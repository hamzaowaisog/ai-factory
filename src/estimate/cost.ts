// API credit cost from measured runs (docs/estimates-design.md, "Cost in API credits"). Records come
// from finished steps (via the run scorecard); a phase with no records falls back to a labelled
// cold-start figure and the estimate says so. Nothing here is a pooled table of task hours.
import type { ApiCost, Confidence, DeliveryModel } from "../contracts/index.js";
import type { RunScore } from "../report.js";
import { stageOf } from "../report.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";

export type CostPhase = ApiCost["phases"][number]["phase"];
export const PHASES: CostPhase[] = ["planning", "design", "breakdown-estimate", "build", "verification"];

/** One finished step, reduced to what the cost and duration harness needs. */
export interface BenchmarkRecord {
  runId: string;
  phase: CostPhase;
  stage: string;
  costUsd: number;
  activeSec: number;
  /** work units the step covered (requirements, screens, tasks); 1 when the step is per run */
  units: number;
  outcome: string;
  /** where the record comes from: a run in this factory's ledger home (the default), or a paid eval run published under evidence/ */
  source?: "ledger" | "eval";
  stack?: string;
  sizeBand?: string;
}

const PHASE_OF: Record<string, CostPhase> = {
  discover: "planning", intake: "planning", ground: "planning", clarify: "planning", "clarify-2": "planning",
  drafts: "planning", merge: "planning", specify: "planning", plan: "planning", approve: "planning",
  design: "design", "design-mock": "design",
  breakdown: "breakdown-estimate", estimate: "breakdown-estimate",
  "stub-commit": "build", "author-tests": "build", implement: "build",
  integrate: "verification", accept: "verification", review: "verification", deliver: "verification",
};

/** Turn a run scorecard into benchmark records (one per step, per attempt total). */
export function recordsFromScore(score: RunScore, meta: { stack?: string; sizeBand?: string } = {}): BenchmarkRecord[] {
  const out: BenchmarkRecord[] = [];
  for (const s of score.steps) {
    const phase = PHASE_OF[stageOf(s.step)];
    if (!phase) continue;
    out.push({ runId: score.runId, phase, stage: stageOf(s.step), costUsd: s.costUsd, activeSec: s.activeSec, units: 1, outcome: s.outcome, ...meta });
  }
  return out;
}

/** Linear-interpolated quantile of a sorted or unsorted list. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) throw new Error("quantile of nothing");
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function confidenceFor(records: number, a: Assumptions = DEFAULT_ASSUMPTIONS): Confidence {
  if (records >= a.cost.calibratedFrom) return "calibrated";
  return records >= a.cost.partialFrom ? "partial" : "cold-start";
}

const WEAKEST: Confidence[] = ["cold-start", "partial", "calibrated"];
const usd = (n: number): number => Math.round(n * 100) / 100;

/**
 * Cost per phase, as a range. Units are the phase's work count (e.g. planning: 1 per run; build: the
 * number of factory tasks). Records give p10..p90 dollars per unit; a phase with none uses the assumed
 * cold-start split of the whole-run figure. The solely agentic model scales build and verification.
 */
export function estimateApiCost(
  units: Partial<Record<CostPhase, number>>, records: BenchmarkRecord[], model: DeliveryModel, a: Assumptions = DEFAULT_ASSUMPTIONS,
): ApiCost {
  const phases: ApiCost["phases"] = [];
  let weakest = 2;
  let used = 0;
  for (const phase of PHASES) {
    const n = units[phase] ?? 0;
    if (n <= 0) continue;
    const rs = records.filter((r) => r.phase === phase && r.units > 0);
    let per: Range;
    if (rs.length > 0) {
      const perUnit = rs.map((r) => r.costUsd / r.units);
      per = { min: quantile(perUnit, 0.1), max: quantile(perUnit, 0.9) };
      used += rs.length;
    } else {
      const share = a.cost.coldStartShares[phase];
      per = { min: a.cost.coldStartUsdPerTask.min * share, max: a.cost.coldStartUsdPerTask.max * share };
    }
    const factor = model === "agentic" && (phase === "build" || phase === "verification") ? a.cost.agenticBuildFactor : 1;
    const evals = rs.filter((r) => r.source === "eval").length;
    phases.push({ phase, usd: { min: usd(per.min * n * factor), max: usd(per.max * n * factor) }, basis: { ledger: rs.length - evals, eval: evals } });
    weakest = Math.min(weakest, WEAKEST.indexOf(confidenceFor(rs.length, a)));
  }
  const total = { min: usd(phases.reduce((s, p) => s + p.usd.min, 0)), max: usd(phases.reduce((s, p) => s + p.usd.max, 0)) };
  return { phases, total, confidence: phases.length ? WEAKEST[weakest]! : "cold-start", records: used };
}

/** the phases the factory spends per task; the others (planning, design, breakdown and estimate) are spent once per run */
export const PER_TASK: CostPhase[] = ["build", "verification"];

/**
 * Each task's API cost: its share of the build and verification phases, by its sized hours (the midpoint, so a task's min never
 * passes its max), in whole cents that add up to those phases exactly. Only the tasks the factory builds (factory and joint)
 * have a share; a human task costs nothing. With no hours at all, the tasks share equally.
 */
export function apiCostByTask(cost: Pick<ApiCost, "phases">, tasks: { taskId: string; executor: string; hours: Range }[]): Map<string, Range> {
  const built = tasks.filter((t) => t.executor !== "human");
  const out = new Map<string, Range>(tasks.map((t) => [t.taskId, { min: 0, max: 0 }]));
  if (!built.length) return out;
  const total = (k: "min" | "max") => cost.phases.filter((p) => PER_TASK.includes(p.phase)).reduce((s, p) => s + p.usd[k], 0);
  const weights = built.map((t) => (t.hours.min + t.hours.max) / 2);
  const sum = weights.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? weights.map((w) => w / sum) : built.map(() => 1 / built.length);
  const split = (k: "min" | "max"): number[] => {
    const cents = Math.round(total(k) * 100);
    const raw = shares.map((s) => s * cents);
    const got = raw.map(Math.floor);
    // largest remainder: the leftover cents go to the tasks closest to their next cent
    const order = raw.map((x, i) => [x - got[i]!, i] as const).sort((a, b) => b[0] - a[0]);
    for (let left = cents - got.reduce((s, x) => s + x, 0), j = 0; left > 0; left--, j++) got[order[j % order.length]![1]]!++;
    return got;
  };
  const mins = split("min"), maxs = split("max");
  built.forEach((t, i) => out.set(t.taskId, { min: mins[i]! / 100, max: Math.max(mins[i]!, maxs[i]!) / 100 }));
  return out;
}
