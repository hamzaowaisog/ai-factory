# The implement ⟲ verify loop: two changes (2026-09-29)

## Summary

**What changed**

1. **Every task checks the earlier tasks' locked tests.** Before, a task had to pass only its own locked tests and the characterisation tests. The earlier tasks' locked tests ran too, but their results were ignored, so a later task could quietly break an earlier one and nobody found out until integrate. Now each task must also keep the earlier tasks' locked tests passing. Later tasks' tests are still left out, because the code for them doesn't exist yet.

   When one of those earlier tests fails, the agent is told plainly: *"Your change broke TASK-1's locked test X (AC-1.1): …"*. This is a normal failure that climbs the usual ladder (retry → more effort → stronger model → park). It does **not** trigger the "the same locked test failed twice, maybe the test is wrong" rule, because that test already passed at its own task: the code is wrong, not the test.

2. **A retry keeps the code when only tests or the build failed.** Before, every retry threw away the previous attempt's code and started again from the task's start. Now, if the previous attempt failed only because tests failed or the build broke, the agent starts from its previous code (since 2026-10-08 also after a move up the ladder, where it is told to replace a part only where its approach cannot pass the tests; see fix 46 in cost-and-failure-fixes.md). It sees its previous diff and is told to fix the failures by editing that change, not to rewrite it. Everything else still starts fresh: safety failures, edits outside the task's files, escape hatches, protected files, secrets, changes to locked tests, agent errors or timeouts, bad test evidence, a crash. (Until 2026-10-08 a move up the ladder also started fresh, so a stronger model wasn't anchored on a weaker model's approach; that cost a full rewrite each time.) One exception to the last: if the previous attempt failed only on locked tests and fewer of them than the attempt before, the code is kept on the way up too. It is getting closer, so the higher rung finishes it instead of paying for it again (on a large wiring task a fresh start throws away a whole session).

**What it means**

- A task that breaks an earlier task is caught at that task, where the fix is cheap and the agent is told exactly which test and which task.
- A near-miss (one test off, a compile error) costs a small fix instead of a full rewrite. A different approach still comes with the next rung.
- The diff checks still measure the whole task from its start commit, and each task still ends as exactly one commit on the branch.

**Also fixed on the way**

- **Plans with two or more tasks never finished.** Each task's start commit was taken from whichever other task had finished last, so when task 2 finished, task 1's inputs changed and it ran again, and the two kept re-running each other. Now a task starts from the task just before it in plan order and waits until every earlier task is done.
- **Two broken builds in a row parked the run.** A failed build marks every expected test as failed, which looked like "the same locked test failed twice". A broken build now names no locked tests, so it climbs the ladder like any other failure.

**What was left out, and why**

- **Integrate sending failures back to a task: deliberately not built.** After change 1, integrate can only fail on flaky tests, on the total diff-size check, or on criteria no task owns. None of those points to one task. And sending a task back changes its commit, which re-runs every later task's coding agent (cost).
- **Running only the tests a change affects: out of scope.** Tests run without AI, so this would save time, not money.

**Also fixed on the way:** in a plan with two or more tasks, a finished later task changed an earlier task's inputs, so the tasks re-ran each other forever. A task now depends only on the tasks before it in plan order. Found by the new three-task end-to-end test.

## Details

### Earlier tasks' tests (`src/stages/build.ts`)

- Ownership is unchanged (`acOwners`): each criterion belongs to the last task in plan order that works on its requirement.
- `earlierTests(plan, owners, tests, taskId)` lists the locked tests owned by tasks before this one. They are added to the task's `expectPass`, next to its own tests and the characterisation tests.
- After the test gate, `labelRegressions(failures, earlier)` rewrites a `locked-failed`, `locked-flaky` or `locked-not-executed` failure on one of those tests into check `regression`, message *"Your change broke TASK-n's locked test <id> (<criterion>): <original message>"*, stack frames kept. The recorded gate result is untouched, so `verify-evidence` still re-checks it.
- Regressions are not counted as locked-test failures (`lockedFailedIds`), so the ladder's test-defect rule doesn't fire. If only regressions failed, the category is "other" and the ladder climbs as usual. An earlier test that didn't run counts as a regression; a "didn't run" on the task's own tests or characterisation tests is still an evidence (safety) failure.
- When the build fails, every expected test is marked "Build failed". Those are left as they are, not relabelled as regressions.

### Keep or reset on a retry (`src/stages/build.ts`)

