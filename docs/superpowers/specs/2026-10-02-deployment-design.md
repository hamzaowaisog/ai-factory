# Deployment: promoting a verified main to production

Status: design, awaiting review. Date: 2026-10-02.

Follows [2026-10-02-pr-merge-gate-design.md](2026-10-02-pr-merge-gate-design.md), which ends at the
moment a verified commit lands on `main`. This spec starts there.

**The deploy run makes no model calls.** Not one step. It reads a classification computed earlier,
checks health, migrates, promotes or rolls back. Production credentials therefore never enter a
context window, and "the core never calls a model" holds unchanged. **If any step here appears to
need a model, the design is wrong.** This is the property that makes the rest safe, so it is stated
first.

## The problem

A verified commit is on `main`. Nothing has reached customers. Three things are missing between
those two facts:

1. **Nobody has run this code against production data.** Every verification so far used a throwaway
   Postgres with synthetic rows.
2. **The schema change has not been applied.** It is the only irreversible step in the entire
   system — code rollback is a redeploy, a migration that rewrote live rows is not.
3. **Production configuration may be incomplete.** New code can require an environment variable
   nobody has set, which no amount of pre-merge testing catches.

## Decisions taken

| Decision | Choice |
|---|---|
| Who builds | Vercel / Railway, from their own Git integration. The factory builds nothing. |
| Shape | Platform deploys `main` to **preview**; the factory **promotes** to production |
| Human in the promotion path | **None.** Automatic once every check passes |
| Migration proof | Wire up `MigrationRun` (squawk, applies-on-empty, applies-on-seeded, no EF drift) **plus** a replay against a restored production snapshot |
| Rollback | Classify schema backwards-compatibility; auto-rollback when compatible, forward-fix when not |
| Structure | A `deploy` mode as a child run, triggered by a push to `main` |
| Model calls | Zero |
| Production config | Lives **on the platform**. The factory never holds a value — only gates on completeness by name |
| What runs against production | A **generated, linted SQL script** — never arbitrary migration code |
| What ships | The **exact artifact that was health-checked**. Promotion re-points traffic; it never rebuilds |

## Architecture

```
GitHub: push to main (one or more PRs merged out of the queue)
  └─ Harness trigger (inputs: ref, repository, commit sha)
      └─ Delegate on the factory host
          └─ factory deploy --project <p> --json
               ├─ coalesce: is a deploy already in flight?
               ├─ resolve: which runs does this main contain?
               ├─ deploy run (new mode, child of those runs)
               └─ writes: ledger · Slack · platform APIs
```

Same Harness Delegate bridge as the merge gate, for the same reason: the work needs Docker, a repo
clone, and credentials that must not leave the host.

### The sequence

| Step | What happens | Touches production? |
|---|---|---|
| `observe-preview` | The platform already built this commit. Poll its deployment status, bounded, until ready or failed. | no |
| `env-audit` | Read the environment-variable **names** the new code requires and compare with the names configured on the target. Gate `deploy.env-complete`. | reads names only |
| `migration-script` | Generate an idempotent SQL script from the repo's migrations. This script, not arbitrary code, is what will run. | no |
| `migration-proof` | Produce `MigrationRun`: squawk-lint the script, apply to an empty database, apply to a seeded one, assert no pending model changes — **and** apply to a restored production snapshot, then boot the app against it. | no (a copy) |
| `schema-compat` | Classify from the squawk findings whether the **previous** code version still runs against the new schema. Recorded **before** anything changes. | no |
| `migrate-prod` | Apply the script to production. **The only irreversible step.** | **yes** |
| `promote` | Point production traffic at the already-built preview deployment. | **yes** |
| `watch` | Bounded health window: readiness plus error rate, not a single 200. | observes |
| `settle` / `recover` | Healthy ⇒ record and finish. Unhealthy ⇒ roll back if `schema-compat` permits, otherwise hold, alert, and start a forward-fix run. | maybe |

### Why `migrate-prod` precedes `promote`

New code generally needs the new schema, so the migration goes first. That creates a window in which
production is running the **old** code against the **new** schema.

That window is only survivable when the migration is additive — which is exactly what
`schema-compat` establishes, before the migration runs. See "The incompatible-migration problem"
under Open questions: it is a direct consequence of two of the decisions above and needs settling.

### A deploy covers several runs

The merge queue batches. One push to `main` can carry three PRs, so a deploy's parent is a **set**
of runs:

```ts
parent: { kind: "deploy", runIds: string[], commit: GitSha }
```

