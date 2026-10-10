// The design step on the stitch engine (docs/superpowers/plans/2026-10-09-design-tier-ladder.md, Tasks 9 and 10): Claude
// lists the screens and writes a DESIGN.md by following the stitch-design-taste skill; Stitch draws each screen against it.
// Each screenshot is saved as a frame, so the demo, the approval card and the package pictures show it like an attached frame.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Spec } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import { designRoute, ladderAt } from "../config/design-route.js";
import { designMdFaults, DesignMdOut, loadTasteSkill, TASTE_OVERRIDES, type StitchTheme } from "../design/stitch-taste.js";
import { stitchThemeToDesign } from "../design/stitch-theme.js";
import { stitchFacts, type StitchFacts } from "../design/stitch-facts.js";
import { stitchClient, type StitchClient, type StitchDevice } from "../design/stitch.js";
import { checkStitchA11y } from "../design/stitch-a11y.js";
import { stateKind } from "../design/demo.js";
import { failure } from "../gates/engine.js";
import { currentCostCap } from "../ledger/caps.js";
import { hashJson } from "../util/hash.js";
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

/** Stitch's pictures come about 512 px wide; its image links may take a size (FIFE "=w1600"), which is tried first. */
const LARGE = "=w1600";
/** The largest larger picture kept: the approval demo embeds at most 8 MB of pictures in all (src/design/demo.ts MAX_TOTAL_BYTES), so a
 * screen and its states at this size leave room for the other screens; a bigger one falls back to the picture as Stitch made it. */
const MAX_PICTURE = 600_000;
const isImage = (b: Uint8Array) =>
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
  || (Buffer.from(b.subarray(0, 4)).toString() === "RIFF" && Buffer.from(b.subarray(8, 12)).toString() === "WEBP");

/** The screen's picture, larger when Stitch gives a larger image the demo can still show; otherwise the picture as Stitch made it. */
async function picture(c: StitchClient, url: string): Promise<Uint8Array> {
  try {
    const big = await c.download(`${url}${LARGE}`);
    if (isImage(big) && big.length <= MAX_PICTURE) return big;
  } catch { /* the link takes no size: the picture as Stitch made it */ }
  return c.download(url);
}

/** Every Stitch call is one usage row under this model name: no tokens, the project's price per call. */
export const STITCH_USAGE_MODEL = "stitch";
/** The most Stitch calls one run makes unless the project says otherwise (a 10-screen design with two states each is 30). */
export const DEFAULT_STITCH_MAX_CALLS = 40;

/** The Stitch calls the run has made so far, from its usage rows (earlier steps and attempts included). */
function stitchCallsSoFar(ctx: StepContext): number {
  return ctx.ledger.events().filter((e) => e.type === "usage" && (e.data as Record<string, unknown> | undefined)?.["gen_ai.request.model"] === STITCH_USAGE_MODEL).length;
}

/** Why the run may not make `calls` more Stitch calls, if it may not: past its call limit, or past what is left of its cost limit. */
function stitchBudgetProblem(ctx: StepContext, calls: number): string | undefined {
  const max = ctx.project.design?.stitch?.maxCalls ?? DEFAULT_STITCH_MAX_CALLS, used = stitchCallsSoFar(ctx), usd = ctx.project.design?.stitch?.usdPerCall ?? 0;
  if (used + calls > max) return `This design needs ${calls} Stitch calls (${used} already used this run), past the run's limit of ${max} (design.stitch.maxCalls). Raise the limit or draw fewer screens or states, then resume.`;
  const left = currentCostCap(ctx.state) - ctx.state.costUsd;
  if (usd * calls > left) return `This design's ${calls} Stitch calls cost ${(usd * calls).toFixed(2)}, more than the ${Math.max(0, left).toFixed(2)} left of the run's cost limit. Raise the limit, then resume.`;
  return undefined;
}

/**
 * The Stitch client with every draw and edit counted: a usage row each (so the cost report, the UI and the run's cost limit see
 * Stitch), and the run's call limit held at each call, side-by-side calls included. A call that times out may still have run
 * at Stitch, so it is counted too.
 */
