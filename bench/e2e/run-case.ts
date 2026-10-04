// One e2e run: the factory (or a plain Claude Code baseline, or a scripted patch) on a fresh base of the case's repo,
// then the hidden tests on what it delivered. Runs in the eval harness's own temporary factory home; cards are answered
// by the oracle as "eval": questions from the case's facts, the plan approved, anything else (a waiver, a cost or time
// limit) refused, which ends the run as a fail.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { decide, EVAL_DECIDER } from "../../src/ledger/human.js";
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { createRun, execute } from "../../src/stages/executor.js";
import { factoryHome } from "../../src/util/paths.js";
import { answerCard, type CardQuestion } from "../spec/oracle.js";
import { rowOf, type RunRow } from "../runs/row.js";
import { hiddenClasses, patchSize, repoSettings, type E2ECase } from "./case.js";
import { brokenExisting, commitWith, freshBase, hiddenOutcomes, runSuite, WORK, type HiddenOutcome } from "./lab.js";

export interface HiddenScore {
  /** each hidden test over the two scoring runs: pass, fail, or flaky when they disagree */
  tests: Record<string, "pass" | "fail" | "flaky">;
  passed: number;
  total: number;
  /** every hidden test passed, both times */
  pass: boolean;
  flaky: boolean;
  /** existing tests the change broke */
  brokeExisting: string[];
}

export interface E2ERow {
  caseId: string;
  /** the case's version when it ran (case.yaml caseVersion); results of different versions don't compare */
  caseVersion?: number;
  /** the factory commit that ran it */
  factoryCommit?: string;
  repeat: number;
  mode: "factory" | "claude-code" | "patch";
  outcome: string;
  stoppedAt?: string;
  hidden?: HiddenScore;
  costUsd: number;
  minutes: number;
  prodLines?: number;
  /** delivered production lines against the reference fix's */
  linesVsReference?: number;
  /** production files the change touched that the reference fix doesn't */
  creepFiles: string[];
  cardsAnswered: number;
  leaks: string[];
  run?: RunRow;
}

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

/** Run the hidden tests twice on `head` (in a throwaway branch); disagreement marks a test flaky. */
export async function scoreHidden(c: E2ECase, dir: string, head: string, log: (m: string) => void = () => undefined): Promise<HiddenScore> {
  const runs = [];
  for (let i = 1; i <= 2; i++) {
    const at = commitWith(dir, head, `e2e-score-${i}`, { hidden: c.hidden });
    const r = await runSuite(c, dir, at);
    runs.push({ r, h: hiddenOutcomes(c, r) });
    log(`  ${c.id} hidden #${i}: ${[...runs.at(-1)!.h].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  const tests: HiddenScore["tests"] = {};
  for (const k of runs[0]!.h.keys()) {
    const a = runs[0]!.h.get(k) as HiddenOutcome, b = runs[1]!.h.get(k) as HiddenOutcome;
    tests[k] = a !== b ? "flaky" : a === "pass" ? "pass" : "fail";
  }
  const v = Object.values(tests);
  return { tests, passed: v.filter((x) => x === "pass").length, total: v.length, pass: v.every((x) => x === "pass"), flaky: v.includes("flaky"), brokeExisting: brokenExisting(c, runs[0]!.r) };
}

/** Lines and creep against the reference fix, from the change between base and head. */
function sizeAgainstReference(c: E2ECase, dir: string, base: string, head: string): { prodLines: number; linesVsReference: number; creepFiles: string[] } {
  const ref = patchSize(c.reference);
  const got = patchSize(git(dir, "diff", base, head));
  return { prodLines: got.lines, linesVsReference: ref.lines ? got.lines / ref.lines : 0, creepFiles: got.files.filter((f) => !ref.files.includes(f)) };
}

/** Anything of the hidden tests where the run could read it: its ledger, worktree and snapshot. */
export function leaksOf(c: E2ECase, runId: string): string[] {
  const home = factoryHome();
  const needles = [...hiddenClasses(c), "Hidden acceptance tests", "bench/e2e"];
  const roots = [join(home, "ledger", runId), join(home, "wt"), join(home, "snapshots")].filter(existsSync);
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === ".git" || n === "node_modules" || n === "obj" || n === "bin") continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 2_000_000) { const t = readFileSync(p, "utf8"); for (const s of needles) if (t.includes(s)) hits.push(`${p.slice(home.length + 1)}: ${s}`); }
    }
  };
  for (const r of roots) walk(r);
  return hits;
}

/** The eval project in the harness's home, and the base's recorded baseline so discover doesn't build it again. */
async function prepareProject(c: E2ECase, dir: string, commit: string, like: Record<string, unknown> | undefined, log: (m: string) => void): Promise<string> {
  const home = factoryHome();
  const project = `eval-${c.repo}`;
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", `${project}.yaml`), stringify({ ...repoSettings(c.repo).config, project, repo: dir, baseBranch: "main", ...(like ?? {}) }));
  const cache = join(home, "repos", project, `baseline-${commit}.json`);
  if (!existsSync(cache)) {
    log(`  ${c.id}: baseline of the fresh base`);
    const b = await runSuite(c, dir, commit);
    mkdirSync(join(home, "repos", project), { recursive: true });
    writeFileSync(cache, JSON.stringify(b.testRun));
  }
  return project;
}

/** The run's package folder starts from the harness's shared one (hard links): restores are the slow part. */
function seedPackages(c: E2ECase, runId: string): void {
  const shared = join(WORK, `packages-${c.repo}`);
  const mine = join(factoryHome(), "tmp", runId, "nuget");
  if (!existsSync(shared) || existsSync(mine)) return;
  mkdirSync(join(factoryHome(), "tmp", runId), { recursive: true });
  try { execFileSync("cp", ["-al", shared, mine], { stdio: "ignore" }); } catch { cpSync(shared, mine, { recursive: true }); }
}

const MAX_CARDS = 6;

/** A factory run on the case, scored. `like` carries prices, routes and policy for a paid run. */
export async function runFactory(c: E2ECase, repeat: number, opts: { maxCostUsd: number; like?: Record<string, unknown>; log?: (m: string) => void }): Promise<E2ERow> {
  const log = opts.log ?? (() => undefined);
  const t0 = Date.now();
  const { dir, commit } = freshBase(c);
  const project = await prepareProject(c, dir, commit, opts.like, log);
  let runId: string | undefined, outcome = "error", stoppedAt: string | undefined, answered = 0;
  try {
    runId = await createRun(c.request, project, EVAL_DECIDER, { maxCostUsd: Math.min(opts.maxCostUsd, c.maxCostUsd) });
    seedPackages(c, runId);
    log(`  ${c.id} #${repeat}: run ${runId}`);
    for (let cards = 0; ; cards++) {
      const r = await execute(runId, () => undefined);
      outcome = r.status;
      if (r.status !== "waiting") { if (r.status !== "delivered") stoppedAt = r.message.slice(0, 200); break; }
      const ledger = Ledger.open(runId);
      const card = replay(ledger.events()).openCard!;
      if (cards >= MAX_CARDS) { stoppedAt = "too many cards"; break; }
      if (card.kind === "question") {
        const pending = ledger.getJson<{ asked: CardQuestion[] }>(card.artifactSha);
        const a = answerCard(pending.asked, c.facts);
        answered++;
        await decide(ledger, { decision: "answer", hashPrefix: card.artifactSha.slice(0, 8), by: EVAL_DECIDER, data: { answers: a.answers } });
      } else if (card.kind === "approval") {
        answered++;
        await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 8), by: EVAL_DECIDER, data: { note: "e2e eval" } });
      } else {
        // a waiver, a cost or time limit, anything else: the eval never says yes to more; the run is a fail
        outcome = "stopped"; stoppedAt = `${card.kind} card (refused by the eval)`; break;
      }
    }
  } catch (e) { outcome = "error"; stoppedAt = (e as Error).message.slice(0, 300); }
  const leaks = runId ? leaksOf(c, runId) : [];
  const run = runId ? rowOf(Ledger.open(runId)) : undefined;
  const row: E2ERow = { caseId: c.id, repeat, mode: "factory", outcome, ...(stoppedAt ? { stoppedAt } : {}), costUsd: run?.costUsd ?? 0, minutes: (Date.now() - t0) / 60_000, creepFiles: [], cardsAnswered: answered, leaks, ...(run ? { run } : {}) };
  if (outcome === "delivered" && runId) {
    const branch = replay(Ledger.open(runId).events()).workspace?.branch ?? `factory/${runId}`;
    const head = git(dir, "rev-parse", branch);
    row.hidden = await scoreHidden(c, dir, head, log);
    Object.assign(row, sizeAgainstReference(c, dir, commit, head));
  }
  return row;
}

