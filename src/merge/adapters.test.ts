import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitsWithTrailers } from "./adapters.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
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
