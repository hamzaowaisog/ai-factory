// The design step on the stitch engine (docs/superpowers/plans/2026-10-09-design-tier-ladder.md, Tasks 9 and 10): Claude
// lists the screens and writes a DESIGN.md by following the stitch-design-taste skill; Stitch draws each screen against it.
// Each screenshot is saved as a frame, so the demo, the approval card and the package pictures show it like an attached frame.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Spec } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import { designRoute, ladderAt } from "../config/design-route.js";
import { designMdFaults, DesignMdOut, loadTasteSkill, TASTE_OVERRIDES, type StitchTheme } from "../design/stitch-taste.js";
import { stitchThemeToDesign } from "../design/stitch-theme.js";
import { stitchFacts, type StitchFacts } from "../design/stitch-facts.js";
import { stitchClient, type StitchClient } from "../design/stitch.js";
import { stateKind } from "../design/demo.js";
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

/** What the artifact records as the Stitch model: Stitch's own default (no model id is sent). */
const STITCH_MODEL = "stitch-default";

/** The extra states drawn when a project does not say (each one is one more Stitch generation). */
export const DEFAULT_STITCH_STATES = ["empty", "error"] as const;
const STATE_HINT: Record<string, string> = {
  empty: "no records yet, with a short message and the one action that adds the first",
  error: "the data failed to load, with an inline error message and a retry action",
  loading: "skeleton placeholders where the data will appear",
  success: "a confirmation that the action worked",
  validation: "the form with its required fields flagged and their error messages",
};
const FOLLOW = "\nFollow the project's design system exactly.";

/** What to draw: each screen's normal page, then each state it lists that the project allows (once per kind). */
export function stitchJobs(screens: Plan["screens"], allowed: readonly string[]): { id: string; state: string; prompt: string }[] {
  return screens.flatMap((s) => {
    const kinds = [...new Set(s.states.map(stateKind))].filter((k) => k !== "normal" && allowed.includes(k));
    return [
      { id: s.id, state: "normal", prompt: `${s.prompt}${FOLLOW}` },
      ...kinds.map((k) => ({ id: s.id, state: k, prompt: `${s.prompt}\nShow this same page in its ${k} state: ${STATE_HINT[k]}. Keep the layout, navigation and header identical to the normal page.${FOLLOW}` })),
    ];
  });
}

/** Downloads a generated screen, saves its picture as a frame named by version, and stores its HTML and picture in the ledger. */
async function saveAsset(ctx: StepContext, c: StitchClient, framesDir: string, id: string, state: string, g: { screenId: string; htmlUrl: string; imageUrl: string }): Promise<StitchAsset> {
  const [html, png] = await Promise.all([c.download(g.htmlUrl), c.download(g.imageUrl)]);
  const image = ctx.ledger.putArtifact(png);
  const name = `stitch-${id}-${state}-${image.slice(0, 8)}.png`;
  writeFileSync(join(framesDir, name), png);
  return { id, state, name, screenId: g.screenId, html: ctx.ledger.putArtifact(html), image, ...(state === "normal" ? { facts: stitchFacts(Buffer.from(html).toString("utf8")) } : {}) };
}

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

/** One drawn Stitch screen: a page in its normal state or one of its extra states, with its saved frame file. */
export interface StitchAsset { id: string; state: string; name: string; screenId: string; html: string; image: string; facts?: StitchFacts }
/** `theme` is the Stitch design system's theme; with it the design gets our theme (tokens, the kit's look) and "new" as its look. */
export interface StitchMeta { projectId: string; model: string; designMd: string; theme?: StitchTheme; mood?: string }

/**
 * The design artifact of a Stitch design: the JSON design's shape, with each screen drawn as frames (ST-n) instead of a mock,
 * its normal page first and then its extra states in the order the plan lists them.
 */
