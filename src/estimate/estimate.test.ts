import { describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import type { BreakdownTask } from "../contracts/index.js";
import { evaluate } from "../gates/engine.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { DEFAULT_ASSUMPTIONS } from "./assumptions.js";
import { confidenceFor, estimateApiCost, quantile, type BenchmarkRecord } from "./cost.js";
import { gateHours, prCount } from "./gate-hours.js";
import { effortHours, mergeEstimators, scale, sizeTasks } from "./hours.js";
import { estimateWorkbookLint, lintEstimate } from "./lint.js";
import { bandFor, baseBand, uncertaintyFor, type Units } from "./size.js";
import { computeTotals, criticalPath, elapsedDays, weeks } from "./totals.js";

const units = (o: Partial<Units> = {}): Units => ({ requirements: 10, features: 2, screens: 3, endpoints: 4, integrations: 0, platforms: 1, flags: [], ...o });

describe("size band", () => {
  it("bands by counted units", () => {
    expect(baseBand(units({ requirements: 2, features: 1, screens: 1 }))).toBe("XS");
    expect(baseBand(units({ features: 2 }))).toBe("S");
    expect(baseBand(units({ features: 5 }))).toBe("M");
    expect(baseBand(units({ features: 34, platforms: 2, integrations: 3 }))).toBe("L"); // the Few Center spec
    expect(baseBand(units({ features: 80 }))).toBe("XL");
    expect(baseBand(units({ features: 3, platforms: 2 }))).toBe("S");
    expect(baseBand(units({ features: 4, platforms: 2 }))).toBe("L");
  });

  it("bumps one band when many units are non-standard, never past XL", () => {
    const flags = ["real-time", "standard", "standard"] as Units["flags"];
    expect(bandFor(units({ features: 5, flags }))).toBe("L");
    expect(bandFor(units({ features: 80, flags }))).toBe("XL");
    expect(bandFor(units({ features: 5, flags: ["standard", "standard"] }))).toBe("M");
  });

  it("grades uncertainty, and a missing scope is never low", () => {
    const g = { scopeClarity: "precise", designAvailability: "precise", technicalContext: "precise", codeAccess: "precise", constraintsKnown: "precise" } as const;
    expect(uncertaintyFor(g)).toBe("low");
    expect(uncertaintyFor({ ...g, designAvailability: "vague", codeAccess: "missing" })).toBe("medium");
    expect(uncertaintyFor({ ...g, scopeClarity: "missing" })).toBe("high");
    expect(uncertaintyFor({ scopeClarity: "vague", designAvailability: "missing", technicalContext: "vague", codeAccess: "missing", constraintsKnown: "vague" })).toBe("high");
  });
});

describe("anchors and ratios", () => {
  const anchors = [{ taskId: "EST-1", hours: { min: 4, max: 8 } }];
  it("computes anchor x ratio", () => {
    expect(scale({ min: 4, max: 8 }, 2.5)).toEqual({ min: 10, max: 20 });
    expect(() => scale({ min: 4, max: 8 }, 0)).toThrow();
  });

  it("sizes tasks against their anchor and rejects a bad reference", () => {
    const out = sizeTasks(anchors, [
      { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "anchor", executor: "human" },
      { taskId: "EST-2", anchorId: "EST-1", ratio: 0.5, reason: "half the fields", executor: "human" },
    ]);
    expect(out[1]!.hours).toEqual({ min: 2, max: 4 });
    expect(() => sizeTasks(anchors, [{ taskId: "EST-2", anchorId: "EST-9", ratio: 1, reason: "x", executor: "human" }])).toThrow(/not an anchor/);
    expect(() => sizeTasks(anchors, [{ taskId: "EST-1", anchorId: "EST-1", ratio: 2, reason: "x", executor: "human" }])).toThrow(/ratio 1/);
  });

  it("merges estimators by median and flags disagreement", () => {
    const base = { min: 4, max: 6 };
    expect(mergeEstimators(base, [])).toEqual({ hours: base, flagged: false });
    // median of mins 4, 4.5, 4 and of maxes 6, 6, 6.2
    expect(mergeEstimators(base, [{ min: 4.5, max: 6 }, { min: 4, max: 6.2 }])).toEqual({ hours: { min: 4, max: 6 }, flagged: false });
    // one estimator reading far high does not move the range; it flags the task
    expect(mergeEstimators(base, [{ min: 4, max: 6 }, { min: 16, max: 24 }])).toEqual({ hours: { min: 4, max: 6 }, flagged: true });
    // two readings: the median is their mean
    expect(mergeEstimators(base, [{ min: 6, max: 8 }]).hours).toEqual({ min: 5, max: 7 });
    expect(mergeEstimators(base, [{ min: 4, max: 7 }, { min: 3.5, max: 6 }]).flagged).toBe(true);
    expect(mergeEstimators(base, [{ min: 10, max: 14 }]).flagged).toBe(true);
    // identical readings of a wide range agree, so they are not flagged
    expect(mergeEstimators({ min: 4, max: 8 }, [{ min: 4, max: 8 }, { min: 4, max: 8 }]).flagged).toBe(false);
  });

  it("counts factory task hours as size, not human effort", () => {
    expect(effortHours({ executor: "factory", hours: { min: 4, max: 8 } })).toEqual({ min: 0, max: 0 });
    expect(effortHours({ executor: "joint", hours: { min: 4, max: 8 } })).toEqual({ min: 4, max: 8 });
    expect(effortHours({ executor: "human", hours: { min: 1, max: 2 } })).toEqual({ min: 1, max: 2 });
  });
});

describe("gate hours", () => {
  const counts = { questions: 8, approvalSections: 5, prs: { low: 4, medium: 2, high: 1 }, factoryTasks: 14, waivers: 0 };
  it("gives HITL lines from counts, all labelled assumed", () => {
    const g = gateHours("hitl", counts);
    expect(g.map((x) => x.source)).toEqual(["Clarify answers", "Approval card reading", "Lead PR review", "Parked runs"]);
    expect(g.every((x) => x.assumed)).toBe(true);
    const review = g.find((x) => x.source === "Lead PR review")!;
    // 4 low (10-20) + 2 medium (20-40) + 1 high (40-90) minutes
    expect(review.hours).toEqual({ min: 2, max: 4.17 });
  });

  it("gives the solely agentic model no supervisor gates", () => {
    expect(gateHours("agentic", counts)).toEqual([]);
  });

  it("adds waivers only when expected, and groups tasks into PRs", () => {
    expect(gateHours("hitl", { ...counts, waivers: 2 }).some((x) => x.source === "Waivers")).toBe(true);
    expect(prCount(0)).toBe(0);
    expect(prCount(5)).toBe(3);
  });
});

const rec = (phase: BenchmarkRecord["phase"], costUsd: number, units = 1): BenchmarkRecord => ({ runId: "r", phase, stage: phase, costUsd, activeSec: 60, units, outcome: "completed" });

describe("API credit cost", () => {
  it("falls back to the labelled cold-start figure when there are no records", () => {
    const c = estimateApiCost({ planning: 1, build: 4 }, [], "hitl");
    expect(c.confidence).toBe("cold-start");
    expect(c.records).toBe(0);
    // 4 tasks x $1.3-1.8 x 0.4 build share
    expect(c.phases.find((p) => p.phase === "build")!.usd).toEqual({ min: 2.08, max: 2.88 });
    expect(c.total.min).toBeCloseTo(c.phases.reduce((s, p) => s + p.usd.min, 0), 2);
  });

  it("uses measured records once they exist, per unit, and raises confidence with their count", () => {
    const records = [rec("build", 1), rec("build", 2), rec("build", 3)];
    const c = estimateApiCost({ build: 2 }, records, "hitl");
    expect(c.phases[0]!.usd).toEqual({ min: 2.4, max: 5.6 }); // p10=1.2, p90=2.8 per unit x2
    expect(c.confidence).toBe("partial");
    expect(c.records).toBe(3);
    expect(confidenceFor(0)).toBe("cold-start");
    expect(confidenceFor(15)).toBe("calibrated");
  });

  it("costs build and verification more when solely agentic, and the weakest phase sets confidence", () => {
    const hitl = estimateApiCost({ planning: 1, build: 1 }, [], "hitl");
    const agentic = estimateApiCost({ planning: 1, build: 1 }, [], "agentic");
    expect(agentic.phases.find((p) => p.phase === "build")!.usd.max).toBeGreaterThan(hitl.phases.find((p) => p.phase === "build")!.usd.max);
    expect(agentic.phases.find((p) => p.phase === "planning")!.usd).toEqual(hitl.phases.find((p) => p.phase === "planning")!.usd);
    const many = Array.from({ length: 20 }, () => rec("planning", 0.5));
    expect(estimateApiCost({ planning: 1, build: 1 }, many, "hitl").confidence).toBe("cold-start");
  });

  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
    expect(() => quantile([], 0.5)).toThrow();
  });
});

