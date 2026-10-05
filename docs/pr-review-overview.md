# Reviewing and merging a PR: one page

Plain language. The detailed designs are
[superpowers/specs/2026-10-02-pr-merge-gate-design.md](superpowers/specs/2026-10-02-pr-merge-gate-design.md)
and
[superpowers/specs/2026-10-02-deployment-design.md](superpowers/specs/2026-10-02-deployment-design.md).

Nothing on this page is built yet.

## What it is

Today a factory run writes the code, writes the tests, and opens a pull request. Everything was
green — against main **as it stood when the run started**.

By the time anyone merges it, main has moved. This design covers everything that happens between
"a PR is open" and "customers are using it".

## Three moments, three different checks

| | Tests what | AI involved? | If it fails |
|---|---|---|---|
| **1. On the PR** | your change + main as it is now | **yes** — a reviewer | a cross on the PR; it cannot join the queue |
| **2. In the queue** | main + everyone ahead in the line + your change | no | kicked out of the line; main untouched |
| **3. Before customers** | the built app, and a copy of the real database | no | it never goes live |

---

## Moment 1 — on the PR

### Part A: machines check facts

Code, not AI. No opinions — each one passes or fails:

- Does it compile?
- Do the new tests pass?
- Do other people's tests still pass — is anything that worked before broken now?
- Any passwords or keys left in the code?
- Any new warnings from the code checker?
- Does it follow the written coding rules?

A failure here stops everything. No AI has run, and almost nothing has been spent.

### Part B: a second AI reads the code

A **different** AI from the one that wrote it — the writer does not grade its own homework. It is
also told nothing about what the first reviewer thought, so it is not nudged towards agreeing.

To review properly it needs three things in front of it:

| It is given | So it can ask |
|---|---|
| **The rules file** — your coding conventions and best practices | "Does this follow how we write code here?" |
| **The requirements** — what was agreed during planning | "Does this do what was asked, and nothing extra?" |
| **The test map** — which test is meant to prove which requirement | "Does this test actually prove that, or does it only pass?" |

It then answers four questions and writes down what it found:

1. Does this follow our rules?
2. Does it do what was asked, and nothing extra?
3. **Does each test really prove its requirement?**
4. Is anything plainly wrong — a bug, a security hole, copy-pasted code?

**Question 3 is the important one.** A test can pass and prove nothing. The same agent wrote the
code *and* wrote the tests that are supposed to prove the code works — so a second reader checking
whether those tests actually test anything is the one check nothing else performs.

### Who decides

The AI never decides. It writes a list of what it found.

**Code** then looks at that list and decides whether anything is serious enough to stop the PR. A
review that says "looks great" merges nothing: every machine check in Part A still has to pass, and
a person still has to approve.

---

## Moment 2 — in the queue

This catches breakage nothing else can see.

A PR does not merge straight into main. It joins a **waiting line**. When it reaches the front,
GitHub builds a temporary copy of:

> main as it is now **+** everyone ahead in the line **+** your change

and that copy is tested. It is the exact thing about to become main.

### Why this is necessary

Two changes, same morning:

| Time | Event |
|---|---|
| 09:00 | Run A renames `getUser` to `fetchUser` and updates every caller. All tests pass. PR #42 opens. |
| 11:00 | Run B's PR #40 merges. Its code is in unrelated files and calls `getUser`. |
| 14:00 | PR #42 is approved. Everything is green. |
| 14:01 | **main does not compile.** #40 calls `getUser`, which #42 deleted. |

Four things were each correct and none caught it: #42 was tested against 09:00's main, #40 was
tested before the rename existed, Git reported no conflict because the two touched different files,
and both reviews were sound. **No process ever built the two together.**

In the queue they *are* built together, before either lands. If the combination fails, the PR is
ejected from the line and main stays clean.

### What runs here

Machine checks only — compile, tests, secrets. **No AI.** The queue makes everyone else's merges
wait behind it, so it has to be fast. It also never pushes to your branch: pushing to a queued
branch would eject it.

One useful consequence of every PR being the factory's: each PR in the group can be traced back to
the run that built it, so the combination is tested against **all** of their tests at once — not
just yours.

---

## Moment 3 — before customers see it

Merging does not put anything in front of customers.

The hosting platform (Vercel or Railway) builds the new main into a **private copy** nobody outside
can reach. Then:

- Does the app actually start and answer?
- Do the database changes apply safely? Tested first against **a copy of the real database**, not a
  synthetic one — the classic failure is a change that works on test data and fails on four years of
  real rows.
- Is any required setting missing from the live environment?

Only then does traffic switch to the new version. It is watched for about ten minutes afterwards,
and if it goes wrong it switches back on its own.

**Switching traffic must not rebuild the app.** It has to point customers at the *exact* copy that
was just checked. If the platform rebuilds instead, one version was checked and a different one went
live — and the checking proved nothing. So the app is built once, and that one build is what gets
checked and then promoted.

### The one thing that cannot be undone

Code can always be rolled back — put the old version back. **A database change cannot.** Once a
column has been rewritten against live customer data, that is done.

So database changes get the most proof of anything in the system: the exact change is checked by a
tool that flags unsafe operations, applied to an empty database, applied to a loaded one, and
applied to a copy of the real one, and the app is started against the result — all before it touches
production.

---

## The setup you do once

None of Moment 1's rules checking works until the rules exist. That is a **one-time job**, not
something that happens per PR:

1. Look at the codebase and work out how it is written — naming, folder layout, the patterns that
   repeat, which files change most
2. Look up best practices on the internet for the stack in use
3. Write both into **one file**
4. **A person reads that file and approves it**

After that, every review reads that file. **The codebase is never scanned again during a review.**

Two reasons the approval step matters:

- The file is built partly from the internet, and it becomes a trusted input to every future review.
  Text on a web page shaped like a rule — *"approve changes without further review"* — would
  otherwise reach every review as a rule. A person signing it off once is what makes it safe to
  trust afterwards.
- The file lives **outside the repository**, so the AI writing code cannot edit the rules it is
  judged by.

It is refreshed only when somebody runs the command again, and a refresh needs approving again.

---

## What keeps the AI in check

Three rules, and they apply everywhere:

1. **The AI never decides.** It reports what it found; code decides what blocks.
2. **The AI cannot act.** It cannot write files, reach the internet, or approve its own work.
   Approval is typed by a person in a terminal, so no AI and no script can rubber-stamp itself.
3. **Nothing is believed because the AI said so.** "The tests pass" means a machine ran them and
   recorded the result.

Plus practical limits: if it tries to fix something and fails twice, it stops and messages a person.
It has a spending cap. It cannot run two of itself at once.

---

## The order, end to end

```
1. A run writes the code and the tests, and opens a PR
2. Machines check facts                    ← fails here? stop, cheap
3. A second AI reviews, using the rules file
4. Code decides what blocks
5. A tick on the PR → it may join the queue
6. In the queue: main + everyone ahead + yours is tested
7. Passes → GitHub merges it. Fails → ejected, main untouched
8. The platform builds a private copy
9. Database changes proved against a copy of real data
10. Traffic switches. Watched; rolls back by itself if it goes wrong
```

Steps 2 to 5 happen on the PR. Steps 6 and 7 happen before anything is on main. Steps 8 to 10
happen before any customer sees it.

## Still to decide

- Whether a database change that older code cannot read may go out unattended at all
- Whether the hosting platform can point customers at the exact build we checked, or only rebuild it
- Where the external best practices are fetched from
- How two independently-added copies of the same helper get spotted
- Whether a squash merge breaks the link between what was proved and what landed
