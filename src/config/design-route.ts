// The design step's engine and tier (docs/superpowers/plans/2026-10-09-design-tier-ladder.md): the one place that names
// them, so the project config, the design step and the ledger spell them the same way.
export const DESIGN_ENGINES = ["claude", "openai", "stitch"] as const;
/** Ladder order: a step up is the next one. light = T1, standard = T2, heavy = T3 (docs/design/workflow-design.md). */
export const DESIGN_TIERS = ["light", "standard", "heavy"] as const;
export type DesignEngine = (typeof DESIGN_ENGINES)[number];
export type DesignTier = (typeof DESIGN_TIERS)[number];
