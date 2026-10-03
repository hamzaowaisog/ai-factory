import { describe, expect, it } from "vitest";
import { hashJson } from "../util/hash.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import {
  budgetBurn, changeRequest, consistency, designBaseline, forgottenWork, leadApproval, readiness,
  reqToTask, scopeLock, sizeCap, taskToReq, unrequestedBehaviour,
} from "./gates.js";

// gates are pure predicates, so the fixtures are minimal objects cast to the input type
const run = (g: { predicate: (i: any, p: any) => { passed: boolean; details: string } }, input: unknown) => g.predicate(input, DEFAULT_POLICY);
const req = (id: string, ears = "x") => ({ id, ears, op: "ADDED", sources: [], acceptance: [] });
const bt = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, featureId: "F-1", reqs: ["R-1"], track: "backend", executor: "human", complexity: "standard", ...extra });
const sizing = (taskId: string, avg: number, extra: Record<string, unknown> = {}) => ({ taskId, executor: "human", hours: { min: avg, max: avg }, flagged: false, ...extra });

describe("E1 readiness", () => {
  const spec = { requirements: [req("R-1")], lint: [{ check: "ears", passed: true, details: "" }], critic: [{ finding: "minor", severity: "low" }], roundTrip: { droppedSpans: [], inventedCapabilities: [] } };
  it("passes a clean spec with every question answered", () => {
    expect(run(readiness, { spec, questions: { questions: [{ id: "Q-1", answer: "yes" }] } }).passed).toBe(true);
  });
  it("fails on lint, a high critic finding, a dropped span, an open question or no questions record", () => {
    expect(run(readiness, { spec: { ...spec, lint: [{ check: "ears", passed: false, details: "bad" }] }, questions: { questions: [] } }).passed).toBe(false);
    expect(run(readiness, { spec: { ...spec, critic: [{ finding: "gap", severity: "high" }] }, questions: { questions: [] } }).passed).toBe(false);
    expect(run(readiness, { spec: { ...spec, roundTrip: { droppedSpans: ["S-1"], inventedCapabilities: [] } }, questions: { questions: [] } }).passed).toBe(false);
    expect(run(readiness, { spec, questions: { questions: [{ id: "Q-1" }] } }).passed).toBe(false);
    expect(run(readiness, { spec }).passed).toBe(false);
  });
});

describe("E1b design baseline", () => {
  const design = { screens: [{ id: "S-1", reqs: ["R-1"] }], mapping: { unmappedReqs: [], orphanScreens: [] } };
  it("skips a request with no UI", () => expect(run(designBaseline, { ui: false }).passed).toBe(true));
  it("needs an approved design whose screens all link to requirements", () => {
    expect(run(designBaseline, { ui: true, design, approval: { decision: "approved", by: "lead" } }).passed).toBe(true);
    expect(run(designBaseline, { ui: true, approval: { decision: "approved", by: "lead" } }).passed).toBe(false);
    expect(run(designBaseline, { ui: true, design }).passed).toBe(false);
    expect(run(designBaseline, { ui: true, design: { ...design, mapping: { unmappedReqs: ["R-2"], orphanScreens: [] } }, approval: { decision: "approved", by: "lead" } }).passed).toBe(false);
    expect(run(designBaseline, { ui: true, design: { ...design, screens: [{ id: "S-1", reqs: [] }] }, approval: { decision: "approved", by: "lead" } }).passed).toBe(false);
  });
});

describe("E2 and E3 traceability", () => {
  const spec = { requirements: [req("R-1"), req("R-2")] };
  it("E2 fails a requirement with no task", () => {
    expect(run(reqToTask, { spec, breakdown: { tasks: [bt("EST-1"), bt("EST-2", { reqs: ["R-2"] })] } }).passed).toBe(true);
    expect(run(reqToTask, { spec, breakdown: { tasks: [bt("EST-1")] } }).details).toMatch(/R-2/);
  });
  it("E3 fails a task with no requirement and no overhead, or citing an unknown one", () => {
    expect(run(taskToReq, { spec, breakdown: { tasks: [bt("EST-1"), bt("EST-2", { reqs: [], overhead: "deployment" })] } }).passed).toBe(true);
    expect(run(taskToReq, { spec, breakdown: { tasks: [bt("EST-3", { reqs: [] })] } }).passed).toBe(false);
    expect(run(taskToReq, { spec, breakdown: { tasks: [bt("EST-4", { reqs: ["R-9"] })] } }).passed).toBe(false);
  });
});

describe("E4 forgotten work", () => {
  it("needs a non-empty checklist with a reason for every exclusion", () => {
    expect(run(forgottenWork, { breakdown: { checklist: [{ item: "logging", included: true }, { item: "i18n", included: false, reason: "single locale" }] } }).passed).toBe(true);
    expect(run(forgottenWork, { breakdown: { checklist: [{ item: "i18n", included: false }] } }).passed).toBe(false);
    expect(run(forgottenWork, { breakdown: { checklist: [] } }).passed).toBe(false);
  });
});

