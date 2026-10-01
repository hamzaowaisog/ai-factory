# The test lab: build once, test once (2026-09-30)

## Summary

**Why**

The first real runs (`docs/runs/2026-09-30-first-real-runs.md`) showed that the **test lab takes about 64% of a run**. For a one-line fix, the solution was rebuilt 7–8 times and the full test suite ran twice. Most of those builds and test runs repeated work already done on the same commit.

**What changed**

Four changes. None of them weakens a check: the same commit is still judged, locked tests must still pass, and any test that passed in the baseline still blocks if it fails.

1. **Integrate reuses the last task's test run.** When the last task already ran the full suite on the exact commit Integrate is checking, and that run required everything Integrate requires, Integrate reuses the stored result instead of building and testing again.
2. **Finding the new tests is also the first "fails on the old code" check.** One lab run now finds the test IDs by name and counts as run 1 of 2. "Must fail on the old code twice" is unchanged.
3. **Known failures are skipped on full-suite runs.** Tests that already failed on the base branch can never block anything, so the full-suite runs leave them out.
4. **Each commit is built once.** After a successful build, the lab keeps a copy of the build. A later lab run on the same commit starts from a fresh copy of it instead of copying, restoring and building again.

**What it means**

A one-task run goes from **6 builds and 2 full-suite runs to 2 builds and 1 full-suite run**, with the known failures left out of that one run. These numbers come from the code and the end-to-end test. They haven't been measured on a real repo yet (see *How to check* below).

## Before and after: one task, no retries

The example repo has 748 tests: 626 pass on the base branch and 122 already fail.

**Before**

| # | Step | Commit | Build | Tests run |
|---|---|---|---|---|
| 1 | Baseline | base | build (first run on this commit only; saved and reused after) | all 748 |
| 2 | Author-tests: find the tests | tests commit | **build** | the new tests (to get their IDs) |
| 3 | Author-tests: fails on old code #1 | tests commit | **build** | the new tests |
| 4 | Author-tests: fails on old code #2 | tests commit | **build** | the new tests |
| 5 | Implement TASK-1 | fix commit | **build** | **all 748** |
| 6 | Integrate | fix commit | **build** | **all 748 again** |
| 7 | Accept | fix commit | **build** | start the app + locked tests |

**After**

| # | Step | Commit | Build | Tests run |
|---|---|---|---|---|
| 1 | Baseline | base | reused (saved from an earlier run) | none |
| 2 | Author-tests: find + fails on old code #1 | tests commit | **build** (kept) | the new tests: IDs, then the check |
| 3 | Author-tests: fails on old code #2 | tests commit | reuses step 2's build | the new tests |
| 4 | Implement TASK-1 | fix commit | **build** (kept) | **626** (the 122 known failures left out) |
| 5 | Integrate | fix commit | none: reuses step 4's result | none (plus the lock-set and diff-size checks, which need no lab) |
| 6 | Accept | fix commit | reuses step 4's build | start the app + locked tests |

**Totals**

| | Before | After |
|---|---|---|
| Lab runs | 6 (7 with an uncached baseline) | 5, one of which is only quick checks |
| Full builds | 6 (7) | **2** (3) |
| Full-suite runs | 2 × 748 (3 with an uncached baseline) | **1 × 626** (+1 × 748 for an uncached baseline) |

**What still adds work**

- **Each Implement retry** is a new commit: +1 build and +1 full-suite run.
- **Each author-tests retry** is a new tests commit: +1 build, with a second run that reuses it.
- **Each extra task** in a multi-task plan: +1 build and +1 full-suite run. Integrate still reuses the last task's run.

## The changes in detail

### 1. Integrate reuses the last task's run

