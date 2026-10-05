// Benchmark records from the ledger (docs/estimates-design.md, "Internal benchmark record"). Every
// finished run adds records automatically: what each phase cost, per unit of work, so the next estimate
// replaces the cold-start figure with a measured range. The paid eval runs published under evidence/ add build and
// verification records too: estimate runs never build, so without them those phases stay cold-start. Nothing here is a
// table of task hours.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger } from "../ledger/ledger.js";
import { scoreRun, stageOf, type RunScore, type StepScore } from "../report.js";
import { PER_TASK, PHASES, type BenchmarkRecord, type CostPhase } from "./cost.js";

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
export function recordsFromRun(score: Pick<RunScore, "runId"> & { steps: Pick<StepScore, "step" | "costUsd" | "activeSec" | "outcome">[] }, meta: { stack?: string; sizeBand?: string } = {}): BenchmarkRecord[] {
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

/** The repo's published runs and eval results (`npm run eval -- publish`). */
export const EVIDENCE_DIR = fileURLToPath(new URL("../../evidence", import.meta.url));

/** A published run row (evidence/runs/<run>/row.json, and each case's "run" in evidence/evals/e2e/*.json). */
interface EvidenceRow { runId: string; kind?: string; outcome: string; steps: { step: string; costUsd: number; minutes: number }[] }

/**
 * Build and verification records from a paid eval run of the factory. Its planning is a ticket's, not a requirements
 * document's, so only the per-task phases count; a run that stopped before verifying adds build only.
 */
export function recordsFromEvidence(row: EvidenceRow): BenchmarkRecord[] {
  if (row.kind !== "factory" || !Array.isArray(row.steps)) return [];
  const outcome = row.outcome === "delivered" ? "completed" : "partial";
  const steps = row.steps.map((s) => ({ step: s.step, costUsd: s.costUsd, activeSec: s.minutes * 60, outcome }));
  return recordsFromRun({ runId: row.runId, steps }).filter((r) => PER_TASK.includes(r.phase)).map((r) => ({ ...r, source: "eval" as const }));
}

/** Every published eval run once (a run sits both in evidence/runs and in its eval result), skipping the given run ids. */
export function loadEvalRecords(dir = EVIDENCE_DIR, skip: Set<string> = new Set()): BenchmarkRecord[] {
  const rows = new Map<string, EvidenceRow>();
  const read = (f: string): unknown => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };
  const add = (r: unknown) => { const x = r as EvidenceRow | undefined; if (x?.runId && !skip.has(x.runId) && !rows.has(x.runId)) rows.set(x.runId, x); };
  const runs = join(dir, "runs");
  if (existsSync(runs)) for (const d of readdirSync(runs)) add(read(join(runs, d, "row.json")));
  const e2e = join(dir, "evals", "e2e");
  if (existsSync(e2e)) for (const f of readdirSync(e2e).filter((x) => x.endsWith(".json"))) { const j = read(join(e2e, f)); if (Array.isArray(j)) for (const c of j) add((c as { run?: unknown }).run); }
  return [...rows.values()].flatMap(recordsFromEvidence);
}

/** Records from every other run in the ledger home, then the published eval runs. A run that cannot be read is skipped, never fatal. */
export function loadBenchmarkRecords(exceptRun?: string, evidenceDir = EVIDENCE_DIR): BenchmarkRecord[] {
  const out: BenchmarkRecord[] = [];
  const ids = Ledger.listRuns();
  for (const id of ids) {
    if (id === exceptRun) continue;
    try { out.push(...recordsFromRun(scoreRun(Ledger.open(id))).map((r) => ({ ...r, source: "ledger" as const }))); } catch { /* an unreadable run adds no record */ }
  }
  return [...out, ...loadEvalRecords(evidenceDir, new Set([...ids, ...(exceptRun ? [exceptRun] : [])]))];
}
