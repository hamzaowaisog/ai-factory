// The link between the approved design and the build (docs/estimates-design.md, "Design baseline"). The estimate counts
// screens; this makes the build deliver the ones that were approved: the plan task that builds a screen must be allowed
// to touch the screen's file (gate B7), and the implementer is shown the approved screen (route, states, sample content,
// the look: the new product's theme, or "use the existing app's tokens and components", and its languages).
import type { Breakdown } from "../contracts/index.js";
import type { DesignLocale, DesignTheme } from "../contracts/artifacts.js";
import { localeBrief } from "../design/locale.js";
import { designTokens } from "../design/tokens.js";
import { matchesAny } from "../util/glob.js";

export interface ApprovedScreen { id: string; route: string; file: string; reqs: string[]; states?: string[]; size?: string; mock?: unknown; frames?: string[]; change?: string }
export interface ApprovedDesign { skipped?: boolean; flow?: string; screens: ApprovedScreen[]; theme?: unknown; themeSource?: "new" | "repo"; locale?: unknown; note?: boolean }

/** The approved screen an estimate task builds, if any. */
export function screenFor(breakdown: Pick<Breakdown, "tasks">, design: ApprovedDesign | undefined, estimateTaskId: string | undefined): ApprovedScreen | undefined {
  if (!design || design.skipped || !estimateTaskId) return undefined;
  const id = breakdown.tasks.find((t) => t.id === estimateTaskId)?.screen;
  return id ? design.screens.find((s) => s.id === id) : undefined;
}

/**
 * The approved screen a plan task builds, whatever led to the build (an estimate, --from-design, a scaffold or none): the
 * estimate task's screen first, then the screen whose page file is in the task's scope, then the one screen sharing the
 * task's requirements. A task that is not a screen's gets none.
 */
export function screenForTask(design: ApprovedDesign | undefined, task: { fileScope: string[]; reqs?: string[] }, estimated?: ApprovedScreen): ApprovedScreen | undefined {
  if (estimated) return estimated;
  if (!design || design.skipped) return undefined;
  const byFile = design.screens.filter((s) => s.file && matchesAny(s.file, task.fileScope));
  if (byFile.length === 1) return byFile[0];
  if (byFile.length > 1) return undefined; // a shared layout or a broad glob: no one screen is this task's
  const byReq = design.screens.filter((s) => s.reqs.some((r) => task.reqs?.includes(r)));
  return byReq.length === 1 ? byReq[0] : undefined;
}

/** How the implementer uses the tokens. */
export const TOKENS_NOTE = "These are the approved look's design tokens: the exact values the approved demo was drawn with. If the app has no such variables yet and its global stylesheet is in your file scope, add the `css` block there once; then style with the variables (var(--color-brand), var(--radius), ...) or, where variables cannot reach, these values. Do not invent other colours, fonts, corners or shadows. When there is a light and a dark set, the app follows the viewer's setting, and a light/dark switch (where the app has a settings menu or top bar) sets data-theme=\"light\" or \"dark\" on the root element.";

/** The approved look's tokens, or undefined when the look is the repo's or the theme cannot be read. */
export function approvedTokens(design: ApprovedDesign): ReturnType<typeof designTokens> | undefined {
  if (design.themeSource === "repo" || !design.theme || typeof design.theme !== "object") return undefined;
  try { return designTokens(design.theme as DesignTheme); } catch { return undefined; }
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
