// Path B: the queue ref. Read-only with respect to every branch — pushing here would eject a queue
// entry that other speculated entries are stacked on top of.

const QUEUE = /^refs\/heads\/gh-readonly-queue\/(.+)\/([^/]+)$/;

export function parseMergeGroupRef(ref: string): { base: string; sha: string } {
  const m = QUEUE.exec(ref);
  if (!m) {
    throw new Error(`${ref} is not a merge queue ref (expected refs/heads/gh-readonly-queue/<base>/<sha>)`);
  }
  return { base: m[1]!, sha: m[2]! };
}

export type Member =
  | { runId: string; lockedTestIds: string[] }
  | { runId: undefined; anomaly: string };

/**
 * Because every pull request in a merge group is the factory's, path B resolves EVERY member to its
 * own run and therefore to its own locked tests — each already known to fail on code lacking its
 * change. So B never falls back to "whatever tests the repo has".
 *
 * A member that cannot contribute its tests is reported, never silently dropped: a quietly smaller
 * union would verify the group against less than it claims to.
 */
export function lockedTestUnion(members: Member[]): { ids: string[]; incomplete: { runId: string; why: string }[] } {
  const ids = new Set<string>();
  const incomplete: { runId: string; why: string }[] = [];
  for (const m of members) {
    if (m.runId === undefined) { incomplete.push({ runId: "(unresolved)", why: m.anomaly }); continue; }
    if (m.lockedTestIds.length === 0) {
      incomplete.push({ runId: m.runId, why: "no locked tests: its run never completed author-tests" });
      continue;
    }
    for (const id of m.lockedTestIds) ids.add(id);
  }
  return { ids: [...ids].sort(), incomplete };
}
