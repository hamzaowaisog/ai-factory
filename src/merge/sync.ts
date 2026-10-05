// Cheap, local, and FIRST: classification decides whether any container starts or any token is
// spent. Nothing here touches the network, the clock or the filesystem.

export type DriftClass =
  | "evidence-mismatch" | "self-push" | "unexpected-commits"
  | "conflict" | "broken-merge" | "base-moved-clean" | "unchanged";

const MARKER = /<\!--\s*factory-review:([A-Za-z0-9._-]+)\s*-->/;
const BRANCH = /(run-[A-Za-z0-9._-]+)$/;

/** The trailer every factory repair commit carries, so the next webhook recognises it as ours. */
export function repairTrailer(reverifyRunId: string): string {
  return `Factory-Repair: ${reverifyRunId}`;
}

/**
 * Every PR is the factory's, so a missing marker is not a benign case to wave through — it means
 * the marker was edited away, or something opened a PR outside the factory. Two keys: the review
 * body's marker, then the branch name, which cannot be edited without becoming a different branch.
 */
export function resolveRunId(a: { reviewBody?: string; headRef: string }):
  | { runId: string; via: "marker" | "branch" }
  | { anomaly: string } {
  const m = a.reviewBody ? MARKER.exec(a.reviewBody) : null;
  if (m) return { runId: m[1]!, via: "marker" };
  const b = BRANCH.exec(a.headRef);
  if (b) return { runId: b[1]!, via: "branch" };
  return {
    anomaly: `This pull request cannot be attributed to a factory run: no review marker, and the branch "${a.headRef}" carries no run id. Every pull request on this repository is the factory's, so this needs a person.`,
  };
}

export interface ClassifyInput {
  /** `~/.factory/ledger/<runId>/` is present on this host */
  ledgerPresent: boolean;
  /** recorded gate decisions, the evidence manifest commit and the locked-test fingerprints reconcile */
  evidenceReconciles: boolean;
  headSha: string;
  gatedSha: string;
  baseSha: string;
  recordedBaseSha: string;
  newCommits: { sha: string; trailers: string[] }[];
  mergesClean: boolean;
  mergeTestsPass: boolean;
  priorReverifyConcluded: boolean;
}

const isRepair = (c: { trailers: string[] }) => c.trailers.some((t) => /^Factory-Repair:\s*\S/.test(t));

/** Exactly one class applies, checked in this order. */
export function classify(i: ClassifyInput): { cls: DriftClass; why: string } {
  // FIRST, above even the loop guard: both checks are cheap and local, and a tampering or
  // corruption signal must never be masked by a self-push short-circuit.
  if (!i.ledgerPresent) {
    return { cls: "evidence-mismatch", why: "No ledger for this run on this host: its requirements, gate decisions and locked tests cannot be read, so nothing can be replayed or verified." };
  }
  if (!i.evidenceReconciles) {
    return { cls: "evidence-mismatch", why: "The recorded gate decisions, the evidence manifest commit and the locked-test fingerprints do not reconcile." };
  }
  // SECOND: the loop guard. Still ahead of every repair, every model call and every container start.
  if (i.headSha !== i.gatedSha && i.newCommits.length > 0 && i.newCommits.every(isRepair) && i.priorReverifyConcluded) {
    return { cls: "self-push", why: `${i.newCommits.length} new commit(s), all factory repairs from a concluded reverify. Concluding from the prior result.` };
  }
  if (i.headSha !== i.gatedSha && i.newCommits.some((c) => !isRepair(c))) {
    const them = i.newCommits.filter((c) => !isRepair(c)).map((c) => c.sha.slice(0, 8)).join(", ");
    return { cls: "unexpected-commits", why: `Commits not written by the factory: ${them}. Verifying and reporting; never repairing over commits whose origin is unknown.` };
  }
  if (i.baseSha !== i.recordedBaseSha) {
    if (!i.mergesClean) return { cls: "conflict", why: `The base moved to ${i.baseSha.slice(0, 8)} and the branch no longer merges cleanly.` };
    if (!i.mergeTestsPass) return { cls: "broken-merge", why: `The base moved to ${i.baseSha.slice(0, 8)}; the merge is clean but the locked tests fail on the result.` };
    return { cls: "base-moved-clean", why: `The base moved to ${i.baseSha.slice(0, 8)} and everything still passes.` };
  }
  if (!i.mergesClean) return { cls: "conflict", why: "The branch does not merge cleanly." };
  if (!i.mergeTestsPass) return { cls: "broken-merge", why: "The merge is clean but the locked tests fail on the result." };
  return { cls: "unchanged", why: "Nothing moved: concluding from the recorded decisions." };
}

/** Only these two are repairable. Everything else is reported, replayed or stopped. */
export const REPAIRABLE: DriftClass[] = ["conflict", "broken-merge"];
export const isRepairable = (cls: DriftClass): boolean => REPAIRABLE.includes(cls);
