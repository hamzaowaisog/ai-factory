import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitRepair, commitsWithTrailers, failingTests, insideWorktree, isFork, mergeExpectations, mergeInto, merging, workingTreeCommit } from "./adapters.js";
import type { TestRun } from "../contracts/index.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env }).toString().trim();

describe("commitsWithTrailers", () => {
  it("walks the first parent only, so a repair merge does not bring the base's commits with it", () => {
    const repo = mkdtempSync(join(tmpdir(), "factory-trail-"));
    g(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "1\n");
    g(repo, "add", "."); g(repo, "commit", "-q", "-m", "init");
    g(repo, "checkout", "-q", "-b", "pr");
    const gated = g(repo, "rev-parse", "HEAD");
    g(repo, "checkout", "-q", "main");
    writeFileSync(join(repo, "b.txt"), "base\n");
    g(repo, "add", "."); g(repo, "commit", "-q", "-m", "a base commit with no trailer");
    g(repo, "checkout", "-q", "pr");
    g(repo, "merge", "-q", "--no-ff", "-m", "factory: repair conflict\n\nFactory-Repair: run-1", "main");
    const head = g(repo, "rev-parse", "HEAD");
    return commitsWithTrailers(repo, gated, head).then((got) => {
      expect(got).toHaveLength(1);
      expect(got[0]!.trailers).toContain("Factory-Repair: run-1");
    });
  });
});

/** A repo whose `pr` branch and `main` both changed a.txt (conflict) and main also added b.txt. */
function forked(conflicting: boolean) {
  const repo = mkdtempSync(join(tmpdir(), "factory-merge-"));
  g(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(repo, "add", "."); g(repo, "commit", "-q", "-m", "init");
  g(repo, "checkout", "-q", "-b", "pr");
  writeFileSync(join(repo, conflicting ? "a.txt" : "c.txt"), "pr side\n");
  g(repo, "add", "."); g(repo, "commit", "-q", "-m", "pr work");
  g(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "a.txt"), "base side\n");
  writeFileSync(join(repo, "b.txt"), "base only\n");
  g(repo, "add", "."); g(repo, "commit", "-q", "-m", "base work");
  const base = g(repo, "rev-parse", "HEAD");
  g(repo, "checkout", "-q", "pr");
  return { repo, base, head: g(repo, "rev-parse", "HEAD") };
}

