// The design pipeline as one piece any mode puts in its step list (docs/estimates-design.md,
// "Design references", "Built to plug into greenfield"): draw the design, then a person approves it.
// The estimate uses it today; greenfield and direct brownfield builds plug it in after their spec.
// The steps keep the keys "design" and "design-baseline" in every mode, so the UI, lineage and
// `approvedDesignFor` read them the same way.
import type { StepDef } from "./framework.js";
import { makeDesignStep } from "./design.js";
import { ESTIMATE_SOURCES, type DesignSources } from "./design-inputs.js";
import { makeDesignApprovalStep, type DesignPurpose } from "./estimate-approve.js";

export interface DesignPipelineOptions {
  /** the steps the pipeline reads (the estimate's by default) */
  sources?: DesignSources;
  /** what the approved design is for: the card's wording */
  purpose?: DesignPurpose;
}

/** The design steps, in order, for a mode's step list. */
export function designSteps(opts: DesignPipelineOptions = {}): StepDef[] {
  const sources = opts.sources ?? ESTIMATE_SOURCES;
  return [makeDesignStep(sources), makeDesignApprovalStep({ sources, purpose: opts.purpose ?? "estimate" })];
}
