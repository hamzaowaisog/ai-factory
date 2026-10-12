import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designMdFaults, offBlack, loadTasteSkill, tastePageProblem, tastePageRules, TASTE_SKILL_PATH } from "./stitch-taste.js";
import { FIELD_RULES as FIELD_RULES_, TASTE_OVERRIDES as TASTE_OVERRIDES_ } from "./stitch-taste.js";

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

describe("pure black put right without a model call", () => {
  it("swaps it where it is used, and leaves a ban line and a black brand alone", () => {
    const md = "- **Canvas** (#000000) page\n- No pure black (#000000).";
    expect(offBlack(md, { colours: [] })).toEqual({ md: "- **Canvas** (#18181B) page\n- No pure black (#000000).", swapped: 1 });
    expect(offBlack(md, { colours: ["#000"] })).toEqual({ md, swapped: 0 });
  });
});

describe("pure black named only to ban it", () => {
  it("passes a design system whose anti-patterns say no pure black, and still flags one that uses it", () => {
    expect(designMdFaults(`${good}\n- No emojis, no Inter, no pure black (#000000).`, { colours: ["#0f766e"], fonts: [] })).toEqual([]);
    expect(designMdFaults(`${good}\n- **Ink** (#000000) — headings`, { colours: ["#0f766e"], fonts: [] }).map((f) => f.check)).toEqual(["stitch-designmd-black"]);
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

describe("the DESIGN.md rules that keep its words off the pages (parking redraw, 12 Oct 2026)", () => {
  it("ask for photographs of what the product shows, a fingerprint in the look, no leakable term, sentence case, motion once and no product name", () => {
    for (const w of ["is a real photograph", "never a mark, glyph or line drawn beside a value", "Nothing in this file is ever text on a page", "uppercase is for a table's column heads only", "neither repeats the other", "Name no real product or company in the file"]) expect(TASTE_OVERRIDES_).toContain(w);
    expect(FIELD_RULES_).toContain('without a product\'s name (the names go in "basis")');
  });
});

describe("the skill's page rules, for the step that writes each Stitch prompt", () => {
  it("are the layout rules, the anti-patterns and the component replacements of the reviewed skill, and nothing else", () => {
    const rules = tastePageRules();
    for (const w of ["### 6. Define Layout Principles", "3 equal cards", "### 9. List Anti-Patterns", "No generic names", "## 12. Anti-Vibe-Coded Components", "One headline metric with context"]) expect(rules).toContain(w);
    for (const w of ["Define Responsive Rules", "Output Format", "Human Fingerprint Rules", "Motion Tokens"]) expect(rules).not.toContain(w);
    expect(rules.length).toBeLessThan(6000);
  });
  it("says which part is missing when the skill no longer has it", () => {
    expect(() => tastePageRules("# Skill\n### 6. Define Layout Principles\n- a rule")).toThrow(/9\. List Anti-Patterns/);
  });
  it("is asked of the design system as a digest", () => {
    expect(TASTE_OVERRIDES_).toContain('"digest"');
  });
});

describe("the skill on a design drawn by Claude or OpenAI", () => {
  it("is no start-up problem when missing or the reviewed copy, and one when changed", () => {
    expect(tastePageProblem("/nope/SKILL.md")).toBeUndefined();
    expect(tastePageProblem()).toBeUndefined();
    const f = join(mkdtempSync(join(tmpdir(), "factory-taste-")), "SKILL.md");
    writeFileSync(f, "# Changed");
    expect(tastePageProblem(f, "0".repeat(64))).toMatch(/not the reviewed copy/);
  });
});
