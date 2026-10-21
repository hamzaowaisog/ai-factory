// The link between the approved design and the build (docs/estimates-design.md, "Design baseline"). The estimate counts
// screens; this makes the build deliver the ones that were approved: the plan task that builds a screen must be allowed
// to touch the screen's file (gate B7), and the implementer is shown the approved screen (route, states, sample content,
// the look: the new product's theme, or "use the existing app's tokens and components", and its languages).
import type { Breakdown } from "../contracts/index.js";
import type { DesignLocale, DesignTheme } from "../contracts/artifacts.js";
import { localeBrief } from "./locale.js";
import { designTokens } from "./tokens.js";
import { matchesAny } from "../util/glob.js";
import { load } from "cheerio";
import { stitchPhotos } from "./stitch-photos.js";

import type { StitchFacts } from "./stitch-facts.js";
export interface ApprovedScreen { id: string; route: string; file: string; reqs: string[]; states?: string[]; size?: string; mock?: unknown; frames?: string[]; change?: string; facts?: StitchFacts; user?: string }
export interface ApprovedDesign { skipped?: boolean; flow?: string; screens: ApprovedScreen[]; theme?: unknown; themeSource?: "new" | "repo"; locale?: unknown; note?: boolean }

/** The approved screen an estimate task builds, if any. */
export function screenFor(breakdown: Pick<Breakdown, "tasks">, design: ApprovedDesign | undefined, estimateTaskId: string | undefined): ApprovedScreen | undefined {
  if (!design || design.skipped || !estimateTaskId) return undefined;
  const id = breakdown.tasks.find((t) => t.id === estimateTaskId)?.screen;
  return id ? design.screens.find((s) => s.id === id) : undefined;
}

/**
 * The approved screens a plan task builds, whatever led to the build (an estimate, --from-design, a scaffold or none): the
 * estimate task's screen first, then the screens whose page files are in the task's scope (narrowed to the ones sharing the
 * task's requirements when that leaves any), then the screens sharing its requirements. A task that is no screen's gets none.
 * A task over several pages (a shared layout, a broad glob, a flow) gets each of them (the PR #11 re-review, item 5).
 */
export function screensForTask(design: ApprovedDesign | undefined, task: { fileScope: string[]; reqs?: string[] }, estimated?: ApprovedScreen): ApprovedScreen[] {
  if (estimated) return [estimated];
  if (!design || design.skipped) return [];
  const sharesReq = (s: ApprovedScreen) => s.reqs.some((r) => task.reqs?.includes(r));
  const byFile = design.screens.filter((s) => s.file && matchesAny(s.file, task.fileScope));
  if (byFile.length > 1) { const narrowed = byFile.filter(sharesReq); return narrowed.length ? narrowed : byFile; }
  if (byFile.length === 1) return byFile;
  return design.screens.filter(sharesReq);
}

/** The one approved screen a plan task builds, or undefined when it builds none or several (see screensForTask). */
export function screenForTask(design: ApprovedDesign | undefined, task: { fileScope: string[]; reqs?: string[] }, estimated?: ApprovedScreen): ApprovedScreen | undefined {
  const all = screensForTask(design, task, estimated);
  return all.length === 1 ? all[0] : undefined;
}

/** Most screens one task's brief carries in full; the rest are named, so the brief stays small. */
export const MAX_BRIEF_SCREENS = 4;

/** The brief for a task over several approved screens: each one's brief, up to MAX_BRIEF_SCREENS, and the others by name. */
export function screensBrief(design: ApprovedDesign, screens: ApprovedScreen[]): Record<string, unknown> {
  const shown = screens.slice(0, MAX_BRIEF_SCREENS);
  const rest = screens.slice(MAX_BRIEF_SCREENS);
  return {
    note: `This task builds ${screens.length} approved screens; each one's route, states, sample content and look follow.${rest.length ? " The others are named only: read the approved design for them if you change them." : ""}`,
    screens: shown.map((s) => screenBrief(design, s)),
    ...(rest.length ? { others: rest.map((s) => ({ screen: s.id, route: s.route, file: s.file })) } : {}),
  };
}

