// Path A, sequenced. Every effect is injected, so the ORDER — which is the part that protects
// against spend loops, tampering and wasted containers — is testable without Docker, a forge or a
// model. The real adapters are thin; this is where the decisions live.
import { classify, isRepairable, resolveRunId, type DriftClass } from "./sync.js";
import { COOLDOWN_MS, mayRepair, type RepairBudget } from "./repair.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";

export interface PrFacts {
  headSha: string; headRef: string; baseRef: string; baseSha: string;
  state: string; merged: boolean;
  /** the head branch lives in another repository: nothing may be pushed to it, and it is not ours */
  fromFork?: boolean;
}

/** What the run that built this PR recorded. `undefined` means no ledger on this host. */
export interface RunFacts {
  gatedSha: string;
  /** the head deliver pushed: the gated commit plus its evidence-manifest commit */
  deliveredSha?: string;
  recordedBaseSha: string;
  /** gate id → recorded inputs hash */
  recorded: Map<string, string>;
  evidenceReconciles: boolean;
  priorReverifyConcluded: boolean;
  priorConclusion?: Conclusion;
  attemptsThisPr: number;
  lastReverifyAt?: number;
  /** the head the last reverify judged; `recordedBaseSha` is then the base it judged */
  judgedHeadSha?: string;
  /** model gate id → the hash of what review-2 last read, so the same diff is never reviewed twice */
  reviewed?: Map<string, string>;
}

/** What a reverify writes to the run's ledger when it reaches a verdict: its memory for the next pass. */
export interface ReverifyRecord {
  runId: string;
  conclusion: Conclusion;
  cls: string;
  headSha: string;
  baseSha: string;
  attemptsThisPr: number;
  at: number;
  reviewed: Record<string, string>;
}

export interface MergeResult {
  mergesClean: boolean;
  testsPass: boolean;
  /** Conflicted paths, when `mergesClean` is false. Repair cannot be told what to fix without them. */
  conflicts?: string[];
  /** Ids of the locked tests that failed, when `testsPass` is false. Same reason. */
  failedTests?: string[];
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
  /**
   * Worktree merge + build + locked tests. The only step that starts a container.
   * `afterRepair` verifies the tree the repair just produced instead of rebuilding from the head,
   * which would discard the repair and verify the broken tree in its place.
   */
  mergeVerify(a: { runId: string; headSha: string; baseSha: string; afterRepair?: boolean }): Promise<MergeResult>;
  /** The model call. Produces the review artifact and its coverage. */
  review2(a: { runId: string; mergeSha: string; diffSha: string }): Promise<void>;
  runGates(a: { ids: string[]; replay: string[]; evidence?: unknown }): Promise<GateOutcome[]>;
  /**
   * Commits the repair in the reverify worktree and nothing more: it is verified and gated before
   * `pushRepair` may deliver it. `subject` is the conflicted paths, or the failing locked test ids.
   */
  repair(cls: "conflict" | "broken-merge", a: { runId: string; subject: string[] }): Promise<{ made: boolean; why: string }>;
  /** Pushes the verified repair to the pull request's own branch. `sha` is the head it pushed. */
  pushRepair(a: { runId: string; headRef: string }): Promise<{ pushed: boolean; why: string; sha?: string }>;
  recordReverify(r: ReverifyRecord): Promise<void>;
  writeCheck(a: { name: string; headSha: string; conclusion: Conclusion; title: string; summary: string }): Promise<void>;
  writeComment(a: { pr: number; runId: string; body: string }): Promise<void>;
  notify(msg: string): Promise<void>;
  now(): number;
}

