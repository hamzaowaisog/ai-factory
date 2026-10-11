// The ui-ux-pro-max skill on the JSON track: the factory runs the skill's own search (Python, no model) and the design briefing
// gets the design system it returns. The skill is a third party's code and data, so the copy is pinned by its hash.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPython, setUiuxSearch, uiuxDesignSystem, uiuxProblem, uiuxQuery, UIUX_SKILL_DIR, UIUX_SKILL_SHA256, uiuxSkillSha } from "./uiux-skill.js";

afterEach(() => setUiuxSearch(undefined));

describe("the committed ui-ux-pro-max skill", () => {
  it("is the reviewed copy, with its MIT licence beside it", () => {
    expect(uiuxSkillSha()).toBe(UIUX_SKILL_SHA256);
    expect(uiuxProblem()).toBeUndefined();
    expect(readFileSync(join(UIUX_SKILL_DIR, "LICENSE"), "utf8")).toMatch(/MIT License/);
  });
  it("refuses a changed copy, whatever the line endings", () => {
    const dir = mkdtempSync(join(tmpdir(), "uiux-"));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "SKILL.md"), "# skill\r\nrules\r\n");
    writeFileSync(join(dir, "scripts", "search.py"), "print(1)\n");
    const lf = uiuxSkillSha(dir);
    writeFileSync(join(dir, "SKILL.md"), "# skill\nrules\n");
    expect(uiuxSkillSha(dir)).toBe(lf);
    expect(uiuxProblem(dir, lf)).toBeUndefined();
    writeFileSync(join(dir, "scripts", "search.py"), "import os\n");
    expect(uiuxProblem(dir, lf)).toMatch(/not the reviewed copy/);
  });
  it("says nothing when the skill is not installed: the JSON track works without it", () => {
    expect(uiuxProblem(join(tmpdir(), "no-such-skill"), "0".repeat(64))).toBeUndefined();
  });
  it("ignores Python's cache files when hashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "uiux-"));
    writeFileSync(join(dir, "SKILL.md"), "# skill\n");
    const before = uiuxSkillSha(dir);
    mkdirSync(join(dir, "__pycache__"));
    writeFileSync(join(dir, "__pycache__", "core.cpython-313.pyc"), "x");
    expect(uiuxSkillSha(dir)).toBe(before);
  });
});

describe("the search query", () => {
  it("names the product's field, its own words and that it is an app, not a landing page", () => {
    const q = uiuxQuery("The system shall let a receptionist book a patient appointment at the clinic.", "Clinic Desk");
    expect(q).toMatch(/clinic|health/i);
    expect(q).toMatch(/app/);
    expect(q.length).toBeLessThanOrEqual(120);
  });
});

describe("the design system for the briefing", () => {
  it("runs the skill's search and gives its design system, capped", async () => {
    let asked: string[] = [];
    setUiuxSearch(async (args) => { asked = args; return `## Design System: X\n### Colors\n${"| Primary | #0891B2 |\n".repeat(1000)}`; });
    const r = await uiuxDesignSystem("clinic booking app", "Clinic");
    expect(asked).toEqual(expect.arrayContaining(["clinic booking app", "--design-system", "-f", "markdown", "-p", "Clinic"]));
    expect(r.text).toMatch(/^## Design System: X/);
    expect(r.text!.length).toBeLessThanOrEqual(6000);
  });
  it("gives a reason, never an error, when the search fails or Python is missing", async () => {
    setUiuxSearch(async () => { throw new Error("python was not found"); });
    const r = await uiuxDesignSystem("clinic", "Clinic");
    expect(r.text).toBeUndefined();
    expect(r.why).toMatch(/python was not found/);
  });
  it.skipIf(!findPython())("returns a real design system from the installed skill, and leaves no cache files in it", async () => {
    const r = await uiuxDesignSystem("clinic appointment booking healthcare app", "Clinic");
    expect(r.text).toMatch(/### Colors[\s\S]*#[0-9A-F]{6}/i);
    expect(r.text).toMatch(/### Typography/);
    expect(existsSync(join(UIUX_SKILL_DIR, "scripts", "__pycache__"))).toBe(false);
  }, 60_000);
});

describe("hash helper", () => {
  it("is a SHA-256", () => {
    expect(UIUX_SKILL_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update("").digest("hex")).toHaveLength(64);
  });
});

describe("the briefing section", () => {
  it("is added only for a new look, and tells the model what wins over it", async () => {
    const { uiuxSection } = await import("./uiux-skill.js");
    let calls = 0;
    setUiuxSearch(async () => { calls++; return "## Design System: Clinic\n### Pattern\n- Hero\n### Colors\n| Primary | #0891B2 |"; });
    expect(await uiuxSection("book a clinic appointment", "Clinic", false)).toEqual({});
    expect(calls).toBe(0);
    const s = await uiuxSection("book a clinic appointment", "Clinic", true);
    expect(s.section?.spec.id).toBe("ui-ux-pro-max");
    expect(s.section?.content).toMatch(/starting point/);
    expect(s.section?.content).toMatch(/brand/);
    expect(s.section?.content).toMatch(/Pattern.*landing/i);
    expect(s.section?.content).toContain("#0891B2");
  });
  it("gives a note instead of a section when the search cannot run", async () => {
    const { uiuxSection } = await import("./uiux-skill.js");
    setUiuxSearch(async () => { throw new Error("no python"); });
    const s = await uiuxSection("book a clinic appointment", "Clinic", true);
    expect(s.section).toBeUndefined();
    expect(s.note).toMatch(/ui-ux-pro-max.*no python/);
  });
});
