// Benchmark records from the ledger (docs/estimates-design.md, "Internal benchmark record"). Every
// finished run adds records automatically: what each phase cost, per unit of work, so the next estimate
// replaces the cold-start figure with a measured range. Nothing here is a table of task hours.
import { Ledger } from "../ledger/ledger.js";
import { scoreRun, stageOf, type RunScore } from "../report.js";
import { PHASES, type BenchmarkRecord, type CostPhase } from "./cost.js";

const PHASE_OF: Record<string, CostPhase> = {
  discover: "planning", intake: "planning", ground: "planning", clarify: "planning", "clarify-2": "planning",
  drafts: "planning", merge: "planning", specify: "planning", plan: "planning", approve: "planning",
  "design-baseline": "design", design: "design", "design-mock": "design",
  breakdown: "breakdown-estimate", estimate: "breakdown-estimate",
  "stub-commit": "build", "author-tests": "build", implement: "build",
  integrate: "verification", accept: "verification", review: "verification", deliver: "verification",
};

/**
 * One record per phase per run. Planning, design and breakdown/estimate are per run (1 unit); build and
 * verification are per factory task, so they divide the run's spend by its number of implement steps and
 * are skipped for a run that built nothing. A phase that cost nothing adds no record.
 */
export function recordsFromRun(score: RunScore, meta: { stack?: string; sizeBand?: string } = {}): BenchmarkRecord[] {
  const tasks = new Set(score.steps.filter((s) => stageOf(s.step) === "implement").map((s) => s.step)).size;
  const out: BenchmarkRecord[] = [];
  for (const phase of PHASES) {
    const steps = score.steps.filter((s) => PHASE_OF[stageOf(s.step)] === phase);
    const costUsd = steps.reduce((n, s) => n + s.costUsd, 0);
    const activeSec = steps.reduce((n, s) => n + s.activeSec, 0);
    const perTask = phase === "build" || phase === "verification";
    if (costUsd <= 0 || (perTask && tasks === 0)) continue;
    out.push({
      runId: score.runId, phase, stage: phase, costUsd, activeSec, units: perTask ? tasks : 1,
      outcome: steps.every((s) => s.outcome === "completed") ? "completed" : "partial", ...meta,
    });
  }
  return out;
}

/** Records from every other run in the ledger home. A run that cannot be read is skipped, never fatal. */
export function loadBenchmarkRecords(exceptRun?: string): BenchmarkRecord[] {
  const out: BenchmarkRecord[] = [];
  for (const id of Ledger.listRuns()) {
    if (id === exceptRun) continue;
    try { out.push(...recordsFromRun(scoreRun(Ledger.open(id)))); } catch { /* an unreadable run adds no record */ }
  }
  return out;
}
