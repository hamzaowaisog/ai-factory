// Mode manifests. Brownfield (stages-aligned §1) and estimate (docs/estimates-design.md).
import type { RunState } from "../ledger/state.js";
import { acceptStep, authorTestsStep, discoverStep, implementStep, integrateStep, stubCommitStep } from "./build.js";
import { deliverStep, reviewStep } from "./deliver.js";
import type { StepDef } from "./framework.js";
import { clarify2Step, clarifyStep } from "./clarify.js";
import { breakdownStep, estimateStep } from "./estimate.js";
import { approveStep, groundStep, intakeStep, planStep } from "./spec.js";
import { draftsStep, mergeStep, specifyStep } from "./specpipe.js";
import { splitModules } from "../estimate/modules.js";
import { designCheckStep } from "./design-check.js";
import { approveEstimateStep, exportStep } from "./estimate-approve.js";
import { designSteps } from "./design-pipeline.js";
import { seedStep } from "./seed.js";
import { estimateGroundStep } from "./estimate-ground.js";
import { combineClarifyStep, combineIntakeStep, combineSpecsStep, moduleClarifySteps, moduleIntakeSteps, moduleSteps } from "./modular.js";

export function brownfieldSteps(state: RunState): StepDef[] {
  const tasks = (state.steps.get("plan")?.status === "completed" ? (state.steps.get("plan")!.data?.tasks as string[] | undefined) : undefined) ?? [];
  // a build run seeded from an approved estimate inherits its spec (no clarify, no specify) and is held to it (gates B1-B5)
  const spec: StepDef[] = state.info.estimateRef
    ? [seedStep("specify", "specify", (i) => i.estimateRef?.specSha, { critic: (i) => i.estimateRef?.criticSha })]
    : [clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep];
  return [
    discoverStep, intakeStep, groundStep, ...spec, planStep, approveStep,
    stubCommitStep, authorTestsStep,
    ...tasks.map((t) => implementStep(t)),
    integrateStep, acceptStep, designCheckStep, reviewStep, deliverStep,
  ];
}

/**
 * Estimate mode (docs/estimates-design.md, "The pipeline"):
 *   intake -> ground -> clarify -> drafts -> merge -> specify (E1)
 *   -> design-baseline (E1b) -> breakdown (E2-E4) -> estimate (E5, E6) -> approve-estimate (E7) -> export.
 * A large requirements document is split into modules by code; intake, both clarify rounds and the spec
 * pipeline then run once per module and are joined under the same step keys, so everything after them
 * is unchanged. The list is a pure function of the request text, so a replay gets the same steps.
 */
export function estimateSteps(state: RunState): StepDef[] {
  // the other delivery model over an approved breakdown: its spec, answers and tasks are inherited, only sizing is new
  const p = state.info.parent;
  if (p?.kind === "sibling") {
    return [
      seedStep("specify", "specify", (i) => i.parent?.specSha, { critic: (i) => i.parent?.criticSha }),
      ...(p.clarifySha ? [seedStep("clarify", "clarify", (i) => i.parent?.clarifySha)] : []),
      ...(p.clarify2Sha ? [seedStep("clarify-2", "clarify", (i) => i.parent?.clarify2Sha)] : []),
      // the same screens and the same approval: a different delivery model does not redraw the design
      ...(p.designSha ? [seedStep("design", "design", (i) => i.parent?.designSha)] : []),
      ...(p.baselineSha ? [seedStep("design-baseline", "design", (i) => i.parent?.baselineSha)] : []),
      seedStep("breakdown", "breakdown", (i) => i.parent?.breakdownSha),
      estimateStep, approveEstimateStep, exportStep,
    ];
  }
  const modules = splitModules(state.info.request ?? "");
  const head: StepDef[] = modules.length
    ? [...moduleIntakeSteps(modules), combineIntakeStep(modules), estimateGroundStep,
      ...moduleClarifySteps(modules, 1), combineClarifyStep(modules, 1), ...moduleClarifySteps(modules, 2), combineClarifyStep(modules, 2),
      ...moduleSteps(modules), combineSpecsStep(modules)]
    : [intakeStep, estimateGroundStep, clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep];
  return [...head, ...designSteps({ purpose: "estimate" }), breakdownStep, estimateStep, approveEstimateStep, exportStep];
}

/** The ordered steps for the run's mode. */
export function stepsFor(state: RunState): StepDef[] {
  switch (state.info.mode) {
    case "brownfield": return brownfieldSteps(state);
    case "estimate": return estimateSteps(state);
    default: throw new Error(`No step list for mode "${state.info.mode}" yet`);
  }
}
