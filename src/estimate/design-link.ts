// The link between the approved design and the build (docs/estimates-design.md, "Design baseline"). The estimate counts
// screens; this makes the build deliver the ones that were approved: the plan task that builds a screen must be allowed
// to touch the screen's file (gate B7), and the implementer is shown the approved screen (route, states, sample content,
// and the look: the new product's theme, or "use the existing app's tokens and components").
import type { Breakdown } from "../contracts/index.js";
import { matchesAny } from "../util/glob.js";

export interface ApprovedScreen { id: string; route: string; file: string; reqs: string[]; states?: string[]; size?: string; mock?: unknown; frames?: string[] }
export interface ApprovedDesign { skipped?: boolean; flow?: string; screens: ApprovedScreen[]; theme?: unknown; themeSource?: "new" | "repo" }

/** The approved screen an estimate task builds, if any. */
export function screenFor(breakdown: Pick<Breakdown, "tasks">, design: ApprovedDesign | undefined, estimateTaskId: string | undefined): ApprovedScreen | undefined {
  if (!design || design.skipped || !estimateTaskId) return undefined;
  const id = breakdown.tasks.find((t) => t.id === estimateTaskId)?.screen;
  return id ? design.screens.find((s) => s.id === id) : undefined;
}

/** What the implementer is told about the screen it builds. The look is the existing app's when the design says so. */
export function screenBrief(design: ApprovedDesign, s: ApprovedScreen): Record<string, unknown> {
  return {
    screen: s.id, route: s.route, file: s.file, states: s.states ?? [], size: s.size ?? "new", flow: design.flow,
    look: design.themeSource === "repo" || !design.theme
      ? "Use the existing app's design tokens and shared components. Do not introduce new colours, fonts or one-off styles."
      : design.theme,
    ...(s.mock ? { sampleContent: s.mock } : {}),
  };
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
