// Wiring the real world into `reviewPr` and `verifyMergeGroup`.
//
// UNVERIFIED. Every function here touches the ledger, a worktree or Docker, none of which run on a
// native Windows host (src/util/paths.ts refuses, and fsync is unreliable on /mnt). The decisions
// these feed — orchestrate.ts and group-run.ts — are covered by 31 tests against fakes; this
// assembly is not, and must be exercised under WSL2 before it is trusted.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { secret } from "../config/env.js";
import type { Gh } from "../forge/github.js";
import { addWorktree, authEnv, freshWorktree, git, gitOut, resolveRef } from "../ledger/git.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { factoryHome, paths } from "../util/paths.js";
import { DockerCli } from "../verify/runtime.js";
import { labFor } from "../verify/lab.js";
import { ensureEgress, feedHostsFrom } from "../runners/netinfra.js";
import { createSnapshot, snapshotDir } from "../context/snapshot.js";
import { readApproved } from "../conventions/store.js";
import { HUMAN_WRITER } from "../ledger/ledger.js";
import { diffFiles } from "../stages/deliver.js";
import { modelFor } from "../stages/routing.js";
import type { Review2Inputs } from "../stages/review2.js";
import { commitRepair, commitsWithTrailers, failingTests, forgeAdapter, gateDiff, unknownFailures, mergeExpectations, forgeRemote, insideWorktree, mergeInto, merging, openRunFacts, ownReviewBody, recordedVerdicts, reverifyWorktree, workingTreeCommit, worktreeExists } from "./adapters.js";
import { plannedInputHashes, reviewEvidence, runMergeGates, type MergeEvidence } from "./gates-run.js";
import { gateInputsHash } from "../gates/engine.js";
import { scanText } from "../context/secrets.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { proposeRepair, repairIsEmpty } from "./repair-run.js";
import { runMergeReview } from "./review-run.js";
import type { MergeResult, ReviewPrDeps } from "./orchestrate.js";
import type { TestRun } from "../contracts/index.js";
import type { GroupDeps } from "./group-run.js";
import { repairTrailer, resolveRunId } from "./sync.js";

export interface LiveOpts { cfg: ProjectConfig; gh: Gh; log: (s: string) => void; policy?: typeof DEFAULT_POLICY }

/**
 * A worktree at the PR head with the base merged in. Never pushed from here.
 *
 * `afterRepair` is the case that used to be impossible: the repair committed into this worktree, so
 * rebuilding it from the PR head would throw away the repair and verify the broken tree. Then the
 * rebuild itself threw anyway, because the path and the branch both already existed.
 */
async function mergedWorktree(o: LiveOpts, runId: string, headSha: string, baseSha: string, afterRepair = false) {
  const wt = reverifyWorktree(runId);
  if (afterRepair) {
    if (!worktreeExists(runId)) throw new Error(`No reverify worktree for ${runId}: nothing to verify after the repair.`);
    // already at the merge result plus the repair commit, and already merged: do not touch it
    return { wt, merged: { clean: true, conflicts: [] } };
  }
  await freshWorktree(o.cfg.repo, wt, `factory/reverify-${runId.slice(-8)}`, headSha, runId);
  // the trailer marks a merge settled without a model as the factory's own, should it be pushed
  const merged = await mergeInto(wt, baseSha, repairTrailer(runId));
  return { wt, merged };
}

