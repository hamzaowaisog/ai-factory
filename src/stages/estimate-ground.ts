// Estimate mode's ground step (docs/estimates-design.md, "Prerequisites" 1 and 2). It keeps the key
// "ground" so clarify and the spec pipeline read it unchanged, and always produces a current-behaviour
// artifact. A requirements-only run has no repo: every span is new build work, stated without a model
// call. An existing repo gets the normal grounding step, plus a stack-agnostic survey and, for UI work,
// the design inventory, both stored as named outputs for breakdown to read.
import type { z } from "zod";
import { CurrentBehaviourBody, IntentBody } from "../contracts/index.js";
import { buildInventory } from "../design/inventory.js";
import { dirSource } from "../design/source.js";
import { surveyRepo, surveyText } from "../context/survey.js";
import { hashJson } from "../util/hash.js";
import { header, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { groundStep } from "./spec.js";
import { snapshotFor } from "./workspace.js";

type Intent = z.infer<typeof IntentBody>;

export const hasRepo = (state: { info: { repoPath?: string; baseCommit?: string } }): boolean => !!state.info.repoPath && !!state.info.baseCommit;

/** What a run with no repo knows about today's behaviour: nothing exists, so every span is new. */
export function newBuildBehaviour(intent: Pick<Intent, "spans">): z.infer<typeof CurrentBehaviourBody> {
  return { claims: [], notFound: intent.spans.map((s) => ({ span: s.id, searched: ["no repository: this is new build work"] })) };
}

export const estimateGroundStep: StepDef = {
  ...groundStep,
  inputs: (s, l) => {
    const base = groundStep.inputs(s, l);
    return base ? { ...base, repo: hasRepo(s) } : undefined;
  },
  async run(ctx: StepContext): Promise<StepOutcome> {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    if (!hasRepo(ctx.state)) {
      const cb = ctx.ledger.putJson({ header: header(ctx.runId, "current-behaviour", "ground", ""), ...newBuildBehaviour(intent) });
      return { kind: "done", outputs: { cb }, data: { repo: false } };
    }
    const out = await groundStep.run(ctx);
    if (out.kind !== "done") return out;
    const snap = snapshotFor(ctx);
    const survey = surveyRepo(snap, ctx.state.info.repoPath);
    const named: Record<string, string> = { ...out.outputs, survey: ctx.ledger.putJson(survey) };
    if (intent.touchesUi) named.design = ctx.ledger.putJson(buildInventory(dirSource(snap.root)));
    ctx.log(`survey: ${surveyText(survey).split("\n")[0]}`);
    return { ...out, outputs: named, data: { ...(out.data ?? {}), repo: true, surveyHash: hashJson(survey).slice(0, 12) } };
  },
};
