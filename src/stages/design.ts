// Estimate mode's design step (docs/estimates-design.md, "Design baseline"). For a request with UI it
// proposes the screen inventory the estimate stands on: a flow, every screen with its route and the
// requirements it serves, and a reason for each requirement that needs no screen. Code checks the links
// both ways. It is an inventory of screens, not a rendered mock: a person approves it at E1b, and it
// becomes the count of screens, flows and reused components for the UI work.
import { z } from "zod";
import type { IntentBody, Spec } from "../contracts/index.js";
import type { DesignInventory } from "../design/inventory.js";
import { failure } from "../gates/engine.js";
import { header, readOutput, requireOutput, type StepDef } from "./framework.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

type Intent = z.infer<typeof IntentBody>;

export const DesignOut = z.object({
  flow: z.string().min(1),
  screens: z.array(z.object({
    id: z.string(), route: z.string().min(1), file: z.string().min(1), reqs: z.array(z.string()),
    states: z.array(z.string()).default([]),
    /** new screen, a tweak of an existing one, a design-system change, or reuse of existing components */
    size: z.enum(["new", "tweak", "design-system", "reuse"]).default("new"),
  })).min(1),
  /** requirements that need no screen (an API rule, a job) and why */
  noScreen: z.array(z.object({ req: z.string(), reason: z.string().min(1) })).default([]),
});

const RULES = `You are drawing the screen inventory of a UI request, for an estimate. The approved inventory is what the estimate counts.
- List every screen a user sees: id S-1, S-2, ..., its route, a proposed file path, the requirement ids it serves in "reqs", its states (empty, loading, error, success, validation) and its size:
  new (a screen that does not exist), tweak (a change to an existing screen), design-system (a new shared component or theme change), reuse (built only from existing components).
- Every requirement that has anything a user sees or does goes on at least one screen. A requirement with no screen at all (an API rule, a scheduled job) goes in "noScreen" with the reason. Nothing may be left out.
- "flow": two or three sentences on how a user moves between the screens.
- Use only requirement ids that exist. Do not invent screens the requirements do not need.
- If an existing-system summary is given, mark a screen "reuse" or "tweak" only when an existing page or shared component really covers it.
${UNTRUSTED_NOTE}`;

/** Code's view of the links: which requirements no screen serves, and which screens serve none. */
export function mapDesign(reqIds: string[], out: z.infer<typeof DesignOut>): { unmappedReqs: string[]; orphanScreens: string[]; unknown: string[] } {
  const known = new Set(reqIds);
  const served = new Set(out.screens.flatMap((s) => s.reqs));
  const exempt = new Set(out.noScreen.map((n) => n.req));
  return {
    unmappedReqs: reqIds.filter((r) => !served.has(r) && !exempt.has(r)),
    orphanScreens: out.screens.filter((s) => s.reqs.length === 0).map((s) => s.id),
    unknown: [...new Set([...out.screens.flatMap((s) => s.reqs), ...out.noScreen.map((n) => n.req)].filter((r) => !known.has(r)))],
  };
}

const inventoryBrief = (inv: DesignInventory) => ({
  framework: inv.stack.framework, styling: inv.stack.styling, componentSystem: inv.stack.componentSystem,
  pages: inv.pages.slice(0, 40), sharedComponents: [...inv.primitives, ...inv.composites].slice(0, 40).map((c) => (c as { name?: string }).name ?? c),
});

export const designStep: StepDef = {
  key: "design", stage: "design", templateVersion: "1",
  inputs: (s, l) => {
    if (s.steps.get("specify")?.status !== "completed" || s.steps.get("intake")?.status !== "completed") return undefined;
    const ui = !!l.getJson<Intent>(s.steps.get("intake")!.outputs[0]!)?.touchesUi;
    return { spec: s.steps.get("specify")!.outputs[0], ui, inventory: s.steps.get("ground")?.data?.named };
  },
  async run(ctx) {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    // no UI: nothing to draw; E1b passes on the intent alone
    if (!intent.touchesUi) return { kind: "done", outputs: { design: ctx.ledger.putJson({ header: header(ctx.runId, "design", "design", ""), skipped: true, reason: "no UI in this request" }) }, data: { skipped: true } };
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const inv = readOutput<DesignInventory>(ctx.state, ctx.ledger, "ground", "design");
    const r = await think(ctx, {
      stage: "design", route: "design", cls: "read-large", budgetTokens: 30000, tools: [], schema: DesignOut, maxTurns: 4,
      sections: [
        S.template("tpl", RULES),
        S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
        ...(inv ? [S.artifact("existing", "existing-ui", inventoryBrief(inv))] : []),
        S.task("Draw the screen inventory."),
      ],
    });
    if (!r.ok) return r.outcome;
    const map = mapDesign(spec.requirements.map((q) => q.id), r.output);
    const bad = [
      ...map.unknown.map((x) => failure("design-unknown-req", `${x} is not a requirement in the spec`)),
      ...map.unmappedReqs.map((x) => failure("design-unmapped", `${x} is on no screen and not listed under noScreen`)),
      ...map.orphanScreens.map((x) => failure("design-orphan", `screen ${x} serves no requirement`)),
    ];
    if (bad.length) return { kind: "fail", category: "other", failures: bad, signature: `design:${bad.map((f) => f.check).sort().join(",")}` };
    const artifact = {
      header: header(ctx.runId, "design", "design", "", r.model), flow: r.output.flow,
      screens: r.output.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: s.size })),
      mapping: { unmappedReqs: [], orphanScreens: [] }, noScreen: r.output.noScreen,
    };
    return { kind: "done", outputs: { design: ctx.ledger.putJson(artifact) }, data: { screens: artifact.screens.length, states: artifact.screens.reduce((n, s) => n + Math.max(1, s.states.length), 0) } };
  },
};
