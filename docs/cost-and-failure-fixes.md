# AI Factory: cost and failure fixes (proposed)

*Written on 2026-10-07, branch `Hamza/greenfield`. Fixes 1 to 16 and 18 to 20 are built and tested. 17 and 21 are left as they are, 22 comes later. Fixes 23 to 35 (section 5) came from the first run to reach coding and are committed (`cafbca4`, `98d23aa`).*

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

### Verdict (2026-10-07): do not build it now

Checked against the two plans the runs already have. A task can run beside another only if neither depends on the other and their file lists don't overlap.

| Run | Tasks | Could run side by side | Best case |
|---|---|---|---|
| `b497` (web) | 7 | None: the planner declared every task as depending on the one before | No time saved |
| `31fe` (API) | 8 | 5 tasks, in two groups (2 and 3) | 8 slots become 5, about a third less coding time |

- **The planner writes chains.** It is told to put tasks "in dependency order", and on the web run it made each task depend on the previous one. The three screen tasks (TASK-5, 6, 7) look independent, but the plan says they are not. Parallel coding does nothing until the planner declares only real dependencies.
- **The API saving is an upper bound.** The side-by-side tasks are queries, commands, seed and transformers, which are likely to touch the same registration and startup files. A merge conflict sends a task back to run alone, and the saving shrinks.
- **It costs the same money and adds risk.** The tokens are the same, and several agents spending at once can overshoot the cost cap, which is only checked between steps.
- **Coding time is not known yet.** No run has reached coding. On these two runs the time went on spec, design and test writing.

What to do instead, in order:

1. Get one run through coding one task at a time and read the per-task times from its trace.
2. If coding is the slow part, change the plan prompt so tasks declare only real dependencies, and check the next plans for how many tasks come out independent. This is a small change.
3. Build the waves only if those plans show a real gain: roughly a third or more of the tasks able to run together.

## 4. Order

| Step | Fixes | Why |
|---|---|---|
| First (built) | 1 to 12 | Gets both parked runs moving |
| Next (built) | 13 to 16, 18 to 20 | Cuts the cost of rewrites |
| Later, if measured | 22 | Parallel coding: not now, see the verdict in section 3 |
| Left as is | 17, 21 | Draft count and default caps stay as they are (Hamza, 2026-10-07) |

`dist` is rebuilt with fixes 1 to 16 and 18 to 20. Resuming the two runs spends API credit and `31fe` needs its cap raised first, so both wait for a go-ahead.

On resume, `31fe` keeps the first attempt's 15 test files ($2.84): they were restored into its working folder from commit `43a7801`. The second attempt's three files are set aside in a git stash.

None of fixes 13 to 20 has been through a live run yet. Both parked runs are past the plan and the design, so the first run to show the plan patch and the page redraw will be a new one.

## 5. Fixes from the first run through coding (`31fe`, 2026-10-07)

`31fe` was the first run to reach the coding step. It finished six of eight tasks and then parked at TASK-7 with $27.65 of its $30 limit spent. Before resuming, every remaining step was traced against its ledger without spending. These are the fixes from the coding itself and from that trace.

### What the run showed

- **The plan was built in layers.** Tasks 1 to 7 wrote the data model, the services and the API document code. TASK-8 wrote the endpoints. 100 of the 106 locked tests go through HTTP, so they answered "404" until TASK-8, whatever the earlier tasks wrote.
- **Tasks were held to tests they could not pass.** TASK-7 used five paid attempts (about $2.50 each) on three tests that needed TASK-8's endpoints.
- **A long session filled the model's context window** ("prompt is too long") and was treated as an error, so its code was thrown away.
- **Each move to a stronger model started from nothing**, paying again for much the same code.

### Coding step

