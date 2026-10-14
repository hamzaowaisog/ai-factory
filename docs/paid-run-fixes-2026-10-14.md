# Fixes from the paid runs of 14 October 2026

Two paid runs of the Folio3 Parking App were read end to end: the web app (`20261013-folio3-parking-app-introductio-c0aa`) and the API (`20261013-folio3-parking-app-introductio-e8ef`). Both used gpt-6-luna, with gpt-6-sol as the stronger model.

This note lists every fault found, what it cost, its cause, and the fix.

## Summary

| # | Fault | Run | Cost | State |
|---|---|---|---|---|
| 1 | The test writer is not told why its test crashed | web | run parked after 25 min, 3 attempts | fixed, not committed |
| 2 | A screen cannot be rendered on its own in a test | web | same park | fixed, not committed |
| 3 | A task's code is wiped after a contract difference | API | 2 of 3 wipes rewrote working code | fixed, not committed |
| 4 | The contract check rejects correct shared error answers | API | about 24.5 min and $1.00 of $1.08 | fixed, not committed |

Faults 5 to 7 were found by the review of the checks further down and are fixed too. All seven fixes pass type checks and the full suite (2,109 passed, 2 skipped). None has been through a paid run.

One symptom reported during the runs did not happen: a failing test did not cause a writer's other tests to be written again. On every author-tests retry in both runs the log says "keeping the previous attempt's 4 test files", and one writer edited only the named tests.

## 1. The test writer is not told why its test crashed

**What happened.** In the web run, six of 45 tests crashed with `Tooltip must be used within TooltipProvider`. The writer was told only "fails with exception, not an assertion or not-implemented". It guessed three times, failed the same way each time, and the run parked.

**Cause.** The check that rejects such a test built its message from the failure kind and left out the error text.

**Why it was not caught.** The check was written for .NET bug fixes, where a crash is usually clear from the test. The factory's tests asserted that the check fails, not what its message says.

**Fix.** `src/gates/predicates.ts`: a rejection now ends with "It failed with: ..." and the first 300 characters of the error. It is added in the four places that left it out:

- a test that fails for the wrong reason (author-tests)
- an expected-to-fail test that fails for the wrong reason (task check)
- a new failure against the baseline
- a test of today's behaviour that fails on the old code

**Test.** `src/gates/gates.test.ts` asserts the message carries the error text.

## 2. A screen cannot be rendered on its own in a test

**What happened.** The same six tests. Each renders a screen that has a tooltip.

**Cause.** The tooltip provider and the toast area exist only in the app frame (`components/frame/app-frame.tsx`). The test set-up the scaffold writes put nothing around a rendered page. No correct test of such a screen could pass, and a test waiting for a toast never would.

**Why it was not caught.** Screen tests were committed in `913c8df` and had not been through a paid run. The factory's test checked that the set-up file is written, not that a real page renders with it.

**Fix.** `src/design/kit/screen-tests.ts`: the set-up file now wraps every `render()` in the tooltip provider and the toast area. Test writers call `render()` as before; there is no new rule for them.

**Test.** `src/design/kit/kit.test.ts` asserts the set-up wraps `render()` and that the kit ships both parts.

**Checked on the real code.** The parked web run's checkout was copied to a scratch folder, the new set-up file swapped in, and its 45 tests run. All 45 still fail before any code is written, as they must. The six that crashed now fail on an assertion.

**Render check.** The opt-in kit test (`FACTORY_KIT_E2E=1`, `src/design/kit/kit.test.ts`) now also renders every screen of the sample app, live and in each of its states, the way a screen test does, on both targets. The sample design gained a field hint and an icon-only button, the two things that draw a tooltip. With the wrapper taken out, the check fails with the parked run's error; with it, all 22 renders pass. It calls no model and is not part of a run.

**The router used directly.** A page that calls the router's own package and not `lib/nav` crashed the same way (`useRouter`: "invariant expected app router to be mounted"). No generated app on disk does this and no rule forbids it. The set-up file now gives `next/navigation` and `next/link` (Next.js) or `react-router` (Vite) the same stand-in as `lib/nav`, so such a page renders and its navigation is recorded. The render check covers it on both targets.

