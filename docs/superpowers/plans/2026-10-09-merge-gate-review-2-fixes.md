# Merge gate: second-review fixes (PR #27, items 1–5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five issues the second review of PR #27 (at `8b3a2be`) says would stop the first real run, plus the test half of item 8, which item 5 depends on.

**Architecture:** The decisions stay in `src/merge/orchestrate.ts` (tested with fakes). The real-world wiring stays in `src/merge/live.ts` and `src/merge/adapters.ts` (tested against real git where it can be). The forge call moves from check runs to commit statuses in `src/forge/github.ts`. No new files apart from this plan.

**Tech Stack:** TypeScript (ESM), vitest, hardened git wrapper (`src/ledger/git.ts`), GitHub REST.

**Spec:** the second review comment on https://github.com/im-ahsan/ai-factory/pull/27 (hamzaowaisog, 2026-10-08T23:20Z), items 1–5 and item 8 (tests only). The decisions the user made on 2026-10-09:
- item 1: commit status, not a GitHub App;
- item 4: push the model-free merge once it is gated;
- item 5: include the test baseline.

## Global Constraints

- Commit messages: plain sentences in the repo's style. No `Co-Authored-By` line (user's global CLAUDE.md).
- Never delete files permanently. Use the recycle bin.
- Status context name: `OWN_CHECK_NAME` (`factory/merge-gate`) from `src/contracts/checks.ts`.
- The status `description` is capped at 140 characters by GitHub.
- Test command: `npx vitest run src/merge src/forge src/ledger/git.test.ts`. The baseline is 213 passing. The 4 failures in `src/forge/repos.test.ts` were already there on native Windows and are out of scope.

## Review Focus

1. **The base deleted the manifest, or the PR did.** This is a modify/delete conflict on `.factory/evidence-manifest.json`. It must still settle with no model, keeping the PR's side. The test is in Task 5.
2. **A throw on a PR that has never had a verdict.** The error record must not invent a judged head or base: the next pass must still see the base as moved. The test is in Task 4.
3. **A title longer than 140 characters.** It must be cut, not rejected by GitHub with a 422. The test is in Task 2.
4. **A run with no `discover` baseline** (an older ledger). Every failure counts and nothing crashes. The test is in Task 3.
5. **A Jira key with many digits, or a slug containing eight digits.** The right run id must still resolve. The test is in Task 1.

---

### Task 1: Resolve a real factory branch to its run id (item 2)

**Files:**
- Modify: `src/merge/sync.ts:9` (`BRANCH`)
- Test: `src/merge/sync.test.ts` (`describe("resolveRunId")`)

**Interfaces:** Produces: `resolveRunId` unchanged in signature. It now matches `YYYYMMDD-<slug>-<hex4>` (`newRunId`, `src/stages/executor.ts:64`) at the end of `factory/<runId>` or `factory/<JIRA>-<runId>` (`src/stages/workspace.ts:49`).

- [ ] **Step 1: Write the failing tests.** Replace the four `resolveRunId` tests with fixtures in the real shape:

```ts
const RUN = "20261006-return-404-not-found-3f9a";
// marker, branch fallback, Jira prefix: as before but with RUN
it("reads every branch the factory names, whatever the request was", () => {
  for (const request of ["Return 404 when not found", "x", "!!!", "fix 12345678 in the 2026 report"]) {
    const runId = newRunId(request);
    expect(resolveRunId({ headRef: `factory/${runId}` })).toEqual({ runId, via: "branch" });
    expect(resolveRunId({ headRef: `factory/SHOP-12345-${runId}` })).toEqual({ runId, via: "branch" });
  }
});
it("is an anomaly when neither resolves — never neutral, never ignored", () => {
  for (const headRef of ["feature/hand-written", "factory/run-20261005-abc", "main"])
    expect(resolveRunId({ headRef })).toEqual({ anomaly: expect.stringMatching(/cannot be attributed/) });
});
```

- [ ] **Step 2: Run, expect 4 failures.** `npx vitest run src/merge/sync.test.ts`
- [ ] **Step 3: Implement.**

```ts
// newRunId's shape, `YYYYMMDD-<slug>-<hex4>`, at the end of `factory/<runId>` or `factory/<JIRA>-<runId>`.
// The date is matched leftmost, so a slug that happens to hold eight digits cannot shift the start.
const BRANCH = /(?:^|[/-])(20\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4})$/;
```

- [ ] **Step 4: Run. Everything in `src/merge` passes.**
- [ ] **Step 5: Commit.** "Resolve a pull request from the branch names the factory actually makes"

