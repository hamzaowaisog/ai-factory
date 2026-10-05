// The thin layer between `reviewPr`'s decisions and the real world. Everything here touches the
// ledger, a worktree, Docker or GitHub — which is why it is kept separate from orchestrate.ts,
// where the decisions live and can be tested without any of them.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { findReviewBody, getPr, type Gh, listChecks, upsertCheckRun, upsertReviewComment } from "../forge/github.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { git, gitOut } from "../ledger/git.js";
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
  // %x1e between commits, %x1f between sha and body: characters git will not emit itself
  const out = await gitOut(repo, ["log", "--format=%H%x1f%B%x1e", `${from}..${to}`]);
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
  const reverify = state.steps.get("reverify");
  return {
    gatedSha: String(integrate.data.commit),
    recordedBaseSha: state.info.baseCommit ?? "",
    recorded: recordedGateHashes(events as never),
    // the manifest commit is what binds the evidence to the branch; without it nothing reconciles
    evidenceReconciles: deliver?.status === "completed" && !!deliver.data?.manifestHash,
    priorReverifyConcluded: reverify?.status === "completed",
    priorConclusion: reverify?.data?.conclusion as Conclusion | undefined,
    attemptsThisPr: Number(reverify?.data?.attemptsThisPr ?? 0),
    lastReverifyAt: reverify?.lastAttempt,
  };
}

export interface ForgeAdapterOpts { gh: Gh; cfg: ProjectConfig; requiredChecks: string[] }

/** The GitHub half of the deps: everything that talks to the forge. */
export function forgeAdapter(o: ForgeAdapterOpts): Pick<ReviewPrDeps, "getPr" | "findReviewBody" | "writeCheck" | "writeComment" | "notify"> {
  return {
    async getPr(n): Promise<PrFacts> {
      const pr = await getPr(o.gh, n);
      // the base SHA, not the base ref: a ref name does not change when the branch moves
      const baseSha = await gitOut(o.cfg.repo, ["rev-parse", `origin/${pr.baseRef}`]);
      return { ...pr, baseSha: baseSha.trim() };
    },
    findReviewBody: (n) => findReviewBody(o.gh, n),
    async writeCheck(a) {
      await upsertCheckRun(o.gh, { ...a, name: OWN_CHECK_NAME });
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

/** Merge the base into the PR head in a throwaway worktree. Does not push. */
export async function mergeInto(wt: string, baseSha: string): Promise<{ clean: boolean; conflicts: string[] }> {
  try {
    await git(wt, ["merge", "--no-commit", "--no-ff", baseSha]);
    return { clean: true, conflicts: [] };
  } catch {
    // a conflicting merge exits non-zero, which the hardened git wrapper turns into a throw
    const names = await gitOut(wt, ["diff", "--name-only", "--diff-filter=U"]);
    await git(wt, ["merge", "--abort"]).catch(() => undefined);
    return { clean: false, conflicts: names.split("\n").map((x) => x.trim()).filter(Boolean) };
  }
}