/** How the implementer uses the tokens. */
export const TOKENS_NOTE = "These are the approved look's design tokens: the exact values the approved demo was drawn with. If the app has no such variables yet and its global stylesheet is in your file scope, add the `css` block there once; then style with the variables (var(--color-brand), var(--radius), ...) or, where variables cannot reach, these values. Do not invent other colours, fonts, corners or shadows. When there is a light and a dark set, the app follows the viewer's setting, and a light/dark switch (where the app has a settings menu or top bar) sets data-theme=\"light\" or \"dark\" on the root element.";

/** The approved look's tokens, or undefined when the look is the repo's or the theme cannot be read. */
export function approvedTokens(design: ApprovedDesign): ReturnType<typeof designTokens> | undefined {
  if (design.themeSource === "repo" || !design.theme || typeof design.theme !== "object") return undefined;
  try { return designTokens(design.theme as DesignTheme); } catch { return undefined; }
}

/** How the implementer uses an approved Stitch screen (its HTML follows in an untrusted section of the brief). */
export const STITCH_NOTE = "This screen was drawn by Google Stitch and approved as drawn. Rebuild it in this app's own stack, components and design tokens to look like the Stitch HTML that follows (layout, sections, order, words); do not paste its markup, Tailwind CDN script or inline styles into the app.";

/** Elements whose content the lead never saw on the card, or that only carry code, styling or metadata. */
const NOT_SHOWN = "script, style, noscript, template, iframe, object, embed, meta, link, base, title, svg title, svg desc, [hidden], [aria-hidden=true], .sr-only, .hidden, .invisible, .opacity-0, [style*='display:none'], [style*='display: none'], [style*='visibility:hidden'], [style*='visibility: hidden'], [style*='opacity:0;'], [style*='opacity: 0;'], [style$='opacity:0'], [style$='opacity: 0']";
/** The attributes the coding agent needs to rebuild the page (its layout classes, roles, input types, links). */
const KEPT_ATTRS = new Set(["class", "role", "type", "href"]);

/**
 * A Stitch screen's HTML as the coding brief shows it: only what the lead could see (no scripts, styles, comments, hidden or
 * screen-reader-only text, and no attributes but class, role, type and a plain href), whitespace collapsed, and at most
 * `maxChars` (the rest named in a closing comment), so the brief stays within its budget.
 */
export function stitchBriefHtml(html: string, maxChars = 30_000, screenId?: string): string {
  // a photo the stub commit saved keeps a src naming it (photo:s-3-1), so the brief can say which file it is
  const photos = new Map(screenId ? stitchPhotos(screenId, html).map((p) => [p.url, p.name]) : []);
  const $ = load(html);
  $(NOT_SHOWN).remove();
  // comments are words no one approved on the card
  $("*").contents().filter((_, n) => n.type === "comment").remove();
  $("*").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    const photo = (el as { name?: string }).name === "img" ? photos.get((attribs.src ?? "").trim()) : undefined;
    if (photo) attribs.src = `photo:${photo}`;
    for (const [name, value] of Object.entries(attribs)) {
      if (photo && name === "src") continue;
      if (!KEPT_ATTRS.has(name.toLowerCase()) || (name.toLowerCase() === "href" && /^\s*(javascript|vbscript|data):/i.test(value))) $(el).removeAttr(name);
    }
  });
  const clean = ($("body").html() ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars)}<!-- cut: ${clean.length - maxChars} more characters -->`;
}

/**
 * A greenfield coding task's brief for a scaffolded Stitch screen: build the approved page in its container, keep fixture mode, and
 * keep what the review's fidelity check reads (run 3f0f: buttons left out, IDs out of monospace, faded text below 4.5:1).
 */
export function stitchScaffoldBrief(s: { id: string; container: string }, states: string[], buttons: string[] = [], mono = false, o: { users?: string[]; photos?: { name: string; file: string; alt: string }[] } = {}): string {
  // run 4049: every page listed every other kind of user's pages, and each photo was drawn as a grey box
  const users = o.users?.length ? `\n- The product's pages are for different kinds of user (${o.users.join(", ")}), and the frame lists each page only for its own kind. Wherever this page signs a person in, call setSessionRole from "@/lib/session-role" with the one of those kinds their role in the API's answer is; wherever it signs them out, call setSessionRole(null).` : "";
  const photos = o.photos?.length ? `\n- The page's approved photos are saved in the app: ${o.photos.map((p) => `photo:${p.name} is /${p.file.replace(/^public\//, "")}${p.alt ? ` (${p.alt})` : ""}`).join("; ")}. Where the Stitch HTML shows one (src="photo:..."), show that file with an <img> (alt="" when the words beside it say what it is, object-cover, in the same place and size). A photo stands for a place or a kind of thing; where it would stand for one person or record of the data (a person's portrait, a vehicle's own plate, a camera's live picture), show that record's own picture or the person's initials instead, never the sample photo.` : "";
  return `This task builds ${s.id}'s page in ${s.container}: the approved Stitch screen. Rebuild it with the kit's components (components/ui, components/blocks) and the approved theme so it matches the Stitch HTML (layout, sections, order, words); do not paste the Stitch markup or its Tailwind CDN script.