Resolution: walk the commits new to `main` since the last recorded successful deploy, recover each
PR number from the merge commits, and resolve each to its run through the marker and branch-name
keys the merge gate already defines. Every PR is the factory's (that spec's precondition), so every
member resolves — if one does not, that is an anomaly and the deploy stops.

This also shapes recovery: "which of the three changes broke it" is not answerable automatically, so
a forward-fix escalation names all of them.

### Coalescing, and the lock

Three PRs landing within a minute must not start three deploys.

- **The unit of deployment is the current head of `main`**, never an individual commit.
- A debounce window (`coalesceSec`, default 90) collapses a burst into one run.
- A deploy already in flight either absorbs the newer commit before `migrate-prod`, or queues
  **exactly one** successor. Never more, and never concurrently.
- `ExecutionLock` ([src/ledger/exec-lock.ts](../../../src/ledger/exec-lock.ts)) provides this, scoped
  **per project and environment** rather than per run.

Two concurrent `migrate-prod` steps against one database is the worst failure mode in this design.
The lock is not an optimisation.

## Running a script, not migration code

`dotnet ef database update` executes arbitrary C#. Linting it proves nothing, because the thing
linted is not the thing that runs.

So the deploy generates an **idempotent SQL script** from the migrations, and that script is:

1. what squawk lints,
2. what is applied to the empty, seeded and snapshot databases,
3. what `schema-compat` is classified from,
4. what is applied to production — byte-identical, hashed, and recorded in the ledger.

This is what makes the migration gate meaningful: what was proved is what runs. A mismatch between
the proved script's hash and the applied script's hash fails `migrate-prod` outright.

### Where the migration runs

Not on the host. In a container, following existing practice, with a deliberately minimal grant:

- **only** the production database credential, resolved from `~/.factory/.env` by name;
- no model API access, no forge token, no other secret;
- egress restricted to the database host alone, through the existing proxy pattern
  ([docker/proxy/proxy.mjs](../../../docker/proxy/proxy.mjs));
- the container is removed afterwards.

This is a real widening of the safety model and should be read as one: until now, repo-derived
artifacts only ever ran against a throwaway database with no network. The mitigations are that the
artifact is a reviewed SQL script rather than code, its content was proved beforehand, and the
credential is the only secret present.

## Schema compatibility classification

Derived from squawk's findings on the generated script.

| Verdict | Operations | Consequence |
|---|---|---|
| `additive` | `CREATE TABLE`, nullable `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID`, new enum values | Old code still runs. The fully automatic path, and auto-rollback is permitted. |
| `incompatible` | `DROP COLUMN`, `DROP TABLE`, `RENAME`, narrowing `ALTER TYPE`, `SET NOT NULL` on an existing column, dropping a constraint old code relies on | Old code may break against the new schema. Rollback is unsafe, and whether it may deploy unattended at all is Open question 1. |

A script is `additive` only when **every** operation is additive. Unrecognised operations classify as
`incompatible` — a gate that cannot classify has failed, consistent with the rest of the system.

New contract:

```ts
SchemaCompat = {
  verdict: "additive" | "incompatible",
  scriptSha: Sha,
  operations: { op: string, object: string, additive: boolean, rule?: string }[],
}
```

Recorded before `migrate-prod`, so the recovery path is known in advance rather than chosen during an
incident.

## Production configuration

**Values live on the platform. The factory never holds one.**

Vercel and Railway are already configuration stores with per-environment scoping, encryption and
audit trails. Duplicating that in `~/.factory/.env` would mean the factory holding every production
secret for every project, which is strictly worse.

What the factory does instead is close the gap this leaves: new code that requires a variable nobody
set will deploy and fail at runtime, and no pre-merge test catches it.

`env-audit` therefore compares **names only**:

- **Required**, read from the repo: `appsettings*.json` keys bound to configuration, `.env.example`,
  and `IConfiguration` lookups where statically resolvable.
- **Present**, read from the platform's API, which returns variable *names* without values.
- Gate `deploy.env-complete` fails on any name required but absent.

No value is read, logged, or recorded. The audit stores names and a verdict. New contract:

```ts
EnvAudit = { target: string, required: string[], present: string[], missing: string[] }
```

Static analysis will not find every dynamic lookup, so this gate reduces a class of failure rather
than eliminating it. It is honest about that: it never claims configuration is *correct*, only that
nothing it could identify is *missing*.

## The production snapshot

Required by the migration decision, and the one piece of genuinely new infrastructure.

