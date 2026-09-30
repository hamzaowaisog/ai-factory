// The gate and waiver log of an estimate run (docs/estimates-design.md, "Gates"): what each estimate
// gate decided and which failures a lead waived, read back from the ledger so the approval card and the
// team workbook show the same facts.
import type { LedgerEvent } from "../contracts/index.js";
import type { RunState } from "../ledger/state.js";

export interface GateLogRow { gateId: string; passed: boolean; details: string; step?: string }
export interface WaiverRow { step: string; gateIds: string[]; human: string; reason: string; boundTo: string }

/** The latest result of each estimate gate (E1-E7), in the order first seen. */
export function gateLog(events: LedgerEvent[]): GateLogRow[] {
  const rows = new Map<string, GateLogRow>();
  for (const e of events) {
    if (e.type !== "gate.result") continue;
    const d = e.data as { gateId?: string; passed?: boolean; details?: string; step?: string };
    if (!d.gateId?.startsWith("estimate.")) continue;
    rows.set(d.gateId, { gateId: d.gateId, passed: !!d.passed, details: String(d.details ?? ""), ...(d.step ? { step: d.step } : {}) });
  }
  return [...rows.values()];
}

/** Waivers a lead gave, recorded by the step that offered them. */
export function waiversOf(state: Pick<RunState, "steps">): WaiverRow[] {
  const out: WaiverRow[] = [];
  for (const [step, rec] of state.steps) {
    if (rec.status !== "completed") continue;
    const w = rec.data?.waivers as Omit<WaiverRow, "step">[] | undefined;
    for (const x of w ?? []) out.push({ step, ...x });
  }
  return out;
}

export const gateLine = (g: GateLogRow): string => `${g.passed ? "passed" : "FAILED"} ${g.gateId}: ${g.details}`;
