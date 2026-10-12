// The design step on the stitch engine (docs/superpowers/plans/2026-10-09-design-tier-ladder.md, Tasks 9 and 10): Claude
// lists the screens and writes a DESIGN.md by following the stitch-design-taste skill; Stitch draws each screen against it.
// Each screenshot is saved as a frame, so the demo, the approval card and the package pictures show it like an attached frame.
import type { OwnPicture } from "../design/package.js";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Spec } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import { designMdFaults, DesignMdOut, offBlack, FIELD_RULES, loadTasteSkill, moodRules, TASTE_OVERRIDES, type StitchMotion, type StitchTheme } from "../design/stitch-taste.js";
import { stitchTells, type StitchTell } from "../design/stitch-tells.js";
import { stitchThemeToDesign } from "../design/stitch-theme.js";
import { ideaBrief } from "../design/refs/index.js";
import { themeFit } from "../design/refs/fit.js";
import { lookResearch } from "../design/research.js";
import { lookFromRefs, refFit } from "../design/ref-checks.js";
import type { DesignRefsArt } from "./design-refs.js";
import { stitchFacts, type StitchFacts } from "../design/stitch-facts.js";
import { stitchClient, type StitchClient, type StitchDevice } from "../design/stitch.js";
import { checkStitchA11y } from "../design/stitch-a11y.js";
import { buildDemo, frameDataUri, stateKind } from "../design/demo.js";
import { LIVE_DIR, stitchLiveHtml, type LiveScreen } from "../design/stitch-live.js";
import { hasExistingLook, type DesignInventory } from "../design/inventory.js";
import { failure } from "../gates/engine.js";
import { currentCostCap } from "../ledger/caps.js";
import { hashJson } from "../util/hash.js";
import { inPool } from "../util/pool.js";
import { header, type StepContext, type StepOutcome } from "./framework.js";
import { S, think, UNTRUSTED_IMAGE_NOTE } from "./think.js";

export const StitchPlan = z.object({
  flow: z.string(),
  screens: z.array(z.object({
    id: z.string().regex(/^S-\d+$/), title: z.string(), route: z.string().min(1), file: z.string().min(1),
    reqs: z.array(z.string()), states: z.array(z.string()).default([]), prompt: z.string().min(20),
    links: z.array(z.object({ label: z.string().min(1), to: z.string() })).default([]),
  })).min(1),
  noScreen: z.array(z.object({ req: z.string(), reason: z.string() })).default([]),
  brand: z.object({ colours: z.array(z.string()).default([]), fonts: z.array(z.string()).default([]) }).default({ colours: [], fonts: [] }),
});
type Plan = z.infer<typeof StitchPlan>;

const STITCH_PLAN_RULES = `You list the screens of a product for Google Stitch to draw, one prompt per screen.
- One screen per page a user sees: ids S-1, S-2, ..., each with its route, a proposed file path and the requirement ids it serves in "reqs".
- Every requirement is on a screen, or in "noScreen" with the reason it has no page of its own.
- Each "prompt" describes that page alone, in its normal state (its other states are drawn apart, from "states"): its purpose, its sections in order, and real sample content from the product's domain (names, amounts, dates). No lorem ipsum, no generic names, nothing the requirements do not ask for.
- "links" lists every way from this page to another screen: its menu items and the buttons and links that open one, each with the exact words on the control ("label") and the screen id it opens ("to"). A screen has one label, the same on every page that links to it; a button that stays on its page is not listed. The prompt uses those same words for those controls. The pages one kind of user sees share one menu: the same items, labels and order on each of them, and never a page meant for another kind of user.
- Where a page shows something its user knows by sight (a product, a place, a person, a vehicle), the prompt asks for a real photograph of it, with what is in the picture; never an illustration, an icon in its place or a grey box.
- "field-ideas", when given, tells how the leading real products of this field arrange their pages. Where a requirement fits one of their patterns, the prompt asks for that component by what it is and what it holds (a boarding-pass strip with the route set large, a balance in large tabular figures above the latest movements), with this product's own content. Never a product's name, logo or wording, and never a colour from that list: the design system sets the colours.
- "client-references", when given, are the client's own references with their pictures (R-1, R-2, ...). Stitch never sees them, so the prompt says in words what is taken: for a "layout" or "match" reference, the navigation and the regions in the order its picture shows, on the screens it relates to; for an "inspire" reference, its feel (how dense, how much white, how large the pictures and headings). The requirements beat a reference.
- Each prompt composes its page like a finished product, not a wireframe: one thing the eye meets first (named, with its size against the rest), then the sections in the order the user needs them, what sits beside what on a wide screen, and where the page is left empty on purpose. Give real figures, names and dates enough to fill every list and table with believable rows.
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
const FOLLOW_SYSTEM = "\nFollow the project's design system exactly.";
/** The links of a screen that lead to a screen of the plan, each label once. */
export function stitchLinks(s: Pick<Plan["screens"][number], "id" | "links">, ids: ReadonlySet<string>): { label: string; to: string }[] {
  const seen = new Set<string>();
  return (s.links ?? []).filter((l) => { const k = l.label.trim().toLowerCase(); if (!k || l.to === s.id || !ids.has(l.to) || seen.has(k)) return false; seen.add(k); return true; });
}
/** What a screen's prompt says of its links, so Stitch words those controls as the screen list did. */
const labelled = (links: { label: string }[]) => (links.length ? `\nThe controls that open other pages are these, worded exactly: ${links.map((l) => `"${l.label.trim()}"`).join(", ")}. Draw no other menu item, tab or footer link that would open a page.` : "");
/** Stitch otherwise draws a row of switches between a page's states into the page; each state is a drawing of its own. */
const ONE_STATE = "\nDraw this one state only: no tabs, chips or buttons that switch between states or previews.";

/** Stitch draws a still page unless the prompt asks for the motion itself, so each one does, and names the design's two motions. */
const moving = (m: StitchMotion | undefined) => `\nMotion: write the design system's motion tokens and keyframes into a <style> block and use them, in CSS only (no JavaScript): the entrance sequence on load, and a hover, focus and pressed state on every control.${m ? ` The signature motion: ${m.signature.trim()} The one ambient animation: ${m.ambient.trim()}` : ""} Include a prefers-reduced-motion rule.`;

