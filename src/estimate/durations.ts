// Factory task durations from the ledger (docs/estimates-design.md, "Duration harness"). Each finished implement
// step that delivers an approved estimate task adds one record, grouped by the task's class (track and complexity).
// A class with enough records gives a measured p10..p90 duration; a class without falls back to the sized hours
// (a relative size, labelled cold-start). Nothing here is a table of task hours: records are this factory's own runs.
import type { Breakdown, Confidence, Estimate } from "../contracts/index.js";
import { Ledger } from "../ledger/ledger.js";
import { replay, splitKey } from "../ledger/state.js";
import { scoreRun } from "../report.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";
import { confidenceFor, quantile } from "./cost.js";

/** One approved estimate task as the factory built it (steps that delivered it, summed). */
export interface TaskRecord {
  runId: string;
  estimateTaskId: string;
  /** "backend/standard": the approved task's track and complexity */
  taskClass: string;
  stack?: string;
  sizeBand?: string;
  /** what the approved estimate predicted for the task, so predicted and actual sit in one record (Phase 2) */
  kind?: string;
  size?: string;
  hours?: Range;
  catalogue?: string;
  activeMin: number;
  costUsd: number;
  /** model turns, comparable to a tool round in external data */
  turns: number;
  attempts: number;
  outcome: string;
}

export const classOf = (t: { track: string; complexity?: string }): string => `${t.track}/${t.complexity ?? "standard"}`;

/** Records from one build run that followed an approved estimate; none for any other run. */
export function taskRecordsFromRun(ledger: Ledger): TaskRecord[] {
  const state = replay(ledger.events());
  const ref = state.info.estimateRef;
  if (!ref) return [];
  const bd = Ledger.open(ref.runId).getJson<Pick<Breakdown, "tasks">>(ref.breakdownSha);
  const est = Ledger.open(ref.runId).getJson<Pick<Estimate, "band" | "tasks" | "catalogue">>(ref.estimateSha);
  const task = new Map(bd.tasks.map((t) => [t.id, t]));
  const sizing = new Map((est.tasks ?? []).map((t) => [t.taskId, t]));
  const turns = new Map<string, number>();
  for (const e of ledger.events()) if (e.type === "usage" && e.key) { const s = splitKey(e.key).step; turns.set(s, (turns.get(s) ?? 0) + 1); }
  const score = new Map(scoreRun(ledger).steps.map((s) => [s.step, s]));
  const by = new Map<string, TaskRecord>();
  for (const [step, r] of state.steps) {
    const id = r.data?.estimateTaskId;
    const t = typeof id === "string" ? task.get(id) : undefined;
    const sc = score.get(step);
    if (!step.startsWith("implement/") || !t || !sc) continue;
    const prev = by.get(t.id);
    const outcome = r.status === "completed" ? "completed" : "partial";
    const z = sizing.get(t.id);
    by.set(t.id, {
      runId: state.info.runId, estimateTaskId: t.id, taskClass: classOf(t), sizeBand: est.band,
      ...(t.kind ? { kind: t.kind } : {}), ...(z?.size ? { size: z.size } : {}), ...(z ? { hours: z.hours } : {}), ...(est.catalogue ? { catalogue: est.catalogue.version } : {}),
      activeMin: (prev?.activeMin ?? 0) + sc.activeSec / 60, costUsd: (prev?.costUsd ?? 0) + sc.costUsd,
      turns: (prev?.turns ?? 0) + (turns.get(step) ?? 0), attempts: (prev?.attempts ?? 0) + sc.attempts,
      outcome: prev && prev.outcome !== "completed" ? prev.outcome : outcome,
    });
  }
  return [...by.values()];
}

/** Records from every other run in the ledger home. An unreadable run adds nothing. */
export function loadTaskRecords(exceptRun?: string): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const id of Ledger.listRuns()) {
    if (id === exceptRun) continue;
    try { out.push(...taskRecordsFromRun(Ledger.open(id))); } catch { /* an unreadable run adds no record */ }
  }
  return out;
}

export interface ClassBasis { taskClass: string; records: number; confidence: Confidence; minutes?: Range; turnsMedian?: number }
export interface DurationBasis { confidence: Confidence; records: number; byClass: ClassBasis[] }

/** Duration of a class's factory tasks in minutes (p10..p90), or undefined while it has too few records to be measured. */
export function classMinutes(taskClass: string, records: TaskRecord[], a: Assumptions = DEFAULT_ASSUMPTIONS): ClassBasis {
  const rs = records.filter((r) => r.taskClass === taskClass && r.outcome === "completed" && r.activeMin > 0);
  const confidence = confidenceFor(rs.length, a);
  if (rs.length < a.cost.partialFrom) return { taskClass, records: rs.length, confidence };
  const m = rs.map((r) => r.activeMin);
  const t = rs.map((r) => r.turns).filter((n) => n > 0);
  return { taskClass, records: rs.length, confidence, minutes: { min: quantile(m, 0.1), max: quantile(m, 0.9) }, ...(t.length ? { turnsMedian: quantile(t, 0.5) } : {}) };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Duration in hours of each task for the critical path. Human and joint tasks take their sized hours. A factory
 * task takes the class's measured duration when the ledger has enough records for the class, and otherwise its
 * sized hours, which is a relative size and not a measurement (cold-start). The basis says which one was used.
 */
export function taskDurations(
  tasks: Pick<Breakdown["tasks"][number], "id" | "track" | "complexity" | "executor">[], sized: Pick<Estimate["tasks"][number], "taskId" | "hours">[],
  records: TaskRecord[], a: Assumptions = DEFAULT_ASSUMPTIONS,
): { duration: Map<string, Range>; basis?: DurationBasis } {
  const hours = new Map(sized.map((s) => [s.taskId, s.hours]));
  const duration = new Map<string, Range>();
  const classes = new Map<string, ClassBasis>();
  for (const t of tasks) {
    let d = hours.get(t.id)!;
    if (t.executor === "factory") {
      const key = classOf(t);
      if (!classes.has(key)) classes.set(key, classMinutes(key, records, a));
      const m = classes.get(key)!.minutes;
      if (m) d = { min: round(m.min / 60), max: round(m.max / 60) };
    }
    duration.set(t.id, d);
  }
  if (classes.size === 0) return { duration };
  const byClass = [...classes.values()].sort((x, y) => x.taskClass.localeCompare(y.taskClass));
  const order: Confidence[] = ["cold-start", "partial", "calibrated"];
  const weakest = byClass.reduce((w, c) => Math.min(w, order.indexOf(c.confidence)), 2);
  return { duration, basis: { confidence: order[weakest]!, records: byClass.reduce((n, c) => n + c.records, 0), byClass } };
}

/**
 * The factory's own hours on a task, shown beside the human hours (docs/estimates-design.md, "Agent hours"). The work of a
 * solely agentic delivery is the factory's, so every factory and joint task has agent hours: a factory task takes its class's
 * measured duration when this factory's runs have enough of them (the estimate's duration basis), else its sized hours, which
 * are a reference size and not a measurement (cold-start); a joint task takes its sized hours, as on the critical path. A
 * human task has none.
 */
export function agentHours(
  s: Pick<Estimate["tasks"][number], "executor" | "hours">, task: { track: string; complexity?: string }, basis?: Pick<DurationBasis, "byClass">,
): Range {
  if (s.executor === "human") return { min: 0, max: 0 };
  const m = s.executor === "factory" ? basis?.byClass.find((c) => c.taskClass === classOf(task))?.minutes : undefined;
  return m ? { min: round(m.min / 60), max: round(m.max / 60) } : s.hours;
}
