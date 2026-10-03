// Estimate gates E1-E5, E7 and build gates B1-B5 (docs/estimates-design.md, "Gates"). Each is a pure
// check over ledger artifacts and fails closed: missing input counts as failed. E6 is in lint.ts.
import type { z } from "zod";
import type { Approval, Breakdown, Design, Estimate, PlanTask, Questions, ReviewFinding, Spec, SpecDraft } from "../contracts/index.js";
import { screenScopeGaps, type ApprovedDesign } from "./design-link.js";
import { matchesAny } from "../util/glob.js";
import { defineGate, failure, verdict } from "../gates/engine.js";
import type { DiffSummary } from "../gates/predicates.js";
import { hashJson } from "../util/hash.js";
import { effortHours } from "./hours.js";
import { kindProblem, type Catalogue } from "./catalogue.js";

/** An outlier task sits outside median / this .. median x this within its group (E5). */
export const OUTLIER_FACTOR = 3;
/** Groups smaller than this are not compared (E5). */
export const OUTLIER_MIN_GROUP = 4;
/** Assumption, editable: changed lines per approved build hour, for the size cap (B3). */
export const LINES_PER_HOUR = 40;
export const BURN_WARN = 0.8;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ---------- estimate time ----------

export const readiness = defineGate<{ spec: Spec; questions?: Questions }>({
  id: "estimate.e1-readiness", after: "spec-gate", safety: false, waiver: "none",
  predicate: ({ spec, questions }) => {
    const fs = [];
    for (const l of spec.lint) if (!l.passed) fs.push(failure("e1-lint", `spec lint ${l.check}: ${l.details}`));
    for (const c of spec.critic) if (c.severity === "critical" || c.severity === "high") fs.push(failure("e1-critic", `critic ${c.severity}: ${c.finding}`));
    for (const s of spec.roundTrip.droppedSpans) fs.push(failure("e1-round-trip", `source span ${s} was dropped`));
    for (const c of spec.roundTrip.inventedCapabilities) fs.push(failure("e1-round-trip", `invented capability: ${c}`));
    if (!questions) fs.push(failure("e1-questions", "no questions record, so open questions cannot be ruled out"));
    else for (const q of questions.questions) if (!q.answer) fs.push(failure("e1-questions", `question ${q.id} is still open`));
    if (spec.requirements.length === 0) fs.push(failure("e1-empty", "the spec has no requirements"));
    return verdict(fs, `${spec.requirements.length} requirements, lint, critic and round trip clean, no open questions`);
  },
});

export const designBaseline = defineGate<{ ui: boolean; design?: z.infer<typeof Design>; approval?: Pick<z.infer<typeof Approval>, "decision" | "by">; note?: boolean }>({
  id: "estimate.e1b-design-baseline", after: "design", safety: false, waiver: "none",
  predicate: ({ ui, design, approval, note }) => {
    if (!ui) return { passed: true, details: "no UI in this request" };
    // a small fix's text note is approved by the person who approves the estimate (E7), on the same card
    const withEstimate = note && design?.note === true;
    const fs = [];
    if (!design) fs.push(failure("e1b-design", "the request has UI but there is no design"));
    else {
      for (const s of design.screens) if (s.reqs.length === 0) fs.push(failure("e1b-screen", `screen ${s.id} links to no requirement`));
      for (const r of design.mapping.unmappedReqs) fs.push(failure("e1b-mapping", `requirement ${r} has no screen`));
      for (const s of design.mapping.orphanScreens) fs.push(failure("e1b-mapping", `screen ${s} maps to no requirement`));
      if (design.screens.length === 0) fs.push(failure("e1b-design", "the design has no screens"));
      const ids = design.screens.map((x) => x.id);
      for (const x of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) fs.push(failure("e1b-duplicate", `two screens share the id ${x}`));
    }
    if (!withEstimate && (approval?.decision !== "approved" || !approval.by)) fs.push(failure("e1b-approval", "the mock and clickable demo are not approved by a person"));
    return verdict(fs, withEstimate ? `design note: ${design!.screens.length} page(s) linked to requirements, approved with the estimate (E7)` : `${design?.screens.length ?? 0} screens approved and linked to requirements`);
  },
});

type ScreenLike = { id: string; route?: string };