/** What to draw: each screen's normal page, then each state it lists that the project allows (once per kind). */
export function stitchJobs(screens: Plan["screens"], allowed: readonly string[], motion?: StitchMotion): { id: string; state: string; prompt: string }[] {
  const ids = new Set(screens.map((s) => s.id));
  const FOLLOW = `${moving(motion)}${FOLLOW_SYSTEM}`;
  return screens.flatMap((s) => {
    const kinds = [...new Set(s.states.map(stateKind))].filter((k) => k !== "normal" && allowed.includes(k));
    const names = labelled(stitchLinks(s, ids));
    return [
      { id: s.id, state: "normal", prompt: `${s.prompt}${names}\nShow the page in its normal state.${ONE_STATE}${FOLLOW}` },
      ...kinds.map((k) => ({ id: s.id, state: k, prompt: `${s.prompt}${names}\nShow this same page in its ${k} state: ${STATE_HINT[k]}. Keep the layout, navigation and header identical to the normal page.${ONE_STATE}${FOLLOW}` })),
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

/**
 * Why Stitch may not draw this design, if it may not: an app with a look of its own. Stitch draws a new product's screens in a
 * look of its own, and its design is sized, scaffolded and built as new screens; a change to an existing app is drawn on the
 * JSON track, which keeps the app's look and sizes each screen by what changes.
 */
export function stitchOnExistingApp(inv: DesignInventory | undefined): string | undefined {
  return hasExistingLook(inv)
    ? `The stitch design engine draws a new product's screens, but this is an existing app with its own look (${inv.pages.length} page(s) found). Use design.engine claude or openai for changes to an existing app.`
    : undefined;
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
/** The accepted screen list, and the accepted design system for it, kept with the run (see drawWithStitch). */
interface StitchKept { planKey: string; plan: z.infer<typeof StitchPlan>; /** the model that wrote the list */ model: string; sysKey?: string; system?: z.infer<typeof DesignMdOut> }
const keptFile = (ctx: StepContext) => join(ctx.ledger.dir, "attachments", "stitch-plan.json");
function readKept(ctx: StepContext, planKey: string): StitchKept | undefined {
  try { const k = JSON.parse(readFileSync(keptFile(ctx), "utf8")) as StitchKept; return k.planKey === planKey && StitchPlan.safeParse(k.plan).success ? k : undefined; } catch { return undefined; }
}
function saveKept(ctx: StepContext, k: StitchKept): void {
  const file = keptFile(ctx);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(k));
  renameSync(`${file}.tmp`, file);
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
export interface StitchMeta { projectId: string; model: string; designMd: string; theme?: StitchTheme; mood?: string; motion?: StitchMotion; basis?: { ref: string; took: string }[]; departure?: string }

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
    ...(meta.theme ? { theme: { ...stitchThemeToDesign(meta.theme, meta.mood ?? p.flow), ...(meta.basis?.length ? { basis: meta.basis } : {}), ...(meta.departure ? { departure: meta.departure } : {}) }, themeSource: "new" as const } : {}),
    flow: p.flow,
    screens: p.screens.map((s) => {
      const own = ordered.filter((a) => a.id === s.id);
      const facts = own.find((a) => a.state === "normal")?.facts;
      return { id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: "new" as const, frames: own.map((a) => fid.get(a)!), ...(facts ? { facts } : {}) };
    }),
    noScreen: p.noScreen,
    mapping: { unmappedReqs: reqIds.filter((r) => !onScreen.has(r) && !p.noScreen.some((n) => n.req === r)), orphanScreens: p.screens.filter((s) => !s.reqs.length).map((s) => s.id) },
    stitch: {
      projectId: meta.projectId, model: meta.model, designMd: meta.designMd, ...(meta.theme ? { theme: meta.theme } : {}), ...(meta.motion ? { motion: meta.motion } : {}),
      frames: Object.fromEntries(ordered.map((a) => [fid.get(a)!, { screen: a.id, state: a.state, name: a.name, screenId: a.screenId, html: a.html, image: a.image }])),
      prompts: Object.fromEntries(p.screens.map((s) => [s.id, s.prompt])),
      links: Object.fromEntries(p.screens.map((s) => [s.id, stitchLinks(s, new Set(p.screens.map((x) => x.id)))] as const).filter(([, l]) => l.length)),
    },
  };
}

/** The Stitch screenshots a design carries, as frames the approval step reads from attachments/frames. */
export function stitchFrames(design: { stitch?: { frames: Record<string, { name: string; state?: string }> } }): { id: string; name: string; state?: string }[] {
  // each screen's page first: the demo embeds pictures up to a total, and an extra state is the one to go without
  const all = Object.entries(design.stitch?.frames ?? {}).map(([id, f]) => ({ id, name: f.name, ...(f.state ? { state: f.state } : {}) }));
  return [...all.filter((f) => f.state === "normal"), ...all.filter((f) => f.state !== "normal")];
}

/**
 * The Stitch design as far as it is drawn, as the run's preview (Run: Preview in `factory ui`): each drawn frame live with its
 * picture, the screens not drawn yet as wireframes, marked a draft so the page says how far it is. The approval step writes the
 * real preview over it. Best effort: a draft that cannot be written never stops the drawing. Files are swapped in whole.
 */
export function stitchDraftPreview(ctx: Pick<StepContext, "ledger" | "state" | "runId" | "log">, spec: Spec, plan: Plan, assets: StitchAsset[], theme: StitchTheme | undefined, total: number): void {
  try {
    const dir = join(ctx.ledger.dir, "preview");
    mkdirSync(join(dir, LIVE_DIR), { recursive: true });
    const put = (name: string, body: string) => { writeFileSync(join(dir, `${name}.tmp`), body); renameSync(join(dir, `${name}.tmp`), join(dir, name)); };
    const page = (id: string) => assets.find((a) => a.id === id && a.state === "normal");
    const title = (s: Plan["screens"][number]) => page(s.id)?.facts?.title ?? s.title;
    const screens: LiveScreen[] = plan.screens.map((s) => ({ id: s.id, route: s.route, title: title(s), ...(page(s.id)?.facts?.headings ? { headings: page(s.id)!.facts!.headings } : {}), links: stitchLinks(s, new Set(plan.screens.map((x) => x.id))) }));
    // a frame keeps its name while the rest are drawn (the stored design numbers them ST-n only once all are back)
    const fid = (a: StitchAsset) => `${a.id}-${a.state}`;
    const frames: NonNullable<Parameters<typeof buildDemo>[0]["frames"]> = {};
    let embedded = 0;
    // each screen's page first: the demo embeds pictures up to a total, and an extra state is the one to go without
    for (const a of [...assets.filter((x) => x.state === "normal"), ...assets.filter((x) => x.state !== "normal")]) {
      let live: string | undefined;
      try { put(`${LIVE_DIR}/${fid(a)}.html`, stitchLiveHtml(ctx.ledger.getArtifact(a.html).toString("utf8"), a.id, screens)); live = `${LIVE_DIR}/${fid(a)}.html`; } catch { /* its picture alone */ }
      const png = ctx.ledger.getArtifact(a.image);
      const dataUri = frameDataUri(a.name, png, embedded);
      if (dataUri) embedded += png.length;
      frames[fid(a)] = { name: a.name, state: a.state, ...(dataUri ? { dataUri } : {}), ...(live ? { live } : {}) };
    }
    put("index.html", buildDemo({
      title: ctx.state.info.estimate?.projectName ?? ctx.runId, flow: plan.flow,
      screens: plan.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: "new" as const, frames: assets.filter((a) => a.id === s.id).map(fid), ...(page(s.id)?.facts ? { facts: page(s.id)!.facts! } : {}) })),
      requirements: Object.fromEntries(spec.requirements.map((q) => [q.id, q.ears])), noScreen: plan.noScreen, frames,
      ...(theme ? { theme: stitchThemeToDesign(theme, plan.flow) } : {}),
    }));
    put("preview.json", JSON.stringify({
      site: { entry: "index.html", screens: plan.screens.map((s) => ({ path: `index.html#${s.id}`, title: title(s), ...(s.reqs[0] ? { req: s.reqs[0] } : {}), ...(page(s.id) ? {} : { pending: true }) })) },
      images: [], draft: { drawn: assets.length, total, failed: 0 },
    }, null, 2));
  } catch (e) { ctx.log(`design: draft preview not written: ${(e as Error).message}`); }
}

