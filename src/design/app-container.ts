// Run a built app for a check inside containers, not on this machine (the PR #11 re-review, blocker 2): the fidelity check's
// app is code the agents wrote, so its install and start never run on the factory host.
//   install: the agent image, a copy of the commit, only the package feeds (through the feed proxy)
//   start:   the same image with no network at all; this machine reaches it through a small local bridge that pipes each
//            connection into the container (`docker exec -i … node`), so no port is published and the app has no way out
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { FEED_PROXY_URL, FEEDS_NET } from "../runners/netinfra.js";
import { factoryHome } from "../util/paths.js";
import { copyTree } from "../verify/dotnet.js";
import { stopAndRemove, type ContainerRuntime } from "../verify/runtime.js";

export interface ContainerAppSpec {
  rt: ContainerRuntime;
  image: string;
  runId: string;
  /** the repo (or worktree) and the commit to copy; the checkout itself is never mounted */
  repo: string;
  commit: string;
  install?: string;
  /** builds and starts the app on $PORT */
  start: string;
  port: number;
  readyPath: string;
  timeoutSec: number;
  env: Record<string, string>;
  what?: string;
  /** one connection into the container's loopback port; the default runs `<cli> exec -i <id> node` */
  pipe?: (id: string, port: number) => ChildProcess;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const user = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
const ENV = { HOME: "/tmp", npm_config_cache: "/tmp/npm-cache", npm_config_update_notifier: "false", NEXT_TELEMETRY_DISABLED: "1", CI: "1" };

/** Copies stdin to 127.0.0.1:<port> and the answers back, inside the container. */
export const PIPE_JS = `const s=require("net").connect(+process.argv[1],"127.0.0.1");process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(1));s.on("close",()=>process.exit(0));`;

/** Prints the HTTP status of a GET (0 when nothing answers yet), inside the container. */
const READY_JS = `fetch(process.argv[1],{redirect:"manual",signal:AbortSignal.timeout(5000)}).then(r=>process.stdout.write(String(r.status)),()=>process.stdout.write("0"));`;

const defaultPipe = (rt: ContainerRuntime) => (id: string, port: number) =>
  spawn(rt.binary, ["exec", "-i", id, "node", "-e", PIPE_JS, String(port)], { stdio: ["pipe", "pipe", "ignore"] });

/** A local port on 127.0.0.1 whose connections are each piped into the container. */
export async function bridge(open: () => ChildProcess): Promise<{ port: number; close: () => void }> {
  const socks = new Set<Socket>();
  const server = createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    const p = open();
    sock.pipe(p.stdin!);
    p.stdout!.pipe(sock);
    const end = () => { sock.destroy(); p.kill(); };
    p.on("exit", end);
    p.on("error", end);
    sock.on("error", end);
    sock.on("close", () => p.kill());
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  return { port: (server.address() as AddressInfo).port, close: () => { server.close(); for (const s of socks) s.destroy(); } };
}

/** Install and start the app in containers, wait for the ready path, call `fn` with a local base URL, always stop. */
export async function withAppInContainer<T>(spec: ContainerAppSpec, fn: (baseUrl: string) => Promise<T>, log: (m: string) => void = () => undefined): Promise<T> {
  const { rt } = spec;
  const what = spec.what ?? "app check";
  // under the factory's home: Colima and Docker Desktop share the home folder with their VM, not the system temp folder
  const work = join(factoryHome(), "tmp", spec.runId, `app-${Date.now()}-${randomBytes(3).toString("hex")}`);
  const src = join(work, "src");
  mkdirSync(src, { recursive: true });
  const live = new Set<string>();
  const launch = async (role: "restore" | "app", network: string, cmd: string, env: Record<string, string>) => {
    const id = await rt.create({
      image: spec.image, role, labels: { run: spec.runId, key: what }, network, user: user(), entrypoint: "", workdir: "/src",
      mounts: [{ src, dst: "/src" }], env: { ...ENV, ...env }, cmd: ["sh", "-c", cmd],
    });
    live.add(id);
    await rt.start(id);
    return id;
  };
  const tail = async (id: string) => (await rt.logs(id).catch(() => "")).trim().split("\n").slice(-3).join(" | ");
  let close: (() => void) | undefined;
  try {
    copyTree(spec.repo, spec.commit, src);
    if (spec.install) {
      log(`${what}: ${spec.install} (in a container, package feeds only)`);
      const id = await launch("restore", FEEDS_NET, spec.install, { HTTPS_PROXY: FEED_PROXY_URL, HTTP_PROXY: FEED_PROXY_URL, https_proxy: FEED_PROXY_URL, http_proxy: FEED_PROXY_URL });
      const code = await rt.wait(id, spec.timeoutSec * 1000);
      if (code !== 0) throw new Error(`install failed (exit ${code ?? "timeout"}): ${await tail(id)}`);
      await stopAndRemove(rt, id);
      live.delete(id);
    }
    log(`${what}: ${spec.start} (in a container, no network)`);
    const app = await launch("app", "none", spec.start, { NODE_ENV: "production", ...spec.env, PORT: String(spec.port), HOSTNAME: "127.0.0.1" });
    const until = Date.now() + spec.timeoutSec * 1000;
    for (;;) {
      if (!(await rt.isRunning(app))) throw new Error(`the app exited before it answered: ${await tail(app)}`);
      const r = await rt.exec(app, ["node", "-e", READY_JS, `http://127.0.0.1:${spec.port}${spec.readyPath}`]);
      const status = Number(r.stdout.trim()) || 0;
      if (status > 0 && status < 500) break;
      if (Date.now() > until) throw new Error(`the app did not answer ${spec.readyPath} within ${spec.timeoutSec}s: ${await tail(app)}`);
      await sleep(1000);
    }
    const pipe = spec.pipe ?? defaultPipe(rt);
    const b = await bridge(() => pipe(app, spec.port));
    close = b.close;
    return await fn(`http://127.0.0.1:${b.port}`);
  } finally {
    close?.();
    for (const id of live) await stopAndRemove(rt, id).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
}
