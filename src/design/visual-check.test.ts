import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the test config turns screenshots off everywhere else; these tests are about the real browser
const offBefore = process.env.FACTORY_NO_SCREENSHOTS;
beforeAll(() => { delete process.env.FACTORY_NO_SCREENSHOTS; });
afterAll(() => { if (offBefore !== undefined) process.env.FACTORY_NO_SCREENSHOTS = offBefore; });
import { findChromium } from "./screenshots.js";
import { withApp } from "./app-runner.js";
import { visualCheck, type CaptureConfig } from "./visual-check.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();

const SERVER = `require("http").createServer((req,res)=>{res.setHeader("content-type","text/html");res.end(require("fs").readFileSync(__dirname+"/index.html"))}).listen(process.env.PORT,"127.0.0.1")`;
const page = (color: string, extra = "") => `<!doctype html><html lang="en"><body style="margin:0"><h1 style="background:${color};margin:0">Orders</h1><button>Go</button>${extra}</body></html>`;

function repoWith(a: string, b: string): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "vis-repo-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "server.js"), SERVER);
  writeFileSync(join(dir, "index.html"), a);
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "base");
  const base = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "index.html"), b);
  git(dir, "commit", "-qam", "head", "--allow-empty");
  return { dir, base, head: git(dir, "rev-parse", "HEAD") };
}

const cfg = (over: Partial<CaptureConfig> = {}): CaptureConfig => ({ allowHost: true, start: "node server.js", pages: [{ name: "Orders", path: "/" }], port: 4390, readyPath: "/", timeoutSec: 30, env: {}, ...over });

describe("withApp", () => {
  it("starts the command, waits for it to answer, and stops it", async () => {
    const { dir } = repoWith(page("#fff"), page("#fff"));
    let url = "";
    await withApp({ cwd: dir, start: "node server.js", port: 4381, readyPath: "/", timeoutSec: 20, env: {} }, async (u) => { url = u; expect((await fetch(u)).status).toBe(200); });
    await expect(fetch(url, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
  }, 40_000);
  it("says why when the app exits early or never answers, and hides the factory's secrets from it", async () => {
    const { dir } = repoWith(page("#fff"), page("#fff"));
    await expect(withApp({ cwd: dir, start: "echo boom >&2; exit 3", port: 4382, readyPath: "/", timeoutSec: 20, env: {} }, async () => 1)).rejects.toThrow(/exited \(3\).*boom/);
    await expect(withApp({ cwd: dir, install: "exit 1", start: "true", port: 4383, readyPath: "/", timeoutSec: 20, env: {} }, async () => 1)).rejects.toThrow(/install failed/);
    process.env.FACTORY_TEST_SECRET = "sk-secret";
    try {
      await withApp({ cwd: dir, start: `node -e 'require("http").createServer((q,r)=>r.end(process.env.FACTORY_TEST_SECRET||"none")).listen(process.env.PORT,"127.0.0.1")'`, port: 4384, readyPath: "/", timeoutSec: 20, env: {} },
        async (u) => { expect(await (await fetch(u)).text()).toBe("none"); });
    } finally { delete process.env.FACTORY_TEST_SECRET; }
  }, 60_000);
});

describe.skipIf(!findChromium())("visual check", () => {
  it("takes the page before and after, compares them, and keeps the pictures", async () => {
    const { dir, base, head } = repoWith(page("#2255cc"), page("#cc5522", "<p>New line</p>"));
    const out = mkdtempSync(join(tmpdir(), "vis-out-"));
    const r = await visualCheck({ repo: dir, base, headDir: dir, cfg: cfg(), outDir: join(out, "design-check"), relDir: "design-check", tmpDir: out });
    expect(r.skipped).toBeUndefined();
    expect(r.pages.map((p) => p.viewport).sort()).toEqual(["desktop", "phone", "tablet"]);
    for (const p of r.pages) {
      expect(p.noticeable).toBe(true);
      expect(p.ratio).toBeGreaterThan(0);
      for (const f of [p.base, p.final, p.diff]) expect(existsSync(join(out, "design-check", f!))).toBe(true);
    }
  }, 120_000);

  it("skips, with the reason, when the app cannot start", async () => {
    const { dir, base } = repoWith(page("#fff"), page("#fff"));
    const out = mkdtempSync(join(tmpdir(), "vis-out-"));
    const r = await visualCheck({ repo: dir, base, headDir: dir, cfg: cfg({ start: "exit 2", port: 4395 }), outDir: join(out, "dc"), relDir: "dc", tmpDir: out });
    expect(r.skipped).toMatch(/exited \(2\)/);
    expect(r.pages).toEqual([]);
  }, 60_000);
});