const failed = (failures: Failure[], tag: string): StepOutcome => ({ kind: "fail", category: "other", failures, signature: `${tag}:${[...new Set(failures.map((f) => f.check))].sort().join(",")}`, gate: true });

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references. */
/** A Stitch design as the design step stored it (with the rework rounds a send-back added). */
export type StitchDesign = ReturnType<typeof stitchArtifact> & { revision?: number; rework?: ReworkRound[]; stitch: { a11y?: A11yOpen[]; motion?: StitchMotion } };
interface ReworkRound { round: number; mode: "patch" | "redraw" | "none"; patched: string[]; lines: string[]; kept: string[]; notDesign: { quote: string; why: string }[]; fine: string[] }

/** What the design step knows besides the spec: the lead's send-back reasons, the existing app's look, the client's references, and the design sent back. */
export interface StitchInputs {
  feedback?: string[]; look?: unknown; refs?: unknown; previous?: StitchDesign;
  /** the client's references as the design call of a Claude design gets them: the reading, their words and their pictures (in place of the plain reading) */
  refSections?: Parameters<typeof think>[1]["sections"];
}

/** How the design system uses the client's references (the screen list has its own line in STITCH_PLAN_RULES). */
const STITCH_REF_RULES = `CLIENT REFERENCES. The client attached design references (the "client-references" section, R-1, R-2, ..., with their pictures). They come before the field's products and before the taste rules, each by its role:
- match: use its values exactly: its brand or button colour as "theme.customColor", its fonts, corners and density. Do not "improve" a client's brand.
- inspire: stay in its colour family and feel (its corners, density, surfaces, how much the page breathes); choose your own exact values. When the requirements call for a colour outside that family, return "departure" (beside "theme") with the reason in one sentence.
- layout: take nothing for the look from it; the screen list already took its arrangement.
- Say in section 1 which reference the look came from and what was taken ("R-1: violet primary action, 4 px corners").
- A colour you use from a reference is written exactly as listed in "client-references"; never sample one from a picture.`;

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
    screens: prev.screens.map((s) => ({ id: s.id, title: s.facts?.title ?? s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states ?? [], prompt: prev.stitch.prompts![s.id] ?? s.facts?.title ?? s.id, links: prev.stitch.links?.[s.id] ?? [] })),
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
  const motion = prev.stitch.motion;
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
      const page = await saveAsset(ctx, c, framesDir, n.id, "normal", await c.edit(prev.stitch.projectId, normal.screenId, `${n.change}${FOLLOW_SYSTEM}`, device));
      // its extra states follow the change: drawn again from the screen's prompt with the change added
      const screen = plan.screens.find((s) => s.id === n.id)!;
      const states = stitchJobs([{ ...screen, prompt: `${screen.prompt}\nChange: ${n.change}` }], allowed, motion).filter((j) => j.state !== "normal");
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
  const drawn = stitchArtifact(plan, [...kept, ...edited], { projectId: prev.stitch.projectId, model: prev.stitch.model, designMd: prev.stitch.designMd, ...(theme ? { theme, mood: prev.flow } : {}), ...(motion ? { motion } : {}) }, specReqs);
  const design = {
    ...drawn, stitch: { ...drawn.stitch, ...(open.length ? { a11y: open } : {}) },
    revision: round,
    rework: [...(prev.rework ?? []), { round, mode: "patch" as const, patched: named.map((n) => n.id), lines: named.map((n) => `${n.id}: ${n.change}`), kept: plan.screens.filter((s) => !named.some((n) => n.id === s.id)).map((s) => s.id), notDesign: [], fine: [] }],
    header: header(ctx.runId, "design", "design", "", t.model),
  };
  return { kind: "done", outputs: { design: ctx.ledger.putJson(design) }, data: { screens: plan.screens.length, engine: "stitch", rework: "patch" } };
}