23. **A test failure is read for what it is.** A test that fails because the answer does not match the contract is an ordinary failed assertion, not a crash (`src/verify/trx.ts`). Before, the test writer's work was rejected for it.
24. **Free re-check.** When the last attempt failed only on tests the task is no longer held to, its code is judged again as it is, with no coding session (`recheck` in `src/stages/build.ts`).
25. **Tests wait for the task that can reach them.** A criterion proven through the running app (level api, ui or job) is held at the last task built on its owner once the plan is known to be layered (`acOwners`, `planShowsLayers`). That task gets those requirements in its briefing (`takenOver`).
26. **A layered plan is seen from its files, before any task runs.** If a requirement tested through the app sits on a task that writes no route or page file, nothing under it does, and a task built on it does, the plan is layered from the start (`layeredByFiles`). No model call. It goes by file names (`Program.cs`, `Endpoints`, `Controllers`; `page` and `route` files), and says nothing when no task writes such a file.
27. **Hand over on the first failure, not the second.** When a task's own app-level tests fail with exactly the same kind and message as before the task started, nothing else failed, and the task writes no route or page itself, the tests move to the later task at once (`failsAsBefore`, `deferNow`). A real bug changes the message and still gets its retry. Covers the plans fix 26 does not recognise.
28. **The task that takes tests over can fix what they run.** It may edit the files of the tasks it took over from and of every task it is built on, and it gets twice the turns, budget and time (160 turns, $8, 90 minutes).
29. **A full context window is unfinished work.** The code is kept and the next attempt finishes it, as for running out of budget or turns (`src/runners/claude-agent.ts`). Compaction is switched on for the coding agent (`docs/design/context-builder.md` §2.10), and the briefing asks the agent to keep command output and file reads small.
30. **A move up the ladder keeps code that is getting closer.** If the last attempt failed only on locked tests and fewer of them than the attempt before, the code is kept. Same or more failures still get the fresh start (`retryMode`).
31. **The limit card comes before a first attempt too.** A first coding attempt starts only with at least what the dearest earlier coding attempt in the run cost (`startNeed` in `src/stages/executor.ts`). Before, it needed $1 and would have been cut off part-way.
32. **The planner is told to list a requirement on the task after which its criteria can pass** (`src/stages/spec.ts`): prefer tasks that each deliver a working slice, the logic together with its endpoint or screen, and if it builds in layers, make the wiring task depend on every layer it serves. It is also told to declare only real dependencies. Applies to new plans.

### Integrate and review

33. **A change over the size limit asks for a waiver.** `integrate.diff-size` runs after the other integration checks, and when it is the only one failing the run stops on a waiver card (`factory waive`). Before, it parked with no way forward: `31fe` is 2,839 lines against a limit of 1,500, and a project can only lower that limit.
34. **Review limits grow with the number of criteria.** Every criterion needs its own verdict, and running out before the last one fails the review and pays for it again. The usual 14 turns, $2 and 15 minutes fit about 35 criteria; a larger change gets two or three times that (`reviewRoom` in `src/stages/deliver.ts`). `31fe` has 104.

### Checked and found fine

35. **Deliver.** Traced for `31fe` at no cost: no secrets in its nine commits, the PR text is 44,000 of GitHub's 65,536 characters, the manifest commit holds one file, and the token can push to the repo.

### From the resume of 2026-10-07

What the resume showed: TASK-7 passed on the free re-check, compaction worked in a live session (164k tokens down to 17k), and TASK-8 has not passed yet. Three things stopped it, none of them the code it wrote.

36. **A file the plan names is committed even when an ignore rule hides it.** The skeleton's `.gitignore` had `openapi/`, for the built API document in `App.Api/openapi/`. The plan put a source file in `App.Api/OpenApi/`. On a Mac those are one folder and git matches ignore rules without case, so the file was left out of every commit. The test lab judges the commit, so TASK-7 was tested five times without the code it wrote. Before each task commit, and before the clean on a "keep the code" retry, the factory now adds the files of the task's scope that an ignore rule hides, under the plan's spelling (`trackIgnored` in `src/ledger/git.ts`). The built document stays out.
37. **The agent is told not to delete that folder.** It ran `rm -rf openapi` to get a fresh document and removed its own source file with it. When a scope file shares the built document's folder, the prompt says to delete only the document.
38. **New projects ignore only the built document.** The skeleton's rule is now `openapi/*.json`.
39. **Out of credit stops the run at once.** "Credit balance is too low" was an ordinary failure: three attempts and two rungs went in five seconds, the task moved to the dearest model, and twelve minutes of code were thrown away on the rung move. It is now a park. The code so far is committed and the next attempt carries on from it at the same rung. Such a failure is no attempt on the ladder, also when it is read from a run's earlier events, so `31fe` goes back to rung 0.
40. **The planner must build in working slices.** Fix 32 was a preference; it is now the rule, and the plan is checked (`slicesProblem` in `src/stages/build.ts`). A plan goes back to the planner once when its files show layers, or when one task holds more than 60% of the criteria checked through the app (plans of four or more tasks and twelve or more such criteria). A plan that stays layered still runs, with the hand-over of fixes 28 and 29. File scopes may not overlap, so the planner is told to have the first slice register routes by convention.
41. **A task that writes the API gets the contract differences.** The list compares the document of the last build with the contract and includes what the contract gate does not check: operation ids, parameters, enum values and nullable fields (`contractGap` in `src/gates/contract.ts`). The gate itself is unchanged. On a first attempt the list mostly says which operations are missing; it earns its place on retries. In `31fe` the gate passed while the run's own contract tests failed on exactly these details.

