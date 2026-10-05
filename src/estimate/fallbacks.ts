// What a hands-off estimate run does when a gate still fails after the retry with the failures fed back (docs/estimates-design.md,
// "Gates"): no person waives it, so the factory decides, by rules, and every decision is written on the estimate. Review mode keeps
// the waiver card. Pure: no model, no ledger; the small model call for missing tasks and wrong kinds is in src/stages/estimate.ts.
import type { BreakdownBody, BreakdownTask, Estimate, Failure } from "../contracts/index.js";
import type { z } from "zod";
import { kindProblem, type Catalogue } from "./catalogue.js";

type Body = z.infer<typeof BreakdownBody>;
type Suggested = Estimate["suggested"][number];

/** what a checklist item left out with no reason says, and what an empty checklist is filled with (gate E4) */
export const NOT_ASSESSED = "not assessed by the factory (hands-off): confirm with the client";
export const CHECKLIST_ITEMS = ["auth", "roles", "environments", "CI/CD", "monitoring", "error handling", "migrations", "notifications", "reports and exports", "admin tools", "accessibility", "feedback rounds", "documentation", "release"];

export interface BreakdownFix {
  body: Body;
  /** tasks taken out of the breakdown (gate E3), for the estimate's "Suggested, not included" */
  suggested: Suggested[];
  /** each decision, as a line for the estimate's assumptions */
  notes: string[];
}

/**
 * The rule-based fixes: a task that cites a requirement the spec does not have loses that citation (E3); a task that then
 * cites none and names no overhead leaves the breakdown for "Suggested, not included" (E3), and other tasks stop depending
 * on it; a checklist item left out with no reason is marked not assessed, and an empty checklist lists every item so (E4);
 * a task naming a screen the approved design does not have no longer names one (E1c).
 */
export function fixBreakdown(body: Body, specReqs: string[], screens: string[]): BreakdownFix {
  const known = new Set(specReqs);
  const approved = new Set(screens);
  const notes: string[] = [];
  const suggested: Suggested[] = [];
  const kept: BreakdownTask[] = [];
  for (const t0 of body.tasks) {
    let t = t0;
    const unknown = t.reqs.filter((r) => !known.has(r));
    if (unknown.length) {
      t = { ...t, reqs: t.reqs.filter((r) => known.has(r)) };
      notes.push(`Factory decision (hands-off, gate E3): ${t.id} "${t.title}" no longer cites ${unknown.join(", ")}, which the spec does not have.`);
    }
    if (t.screen && !approved.has(t.screen)) {
      notes.push(`Factory decision (hands-off, gate E1c): ${t.id} "${t.title}" named screen ${t.screen}, which is not in the approved design; it is sized as a task with no screen.`);
      const { screen: _s, ...rest } = t;
      t = rest as BreakdownTask;
    }
    if (t.reqs.length === 0 && !t.overhead?.trim()) {
      suggested.push({ title: t.title, reason: `no requirement asks for it (taken out of the breakdown by the factory, hands-off, gate E3; was ${t.id})` });
      notes.push(`Factory decision (hands-off, gate E3): ${t.id} "${t.title}" cites no requirement and names no overhead, so it moved to Suggested, not included.`);
      continue;
    }
    kept.push(t);
  }
  const gone = new Set(body.tasks.map((t) => t.id).filter((id) => !kept.some((t) => t.id === id)));
  const tasks = gone.size ? kept.map((t) => (t.dependsOn.some((d) => gone.has(d)) ? { ...t, dependsOn: t.dependsOn.filter((d) => !gone.has(d)) } : t)) : kept;

  let checklist = body.checklist;
  if (!checklist.length) {
    checklist = CHECKLIST_ITEMS.map((item) => ({ item, included: false, reason: NOT_ASSESSED }));
    notes.push(`Factory decision (hands-off, gate E4): the forgotten-work checklist was empty; every item (${CHECKLIST_ITEMS.join(", ")}) is ${NOT_ASSESSED}.`);
  } else {
    const blank = checklist.filter((c) => !c.included && !c.reason?.trim());
    if (blank.length) {
      checklist = checklist.map((c) => (!c.included && !c.reason?.trim() ? { ...c, reason: NOT_ASSESSED } : c));
      notes.push(`Factory decision (hands-off, gate E4): ${blank.map((c) => `"${c.item}"`).join(", ")} left out with no reason: ${NOT_ASSESSED}.`);
    }
  }
  return { body: { ...body, tasks, checklist }, suggested, notes };
}

/** What only a model can add: requirements no task delivers (E2), approved screens no task builds (E1c), tasks whose kind does not fit (E2c). */
export interface BreakdownGaps { uncovered: string[]; unbuilt: string[]; kinds: { taskId: string; problem: string }[] }

