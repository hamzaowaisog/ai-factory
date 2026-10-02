// Runs one eval case through the real pipeline, intake to the final spec, and reads back what came out.
// The question cards are answered by the oracle; the run stops before plan, so nothing is built.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { decide } from "../../src/ledger/human.js";
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { readOutput } from "../../src/stages/framework.js";
import { createRun, execute } from "../../src/stages/executor.js";
import type { ClarifyResult } from "../../src/stages/clarify.js";
import { factoryHome } from "../../src/util/paths.js";
import type { EvalCase, RepoPin } from "./case.js";
import { answerCard, type CardQuestion, type OracleAnswer } from "./oracle.js";
import type { RunOutcome, SpecLike } from "./score.js";

export const EVAL_BRANCH = "factory-eval";
export const projectFor = (repoKey: string) => `eval-${repoKey}`;

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A clone of the pinned commit under the factory home, on a local branch the run reads as its base. */
export function prepareRepo(key: string, pin: RepoPin, home = factoryHome()): string {
  const dir = join(home, "eval-repos", key);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q"]);
    git(dir, ["remote", "add", "origin", pin.url]);
  }
  let have = true;
  try { git(dir, ["cat-file", "-e", `${pin.commit}^{commit}`]); } catch { have = false; }
  if (!have) git(dir, ["fetch", "-q", "--depth", "1", "origin", pin.commit]);
  git(dir, ["checkout", "-q", "-B", EVAL_BRANCH, pin.commit]);
  return dir;
}

/**
 * The eval project for a repo, plus a recorded empty baseline for its commit, so discover doesn't build and
 * test the repo (the spec stage never reads the baseline). `like` copies prices and model routes from a
 * real project, so a paid run is priced and routed the way real runs are.
 */
export function writeProject(key: string, repoPath: string, commit: string, like?: { prices?: unknown; steps?: unknown; policy?: unknown }, home = factoryHome()): string {
  const project = projectFor(key);
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", `${project}.yaml`), stringify({
    project, repo: repoPath, baseBranch: EVAL_BRANCH, stack: "dotnet",
    ...(like?.prices ? { prices: like.prices } : {}), ...(like?.steps ? { steps: like.steps } : {}), ...(like?.policy ? { policy: like.policy } : {}),
  }));
  const baseline = join(home, "repos", project, `baseline-${commit}.json`);
  if (!existsSync(baseline)) {
    mkdirSync(join(home, "repos", project), { recursive: true });
    writeFileSync(baseline, JSON.stringify({
      kind: "test", treeSha: commit, stage: "baseline", runner: "vstest", toolVersions: {}, expectPass: [], expectFail: [], compareToBaseline: [],
      discovered: [], results: [], exitCode: 0, reportShas: [], valid: true, classification: "ok",
    }));
  }
  return project;
}

/** Card answers: at most this many cards per run (two clarify rounds, plus slack for a re-asked card). */
const MAX_CARDS = 4;

export async function runCase(c: EvalCase, repeat: number, opts: { maxCostUsd: number; log?: (m: string) => void }): Promise<RunOutcome> {
  const t0 = Date.now();
  const log = opts.log ?? (() => undefined);
  const oracle: OracleAnswer[] = [];
  let runId: string | undefined;
  let status = "error", message = "";
  try {
    runId = await createRun(c.request, projectFor(c.repo), "spec-eval", { maxCostUsd: opts.maxCostUsd });
    log(`${c.id} #${repeat}: run ${runId}`);
    for (let cards = 0; ; cards++) {
      const r = await execute(runId, () => undefined, { until: "specify" });
      status = r.status; message = r.message;
      if (r.status !== "waiting") break;
      const ledger = Ledger.open(runId);
      const card = replay(ledger.events()).openCard;
      // a cost or time card is a stop for the eval: it never raises a limit
      if (!card || card.kind !== "question") { status = `waiting: ${card?.kind ?? "card"}`; break; }
      if (cards >= MAX_CARDS) { status = "too many cards"; break; }
      const pending = ledger.getJson<{ asked: CardQuestion[] }>(card.artifactSha);
      const a = answerCard(pending.asked, c.facts);
      oracle.push(...a.log);
      log(`${c.id} #${repeat}: answered ${Object.keys(a.answers).length} of ${pending.asked.length} questions from the case's facts`);
      await decide(ledger, { decision: "answer", hashPrefix: card.artifactSha.slice(0, 8), by: "spec-eval", data: { answers: a.answers } });
    }
  } catch (e) {
    status = "error"; message = (e as Error).message.slice(0, 500);
  }
  return { ...collect(runId), caseId: c.id, repeat, runId, status, message, oracle, wallMs: Date.now() - t0 };
}

/** What the run left in its ledger: the final spec, both clarify rounds, the spec stage's own record. */
function collect(runId: string | undefined): Pick<RunOutcome, "spec" | "questions" | "assumptions" | "openFindings" | "repairs" | "lane" | "costUsd"> {
  const empty = { questions: [], assumptions: [], openFindings: [], repairs: 0, costUsd: 0 };
  if (!runId) return empty;
  let ledger: Ledger;
  try { ledger = Ledger.open(runId); } catch { return empty; }
  const state = replay(ledger.events());
  const rounds = (["clarify", "clarify-2"] as const).map((k) => readOutput<ClarifyResult>(state, ledger, k)).filter(Boolean) as ClarifyResult[];
  const sp = state.steps.get("specify");
  const data = (sp?.status === "completed" ? sp.data : undefined) as { openFindings?: string[]; repairs?: number; lane?: string } | undefined;
  return {
    spec: sp?.status === "completed" ? readOutput<SpecLike>(state, ledger, "specify", "spec") : undefined,
    questions: rounds.flatMap((r) => r.asked.map((q) => ({ text: q.text, options: q.options }))),
    assumptions: rounds.flatMap((r) => r.assumptions.map((a) => a.text)),
    openFindings: data?.openFindings ?? [], repairs: data?.repairs ?? 0, lane: data?.lane,
    costUsd: state.costUsd,
  };
}