export async function liveDeps(o: LiveOpts): Promise<ReviewPrDeps> {
  const rt = new DockerCli();
  const forge = forgeAdapter({ gh: o.gh, cfg: o.cfg, requiredChecks: [] });
  // learned when the pull request is resolved to its run, and needed again when the gates run
  let runId = "";
  // what the verify pass actually found. review-2 is shown these, and telling it the tests were
  // clean when they were not would make its judgement worthless.
  let lastVerify: { lint: { findings: unknown[] }; verification: { failed: string[]; flaky: string[] } } | undefined;

  return {
    ...forge,
    openRun: (id) => { runId = id; return openRunFacts(id); },
    commitsSince: (gated, head) => commitsWithTrailers(o.cfg.repo, gated, head),

    async mergeVerify(a): Promise<MergeResult> {
      const { wt, merged } = await mergedWorktree(o, a.runId, a.headSha, a.baseSha, a.afterRepair);
      if (!merged.clean) {
        o.log(`conflict in ${merged.conflicts.length} file(s): ${merged.conflicts.slice(0, 5).join(", ")}`);
        // the paths travel with the result: the repair is given them, not asked to guess
        return { mergesClean: false, testsPass: false, conflicts: merged.conflicts, settled: merged.settled, current: new Map(), diffSha: "", mergeSha: "" };
      }
      // the merge result is committed (mergeInto, or the repair), so HEAD is what the lab builds
      const mergeSha = (await gitOut(wt, ["rev-parse", "HEAD"])).trim();
      // what this pull request adds on top of the base it now contains
      const diff = await gateDiff(wt, a.baseSha);

      const ledger = Ledger.open(a.runId);
      const diffSha = ledger.putArtifact(diff);
      const policy = o.policy ?? DEFAULT_POLICY;
      // the run's own tests: what was locked must pass, and a test that already failed on the run's
      // base is not this pull request's to fix (failingTests)
      const state = replay(ledger.events());
      const lock = ledger.getJson<{ tests: { testId: string }[]; characterisation?: { testId: string }[] }>(state.steps.get("author-tests")!.outputs[0]!);
      const baselineSha = state.steps.get("discover")?.outputs[0];
      const baseline = baselineSha ? ledger.getJson<TestRun>(baselineSha) : undefined;

      const pk = join(factoryHome(), "tmp", `reverify-${a.runId}`, o.cfg.stack === "node" ? "npm-cache" : "nuget");
      mkdirSync(pk, { recursive: true });
      // the restore container reaches the feeds only through the proxy on FEEDS_NET, which a reboot
      // takes down: the build sets it up before every lab run, and so must this
      await ensureEgress(rt, feedHostsFrom(policy.registryAllowlist));
      const out = await labFor(o.cfg).produce({
        runId: a.runId, key: "merge-verify", repo: wt, commit: mergeSha, stage: "integrate",
        exp: mergeExpectations(lock),
        knownFailures: new Set(failingTests(baseline?.results ?? [], undefined)),
        project: o.cfg, rt, packagesDir: pk,
        onContainer: async (id, role) => o.log(`  container ${role} ${id.slice(0, 12)}`),
      });

      lastVerify = {
        lint: { findings: out.lint?.findings ?? [] },
        verification: {
          failed: failingTests(out.testRun.results, baseline),
          flaky: out.testRun.results.filter((r) => r.flaky).map((r) => r.id).sort(),
        },
      };
      const evidence: MergeEvidence = {
        // no lint here: the run records no lint baseline, so every warning already in a touched file
        // would count as new, and the build never ran this gate either. review-2 still reads the findings.
        build: out.build, testRun: out.testRun, baseline, lintBaseline: [],
        // the lines this tree adds, scanned for real: a repair is pushed with the forge token
        secretScan: { kind: "secrets", commit: mergeSha, hits: secretHits(diff) },
        diff: { files: diffFiles(diff).map((path) => ({ path, added: [], removed: [] })) },
        guidelines: readApproved(o.cfg.project),
        violations: [],
        spec: { requirements: [] },
        head: { sha: a.headSha },
        gatedSha: mergeSha,
      };
      // what each gate depends on, for the replay decision, hashed exactly as the engine records it
      // so an unchanged gate can ever match. The review gates move with what the reviewer reads.
      const current = plannedInputHashes(ledger, policy, evidence);
      for (const id of ["review.covers-every-criterion", "review-2.no-blocking"]) current.set(id, gateInputsHash(id, { diff: diffSha }, policy));
      return {
        mergesClean: true,
        testsPass: lastVerify.verification.failed.length === 0,
        failedTests: lastVerify.verification.failed,
        unknownFailures: unknownFailures(lastVerify.verification.failed, mergeExpectations(lock).expectPass, baseline),
        current, diffSha, mergeSha, settled: merged.settled,
        evidence: { ledger, evidence, treeSha: mergeSha },
      };
    },

    async review2(a) {
      const ledger = Ledger.open(a.runId);
      const state = replay(ledger.events());
      const conv = readApproved(o.cfg.project);
      if ("unapproved" in conv) throw new Error(conv.unapproved);

      const diff = ledger.getArtifact(a.diffSha).toString("utf8");
      const lock = ledger.getJson<{ tests: Review2Inputs["acTests"]["tests"] }>(state.steps.get("author-tests")!.outputs[0]!);
      const questions = state.steps.get("clarify")?.outputs[0];
      const snap = createSnapshot(o.cfg.repo, a.mergeSha, snapshotDir(a.runId, a.mergeSha), o.cfg.noGo);

      await runMergeReview({
        ledger, writer: HUMAN_WRITER, runId: a.runId, snap, noGo: o.cfg.noGo, log: o.log,
        inputs: {
          diff,
          intent: ledger.getJson(state.steps.get("intake")!.outputs[0]!),
          spec: ledger.getJson(state.steps.get("specify")!.outputs[0]!),
          plan: ledger.getJson(state.steps.get("plan")!.outputs[0]!),
          acTests: lock,
          assumptions: questions ? (ledger.getJson<{ assumptions: unknown[] }>(questions).assumptions ?? []) : [],
          guidelinesMarkdown: conv.markdown,
          lint: lastVerify?.lint ?? { findings: [] },
          // left undefined when no verify pass ran, so the reviewer is told nothing was checked
          // rather than shown an empty failure list that reads as clean
          verification: lastVerify?.verification,
          changedFiles: diffFiles(diff),
        },
        model: modelFor(o.cfg, "review-2", 0).model,
        stronger: modelFor(o.cfg, "review-2", 2).model,
        implementerModel: modelFor(o.cfg, "implement", 0).model,
        reviewerModel: modelFor(o.cfg, "review", 0).model,
      });
    },

    async runGates(a) {
      // an unchanged tree produced no evidence, because nothing was built: every verdict is replayed
      // from the ledger, which is what "unchanged" means
      if (!a.evidence) {
        const recorded = recordedVerdicts(Ledger.open(runId));
        // a gate with no recorded verdict has never been decided, so it cannot be replayed: failing
        // is the only honest answer, since a gate that cannot check counts as failed
        return a.ids.map((id) => recorded.get(id) ?? { id, passed: false, details: `no recorded verdict for ${id}` });
      }
      const { ledger, evidence, treeSha } = a.evidence as { ledger: Ledger; evidence: MergeEvidence; treeSha: string };
      // review-2's latest output gates too: it is of this diff, either written by this pass or
      // replayed because the diff it read is unchanged
      const state = replay(ledger.events());
      const r2 = state.steps.get("review-2");
      const spec = state.steps.get("specify")?.outputs[0];
      const judged = r2?.status === "completed" && r2.outputs.length >= 2 && spec
        ? { ...evidence, ...reviewEvidence(ledger, { reviewSha: r2.outputs[0]!, familiesSha: r2.outputs[1]!, specSha: spec }) }
        : evidence;
      const replayed = new Map([...recordedVerdicts(ledger)].filter(([id]) => a.replay.includes(id)));
      return runMergeGates(ledger, HUMAN_WRITER, o.policy ?? DEFAULT_POLICY, {
        evidence: judged, step: "reverify", treeSha, replay: replayed,
      });
    },

    async repair(cls, a) {
      // the budget was already checked by mayRepair; what remains is the work and the binding.
      // The token is checked FIRST: a repair that cannot be delivered is not worth paying a model for.
      const forge = o.cfg.forge;
      if (!forge) return { made: false, why: "no forge is configured, so a repair cannot be delivered to the pull request" };
      if (!secret(forge.tokenEnv)) return { made: false, why: `${forge.tokenEnv} is missing in ~/.factory/.env, so a repair cannot be pushed` };

      const ledger = Ledger.open(a.runId);
      const state = replay(ledger.events());
      const lock = ledger.getJson<{ lock: { file: string }[] }>(state.steps.get("author-tests")!.outputs[0]!);
      const wt = reverifyWorktree(a.runId);
      // the model reads the MERGED tree: for a conflict the working tree with its markers and both
      // sides (HEAD has neither), for a broken merge the committed merge result. Reading the PR head
      // instead made its whole-file edits silently drop whatever the base changed in those files.
      const reads = (await merging(wt)) ? await workingTreeCommit(wt) : (await gitOut(wt, ["rev-parse", "HEAD"])).trim();
      const snap = createSnapshot(wt, reads, snapshotDir(a.runId, `repair-${reads.slice(0, 12)}`), o.cfg.noGo);

      const proposal = await proposeRepair({
        snap, lockedFiles: lock.lock.map((x) => x.file), cls,
        subject: a.subject, noGo: o.cfg.noGo, log: o.log,
        model: modelFor(o.cfg, "implement", 0).model,
        stronger: modelFor(o.cfg, "implement", 2).model,
      }, a.runId);

      if (repairIsEmpty(proposal)) {
        const why = proposal.rejected.length
          ? `the repair only proposed edits it may not make (${proposal.rejected.map((r) => `${r.path}: ${r.why}`).join("; ")})`
          // case 4 of the conflict policy: declining to guess is a correct outcome, and the model's
          // reason is the most useful thing a person can be handed here
          : `the repair declined to resolve this automatically: ${proposal.summary}`;
        return { made: false, why };
      }
      // paths are already normalised and checked by proposeRepair; a symlink in the merged tree must
      // still not carry a write out of the worktree, so every target is checked before any is written
      const escapes = proposal.edits.filter((e) => !insideWorktree(wt, e.path)).map((e) => e.path);
      if (escapes.length) return { made: false, why: `the repair would write outside the worktree through a link: ${escapes.join(", ")}` };
      for (const e of proposal.edits) {
        mkdirSync(dirname(join(wt, e.path)), { recursive: true });
        writeFileSync(join(wt, e.path), e.content);
      }
      // ONE merge commit, carrying the trailer the next pass reads to recognise this push as ours
      const c = await commitRepair(wt, `factory: repair ${cls}

${proposal.summary}

${proposal.trailer}`, proposal.edits.map((e) => e.path));
      if (!c.ok) return { made: false, why: c.why };
      return { made: true, why: proposal.summary };
    },

    async pushRepair(a) {
      // reached only once the repaired tree has been verified and every gate passed on it: deliver's
      // rule, that only a gated tree is pushed, holds here too
      const remote = forgeRemote(o.cfg);
      if (!remote?.token) return { pushed: false, why: "no forge token is configured, so the repair cannot be pushed" };
      const wt = reverifyWorktree(a.runId);
      const sha = (await gitOut(wt, ["rev-parse", "HEAD"])).trim();
      try {
        await git(wt, ["push", remote.url, `HEAD:refs/heads/${a.headRef}`], { env: authEnv(remote.token) });
      } catch (e) {
        // the edits are committed locally but the pull request has not moved, so this is NOT a repair
        const why = (e as Error).message.replaceAll(remote.token, "«SECRET»").slice(0, 300);
        return { pushed: false, why: `the repair passed but could not be pushed to ${a.headRef}: ${why}` };
      }
      o.log(`pushed the repair to ${a.headRef}`);
      return { pushed: true, why: "pushed", sha };
    },

    async recordReverify(r) {
      // the next pass reads this back through openRunFacts: without it nothing ever stopped the loop
      const { runId, ...data } = r;
      await Ledger.open(runId).append({ type: "step.completed", key: "reverify", outputs: [], data }, HUMAN_WRITER);
    },

    now: () => Date.now(),
  };
}

