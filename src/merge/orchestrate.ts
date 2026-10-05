// Path A, sequenced. Every effect is injected, so the ORDER — which is the part that protects
// against spend loops, tampering and wasted containers — is testable without Docker, a forge or a
// model. The real adapters are thin; this is where the decisions live.
import { classify, isRepairable, resolveRunId, type DriftClass } from "./sync.js";
import { mayRepair, type RepairBudget } from "./repair.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";

export interface PrFacts {
  headSha: string; headRef: string; baseRef: string; baseSha: string;
  state: string; merged: boolean;
}

/** What the run that built this PR recorded. `undefined` means no ledger on this host. */
export interface RunFacts {
  gatedSha: string;
  recordedBaseSha: string;
  /** gate id → recorded inputs hash */
  recorded: Map<string, string>;
  evidenceReconciles: boolean;
  priorReverifyConcluded: boolean;
  priorConclusion?: Conclusion;
  attemptsThisPr: number;
  lastReverifyAt?: number;
}

export interface MergeResult {
  mergesClean: boolean;
  testsPass: boolean;
  /** gate id → recomputed inputs hash for this tree */
  current: Map<string, string>;
  diffSha: string;
  mergeSha: string;
  /** Everything the gates judge, produced by the same pass that built and tested the tree. */
  evidence?: unknown;
}

export type Conclusion = "success" | "failure" | "neutral";

export interface GateOutcome { id: string; passed: boolean; details: string }

export interface ReviewPrDeps {
  getPr(n: number): Promise<PrFacts>;
  findReviewBody(n: number): Promise<string | undefined>;
  /** Opens the run's ledger on this host. Undefined when it is not here. */
  openRun(runId: string): RunFacts | undefined;
  commitsSince(gatedSha: string, headSha: string): Promise<{ sha: string; trailers: string[] }[]>;
  /** Worktree merge + build + locked tests. The only step that starts a container. */
  mergeVerify(a: { runId: string; headSha: string; baseSha: string }): Promise<MergeResult>;
  /** The model call. Produces the review artifact and its coverage. */
  review2(a: { runId: string; mergeSha: string; diffSha: string }): Promise<void>;
  runGates(a: { ids: string[]; replay: string[]; evidence?: unknown }): Promise<GateOutcome[]>;
  repair(cls: "conflict" | "broken-merge", a: { runId: string }): Promise<{ pushed: boolean; why: string }>;
  writeCheck(a: { name: string; headSha: string; conclusion: Conclusion; title: string; summary: string }): Promise<void>;
  writeComment(a: { pr: number; runId: string; body: string }): Promise<void>;
  notify(msg: string): Promise<void>;
  now(): number;
}

export interface ReviewPrResult {
  conclusion: Conclusion;
  cls: DriftClass | "anomaly" | "abandoned";
  why: string;
  forced: boolean;
  repaired: boolean;
}

/** Gate ids whose verdict is a model judgement, and so can differ on an identical tree. */
const MODEL_GATES = new Set(["review.no-blocking", "review-2.no-blocking", "review.covers-every-criterion"]);

function plan(recorded: Map<string, string>, current: Map<string, string>, force: boolean) {
  const replay: string[] = [];
  const rerun: string[] = [];
  for (const [id, hash] of current) {
    (recorded.get(id) !== hash || (force && MODEL_GATES.has(id)) ? rerun : replay).push(id);
  }
  return { replay, rerun };
}

/**
 * The order here is the design. Nothing expensive happens until everything cheap and local has
 * agreed it should: resolve, classify, and only then merge, review and gate.
 */