### Task 2: Write the verdict as a commit status (item 1)

**Files:**
- Modify: `src/forge/github.ts`. Replace `upsertCheckRun` (lines 88–108) with `setCommitStatus`; nothing else imports `upsertCheckRun`.
- Modify: `src/merge/adapters.ts:201-203` (`forgeAdapter.writeCheck`), plus the import line.
- Modify: `docs/merge-gate-setup.md:82` (token row), and any "check run" wording on the same page.
- Test: `src/forge/github.test.ts`. Replace `describe("upsertCheckRun")`.

**Interfaces:** Produces `setCommitStatus(gh: Gh, a: { context: string; sha: string; conclusion: "success" | "failure" | "neutral"; description: string }, f?: typeof fetch): Promise<void>`. `ReviewPrDeps.writeCheck` keeps its signature: `title` becomes the description, and `summary` is already carried by the PR comment.

- [ ] **Step 1: Failing tests.**

```ts
describe("setCommitStatus", () => {
  it("posts one status to the commit under the gate's context: a PAT can, a check run needs an App", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 201 }));
    await setCommitStatus(gh, { context: "factory/merge-gate", sha: SHA, conclusion: "failure", description: "2 blocking" }, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toMatch(new RegExp(`/statuses/${SHA}$`));
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ state: "failure", context: "factory/merge-gate", description: "2 blocking" });
  });
  it("writes neutral as success, which is how a required check treats a neutral check run", ...);
  it("cuts a description to GitHub's 140 characters instead of being refused", ...); // "x".repeat(300) → length 140, ends with "…"
  it("throws when GitHub refuses", ...); // 403 → rejects /commit status failed: 403/
});
```

- [ ] **Step 2: Run, expect failure** (`setCommitStatus` is not exported).
- [ ] **Step 3: Implement.**

```ts
/**
 * The verdict as a commit status. A personal access token can write one; a check run can only be
 * created by a GitHub App. Statuses are keyed by context, so posting again replaces the last one.
 */
export async function setCommitStatus(
  gh: Gh, a: { context: string; sha: string; conclusion: "success" | "failure" | "neutral"; description: string }, f: typeof fetch = fetch,
): Promise<void> {
  // a status has no neutral; a required check counts a neutral check run as passing, so this keeps that
  const state = a.conclusion === "failure" ? "failure" : "success";
  const description = a.description.length > 140 ? `${a.description.slice(0, 139)}…` : a.description;
  await ok(await f(`${gh.api}/statuses/${a.sha}`, { method: "POST", headers: gh.headers, body: JSON.stringify({ state, context: a.context, description }) }), "commit status");
}
```

In `adapters.ts`:

```ts
async writeCheck(a) {
  // the detail is in the pull request comment; a status carries the one-line verdict
  await setCommitStatus(o.gh, { context: OWN_CHECK_NAME, sha: a.headSha, conclusion: a.conclusion, description: a.title });
},
```

Doc row: ``Token permissions: **Commit statuses: write**, **Pull requests: write**, **Contents: write** (fine-grained), or `repo` (classic) | the token in `~/.factory/.env` | Writing the `factory/merge-gate` status, the comment, and repair commits. A check run would need a GitHub App, so the verdict is a commit status, which branch protection accepts as a required check``.

- [ ] **Step 4: Run.** Everything in `src/forge` and `src/merge` passes.
- [ ] **Step 5: Commit.** "Write the merge-gate verdict as a commit status, which the deliver token can write"

### Task 3: Judge the merge result against the locked tests and the run's baseline (items 5 and 8, tests only)

**Files:**
- Modify: `src/merge/adapters.ts`. Add the pure helpers `mergeExpectations` and `failingTests`.
- Modify: `src/merge/live.ts:83-124` (`mergeVerify`): read the lock and the baseline, pass `exp`, `knownFailures` and `evidence.baseline`, and compute `failedTests` with `failingTests`.
- Modify: `src/merge/orchestrate.ts`. After the "does not merge cleanly" check, fail any tree whose tests fail and that was not repaired.
- Test: `src/merge/adapters.test.ts`, `src/merge/orchestrate.test.ts`

**Interfaces:**

```ts
export function mergeExpectations(
  lock: { tests: { testId: string }[]; characterisation?: { testId: string }[] }, baseline: TestRun | undefined,
): Expectations // { expectPass: locked + characterisation ids, expectFail: [], compareToBaseline: baseline ids }
export function failingTests(results: TestResult[], baseline: TestRun | undefined): string[]
// failed results, minus the ids that already failed in the baseline, sorted
```

