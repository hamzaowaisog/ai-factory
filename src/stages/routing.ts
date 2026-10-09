// Model routing per step (adapters.md config; stages-aligned §2; WD §4 tiers).
import type { ProjectConfig, StepRoute } from "../config/project.js";
import { hasSecret } from "../config/env.js";
import { designRoute } from "../config/design-route.js";
import type { Rung } from "../gates/ladder.js";
import { hasPrice } from "../runners/pricing.js";
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
  // the merge reviewer, deliberately a different family from `review` above: one reviewer run
  // twice has the same blind spots twice.
  // Caveat: without OPENAI_API_KEY, `review` falls back to a Claude model and the two collapse into
  // one family. That is detected rather than ignored — review-2.no-blocking reports "the merge
  // reviewer is the same family as the pre-PR reviewer" on its verdict — but it is a weaker review
  // than the routing implies, so set a project-level route if both keys are not available.
  "review-2": { runner: "api", model: OPUS, escalate: [], effort: "high" },
  /** impact lenses: only when the project turns them on */
  "impact-lens": { runner: "api", model: SONNET, escalate: [], effort: "medium" },
};

export const THINKING_STEPS = new Set(["intake", "ground", "specify", "specify-other", "critic", "plan", "breakdown", "estimate", "design", "design-triage", "design-read", "review", "sketches", "sketch-align", "clarifier", "merge", "restater", "rt-align", "impact", "impact-lens", "review-2"]);
/** The model steps an estimate run uses: it never plans, writes tests or code, or reviews, so it does not need those routes set up. */
export const ESTIMATE_ROUTES = ["intake", "ground", "sketches", "sketch-align", "clarifier", "specify", "specify-other", "merge", "restater", "rt-align", "critic", "breakdown", "estimate", "design", "design-triage", "design-read"] as const;
/** A design-only run: the estimate's steps up to the spec, then the design (no breakdown, no sizing). */
export const DESIGN_ROUTES = ESTIMATE_ROUTES.filter((r) => r !== "breakdown" && r !== "estimate");
export const CODING_STEPS = new Set(["author-tests", "implement", "conflict-resolve"]);

export function routeFor(project: ProjectConfig, stage: string): StepRoute {
  // the design step climbs its engine's tiers, unless the project routes it by hand
  if (stage === "design" && !project.steps.design) return designRoute(project).route;
  const r = project.steps[stage] ?? DEFAULT_ROUTES[stage];
  if (!r) throw new Error(`No model route for step ${stage}`);
  return r;
}

/**
 * Failures that already say exactly what is wrong or missing: the answer did not fit its shape, the money or the turns ran out,
 * or a listed item has nothing against it. More thinking does not fix these, so a retry keeps the step's own effort.
 */
const MECHANICAL = new Set([
  "agent-over-budget", "agent-timeout", "not-executed",
  "ac-coverage", "test-not-found", "missing-test", "plan-coverage", "impact-uncovered", "e2-uncovered", "b1-unmapped", "b1-unknown",
  "design-unmapped", "design-orphan", "design-unknown-req", "design-duplicate-id", "design-duplicate-route", "design-layout",
]);
export const mechanical = (failures: { check: string }[]): boolean =>
  failures.length > 0 && failures.every((f) => f.check.startsWith("runner-") || MECHANICAL.has(f.check));

/**
 * Model + effort for a ladder rung. The effort is raised from rung 1 on, unless every failure of the attempt before (`prior`)
 * is a mechanical one. With a policy that lists its models (no "*"), the final model must
 * be on the list: a GPT step without an OpenAI key falls back to Opus only if Opus is listed, and an
 * escalation is checked too; otherwise `blocked` says why (the caller parks, never swaps silently).
 * No policy or "*": the old behaviour (the Opus fallback still noted).
 */
/** The model a rung runs: the route's own on rungs 0 and 1, then one escalate model per stronger-model rung (the last one stays). */
function wanted(r: StepRoute, rung: number): string {
  return rung >= 2 && r.escalate.length ? r.escalate[Math.min(rung - 2, r.escalate.length - 1)]! : r.model;
}

