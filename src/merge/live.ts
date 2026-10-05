// Wiring the real world into `reviewPr` and `verifyMergeGroup`.
//
// UNVERIFIED. Every function here touches the ledger, a worktree or Docker, none of which run on a
// native Windows host (src/util/paths.ts refuses, and fsync is unreliable on /mnt). The decisions
// these feed — orchestrate.ts and group-run.ts — are covered by 31 tests against fakes; this
// assembly is not, and must be exercised under WSL2 before it is trusted.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import type { Gh } from "../forge/github.js";
import { addWorktree, git, gitOut, resolveRef } from "../ledger/git.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { factoryHome, paths } from "../util/paths.js";
import { hashJson } from "../util/hash.js";
import { DockerCli } from "../verify/runtime.js";
import { labFor } from "../verify/lab.js";
import { writeFileSync } from "node:fs";
import { createSnapshot, snapshotDir } from "../context/snapshot.js";
import { readApproved } from "../conventions/store.js";
import { HUMAN_WRITER } from "../ledger/ledger.js";
import { diffFiles } from "../stages/deliver.js";
import { modelFor } from "../stages/routing.js";
import type { Review2Inputs } from "../stages/review2.js";
import { commitsWithTrailers, forgeAdapter, mergeInto, openRunFacts, recordedVerdicts, reverifyWorktree } from "./adapters.js";
import { runMergeGates, type MergeEvidence } from "./gates-run.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { proposeRepair, repairIsEmpty } from "./repair-run.js";
import { runMergeReview } from "./review-run.js";
import type { MergeResult, ReviewPrDeps } from "./orchestrate.js";
import type { GroupDeps } from "./group-run.js";
import { resolveRunId } from "./sync.js";

export interface LiveOpts { cfg: ProjectConfig; gh: Gh; log: (s: string) => void; policy?: typeof DEFAULT_POLICY }

