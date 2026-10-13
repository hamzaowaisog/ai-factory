// A guided run's two extra stops (src/stages/framework.ts, guided): what the factory understood, before the spec is written,
// and the spec, before the design and the plan. Each is a card a person accepts or sends back once; neither calls a model.
import type { Intent, Spec } from "../contracts/index.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { requirementSummary, riskLines, spendLine, understoodLines, withSummary } from "./card-summary.js";
import { planRejections, readOutput, requireOutput, SPEC_CARD, specRejections, UNDERSTOOD_CARD, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { criticLines, requirementLines } from "./spec.js";

const clarOf = (ctx: StepContext) => clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));
const decisionOn = (ctx: StepContext, sha: string) => [...ctx.state.decisions].reverse().find((d) => d.artifactSha === sha);

/**
 * "What I understood": the request point by point, the answers and the assumptions. The person says it is right, or writes what
 * is wrong; either way the run goes on, and a correction is handed to the spec writers (framework.ts, correction). Nothing is
 * run again: no spec exists yet.
 */
export const understoodStep: StepDef = {
  key: "understood", stage: "approve", templateVersion: "1",
  inputs: (s) => (s.steps.get("clarify-2")?.status === "completed"
    ? { intent: s.steps.get("intake")!.outputs[0], c1: s.steps.get("clarify")!.outputs[0], c2: s.steps.get("clarify-2")!.outputs[0] } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const bundle = ctx.ledger.putJson({ card: "understood", ...understoodStep.inputs(ctx.state, ctx.ledger) });
    const decision = decisionOn(ctx, bundle);
    if (decision) return { kind: "done", outputs: { understood: ctx.ledger.putJson({ bundle, by: decision.by, decision: decision.decision }) } };
    const md = [
      `# What I understood`,
      ``,
      `Run ${ctx.runId}. Nothing is written yet. Check that this is what you meant; a correction now costs nothing.`,
      ``,
      ...understoodLines(requireOutput<Intent>(ctx.state, ctx.ledger, "intake").spans, clarOf(ctx)),
      ``,
      `## Decide`,
      `  factory approve ${ctx.runId} <hash>                              (this is right)`,
      `  factory reject  ${ctx.runId} <hash> --reason "what is wrong"     (go on with this correction; you are not asked again)`,
      ``,
      `Card hash: ${bundle.slice(0, 8)}`,
    ].join("\n");
    return { kind: "wait", card: { cardId: `${UNDERSTOOD_CARD}${bundle.slice(0, 8)}`, kind: "understood", artifactSha: bundle, markdown: md } };
  },
};

/**
 * The spec, before anything is drawn or planned from it. Sent back with a reason, the spec step revises it (as it does for a
 * rejected plan) and the card returns; a second send-back parks the run. Once the plan card has been rejected the spec is
 * reviewed there, with its plan, so this card is not shown again.
 */
export const specReviewStep: StepDef = {
  key: "spec-review", stage: "approve", templateVersion: "1",
  inputs: (s) => (s.steps.get("specify")?.status === "completed"
    ? { spec: s.steps.get("specify")!.outputs[0], round: specRejections(s).length, ...(planRejections(s).length ? { afterPlan: true } : {}) } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const specSha = ctx.state.steps.get("specify")!.outputs[0]!;
    if (planRejections(ctx.state).length) return { kind: "done", outputs: { specApproval: ctx.ledger.putJson({ spec: specSha, auto: true, reason: "revised for a rejected plan: reviewed on the plan card" }) } };
    // the round is part of the card's identity: a card sent back never comes back unchanged
    const bundle = ctx.ledger.putJson({ card: "spec-review", spec: specSha, round: specRejections(ctx.state).length });
    const decision = decisionOn(ctx, bundle);
    if (decision?.decision === "approve") return { kind: "done", outputs: { specApproval: ctx.ledger.putJson({ spec: specSha, auto: false, by: decision.by, bundle }) } };
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const rec = ctx.state.steps.get("specify")!;
    const open = (rec.data?.openFindings as string[] | undefined) ?? [];
    const modules = (rec.data?.modules as string[] | undefined)?.length ?? 0;
    const risks = riskLines(open, [], clarOf(ctx));
    const technical = [
      `## Requirements`,
      ...requirementLines(spec),
      ``,
      `## Critic findings`,
      ...criticLines(requireOutput(ctx.state, ctx.ledger, "specify", "critic")),
      ``,
      `## Decide`,
      `  factory approve ${ctx.runId} <hash>`,
      `  factory reject  ${ctx.runId} <hash> --reason "what to change"     (the spec is revised once and shown again${modules > 1 ? `; all ${modules} parts of the request are revised` : ""})`,
      ``,
      `Card hash: ${bundle.slice(0, 8)}`,
    ].join("\n");
    const md = withSummary([
      `# The spec: what will be built`,
      ``,
      `Run ${ctx.runId}. Nothing is drawn or planned yet. ${spendLine(ctx.state)}`,
      ``,
      ...requirementSummary(spec, (rec.data?.apiSide as string[] | undefined) ?? []),
      ...(risks.length ? [``, ...risks] : []),
    ], technical);
    return { kind: "wait", card: { cardId: `${SPEC_CARD}${bundle.slice(0, 8)}`, kind: "spec-review", artifactSha: bundle, markdown: md } };
  },
};
