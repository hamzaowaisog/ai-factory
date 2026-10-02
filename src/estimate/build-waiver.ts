// Waivers for the build gates B1, B3, B4 and B6 (docs/estimates-design.md, "During the build"). The step that
// ran the gate asks the lead on a hash-bound waiver card, the same card and `factory waive` as the estimate
// gates. The waiver is bound to the gate ids and a scope (the code commit for B3 and B4, the approved spec
// and tasks for B1 and B6), not to the failure text, so a re-run that fails again the same way is covered
// while a different commit or a different approved scope needs a new decision. B2 is never waived here: a
// changed requirement goes through a change request.
import type { Failure } from "../contracts/index.js";
import type { GateDef } from "../gates/engine.js";
import type { StepContext, StepOutcome } from "../stages/framework.js";
import type { WaiverRow } from "./log.js";

export interface BuildFailed { def: GateDef; failures: Failure[] }
export type BuildWaiver = { kind: "waived"; waivers: Omit<WaiverRow, "step">[] } | { kind: "ask"; outcome: StepOutcome };

/** A waiver the lead already gave for these gates and this scope, or the card that asks for one. */
export function buildWaiver(ctx: StepContext, step: string, failed: BuildFailed[], scope: string, advice: string): BuildWaiver {
  const gateIds = failed.map((f) => f.def.id).sort();
  const bundle = ctx.ledger.putJson({ kind: "build-waiver", step, gateIds, scope });
  const given = ctx.state.decisions.find((d) => d.artifactSha === bundle && d.decision === "waive");
  if (given) {
    const reason = String((given as unknown as { reason?: string }).reason ?? "").trim();
    return { kind: "waived", waivers: [{ gateIds, human: given.by, reason, boundTo: bundle }] };
  }
  const lines = failed.flatMap((f) => f.failures.slice(0, 5).map((x) => `- ${f.def.id}: ${x.message}`));
  const md = [
    `# Waive build gate${failed.length > 1 ? "s" : ""}? (${step})`, ``,
    `Run ${ctx.runId}${ctx.state.info.estimateRef ? " follows an approved estimate and" : ""} these gates fail:`, ``, ...lines, ``,
    `A waiver is recorded with your name and reason. It covers these gates for this ${step === "plan" ? "approved scope" : "commit"} only; a different one needs a new decision.`,
    `To accept it as it stands:`,
    `  factory waive ${ctx.runId} ${bundle.slice(0, 8)} --reason "why this is fine"`,
    advice, ``, `Card hash: ${bundle.slice(0, 8)}`,
  ].join("\n");
  return { kind: "ask", outcome: { kind: "wait", card: { cardId: `waiver-${bundle.slice(0, 8)}`, kind: "waiver", artifactSha: bundle, markdown: md, extra: { gateIds, scope } } } };
}
