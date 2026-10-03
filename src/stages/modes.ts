// Mode manifests. Brownfield (stages-aligned §1) and estimate (docs/estimates-design.md).
import type { RunState } from "../ledger/state.js";
import { acceptStep, authorTestsStep, discoverStep, implementStep, integrateStep, stubCommitStep } from "./build.js";
import { deliverStep, reviewStep } from "./deliver.js";
import type { StepDef } from "./framework.js";
import { clarify2Step, clarifyStep } from "./clarify.js";
import { breakdownStep, estimateStep } from "./estimate.js";
import { approveStep, intakeStep, planStep } from "./spec.js";
import { draftsStep, mergeStep, specifyStep } from "./specpipe.js";
import { splitModules } from "../estimate/modules.js";
import { designCheckStep } from "./design-check.js";
import { designFidelityStep } from "./design-fidelity.js";
import { approveEstimateStep, exportStep } from "./estimate-approve.js";
import { designSteps } from "./design-pipeline.js";
import { seedStep } from "./seed.js";
import { brownfieldGroundStep, estimateGroundStep, newProductGroundStep } from "./estimate-ground.js";
import { BROWNFIELD_SOURCES } from "./design-inputs.js";
import { combineClarifyStep, combineIntakeStep, combineSpecsStep, moduleClarifySteps, moduleIntakeSteps, moduleSteps } from "./modular.js";

export function brownfieldSteps(state: RunState): StepDef[] {
  const tasks = (state.steps.get("plan")?.status === "completed" ? (state.steps.get("plan")!.data?.tasks as string[] | undefined) : undefined) ?? [];
  // a build run seeded from an approved estimate inherits its spec (no clarify, no specify) and is held to it (gates B1-B5)
  // a build from an approved design-only run inherits that run's spec the same way, so its screens and requirements line up
  const spec: StepDef[] = state.info.estimateRef
    ? [seedStep("specify", "specify", (i) => i.estimateRef?.specSha, { critic: (i) => i.estimateRef?.criticSha })]
    : state.info.designRef
    ? [seedStep("specify", "specify", (i) => i.designRef?.specSha, { critic: (i) => i.designRef?.criticSha })]
    : [clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep];
  // a direct build that touches UI draws its design and a person approves it before plan (a build from an approved
  // estimate or design follows that one); once intake says there is no UI the steps drop out, so such a run is as before
  const intake = state.steps.get("intake");
  const noUi = intake?.status === "completed" && intake.data?.touchesUi === false;
  // (a run that planned without them, started before builds drew designs, goes on as it was rather than replanning)
  const plannedWithout = state.steps.has("plan") && !state.steps.has("design");
  // (a run whose first build commit was made before design packages existed goes on without one, rather than redoing its commits)
  const committedWithout = state.steps.get("stub-commit")?.status === "completed" && !state.steps.has("design-export");
  const design = state.info.estimateRef || state.info.designRef || noUi || plannedWithout ? [] : designSteps({ sources: BROWNFIELD_SOURCES, purpose: "build", refs: !!state.info.references?.length, exportPackage: !committedWithout });
  return [
    discoverStep, intakeStep, brownfieldGroundStep, ...spec, ...design, planStep, approveStep,
    stubCommitStep, authorTestsStep,
    ...tasks.map((t) => implementStep(t)),
    integrateStep, acceptStep, designFidelityStep, designCheckStep, reviewStep, deliverStep,
  ];
}

/**
 * Greenfield (the PR #11 review's follow-up, after the split): an approved design for a new product, built into an empty repo.
 *   discover (an empty baseline) -> intake, ground, clarify and specify, seeded from the design run (the design itself via designRef)
 *   -> plan -> approve -> stub-commit (the scaffold: a fresh next-shadcn app, its kit, theme and every approved page)
 *   -> author-tests -> implement per task -> integrate -> accept -> fidelity -> design-check -> review -> deliver.
 * Every gate of a build runs: it is brownfield's build half on a repo whose only code is the scaffold.
 */
