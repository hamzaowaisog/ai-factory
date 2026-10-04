// A new product (greenfield follow-up to the PR #11 review): an approved design with no repo is built into an empty git repo.
// "Empty" allows the few files a new repo is often created with (a README, a licence, git's own settings); anything else is code.
import { execFileSync } from "node:child_process";
import { hardenedEnv } from "../ledger/git.js";
import type { ProjectConfig } from "./project.js";

const STARTER = /^(README|LICEN[CS]E|COPYING)(\.[A-Za-z]+)?$|^\.git(ignore|attributes)$|^\.editorconfig$/i;

/** True when these repo files are only what a new repo starts with. */
export function isEmptyTree(files: string[]): boolean {
  return files.every((f) => STARTER.test(f));
}

const git = (repo: string, args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-C", repo, ...args], { encoding: "utf8", env: hardenedEnv(), stdio: ["ignore", "pipe", "pipe"] });

/**
 * The commit `ref` names, or undefined when there is none (a fresh `git init`, a branch not made yet). Only "no such ref" is
 * undefined: any other git error (not a repo, an unreadable object) throws, so a repo is never taken as empty by mistake (PR #17 review, item 4).
 */
export function commitAt(repo: string, ref: string): string | undefined {
  try { return git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() || undefined; } catch (e) {
    // --verify --quiet: a ref that does not resolve exits 1 and prints nothing; everything else is a real error
    const err = e as { status?: number; stderr?: string | Buffer };
    if (err.status === 1 && !String(err.stderr ?? "").trim()) return undefined;
    throw e;
  }
}

/** True when the repo has no commit at `ref`, or the commit holds only starter files. */
export function repoIsEmpty(repo: string, ref: string): boolean {
  const c = commitAt(repo, ref);
  return !c || isEmptyTree(git(repo, ["ls-tree", "-r", "--name-only", "-z", c]).split("\0").filter(Boolean));
}

/** Files staged or in the working tree that are not starter files (ignored files aside): what an "empty" base commit must not take in. */
export function uncommittedCode(repo: string): string[] {
  const out = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  return out.map((l) => l.slice(3)).filter((f) => f && !isEmptyTree([f]));
}

/** A repo with no commits must have nothing but starter files staged or waiting: its base commit would take them in (PR #17 review, item 2). */
export function assertNothingWaiting(repo: string): void {
  const code = uncommittedCode(repo);
  if (code.length) throw new Error(`${repo} has no commits but has files waiting (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}). A new product starts from an empty repo: commit them (then it is an existing project) or remove them, and run factory init again.`);
}

/** The branch a repo is on, including one with no commits yet; "HEAD" on a detached HEAD, as `factory init` always took it (PR #17 review, item 3). */
export function currentBranch(repo: string): string {
  try { return git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).trim(); } catch { return git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(); }
}

/**
 * A repo with no commits gets an empty base commit, so a run has something to branch from. No files: the scaffold writes the
 * app's own .gitignore and skeleton in the first build commit.
 */
export function seedEmptyRepo(repo: string): string {
  const have = commitAt(repo, "HEAD");
  if (have) return have;
  assertNothingWaiting(repo);
  const who = { GIT_AUTHOR_NAME: "AI Factory", GIT_AUTHOR_EMAIL: "factory@localhost", GIT_COMMITTER_NAME: "AI Factory", GIT_COMMITTER_EMAIL: "factory@localhost" };
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-c", "commit.gpgsign=false", "-C", repo, "commit", "-q", "--allow-empty", "-m", "Start (factory init: a new product)"], { env: { ...hardenedEnv(), ...who }, stdio: ["ignore", "pipe", "pipe"] });
  return commitAt(repo, "HEAD")!;
}

/** `factory init` on an empty repo: a Node project, built with the factory's kit from an approved design. */
export function nodeProjectYaml(name: string, repo: string, baseBranch: string): string {
  return [
    "# Written by `factory init` for a new product: the repo was empty. Build an approved design into it with",
    `#   factory start --project ${name} --from-design <design run>`,
    `project: ${name}`,
    `repo: ${repo}`,
    `baseBranch: ${baseBranch}`,
    "stack: node",
    "",
  ].join("\n");
}

/**
 * Why an approved design with no repo cannot be built into this project, or undefined when it can: the project must be a Node
 * project whose repo is still empty (a design for a new product is a whole app; it is not merged into existing code).
 */
export function greenfieldRefusal(designRunId: string, project: Pick<ProjectConfig, "project" | "repo" | "baseBranch" | "stack">): string | undefined {
  const init = `Create an empty git repo (git init) and run: factory init <folder>, then build into that project.`;
  if (project.repo === "-") return `${designRunId} is a new product (designed with no repo); pick a project with an empty repo to build it into. ${init}`;
  if (!repoIsEmpty(project.repo, project.baseBranch)) return `${designRunId} is a new product (designed with no repo), and project ${project.project}'s repo already has code. A new product is built into an empty repo. ${init}`;
  if (project.stack !== "node") return `Project ${project.project} has an empty repo but is set up as stack: ${project.stack}. A new product is a Node app: run factory init <folder> --force again, or set stack: node in its config.`;
  return undefined;
}
