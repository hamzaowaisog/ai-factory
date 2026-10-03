// Model routing per step (adapters.md config; stages-aligned §2; WD §4 tiers).
import type { ProjectConfig, StepRoute } from "../config/project.js";
import { hasSecret } from "../config/env.js";
import type { Rung } from "../gates/ladder.js";
import { blockedText, modelAllowed, type Policy } from "../gates/policy.js";
import { family, type Effort } from "../runners/types.js";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5";

/** Defaults. GPT steps fall back to Opus (noted as single-family) when no OpenAI key exists. */
export const DEFAULT_ROUTES: Record<string, StepRoute> = {
  intake: { runner: "api", model: HAIKU, escalate: [SONNET], effort: "low" },
  ground: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  sketches: { runner: "api", model: SONNET, escalate: [], effort: "medium" },
  "sketch-align": { runner: "api", model: HAIKU, escalate: [SONNET], effort: "low" },
  clarifier: { runner: "api", model: OPUS, escalate: [], effort: "medium" },
  specify: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  "specify-other": { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
  merge: { runner: "api", model: OPUS, escalate: [], effort: "medium" },
  restater: { runner: "api", model: SONNET, escalate: [], effort: "low" },
  "rt-align": { runner: "api", model: HAIKU, escalate: [SONNET], effort: "low" },
  critic: { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
  breakdown: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  estimate: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  design: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  "design-triage": { runner: "api", model: HAIKU, escalate: [SONNET], effort: "low" },
  /** reads the design references the user attached (runs with references only) */
  "design-read": { runner: "api", model: SONNET, escalate: [OPUS], effort: "medium" },
  plan: { runner: "api", model: OPUS, escalate: [], effort: "high" },
  "author-tests": { runner: "claude-agent", model: OPUS, escalate: [], effort: "high" },
  implement: { runner: "claude-agent", model: SONNET, escalate: [OPUS], effort: "high" },
  review: { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
};

export const THINKING_STEPS = new Set(["intake", "ground", "specify", "specify-other", "critic", "plan", "breakdown", "estimate", "design", "design-triage", "design-read", "review", "sketches", "sketch-align", "clarifier", "merge", "restater", "rt-align", "impact"]);
/** The model steps an estimate run uses: it never plans, writes tests or code, or reviews, so it does not need those routes set up. */
export const ESTIMATE_ROUTES = ["intake", "ground", "sketches", "sketch-align", "clarifier", "specify", "specify-other", "merge", "restater", "rt-align", "critic", "breakdown", "estimate", "design", "design-triage", "design-read"] as const;
/** A design-only run: the estimate's steps up to the spec, then the design (no breakdown, no sizing). */
export const DESIGN_ROUTES = ESTIMATE_ROUTES.filter((r) => r !== "breakdown" && r !== "estimate");
export const CODING_STEPS = new Set(["author-tests", "implement", "conflict-resolve"]);

export function routeFor(project: ProjectConfig, stage: string): StepRoute {
  const r = project.steps[stage] ?? DEFAULT_ROUTES[stage];
  if (!r) throw new Error(`No model route for step ${stage}`);
  return r;
}

/**
 * Model + effort for a ladder rung. With a policy that lists its models (no "*"), the final model must
 * be on the list: a GPT step without an OpenAI key falls back to Opus only if Opus is listed, and an
 * escalation is checked too; otherwise `blocked` says why (the caller parks, never swaps silently).
 * No policy or "*": the old behaviour (the Opus fallback still noted).
 */
export function modelFor(project: ProjectConfig, stage: string, rung: number, policy?: Pick<Policy, "allowedModels">): { model: string; effort: Effort; singleFamilyNote?: string; blocked?: string } {
  const r = routeFor(project, stage);
  const effort: Effort = rung >= 1 ? "xhigh" : (r.effort ?? "high");
  if (policy && !policy.allowedModels.includes("*")) {
    const want = rung >= 2 && r.escalate[0] ? r.escalate[0] : r.model;
    let model = want, note: string | undefined;
    if (/^gpt|^o\d/.test(want) && !hasSecret("OPENAI_API_KEY")) {
      if (!modelAllowed(policy, OPUS)) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or allow ${OPUS} for this step` };
      model = OPUS;
      note = `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)`;
    }
    if (!modelAllowed(policy, model)) return { model, effort, blocked: blockedText(stage, model, policy) };
    return { model, effort, singleFamilyNote: note };
  }
  let model = r.model;
  let note: string | undefined;
  if (/^gpt|^o\d/.test(model) && !hasSecret("OPENAI_API_KEY")) {
    model = OPUS;
    note = `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)`;
  }
  if (rung >= 2 && r.escalate[0]) model = r.escalate[0];
  return { model, effort, singleFamilyNote: note };
}

/** Rungs this step can use. Other-vendor needs the Codex runner, which isn't built yet. */
export function availableRungs(project: ProjectConfig, stage: string, localOnly: boolean): Set<Rung> {
  const r = project.steps[stage] ?? DEFAULT_ROUTES[stage];
  // deterministic steps (discover, stub-commit, integrate, accept, deliver, cards) have no model: retry only
  if (!r) return new Set<Rung>(["retry"]);
  const s = new Set<Rung>(["retry", "raise-effort"]);
  // localOnly: no escalation to a hosted model
  if (r.escalate.length && (!localOnly || family(r.escalate[0]!) === "local")) s.add("stronger-model");
  // "other-vendor" is added once the Codex runner exists, and never under localOnly.
  return s;
}

/** Start-up checks (adapters.md): thinking steps use api only, coding steps an agent runner, every model has a credential. */
export function checkRoutes(project: ProjectConfig, only?: readonly string[]): string[] {
  const problems: string[] = [];
  const noKey: string[] = [];
  for (const stage of only ?? Object.keys(DEFAULT_ROUTES)) {
    const r = routeFor(project, stage);
    if (THINKING_STEPS.has(stage) && r.runner !== "api") problems.push(`${stage} is a thinking step and must use the api runner`);
    if (CODING_STEPS.has(stage) && r.runner === "api") problems.push(`${stage} is a coding step and needs an agent runner`);
    const { model } = modelFor(project, stage, 0);
    if (model.startsWith("claude-") && !hasSecret("ANTHROPIC_API_KEY")) noKey.push(stage);
    if ((r.runner === "codex" || r.runner === "jcode")) problems.push(`${stage}: the ${r.runner} runner isn't built yet`);
  }
  // one line for a missing key, not one per step
  if (noKey.length) problems.unshift(`ANTHROPIC_API_KEY is missing from ~/.factory/.env (needed by ${noKey.join(", ")})`);
  return [...new Set(problems)];
}