describe("totals, weeks and elapsed", () => {
  const tasks = [{ id: "EST-1", track: "backend" }, { id: "EST-2", track: "web" }, { id: "EST-3", track: "design" }] as Pick<BreakdownTask, "id" | "track">[];
  const sized = [
    { taskId: "EST-1", executor: "human" as const, hours: { min: 4, max: 8 } },
    { taskId: "EST-2", executor: "factory" as const, hours: { min: 6, max: 9 } },
    { taskId: "EST-3", executor: "human" as const, hours: { min: 2, max: 3 } },
  ];
  it("sums human effort by track, keeps the design row, and honours the design switch", () => {
    const withDesign = computeTotals(tasks, sized, [{ hours: { min: 1, max: 1 } }], [{ track: "backend", hours: { min: 1, max: 2 } }], true);
    expect(withDesign.byTrack).toEqual({ backend: { min: 5, max: 10 }, web: { min: 0, max: 0 }, design: { min: 2, max: 3 } });
    expect(withDesign.overall).toEqual({ min: 8, max: 14 });
    const without = computeTotals(tasks, sized, [], [], false);
    expect(without.byTrack.design).toEqual({ min: 2, max: 3 });
    expect(without.overall).toEqual({ min: 4, max: 8 });
  });

  it("rejects a sized task that is not in the breakdown", () => {
    expect(() => computeTotals(tasks, [{ taskId: "EST-9", executor: "human", hours: { min: 1, max: 1 } }], [], [], true)).toThrow(/EST-9/);
  });

  it("computes weeks and the critical path", () => {
    expect(weeks({ min: 80, max: 120 }, 2)).toEqual({ min: 1, max: 1.5 });
    expect(() => weeks({ min: 1, max: 1 }, 0)).toThrow();
    const graph = [{ id: "A", dependsOn: [] }, { id: "B", dependsOn: ["A"] }, { id: "C", dependsOn: ["A"] }, { id: "D", dependsOn: ["B", "C"] }];
    const dur: Record<string, { min: number; max: number }> = { A: { min: 2, max: 3 }, B: { min: 4, max: 5 }, C: { min: 1, max: 2 }, D: { min: 1, max: 1 } };
    expect(criticalPath(graph, (id) => dur[id]!)).toEqual({ min: 7, max: 9 });
    expect(() => criticalPath([{ id: "A", dependsOn: ["B"] }, { id: "B", dependsOn: ["A"] }], () => ({ min: 1, max: 1 }))).toThrow(/cycle/);
  });

  it("adds the review queue to the maximum only", () => {
    expect(elapsedDays({ min: 16, max: 24 }, 8)).toEqual({ min: 2, max: 4 });
  });
});