describe("E5 consistency", () => {
  const tasks = ["EST-1", "EST-2", "EST-3", "EST-4"].map((id) => bt(id));
  it("passes similar tasks and small groups", () => {
    expect(run(consistency, { breakdown: { tasks }, estimate: { tasks: [4, 5, 6, 5].map((h, i) => sizing(`EST-${i + 1}`, h)) } }).passed).toBe(true);
    expect(run(consistency, { breakdown: { tasks: tasks.slice(0, 3) }, estimate: { tasks: [4, 5, 60].map((h, i) => sizing(`EST-${i + 1}`, h)) } }).passed).toBe(true);
  });
  it("fails an unflagged outlier and accepts a flagged one", () => {
    const hours = [4, 5, 6, 60];
    expect(run(consistency, { breakdown: { tasks }, estimate: { tasks: hours.map((h, i) => sizing(`EST-${i + 1}`, h)) } }).passed).toBe(false);
    expect(run(consistency, { breakdown: { tasks }, estimate: { tasks: hours.map((h, i) => sizing(`EST-${i + 1}`, h, { flagged: i === 3 })) } }).passed).toBe(true);
  });
  it("fails a screen the demo counts as complex sized below a simple one on the same track", () => {
    const ui = { "S-1": "complex", "S-2": "simple", "S-3": "moderate" };
    const web = [bt("EST-1", { track: "web", screen: "S-1" }), bt("EST-2", { track: "web", screen: "S-1" }), bt("EST-3", { track: "web", screen: "S-2" }), bt("EST-4", { track: "web", screen: "S-3" })];
    const est = (h: number[], extra: Record<string, unknown>[] = []) => ({ tasks: h.map((x, i) => sizing(`EST-${i + 1}`, x, extra[i] ?? {})) });
    // the complex screen's two tasks add up: 3 + 4 = 7 is above the simple screen's 6
    expect(run(consistency, { breakdown: { tasks: web }, estimate: est([3, 4, 6, 2]), ui }).passed).toBe(true);
    const bad = run(consistency, { breakdown: { tasks: web }, estimate: est([2, 2, 6, 2]), ui });
    expect(bad.passed).toBe(false);
    expect(bad.details).toMatch(/S-1 is complex .*EST-1, EST-2.* 4h, below simple screen S-2 at 6h/);
    // moderate screens are not compared; a flagged task leaves its screen to the lead; another track or executor is its own group
    expect(run(consistency, { breakdown: { tasks: web }, estimate: est([2, 2, 6, 2], [{ flagged: true }]), ui }).passed).toBe(true);
    expect(run(consistency, { breakdown: { tasks: web.map((t, i) => (i === 2 ? { ...t, track: "mobile" } : t)) }, estimate: est([2, 2, 6, 2]), ui }).passed).toBe(true);
    expect(run(consistency, { breakdown: { tasks: web }, estimate: est([2, 2, 6, 2], [{}, {}, { executor: "factory" }]), ui }).passed).toBe(true);
    // with no counted design the check is not run
    expect(run(consistency, { breakdown: { tasks: web }, estimate: est([2, 2, 6, 2]) }).passed).toBe(true);
  });
});

describe("E7 lead approval", () => {
  const estimate = { tasks: [sizing("EST-1", 4, { flagged: true })] };
  const ok = { estimateHash: hashJson(estimate), decision: "approved", by: "lead", signedOff: ["EST-1"] };
  it("passes an approval tied to the hash, with low-confidence lines signed off", () => {
    expect(run(leadApproval, { estimate, approval: ok }).passed).toBe(true);
  });
  it("fails no approval, a stale hash, a rejection, or a missing sign-off", () => {
    expect(run(leadApproval, { estimate }).passed).toBe(false);
    expect(run(leadApproval, { estimate: { tasks: [] }, approval: ok }).passed).toBe(false);
    expect(run(leadApproval, { estimate, approval: { ...ok, decision: "rejected" } }).passed).toBe(false);
    expect(run(leadApproval, { estimate, approval: { ...ok, signedOff: [] } }).passed).toBe(false);
  });
  it("a hands-off run: the factory approves, with no sign-off", () => {
    const auto = { estimateHash: hashJson(estimate), decision: "approved", by: "factory", signedOff: [], auto: true };
    const v = run(leadApproval, { estimate, approval: auto });
    expect(v.passed).toBe(true);
    expect(v.details).toBe("approved by the factory (no human review)");
    expect(run(leadApproval, { estimate: { tasks: [] }, approval: auto }).passed).toBe(false);
    expect(run(leadApproval, { estimate, approval: { ...auto, by: "lead" } }).passed).toBe(false);
  });
});

describe("B1 scope lock", () => {
  const breakdown = { tasks: [bt("EST-1")] };
  it("needs every plan task mapped to an approved estimate task", () => {
    expect(run(scopeLock, { breakdown, plan: { tasks: [{ id: "T-1", estimateTaskId: "EST-1" }] } }).passed).toBe(true);
    expect(run(scopeLock, { breakdown, plan: { tasks: [{ id: "T-1" }] } }).passed).toBe(false);
    expect(run(scopeLock, { breakdown, plan: { tasks: [{ id: "T-1", estimateTaskId: "EST-7" }] } }).passed).toBe(false);
  });
});

