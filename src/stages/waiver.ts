// Waivers for estimate gates (docs/estimates-design.md, "Gates": E3, E4 and E5 are waivable by a lead).
// A step that fails only waivable gates, after it has already retried once with the failures fed back,
// asks the lead in a terminal instead of failing again. The decision is bound to the exact failures: a
// different failure is a different card, and a waiver never carries over to it.
import type { Failure } from "../contracts/index.js";
import type { GateDef } from "../gates/engine.js";
import type { WaiverRow } from "../estimate/log.js";
import type { StepContext, StepOutcome } from "./framework.js";

/** Attempts before a waiver is offered: the model gets one retry with the failures fed back first. */
export const WAIVER_AFTER_ATTEMPT = 2;

export interface Failed { def: GateDef; failures: Failure[] }

export type WaiverResult = { kind: "ask"; outcome: StepOutcome } | { kind: "none" };

export type Pending = { cacheKey: string; payload: unknown };

/**
 * Whether these failures can be waived at all, and if so the card. The model's output is stored with the
 * card so that the waiver applies to exactly what the lead saw; the step does not call the model again.
 */
export function waiverFor(ctx: StepContext, step: string, failed: Failed[], pending: Pending): WaiverResult {
  if (!failed.length || failed.some((f) => f.def.waiver !== "human") || ctx.attempt < WAIVER_AFTER_ATTEMPT) return { kind: "none" };
  const lines = failed.flatMap((f) => f.failures.map((x) => `- ${f.def.id}: ${x.message}`));
  const pendingSha = ctx.ledger.putJson(pending.payload);
  const gateIds = failed.map((f) => f.def.id);
  const bundle = ctx.ledger.putJson({ step, pendingSha, gateIds, failures: failed.flatMap((f) => f.failures.map((x) => `${x.check}:${x.message}`)) });
  const md = [
    `# Waive estimate gate${failed.length > 1 ? "s" : ""}? (${step})`, ``,
    `Run ${ctx.runId}. The step ran ${ctx.attempt - 1} time${ctx.attempt > 2 ? "s" : ""} and these gates still fail:`, ``, ...lines, ``,
    `A waiver is recorded with your name and reason and shown on the approval card and in the team workbook.`,
    `To accept the estimate as it stands:`,
    `  factory waive ${ctx.runId} ${bundle.slice(0, 8)} --reason "why this is fine"`,
    `To stop and change the request instead: factory stop ${ctx.runId}`, ``, `Card hash: ${bundle.slice(0, 8)}`,
  ].join("\n");
  return { kind: "ask", outcome: { kind: "wait", card: { cardId: `waiver-${bundle.slice(0, 8)}`, kind: "waiver", artifactSha: bundle, markdown: md, extra: { cacheKey: pending.cacheKey, pendingSha, gateIds } } } };
}

/** A waiver the lead already gave for this step and these exact inputs: the stored output and who waived what. */
export function waivedCache<T>(ctx: StepContext, step: string, cacheKey: string): { payload: T; waivers: Omit<WaiverRow, "step">[] } | undefined {
  const ev = [...ctx.ledger.events()].reverse().find((e) => {
    const d = e.data as { kind?: string; step?: string; cacheKey?: string };
    return e.type === "human.requested" && d.kind === "waiver" && d.step === step && d.cacheKey === cacheKey;
  });
  if (!ev) return undefined;
  const d = ev.data as { artifactSha: string; pendingSha: string; gateIds: string[] };
  const dec = ctx.state.decisions.find((x) => x.artifactSha === d.artifactSha && x.decision === "waive");
  const payload = dec ? ctx.ledger.getJson<T>(d.pendingSha) : undefined;
  if (!dec || payload === undefined) return undefined;
  return { payload, waivers: [{ gateIds: d.gateIds, human: dec.by, reason: String((dec as unknown as { reason?: string }).reason ?? "").trim(), boundTo: d.artifactSha }] };
}

export const waivedNote = (w: Omit<WaiverRow, "step">[]): string => w.map((x) => `waived ${x.gateIds.join(", ")} (${x.human}: ${x.reason})`).join("; ");
