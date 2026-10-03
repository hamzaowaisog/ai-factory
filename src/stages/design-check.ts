// design-check (no model): after accept, the project's pages as they were at the base commit and as they are
// now, compared for layout, accessibility and pixels (docs/design-step.md, "Visual check"). Evidence for the
// reviewer and for `factory ui`; it never stops the run. It does nothing unless the project opted in with
// design.capture, because it starts the project's own app on this machine.
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { touchesUiFiles } from "../design/build-checks.js";
import { visualCheck, type VisualCheck } from "../design/visual-check.js";
import { ensureWorktree, codeBase } from "./workspace.js";
import { requireOutput, type StepDef, type StepOutcome } from "./framework.js";

export const designCheckStep: StepDef = {
  key: "design-check", stage: "accept", templateVersion: "1",
  inputs: (s) => (s.steps.get("accept")?.status === "completed" ? { integrate: s.steps.get("integrate")!.outputs[0], head: s.steps.get("integrate")!.data?.commit } : undefined),
  async run(ctx): Promise<StepOutcome> {
    requireOutput(ctx.state, ctx.ledger, "integrate");
    const head = String(ctx.state.steps.get("integrate")!.data!.commit);
    const cfg = ctx.project.design?.capture;
    const done = (v: VisualCheck): StepOutcome => ({
      kind: "done", outputs: { check: ctx.ledger.putJson(v) },
      data: { ...(v.skipped ? { skipped: v.skipped } : { overall: v.overall, pages: v.pages.length, noticeable: v.pages.filter((p) => p.noticeable).length }) },
    });
    const skip = (why: string): StepOutcome => { ctx.log(`visual check skipped: ${why}`); return done({ skipped: why, results: [], overall: "unchecked", pages: [], dir: "design-check" }); };
    if (!cfg) return skip("no design.capture in the project config");
    const repo = ctx.state.info.repoPath!;
    const base = ctx.state.info.baseCommit!;
    const wt = await ensureWorktree(ctx, head);
    if (!touchesUiFiles(wt, codeBase(ctx.state), head)) return skip("no UI files changed");
    const tmp = mkdtempSync(join(tmpdir(), "factory-visual-"));
    try {
      const outDir = join(ctx.ledger.dir, "design-check");
      mkdirSync(outDir, { recursive: true });
      const v = await visualCheck({ repo, base, headDir: wt, cfg, outDir, relDir: "design-check", tmpDir: tmp, log: ctx.log });
      ctx.log(v.skipped ? `visual check skipped: ${v.skipped}` : `visual check: ${v.overall}; ${v.pages.filter((p) => p.noticeable).length} of ${v.pages.length} picture(s) differ noticeably`);
      return done(v);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
};
