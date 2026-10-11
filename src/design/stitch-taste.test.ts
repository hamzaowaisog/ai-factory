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

describe("the Stitch theme", () => {
  it("needs Stitch's required theme fields, with fonts from Stitch's own list", async () => {
    const { DesignMdOut } = await import("./stitch-taste.js");
    const designMd = "x".repeat(220);
    const theme = { colorMode: "LIGHT", headlineFont: "GEIST", bodyFont: "DM_SANS", roundness: "ROUND_EIGHT", customColor: "#0F766E" };
    expect(DesignMdOut.safeParse({ designMd, theme }).success).toBe(true);
    expect(DesignMdOut.safeParse({ designMd }).success).toBe(false);
    expect(DesignMdOut.safeParse({ designMd, theme: { ...theme, bodyFont: "SATOSHI" } }).success).toBe(false);
    expect(DesignMdOut.safeParse({ designMd, theme: { ...theme, customColor: "teal" } }).success).toBe(false);
  });
});

describe("the committed skill (PR review)", () => {
  it("is the reviewed copy: its hash matches the pin, whatever the line endings", async () => {
    const { tasteSkillProblem, TASTE_SKILL_SHA256 } = await import("./stitch-taste.js");
    expect(tasteSkillProblem()).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), "taste-"));
    writeFileSync(join(dir, "lf.md"), "# skill\nrules\n");
    writeFileSync(join(dir, "crlf.md"), "# skill\r\nrules\r\n");
    const { createHash } = await import("node:crypto");
    const pin = createHash("sha256").update("# skill\nrules\n").digest("hex");
    expect(tasteSkillProblem(join(dir, "crlf.md"), pin)).toBeUndefined();
    expect(TASTE_SKILL_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a skill that was changed after review, at start-up and when loaded", async () => {
    const { tasteSkillProblem } = await import("./stitch-taste.js");
    const f = join(mkdtempSync(join(tmpdir(), "taste-")), "SKILL.md");
    writeFileSync(f, "# a changed skill");
    expect(tasteSkillProblem(f, "0".repeat(64))).toMatch(/not the reviewed copy/);
    expect(() => loadTasteSkill(f, "0".repeat(64))).toThrow(/not the reviewed copy/);
  });
  it("carries the upstream MIT licence beside it", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const licence = join(dirname(TASTE_SKILL_PATH), "LICENSE");
    expect(existsSync(licence)).toBe(true);
    expect(readFileSync(licence, "utf8")).toMatch(/MIT License[\s\S]*Copyright \(c\) 2026 Leonxlnx/);
  });
});