/** Secret-scan hits in the lines a diff adds, file by file, the way deliver scans a branch. */
function secretHits(diff: string): { file: string; line: number; rule: string }[] {
  const hits: { file: string; line: number; rule: string }[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++")) hits.push(...scanText(file, line.slice(1)).map((h) => ({ ...h, line: 0 })));
  }
  return hits;
}

export async function liveGroupDeps(o: LiveOpts): Promise<GroupDeps> {
  const rt = new DockerCli();
  const forge = forgeAdapter({ gh: o.gh, cfg: o.cfg, requiredChecks: [] });
  const reviewBody = ownReviewBody(o.gh);

  return {
    async membersOf(ref) {
      // GitHub does not list a merge group's members directly; the queue ref's commit message names
      // each pull request it speculates on.
      const sha = await resolveRef(o.cfg.repo, ref);
      const body = await gitOut(o.cfg.repo, ["log", "-1", "--format=%B", sha]);
      const prs = [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const out: { pr: number; headRef: string; reviewBody?: string }[] = [];
      for (const pr of [...new Set(prs)]) {
        const { getPr } = await import("../forge/github.js");
        const p = await getPr(o.gh, pr);
        out.push({ pr, headRef: p.headRef, reviewBody: await reviewBody(pr) });
      }
      return out;
    },

    resolveMember(m) {
      const r = resolveRunId({ reviewBody: m.reviewBody, headRef: m.headRef });
      if ("anomaly" in r) return { runId: undefined, anomaly: r.anomaly };
      const facts = openRunFacts(r.runId);
      if (!facts) return { runId: undefined, anomaly: `no ledger for ${r.runId} on this host` };
      const ledger = Ledger.open(r.runId);
      const state = replay(ledger.events());
      const lock = state.steps.get("author-tests");
      const tests = lock?.status === "completed"
        ? (ledger.getJson<{ tests: { testId: string }[] }>(lock.outputs[0]!).tests ?? []).map((t) => t.testId)
        : [];
      return { runId: r.runId, lockedTestIds: tests };
    },

    async verifyRef(a) {
      const wt = join(paths.worktrees(), `mg-${a.ref.split("/").pop()!.slice(0, 12)}`);
      const sha = await resolveRef(o.cfg.repo, a.ref);
      await addWorktree(o.cfg.repo, wt, `factory/mg-${sha.slice(0, 8)}`, sha, "merge-group");
      const pk = join(factoryHome(), "tmp", `mg-${sha.slice(0, 8)}`, o.cfg.stack === "node" ? "npm-cache" : "nuget");
      mkdirSync(pk, { recursive: true });
      const out = await labFor(o.cfg).produce({
        runId: `mg-${sha.slice(0, 8)}`, key: "merge-group", repo: wt, commit: sha, stage: "integrate",
        exp: { expectPass: a.testIds, expectFail: [], compareToBaseline: [] },
        project: o.cfg, rt, packagesDir: pk, onlyTests: a.testIds,
        onContainer: async (id, role) => o.log(`  container ${role} ${id.slice(0, 12)}`),
      });
      return {
        built: out.build.ok,
        failed: out.testRun.results.filter((r) => r.outcome === "failed").map((r) => r.id),
        details: out.build.errors.slice(0, 3).map((e) => `${e.file}:${e.line} ${e.code}`).join("; "),
      };
    },

    async runGates() {
      throw new Error("the gate loop is not wired to the executor yet: see docs/merge-gate-setup.md");
    },

    writeCheck: (x) => forge.writeCheck({ ...x, name: OWN_CHECK_NAME }),
    commentOnPr: (x) => forge.writeComment({ pr: x.pr, runId: `group-${Date.now()}`, body: x.body }),
    notify: forge.notify,
  };
}
