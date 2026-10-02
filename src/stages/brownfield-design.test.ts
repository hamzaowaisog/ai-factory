// Direct brownfield builds draw a design (docs/estimates-design.md, "Design references", step 9):
// the design steps sit between the spec and the plan when the request touches UI, and a repo with a
// look of its own meets a match reference with a question on the round-1 card.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DesignInventory } from "../design/inventory.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { uiFactors } from "../estimate/ui-complexity.js";
import { restyleChosen, restyleQuestion, type ClarifyResult } from "./clarify.js";
import { brownfieldSteps } from "./modes.js";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-bf-design-"));
});

let n = 0;
async function run(data: Record<string, unknown> = {}, intake?: { touchesUi?: boolean }) {
  const l = Ledger.create(`20261002-bf-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await l.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "Add an orders page", ...data } }, HUMAN_WRITER);
  if (intake) await l.append({ type: "step.completed", key: "intake/1", inputsHash: "a".repeat(64), outputs: ["b".repeat(64)], data: { changeClass: "feature", risk: "low", ...intake } }, HUMAN_WRITER);
  return brownfieldSteps(replay(l.events())).map((s) => s.key);
}

const SPEC = ["discover", "intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify"];
const BUILD = ["plan", "approve", "stub-commit", "author-tests", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"];

describe("the design steps in a direct brownfield build", () => {
  it("draws and approves the design between the spec and the plan, reading the references first when there are some", async () => {
    expect(await run()).toEqual([...SPEC, "design", "design-baseline", "design-export", ...BUILD]);
    expect(await run({}, { touchesUi: true })).toEqual([...SPEC, "design", "design-baseline", "design-export", ...BUILD]);
    const refs = [{ id: "R-1", kind: "image", source: "a.png", role: "inspire", roleGiven: false, images: [], colours: [], fonts: [], measured: "approximate", notes: [] }];
    expect(await run({ references: refs })).toEqual([...SPEC, "design-refs", "design", "design-baseline", "design-export", ...BUILD]);
  });

  it("drops them once intake finds no UI, and a build from an approved estimate or design follows that one", async () => {
    expect(await run({}, { touchesUi: false })).toEqual([...SPEC, ...BUILD]);
    // a run that planned before builds drew designs is not sent back to draw one
    const l = Ledger.create(`20261002-bf-old-${++n}`);
    await l.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "Add an orders page" } }, HUMAN_WRITER);
    await l.append({ type: "step.started", key: "plan/1", data: { rung: 0 } }, HUMAN_WRITER);
    expect(brownfieldSteps(replay(l.events())).map((s) => s.key)).toEqual([...SPEC, ...BUILD]);
    const estimateRef = { runId: "r0", estimateSha: "e".repeat(64), breakdownSha: "b".repeat(64), specSha: "s".repeat(64), criticSha: "k".repeat(64) };
    expect(await run({ estimateRef })).not.toContain("design");
    const designRef = { runId: "d0", designSha: "d".repeat(64), baselineSha: "a".repeat(64), intakeSha: "i".repeat(64), specSha: "s".repeat(64), criticSha: "k".repeat(64) };
    expect(await run({ designRef })).not.toContain("design");
  });
});

const inv = (pages: number, verdict: "consistent" | "none" = "consistent") => ({
  pages: Array.from({ length: pages }, (_, i) => ({ path: `app/p${i}/page.tsx`, kind: "page", route: `/p${i}`, layout: [], heading: null })),
  verdict, tokens: { total: 24 }, primitives: [{}, {}], composites: [{}],
}) as unknown as DesignInventory;
const ref = (id: string, role: string, source = `${id}.png`) => ({ id, role: role as "match", source });

describe("the restyle question", () => {
  it("is asked only when an app with its own look meets a match reference", () => {
    const q = restyleQuestion([ref("R-1", "match", "acme-brand-guide.pdf"), ref("R-2", "layout")], inv(3), ["I-1", "I-2"], 4)!;
    expect(q.id).toBe("Q-4");
    expect(q.text).toBe("R-1 (acme-brand-guide.pdf) is marked match (use its look exactly), but this app already has its own look (24 design tokens, 3 shared components). Which look should this change use?");
    expect(q.options).toEqual(["Keep the app's own look; use R-1 for layout and content only", "Restyle the whole app to R-1's look (a design-system change: new colours, type and corners on every page)"]);
    expect(q).toMatchObject({ recommended: q.options[0], impact: 3, score: 9, spans: ["I-1", "I-2"], restyle: ["R-1"] });
    expect(restyleQuestion([ref("R-1", "match"), ref("R-2", "match")], inv(1), [], 1)!.text).toMatch(/^R-1 \(R-1\.png\) and R-2 \(R-2\.png\) are marked match \(use their look/);
    expect(restyleQuestion([ref("R-1", "inspire")], inv(3), [], 1)).toBeUndefined();
    expect(restyleQuestion([ref("R-1", "match")], undefined, [], 1)).toBeUndefined();
    expect(restyleQuestion([ref("R-1", "match")], inv(0), [], 1)).toBeUndefined();
    expect(restyleQuestion([ref("R-1", "match")], inv(3, "none"), [], 1)).toBeUndefined();
    expect(restyleQuestion([], inv(3), [], 1)).toBeUndefined();
  });

  it("restyles only when the person chose it; the recommended answer, no question or no answer keep the app's look", () => {
    const q = restyleQuestion([ref("R-1", "match")], inv(3), [], 1)!;
    const res = (answers?: Record<string, string>): ClarifyResult => ({ round: 1, asked: [q], assumptions: [], differences: [], conflicts: [], ...(answers ? { answers } : {}) });
    expect(restyleChosen(res({ "Q-1": q.options[1]! }))).toEqual(["R-1"]);
    expect(restyleChosen(res({ "Q-1": "Restyle it, the client is rebranding" }))).toEqual(["R-1"]);
    expect(restyleChosen(res({ "Q-1": q.options[0]! }))).toBeUndefined();
    expect(restyleChosen(res({ "Q-1": "keep it, but restyle later" }))).toBeUndefined();
    expect(restyleChosen(res())).toBeUndefined();
    expect(restyleChosen({ ...res({ "Q-1": q.options[1]! }), asked: [{ ...q, restyle: undefined }] })).toBeUndefined();
    expect(restyleChosen(undefined)).toBeUndefined();
  });

  it("a restyle is sized as a design-system change in the estimate", () => {
    expect(uiFactors({ restyle: true })).toEqual(["the existing app is restyled to the client's reference: every existing page's look changes (a design-system change)"]);
    expect(uiFactors({ themeSource: "repo" })).toEqual(["the existing app's look and components are reused"]);
  });
});