**Other cases looked for.** The tooltip provider and the toast area are the only things the frame gives a page. Translations have a built-in default and need no wrapper.

## 3. A task's code is wiped after a contract difference

**What happened.** In the API run, TASK-1 was wiped and written again three times, each time because the contract check had failed. The first wipe threw away code that passed all 15 locked tests; the rewrite passed 7.

**Cause.** The list of failures that let a retry keep the code had no entry for "contract" or "data-model". Anything not on the list means start again from the task's first commit, though both checks name the exact endpoint, field or column that differs.

**Why it was not caught.** The list was written before the contract and data-model checks existed, and they were not added to it.

**Fix.** `src/stages/build.ts:1403`: "contract" and "data-model" are on the keep list. Safety failures (locked files, scope, escape hatches) still reset.

**Test.** `src/stages/build.test.ts` asserts a contract or data-model difference keeps the code, and that it still resets alongside a safety failure.

## 4. The contract check rejects correct shared error answers

**What happened.** TASK-1 of the API run took five attempts, 34 min 22 s and $1.08.

| Attempt | Model | Time | Cost | Locked tests | Outcome |
|---|---|---|---|---|---|
| 1 | gpt-6-luna | 9m47s | $0.081 | 15 of 15 pass | contract check failed, code wiped |
| 2 | gpt-6-luna | 6m53s | $0.051 | 7 of 15 | contract failed again, code wiped |
| 3 | gpt-6-luna | 7m53s | $0.058 | build failed | code kept |
| 4 | gpt-6-luna | 3m05s | $0.018 | 12 of 15 | contract failed, code wiped, moved to the strong model |
| 5 | gpt-6-sol | 6m44s | $0.875 | 15 of 15 pass | passed |

Attempt 1 was correct. It was rejected with "not in the contract: GET /api/auth/google/authorization 503 body" and four more lines like it.

**Cause.** The contract writes each error answer as a pointer to a shared definition (`$ref: "#/components/responses/ServiceUnavailable"`), 53 times in this contract. The check follows pointers for data shapes but not for whole answers (`contractFacts`, `src/gates/contract.ts:94`). It reads every shared error answer as having no body, so an API that correctly declares the body is told the body is "not in the contract".

**Evidence.**

1. Attempt 1's commit (`a501efb`) declares `.Produces<ApiError>(503)`, and the contract's shared 503 answer is an `ApiError` body with the same three fields.
2. The check lists real differences before "not in the contract" lines. Attempt 1's list starts with a "not in the contract" line, so it had no real difference.
3. Comparing the run's contract with a copy of itself that has the shared answers written out in full gives 53 differences. The first five are word for word those of attempt 1.

The build output of attempt 1 itself is no longer on disk, so the check was not re-run on that exact file.

**What it cost.** About 24.5 minutes and $1.00 of the task's $1.08, including the $0.875 attempt on the strong model.

**Side effects.**

- The delivered code passed by declaring its error answers with no body (`.Produces(503)`), though the code still sends one. The API's own document understates what it sends.
- The check is too lenient in the same place: an API with no error body at all passes.

**Why it was not caught.** The contract check had not been through a paid run. Its own tests use contracts with the answers written inline; the planner chose the shared form on its own in this run.

**Fix.** `src/gates/contract.ts`: a pointer on an answer, a request body or a parameter is followed the same way a data shape's pointer is. The check that a contract is complete before it is locked follows them too.

**Test.** `src/gates/contract.test.ts` writes a contract with a shared answer and a shared request body, and asserts it matches an API that says the same, and does not match one that drops the body.

**Checked on the real contracts.** Each of the 11 contracts on disk was compared with a copy of itself that has the shared answers written out in full. Before the fix run e8ef's gave 53 differences; now all 11 give none, and none is newly refused at locking.

**Consequence.** The corrected check fails the API run's accepted TASK-1 code, with "missing in the API: ... 503 body" on 13 answers. If run e8ef is resumed or continued on the corrected check, its later tasks will be asked to put the bodies back. Decide what to do with that run first.

## Smaller findings, not changed