- [ ] **Step 1: Failing tests.**
  - adapters: `mergeExpectations` returns the locked and characterisation ids as `expectPass`, and the baseline ids as `compareToBaseline` (`[]` when there is no baseline).
  - adapters: `failingTests` drops a test that already failed in the baseline. With no baseline, it keeps every failure (Review Focus 4).
  - orchestrate: an `unexpected-commits` PR whose merge has `testsPass: false` concludes `failure`, with `review2 === 0`, `gates === 0`, `push === 0`.
  - orchestrate: a `self-push` after a base move with `testsPass: false` concludes `failure`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** In `orchestrate.ts`, after the `judged && !judged.mergesClean` block:

```ts
  // tests that fail on the merge result are never green, whatever the class: only conflict and
  // broken-merge are repaired, so every other class is reported here, before review-2 is paid for
  if (judged && !repairPending && !judged.testsPass) {
    return fail(cls, "Tests fail on the merge result", `Failing on the merge with ${pr.baseSha.slice(0, 8)}: ${(judged.failedTests ?? []).join(", ") || "the locked tests"}. ${cls} is not repaired automatically.`);
  }
```

In `live.ts` `mergeVerify`:

```ts
const state = replay(ledger.events());
const lock = ledger.getJson<{ tests: { testId: string }[]; characterisation?: { testId: string }[] }>(state.steps.get("author-tests")!.outputs[0]!);
const baselineSha = state.steps.get("discover")?.outputs[0];
const baseline = baselineSha ? ledger.getJson<TestRun>(baselineSha) : undefined;
// ...produce({ ..., exp: mergeExpectations(lock, baseline), knownFailures: new Set(failingTests(baseline?.results ?? [], undefined)) })
// failed: failingTests(out.testRun.results, baseline); evidence: { ..., baseline }
```

- [ ] **Step 4: Run** the whole set.
- [ ] **Step 5: Commit.** "Judge the merge result against the locked tests and the run's baseline, and never pass one whose tests fail"

### Task 4: Remember an attempt that threw, and record the verdict before writing it (item 3)

**Files:**
- Modify: `src/merge/orchestrate.ts`:
  - `ReverifyRecord`: `conclusion?`, `headSha?`, `error?`.
  - `fail()` and the final block record first, then write.
  - The work from the first `probe()` onward runs inside `try/catch`.
- Modify: `src/merge/adapters.ts:153` (`openRunFacts`): `priorReverifyConcluded: !!rv?.conclusion`.
- Test: `src/merge/orchestrate.test.ts`

**Interfaces:** `ReverifyRecord` becomes `{ runId; cls; at; attemptsThisPr; reviewed; baseSha: string; conclusion?: Conclusion; headSha?: string; error?: string }`. An error record carries the PRIOR judged head, base and conclusion forward, so it never makes a moved base read as judged.

