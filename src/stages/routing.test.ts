import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { availableRungs, checkRoutes, ESTIMATE_ROUTES, mechanical, modelFor, modelSteps, routeFor } from "./routing.js";

describe("start-up route checks", () => {
  const saved = { home: process.env.FACTORY_HOME, key: process.env.ANTHROPIC_API_KEY };
  beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "routes-")); delete process.env.ANTHROPIC_API_KEY; _resetEnvCache(); });
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["ANTHROPIC_API_KEY", saved.key]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache();
  });
  const project = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet" });

  it("says a missing key once, naming the steps, instead of one line per step", () => {
    const all = checkRoutes(project);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatch(/^ANTHROPIC_API_KEY is missing/);
    expect(all[0]).toMatch(/implement/);
  });

  it("an estimate only checks the steps it uses", () => {
    const est = checkRoutes(project, ESTIMATE_ROUTES);
    expect(est).toHaveLength(1);
    expect(est[0]).toMatch(/breakdown/);
    for (const s of ["plan", "author-tests", "implement", "review"]) expect(est[0]).not.toMatch(new RegExp(`\\b${s}\\b`));
    process.env.ANTHROPIC_API_KEY = "sk-test";
    _resetEnvCache();
    expect(checkRoutes(project, ESTIMATE_ROUTES)).toEqual([]);
  });
});

describe("allowed models (policy)", () => {
  const saved = { home: process.env.FACTORY_HOME, key: process.env.OPENAI_API_KEY };
  beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "routes-")); delete process.env.OPENAI_API_KEY; _resetEnvCache(); });
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["OPENAI_API_KEY", saved.key]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache();
  });
  const project = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet" });

  it("no list (\"*\" or no policy): the old behaviour, the Opus fallback noted", () => {
    for (const pol of [undefined, { allowedModels: ["*"] }]) {
      const r = modelFor(project, "critic", 0, pol);
      expect(r.model).toBe("claude-opus-5-5");
      expect(r.blocked).toBeUndefined();
      expect(r.singleFamilyNote).toMatch(/No OpenAI key/);
      expect(modelFor(project, "implement", 2, pol).model).toBe("claude-opus-5-5");
    }
  });

  it("a GPT step without a key falls back to Opus only when the policy lists Opus", () => {
    const ok = modelFor(project, "critic", 0, { allowedModels: ["claude-opus-5-5", "gpt-5.5"] });
    expect([ok.model, ok.blocked]).toEqual(["claude-opus-5-5", undefined]);
    expect(ok.singleFamilyNote).toMatch(/No OpenAI key/);
    expect(modelFor(project, "critic", 0, { allowedModels: ["gpt-5.5", "claude-sonnet-5"] }).blocked)
      .toBe("critic needs gpt-5.5 but OPENAI_API_KEY is missing; add the key or allow claude-opus-5-5 for this step");
    process.env.OPENAI_API_KEY = "sk-test";
    _resetEnvCache();
    const gpt = modelFor(project, "critic", 0, { allowedModels: ["gpt-5.5"] });
    expect([gpt.model, gpt.blocked]).toEqual(["gpt-5.5", undefined]);
  });

  it("checks the route's model and the escalation model", () => {
    const pol = { allowedModels: ["claude-sonnet-5"] };
    const r0 = modelFor(project, "implement", 0, pol);
    expect([r0.model, r0.blocked]).toEqual(["claude-sonnet-5", undefined]);
    expect(modelFor(project, "implement", 2, pol).blocked).toMatch(/^implement needs claude-opus-5-5 but this run's policy allows only claude-sonnet-5/);
    expect(modelFor(project, "plan", 0, pol).blocked).toMatch(/^plan needs claude-opus-5-5/);
  });

  it("localOnly: no escalation to a hosted model", () => {
    expect(availableRungs(project, "implement", false).has("stronger-model")).toBe(true);
    expect(availableRungs(project, "implement", true).has("stronger-model")).toBe(false);
  });
});

describe("a retry's effort", () => {
  const project = ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet" });
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
    expect(checkRoutes(cfg(openai), ["design"]).join("\n")).toMatch(/gpt-6-luna has no price/);
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
    const p = cfg({ design: { engine: "claude", tier: "standard" }, steps: { design: { runner: "api", model: "claude-sonnet-5" } } });
    expect(routeFor(p, "design")).toMatchObject({ model: "claude-sonnet-5", escalate: [] });
    expect(routeFor(p, "design").tiered).toBeUndefined();
  });

  it("leaves other steps' escalation as it was", () => {
    expect(modelFor(cfg(), "implement", 2).model).toBe("claude-opus-5-5");
    expect(modelSteps(cfg(), "implement")).toBe(1);
  });
});