- **Before:** Integrate always rebuilt and re-ran the full suite on the final commit. On a one-task run, that is the same commit the task had just tested.
- **Now:** Integrate looks for a finished task whose commit is Integrate's commit. It reuses that task's test run only if all of these hold (`coversIntegrate`):
  - the run judged that exact commit;
  - the run was valid;
  - it required every locked test and every characterisation test to pass;
  - it compared against the whole baseline.

  Since the earlier implement-loop change (`implement-loop.md`), the last task already requires all earlier tasks' tests, so this is normally true for multi-task plans too.
- **Still checked at Integrate:** the test-expectation check (on the reused run), the lock-set check and the diff-size check, all recorded as Integrate's own gate results. `factory verify-evidence` re-checks them as before.
- **Recorded:** Integrate's step data has `reusedRunFrom: "implement/TASK-n"`, and the log says `integrate: … reusing its run`.
- **Falls back** to a full build and full suite when no task run covers it.
- **Code:** `coversIntegrate` and `reusableTaskRun` in `src/stages/build.ts`.

### 2. One lab run finds the tests and is the first run on the old code

- **Before:** three lab runs on the same tests commit. The first only found the test IDs by method name. As a side effect, it also re-ran up to 20 of the new tests as possibly flaky, even though they're expected to fail.
- **Now:** one run, filtered by the test method names, finds the IDs. The factory then decides that run's expectations from its own results (the IDs only exist once the tests have run), and the run counts as "fails on the old code #1". The second run is unchanged.
- **Unchanged:** "every acceptance test fails on the old code for the right reason, twice", the keep-passing rule for criteria that already work, and the compile and test-not-found failures.
- **Code:** `fromResults` in the author-tests step (`src/stages/build.ts`), and the new `resolveExp` input of `produceDotnetTests` (`src/verify/dotnet.ts`).

### 3. Known failures are skipped on full-suite runs

- **The list isn't hardcoded.** It comes from each project's own baseline: the tests that failed on the untouched base commit. 122 is just what this repo has. The list is recalculated when the base commit changes.
- **Which tests are skipped** (`skippableKnownFailures`):
  - A test method is skipped only if **every** baseline row of it failed. A parameterised (theory) test with some passing rows keeps running.
  - A test the run expects to pass or fail is never skipped.
- **Where:** only the full-suite runs, meaning Implement, and Integrate when it can't reuse. The baseline, author-tests and Accept runs are unchanged.
- **How:** a `dotnet test --filter` of the form `FullyQualifiedName!=A.B.C&…`, with filter special characters escaped (`skipFilterFor`). If the filter would be longer than 30,000 characters, the run keeps every test and logs why.
- **Why it's safe:** "no new failures vs baseline" only ever looked at tests that **passed** in the baseline. A known failure could never block a run, so skipping it removes no check.
- **Recorded:** the test run has `skippedKnownFailures: [...]`, and the log says `lab: skipping N test(s) that already fail on the base branch`.

### 4. Each commit is built once

- **Before:** every lab run copied the commit, restored packages and built the whole solution, even when an earlier lab run in the same factory run had just built that exact commit.
- **Now:**
  - After a successful build, the lab saves a copy of the built folder, **taken before any test runs** (`saveBuild`).
  - A later lab run on the same commit, SDK image and build target (`buildCachePath`) starts from **its own fresh copy** of that build and skips copy, restore and build.
- **Safety:**
  - Each lab run gets its own copy, so a test that writes into its folder can't affect the next run.
  - The copy is written aside and then renamed, so a half-written copy is never reused.
  - Builds are keyed by commit, SDK image and build target. A different commit never reuses another's build.
- **Disk:** a run keeps at most **2 builds**: the one just saved plus the most recently used other one (`KEEP_BUILDS`). They live in `~/.factory/tmp/<run>/builds/` and are deleted when the run is delivered, closed or stopped (`dropBuildCache` in `src/stages/executor.ts`). A parked run keeps them, because it may resume.
- **Copy speed:** on macOS (APFS) and on Linux file systems that support it, the copy is a near-instant clone (`cp -c` / `cp --reflink=auto`). Elsewhere, such as WSL, it's a normal copy.
- **Not cached:** the baseline build. Its commit is never built again in the same run.
- **Recorded:** the log says `lab: reused the build of <commit> from an earlier lab run (Ns)`. In `trace.jsonl` this is the phase `lab.build-reused`, so `lab.build` now counts real builds only.