/**
 * A failure of the design system step (its DESIGN.md, its accent against the field's products or the client's references). A retry
 * gives each of the two calls only its own failures, so a rejected design system does not pay for the screen list again: that call's
 * briefing is unchanged and its stored answer is reused.
 */
const ofSystem = (check: string): boolean => /^stitch-designmd-|^design-(off-reference|neon|copied|no-basis|ref-colour|ref-family)$/.test(check);

export async function drawWithStitch(ctx: StepContext, spec: Spec, inputs: StitchInputs = {}): Promise<StepOutcome> {
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
    ...(inputs.refSections?.length ? inputs.refSections : inputs.refs ? [S.artifact("references", "design-references", inputs.refs)] : []),
  ];
  const seen = inputs.refSections?.length ? [S.template("image-note", UNTRUSTED_IMAGE_NOTE)] : [];
  const reqText = spec.requirements.map((q) => q.ears).join("\n");
  // how the field's real products arrange their pages: the screen list takes ideas from them, whatever sets the colours
  const ideas = ideaBrief(reqText);

  // 1. the screens, each with its Stitch prompt. The accepted list is kept with the run: a park while Stitch draws, or a design
  // system sent back by its checks, goes on from it without asking (and paying) for the list again
  const planKey = hashJson({ rules: STITCH_PLAN_RULES, reqs: spec.requirements.map((q) => [q.id, q.ears]), ideas, context: context.map((c) => c.content) });
  const kept = readKept(ctx, planKey);
  let plan: z.infer<typeof StitchPlan>;
  let planner: string;
  if (kept && !ctx.priorFailures.some((f) => !ofSystem(f.check))) {
    plan = kept.plan;
    planner = kept.model;
    ctx.log("design: the screen list is kept as it was accepted (no model call)");
  } else {
    const p = await think({ ...ctx, priorFailures: ctx.priorFailures.filter((f) => !ofSystem(f.check)) }, {
      stage: "design", label: "design screen list (stitch)", route: "design", cls: "read-large", budgetTokens: 60000, tools: [], schema: StitchPlan, maxTurns: 3,
      sections: [S.template("tpl", STITCH_PLAN_RULES), ...seen, S.artifact("reqs", "requirements", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))), ...(ideas ? [S.reference("field-ideas", `How the leading products of this field arrange their pages:\n${ideas}`)] : []), ...context, S.task("List every screen and write one Stitch prompt for each.")],
    });
    if (!p.ok) return p.outcome;
    plan = p.output;
    const listed = planFaults(reqIds, plan);
    if (listed.length) { p.forget?.(); return failed(listed, "stitch-plan"); }
    planner = p.model;
    saveKept(ctx, { planKey, plan, model: planner });
  }

  // a brand colour is the client's only when the requirements or a reference give it. A colour that reached the list another way
  // (an answer to a check question about an off-black made #18181B "the brand" on 12 Oct 2026) would switch the field research off
  const given = Boolean(inputs.refs || inputs.refSections?.length) || /brand\s+(colou?rs?|palette|guidelines?)/i.test(reqText);
  const own = plan.brand.colours.filter((c) => given || reqText.toLowerCase().includes(c.toLowerCase()));
  if (own.length !== plan.brand.colours.length) {
    ctx.log(`design: ${plan.brand.colours.filter((c) => !own.includes(c)).join(", ")} is not a brand colour the requirements or references give, so it does not set the look`);
    plan = { ...plan, brand: { ...plan.brand, colours: own } };
  }

  // 2. the design system, by the stitch-design-taste skill; the client's brand (and the project's brand fonts) win over its taste rules
  const look = moodRules(ctx.project.design?.stitch?.mood);
  // no client brand and no reference that sets the look: it stands on the field's real products, as a design drawn by Claude does.
  // Their live sites are read first (best effort), so the brief and the colour check use the colours they have today.
  const byField = !plan.brand.colours.length && !inputs.look && !lookFromRefs(inputs.refs as never);
  // the same research as a design drawn by Claude or OpenAI (src/design/research.ts)
  const found = byField ? await lookResearch(reqText, { projectName: ctx.state.info.estimate?.projectName, runId: ctx.runId, byField, compare: true, fresh: true, log: ctx.log }) : undefined;
  const fieldRefs = found?.refs;
  const recent = found?.recent ?? [];
  const reading = inputs.refSections?.length ? inputs.refs as DesignRefsArt : undefined;
  if (byField) ctx.log(`design: the look stands on ${fieldRefs!.brands.length ? `${fieldRefs!.labels.join(" / ")} products (${fieldRefs!.brands.slice(0, 6).map((b) => b.name).join(", ")})` : "well-known products of this kind (no listed field matched)"}`);
  const market = byField ? [
    S.template("field-rules", FIELD_RULES),
    S.reference("design-references", `Design references (how real products in this field look):\n${found!.brief}`),
    ...(found!.uiux ? [found!.uiux] : []),
    ...(recent.length ? [S.reference("recent-looks", `The factory's latest other products:\n${recent.map((l, i) => `${i + 1}. ${l.field ? `[${l.field}] ` : ""}${l.brand.toUpperCase()} ${l.mode}, ${l.font} type${l.mood ? ` ("${l.mood}")` : ""}`).join("\n")}`)] : []),
  ] : [];
  const brand = { colours: plan.brand.colours, fonts: [...new Set([...plan.brand.fonts, ...(ctx.project.design?.brandFonts ?? [])])] };
  const sysKey = hashJson({ brand, look });
  let out: z.infer<typeof DesignMdOut>;
  let forget: (() => void) | undefined;
  if (kept?.system && kept.sysKey === sysKey && !ctx.priorFailures.some((f) => ofSystem(f.check))) {
    out = kept.system;
    ctx.log("design: the design system is kept as it was accepted (no model call)");
  } else {
    const m = await think({ ...ctx, priorFailures: ctx.priorFailures.filter((f) => ofSystem(f.check)) }, {
      stage: "design", label: "design system (stitch-design-taste)", route: "design", cls: "read-large", budgetTokens: 40000, tools: [], schema: DesignMdOut, maxTurns: 3,
      sections: [S.template("taste", loadTasteSkill()), S.template("taste-rules", TASTE_OVERRIDES), S.artifact("brand", "brand", brand), ...(look ? [S.template("mood", look)] : []), ...(inputs.refSections?.length ? [S.template("ref-rules", STITCH_REF_RULES), ...seen] : []), ...market, S.artifact("product", "product", { flow: plan.flow, screens: plan.screens.map((s) => s.title) }), ...context, S.task("Write DESIGN.md.")],
    });
    if (!m.ok) return m.outcome;
    out = m.output;
    forget = m.forget;
  }
  const black = offBlack(out.designMd, brand);
  if (black.swapped) ctx.log(`design: pure black in the design system put right to #18181B (${black.swapped} place${black.swapped === 1 ? "" : "s"}, no model call)`);
  const md = black.md;
  const basis = byField || reading ? { ...(out.basis?.length ? { basis: out.basis } : {}), ...(out.departure?.trim() ? { departure: out.departure.trim() } : {}) } : {};
  const mdFaults = [...designMdFaults(md, brand), ...(fieldRefs ? themeFit({ ...stitchThemeToDesign(out.theme, plan.flow), ...basis }, fieldRefs) : []),
    // a client's match reference gives its own colour, an inspire reference its colour family: the checks a Claude design gets, for what a Stitch theme holds
    ...(reading ? refFit({ ...stitchThemeToDesign(out.theme, plan.flow), ...basis }, [], reading.refs.map((r) => ({ id: r.id, use: "used" as const, how: "the design system" })), reading).filter((f) => f.check === "design-ref-colour" || f.check === "design-ref-family") : [])].map((f) => failure(f.check, f.message.replace(/"theme\.basis"/g, '"basis"').replace(/"departure"/g, '"departure" (beside "theme")').replace(/Brand (#[0-9a-fA-F]{6})/g, "The accent (theme.customColor) $1")));
  if (mdFaults.length) { forget?.(); return failed(mdFaults, "stitch-designmd"); }
  saveKept(ctx, { planKey, plan, model: planner, sysKey, system: { ...out, designMd: md } });
  const mdSha = ctx.ledger.putArtifact(md);

  // 3. Stitch: one project, its design system, then each screen
  const device = ctx.project.design?.stitch?.device ?? "DESKTOP";
  const allowed = ctx.project.design?.stitch?.states ?? DEFAULT_STITCH_STATES;
  const title = ctx.state.info.estimate?.projectName ?? ctx.runId;
  const framesDir = join(ctx.ledger.dir, "attachments", "frames");
  const jobs = stitchJobs(plan.screens, allowed, out.motion);
  // a resumed run keeps the Stitch project and the screens it already drew, when the plan and design system are the same
  const key = hashJson({ plan, designMd: mdSha, theme: out.theme, device, allowed, ...(out.motion ? { motion: out.motion } : {}) });
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
      await c.createDesignSystem(progress.projectId, title, { ...out.theme, designMd: md });
      progress.system = true;
      saveProgress(ctx, progress);
    }
    if (saved) ctx.log(`design: resuming Stitch project ${progress.projectId}: ${saved.assets.length} drawn frame(s) kept, ${todo.length} to draw`);
    else ctx.log(`design: Stitch project ${progress.projectId}, drawing ${plan.screens.length} screens with Stitch's default model, ${STITCH_SIDE_BY_SIDE} at a time (Preview shows them as they come)`);
    mkdirSync(framesDir, { recursive: true });
    // the preview fills in as screens come back
    const draft = (drawn: StitchAsset[]) => stitchDraftPreview(ctx, spec, plan, drawn, out.theme, jobs.length);
    draft(progress.assets);
    if (jobs.length > plan.screens.length) ctx.log(`design: ${jobs.length - plan.screens.length} extra state(s) drawn too (${allowed.join(", ")})`);
    // after a fault no new screen is started, and the ones under way are waited for and kept: they are paid for
    const faults: Error[] = [];
    await inPool(todo, STITCH_SIDE_BY_SIDE, async (j) => {
      if (faults.length) return;
      try {
        progress.assets.push(await saveAsset(ctx, c, framesDir, j.id, j.state, await c.generate(progress.projectId, j.prompt, device)));
        saveProgress(ctx, progress);
        draft(progress.assets);
      } catch (e) { faults.push(e as Error); }
    });
    if (faults.length) throw faults[0];
    if (progress.a11y) ({ assets, open } = progress.a11y);
    else {
      ({ assets, open } = await fixA11y(ctx, c, framesDir, progress.projectId, device, progress.assets, progress.assets.map((x) => x.id)));
      progress.a11y = { assets, open };
      // a page Stitch fixed for accessibility replaces the one drawn first
      draft(assets);
    }
    saveProgress(ctx, { ...progress, done: true });
  } catch (e) {
    // a Stitch fault is not the model's: park for a person instead of climbing to a dearer tier and paying for every call again
    return { kind: "park", reason: `Stitch failed: ${(e as Error).message}. Check the Stitch service, its quota and STITCH_API_KEY, then resume.` };
  } finally {
    await c.close().catch(() => undefined);
  }
  const projectId = progress.projectId;
  const drawn = stitchArtifact(plan, assets, { projectId, model: STITCH_MODEL, designMd: mdSha, theme: out.theme, mood: plan.flow, ...(out.motion ? { motion: out.motion } : {}), ...basis }, reqIds);
  // a whole redraw answers every send-back so far too
  const answered = inputs.feedback?.length ? { revision: inputs.feedback.length, ...(inputs.previous?.rework?.length ? { rework: inputs.previous.rework } : {}) } : {};
  const design = { ...drawn, ...answered, stitch: { ...drawn.stitch, ...(open.length ? { a11y: open } : {}) }, header: header(ctx.runId, "design", "design", "", planner) };
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

/** What Stitch drew, for the design package's pictures: each screen and state at full size; none for a JSON design. */
export function stitchPictures(design: { engine?: string; stitch?: { frames: Record<string, { screen?: string; state?: string; image: string }> } }, getArtifact: (sha: string) => Buffer): OwnPicture[] {
  if (design.engine !== "stitch" || !design.stitch) return [];
  return Object.values(design.stitch.frames).filter((f) => f.screen).map((f) => {
    const png = getArtifact(f.image);
    // a narrow picture is taken for a phone page; Stitch's desktop pictures are 1600 wide
    const wide = png.length >= 24 && png.toString("latin1", 12, 16) === "IHDR" ? png.readUInt32BE(16) : 1600;
    return { id: f.screen!, kind: f.state ?? "normal", viewport: wide <= 900 ? "phone" as const : "desktop" as const, png };
  });
}

/** An accessibility problem Stitch could not fix on a screen: the axe rules still failing. */
export interface A11yOpen { screen: string; rules: string[] }

let tellCheck: typeof stitchTells = stitchTells;
/** Tests replace the check for generated-looking and still pages; undefined goes back to the HTML check. */
export function setTellCheck(f: typeof stitchTells | undefined): void { tellCheck = f ?? stitchTells; }

let a11yCheck: typeof checkStitchA11y = checkStitchA11y;
/** Tests replace the browser check; undefined goes back to axe-core in headless Chromium. */
export function setA11yCheck(f: typeof checkStitchA11y | undefined): void { a11yCheck = f ?? checkStitchA11y; }

/**
 * Checks the normal pages of the given screens for accessibility (axe) and for what makes a page look generated or stand still
 * (src/design/stitch-tells.ts), gives each one that fails a single Stitch fix for both (edit_screens with the rules and elements
 * axe named and the tells to change), and checks the fixed ones again. Returns the assets with the fixed pages in place and the
 * accessibility rules still open; a tell still there is said in the log.
 */
async function fixA11y(ctx: StepContext, c: StitchClient, framesDir: string, projectId: string, device: StitchDevice, assets: StitchAsset[], ids: string[]): Promise<{ assets: StitchAsset[]; open: A11yOpen[] }> {
  const normals = assets.filter((a) => a.state === "normal" && ids.includes(a.id));
  const read = (a: StitchAsset) => ({ id: a.id, html: ctx.ledger.getArtifact(a.html).toString("utf8") });
  // a check that cannot run is a note, never a failure: the screens Stitch drew are kept
  const check = async (pages: StitchAsset[]) => {
    try { return await a11yCheck(pages.map(read)); } catch (e) { ctx.log(`design: the accessibility check could not run (${(e as Error).message})`); return undefined; }
  };
  const first = await check(normals);
  if (!first) ctx.log("design: the Stitch screens' accessibility was not checked (no Chromium or axe-core here)");
  // a page is paid a fix for a tell that shows; one that only lacks a reduced-motion rule gets it when it is fixed anyway
  const tellsOf = (a: StitchAsset): StitchTell[] => { try { return tellCheck(read(a).html); } catch { return []; } };
  const bad = normals.map((a) => ({ id: a.id, violations: first?.find((x) => x.id === a.id)?.violations ?? [], tells: tellsOf(a) })).filter((b) => b.violations.length || b.tells.some((t) => !t.soft));
  if (!bad.length) return { assets, open: [] };
  const named = (pick: (b: (typeof bad)[number]) => boolean) => bad.filter(pick).map((b) => b.id).join(", ");
  if (bad.some((b) => b.violations.length)) ctx.log(`design: accessibility problems on ${named((b) => b.violations.length > 0)}; one Stitch fix each`);
  if (bad.some((b) => b.tells.some((t) => !t.soft))) ctx.log(`design: ${named((b) => b.tells.some((t) => !t.soft))} look generated or stand still (${[...new Set(bad.flatMap((b) => b.tells.filter((t) => !t.soft).map((t) => t.id)))].join(", ")}); one Stitch fix each`);
  const rulesOf = (x: { violations: { id: string }[] }) => [...new Set(x.violations.map((v) => v.id))];
  // a fix Stitch cannot make keeps the page as drawn and leaves its rules open
  const tried = await inPool(bad, STITCH_SIDE_BY_SIDE, async (b) => {
    const a = normals.find((x) => x.id === b.id)!;
    const a11y = b.violations.length ? `Fix these accessibility problems and change nothing else: ${b.violations.map((v) => `${v.id} (${(v.targets ?? []).slice(0, 3).join("; ")})`).join(", ")}.` : "";
    const look = b.tells.length ? `${a11y ? " Also" : "Change this and nothing else:"} ${b.tells.map((t) => t.fix).join("; ")}.` : "";
    const prompt = `${a11y}${look}`;
    try { return { b, page: await saveAsset(ctx, c, framesDir, a.id, "normal", await c.edit(projectId, a.screenId, prompt, device)) }; }
    catch (e) { ctx.log(`design: Stitch could not fix ${b.id}'s accessibility (${(e as Error).message}); kept as drawn`); return { b, page: undefined }; }
  });
  const fixed = tried.flatMap((x) => (x.page ? [x.page] : []));
  const notFixed = tried.filter((x) => !x.page && x.b.violations.length).map((x) => ({ screen: x.b.id, rules: rulesOf(x.b) }));
  const again = fixed.length && first ? (await check(fixed)) ?? [] : [];
  const still = fixed.map((p) => ({ id: p.id, tells: tellsOf(p).filter((t) => !t.soft).map((t) => t.id) })).filter((x) => x.tells.length);
  if (still.length) ctx.log(`design: still there after Stitch's fix: ${still.map((x) => `${x.id} (${x.tells.join(", ")})`).join("; ")}; kept as drawn`);
  return {
    assets: assets.map((a) => (a.state === "normal" ? fixed.find((f) => f.id === a.id) ?? a : a)),
    open: [...notFixed, ...again.filter((x) => x.violations.length).map((x) => ({ screen: x.id, rules: rulesOf(x) }))],
  };
}
