import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addWorktree, authEnv, changedFiles, commitAll, diffIncludingUntracked, fetchForGate, freshWorktree, git, headSha, removeWorktree, repoRefusals, resetHard, trackIgnored } from "./git.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-git-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  writeFileSync(join(dir, "a.txt"), "one\n");
  execFileSync("git", ["add", "."], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, env });
  return dir;
}

describe("hardened git", () => {
  it("never runs repo hooks", async () => {
    const repo = makeRepo();
    const marker = join(repo, "HOOK_RAN");
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`);
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, "b.txt"), "two\n");
    await commitAll(repo, "b");
    expect(existsSync(marker)).toBe(false);
  });

  it("creates a worktree, commits, diffs, resets and removes it", async () => {
    const repo = makeRepo();
    const base = await headSha(repo);
    const wt = join(mkdtempSync(join(tmpdir(), "factory-wt-")), "w1");
    await addWorktree(repo, wt, "factory/run-1", base, "run-1");
    writeFileSync(join(wt, "new.txt"), "x\n");
    const diff = await diffIncludingUntracked(wt, base);
    expect(diff).toContain("new.txt");
    const sha = await commitAll(wt, "task");
    expect(sha).not.toBe(base);
    expect(await changedFiles(wt, base)).toEqual([{ status: "A", path: "new.txt" }]);
    await resetHard(wt, base);
    expect(existsSync(join(wt, "new.txt"))).toBe(false);
    // a reset can leave named untracked folders alone (installed packages)
    mkdirSync(join(wt, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(wt, "node_modules", "pkg", "index.js"), "x\n");
    writeFileSync(join(wt, "stray.txt"), "x\n");
    await resetHard(wt, base, ["node_modules"]);
    expect(existsSync(join(wt, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(existsSync(join(wt, "stray.txt"))).toBe(false);
    await resetHard(wt, base);
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
    await removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
    const branches = (await git(repo, ["branch", "--list", "factory/*"])).stdout;
    expect(branches).toContain("factory/run-1");
  });

  it("rebuilds a worktree that is already there, branch and all", async () => {
    // the merge gate builds the SAME reverify worktree on every webhook for a pull request. With
    // plain addWorktree the second build threw: the path existed, and removeWorktree leaves the
    // branch behind (see the assertion above), so `add -b` hit an existing branch too.
    const repo = makeRepo();
    const base = await headSha(repo);
    const wt = join(mkdtempSync(join(tmpdir(), "factory-wt-")), "w2");

    await freshWorktree(repo, wt, "factory/reverify-1", base, "run-1");
    writeFileSync(join(wt, "left-behind.txt"), "x");
    await commitAll(wt, "a repair, committed into the worktree");

    await freshWorktree(repo, wt, "factory/reverify-1", base, "run-1");
    expect(existsSync(join(wt, "left-behind.txt"))).toBe(false);   // a FRESH tree at base
    expect(await headSha(wt)).toBe(base);
  });

  it("refuses submodules", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitmodules"), "");
    expect((await repoRefusals(repo)).map((r) => r.code)).toContain("submodules");
  });
  it("commits a file the plan names even when an ignore rule hides it, and keeps it through a clean", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".gitignore"), "gen/\n");
    const start = await commitAll(repo, "ignore");
    mkdirSync(join(repo, "gen", "deep"), { recursive: true });
    for (const f of ["gen/Source.cs", "gen/deep/More.cs", "gen/built.json", "gen/other.txt"]) writeFileSync(join(repo, f), "x\n");
    const scope = ["gen/Source.cs", "gen/**/*.cs", "gen/built.json"];
    expect((await trackIgnored(repo, scope, ["gen/built.json"])).sort()).toEqual(["gen/Source.cs", "gen/deep/More.cs"]);
    const commit = await commitAll(repo, "task");
    expect((await changedFiles(repo, start, commit)).map((f) => f.path).sort()).toEqual(["gen/Source.cs", "gen/deep/More.cs"]);
    // keep mode: HEAD back to the start, then the build output is cleaned
    await git(repo, ["reset", "--mixed", "-q", start]);
    await trackIgnored(repo, scope, ["gen/built.json"]);
    await git(repo, ["clean", "-fdX"]);
    expect(existsSync(join(repo, "gen/Source.cs"))).toBe(true);
    expect(existsSync(join(repo, "gen/built.json"))).toBe(false);
    expect(await trackIgnored(repo, ["src/**"])).toEqual([]);
  });
  it("passes the forge token through git's environment only, base64 in an auth header", () => {
    const env = authEnv("tok-123");
    expect(Object.keys(env).sort()).toEqual(["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from("x-access-token:tok-123").toString("base64")}`);
  });

  it("fails the gate's fetch when the base cannot be reached, without the token in the error", async () => {
    const repo = makeRepo();
    const err = await fetchForGate(repo, "main", undefined, { url: "https://127.0.0.1:9/none.git", token: "tok-SECRET-9" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("tok-SECRET-9");
  });
});
