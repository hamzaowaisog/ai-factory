// The design step on the stitch engine (docs/superpowers/plans/2026-10-09-design-tier-ladder.md, Tasks 9 and 10): Claude
// lists the screens and writes a DESIGN.md by following the stitch-design-taste skill; Stitch draws each screen against it.
// Each screenshot is saved as a frame, so the demo, the approval card and the package pictures show it like an attached frame.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Spec } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import { designRoute, ladderAt } from "../config/design-route.js";
import { designMdFaults, DesignMdOut, loadTasteSkill, TASTE_OVERRIDES } from "../design/stitch-taste.js";
import { stitchClient } from "../design/stitch.js";
import { failure } from "../gates/engine.js";
import { inPool } from "../util/pool.js";
import { header, type StepContext, type StepOutcome } from "./framework.js";
import { S, think } from "./think.js";

export const StitchPlan = z.object({
  flow: z.string(),
  screens: z.array(z.object({
    id: z.string().regex(/^S-\d+$/), title: z.string(), route: z.string().min(1), file: z.string().min(1),
    reqs: z.array(z.string()), states: z.array(z.string()).default([]), prompt: z.string().min(20),
  })).min(1),
  noScreen: z.array(z.object({ req: z.string(), reason: z.string() })).default([]),
  brand: z.object({ colours: z.array(z.string()).default([]), fonts: z.array(z.string()).default([]) }).default({ colours: [], fonts: [] }),
});
type Plan = z.infer<typeof StitchPlan>;

const STITCH_PLAN_RULES = `You list the screens of a product for Google Stitch to draw, one prompt per screen.
- One screen per page a user sees: ids S-1, S-2, ..., each with its route, a proposed file path and the requirement ids it serves in "reqs".
- Every requirement is on a screen, or in "noScreen" with the reason it has no page of its own.
- Each "prompt" describes that page alone: its purpose, its sections in order, and real sample content from the product's domain (names, amounts, dates). No lorem ipsum, no generic names, nothing the requirements do not ask for.
- "states" lists the page's extra states besides its normal page (empty, loading, error, success, validation) only where the requirements need them.
- "brand" lists the client's colours (hex) and fonts only when the requirements or references name them; otherwise leave it empty.`;

/** Concurrent Stitch generations: each takes a while, and the account's quota is unknown. */
const STITCH_SIDE_BY_SIDE = 3;

/** The plan's own coverage faults: a requirement with no screen, a screen with no requirement, ids or routes used twice. */
function planFaults(reqIds: string[], p: Plan): Failure[] {
  const onScreen = new Set([...p.screens.flatMap((s) => s.reqs), ...p.noScreen.map((n) => n.req)]);
  const dup = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
  return [
    ...reqIds.filter((r) => !onScreen.has(r)).map((r) => failure("design-unmapped", `${r} is on no screen; put it on a screen or in noScreen with the reason`)),
    ...p.screens.filter((s) => !s.reqs.some((r) => reqIds.includes(r))).map((s) => failure("design-orphan", `${s.id} serves no requirement; drop it or name the requirements it serves`)),
    ...dup(p.screens.map((s) => s.id)).map((x) => failure("design-duplicate-id", `two screens share the id ${x}`)),
    ...dup(p.screens.map((s) => s.route.trim().toLowerCase().replace(/\/+$/, "") || "/")).map((x) => failure("design-duplicate-route", `two screens share the route ${x}`)),
  ];
}

export interface StitchAsset { id: string; screenId: string; html: string; image: string }
export interface StitchMeta { projectId: string; model: string; designMd: string }

/** The design artifact of a Stitch design: the JSON design's shape, with each screen drawn as a frame (ST-n) instead of a mock. */
export function stitchArtifact(p: Plan, assets: StitchAsset[], meta: StitchMeta, reqIds: string[]) {
  const frameOf = new Map(assets.map((a, i) => [a.id, `ST-${i + 1}`]));
  const onScreen = new Set(p.screens.flatMap((s) => s.reqs));
  return {
    engine: "stitch" as const,
    flow: p.flow,
    screens: p.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: "new" as const, frames: frameOf.has(s.id) ? [frameOf.get(s.id)!] : [] })),
    noScreen: p.noScreen,
    mapping: { unmappedReqs: reqIds.filter((r) => !onScreen.has(r) && !p.noScreen.some((n) => n.req === r)), orphanScreens: p.screens.filter((s) => !s.reqs.length).map((s) => s.id) },
    stitch: { ...meta, frames: Object.fromEntries(assets.map((a) => [frameOf.get(a.id)!, { name: `stitch-${a.id}.png`, screenId: a.screenId, html: a.html, image: a.image }])) },
  };
}

