import { describe, expect, it } from "vitest";
import { ProjectConfig } from "./project.js";
import { DEFAULT_TIERS, DESIGN_ENGINES, DESIGN_TIERS, designRoute, mergeDesignRoute, tierModels } from "./design-route.js";

const base = { project: "p", repo: "-", stack: "dotnet" };

describe("locked design names", () => {
  it("has the three engines and the three tiers in ladder order", () => {
    expect(DESIGN_ENGINES).toEqual(["claude", "openai", "stitch"]);
    expect(DESIGN_TIERS).toEqual(["light", "standard", "heavy"]);
  });

  it("reads engine, tier, tiers and allowStitch from the project's design block", () => {
    const p = ProjectConfig.parse({ ...base, design: { engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" } } } });
    expect(p.design?.engine).toBe("openai");
    expect(p.design?.tier).toBe("light");
    expect(p.design?.tiers?.light?.openai).toBe("gpt-6-luna");
    expect(p.design?.allowStitch).toBe(false);
  });

  it("refuses a misspelt engine or tier when the project is loaded", () => {
    expect(() => ProjectConfig.parse({ ...base, design: { engine: "gemini" } })).toThrow();
    expect(() => ProjectConfig.parse({ ...base, design: { tier: "medium" } })).toThrow();
    expect(() => ProjectConfig.parse({ ...base, design: { tiers: { medium: { claude: "x" } } } })).toThrow();
  });

  it("keeps a project with no design block valid", () => {
    expect(ProjectConfig.parse(base).design).toBeUndefined();
  });
});

describe("design route", () => {
  const cfg = (design?: unknown) => ProjectConfig.parse({ ...base, ...(design ? { design } : {}) });

  it("keeps today's design model when the project pins nothing", () => {
    const r = designRoute(cfg());
    expect(r.engine).toBe("claude");
    expect(r.tier).toBe("heavy");
    expect(r.source).toEqual({ engine: "default", tier: "default" });
    expect(r.route).toMatchObject({ runner: "api", model: "claude-opus-5-5", escalate: [], effort: "high", strict: true });
    expect(r.route.tiered).toBeFalsy();
  });

  it("climbs from standard to heavy on the claude engine", () => {
    const r = designRoute(cfg({ engine: "claude", tier: "standard" }));
    expect(r.ladder).toEqual([{ tier: "standard", model: "claude-sonnet-5" }, { tier: "heavy", model: "claude-opus-5-5" }]);
    expect(r.route).toMatchObject({ model: "claude-sonnet-5", escalate: ["claude-opus-5-5"], tiered: true });
  });

  it("starts claude at standard when light has no claude model", () => {
    expect(designRoute(cfg({ engine: "claude", tier: "light" })).ladder[0]).toEqual({ tier: "standard", model: "claude-sonnet-5" });
  });

  it("climbs the openai tiers and steps to Claude's heavy model at the top", () => {
    const r = designRoute(cfg({ engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" }, standard: { openai: "gpt-6-sol" } } }));
    expect(r.ladder.map((x) => x.model)).toEqual(["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5"]);
  });

  it("lets the project's tier table replace a default cell", () => {
    expect(designRoute(cfg({ engine: "claude", tier: "standard", tiers: { standard: { claude: "claude-sonnet-5-5" } } })).route.model).toBe("claude-sonnet-5-5");
  });

  it("says what to add when the engine has no model of its own at or above the tier", () => {
    // openai with no OpenAI model configured: only Claude's heavy would remain, which would be a silent vendor swap
    expect(() => designRoute(cfg({ engine: "openai", tier: "light" }))).toThrow(/No openai model.*design\.tiers/);
    expect(tierModels("openai", "light", {})).toEqual([]);
  });

  it("refuses stitch while allowStitch is off, and as not built when it is on", () => {
    expect(() => designRoute(cfg({ engine: "stitch" }))).toThrow(/allowStitch/);
    expect(() => designRoute(cfg({ engine: "stitch", allowStitch: true }))).toThrow(/not built yet/);
  });

  it("puts a pin over the hook and the hook over the default", () => {
    expect(mergeDesignRoute(cfg({ tier: "standard" }).design, { engine: "openai", tier: "light" })).toMatchObject({
      engine: "openai", tier: "standard", source: { engine: "hook", tier: "project-pin" },
    });
    expect(mergeDesignRoute(undefined, undefined).source).toEqual({ engine: "default", tier: "default" });
  });

  it("drops a hook's stitch suggestion when the project does not allow Stitch", () => {
    const pick = mergeDesignRoute(cfg().design, { engine: "stitch" });
    expect(pick.engine).toBe("claude");
    expect(pick.source.engine).toBe("default");
    expect(pick.dropped).toMatch(/stitch/);
  });

  it("only lists priced Claude models as defaults", () => {
    expect(DEFAULT_TIERS).toEqual({ standard: { claude: "claude-sonnet-5" }, heavy: { claude: "claude-opus-5-5" } });
  });
});