function metered(ctx: StepContext, c: StitchClient): StitchClient {
  const max = ctx.project.design?.stitch?.maxCalls ?? DEFAULT_STITCH_MAX_CALLS, usd = ctx.project.design?.stitch?.usdPerCall ?? 0;
  let used = stitchCallsSoFar(ctx);
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    if (used >= max) throw new Error(`the run's limit of ${max} Stitch calls is reached (design.stitch.maxCalls)`);
    used++;
    const record = () => ctx.usage({ model: STITCH_USAGE_MODEL, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, turns: 1, wallMs: 0, estUsd: usd });
    try { const r = await run(); await record(); return r; } catch (e) {
      if (/timed out/.test((e as Error).message)) await record(); else used--;
      throw e;
    }
  };
  return { ...c, generate: (p, prompt, device) => call(() => c.generate(p, prompt, device)), edit: (p, id, prompt, device) => call(() => c.edit(p, id, prompt, device)) };
}

/**
 * A draw's Stitch progress in the run's folder, so a resume carries on in the same project: one file per run, replaced whole.
 * A finished draw is marked done and never reused: drawing again after it (a send-back, a changed spec) is a new drawing.
 */
interface StitchProgress { key: string; projectId: string; system: boolean; assets: StitchAsset[]; a11y?: { assets: StitchAsset[]; open: A11yOpen[] }; done?: boolean }
const progressFile = (ctx: StepContext) => join(ctx.ledger.dir, "attachments", "stitch-progress.json");
function readProgress(ctx: StepContext, key: string): StitchProgress | undefined {
  try { const p = JSON.parse(readFileSync(progressFile(ctx), "utf8")) as StitchProgress; return p.key === key && !p.done ? p : undefined; } catch { return undefined; }
}
function saveProgress(ctx: StepContext, p: StitchProgress): void {
  const file = progressFile(ctx);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(p));
  renameSync(`${file}.tmp`, file);
}

