// Seeded-defect cases for the real estimate and build gates (E1-E7, B1-B6). Inputs are the real artifact
// shapes, built from src/estimate/fixture.ts (a complete, internally consistent estimate and breakdown), and
// each defect case changes exactly one thing in a clean input. The gates are pure, so no model or ledger runs.
import type { Estimate } from "../../src/contracts/index.js";
import { hashJson } from "../../src/util/hash.js";
import { breakdown, fixture } from "../../src/estimate/fixture.js";
import { loadCatalogue } from "../../src/estimate/catalogue.js";
import type { GateCase } from "./cases.js";

const e: Estimate = fixture().estimate;
const tasks = breakdown.tasks;
const req = (id: string, ears = "x") => ({ id, ears, op: "ADDED", sources: [], acceptance: [] });
const spec2 = { requirements: [req("R-1"), req("R-2")] };
const specE1 = { requirements: [req("R-1")], lint: [{ check: "ears", passed: true, details: "" }], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } };
const answered = { questions: [{ id: "Q-1", answer: "yes" }] };
const design = { screens: [{ id: "S-1", route: "/login", reqs: ["R-1"] }, { id: "S-2", route: "/reports", reqs: ["R-2"] }], mapping: { unmappedReqs: [], orphanScreens: [] } };
const lead = { decision: "approved", by: "lead" };
const withScreens = (m: Record<string, string>) => tasks.map((t) => (m[t.id] ? { ...t, screen: m[t.id] } : t));
const screensBuilt = withScreens({ "EST-2": "S-1", "EST-3": "S-2" }); // EST-2 is a factory task, EST-3 is joint
const plan = (xs: [string, string | undefined][]) => ({ tasks: xs.map(([id, estimateTaskId]) => ({ id, estimateTaskId, fileScope: ["src/**"] })) });
const fileDesign = { screens: [{ id: "S-1", route: "/login", file: "src/pages/login.tsx", reqs: ["R-1"] }, { id: "S-2", route: "/reports", file: "src/pages/reports.tsx", reqs: ["R-2"] }] };
const planScope = (scope: string[]) => ({ tasks: [{ id: "T-1", estimateTaskId: "EST-2", fileScope: scope }, { id: "T-2", estimateTaskId: "EST-3", fileScope: scope }] });
const diffOf = (lines: number) => ({ from: "a", to: "b", lockedNow: {}, files: [{ status: "M", path: "src/a.ts", added: Array(lines).fill("x"), removed: [] }] });
const finding = (category: string, confidence: number) => ({ id: "F-1", category, file: "a.ts", line: 1, text: "extra option", confidence, severity: "medium" });
const burnEst = { totals: e.totals, apiCost: { ...e.apiCost, total: { min: 5, max: 10 } }, elapsed: { planningMinutes: 20, criticalPathDays: { min: 1, max: 10 } }, gateHours: e.gateHours };
const burn = (apiUsd: number) => ({ effortHours: 0, apiUsd, elapsedDays: 0 });
const sized = (id: string, avg: number, flagged = false) => ({ taskId: id, anchorId: "EST-1", ratio: 1, reason: "r", executor: "human" as const, hours: { min: avg, max: avg }, flagged });
const peers = ["EST-1", "EST-2", "EST-3", "EST-4"];
const peerTasks = peers.map((id) => ({ id, title: id, featureId: "F-1", reqs: ["R-1"], items: [], track: "web", executor: "human", dependsOn: [], complexity: "standard" }));
const cat = (({ version, kinds }) => ({ version, kinds }))(loadCatalogue());
const KIND: Record<string, string> = { backend: "be-crud", web: "ui-form", mobile: "ui-form", qa: "qa-uat", pm: "pm-management", pdm: "pdm-docs", design: "design-screen", gd: "gd-assets" };
const kinded = tasks.map((t) => ({ ...t, kind: KIND[t.track] }));
const approved = (by = "lead", hash = hashJson(e), signedOff: string[] = []) => ({ estimateHash: hash, decision: "approved" as const, by, signedOff });
const c = (id: string, gateId: string, description: string, expect: GateCase["expect"], input: unknown): GateCase => ({ id, gateId, description, expect, input });

