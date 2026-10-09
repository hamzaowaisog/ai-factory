// The design step's engine and tier (docs/superpowers/plans/2026-10-09-design-tier-ladder.md): the one place that names
// them, so the project config, the design step and the ledger spell them the same way.
import type { ProjectConfig, StepRoute } from "./project.js";

export const DESIGN_ENGINES = ["claude", "openai", "stitch"] as const;
/** Ladder order: a step up is the next one. light = T1, standard = T2, heavy = T3 (docs/design/workflow-design.md). */
export const DESIGN_TIERS = ["light", "standard", "heavy"] as const;
export type DesignEngine = (typeof DESIGN_ENGINES)[number];
export type DesignTier = (typeof DESIGN_TIERS)[number];
export type RouteSource = "project-pin" | "hook" | "default";
type TierTable = Partial<Record<DesignTier, Partial<Record<DesignEngine, string>>>>;

/** Models per tier and engine when a project names none: priced Claude models only. An OpenAI ladder needs the project's own `design.tiers` and `prices`. */
export const DEFAULT_TIERS: TierTable = {
  standard: { claude: "claude-sonnet-5" },
  heavy: { claude: "claude-opus-5-5" },
};
/** Until the design eval has compared the tiers, a project that pins nothing keeps today's model: Opus 5.5, no step-up. */
const DEFAULT_ENGINE: DesignEngine = "claude";
const DEFAULT_TIER: DesignTier = "heavy";

export interface DesignPick { engine: DesignEngine; tier: DesignTier; source: { engine: RouteSource; tier: RouteSource }; dropped?: string }
export interface DesignRoute extends DesignPick { ladder: { tier: DesignTier; model: string }[]; route: StepRoute }
type Design = ProjectConfig["design"];
type Hook = { engine?: DesignEngine; tier?: DesignTier };

/** What a person pinned in the project beats what the intake hook suggests, which beats the default. */
export function mergeDesignRoute(design: Design, hook?: Hook): DesignPick {
  // a suggestion the project does not allow is dropped, not refused: nobody asked for it
  const dropped = hook?.engine === "stitch" && !design?.allowStitch ? "the hook suggested stitch, which this project does not allow" : undefined;
  const suggested = dropped ? undefined : hook?.engine;
  const engine: [DesignEngine, RouteSource] = design?.engine ? [design.engine, "project-pin"] : suggested ? [suggested, "hook"] : [DEFAULT_ENGINE, "default"];
  const tier: [DesignTier, RouteSource] = design?.tier ? [design.tier, "project-pin"] : hook?.tier ? [hook.tier, "hook"] : [DEFAULT_TIER, "default"];
  return { engine: engine[0], tier: tier[0], source: { engine: engine[1], tier: tier[1] }, ...(dropped ? { dropped } : {}) };
}

/**
 * The models a design run climbs, from its starting tier up: the engine's model on each tier that has one. On the openai
 * engine the heavy tier is Claude's (a cross-vendor step: the ladder has no OpenAI model above standard).
 */
export function tierModels(engine: DesignEngine, tier: DesignTier, tiers: TierTable): { tier: DesignTier; model: string }[] {
  const out: { tier: DesignTier; model: string }[] = [];
  for (const t of DESIGN_TIERS.slice(DESIGN_TIERS.indexOf(tier))) {
    const model = tiers[t]?.[engine] ?? (engine === "openai" && t === "heavy" ? tiers.heavy?.claude : undefined);
    if (model && !out.some((x) => x.model === model)) out.push({ tier: t, model });
  }
  return out;
}

/** The design step's route from the project's engine and tier. Throws a start-up problem when it cannot be resolved. */
export function designRoute(project: Pick<ProjectConfig, "design">, hook?: Hook): DesignRoute {
  const d = project.design;
  const pick = mergeDesignRoute(d, hook);
  if (pick.engine === "stitch") {
    throw new Error(d?.allowStitch ? "design.engine is stitch, and the Stitch engine is not built yet; set design.engine to claude or openai"
      : "design.engine is stitch, but design.allowStitch is off; Stitch sends the requirements to Google, so a project must allow it");
  }
  const tiers: TierTable = {};
  for (const t of DESIGN_TIERS) tiers[t] = { ...DEFAULT_TIERS[t], ...d?.tiers?.[t] };
  const ladder = tierModels(pick.engine, pick.tier, tiers);
  // the engine needs a model of its own on the ladder; a ladder of only the cross-vendor heavy step would swap vendors silently
  if (!ladder.some((x) => tiers[x.tier]?.[pick.engine] === x.model)) throw new Error(`No ${pick.engine} model for the design step at tier ${pick.tier} or above; add one under design.tiers`);
  return {
    ...pick, ladder,
    route: { runner: "api", model: ladder[0]!.model, escalate: ladder.slice(1).map((x) => x.model), effort: "high", strict: true, ...(ladder.length > 1 ? { tiered: true } : {}) },
  };
}
