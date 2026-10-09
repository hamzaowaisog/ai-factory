import { describe, expect, it } from "vitest";
import { ProjectConfig } from "./project.js";
import { DESIGN_ENGINES, DESIGN_TIERS } from "./design-route.js";

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
