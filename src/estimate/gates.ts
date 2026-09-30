// Estimate gates E1-E5, E7 and build gates B1-B5 (docs/estimates-design.md, "Gates"). Each is a pure
// check over ledger artifacts and fails closed: missing input counts as failed. E6 is in lint.ts.
import type { z } from "zod";
import type { Approval, Breakdown, Design, Estimate, PlanTask, Questions, ReviewFinding, Spec, SpecDraft } from "../contracts/index.js";
import { defineGate, failure, verdict } from "../gates/engine.js";
import type { DiffSummary } from "../gates/predicates.js";
import { hashJson } from "../util/hash.js";
import { effortHours } from "./hours.js";

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

export const designBaseline = defineGate<{ ui: boolean; design?: z.infer<typeof Design>; approval?: Pick<z.infer<typeof Approval>, "decision" | "by"> }>({
  id: "estimate.e1b-design-baseline", after: "design", safety: false, waiver: "none",
  predicate: ({ ui, design, approval }) => {
    if (!ui) return { passed: true, details: "no UI in this request" };
    const fs = [];
    if (!design) fs.push(failure("e1b-design", "the request has UI but there is no design"));
    else {
      for (const s of design.screens) if (s.reqs.length === 0) fs.push(failure("e1b-screen", `screen ${s.id} links to no requirement`));
      for (const r of design.mapping.unmappedReqs) fs.push(failure("e1b-mapping", `requirement ${r} has no screen`));
      for (const s of design.mapping.orphanScreens) fs.push(failure("e1b-mapping", `screen ${s} maps to no requirement`));
      if (design.screens.length === 0) fs.push(failure("e1b-design", "the design has no screens"));
    }
    if (approval?.decision !== "approved" || !approval.by) fs.push(failure("e1b-approval", "the mock and clickable demo are not approved by a person"));
    return verdict(fs, `${design?.screens.length ?? 0} screens approved and linked to requirements`);
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
export const consistency = defineGate<{ estimate: Pick<Estimate, "tasks">; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "estimate.e5-consistency", after: "estimate", safety: false, waiver: "human",
  predicate: ({ estimate, breakdown }) => {
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
    return verdict(fs, "similar tasks are within tolerance");
  },
});

export const leadApproval = defineGate<{ estimate: Estimate; approval?: { estimateHash: string; decision: "approved" | "rejected"; by: string; signedOff: string[] } }>({
  id: "estimate.e7-approval", after: "estimate", safety: false, waiver: "none",
  predicate: ({ estimate, approval }) => {
    if (!approval) return verdict([failure("e7-missing", "no approval recorded")], "");
    const fs = [];
    if (approval.decision !== "approved") fs.push(failure("e7-decision", `the estimate was ${approval.decision}`));
    if (!approval.by.trim()) fs.push(failure("e7-by", "the approval names no person"));
    if (approval.estimateHash !== hashJson(estimate)) fs.push(failure("e7-hash", "the approval is for a different version of the estimate"));
    for (const t of estimate.tasks) if (t.flagged && !approval.signedOff.includes(t.taskId)) fs.push(failure("e7-signoff", `low-confidence ${t.taskId} has no sign-off`));
    return verdict(fs, `approved by ${approval.by}`);
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
export function burnRatios(spent: Burn, e: Pick<Estimate, "totals" | "apiCost" | "elapsed">): Record<keyof Burn, number> {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 0);
  return {
    effortHours: ratio(spent.effortHours, e.totals.overall.max),
    apiUsd: ratio(spent.apiUsd, e.apiCost.total.max),
    elapsedDays: ratio(spent.elapsedDays, e.elapsed.criticalPathDays.max),
  };
}

/** Warn at 80% of the approved maximum, stop at 100%. */
export const budgetBurn = defineGate<{ spent: Burn; estimate: Pick<Estimate, "totals" | "apiCost" | "elapsed"> }>({
  id: "build.b5-budget-burn", after: "implement", safety: false, waiver: "human",
  predicate: ({ spent, estimate }) => {
    const r = burnRatios(spent, estimate);
    const over = (Object.keys(r) as (keyof Burn)[]).filter((k) => r[k] >= 1);
    if (over.length) return verdict(over.map((k) => failure("b5-burn", `${k} is at ${Math.round(r[k] * 100)}% of the approved maximum`)), "");
    const warn = (Object.keys(r) as (keyof Burn)[]).filter((k) => r[k] >= BURN_WARN);
    return { passed: true, details: warn.length ? `warning: ${warn.map((k) => `${k} ${Math.round(r[k] * 100)}%`).join(", ")} of the approved maximum` : "within the approved budget" };
  },
});
