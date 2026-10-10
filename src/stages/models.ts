// The models the factory routes to, the tier table, each step's place in it, and the ladders retries climb.
// One table for every pipeline: a new step adds a line to STEPS and gets the picker, the presets, the
// checks and the route log with it. Prices live in src/runners/pricing.ts.
import type { Effort } from "../runners/types.js";

export type Vendor = "anthropic" | "openai";
export type Tier = "light" | "standard" | "heavy";
export const TIERS: readonly Tier[] = ["light", "standard", "heavy"];
/** Where a step's model came from, as written to the ledger. */
export type RouteSource = "pick" | "config" | "recommended" | "plan size" | "rule" | "default" | "fixed" | "before the picker";
export type StepGroup = "thinking" | "design" | "coding" | "review";

export interface ModelInfo {
  id: string;
  name: string;
  vendor: Vendor;
  /** the step groups whose rows offer it at the start of a run; a model with none is reached through a tier only */
  offered: readonly StepGroup[];
}

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-5-5";
export const LUNA = "gpt-6-luna";
export const SOL = "gpt-6-sol";

export const MODELS: readonly ModelInfo[] = [
  { id: LUNA, name: "GPT-6 Luna", vendor: "openai", offered: ["thinking", "design", "review", "coding"] },
  { id: SOL, name: "GPT-6 Sol", vendor: "openai", offered: ["thinking", "design", "review", "coding"] },
  { id: OPUS, name: "Claude Opus 5.5", vendor: "anthropic", offered: ["thinking", "design", "review", "coding"] },
  { id: SONNET, name: "Claude Sonnet 5.5", vendor: "anthropic", offered: ["coding"] },
  { id: HAIKU, name: "Claude Haiku 5.5", vendor: "anthropic", offered: [] },
];

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id);
export const modelName = (id: string): string => modelInfo(id)?.name ?? id;

/** A tier's model and, where the tier sets one, its effort. */
export interface TierEntry { model: string; effort?: Effort }

/** The tier table: one row per vendor. A step names a vendor and a tier, never a model. */
export const TIER_TABLE: Record<Vendor, Record<Tier, TierEntry>> = {
  openai: { light: { model: LUNA }, standard: { model: SOL, effort: "medium" }, heavy: { model: SOL, effort: "high" } },
  anthropic: { light: { model: HAIKU }, standard: { model: SONNET, effort: "medium" }, heavy: { model: OPUS } },
};

export interface StepSpec {
  /** a coding step names the Claude agent; on a GPT model it runs in the Codex one (runnerFor) */
  runner: "api" | "claude-agent";
  group: StepGroup;
  /** the vendor its default and its presets are read from */
  vendor: Vendor;
  tier: Tier;
  /** the step's own effort; without one the tier's is used, then high */
  effort?: Effort;
  /** the lowest tier a preset or a suggestion may put it on */
  floor?: Tier;
  /** never asked and never changed: the model it always runs on */
  fixed?: string;
  /** only these vendors may run it; a pick from another is refused */
  only?: readonly Vendor[];
  /** a pick from this vendor is allowed but warned about at the start */
  warn?: { vendor: Vendor; why: string };
  /** the models a retry climbs, weakest first, when it differs from the vendor's own */
  ladder?: readonly string[];
}

const SAME_AS_CRITIC = "the critic is Claude Opus 5.5 too, so it reads a spec its own model wrote";

/**
 * Every model step. Thinking steps stay on Claude until the paid GPT-6 proving run; the second spec draft and the
 * pre-PR reviewer are on GPT-6 so they differ from the critic and from the implementer.
 */
