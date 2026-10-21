# Demo mode (`FACTORY_DEMO=1`)

Demo mode relaxes the factory's build gates so a run reaches a delivered product (a pull request and a running app) instead of stopping on a card, a park or a long retry ladder. It was built for showing the factory to judges and clients, where a run that stops halfway is worse than a run that delivers with its gaps named.

It is **not** for real delivery. A demo run can ship code with failing tests, unreviewed criteria and blocking review findings. Every one of those is named in the run log and on the pull request, so nothing is hidden, but nobody has checked them.

## How to turn it on

Demo mode is an environment variable, read by whichever process runs the steps. Nothing about it is stored with the run.

```bash
# the factory UI: every run started or resumed from it runs in demo mode
FACTORY_DEMO=1 factory ui

# a run from the terminal
FACTORY_DEMO=1 factory run ...
FACTORY_DEMO=1 factory resume <run-id>
```

Things to know:

- **Set it on the process that executes.** A UI started without it runs everything without it, even a run that was started in demo mode before. The same run can be resumed with or without it.
- **A run started without it can still switch over.** Pause or stop it, then resume it with `FACTORY_DEMO=1`. Apart from the retry limit, the relaxed checks only begin at stub-commit, so a run caught at clarify, specify, design or plan loses nothing.
- **To turn it off,** start the process without the variable. The normal gates come back at once.
- **Every relaxation writes a `DEMO` line to the run log** (`~/.factory/ledger/<run>/run.log`). To see what a run let through, run `grep DEMO ~/.factory/ledger/<run>/run.log`.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `FACTORY_DEMO` | unset | `1` turns demo mode on. Any other value leaves it off. |
| `FACTORY_DEMO_ACCEPT_AFTER` | `2` | The try from which a step accepts what it has instead of retrying. `2` gives one retry with the failures fed back first. `1` accepts on the first try: fastest, but the least working code. |

## What changes

All the code reads one switch, `demoMode()` in [src/util/demo.ts](../src/util/demo.ts). Each change below is one `if (demoMode())` branch, marked with a `// DEMO:` comment. Apart from the retry limit, nothing before stub-commit changes: clarify, specify, design, estimate and plan keep their normal checks.

### Retries: 2 attempts per step instead of 6

[src/gates/policy.ts](../src/gates/policy.ts) sets `retryBudget` to `DEMO_RETRY_BUDGET` (2) instead of 6. This applies to every step, the early ones included. A step gets its first attempt and one retry with the failures fed back. Then a build step accepts what it has (see below), and any other step stops as it would after 6.

The factory counts tries with `demoTry()` rather than every start of a step. A pause, a park and resume, or a plan sent back does not use up a try. A rate-limited attempt, or one that threw before the agent ran, doesn't count either (run b587 counted author-tests attempts 1, 3, 4, 5 without this).

### stub-commit: stubs that don't build are dropped

Normal: if the plan's interface stubs don't build in a new product, the plan is sent back. That costs a planner session and often a whole new plan.

Demo (`demoDropStubs` in [src/stages/build.ts](../src/stages/build.ts)): the stubs named in the build errors are reset to their old version or removed, and the run goes on. A second round drops every stub still left if the build still fails. If the errors aren't in any stub, or the build can't run, it goes on anyway.

Log: `DEMO stub-commit: … dropped N stub(s) instead of sending the plan back`.

### author-tests: from the 2nd try, accept what was written

[src/stages/build.ts](../src/stages/build.ts), `author-tests`:

| Normal | Demo (from the accept try) |
|---|---|
| A criterion with no test fails the attempt. | It goes on untested and is named in the log. |
| Test files that don't compile mean another writer session. | Those files are dropped, their criteria go untested, and the rest run again (runs c944, e8ef produced a new compile error every attempt). |
| Tests that fail on the old code for the wrong reason (an exception, not an assertion) fail the check. | They are locked as they are. |
| A model reads every test against its criterion (the weak-test check) and can send all of them back for a rewrite. | Skipped on every try. |

### implement: from the 2nd try, accept a task whose build passes

[src/stages/build.ts](../src/stages/build.ts), `implement/TASK-n`:

- **The task builds but checks fail** (locked tests, contract or data-model differences, lint, files outside its scope): the task is accepted.
  - The failing locked tests are recorded as `test.disputed`.
  - Later tasks are no longer held to them, so a later task isn't told it broke them (run 7850 lost an attempt that way).
  - They are named on the pull request.
  - Log: `DEMO implement TASK-n: build ok; accepting N failing check(s)…` and `…left out of later checks and named on the pull request`.
- **The task still doesn't build on its last attempt:** it is dropped (reset to where it started) and the run goes on without it.
  - Log: `DEMO implement TASK-n: still does not build on the last attempt; dropped`.
- **An agent cut off on its last attempt** (turns, budget or timeout; run c944 exited 143): what it wrote is checked instead of failing at once.
- **On a retry,** the factory skips the step that reruns only the previously failing tests and runs the whole suite straight away.

### integrate: accept instead of parking or asking

[src/stages/build.ts](../src/stages/build.ts), `integrate`:

- **Failing locked tests, contract or data-model findings on a built app** are accepted, and the run goes on to delivery. A built app means at least one test passed.
  - Log: `DEMO integrate: accepting N failing check(s) instead of parking`.
- **Tests that pass only at the usual time or order** are treated the same way as in a lenient run. They are left out of the checks and named on the pull request instead of parking the run.
- **A size limit a person would normally waive on a card** (change size, design size cap, estimate size) is waived at once (`integrateWaiver`). The waiver is recorded with `human: "DEMO mode"` and shown on the pull request (run 3f0f stopped on this card).

