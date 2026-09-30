// Totals, weeks and elapsed time: pure arithmetic over the breakdown and the sized tasks.
// Gate E6 recomputes these independently and compares (src/estimate/lint.ts).
import type { BreakdownTask, Estimate, TaskSizing, Track } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";
import { addRange, effortHours, ZERO } from "./hours.js";

export type Totals = Estimate["totals"];
type Overhead = Estimate["overheads"][number];
type GateLine = Estimate["gateHours"][number];

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Per-track and overall delivery effort. Tasks land in their track; overheads and gate hours land in
 * theirs when they name one. Design always shows its row, and counts in the overall figure only when
 * `designInTotal` is set. Untracked overheads and gate hours count in the overall figure only.
 */
export function computeTotals(
  tasks: Pick<BreakdownTask, "id" | "track">[], sized: Pick<TaskSizing, "taskId" | "executor" | "hours">[],
  overheads: Pick<Overhead, "track" | "hours">[], gates: Pick<GateLine, "track" | "hours">[], designInTotal: boolean,
): Totals {
  const trackOf = new Map(tasks.map((t) => [t.id, t.track]));
  const by = new Map<Track, Range>();
  const add = (t: Track, r: Range) => by.set(t, addRange(by.get(t) ?? ZERO, r));
  for (const s of sized) {
    const t = trackOf.get(s.taskId);
    if (!t) throw new Error(`${s.taskId} is not in the breakdown`);
    add(t, effortHours(s));
  }
  let untracked = ZERO;
  for (const x of [...overheads, ...gates]) {
    if (x.track) add(x.track, x.hours); else untracked = addRange(untracked, x.hours);
  }
  const byTrack: Totals["byTrack"] = {};
  let overall = untracked;
  for (const [t, r] of by) {
    byTrack[t] = r;
    if (t !== "design" || designInTotal) overall = addRange(overall, r);
  }
  return { byTrack, overall };
}

/** Calendar weeks for a track: hours / hoursPerWeek / resources. */
export function weeks(hours: Range, resources: number, a: Assumptions = DEFAULT_ASSUMPTIONS): Range {
  if (!(resources > 0)) throw new Error("resources must be positive");
  return { min: round(hours.min / a.hoursPerWeek / resources), max: round(hours.max / a.hoursPerWeek / resources) };
}

/**
 * Longest dependency chain, in hours. `durationOf` gives each task's duration (human tasks from their
 * hours, factory tasks from the harness). Throws on a dependency cycle.
 */
export function criticalPath(tasks: Pick<BreakdownTask, "id" | "dependsOn">[], durationOf: (id: string) => Range): Range {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, Range>();
  const visiting = new Set<string>();
  const finish = (id: string): Range => {
    const done = memo.get(id);
    if (done) return done;
    if (visiting.has(id)) throw new Error(`dependency cycle through ${id}`);
    visiting.add(id);
    const t = byId.get(id);
    if (!t) throw new Error(`unknown task ${id}`);
    let start: Range = ZERO;
    for (const d of t.dependsOn) {
      const f = finish(d);
      start = { min: Math.max(start.min, f.min), max: Math.max(start.max, f.max) };
    }
    visiting.delete(id);
    const own = durationOf(id);
    const r = { min: round(start.min + own.min), max: round(start.max + own.max) };
    memo.set(id, r);
    return r;
  };
  let out: Range = ZERO;
  for (const t of tasks) {
    const f = finish(t.id);
    out = { min: Math.max(out.min, f.min), max: Math.max(out.max, f.max) };
  }
  return out;
}

/**
 * Elapsed days: the critical path plus, in HITL, the review queue (PRs are reviewed one at a time, so
 * the queue only ever lengthens the maximum). Waiting for external keys and approvals is a dependency
 * task with its own duration, not effort.
 */
export function elapsedDays(path: Range, queueHours: number, a: Assumptions = DEFAULT_ASSUMPTIONS): Range {
  return { min: round(path.min / a.hoursPerDay), max: round((path.max + queueHours) / a.hoursPerDay) };
}