export function modelFor(project: ProjectConfig, stage: string, rung: number, policy?: Pick<Policy, "allowedModels">, prior: { check: string }[] = []): { model: string; effort: Effort; singleFamilyNote?: string; blocked?: string } {
  const r = routeFor(project, stage);
  const effort: Effort = rung >= 1 && !mechanical(prior) ? "xhigh" : (r.effort ?? "high");
  const want = wanted(r, rung);
  const noOpenAi = /^gpt|^o\d/.test(want) && !hasSecret("OPENAI_API_KEY");
  // a vendor chosen on purpose (a design engine) parks rather than run another vendor's model
  if (noOpenAi && r.strict) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or choose another design engine` };
  if (policy && !policy.allowedModels.includes("*")) {
    let model = want, note: string | undefined;
    if (noOpenAi) {
      if (!modelAllowed(policy, OPUS)) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or allow ${OPUS} for this step` };
      model = OPUS;
      note = `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)`;
    }
    if (!modelAllowed(policy, model)) return { model, effort, blocked: blockedText(stage, model, policy) };
    return { model, effort, singleFamilyNote: note };
  }
  if (noOpenAi) return { model: OPUS, effort, singleFamilyNote: `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)` };
  return { model: want, effort };
}

/** The step's route, or undefined for a deterministic step or a route that cannot be resolved (checkRoutes reports that). */
function routeOrNone(project: ProjectConfig, stage: string): StepRoute | undefined {
  try { return routeFor(project, stage); } catch { return undefined; }
}

/** Rungs this step can use. Other-vendor needs the Codex runner, which isn't built yet. */
export function availableRungs(project: ProjectConfig, stage: string, localOnly: boolean): Set<Rung> {
  const r = routeOrNone(project, stage);
  // deterministic steps (discover, stub-commit, integrate, accept, deliver, cards) have no model: retry only
  if (!r) return new Set<Rung>(["retry"]);
  // a tier ladder steps up after two failures on a tier: no raise-effort rung in between
  const s = new Set<Rung>(r.tiered ? ["retry"] : ["retry", "raise-effort"]);
  // localOnly: no escalation to a hosted model
  if (r.escalate.length && (!localOnly || family(r.escalate[0]!) === "local")) s.add("stronger-model");
  // "other-vendor" is added once the Codex runner exists, and never under localOnly.
  return s;
}

/** Stronger-model rungs the step has (LadderOptions.modelSteps): one per model above the first on a tier ladder, else one. */
export function modelSteps(project: ProjectConfig, stage: string): number {
  const r = routeOrNone(project, stage);
  return r?.tiered ? Math.max(1, r.escalate.length) : 1;
}

/** Start-up checks (adapters.md): thinking steps use api only, coding steps an agent runner, every model has a credential. */
export function checkRoutes(project: ProjectConfig, only?: readonly string[]): string[] {
  const problems: string[] = [];
  const noKey: string[] = [];
  for (const stage of only ?? Object.keys(DEFAULT_ROUTES)) {
    let r: StepRoute;
    try { r = routeFor(project, stage); } catch (e) { problems.push((e as Error).message); continue; }
    if (stage === "design" && !project.steps.design && project.design?.engine === "stitch" && !hasSecret("STITCH_API_KEY")) problems.push("design.engine is stitch, but STITCH_API_KEY is missing from ~/.factory/.env");
    if (THINKING_STEPS.has(stage) && r.runner !== "api") problems.push(`${stage} is a thinking step and must use the api runner`);
    if (CODING_STEPS.has(stage) && r.runner === "api") problems.push(`${stage} is a coding step and needs an agent runner`);
    const { model, blocked } = modelFor(project, stage, 0);
    if (blocked) problems.push(blocked);
    if (model.startsWith("claude-") && !hasSecret("ANTHROPIC_API_KEY")) noKey.push(stage);
    // every model on a tier ladder is costed, so the caps never fall back to the unknown-model rate
    if (r.tiered || r.strict) for (const m of [r.model, ...r.escalate]) if (!hasPrice(m) && !project.prices[m]) problems.push(`${stage}: ${m} has no price; add it under prices so the cost caps hold`);
    if ((r.runner === "codex" || r.runner === "jcode")) problems.push(`${stage}: the ${r.runner} runner isn't built yet`);
  }
  // one line for a missing key, not one per step
  if (noKey.length) problems.unshift(`ANTHROPIC_API_KEY is missing from ~/.factory/.env (needed by ${noKey.join(", ")})`);
  return [...new Set(problems)];
}
