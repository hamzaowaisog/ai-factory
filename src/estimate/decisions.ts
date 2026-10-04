// Size-pick decision log (docs/estimate-consistency.md, section 11, Phase 2). Each catalogue-sized estimate records
// the picks the estimators made, per task and per question (size step, and for agent work the verify and context
// grades), in the Decider's decision shape (docs/design/contracts.md, section 4): question, choice, backend,
// features, confidence. Features are derived from the breakdown only, never client text, so another backend
// (Jev, or rules) can later be run on the same records and compared with what the build actually took.
// Nothing here changes an estimate: the log is evidence for a later comparison.
import type { Breakdown, Estimate } from "../contracts/index.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Proposal } from "./assemble.js";
import type { TaskReference } from "./references.js";
import { taskRecordsFromRun, type TaskRecord } from "./durations.js";

export type DecisionQuestion = "size" | "verify" | "context";

export interface SizeDecision {
  taskId: string;
  question: DecisionQuestion;
  /** the lead estimator's pick: the one the estimate's hours are built on */
  choice: string;
  backend: "rules" | "jev" | "llm";
  /** derived from the breakdown and the design count; no titles, items text or client words */
  features: Record<string, number | string>;
  /** share of estimators that made the same pick as the lead (agreement, not a calibrated probability) */
  confidence: number;
  /** every estimator's pick, lead first */
  votes: string[];
}

export interface DecisionLog {
  schemaVersion: 1;
  catalogue: string;
  stack: string;
  band: string;
  estimators: number;
  /** a lead's edits applied after the picks; hours of an edited estimate are no longer the picks' alone */
  edits: number;
  decisions: SizeDecision[];
}

type Task = Pick<Breakdown["tasks"][number], "id" | "track" | "kind" | "complexity" | "executor" | "items" | "dependsOn" | "overhead" | "screen">;

/** Features a backend may read for one task: what the breakdown says about it, as categories and counts. */
export function taskFeatures(t: Task, ui: string | undefined, meta: Pick<DecisionLog, "catalogue" | "stack" | "band">): Record<string, number | string> {
  return {
    kind: t.kind ?? "none", track: t.track, complexity: t.complexity, executor: t.executor, ui: ui ?? "none",
    items: t.items.length, dependsOn: t.dependsOn.length, overhead: t.overhead ? 1 : 0, screen: t.screen ? 1 : 0,
    band: meta.band, stack: meta.stack, catalogue: meta.catalogue,
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The decision log of one estimate's proposals. Tasks a proposal did not size against the catalogue add nothing. */
export function sizeDecisions(proposals: Proposal[], tasks: Task[], uiOf: (t: Task) => string | undefined, meta: Pick<DecisionLog, "catalogue" | "stack" | "band"> & { edits?: number }, pastOf: (id: string) => TaskReference[] = () => []): DecisionLog {
  const picks = proposals.map((p) => new Map(p.tasks.map((x) => [x.taskId, x])));
  const decisions: SizeDecision[] = [];
  for (const t of tasks) {
    const past = pastOf(t.id);
    // the references the estimators were shown are inputs too: a backend compared later gets the same ones
    const features = { ...taskFeatures(t, uiOf(t), { catalogue: meta.catalogue, stack: meta.stack, band: meta.band }), pastMatches: past.length, pastSize: past[0]?.size ?? "none" };
    for (const question of ["size", "verify", "context"] as const) {
      const votes = picks.map((m) => m.get(t.id)?.[question]).filter((v): v is NonNullable<typeof v> => !!v);
      if (!votes.length) continue;
      const choice = votes[0]!;
      decisions.push({ taskId: t.id, question, choice, backend: "llm", features, confidence: r2(votes.filter((v) => v === choice).length / votes.length), votes });
    }
  }
  return { schemaVersion: 1, catalogue: meta.catalogue, stack: meta.stack, band: meta.band, estimators: proposals.length, edits: meta.edits ?? 0, decisions };
}

/** One decision paired with what the build of its task took. */
export interface DecisionPair extends SizeDecision {
  estimateRun: string;
  buildRun: string;
  /** the task's sized hours in the approved estimate */
  hours?: { min: number; max: number };
  actual: Pick<TaskRecord, "activeMin" | "turns" | "attempts" | "costUsd" | "outcome">;
}

/** The decision log of the estimate a build followed, or undefined when that estimate was not catalogue-sized. */
export function decisionLogFor(ref: { runId: string; estimateSha: string }): DecisionLog | undefined {
  const ledger = Ledger.open(ref.runId);
  const state = replay(ledger.events());
  // the estimate step may have run again after the approved one (a lead's edit): only the approved run's log counts
  const step = state.steps.get("estimate");
  if (step?.status !== "completed" || step.outputs[0] !== ref.estimateSha) return undefined;
  const sha = (step.data?.named as Record<string, string> | undefined)?.decisions;
  return sha ? ledger.getJson<DecisionLog>(sha) : undefined;
}

/** Every decision paired with its build's actuals, over the runs in the ledger home. An unreadable run adds nothing. */
export function decisionPairs(runIds: string[] = Ledger.listRuns()): DecisionPair[] {
  const out: DecisionPair[] = [];
  for (const id of runIds) {
    try {
      const ledger = Ledger.open(id);
      const ref = replay(ledger.events()).info.estimateRef;
      if (!ref) continue;
      const log = decisionLogFor(ref);
      if (!log) continue;
      const est = Ledger.open(ref.runId).getJson<Pick<Estimate, "tasks">>(ref.estimateSha);
      const hours = new Map(est.tasks.map((t) => [t.taskId, t.hours]));
      for (const r of taskRecordsFromRun(ledger)) {
        for (const d of log.decisions.filter((x) => x.taskId === r.estimateTaskId)) {
          const h = hours.get(d.taskId);
          out.push({ ...d, estimateRun: ref.runId, buildRun: id, ...(h ? { hours: h } : {}), actual: { activeMin: r.activeMin, turns: r.turns, attempts: r.attempts, costUsd: r.costUsd, outcome: r.outcome } });
        }
      }
    } catch { /* an unreadable run adds no pair */ }
  }
  return out;
}

/** A short summary of the pairs: how many, and per question how often the estimators agreed and how long tasks took. */
export function formatPairs(pairs: DecisionPair[]): string {
  if (!pairs.length) return "No finished build has followed a catalogue-sized estimate yet, so there is no size pick to pair with actual time.";
  const lines = [`${pairs.length} decision(s) paired with build actuals, from ${new Set(pairs.map((p) => p.buildRun)).size} build run(s).`];
  const groups = new Map<string, DecisionPair[]>();
  for (const p of pairs) groups.set(`${p.question} ${p.choice}`, [...(groups.get(`${p.question} ${p.choice}`) ?? []), p]);
  for (const [g, ps] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const min = ps.map((p) => p.actual.activeMin).sort((a, b) => a - b);
    const agree = ps.reduce((a, p) => a + p.confidence, 0) / ps.length;
    lines.push(`${g.padEnd(24)} ${String(ps.length).padStart(3)} task(s)  agreement ${Math.round(agree * 100)}%  median ${min[Math.floor(min.length / 2)]!.toFixed(1)} min`);
  }
  return lines.join("\n");
}