// ---------- a full estimate, and gate E6 over it ----------
const sha = "a".repeat(64);
const bTasks = [
  { id: "EST-1", title: "a", featureId: "F-1", reqs: ["R-1"], track: "backend", executor: "human", dependsOn: [], items: [], complexity: "standard" },
  { id: "EST-2", title: "b", featureId: "F-1", reqs: ["R-1"], track: "web", executor: "factory", dependsOn: ["EST-1"], items: [], complexity: "standard" },
] as unknown as BreakdownTask[];

function build(model: "hitl" | "agentic" = "hitl") {
  const sizing = sizeTasks([{ taskId: "EST-1", hours: { min: 4, max: 8 } }], [
    { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "anchor", executor: "human" },
    { taskId: "EST-2", anchorId: "EST-1", ratio: 2, reason: "twice", executor: "factory" },
  ]);
  const gates = gateHours(model, { questions: 4, approvalSections: 3, prs: { low: 1, medium: 0, high: 0 }, factoryTasks: 1, waivers: 0 });
  const totals = computeTotals(bTasks, sizing, [], gates, true);
  return Estimate.parse({
    header: { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
    deliveryModel: model, band: "S", uncertainty: "medium", breakdownSha: sha, specSha: sha,
    anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "typical" }], tasks: sizing, merge: "median", gateHours: gates, totals,
    apiCost: estimateApiCost({ planning: 1, build: 1 }, [], model),
    elapsed: { planningMinutes: 20, criticalPathDays: { min: 1, max: 2 } },
    settings: { stackSource: "client", designInTotal: true, feedbackRounds: 1 },
  });
}

