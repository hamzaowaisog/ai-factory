// The link between the approved design and the build (docs/estimates-design.md, "Design baseline"). The estimate counts
// screens; this makes the build deliver the ones that were approved: the plan task that builds a screen must be allowed
// to touch the screen's file (gate B7), and the implementer is shown the approved screen (route, states, sample content,
// the look: the new product's theme, or "use the existing app's tokens and components", and its languages).
import type { Breakdown } from "../contracts/index.js";
import type { DesignLocale, DesignTheme } from "../contracts/artifacts.js";
import { localeBrief } from "./locale.js";
import { designTokens } from "./tokens.js";
import { matchesAny } from "../util/glob.js";

import type { StitchFacts } from "./stitch-facts.js";
export interface ApprovedScreen { id: string; route: string; file: string; reqs: string[]; states?: string[]; size?: string; mock?: unknown; frames?: string[]; change?: string; facts?: StitchFacts }
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

/**
 * A Stitch screen's HTML as the coding brief shows it: no scripts, stylesheets links or metas, inline data cut to `data:…`,
 * whitespace collapsed, and at most `maxBytes` (the rest named in a closing comment), so the brief stays within its budget.
 */
export function stitchBriefHtml(html: string, maxBytes = 30_000): string {
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    // comments are words no one approved on the card: hidden text never reaches the coding agent
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(link|meta)\b[^>]*>/gi, "")
    .replace(/(["'])data:[^"']*\1/gi, '"data:…"')
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= maxBytes ? clean : `${clean.slice(0, maxBytes)}<!-- cut: ${clean.length - maxBytes} more bytes -->`;
}

/** Brief screens whose Stitch HTML a coding task reads (each is up to 30 KB of the briefing). */
const MAX_STITCH_HTML = 3;

/** The cleaned Stitch HTML of each brief screen's normal page, for at most three screens; none for a JSON design. */
export function stitchHtmlFor(design: { stitch?: { frames: Record<string, { screen?: string; state?: string; html: string }> } }, screens: Pick<ApprovedScreen, "id">[], read: (sha: string) => string): { id: string; html: string }[] {
  const frames = Object.values(design.stitch?.frames ?? {});
  return screens.flatMap((s) => {
    const f = frames.find((x) => x.screen === s.id && (x.state ?? "normal") === "normal");
    return f ? [{ id: s.id, html: stitchBriefHtml(read(f.html)) }] : [];
  }).slice(0, MAX_STITCH_HTML);
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
