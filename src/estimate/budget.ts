// Gate B5 in the run loop (docs/estimates-design.md, "During the build"): a run that follows an approved
// estimate is checked against it before every step. Warn at 80% of the approved maximum, stop at 100%.
// The stop opens a hash-bound card: a lead can let the run go on to a higher ceiling (`factory waive-budget`, recorded
// with name and reason), or stop and revise the estimate.
import type { Estimate } from "../contracts/index.js";
import { runGate } from "../gates/engine.js";
import type { Writer } from "../ledger/ledger.js";
import type { Policy } from "../gates/policy.js";
import type { Ledger } from "../ledger/ledger.js";
import type { LedgerEvent } from "../contracts/index.js";
import { hashJson } from "../util/hash.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";
import { MAX_BUDGET_CEILING, type RunState } from "../ledger/state.js";
import { BURN_WARN, budgetBurn, burnRatios, type Burn } from "./gates.js";

const mid = (r: Range): number => (r.min + r.max) / 2;

/**
 * Human effort this run has used, in hours, counted from the ledger: each recorded human decision costs the
 * midpoint of the assumed gate time (docs/estimates-design.md, "Human hours in the workflow"). Answered
 * clarify questions count one each, waiver, limit and budget cards the waiver time, and every other card
 * (approvals, design) one approval section, which makes this a lower bound for long cards. PR review comes
 * after the run and is not counted. The figures are the editable assumptions, so this is "assumed", not timed.
 */
export function effortHoursOf(events: LedgerEvent[], a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  const kinds = new Map<string, string>();
  let minutes = 0;
  for (const e of events) {
    const d = e.data as { cardId?: string; kind?: string; answers?: Record<string, unknown> };
    if (e.type === "human.requested" && d.cardId) kinds.set(d.cardId, String(d.kind ?? ""));
    if (e.type !== "human.decided" || !d.cardId) continue;
    const kind = kinds.get(d.cardId) ?? "";
    if (/question|clarif/.test(kind)) minutes += mid(a.gates.clarifyMinutesPerQuestion) * Math.max(1, Object.keys(d.answers ?? {}).length);
    else if (/waiver|cap|budget/.test(kind)) minutes += mid(a.gates.waiverMinutes);
    else minutes += mid(a.gates.approvalMinutesPerSection);
  }
  return Math.round((minutes / 60) * 100) / 100;
}

/** What the run has spent: API credits and elapsed days as measured, effort hours as counted above. */
export function spentOf(state: Pick<RunState, "costUsd" | "info">, now = Date.now(), events: LedgerEvent[] = []): Burn {
  const started = Date.parse(state.info.createdAt);
  return { effortHours: effortHoursOf(events), apiUsd: state.costUsd, elapsedDays: Number.isFinite(started) ? Math.max(0, (now - started) / 86_400_000) : 0 };
}

const label: Record<keyof Burn, string> = { effortHours: "effort", apiUsd: "API credit spend", elapsedDays: "elapsed time" };

/** Each waiver lets the run go this much further past the approved maximum (a share of it). */
export const BUDGET_STEP = 0.25;

export interface BudgetCard { cardId: string; artifactSha: string; markdown: string; reason: string; ceiling: number; proposed: number }

/**
 * A card asking the lead what to do, or undefined. A warning is logged once per measure and ceiling.
 * Reaching the ceiling (the approved maximum, or the last waiver's higher one) records gate B5 as failed.
 */
export async function budgetStop(ledger: Ledger, writer: Writer, state: RunState, policy: Policy, log: (m: string) => void, warned: Set<string>): Promise<BudgetCard | undefined> {
  const ref = state.info.estimateRef;
  if (!ref) return undefined;
  const estimate = ledger.getJson<Estimate>(ref.estimateSha);
  const spent = spentOf(state, Date.now(), ledger.events());
  const ratios = burnRatios(spent, estimate);
  const ceiling = state.budgetCeiling;
  for (const k of Object.keys(ratios) as (keyof Burn)[]) {
    const key = `${k}@${ceiling}`;
    if (ratios[k] >= BURN_WARN * ceiling && ratios[k] < ceiling && !warned.has(key)) {
      warned.add(key);
      log(`budget warning (B5): ${label[k]} is at ${Math.round(ratios[k] * 100)}% of the approved maximum${ceiling > 1 ? ` (limit raised to ${Math.round(ceiling * 100)}%)` : ""}`);
    }
  }
  if (!(Object.values(ratios).some((r) => r >= ceiling))) return undefined;
  const res = await runGate(budgetBurn, ledger, writer, { spent: ledger.putJson(spent), estimate: ledger.putJson(estimate), limit: ledger.putJson({ ceiling }) }, policy, { step: "budget" });
  const reason = `Approved budget reached (gate B5): ${res.details}`;
  const proposed = Math.min(MAX_BUDGET_CEILING, Math.round((ceiling + BUDGET_STEP) * 100) / 100);
  const atMax = ceiling >= MAX_BUDGET_CEILING;
  const artifactSha = hashJson({ kind: "budget", ceiling, seq: state.lastSeq });
  const cardId = `budget-${artifactSha.slice(0, 8)}`;
  const markdown = [
    `# Budget reached: ${reason.replace("Approved budget reached (gate B5): ", "")}`, ``,
    `Run ${state.info.runId} follows the approved estimate from run ${ref.runId}. Spent: $${spent.apiUsd.toFixed(2)} API credits, ${spent.elapsedDays.toFixed(1)} days elapsed, ${spent.effortHours.toFixed(1)} h of counted human gate effort (assumed times).`, ``,
    ...(atMax ? [
      `The limit is already ${MAX_BUDGET_CEILING * 100}% of the approved maximum, the most a waiver allows: the estimate is wrong for this work.`,
      `Revise it with a change request (factory estimate --revises ${ref.runId}), start a new estimate, or factory stop.`, ``,
    ] : [
      `To let the run continue up to ${Math.round(proposed * 100)}% of the approved maximum (recorded with your name and reason):`,
      `  factory waive-budget ${state.info.runId} ${artifactSha.slice(0, 8)} --reason "why more is acceptable"`,
      `(--ceiling <n> sets a different limit, as a multiple of the approved maximum, above the current one and at most ${MAX_BUDGET_CEILING})`,
      `Or decide it is a different scope: a change request (factory estimate --revises ${ref.runId}), a new estimate, or factory stop.`, ``,
    ]),
    `Card hash: ${artifactSha.slice(0, 8)}`,
  ].join("\n");
  return { cardId, artifactSha, markdown, reason, ceiling, proposed };
}
