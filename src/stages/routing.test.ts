import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { checkRoutes, ESTIMATE_ROUTES } from "./routing.js";

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
