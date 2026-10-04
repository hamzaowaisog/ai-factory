// Gate E6, data level: code recomputes every total from the breakdown and the sized tasks and compares
// it with what the estimate stores. (The cell-by-cell workbook lint arrives with the export slice.)
import { defineGate, failure, verdict } from "../gates/engine.js";
import type { Breakdown, Estimate } from "../contracts/index.js";
import { mergeEstimators, scale } from "./hours.js";
import { computeTotals } from "./totals.js";

const EPS = 0.011;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

export interface LintIssue { check: string; message: string }

export function lintEstimate(e: Estimate, b: Pick<Breakdown, "tasks">): LintIssue[] {
  const issues: LintIssue[] = [];
  const bad = (check: string, message: string) => issues.push({ check, message });

  // every breakdown task is sized exactly once, and nothing else is
  const sized = new Map<string, number>();
  for (const t of e.tasks) sized.set(t.taskId, (sized.get(t.taskId) ?? 0) + 1);
  for (const t of b.tasks) if (!sized.has(t.id)) bad("task-missing", `${t.id} has no sizing`);
  for (const [id, n] of sized) {
    if (n > 1) bad("task-duplicate", `${id} is sized ${n} times`);
    if (!b.tasks.some((t) => t.id === id)) bad("task-unknown", `${id} is sized but not in the breakdown`);
  }

  // hours = anchor x ratio, merged with the other estimators' readings by median (step D); an estimate made before
  // the median merge only ever widened the range, so it is checked by that older rule
  const anchors = new Map(e.anchors.map((a) => [a.taskId, a]));
  for (const t of e.tasks) {
    const a = anchors.get(t.anchorId);
    if (!a) continue;
    const base = scale(a.hours, t.ratio);
    if (e.merge === "median") {
      const expect = mergeEstimators(base, t.estimators).hours;
      if (!near(t.hours.min, expect.min) || !near(t.hours.max, expect.max)) bad("ratio", `${t.taskId} hours ${t.hours.min}-${t.hours.max} differ from anchor x ratio${t.estimators.length ? " merged with the other estimators" : ""} ${expect.min}-${expect.max}`);
      continue;
    }
    if (t.hours.min > base.min + EPS || t.hours.max < base.max - EPS) bad("ratio", `${t.taskId} hours ${t.hours.min}-${t.hours.max} do not cover anchor x ratio ${base.min}-${base.max}`);
    if (t.estimators.length === 0 && (!near(t.hours.min, base.min) || !near(t.hours.max, base.max))) bad("ratio", `${t.taskId} hours ${t.hours.min}-${t.hours.max} differ from anchor x ratio ${base.min}-${base.max}`);
  }

  // totals recomputed from scratch
  const known = b.tasks.filter((t) => sized.has(t.id));
  let again: ReturnType<typeof computeTotals> | undefined;
  try {
    again = computeTotals(known, e.tasks.filter((t) => known.some((k) => k.id === t.taskId)), e.overheads, e.gateHours, e.settings.designInTotal);
  } catch (err) { bad("totals", (err as Error).message); }
  if (again) {
    if (!near(again.overall.min, e.totals.overall.min) || !near(again.overall.max, e.totals.overall.max)) {
      bad("total-overall", `overall stored ${e.totals.overall.min}-${e.totals.overall.max}, recomputed ${again.overall.min}-${again.overall.max}`);
    }
    const tracks = new Set([...Object.keys(again.byTrack), ...Object.keys(e.totals.byTrack)]);
    for (const t of tracks) {
      const x = again.byTrack[t as keyof typeof again.byTrack];
      const y = e.totals.byTrack[t as keyof typeof e.totals.byTrack];
      if (!x || !y || !near(x.min, y.min) || !near(x.max, y.max)) bad("total-track", `${t}: stored ${y ? `${y.min}-${y.max}` : "none"}, recomputed ${x ? `${x.min}-${x.max}` : "none"}`);
    }
  }

  // API cost adds up
  const cost = e.apiCost;
  const min = cost.phases.reduce((s, p) => s + p.usd.min, 0);
  const max = cost.phases.reduce((s, p) => s + p.usd.max, 0);
  if (!near(min, cost.total.min) || !near(max, cost.total.max)) bad("cost-total", `API cost stored ${cost.total.min}-${cost.total.max}, phases add to ${min.toFixed(2)}-${max.toFixed(2)}`);
  if (cost.records === 0 && cost.confidence !== "cold-start") bad("cost-confidence", "no benchmark records, but the confidence is not cold-start");

  // solely agentic carries no supervisor gates
  if (e.deliveryModel === "agentic" && e.gateHours.length) bad("agentic-gates", "the solely agentic model carries no supervisor gate hours");
  return issues;
}

export const estimateWorkbookLint = defineGate<{ estimate: Estimate; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "estimate.e6-lint", after: "estimate", safety: false, waiver: "none",
  predicate: ({ estimate, breakdown }) => {
    const issues = lintEstimate(estimate, breakdown);
    return verdict(issues.map((i) => failure(`estimate-${i.check}`, i.message)), "totals, ratios and costs recompute cleanly");
  },
});