describe("B2 change request", () => {
  const approvedSpec = { requirements: [req("R-1")] };
  it("passes when nothing changed, or a changed requirement has an estimate that revises the approved one", () => {
    expect(run(changeRequest, { spec: approvedSpec, approvedSpec, approvedEstimateSha: "a" }).passed).toBe(true);
    const spec = { requirements: [req("R-1", "changed")] };
    expect(run(changeRequest, { spec, approvedSpec, approvedEstimateSha: "a", estimate: { parentEstimate: "a" } }).passed).toBe(true);
  });
  it("fails a changed or new requirement with no v2, or a v2 with the wrong parent", () => {
    const spec = { requirements: [req("R-1"), req("R-2")] };
    expect(run(changeRequest, { spec, approvedSpec, approvedEstimateSha: "a" }).passed).toBe(false);
    expect(run(changeRequest, { spec, approvedSpec, approvedEstimateSha: "a", estimate: { parentEstimate: "b" } }).passed).toBe(false);
    expect(run(changeRequest, { spec: { requirements: [] }, approvedSpec, approvedEstimateSha: "a" }).passed).toBe(false);
  });
});

describe("B3 size cap", () => {
  const diff = (n: number) => ({ files: [{ status: "A", path: "a.ts", added: Array(n).fill("x"), removed: [] }] });
  const estimate = { tasks: [{ hours: { min: 1, max: 2 } }] }; // cap 80 lines
  it("passes a change within the cap and fails one over it", () => {
    expect(run(sizeCap, { diff: diff(80), estimate }).passed).toBe(true);
    expect(run(sizeCap, { diff: diff(81), estimate }).passed).toBe(false);
  });
});

describe("B4 unrequested behaviour", () => {
  const finding = (category: string, confidence: number) => ({ id: "F", category, file: "a.ts", line: 1, text: "extra endpoint", confidence, severity: "medium" });
  it("fails a confident unrequested-behaviour finding only", () => {
    expect(run(unrequestedBehaviour, { review: { findings: [finding("reuse", 0.9)] } }).passed).toBe(true);
    expect(run(unrequestedBehaviour, { review: { findings: [finding("unrequested-behaviour", 0.3)] } }).passed).toBe(true);
    expect(run(unrequestedBehaviour, { review: { findings: [finding("unrequested-behaviour", 0.9)] } }).passed).toBe(false);
  });
});

describe("B5 budget burn", () => {
  const estimate = { totals: { overall: { min: 50, max: 100 } }, apiCost: { total: { min: 5, max: 10 } }, elapsed: { criticalPathDays: { min: 4, max: 5 } } };
  it("passes quietly under 80%, warns from 80%, stops at 100%", () => {
    expect(run(budgetBurn, { estimate, spent: { effortHours: 10, apiUsd: 1, elapsedDays: 1 } })).toEqual({ passed: true, details: "within the approved budget" });
    const warn = run(budgetBurn, { estimate, spent: { effortHours: 10, apiUsd: 8, elapsedDays: 1 } });
    expect(warn.passed).toBe(true);
    expect(warn.details).toMatch(/warning: apiUsd 80%/);
    expect(run(budgetBurn, { estimate, spent: { effortHours: 10, apiUsd: 10, elapsedDays: 1 } }).passed).toBe(false);
    expect(run(budgetBurn, { estimate, spent: { effortHours: 10, apiUsd: 1, elapsedDays: 6 } }).passed).toBe(false);
  });
  it("holds measured effort against the estimate's own gate hours, and has no effort limit without them", () => {
    const hitl = { ...estimate, gateHours: [{ source: "Clarify answers", hours: { min: 1, max: 2 }, assumed: true }, { source: "Lead PR review", hours: { min: 2, max: 4 }, assumed: true }] };
    expect(run(budgetBurn, { estimate: hitl, spent: { effortHours: 5, apiUsd: 1, elapsedDays: 1 } }).passed).toBe(true);
    expect(run(budgetBurn, { estimate: hitl, spent: { effortHours: 6, apiUsd: 1, elapsedDays: 1 } }).passed).toBe(false);
    expect(run(budgetBurn, { estimate, spent: { effortHours: 500, apiUsd: 1, elapsedDays: 1 } }).passed).toBe(true);
  });
  it("a lead's higher ceiling moves the stop and the warning", () => {
    const spent = { effortHours: 0, apiUsd: 10, elapsedDays: 1 };
    expect(run(budgetBurn, { estimate, spent, limit: { ceiling: 1.25 } }).details).toMatch(/warning: apiUsd 100%/);
    expect(run(budgetBurn, { estimate, spent: { ...spent, apiUsd: 10 }, limit: { ceiling: 1.25 } }).passed).toBe(true);
    expect(run(budgetBurn, { estimate, spent: { ...spent, apiUsd: 12.5 }, limit: { ceiling: 1.25 } }).passed).toBe(false);
  });
});