/** Downloads a generated screen, saves its picture as a frame named by version, and stores its HTML and picture in the ledger. */
async function saveAsset(ctx: StepContext, c: StitchClient, framesDir: string, id: string, state: string, g: { screenId: string; htmlUrl: string; imageUrl: string }): Promise<StitchAsset> {
  const [html, png] = await Promise.all([c.download(g.htmlUrl), picture(c, g.imageUrl)]);
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
export function stitchFrames(design: { stitch?: { frames: Record<string, { name: string; state?: string }> } }): { id: string; name: string; state?: string }[] {
  // each screen's page first: the demo embeds pictures up to a total, and an extra state is the one to go without
  const all = Object.entries(design.stitch?.frames ?? {}).map(([id, f]) => ({ id, name: f.name, ...(f.state ? { state: f.state } : {}) }));
  return [...all.filter((f) => f.state === "normal"), ...all.filter((f) => f.state !== "normal")];
}

const failed = (failures: Failure[], tag: string): StepOutcome => ({ kind: "fail", category: "other", failures, signature: `${tag}:${[...new Set(failures.map((f) => f.check))].sort().join(",")}`, gate: true });

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references. */
/** A Stitch design as the design step stored it (with the rework rounds a send-back added). */
export type StitchDesign = ReturnType<typeof stitchArtifact> & { revision?: number; rework?: ReworkRound[]; stitch: { a11y?: A11yOpen[] } };
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
async function reworkStitch(ctx: StepContext, prev: StitchDesign, feedback: string[], spec: Spec): Promise<StepOutcome | undefined> {
  // the reasons the design already answers (its revision) and the new ones; with no new one this is not a send-back to answer:
  // the step ran again for another reason (a changed spec, new references) and draws again
  const answered = Math.min(prev.revision ?? 0, feedback.length);
  const fresh = feedback.slice(answered);
  if (!fresh.length) return undefined;
  const frames = Object.values(prev.stitch.frames);
  // a design stored before frames named their screen and state, or before prompts were kept, can only be drawn again
  if (!prev.stitch.prompts || frames.some((f) => !f.screen || !f.state)) { ctx.log("design: the earlier Stitch design predates per-screen frames; it is drawn again"); return undefined; }
  const plan: Plan = {
    flow: prev.flow, noScreen: prev.noScreen ?? [], brand: { colours: [], fonts: [] },
    screens: prev.screens.map((s) => ({ id: s.id, title: s.facts?.title ?? s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states ?? [], prompt: prev.stitch.prompts![s.id] ?? s.facts?.title ?? s.id })),
  };
  // the spec may have changed since the design was drawn: screens that no longer cover it are drawn again
  const specReqs = spec.requirements.map((q) => q.id);
  if (planFaults(specReqs, plan).length) { ctx.log("design: the earlier Stitch screens no longer cover the spec; the design is drawn again"); return undefined; }

  const t = await think(ctx, {
    stage: "design", label: "design rework triage (stitch)", route: "design-triage", cls: "read-small", budgetTokens: 14000, tools: [], schema: StitchTriage, maxTurns: 2,
    sections: [S.template("tpl", TRIAGE_RULES), S.artifact("sent-back", "lead-feedback", { reasons: fresh, alreadyAnswered: feedback.slice(0, answered) }), S.artifact("screens", "screens", prev.screens.map((x) => ({ id: x.id, route: x.route, title: x.facts?.title ?? x.id })))],
  });
  if (!t.ok) return t.outcome;
  const named = t.output.screens.filter((x) => prev.screens.some((s) => s.id === x.id));
  const unpaged = named.filter((n) => !frames.some((f) => f.screen === n.id && f.state === "normal"));
  if (t.output.redraw || !named.length || unpaged.length) { ctx.log("design: the send-back needs the whole Stitch design drawn again"); return undefined; }

  const kept: StitchAsset[] = frames.filter((f) => !named.some((n) => n.id === f.screen)).map((f) => ({
    id: f.screen, state: f.state, name: f.name, screenId: f.screenId, html: f.html, image: f.image,
    ...(f.state === "normal" && prev.screens.find((s) => s.id === f.screen)?.facts ? { facts: prev.screens.find((s) => s.id === f.screen)!.facts! } : {}),
  }));
  const device = ctx.project.design?.stitch?.device ?? "DESKTOP";
  const allowed = ctx.project.design?.stitch?.states ?? DEFAULT_STITCH_STATES;
  const framesDir = join(ctx.ledger.dir, "attachments", "frames");
  // each named screen is one edit, and its extra states are drawn again
  const calls = named.reduce((n, x) => n + stitchJobs([plan.screens.find((s) => s.id === x.id)!], allowed).length, 0);
  const over = stitchBudgetProblem(ctx, calls);
  if (over) return { kind: "park", reason: over };
  const c = metered(ctx, stitchClient());
  let edited: StitchAsset[];
  let open: A11yOpen[] = [];
  try {
    mkdirSync(framesDir, { recursive: true });
    ctx.log(`design: Stitch edits ${named.map((n) => n.id).join(", ")}; ${plan.screens.length - named.length} screen(s) kept as approved`);
    edited = (await inPool(named, STITCH_SIDE_BY_SIDE, async (n) => {
      const normal = frames.find((f) => f.screen === n.id && f.state === "normal")!;
      const page = await saveAsset(ctx, c, framesDir, n.id, "normal", await c.edit(prev.stitch.projectId, normal.screenId, `${n.change}${FOLLOW}`, device));
      // its extra states follow the change: drawn again from the screen's prompt with the change added
      const screen = plan.screens.find((s) => s.id === n.id)!;
      const states = stitchJobs([{ ...screen, prompt: `${screen.prompt}\nChange: ${n.change}` }], allowed).filter((j) => j.state !== "normal");
      const drawn = await inPool(states, STITCH_SIDE_BY_SIDE, async (j) => saveAsset(ctx, c, framesDir, j.id, j.state, await c.generate(prev.stitch.projectId, j.prompt, device)));
      return [page, ...drawn];
    })).flat();
    // only the edited screens are checked: an approved screen is never changed for accessibility on a send-back
    const fixed = await fixA11y(ctx, c, framesDir, prev.stitch.projectId, device, edited, named.map((n) => n.id));
    edited = fixed.assets;
    open = [...(prev.stitch.a11y ?? []).filter((x) => !named.some((n) => n.id === x.screen)), ...fixed.open];
  } catch (e) {
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const theme = prev.stitch.theme as StitchTheme | undefined;
  // the revision counts the send-backs answered, as on the JSON track: a rerun with no new one does not rework again
  const round = feedback.length;
  const drawn = stitchArtifact(plan, [...kept, ...edited], { projectId: prev.stitch.projectId, model: prev.stitch.model, designMd: prev.stitch.designMd, ...(theme ? { theme, mood: prev.flow } : {}) }, specReqs);
  const design = {
    ...drawn, stitch: { ...drawn.stitch, ...(open.length ? { a11y: open } : {}) },
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
    const r = await reworkStitch(ctx, inputs.previous, inputs.feedback, spec);
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
  const jobs = stitchJobs(plan.screens, allowed);
  // a resumed run keeps the Stitch project and the screens it already drew, when the plan and design system are the same
  const key = hashJson({ plan, designMd: mdSha, theme: m.output.theme, device, allowed });
  const saved = readProgress(ctx, key);
  const todo = jobs.filter((j) => !saved?.assets.some((a) => a.id === j.id && a.state === j.state));
  const over = stitchBudgetProblem(ctx, todo.length);
  if (over) return { kind: "park", reason: over };
  const c = metered(ctx, stitchClient());
  let progress: StitchProgress;
  let assets: StitchAsset[];
  let open: A11yOpen[] = [];
  try {
    progress = saved ?? { key, projectId: await c.createProject(title), system: false, assets: [] };
    saveProgress(ctx, progress);
    if (!progress.system) {
      await c.createDesignSystem(progress.projectId, title, { ...m.output.theme, designMd: md });
      progress.system = true;
      saveProgress(ctx, progress);
    }
    if (saved) ctx.log(`design: resuming Stitch project ${progress.projectId}: ${saved.assets.length} drawn frame(s) kept, ${todo.length} to draw`);
    else ctx.log(`design: Stitch project ${progress.projectId}, drawing ${plan.screens.length} screens with Stitch's default model, ${STITCH_SIDE_BY_SIDE} at a time`);
    mkdirSync(framesDir, { recursive: true });
    if (jobs.length > plan.screens.length) ctx.log(`design: ${jobs.length - plan.screens.length} extra state(s) drawn too (${allowed.join(", ")})`);
    // after a fault no new screen is started, and the ones under way are waited for and kept: they are paid for
    const faults: Error[] = [];
    await inPool(todo, STITCH_SIDE_BY_SIDE, async (j) => {
      if (faults.length) return;
      try {
        progress.assets.push(await saveAsset(ctx, c, framesDir, j.id, j.state, await c.generate(progress.projectId, j.prompt, device)));
        saveProgress(ctx, progress);
      } catch (e) { faults.push(e as Error); }
    });
    if (faults.length) throw faults[0];
    if (progress.a11y) ({ assets, open } = progress.a11y);
    else {
      ({ assets, open } = await fixA11y(ctx, c, framesDir, progress.projectId, device, progress.assets, progress.assets.map((x) => x.id)));
      progress.a11y = { assets, open };
    }
    saveProgress(ctx, { ...progress, done: true });
  } catch (e) {
    // a Stitch fault is not the model's: park for a person instead of climbing to a dearer tier and paying for every call again
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const projectId = progress.projectId;
  const drawn = stitchArtifact(plan, assets, { projectId, model: STITCH_MODEL, designMd: mdSha, theme: m.output.theme, mood: plan.flow }, reqIds);
  // a whole redraw answers every send-back so far too
  const answered = inputs.feedback?.length ? { revision: inputs.feedback.length, ...(inputs.previous?.rework?.length ? { rework: inputs.previous.rework } : {}) } : {};
  const design = { ...drawn, ...answered, stitch: { ...drawn.stitch, ...(open.length ? { a11y: open } : {}) }, header: header(ctx.runId, "design", "design", "", at.model) };
  return { kind: "done", outputs: { design: ctx.ledger.putJson(design) }, data: { screens: plan.screens.length, engine: "stitch" } };
}

/** The design package's Stitch files: the DESIGN.md and each frame's HTML (screens/<id>.html, screens/<id>-<state>.html); none for a JSON design. */
export function stitchPackageFiles(design: { engine?: string; stitch?: { designMd: string; frames: Record<string, { screen?: string; state?: string; html: string }> } }, getArtifact: (sha: string) => Buffer): { path: string; content: Buffer }[] {
  if (design.engine !== "stitch" || !design.stitch) return [];
  return [
    { path: "screens/DESIGN.md", content: getArtifact(design.stitch.designMd) },
    ...Object.values(design.stitch.frames).filter((f) => f.screen).map((f) => ({
      path: `screens/${f.screen}${!f.state || f.state === "normal" ? "" : `-${f.state}`}.html`, content: getArtifact(f.html),
    })),
  ];
}

/** An accessibility problem Stitch could not fix on a screen: the axe rules still failing. */
export interface A11yOpen { screen: string; rules: string[] }

let a11yCheck: typeof checkStitchA11y = checkStitchA11y;
/** Tests replace the browser check; undefined goes back to axe-core in headless Chromium. */
export function setA11yCheck(f: typeof checkStitchA11y | undefined): void { a11yCheck = f ?? checkStitchA11y; }

/**
 * Checks the normal pages of the given screens, gives each one that fails a single Stitch fix (edit_screens with the rules and
 * elements axe named), and checks the fixed ones again. Returns the assets with the fixed pages in place and what is still open.
 */
async function fixA11y(ctx: StepContext, c: StitchClient, framesDir: string, projectId: string, device: StitchDevice, assets: StitchAsset[], ids: string[]): Promise<{ assets: StitchAsset[]; open: A11yOpen[] }> {
  const normals = assets.filter((a) => a.state === "normal" && ids.includes(a.id));
  const read = (a: StitchAsset) => ({ id: a.id, html: ctx.ledger.getArtifact(a.html).toString("utf8") });
  // a check that cannot run is a note, never a failure: the screens Stitch drew are kept
  const check = async (pages: StitchAsset[]) => {
    try { return await a11yCheck(pages.map(read)); } catch (e) { ctx.log(`design: the accessibility check could not run (${(e as Error).message})`); return undefined; }
  };
  const first = await check(normals);
  if (!first) { ctx.log("design: the Stitch screens' accessibility was not checked (no Chromium or axe-core here)"); return { assets, open: [] }; }
  const bad = first.filter((x) => x.violations.length);
  if (!bad.length) return { assets, open: [] };
  ctx.log(`design: accessibility problems on ${bad.map((b) => b.id).join(", ")}; one Stitch fix each`);
  const rulesOf = (x: { violations: { id: string }[] }) => [...new Set(x.violations.map((v) => v.id))];
  // a fix Stitch cannot make keeps the page as drawn and leaves its rules open
  const tried = await inPool(bad, STITCH_SIDE_BY_SIDE, async (b) => {
    const a = normals.find((x) => x.id === b.id)!;
    const prompt = `Fix these accessibility problems and change nothing else: ${b.violations.map((v) => `${v.id} (${(v.targets ?? []).slice(0, 3).join("; ")})`).join(", ")}.`;
    try { return { b, page: await saveAsset(ctx, c, framesDir, a.id, "normal", await c.edit(projectId, a.screenId, prompt, device)) }; }
    catch (e) { ctx.log(`design: Stitch could not fix ${b.id}'s accessibility (${(e as Error).message}); kept as drawn`); return { b, page: undefined }; }
  });
  const fixed = tried.flatMap((x) => (x.page ? [x.page] : []));
  const notFixed = tried.filter((x) => !x.page).map((x) => ({ screen: x.b.id, rules: rulesOf(x.b) }));
  const again = fixed.length ? (await check(fixed)) ?? [] : [];
  return {
    assets: assets.map((a) => (a.state === "normal" ? fixed.find((f) => f.id === a.id) ?? a : a)),
    open: [...notFixed, ...again.filter((x) => x.violations.length).map((x) => ({ screen: x.id, rules: rulesOf(x) }))],
  };
}
