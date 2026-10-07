# Hand-over: greenfield in one run, and the full-stack contract (2026-10-06)

Read [fullstack-contract.md](fullstack-contract.md) first: it says what the features are and how they work. This
note says where the work stands and what to do next.

## Where the code is
| Branch | Holds | State |
|---|---|---|
| `main` | Everything merged so far. Does **not** have the work below. | `factory selftest` fails on it (see "Known problems"). |
| `greenfield-first-run` | Greenfield in one run, the lockfile fix, main merged in. | Pushed. Not merged. |
| `fullstack-contract` | All of `greenfield-first-run`, plus the API contract, `factory fullstack`, the dry-run scripts and these docs. | Pushed. Not merged. **Work from here.** |

`fullstack-contract` contains `greenfield-first-run`, so merging it into main brings both. Nothing here changes any
existing step's `templateVersion`, and the step lists of brownfield, estimate and seeded greenfield runs are
unchanged (`src/stages/modes.test.ts`).

## What is proven, and how
Everything was proven with **scripted models on real containers**, at $0. No real model has run any of it.

| Claim | Evidence |
|---|---|
| One greenfield run goes from an empty repo to a delivered Next.js branch | `dryrun/one-run-greenfield.ts`: delivered in about 12 min, fidelity pass (tokens, structure, accessibility, layout), 2 cards |
| The delivered app builds, starts and passes its tests | built and started in a Node container; `/login` and `/appointments` answered 200 |
| A run killed mid-implement resumes without redoing finished steps | `--kill-at-implement`, then one resume delivered |
| The web plan writes the contract, it is shown on the card, and the client is generated from it | `dryrun/fullstack.ts`; tests in `src/stages/greenfield.test.ts` |
| The API is held to the contract by code | the scripted API agent names a field wrongly; all 4 tests still pass; only `contract.matches` fails; the retry passes |
| `factory fullstack` takes one request to two delivered branches | `dryrun/fullstack.ts`: about 17 min, 3 cards (web design, web plan, API plan) |
| The two apps run together | `docker compose up` on the written files: the API returned the SQLite rows, CORS allowed the web origin, and the web app's generated client read the live API |

## What is not proven or not built
1. **A real model on the contract path.** The planner has never written a real contract, and no real agent has
   wired screens to the generated client. Expect at least one retry or stop on the first paid run.
2. **Screens showing live API data.** The scripted implementer only marks the screen files. Tests run against the
   generated handlers, never the live API.
3. **PRs.** `factory fullstack` makes local repos, so delivery ends at a local branch in each. A PR needs a GitHub
   repo, a remote and a token per repo.
4. **One spec for both sides.** With two repos the spec is written and paid for twice.
5. **The cost of the new review step.** Review now takes up to 14 turns with file reading (it was 4 turns, about
   $0.15). It has never run paid in this form. Estimate: $0.40-1.50 for a two-screen app.

## Next steps, in order
1. **Decide the merge.** Merge `fullstack-contract` into main, or at least take the one-line selftest fix
   (`src/selftest/script.ts`), so `factory selftest` passes on main again.
2. **Get the real intent file** from Ahsan and read it before any paid run: its wording must not raise the risk lane
   (the words "migration", "endpoint" and "author" do), and it should stay at two screens. The dry runs use a
   stand-in (`dryrun/intent-example.md`); scripted answers do not react to the real text.
3. **First paid run, web side only** (cheapest way to see a real contract):
   `factory fullstack start --name <name> --file intent.md --dir ~/code --max-cost 10`.
   Read the contract on the plan card before approving: every operation the screens need, an example per response.
4. **Then the API side:** `factory fullstack next <name> --max-cost 6`.
5. **Then** `factory fullstack up <name>`, start both, and click through the screens against the real API. This is
   the first time item 2 above gets checked.
6. Record the per-step costs of both runs (`factory report <run>`); the estimates below are guesses until then.

Ideas not started: a factory scaffold for the API instead of the fixed skeleton; creating the GitHub repos from
`fullstack start`; one spec shared by both runs; a check of the screens against the live API in accept; a rule that
compares `package.json` with the plan's package list.

## Cost and caps (estimates from three earlier paid runs)
| Run | Expected | Suggested `--max-cost` |
|---|---|---|
| Web run, two screens | $3-8 | 10 |
| API run, two operations | $3-5 | 6 |

A run stops cleanly at its cap on a card you can waive (`factory waive-cap`). Only Ahsan starts paid runs.

## Before any push
1. `npx tsc --noEmit -p .`, `npx tsc --noEmit -p bench/tsconfig.json`, `npx tsc --noEmit -p dryrun/tsconfig.json`.
2. The full suite in the Playwright container (browser tests cannot start on a bare WSL host):
   `docker run --rm --user $(id -u):$(id -g) -v <repo>/node_modules:<repo>/node_modules -v <worktree>:/w -w /w -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble npx vitest run`
   The only failure there is `src/scripts.test.ts` (a git ownership quirk); run that one on the host.
3. `npm run test:bench`.
4. `factory selftest` ($0), or `npx tsx src/cli/index.ts selftest` from a worktree.
5. For a change to a build step: one of the `dryrun/` scripts.

## Known problems and traps
- **`factory selftest` fails on main.** Main's review step now needs a verdict per acceptance criterion and the
  selftest's scripted reviewer did not give one. Fixed on both branches.
- **The global `factory` command runs main's `dist/`.** Work in a separate git worktree, and after pulling main run
  `npm ci && npm run build` there.
- **Never bump a step's `templateVersion` while a paid run is paused:** the run pays for that step again on resume.
  Main recently bumped breakdown, drafts, merge, specify and review.
- **Resume right after a hard kill says "Repo is busy".** The run lock goes stale after 60 seconds; then one
  resume is enough.
- **A laptop that sleeps can trip the active-time cap** (the clock jumps under WSL). Keep it awake during a run.
- **A dropped package download stops a run at a waiver card.** If `npm install` fails inside the fidelity check (seen once: the feed proxy dropped a connection), the design checks are "not checked" and the run waits on a waiver card instead of passing. Read the card before waiving: a waiver here lets a design that was never checked go on. How to run the check again without waiving has not been tried.
- **One coding image tag.** `factory-agent:dotnet8` is rebuilt from the project's `dotnet.sdkImage`. Two projects
  with different SDK images must not run at the same time. `factory fullstack` gives both sides the same image.
- **Any word like "screen", "web app" or "button" in a request makes intake say the run touches UI.** That is why
  the API side of a contract product is told by code that it has no UI.
- **`src/design/` belongs to the design work.** The scaffold lives there; this work did not edit it.
- **The repo is public.** Do not commit client requests, ledgers or project configs.