export function stitchArtifact(p: Plan, assets: StitchAsset[], meta: StitchMeta, reqIds: string[]) {
  const ordered = p.screens.flatMap((s) => {
    const own = assets.filter((a) => a.id === s.id);
    const rank = (a: StitchAsset) => (a.state === "normal" ? -1 : s.states.findIndex((x) => stateKind(x) === a.state));
    return own.sort((x, y) => rank(x) - rank(y));
  });
  const fid = new Map(ordered.map((a, i) => [a, `ST-${i + 1}`]));
  const onScreen = new Set(p.screens.flatMap((s) => s.reqs));
  return {
    engine: "stitch" as const,
    ...(meta.theme ? { theme: stitchThemeToDesign(meta.theme, meta.mood ?? p.flow), themeSource: "new" as const } : {}),
    flow: p.flow,
    screens: p.screens.map((s) => {
      const own = ordered.filter((a) => a.id === s.id);
      const facts = own.find((a) => a.state === "normal")?.facts;
      return { id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: "new" as const, frames: own.map((a) => fid.get(a)!), ...(facts ? { facts } : {}) };
    }),
    noScreen: p.noScreen,
    mapping: { unmappedReqs: reqIds.filter((r) => !onScreen.has(r) && !p.noScreen.some((n) => n.req === r)), orphanScreens: p.screens.filter((s) => !s.reqs.length).map((s) => s.id) },
    stitch: {
      projectId: meta.projectId, model: meta.model, designMd: meta.designMd, ...(meta.theme ? { theme: meta.theme } : {}),
      frames: Object.fromEntries(ordered.map((a) => [fid.get(a)!, { screen: a.id, state: a.state, name: a.name, screenId: a.screenId, html: a.html, image: a.image }])),
      prompts: Object.fromEntries(p.screens.map((s) => [s.id, s.prompt])),
    },
  };
}

/** The Stitch screenshots a design carries, as frames the approval step reads from attachments/frames. */
export function stitchFrames(design: { stitch?: { frames: Record<string, { name: string }> } }): { id: string; name: string }[] {
  return Object.entries(design.stitch?.frames ?? {}).map(([id, f]) => ({ id, name: f.name }));
}

const failed = (failures: Failure[], tag: string): StepOutcome => ({ kind: "fail", category: "other", failures, signature: `${tag}:${[...new Set(failures.map((f) => f.check))].sort().join(",")}`, gate: true });

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references. */
/** A Stitch design as the design step stored it (with the rework rounds a send-back added). */
export type StitchDesign = ReturnType<typeof stitchArtifact> & { revision?: number; rework?: ReworkRound[] };
interface ReworkRound { round: number; mode: "patch" | "redraw" | "none"; patched: string[]; lines: string[]; kept: string[]; notDesign: { quote: string; why: string }[]; fine: string[] }

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references, and the design sent back. */
export interface StitchInputs { feedback?: string[]; look?: unknown; refs?: unknown; previous?: StitchDesign }

export const StitchTriage = z.object({ redraw: z.boolean(), screens: z.array(z.object({ id: z.string(), change: z.string().min(3) })) });
const TRIAGE_RULES = `The lead sent a Google Stitch design back. Read their reasons against the screens listed.
- Name each screen the reasons ask to change, with the change in one plain sentence Stitch can apply to that screen alone.
- Set "redraw" true when a reason is about the whole look (colours, fonts, density), the flow, or which screens exist; then "screens" may be empty.
- Never name a screen the reasons do not touch.`;

/**
 * A sent-back Stitch design: Stitch edits only the screens the lead named (and redraws their extra states); every other screen
 * keeps its frames, HTML and words. Undefined when the whole design has to be drawn again (the triage says so, or names no screen).
 */
