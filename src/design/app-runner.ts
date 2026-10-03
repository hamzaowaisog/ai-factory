// Start an app from a shell command, wait until it answers, run something against it, stop it (docs/design-step.md,
// "Visual check"). This runs the project's own commands on this machine, so the caller must have been told to
// (design.capture.allowHost). The app gets a small environment: no secrets from the factory's own, a scratch HOME.
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface AppSpec { cwd: string; install?: string; start: string; port: number; readyPath: string; timeoutSec: number; env: Record<string, string>; /** the log prefix; default "visual check" */ what?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function appEnv(spec: AppSpec, home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, CI: "1", NODE_ENV: "production", ...spec.env, PORT: String(spec.port) };
}

async function answers(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" })).status < 500; } catch { return false; }
}

/** Install, start, wait for the ready path, call `fn` with the base URL, always stop. Throws with a short reason. */
export async function withApp<T>(spec: AppSpec, fn: (baseUrl: string) => Promise<T>, log: (m: string) => void = () => undefined): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "factory-app-"));
  let child: ReturnType<typeof spawn> | undefined;
  let tail = "";
  try {
    if (spec.install) {
      log(`${spec.what ?? "visual check"}: ${spec.install}`);
      try { await run("sh", ["-c", spec.install], { cwd: spec.cwd, env: appEnv(spec, home), timeout: spec.timeoutSec * 1000, maxBuffer: 16 * 1024 * 1024 }); }
      catch (e) { throw new Error(`install failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split("\n").slice(-3).join(" | ")}`); }
    }
    child = spawn("sh", ["-c", spec.start], { cwd: spec.cwd, env: appEnv(spec, home), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let exited: number | null | undefined;
    child.on("exit", (code) => { exited = code ?? -1; });
    child.on("error", () => { exited = -1; });
    for (const s of [child.stdout, child.stderr]) s?.on("data", (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });
    const base = `http://127.0.0.1:${spec.port}`;
    const until = Date.now() + spec.timeoutSec * 1000;
    while (!(await answers(base + spec.readyPath))) {
      if (exited !== undefined) throw new Error(`the app exited (${exited}) before it answered: ${tail.trim().split("\n").slice(-3).join(" | ")}`);
      if (Date.now() > until) throw new Error(`the app did not answer ${spec.readyPath} within ${spec.timeoutSec}s: ${tail.trim().split("\n").slice(-3).join(" | ")}`);
      await sleep(400);
    }
    return await fn(base);
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
      await sleep(300);
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
    }
    rmSync(home, { recursive: true, force: true });
  }
}
