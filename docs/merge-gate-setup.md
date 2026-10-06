# Running the PR review agent: setup and operation

What to configure once, and what happens afterwards on every pull request.

The design is [superpowers/specs/2026-10-02-pr-merge-gate-design.md](superpowers/specs/2026-10-02-pr-merge-gate-design.md).
The plain-language version is [pr-review-overview.md](pr-review-overview.md).

## Before you start

The factory runs **inside WSL2 on Windows**, never as a native Windows process: `fsync` and file
locking are unreliable on a Windows drive, and the ledger depends on both. `factory doctor` checks
this. Everything below assumes an Ubuntu shell with the repository in the Linux filesystem.

---

## Step 1 — Build the coding guidelines

Once per project, by hand. Nothing triggers it, and no review ever rebuilds it.

```bash
factory conventions build --project shop
```

It reads a bounded sample of your code with a model — the most-changed files plus a spread across
your main folders, capped at 40 — and writes one Markdown file:

```
~/.factory/projects/shop/conventions.md
```

Four sections:

| Section | Where the rules come from | Can block a merge? |
|---|---|---|
1. What this repository already does | mined from your code, with counts | **yes**, when confirmed *and* machine-checkable |
2. What this repository declares | `.editorconfig`, `stylecop.json`, `.eslintrc*` | **yes** |
3. External best practices | skill files, shared or per-project (below) | **never** |
4. Conflicts | where 3 disagrees with 1 | read before approving |

**It lives outside the repository on purpose.** A pull request must not be able to edit the rules it
is judged by — the same reason `protected.ts` already guards `.editorconfig`.

### Where the skill files go

| Put a skill here | And |
|---|---|
| `~/.factory/skills/<name>/SKILL.md` | every project on this host picks it up |
| `<repo>/.claude/skills/<name>/SKILL.md` | only that repository does, and it **replaces** a shared skill of the same name |

Shared is usually what you want: install `dotnet-best-practices` once and every .NET project gets it.
Use the project layer when one repository genuinely disagrees — a Node service has no use for the
.NET rules.

If neither directory has anything, the build says so and section 3 comes out empty. It does not fail:
external best practices are advisory and can never block a merge.

## Step 2 — Read it, then approve it

```bash
factory conventions show --project shop        # or just open the file
factory conventions approve --project shop 7f3a9c2b
```

Read **section 4 first.** It lists every place an external rule disagrees with what your code
actually does — for example a skill recommending MSTest when your tests use xUnit. Your repository
wins, and the external rule stays advisory, but you should see it rather than discover it later
through a reviewer reporting correct code as a violation.

You can edit the file by hand: fix a sentence, delete a rule you disagree with. Editing changes its
hash, which unapproves it, so approve again.

**Until it is approved, `conventions.followed` fails.** Not passes, not skips — a gate that cannot
check counts as failed.

## Step 3 — Configure GitHub

| Setting | Where | Why |
|---|---|---|
Require a merge queue on the base branch | Settings → Branches → branch protection | Nothing else verifies the *combination* of pull requests about to land |
Add `factory/merge-gate` as a required status check | same page | Without it, nothing stops a pull request merging ungated |
Merge method: **merge commit**, not squash | same page | A squash rewrites the commit the factory gated, so what lands is not what the evidence describes |
Token scopes: `checks:write`, `pull_requests:write`, `contents:write` | the token in `~/.factory/.env` | Writing the check run, the comment, and repair commits |

**Order matters.** Approve the guidelines (step 2) *before* making the check required, or every pull
request goes red until you do.

## Step 4 — Configure Harness

Install a Delegate on the factory host — the machine where `~/.factory`, your repository clones and
Docker already are. Harness Cloud cannot reach that host, and the design requires that no credential
leaves it.

Two triggers, both passing their webhook inputs straight through:

```yaml
# pull_request: opened, synchronize, reopened
factory review-pr <+trigger.pr.number> \
  --project shop --repository <+trigger.repo.name> --json

# merge_group
factory verify-merge-group <+trigger.ref> \
  --project shop --repository <+trigger.repo.name> --json
```