/** A worktree at the PR head with the base merged in. Never pushed from here. */
async function mergedWorktree(o: LiveOpts, runId: string, headSha: string, baseSha: string) {
  const wt = reverifyWorktree(runId);
  await addWorktree(o.cfg.repo, wt, `factory/reverify-${runId.slice(-8)}`, headSha, runId);
  const merged = await mergeInto(wt, baseSha);
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
      const { wt, merged } = await mergedWorktree(o, a.runId, a.headSha, a.baseSha);
      if (!merged.clean) {
        o.log(`conflict in ${merged.conflicts.length} file(s): ${merged.conflicts.slice(0, 5).join(", ")}`);
        return { mergesClean: false, testsPass: false, current: new Map(), diffSha: "", mergeSha: "" };
      }
      const mergeSha = (await gitOut(wt, ["rev-parse", "HEAD"])).trim();
      const base = (await gitOut(wt, ["merge-base", "HEAD", a.baseSha])).trim();
      const diff = (await git(wt, ["diff", "--no-color", "-U5", base, "HEAD"])).stdout;

      const ledger = Ledger.open(a.runId);
      const diffSha = ledger.putArtifact(diff);

      const pk = join(factoryHome(), "tmp", `reverify-${a.runId}`, o.cfg.stack === "node" ? "npm-cache" : "nuget");
      mkdirSync(pk, { recursive: true });
      const out = await labFor(o.cfg).produce({
        runId: a.runId, key: "merge-verify", repo: wt, commit: mergeSha, stage: "integrate",
        exp: { expectPass: [], expectFail: [], compareToBaseline: [] },
        project: o.cfg, rt, packagesDir: pk,
        onContainer: async (id, role) => o.log(`  container ${role} ${id.slice(0, 12)}`),
      });

      // what each gate depends on, for the replay decision. Tree-derived gates move with the merge
      // result; the review gates move with what the reviewer reads.
      const current = new Map<string, string>([
        ["build.clean", hashJson({ build: out.build })],
        ["tests.expectations", hashJson({ run: out.testRun })],
        ["lint.no-new-findings", hashJson({ lint: out.lint?.findings ?? [], files: diff.length })],
        ["conventions.followed", hashJson({ diffSha })],
        ["review.covers-every-criterion", hashJson({ diffSha })],
        ["review-2.no-blocking", hashJson({ diffSha })],
      ]);
      lastVerify = {
        lint: { findings: out.lint?.findings ?? [] },
        verification: {
          failed: out.testRun.results.filter((r) => r.outcome === "failed").map((r) => r.id).sort(),
          flaky: out.testRun.results.filter((r) => r.flaky).map((r) => r.id).sort(),
        },
      };
      const evidence: MergeEvidence = {
        build: out.build, testRun: out.testRun, lint: out.lint, lintBaseline: [],
        secretScan: { kind: "secrets", commit: mergeSha, hits: [] },
        diff: { files: diffFiles(diff).map((path) => ({ path, added: [], removed: [] })) },
        guidelines: readApproved(o.cfg.project),
        violations: [],
        spec: { requirements: [] },
        head: { sha: a.headSha },
        gatedSha: mergeSha,
      };
      return {
        mergesClean: true,
        testsPass: out.testRun.results.every((r) => r.outcome !== "failed"),
        current, diffSha, mergeSha,
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
      const replay = new Map([...recordedVerdicts(ledger)].filter(([id]) => a.replay.includes(id)));
      return runMergeGates(ledger, HUMAN_WRITER, o.policy ?? DEFAULT_POLICY, {
        evidence, step: "reverify", treeSha, replay,
      });
    },

    async repair(cls, a) {
      // the budget was already checked by mayRepair; what remains is the work and the binding
      const ledger = Ledger.open(a.runId);
      const state = replay(ledger.events());
      const lock = ledger.getJson<{ lock: { file: string }[] }>(state.steps.get("author-tests")!.outputs[0]!);
      const wt = reverifyWorktree(a.runId);
      const snap = createSnapshot(wt, "HEAD", snapshotDir(a.runId, `repair-${Date.now()}`), o.cfg.noGo);

      const proposal = await proposeRepair({
        snap, lockedFiles: lock.lock.map((x) => x.file), cls,
        subject: [], noGo: o.cfg.noGo, log: o.log,
        model: modelFor(o.cfg, "implement", 0).model,
        stronger: modelFor(o.cfg, "implement", 2).model,
      }, a.runId);

      if (repairIsEmpty(proposal)) {
        const why = proposal.rejected.length
          ? `the repair only proposed edits to locked test files (${proposal.rejected.map((r) => r.path).join(", ")}), which are not allowed`
          : "the repair proposed no changes";
        return { pushed: false, why };
      }
      for (const e of proposal.edits) writeFileSync(join(wt, e.path), e.content);
      await git(wt, ["add", "-A"]);
      // the trailer is what the NEXT webhook reads to recognise this push as ours
      await git(wt, ["commit", "-m", `factory: repair ${cls}

${proposal.summary}

${proposal.trailer}`]);
      return { pushed: true, why: proposal.summary };
    },

    now: () => Date.now(),
  };
}

export async function liveGroupDeps(o: LiveOpts): Promise<GroupDeps> {
  const rt = new DockerCli();
  const forge = forgeAdapter({ gh: o.gh, cfg: o.cfg, requiredChecks: [] });

  return {
    async membersOf(ref) {
      // GitHub does not list a merge group's members directly; the queue ref's commit message names
      // each pull request it speculates on.
      const sha = await resolveRef(o.cfg.repo, ref);
      const body = await gitOut(o.cfg.repo, ["log", "-1", "--format=%B", sha]);
      const prs = [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const out: { pr: number; headRef: string; reviewBody?: string }[] = [];
      for (const pr of [...new Set(prs)]) {
        const { getPr, findReviewBody } = await import("../forge/github.js");
        const p = await getPr(o.gh, pr);
        out.push({ pr, headRef: p.headRef, reviewBody: await findReviewBody(o.gh, pr) });
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
