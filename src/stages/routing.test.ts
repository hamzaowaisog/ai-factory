import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { availableRungs, checkRoutes, DEFAULT_ROUTES, ESTIMATE_ROUTES, lightLaneModel, mechanical, modelFor, projectForRun, resolveRoute, resolveRun, routeFor, routeRecord, routeSource, routeWarnings, usageRoute } from "./routing.js";

const KEYS = ["FACTORY_HOME", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
function cleanEnv(set: Partial<Record<(typeof KEYS)[number], string>> = {}): void {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "routes-"));
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const) { if (set[k]) process.env[k] = set[k]; else delete process.env[k]; }
    _resetEnvCache();
  });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    _resetEnvCache();
  });
}
const project = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet" });
/** the project as a run created before routes were saved reads it */
const old = projectForRun(project, undefined);

describe("start-up route checks", () => {
  cleanEnv();

  it("says a missing key once, naming the steps, instead of one line per step", () => {
    const all = checkRoutes(project);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatch(/^ANTHROPIC_API_KEY is missing/);
    expect(all[0]).toMatch(/implement/);
    // a GPT step no longer runs on Claude when the key is missing: the start is refused
    expect(all[1]).toBe("OPENAI_API_KEY is missing from ~/.factory/.env (needed by specify-other, review)");
  });

  it("an estimate only checks the steps it uses", () => {
    const est = checkRoutes(project, ESTIMATE_ROUTES);
    expect(est).toHaveLength(2);
    expect(est[0]).toMatch(/breakdown/);
    for (const s of ["plan", "author-tests", "implement", "review"]) expect(est.join("\n")).not.toMatch(new RegExp(`\\b${s}\\b`));
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OPENAI_API_KEY = "sk-test";
    _resetEnvCache();
    expect(checkRoutes(project, ESTIMATE_ROUTES)).toEqual([]);
  });
});