/** A patch scored as if it had been delivered: the reference, the broken patch, or a baseline's diff. */
export async function runPatch(c: E2ECase, repeat: number, patch: string, mode: E2ERow["mode"] = "patch", log: (m: string) => void = () => undefined, extra: Partial<E2ERow> = {}): Promise<E2ERow> {
  const t0 = Date.now();
  const { dir, commit } = freshBase(c);
  const head = commitWith(dir, commit, "e2e-patch", { patch });
  const hidden = await scoreHidden(c, dir, head, log);
  return { caseId: c.id, repeat, mode, outcome: "delivered", hidden, costUsd: 0, minutes: (Date.now() - t0) / 60_000, cardsAnswered: 0, leaks: [], ...sizeAgainstReference(c, dir, commit, head), ...extra };
}

/** A plain Claude Code run on a fresh base (paid): same ticket, implement's model, file tools only, a budget cap. */
export async function runClaudeCode(c: E2ECase, repeat: number, opts: { model: string; maxCostUsd: number; apiKey: string; log?: (m: string) => void }): Promise<E2ERow> {
  const t0 = Date.now();
  const { dir, commit } = freshBase(c);
  let result: { total_cost_usd?: number; is_error?: boolean; subtype?: string } = {};
  try {
    const out = execFileSync("claude", ["-p", c.request, "--model", opts.model, "--bare", "--permission-mode", "acceptEdits", "--allowedTools", "Read Edit Write Glob Grep", "--max-budget-usd", String(opts.maxCostUsd), "--output-format", "json"],
      { cwd: dir, encoding: "utf8", input: "", env: { ...process.env, ANTHROPIC_API_KEY: opts.apiKey }, timeout: c.timeoutMin * 60_000, maxBuffer: 1 << 26 });
    result = JSON.parse(out);
  } catch (e) { result = { is_error: true, subtype: (e as Error).message.slice(0, 120) }; }
  git(dir, "add", "-A");
  try { git(dir, "-c", "user.name=baseline", "-c", "user.email=baseline@local", "commit", "-q", "-m", "claude code"); } catch { /* changed nothing */ }
  const head = git(dir, "rev-parse", "HEAD");
  const hidden = await scoreHidden(c, dir, head, opts.log);
  return { caseId: c.id, repeat, mode: "claude-code", outcome: result.is_error ? `error (${result.subtype})` : "delivered", hidden, costUsd: result.total_cost_usd ?? 0, minutes: (Date.now() - t0) / 60_000, cardsAnswered: 0, leaks: [], ...sizeAgainstReference(c, dir, commit, head) };
}