export async function reviewPr(deps: ReviewPrDeps, a: { pr: number; force?: boolean }): Promise<ReviewPrResult> {
  const force = a.force === true;
  const pr = await deps.getPr(a.pr);

  // a PR closed or merged while we were queued: write nothing to it
  if (pr.merged || pr.state === "closed") {
    return { conclusion: "neutral", cls: "abandoned", why: `Pull request ${a.pr} is ${pr.merged ? "merged" : "closed"}; discarding the verdict rather than writing to it.`, forced: force, repaired: false };
  }

  const resolved = resolveRunId({ reviewBody: await deps.findReviewBody(a.pr), headRef: pr.headRef });
  if ("anomaly" in resolved) {
    // never neutral: under the precondition there is no benign reason for an unattributable PR
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: "Cannot attribute this pull request", summary: resolved.anomaly });
    await deps.notify(resolved.anomaly);
    return { conclusion: "failure", cls: "anomaly", why: resolved.anomaly, forced: force, repaired: false };
  }
  const { runId } = resolved;

  const run = deps.openRun(runId);
  const commits = run ? await deps.commitsSince(run.gatedSha, pr.headSha) : [];

  // classification FIRST, before any container and any token. It needs to know whether the merge is
  // clean, so ask only when something actually moved — an unchanged tree cannot have a new conflict.
  const moved = !run || pr.headSha !== run.gatedSha || pr.baseSha !== run.recordedBaseSha;
  let merge: MergeResult | undefined;
  const probe = async (): Promise<MergeResult> => (merge ??= await deps.mergeVerify({ runId, headSha: pr.headSha, baseSha: pr.baseSha }));

  // the two cheapest classes are decided without touching the tree at all
  const cheap = classify({
    ledgerPresent: !!run,
    evidenceReconciles: run?.evidenceReconciles ?? false,
    headSha: pr.headSha, gatedSha: run?.gatedSha ?? pr.headSha,
    baseSha: pr.baseSha, recordedBaseSha: run?.recordedBaseSha ?? pr.baseSha,
    newCommits: commits,
    mergesClean: true, mergeTestsPass: true,
    priorReverifyConcluded: run?.priorReverifyConcluded ?? false,
  });
  if (cheap.cls === "evidence-mismatch") {
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: "Evidence does not reconcile", summary: cheap.why });
    await deps.notify(`${runId}: ${cheap.why}`);
    return { conclusion: "failure", cls: cheap.cls, why: cheap.why, forced: force, repaired: false };
  }
  if (cheap.cls === "self-push" && run?.priorConclusion) {
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: run.priorConclusion, title: "Concluded from the previous run", summary: cheap.why });
    return { conclusion: run.priorConclusion, cls: cheap.cls, why: cheap.why, forced: force, repaired: false };
  }

  // now the tree, if anything moved
  const m = moved || force ? await probe() : undefined;
  const cls = m
    ? classify({
        ledgerPresent: true, evidenceReconciles: run!.evidenceReconciles,
        headSha: pr.headSha, gatedSha: run!.gatedSha,
        baseSha: pr.baseSha, recordedBaseSha: run!.recordedBaseSha,
        newCommits: commits, mergesClean: m.mergesClean, mergeTestsPass: m.testsPass,
        priorReverifyConcluded: run!.priorReverifyConcluded,
      }).cls
    : cheap.cls;

  // repair, once, before gating: a repaired tree is the one that should be judged
  let repaired = false;
  if (isRepairable(cls)) {
    const budget: RepairBudget = {
      path: "A", attemptsThisRun: 0, attemptsThisPr: run!.attemptsThisPr,
      lastRunAt: run!.lastReverifyAt, now: deps.now(),
    };
    const may = mayRepair(budget);
    if (!may.ok) {
      await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: `Parked: ${cls}`, summary: may.why });
      await deps.notify(`${runId}: parked after ${cls} — ${may.why}`);
      return { conclusion: "failure", cls, why: may.why, forced: force, repaired: false };
    }
    const r = await deps.repair(cls as "conflict" | "broken-merge", { runId });
    repaired = r.pushed;
    if (!r.pushed) {
      await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: `Could not repair ${cls}`, summary: r.why });
      await deps.notify(`${runId}: ${r.why}`);
      return { conclusion: "failure", cls, why: r.why, forced: force, repaired: false };
    }
    // the repaired tree is a different tree; verify it rather than the one we classified
    merge = undefined;
    await probe();
  }

  // When nothing moved, the recorded hashes ARE the current hashes — that is what "unchanged" means.
  // Starting a container to recompute them would defeat the entire staleness model, which is the one
  // property this design is built on.
  const current = merge?.current ?? run!.recorded;
  const { replay, rerun } = plan(run!.recorded, current, force);

  // the model review comes after the deterministic picture is in hand, so a tree that does not
  // compile costs no tokens
  if (rerun.some((id) => MODEL_GATES.has(id))) {
    const tree = merge ?? (await probe());
    await deps.review2({ runId, mergeSha: tree.mergeSha, diffSha: tree.diffSha });
  }
  const outcomes = await deps.runGates({ ids: [...current.keys()], replay, evidence: merge?.evidence });

  const failed = outcomes.filter((o) => !o.passed);
  const conclusion: Conclusion = failed.length ? "failure" : "success";
  const summary = failed.length
    ? failed.map((f) => `- ${f.id}: ${f.details}`).join("\n")
    : `${outcomes.length} gates passed (${replay.length} replayed, ${rerun.length} re-run).`;

  await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion, title: `${cls}: ${failed.length ? `${failed.length} blocking` : "clear"}`, summary });
  await deps.writeComment({ pr: a.pr, runId, body: `**Merge gate — ${cls}**\n\n${summary}${repaired ? "\n\n_Repaired automatically since your approval; re-read the diff._" : ""}` });
  if (failed.length) await deps.notify(`${runId}: merge gate failed — ${failed.map((f) => f.id).join(", ")}`);

  return { conclusion, cls, why: summary, forced: force, repaired };
}
