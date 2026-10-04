// The repo an e2e run works on, and running its tests in the factory's lab. Free: git and containers, no model.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ProjectConfig } from "../../src/config/project.js";
import { DEFAULT_POLICY } from "../../src/gates/policy.js";
import { ensureEgress, feedHostsFrom } from "../../src/runners/netinfra.js";
import { labFor } from "../../src/verify/lab.js";
import { DockerCli } from "../../src/verify/runtime.js";
import type { TestResult, TestRun } from "../../src/contracts/index.js";
import { hiddenClasses, repoSettings, type E2ECase } from "./case.js";

// pinned clones are shared with the ripple replay; work trees and package caches live under the factory's home
// (Colima and Docker Desktop share the home folder with their VM)
const CLONES = join(homedir(), ".factory", "bench-repos");
export const WORK = join(homedir(), ".factory", "tmp", "e2e");
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@factory.local", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@factory.local" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env: ENV, encoding: "utf8", maxBuffer: 1 << 28 });

function clone(c: E2ECase): string {
  const dir = join(CLONES, c.repo);
  if (!existsSync(dir)) { mkdirSync(CLONES, { recursive: true }); execFileSync("git", ["clone", "--quiet", "--no-checkout", c.pin.url, dir], { stdio: "inherit" }); }
  git(dir, "cat-file", "-e", c.pin.commit);
  return dir;
}

/**
 * The case's base as a brand-new repo: the pinned commit's files (plus the repo's setup patch) in one commit, with no
 * history, no other branches and no remote, so nothing in it can lead to a later fix. Returns its folder and commit.
 */
export function freshBase(c: E2ECase): { dir: string; commit: string } {
  mkdirSync(WORK, { recursive: true });
  const dir = mkdtempSync(join(WORK, `${c.id}-`));
  execFileSync("bash", ["-c", `git -C '${clone(c)}' archive ${c.pin.commit} | tar -x -C '${dir}'`]);
  git(dir, "init", "-q", "-b", "main");
  const setup = repoSettings(c.repo).setupPatch;
  if (setup) git(dir, "apply", "--whitespace=nowarn", setup);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", `base: ${c.repo} at ${c.pin.commit.slice(0, 7)}${setup ? " + setup" : ""}`);
  return { dir, commit: git(dir, "rev-parse", "HEAD").trim() };
}

/** A commit on top of `from` with a patch applied and/or the hidden tests added (in a throwaway branch). */
export function commitWith(dir: string, from: string, branch: string, opts: { patch?: string; hidden?: Record<string, string> }): string {
  git(dir, "checkout", "-q", "-B", branch, from);
  if (opts.patch) { const p = join(dir, "..", `${branch.replace(/\W/g, "_")}.patch`); writeFileSync(p, opts.patch); git(dir, "apply", "--whitespace=nowarn", p); }
  for (const [path, text] of Object.entries(opts.hidden ?? {})) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", branch);
  return git(dir, "rev-parse", "HEAD").trim();
}

export function projectFor(c: E2ECase, dir: string): ProjectConfig {
  return ProjectConfig.parse({ ...repoSettings(c.repo).config, project: `eval-${c.repo}`, repo: dir });
}

export interface LabRun { built: boolean; buildErrors: string[]; results: TestResult[]; valid: boolean; testRun: TestRun }

/** Build and run the whole suite at `commit` in the lab, as discover's baseline does. */
export async function runSuite(c: E2ECase, dir: string, commit: string, log: (m: string) => void = () => undefined): Promise<LabRun> {
  const project = projectFor(c, dir);
  const rt = new DockerCli();
  await ensureEgress(rt, feedHostsFrom(DEFAULT_POLICY.registryAllowlist));
  const packagesDir = join(WORK, `packages-${c.repo}`);
  mkdirSync(packagesDir, { recursive: true });
  const out = await labFor(project).produce({
    runId: `e2e-${c.id}`, key: "e2e", repo: dir, commit, stage: "baseline",
    exp: { expectPass: [], expectFail: [], compareToBaseline: [] }, project, rt, packagesDir,
    onPhase: (_p, msg) => log(`    ${msg}`),
  });
  return { built: out.build.ok, buildErrors: out.build.errors.slice(0, 5).map((e) => `${e.file ?? ""}:${e.line ?? ""} ${e.code} ${e.msg}`), results: out.testRun.results, valid: out.testRun.valid, testRun: out.testRun };
}

export type HiddenOutcome = "pass" | "fail" | "missing";
/** Each hidden test's outcome in one lab run; a build that failed fails them all. */
export function hiddenOutcomes(c: E2ECase, run: LabRun): Map<string, HiddenOutcome> {
  const classes = hiddenClasses(c);
  const out = new Map<string, HiddenOutcome>();
  const methods = Object.values(c.hidden).flatMap((t) => [...t.matchAll(/\[Fact\][\s\S]*?public\s+async\s+Task\s+(\w+)\(/g)].map((m) => m[1]!));
  for (const m of methods) out.set(m, run.built ? "missing" : "fail");
  for (const r of run.results) {
    const hit = classes.find((cl) => r.id.includes(`.${cl}.`));
    if (!hit) continue;
    const m = r.id.replace(/\(.*$/, "").split(".").pop()!;
    out.set(m, r.outcome === "passed" ? "pass" : "fail");
  }
  return out;
}

/** Existing (non-hidden) tests that failed: a change that broke something already there. */
export const brokenExisting = (c: E2ECase, run: LabRun): string[] =>
  run.results.filter((r) => r.outcome === "failed" && !hiddenClasses(c).some((cl) => r.id.includes(`.${cl}.`))).map((r) => r.id);