- A per-project command produces a restorable dump — preferably from the platform's existing managed
  backup, **not** by dumping the live primary, which takes locks on a production database.
- It is restored into a throwaway Postgres container, the same pattern the test lab already uses.
- The generated script is applied, then the app is booted against the result, reusing the existing
  boot-and-probe approach ([src/verify/dotnet.ts](../../../src/verify/dotnet.ts)).
- `snapshot.maxAgeHours` (default 24) bounds staleness; too old fails the gate rather than passing
  quietly.

**This container holds real production data.** Therefore: it is ephemeral and removed on every exit
path including failure; nothing from it is written to the ledger except the verdict; no row, column
value or error string containing data is recorded; and it is never packed, never summarised, never
shown to a model. The zero-model-calls property is what makes that last guarantee structural rather
than procedural.

## Promotion must not rebuild

A **preview** is a complete, running copy of the application, built from one commit, reachable at
its own URL, and not the one customers use. It splits one event into two — "built and running" and
"customers can see it" — and the gap between them is where every check in this spec happens.

That only means anything if **promotion re-points traffic at the build that was checked.** If
promotion rebuilds from source, one artifact was verified and a different one shipped, and the
exercise is theatre. It is the same principle this spec already applies to the migration script:
*what was proved is what runs.*

### The two platforms do not mean the same thing by "preview"

| | Vercel | Railway |
|---|---|---|
| A preview is | an **immutable build** with its own URL | a **long-lived environment** with its own instance, variables and database |
| Promotion | re-points the production domain at that existing build | deploys to the production environment, which normally **builds again** |
| Is the shipped artifact the checked one? | **yes** | **no — a rebuild** |

So the property holds for free on Vercel and **breaks on Railway** — which is the target that
matters most here, since Railway hosts the .NET API this design can actually verify end to end.

A rebuild is usually identical. "Usually" is doing a great deal of work: a floating base-image tag,
a dependency resolved at build time, a different build cache, and the health check applied to one
binary while another shipped.

### Build once, deploy by digest

Platform-independent, and it restores the property:

```
build once  →  registry  →  staging (digest X)  →  verify  →  production (digest X)
```

