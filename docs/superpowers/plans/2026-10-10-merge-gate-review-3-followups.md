# Merge gate: third-review follow-ups (C and 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop paying review-2 again when only another pull request's evidence manifest moved `main` (item C), and take the event triggers that fire before deliver finishes out of the setup doc (item 6).

**Architecture:** The diff the merge gate hashes, secret-scans and shows review-2 is built by a new `gateDiff(wt, baseSha)` in `src/merge/adapters.ts`, which excludes `.factory/` with a git pathspec. `live.ts` calls it in place of its inline `git diff`. Item 6 is a doc-only change. The code fix (do not conclude from a recorded `evidence-mismatch`; `review-pr` leaves drafts alone) stays open.

**Tech Stack:** TypeScript, vitest, git CLI through `src/ledger/git.ts`.

**Spec:** PR #27, third review comment (hamzaowaisog, 2026-10-09), items C and 6; `docs/merge-gate-review-fixes.md` section 7.

## Global Constraints

- Git runs only through `git`/`gitOut` from `src/ledger/git.ts` (hardened environment).
- No `Co-Authored-By` line in commit messages.
- Commit-message style: one plain sentence describing the behaviour.

## Review Focus

- A pull request whose only change is under `.factory/` must produce an empty diff, not an error. `diffFiles("")` and `secretHits("")` must handle that.
- A real code change must still show up in full, including new files and deletions.
- A base move that changes code as well as the manifest must still change the diff, so review-2 runs again.
- Paths that only start with `.factory` (for example `.factoryrc`) must not be excluded.
- The pathspec must work on Windows git and Linux git alike. Use the `:(exclude)` magic, not shell globs.

---

### Task 1: `gateDiff` excludes `.factory/` (item C)

**Files:**
- Modify: `src/merge/adapters.ts` (new export next to `EVIDENCE_MANIFEST`)
- Modify: `src/merge/live.ts:83` (use it)
- Test: `src/merge/adapters.test.ts` (new `describe` before "the evidence manifest every factory branch writes")

**Interfaces:**
- Produces: `export async function gateDiff(wt: string, baseSha: string): Promise<string>`, the diff from `baseSha` to `HEAD` with `-U5`, without `.factory/`.

- [ ] **Step 1: Write the failing test.** This test was already inserted. Its string literals were broken by a shell escape and must be repaired: each `writeFileSync` content must be a single-line literal ending in `\n`. The test builds `main` with `a.cs` and the manifest, then a `pr` branch that changes both. `main` then moves by the manifest only. The test asserts that `gateDiff(repo, base1)` mentions `a.cs`, does not mention `.factory`, and equals `gateDiff(repo, base2)`. Add a second case: a file `.factoryrc` changed on the PR **is** in the diff.
- [ ] **Step 2: Run it and check it fails.** Run `npx vitest run src/merge/adapters.test.ts -t "review-2 reads"`. Expected: FAIL, `gateDiff` is not exported.
- [ ] **Step 3: Implement.**

```ts
/**
 * The diff the merge gate hashes, scans and shows review-2: what the pull request adds on top of the
 * base it now contains, without `.factory/`. Deliver writes its manifest there on every branch, so each
 * merge to main changed every other pull request's diff and paid review-2 again for the same code.
 */
export async function gateDiff(wt: string, baseSha: string): Promise<string> {
  return (await git(wt, ["diff", "--no-color", "-U5", baseSha, "HEAD", "--", ".", ":(exclude).factory/"])).stdout;
}
```

  In `live.ts`, replace `const diff = (await git(wt, ["diff", "--no-color", "-U5", a.baseSha, "HEAD"])).stdout;` with `const diff = await gateDiff(wt, a.baseSha);` and add `gateDiff` to the `./adapters.js` import.
- [ ] **Step 4: Run and check it passes.** Run `npx vitest run src/merge src/forge src/ledger/git.test.ts` and `npx tsc --noEmit -p .`. Expected: everything passes except the 4 known native-Windows failures in `src/forge/repos.test.ts`.
- [ ] **Step 5: Commit.** Message: "Leave .factory/ out of the diff the merge gate hashes and review-2 reads, so another pull request's manifest does not pay for a second review".

### Task 2: Take the premature event triggers out of the setup doc (item 6)

**Files:**
- Modify: `docs/merge-gate-setup.md`: the Harness `pull_request` trigger (lines ~94-98) and the "On a self-hosted GitHub Actions runner" block (lines ~148-160)
- Modify: `docs/merge-gate-review-fixes.md`, section 7: mark C done and 6 as "doc only, code fix open"

- [ ] **Step 1:** In the Harness block, remove the `pull_request` / `review-pr` trigger and keep `merge_group`. Add one line: a `review-pr` trigger on `opened` or `ready_for_review` fires before deliver has finished its step. The evidence then reads as not reconciled, and that failure sticks until the base moves. Use `review-open-prs` for pull requests until that is fixed.
- [ ] **Step 2:** Replace the Actions block's `pull_request` trigger with the same note, and keep the public-repository warning.
- [ ] **Step 3:** Update section 7 of the fixes doc.
- [ ] **Step 4: Commit and push.** Message: "Take the pull-request event triggers out of the setup doc until a review before deliver finishes is no longer sticky", then `git push fork pr-review`.
