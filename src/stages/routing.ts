// Model routing per step (adapters.md config; stages-aligned §2; WD §4 tiers).
import type { ProjectConfig, RunRoutes, StepRoute } from "../config/project.js";
import { hasSecret } from "../config/env.js";
import { designRoute } from "../config/design-route.js";
import type { Rung } from "../gates/ladder.js";
import { hasPrice } from "../runners/pricing.js";
import { tasteSkillProblem } from "../design/stitch-taste.js";
import { uiuxProblem } from "../design/uiux-skill.js";
import { blockedText, modelAllowed, type Policy } from "../gates/policy.js";
import { family, type Effort } from "../runners/types.js";
import { priceOf, UNCONFIRMED_PRICES } from "../runners/pricing.js";
import { heldTier, modelInfo, modelName, nextUp, offeredFor, OPUS, PRESETS, presetTier, runnerFor, STEPS, TIER_TABLE, type Preset, type RouteSource, type StepSpec, type Tier, type Vendor } from "./models.js";

const OLD_OPUS = "claude-opus-5-5";
const OLD_SONNET = "claude-sonnet-5";
const OLD_HAIKU = "claude-haiku-4-5";

/**
 * The routing table before a run saved its own routes. A run created then is read with this table, so a parked
 * one resumes on the models it began with: a completed step is not run and billed again.
 */