export function greenfieldSteps(state: RunState): StepDef[] {
  if (!state.info.designRef) throw new Error("A greenfield run is built from an approved design (--from-design); this one has none.");
  const tasks = (state.steps.get("plan")?.status === "completed" ? (state.steps.get("plan")!.data?.tasks as string[] | undefined) : undefined) ?? [];
  return [
    // the approved design itself is read through designRef, as in a brownfield build --from-design (no design steps of its own)
    discoverStep, ...seededFromDesign(state).filter((s) => !s.key.startsWith("design")), ...(state.info.designRef.groundSha ? [] : [newProductGroundStep]),
    planStep, approveStep, stubCommitStep, authorTestsStep,
    ...tasks.map((t) => implementStep(t)),
    integrateStep, acceptStep, designFidelityStep, designCheckStep, reviewStep, deliverStep,
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
  // an approved design-only run: its intake, grounding, answers, spec and approved design are inherited; only sizing is new
  if (state.info.designRef) return [...seededFromDesign(state), breakdownStep, estimateStep, approveEstimateStep, exportStep];
  return [...requirementsHead(state), ...designSteps({ purpose: "estimate", refs: !!state.info.references?.length }), breakdownStep, estimateStep, approveEstimateStep, exportStep];
}

/**
 * From the requirements to the spec, shared by the estimate and the design-only run: intake, ground,
 * two clarify rounds and the spec pipeline, per module for a large document.
 */
export function requirementsHead(state: RunState): StepDef[] {
  const modules = splitModules(state.info.request ?? "");
  return modules.length
    ? [...moduleIntakeSteps(modules), combineIntakeStep(modules), estimateGroundStep,
      ...moduleClarifySteps(modules, 1), combineClarifyStep(modules, 1), ...moduleClarifySteps(modules, 2), combineClarifyStep(modules, 2),
      ...moduleSteps(modules), combineSpecsStep(modules)]
    : [intakeStep, estimateGroundStep, clarifyStep, clarify2Step, draftsStep, mergeStep, specifyStep];
}

/** The steps of an approved design-only run, seeded into a new run under the same keys (`info.designRef`). */
function seededFromDesign(state: RunState): StepDef[] {
  const ref = state.info.designRef!;
  return [
    seedStep("intake", "intake", (i) => i.designRef?.intakeSha),
    ...(ref.groundSha ? [seedStep("ground", "ground", (i) => i.designRef?.groundSha, { survey: (i) => i.designRef?.surveySha, design: (i) => i.designRef?.inventorySha })] : []),
    ...(ref.clarifySha ? [seedStep("clarify", "clarify", (i) => i.designRef?.clarifySha)] : []),
    ...(ref.clarify2Sha ? [seedStep("clarify-2", "clarify", (i) => i.designRef?.clarify2Sha)] : []),
    seedStep("specify", "specify", (i) => i.designRef?.specSha, { critic: (i) => i.designRef?.criticSha }),
    seedStep("design", "design", (i) => i.designRef?.designSha),
    seedStep("design-baseline", "design", (i) => i.designRef?.baselineSha),
  ];
}

/**
 * Design-only mode (`factory design start`, docs/estimates-design.md, "Design references", step 3b):
 * the estimate's road from the requirements to the spec, then the design pipeline, and it stops at the
 * approved design and clickable demo: no breakdown, sizing or workbooks. An estimate or a build carries
 * the approved design on (`--from-design`).
 */
export function designOnlySteps(state: RunState): StepDef[] {
  return [...requirementsHead(state), ...designSteps({ purpose: "design", refs: !!state.info.references?.length })];
}

/** The ordered steps for the run's mode. */
export function stepsFor(state: RunState): StepDef[] {
  switch (state.info.mode) {
    case "brownfield": return brownfieldSteps(state);
    case "greenfield": return greenfieldSteps(state);
    case "estimate": return estimateSteps(state);
    case "design": return designOnlySteps(state);
    default: throw new Error(`No step list for mode "${state.info.mode}" yet`);
  }
}
