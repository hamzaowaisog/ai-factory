// Every number the estimate uses that is not counted from the project. All are labelled assumptions,
// editable per run, and meant to be replaced by measured values as the ledger fills
// (docs/estimates-design.md: "All times are labelled assumed"). Nothing here is a task-hours table.
export interface Range { min: number; max: number }

export interface Assumptions {
  /** work-size band cut-offs (structural for now) */
  bands: {
    xs: { maxRequirements: number; maxFeatures: number; maxScreens: number };
    s: { maxFeatures: number };
    m: { maxFeatures: number; maxIntegrations: number };
    l: { maxFeatures: number; maxPlatforms: number };
    /** share of non-standard units that bumps the band up one step */
    complexityBumpShare: number;
  };
  /** HITL human gate time */
  gates: {
    clarifyMinutesPerQuestion: Range;
    approvalMinutesPerSection: Range;
    prReviewMinutes: { low: Range; medium: Range; high: Range };
    /** share of tasks expected to exhaust the retry ladder, and the lead time each costs */
    parkedRunRate: Range;
    parkedInterventionMinutes: Range;
    waiverMinutes: Range;
  };
  /** tasks folded into one PR when grouping */
  tasksPerPr: number;
  /** estimators disagreeing by more than this share of their midpoint flag the item */
  estimatorTolerance: number;
  hoursPerDay: number;
  hoursPerWeek: number;
  cost: {
    /** records behind a phase before its confidence leaves cold-start / reaches calibrated */
    partialFrom: number;
    calibratedFrom: number;
    /** fallback dollars per estimate-task unit when a phase has no records (cold-start), whole-run figure */
    coldStartUsdPerTask: Range;
    /** how the whole-run fallback is split across phases (assumed until per-step reports are available) */
    coldStartShares: Record<"planning" | "design" | "breakdown-estimate" | "build" | "verification", number>;
    /** solely agentic: nobody takes over parked runs, so build and verification cost more */
    agenticBuildFactor: number;
  };
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  bands: {
    xs: { maxRequirements: 3, maxFeatures: 1, maxScreens: 1 },
    s: { maxFeatures: 3 },
    m: { maxFeatures: 14, maxIntegrations: 2 },
    l: { maxFeatures: 59, maxPlatforms: 3 },
    complexityBumpShare: 0.3,
  },
  gates: {
    clarifyMinutesPerQuestion: { min: 2, max: 5 },
    approvalMinutesPerSection: { min: 3, max: 8 },
    prReviewMinutes: { low: { min: 10, max: 20 }, medium: { min: 20, max: 40 }, high: { min: 40, max: 90 } },
    parkedRunRate: { min: 0.05, max: 0.15 },
    parkedInterventionMinutes: { min: 20, max: 60 },
    waiverMinutes: { min: 5, max: 15 },
  },
  tasksPerPr: 2,
  estimatorTolerance: 0.5,
  hoursPerDay: 8,
  hoursPerWeek: 40,
  cost: {
    partialFrom: 3,
    calibratedFrom: 15,
    // first measured runs (docs/runs/2026-09-30-first-real-runs.md): one small fix cost $1.33-$1.75
    coldStartUsdPerTask: { min: 1.3, max: 1.8 },
    coldStartShares: { planning: 0.35, design: 0, "breakdown-estimate": 0.05, build: 0.4, verification: 0.2 },
    agenticBuildFactor: 1.25,
  },
};
