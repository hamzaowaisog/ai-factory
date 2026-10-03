// Anchors and ratios: the model proposes reference tasks and a ratio per task with a reason; code
// computes anchor x ratio, merges independent estimators (median), and decides which hours count as delivery
// effort. The model never adds numbers (docs/estimates-design.md, "How the hours are built").
import type { Executor, SizeStep, TaskSizing } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";

export interface AnchorIn { taskId: string; hours: Range }
export interface RatioIn { taskId: string; anchorId: string; ratio: number; reason: string; executor: Executor; estimators?: Range[]; size?: SizeStep | undefined }

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** anchor hours x ratio, rounded to hundredths. An anchor sizes itself at ratio 1. */
export function scale(hours: Range, ratio: number): Range {
  if (!(ratio > 0)) throw new Error(`ratio must be positive, got ${ratio}`);
  return { min: r2(hours.min * ratio), max: r2(hours.max * ratio) };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Merge independent readings (docs/estimate-consistency.md, section 10, step D). The merged range is the median of
 * the readings' mins and the median of their maxes, so one estimator that reads high or low does not move the
 * estimate. The item is flagged when the spread (widest max minus lowest min) exceeds the tolerance share of the
 * readings' midpoint AND is wider than the widest single reading, so estimators who agree are not flagged for a
 * wide range they share.
 */
export function mergeEstimators(base: Range, readings: Range[], tol = DEFAULT_ASSUMPTIONS.estimatorTolerance): { hours: Range; flagged: boolean } {
  if (readings.length === 0) return { hours: base, flagged: false };
  const all = [base, ...readings];
  const lo = Math.min(...all.map((r) => r.min));
  const hi = Math.max(...all.map((r) => r.max));
  const mid = (lo + hi) / 2;
  const widest = Math.max(...all.map((r) => r.max - r.min));
  return { hours: { min: r2(median(all.map((r) => r.min))), max: r2(median(all.map((r) => r.max))) }, flagged: mid > 0 && (hi - lo) / mid > tol && hi - lo > widest + 0.005 };
}

/** Size every task against its anchor. Throws on a ratio that names something that is not an anchor. */
export function sizeTasks(anchors: AnchorIn[], ratios: RatioIn[], a: Assumptions = DEFAULT_ASSUMPTIONS): TaskSizing[] {
  const byId = new Map(anchors.map((x) => [x.taskId, x]));
  return ratios.map((r) => {
    const anchor = byId.get(r.anchorId);
    if (!anchor) throw new Error(`${r.taskId} is sized against ${r.anchorId}, which is not an anchor`);
    if (r.taskId === r.anchorId && r.ratio !== 1) throw new Error(`anchor ${r.taskId} must have ratio 1`);
    const merged = mergeEstimators(scale(anchor.hours, r.ratio), r.estimators ?? [], a.estimatorTolerance);
    return { taskId: r.taskId, anchorId: r.anchorId, ratio: r.ratio, reason: r.reason, hours: merged.hours, executor: r.executor, ...(r.size ? { size: r.size } : {}), estimators: r.estimators ?? [], flagged: merged.flagged };
  });
}

/**
 * Human effort a task contributes to the delivery estimate. Human and joint tasks carry their hours;
 * a factory task's hours are a relative size (used for cost and duration) and add no human effort:
 * its only human time is the gate time, counted separately.
 */
export function effortHours(t: Pick<TaskSizing, "executor" | "hours">): Range {
  return t.executor === "factory" ? { min: 0, max: 0 } : t.hours;
}

export const addRange = (a: Range, b: Range): Range => ({ min: r2(a.min + b.min), max: r2(a.max + b.max) });
export const ZERO: Range = { min: 0, max: 0 };
export const sumRanges = (rs: Range[]): Range => rs.reduce(addRange, ZERO);
