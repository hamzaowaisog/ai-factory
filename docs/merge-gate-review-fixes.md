# Merge gate: fixes from the PR #27 review (proposed)

*Written on 2026-10-08, branch `pr-review`, from the review by hamzaowaisog on `afd12c3` of [im-ahsan/ai-factory#27](https://github.com/im-ahsan/ai-factory/pull/27). Line numbers were checked again after `main` was merged in (`3f3a6e3`). Items 1 to 14 are built and unit-tested (`cbd28ee`..`1dfc35b`). The end-to-end run on a real repository, step 8 in section 5, has not happened yet.*

PR #27 makes the merge repair work and adds `review-open-prs`, the poller that runs the merge gate every 120 seconds. The review agrees that each fix in the diff is correct. The problem is that turning on the trigger and the push makes older code run unattended for the first time. That code builds the wrong tree, repairs without seeing the conflict, and has no state to stop it looping. The tests do not catch this, because fakes replace the wiring where all of these problems live.

## 1. Scope

Every change here is on the path that runs **after the factory has opened a pull request**: the merge gate, reverify, the conflict and broken-merge repair, and the poller. The run pipeline that plans, implements, gates and delivers, up to opening the PR, does not change.

| Changed | Why it is in scope |
|---|---|
| `src/merge/*` (`live.ts`, `adapters.ts`, `orchestrate.ts`, `repair-run.ts`, `poll.ts`, `reverify.ts`) | The merge gate itself |
| `src/forge/github.ts` | Only `src/merge` and `src/cli/merge-gate.ts` import it |
| `src/cli/merge-gate.ts` | Entry point for the merge gate |
| `src/ledger/git.ts`: `fetchForGate`, `freshWorktree` only | Only the merge code calls these. The git helpers the run pipeline uses stay as they are |
| Merge-gate setup doc | To state the limits we accept |

| Used without changing | How |
|---|---|
| `src/gates/engine.ts` | Reverify reuses `gateInputsHash` so its hashes match the recorded ones |
| Run ledger | Reverify appends its own `reverify` step through the existing API. The ledger format stays the same |

## 2. Must fix before merge

### 1. Branch conflicts with `main` ✅ done
`src/ledger/git.test.ts`, import line: both `freshWorktree` (this branch) and `trackIgnored` (#26) are kept. Merged in `3f3a6e3` and pushed.

### 2. The gate builds and tests the PR head, not the merge result
- **Where:** `adapters.ts:120` runs `git merge --no-commit --no-ff`, so `HEAD` stays at the PR head. `live.ts:78` takes `mergeSha = rev-parse HEAD` and hands it to the lab, and the lab runs `git archive <commit>` (`verify/dotnet.ts`, `verify/node.ts`).
- **Effect:** the archive contains none of the base's changes. `base-moved-clean` can pass without the base ever being compiled or tested, and `broken-merge` only fires if the head was already failing.
- **Fix:** commit the merge in the reverify worktree (a local merge commit that is never pushed by this step) and pass that commit to the lab.
- **Test:** in a real temporary repo, add a base commit that breaks the build, merge it, and check that `mergeVerify` reports the build as failed.

### 3. The conflict repair is not shown the conflict
- **Where:** on a conflict `adapters.ts:125` runs `merge --abort`. The repair then snapshots `HEAD` (`live.ts:192`). `afterRepair` returns `clean: true` without merging the base (`live.ts:50`).
- **Effect:** the model gets the right list of paths, but the files have no markers and the base side is missing, while `CONFLICT_TEMPLATE` tells it the markers are there. Its answer is committed as a plain commit on the PR head, not as a merge. The tree it "verifies" has no base in it, and the PR still conflicts on GitHub.
- **Fix:** leave the conflicted merge in the worktree. Snapshot the **working tree**, not a commit, and conclude the merge with the repair's edits so the result is a merge commit with both parents.
- **Test:** make two branches that conflict, run the repair with a fake model that returns a resolution, and check that the snapshot contains markers and that the result commit has two parents.

### 4. The broken-merge repair can silently revert the base's changes
- **Where:** the merge is left uncommitted, but the snapshot is again `HEAD` (`live.ts:192`). The whole-file edits are written over the merged files (`live.ts:209`), then `git add -A && git commit` concludes the merge.
- **Effect:** any base change to a file the model edits is dropped, and that is what gets pushed.
- **Fix:** same as 3. The model reads the merged working tree.
- **Test:** the base changes file F and the merge breaks the build. The repair edits F. Check that the base change is still in F after the repair.

### 5. The repair is pushed before it is verified
- **Where:** `repair()` pushes at `live.ts:224`. Only after that does `reviewPr` call `probe(true)`.
- **Effect:** this breaks deliver's rule that only a gated tree is pushed, and the header of `repair-run.ts` says the same thing. An unbuilt model resolution lands on the PR branch, and a failed verification leaves it there.
- **Fix:** apply the repair, run the full re-verification on the local merge commit, and push only if it passes. If it fails, push nothing and report.
- **Test:** a fake lab that fails after the repair. Assert that no push happened.

### 6. Nothing stops the loop, and the poller runs it every 120 seconds
- **Where:**
  - Nothing writes a `reverify` step to the ledger. `adapters.ts:61-68` reads `attemptsThisPr`, `lastReverifyAt`, `priorReverifyConcluded` and `priorConclusion` from that step, so they are always `0`, `undefined`, `false` and `undefined`. The six-attempt budget, the five-minute cooldown and the `self-push` guard never engage.
  - `recordedBaseSha` (`adapters.ts:61`) is the run's original base and is never updated. Once `main` moves, the PR reads as "moved" on every pass.
  - `live.ts:97-102` hashes `current` as `hashJson({ build })` and so on, but the recorded hashes come from `gateInputsHash(gateId, inputs, policy)` (`gates/engine.ts:35`). They can never be equal, so every gate re-runs and review-2 is called on every pass.
- **Effect:** after any merge to `main`, every other open PR costs a container build, a test run and a review-2 call every two minutes. A conflicted PR adds a repair model call each pass, plus either a new commit pushed to the PR or a failure notification.
- **Fix:**
  - After each reverify, write a `reverify` step to the ledger: conclusion, attempt count, timestamp, and the base and head SHAs it judged.
  - Read `recordedBaseSha` from the last reverify, and fall back to the run's base only when there is none.
  - Build `current` with `gateInputsHash` from the same inputs and policy the engine uses.
- **Test:** run `reviewPr` twice with no change to base or head. The second pass must do nothing and spend nothing. Then run it past the attempt budget and inside the cooldown, and check that both stop it.

### 7. After a repair, the check is written to the old head
- **Where:** `writeCheck` uses `pr.headSha`, which was fetched before the push (`orchestrate.ts:107`, `:134` and the final write).
- **Effect:** the new head has no `factory/merge-gate` check. If the check is required, the PR stays blocked until the next pass.
- **Fix:** have the repair return the SHA it pushed, and write the check to that SHA.
- **Test:** a repair that pushes. Assert that the check is written to the new SHA.

### 8. The fetch has no credential
- **Where:** `fetchForGate` (`ledger/git.ts:117`) uses hardened git (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`), so no credential helper applies. It also fetches from `origin`, while the push uses `forge.pushUrl`.
- **Effect:** on a private HTTPS repository the base fetch fails. It is fatal, so every review throws.
- **Fix:** fetch from the same URL the push uses (`forge.pushUrl ?? https://github.com/<repo>.git`), with the token passed through `http.extraHeader` in git's environment, as deliver's push does. Never put the token on the command line.
- **Test:** check the git arguments and environment that `fetchForGate` builds. Make sure the token appears in the environment only, never in the arguments or the logs.

## 3. Should fix, or state as a limit in the setup doc

| # | Problem | Fix |
|---|---|---|
| 9 | **Ledgers are per host, but the poller gates every open PR.** A PR built on another machine gets `evidence-mismatch` ("no ledger on this host") as a failing required check plus a notification on every pass. A PR opened by a person gets "cannot attribute" on every pass. Two hosts polling the same repo overwrite each other's check. | Gate only PRs whose ledger is on this host, and skip the rest without writing a check. Send a notification only when the state changes. Document that one host owns a repo. |
| 10 | **Fork PRs.** `getPr` drops `head.repo`, and the repair pushes to `refs/heads/<headRef>` on the base repo. A fork PR whose branch is called `main` would aim that push at the base repo's `main`. Today it is stopped only by accident: the fork's SHA is not fetched, so `commitsSince` throws. | Keep `head.repo`. Refuse any PR whose head repo is not `forge.repo`, and refuse a `headRef` equal to the base branch. |
| 11 | **`findReviewBody` trusts any review** that contains `factory-review:<id>` (`forge/github.ts:107`), whoever wrote it. That now decides which ledger authorises a push. | Accept the marker only when the factory's own account wrote it. |
| 12 | **Writes use the raw path.** `safeEditPath` normalises the path for its check, but `live.ts:209` writes `e.path`. On Linux, `src\A.cs` becomes a file with a backslash in its name. A new file in a new folder throws after the model has already been paid. | Write the normalised path, and `mkdirSync(dirname, { recursive: true })` before writing. |
| 13 | **`noGo` only applies to reads.** A repair can write `.github/workflows/*` or `.factory/evidence-manifest.json` and push it with the forge token. `secretScan.hits` is hard-coded to `[]` on this path (`live.ts:113`). The setup doc recommends a self-hosted runner on this same host, which makes a pushed workflow file the main risk. | Reject repair edits that match `noGo`, workflows or the evidence manifest. Run the real secret scan on the merge commit. |
| 14 | **`listOpenPrs` reads one page of 100** (`forge/github.ts:48`). | Follow the `Link` header, or document the limit. |

## 4. How to land it

The review offers two options:

1. **Fix everything here.** Do items 2 to 8 in this PR, then do the full end-to-end run that has still not happened, before `factory/merge-gate` is made a required check anywhere.
2. **Split the PR.** Merge the parts that are safe on their own now:
   - the `edits` floor and template
   - `safeEditPath`
   - `freshWorktree`
   - `fetchForGate`, with the credential from item 8
   - the subject wiring

   Hold back the repair push and `review-open-prs` until reverify records its own state.

**Recommendation: option 2.** Items 2 to 7 are not in this PR's diff. They are in the code it builds on, and fixing them is a redesign of the reverify and repair path. Splitting gets the safe fixes into `main` now and keeps the paid loop switched off until that redesign is done and tested end to end.

## 5. Order of work

Cost and safety first:

1. **Item 6:** record reverify state and hash the way the engine does. This stops the loop.
2. **Item 5:** verify before push.
3. **Items 2, 3, 4:** build, snapshot and repair the merged tree.
4. **Item 7:** write the check to the new head.
5. **Item 8:** add the credential to the fetch.
6. **Items 10, 11, 13:** close off push targets and write paths.
7. **Items 9, 12, 14:** host ownership, path writes, pagination. Fix each one or document it as a limit.
8. **End-to-end run** on a real repository before the check is made required.
