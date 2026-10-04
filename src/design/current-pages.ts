// Pictures of an existing app's pages as they are today, for the design approval card (the PR #11 re-review, item 6): the
// person approving a change to a page sees the page now beside the proposed screen, not only its file and route. It uses
// the project's visual-check settings (design.capture), so it runs only where the project agreed to start its app on this
// machine (allowHost); otherwise the card says how to turn it on. Best effort: never a reason to stop.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withApp } from "./app-runner.js";
import { captureReports } from "./capture.js";
import { gitSync } from "./source.js";
import type { CaptureConfig } from "./visual-check.js";

/** Most current pages pictured for one card. */
export const MAX_CURRENT_PAGES = 8;

/** The pages that can be opened as they are: a fixed route (no :id, [slug] or *), each once, at most MAX_CURRENT_PAGES. */
export function openablePages(pages: { name: string; route: string }[]): { name: string; route: string }[] {
  const seen = new Set<string>();
  return pages.filter((p) => p.route.startsWith("/") && !/[:[*]/.test(p.route) && !seen.has(p.route) && seen.add(p.route)).slice(0, MAX_CURRENT_PAGES);
}

export interface CurrentPictures { files: string[]; note?: string }

/** Start the app at the base commit and take each page at phone, tablet and desktop width into outDir. Never throws. */
export async function currentPictures(i: { repo: string; base: string; cfg: CaptureConfig; pages: { name: string; route: string }[]; outDir: string; tmpDir: string; log?: (m: string) => void }): Promise<CurrentPictures> {
  const pages = openablePages(i.pages);
  if (!pages.length) return { files: [], note: "none of the changed pages has a fixed route to open" };
  const dir = join(i.tmpDir, "current-checkout");
  let added = false;
  try {
    mkdirSync(i.tmpDir, { recursive: true });
    gitSync(i.repo, ["worktree", "add", "--detach", dir, i.base]);
    added = true;
    i.log?.(`design-baseline: pictures of ${pages.length} current page(s), from the app at the base commit`);
    const got = await withApp(
      { cwd: dir, ...(i.cfg.install ? { install: i.cfg.install } : {}), start: i.cfg.start, port: i.cfg.port, readyPath: i.cfg.readyPath, timeoutSec: i.cfg.timeoutSec, env: i.cfg.env, what: "current pages" },
      (url) => captureReports(pages.map((p) => ({ name: p.name, url: url + p.route })), i.outDir), i.log,
    );
    return { files: got.files, ...(got.note ? { note: got.note } : {}) };
  } catch (e) {
    return { files: [], note: `the current pages were not taken: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    if (added) { try { gitSync(i.repo, ["worktree", "remove", "--force", dir]); } catch { /* left for prune */ } }
  }
}