- [ ] **Step 1: Failing tests.**
  - The base moved and `writeCheck` throws. `reviewPr` rejects, and `records[0].conclusion === "success"` is written BEFORE the check, so the next pass concludes from it with no container.
  - The base moved, there is a conflict, and `repair` throws. It rejects, and the record has `attemptsThisPr: 1`, `error` matching the message, `conclusion: undefined`, `baseSha: "base1"` (the run's recorded base, not the new one) and `at` set.
  - On a PR with no prior verdict, `review2` throws. The record has `headSha: undefined` and `baseSha` equal to the run's recorded base (Review Focus 2).
  - The record's own write throws inside the catch. The ORIGINAL error is still the one rethrown.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**

```ts
  let recorded = false;
  const record = async (...) => { if (!run) return; await deps.recordReverify({...}); recorded = true; };
  const fail = async (...) => { await record("failure", cls); await deps.writeCheck(...); await deps.notify(note); return done(...); };
  // ...the cooldown check, then:
  try {
    return await judge();          // the existing body from `const m = moved || force ? ...` to the end
  } catch (e) {
    // money may already be spent: the next pass must see the attempt, or it pays again every 120s
    if (run && !recorded) {
      await deps.recordReverify({
        runId, cls: "error", error: (e as Error).message.slice(0, 300),
        headSha: run.judgedHeadSha, baseSha: run.recordedBaseSha, conclusion: run.priorConclusion,
        attemptsThisPr: run.attemptsThisPr + (attempted ? 1 : 0), at: deps.now(),
        reviewed: { ...Object.fromEntries(run.reviewed ?? []), ...reviewed },
      }).catch(() => undefined);
    }
    throw e;
  }
```

At the end of `judge()`: `await record(conclusion, cls, checkSha)` moves above `writeCheck`.

- [ ] **Step 4: Run** the whole set. The existing "records every verdict" tests still pass.
- [ ] **Step 5: Commit.** "Record an attempt that threw, and a verdict before it is written, so a failure is not paid for again every pass"

### Task 5: Settle the evidence-manifest conflict without a model, and push it once gated (item 4)

**Files:**
- Modify: `src/merge/adapters.ts` (`mergeInto`): add `EVIDENCE_MANIFEST` and the optional `trailer` parameter, and return `settled?: string[]`.
- Modify: `src/merge/live.ts:45-55` (`mergedWorktree` passes `repairTrailer(runId)`); `mergeVerify` returns `settled`.
- Modify: `src/merge/orchestrate.ts`:
  - `MergeResult.settled?: string[]`.
  - A settled-only merge sets `repairPending` unless the class is `unexpected-commits`.
- Test: `src/merge/adapters.test.ts` (real git), `src/merge/orchestrate.test.ts`

**Interfaces:** `mergeInto(wt: string, baseSha: string, trailer?: string): Promise<{ clean: boolean; conflicts: string[]; settled?: string[] }>`. `settled` is present only when non-empty, so the existing `toEqual` assertions still hold.

- [ ] **Step 1: Failing tests.**
  - adapters, real git: both sides add `.factory/evidence-manifest.json` with different content. The result is `{ clean: true, conflicts: [], settled: [".factory/evidence-manifest.json"] }`, HEAD's file holds the PR's content, HEAD has two parents, and the commit body contains `Factory-Repair: rv`.
  - adapters: the manifest plus `a.txt` both conflict. The result is `{ clean: false, conflicts: ["a.txt"], settled: [manifest] }`, the manifest is no longer unmerged, and `commitRepair(repo, msg, ["a.txt"])` succeeds once `a.txt` is fixed.
  - adapters: the base deleted the manifest and the PR changed it. It settles to the PR's file (Review Focus 1).
  - orchestrate: the base moved, the merge is clean with `settled: [manifest]`, and the gates pass. `repair === 0`, `push === 1`, and the check is written on `pushed1`.
  - orchestrate: the same with `unexpected-commits`. `push === 0`, and the summary says GitHub still reports the conflict.
  - orchestrate: the same, but a gate fails. `push === 0`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**

```ts
/** Deliver writes this at one fixed path on every branch, so any two open factory PRs conflict on it. */
export const EVIDENCE_MANIFEST = ".factory/evidence-manifest.json";

// in mergeInto's catch, after `conflicts` is read:
    // the manifest binds THIS pull request's evidence to its branch: its side is the right one, and
    // the repair may not write .factory/**, so a model asked to resolve it could only fail
    const settled = conflicts.filter((p) => p === EVIDENCE_MANIFEST);
    for (const p of settled) {
      await git(wt, ["checkout", "--ours", "--", p]).then(
        () => git(wt, ["add", "--", p]),
        () => git(wt, ["rm", "-q", "-f", "--ignore-unmatch", "--", p]),   // the pull request deleted it
      );
    }
    const left = conflicts.filter((p) => !settled.includes(p));
    if (left.length) return { clean: false, conflicts: left, ...(settled.length ? { settled } : {}) };
    await git(wt, ["commit", "--no-edit", "-m", `${VERIFY_MERGE} ${baseSha.slice(0, 8)}${trailer ? `\n\n${trailer}` : ""}`]);
    return { clean: true, conflicts: [], settled };
```

In `orchestrate.ts`, after the repair block:

```ts
  // a conflict settled without a model (deliver's manifest) left a merge only this host has: once
  // gated it is pushed like a repair, so GitHub stops reporting the conflict. Never over commits
  // the factory did not write.
  const settled = merge?.settled ?? [];
  if (!repairPending && settled.length && cls !== "unexpected-commits") repairPending = true;
```

- [ ] **Step 4: Run** the whole set.
- [ ] **Step 5: Commit.** "Settle the evidence-manifest conflict without a model, and push the merge once it is gated"

### Task 6: Record the second review in the fixes doc

**Files:** Modify `docs/merge-gate-review-fixes.md`. Add a section "Second review (at `8b3a2be`)":
- items 1–5 and the test half of 8 are done, with their commits;
- items 6, 7, the lint half of 8, 9 and 10 are still open;
- the end-to-end run (`review-open-prs --once`, two factory PRs open and one merged) has not happened, and `factory/merge-gate` stays out of the required checks until it has.

- [ ] Commit: "Record the second review's fixes and what is still open"
