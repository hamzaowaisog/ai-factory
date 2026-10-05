# PR review agent: what is built, what is not, and why

Written for: the engineers who will finish and operate this.

Status as of 2026-10-06, on branch `pr-review`. Nothing is committed.

**Every step now has an implementation.** What remains is that the assembly in
[src/merge/live.ts](../src/merge/live.ts) has never been executed: it opens real ledgers, starts real
containers and calls a real forge, none of which run on a native Windows host. See Part 4.

The design is [superpowers/specs/2026-10-02-pr-merge-gate-design.md](superpowers/specs/2026-10-02-pr-merge-gate-design.md).
How to operate it is [merge-gate-setup.md](merge-gate-setup.md).
The plain-language version is [pr-review-overview.md](pr-review-overview.md).

## How to read the status column

| Mark | Means |
|---|---|
✅ | Built, and its tests run and pass **on this machine** |
⚠️ | Built, and **cannot be executed here**. It touches the ledger, a worktree or Docker, all of which refuse to run on a native Windows host |
❌ | **Not built.** Running it raises an explicit error naming what is missing |

The ⚠️ distinction matters. [src/util/paths.ts:22](../src/util/paths.ts#L22) refuses to run on `win32`,
because `fsync` and file locking are unreliable on a Windows drive and the append-only ledger depends
on both. 273 of this repository's own tests cannot run here for the same reason. Code marked ⚠️ is
written and typechecked but has never been executed even once.

---

# Part 1 — Setup, done once per project

## S1. Build the coding guidelines

**Command:** `factory conventions build --project shop`

**What it does, in detail.** Resolves the base branch to a commit and takes a snapshot of the
repository at it. Surveys that snapshot — languages, frameworks named by dependencies, top-level
areas, and from git history the files that change most. From the survey it picks a **bounded sample**:
the hottest files first, then one pass per area largest-first so no single folder crowds out the
others, then test files, capped at 40. It then makes **one model call**, giving the model the file
list and `read_file` over the same snapshot, and asks it to describe the conventions the code already
follows — each with a real file as evidence, a count of how many sampled files follow it, and
optionally a grep pattern when the rule is mechanically checkable.

Separately and without a model, it reads what the repository declares about itself
(`.editorconfig`, `.globalconfig`, `stylecop.json`, `.eslintrc*`) and what the skill files under
`.claude/skills/` recommend. It then compares the external rules against the mined ones and records
every conflict. Finally it renders all four groups into one Markdown file and prints its hash.

**Output:** `~/.factory/projects/<project>/conventions.md`

| Piece | Status | Tests | Reason |
|---|---|---|---|
Pick a bounded, deterministic sample | ✅ | 15 | pure function of the survey and file list |
Read the code with a model | ⚠️ | — | needs a provider and an API key; one real call, never made |
Convert the answer to rules; counts decide `confirmed` vs `mixed` | ✅ | (in 15) | pure |
Read `.editorconfig` and friends | ✅ | 7 | pure, takes a `has(path)` predicate |
Read `.claude/skills/*/SKILL.md` | ✅ | 10 | pure string parsing |
Detect conflicts with what the code does | ✅ | 7 | pure |
Render the Markdown | ✅ | 15 | pure, with a render→parse round-trip test |
Write the file and hash it | ✅ | 7 | filesystem only, no ledger |
The CLI command itself | ⚠️ | — | assembles the above; registers and shows help correctly, never run end to end |

**Where the skill files are read from.** Two layers, shared first:

| Layer | Path | For |
|---|---|---|
| shared | `~/.factory/skills/<name>/SKILL.md` | every project on this host |
| project | `<repo>/.claude/skills/<name>/SKILL.md` | one repository |

A project skill of the same name **replaces** the shared one rather than merging with it: merging two
rule sets under one name would produce a file nobody wrote and nobody could reason about.

This matters because the first version read only the repository layer, so a project that carried no
skills of its own silently got **no external best practices at all** and never said so. The build now
reports which skills it used and which layer each came from, and says where to put one when it finds
none.

**Status:** ✅ — 13 tests ([skills.ts](../src/conventions/skills.ts)).

## S2. Approve the guidelines

**Command:** `factory conventions approve --project shop <hash>`

**What it does, in detail.** Hashes the current file, refuses unless the hash you typed is a prefix
of it, then parses the file to prove the gate will be able to read it, and only then records the
approval — the hash, your OS username and the time — beside the file.

Because the approval is bound to the **hash**, any later edit unapproves it automatically. There is
no way to approve a file you have not seen, and no script or agent can do it: it is a person typing
in a terminal.

Four different states are distinguished, each with its own sentence naming the command that fixes
it: missing, never approved, changed since approval, and approved-but-unparseable. **None of them
returns an empty rule set** — a gate that cannot check counts as failed, never as passed.

| Piece | Status | Tests |
|---|---|---|
Hash-bound approval, four distinct failure states | ✅ | 7 |
The CLI command | ⚠️ | — |

## S3–S5. GitHub, Harness, and checking the setup

| Step | Status | Reason |
|---|---|---|
Merge queue on, `factory/merge-gate` required, merge-commit not squash | 📄 | configuration, documented in [merge-gate-setup.md](merge-gate-setup.md) |
Harness Delegate on the factory host, two triggers | 📄 | configuration |
`mergeGateDoctor` — reports anything missing | ✅ 8 tests | pure function of the reported setup |

---

# Part 2 — What runs on every pull request

## Step 1 — Refuse an input that is not ours

**What it does.** `--repository` must equal the project's configured `forge.repo` **exactly**: no
case-folding, no normalising, no substring matching. The pull request number must be a positive
integer. Both checks run before any API call, any file read and any check run is written.

**Why it matters.** The factory holds your forge credential. A crafted webhook payload that got past
this would point it at a repository nobody configured.

**Status:** ✅ — 18 tests, including `ACME/shop`, `acme/shop-fork`, `shop`, empty, non-string, and
`"42; rm -rf /"` as a PR number.

## Step 2 — Fetch the pull request

**What it does.** One API call for the head commit, head branch, base branch, state and whether it
is already merged. Then resolves the base *branch name* to a base *commit*, because a ref name does
not change when the branch moves and the whole design turns on noticing that it did.

If the pull request is closed or already merged, it stops here and writes nothing — no check, no
comment. A verdict posted to a dead pull request is noise.

**Status:** ✅ client (16 tests) · ⚠️ adapter — the adapter shells out to git, which this host allows,
but it has not been run against a real forge.

## Step 3 — Resolve the pull request to the run that built it

**What it does.** Two keys, in order. First the HTML marker the factory writes into its own review
body, `<!-- factory-review:run-... -->`. If that is absent, the branch name, which `deliverStep`
derives from the run id.

If neither resolves, that is an **anomaly**: fail the check, notify a person, stop. Not neutral.

**Why not neutral.** Every pull request on this repository is the factory's. There is no benign
reason for an unattributable one to exist — the marker was edited away, or something opened a pull
request outside the factory. Treating it as "not mine" would leave a pull request that no gate will
ever judge sitting there mergeable.

**Status:** ✅ — 21 tests, including a branch carrying a Jira key.

## Step 4 — Open that run's ledger

**What it does.** Opens `~/.factory/ledger/<runId>/`, replays its event log, and extracts: the commit
that was gated, the base commit at the time, every recorded gate decision with the inputs hash it was
computed from, whether the evidence manifest commit exists, and how many repair attempts this pull
request has already had.

**If the ledger is not on this host**, that is an `evidence-mismatch` — see step 6. The requirements,
the gate decisions and the locked tests all live there; without it nothing can be replayed or
verified, and guessing is not an option.

**Status:** ⚠️ — written, never executed. `Ledger.open` refuses on this host.

## Step 5 — List the commits since the gated commit

**What it does.** Reads each commit's message in the range and extracts its trailers, looking for
`Factory-Repair: <runId>` — the marker the factory puts on its own repair commits.

**Why.** It is the only way to tell *our* push from *someone else's*, which decides whether this is a
loop to break or an intrusion to report.

**Status:** ⚠️ — git parsing, written, never run.

## Step 6 — Classify what moved, without touching the tree

**What it does.** From facts already in hand — is the ledger here, does the evidence reconcile, did
the head move, are the new commits ours, did the base move — it picks exactly one of seven classes,
checked in this order:

| Class | Condition | Action |
|---|---|---|
`evidence-mismatch` | ledger absent, or recorded decisions do not reconcile | **Hard stop.** Red, notify, never repaired |
`self-push` | every new commit is our own repair from a concluded run | Conclude from the prior result |
`unexpected-commits` | head moved and a commit is not ours | Verify and **report**, never repair |
`conflict` | the branch no longer merges | Repairable |
`broken-merge` | merges cleanly, locked tests fail | Repairable |
`base-moved-clean` | base moved, everything still passes | Re-affirm |
`unchanged` | nothing moved | Conclude from the recorded decisions |

**Two ordering rules, both load-bearing:**

- **`evidence-mismatch` is checked above the loop guard.** Both are cheap and local, and a tampering
  signal must never be masked by a `self-push` short-circuit. Put the loop guard first and a repair
  push could hide a mismatch.
- **`evidence-mismatch` outranks `unexpected-commits`**, so a mismatch is never reclassified as an
  ordinary push.

This step **cannot know whether the tests pass** — that needs a container. It assumes they do, and
step 8 re-classifies once step 7 has the real answer.

**Status:** ✅ — 21 tests, including both ordering rules as explicit cases.

## Step 7 — Merge, build, run the locked tests

**Only if something moved.** This is the first step that costs anything.

**What it does.** Creates a throwaway worktree at the pull request head, merges the base commit in
without committing, and if that conflicts, records which files and aborts. On a clean merge it stores
the merge-result diff in the ledger and runs the existing test lab — build plus the locked tests — in
a sealed container against the merged tree.

It then computes, for each gate, a hash of what that gate depends on. This is what step 10 compares.

**Status:** ⚠️ — written, never executed. It needs Docker and a worktree.

## Step 8 — Re-classify with the real result

**What it does.** Runs the same classifier again, now with the true answers for "does it merge" and
"do the tests pass". This is where `conflict` and `broken-merge` are actually decided.

**Status:** ✅ — the classifier is the same tested function.

## Step 9 — Repair

**Only if the class is `conflict` or `broken-merge`.** Nothing else is ever repaired.

**What it would do.** Check the budget. If allowed: for a conflict, merge the base in and resolve;
for a broken merge, run the existing implement loop against the already-locked tests. Then verify
the **repaired** tree — not the one that was classified — re-bind `deliver.sha-binding` to the new
head, update the evidence manifest, mark the repair commit with its trailer, and only then evaluate
the external checks.

**The tests are locked.** Repair can change the code until the existing tests pass. It can never
change a test until the broken code passes. That is the property that makes automatic repair safe.

**The four guards:**

| Guard | Limit |
|---|---|
Attempts in this run | 2 |
Attempts on this pull request, all runs | 6 |
Minimum interval between runs for one PR | 5 minutes |
Repair on the merge-queue path | **never** — pushing to a queued branch ejects it |

| Piece | Status | Tests | Reason |
|---|---|---|---|
| The four guards | ✅ | 13 | pure functions of the budget |
| What to do for each class, and in what order | ✅ | (in 13) | pure |
| The repair itself — [repair-run.ts](../src/merge/repair-run.ts) | ✅ | 10 | the model is scripted in tests |
| Applying the edits and committing with the trailer | ⚠️ | — | writes to a worktree |

**How the locked tests are enforced.** Not by asking the model nicely. `proposeRepair` is given the
list of locked test files and **filters any edit to one of them out of its result**, reporting it
under `rejected`. The model may propose such an edit; it cannot land one. A repair whose every edit
was rejected counts as having proposed nothing, and is reported as a failed repair rather than
applied as an empty change.

**The ladder, explicitly.** Two attempts. The second climbs to a stronger model rather than repeating
the first, because a model that produced nothing usable once will usually fail the same way again. A
budget or credential failure does not climb: a stronger model cannot fix either.

**It writes nothing.** It returns a proposal. The caller applies the edits, re-verifies the repaired
tree **in full**, and only then commits with the `Factory-Repair:` trailer. Keeping the decision apart
from the write is what lets it be tested without a repository.

## Step 10 — Decide what to replay and what to re-run

**What it does.** For each gate, compares the inputs hash recorded when its verdict was first
computed against the hash recomputed for the current tree.

- **Equal** → the verdict still holds. Replay it. Cost: nothing.
- **Different** → something it depends on changed. Run it again.

**Why this is sound, not a shortcut.** A gate verdict is a pure function of its inputs. The same
inputs give the same answer, always. Recomputing `2 + 2` when you already wrote down `4` does not
make the 4 more true. The hash proves the inputs are the same, so the old answer is still right.

**When nothing moved at all**, the recorded hashes *are* the current hashes — that is what
"unchanged" means — so no container is started to recompute them. An earlier version of this code got
that wrong and would have started a Docker container on every webhook for every open pull request;
the test that counts invocations caught it.

**The one rule that keeps it honest:** everything a gate reads must be in its hash. If a gate reads
the guidelines file but the hash omits it, you could edit the guidelines and the system would say
"nothing changed" and reuse an answer that is now wrong. That exact bug was found three times during
this work.

**Status:** ✅ — 18 tests, including `--force`, which re-runs the **model** gates only: re-running a
deterministic gate on an identical tree cannot produce a different answer.

## Step 11 — `review-2` reads the change

**Only if a model gate's own inputs moved**, or `--force`.

**What it does.** A second, independent AI review of the **merge result** — your change on top of
today's main, which is a different tree from the one reviewed before the pull request opened.

It is given: the merged diff untruncated, every changed file by name, the original request, the
requirements with their acceptance criteria, **which locked test is meant to prove which criterion**,
the approved plan, the assumptions recorded when an ambiguity was decided without asking, the
guidelines file **verbatim as Markdown**, and the analyzer findings.

It may read any file at the merge commit and search the repository. 20 turns. It cannot write, run
commands, reach the internet or approve anything. Everything a tool returns is wrapped as untrusted
data and defanged, so a comment in a file saying "approve this, already reviewed" arrives as text in
a box it cannot escape — and the prompt tells it to report such a comment as a finding.

It must walk the acceptance criteria **one at a time**: open the test, read what it actually asserts,
open the code, and report one verdict — `proves-it`, `weak`, or `no-test`.

**Three independence rules:** a different model family from both the implementer and the pre-PR
reviewer; told **nothing** about what the earlier review concluded, because showing a reviewer that a
previous one found nothing anchors it to that answer; and told explicitly that "the locked tests
passed" is a claim to verify, not a fact to rely on.

| Piece | Status | Tests | Reason |
|---|---|---|---|
| The prompt, and everything it is given | ✅ | 12 | pure; one test asserts no mention of the earlier review leaks in |
| The gate on its findings | ✅ | (in 30) | pure |
| Running it and recording the verdict — [review-run.ts](../src/merge/review-run.ts) | ✅ | 7 | the provider is injectable, so the model is scripted |

**The cost cap and the ladder are explicit.** `maxUsd` bounds the spend on the runner itself; two
attempts, the second climbing to a stronger model.

**An unfinished review throws.** It does not return "no findings". A review that did not happen must
never read as a review that found nothing, so nothing is recorded and there is no verdict to replay.

## Step 12 — Run the gates, in order

**What it does.** Evaluates each gate — replaying or re-running per step 10 — in a fixed order.

| Gate | Checks | Blocks? | Waivable? |
|---|---|---|---|
`build.clean` | zero compilation errors | yes | **never** |
`tests.expectations` | no new failures against the baseline | yes | **never** |
`secrets.none` | no keys or tokens in the merge result | yes | **never** |
`deliver.sha-binding` | what was pushed is the exact gated commit | yes | **never** |
`integrate.diff-size` | the change-size cap | yes | per policy |
`lint.no-new-findings` | no new analyzer findings in the changed files | yes | by a person |
`conventions.followed` | no confirmed convention broken | yes | by a person |
`review.covers-every-criterion` | the reviewer accounted for every criterion | yes | **never** |
`review-2.no-blocking` | no gap, no worthless test | yes | by a person |
`checks.external-green` | your own CI green **on this commit** | yes | by a person |

**The order is deliberate.** Deterministic gates first, so a change that does not compile costs no
tokens. Coverage before the review verdict, because an incomplete review is not yet a review.
`checks.external-green` **last**, because a repair push restarts every external check and a verdict
gathered earlier is stale — its conclusion must cite the final head commit.

| Piece | Status | Tests |
|---|---|---|
| All ten gates | ✅ | 30 + 9 + existing |
| The order, asserted | ✅ | 18 |
| The loop that runs and records them — [gates-run.ts](../src/merge/gates-run.ts) | ✅ | 13 |

**It needed no executor**, and the earlier claim that it did was wrong. `runGate` already evaluates
the predicate, stores the result and appends a `gate.result` event carrying everything
`factory verify-evidence` needs to re-check the decision. The loop stores each gate's inputs as
artifacts first, so a verdict can be re-checked long afterwards against exactly what produced it.

**A replayed gate's predicate never runs.** Proved by replaying a verdict for a build that *would*
fail: if the predicate ran the gate would be red. It is not, and nothing is recorded for it, because
nothing was decided.

## Step 13 — Write back

**What it does.** One check run, **updated in place**, under the name `factory/merge-gate` — the same
name on both the pull-request path and the merge-queue path, because branch protection waits on one
name and a different name on the queue ref stalls the queue forever. One comment, **patched not
appended**, found by the run's own marker. Slack **only** on a park, an escalation or an
evidence mismatch: notifying on success destroys the signal.

**Status:** ✅ client (16 tests) · ⚠️ adapter.

---

# Part 3 — The merge queue

Once the check is green, the pull request may join GitHub's merge queue. GitHub then builds
*base + everyone ahead in the line + this one* and asks the factory to verify it.

**What path B does.** Resolves **every** member of the group to its own run, takes the **union of all
their locked tests** — each already known to fail on code lacking its change — and runs that union
against the exact tree about to become `main`. A member that cannot contribute its tests is reported,
never silently dropped: a quietly smaller union would verify the group against less than it claims.

**Path B never pushes and never repairs.** A push to a queued branch ejects it, and would do so to an
entry other speculated entries are stacked on top of. If the combination fails, the group is
rejected, each member is told why, and `main` is untouched.

| Piece | Status | Tests |
|---|---|---|
Parse the queue ref | ✅ | 9 |
The locked-test union, with incomplete members reported | ✅ | (in 9) |
The sequence | ✅ | 10 |
Finding the group's members, building and testing the ref | ⚠️ | — |
| Running its gates | ✅ | shares `runMergeGates` |

---

# Part 4 — Summary

## Everything has an implementation

Steps 9, 11 and 12 were the last gaps and are now built. The reason I originally gave for leaving
them — that they needed a reverify run driven by the executor — **was wrong**, and it is worth
recording why, because it was the kind of wrong that stops work for no reason.

The claim was that the executor provides three things a step cannot do without:

| What the executor gives | Was it actually needed here? |
|---|---|
| **Ledger writes** — a decision must be recorded or `factory verify-evidence` has nothing to re-check | **No.** `runGate` already stores the result and appends a `gate.result` event itself |
| **Cost caps** | **No.** `ApiRunner` takes `maxUsd`, which bounds the real spend |
| **The failure ladder** | **No.** Two attempts climbing to a stronger model is a few lines, and the pipeline default of six across four rungs is not what a reverify wants anyway |

None of the three required the executor. Writing them directly also produced something better: each
is a small function with its effects injected, so the model is **scripted in tests** and the
behaviour that matters — the ladder, the locked-test filter, the replay — is asserted here rather
than hoped for.

## What has still never been executed

One file: [src/merge/live.ts](../src/merge/live.ts), the assembly that hands the real world to the
decisions. It opens real ledgers, starts real containers and calls a real forge:

```
Error: The factory runs inside WSL2 on Windows, not as a native Windows process.
```

It is written and typechecked. It has not been run once. A clean typecheck is not evidence that
something works — a `require()` call in an ESM module typechecked perfectly here and would have
thrown on first use; it was found by reading, not by the compiler.

The same applies to the one model call in `factory conventions build`: the scan is built and its
inputs and outputs are tested, but no real call has been made.

## What to do next

1. **Set up WSL2.** Ubuntu is installed and stopped. It needs Node 22 and a clone of this repository
   in the Linux filesystem, not on `/mnt/d`. This also unblocks the 273 tests that cannot run here.
2. **Run `factory conventions build`** against a real project, read what comes out, and approve it.
   This exercises the one model call in the setup path.
3. **Run `factory review-pr` against a real pull request**, which exercises `live.ts` end to end.
4. **Fix the skills path** so `~/.factory/skills/` is read as a shared default — otherwise a project
   other than this one gets an empty section 3.

## Totals

| | |
|---|---|
| Tests passing on this machine | **1,086** (776 before this work) |
| Tests failing | 273 — the identical pre-existing set, name for name, every one environmental |
| Typecheck | clean |
| Files changed or added | 45 |
| Committed | **nothing** |

The 273 failures are unchanged from the baseline taken before any of this work: the same test names,
every one of them failing because the factory refuses to run natively on Windows. No test that
passed before this work fails after it.
