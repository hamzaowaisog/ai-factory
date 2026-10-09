// The thin layer between `reviewPr`'s decisions and the real world. Everything here touches the
// ledger, a worktree, Docker or GitHub — which is why it is kept separate from orchestrate.ts,
// where the decisions live and can be tested without any of them.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { secret } from "../config/env.js";
import { factoryLogin, findReviewBody, getPr, type Gh, listChecks, setCommitStatus, upsertReviewComment } from "../forge/github.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { fetchForGate, git, gitOut } from "../ledger/git.js";
import { notifiersFor } from "../watch/notify.js";
import { paths } from "../util/paths.js";
import type { Conclusion, GateOutcome, PrFacts, ReviewPrDeps, RunFacts } from "./orchestrate.js";

/** Every gate decision this run recorded, by gate id, with the inputs hash it was computed from. */
export function recordedGateHashes(events: { type: string; data?: Record<string, unknown>; inputsHash?: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ev of events) {
    if (ev.type !== "gate.result") continue;
    const id = String(ev.data?.gateId ?? "");
    if (id && ev.inputsHash) out.set(id, ev.inputsHash);          // later decisions win
  }
  return out;
}

/** Every gate verdict this run recorded, by gate id, newest winning. */
export function recordedVerdicts(ledger: Ledger): Map<string, GateOutcome> {
  const out = new Map<string, GateOutcome>();
  for (const ev of ledger.events()) {
    if (ev.type !== "gate.result") continue;
    const id = String(ev.data?.gateId ?? "");
    if (!id) continue;
    out.set(id, { id, passed: ev.data?.passed === true, details: String(ev.data?.details ?? "") });
  }
  return out;
}

/** The commit trailers of each commit in a range, for the repair-loop guard. */
export async function commitsWithTrailers(repo: string, from: string, to: string): Promise<{ sha: string; trailers: string[] }[]> {
  if (from === to) return [];
  // %x1e between commits, %x1f between sha and body: characters git will not emit itself.
  // First parent only: a repair is a merge commit, and its second parent brings in the base's own
  // commits, which carry no trailer and would read as commits nobody in the factory wrote.
  const out = await gitOut(repo, ["log", "--first-parent", "--format=%H%x1f%B%x1e", `${from}..${to}`]);
  return out.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => {
    const [sha, body = ""] = c.split("\x1f");
    return { sha: sha!.trim(), trailers: body.split("\n").map((l) => l.trim()).filter((l) => /^[A-Za-z-]+:\s/.test(l)) };
  });
}

export function openRunFacts(runId: string): RunFacts | undefined {
  if (!Ledger.exists(runId)) return undefined;                     // not on this host
  const ledger = Ledger.open(runId);
  const events = ledger.events();
  const state = replay(events);
  const integrate = state.steps.get("integrate");
  const deliver = state.steps.get("deliver");
  if (!integrate?.data?.commit) return undefined;                  // never reached a gated commit
  // the last verdict reverify wrote (recordReverify): what it judged, and when
  const reverify = state.steps.get("reverify");
  const rv = reverify?.status === "completed" ? reverify.data : undefined;
  return {
    gatedSha: String(integrate.data.commit),
    deliveredSha: typeof deliver?.data?.head === "string" ? deliver.data.head : undefined,
    // the base the last verdict judged, so a base that moved once does not read as moved forever
    recordedBaseSha: String(rv?.baseSha ?? state.info.baseCommit ?? ""),
    recorded: recordedGateHashes(events as never),
    // the manifest commit is what binds the evidence to the branch; without it nothing reconciles
    evidenceReconciles: deliver?.status === "completed" && !!deliver.data?.manifestHash,
    priorReverifyConcluded: !!rv,
    priorConclusion: rv?.conclusion as Conclusion | undefined,
    attemptsThisPr: Number(rv?.attemptsThisPr ?? 0),
    lastReverifyAt: typeof rv?.at === "number" ? rv.at : undefined,
    judgedHeadSha: typeof rv?.headSha === "string" ? rv.headSha : undefined,
    reviewed: new Map(Object.entries((rv?.reviewed ?? {}) as Record<string, string>)),
  };
}

