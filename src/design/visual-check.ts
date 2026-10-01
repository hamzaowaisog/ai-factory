// The visual check of a finished change (docs/design-step.md, "Visual check"): take the app's pages as they were
// at the base commit and as they are at the head, compare layout, accessibility and pixels, and keep the pictures.
// It is evidence for the reviewer, not a gate: a change request is meant to change how a page looks, so this says
// what moved and where, and the pixel figures are facts with no pass or fail.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { withApp, type AppSpec } from "./app-runner.js";
import { captureReports } from "./capture.js";
import { compareReports, overall, type CheckResult, type StateReport } from "./fidelity.js";
import { NOTICEABLE_RATIO, pixelDiff, type PixelResult } from "./pixeldiff.js";
import { gitSync } from "./source.js";
import type { ProjectConfig } from "../config/project.js";

export type CaptureConfig = NonNullable<NonNullable<ProjectConfig["design"]>["capture"]>;

export interface VisualPage { name: string; viewport: string; base?: string; final?: string; diff?: string; ratio?: number; differing?: number; sizeChanged?: boolean; noticeable?: boolean }
export interface VisualCheck {
  /** why nothing was taken: no config, no UI files, no browser, the app would not start */
  skipped?: string;
  note?: string;
  results: CheckResult[];
  overall: "pass" | "fail" | "unchecked";
  pages: VisualPage[];
  /** folder of the pictures, relative to the run's ledger folder */
  dir: string;
}

export interface VisualInput {
  repo: string;
  base: string;
  /** a checkout of the head commit, already made */
  headDir: string;
  cfg: CaptureConfig;
  /** where the pictures go: <outDir>/base, /final, /diff */
  outDir: string;
  /** what outDir is called in the result, relative to the ledger folder */
  relDir: string;
  tmpDir: string;
  log?: (m: string) => void;
}

async function take(spec: AppSpec, cfg: CaptureConfig, dir: string, log: (m: string) => void): Promise<{ reports: StateReport[]; files: string[]; note?: string }> {
  return withApp(spec, (url) => captureReports(cfg.pages.map((p) => ({ name: p.name, url: url + p.path })), dir), log);
}

export async function visualCheck(i: VisualInput): Promise<VisualCheck> {
  const log = i.log ?? (() => undefined);
  const empty = (skipped: string): VisualCheck => ({ skipped, results: [], overall: "unchecked", pages: [], dir: i.relDir });
  const spec = (cwd: string, offset: number): AppSpec => ({ cwd, ...(i.cfg.install ? { install: i.cfg.install } : {}), start: i.cfg.start, port: i.cfg.port + offset, readyPath: i.cfg.readyPath, timeoutSec: i.cfg.timeoutSec, env: i.cfg.env });
  rmSync(i.outDir, { recursive: true, force: true });
  mkdirSync(join(i.outDir, "base"), { recursive: true });
  mkdirSync(join(i.outDir, "final"), { recursive: true });
  const baseDir = join(i.tmpDir, "base-checkout");
  let added = false;
  try {
    gitSync(i.repo, ["worktree", "add", "--detach", baseDir, i.base]);
    added = true;
    log("visual check: the app as it was at the base commit");
    const before = await take(spec(baseDir, 0), i.cfg, join(i.outDir, "base"), log);
    if (!before.reports.length) return empty(before.note ?? "no pages could be taken at the base commit");
    log("visual check: the app as it is now");
    const after = await take(spec(i.headDir, 1), i.cfg, join(i.outDir, "final"), log);
    if (!after.reports.length) return empty(after.note ?? "no pages could be taken at the head commit");
    const results = compareReports(before.reports, after.reports);
    const pix = await pixelDiff(before.files.filter((f) => after.files.includes(f)).map((f) => ({ name: f, base: join(i.outDir, "base", f), final: join(i.outDir, "final", f), out: join(i.outDir, "diff", f) })));
    const by = new Map<string, PixelResult>(pix.results.map((r) => [r.name, r]));
    const pages: VisualPage[] = after.files.map((f) => {
      const r = by.get(f);
      const viewport = f.replace(/\.png$/, "").split("-").pop() ?? "";
      return {
        name: f.replace(/\.png$/, ""), viewport,
        ...(before.files.includes(f) ? { base: `base/${f}` } : {}), final: `final/${f}`,
        ...(r ? { diff: `diff/${f}`, ratio: r.ratio, differing: r.differing, sizeChanged: r.sizeChanged, noticeable: r.ratio > NOTICEABLE_RATIO || r.sizeChanged } : {}),
      };
    });
    const note = [before.note, after.note, pix.note].filter(Boolean).join("; ");
    return { results, overall: overall(results), pages, dir: i.relDir, ...(note ? { note } : {}) };
  } catch (e) {
    return empty(`the visual check stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  } finally {
    if (added) { try { gitSync(i.repo, ["worktree", "remove", "--force", baseDir]); } catch { /* left for prune */ } }
  }
}