- Load the real data, handle the page's actions, and keep fixture mode: ?fixture=${s.id}:<state> shows the approved sample content in that state with no backend, for ${states.join(", ") || "default"}.
- Keep every button and link the screen shows, with its words exactly as approved${buttons.length ? ` (${buttons.map((b) => `"${b}"`).join(", ")})` : ""}; the factory checks they are all there.
- The frame (components/frame/app-frame.tsx) already draws the product's top bar, name and navigation around every page: build only what sits inside it, and leave out the Stitch screen's own top bar, product name and navigation (run 4049's gate page drew a second header). A sign-out button the screen shows goes in the page's own title row.
- The screen's names, dates and numbers are sample data: outside fixture mode each one comes from the API, the signed-in session or today's date, never from text written into the page (run 4049's gate page always showed one guard and one day).
${mono ? "- The screen sets its IDs and codes in monospace: keep them in font-mono.\n" : ""}- Use the theme's text colours as they are: no see-through text (text-muted-foreground/70), which falls below 4.5:1 against its background.
- Server code, API clients and validation go in the other files of your scope.${users}${photos}`;
}

/** The approved Stitch HTML of a screen's normal page; undefined for a JSON design or a screen with none. */
export function stitchPageHtml(design: { stitch?: { frames: Record<string, { screen?: string; state?: string; html: string }> } }, screenId: string, read: (sha: string) => string): string | undefined {
  const f = Object.values(design.stitch?.frames ?? {}).find((x) => x.screen === screenId && (x.state ?? "normal") === "normal");
  try { return f ? read(f.html) : undefined; } catch { return undefined; }
}

/** Does the approved HTML set text in monospace (font-mono, or a monospace font family)? */
export const setsMonospace = (html: string): boolean => /\bfont-mono\b|monospace/i.test(html);

/** Brief screens whose Stitch HTML a coding task reads, and the characters of HTML the whole brief may hold (about 6k tokens). */
const MAX_STITCH_HTML = 3;
export const STITCH_HTML_BUDGET = 24_000;

/** The cleaned Stitch HTML of each brief screen's normal page, for at most three screens; none for a JSON design. */
export function stitchHtmlFor(design: { stitch?: { frames: Record<string, { screen?: string; state?: string; html: string }> } }, screens: Pick<ApprovedScreen, "id">[], read: (sha: string) => string, budget = STITCH_HTML_BUDGET): { id: string; html: string }[] {
  if (budget <= 0) return [];
  const frames = Object.values(design.stitch?.frames ?? {});
  const picked = screens.flatMap((s) => {
    const f = frames.find((x) => x.screen === s.id && (x.state ?? "normal") === "normal");
    return f ? [{ id: s.id, sha: f.html }] : [];
  }).slice(0, MAX_STITCH_HTML);
  // one budget for the whole brief, shared by its screens
  const each = Math.floor(budget / Math.max(1, picked.length));
  return picked.map((x) => ({ id: x.id, html: stitchBriefHtml(read(x.sha), each, x.id) }));
}

/** What the implementer is told about the screen it builds. The look is the existing app's when the design says so. */
export function screenBrief(design: ApprovedDesign, s: ApprovedScreen): Record<string, unknown> {
  const tokens = approvedTokens(design);
  return {
    screen: s.id, route: s.route, file: s.file, states: s.states ?? [], size: s.size ?? "new", flow: design.flow,
    look: design.themeSource === "repo" || !design.theme
      ? "Use the existing app's design tokens and shared components. Do not introduce new colours, fonts or one-off styles."
      : design.theme,
    ...(tokens ? { tokens, tokensNote: TOKENS_NOTE } : {}),
    ...(s.mock ? { sampleContent: s.mock } : {}),
    ...(!s.mock && s.facts ? { stitch: { facts: s.facts, note: STITCH_NOTE } } : {}),
    ...(s.change ? { change: s.change, changeNote: "The approved design note for this page: make exactly this change in the existing page, nothing more." } : {}),
    ...(design.locale && typeof design.locale === "object" ? { languages: localeBrief(design.locale as DesignLocale) } : {}),
  };
}

/** What an approved screen shows that a test can check: its route, states, and the exact words on it. */
export interface ScreenFacts { screen: string; route: string; reqs: string[]; states: string[]; title?: string; buttons: string[]; fields: string[]; columns: string[]; messages: Record<string, string>; toasts: string[]; change?: string }

const label = (b: unknown): string | undefined => (typeof b === "string" ? b : b && typeof b === "object" && typeof (b as { label?: unknown }).label === "string" ? (b as { label: string }).label : undefined);

/**
 * The approved screens that serve these requirements, as facts the acceptance-test writer can use as expected values (PR #11
 * review, item 13): the labels, messages and states the person approved, not ones the tests make up. At most 20 of each list.
 */
export function screenFacts(design: ApprovedDesign | undefined, reqIds: string[]): ScreenFacts[] {
  if (!design || design.skipped) return [];
  const want = new Set(reqIds);
  return design.screens.filter((s) => s.reqs.some((r) => want.has(r))).map((s) => {
    // a Stitch screen has no design JSON: its words are the ones read from its HTML
    if (!s.mock && s.facts) {
      const f = s.facts;
      return { screen: s.id, route: s.route, reqs: s.reqs, states: s.states ?? [], ...(f.title ? { title: f.title } : {}), buttons: f.buttons, fields: f.fields, columns: f.columns, messages: {}, toasts: [] };
    }
    const m = (s.mock ?? {}) as { title?: string; blocks?: Record<string, unknown>[]; copy?: Record<string, string>; toasts?: { text?: string }[]; overlays?: { actions?: unknown[] }[] };
    const blocks = m.blocks ?? [];
    const words = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))].slice(0, 20);
    const buttons = words([
      ...blocks.flatMap((b) => [...((b.buttons as unknown[] | undefined) ?? []), ...((b.bulk as unknown[] | undefined) ?? []), b.submit].map(label)),
      ...(m.overlays ?? []).flatMap((o) => (o.actions ?? []).map(label)),
    ]);
    const fields = words(blocks.flatMap((b) => ((b.fields as { label?: string }[] | undefined) ?? []).map((f) => f.label)));
    const columns = words(blocks.flatMap((b) => (b.columns as string[] | undefined) ?? []));
    return {
      screen: s.id, route: s.route, reqs: s.reqs, states: s.states ?? [], ...(m.title ? { title: m.title } : {}),
      buttons, fields, columns, messages: Object.fromEntries(Object.entries(m.copy ?? {}).filter(([, v]) => typeof v === "string" && v)),
      toasts: words((m.toasts ?? []).map((t) => t.text)), ...(s.change ? { change: s.change } : {}),
    };
  });
}

/** A screen-building plan task whose file scope does not reach the approved screen's file, as `[planTask, screen, file]`. */
export function screenScopeGaps(
  plan: { tasks: { id: string; estimateTaskId?: string; fileScope: string[] }[] }, breakdown: Pick<Breakdown, "tasks">, design: ApprovedDesign | undefined,
): { task: string; screen: string; file: string }[] {
  const out: { task: string; screen: string; file: string }[] = [];
  for (const t of plan.tasks) {
    const s = screenFor(breakdown, design, t.estimateTaskId);
    if (s?.file && !matchesAny(s.file, t.fileScope)) out.push({ task: t.id, screen: s.id, file: s.file });
  }
  return out;
}