export const LEGACY_ROUTES: Record<string, StepRoute> = {
  intake: { runner: "api", model: OLD_HAIKU, escalate: [OLD_SONNET], effort: "low" },
  ground: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  sketches: { runner: "api", model: OLD_SONNET, escalate: [], effort: "medium" },
  "sketch-align": { runner: "api", model: OLD_HAIKU, escalate: [OLD_SONNET], effort: "low" },
  clarifier: { runner: "api", model: OLD_OPUS, escalate: [], effort: "medium" },
  specify: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  "specify-other": { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
  merge: { runner: "api", model: OLD_OPUS, escalate: [], effort: "medium" },
  restater: { runner: "api", model: OLD_SONNET, escalate: [], effort: "low" },
  "rt-align": { runner: "api", model: OLD_HAIKU, escalate: [OLD_SONNET], effort: "low" },
  critic: { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
  breakdown: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  estimate: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  design: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  "design-triage": { runner: "api", model: OLD_HAIKU, escalate: [OLD_SONNET], effort: "low" },
  "design-read": { runner: "api", model: OLD_SONNET, escalate: [OLD_OPUS], effort: "medium" },
  plan: { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  "author-tests": { runner: "claude-agent", model: OLD_OPUS, escalate: [], effort: "high" },
  implement: { runner: "claude-agent", model: OLD_SONNET, escalate: [OLD_OPUS], effort: "high" },
  review: { runner: "api", model: "gpt-5.5", escalate: [], effort: "high" },
  "review-2": { runner: "api", model: OLD_OPUS, escalate: [], effort: "high" },
  "impact-lens": { runner: "api", model: OLD_SONNET, escalate: [], effort: "medium" },
};

/** What the person starting a run chose: a model for some steps, and a preset for the rest. */
export interface Choice { picks?: Record<string, string>; preset?: Preset }
/** A tier put forward for a step by something other than a person (the plan's task size, a rule, a recommendation). */
export interface Suggestion { tier: Tier; source: Extract<RouteSource, "recommended" | "plan size" | "rule"> }
/** A step's route with where it came from. */
export interface Resolved extends StepRoute { source: RouteSource; tier?: Tier; preset?: Preset }

const esc = (stage: string, model: string): string[] => { const n = nextUp(stage, model); return n ? [n] : []; };

function fromTier(stage: string, spec: StepSpec, tier: Tier): Pick<Resolved, "runner" | "model" | "escalate" | "effort" | "tier"> {
  const t = TIER_TABLE[spec.vendor][tier];
  // on its own tier a step keeps the effort it was tuned for; moved to another, it takes that tier's
  const effort = tier === spec.tier ? spec.effort ?? t.effort : t.effort ?? spec.effort;
  return { runner: runnerFor(stage, t.model), model: t.model, escalate: esc(stage, t.model), effort: effort ?? "high", tier };
}

/**
 * Which model a step runs on and why, in this order: a fixed step's own model; the person's pick; their preset;
 * the project file; a suggested tier; the built-in default. Read once, when a run is created.
 */
export function resolveRoute(project: ProjectConfig, stage: string, choice: Choice = {}, suggest?: Suggestion): Resolved {
  const spec = STEPS[stage];
  const own = project.steps[stage];
  if (!spec) {
    if (!own) throw new Error(`No model route for step ${stage}`);
    return { ...own, source: "config" };
  }
  if (spec.fixed) return { runner: spec.runner, model: spec.fixed, escalate: [], effort: spec.effort ?? "high", source: "fixed" };
  const pick = choice.picks?.[stage];
  if (pick) return { runner: runnerFor(stage, pick), model: pick, escalate: esc(stage, pick), effort: spec.effort ?? "high", source: "pick" };
  // a design engine or tier the project pinned is not undone by a preset: only a pick for the step itself changes it
  if (stage === "design" && !own && (project.design?.engine || project.design?.tier)) return { ...designRoute(project).route, source: "design engine" };
  const preset = choice.preset ? presetTier(stage, choice.preset) : undefined;
  if (preset) return { ...fromTier(stage, spec, preset), source: "pick", preset: choice.preset };
  if (own) return { ...own, source: "config" };
  // the design step nobody routed by hand climbs its design engine's tiers (src/config/design-route.ts)
  if (stage === "design") return { ...designRoute(project).route, source: "design engine" };
  if (suggest) return { ...fromTier(stage, spec, heldTier(stage, suggest.tier)), source: suggest.source };
  return { ...fromTier(stage, spec, spec.tier), source: "default" };
}

/** The built-in defaults: every step on its own tier. */
export const DEFAULT_ROUTES: Record<string, StepRoute> = Object.fromEntries(Object.keys(STEPS).map((stage) => {
  const { runner, model, escalate, effort } = resolveRoute({ steps: {} } as unknown as ProjectConfig, stage);
  return [stage, { runner, model, escalate, ...(effort ? { effort } : {}) }];
}));

/** Every step's route for a new run. Saved in the run's first ledger event; the run reads them from there from then on. */
export function resolveRun(project: ProjectConfig, choice: Choice = {}): Record<string, Resolved> {
  return Object.fromEntries([...new Set([...Object.keys(STEPS), ...Object.keys(project.steps)])].map((stage) => [stage, resolveRoute(project, stage, choice)]));
}

/**
 * The project as one run reads it: its steps are the routes saved when the run was created. A run from before
 * routes were saved gets the table of that time (LEGACY_ROUTES) under the project file's own entries.
 */
export function projectForRun(project: ProjectConfig, saved: Record<string, Resolved> | undefined): ProjectConfig {
  if (!saved) {
    const steps = { ...LEGACY_ROUTES, ...project.steps };
    return { ...project, steps, runRoutes: { legacy: true, steps: Object.fromEntries(Object.keys(steps).map((k) => [k, { source: project.steps[k] ? "config" : "before the picker" }])) } };
  }
  const steps: Record<string, StepRoute> = {}, how: RunRoutes["steps"] = {};
  for (const [stage, r] of Object.entries(saved)) {
    steps[stage] = { runner: r.runner, model: r.model, escalate: r.escalate, ...(r.effort ? { effort: r.effort } : {}), ...(r.tiered ? { tiered: true } : {}), ...(r.strict ? { strict: true } : {}) };
    how[stage] = { source: r.source, ...(r.tier ? { tier: r.tier } : {}), ...(r.preset ? { preset: r.preset } : {}) };
  }
  // a step added to the project file after the run began: read as the file has it
  for (const [stage, r] of Object.entries(project.steps)) if (!steps[stage] && !STEPS[stage]) { steps[stage] = r; how[stage] = { source: "config" }; }
  return { ...project, steps, runRoutes: { legacy: false, steps: how } };
}

/**
 * Whether the design step draws with its design engine (design.engine, design.tier): not when a person picked its model, a
 * preset or the project's steps routed it, or the run began before the picker.
 */
export function usesDesignEngine(project: ProjectConfig): boolean {
  if (!project.runRoutes) return !project.steps.design;
  return !project.runRoutes.legacy && project.runRoutes.steps.design?.source === "design engine";
}

/** Where a step's model came from, for the ledger and the run page. */
export function routeSource(project: ProjectConfig, stage: string): { source: string; tier?: string; preset?: string } {
  const saved = project.runRoutes?.steps[stage];
  if (saved) return saved;
  if (STEPS[stage]?.fixed) return { source: "fixed" };
  if (project.steps[stage]) return { source: "config" };
  return { source: "default", ...(STEPS[stage] ? { tier: STEPS[stage]!.tier } : {}) };
}

/**
 * A light-lane step left on its default runs on the standard tier, not the heavy one: the work is small. A pick,
 * a preset or the project file is kept as it is.
 */
export function lightLaneModel(project: ProjectConfig, stage: "specify" | "author-tests", rung: number): string | undefined {
  // a run from before the picker: Sonnet 5 (the spec draft on every attempt and whatever the project file said)
  if (project.runRoutes?.legacy) return stage === "specify" || (rung < 2 && routeSource(project, stage).source !== "config") ? OLD_SONNET : undefined;
  // a retry that moves a model up goes back to the step's own
  if (rung >= 2 || routeSource(project, stage).source !== "default") return undefined;
  return TIER_TABLE[STEPS[stage]!.vendor].standard.model;
}

export const THINKING_STEPS = new Set(["intake", "ground", "specify", "specify-other", "critic", "plan", "breakdown", "estimate", "design", "design-triage", "design-read", "review", "sketches", "sketch-align", "clarifier", "merge", "restater", "rt-align", "impact", "impact-lens", "review-2"]);
/** The model steps an estimate run uses: it never plans, writes tests or code, or reviews, so it does not need those routes set up. */
export const ESTIMATE_ROUTES = ["intake", "ground", "sketches", "sketch-align", "clarifier", "specify", "specify-other", "merge", "restater", "rt-align", "critic", "breakdown", "estimate", "design", "design-triage", "design-read"] as const;
/** A design-only run: the estimate's steps up to the spec, then the design (no breakdown, no sizing). */
export const DESIGN_ROUTES = ESTIMATE_ROUTES.filter((r) => r !== "breakdown" && r !== "estimate");
export const CODING_STEPS = new Set(["author-tests", "implement", "conflict-resolve"]);

/** The model steps a run of this kind uses. */
export function stepsOf(mode: string | undefined): string[] {
  if (mode === "estimate") return [...ESTIMATE_ROUTES];
  if (mode === "design") return [...DESIGN_ROUTES];
  return Object.keys(STEPS);
}

/** What the start form shows: every step with its default, the models it can be given, and what each preset puts it on. */
export function modelsView(mode: string | undefined): { steps: { step: string; group: string; model: string; effort: string; fixed: boolean; offered: string[]; presets: Record<Preset, string>; warn?: { model: string; why: string } }[]; presets: readonly Preset[]; models: { id: string; name: string; input: number; output: number; unconfirmed: boolean }[] } {
  const none = { steps: {} } as unknown as ProjectConfig;
  const steps = stepsOf(mode).map((step) => {
    const spec = STEPS[step]!, r = resolveRoute(none, step);
    return {
      step, group: spec.group, model: r.model, effort: r.effort ?? "high", fixed: !!spec.fixed, offered: offeredFor(step).map((m) => m.id),
      presets: Object.fromEntries(PRESETS.map((p) => [p, resolveRoute(none, step, { preset: p }).model])) as Record<Preset, string>,
      ...(spec.warn ? { warn: { model: OPUS, why: spec.warn.why } } : {}),
    };
  });
  const ids = [...new Set(steps.flatMap((s) => [s.model, ...s.offered, ...Object.values(s.presets)]))];
  return { steps, presets: PRESETS, models: ids.map((id) => { const p = priceOf(id); return { id, name: modelName(id), input: p.input, output: p.output, unconfirmed: UNCONFIRMED_PRICES.includes(id) }; }) };
}

export function routeFor(project: ProjectConfig, stage: string): StepRoute {
  // a fixed step is not the project file's to change (a run from before the picker keeps what it had)
  // a design step outside a run (no saved routes) climbs its design engine's tiers, as resolveRoute would give it
  if (stage === "design" && !project.steps.design && !project.runRoutes) return designRoute(project).route;
  const r = (STEPS[stage]?.fixed && !project.runRoutes ? undefined : project.steps[stage]) ?? DEFAULT_ROUTES[stage];
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

const openAi = (model: string): boolean => /^gpt|^o\d/.test(model);

/**
 * Model + effort for a ladder rung. The effort is raised from rung 1 on, unless every failure of the attempt before (`prior`)
 * is a mechanical one; from rung 2 the step moves one model up its ladder. A GPT step without an OpenAI key is `blocked`
 * (the caller parks, never swaps silently), and so is a model a listed policy does not hold.
 * A run from before the picker keeps the behaviour it began with: its GPT steps run on Claude Opus when the key is missing, and say so.
 */
/** The model a rung runs: the route's own on rungs 0 and 1, then one escalate model per stronger-model rung (the last one stays). */
function wanted(r: StepRoute, rung: number): string {
  return rung >= 2 && r.escalate.length ? r.escalate[Math.min(rung - 2, r.escalate.length - 1)]! : r.model;
}

export function modelFor(project: ProjectConfig, stage: string, rung: number, policy?: Pick<Policy, "allowedModels">, prior: { check: string }[] = []): { model: string; effort: Effort; singleFamilyNote?: string; blocked?: string } {
  const r = routeFor(project, stage);
  const effort: Effort = rung >= 1 && !mechanical(prior) ? "xhigh" : (r.effort ?? "high");
  const listed = policy && !policy.allowedModels.includes("*") ? policy : undefined;
  const legacy = project.runRoutes?.legacy === true;
  const want = rung >= 2 && r.escalate[0] && (listed || !legacy) ? wanted(r, rung) : r.model;
  let model = want, note: string | undefined;
  if (openAi(want) && !hasSecret("OPENAI_API_KEY")) {
    // a vendor chosen on purpose (a design engine) parks rather than run another vendor's model
    if (!legacy || r.strict) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing from ~/.factory/.env` };
    if (listed && !modelAllowed(listed, OLD_OPUS)) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or allow ${OLD_OPUS} for this step` };
    model = OLD_OPUS;
    note = `No OpenAI key: ${stage} ran on ${OLD_OPUS} (same family as the implementer)`;
  }
  if (legacy && !listed && rung >= 2 && r.escalate[0]) model = r.escalate[0];
  if (listed && !modelAllowed(listed, model)) return { model, effort, blocked: blockedText(stage, model, listed) };
  return { model, effort, singleFamilyNote: note };
}

/** The step's route, or undefined for a deterministic step or a route that cannot be resolved (checkRoutes reports that). */
function routeOrNone(project: ProjectConfig, stage: string): StepRoute | undefined {
  try { return routeFor(project, stage); } catch { return undefined; }
}

/** The route a model call was made on and where that route came from, as fields of a usage event. */
export function usageRoute(project: ProjectConfig, route: string): Record<string, string> {
  if (!project.steps[route] && !DEFAULT_ROUTES[route]) return {};
  const { source, tier, preset } = routeSource(project, route);
  return { "factory.route": route, "factory.route.source": source, ...(tier ? { "factory.route.tier": tier } : {}), ...(preset ? { "factory.route.preset": preset } : {}) };
}

/** What a step is about to run on, for the ledger: the model and effort of this rung, and where the route came from. */
export function routeRecord(project: ProjectConfig, stage: string, rung: number, prior: { check: string }[] = []): Record<string, unknown> | undefined {
  if (!project.steps[stage] && !DEFAULT_ROUTES[stage]) return undefined;
  const { model, effort } = modelFor(project, stage, rung, undefined, prior);
  return { model, effort, ...routeSource(project, stage), ...(rung >= 2 && model !== routeFor(project, stage).model ? { movedUpFrom: routeFor(project, stage).model } : {}) };
}

/** Rungs this step can use. */
export function availableRungs(project: ProjectConfig, stage: string, localOnly: boolean): Set<Rung> {
  const r = routeOrNone(project, stage);
  // deterministic steps (discover, stub-commit, integrate, accept, deliver, cards) have no model: retry only
  if (!r) return new Set<Rung>(["retry"]);
  // a tier ladder steps up after two failures on a tier: no raise-effort rung in between
  const s = new Set<Rung>(r.tiered ? ["retry"] : ["retry", "raise-effort"]);
  // localOnly: no escalation to a hosted model
  if (r.escalate.length && (!localOnly || family(r.escalate[0]!) === "local")) s.add("stronger-model");
  // "other-vendor" is not a rung yet: a person picks the other vendor's model at the start of a run.
  return s;
}

/** Stronger-model rungs the step has (LadderOptions.modelSteps): one per model above the first on a tier ladder, else one. */
export function modelSteps(project: ProjectConfig, stage: string): number {
  const r = routeOrNone(project, stage);
  return r?.tiered ? Math.max(1, r.escalate.length) : 1;
}

/** A model named by a person or a project file for a step the factory knows: why it cannot run there, if it cannot. */
function refusal(stage: string, model: string, by: "pick" | "config"): string | undefined {
  const spec = STEPS[stage];
  if (!spec) return by === "pick" ? `${stage} is not a step that takes a model (see factory models)` : undefined;
  if (spec.fixed) return by === "pick" ? `${stage} always runs on ${modelName(spec.fixed)}; it cannot be changed` : undefined;
  const info = modelInfo(model);
  if (by === "pick" && !offeredFor(stage).some((m) => m.id === model)) return `${stage}: ${model} is not offered for this step (choose ${offeredFor(stage).map((m) => m.id).join(", ")})`;
  const vendor = info?.vendor ?? (family(model) === "local" ? undefined : family(model));
  if (spec.only && vendor && !spec.only.includes(vendor as Vendor)) {
    return stage === "specify-other" ? `specify-other is the spec draft from another vendor than the critic (${modelName(OPUS)}); it needs a GPT-6 model, not ${model}`
      : `${stage}: ${model} cannot run this step (it needs a model from ${spec.only.join(" or ")})`;
  }
  return undefined;
}

/** What a choice is allowed but warned about: a spec written by the same model that criticises it. */
export function routeWarnings(project: ProjectConfig, choice: Choice = {}, only?: readonly string[]): string[] {
  const out: string[] = [];
  for (const stage of only ?? Object.keys(STEPS)) {
    const w = STEPS[stage]?.warn;
    if (!w) continue;
    const r = resolveRoute(project, stage, choice);
    if (r.source !== "default" && r.model === OPUS && w.vendor === "anthropic") out.push(`${stage} on ${modelName(r.model)}: ${w.why}`);
  }
  return out;
}

/**
 * Start-up checks (adapters.md): thinking steps use api only, coding steps an agent runner, every model has a credential,
 * and every pick is a model that step may run on. `choice` is what the person starting the run chose.
 */
export function checkRoutes(project: ProjectConfig, only?: readonly string[], choice: Choice = {}): string[] {
  const problems: string[] = [];
  const noKey: Record<"ANTHROPIC_API_KEY" | "OPENAI_API_KEY", string[]> = { ANTHROPIC_API_KEY: [], OPENAI_API_KEY: [] };
  if (choice.preset && !PRESETS.includes(choice.preset)) problems.push(`No preset "${choice.preset}" (choose ${PRESETS.join(", ")})`);
  for (const [stage, model] of Object.entries(choice.picks ?? {})) {
    const why = refusal(stage, model, "pick");
    if (why) problems.push(why);
  }
  if (problems.length) return problems;
  for (const stage of only ?? Object.keys(DEFAULT_ROUTES)) {
    let r: Resolved;
    try { r = resolveRoute(project, stage, choice); } catch (e) { problems.push((e as Error).message); continue; }
    if (r.source === "config") {
      const why = refusal(stage, r.model, "config");
      if (why) problems.push(`${why} (set in the project file)`);
    }
    if (stage === "design" && r.source === "design engine" && project.design?.engine === "stitch") {
      if (!hasSecret("STITCH_API_KEY")) problems.push("design.engine is stitch, but STITCH_API_KEY is missing from ~/.factory/.env");
      const skill = tasteSkillProblem();
      if (skill) problems.push(skill);
    } else if (stage === "design") {
      // the JSON track runs the ui-ux-pro-max skill's search: only the reviewed copy
      const ux = uiuxProblem();
      if (ux) problems.push(`design: ${ux}`);
    }
    if (STEPS[stage]?.fixed && project.steps[stage] && project.steps[stage]!.model !== r.model) problems.push(`${stage} always runs on ${modelName(r.model)}; remove its entry (${project.steps[stage]!.model}) from the project file's steps`);
    if (THINKING_STEPS.has(stage) && r.runner !== "api") problems.push(`${stage} is a thinking step and must use the api runner`);
    if (CODING_STEPS.has(stage) && r.runner === "api") problems.push(`${stage} is a coding step and needs an agent runner`);
    if (r.model.startsWith("claude-") && !hasSecret("ANTHROPIC_API_KEY")) noKey.ANTHROPIC_API_KEY.push(stage);
    if (openAi(r.model) && !hasSecret("OPENAI_API_KEY")) noKey.OPENAI_API_KEY.push(stage);
    // every model on a tier ladder is costed, so the caps never fall back to the unknown-model rate
    if (r.tiered || r.strict) for (const m of [r.model, ...r.escalate]) if (!hasPrice(m) && !project.prices[m]) problems.push(`${stage}: ${m} has no price; add it under prices so the cost caps hold`);
    if (r.runner === "jcode") problems.push(`${stage}: the jcode runner isn't built yet`);
    if (r.runner === "codex" && !CODING_STEPS.has(stage)) problems.push(`${stage}: the codex runner is for coding steps`);
  }
  // one line for a missing key, not one per step
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const) if (noKey[key].length) problems.unshift(`${key} is missing from ~/.factory/.env (needed by ${noKey[key].join(", ")})`);
  return [...new Set(problems)];
}

/** A choice as it arrives from a form, a tool call or a saved file: { preset?, picks?: { step: model } }. Anything else in it is dropped; the start check judges what is left. */
export function choiceFrom(raw: unknown): Choice {
  const m = (raw && typeof raw === "object" ? raw : {}) as { preset?: unknown; picks?: unknown };
  const picks = Object.fromEntries(Object.entries(m.picks && typeof m.picks === "object" ? m.picks : {}).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v)]));
  return { ...(Object.keys(picks).length ? { picks } : {}), ...(typeof m.preset === "string" && m.preset ? { preset: m.preset as Preset } : {}) };
}

