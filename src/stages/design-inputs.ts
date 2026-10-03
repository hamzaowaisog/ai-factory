// What the design pipeline reads from the steps before it, and what the steps after it read back
// (docs/estimates-design.md, "Design references", step 2). Kept apart from design.ts so the build
// steps can read the approved design without importing the design step.
import type { RunState } from "../ledger/state.js";
import type { Ledger } from "../ledger/ledger.js";
import { buildInventory, type DesignInventory } from "../design/inventory.js";
import { dirSource } from "../design/source.js";
import { outputOf, readOutput, requireOutput, type StepContext } from "./framework.js";
import { snapshotFor } from "./workspace.js";

/**
 * The steps the design pipeline reads. Every mode that draws a design names its own: the estimate
 * reads intake, specify and the estimate ground step's design inventory; a mode with no repo to read
 * (greenfield) leaves `inventory` out.
 */
export interface DesignSources {
  /** the step whose first output is the intent (touchesUi) */
  intent: string;
  /** the step whose first output is the spec */
  spec: string;
  /** the step and named output holding the repo's design inventory, when the mode has a repo */
  inventory?: { step: string; name: string };
  /**
   * A fixed list of components to draw onto when there is no app of its own to read, such as a starter
   * template a new app is scaffolded from (greenfield). Used only when the repo has no look of its own;
   * an existing app's inventory always wins. `kitComponents()` gives the factory's own kit as one.
   */
  components?: StarterComponents;
}

/** The components a new app starts with (a starter template's or a UI kit's), named the way its code names them. */
export interface StarterComponents {
  /** where the list comes from: "starter template acme-web 2.3", "ai-factory kit shadcn 1.1.0" */
  source: string;
  framework?: string;
  styling?: string;
  componentSystem?: string;
  components: { name: string; kind?: string; variants?: string[] }[];
}

export const ESTIMATE_SOURCES: DesignSources = { intent: "intake", spec: "specify", inventory: { step: "ground", name: "design" } };
/** A direct brownfield build reads the same steps: its ground step keeps the repo's design inventory too. */
export const BROWNFIELD_SOURCES: DesignSources = { intent: "intake", spec: "specify", inventory: { step: "ground", name: "design" } };

export const sourcesReady = (s: RunState, src: DesignSources): boolean =>
  s.steps.get(src.spec)?.status === "completed" && s.steps.get(src.intent)?.status === "completed";

export const intentOf = <T>(s: RunState, l: Ledger, src: DesignSources): T => requireOutput<T>(s, l, src.intent);
export const specOf = <T>(s: RunState, l: Ledger, src: DesignSources): T => requireOutput<T>(s, l, src.spec);
export const inventoryOf = <T>(s: RunState, l: Ledger, src: DesignSources): T | undefined =>
  src.inventory ? readOutput<T>(s, l, src.inventory.step, src.inventory.name) : undefined;
/**
 * The repo's design inventory for a step that runs on it: the ground step's, or, when that ground step completed before it
 * kept one (a run paused across an upgrade keeps its ground output), read from the run's repo snapshot now. Deterministic: the
 * same snapshot always gives the same inventory, so the step's inputs need not change.
 */
export function repoInventory(ctx: Pick<StepContext, "runId" | "state" | "project" | "ledger">, src: DesignSources): DesignInventory | undefined {
  const kept = inventoryOf<DesignInventory>(ctx.state, ctx.ledger, src);
  if (kept || !src.inventory || !ctx.state.info.repoPath || !ctx.state.info.baseCommit) return kept;
  try { return buildInventory(dirSource(snapshotFor(ctx).root)); } catch { return undefined; }
}
/** the inventory's named outputs, as the design step's inputs record them (undefined with no inventory) */
export const inventoryNamed = (s: RunState, src: DesignSources): unknown => (src.inventory ? s.steps.get(src.inventory.step)?.data?.named : undefined);

/**
 * The design a build follows: the one approved in the estimate or the design-only run the run was
 * seeded from, or else the one approved in this run's own design steps (a mode that draws and builds in one run). Undefined
 * when there is none, or when the request has no UI.
 */
export function approvedDesignFor<T = unknown>(state: RunState, ledger: Ledger): { sha: string; design: T } | undefined {
  const fromEstimate = state.info.estimateRef?.designSha ?? state.info.designRef?.designSha;
  if (fromEstimate) return { sha: fromEstimate, design: ledger.getJson<T>(fromEstimate) };
  const baseline = readOutput<{ ui?: boolean; design?: string }>(state, ledger, "design-baseline");
  const sha = baseline?.ui && baseline.design ? baseline.design : undefined;
  if (!sha || sha !== outputOf(state, "design")) return undefined;
  return { sha, design: ledger.getJson<T>(sha) };
}
