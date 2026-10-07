# AI Factory: cost and failure fixes (proposed)

*Written on 2026-10-07, branch `Hamza/greenfield`. Fixes 1 to 16 and 18 to 20 are built and tested (uncommitted). 17 and 21 are left as they are, 22 comes later.*

This is the list of fixes found by reading the code against four live runs:

| Run | What it was | Where it ended | Cost |
|---|---|---|---|
| `b497` | Web app, boutique fitness studio | Parked at test writing | $11.70 of $15 |
| `31fe` | API, boutique fitness studio | Waiting on a cap card at test writing | $10.04 of $10 |
| `d7a6` | Design run | Finished | $8.19 |
| `674c` | Design run | Used for schema rejection counts only | |

Savings are estimates from these runs.

## 1. What the runs showed

- **Most of the money goes on rewrites.** On `b497`, output tokens were about $8.10 of the $11.70. Answers are written, rejected for a small reason, and then written again in full.
- **Neither build run ran a single test.** Both stopped in the step that writes the tests, for reasons the factory caused itself.
- **No run has reached coding, review or delivery**, so those steps have no evidence yet.

### Web run (`b497`)

- The briefing for the test writer was 40,228 tokens against a 40,000 limit, so the agent never started.
- The factory retried the same thing three times and parked.
- About 6.5 minutes were lost at $0. The first package install ran 4 minutes 11 seconds with no progress shown, and each failed try ran another 30 to 40 second install before failing.

### API run (`31fe`)

- Attempt 1 wrote about 14 test files in 35 turns for $2.84. It was rejected because two acceptance criteria (AC-1.2 and AC-1.5) had no test.
- The factory wiped all of it and started attempt 2 from an empty folder with $0.96 left under the cap.
- Attempt 2 ran out of money after 14 turns and hit the cap card.
- About 16 minutes and $3.84 were lost, with nothing kept.

## 2. The fixes

### Test step

1. **Keep the tests on a retry.** A failed attempt's tests stay, and the retry asks only for the missing ones. Today `author-tests` resets the working folder on every attempt (`src/stages/build.ts`); the coding step already keeps its code. Saves about $2.50 per failed attempt.
2. **Coverage checklist in the briefing.** The test writer is given the list of criteria that each need a test and told to check its answer against it before it returns. This is an instruction, not a hard check inside the session: a miss still fails the attempt, but fix 1 makes that retry cheap.
3. **Budget check before a step starts.** If the money left is well below what the last attempt needed, raise the cap card first. Today a step starts with as little as $0.25 (`src/ledger/caps.ts`). Saves about $1 per cap hit.
4. **Keep work from an attempt that ran out of budget or turns**, so the money already spent is not thrown away. Built for the test writer and the coder: the unfinished files are committed and the retry is told to finish them.

### Briefing size

The test writer and the coder work inside the project folder, so a file pasted into the briefing is a copy of something they can open themselves. A pointer loses no context.

5. **Point to the contract, don't paste it.** The web test writer gets a pointer. The .NET note pastes a small contract and points to one over 16,000 characters.
6. **Large stub files become pointers** (over 16,000 characters); small ones stay inline.
7. **Auto-shrink when over the limit.** Swap the biggest stubs for pointers until the briefing fits. Today the builder (`src/context/pack.ts`) can only shrink the pointer list and the repo map.
8. **Raise the agent briefing limit** from 40,000 to 60,000 tokens (`src/contracts/pack.ts`). The briefing is re-read from cache each turn, so this costs roughly $0.25 over a 35-turn session.
9. **Stop on the first try if it still doesn't fit**, not after three identical tries. This is a safety net for any step; with 5 to 8 in place it should not happen.
10. **Check the briefing size before installing packages.**

### Installs

11. **One install, not one per attempt.** The repeat installs came from the reset before each attempt, which deleted the installed packages. A reset now leaves them in place, and they are installed again only when the package list changes.
12. **Show progress during the first install**: a line every 30 seconds with the number of packages installed so far. It ran silent for about four minutes and looked like a hang.

### Cost of rewrites

13. **Plan retry returns a patch**, not a whole new plan. On `b497`, two uncovered requirements made the planner rewrite 51,000 output tokens for $1.30. Saves about $1 per plan retry. Built: the retry returns only the tasks and stub files that change, and can edit a few lines inside a large stub such as the API contract. The patched plan goes through the same checks. If the patch cannot be applied, or two patches in a row still fail, the planner writes the whole plan again (`src/stages/plan-patch.ts`).
14. **Design retry redraws only the failing pages.** On `b497` one cut-off label cost $0.86. Built in two parts:
    - A large design is already drawn page by page, and a retry reuses the stored answer of every page that passed. That only worked in estimate and design runs. Fix 19 turns it on for build runs, which is what `b497` was.
    - A small design is one answer. Its retry now redraws only the pages the failures name and keeps the rest. A failure about the look or the screen list still redraws everything.
    - Not changed: a page that is redrawn is still written whole.