async function reworkStitch(ctx: StepContext, prev: StitchDesign, feedback: string[]): Promise<StepOutcome | undefined> {
  const t = await think(ctx, {
    stage: "design", label: "design rework triage (stitch)", route: "design-triage", cls: "read-small", budgetTokens: 14000, tools: [], schema: StitchTriage, maxTurns: 2,
    sections: [S.template("tpl", TRIAGE_RULES), S.artifact("sent-back", "lead-feedback", feedback), S.artifact("screens", "screens", prev.screens.map((x) => ({ id: x.id, route: x.route, title: x.facts?.title ?? x.id })))],
  });
  if (!t.ok) return t.outcome;
  const named = t.output.screens.filter((x) => prev.screens.some((s) => s.id === x.id));
  if (t.output.redraw || !named.length) { ctx.log("design: the send-back needs the whole Stitch design drawn again"); return undefined; }

  const frames = Object.values(prev.stitch.frames);
  const kept: StitchAsset[] = frames.filter((f) => !named.some((n) => n.id === f.screen)).map((f) => ({
    id: f.screen, state: f.state, name: f.name, screenId: f.screenId, html: f.html, image: f.image,
    ...(f.state === "normal" && prev.screens.find((s) => s.id === f.screen)?.facts ? { facts: prev.screens.find((s) => s.id === f.screen)!.facts! } : {}),
  }));
  const plan: Plan = {
    flow: prev.flow, noScreen: prev.noScreen ?? [], brand: { colours: [], fonts: [] },
    screens: prev.screens.map((s) => ({ id: s.id, title: s.facts?.title ?? s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states ?? [], prompt: prev.stitch.prompts?.[s.id] ?? s.facts?.title ?? s.id })),
  };
  const device = ctx.project.design?.stitch?.device ?? "DESKTOP";
  const allowed = ctx.project.design?.stitch?.states ?? DEFAULT_STITCH_STATES;
  const framesDir = join(ctx.ledger.dir, "attachments", "frames");
  const c = stitchClient();
  let edited: StitchAsset[];
  try {
    mkdirSync(framesDir, { recursive: true });
    ctx.log(`design: Stitch edits ${named.map((n) => n.id).join(", ")}; ${plan.screens.length - named.length} screen(s) kept as approved`);
    edited = (await inPool(named, STITCH_SIDE_BY_SIDE, async (n) => {
      const normal = frames.find((f) => f.screen === n.id && f.state === "normal")!;
      const page = await saveAsset(ctx, c, framesDir, n.id, "normal", await c.edit(prev.stitch.projectId, normal.screenId, `${n.change}${FOLLOW}`, device));
      // its extra states follow the change: drawn again from the screen's prompt with the change added
      const screen = plan.screens.find((s) => s.id === n.id)!;
      const states = stitchJobs([{ ...screen, prompt: `${screen.prompt}
Change: ${n.change}` }], allowed).filter((j) => j.state !== "normal");
      const drawn = await inPool(states, STITCH_SIDE_BY_SIDE, async (j) => saveAsset(ctx, c, framesDir, j.id, j.state, await c.generate(prev.stitch.projectId, j.prompt, device)));
      return [page, ...drawn];
    })).flat();
  } catch (e) {
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const reqIds = plan.screens.flatMap((s) => s.reqs).concat(plan.noScreen.map((n) => n.req));
  const theme = prev.stitch.theme as StitchTheme | undefined;
  const round = (prev.revision ?? 0) + 1;
  const design = {
    ...stitchArtifact(plan, [...kept, ...edited], { projectId: prev.stitch.projectId, model: prev.stitch.model, designMd: prev.stitch.designMd, ...(theme ? { theme, mood: prev.flow } : {}) }, [...new Set(reqIds)]),
    revision: round,
    rework: [...(prev.rework ?? []), { round, mode: "patch" as const, patched: named.map((n) => n.id), lines: named.map((n) => `${n.id}: ${n.change}`), kept: plan.screens.filter((s) => !named.some((n) => n.id === s.id)).map((s) => s.id), notDesign: [], fine: [] }],
    header: header(ctx.runId, "design", "design", "", t.model),
  };
  return { kind: "done", outputs: { design: ctx.ledger.putJson(design) }, data: { screens: plan.screens.length, engine: "stitch", rework: "patch" } };
}

export async function drawWithStitch(ctx: StepContext, spec: Spec, inputs: StitchInputs = {}): Promise<StepOutcome> {
  const at = ladderAt(designRoute(ctx.project), ctx.rung);
  const reqIds = spec.requirements.map((q) => q.id);
  // a sent-back Stitch design: fix only the screens the lead named when that is all they asked
  if (inputs.previous && inputs.feedback?.length) {
    const r = await reworkStitch(ctx, inputs.previous, inputs.feedback);
    if (r) return r;
  }
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
  const allowed = ctx.project.design?.stitch?.states ?? DEFAULT_STITCH_STATES;
  const title = ctx.state.info.estimate?.projectName ?? ctx.runId;
  const framesDir = join(ctx.ledger.dir, "attachments", "frames");
  const c = stitchClient();
  let projectId: string;
  let assets: StitchAsset[];
  try {
    projectId = await c.createProject(title);
    await c.createDesignSystem(projectId, title, { ...m.output.theme, designMd: md });
    ctx.log(`design: Stitch project ${projectId}, drawing ${plan.screens.length} screens with Stitch's default model, ${STITCH_SIDE_BY_SIDE} at a time`);
    mkdirSync(framesDir, { recursive: true });
    const jobs = stitchJobs(plan.screens, allowed);
    if (jobs.length > plan.screens.length) ctx.log(`design: ${jobs.length - plan.screens.length} extra state(s) drawn too (${allowed.join(", ")})`);
    assets = await inPool(jobs, STITCH_SIDE_BY_SIDE, async (j) => saveAsset(ctx, c, framesDir, j.id, j.state, await c.generate(projectId, j.prompt, device)));
  } catch (e) {
    // a Stitch fault is not the model's: park for a person instead of climbing to a dearer tier and paying for every call again
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const design = { ...stitchArtifact(plan, assets, { projectId, model: STITCH_MODEL, designMd: mdSha, theme: m.output.theme, mood: plan.flow }, reqIds), header: header(ctx.runId, "design", "design", "", at.model) };
  return { kind: "done", outputs: { design: ctx.ledger.putJson(design) }, data: { screens: plan.screens.length, engine: "stitch" } };
}
