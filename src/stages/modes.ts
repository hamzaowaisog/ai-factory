// Mode manifests. Brownfield (stages-aligned §1) and estimate (docs/estimates-design.md).
import type { RunState } from "../ledger/state.js";
import { acceptStep, authorTestsStep, discoverStep, implementStep, integrateStep, stubCommitStep } from "./build.js";
import { deliverStep, reviewStep } from "./deliver.js";
import type { StepDef } from "./framework.js";
import { clarify2Step, clarifyStep } from "./clarify.js";
import { approveStep, groundStep, intakeStep, planStep } from "./spec.js";
import { draftsStep, mergeStep, specifyStep } from "./specpipe.js";

export function brownfieldSteps(state: RunState): StepDef[] {
  const tasks = (state.steps.get("plan")?.status === "completed" ? (state.steps.get("plan")!.data?.tasks as string[] | undefined) : undefined) ?? [];
  return [
    discoverStep, intakeStep, groundStep, clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep, planStep, approveStep,
    stubCommitStep, authorTestsStep,
    ...tasks.map((t) => implementStep(t)),
    integrateStep, acceptStep, reviewStep, deliverStep,
  ];
}

/**
 * Estimate mode, slice 1: the reused spec pipeline only. The estimate steps (design baseline,
 * breakdown, estimators, gates E1b-E7, approve-estimate, export) are added by later slices, each
 * behind its own inputs so the list stays a pure function of the replayed ledger.
 */
export function estimateSteps(_state: RunState): StepDef[] {
  return [intakeStep, groundStep, clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep];
}

/** The ordered steps for the run's mode. */
export function stepsFor(state: RunState): StepDef[] {
  switch (state.info.mode) {
    case "brownfield": return brownfieldSteps(state);
    case "estimate": return estimateSteps(state);
    default: throw new Error(`No step list for mode "${state.info.mode}" yet`);
  }
}