Railway can deploy from a registry image rather than from source, which is what makes this work
there. And it fits what the factory already does rather than adding machinery: `imageDigest` is
already on `ContainerRuntime` ([src/verify/runtime.ts:47](../../../src/verify/runtime.ts#L47)), and
[src/verify/dotnet.ts:259](../../../src/verify/dotnet.ts#L259) already records image digests as
evidence in `toolVersions`.

`deploy.image-binding` then generalises `deploy.script-binding`: **refuse to promote a digest that
differs from the digest that was health-checked.** One principle, two artifacts — the SQL script and
the image.

## Gate set

All new. All deterministic.

| Gate | Fails when | Waiver |
|---|---|---|
| `deploy.preview-ready` | The platform's build failed, or did not become ready within the timeout | `none` |
| `deploy.env-complete` | A required variable name is absent from the target | `human` |
| `deploy.migration-safe` | squawk flags an unsafe operation · the script fails on empty, seeded or snapshot · pending EF model changes · the snapshot is older than `maxAgeHours` | `none`, safety |
| `deploy.script-binding` | The script hash applied differs from the script hash proved | `none`, safety |
| `deploy.image-binding` | The image digest promoted differs from the digest that was health-checked | `none`, safety |
| `deploy.prod-healthy` | Readiness or error rate outside bounds within the watch window | `none` |

`deploy.env-complete` is waivable because static analysis has false positives — a variable may be
genuinely optional. The other five are not: each one guards something irreversible or
unverifiable.

## Prerequisites

Everything that must exist before an implementation can be exercised. Platform UIs change, so these
state the **capability required** and the **setting that must hold**, not a click path; confirm the
current wording in each dashboard during implementation.

### On Vercel

| Requirement | Why |
|---|---|
| Repository connected via the Git integration | It builds the commit; the factory does not |
| **`main` must not be the Production Branch** | Otherwise a merge goes straight to customers and there is no preview left to gate. Point the production branch elsewhere so `main` builds as a preview. |
| A deployment can be **promoted** to production via the API | This is the `promote` step — re-pointing an existing build, not rebuilding |
| An access token with deploy and promote scope | Stored in `~/.factory/.env`, named in config |
| Project id, and team id if the project is in a team | API addressing |
| Production environment variables set **in Vercel** | The factory gates on names, never holds values |
| The API can list variable **names** per environment | Required by `env-audit` |

### On Railway

| Requirement | Why |
|---|---|
| Repository connected | Same reason |
| **Two environments**, e.g. `staging` and `production` | `staging` tracks `main`; `production` is only ever changed by the `promote` step |
| Production deploys **not** triggered by Git | Otherwise promotion is not the factory's to control |
| A token with deploy rights | `~/.factory/.env` |
| Project, service and environment ids | API addressing. Railway's public API is GraphQL — confirm the current schema during implementation. |
| **Deploy from a registry image**, not from source | So production runs the exact digest that staging verified. Without this, promotion is a rebuild and `deploy.image-binding` cannot hold. |
| Postgres service, with a **managed backup** the snapshot step can restore from | Required by `migration-proof` |
| A migration credential that is **not** a superuser, with only the rights the script needs | Blast radius |

### A container registry

| Requirement | Why |
|---|---|
| Somewhere to push the built image, reachable by both environments | `build once → registry → deploy by digest` needs a registry. This is new infrastructure, alongside the production snapshot. |
| Credentials for it, named in `~/.factory/.env` | Same rule as every other secret |

### In the repository

| Requirement | Why |
|---|---|
| Branch protection forbids direct pushes to `main` | The merge gate's precondition; also means a deploy can only ever follow a verified commit |
| Merge queue enabled, requiring the merge gate's check | Upstream of this spec |

### In the factory

A new `deploy:` block in `ProjectConfig` ([src/config/project.ts](../../../src/config/project.ts)),
following the established rule that **config names an env var and never holds a secret** — exactly
as `forge.tokenEnv` and `notify.slackWebhookEnv` already do:

```yaml
deploy:
  coalesceSec: 90
  targets:
    - name: api
      platform: railway
      tokenEnv: RAILWAY_TOKEN
      projectId: "..."
      serviceId: "..."
      previewEnvironment: staging
      productionEnvironment: production
      health:
        readyPath: /health
        readyTimeoutSec: 180
        watchSec: 600
        maxErrorRate: 0.02
    - name: web
      platform: vercel
      tokenEnv: VERCEL_TOKEN
      projectId: "..."
      teamId: "..."
      health:
        readyPath: /
        readyTimeoutSec: 120
        watchSec: 600
  database:
    connEnv: PROD_DATABASE_URL        # name only
    migrationUserEnv: PROD_MIGRATE_URL # non-superuser, name only
    snapshot:
      restoreFrom: managed-backup
      maxAgeHours: 24
  rollback:
    auto: true                        # honoured only when schema-compat is `additive`
```

And in `~/.factory/.env`, which the factory reads and never writes:

```
RAILWAY_TOKEN=...
VERCEL_TOKEN=...
PROD_DATABASE_URL=...
PROD_MIGRATE_URL=...
```

### The Vercel caveat, restated

`stack` admits only `dotnet` ([src/config/project.ts:21](../../../src/config/project.ts#L21)), and
the README lists Next.js/Node repos as not yet supported for building
([README.md:103](../../../README.md#L103)). The design toolkit can scan and lint a frontend, and
`design.capture` can start one, but that path is host-only, opt-in and explicitly advisory.

So a Vercel target ships code the factory has never built or tested. That contradicts "nothing
unverified ships". It is listed as a prerequisite decision rather than a blocker: deploying a
frontend is allowed, but it must be **recorded as an accepted exception**, and the Railway target is
the only one this spec can claim end-to-end verification for.

## What gets written back

| Target | Content |
|---|---|
| Ledger | The `deploy` run: the runs it covers, the script hash, `MigrationRun`, `SchemaCompat`, `EnvAudit` (names only), promotion and health results, any rollback |
| Slack | On park, rollback, forward-fix escalation, or `deploy.migration-safe` failure. **Silent on success** — notifying on every deploy destroys the signal |
| Platform | The promotion, and the rollback if one happens |
| GitHub | A deployment status on the merge commit, so the PR shows where its change reached |

## Error handling

| Failure | Behaviour |
|---|---|
| Platform build failed | `deploy.preview-ready` fails. No migration, no promotion. Notify. |
| Platform API unreachable | Backoff per the ladder, uncounted, then park. Never promote on an uncertain read. |
| Snapshot unavailable or stale | `deploy.migration-safe` fails. **Do not** fall back to proving on seeded data alone — that is the proof the decision asked for. |
| Script fails on the snapshot | Fail, notify, park. Production is untouched. |
| `migrate-prod` fails midway | Stop. Do not promote, do not roll back the schema. Park and alert: a partially applied migration needs a person. Idempotent scripts make re-running safe, but the decision to re-run is not the agent's. |
| Promotion succeeds, health fails, `schema-compat` is `additive` | Automatic rollback to the previous deployment. Record both. |
| Promotion succeeds, health fails, `schema-compat` is `incompatible` | **No rollback** — rolling back would put old code against a schema it cannot read. Hold, alert, start a forward-fix run naming every run in the batch. **Conditional on Open question 1:** under resolution (a) this row becomes unreachable, because an `incompatible` script never reaches `migrate-prod` unattended. |
| Newer commit arrives mid-deploy | Absorb it before `migrate-prod`; after that point, queue exactly one successor. |
| Two deploys race | `ExecutionLock` per project and environment refuses the second. |

## Testing strategy

Deterministic, no network, no real platform, no production data — the same approach as the existing
fakes (`src/runners/agent.test.ts`, `src/verify/verify.test.ts`).

**Unit**

- `schema-compat`: one case per operation class; an unrecognised operation classifies `incompatible`.
- `env-audit`: missing name detected; extra names on the platform are not a failure; no value ever
  appears in the output.
- Script binding: a changed script hash between proof and apply fails.
- Coalescing: a burst of five commits inside the window yields one deploy.

**Integration**, against a fake Vercel, a fake Railway and the fake container runtime

- happy path: preview ready → proofs pass → migrate → promote → healthy → recorded;
- squawk flags a destructive operation ⇒ no migration, no promotion, production untouched;
- snapshot older than `maxAgeHours` ⇒ gate fails rather than passing quietly;
- script fails on the snapshot but passes on seeded data ⇒ still fails, proving the snapshot layer is
  load-bearing;
- a promoted digest differing from the health-checked digest ⇒ `deploy.image-binding` fails and
  nothing is promoted. **Mandatory** — it is what stops a rebuild silently replacing the verified
  artifact;
- health fails with `additive` ⇒ rolled back automatically;
- health fails with `incompatible` ⇒ **not** rolled back; forward-fix escalation names all runs in
  the batch. This asymmetry is the core safety property and must be asserted;
- two concurrent deploys ⇒ the second is refused by the lock. **Mandatory.**
- a batch of three PRs ⇒ one deploy run, parent referencing three run ids.

**Verified by hand once, not by tests:** that the Harness Delegate can invoke the command; that
Vercel's production branch is not `main`; that Railway's production environment does not deploy on
push; and that the migration credential is not a superuser.

## Open questions

1. **The incompatible-migration problem.** This follows directly from two decisions above —
   automatic promotion, and a migration gate that permits destructive operations — and they do not
   fully reconcile. `migrate-prod` precedes `promote`, so an incompatible migration puts old code
   against a new schema for the length of the promotion, which is an outage rather than a risk. The
   two honest resolutions are: **(a)** classify `incompatible` as "cannot deploy unattended" and park
   for a human, which makes the automatic path effectively expand-only; or **(b)** accept a brief
   outage window and document it. **Recommendation: (a).** It needs deciding, not discovering.
2. **Railway's promote mechanics.** I am confident about Vercel's aliasing model and **not**
   confident about Railway's current promote capabilities. Confirm in their dashboard and API
   whether an environment can be pointed at an existing image digest, or whether `build once →
   registry → deploy by digest` is the only route to it. The design consequence is the same
   either way; the implementation is not.
3. **Where the error rate comes from.** `deploy.prod-healthy` needs more than a 200 from
   `readyPath`. Both platforms expose logs and metrics, but the shape differs, and a readiness probe
   alone will not notice a 20% 5xx rate. Per-platform detail needed.
4. **Multi-target atomicity.** With both an `api` and a `web` target, the API may promote and the
   frontend fail. Is a partial promotion acceptable, or must both roll back together? Coupled
   rollback needs the frontend to be verifiable, which the Vercel caveat says it is not.
5. **Forward-fix attribution.** When a batch of three breaks production, which run is held
   responsible, and does the forward-fix run inherit from one of them or start fresh?

## Out of scope

- **Building or testing the frontend.** Required before a Vercel target can honestly claim
  verification; a separate piece of work on `stack` support.
- **Multi-region, blue/green, canary.** Preview-then-promote is the chosen shape.
- **Rolling the schema back.** Never attempted. Expand/contract across two deploys is the mechanism
  for removing a column, and the contract half is an ordinary change with its own verification.
- **Secret rotation and management.** Values live on the platform; the factory gates on names.
- **Deploying anything other than `main`.** The queue is the only path in.
