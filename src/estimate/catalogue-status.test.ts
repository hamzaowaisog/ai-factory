import { describe, expect, it } from "vitest";
import { loadCatalogue } from "./catalogue.js";
import { catalogueEvidence, catalogueStatusText, factorChecks } from "./catalogue-status.js";
import type { DecisionPair } from "./decisions.js";

const c = loadCatalogue();
let n = 0;
/** one finished task: its size pick, the build it was in and the minutes it took */
const pair = (choice: string, activeMin: number, over: { question?: string; kind?: string; build?: string; outcome?: string; catalogue?: string } = {}): DecisionPair => ({
  taskId: `EST-${++n}`, question: (over.question ?? "size") as never, choice, backend: "llm", confidence: 1, votes: [choice],
  features: { kind: over.kind ?? "be-crud", track: "backend", catalogue: over.catalogue ?? c.version },
  estimateRun: "e", buildRun: over.build ?? `b${n % 12}`, actual: { activeMin, turns: 10, attempts: 1, costUsd: 1, outcome: over.outcome ?? "completed" },
});
const many = (k: number, choice: string, min: number, over: Parameters<typeof pair>[2] = {}) => Array.from({ length: k }, () => pair(choice, min, over));

describe("catalogue status from evidence", () => {
  it("measures a pick's factor against the baseline within one kind, and needs enough tasks on both sides", () => {
    // large should be 1.6x typical: 32 vs 20 min holds; 4 small tasks are too few to judge
    const checks = factorChecks(c, [...many(5, "typical", 20), ...many(5, "large", 32), ...many(4, "small", 1), ...many(5, "large", 99, { outcome: "partial" })]);
    expect(checks).toEqual([{ question: "size", kind: "be-crud", track: "backend", pick: "large", expected: 1.6, measured: 1.6, held: true, tasks: 10 }]);
    // 5x typical is outside 1.6 x/÷ 1.5
    expect(factorChecks(c, [...many(5, "typical", 20), ...many(5, "large", 100)])[0]).toMatchObject({ measured: 5, held: false });
    // another catalogue version's tasks are not this catalogue's evidence
    expect(factorChecks(c, [...many(5, "typical", 20, { catalogue: "old" }), ...many(5, "large", 32, { catalogue: "old" })])).toEqual([]);
  });

  it("stays draft until enough builds and checks hold, and needs finished projects' real hours for the hours", () => {
    expect(catalogueEvidence(c, [], [])).toMatchObject({ status: "draft", builds: 0, checks: [], projects: 0 });
    const kinds = ["be-crud", "be-endpoint", "be-rules"];
    // 3 kinds x (large, small vs typical) = 6 checks, all holding, over 12 builds
    const good = kinds.flatMap((kind) => [...many(5, "typical", 20, { kind }), ...many(5, "large", 32, { kind }), ...many(5, "small", 12, { kind })]);
    const e = catalogueEvidence(c, good, []);
    expect(e.checks).toHaveLength(6);
    expect(e).toMatchObject({ status: "calibrated-factors", builds: 12 });
    // too few holding: back to draft
    const bad = kinds.flatMap((kind) => [...many(5, "typical", 20, { kind }), ...many(5, "large", 200, { kind }), ...many(5, "small", 12, { kind })]);
    expect(catalogueEvidence(c, bad, []).status).toBe("draft");
    const row = (within: boolean, catalogue = c.version) => ({ estimateRun: "e", estimated: { min: 10, max: 20 }, actual: within ? 15 : 40, verdict: within ? "within" as const : "over" as const, ratio: 1, catalogue });
    const rows = (inside: number, outside: number) => [...Array.from({ length: inside }, () => row(true)), ...Array.from({ length: outside }, () => row(false)), row(true, "old")];
    expect(catalogueEvidence(c, good, rows(7, 3))).toMatchObject({ status: "calibrated-factors", projects: 10, projectsWithin: 7 }); // 70% within: not enough
    expect(catalogueEvidence(c, good, rows(8, 1))).toMatchObject({ status: "calibrated-factors", projects: 9 }); // too few projects
    expect(catalogueEvidence(c, good, rows(9, 1))).toMatchObject({ status: "calibrated-hours", projects: 10, projectsWithin: 9 });
    // real hours alone, without the factors measured, do not move the status
    expect(catalogueEvidence(c, [], rows(9, 1)).status).toBe("draft");
  });

  it("words the status for the internal views without naming a person", () => {
    expect(catalogueStatusText({ status: "draft" })).toBe("reference hours, not yet measured");
    expect(catalogueStatusText({ status: "calibrated-factors", evidence: { builds: 12, projects: 0 } })).toBe("size factors measured from 12 builds; hours not yet measured against finished projects");
    expect(catalogueStatusText({ status: "calibrated-hours", evidence: { builds: 12, projects: 1 } })).toBe("hours measured against 1 finished project");
    // a self-tuned version says so, and its own evidence starts afresh
    expect(catalogueStatusText({ status: "draft", tuned: { generation: 1, builds: 12, projects: 0 } })).toBe("self-tuned once, last from 12 builds and 0 finished projects; this version not yet measured");
    expect(catalogueStatusText({ status: "calibrated-factors", evidence: { builds: 10, projects: 0 }, tuned: { generation: 3, builds: 14, projects: 10 } })).toBe("self-tuned 3 times, last from 14 builds and 10 finished projects; size factors measured from 10 builds; hours not yet measured against finished projects");
  });
});
