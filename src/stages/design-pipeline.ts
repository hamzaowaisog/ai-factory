// The design pipeline as one piece any mode puts in its step list (docs/estimates-design.md,
// "Design references", "Built to plug into greenfield"): read the references the user attached (only
// when there are some), draw the design, a person approves it, then the approved design is written out as
// a design package (`design-export`, src/design/package.ts).
// The estimate uses it today; greenfield and direct brownfield builds plug it in after their spec.
// The steps keep the keys "design" and "design-baseline" in every mode, so the UI, lineage and
// `approvedDesignFor` read them the same way.
import type { StepDef } from "./framework.js";
import { makeDesignStep } from "./design.js";
import { makeDesignRefsStep } from "./design-refs.js";
import { ESTIMATE_SOURCES, type DesignSources } from "./design-inputs.js";
import { makeDesignApprovalStep, type DesignPurpose } from "./estimate-approve.js";
import { designExportStep } from "./design-export.js";

export interface DesignPipelineOptions {
  /** the steps the pipeline reads (the estimate's by default) */
  sources?: DesignSources;
  /** what the approved design is for: the card's wording */
  purpose?: DesignPurpose;
  /** the run has design references: read them first (`design-refs`); without, the list is what it always was */
  refs?: boolean;
  /** write the design package after the approval (default); off only for a run that went past it before packages existed */
  exportPackage?: boolean;
}

/** The design steps, in order, for a mode's step list. */
export function designSteps(opts: DesignPipelineOptions = {}): StepDef[] {
  const sources = opts.sources ?? ESTIMATE_SOURCES;
  return [...(opts.refs ? [makeDesignRefsStep(sources)] : []), makeDesignStep(sources), makeDesignApprovalStep({ sources, purpose: opts.purpose ?? "estimate" }), ...(opts.exportPackage === false ? [] : [designExportStep])];
}