/** The breakdown and the approved design agree: each task's screen exists, each approved screen is built, no id or route twice. */
export const designCoverage = defineGate<{ design?: { skipped?: boolean; screens: ScreenLike[] }; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "estimate.e1c-design-coverage", after: "breakdown", safety: false, waiver: "human",
  predicate: ({ design, breakdown }) => {
    const screens = design && !design.skipped ? design.screens : [];
    const ids = new Set(screens.map((s) => s.id));
    const fs = [];
    const dup = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
    for (const x of dup(screens.map((s) => s.id))) fs.push(failure("e1c-duplicate-id", `two approved screens share the id ${x}`));
    for (const x of dup(screens.flatMap((s) => (s.route ? [s.route.trim().toLowerCase().replace(/\/+$/, "") || "/"] : [])))) fs.push(failure("e1c-duplicate-route", `two approved screens share the route ${x}`));
    for (const t of breakdown.tasks) {
      if (t.screen && !ids.has(t.screen)) fs.push(failure("e1c-unknown-screen", `${t.id} builds screen ${t.screen}, which is not in the approved design${screens.length ? "" : " (there is none)"}`));
    }
    const built = new Set(breakdown.tasks.map((t) => t.screen).filter(Boolean));
    for (const s of screens) if (!built.has(s.id)) fs.push(failure("e1c-unbuilt-screen", `approved screen ${s.id} is built by no task`));
    return verdict(fs, screens.length ? `all ${screens.length} approved screens are built by a task, and every task screen is approved` : "no approved screens, and no task cites one");
  },
});

export const reqToTask = defineGate<{ spec: Pick<SpecDraft, "requirements">; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "estimate.e2-req-to-task", after: "breakdown", safety: false, waiver: "none",
  predicate: ({ spec, breakdown }) => {
    const covered = new Set(breakdown.tasks.flatMap((t) => t.reqs));
    return verdict(
      spec.requirements.filter((r) => r.op !== "REMOVED" && !covered.has(r.id)).map((r) => failure("e2-uncovered", `${r.id} has no task`)),
      `all ${spec.requirements.length} requirements have a task`,
    );
  },
});

export const taskToReq = defineGate<{ spec: Pick<SpecDraft, "requirements">; breakdown: Pick<Breakdown, "tasks">; estimate?: Pick<Estimate, "suggested"> }>({
  id: "estimate.e3-task-to-req", after: "breakdown", safety: false, waiver: "human",
  predicate: ({ spec, breakdown }) => {
    const known = new Set(spec.requirements.map((r) => r.id));
    const fs = [];
    for (const t of breakdown.tasks) {
      for (const r of t.reqs) if (!known.has(r)) fs.push(failure("e3-unknown", `${t.id} cites ${r}, which is not in the spec`));
      if (t.reqs.length === 0 && !t.overhead?.trim()) fs.push(failure("e3-extra", `${t.id} "${t.title}" cites no requirement and names no overhead; move it to Suggested, not included`));
    }
    return verdict(fs, "every task cites a requirement or a named overhead");
  },
});

/**
 * Every task has a catalogue kind that fits its track (docs/estimate-consistency.md, section 10, step C). The catalogue
 * is part of the gate's inputs, so the evidence re-checks against the catalogue the breakdown was made with.
 */
export const taskKind = defineGate<{ breakdown: Pick<Breakdown, "tasks">; catalogue: Pick<Catalogue, "version" | "kinds"> }>({
  id: "estimate.e2c-task-kind", after: "breakdown", safety: false, waiver: "none",
  predicate: ({ breakdown, catalogue }) => verdict(
    breakdown.tasks.flatMap((t) => { const p = kindProblem(catalogue, t); return p ? [failure("e2c-kind", p)] : []; }),
    `every task has a catalogue kind that fits its track (catalogue ${catalogue.version})`,
  ),
});

export const forgottenWork = defineGate<{ breakdown: Pick<Breakdown, "checklist"> }>({
  id: "estimate.e4-checklist", after: "breakdown", safety: false, waiver: "human",
  predicate: ({ breakdown }) => {
    if (breakdown.checklist.length === 0) return verdict([failure("e4-empty", "the forgotten-work checklist is empty")], "");
    return verdict(
      breakdown.checklist.filter((c) => !c.included && !c.reason?.trim()).map((c) => failure("e4-reason", `"${c.item}" is left out with no reason`)),
      `${breakdown.checklist.length} checklist items each in, or out with a reason`,
    );
  },
});

