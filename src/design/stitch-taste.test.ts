import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designMdFaults, loadTasteSkill, TASTE_SKILL_PATH } from "./stitch-taste.js";

const good = "# Design System: Ledgerly\n## 1. Visual Theme & Atmosphere\nCalm.\n## 2. Color Palette & Roles\n- **Canvas** (#F9FAFB) — background\n- **Brand Teal** (#0F766E) — accent\n## 3. Typography Rules\n- **Display:** Geist\n## 4. Component Stylings\n## 5. Layout Principles\n## 7. Anti-Patterns (Banned)\n- No emojis";

describe("the taste skill", () => {
  it("points at the installed skill in the factory root", () => {
    expect(TASTE_SKILL_PATH.replace(/\\/g, "/")).toMatch(/\.agents\/skills\/stitch-design-taste\/SKILL\.md$/);
  });
  it("reads the skill without its front matter", () => {
    const f = join(mkdtempSync(join(tmpdir(), "taste-")), "SKILL.md");
    writeFileSync(f, "---\nname: x\n---\n# Body\nRules");
    expect(loadTasteSkill(f)).toBe("# Body\nRules");
  });
  it("names the missing file", () => {
    expect(() => loadTasteSkill("/nope/SKILL.md")).toThrow(/nope.*SKILL\.md/);
  });
});

describe("DESIGN.md checks", () => {
  it("passes a complete design system that keeps the brand", () => {
    expect(designMdFaults(good, { colours: ["#0f766e"], fonts: [] })).toEqual([]);
  });
  it("flags missing sections, pure black, and a dropped brand colour or font", () => {
    const checks = designMdFaults("# Design System: X\n## 2. Color Palette & Roles\n- Ink (#000000)", { colours: ["#0F766E"], fonts: ["Lato"] }).map((f) => f.check);
    expect(checks).toEqual(expect.arrayContaining(["stitch-designmd-section", "stitch-designmd-black", "stitch-designmd-brand"]));
  });
});

describe("review fixes", () => {
  it("reports a missing taste skill as a start-up problem", async () => {
    const { tasteSkillProblem } = await import("./stitch-taste.js");
    expect(tasteSkillProblem("/nope/SKILL.md")).toMatch(/stitch-design-taste skill is missing at .*nope/);
    const f = join(mkdtempSync(join(tmpdir(), "taste-")), "SKILL.md");
    writeFileSync(f, "# skill");
    expect(tasteSkillProblem(f)).toBeUndefined();
  });
  it("lets a black brand colour through the pure-black ban", () => {
    expect(designMdFaults(`${good}\n- **Brand Black** (#000000) — the brand`, { colours: ["#000000"], fonts: [] })).toEqual([]);
    expect(designMdFaults(`${good}\n- **Ink** (#000) — text`, { colours: ["#000"], fonts: [] })).toEqual([]);
  });
});
