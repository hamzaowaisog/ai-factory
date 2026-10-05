// Two layers of skill files: shared across the host, overridden per project.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noSkillsNote, projectSkillsDir, readSkillDir, readSkills, sharedSkillsDir } from "./skills.js";

let root: string;
let home: string;
let repo: string;
const prev = process.env.FACTORY_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-"));
  home = join(root, "factory");
  repo = join(root, "repo");
  process.env.FACTORY_HOME = home;
});
afterEach(() => { process.env.FACTORY_HOME = prev; rmSync(root, { recursive: true, force: true }); });

const put = (dir: string, name: string, body: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), body);
};
const shared = (name: string, body: string) => put(join(home, "skills"), name, body);
const project = (name: string, body: string) => put(join(repo, ".claude", "skills"), name, body);

describe("where skills are looked for", () => {
  it("shares them from the factory home, so one install covers every project", () => {
    expect(sharedSkillsDir()).toBe(join(home, "skills"));
  });

  it("lets a repository carry its own", () => {
    expect(projectSkillsDir(repo)).toBe(join(repo, ".claude", "skills"));
  });
});

describe("readSkills", () => {
  it("finds the shared ones when the project carries none", () => {
    // the bug this fixes: a project without its own skills used to get NO external rules at all
    shared("dotnet-best-practices", "---\nname: dotnet-best-practices\n---\n## S\n\n- Use async for I/O operations\n");
    const got = readSkills(repo);
    expect(got.map((s) => s.name)).toEqual(["dotnet-best-practices"]);
    expect(got[0]!.layer).toBe("shared");
  });

  it("finds the project's own when there are no shared ones", () => {
    project("house-style", "---\nname: house-style\n---\n## S\n\n- Keep controllers thin and boring\n");
    const got = readSkills(repo);
    expect(got.map((s) => s.name)).toEqual(["house-style"]);
    expect(got[0]!.layer).toBe("project");
  });

  it("combines both layers when each has different skills", () => {
    shared("dotnet-best-practices", "---\nname: dotnet-best-practices\n---\n");
    project("house-style", "---\nname: house-style\n---\n");
    expect(readSkills(repo).map((s) => s.name)).toEqual(["dotnet-best-practices", "house-style"]);
  });

  it("a project skill REPLACES a shared one of the same name, rather than merging", () => {
    shared("code-review", "---\nname: code-review\n---\nSHARED\n");
    project("code-review", "---\nname: code-review\n---\nPROJECT\n");
    const got = readSkills(repo);
    expect(got).toHaveLength(1);
    expect(got[0]!.text).toContain("PROJECT");
    expect(got[0]!.text).not.toContain("SHARED");
    expect(got[0]!.layer).toBe("project");
  });

  it("returns nothing, and does not throw, when neither directory exists", () => {
    expect(readSkills(repo)).toEqual([]);
  });

  it("ignores a directory with no SKILL.md in it", () => {
    mkdirSync(join(home, "skills", "empty"), { recursive: true });
    shared("real", "---\nname: real\n---\n");
    expect(readSkills(repo).map((s) => s.name)).toEqual(["real"]);
  });

  it("ignores a loose file sitting beside the skill directories", () => {
    mkdirSync(join(home, "skills"), { recursive: true });
    writeFileSync(join(home, "skills", "README.md"), "not a skill");
    shared("real", "---\nname: real\n---\n");
    expect(readSkills(repo).map((s) => s.name)).toEqual(["real"]);
  });

  it("is deterministic: the same files give the same order", () => {
    shared("b-skill", "---\nname: b\n---\n");
    shared("a-skill", "---\nname: a\n---\n");
    expect(readSkills(repo).map((s) => s.name)).toEqual(["a-skill", "b-skill"]);
  });

  it("records which directory each one came from, for the guidelines file", () => {
    shared("x", "---\nname: x\n---\n");
    expect(readSkills(repo)[0]!.dir).toBe(join(home, "skills"));
  });
});

describe("readSkillDir", () => {
  it("labels the layer it was told, so provenance survives into the rules", () => {
    shared("x", "---\nname: x\n---\n");
    expect(readSkillDir(join(home, "skills"), "shared")[0]!.layer).toBe("shared");
  });
});

describe("noSkillsNote", () => {
  it("names both places a skill can go, so the answer is actionable", () => {
    const note = noSkillsNote(repo);
    expect(note).toContain(join(home, "skills"));
    expect(note).toContain(join(repo, ".claude", "skills"));
  });
});
