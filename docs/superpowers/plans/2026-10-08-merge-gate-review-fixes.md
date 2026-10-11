# Merge Gate Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix items 2 to 14 of the PR #27 review, so the merge gate judges the real merge result, never pushes an unverified repair, and stops looping.

**Architecture:** The decisions stay in `src/merge/orchestrate.ts`, which is tested against fakes. Real effects stay in `live.ts`, `adapters.ts`, `forge/github.ts` and `ledger/git.ts`. Reverify gets its own memory: a `reverify` step in the run ledger that records what it last judged. Every later pass reads that step first.

**Tech Stack:** TypeScript (ESM), vitest, hardened host git, GitHub REST.

**Spec:** `docs/merge-gate-review-fixes.md`

## Global Constraints

- Only touch the path after a PR exists: `src/merge/*`, `src/forge/github.ts`, `src/cli/merge-gate.ts`, and `fetchForGate`/`freshWorktree` plus one new helper (`authEnv`) in `src/ledger/git.ts`.
- `src/gates/engine.ts` and the ledger format stay unchanged. Reverify uses `gateInputsHash` and `ledger.append`.
- A token never goes on a git command line. It goes in through `GIT_CONFIG_*` env, and is redacted from errors.
- The factory pushes a tree only after the full gates pass on it.
- Repair edits: never to locked tests, `noGo`, `.github/**` or `.factory/**`.
- Commit messages get no Co-Authored-By lines (user rule).

## Design decisions (beyond the spec)

1. **Remember the last judgement.** Each pass that concludes, for a run whose ledger is here, appends `step.completed` with key `reverify` and data `{ conclusion, cls, headSha, baseSha, attemptsThisPr, at, reviewed }`. `openRunFacts` reads `judgedHeadSha`, `recordedBaseSha` (falling back to `info.baseCommit`), `lastReverifyAt = data.at`, `attemptsThisPr` and `reviewed` from it.
2. **Unchanged since judged = conclude from the record.** If head and base equal the last judged pair and a prior conclusion exists (and no `--force`), re-write the prior conclusion to the check. No container, no model, no notification.
3. **Cooldown defers instead of failing.** If something moved within 5 minutes of the last judgement, return `cls: "deferred"` and write nothing (no check, no record). A burst of pushes then collapses into one later run. This happens before any container starts.
4. **Repair = one merge commit with the trailer.** For a conflict, the merge is left in progress and the repair concludes it. For a broken merge, the verification merge commit is amended. Either way, the result has two parents and carries `Factory-Repair:`. `commitsWithTrailers` walks `--first-parent`, so the base's own commits don't count as "unexpected".
5. **Repair → verify → gates → push.** `repair` only commits locally. `pushRepair` runs only when all gates pass on the repaired tree. The check is written to the pushed SHA.
6. **Model gates** are hashed from the diff they read: `gateInputsHash(id, { diff: diffSha }, policy)`. They are recorded in the reverify step's `reviewed`, so the same diff never pays for review-2 twice.
7. **Poller gates only local, own-repo PRs** (`onlyLocal`): an unattributable PR, one with no ledger here, or a fork returns `cls: "not-here"` and writes nothing. `review-pr` (an explicit trigger) still fails those loudly.

## Review Focus

- A base that is already merged into the head ("Already up to date"): there is nothing to commit, so verify `HEAD` as it is.
- A repair that leaves conflict markers or an unmerged index: refuse it as `made: false`, and never commit.
- A push that fails after the gates passed: failure check on the old head, no `repaired` claim.
- A token in a fetch error: it must be redacted.
- `/user` failing (App token): `findReviewBody` fails closed, and resolution falls back to the branch name.

---

### Task 1: Git helpers

**Files:** Modify `src/ledger/git.ts` (`fetchForGate`, new `authEnv`). Modify `src/merge/adapters.ts` (`commitsWithTrailers` `--first-parent`). Test: `src/ledger/git.test.ts`.

**Produces:** `authEnv(token: string): Record<string,string>`. `fetchForGate(repo, baseRef, headRef?: string, remote?: { url: string; token?: string })`.

- [ ] Test: `authEnv("t")` puts the token only in `GIT_CONFIG_VALUE_0` (base64), and `fetchForGate` from a local bare repo URL updates `refs/remotes/origin/<base>`. A fetch with `headRef` undefined fetches only the base.
- [ ] Implement, run `npx vitest run src/ledger/git.test.ts`, commit.

### Task 2: Forge client (items 10, 11, 14)

**Files:** `src/forge/github.ts`, `src/forge/github.test.ts`.

**Produces:**
- `getPr` also returns `headRepo: string` (`head.repo.full_name`, `""` when the repo was deleted).
- `factoryLogin(gh, f): Promise<string>` (`GET {root}/user`).
- `findReviewBody(gh, n, f, author?)`: when `author` is given, only reviews whose `user.login === author` count.
- `listOpenPrs` follows `Link: rel="next"`.

- [ ] Tests: an author mismatch returns undefined. Pagination: two pages are concatenated. `getPr` maps `headRepo`.
- [ ] Implement, run the tests, commit.