describe("which model a step runs on", () => {
  cleanEnv({ ANTHROPIC_API_KEY: "sk-test", OPENAI_API_KEY: "sk-test" });
  const withFile = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet", steps: { plan: { tier: "standard" }, design: { model: "gpt-6-luna" }, critic: { model: "gpt-6-sol" } } });

  it("defaults: each step on its own tier, the reason recorded", () => {
    expect(resolveRoute(project, "intake")).toMatchObject({ model: "claude-haiku-5-5", effort: "low", source: "default", tier: "light", escalate: ["claude-sonnet-5-5"] });
    expect(resolveRoute(project, "implement")).toMatchObject({ runner: "claude-agent", model: "claude-sonnet-5-5", effort: "high", tier: "standard", escalate: ["claude-opus-5-5"] });
    expect(resolveRoute(project, "specify-other")).toMatchObject({ model: "gpt-6-sol", effort: "high", escalate: [] });
    expect(resolveRoute(project, "author-tests")).toMatchObject({ model: "claude-opus-5-5", escalate: [] });
    expect(Object.keys(DEFAULT_ROUTES)).toHaveLength(22);
  });

  it("a pick wins over a preset, a preset over the project file, the file over the default", () => {
    expect(resolveRoute(withFile, "plan")).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium", source: "config", escalate: ["claude-opus-5-5"] });
    expect(resolveRoute(withFile, "plan", { preset: "quality" })).toMatchObject({ model: "claude-opus-5-5", source: "pick", preset: "quality", tier: "heavy" });
    expect(resolveRoute(withFile, "plan", { preset: "quality", picks: { plan: "gpt-6-luna" } })).toMatchObject({ model: "gpt-6-luna", effort: "high", source: "pick", escalate: ["gpt-6-sol"] });
    // a GPT-6 step may end its retries on Claude Opus 5.5
    expect(resolveRoute(project, "design", { picks: { design: "gpt-6-sol" } }).escalate).toEqual(["claude-opus-5-5"]);
    expect(resolveRoute(project, "sketches", undefined, { tier: "heavy", source: "rule" })).toMatchObject({ model: "claude-opus-5-5", source: "rule", tier: "heavy" });
    expect(resolveRoute(withFile, "plan", undefined, { tier: "heavy", source: "rule" }).source).toBe("config");
  });

  it("presets fill every step from the tier table; the test writer never goes light", () => {
    expect(resolveRoute(project, "specify", { preset: "economy" })).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium", tier: "standard" });
    expect(resolveRoute(project, "implement", { preset: "economy" })).toMatchObject({ model: "claude-haiku-5-5", tier: "light" });
    expect(resolveRoute(project, "author-tests", { preset: "economy" })).toMatchObject({ model: "claude-sonnet-5-5", tier: "standard" });
    expect(resolveRoute(project, "specify-other", { preset: "economy" })).toMatchObject({ model: "gpt-6-sol", effort: "medium" });
    // balanced is the defaults
    for (const stage of Object.keys(DEFAULT_ROUTES).filter((s) => s !== "critic")) expect(resolveRoute(project, stage, { preset: "balanced" })).toMatchObject(DEFAULT_ROUTES[stage]!);
  });

  it("the critic is Claude Opus 5.5 whatever the person, the preset or the project file says", () => {
    for (const c of [{}, { preset: "economy" as const }, { picks: { critic: "gpt-6-sol" } }]) expect(resolveRoute(withFile, "critic", c)).toMatchObject({ model: "claude-opus-5-5", effort: "high", source: "fixed" });
    expect(routeFor(withFile, "critic").model).toBe("claude-opus-5-5");
    expect(checkRoutes(project, undefined, { picks: { critic: "gpt-6-sol" } })).toEqual(["critic always runs on Claude Opus 5.5; it cannot be changed"]);
    expect(checkRoutes(withFile).join("\n")).toMatch(/critic always runs on Claude Opus 5.5; remove its entry \(gpt-6-sol\)/);
  });

  it("refuses a pick the step cannot run on, and warns about a spec written by the critic's own model", () => {
    expect(checkRoutes(project, undefined, { picks: { "specify-other": "claude-opus-5-5" } })[0]).toMatch(/specify-other: claude-opus-5-5 is not offered for this step \(choose gpt-6-luna, gpt-6-sol\)/);
    expect(checkRoutes(project, undefined, { picks: { implement: "gpt-6-sol" } })[0]).toMatch(/implement: gpt-6-sol is not offered for this step \(choose claude-opus-5-5, claude-sonnet-5-5\)/);
    expect(checkRoutes(project, undefined, { picks: { plan: "claude-haiku-5-5" } })[0]).toMatch(/not offered/);
    expect(checkRoutes(project, undefined, { picks: { nope: "gpt-6-sol" } })[0]).toMatch(/nope is not a step that takes a model/);
    expect(checkRoutes(project, undefined, { picks: { specify: "gpt-6-sol", implement: "claude-opus-5-5" } })).toEqual([]);
    expect(routeWarnings(project)).toEqual([]);
    expect(routeWarnings(project, { picks: { specify: "claude-opus-5-5" } })).toEqual(["specify on Claude Opus 5.5: the critic is Claude Opus 5.5 too, so it reads a spec its own model wrote"]);
    const claudeDraft = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet", steps: { "specify-other": { model: "claude-opus-5-5" } } });
    expect(checkRoutes(claudeDraft).join("\n")).toMatch(/specify-other is the spec draft from another vendor than the critic .* \(set in the project file\)/);
  });

  it("the project file names a model or a tier, never both, and a tier only for a step the factory knows", () => {
    const bad = (steps: unknown) => ProjectConfig.safeParse({ project: "p", repo: "-", steps }).error?.issues[0]?.message;
    expect(bad({ plan: { model: "gpt-6-sol", tier: "heavy" } })).toMatch(/not both/);
    expect(bad({ plan: { effort: "low" } })).toMatch(/needs a model or a tier/);
    expect(bad({ mine: { tier: "heavy" } })).toMatch(/name the model/);
    expect(bad({ mine: { model: "gpt-6-sol" } })).toMatch(/needs a runner/);
    expect(ProjectConfig.parse({ project: "p", repo: "-", steps: { "author-tests": { tier: "light" } } }).steps["author-tests"]).toMatchObject({ runner: "claude-agent", model: "claude-sonnet-5-5" });
  });

  it("a run keeps the routes it was created with; a run from before the picker keeps the table of that time", () => {
    const run = projectForRun(withFile, resolveRun(project, { picks: { plan: "gpt-6-sol" } }));
    expect(routeFor(run, "plan").model).toBe("gpt-6-sol");
    expect(routeSource(run, "plan")).toEqual({ source: "pick" });
    // the project file changed after the run began: the run does not move
    expect(routeFor(run, "design").model).toBe("claude-opus-5-5");
    expect(routeRecord(run, "plan", 2)).toMatchObject({ model: "claude-opus-5-5", source: "pick", movedUpFrom: "gpt-6-sol" });
    expect(usageRoute(run, "critic")).toEqual({ "factory.route": "critic", "factory.route.source": "fixed" });
    expect(routeFor(old, "intake").model).toBe("claude-haiku-4-5");
    expect(routeFor(old, "critic").model).toBe("gpt-5.5");
    expect(routeSource(old, "critic").source).toBe("before the picker");
    expect(lightLaneModel(old, "specify", 0)).toBe("claude-sonnet-5");
  });

  it("the light lane lowers a step left on its default, and nothing a person or the project file set", () => {
    const run = (c: Parameters<typeof resolveRun>[1]) => projectForRun(project, resolveRun(project, c));
    expect(lightLaneModel(run({}), "specify", 0)).toBe("claude-sonnet-5-5");
    expect(lightLaneModel(run({}), "author-tests", 0)).toBe("claude-sonnet-5-5");
    expect(lightLaneModel(run({}), "author-tests", 2)).toBeUndefined();
    expect(lightLaneModel(run({ picks: { specify: "gpt-6-sol" } }), "specify", 0)).toBeUndefined();
    expect(lightLaneModel(run({ preset: "quality" }), "author-tests", 0)).toBeUndefined();
  });
});

