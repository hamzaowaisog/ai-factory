// Gate B5 in the run loop (docs/estimates-design.md, "During the build"): a run that follows an approved
// estimate is checked against it before every step. Warn at 80% of the approved maximum, stop at 100%.
// The stop ends the run for a person to decide (a change request, or a new estimate); it is not waived here.
import type { Estimate } from "../contracts/index.js";
import { runGate } from "../gates/engine.js";
import type { Writer } from "../ledger/ledger.js";
import type { Policy } from "../gates/policy.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";
import { BURN_WARN, budgetBurn, burnRatios, type Burn } from "./gates.js";

/**
 * What the run has spent. API credits and elapsed days are measured. Effort hours are human time, which
 * the ledger does not measure yet, so they count as zero here and only the other two can stop a run.
 */
export function spentOf(state: Pick<RunState, "costUsd" | "info">, now = Date.now()): Burn {
  const started = Date.parse(state.info.createdAt);
  return { effortHours: 0, apiUsd: state.costUsd, elapsedDays: Number.isFinite(started) ? Math.max(0, (now - started) / 86_400_000) : 0 };
}

const label: Record<keyof Burn, string> = { effortHours: "effort", apiUsd: "API credit spend", elapsedDays: "elapsed time" };

/** A reason to stop the run, or undefined. A warning is logged once per measure. */
export async function budgetStop(ledger: Ledger, writer: Writer, state: RunState, policy: Policy, log: (m: string) => void, warned: Set<string>): Promise<string | undefined> {
  const ref = state.info.estimateRef;
  if (!ref) return undefined;
  const estimate = ledger.getJson<Estimate>(ref.estimateSha);
  const spent = spentOf(state);
  const ratios = burnRatios(spent, estimate);
  for (const k of Object.keys(ratios) as (keyof Burn)[]) {
    if (ratios[k] >= BURN_WARN && ratios[k] < 1 && !warned.has(k)) {
      warned.add(k);
      log(`budget warning (B5): ${label[k]} is at ${Math.round(ratios[k] * 100)}% of the approved maximum`);
    }
  }
  if (!(Object.values(ratios).some((r) => r >= 1))) return undefined;
  const res = await runGate(budgetBurn, ledger, writer, { spent: ledger.putJson(spent), estimate: ledger.putJson(estimate) }, policy, { step: "budget" });
  return `Approved budget reached (gate B5): ${res.details}. Decide with the lead: a change request (factory estimate --revises ${ref.runId}) or a new estimate, then build that.`;
}