15. **Accept trivial schema slips.** There were 21 such rejections across the four runs. Saves $0.30 to $2 per run. Built: a list sent as text is read as a list, and a sentence or label up to a quarter over its length limit is cut to the limit. Too many items, a missing field or an id that is too long still go back to the model.
16. **Retries keep normal effort for mechanical failures.** Before, any second failure went to the highest effort (`src/stages/routing.ts`). Built: the effort stays as it was when every failure is one of: the answer did not fit its shape, budget or turns ran out, or a listed item has nothing against it (a criterion with no test, a requirement with no task or screen, a cut-off label). Saving not measured.
17. **Fewer spec drafts when there is no second model family.** With no OpenAI key all three drafts come from the same model. On `b497` drafts and merge cost $2.78 and took 9 minutes. Saves up to about $2.80 per build run. *This trades quality for cost: a decision for Hamza and Ahsan (one draft or two).*
18. **No cache write on calls that never read it back.** Measured again on the traces: the waste was the spec drafters. They were given repo tools on an empty repo, which makes the briefing a cached conversation, and then answered in one turn. On `b497` seven calls wrote 200,000 tokens that way, about $0.25. Built: with an empty repo the drafters get no repo tools (`src/stages/specpipe.ts`). The larger numbers on `674c` came from before an earlier fix and no longer apply.
19. **Reuse stored answers on retry and resume in build runs**, as estimate and design runs already do. Built with three limits: only answers from the same run, never an answer that was written against failures (a retry rejected for the same reasons must ask again), and never a reviewer's answer.

### Errors caught earlier

20. **Contract YAML errors reach the planner** with the line that broke, not "needs openapi and paths". Built: the failure gives the parser's message, the line number and the text of that line, or names the top-level key that is missing.
21. **Default cost caps match what runs cost.** The spec side alone used $6.19 (API) and $11.70 (web) against caps of $10 and $15, so every run stops on a cap card mid-step. *This is a decision, not a code fix.*

## 3. Running coding tasks in parallel

22. **Run independent coding tasks side by side.**

### Today

- The plan already records, per task, which tasks it depends on and which files it may touch (`PlanTask` in `src/contracts/artifacts.ts`).
- The executor can already run up to four steps side by side (`nextBatch` in `src/stages/executor.ts`). It is used for writing module specs.
- The coding step uses neither. Each task waits for every earlier task in the plan and starts from the previous task's commit, all in one working folder.

### What it needs

1. **Group tasks into waves.** Two tasks go in the same wave only if neither depends on the other and their file lists don't overlap.
2. **One working folder per task in a wave**, all starting from the same commit.
3. **Merge the wave, then run the full locked test suite on the result.** If the merge conflicts or a test breaks, redo only the later task on top of the merged code, one at a time as now.
4. **Change the "you broke an earlier task's test" check**, which today relies on plan order.

### Risks

- **Tasks that look unrelated often share a few files**: the app's startup and route registration, the database setup, the package list. If the planner leaves those out of a task's file list, the merge conflicts and the time saved is lost. The fall back in step 3 covers this.
- **It saves time, not money.** The tokens are the same. Four agents spending at once can overshoot the cost cap, because the cap is only checked between steps. Fix 3 has to go in first.
- **Machine load.** Four containers building and testing at once on one laptop may be slower per task than one.

### Why it comes after the other fixes

- Neither run can reach coding today, so parallel coding has nothing to run on until fixes 1 to 12 are in.
- The gain is not measured. One sequential run through coding shows how long it takes and how many tasks in a real plan are independent.

## 4. Order

| Step | Fixes | Why |
|---|---|---|
| First (built) | 1 to 12 | Gets both parked runs moving |
| Next (built) | 13 to 16, 18 to 20 | Cuts the cost of rewrites |
| Then | 22 | Parallel coding, once a run has gone through coding one task at a time |
| Left as is | 17, 21 | Draft count and default caps stay as they are (Hamza, 2026-10-07) |

`dist` is rebuilt with fixes 1 to 16 and 18 to 20. Resuming the two runs spends API credit and `31fe` needs its cap raised first, so both wait for a go-ahead.

On resume, `31fe` keeps the first attempt's 15 test files ($2.84): they were restored into its working folder from commit `43a7801`. The second attempt's three files are set aside in a git stash.

None of fixes 13 to 20 has been through a live run yet. Both parked runs are past the plan and the design, so the first run to show the plan patch and the page redraw will be a new one.