describe("mergeInto", () => {
  it("commits a clean merge, so the commit the lab archives contains the base", async () => {
    const { repo, base, head } = forked(false);
    expect(await mergeInto(repo, base)).toEqual({ clean: true, conflicts: [] });
    const parents = g(repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ");
    expect(parents.slice(1)).toEqual([head, base]);
    expect(g(repo, "ls-tree", "--name-only", "HEAD").split("\n")).toContain("b.txt");
  });

  it("leaves a conflict in progress, markers and both sides in the files", async () => {
    const { repo, base } = forked(true);
    expect(await mergeInto(repo, base)).toEqual({ clean: false, conflicts: ["a.txt"] });
    expect(await merging(repo)).toBe(true);
    const a = readFileSync(join(repo, "a.txt"), "utf8");
    expect(a).toMatch(/<<<<<<<[\s\S]*pr side[\s\S]*=======[\s\S]*base side[\s\S]*>>>>>>>/);
  });

  it("verifies HEAD as it is when the base is already merged in", async () => {
    const { repo, base } = forked(false);
    g(repo, "merge", "-q", "--no-ff", "-m", "merged earlier", base);
    const before = g(repo, "rev-parse", "HEAD");
    expect((await mergeInto(repo, base)).clean).toBe(true);
    expect(g(repo, "rev-parse", "HEAD")).toBe(before);
  });
});

describe("workingTreeCommit", () => {
  it("captures the conflicted files, markers included, without touching the merge", async () => {
    const { repo, base } = forked(true);
    await mergeInto(repo, base);
    const sha = await workingTreeCommit(repo);
    expect(g(repo, "show", `${sha}:a.txt`)).toMatch(/<<<<<<<[\s\S]*>>>>>>>/);
    expect(g(repo, "show", `${sha}:b.txt`)).toBe("base only");
    expect(await merging(repo)).toBe(true);
  });
});

describe("commitRepair", () => {
  it("concludes a conflicted merge: one commit, both parents, the trailer", async () => {
    const { repo, base, head } = forked(true);
    await mergeInto(repo, base);
    writeFileSync(join(repo, "a.txt"), "resolved\n");
    expect(await commitRepair(repo, "factory: repair conflict\n\nFactory-Repair: run-1", ["a.txt"])).toEqual({ ok: true });
    expect(g(repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1)).toEqual([head, base]);
    expect(g(repo, "log", "-1", "--format=%B")).toMatch(/Factory-Repair: run-1/);
  });

  it("refuses a resolution that leaves a conflict marker", async () => {
    const { repo, base } = forked(true);
    await mergeInto(repo, base);
    const got = await commitRepair(repo, "x", []);
    expect(got.ok).toBe(false);
    expect(await merging(repo)).toBe(true);
  });

  it("folds a broken-merge fix into the verification merge, keeping the base's changes", async () => {
    const { repo, base, head } = forked(false);
    await mergeInto(repo, base);
    writeFileSync(join(repo, "c.txt"), "fixed\n");
    expect((await commitRepair(repo, "factory: repair broken-merge\n\nFactory-Repair: run-1", ["c.txt"])).ok).toBe(true);
    expect(g(repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1)).toEqual([head, base]);
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("base only\n");
    expect(g(repo, "show", "HEAD:c.txt")).toBe("fixed");
  });

  it("never rewrites the pull request's own commit when no merge was made", async () => {
    const { repo, base } = forked(false);
    g(repo, "merge", "-q", "--no-ff", "-m", "merged earlier", base);
    const before = g(repo, "rev-parse", "HEAD");
    await mergeInto(repo, base);
    writeFileSync(join(repo, "c.txt"), "fixed\n");
    await commitRepair(repo, "factory: repair\n\nFactory-Repair: run-1", ["c.txt"]);
    expect(g(repo, "rev-parse", "HEAD^")).toBe(before);
  });
});

describe("final review fixes", () => {
  it("treats a repository name in another case as the same repository, not a fork", () => {
    expect(isFork("Im-Ahsan/AI-Factory", "im-ahsan/ai-factory")).toBe(false);
    expect(isFork("someone/ai-factory", "im-ahsan/ai-factory")).toBe(true);
    expect(isFork("", "im-ahsan/ai-factory")).toBe(true);
  });

  it("refuses a repair that leaves an unmerged path it never wrote (modify/delete has no markers)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "factory-md-"));
    g(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "one\n"); writeFileSync(join(repo, "k.txt"), "keep\n");
    g(repo, "add", "."); g(repo, "commit", "-q", "-m", "init");
    g(repo, "checkout", "-q", "-b", "pr");
    writeFileSync(join(repo, "a.txt"), "pr changed it\n");
    g(repo, "add", "."); g(repo, "commit", "-q", "-m", "pr");
    g(repo, "checkout", "-q", "main");
    g(repo, "rm", "-q", "a.txt"); g(repo, "commit", "-q", "-m", "base deleted it");
    const base = g(repo, "rev-parse", "HEAD");
    g(repo, "checkout", "-q", "pr");
    expect((await mergeInto(repo, base)).clean).toBe(false);
    writeFileSync(join(repo, "k.txt"), "an unrelated edit\n");
    const got = await commitRepair(repo, "x", ["k.txt"]);
    expect(got.ok).toBe(false);
    expect(await merging(repo)).toBe(true);
  });

  it("accepts a resolution of every unmerged path, even beside a file with a ======= line", async () => {
    const { repo, base } = forked(true);
    await mergeInto(repo, base);
    writeFileSync(join(repo, "a.txt"), "resolved\n");
    writeFileSync(join(repo, "notes.md"), "Title\n=======\n");
    expect(await commitRepair(repo, "factory: repair\n\nFactory-Repair: run-1", ["a.txt", "notes.md"])).toEqual({ ok: true });
  });

  it("throws on a merge that fails for a reason other than a conflict, rather than paying a repair to guess", async () => {
    const { repo, base } = forked(false);
    writeFileSync(join(repo, "b.txt"), "untracked, in the way\n");
    await expect(mergeInto(repo, base)).rejects.toThrow();
  });

  it("refuses a write through a symlink that leaves the worktree", () => {
    const wt = mkdtempSync(join(tmpdir(), "factory-wt-"));
    const outside = mkdtempSync(join(tmpdir(), "factory-out-"));
    try { symlinkSync(outside, join(wt, "docs"), "junction"); } catch { return; }   // no symlink rights here
    expect(insideWorktree(wt, "docs/.env")).toBe(false);
    expect(insideWorktree(wt, "src/new/File.cs")).toBe(true);
  });
});

describe("judging the merge result against the run's own tests", () => {
  const row = (id: string, outcome: "passed" | "failed") => ({ id, outcome }) as TestRun["results"][number];
  const baseline = { results: [row("T::Known", "failed"), row("T::Old", "passed")] } as TestRun;
  const lock = { tests: [{ testId: "T::Locked" }], characterisation: [{ testId: "T::Char" }] };

  it("expects the locked and characterisation tests to pass, and compares the rest with the baseline", () => {
    expect(mergeExpectations(lock, baseline)).toEqual({ expectPass: ["T::Locked", "T::Char"], expectFail: [], compareToBaseline: ["T::Known", "T::Old"] });
  });

  it("compares nothing when the run has no baseline", () => {
    expect(mergeExpectations({ tests: [{ testId: "T::Locked" }] }, undefined)).toEqual({ expectPass: ["T::Locked"], expectFail: [], compareToBaseline: [] });
  });

  it("does not count a test that already failed on the base: the pull request did not break it", () => {
    expect(failingTests([row("T::Known", "failed"), row("T::Old", "failed"), row("T::Locked", "passed")], baseline)).toEqual(["T::Old"]);
  });

  it("counts every failure when there is no baseline to excuse one", () => {
    expect(failingTests([row("T::B", "failed"), row("T::A", "failed")], undefined)).toEqual(["T::A", "T::B"]);
  });
});