describe("gate E6 (data level)", () => {
  it("passes a freshly computed estimate, for both delivery models", () => {
    expect(lintEstimate(build("hitl"), { tasks: bTasks })).toEqual([]);
    expect(lintEstimate(build("agentic"), { tasks: bTasks })).toEqual([]);
  });

  it("catches a typed-in total, a wrong track total and a wrong cost sum", () => {
    const e = build();
    const cooked = { ...e, totals: { ...e.totals, overall: { min: 1, max: 2 } }, apiCost: { ...e.apiCost, total: { min: 99, max: 100 } } };
    const checks = lintEstimate(cooked, { tasks: bTasks }).map((i) => i.check);
    expect(checks).toContain("total-overall");
    expect(checks).toContain("cost-total");
    const track = { ...e, totals: { ...e.totals, byTrack: { ...e.totals.byTrack, backend: { min: 0, max: 0 } } } };
    expect(lintEstimate(track, { tasks: bTasks }).map((i) => i.check)).toContain("total-track");
  });

  it("catches a task that ignores its anchor x ratio, and unsized or unknown tasks", () => {
    const e = build();
    const off = { ...e, tasks: e.tasks.map((t) => (t.taskId === "EST-2" ? { ...t, hours: { min: 1, max: 2 } } : t)) };
    expect(lintEstimate(off, { tasks: bTasks }).map((i) => i.check)).toContain("ratio");
    expect(lintEstimate(e, { tasks: [...bTasks, { ...bTasks[0]!, id: "EST-3" }] }).map((i) => i.check)).toContain("task-missing");
    expect(lintEstimate(e, { tasks: [bTasks[0]!] }).map((i) => i.check)).toContain("task-unknown");
  });

  it("checks the median of the estimators' readings, and older estimates by the widening rule they were made with", () => {
    const e = build();
    expect(e.merge).toBe("median");
    const t2 = e.tasks.find((t) => t.taskId === "EST-2")!;
    const readings = [{ min: t2.hours.min * 4, max: t2.hours.max * 4 }, { min: t2.hours.min, max: t2.hours.max }];
    const median = { ...e, tasks: e.tasks.map((t) => (t === t2 ? { ...t, estimators: readings } : t)) };
    expect(lintEstimate(median, { tasks: bTasks })).toEqual([]);
    // the widened range is not the median
    const widened = { ...median, tasks: median.tasks.map((t) => (t.taskId === "EST-2" ? { ...t, hours: { min: t2.hours.min, max: t2.hours.max * 4 } } : t)) };
    expect(lintEstimate(widened, { tasks: bTasks }).map((i) => i.check)).toContain("ratio");
    // ... but it is what an estimate made before the median merge stored, and that one still passes
    const { merge: _, ...older } = widened;
    expect(lintEstimate(older as typeof e, { tasks: bTasks }).map((i) => i.check)).not.toContain("ratio");
  });

  it("flags confidence that outruns the data", () => {
    const e = build();
    expect(lintEstimate({ ...e, apiCost: { ...e.apiCost, confidence: "calibrated" } }, { tasks: bTasks }).map((i) => i.check)).toContain("cost-confidence");
  });

  it("is a registered gate that fails closed with its failures listed", () => {
    const e = build();
    const bad = { ...e, totals: { ...e.totals, overall: { min: 0, max: 0 } } };
    const v = estimateWorkbookLint.predicate({ estimate: bad, breakdown: { tasks: bTasks } }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.failures![0]!.check).toBe("estimate-total-overall");
    expect(estimateWorkbookLint.predicate({ estimate: e, breakdown: { tasks: bTasks } }, DEFAULT_POLICY).passed).toBe(true);
    expect(estimateWorkbookLint.waiver).toBe("none");
    void evaluate; void DEFAULT_ASSUMPTIONS;
  });
});