- **npm install repeats on every author-tests attempt** of a Node app (about 30 seconds each, three times in the web run), though the packages did not change between attempts.
- **A reset of author-tests redoes all writer groups**, not only the group at fault. It did not occur in either run, since every retry kept the files.
- **The parked web run (c0aa)** still has the old set-up file in its checkout, and that file is protected. Resuming it would fail the same way; a new run gets fix 2.

## Review of the checks

Done on 14 October 2026, read-only. Every failed attempt in the 38 run ledgers on disk was grouped by the check that failed it (178 failed attempts, 705 check results), and each check whose failure came back unchanged, or was later waved through, was read against today's code.

The review sees only failures. A check that wrongly passes leaves no trace in a ledger, so it finds those only by accident (it found one, under fault 4).

### Faults found in the code

| # | Fault | Evidence | State |
|---|---|---|---|
| 4 | Contract check does not follow a pointer to a shared answer | Proven on run e8ef. 9 of the 11 contracts on disk use the form, 23 to 472 times each | fixed |
| 5 | Contract check reads `allOf` around a pointer as "any type" | Proven on run e1b5: `status` is written that way, the API correctly says string, and TASK-2 failed twice on "the contract says any, the API has string". 6 of 11 contracts use the form | fixed |
| 6 | An error that cannot change on a retry is retried like a model's mistake | `src/stages/executor.ts:411` gives every thrown error the same class as a failed check. 14 attempts in 4 runs repeated an identical error: a design package already approved (d7a6, 5), no container runtime (3c44, 4), a briefing over its size limit (b497, 3), npm install failing (9fcb, 2) | fixed |
| 7 | The design-scope check refuses a non-functional requirement the spec has | `build.b1-design-scope` (`src/design/gates.ts:147`) counted only the spec's functional requirements as approved. Run c0aa's approved spec has NFR-1, and the plan's set-up task was refused three times for delivering it (about 6.5 minutes), then the plan was accepted anyway. It failed all 3 times it ever ran | fixed |

Likely the same as fault 5, not verified: run e8ef also failed on "the contract says string, the API has any" for three status fields. The API's built document is no longer on disk.

**How each was fixed.**

- **5.** `src/gates/contract.ts`: `allOf` around a pointer is read as the type it points at, several `allOf` parts as one object, and `oneOf` or `anyOf` with one real member (the other says only "or null") as that member. Covered by the same test as fault 4.
- **6.** `src/gates/ladder.ts`: the same thrown error on two attempts in a row stops the run with that error, where it used to move to a stronger model. A first occurrence is still retried once, since an install or a network call can recover. A briefing over its size limit already stopped at once. Test in `src/gates/gates.test.ts`.
- **7.** `src/design/gates.ts`: the spec's non-functional requirements count as approved. A requirement the spec does not have is still refused, and so is a task that delivers none. Test in `src/design/design.test.ts`.

### Found in the ledgers, already fixed before this review

- The build's own API document counted as a change outside the task's files (e1b5, 4 attempts).
- The design lint gave a count and no file or class name (1679, 2 attempts).
- A check at review that a locked test proves its criterion, when nothing could change the test any more (5 failures, never passed). The check now runs when the tests are written.
- A locked test failing twice with no one to judge it (31fe, e1b5, 0f9d parked). The test-or-code check now does this.
- The password rule flagging test and screen code (1679, e1b5).

### Looked like a fault, already fixed

- Run 31fe: two API tests (`ContractTests.AC_1_2`, `AC_2_2`) were rejected at author-tests as crashing. They did not crash: both used `Assert.True(condition, message)`, and the reader of .NET test results took an assertion with its own message for a thrown error. It cost one attempt and parked the run. Fixed on 7 October in `cafbca4` (`classifyTrxFailure`, `src/verify/trx.ts`), with these two messages in its test.

### Failures where the check was right

The spec anchor rule, plan coverage, test compile errors, the design layout checks and the test-proof check failed often, and each time the work was wrong and the message named what to fix.

### Not covered

- The estimate checks and the merge gate: they have no failures in these ledgers to replay.
- Checks that pass when they should fail, beyond the one found.
