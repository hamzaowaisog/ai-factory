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

  it("estimate mode reuses the spec pipeline and stops before any build step", async () => {
    const keys = estimateSteps(await stateFor("estimate")).map((s) => s.key);
    expect(keys).toEqual(["intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify"]);
    for (const k of ["plan", "approve", "implement", "integrate", "deliver"]) expect(keys).not.toContain(k);
  });

  it("refuses a mode with no step list yet", async () => {
    const g = await stateFor("greenfield");
    expect(() => stepsFor(g)).toThrow(/greenfield/);
  });
});