/** The Stitch screenshots a design carries, as frames the approval step reads from attachments/frames. */
export function stitchFrames(design: { stitch?: { frames: Record<string, { name: string }> } }): { id: string; name: string }[] {
  return Object.entries(design.stitch?.frames ?? {}).map(([id, f]) => ({ id, name: f.name }));
}

const failed = (failures: Failure[], tag: string): StepOutcome => ({ kind: "fail", category: "other", failures, signature: `${tag}:${[...new Set(failures.map((f) => f.check))].sort().join(",")}`, gate: true });

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references. */
export interface StitchInputs { feedback?: string[]; look?: unknown; refs?: unknown }

export async function drawWithStitch(ctx: StepContext, spec: Spec, inputs: StitchInputs = {}): Promise<StepOutcome> {
  const at = ladderAt(designRoute(ctx.project), ctx.rung);
  const reqIds = spec.requirements.map((q) => q.id);
  // both calls read these, so a sent-back design changes what the lead asked and the client's look and references come first
  const context = [
    ...(inputs.feedback?.length ? [S.artifact("sent-back", "lead-feedback", { note: "The lead sent the previous design back. Change what they asked; keep the rest.", reasons: inputs.feedback })] : []),
    ...(inputs.look ? [S.artifact("existing-look", "existing-look", inputs.look)] : []),
    ...(inputs.refs ? [S.artifact("references", "design-references", inputs.refs)] : []),
  ];

  // 1. the screens, each with its Stitch prompt
  const p = await think(ctx, {
    stage: "design", label: "design screen list (stitch)", route: "design", cls: "read-large", budgetTokens: 60000, tools: [], schema: StitchPlan, maxTurns: 3,
    sections: [S.template("tpl", STITCH_PLAN_RULES), S.artifact("reqs", "requirements", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))), ...context, S.task("List every screen and write one Stitch prompt for each.")],
  });
  if (!p.ok) return p.outcome;
  const plan = p.output;
  const listed = planFaults(reqIds, plan);
  if (listed.length) { p.forget?.(); return failed(listed, "stitch-plan"); }

  // 2. the design system, by the stitch-design-taste skill; the client's brand (and the project's brand fonts) win over its taste rules
  const brand = { colours: plan.brand.colours, fonts: [...new Set([...plan.brand.fonts, ...(ctx.project.design?.brandFonts ?? [])])] };
  const m = await think(ctx, {
    stage: "design", label: "design system (stitch-design-taste)", route: "design", cls: "read-large", budgetTokens: 40000, tools: [], schema: DesignMdOut, maxTurns: 3,
    sections: [S.template("taste", loadTasteSkill()), S.template("taste-rules", TASTE_OVERRIDES), S.artifact("brand", "brand", brand), S.artifact("product", "product", { flow: plan.flow, screens: plan.screens.map((s) => s.title) }), ...context, S.task("Write DESIGN.md.")],
  });
  if (!m.ok) return m.outcome;
  const md = m.output.designMd;
  const mdFaults = designMdFaults(md, brand).map((f) => failure(f.check, f.message));
  if (mdFaults.length) { m.forget?.(); return failed(mdFaults, "stitch-designmd"); }
  const mdSha = ctx.ledger.putArtifact(md);

  // 3. Stitch: one project, its design system, then each screen
  const device = ctx.project.design?.stitch?.device ?? "DESKTOP";
  const title = ctx.state.info.estimate?.projectName ?? ctx.runId;
  const framesDir = join(ctx.ledger.dir, "attachments", "frames");
  const c = stitchClient();
  let projectId: string;
  let assets: StitchAsset[];
  try {
    projectId = await c.createProject(title);
    await c.createDesignSystem(projectId, title, md);
    ctx.log(`design: Stitch project ${projectId}, drawing ${plan.screens.length} screens with ${at.stitch}, ${STITCH_SIDE_BY_SIDE} at a time`);
    mkdirSync(framesDir, { recursive: true });
    assets = await inPool(plan.screens, STITCH_SIDE_BY_SIDE, async (s) => {
      const g = await c.generate(projectId, `${s.prompt}\nFollow the project's design system exactly.`, device, at.stitch!);
      const [html, png] = await Promise.all([c.download(g.htmlUrl), c.download(g.imageUrl)]);
      writeFileSync(join(framesDir, `stitch-${s.id}.png`), png);
      return { id: s.id, screenId: g.screenId, html: ctx.ledger.putArtifact(html), image: ctx.ledger.putArtifact(png) };
    });
  } catch (e) {
    // a Stitch fault is not the model's: park for a person instead of climbing to a dearer tier and paying for every call again
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const design = { ...stitchArtifact(plan, assets, { projectId, model: at.stitch!, designMd: mdSha }, reqIds), header: header(ctx.runId, "design", "design", "", at.model) };
  return { kind: "done", outputs: { design: ctx.ledger.putJson(design) }, data: { screens: plan.screens.length, engine: "stitch" } };
}