Pass them unvalidated. The factory validates them itself: `--repository` must equal the configured
`forge.repo` **exactly** — no case-folding, no substring matching — and the pull request number must
be a positive integer. Without that, a crafted webhook payload would aim the factory, holding your
forge credential, at a repository nobody configured.

## Step 5 — Check the setup

```bash
factory doctor --project shop
```

It reports anything missing: the check name absent from branch protection, the merge queue off, no
Delegate on the host, unapproved guidelines, or a squash merge method.

---

## What happens on every pull request afterwards

| # | Step | Cost |
|---|---|---|
1 | Refuse unless `--repository` matches exactly | free |
2 | Fetch the pull request | 1 API call |
3 | Resolve it to the run that built it — review marker, else branch name | 1 API call |
4 | Open that run's ledger | disk |
5 | List commits since the gated commit | disk |
6 | **Classify what moved** | free |
7 | *Only if something moved:* merge the base in, build, run the locked tests | a container |
8 | Re-classify with the merge result | free |
9 | *Only if repairable:* repair, then verify the **repaired** tree | a container |
10 | Compare every gate's recorded inputs hash against the current one | free |
11 | *Only if a review's own inputs moved:* `review-2` reads the code | tokens |
12 | Run the gates, in order | free |
13 | Write back one check run and one comment; Slack only on failure | 2 API calls |

A pull request whose tree has not moved reaches step 13 having spent **nothing**: every gate verdict
is replayed because its inputs hash is unchanged, which means the answer cannot have changed either.

Two classes finish at step 6:

- **`evidence-mismatch`** — the ledger is missing, or the recorded decisions do not reconcile with
  the branch. Red check, Slack, stop. Never repaired: replaying verdicts whose provenance is no
  longer trustworthy is worse than refusing.
- **`self-push`** — the only new commits are the factory's own repair commits from a run that
  already concluded. Reuse that conclusion. This is the loop guard; without it, our own push
  triggers the webhook, which repairs, which pushes again.

## Repair

Only two classes are repairable: a **textual conflict**, and a **clean merge whose locked tests
fail**.

**The tests are locked.** Repair can change the code until the existing tests pass; it can never
change a test until the broken code passes.

| Limit | Value |
|---|---|
Attempts per run | 2 |
Attempts per pull request, across all runs | 6 |
Minimum interval between runs for one pull request | 5 minutes |
Repair on the merge-queue path | **never** — pushing to a queued branch ejects it |

Past any of those: park, red check, Slack, wait for a person. `main` is untouched throughout.

## Forcing a re-review

```bash
factory review-pr 42 --project shop --repository acme/shop --force
```

Re-runs the **model reviews** on one pull request, ignoring the saved result. Deterministic gates are
not re-run: on an identical tree they cannot produce a different answer.

Terminal only. A trigger that could set it would reintroduce the spend loop.

---

## Before you switch it on

Every step is implemented. One file has never been executed:
[src/merge/live.ts](../src/merge/live.ts), which hands the real world to the decisions — it opens
real ledgers, starts real containers and calls a real forge, none of which run on a native Windows
host. It is written and typechecked; a clean typecheck is not evidence that something runs.

So exercise it in this order, under WSL2, before pointing a trigger at it:

1. `factory doctor --project <p>` — the setup itself.
2. `factory conventions build --project <p>` — this makes the one model call in the setup path, and
   is the cheapest way to prove the provider, the key and the snapshot all work.
3. `factory conventions approve --project <p> <hash>`.
4. `factory review-pr <n> --project <p> --repository <owner/name>` against a **real but
   unimportant** pull request. This is the first time `live.ts` runs end to end: the ledger is
   opened, a worktree is merged, a container starts, the reviewer is called and a check run is
   written. Expect to fix things here.
5. Only then add the Harness triggers.

Nothing in that list can damage `main`: every path either writes a check run or refuses. The failure
you are looking for is the opposite one — a step that quietly does nothing and reports green.
