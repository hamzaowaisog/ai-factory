// Path A: gating a pull request before it may enter the merge queue.
import type { GateDef } from "../gates/engine.js";
import { diffSize, noSecrets, shaBinding, testExpectations } from "../gates/predicates.js";
import { reviewCoversCriteria } from "../gates/coverage.js";
import { buildClean, conventionsFollowed, externalGreen, lintNoNewFindings } from "../gates/merge-gate.js";

/**
 * Both Harness inputs are untrusted. Without an exact match, a crafted webhook payload aims the
 * factory — holding your forge credential — at a repository nobody configured. No normalising, no
 * case-folding, no substring matching.
 */
export function assertRepository(configured: string, given: unknown): void {
  if (typeof given !== "string" || given !== configured) {
    throw new Error(`Refusing: the requested repository ${JSON.stringify(given)} does not match the configured forge.repo ${JSON.stringify(configured)}.`);
  }
}

export function assertPrNumber(given: unknown): number {
  const n = typeof given === "number" ? given : Number(String(given).trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Refusing: ${JSON.stringify(given)} is not a positive integer pull request number.`);
  }
  return n;
}

/**
 * Order is load-bearing:
 *  - the deterministic gates first, so a change that does not compile costs nothing in tokens;
 *  - coverage before the review verdict, because an incomplete review is not yet a review;
 *  - `checks.external-green` LAST, because a repair push restarts every external check and a
 *    verdict gathered earlier is stale. Its conclusion must cite the final head SHA.
 */
export function gateOrder(): GateDef[] {
  return [
    buildClean, testExpectations, noSecrets, shaBinding, diffSize,
    lintNoNewFindings, conventionsFollowed,
    reviewCoversCriteria,
    externalGreen,
  ] as GateDef[];
}

/** Gates whose verdict is a model judgement rather than a deterministic function of the tree. */
const MODEL_GATES = new Set(["review.no-blocking", "review-2.no-blocking", "review.covers-every-criterion"]);

/**
 * The gate does not re-check anything. It recomputes each decision's inputs hash and compares it
 * with the recorded one: equal means the decision still holds and is replayed, costing nothing.
 *
 * `force` is the one override, and it is deliberately narrow: it re-runs the MODEL reviews only.
 * Re-running a deterministic gate on an identical tree cannot produce a different answer, so
 * forcing those would be pure waste. Forcing a model review can, because a model is not
 * deterministic — which is the whole reason a person might want this.
 */
export function planWork(a: {
  recorded: Map<string, string>;
  current: Map<string, string>;
  force?: boolean;
}): { replay: string[]; rerun: string[]; forced: boolean } {
  const replay: string[] = [];
  const rerun: string[] = [];
  for (const [id, hash] of a.current) {
    const stale = a.recorded.get(id) !== hash;
    (stale || (a.force === true && MODEL_GATES.has(id)) ? rerun : replay).push(id);
  }
  return { replay, rerun, forced: a.force === true };
}
