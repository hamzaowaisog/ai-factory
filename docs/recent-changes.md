# Recent changes (branch `Hamza/demo-mode`, 2026-10-15 to 2026-10-21)

These are the changes on this branch since `upstream/fixes-next` (c1a35e3). Each one is the fix for something a recorded run showed. The run named in brackets has its ledger under `~/.factory/ledger/<run>/`, and the run ID also appears in a comment next to the code. To find the code for any item, run `grep -rn "run <id>" src`.

**Status.** Everything below is committed on this branch except the last section, and none of it is pushed or merged into `main` yet.

- **Seen working in paid runs:** demo mode, the accounts default, the Stitch fixes, the secrets and evidence fixes. These were proven in parking-app runs e220 (web) and b477 (API).
- **Covered by tests only:** the rest, with no paid run yet.

## Contents

1. [Demo mode](#1-demo-mode)
2. [Accounts: sign-up and log-in by default](#2-accounts-sign-up-and-log-in-by-default)
3. [Full-stack and contract](#3-full-stack-and-contract)
4. [Build steps (stub-commit, author-tests, implement, integrate)](#4-build-steps)
5. [Web app quality (design to code)](#5-web-app-quality)
6. [.NET](#6-net)
7. [Design: Stitch](#7-design-stitch)
8. [Meeting transcript to intent](#8-meeting-transcript-to-intent)
9. [Specify and secrets](#9-specify-and-secrets)
10. [Infrastructure](#10-infrastructure)
11. [Not committed yet](#11-not-committed-yet)

---

## 1. Demo mode

`FACTORY_DEMO=1` relaxes the build gates so a run reaches a pull request and a running app. With the variable unset, nothing changes.

The full description is in [docs/demo-mode.md](demo-mode.md): what each relaxation does, what is never relaxed, how to read a demo run's ledger, and the rules for changing it. The main points:

- 2 attempts per step instead of 6.
- From the 2nd try, a build step accepts what it has. Every accepted failure is named in the run log and on the pull request.
- Safety checks are never relaxed: locked tests, protected files and secrets.

Code: [src/util/demo.ts](../src/util/demo.ts), plus every `demoMode()` branch (`grep -rn DEMO src`). Commits: 640b07f, 94c8fb0, 47b34bc.

> Set the variable on the process that runs the steps: `FACTORY_DEMO=1 factory ui`, or the same prefix on `factory resume`. A UI started without it runs every run without demo mode.

## 2. Accounts: sign-up and log-in by default

Past new-product runs shipped without any way to sign up or log in. One even protected every API call with JWT but had no login endpoint, so nothing worked.

- **Default answer.** A new product gets a factory answer, Q-AUTH: a minimal email-and-password sign-up and log-in ([src/stages/accounts.ts](../src/stages/accounts.ts)). It is added in `specpipe` as a decided answer, so the round-trip check doesn't flag sign-in as invented.
  - "New product" means no repo, an empty repo, or only the skeleton the factory starts (`startsNewProduct`).
  - So the API side of a full-stack product gets it too.
  - In a split spec, only the first module gets it.
- **Lint L-accounts.** It blocks a spec for a new product that has no sign-up or no log-in requirement.
  - "registered vehicle" or "vehicle registration" no longer counts as a sign-up (run e220).
- **Google and other providers.** A log-in through Google, Microsoft, SSO and the like needs the provider's keys before anyone can log in. Where the request asks for one, the default answer replaces it with email and password, and says so (run e220).
- **Contract.** `contractAuthProblems` in [src/gates/contract.ts](../src/gates/contract.ts) requires a new contract that has security to include open `POST` register and login operations.
  - The planner rules in [src/stages/spec.ts](../src/stages/spec.ts) say there is no provider log-in in the contract.
  - They also say the task that delivers sign-in builds the sign-up and log-in pages and keeps the token.

Designs and estimates approved before this change have no auth screens. Redraw the design to get them.

## 3. Full-stack and contract

- **The locked contract can gain operations at plan (run 3406).** An auth flow needed four operations the locked `contracts/openapi.yaml` lacked, and the plan wasn't allowed to change the file, so the run parked.
  - The plan now has a `contractAdditions` field (a YAML fragment of new paths and components).
  - `addToContract` and `contractChange` in [src/gates/contract.ts](../src/gates/contract.ts) merge it into the locked file and keep its layout. Additions only: nothing existing changes.
  - It works on the API side only. A plan whose API lives elsewhere is refused.
  - The plan card and the pull request say the web app must take the new contract.
- **Task requirement IDs (run 3406).** A task's reqs written as "REQ-1 — include sign-in…" are read as `REQ-1` (`leadingId` in [src/contracts/artifacts.ts](../src/contracts/artifacts.ts)). Before, every requirement read as uncovered and the run parked.
- **Contract examples are checked against their schema at plan (run b587).** An example missing a required field made the generated mock handlers fail to compile. That was only found after the test writers had been paid for.
- **Routes (run 7850).** One rule for the test writers and the implementer: routes are the contract's paths, without the server URL's base path. The server URL ended in `/v1`, the tests called `/deliveries`, and the implementer added hidden aliases.

## 4. Build steps

All in [src/stages/build.ts](../src/stages/build.ts) unless named.

- **A run started from a design gets the screens' HTML and images (run 3f0f).** Before, implement parked on ENOENT for a screen's HTML. Fixed in [src/stages/executor.ts](../src/stages/executor.ts).
- **The plan's packages are restored before the implement agent starts (run 7850).** The agent's sandbox is offline. TASK-1 spent 16 minutes unable to build because JwtBearer was missing. Packages go into `packagesDir` first, for .NET and npm.
- **A retry keeps the work of test writers that finished (run b587).** Before, a pause or resume restarted all four writers ($6.47, 15 minutes). Now only the writers that didn't finish write again.
- **A retry for weak tests only stays at its rung (run b587).** If the only failure is weak tests, just those are tightened at the same effort, instead of moving up a rung and restarting every writer ([src/gates/ladder.ts](../src/gates/ladder.ts)).
- **"You broke it" only when it was working (run 7850).** A later task is told it broke an earlier task's test only if that test passed at its own task. Otherwise the test is named as never passing. TASK-6 had been told it broke two tests that had never passed.
- **No change-size limit for a new product (runs 3f0f, 7850).** The 1500-line limit is meant for a change a person reviews in an existing code base, and every new-product run stopped on it (5861 and 3804 lines). An approved estimate still holds the run to its hours.
- **The design size cap asks instead of parking (run 3f0f).** `design.size-cap` now raises a waiver card, like the change-size limit, instead of a park no resume could get past. The run had parked with all 20 tasks built.
- **A new product's first task gets more turns (run 7850).** TASK-1 had routes, auth and persistence in one task and ran out of its 80 turns. The first task of a new product now gets half as many again, 120.
- **Blocking review findings put security first.** In demo mode, they are delivered at the top of the pull request, with security findings first (run 7850: a security finding went through listed among the others). See [src/stages/deliver.ts](../src/stages/deliver.ts).

## 5. Web app quality

- **UI criteria for an estimate that draws a design (run 3f0f).** That estimate's spec seeds the web build of its design, but it was written as if screens can't be tested. So it had 0 ui criteria, and 20 tasks and 17 screens were held to only 2 locked tests.
  - Its spec now keeps `ui` criteria, as a web app with screen tests does (`screensTested` in [src/stages/specpipe.ts](../src/stages/specpipe.ts)).
- **Dynamic routes (run 3f0f).** A screen page with an ID in its route shows any record: `[id]` is the route, and the design's sample ID is only data. Before, only `/deliveries/D-4823` existed and every other row's link was a 404.
- **The theme is fixed after design approval (run 3f0f).** A task builds with the approved theme's tokens and adds or changes none. Only the design-system task wires the theme into the stylesheet.
- **Screen lint (run 3f0f review).** `screenLint` in [src/design/build-checks.ts](../src/design/build-checks.ts) checks a built page against its approved screen for:
  - the screen's button labels;
  - IDs in a monospace font;
  - text contrast of at least 4.5:1.

## 6. .NET

- **Time only from `TimeProvider` (run 7850).** The tests pin the clock with an injected `TimeProvider`, but the app read `DateTime.UtcNow`, so it judged reports against the real time.
  - The .NET rules now say to read time only from `TimeProvider` ([src/stages/stack-text.ts](../src/stages/stack-text.ts)).
  - The `noClockReads` check refuses `DateTime.UtcNow`, `DateTime.Now`, `DateTimeOffset.UtcNow` and `DateTime.Today` in a .NET task ([src/gates/predicates.ts](../src/gates/predicates.ts)).
- [src/verify/dotnet.ts](../src/verify/dotnet.ts) restores the packages into the run's offline feed (see section 4).

## 7. Design: Stitch

From Muhammad Owais (PR 45, merged in 1302e8f). The design note and plan are under `docs/superpowers/specs/` and `docs/superpowers/plans/`, file `2026-10-15-stitch-overlays-and-mobile-design.md`.

- **Popups are drawn on their page.** A modal, drawer, sheet or confirm dialog is an `overlay` of its page (at most 3 per page), drawn once as a frame of that page. It is no longer a screen with its own states and route.
  - It appears as a tab in the approval demo, and the pictures, scaffold and estimate count it.
  - The Stitch rules also say "do not invent screens the requirements do not need". The Stitch track had given 20 to 25 screens against 4 to 5 on the JSON track.
- **Mobile design is chosen per run.** Use `--mobile-design true|false` on the command line, or the "Mobile design" select on the start form, which appears when the run draws with Stitch or pages.
  - The choice is saved with the run.
  - It overrides the project's `design.stitch.phone`.

Fixes from the parking-app run e220, in [src/design/stitch.ts](../src/design/stitch.ts) and [src/stages/design-stitch.ts](../src/stages/design-stitch.ts):

- **"Already connected to a transport" is treated as a dropped connection** and the Stitch client is made again. After a transport error, the SDK marks itself unconnected but keeps the old transport, so the run parked at design.
- **Colours from a send-back reason are kept as the brand.** "Blue and white, primary #1D4ED8" in a lead's send-back was being dropped, because only colours from the request counted.

## 8. Meeting transcript to intent

From Muhammad Owais (PR 42, merged in f6eb771), plus fixes in 8a261ec.

- **The request can be a meeting.** A Google Meet export (`.docx`, `.txt` or `.md`) can be the request, with `--file` on start, estimate and design start, or uploaded in the web UI.
- **New `distill` step.** It turns the transcript into the client's intent, under the `transcript-distill` skill. Code checks every quote against its turn, and speakers are tagged from the team roster (`factory team list|add|remove`).
- **Intent card.** The run waits on it. You can edit it (`factory edit-intent`, or on the run page), approve it, or send it back. The approved brief becomes the request.
  - Clarify then asks only what the meeting left open.
  - A hands-off estimate approves the intent itself and records its assumptions.
- **Size limit.** Transcripts have their own 300 KB limit.
- **Full-stack runs.** `factory fullstack start` passes the transcript to the web run, and the API run reads the web run's approved brief.

## 9. Specify and secrets

- **An evidence quote with a masked secret matches (run afd1).** The model sees secrets as `«SECRET_n»`, so a quote of the skeleton's example connection string never matched the code. The parts around the placeholder are now matched instead (`checkEvidence` in [src/context/tools.ts](../src/context/tools.ts)). The run had parked at specify.
- **The secret check no longer flags TypeScript signatures (run e220).** A line like `login(email: string, password: string): Promise<…>` was read as a password value. Fixed in `isCodeValue`, [src/context/secrets.ts](../src/context/secrets.ts).

## 10. Infrastructure

- **Package feed proxy (run 3406).** [docker/proxy/proxy.mjs](../docker/proxy/proxy.mjs), `connectAny`: each of the feed's addresses gets a 10-second connect timeout, the next address is tried, and a 502 comes back when none answer. One CDN address for api.nuget.org had hung discover for 15 minutes.
  - The factory recreates the proxy container on its next start, because the file changed.
- **New product detection (run 7850).** `startsNewProduct` in [src/config/greenfield.ts](../src/config/greenfield.ts) treats an empty repo, or one holding only the skeleton the factory started, as a new product. It's used by the accounts default, the change-size limit and stub-commit.

## 11. Not committed yet

- [docs/demo-mode.md](demo-mode.md): the demo mode guide (new).
- This file (new).
- [src/gates/policy.ts](../src/gates/policy.ts): a comment corrected, demo mode gives 2 attempts, not 3.
- [src/util/demo.ts](../src/util/demo.ts): a pointer to the demo mode guide.
- **Long screenshot names (run 4049).** A Stitch state named by its whole layout description gave a screenshot file name past the system's 255-byte limit, and design-export parked with ENAMETOOLONG twice. `fileSlug` in [src/design/screenshots.ts](../src/design/screenshots.ts), also used by [src/design/package.ts](../src/design/package.ts), now cuts a name to 60 characters with a short hash.

## Known gaps

These have not been built:

- **The cost cap.** It is $9.50 for a run with Sonnet test writers, at about $6 per author-tests attempt (run b587). Left to Hamza: raise the cap, or route author-tests to a cheaper model.
- **The logout operation (run b477).** The API spec has logout (REQ-4), but the plan added no contract operation for it.
- **The API is ahead of the web app.** A contract operation added at plan on the API side (section 3) is not picked up by the web run automatically. The pull request says so.
