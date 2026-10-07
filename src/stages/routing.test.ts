import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { availableRungs, checkRoutes, ESTIMATE_ROUTES, mechanical, modelFor } from "./routing.js";

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