export interface RunModels {
  /** false for a run from before routes were saved with a run: it has no rows, only calls */
  saved: boolean;
  preset?: Preset;
  /** each step's route as saved when the run was created */
  rows: { step: string; model: string; name: string; effort: string; source: string; tier?: string; preset?: string; next?: string }[];
  /** what was called: one line per route, model that answered and source, dearest first */
  calls: { route: string; model: string; name: string; source: string; calls: number; input: number; output: number; usd: number }[];
  /** every retry that moved a step to another model */
  moved: { step: string; from: string; to: string }[];
}

/** What a run's ledger says about its models (the run page and `factory models --run`). */
export function runModels(events: { type: string; key?: string; data?: Record<string, unknown> }[]): RunModels {
  const info = (events[0]?.data ?? {}) as { routes?: Record<string, Resolved>; models?: Choice; mode?: string };
  const rows = info.routes ? stepsOf(info.mode).filter((s) => info.routes![s]).map((s) => {
    const r = info.routes![s]!;
    return { step: s, model: r.model, name: modelName(r.model), effort: r.effort ?? "high", source: r.source, ...(r.tier ? { tier: r.tier } : {}), ...(r.preset ? { preset: r.preset } : {}), ...(r.escalate[0] ? { next: r.escalate[0] } : {}) };
  }) : [];
  const by = new Map<string, RunModels["calls"][number]>();
  for (const e of events) {
    if (e.type !== "usage") continue;
    const d = e.data ?? {};
    const route = String(d["factory.route"] ?? (e.key ?? "").split("/")[0] ?? "?"), model = String(d["gen_ai.request.model"] ?? "?"), source = String(d["factory.route.source"] ?? "-");
    const k = [route, model, source].join("\t");
    const a = by.get(k) ?? { route, model, name: modelName(model), source, calls: 0, input: 0, output: 0, usd: 0 };
    a.calls++;
    a.input += Number(d["gen_ai.usage.input_tokens"] ?? 0) + Number(d["gen_ai.usage.cache_read_tokens"] ?? 0) + Number(d["gen_ai.usage.cache_write_tokens"] ?? 0);
    a.output += Number(d["gen_ai.usage.output_tokens"] ?? 0);
    a.usd += Number(d["gen_ai.usage.cost_usd"] ?? 0);
    by.set(k, a);
  }
  const moved = events.flatMap((e) => {
    const r = e.type === "step.started" ? (e.data?.route as { model?: string; movedUpFrom?: string } | undefined) : undefined;
    return r?.movedUpFrom && r.model ? [{ step: e.key ?? "", from: r.movedUpFrom, to: r.model }] : [];
  });
  return { saved: !!info.routes, ...(info.models?.preset ? { preset: info.models.preset } : {}), rows, calls: [...by.values()].sort((a, b) => b.usd - a.usd), moved };
}