/** Where the forge repository is fetched from and pushed to: one URL for both, with the same token. */
export function forgeRemote(cfg: ProjectConfig): { url: string; token?: string } | undefined {
  const forge = cfg.forge;
  if (!forge) return undefined;
  return { url: forge.pushUrl ?? `https://github.com/${forge.repo}.git`, token: secret(forge.tokenEnv) };
}

/**
 * The factory's own review body, found only among reviews the factory's account wrote. When the
 * account cannot be read (an App token has no /user), no review counts and the run is resolved
 * from the branch name alone: failing closed, since the marker decides which ledger may push.
 */
export function ownReviewBody(gh: Gh): (n: number) => Promise<string | undefined> {
  let login: Promise<string | undefined> | undefined;
  return async (n) => {
    const me = await (login ??= factoryLogin(gh).catch(() => undefined));
    return me ? findReviewBody(gh, n, fetch, me) : undefined;
  };
}

export interface ForgeAdapterOpts { gh: Gh; cfg: ProjectConfig; requiredChecks: string[] }

/** The GitHub half of the deps: everything that talks to the forge. */
export function forgeAdapter(o: ForgeAdapterOpts): Pick<ReviewPrDeps, "getPr" | "findReviewBody" | "writeCheck" | "writeComment" | "notify"> {
  return {
    async getPr(n): Promise<PrFacts> {
      const pr = await getPr(o.gh, n);
      // a head in any other repository is not the factory's: refused by reviewPr, and never fetched
      // here, since this remote's branch of the same name is a different branch
      const fromFork = isFork(pr.headRepo, o.cfg.forge?.repo);
      // the fetch belongs here, beside the line that derives the base SHA from it: without it
      // `origin/<base>` is whatever was last pulled, so a base that moved reads as unchanged and the
      // gate replays a verdict for a tree that no longer exists
      await fetchForGate(o.cfg.repo, pr.baseRef, fromFork ? undefined : pr.headRef, forgeRemote(o.cfg));
      // the base SHA, not the base ref: a ref name does not change when the branch moves
      const baseSha = await gitOut(o.cfg.repo, ["rev-parse", `origin/${pr.baseRef}`]);
      return { headSha: pr.headSha, headRef: pr.headRef, baseRef: pr.baseRef, state: pr.state, merged: pr.merged, baseSha: baseSha.trim(), fromFork };
    },
    findReviewBody: ownReviewBody(o.gh),
    async writeCheck(a) {
      // the detail is in the pull request comment; a status carries the one-line verdict
      await setCommitStatus(o.gh, { context: OWN_CHECK_NAME, sha: a.headSha, conclusion: a.conclusion, description: a.title });
    },
    async writeComment(a) {
      await upsertReviewComment(o.gh, a.pr, a.runId, a.body);
    },
    async notify(msg) {
      // only on park, escalation or evidence-mismatch: notifying on success destroys the signal
      const [title, ...rest] = msg.split("\n");
      for (const n of notifiersFor(o.cfg.notify ?? {})) {
        // a failed notification must never fail the gate: the verdict is already decided
        await n.send({ title: title ?? msg, lines: rest }).catch(() => undefined);
      }
    },
  };
}

/** Required check names from branch protection, minus our own so the gate cannot wait on itself. */
export async function requiredChecksFor(gh: Gh, headSha: string, names: string[]) {
  return listChecks(gh, headSha, names);
}

/** Where a reverify run's worktree lives, kept apart from the build run's. */
export const reverifyWorktree = (runId: string) => join(paths.worktrees(), `rv-${runId.slice(-8)}`);

export function worktreeExists(runId: string): boolean {
  return existsSync(reverifyWorktree(runId));
}

/** The subject of the merge commit `mergeInto` makes, which is how `commitRepair` recognises it. */
const VERIFY_MERGE = "factory: verify the merge of";

