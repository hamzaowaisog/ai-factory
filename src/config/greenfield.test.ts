import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNothingWaiting, commitAt, currentBranch, greenfieldRefusal, isEmptyTree, nodeProjectYaml, repoIsEmpty, seedEmptyRepo, uncommittedCode, newProductRefusal } from "./greenfield.js";
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

  it("never takes staged or waiting code into the empty base commit (PR #17 review, item 2)", () => {
    const staged = repo();
    writeFileSync(join(staged, "app.ts"), "export {};\n");
    writeFileSync(join(staged, "README.md"), "# shop");
    execFileSync("git", ["add", "app.ts"], { cwd: staged, env });
    expect(uncommittedCode(staged)).toEqual(["app.ts"]);
    expect(() => assertNothingWaiting(staged)).toThrow(/no commits but has files waiting \(app\.ts\)/);
    expect(() => seedEmptyRepo(staged)).toThrow(/files waiting/);
    expect(commitAt(staged, "HEAD")).toBeUndefined();
    const untracked = repo();
    mkdirSync(join(untracked, "src"));
    writeFileSync(join(untracked, "src", "main.ts"), "");
    expect(() => seedEmptyRepo(untracked)).toThrow(/src\/main\.ts/);
    // starter files may wait: the base commit is still empty of code
    const starters = repo();
    writeFileSync(join(starters, "README.md"), "# shop");
    expect(uncommittedCode(starters)).toEqual([]);
    expect(repoIsEmpty(starters, seedEmptyRepo(starters))).toBe(true);
  });

  it("reads a detached HEAD as before, and fails closed on a git error, not as an empty repo (PR #17 review, items 3 and 4)", () => {
    const r = repo({ "a.cs": "" });
    execFileSync("git", ["checkout", "-q", "--detach"], { cwd: r, env });
    expect(currentBranch(r)).toBe("HEAD");
    expect(repoIsEmpty(r, currentBranch(r))).toBe(false);
    expect(commitAt(r, "no-such-branch")).toBeUndefined();
    const notRepo = mkdtempSync(join(tmpdir(), "factory-gf-none-"));
    expect(() => commitAt(notRepo, "HEAD")).toThrow();
    expect(() => repoIsEmpty(notRepo, "main")).toThrow();
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

describe("an estimate built as a new product: a web app and its API, or a web app alone", () => {
  const t = (id: string, track: string, kind: string, executor = "factory") => ({ id, track, kind, executor });
  it("accepts web work, environment set-up and backend work people do", () => {
    for (const withApi of [true, false]) {
      expect(newProductRefusal("est", { tasks: [t("EST-1", "web", "ui-form"), t("EST-2", "qa", "qa-e2e"), t("EST-3", "backend", "ops-setup", "joint"), t("EST-4", "backend", "be-auth", "human")] }, withApi)).toBeUndefined();
      expect(newProductRefusal("est", {}, withApi)).toBeUndefined();
    }
  });
  it("builds an estimate that prices its own API (d7a6's shape) with its API, but not as a web app alone", () => {
    const scope = { tasks: [t("EST-1", "backend", "be-data"), t("EST-2", "backend", "be-auth", "joint"), t("EST-3", "backend", "be-endpoint"), t("EST-4", "backend", "be-endpoint"), t("EST-5", "backend", "be-crud"), t("EST-7", "web", "ui-list")], stack: { backend: "ASP.NET Core Web API" } };
    expect(newProductRefusal("d7a6", scope, true)).toBeUndefined();
    const alone = newProductRefusal("d7a6", scope, false);
    expect(alone).toMatch(/^d7a6 prices more than a web app: 5 backend tasks \(EST-1, EST-2, EST-3, EST-4, …; priced as ASP\.NET Core Web API\)/);
    expect(alone).toMatch(/factory fullstack start --from-estimate d7a6.*client provides the backend, estimate again without the backend work/);
  });
  it("refuses a phone app either way, and names the tasks", () => {
    expect(newProductRefusal("est", { tasks: [t("EST-1", "mobile", "ui-device")] }, true)).toMatch(/^est prices a phone app: 1 mobile task \(EST-1\).*Estimate again without the phone app/);
    expect(newProductRefusal("est", { tasks: [t("EST-1", "mobile", "ui-device")] }, false)).toMatch(/1 mobile task \(EST-1\).*A phone app is not built yet/);
  });
});
