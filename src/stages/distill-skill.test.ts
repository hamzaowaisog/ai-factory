import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_DISTILL_SKILL, loadDistillSkill } from "./distill-skill.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-skill-")); });
const put = (dir: string, text: string) => { mkdirSync(join(dir, "transcript-distill"), { recursive: true }); writeFileSync(join(dir, "transcript-distill", "SKILL.md"), text); };

describe("distill skill", () => {
  it("ships with the factory", () => {
    const s = loadDistillSkill(undefined)!;
    expect(s.path).toBe(BUILTIN_DISTILL_SKILL);
    expect(s.text).toContain("name: transcript-distill");
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the shared copy overrides the built-in one, and the repo's overrides both", () => {
    put(join(process.env.FACTORY_HOME!, "skills"), "shared");
    expect(loadDistillSkill(undefined)!.text).toBe("shared");
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    put(join(repo, ".claude", "skills"), "project");
    expect(loadDistillSkill(repo)!.text).toBe("project");
  });
  it("is missing when no copy exists", () => {
    expect(loadDistillSkill(undefined, join(tmpdir(), "none", "SKILL.md"))).toBeUndefined();
  });
});
