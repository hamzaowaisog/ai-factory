import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_PROXY_URL, FEEDS_NET } from "../runners/netinfra.js";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { PIPE_JS, withAppInContainer } from "./app-container.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** Records what was asked of it; every container "exits 0" and the app "answers 200" to the ready check. */
function fakeRuntime(installExit = 0) {
  const created: (ContainerSpec & { id: string })[] = [];
  const removed: string[] = [];
  const rt: ContainerRuntime = {
    binary: "docker",
    version: async () => "1",
    create: async (s) => { const id = `c${created.length}`; created.push({ ...s, id }); return id; },
    start: async () => undefined,
    wait: async () => installExit,
    exec: async () => ({ code: 0, stdout: "200", stderr: "" }),
    logs: async () => "npm ERR! nope",
    isRunning: async () => true,
    stop: async () => undefined,
    remove: async (id) => { removed.push(id); },
    listByLabel: async () => [],
    imageDigest: async (i) => i,
  };
  return { rt, created, removed };
}

let app: Server;
let appPort = 0;
let repo = "", commit = "";
beforeAll(async () => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-appc-"));
  repo = mkdtempSync(join(tmpdir(), "factory-appc-repo-"));
  writeFileSync(join(repo, "package.json"), "{}\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  execFileSync("git", ["add", "-A"], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", "app"], { cwd: repo, env });
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env, encoding: "utf8" }).trim();
  // stands in for the app inside the container
  app = createServer((req, res) => res.end(`hello from ${req.url}`));
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  appPort = (app.address() as AddressInfo).port;
});
afterAll(() => { app.close(); });

describe("the fidelity check's app in containers (PR #11 re-review, blocker 2)", () => {
  it("installs with only the package feeds, starts with no network, and is reached through the local bridge", async () => {
    const { rt, created, removed } = fakeRuntime();
    // the bridge's pipe, run here instead of in a container: the same script `docker exec -i` runs
    const pipe = (_id: string, port: number) => spawn(process.execPath, ["-e", PIPE_JS, String(port)], { stdio: ["pipe", "pipe", "ignore"] });
    const body = await withAppInContainer({
      rt, image: "factory-agent:dotnet8", runId: "r1", repo, commit, install: "npm install", start: "npm start", port: appPort,
      readyPath: "/", timeoutSec: 30, env: { A: "1" }, pipe,
    }, async (base) => {
      expect(base).not.toContain(`:${appPort}`);
      return (await fetch(`${base}/sign-in`)).text();
    });
    expect(body).toBe("hello from /sign-in");
    const [install, start] = created;
    expect(install).toMatchObject({ role: "restore", network: FEEDS_NET, entrypoint: "", cmd: ["sh", "-c", "npm install"] });
    expect(install!.env).toMatchObject({ HTTPS_PROXY: FEED_PROXY_URL });
    expect(start).toMatchObject({ role: "app", network: "none", cmd: ["sh", "-c", "npm start"] });
    expect(start!.env).toMatchObject({ A: "1", PORT: String(appPort), NODE_ENV: "production" });
    // a copy of the commit is mounted, never the checkout itself
    for (const c of created) expect(c.mounts.map((m) => m.src)).not.toContain(repo);
    expect(removed).toEqual(expect.arrayContaining(["c0", "c1"]));
  });

  it("a failed install stops there, with the end of its log", async () => {
    const { rt, created, removed } = fakeRuntime(1);
    await expect(withAppInContainer({ rt, image: "i", runId: "r2", repo, commit, install: "npm install", start: "npm start", port: 4320, readyPath: "/", timeoutSec: 30, env: {} }, async () => "never"))
      .rejects.toThrow(/install failed \(exit 1\): npm ERR! nope/);
    expect(created).toHaveLength(1);
    expect(removed).toEqual(["c0"]);
  });
});