### Task 3: Gate hashing (item 6, hashing half)

**Files:** `src/merge/gates-run.ts`, `src/merge/gates-run.test.ts`.

**Produces:** `plannedInputHashes(ledger, policy, e: MergeEvidence): Map<string,string>`, equal to the `inputsHash` that `runMergeGates` records for the same evidence.

- [ ] Test: run `runMergeGates` on evidence, read the recorded `gate.result` `inputsHash` per gate, and assert it equals `plannedInputHashes(...)`.
- [ ] Implement by sharing the `putJson` input map with `runMergeGates`. Run, commit.

### Task 4: Orchestration (items 5, 6, 7, 9, 10)

**Files:** `src/merge/orchestrate.ts`, `src/merge/orchestrate.test.ts`.

**Interfaces:**
- `PrFacts` adds `fromFork?: boolean`.
- `RunFacts` adds `judgedHeadSha?: string` and `reviewed?: Map<string,string>`.
- `ReviewPrDeps.repair(cls, { runId, subject }) → { made: boolean; why: string }` (local commit only).
- New `ReviewPrDeps.pushRepair({ runId, headRef }) → { pushed: boolean; why: string; sha?: string }`.
- New `ReviewPrDeps.recordReverify(r: ReverifyRecord) → Promise<void>`, where `ReverifyRecord = { runId; conclusion; cls; headSha; baseSha; attemptsThisPr; at; reviewed: Record<string,string> }`.
- `reviewPr(deps, { pr, force?, onlyLocal? })`. `ReviewPrResult.cls` adds `"deferred" | "not-here"`.

- [ ] Tests (fakes):
  - unchanged-since-judged → no `mergeVerify`, no notify, prior conclusion written.
  - Cooldown → `deferred`, zero checks, zero `mergeVerify`.
  - Repair whose verification fails → `pushRepair` never called, failure check.
  - Repair verified, gates pass → `pushRepair` called once, and the check goes to the pushed SHA.
  - Repair verified, a gate fails → no push.
  - Push fails → failure, `repaired: false`.
  - Every concluding path records reverify with `attemptsThisPr` +1 when a repair was tried.
  - Fork → failure ("fork"). With `onlyLocal`, a fork, an anomaly or a missing ledger → `not-here` and nothing written.
  - The same diff that was already reviewed → no review2.
- [ ] Update the existing tests to the new repair/push split (the cooldown test now expects `deferred`).
- [ ] Implement, run `npx vitest run src/merge/orchestrate.test.ts`, commit.

### Task 5: Repair proposal filters (items 12, 13)

**Files:** `src/merge/repair-run.ts`, `src/merge/repair-run.test.ts`.

- [ ] Tests:
  - An edit's returned `path` is the normalised one (`src\\A.cs` → `src/A.cs`).
  - Edits to `.github/workflows/x.yml`, `.factory/evidence-manifest.json` or a `noGo` match are rejected with a reason.
- [ ] Implement in the `proposeRepair` filter, run, commit.

### Task 6: Live wiring (items 2, 3, 4, 5, 7, 8, 11, 13)

**Files:** `src/merge/live.ts`, `src/merge/adapters.ts`, `src/cli/merge-gate.ts`.

- `mergeInto`: on a conflict, no `--abort`. Leave markers and the unmerged index.
- `mergedWorktree`: after a clean merge, if `MERGE_HEAD` exists, `git commit --no-edit -m "factory: verify merge of <base8>"`. Then `mergeSha = HEAD`, and the diff is `git diff <baseSha> HEAD`.
- `current = plannedInputHashes(...)` plus the model gates hashed from `diffSha`. `secretScan.hits = scanText` over the added lines of that diff.
- `repair`:
  - Snapshot the working tree through a temporary index (`GIT_INDEX_FILE`, `add -A`, `write-tree`, `commit-tree -p HEAD`).
  - Write the normalised paths with `mkdirSync(dirname)`.
  - Refuse when markers remain.
  - Conflict: `add -A` + `commit` (concludes the merge). Broken merge: `add -A` + `commit --amend`. Both use the repair message and trailer.
- `pushRepair`: push `HEAD` with `authEnv`, return the pushed SHA.
- `recordReverify`: `ledger.append({ type: "step.completed", key: "reverify", data })`.
- `adapters.getPr`: `fromFork = headRepo !== forge.repo`. Fetch with the forge URL and token, and skip the head fetch for a fork. `findReviewBody` uses the cached `factoryLogin`, failing closed.
- `openRunFacts`: reads the reverify data as in design decision 1.
- CLI `review-open-prs` passes `onlyLocal: true`.

- [ ] Run `npx tsc --noEmit` and `npx vitest run src/merge src/forge src/ledger/git.test.ts`, then commit.

### Task 7: Docs

- [ ] Update `docs/merge-gate-review-fixes.md` status lines. Add the limits to `docs/merge-gate-setup.md`: one host owns a repo, and the end-to-end run is still owed. Commit.
