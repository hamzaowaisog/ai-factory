import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { brownfieldSteps, designOnlySteps, estimateSteps, greenfieldSteps, stepsFor } from "./modes.js";

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

  it("greenfield builds an approved design for a new product: seeded spec, then every build step and gate", async () => {
    const l = Ledger.create("20261003-greenfield-abcd");
    const ref = { runId: "d0", designSha: "d".repeat(64), baselineSha: "a".repeat(64), intakeSha: "i".repeat(64), specSha: "s".repeat(64), criticSha: "k".repeat(64), groundSha: "g".repeat(64), clarifySha: "c".repeat(64) };
    await l.append({ type: "run.created", data: { mode: "greenfield", project: "p", request: "x", designRef: ref } }, HUMAN_WRITER);
    const s = replay(l.events());
    expect(stepsFor(s).map((x) => x.key)).toEqual(["discover", "intake", "ground", "clarify", "specify", "plan", "approve", "stub-commit", "author-tests", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]);
    // a design run with no ground output of its own: what exists is nothing, stated without a model call
    const l2 = Ledger.create("20261003-greenfield-efgh");
    const { groundSha: _g, clarifySha: _c, ...bare } = ref;
    await l2.append({ type: "run.created", data: { mode: "greenfield", project: "p", request: "x", designRef: bare } }, HUMAN_WRITER);
    expect(greenfieldSteps(replay(l2.events())).map((x) => x.key)).toEqual(["discover", "intake", "specify", "ground", "plan", "approve", "stub-commit", "author-tests", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]);
    const none = await stateFor("greenfield");
    expect(() => greenfieldSteps(none)).toThrow(/approved design/);
  });

  it("estimate mode reuses the spec pipeline, adds breakdown, estimate, approval and export, and stops before any build step", async () => {
    const keys = estimateSteps(await stateFor("estimate")).map((s) => s.key);
    expect(keys).toEqual(["intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "design", "design-baseline", "design-export", "breakdown", "estimate", "approve-estimate", "export"]);
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
      "design", "design-baseline", "design-export", "breakdown", "estimate", "approve-estimate", "export",
    ]);
    // the same request gives the same list (a replay must not reshuffle steps)
    expect(estimateSteps(replay(l.events())).map((s) => s.key)).toEqual(keys);
  });

  it("the other delivery model is seeded with the approved spec, answers and tasks, and only sizes them again", async () => {
    const l = Ledger.create("20260930-estimate-sib1");
    await l.append({ type: "run.created", data: { mode: "estimate", project: "p", request: "x", parent: { runId: "r0", kind: "sibling", estimateSha: "e".repeat(64), breakdownSha: "b".repeat(64), specSha: "s".repeat(64), clarifySha: "c".repeat(64) } } }, HUMAN_WRITER);
    expect(estimateSteps(replay(l.events())).map((s) => s.key)).toEqual(["specify", "clarify", "breakdown", "estimate", "approve-estimate", "export"]);
  });

  it("the other delivery model keeps the approved design and its approval instead of redrawing it", async () => {
    const l = Ledger.create("20260930-estimate-sib2");
    await l.append({ type: "run.created", data: { mode: "estimate", project: "p", request: "x", parent: { runId: "r0", kind: "sibling", estimateSha: "e".repeat(64), breakdownSha: "b".repeat(64), specSha: "s".repeat(64), designSha: "d".repeat(64), baselineSha: "a".repeat(64) } } }, HUMAN_WRITER);
    expect(estimateSteps(replay(l.events())).map((s) => s.key)).toEqual(["specify", "design", "design-baseline", "breakdown", "estimate", "approve-estimate", "export"]);
  });

  it("a build run seeded from an estimate inherits its spec instead of clarifying and specifying", async () => {
    const l = Ledger.create("20260930-build-seed1");
    await l.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x", estimateRef: { runId: "r0", estimateSha: "e".repeat(64), breakdownSha: "b".repeat(64), specSha: "s".repeat(64), criticSha: "k".repeat(64) } } }, HUMAN_WRITER);
    const keys = brownfieldSteps(replay(l.events())).map((s) => s.key);
    expect(keys).toEqual(["discover", "intake", "ground", "specify", "plan", "approve", "stub-commit", "author-tests", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]);
  });

  it("design mode runs the estimate's road to the spec, then the design pipeline, and stops at the approved design", async () => {
    const d = await stateFor("design");
    const keys = stepsFor(d).map((s) => s.key);
    expect(keys).toEqual(designOnlySteps(d).map((s) => s.key));
    expect(keys).toEqual(["intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "design", "design-baseline", "design-export"]);
    for (const k of ["breakdown", "estimate", "approve-estimate", "export", "plan", "implement"]) expect(keys).not.toContain(k);
  });

  const ref = { runId: "d0", designSha: "d".repeat(64), baselineSha: "a".repeat(64), intakeSha: "i".repeat(64), specSha: "s".repeat(64), criticSha: "k".repeat(64), clarifySha: "c".repeat(64), groundSha: "g".repeat(64), surveySha: "v".repeat(64) };

  it("an estimate from an approved design inherits intake, grounding, answers, spec and design, and only sizes them", async () => {
    const l = Ledger.create("20261002-estimate-fromdesign");
    await l.append({ type: "run.created", data: { mode: "estimate", project: "p", request: "x", designRef: ref } }, HUMAN_WRITER);
    const steps = estimateSteps(replay(l.events()));
    expect(steps.map((s) => s.key)).toEqual(["intake", "ground", "clarify", "specify", "design", "design-baseline", "breakdown", "estimate", "approve-estimate", "export"]);
    // the ground seed keeps the survey under its name, where breakdown reads it
    const ground = await steps[1]!.run({ state: replay(l.events()) } as never);
    expect(ground).toMatchObject({ kind: "done", outputs: { ground: "g".repeat(64), survey: "v".repeat(64) }, data: { seeded: true, from: "d0" } });
  });

  it("a build from an approved design inherits its spec, like a build from an estimate", async () => {
    const l = Ledger.create("20261002-build-fromdesign");
    await l.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x", designRef: ref } }, HUMAN_WRITER);
    expect(brownfieldSteps(replay(l.events())).map((s) => s.key)).toEqual(["discover", "intake", "ground", "specify", "plan", "approve", "stub-commit", "author-tests", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]);
  });

  it("refuses a mode with no step list yet", async () => {
    const g = await stateFor("greenfield");
    expect(() => stepsFor(g)).toThrow(/greenfield/);
  });
});
