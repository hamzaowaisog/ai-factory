// The existing app's pages as they are today on the design approval card (the PR #11 re-review, item 6).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { designCard } from "../stages/design-approve.js";
import { currentPictures, MAX_CURRENT_PAGES, openablePages } from "./current-pages.js";
import { findChromium } from "./screenshots.js";
import type { CaptureConfig } from "./visual-check.js";

// the test config turns screenshots off everywhere else; this test is about the real browser
const offBefore = process.env.FACTORY_NO_SCREENSHOTS;
beforeAll(() => { delete process.env.FACTORY_NO_SCREENSHOTS; });
afterAll(() => { if (offBefore !== undefined) process.env.FACTORY_NO_SCREENSHOTS = offBefore; });

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
const SERVER = `require("http").createServer((req,res)=>{res.setHeader("content-type","text/html");res.end("<!doctype html><html lang=en><body><h1>"+req.url+"</h1></body></html>")}).listen(process.env.PORT,"127.0.0.1")`;
const cfg: CaptureConfig = { allowHost: true, start: "node server.js", pages: [{ name: "Home", path: "/" }], port: 4396, readyPath: "/", timeoutSec: 30, env: {} };

describe("pictures of the current pages", () => {
  it("opens only fixed routes, each once, up to the cap", () => {
    const pages = [{ name: "A", route: "/invoices" }, { name: "B", route: "/invoices/:id" }, { name: "C", route: "/blog/[slug]" }, { name: "D", route: "/invoices" }, { name: "E", route: "reports" }, { name: "F", route: "/reports" }];
    expect(openablePages(pages).map((p) => p.name)).toEqual(["A", "F"]);
    expect(openablePages(Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, route: `/p${i}` })))).toHaveLength(MAX_CURRENT_PAGES);
  });

  it.runIf(!!findChromium())("starts the app at the base commit and takes each page, leaving no checkout behind", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cur-repo-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "server.js"), SERVER);
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
    const base = git(repo, "rev-parse", "HEAD");
    const out = mkdtempSync(join(tmpdir(), "cur-out-"));
    const tmp = join(out, "tmp");
    const got = await currentPictures({ repo, base, cfg, pages: [{ name: "Invoices current", route: "/invoices" }, { name: "Detail", route: "/invoices/:id" }], outDir: join(out, "current"), tmpDir: tmp });
    expect(got.files).toEqual(["invoices-current-phone.png", "invoices-current-tablet.png", "invoices-current-desktop.png"]);
    for (const f of got.files) expect(existsSync(join(out, "current", f))).toBe(true);
    expect(existsSync(join(tmp, "current-checkout"))).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain("current-checkout");
  }, 90_000);

  it("never throws: an app that will not start is a note", async () => {
    const repo = mkdtempSync(join(tmpdir(), "cur-repo-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "server.js"), "process.exit(4)");
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
    const got = await currentPictures({ repo, base: git(repo, "rev-parse", "HEAD"), cfg, pages: [{ name: "Home", route: "/" }], outDir: join(repo, "..", "x"), tmpDir: mkdtempSync(join(tmpdir(), "cur-tmp-")) });
    expect(got).toMatchObject({ files: [] });
    expect(got.note).toMatch(/the current pages were not taken: the app exited \(4\)/);
  }, 60_000);

  it("shows the pictures, or why there are none, under current vs proposed on the card", () => {
    const design = { flow: "f", themeSource: "repo", mapping: { unmappedReqs: [], orphanScreens: [] }, screens: [{ id: "S-1", route: "/invoices", file: "src/pages/Invoices.tsx", reqs: ["R-1"], size: "tweak" }] } as never;
    const current = [{ screen: "S-1", size: "tweak", route: "/invoices", file: "src/pages/Invoices.tsx", found: true, uses: [], proposed: [] }];
    expect(designCard("r", design, "a".repeat(64), { current, currentShots: { dir: "/runs/r/preview/current", count: 3 } }))
      .toContain("Pictures of the current pages: 3 in /runs/r/preview/current (the app at the base commit; Preview on the run page shows them beside the demo).");
    expect(designCard("r", design, "a".repeat(64), { current, currentShots: { dir: "d", count: 0, note: "set design.capture in the project config to take them" } }))
      .toContain("Pictures of the current pages: none (set design.capture in the project config to take them).");
  });
});