/** Similar work (same track, complexity and executor) within a stated tolerance; an outlier must be flagged by the estimators. */
export const consistency = defineGate<{ estimate: Pick<Estimate, "tasks">; breakdown: Pick<Breakdown, "tasks">; ui?: Record<string, "simple" | "moderate" | "complex"> }>({
  id: "estimate.e5-consistency", after: "estimate", safety: false, waiver: "human",
  predicate: ({ estimate, breakdown, ui }) => {
    const byId = new Map(breakdown.tasks.map((t) => [t.id, t]));
    const groups = new Map<string, { id: string; avg: number; flagged: boolean }[]>();
    for (const s of estimate.tasks) {
      const t = byId.get(s.taskId);
      if (!t || t.overhead) continue;
      const h = s.hours; // sized hours, so factory tasks are compared too
      const key = `${t.track}/${t.complexity}/${s.executor}`;
      groups.set(key, [...(groups.get(key) ?? []), { id: s.taskId, avg: (h.min + h.max) / 2, flagged: s.flagged }]);
    }
    const fs = [];
    for (const [key, xs] of groups) {
      if (xs.length < OUTLIER_MIN_GROUP) continue;
      const m = median(xs.map((x) => x.avg));
      if (m <= 0) continue;
      for (const x of xs) {
        if ((x.avg > m * OUTLIER_FACTOR || x.avg < m / OUTLIER_FACTOR) && !x.flagged) fs.push(failure("e5-outlier", `${x.id} at ${x.avg}h is far from the ${key} median ${m}h and is not flagged`));
      }
    }
    if (ui) fs.push(...uiOrder(estimate, breakdown, ui));
    return verdict(fs, "similar tasks are within tolerance");
  },
});

const RANK = { simple: 0, moderate: 1, complex: 2 } as const;
/**
 * A screen counted as more complex in the approved demo is not sized below a simpler one: each screen's web or mobile tasks are added
 * up per track and executor, and a complex screen under a simple one fails (moderate sits between and is not compared). A screen
 * with a flagged task is left out, as its range is already the lead's to judge.
 */
function uiOrder(estimate: Pick<Estimate, "tasks">, breakdown: Pick<Breakdown, "tasks">, ui: Record<string, keyof typeof RANK>) {
  const sized = new Map(estimate.tasks.map((s) => [s.taskId, s]));
  const groups = new Map<string, Map<string, { avg: number; flagged: boolean; ids: string[] }>>();
  for (const t of breakdown.tasks) {
    const s = sized.get(t.id), level = t.screen ? ui[t.screen] : undefined;
    if (!s || !level || t.overhead || (t.track !== "web" && t.track !== "mobile")) continue;
    const key = `${t.track}/${s.executor}`, g = groups.get(key) ?? new Map();
    const x = g.get(t.screen!) ?? { avg: 0, flagged: false, ids: [] };
    g.set(t.screen!, { avg: x.avg + (s.hours.min + s.hours.max) / 2, flagged: x.flagged || s.flagged, ids: [...x.ids, t.id] });
    groups.set(key, g);
  }
  const fs = [];
  for (const [key, g] of groups) {
    const list = [...g].filter(([, x]) => !x.flagged);
    const simple = list.filter(([id]) => ui[id] === "simple").sort((a, b) => b[1].avg - a[1].avg)[0];
    if (!simple) continue;
    for (const [id, x] of list) {
      if (ui[id] === "complex" && x.avg < simple[1].avg) fs.push(failure("e5-ui-order", `screen ${id} is complex in the approved demo but its ${key} work (${x.ids.join(", ")}) is sized at ${Math.round(x.avg * 100) / 100}h, below simple screen ${simple[0]} at ${Math.round(simple[1].avg * 100) / 100}h`));
    }
  }
  return fs;
}

/** who approves a hands-off estimate run (no human review) */
export const FACTORY_APPROVER = "factory";

/** E7. A person approves, signing off every low-confidence task; in a hands-off run (`auto`) the factory approves instead. */
export const leadApproval = defineGate<{ estimate: Estimate; approval?: { estimateHash: string; decision: "approved" | "rejected"; by: string; signedOff: string[]; auto?: boolean } }>({
  id: "estimate.e7-approval", after: "estimate", safety: false, waiver: "none",
  predicate: ({ estimate, approval }) => {
    if (!approval) return verdict([failure("e7-missing", "no approval recorded")], "");
    const fs = [];
    if (approval.decision !== "approved") fs.push(failure("e7-decision", `the estimate was ${approval.decision}`));
    if (!approval.by.trim()) fs.push(failure("e7-by", "the approval names no person"));
    if (approval.auto && approval.by !== FACTORY_APPROVER) fs.push(failure("e7-by", `a hands-off approval is the factory's, not ${approval.by}'s`));
    if (approval.estimateHash !== hashJson(estimate)) fs.push(failure("e7-hash", "the approval is for a different version of the estimate"));
    if (!approval.auto) for (const t of estimate.tasks) if (t.flagged && !approval.signedOff.includes(t.taskId)) fs.push(failure("e7-signoff", `low-confidence ${t.taskId} has no sign-off`));
    return verdict(fs, approval.auto ? "approved by the factory (no human review)" : `approved by ${approval.by}`);
  },
});