export const STEPS: Record<string, StepSpec> = {
  intake: { runner: "api", group: "thinking", vendor: "anthropic", tier: "light", effort: "low" },
  ground: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "high" },
  sketches: { runner: "api", group: "thinking", vendor: "anthropic", tier: "standard", effort: "medium" },
  "sketch-align": { runner: "api", group: "thinking", vendor: "anthropic", tier: "light", effort: "low" },
  clarifier: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "medium" },
  specify: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "high", warn: { vendor: "anthropic", why: SAME_AS_CRITIC } },
  "specify-other": { runner: "api", group: "thinking", vendor: "openai", tier: "heavy", effort: "high", only: ["openai"], ladder: [LUNA, SOL] },
  merge: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "medium", warn: { vendor: "anthropic", why: SAME_AS_CRITIC } },
  restater: { runner: "api", group: "thinking", vendor: "anthropic", tier: "standard", effort: "low" },
  "rt-align": { runner: "api", group: "thinking", vendor: "anthropic", tier: "light", effort: "low" },
  critic: { runner: "api", group: "review", vendor: "anthropic", tier: "heavy", effort: "high", fixed: OPUS, ladder: [OPUS] },
  breakdown: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "high" },
  estimate: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "high" },
  design: { runner: "api", group: "design", vendor: "anthropic", tier: "heavy", effort: "high" },
  "design-triage": { runner: "api", group: "design", vendor: "anthropic", tier: "light", effort: "low" },
  "design-read": { runner: "api", group: "design", vendor: "anthropic", tier: "standard", effort: "medium" },
  plan: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "high" },
  // the test writer sets what "done" means for the code: never the light tier
  "author-tests": { runner: "claude-agent", group: "coding", vendor: "anthropic", tier: "heavy", effort: "high", floor: "standard", ladder: [SONNET, OPUS] },
  implement: { runner: "claude-agent", group: "coding", vendor: "anthropic", tier: "standard", effort: "high" },
  review: { runner: "api", group: "review", vendor: "openai", tier: "heavy", effort: "high", ladder: [LUNA, SOL] },
  "review-2": { runner: "api", group: "review", vendor: "anthropic", tier: "heavy", effort: "high" },
  "impact-lens": { runner: "api", group: "thinking", vendor: "anthropic", tier: "standard", effort: "medium" },
};

/** The runner a step uses on this model: a coding step given a GPT model runs in the Codex agent, any other in the Claude one. */
export function runnerFor(stage: string, model: string): "api" | "claude-agent" | "codex" {
  const runner = STEPS[stage]?.runner ?? "api";
  return runner === "claude-agent" && (modelInfo(model)?.vendor === "openai" || /^gpt|^o\d/.test(model)) ? "codex" : runner;
}

/** The models a retry climbs from `model` on this step, weakest first. A GPT-6 step may end on Claude Opus 5.5. */
export function ladderOf(stage: string, model: string): readonly string[] {
  const own = STEPS[stage]?.ladder;
  if (own) return own;
  return modelInfo(model)?.vendor === "openai" ? [LUNA, SOL, OPUS] : [HAIKU, SONNET, OPUS];
}

/** One tier up from `model` on this step; undefined at the top, or for a model the ladder does not hold. */
export function nextUp(stage: string, model: string): string | undefined {
  const l = ladderOf(stage, model);
  const at = l.indexOf(model);
  return at < 0 ? undefined : l[at + 1];
}

/** The models a person may pick for this step at the start of a run (none for a fixed step). */
export function offeredFor(stage: string): ModelInfo[] {
  const s = STEPS[stage];
  if (!s || s.fixed) return [];
  return MODELS.filter((m) => m.offered.includes(s.group) && (!s.only || s.only.includes(m.vendor)));
}

export type Preset = "economy" | "balanced" | "quality";
export const PRESETS: readonly Preset[] = ["economy", "balanced", "quality"];

const up = (t: Tier, floor: Tier | undefined): Tier => (floor && TIERS.indexOf(t) < TIERS.indexOf(floor) ? floor : t);

/**
 * The tier a preset puts a step on. Balanced is the step's own tier; Economy drops every step one tier and
 * Quality lifts every step one, both held to the step's floor.
 */
export function presetTier(stage: string, preset: Preset): Tier | undefined {
  const s = STEPS[stage];
  if (!s || s.fixed) return undefined;
  const at = TIERS.indexOf(s.tier) + (preset === "economy" ? -1 : preset === "quality" ? 1 : 0);
  return up(TIERS[Math.max(0, Math.min(TIERS.length - 1, at))]!, s.floor);
}

/** A tier for this step held to its floor (a suggestion never puts the test writer on the light tier). */
export const heldTier = (stage: string, tier: Tier): Tier => up(tier, STEPS[stage]?.floor);