/** True while a merge is in progress in the worktree (conflicted, or not yet committed). */
export async function merging(wt: string): Promise<boolean> {
  return git(wt, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then(() => true, () => false);
}

/**
 * Merge the base into the PR head in a throwaway worktree. Does not push.
 *
 * A clean merge is COMMITTED: the lab builds `git archive <commit>`, and an uncommitted merge leaves
 * HEAD at the PR head, so the base's changes were never built or tested. A conflicting merge is left
 * in progress, markers and both sides in place: that is what the repair has to read and resolve.
 */
export async function mergeInto(wt: string, baseSha: string): Promise<{ clean: boolean; conflicts: string[] }> {
  try {
    await git(wt, ["merge", "--no-commit", "--no-ff", baseSha]);
  } catch (e) {
    // a conflicting merge exits non-zero, which the hardened git wrapper turns into a throw
    const names = await gitOut(wt, ["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = names.split("\n").map((x) => x.trim()).filter(Boolean);
    // no conflicted path means the merge failed for another reason (a file in the way, unrelated
    // histories): not something a repair can be given, and not worth paying a model to guess at
    if (!conflicts.length) throw e;
    return { clean: false, conflicts };
  }
  // "Already up to date" starts no merge: HEAD already contains the base, and is the result
  if (await merging(wt)) await git(wt, ["commit", "--no-edit", "-m", `${VERIFY_MERGE} ${baseSha.slice(0, 8)}`]);
  return { clean: true, conflicts: [] };
}

/**
 * The worktree as it stands, conflict markers included, as a commit the snapshot can copy. A
 * conflicted index cannot be written as a tree, so a throwaway index is used instead; the merge in
 * progress is not touched. Without this the repair read HEAD: no markers, and no base side at all.
 */
export async function workingTreeCommit(wt: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "factory-index-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    await git(wt, ["read-tree", "HEAD"], { env });
    await git(wt, ["add", "-A"], { env });
    const tree = (await git(wt, ["write-tree"], { env })).stdout.trim();
    return await gitOut(wt, ["commit-tree", tree, "-p", "HEAD", "-m", "factory: the worktree a repair reads"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Commits the repair's edits, already written into the worktree, as ONE merge commit carrying the
 * trailer. A conflicted merge is concluded; a broken merge's fix is folded into the verification
 * merge; with no merge commit to fold into (the base was already merged), a plain commit on top.
 * Never commits a conflict marker or an unmerged path.
 *
 * `written` is the paths the repair wrote. Every path git left unmerged must be one of them: `add -A`
 * would otherwise settle an untouched modify/delete or binary conflict silently, in whatever state the
 * worktree happens to hold. Markers are looked for in the unmerged paths only, so a file that merely
 * contains a line of "=======" elsewhere cannot block every repair.
 */
export async function commitRepair(wt: string, message: string, written: string[]): Promise<{ ok: true } | { ok: false; why: string }> {
  const unmerged = (await gitOut(wt, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
  const untouched = unmerged.filter((f) => !written.includes(f));
  if (untouched.length) return { ok: false, why: `the repair left a conflict unresolved in ${untouched.join(", ")}` };
  const marked = unmerged.filter((f) => existsSync(join(wt, f)) && CONFLICT_MARKER.test(readFileSync(join(wt, f), "utf8")));
  if (marked.length) return { ok: false, why: `the repair left conflict markers in ${marked.join(", ")}` };
  await git(wt, ["add", "-A"]);
  // only the verification merge is folded into: amending anything else would rewrite the pull
  // request's own history
  const fold = !(await merging(wt)) && (await gitOut(wt, ["log", "-1", "--format=%s"])).startsWith(VERIFY_MERGE);
  await git(wt, fold ? ["commit", "--amend", "-m", message] : ["commit", "-m", message]);
  return { ok: true };
}

const CONFLICT_MARKER = /^(<{7}|>{7})(\s|$)/m;

/**
 * True when writing `rel` stays inside the worktree once symlinks are followed. A committed symlink
 * (docs -> ~/.factory) would otherwise carry a repair's write onto the host before git ever saw it.
 */
export function insideWorktree(wt: string, rel: string): boolean {
  const root = realpathSync(wt);
  let p = resolve(wt, rel);
  // the deepest part of the path that exists is where the write would really land
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  const real = realpathSync(p);
  return real === root || real.startsWith(root + sep);
}

/** A head branch in any other repository than the configured one. GitHub's names ignore case. */
export function isFork(headRepo: string, repo: string | undefined): boolean {
  return !headRepo || !repo || headRepo.toLowerCase() !== repo.toLowerCase();
}
