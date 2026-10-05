// Path B, sequenced. Read-only with respect to every branch, and entirely deterministic: no model
// runs here. The queue is what everyone else's merges are waiting behind, so it stays fast, and a
// repair here would eject the very entry it was verifying.
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { lockedTestUnion, type Member } from "./group.js";
import type { Conclusion, GateOutcome } from "./orchestrate.js";

export interface GroupDeps {
  /** Every pull request in this merge group, in the order they will land. */
  membersOf(ref: string): Promise<{ pr: number; headRef: string; reviewBody?: string }[]>;
  /** Resolve one member to its run and its locked tests. */
  resolveMember(m: { pr: number; headRef: string; reviewBody?: string }): Member;
  /** Build the queue ref and run the given tests against it. The only container. */
  verifyRef(a: { ref: string; testIds: string[] }): Promise<{ built: boolean; failed: string[]; details: string }>;
  runGates(a: { ref: string }): Promise<GateOutcome[]>;
  writeCheck(a: { name: string; headSha: string; conclusion: Conclusion; title: string; summary: string }): Promise<void>;
  commentOnPr(a: { pr: number; body: string }): Promise<void>;
  notify(msg: string): Promise<void>;
}

export interface GroupResult { conclusion: Conclusion; why: string; tests: number; members: number }

/**
 * Because every pull request in the group is the factory's, every member resolves to its own run and
 * therefore its own locked tests. So this verifies the exact tree about to become main against the
 * UNION of all their tests — a stronger check than any single pull request's, and one only available
 * because no member can be an unattributed human PR.
 */
export async function verifyMergeGroup(deps: GroupDeps, a: { ref: string; base: string; sha: string }): Promise<GroupResult> {
  const members = await deps.membersOf(a.ref);
  const { ids, incomplete } = lockedTestUnion(members.map((m) => deps.resolveMember(m)));

  // a member that cannot contribute its tests is reported, never silently dropped: a quietly
  // smaller union would verify the group against less than it claims to
  if (incomplete.length) {
    const why = incomplete.map((x) => `${x.runId}: ${x.why}`).join("; ");
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: a.sha, conclusion: "failure", title: "A member of this group cannot be verified", summary: why });
    for (const m of members) await deps.commentOnPr({ pr: m.pr, body: `**Merge gate** — this group was rejected: ${why}` });
    await deps.notify(`merge group on ${a.base}: ${why}`);
    return { conclusion: "failure", why, tests: ids.length, members: members.length };
  }

  const run = await deps.verifyRef({ ref: a.ref, testIds: ids });
  if (!run.built || run.failed.length) {
    const why = run.built
      ? `${run.failed.length} of ${ids.length} locked tests fail on the combination: ${run.failed.slice(0, 5).join(", ")}`
      : `the combination does not build: ${run.details}`;
    await deps.writeCheck({ name: OWN_CHECK_NAME, headSha: a.sha, conclusion: "failure", title: "The combination fails", summary: why });
    // a queue ref has no pull request of its own, so each member is told why the group was rejected
    for (const m of members) await deps.commentOnPr({ pr: m.pr, body: `**Merge gate** — the merge queue rejected this group.\n\n${why}\n\nYour pull request was ejected; main is untouched. The next run on your branch will re-gate it.` });
    await deps.notify(`merge group on ${a.base} rejected: ${why}`);
    return { conclusion: "failure", why, tests: ids.length, members: members.length };
  }

  const outcomes = await deps.runGates({ ref: a.ref });
  const failed = outcomes.filter((o) => !o.passed);
  const why = failed.length
    ? failed.map((f) => `${f.id}: ${f.details}`).join("; ")
    : `${members.length} pull requests, ${ids.length} locked tests, all green on the exact tree about to become ${a.base}`;

  // the SAME check name path A uses: branch protection waits on one name, and a different name on
  // the queue ref stalls the queue forever
  await deps.writeCheck({
    name: OWN_CHECK_NAME, headSha: a.sha,
    conclusion: failed.length ? "failure" : "success",
    title: failed.length ? `${failed.length} blocking` : "The combination is clear", summary: why,
  });
  if (failed.length) {
    for (const m of members) await deps.commentOnPr({ pr: m.pr, body: `**Merge gate** — the merge queue rejected this group.\n\n${why}` });
    await deps.notify(`merge group on ${a.base} rejected: ${why}`);
  }
  return { conclusion: failed.length ? "failure" : "success", why, tests: ids.length, members: members.length };
}
