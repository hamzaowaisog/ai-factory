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

/** The Stitch model per tier (SDK 0.3.5 model ids). */
export const STITCH_MODELS = { light: "GEMINI_3_FLASH", standard: "GEMINI_3_PRO", heavy: "GEMINI_3_1_PRO" } as const satisfies Record<DesignTier, string>;

export interface DesignPick { engine: DesignEngine; tier: DesignTier; source: { engine: RouteSource; tier: RouteSource }; dropped?: string }
/** `stitch` is the Stitch model of the entry's tier, on the stitch engine; its `model` is the Claude planner. */
export interface DesignRoute extends DesignPick { ladder: { tier: DesignTier; model: string; stitch?: string }[]; route: StepRoute }
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
  if (pick.engine === "stitch" && !d?.allowStitch) {
    throw new Error("design.engine is stitch, but design.allowStitch is off; Stitch sends the requirements to Google, so a project must allow it");
  }
  const tiers: TierTable = {};
  for (const t of DESIGN_TIERS) tiers[t] = { ...DEFAULT_TIERS[t], ...d?.tiers?.[t] };
  let ladder: DesignRoute["ladder"];
  if (pick.engine === "stitch") {
    // Stitch draws on every tier from the start with that tier's model; Claude plans on that tier, or the next one up that has a Claude model
    ladder = DESIGN_TIERS.slice(DESIGN_TIERS.indexOf(pick.tier)).flatMap((t) => {
      const planner = tierModels("claude", t, tiers)[0]?.model;
      return planner ? [{ tier: t, model: planner, stitch: STITCH_MODELS[t] }] : [];
    });
    if (!ladder.length) throw new Error(`No claude model to plan the stitch design at tier ${pick.tier} or above; add one under design.tiers`);
  } else {
    ladder = tierModels(pick.engine, pick.tier, tiers);
    // the engine needs a model of its own on the ladder; a ladder of only the cross-vendor heavy step would swap vendors silently
    if (!ladder.some((x) => tiers[x.tier]?.[pick.engine] === x.model)) throw new Error(`No ${pick.engine} model for the design step at tier ${pick.tier} or above; add one under design.tiers`);
    // a tier a person pinned is the tier that runs: no silent start one tier up (a suggested tier may start higher)
    if (pick.source.tier === "project-pin" && ladder[0]!.tier !== pick.tier) {
      throw new Error(`No ${pick.engine} model for the design step at tier ${pick.tier}; add one under design.tiers.${pick.tier}.${pick.engine}, or pin tier ${ladder[0]!.tier}`);
    }
  }
  return {
    ...pick, ladder,
    route: { runner: "api", model: ladder[0]!.model, escalate: ladder.slice(1).map((x) => x.model), effort: "high", strict: true, ...(ladder.length > 1 ? { tiered: true } : {}) },
  };
}

/** The ladder entry a rung runs: rungs 0 and 1 the first, then one per stronger-model rung, the last one kept. */
export function ladderAt(dr: Pick<DesignRoute, "ladder">, rung: number): DesignRoute["ladder"][number] {
  return dr.ladder[Math.min(Math.max(0, rung - 1), dr.ladder.length - 1)]!;
}