// ---------- during the build ----------

export const scopeLock = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "estimateTaskId">[] }; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "build.b1-scope-lock", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, breakdown }) => {
    const approved = new Set(breakdown.tasks.map((t) => t.id));
    return verdict(
      plan.tasks.flatMap((t) => !t.estimateTaskId
        ? [failure("b1-unmapped", `plan task ${t.id} maps to no estimate task`)]
        : approved.has(t.estimateTaskId) ? [] : [failure("b1-unknown", `plan task ${t.id} maps to ${t.estimateTaskId}, which is not in the approved estimate`)]),
      "every plan task maps to an approved estimate task",
    );
  },
});

/** B6: a build that follows an approved estimate plans every approved screen, through the estimate tasks that build it. */
export const screensPlanned = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "estimateTaskId">[] }; breakdown: Pick<Breakdown, "tasks">; design?: { skipped?: boolean; screens: ScreenLike[] } }>({
  id: "build.b6-screens-planned", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, breakdown, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved estimate has no design" };
    const planned = new Set(plan.tasks.map((t) => t.estimateTaskId).filter(Boolean));
    const fs = [];
    for (const s of design.screens) {
      const builders = breakdown.tasks.filter((t) => t.screen === s.id && t.executor !== "human");
      // a screen that only humans build (no factory task) is outside this plan
      if (builders.length && !builders.some((t) => planned.has(t.id))) fs.push(failure("b6-screen", `approved screen ${s.id} is built by ${builders.map((t) => t.id).join(", ")}, and the plan delivers none of them`));
    }
    return verdict(fs, `every approved screen with a factory task is in the plan (${design.screens.length})`);
  },
});

/** B7: the plan task that builds an approved screen may touch that screen's file, so the screen that was approved is the one built. */
export const screenScope = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "estimateTaskId" | "fileScope">[] }; breakdown: Pick<Breakdown, "tasks">; design?: ApprovedDesign }>({
  id: "build.b7-screen-scope", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, breakdown, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved estimate has no design" };
    return verdict(
      screenScopeGaps(plan, breakdown, design).map((g) => failure("b7-screen-scope", `plan task ${g.task} builds approved screen ${g.screen}, but its file scope does not include ${g.file}`)),
      "every plan task that builds an approved screen can touch that screen's file",
    );
  },
});

/**
 * B1 for a build from an approved design (`--from-design`, no estimate): every plan task delivers requirements of the approved
 * spec, and none delivers one the design run did not approve (PR #11 review, item 10).
 */
export const designScopeLock = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "reqs">[] }; approvedSpec: Pick<SpecDraft, "requirements"> }>({
  id: "build.b1-design-scope", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, approvedSpec }) => {
    const approved = new Set(approvedSpec.requirements.map((r) => r.id));
    return verdict(
      plan.tasks.flatMap((t) => !t.reqs.length
        ? [failure("b1-unmapped", `plan task ${t.id} delivers no approved requirement`)]
        : t.reqs.filter((r) => !approved.has(r)).map((r) => failure("b1-unknown", `plan task ${t.id} delivers ${r}, which the approved design's spec does not have`))),
      "every plan task delivers approved requirements",
    );
  },
});

/**
 * B6 and B7 for a build from an approved design: each approved screen is delivered by a plan task that serves its
 * requirements, and one of those tasks can touch the screen's file, so the screen that was approved is the one built.
 */
export const designScreensPlanned = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "reqs" | "fileScope">[] }; design?: ApprovedDesign }>({
  id: "build.b6-design-screens", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved design has no screens" };
    const fs = [];
    for (const s of design.screens) {
      const serving = plan.tasks.filter((t) => t.reqs.some((r) => s.reqs.includes(r)));
      if (!serving.length) fs.push(failure("b6-screen", `approved screen ${s.id} (${s.route}) serves ${s.reqs.join(", ")}, and no plan task delivers them`));
      else if (s.file && !serving.some((t) => matchesAny(s.file, t.fileScope))) fs.push(failure("b7-screen-scope", `approved screen ${s.id} is delivered by ${serving.map((t) => t.id).join(", ")}, but none of their file scopes includes ${s.file}`));
    }
    return verdict(fs, `every approved screen (${design.screens.length}) is planned, by a task that can touch its file`);
  },
});

const reqHashes = (s: Pick<SpecDraft, "requirements">) => new Map(s.requirements.map((r) => [r.id, hashJson(r)]));

