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

/**
 * Brownfield's ground step: the normal grounding, plus the repo's design inventory (named output
 * "design") when the run draws its own design, so the design step follows the app's look as in an
 * estimate. Same key, version and inputs as groundStep; a run with no UI, or one built from an
 * approved estimate or design, gets exactly what it got before. A run whose ground step completed
 * before this kept an inventory is not grounded again: the design steps read the inventory from its
 * snapshot instead (repoInventory).
 */
export const brownfieldGroundStep: StepDef = {
  ...groundStep,
  async run(ctx: StepContext): Promise<StepOutcome> {
    const out = await groundStep.run(ctx);
    if (out.kind !== "done" || ctx.state.info.estimateRef || ctx.state.info.designRef) return out;
    if (!requireOutput<Intent>(ctx.state, ctx.ledger, "intake").touchesUi) return out;
    return { ...out, outputs: { ...out.outputs, design: ctx.ledger.putJson(buildInventory(dirSource(snapshotFor(ctx).root))) } };
  },
};

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

/**
 * A new product built into an empty repo (greenfield) whose approved design run has no ground output of its own: what exists is
 * nothing, as for a run with no repo, stated without a model call (the empty repo has nothing to read).
 */
export const newProductGroundStep: StepDef = {
  ...groundStep,
  async run(ctx: StepContext): Promise<StepOutcome> {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const cb = ctx.ledger.putJson({ header: header(ctx.runId, "current-behaviour", "ground", ""), ...newBuildBehaviour(intent) });
    return { kind: "done", outputs: { cb }, data: { repo: false, newProduct: true } };
  },
};
