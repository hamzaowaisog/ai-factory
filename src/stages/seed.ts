// A step whose output is an artifact already in this ledger, copied there from an approved run
// (src/estimate/lineage.ts). It lets a run inherit a spec, answers or breakdown instead of producing them.
import type { RunInfo } from "../ledger/state.js";
import type { StepDef } from "./framework.js";

export function seedStep(key: string, stage: string, main: (i: RunInfo) => string | undefined, extra: Record<string, (i: RunInfo) => string | undefined> = {}): StepDef {
  const shas = (i: RunInfo): Record<string, string | undefined> => ({ main: main(i), ...Object.fromEntries(Object.entries(extra).map(([k, f]) => [k, f(i)])) });
  return {
    key, stage, templateVersion: "1",
    inputs: (s) => (main(s.info) ? { seed: shas(s.info) } : undefined),
    async run(ctx) {
      const { main: sha, ...rest } = shas(ctx.state.info);
      const named: Record<string, string> = { [key]: sha! };
      for (const [k, v] of Object.entries(rest)) if (v) named[k] = v;
      return { kind: "done", outputs: named, data: { seeded: true, openFindings: [], repairs: 0, conflicts: [], manualUi: [], from: ctx.state.info.parent?.runId ?? ctx.state.info.estimateRef?.runId ?? ctx.state.info.designRef?.runId } };
    },
  };
}