### design-fidelity: switched off

[src/stages/design-fidelity.ts](../src/stages/design-fidelity.ts) skips the screen-against-design comparison. In a web run it took about 8–10 minutes and usually raised a waiver card.

### acceptance: deliver with unproven criteria

[src/stages/build.ts](../src/stages/build.ts), acceptance evidence: if the app started but some criteria aren't proven, the run goes on to delivery. The gaps are written to the log and the evidence.

Log: `DEMO accept: delivering with N criteria not proven`.

### review: deliver despite blocking findings

[src/stages/deliver.ts](../src/stages/deliver.ts):

- **A review that left criteria without a verdict** goes on, and those criteria are logged.
- **Blocking review findings** don't park the run. The pull request opens with a warning block at the very top, listing every blocking finding with security findings first: "Delivered in demo mode with N blocking review findings… Fix before merging".

## What demo mode never relaxes

The safety checks stay in force in every step:

- **Locked tests changed** (`lock-set`): a task that edits the locked acceptance tests is still refused.
- **Protected files changed** (`config-integrity`): still refused.
- **Secrets in the diff** (`secret`): still refused.
- **The app doesn't build at integrate, or doesn't start at acceptance:** the run still parks. Demo mode delivers a working app with gaps, never a broken one.

The checks before stub-commit are untouched too (only their retry limit is lower). A demo run still asks the clarify questions, and still waits for design approval and any other card on those steps.

## Benefits

- **Runs finish.** A demo run gets from request to pull request and running app without waiting on a person after the plan. Before demo mode, runs 3f0f, 7850, c944 and e8ef each stopped at a card or park in the build steps.
- **Faster and cheaper.** At most 2 attempts per step instead of 6. No weak-test model pass, and no 8–10 minute fidelity check. 78% of implement time across stored runs went on failed attempts, which is the part demo mode cuts.
- **Nothing hidden.** Every relaxation is a `DEMO` line in the run log. Accepted failing tests, waived limits and blocking findings are named on the pull request, so a reviewer sees exactly what was let through.
- **Switched per process, with no lasting effect.** Turning it off brings back the normal gates for the next step of the same run. No run settings, code or config change.

## What it costs

- **The delivered code can be wrong.** Tests may fail, criteria may be untested or unproven, a task may be missing, and review findings, including security ones, may be open. Treat a demo pull request as a draft: read the warning block and the named tests before merging anything.
- **Fewer retries means less working code** than a normal run would reach on the same request. `FACTORY_DEMO_ACCEPT_AFTER=1` makes that worse in exchange for speed.

## Reading a demo run's ledger

Each relaxation leaves a mark in `~/.factory/ledger/<run>/`, so a person or an agent can tell what demo mode let through:

| Where | What it means |
|---|---|
| `run.log`, lines with `DEMO` | Every relaxation, with the step and what was accepted, dropped or skipped. |
| `events.jsonl`, `test.disputed` with `why` starting `DEMO:` | A locked test a task was accepted with while it still failed. Later checks leave it out. |
| `events.jsonl`, `test.disputed` with `key: "integrate"` | A test that passed only at the usual time or order. It was left out of the checks. |
| `step.completed` data `demoAccepted: N` | A task accepted with N failing checks. |
| `step.completed` data `demoDropped: true` | A task dropped because it never built. Its code isn't in the product. |
| A waiver with `human: "DEMO mode"` | A size limit at integrate, waived without asking. |
| The `design-fidelity` step's data `skipped: "DEMO: switched off…"` | The design fidelity check didn't run. |
| The pull request's top warning block | The blocking review findings that were delivered anyway. |
| Commits named `factory: DEMO dropped …` or `(DEMO: … dropped)` | Stubs or test files that were removed. |

## Changing it

These rules apply to anyone changing demo mode, developer or agent:

- **Every relaxation reads `demoMode()`** from [src/util/demo.ts](../src/util/demo.ts). Never read `process.env.FACTORY_DEMO` anywhere else.
- **Keep the normal path as it is.** Put the demo branch beside it as `if (demoMode()) … else <normal>`, with a `// DEMO:` comment that says what it relaxes and which run showed the need.
- **Log what it let through** with `ctx.log("DEMO <step>: …")`, and name it on the pull request if it affects the delivered code.
- **Never relax the safety checks:** `lock-set`, `config-integrity`, `secret`, and the app not building or not starting. The implement and integrate branches filter them out explicitly; keep that filter.
- **To accept from a given try,** use `demoTry(ctx.ledger, step) >= demoAcceptFrom()` (or `>= ctx.policy.retryBudget` for "the last attempt"). Never use `ctx.attempt`, which counts pauses, parks and resumes too.
- **Keep it simple** (the team's rule): add a relaxation only when a recorded run stopped on that check in demo mode, and make it the smallest change that lets the run go on.
- **Tests:**
  - [src/util/demo.test.ts](../src/util/demo.test.ts) covers how tries are counted.
  - [src/estimate/build-waiver.test.ts](../src/estimate/build-waiver.test.ts) covers the integrate waiver with demo mode on and off.
  - A test that needs demo mode sets `process.env.FACTORY_DEMO = "1"` and puts the old value back in a `finally`.
- **Update this page** whenever you add, change or remove a relaxation.

## Removing it

Demo mode is meant to be easy to take out. Delete [src/util/demo.ts](../src/util/demo.ts), then remove every `demoMode()` branch: `grep -rn "DEMO" src` lists each one along with its comment. Each branch sits beside the normal path, which stays as it was.