/** A new or changed requirement must produce an estimate whose parent is the approved one. */
export const changeRequest = defineGate<{ spec: Pick<SpecDraft, "requirements">; approvedSpec: Pick<SpecDraft, "requirements">; approvedEstimateSha: string; estimate?: Pick<Estimate, "parentEstimate" | "specSha"> }>({
  id: "build.b2-change-request", after: "plan", safety: false, waiver: "human",
  predicate: ({ spec, approvedSpec, approvedEstimateSha, estimate }) => {
    const now = reqHashes(spec), was = reqHashes(approvedSpec);
    const changed = [...now].filter(([id, h]) => was.get(id) !== h).map(([id]) => id);
    const removed = [...was.keys()].filter((id) => !now.has(id));
    const all = [...changed, ...removed];
    if (all.length === 0) return { passed: true, details: "no requirement changed since approval" };
    if (!estimate) return verdict([failure("b2-missing", `requirements changed (${all.join(", ")}) and there is no estimate v2`)], "");
    return verdict(
      estimate.parentEstimate === approvedEstimateSha ? [] : [failure("b2-parent", `requirements changed (${all.join(", ")}) but the new estimate does not revise the approved one`)],
      `estimate v2 covers ${all.length} changed requirements`,
    );
  },
});

/** Approved build effort caps the change size, at LINES_PER_HOUR (an editable assumption). */
export const sizeCap = defineGate<{ diff: DiffSummary; estimate: Estimate }>({
  id: "build.b3-size-cap", after: "integrate", safety: false, waiver: "human",
  predicate: ({ diff, estimate }, policy) => {
    const lines = diff.files.reduce((n, f) => n + f.added.length + f.removed.length, 0);
    const hours = estimate.tasks.reduce((n, t) => n + t.hours.max, 0);
    const cap = Math.min(policy.maxDiffLines, Math.round(hours * LINES_PER_HOUR));
    return lines > cap
      ? verdict([failure("b3-size", `${lines} changed lines against an approved cap of ${cap}`)], "")
      : { passed: true, details: `${lines} changed lines, cap ${cap}` };
  },
});

export const unrequestedBehaviour = defineGate<{ review: { findings: ReviewFinding[] } }>({
  id: "build.b4-unrequested", after: "review", safety: false, waiver: "human",
  predicate: ({ review }, policy) => verdict(
    review.findings.filter((f) => f.category === "unrequested-behaviour" && f.confidence >= policy.reviewConfidence)
      .map((f) => failure("b4-unrequested", f.text, { location: `${f.file}:${f.line}` })),
    "the diff traces to requirements",
  ),
});

export interface Burn { effortHours: number; apiUsd: number; elapsedDays: number }
type Budgeted = Pick<Estimate, "totals" | "apiCost" | "elapsed"> & Partial<Pick<Estimate, "gateHours">>;

/**
 * Spend as a share of the approved maximum. Measured effort is the human gate time the ledger can count
 * (see budget.ts), so it is held against the estimate's own gate hours, not against the whole-project total,
 * which also holds human tasks (UAT, design approval, PM) that no run measures. The solely agentic model
 * has no gate hours, so it has no effort limit.
 */
export function burnRatios(spent: Burn, e: Budgeted): Record<keyof Burn, number> {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 0);
  const gateMax = (e.gateHours ?? []).reduce((n, g) => n + g.hours.max, 0);
  return {
    effortHours: gateMax > 0 ? ratio(spent.effortHours, gateMax) : 0,
    apiUsd: ratio(spent.apiUsd, e.apiCost.total.max),
    elapsedDays: ratio(spent.elapsedDays, e.elapsed.criticalPathDays.max),
  };
}

/** Warn at 80% of the approved maximum, stop at 100%; a lead's waiver raises the ceiling (1 = the approved maximum). */
export const budgetBurn = defineGate<{ spent: Burn; estimate: Budgeted; limit?: { ceiling: number } }>({
  id: "build.b5-budget-burn", after: "implement", safety: false, waiver: "human",
  predicate: ({ spent, estimate, limit }) => {
    const ceiling = limit?.ceiling ?? 1;
    const r = burnRatios(spent, estimate);
    const over = (Object.keys(r) as (keyof Burn)[]).filter((k) => r[k] >= ceiling);
    if (over.length) return verdict(over.map((k) => failure("b5-burn", `${k} is at ${Math.round(r[k] * 100)}% of the approved maximum`)), "");
    const warn = (Object.keys(r) as (keyof Burn)[]).filter((k) => r[k] >= BURN_WARN * ceiling);
    return { passed: true, details: warn.length ? `warning: ${warn.map((k) => `${k} ${Math.round(r[k] * 100)}%`).join(", ")} of the approved maximum` : "within the approved budget" };
  },
});