Also learned: a sleeping laptop freezes a run while its time limit keeps counting. Attempt 1 of TASK-8 lost about 76 of its 99 minutes that way. Keep the machine awake (`caffeinate -dims`).

### Still unproven

- No run has finished TASK-8, review or delivery yet. `31fe` is the first.
- Fixes 40 and 41 have not been through a paid run: no plan has been written under the new rule yet.
- Review will run on `gpt-5.5`, which `31fe` has not called. The project file has no price for it, so the factory counts it at its dearest rate.

## 6. Cost logging (2026-10-08)

Built before the next resume, so the run itself shows where to save. No prompt changed, so parked runs resume into it unchanged.

`factory report <run> --cost` (add `--json` for the data) reads the ledger and the run trace, with no model call. It shows:

- **Money by kind of token**, for the run and per stage: answers written (output), context read again (cache read), context stored (cache write), context sent uncached (input).
- **Attempts that did not pass**: what each one cost, on which model, and why it failed.
- **Coding agent sessions**: turns, the largest and the average context, how often the context was summarised, and how often it was stored again instead of read (a gap longer than the cache keeps it).
- **What the tool calls put into the context**: calls and tokens per tool, and the largest single results with the command or file.
- **Briefings**: tokens per step against the limit, and the largest sections.
- **Answers sent back for their shape, answers cut off at the output limit, stored answers reused.**

What is new in the trace (`trace.jsonl`):

| Line | What it holds |
|---|---|
| `agent.turn` | now carries the numbers: context size, output, cache read, cache write |
| `agent.result` | a tool result of about 2,000 tokens or more: the tool, the command or file, its size |
| `agent.compact` | the context was summarised, and its size before |
| `agent.summary` | at the end of a session: the largest context, and calls and size per tool |
| `agent.end` | now also written for a session that timed out or was cut off, so its time is counted |
| `pack` | each briefing's size against its limit, by section |

Tool result sizes and briefing sections exist only for sessions run after this change; older runs show the rest. The agent image is rebuilt once on the next run, because its script changed.

First reading, run `31fe` ($32.40): 72% went on attempts that did not pass. Of the $18.12 spent on coding, $8.28 was the agent reading its own context again and $4.27 storing it; the sessions that failed averaged about 100K tokens of context per turn.

## 7. Smaller agent context (2026-10-08)

Both are settings of the coding agent's session, sent with each job (`AGENT_CONTEXT` in `src/runners/claude-agent.ts`). Not through a paid run yet; section 6's report shows their effect.

42. **A tool result is capped.** A command's output past 10,000 characters (about 2,500 tokens) is saved to a file, and the agent gets a preview and the path; before, up to 30,000 characters went into the context. One file read returns at most 12,000 tokens and a bigger file is read in parts; before, 25,000. Nothing is lost: the agent can search the saved output or read the next part.
43. **The compaction window is set to 400,000 tokens.** The SDK summarises at the smaller of this number and the model's own window. The sessions in `31fe` ran on a 200K window ("Prompt is too long" came at about 175K), so there this changes nothing: the context is summarised where it was before. It takes effect only on a model with a window above 400K. To summarise earlier and cut the re-read cost on a 200K model, the number has to be below the window; the SDK accepts 100,000 to 1,000,000.

## 8. From the stop of run 31fe (2026-10-08)

Run `31fe` was stopped by decision at $40 with TASK-8 one failing test short. These came out of reading its ledger, and of checking the web path for the same faults.

44. **A budget stop is read as a budget stop.** The SDK throws "Reached maximum budget" after the result, and that replaced the result's own status with a plain error, so the code was left uncommitted and the next attempt would reset it. The agent script keeps the result's status (`LIMIT_STOPS` in `docker/agent/run-agent.mjs`), and a stop stored the old way is read as out of budget (`checkOf` in `src/stages/build.ts`), in the coding step and the test-writing step.
45. **The test writer keeps its tests when credit runs out.** The coding step already committed its work on that stop; the test-writing step parked without it, and the resume started from the stub commit (run `b497` paid $1.91 for tests that were thrown away). It now commits the test files and the next attempt carries on from them.
46. **A move up the ladder keeps the code.** A retry on a stronger model used to start from the task's start. It now keeps the code whenever only tests or the build failed, as a retry on the same rung does, and the agent is told to replace a part only where its approach cannot pass the tests. A safety failure, an agent error or a crash still starts fresh.
47. **The agent is told its limits.** Turns, minutes and whole dollars of the session go in the task text of the coding agent and the test writer (`limitsNote`), with the advice to run the tests early. Before, the agent could not know them (attempt 7 of TASK-8 was cut off at $5 with 105 of 106 tests passing).

Unproven in a paid run: 44 to 47. Checked on a dry run only.
