import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitAt, currentBranch, greenfieldRefusal, isEmptyTree, nodeProjectYaml, repoIsEmpty, seedEmptyRepo } from "./greenfield.js";
import { ProjectConfig } from "./project.js";
import { parse } from "yaml";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function repo(files?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-gf-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  if (files) {
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    execFileSync("git", ["add", "-A"], { cwd: dir, env });
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "i"], { cwd: dir, env });
  }
  return dir;
}

describe("an empty repo (greenfield)", () => {
  it("counts only a new repo's starter files as empty", () => {
    expect(isEmptyTree([])).toBe(true);
    expect(isEmptyTree(["README.md", "LICENSE", ".gitignore", ".gitattributes", ".editorconfig", "readme.txt", "LICENCE.md"])).toBe(true);
    expect(isEmptyTree(["README.md", "package.json"])).toBe(false);
    expect(isEmptyTree(["docs/README.md"])).toBe(false);
  });

  it("finds an empty repo with no commits or starter files only, and seeds a base commit when there is none", () => {
    const fresh = repo();
    expect(commitAt(fresh, "HEAD")).toBeUndefined();
    expect(currentBranch(fresh)).toBe("main");
    expect(repoIsEmpty(fresh, "main")).toBe(true);
    const base = seedEmptyRepo(fresh);
    expect(commitAt(fresh, "main")).toBe(base);
    expect(seedEmptyRepo(fresh)).toBe(base); // once
    expect(execFileSync("git", ["ls-tree", "-r", "--name-only", base], { cwd: fresh, encoding: "utf8" })).toBe("");
    expect(repoIsEmpty(fresh, "main")).toBe(true);
    expect(repoIsEmpty(repo({ "README.md": "# shop" }), "main")).toBe(true);
    expect(repoIsEmpty(repo({ "README.md": "# shop", "index.ts": "" }), "main")).toBe(false);
  });

  it("writes a Node project config for it", () => {
    const p = ProjectConfig.parse(parse(nodeProjectYaml("shop", "/code/shop", "main")));
    expect(p).toMatchObject({ project: "shop", repo: "/code/shop", baseBranch: "main", stack: "node" });
  });

  it("builds a new product only into an empty Node project, and says how to make one", () => {
    const empty = repo({ "README.md": "x" });
    expect(greenfieldRefusal("d1", { project: "shop", repo: empty, baseBranch: "main", stack: "node" })).toBeUndefined();
    expect(greenfieldRefusal("d1", { project: "shop", repo: empty, baseBranch: "main", stack: "dotnet" })).toMatch(/stack: dotnet/);
    expect(greenfieldRefusal("d1", { project: "api", repo: repo({ "a.cs": "" }), baseBranch: "main", stack: "node" })).toMatch(/already has code.*factory init/);
    expect(greenfieldRefusal("d1", { project: "standalone-estimates", repo: "-", baseBranch: "main", stack: "dotnet" })).toMatch(/pick a project with an empty repo/);
  });
});