## How to check

**1. The code (no cost)**

```bash
nvm use 22            # the tests need Node 22
npm run typecheck
npm test              # 227 tests
```

- If `npm test` fails at startup with *"Cannot find native binding"*: the lockfile didn't install the macOS part of `rolldown` (a vitest dependency). Run `npm install --no-save @rolldown/binding-darwin-arm64@1.2.11` once. It changes `node_modules` only.
- If the first end-to-end test times out at 5 s on a busy machine, run it again. It takes about 3 s on its own.

**2. A real run (on the machine with the client repo)**

```bash
npm run build
factory selftest                                   # full run on the sample repo, $0
factory start "<same symptom text as the earlier bug-1 run>" --project <project> --max-cost 3
factory logs <run> --follow
factory verify-evidence <run>                      # every decision still re-checks
```

**3. What to look for in that run**

```bash
L=~/.factory/ledger/<run>
grep -E "reused the build|skipping .* already fail|reusing its run" $L/run.log
jq -s 'map(select(.kind|startswith("lab.")) | {phase:.kind, s:(((.msg|capture("\\((?<s>[0-9]+)s\\)")|.s) // "0")|tonumber)})
       | group_by(.phase) | map({phase:.[0].phase, count:length, seconds:(map(.s)|add)})' $L/trace.jsonl
factory report <run>                               # compare with the earlier run's report
```

| Check | Expected |
|---|---|
| `lab.build` count | 2 (3 if the baseline wasn't saved yet), plus 1 per retry |
| `lab.build-reused` count | 2: fails-on-old-code #2 and Accept |
| Implement's `lab: tests ran: N` | about 626, not 748 |
| Integrate in `factory report` | about 0 lab seconds |
| `factory verify-evidence` | every check re-verifies |

## Limits and risks

- **Copying a build isn't free.** For a very large solution on a file system without cloning (WSL), the copy can take a noticeable share of a build's time. Compare the `lab.build-reused` seconds with the `lab.build` seconds.
- **Disk:** up to 2 extra copies of the built solution per active run.
- **Test runners:** the skip filter uses VSTest's `--filter`. Test projects on the newer Microsoft.Testing.Platform runner may treat filters differently. The existing targeted runs already rely on `--filter` the same way. Check that Implement's run shows about 626 tests.
- **Retries still build from scratch.** Each new attempt is a new commit.

## Not done (candidates for next)

- **Incremental builds:** start a new commit's build from the previous commit's build output, so only the changed projects recompile. Most useful for retries.
- **A test database in the coding container:** the agent could run the database-backed tests itself before finishing, which should mean fewer failed attempts.
- **Running only the affected tests per task:** only matters for plans with 2+ tasks, since a one-task run now runs the full suite once.

## Files changed

| File | What |
|---|---|
| `src/stages/build.ts` | Integrate reuse (`coversIntegrate`, `reusableTaskRun`); author-tests find + run 1 merged; which runs skip known failures and use the build cache |
| `src/verify/dotnet.ts` | build cache (`buildCachePath`, `saveBuild`, reuse); skip filter (`skipFilterFor`, `skippableKnownFailures`); expectations from the run's own results (`resolveExp`) |
| `src/stages/executor.ts` | free the run's kept builds when it's delivered, closed or stopped |
| `src/contracts/verify.ts` | `skippedKnownFailures` on a test run |
| `src/stages/build.test.ts`, `src/verify/verify.test.ts`, `src/stages/e2e.test.ts` | unit tests for each rule; the end-to-end test checks the exact list of builds, the skip filter, the reuse and the cleanup |