export function breakdownGaps(body: Body, spec: { requirements: { id: string; op?: string }[] }, screens: string[], catalogue: Pick<Catalogue, "kinds">): BreakdownGaps {
  const covered = new Set(body.tasks.flatMap((t) => t.reqs));
  const built = new Set(body.tasks.map((t) => t.screen).filter(Boolean));
  return {
    uncovered: spec.requirements.filter((r) => r.op !== "REMOVED" && !covered.has(r.id)).map((r) => r.id),
    unbuilt: screens.filter((s) => !built.has(s)),
    kinds: body.tasks.flatMap((t) => { const p = kindProblem(catalogue, t); return p ? [{ taskId: t.id, problem: p }] : []; }),
  };
}

export const noGaps = (g: BreakdownGaps): boolean => !g.uncovered.length && !g.unbuilt.length && !g.kinds.length;

/** The model's patch, merged: its new tasks added, its kinds set on the tasks named. Ids that clash are refused. */
export function applyPatch(body: Body, patch: { tasks: BreakdownTask[]; kinds: { taskId: string; kind: string }[] }, gaps: BreakdownGaps): { body: Body; notes: string[] } | { error: string } {
  const ids = new Set(body.tasks.map((t) => t.id));
  const clash = patch.tasks.filter((t) => ids.has(t.id)).map((t) => t.id);
  if (clash.length) return { error: `the patch reuses task ids ${clash.join(", ")}` };
  const kinds = new Map(patch.kinds.map((k) => [k.taskId, k.kind]));
  const unknown = [...kinds.keys()].filter((id) => !ids.has(id));
  if (unknown.length) return { error: `the patch sets kinds on unknown tasks ${unknown.join(", ")}` };
  const tasks = [...body.tasks.map((t) => (kinds.has(t.id) ? { ...t, kind: kinds.get(t.id)! } : t)), ...patch.tasks];
  const notes: string[] = [];
  if (patch.tasks.length) notes.push(`Factory decision (hands-off, gates E2/E1c): added ${patch.tasks.map((t) => `${t.id} "${t.title}"`).join(", ")} for ${[...gaps.uncovered, ...gaps.unbuilt].join(", ")}, which no task delivered.`);
  if (kinds.size) notes.push(`Factory decision (hands-off, gate E2c): re-kinded ${[...kinds].map(([id, k]) => `${id} as ${k}`).join(", ")}.`);
  return { body: { ...body, tasks }, notes };
}

/**
 * A breakdown that still fails its gates after the rounds of questions goes on (src/stages/gate-questions.ts): a task whose kind does
 * not fit the catalogue loses it, so the estimate sizes the breakdown by anchors and ratios instead of failing on it (gate E2c);
 * everything else that fails is carried as an open risk by the step.
 */
export function carryBreakdown(body: Body, catalogue: Pick<Catalogue, "kinds">): { body: Body; notes: string[] } {
  const bad = new Map(body.tasks.flatMap((t) => { const p = kindProblem(catalogue, t); return p && t.kind ? [[t.id, p] as const] : []; }));
  if (!bad.size) return { body, notes: [] };
  const tasks = body.tasks.map((t) => { if (!bad.has(t.id)) return t; const { kind: _k, ...rest } = t; return rest as BreakdownTask; });
  return { body: { ...body, tasks }, notes: [`Open risk: ${[...bad.values()].join("; ")}; ${bad.size === 1 ? "that task loses its kind" : "those tasks lose their kinds"}, so the estimate sizes the tasks by anchors and ratios instead of the task catalogue (gate E2c, carried after the rounds of questions).`] };
}

/**
 * Gate E5, hands-off: each task named by an outlier or UI-order failure (its location) is flagged, so it reads as low confidence
 * with the gate's reason, and the range stays the estimators' median (gate E6 recomputes it, so it is not widened by hand).
 */
export function flagOutliers(estimate: Estimate, failures: Failure[], how = "hands-off"): { estimate: Estimate; notes: string[] } {
  const why = new Map<string, string>();
  for (const f of failures) for (const id of (f.location ?? "").split(",").map((x) => x.trim()).filter(Boolean)) if (!why.has(id)) why.set(id, f.message);
  const tasks = estimate.tasks.map((t) => (why.has(t.taskId) ? { ...t, flagged: true } : t));
  const notes = [...why].map(([id, m]) => `Open risk: ${id} flagged by the factory (${how}, gate E5): ${m}. Confirm its range before it is quoted.`);
  return { estimate: { ...estimate, tasks, assumptions: [...estimate.assumptions, ...notes] }, notes };
}