export const ESTIMATE_CASES: GateCase[] = [
  c("E1/clean", "estimate.e1-readiness", "spec clean, every question answered", "must-pass", { spec: specE1, questions: answered }),
  c("E1/open-question", "estimate.e1-readiness", "a question is still open", "must-fail", { spec: specE1, questions: { questions: [{ id: "Q-1" }] } }),
  c("E1/dropped-span", "estimate.e1-readiness", "the spec dropped a source span", "must-fail", { spec: { ...specE1, roundTrip: { droppedSpans: ["S-1"], inventedCapabilities: [] } }, questions: answered }),
  c("E1/high-critic", "estimate.e1-readiness", "the critic found a high-severity gap", "must-fail", { spec: { ...specE1, critic: [{ finding: "gap", severity: "high" }] }, questions: answered }),

  c("E1b/clean", "estimate.e1b-design-baseline", "approved design, every screen linked", "must-pass", { ui: true, design, approval: lead }),
  c("E1b/no-ui", "estimate.e1b-design-baseline", "a request with no UI needs no design", "must-pass", { ui: false }),
  c("E1b/unapproved", "estimate.e1b-design-baseline", "design not approved by a person", "must-fail", { ui: true, design }),
  c("E1b/orphan-screen", "estimate.e1b-design-baseline", "a screen links to no requirement", "must-fail", { ui: true, design: { ...design, screens: [{ id: "S-1", route: "/a", reqs: [] }] }, approval: lead }),

  c("E1c/clean", "estimate.e1c-design-coverage", "every approved screen is built, every task screen approved", "must-pass", { design, breakdown: { tasks: screensBuilt } }),
  c("E1c/unbuilt-screen", "estimate.e1c-design-coverage", "an approved screen is built by no task", "must-fail", { design, breakdown: { tasks: withScreens({ "EST-2": "S-1" }) } }),
  c("E1c/unknown-screen", "estimate.e1c-design-coverage", "a task builds a screen that is not in the design", "must-fail", { design, breakdown: { tasks: withScreens({ "EST-2": "S-1", "EST-3": "S-2", "EST-1": "S-9" }) } }),

  c("E2/clean", "estimate.e2-req-to-task", "every requirement has a task", "must-pass", { spec: spec2, breakdown: { tasks } }),
  c("E2/dropped-requirement", "estimate.e2-req-to-task", "a requirement has no task", "must-fail", { spec: { requirements: [...spec2.requirements, req("R-3")] }, breakdown: { tasks } }),

  c("E3/clean", "estimate.e3-task-to-req", "every task cites a requirement or a named overhead", "must-pass", { spec: spec2, breakdown: { tasks } }),
  c("E3/gold-plating", "estimate.e3-task-to-req", "a task with no requirement and no overhead", "must-fail", { spec: spec2, breakdown: { tasks: [...tasks, { ...tasks[0]!, id: "EST-9", reqs: [], overhead: undefined }] } }),
  c("E3/unknown-requirement", "estimate.e3-task-to-req", "a task cites a requirement that does not exist", "must-fail", { spec: spec2, breakdown: { tasks: [...tasks, { ...tasks[0]!, id: "EST-9", reqs: ["R-9"] }] } }),

  c("E2c/clean", "estimate.e2c-task-kind", "every task has a catalogue kind on a track it fits", "must-pass", { breakdown: { tasks: kinded }, catalogue: cat }),
  c("E2c/no-kind", "estimate.e2c-task-kind", "a task with no kind", "must-fail", { breakdown: { tasks: [...kinded, { ...kinded[0]!, id: "EST-9", kind: undefined }] }, catalogue: cat }),
  c("E2c/unknown-kind", "estimate.e2c-task-kind", "a kind the catalogue does not list", "must-fail", { breakdown: { tasks: [...kinded, { ...kinded[0]!, id: "EST-9", kind: "be-magic" }] }, catalogue: cat }),
  c("E2c/wrong-track", "estimate.e2c-task-kind", "a screen kind on the backend track", "must-fail", { breakdown: { tasks: [...kinded, { ...kinded[0]!, id: "EST-9", track: "backend", kind: "ui-list" }] }, catalogue: cat }),

  c("E4/clean", "estimate.e4-checklist", "every checklist item in, or out with a reason", "must-pass", { breakdown: { checklist: [{ item: "logging", included: true }, { item: "i18n", included: false, reason: "single locale" }] } }),
  c("E4/silent-out", "estimate.e4-checklist", "an item left out with no reason", "must-fail", { breakdown: { checklist: [{ item: "i18n", included: false }] } }),
  c("E4/empty", "estimate.e4-checklist", "an empty checklist", "must-fail", { breakdown: { checklist: [] } }),

  c("E5/clean", "estimate.e5-consistency", "four similar tasks within tolerance", "must-pass", { estimate: { tasks: [sized("EST-1", 4), sized("EST-2", 5), sized("EST-3", 4), sized("EST-4", 6)] }, breakdown: { tasks: peerTasks } }),
  c("E5/outlier", "estimate.e5-consistency", "one task ten times its peers, unflagged", "must-fail", { estimate: { tasks: [sized("EST-1", 4), sized("EST-2", 5), sized("EST-3", 4), sized("EST-4", 50)] }, breakdown: { tasks: peerTasks } }),
  c("E5/flagged-outlier", "estimate.e5-consistency", "the same outlier, flagged by the estimators", "must-pass", { estimate: { tasks: [sized("EST-1", 4), sized("EST-2", 5), sized("EST-3", 4), sized("EST-4", 50, true)] }, breakdown: { tasks: peerTasks } }),

  c("E6/clean", "estimate.e6-lint", "every total recomputes", "must-pass", { estimate: e, breakdown: { tasks } }),
  c("E6/typed-total", "estimate.e6-lint", "a stored total that no longer matches its tasks", "must-fail", { estimate: { ...e, totals: { ...e.totals, overall: { min: e.totals.overall.min + 7, max: e.totals.overall.max + 7 } } }, breakdown: { tasks } }),
  c("E6/missing-task", "estimate.e6-lint", "a breakdown task is not sized", "must-fail", { estimate: { ...e, tasks: e.tasks.slice(1) }, breakdown: { tasks } }),

  c("E7/clean", "estimate.e7-approval", "approved by a named person for this exact estimate", "must-pass", { estimate: e, approval: approved() }),
  c("E7/missing", "estimate.e7-approval", "no approval recorded", "must-fail", { estimate: e }),
  c("E7/wrong-hash", "estimate.e7-approval", "approval is for a different version", "must-fail", { estimate: e, approval: approved("lead", "0".repeat(64)) }),
  c("E7/no-signoff", "estimate.e7-approval", "a low-confidence task has no sign-off", "must-fail", { estimate: { ...e, tasks: e.tasks.map((t, i) => (i === 0 ? { ...t, flagged: true } : t)) }, approval: { ...approved(), estimateHash: hashJson({ ...e, tasks: e.tasks.map((t, i) => (i === 0 ? { ...t, flagged: true } : t)) }) } }),

  c("B1/clean", "build.b1-scope-lock", "every plan task maps to an approved estimate task", "must-pass", { plan: plan([["T-1", "EST-1"], ["T-2", "EST-2"]]), breakdown: { tasks } }),
  c("B1/unmapped", "build.b1-scope-lock", "a plan task maps to no estimate task", "must-fail", { plan: plan([["T-1", "EST-1"], ["T-2", undefined]]), breakdown: { tasks } }),
  c("B1/unknown", "build.b1-scope-lock", "a plan task maps to an estimate task that is not approved", "must-fail", { plan: plan([["T-1", "EST-99"]]), breakdown: { tasks } }),

  c("B2/clean", "build.b2-change-request", "no requirement changed since approval", "must-pass", { spec: spec2, approvedSpec: spec2, approvedEstimateSha: "a".repeat(64) }),
  c("B2/changed-no-v2", "build.b2-change-request", "a requirement changed and there is no estimate v2", "must-fail", { spec: { requirements: [req("R-1", "changed"), req("R-2")] }, approvedSpec: spec2, approvedEstimateSha: "a".repeat(64) }),
  c("B2/wrong-parent", "build.b2-change-request", "a requirement changed and v2 does not revise the approved one", "must-fail", { spec: { requirements: [req("R-1", "changed"), req("R-2")] }, approvedSpec: spec2, approvedEstimateSha: "a".repeat(64), estimate: { parentEstimate: "b".repeat(64), specSha: "c".repeat(64) } }),

  c("B3/clean", "build.b3-size-cap", "a small change within the approved size", "must-pass", { diff: diffOf(20), estimate: e }),
  c("B3/oversize", "build.b3-size-cap", "a change far bigger than approved", "must-fail", { diff: diffOf(100_000), estimate: e }),

  c("B4/clean", "build.b4-unrequested", "no unrequested behaviour found", "must-pass", { review: { findings: [finding("correctness", 0.9)] } }),
  c("B4/unrequested", "build.b4-unrequested", "the review found behaviour no requirement asked for", "must-fail", { review: { findings: [finding("unrequested-behaviour", 0.95)] } }),

  c("B5/clean", "build.b5-budget-burn", "spend well inside the approved maximum", "must-pass", { spent: burn(2), estimate: burnEst }),
  c("B5/over", "build.b5-budget-burn", "spend past the approved maximum", "must-fail", { spent: burn(11), estimate: burnEst }),
  c("B5/waived-ceiling", "build.b5-budget-burn", "the same spend under a raised ceiling", "must-pass", { spent: burn(11), estimate: burnEst, limit: { ceiling: 1.5 } }),

  c("B6/clean", "build.b6-screens-planned", "every approved screen with a factory or joint task is planned", "must-pass", { plan: plan([["T-1", "EST-2"], ["T-2", "EST-3"]]), breakdown: { tasks: screensBuilt }, design }),
  c("B6/unplanned", "build.b6-screens-planned", "an approved screen's factory task is left out of the plan", "must-fail", { plan: plan([["T-1", "EST-1"]]), breakdown: { tasks: screensBuilt }, design }),

  c("B7/clean", "build.b7-screen-scope", "the task that builds a screen can touch the screen's file", "must-pass", { plan: planScope(["src/pages/**"]), breakdown: { tasks: screensBuilt }, design: fileDesign }),
  c("B7/out-of-scope", "build.b7-screen-scope", "the task's file scope leaves out the approved screen's file", "must-fail", { plan: planScope(["src/api/**"]), breakdown: { tasks: screensBuilt }, design: fileDesign }),
  c("B7/no-design", "build.b7-screen-scope", "an estimate with no design has nothing to check", "must-pass", { plan: planScope(["src/api/**"]), breakdown: { tasks: screensBuilt }, design: { skipped: true, screens: [] } }),
];