describe("allowed models (policy)", () => {
  cleanEnv();

  it("a GPT step without a key is blocked, never swapped", () => {
    for (const pol of [undefined, { allowedModels: ["*"] }, { allowedModels: ["claude-opus-5-5", "gpt-6-sol"] }]) {
      const r = modelFor(project, "review", 0, pol);
      expect([r.model, r.blocked, r.singleFamilyNote]).toEqual(["gpt-6-sol", "review needs gpt-6-sol but OPENAI_API_KEY is missing from ~/.factory/.env", undefined]);
    }
    expect(modelFor(project, "implement", 2).model).toBe("claude-opus-5-5");
    process.env.OPENAI_API_KEY = "sk-test";
    _resetEnvCache();
    const gpt = modelFor(project, "review", 0, { allowedModels: ["gpt-6-sol"] });
    expect([gpt.model, gpt.blocked]).toEqual(["gpt-6-sol", undefined]);
  });

  it("a run from before the picker: the Opus fallback, noted, and only when the policy lists Opus", () => {
    for (const pol of [undefined, { allowedModels: ["*"] }]) {
      const r = modelFor(old, "critic", 0, pol);
      expect(r.model).toBe("claude-opus-5-5");
      expect(r.blocked).toBeUndefined();
      expect(r.singleFamilyNote).toMatch(/No OpenAI key/);
      expect(modelFor(old, "implement", 2, pol).model).toBe("claude-opus-5-5");
    }
    const ok = modelFor(old, "critic", 0, { allowedModels: ["claude-opus-5-5", "gpt-5.5"] });
    expect([ok.model, ok.blocked]).toEqual(["claude-opus-5-5", undefined]);
    expect(ok.singleFamilyNote).toMatch(/No OpenAI key/);
    expect(modelFor(old, "critic", 0, { allowedModels: ["gpt-5.5", "claude-sonnet-5"] }).blocked)
      .toBe("critic needs gpt-5.5 but OPENAI_API_KEY is missing; add the key or allow claude-opus-5-5 for this step");
    process.env.OPENAI_API_KEY = "sk-test";
    _resetEnvCache();
    const gpt = modelFor(old, "critic", 0, { allowedModels: ["gpt-5.5"] });
    expect([gpt.model, gpt.blocked]).toEqual(["gpt-5.5", undefined]);
  });

  it("checks the route's model and the escalation model", () => {
    const pol = { allowedModels: ["claude-sonnet-5-5"] };
    const r0 = modelFor(project, "implement", 0, pol);
    expect([r0.model, r0.blocked]).toEqual(["claude-sonnet-5-5", undefined]);
    expect(modelFor(project, "implement", 2, pol).blocked).toMatch(/^implement needs claude-opus-5-5 but this run's policy allows only claude-sonnet-5-5/);
    expect(modelFor(project, "plan", 0, pol).blocked).toMatch(/^plan needs claude-opus-5-5/);
  });

  it("localOnly: no escalation to a hosted model", () => {
    expect(availableRungs(project, "implement", false).has("stronger-model")).toBe(true);
    expect(availableRungs(project, "implement", true).has("stronger-model")).toBe(false);
    // the top of a ladder has nowhere to move up to
    expect(availableRungs(project, "plan", false).has("stronger-model")).toBe(false);
  });
});

describe("a retry's effort", () => {
  const f = (check: string) => ({ check });

  it("is raised from the second rung on, unless every failure before it was a mechanical one", () => {
    expect(modelFor(project, "plan", 0).effort).toBe("high");
    expect(modelFor(project, "plan", 1).effort).toBe("xhigh");
    expect(modelFor(project, "plan", 1, undefined, [f("plan-scope")]).effort).toBe("xhigh");
    // an answer that did not fit its shape, money that ran out, an item with nothing against it: thinking harder does not fix these
    expect(modelFor(project, "plan", 1, undefined, [f("plan-coverage"), f("runner-bad-output")]).effort).toBe("high");
    expect(modelFor(project, "author-tests", 2, undefined, [f("ac-coverage"), f("agent-over-budget")]).effort).toBe("high");
    expect(modelFor(project, "sketches", 1, undefined, [f("runner-timeout")]).effort).toBe("medium");
    // one failure that needs thought raises it for the whole attempt
    expect(modelFor(project, "plan", 1, undefined, [f("plan-coverage"), f("plan-scope")]).effort).toBe("xhigh");
    expect(mechanical([])).toBe(false);
  });

  it("a stronger model is still chosen at its rung", () => {
    expect(modelFor(project, "implement", 2, undefined, [f("agent-timeout")])).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
  });
});
