import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { brownfieldSteps, estimateSteps, stepsFor } from "./modes.js";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-modes-"));
});

async function stateFor(mode: string) {
  const l = Ledger.create(`20260930-${mode}-abcd`);
  await l.append({ type: "run.created", data: { mode, project: "p", request: "x" } }, HUMAN_WRITER);
  return replay(l.events());
}

describe("mode manifests", () => {
  it("dispatches on the run's mode", async () => {
    const b = await stateFor("brownfield");
    const e = await stateFor("estimate");
    expect(stepsFor(b).map((s) => s.key)).toEqual(brownfieldSteps(b).map((s) => s.key));
    expect(stepsFor(e).map((s) => s.key)).toEqual(estimateSteps(e).map((s) => s.key));
  });

  it("estimate mode reuses the spec pipeline, adds breakdown, estimate, approval and export, and stops before any build step", async () => {
    const keys = estimateSteps(await stateFor("estimate")).map((s) => s.key);
    expect(keys).toEqual(["intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "design-baseline", "breakdown", "estimate", "approve-estimate", "export"]);
    for (const k of ["plan", "approve", "implement", "integrate", "deliver"]) expect(keys).not.toContain(k);
  });

  it("a large requirements document runs intake, clarify and the spec pipeline per module, then joins them under the same keys", async () => {
    const l = Ledger.create("20260930-estimate-big1");
    const section = (n: number) => `# Module ${n}\n\n${"The system shall do a thing in detail. ".repeat(300)}`;
    await l.append({ type: "run.created", data: { mode: "estimate", project: "p", request: [1, 2, 3].map(section).join("\n\n") } }, HUMAN_WRITER);
    const keys = estimateSteps(replay(l.events())).map((s) => s.key);
    expect(keys).toEqual([
      "intake:m1", "intake:m2", "intake:m3", "intake", "ground",
      "clarify:m1", "clarify:m2", "clarify:m3", "clarify", "clarify-2:m1", "clarify-2:m2", "clarify-2:m3", "clarify-2",
      "drafts:m1", "merge:m1", "specify:m1", "drafts:m2", "merge:m2", "specify:m2", "drafts:m3", "merge:m3", "specify:m3", "specify",
      "design-baseline", "breakdown", "estimate", "approve-estimate", "export",
    ]);
    // the same request gives the same list (a replay must not reshuffle steps)
    expect(estimateSteps(replay(l.events())).map((s) => s.key)).toEqual(keys);
  });

  it("refuses a mode with no step list yet", async () => {
    const g = await stateFor("greenfield");
    expect(() => stepsFor(g)).toThrow(/greenfield/);
  });
});
