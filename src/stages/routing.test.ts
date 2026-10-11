import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { availableRungs, checkRoutes, DEFAULT_ROUTES, ESTIMATE_ROUTES, lightLaneModel, mechanical, modelFor, modelSteps, modelsView, projectForRun, resolveRoute, resolveRun, routeFor, routeRecord, routeSource, routeWarnings, usageRoute } from "./routing.js";

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

  it("a GPT model picked for a coding step runs in the Codex agent, and a retry that moves up to Claude runs in the Claude one", () => {
    const picks = { implement: "gpt-6-sol", "author-tests": "gpt-6-sol" };
    expect(checkRoutes(project, undefined, { picks })).toEqual([]);
    expect(resolveRoute(project, "implement", { picks })).toMatchObject({ runner: "codex", model: "gpt-6-sol", effort: "high", escalate: ["claude-opus-5-5"], source: "pick" });
    // the test writer's own ladder is Claude's: on GPT-6 Sol it has no stronger model to move to
    expect(resolveRoute(project, "author-tests", { picks })).toMatchObject({ runner: "codex", model: "gpt-6-sol", escalate: [] });
    // GPT-6 Luna moves up to GPT-6 Sol, still in the Codex agent
    expect(resolveRoute(project, "implement", { picks: { implement: "gpt-6-luna" } })).toMatchObject({ runner: "codex", model: "gpt-6-luna", escalate: ["gpt-6-sol"] });
    expect(resolveRoute(project, "author-tests", { picks: { "author-tests": "gpt-6-luna" } })).toMatchObject({ runner: "codex", model: "gpt-6-luna", escalate: [] });
    // the defaults and the presets keep coding on Claude
    for (const preset of [undefined, "economy", "balanced", "quality"] as const) for (const step of ["implement", "author-tests"]) expect(resolveRoute(project, step, preset ? { preset } : {}).runner).toBe("claude-agent");
    const run = projectForRun(project, resolveRun(project, { picks }));
    expect(routeFor(run, "implement")).toMatchObject({ runner: "codex", model: "gpt-6-sol" });
    expect(modelFor(run, "implement", 0).model).toBe("gpt-6-sol");
    expect(modelFor(run, "implement", 2).model).toBe("claude-opus-5-5");
    // a project file that names a GPT model for a coding step gets the Codex runner without naming it
    expect(ProjectConfig.parse({ project: "p", repo: "-", steps: { implement: { model: "gpt-6-sol" } } }).steps.implement).toMatchObject({ runner: "codex", model: "gpt-6-sol" });
    expect(checkRoutes({ ...project, steps: { plan: { runner: "codex", model: "gpt-6-sol", escalate: [] } } } as ProjectConfig).join("\n")).toMatch(/plan: the codex runner is for coding steps/);
    expect(modelsView(undefined).steps.find((s) => s.step === "implement")!.offered).toEqual(["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  it("refuses a pick the step cannot run on, and warns about a spec written by the critic's own model", () => {
    expect(checkRoutes(project, undefined, { picks: { "specify-other": "claude-opus-5-5" } })[0]).toMatch(/specify-other: claude-opus-5-5 is not offered for this step \(choose gpt-6-luna, gpt-6-sol\)/);
    expect(checkRoutes(project, undefined, { picks: { implement: "claude-haiku-5-5" } })[0]).toMatch(/implement: claude-haiku-5-5 is not offered for this step \(choose gpt-6-luna, gpt-6-sol, claude-opus-5-5, claude-sonnet-5-5\)/);
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

describe("design tier routes", () => {
  const saved = { home: process.env.FACTORY_HOME, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  beforeEach(() => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "routes-"));
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.OPENAI_API_KEY;
    _resetEnvCache();
  });
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["ANTHROPIC_API_KEY", saved.a], ["OPENAI_API_KEY", saved.o]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache();
  });
  const cfg = (extra: Record<string, unknown> = {}) => ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet", ...extra });
  const openai = { design: { engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" }, standard: { openai: "gpt-6-sol" } } } };
  const prices = { prices: { "gpt-6-luna": { input: 0.2, output: 1.2 }, "gpt-6-sol": { input: 4, output: 20 } } };

  it("keeps today's design route and rungs when the project pins nothing", () => {
    const p = cfg();
    expect(modelFor(p, "design", 0).model).toBe("claude-opus-5-5");
    expect(modelFor(p, "design", 2).model).toBe("claude-opus-5-5");
    expect([...availableRungs(p, "design", false)]).toEqual(["retry", "raise-effort"]);
    expect(modelSteps(p, "design")).toBe(1);
  });

  it("climbs one model per stronger-model rung, without a raise-effort rung", () => {
    process.env.OPENAI_API_KEY = "sk-o"; _resetEnvCache();
    const p = cfg({ ...openai, ...prices });
    expect([0, 2, 3, 4].map((r) => modelFor(p, "design", r).model)).toEqual(["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5", "claude-opus-5-5"]);
    expect([...availableRungs(p, "design", false)]).toEqual(["retry", "stronger-model"]);
    expect(modelSteps(p, "design")).toBe(2);
  });

  it("parks an openai design without a key instead of running Opus", () => {
    const p = cfg({ ...openai, ...prices });
    const r = modelFor(p, "design", 0);
    expect(r.blocked).toMatch(/OPENAI_API_KEY/);
    expect(r.model).toBe("gpt-6-luna");
    expect(checkRoutes(p, ["design"]).join("\n")).toMatch(/OPENAI_API_KEY/);
  });

  it("reports an unpriced ladder model at start-up", () => {
    process.env.OPENAI_API_KEY = "sk-o"; _resetEnvCache();
    // GPT-6 is priced now (the model picker): an id the table does not hold stands in for an unpriced model
    const unpriced = { design: { engine: "openai", tier: "light", tiers: { light: { openai: "gpt-x-unpriced" } } } };
    expect(checkRoutes(cfg(unpriced), ["design"]).join("\n")).toMatch(/gpt-x-unpriced has no price/);
    expect(checkRoutes(cfg({ ...openai, ...prices }), ["design"])).toEqual([]);
  });

  it("reports stitch without allowStitch or without its key at start-up", () => {
    expect(checkRoutes(cfg({ design: { engine: "stitch" } }), ["design"]).join("\n")).toMatch(/allowStitch/);
    expect(checkRoutes(cfg({ design: { engine: "stitch", allowStitch: true } }), ["design"]).join("\n")).toMatch(/STITCH_API_KEY/);
    process.env.STITCH_API_KEY = "st"; _resetEnvCache();
    expect(checkRoutes(cfg({ design: { engine: "stitch", allowStitch: true } }), ["design"])).toEqual([]);
    delete process.env.STITCH_API_KEY; _resetEnvCache();
  });

  it("keeps a design route the project set by hand", () => {
    const p = cfg({ design: { engine: "claude", tier: "standard" }, steps: { design: { runner: "api", model: "claude-sonnet-5", escalate: [] } } });
    expect(routeFor(p, "design")).toMatchObject({ model: "claude-sonnet-5", escalate: [] });
    expect(routeFor(p, "design").tiered).toBeUndefined();
  });

  it("leaves other steps' escalation as it was", () => {
    expect(modelFor(cfg(), "implement", 2).model).toBe("claude-opus-5-5");
    expect(modelSteps(cfg(), "implement")).toBe(1);
  });
});