Decided at the start of `implement/<task>`, before the old reset block:

- `previousAttempt(events, step, checks)` reads the ledger: the last `step.failed` or `step.interrupted` of this step since it last completed. An interrupted or parked attempt counts as "didn't finish".
- `retryMode(prev, rung)` is pure. It keeps only when all of these hold:
  1. there was a previous attempt and it ended in a recorded failure;
  2. every failure check is one of `build`, `locked-failed`, `locked-flaky`, `regression`, `new-failure`;
  3. this attempt runs at the same rung as the previous one.
- Then a worktree check: HEAD must be the commit the factory made on that attempt (stored as `commit` on `step.failed`), a descendant of the task's start commit, with no uncommitted changes. If not, reset.
- **Keep:** the diff start..HEAD is saved to the ledger and shown to the agent as a "Your previous change" section (cut at 40 KB with a note). Then HEAD moves back to the start commit with the files left in place (`git reset --mixed`), and ignored build output is cleaned. The agent's edits and the previous change are committed together, so the task still ends as one commit.
- **Reset:** as before: save the diff, `reset --hard` to the start commit.
- The decision is stored on the existing events: `retryMode` (`keep` or `reset`) and `retryReason` on `step.failed` and `step.completed` data, plus a log line such as *"implement TASK-2: keeping previous attempt's code (the previous attempt failed only on regression; …)"*. No new event type.
- Unchanged: diff gates and the ladder's "same diff again" check measure from the task's start commit; attempt caps and park rules.

### Broken builds

A failed build marks every expected test as a failed locked test ("Build failed"). Those failures no longer count as locked-test failures: a broken build is category "other" with no locked tests named. So two broken builds in a row climb the ladder instead of hitting the "same locked test failed twice" rule and parking the run.

### Tests

- `src/stages/build.test.ts`: `earlierTests`, `labelRegressions`, `retryMode` (keep on test, build and regression failures; reset on a rung move, safety, scope, escape hatch, agent timeout, interrupted, first attempt), `previousAttempt`.
- `src/stages/e2e.test.ts`, "implement loop across tasks": a scripted three-task run on the fake runtime. An out-of-scope edit resets to the start commit. TASK-2 breaks TASK-1's test twice: it gets a regression naming TASK-1, keeps its code on the same-rung retry, climbs instead of parking, starts fresh at rung 1 and passes. TASK-3's tests aren't in TASK-2's `expectPass`. TASK-3's own test fails once and the retry starts from the kept code with the previous diff in its instructions. The branch holds one commit per task.

## Added on 2026-10-07: plans built in layers

Found on the first run to reach coding (`31fe`). The full list with the other fixes from that run is in `docs/cost-and-failure-fixes.md`, section 5.

**The problem.** A plan can put the data model, the services and the endpoints in separate tasks. A test that goes through the running app cannot pass until the endpoint task, but ownership (`acOwners`) held it to the last task that lists its requirement, often a service task. That task then failed the same test on every attempt.

**What happens now** (`src/stages/build.ts`)

- **Seen from the plan's files** (`layeredByFiles`): a requirement tested through the app (level api, ui or job) is held by a task that writes no route or page file, no task under it does, and a task built on it does. The plan is then layered before any task runs.
- **Seen from the first failure** (`failsAsBefore`, `deferNow`): the task's own app-level tests fail with the same kind and message as before the task started, nothing else failed, and the task writes no route or page itself. The executor records the attempt with action `defer` and does not climb the ladder.
- **Seen from the second failure** (`failsForLayers`, `deferrable`): the same own app-level tests failed twice and a later task is built on this one. This is the fallback when the message changed between attempts.
- **Once the plan is layered**, app-level criteria are held at the last task built on their owner. The earlier task's code is judged again without a coding session (`recheck`), since it is no longer held to those tests.
- **The task that takes them over** (`takenOver`) gets the requirements, the files of the tasks it took over from and of every task it is built on, and twice the turns, budget and time.

**Keeping code on the way up the ladder.** See change 2 above: a move up keeps the code when fewer locked tests failed than the attempt before.

**Starting a first attempt.** `startNeed` (`src/stages/executor.ts`): a first coding attempt needs at least what the dearest earlier coding attempt in the run cost, so the limit card comes before the attempt.

**Limits of the file check.** It reads file names, so a plan that names its routes differently is not caught there and falls to the first-failure rule. In an existing app, a logic task followed by a task that adds a new route and depends on it has its tests checked one task later than they could be.