export interface ReviewPrResult {
  conclusion: Conclusion;
  /** `deferred`: inside the cooldown, nothing done. `not-here`: not this host's to gate (`onlyLocal`). */
  cls: DriftClass | "anomaly" | "abandoned" | "deferred" | "not-here";
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
 *
 * `onlyLocal` is the poller's mode: a pull request this host cannot attribute to a ledger of its own
 * is left alone, with nothing written to it, instead of failing it on every pass.
 */
export async function reviewPr(deps: ReviewPrDeps, a: { pr: number; force?: boolean; onlyLocal?: boolean }): Promise<ReviewPrResult> {
  const force = a.force === true;
  const pr = await deps.getPr(a.pr);
  const done = (conclusion: Conclusion, cls: ReviewPrResult["cls"], why: string, repaired = false): ReviewPrResult =>
    ({ conclusion, cls, why, forced: force, repaired });
  const notHere = (why: string) => done("neutral", "not-here", why);

  // a PR closed or merged while we were queued: write nothing to it
  if (pr.merged || pr.state === "closed") {
    return done("neutral", "abandoned", `Pull request ${a.pr} is ${pr.merged ? "merged" : "closed"}; discarding the verdict rather than writing to it.`);
  }

  // a repair pushes to the head branch, so a head the factory does not own is refused before anything
  if (pr.fromFork || pr.headRef === pr.baseRef) {
    const why = pr.fromFork
      ? "The head branch lives in another repository (a fork). The factory gates only its own branches and never pushes to a fork."
      : `The head branch "${pr.headRef}" is the base branch itself, which a repair must never push to.`;
    if (a.onlyLocal) return notHere(why);
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: "Cannot gate this pull request", summary: why });
    await deps.notify(`#${a.pr}: ${why}`);
    return done("failure", "anomaly", why);
  }

  const resolved = resolveRunId({ reviewBody: await deps.findReviewBody(a.pr), headRef: pr.headRef });
  if ("anomaly" in resolved) {
    if (a.onlyLocal) return notHere(resolved.anomaly);
    // never neutral: under the precondition there is no benign reason for an unattributable PR
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: "Cannot attribute this pull request", summary: resolved.anomaly });
    await deps.notify(resolved.anomaly);
    return done("failure", "anomaly", resolved.anomaly);
  }
  const { runId } = resolved;

  const run = deps.openRun(runId);
  if (!run && a.onlyLocal) return notHere(`No ledger for ${runId} on this host.`);
  // new commits count from what deliver pushed: the gated commit plus its evidence-manifest commit,
  // which carries no repair trailer and would otherwise make every pull request "unexpected-commits"
  const anchor = run ? (run.deliveredSha ?? run.gatedSha) : pr.headSha;
  const commits = run ? await deps.commitsSince(anchor, pr.headSha) : [];

  // what this pass ends up judging, written back so the next pass knows it has already been judged
  let attempted = false;
  const reviewed: Record<string, string> = {};
  const record = async (conclusion: Conclusion, cls: string, headSha = pr.headSha) => {
    if (!run) return;
    await deps.recordReverify({
      runId, conclusion, cls, headSha, baseSha: pr.baseSha,
      attemptsThisPr: run.attemptsThisPr + (attempted ? 1 : 0), at: deps.now(),
      reviewed: { ...Object.fromEntries(run.reviewed ?? []), ...reviewed },
    });
  };
  const fail = async (cls: ReviewPrResult["cls"], title: string, why: string, note: string = `${runId}: ${why}`) => {
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title, summary: why });
    await deps.notify(note);
    await record("failure", cls);
    return done("failure", cls, why);
  };

  // the same head and base as the last verdict: that verdict still holds, and saying it again to
  // Slack every pass would bury the one message that matters
  const sameAsJudged = !!run?.priorConclusion && run.judgedHeadSha === pr.headSha && run.recordedBaseSha === pr.baseSha;

  // classification FIRST, before any container and any token. It needs to know whether the merge is
  // clean, so ask only when something actually moved — an unchanged tree cannot have a new conflict.
  const moved = !run || pr.headSha !== (run.judgedHeadSha ?? anchor) || pr.baseSha !== run.recordedBaseSha;
  let merge: MergeResult | undefined;
  const probe = async (afterRepair = false): Promise<MergeResult> =>
    (merge ??= await deps.mergeVerify({ runId, headSha: pr.headSha, baseSha: pr.baseSha, afterRepair }));

  // the two cheapest classes are decided without touching the tree at all
  const cheap = classify({
    ledgerPresent: !!run,
    evidenceReconciles: run?.evidenceReconciles ?? false,
    headSha: pr.headSha, gatedSha: anchor,
    baseSha: pr.baseSha, recordedBaseSha: run?.recordedBaseSha ?? pr.baseSha,
    newCommits: commits,
    mergesClean: true, mergeTestsPass: true,
    priorReverifyConcluded: run?.priorReverifyConcluded ?? false,
  });
  if (cheap.cls === "evidence-mismatch") {
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: "failure", title: "Evidence does not reconcile", summary: cheap.why });
    if (!(sameAsJudged && run!.priorConclusion === "failure")) await deps.notify(`${runId}: ${cheap.why}`);
    await record("failure", cheap.cls);
    return done("failure", cheap.cls, cheap.why);
  }
  if (sameAsJudged && !force) {
    const prior = run!.priorConclusion!;
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: prior, title: "Concluded from the last verdict", summary: "Neither the head nor the base moved since this pull request was last judged." });
    return done(prior, "unchanged", "Nothing moved since the last verdict: concluding from it.");
  }
  // only while the base is the one last judged: after a base move the merge must be verified again
  if (cheap.cls === "self-push" && run?.priorConclusion && pr.baseSha === run.recordedBaseSha) {
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: pr.headSha, conclusion: run.priorConclusion, title: "Concluded from the previous run", summary: cheap.why });
    await record(run.priorConclusion, cheap.cls);
    return done(run.priorConclusion, cheap.cls, cheap.why);
  }

  // guard 4: a burst of pushes collapses into one run. Nothing is written, so the next pass after the
  // cooldown does the work; a new head has no check meanwhile, which keeps a required check blocking.
  if (moved && !force && run?.lastReverifyAt !== undefined && deps.now() - run.lastReverifyAt < COOLDOWN_MS) {
    return done("neutral", "deferred", `Cooldown: this pull request was last judged ${Math.round((deps.now() - run.lastReverifyAt) / 1000)}s ago; it is judged again once ${COOLDOWN_MS / 1000}s have passed.`);
  }

  // now the tree, if anything moved
  const m = moved || force ? await probe() : undefined;
  const cls = m
    ? classify({
        ledgerPresent: true, evidenceReconciles: run!.evidenceReconciles,
        headSha: pr.headSha, gatedSha: anchor,
        baseSha: pr.baseSha, recordedBaseSha: run!.recordedBaseSha,
        newCommits: commits, mergesClean: m.mergesClean, mergeTestsPass: m.testsPass,
        priorReverifyConcluded: run!.priorReverifyConcluded,
      }).cls
    : cheap.cls;

  // repair, once, before gating: a repaired tree is the one that should be judged. It is committed
  // locally only; it reaches the pull request after the gates pass on it, never before.
  let repairPending = false;
  if (isRepairable(cls)) {
    const budget: RepairBudget = {
      path: "A", attemptsThisRun: 0, attemptsThisPr: run!.attemptsThisPr,
      lastRunAt: force ? undefined : run!.lastReverifyAt, now: deps.now(),
    };
    const may = mayRepair(budget);
    if (!may.ok) return fail(cls, `Parked: ${cls}`, may.why, `${runId}: parked after ${cls} — ${may.why}`);
    // the subject comes from the probe that classified the tree: the only place that knows it
    const subject = cls === "conflict" ? (m?.conflicts ?? []) : (m?.failedTests ?? []);
    attempted = true;
    const r = await deps.repair(cls as "conflict" | "broken-merge", { runId, subject });
    if (!r.made) return fail(cls, `Could not repair ${cls}`, r.why);
    // the repaired tree is a different tree; verify it rather than the one we classified
    merge = undefined;
    const v = await probe(true);
    if (!v.mergesClean || !v.testsPass) {
      const still = !v.mergesClean ? "still does not merge cleanly" : `still fails ${(v.failedTests ?? []).join(", ") || "its locked tests"}`;
      return fail(cls, "Repair did not verify", `The repair was made, but the repaired tree ${still}. Nothing was pushed.`);
    }
    repairPending = true;
  }

  // a tree that does not merge has nothing to gate, and an empty gate list must never read as green
  const judged = merge as MergeResult | undefined;
  if (judged && !judged.mergesClean) {
    return fail(cls, "Does not merge cleanly", `The branch does not merge cleanly with ${pr.baseSha.slice(0, 8)} (${(judged.conflicts ?? []).join(", ") || "no paths reported"}), and ${cls} is not repaired automatically.`);
  }
  // tests that fail on the merge result are never green, whatever the class: only conflict and
  // broken-merge are repaired, so every other class is reported here, before review-2 is paid for
  if (judged && !repairPending && !judged.testsPass) {
    return fail(cls, "Tests fail on the merge result", `Failing on the merge with ${pr.baseSha.slice(0, 8)}: ${(judged.failedTests ?? []).join(", ") || "the locked tests"}. ${cls} is not repaired automatically.`);
  }

  // When nothing moved, the recorded hashes ARE the current hashes — that is what "unchanged" means.
  // Starting a container to recompute them would defeat the entire staleness model, which is the one
  // property this design is built on.
  const current = merge?.current ?? run!.recorded;
  const known = new Map([...run!.recorded, ...(run!.reviewed ?? [])]);
  const { replay, rerun } = plan(known, current, force);

  // the model review comes after the deterministic picture is in hand, so a tree that does not
  // compile costs no tokens
  const modelRerun = rerun.filter((id) => MODEL_GATES.has(id));
  if (modelRerun.length) {
    const tree = merge ?? (await probe());
    await deps.review2({ runId, mergeSha: tree.mergeSha, diffSha: tree.diffSha });
    for (const id of modelRerun) reviewed[id] = current.get(id)!;
  }
  const outcomes = await deps.runGates({ ids: [...current.keys()], replay, evidence: merge?.evidence });

  const failed = outcomes.filter((o) => !o.passed);
  let conclusion: Conclusion = failed.length ? "failure" : "success";
  let summary = failed.length
    ? failed.map((f) => `- ${f.id}: ${f.details}`).join("\n")
    : `${outcomes.length} gates passed (${replay.length} replayed, ${rerun.length} re-run).`;

  // only a gated tree is pushed, and the check belongs to the head the pull request now has
  let checkSha = pr.headSha;
  let repaired = false;
  if (repairPending && conclusion === "success") {
    const p = await deps.pushRepair({ runId, headRef: pr.headRef });
    if (!p.pushed) return fail(cls, `Could not push the ${cls} repair`, p.why);
    checkSha = p.sha ?? merge!.mergeSha;
    repaired = true;
  } else if (repairPending) {
    summary += "\n\nThe repair was not pushed, because the repaired tree did not pass these gates.";
  }

  await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: checkSha, conclusion, title: `${cls}: ${failed.length ? `${failed.length} blocking` : "clear"}`, summary });
  await deps.writeComment({ pr: a.pr, runId, body: `**Merge gate — ${cls}**\n\n${summary}${repaired ? "\n\n_Repaired automatically after this pull request was last reported on; re-read the diff._" : ""}` });
  if (failed.length) await deps.notify(`${runId}: merge gate failed — ${failed.map((f) => f.id).join(", ")}`);
  await record(conclusion, cls, checkSha);

  return done(conclusion, cls, summary, repaired);
}
