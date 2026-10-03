# AI Factory

> Turn a plain-English change request into a **verified pull request** on a real .NET + Postgres codebase, with every step checked by code, not by the AI's word.

![status](https://img.shields.io/badge/status-experimental%20POC-orange)
![node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![tests](https://img.shields.io/badge/tests-vitest-6E9F18)

AI Factory is a command-line tool. You type what you want changed. It asks you only the questions that matter, writes a spec, plans the work, and asks you to approve. Then it writes the tests first, implements the change, runs every check itself in sealed containers, and hands you a branch (or a PR) with the evidence attached.

```bash
factory start "Return 404 instead of 500 when an order ID doesn't exist" --project shop-api
```

---

## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [What's built / what isn't](#whats-built--whats-not)
- [Requirements](#requirements)
- [Installation](#installation) · [Why Ubuntu on Windows?](#why-ubuntu-wsl-on-windows)
- [Add a project](#add-a-project)
- [Your first run](#your-first-run)
- [Use it on your own .NET repo](#use-it-on-your-own-net-repo)
- [Web screens](#web-screens)
- [Start runs from Jira](#start-runs-from-jira)
- [Command reference](#command-reference)
- [Use it from Claude Code](#use-it-from-claude-code)
- [Safety model](#safety-model)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Development](#development)
- [Design docs](#design-docs)

---

## Why

Coding agents are good at writing code and bad at proving it's right. They can say "all tests pass" when they didn't run, skip a failing test, or quietly change the test instead of the code. AI Factory puts the agent inside a pipeline where:

- **Plain code decides, not a model.** Every step ends at a gate (a small, deterministic check). The same inputs always give the same decision.
- **The factory runs the checks itself.** Build and tests run in throwaway containers the AI can't touch; the factory reads the results.
- **Tests come first and get locked.** Acceptance tests are written from the spec, must fail on today's code, and are then locked by fingerprint. The implementer can't edit them.
- **Humans decide on a terminal.** Approvals are tied to the exact plan you saw. Change the plan and the approval no longer counts.
- **Everything is recorded.** Each run keeps an append-only ledger, and `factory verify-evidence` re-checks every decision later.

---

## How it works

```mermaid
flowchart TD
    A([Your request]) --> B[discover + baseline<br/><sub>build and test the untouched repo</sub>]
    B --> C[intake<br/><sub>split into intent, classify risk</sub>]
    C --> D[ground<br/><sub>find the code involved today</sub>]
    D --> E[clarify<br/><sub>3 independent readings → questions</sub>]
    E -->|only if needed| Q{{Question card<br/>factory answer}}
    Q --> F
    E --> F[3 spec drafts → merge]
    F --> G[lint + critic + round trip<br/><sub>up to 3 repairs</sub>]
    G --> H[plan<br/><sub>tasks, file scopes, options, decision</sub>]
    H --> I{{Approval card<br/>factory approve}}
    I --> J[stub commit + author tests<br/><sub>must fail on old code twice → locked</sub>]
    J --> K[implement task<br/><sub>coding agent in a sealed container</sub>]
    K --> L[task verify<br/><sub>build + tests + scope + lock checks</sub>]
    L -->|fail| K
    L -->|all tasks pass| M[integrate<br/><sub>full suite, no new failures</sub>]
    M --> N[accept → review]
    N --> O([deliver<br/><sub>branch + evidence manifest, PR if configured</sub>])
```

**The steps in plain words**

| Step | What happens | Who does it |
|---|---|---|
| discover | Builds and tests the untouched repo once and remembers the result, so the run is only blamed for *new* failures. Refuses repos it can't handle yet. | Factory (no AI) |
| intake | Splits your request into short "intent" quotes, classifies it (bugfix/feature…) and its risk. | AI (Haiku) |
| ground | Finds the files and methods involved today, quoting them. Quotes are checked against the real files. | AI (Opus) |
| clarify | Three AIs read your request independently. Where they **disagree**, that's ambiguity. You get at most 5 questions (then at most 3 more); everything else becomes a written assumption. | AI + you |
| specify | Three independent spec drafts (EARS requirements + Given/When/Then tests) are merged. Code checks the format; a critic looks for gaps; a round-trip check restates the spec and compares it to your words. | AI + code |
| plan | Tasks with exact file scopes, at least two options and a short decision record. | AI (Opus) |
| **approval** | One card with your request word for word, the answers, the requirements, every file the plan will touch and the critic's findings. | **You** |
| author tests | A coding agent writes one test per acceptance criterion. The factory runs them on the old code **twice**; they must fail for the right reason. Then they're locked. | AI + factory |
| implement ⟲ verify | A coding agent works on one task at a time in a sealed container. The factory then builds, runs the tests, and checks the change stayed in scope, didn't touch locked tests, added no skips or secrets. Each task must also keep earlier tasks' tests passing. Failures loop back with the exact errors; if only tests or the build failed, the retry fixes the existing change instead of starting over. | AI + factory |
| integrate / accept | Full test suite; every locked test must have run and passed; no new failures vs the baseline. | Factory |
| review | A reviewer (a different model family when an OpenAI key is set) reads the diff, with an OWASP Top 10 checklist for security. Whether a finding blocks is decided by code. | AI + code |
| deliver | Secret scan of every commit, an evidence manifest commit, and a PR (or a local branch). | Factory |

When something keeps failing, the factory climbs a fixed ladder (retry with the errors → more effort → stronger model) and then **parks** the run for you. Hard limits on attempts, spend and time stop runaway runs; `factory status <run>` shows the running cost.

---

## What's built / what's not

| Built | Not yet |
|---|---|
| Brownfield mode on **.NET + Postgres** repos | Greenfield build mode (an estimate can start from requirements alone, but building one is not built; the design steps are made to plug into it) |
| Images sent to thinking steps (untrusted, never to steps that write code) | Design references in any form, `--ref` and in the UI (`docs/estimates-design.md`, "Design references"; not yet run against a live model) |
| Clarify, 3-draft spec, merge, lint, critic, round trip | Accept that boots the app and records HTTP/DB evidence (today: "the locked test passed") |
| Plan + approval card, stub commit, locked tests | Applying `steer` changes mid-run (recorded, not applied) |
| Claude coding agent in a sealed container | Codex and jcode runners; Next.js/Node repos |
| Test lab: restore → offline build → tests next to a throwaway Postgres | Review repair loop (blocking findings park the run); unlock card for a wrong test |
| Ledger, crash-resume, failure ladder, cost caps, verify-evidence | URL-prefix package filter (today: allowlist by host name) |
| GitHub PR delivery (optional) | Bitbucket PR delivery (today: branch ready locally) |
| Design toolkit for web apps (no AI): how big a UI change is, shown on the approval card; style checks; `factory design` | A mock rendered in the real app; the visual check (`design.capture`) is opt-in and advisory |
| Design handoff, steps 1-6: common controls, a versioned design package (v1 on approval, v2... per change request, never changed), exports (PNG, PDF design book, demo zip, tokens, JSON, and `figma.json` for our own AI Factory Import Figma plugin, no paid seat) from `factory design export`, `--design-export` and an Export panel in the UI; the approved design built in `next-shadcn` / `vite-shadcn` (the shadcn kit, the theme and every screen scaffolded in the stub commit, agents writing behaviour only) with `--ui-target`, `factory design scaffold` and a Code panel; the fidelity check after accept (`design.fidelity`: tokens, structure and accessibility gates, layout and pixel advice, baselines accepted with a reason, a Fidelity panel), Playwright tests generated per screen, and checked exports | Design handoff, the rest: the `expo` kit and live runs, skipped until a project needs a phone app; the Claude Code + Figma MCP route (needs a paid seat) (`docs/estimates-design.md`, "Design handoff") |
| **Estimate mode**: requirements or a repo plus a request to hours, API cost and elapsed time, with gates E1-E7, a person's questions and approval by default (`--hands-off` to opt out; a build never follows a hands-off estimate) and two workbooks (`factory estimate`); building from an approved estimate under gates B1-B7 (`factory start --from-estimate`); benchmarks in `bench/` | Estimate-driven builds outside .NET; calibration from real hours until finished builds and more ledgers exist. See [docs/estimates-overview.md](docs/estimates-overview.md) |

**Refused for now:** SQL Server, repos whose tests start their own containers (Testcontainers), Windows-only projects (WPF/WinForms/.NET Framework), Git LFS, submodules.

---

## Requirements

| | |
|---|---|
| **Computer** | macOS (Apple Silicon or Intel), Windows 10/11, or Ubuntu |
| **Disk** | ~15 GB free (container images and package caches) |
| **API key** | An Anthropic API key with credit (required). An OpenAI key is optional. A Claude Pro/Max subscription is **not** an API key: create one at [console.anthropic.com](https://console.anthropic.com) → API Keys. |
| **Access** | Read access to this GitHub repo |

Everything else (Node, containers, the `factory` command, images, the Claude Code connection) is installed by the setup script.

---

## Installation

One command per system. It's safe to run again: it skips whatever is already done and only asks for your password when it installs something. At the end it asks for your API key (typing is hidden) and runs `factory doctor`.

### macOS

Open **Terminal** and run:

```bash
git clone https://github.com/im-ahsan/ai-factory.git ~/ai-factory && bash ~/ai-factory/scripts/setup.sh
```

> If a window asks to install Apple's command line tools, click **Install**, then run the same command again.

It installs Homebrew, Node 22, and **Colima** (a free, lightweight way to run the containers; Docker Desktop isn't needed).

### Windows

Open **PowerShell as administrator** (right-click → *Run as administrator*) and run:

```powershell
git clone https://github.com/im-ahsan/ai-factory.git $env:TEMP\ai-factory; powershell -ExecutionPolicy Bypass -File $env:TEMP\ai-factory\install.ps1
```

> Add `-NoKeys` to skip the API-key question and add keys later. No git on Windows? Download [`install.ps1`](install.ps1) from GitHub and run `powershell -ExecutionPolicy Bypass -File install.ps1` from your Downloads folder.

The first time, it installs WSL + Ubuntu and asks you to create a Linux username and password (and may ask for a restart). **Run the same command again afterwards**; it then installs everything inside Ubuntu and connects VS Code. From then on, open the factory with:

```powershell
wsl -d Ubuntu -- code ~/ai-factory
```

The VS Code terminal is already Ubuntu; run all `factory` commands there.

#### Why Ubuntu (WSL) on Windows?

- **Sealed rooms.** The factory runs code nobody has reviewed yet: the AI's code and the repo's own build and test scripts. It runs them in throwaway containers with no internet and no access to your files, so they can't read your keys, touch your machine or fake test results. That's what makes a "pass" trustworthy.
- **They're Linux containers.** The official .NET SDK and Postgres images and the coding agent are Linux-based, and the network lockdown is a Linux container feature. Macs run the same containers, so everyone gets one design.
- **Windows always needs a Linux VM for them.** The only other option is Docker Desktop, which needs a paid licence at our company size and runs the same hidden Linux VM (WSL) underneath. Using Ubuntu directly is free and faster.
- **Day to day you barely see it.** The installer sets it up. Open the project with `wsl -d Ubuntu -- code ~/ai-factory`; VS Code's terminal is already Ubuntu. Run git there, not from Windows.
- **Why not skip containers?** Then the AI and the repo's code would run with your permissions, with access to your keys, network and local databases, and test results could be faked. Not acceptable for client code.

### Ubuntu / Linux

```bash
git clone https://github.com/im-ahsan/ai-factory.git ~/ai-factory && bash ~/ai-factory/scripts/setup.sh
```

### After setup

Open a **new** terminal, then:

```bash
factory doctor
```

```
ok   Node v22.x
ok   container runtime: /usr/bin/docker
ok   ~/.factory/.env exists
ok   ANTHROPIC_API_KEY set in ~/.factory/.env
note OPENAI_API_KEY not set: critic and review will use Claude (single family)
```

Skipped the key during setup? Add it any time: `nano ~/.factory/.env` → `ANTHROPIC_API_KEY=sk-ant-...`. Never paste keys into chat, tickets or the repo.

To start runs from Jira tickets (`--jira`), add these three lines too (optional):

```ini
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=...        # id.atlassian.com → Security → Create API token
```

To use Figma links as design references (`--ref https://www.figma.com/design/...`), add a Figma personal access token with read access to files (optional; exported PNGs and PDFs need nothing):

```ini
FIGMA_TOKEN=...           # Figma → Settings → Security → Personal access tokens
```

<details>
<summary><b>What the setup does</b> (and how to do it by hand)</summary>

| Step | macOS | Windows / Ubuntu |
|---|---|---|
| Base | Apple command line tools, Homebrew | WSL + Ubuntu with systemd (Windows), git, curl |
| Node 22 | nvm | nvm |
| Containers | `brew install colima docker`, `colima start --cpu 4 --memory 8` | Docker Engine CE from Docker's apt repo, your user added to the `docker` group |
| Factory | `npm ci && npm run build && npm link` | same |
| Secrets | `~/.factory/.env` (mode 600) | same |
| Images | `node:22-alpine`, `postgres:16-alpine`, `mcr.microsoft.com/dotnet/sdk:8.0`, and `factory-agent:dotnet8` built from `docker/agent` | same |
| Claude Code | `claude mcp add -s user ai-factory -- node <repo>/dist/cli/index.js mcp` (only if Claude Code is installed) | same |
| Windows extras | – | Ubuntu's git uses your Windows GitHub sign-in; VS Code WSL extension |

Docker Desktop is never used (licensing). The factory refuses to run against it.

</details>

---

## Add a project

Point `factory init` at a .NET repo: a local folder (Windows paths like `/mnt/c/...` are fine) or a git URL.

```bash
factory init /mnt/c/Users/<you>/source/repos/shop-api     # Windows
factory init ~/code/shop-api                              # Mac / Linux
factory init https://github.com/<org>/shop-api.git        # or a URL
```

```
Project shop-api
  repo        /home/<you>/code/shop-api (branch main)
  solution    ShopApi.sln
  .NET        net8.0 → mcr.microsoft.com/dotnet/sdk:8.0
  database    Postgres; tests log in as "shop" to ShopTestDb (tests/Shop.Tests/DbFixture.cs)
  hidden      web (frontend folders the AI won't see)

Wrote ~/.factory/projects/shop-api.yaml
Next: factory baseline --project shop-api
```

What it does for you:
- **Copies the repo into Linux** when it's on a Windows drive or a URL (the factory never works on `C:`).
- **Detects** the solution, the .NET version (→ build image), Postgres, and a database login the tests hardcode. That password goes to `~/.factory/.env`, never into the config.
- **Hides** frontend folders from the AI and **warns** about anything the POC can't run yet.
- Writes `~/.factory/projects/<name>.yaml` (no secrets). Tweak it if you need to; see [`docs/project-example.yaml`](docs/project-example.yaml).

Then record the baseline (builds and tests the untouched repo; no AI, no cost):

```bash
factory baseline --project shop-api
```

```
done in 95s: 412 tests, 405 passed, 7 failed, 0 skipped; exit 1; valid=true
```

Tests that already fail are fine: they're remembered, and a run is only blamed for **new** failures. But code covered only by failing tests has no protection, so pick changes elsewhere.

<details>
<summary><b>Project config reference</b></summary>

| Field | Meaning |
|---|---|
| `repo`, `baseBranch` | The local clone and the branch runs start from. |
| `dotnet.sdkImage` / `solution` | Build image and the solution (or project) that restore, build and test use. Optional: when the repo root has no `.sln` or `.csproj`, the factory uses the shallowest solution below it, else the only project (e.g. `backend/Api/Api.csproj`). Set it when there are several. |
| `database.name` / `user` / `passwordEnv` | The test database, and the login your tests hardcode (created without superuser). The password lives in `~/.factory/.env`. |
| `producerEnv` | Environment for the **test** container only. `{{DB_*}}` are filled in by the factory. |
| `agentEnv` | Dummy environment for the **coding** container, so the app compiles. Never real secrets. |
| `noGo` | Globs hidden from every AI step. |
| `dotnet.runnerArgs` | Extra test-runner settings, e.g. `["xUnit.ParallelizeTestCollections=false"]`. |
| `forge` | GitHub repo to push to and open PRs (`{ kind: github, repo: owner/name, tokenEnv: GITHUB_TOKEN }`). Without it, delivery leaves a ready branch locally. |
| `steps` | Override the model per step (advanced; see `src/stages/routing.ts`). |

</details>

---

## Your first run

All `factory` commands run in the **Ubuntu terminal** on Windows (any terminal on Mac/Linux); see *Where to type these* below.

**Check the whole machine for free first:**

```bash
factory selftest     # one full run on a small sample repo, $0, about 5 minutes
```

It builds a tiny .NET shop with one bug, then runs the whole pipeline on it for real: test lab, test database, the coding container, every check, the approval card (approved automatically) and delivery to a local branch. Only the AI answers are scripted, so nothing is spent. It ends with one line per piece (`ok` or `FAIL`) and cleans up after itself. No API key needed.

**Then spend cents before dollars.** After adding your key, check every paid connection:

```bash
factory smoke        # one tiny call per model, the key proxy, the coding agent in its container: a few cents
```

It stops at the first failure (bad key, unknown model, proxy problem), so nothing bigger runs against a broken setup. Then start with a spend limit, and optionally fewer retries in the project config (`policy: { retryBudget: 2 }`):

```bash
factory start "Return 404 instead of 500 when an order ID doesn't exist" --project shop-api --max-cost 5
```

The factory works until it needs you, then prints what to do and exits. Nothing runs in the background while it waits. After each step it prints what that step cost and the running total. A bad key, an unknown model or a rejected request stops the run at once instead of retrying.

**1. Questions (only if needed)**

```bash
factory show-card <run>
factory answer <run> <hash> Q-1=A Q-2="only for guest checkouts"
```

In a terminal, `factory start` and `factory estimate` ask the questions right there (a letter, your own words, or Enter for the recommended option) and carry straight on, so a run does not stop for a second command. Set `FACTORY_NO_PROMPT=1` to switch that off; from a script or pipe the run still stops and prints the `factory answer` command. On any run (estimate or build) the run page in `factory ui` asks them one at a time as option buttons (the recommended one is marked and pre-selected; picking an option moves on), then a review step lists your choices and you send them with your name. The chosen options are the answers; there is no free-text box. Both channels work on the same card: a terminal run waiting at the prompt notices when the web page answers (and stops asking), and the page shows the card as answered when the terminal got there first. Unanswered questions take the recommended option. Low-risk question cards default automatically after 24 hours.

**2. Approval**

```bash
factory show-card <run>        # read the card: request, answers, requirements, files, plan, findings
factory approve <run> <hash> --note "low risk, one controller"
# or
factory approve <run> <hash> --reject "don't change the payments module"   # the spec and plan are revised, you get a new card
```

`<run>` can be any unique part of the run ID; `<hash>` is the first characters of the card hash printed on the card.

**3. Result**

```bash
factory status <run>
factory show-card <run> --pr   # the PR description the factory wrote
git -C ~/code/<repo> log --oneline <base>..factory/<run>
factory verify-evidence <run>  # re-check every recorded decision
```

The branch `factory/<run>` holds the stub commit (if any), the locked tests, one commit per task and one evidence-manifest commit.

**If a run parks**, `factory status <run>` says why (cap hit, a check failed twice, a locked test keeps failing…). Fix the cause and run `factory resume <run>`, accept a higher limit with `factory waive-cap`, or start a new run.

---

## Use it on your own .NET repo

Six commands, once setup is done and your key is in `~/.factory/.env`.

> **Where to type these:** on Windows, in the **Ubuntu terminal** (Start menu → Ubuntu; the prompt looks like `you@machine:~$`), or in VS Code opened with `wsl -d Ubuntu -- code ~/ai-factory` (bottom-left says *WSL: Ubuntu*). On Mac or Linux, any terminal. PowerShell and CMD can't find `factory`. Windows paths are written the Linux way: `C:\Users\you\repos\x` → `/mnt/c/Users/you/repos/x`.

**1. Add the project** (free)

```bash
factory init /mnt/c/Users/<you>/source/repos/shop-api     # a repo on your Windows drive
factory init https://github.com/<org>/shop-api.git        # or a git URL (Bitbucket works too)
```

It copies the repo into Ubuntu (`~/code/shop-api`; your Windows copy is untouched), detects the solution, the .NET version, Postgres and any database login the tests use (that password goes into `~/.factory/.env`), hides frontend folders from the AI, writes `~/.factory/projects/shop-api.yaml`, and warns about anything it can't handle yet.

**2. Look over the config** (2 minutes): `code ~/.factory/projects/shop-api.yaml`

- `baseBranch`: the branch changes start from.
- `accept.env`: flags the app needs to start properly, e.g. one that makes it run its database migrations:
  ```yaml
  accept:
    env:
      RUN_MIGRATIONS: "true"
  ```
- Optional, for cheap trial runs: `policy: { retryBudget: 2 }`.

**3. Baseline** (free, a few minutes)

```bash
factory baseline --project shop-api
```

The build must be ok. Tests that already fail are fine: they're remembered, and a run is only blamed for new failures.

**4. Cheap check** (a few cents)

```bash
factory smoke --project shop-api
```

**5. Run a change**

```bash
factory start "what you want changed, in plain words" --project shop-api --max-cost 5
# or from a file, or from a Jira ticket:
factory start --file request.md --project shop-api --max-cost 5
factory start --jira SHOP-412 --project shop-api --max-cost 5
factory logs <run> --follow        # in a second terminal
```

Answer the question card if one appears, read the approval card, then approve.

**Seeing the design first.** `factory design start "<requirements>" --ref <image, link or Figma>` runs only the road to the design: clarify, spec, then the mock, clickable demo and look, which a lead approves (`factory approve`, or on the run page). `factory design show <run>` and `factory design open <run>` show it. An approved design is then sized with `factory estimate --from-design <run>` or built with `factory start --project <p> --from-design <run>`, without drawing it again. The web screens have the same choice under New run, Design. Once approved, `factory design export <run>` (or the Export panel on the run's Design tab) writes PNGs, a PDF design book, the demo, tokens, JSON and `figma.json` to `<run>/exports/vN/<n>/`; add `--design-export png,pdf` to `factory design start`, `factory estimate` or `factory start` to export as soon as the design is approved. An approved estimate also gets the design book beside its client workbook.

**Into Figma, on any plan.** `factory design export <run> --format figma` (or Figma in the Export panel) writes `figma.json`: every screen and state as frames with auto layout, text and icons, the tokens as variables, the controls as component sets, and the approved pictures as hidden reference layers. It needs no Figma token or paid seat. Install the plugin once in the Figma desktop app: Plugins > Development > Import plugin from manifest..., then pick `figma-plugin/manifest.json` (or the manifest in the Export panel's plugin zip). Then, in any file you can edit, run Plugins > Development > AI Factory Import and choose `figma.json`. See `figma-plugin/README.md`.

**Estimating instead of building.** `factory estimate` takes requirements (a prompt, `--file` as Markdown, text or Word, `--frames` for exported Figma frames, or `--jira`; and design references via `--ref`: any image, an https link, a Figma link (needs `FIGMA_TOKEN`, a Figma personal access token, in `~/.factory/.env`), a Figma JSON export, a PDF or a Word document, with an optional role and note; e.g. `--ref "layout:dash.jpg|table like this"`) and produces an effort, API-cost and elapsed-time estimate of delivering them through the factory. By default a person answers the clarify questions and approves the estimate (on the terminal, or on the run page). Add `--hands-off` (or set `estimate.humanReview: false` in the project config) to opt out: clarify asks nobody (each open question becomes a labelled assumption with its recommended answer) and the factory approves the estimate once its gates pass. A build never follows a hands-off estimate (`--from-estimate` refuses it), since a build is held to a budget a person approved. Every estimate is solely agentic. A request with UI also waits for a person to approve its design. Then two workbooks (team and client) are written under the run's `export/` folder. See `docs/estimates-design.md`. The workbooks are drawn on Folio3's estimation template, which the repo ships with its text cleared (`src/estimate/assets/estimation-template.xlsx`), so nothing needs setting. To use a newer template file instead, set `estimateTemplate: /path/to/Example_Estimation.xlsx` in the project config (or `FACTORY_ESTIMATE_TEMPLATE` in the environment).

```bash
factory estimate --file requirements.docx --project shop-api --no-repo --rate backend=55 --rate default=40
factory estimate --file requirements.docx            # a lead answers the questions and approves it:
factory approve <run> <hash> --sign-off EST-4     # low-confidence lines need a sign-off
factory estimate --file requirements.docx --hands-off # opt out: the factory approves (not buildable)
factory waive <run> <hash> --reason "why"         # estimate gates E1c, E3, E4, E5; build gates B1, B3, B4, B6, B7
factory waive-budget <run> <hash> --reason "why"  # B5: let a run past its approved estimate go on to a higher limit
factory edit-estimate <run> <hash> --anchor EST-1=6-12 --reason "why"   # recomputes, new card
factory estimate --revises <run> --file changed.md --project shop-api   # a change request (v2)
factory start --from-estimate <run> --project shop-api                  # build it, held to the estimate
factory estimate --file requirements.md --fresh                         # ask the model again, ignoring stored answers
```

The same requirements, model and settings reuse the stored model answers from an earlier estimate (no model call), so the same input gives the same estimate; `--fresh` skips that. See `docs/estimate-consistency.md`.

**6. Get the result**

The change is on branch `factory/<run>` in the Ubuntu copy. Automatic PRs support GitHub only for now (set `forge:` in the config); otherwise push the branch and open the PR yourself with the text the factory wrote:

```bash
git -C ~/code/shop-api push origin factory/<run>
factory show-card <run> --pr       # paste this as the PR description
```

### What the repo needs (POC)

- .NET on Linux: .NET 6+ (not .NET Framework, WPF or WinForms).
- Tests run with `dotnet test`, from a test project (xUnit, NUnit or MSTest). A repo with no test project builds, but its baseline has 0 tests and `valid=false`.
- A solution or project the factory can find: at the repo root, a single one below it, or named in `dotnet.solution`.
- Postgres, or no database. The factory starts a throwaway Postgres for the tests.
- **Refused for now:** SQL Server; tests that start their own containers (Testcontainers).
- **Not provided yet:** other services the tests need (Redis, queues…), private NuGet feeds.
- Endpoints behind a login: acceptance evidence comes from the locked tests only (test users aren't built yet).

---

## Web screens

```bash
factory ui           # prints a link like http://127.0.0.1:4321/?t=… ; open it in your browser
```

A local web app to start runs and watch them. Cards show the exact command to paste, with a copy button. Only an estimate run's cards are decided on the page: its question card and its estimate card (a typed name and the card's hash). Every other decision, including approving a design, answering a build run's questions and accepting a fidelity baseline, is made in your terminal; the page shows the command.

| Screen | What it shows |
|---|---|
| New run | Brownfield, Estimate or Design (Greenfield isn't built yet) → project → prompt, a dropped `.md` file (up to 1 MB) and/or a Jira key → optional max cost. Estimate runs also take exported Figma frames and their run settings. Every mode has a "Design references" section: drop pictures, PDFs, Word or Figma JSON files, or add https and Figma links, each with a role and note. The request is checked before a run exists, the same way `factory start` checks it. A second run on a busy project is refused. |
| Run: Interactive | The pipeline as a chain of steps. Click one for its attempts, why it retried, its gates, cost and time. Also shows cost against the limit, gates, the open card with its command, and the latest activity. |
| Run: Graphical | Charts: cost per step, time per step, cost over time against the limit, retries per step. |
| Run: Statistical | Totals: cost, limit left, machine vs wall-clock time, attempts, first-time pass, gates, human stops, tokens. |
| Run: Text | Every ledger event, filterable by step, type and search, with live follow; click one for its details. Also the trace lines. |
| Run: Design | How big the UI change is and why, and the app's pages and building blocks ("no web UI found" for a .NET-only repo). |
| Run: Preview | Clickable demo of a UI estimate's approved screens, and the attached Figma frames against the screens that cite them: phone/tablet/desktop widths, a screen list, a gallery with a before/after slider. For an estimate run it shows the demo (its states, dialogs, menus and toasts, and links between screens) and its screenshots; the preview folder also holds the look as design tokens (`tokens.css`, `tokens.json`). With nothing to show, it says so. |
| Dashboard | Outcome numbers across runs (like `factory report --all`), per-stage bars, recent runs. |

Safety: it only listens on this computer (127.0.0.1), needs the key from the printed link (a new one each start), refuses requests from other websites, and never sends keys or `.env` values to the browser (ledger text is secret-masked). A preview runs in a locked frame that can't reach the app, the network or your files.

Screenshots of every screen, dark and light: [docs/screens](docs/screens/). For example, [a running run](docs/screens/run-running-dark.jpg), [its charts](docs/screens/run-graphical-dark.jpg), [the dashboard](docs/screens/dashboard-light.jpg) and [a preview](docs/screens/preview-dark.jpg).

---

## Start runs from Jira

`factory watch` starts a run when someone you trust adds a label to a Jira ticket. It posts updates on the ticket and in Slack as the run goes. It **never answers questions or approves plans**: those cards still wait for a person in the terminal, and the Slack message says which command to run.

**Set-up (once per project):**

1. **Jira login** in `~/.factory/.env` (the same as `--jira`): `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` (id.atlassian.com → Security → Create API token).
2. **Slack (optional):** in Slack, create an app for your workspace, turn on *Incoming Webhooks*, add a webhook for the channel, and put its URL in `~/.factory/.env`, e.g. `SHOP_SLACK_WEBHOOK=https://hooks.slack.com/services/...`. Use an app webhook, not the old "custom integration" kind.
3. **Project config:** add a `jira:` block (and `notify:` for Slack). See `docs/project-example.yaml`. The important parts:
   - `project`: the Jira project key, e.g. `SHOP`.
   - `label`: the label that starts a run (default `factory`).
   - `allowedReporters`: the emails or Jira account ids of the people whose label counts. Anyone else's label is ignored.
4. `factory doctor` checks that the Jira login and the Slack webhook are set in `~/.factory/.env` (it doesn't contact Jira or Slack). `factory watch --project <p> --once` tries them for real.

**Run it:**

```bash
factory watch --project shop-api          # checks every minute; Ctrl+C stops it
factory watch --project shop-api --once   # check once, to try the set-up
```

**This computer must stay awake and online while the watcher runs.** It checks Jira from here, and the runs happen here. If the laptop sleeps, nothing starts until it wakes up. Tickets aren't lost: they wait. The watcher finds newly labelled tickets with a search for recent changes, and keeps every ticket that has to wait (busy repo, budget, daily run limit) in `~/.factory/watch/<project>.json`, looking each one up by its key on every check until it starts, oldest first. A waiting ticket stops waiting if its label is removed or it leaves "To Do".

**What it does with a ticket:**
- Starts it only if the label was added by someone on the allowed list, the ticket is in a "To Do" status, and it isn't an epic or a sub-task. The description must also say enough (80 characters or more). The allowed list is checked first: a ticket labelled by anyone else gets no comment at all. For an allowed person's ticket that is skipped, it posts one comment saying why.
- Starts **one run at a time** per repo. The next ticket waits until the current run stops for a person (a question or approval card), is delivered, or stops.
- Each run is capped at `maxCostPerRun` (default $3), like `--max-cost`. On top of that are daily and monthly budgets (`dailyBudgetUsd`, default $10; `monthlyBudgetUsd`, default $100) and `maxRunsPerDay` (default 3). When a budget is used up, it starts nothing more, says so once a day in Slack and once on each waiting ticket, and picks them up when the budget allows.
- A ticket runs once. To run it again, remove the label and add it again after its run has finished. Editing the ticket alone doesn't re-run it. If the watcher is stopped at the moment it starts a run, it finds that run when it comes back; if no run was created, it leaves the ticket alone (only its log says so) rather than risk a second paid run: remove and add the label to try again.
- The run's request is the ticket's summary, description and latest comments, but only comments by people on the allowed list (anyone can comment on a ticket). `factory start --jira` and a Jira key in `factory ui` do the same for a project with a `jira:` block.

**What people see:**
- Jira comments when the run starts, when a card waits for a person (with the command), when it stops and needs a look, and when it's delivered (the branch or pull request, the cost, and how many checks passed).
- The same in Slack, as text and links. There are no buttons: decisions stay in the terminal.
- **No code and no diffs are ever posted** to Jira or Slack.

With a GitHub `forge:`, the pull request title and the branch carry the ticket key (Jira's GitHub app links them). The factory's own review is posted on the PR, then the PR is marked ready for review.

---

## Command reference

| Command | What it does |
|---|---|
| `factory doctor` | Checks Node, containers, secrets, the key proxy and projects. |
| `factory selftest` | Free end-to-end check: one full run on a small sample repo with scripted AI answers. `--keep` keeps the sample for a look. |
| `factory smoke` | Cheap real check of every paid connection (each model, the key proxy, the coding agent). A few cents. Run it after adding or changing keys. |
| `factory init <repo>` | Adds a project: copies the repo into Linux if needed, detects settings, writes the config. |
| `factory mcp` | Runs the MCP server for Claude Code (registered by setup). |
| `factory baseline --project <p>` | Builds and tests the untouched repo in the test lab. No AI. |
| `factory start "<request>" --project <p> [--max-cost <usd>]` | Creates a run and executes until a card, a park or delivery. `--max-cost` lowers this run's spend limit: at that amount the run stops and asks you. |
| `factory start --file request.md --project <p>` | Same, with the request from a Markdown or text file. |
| `factory start --jira ABC-123 --project <p>` | Same, with the request from a Jira ticket (key or link): summary, description and latest comments (only from allowed people when the project has a `jira:` block). Needs Jira set up in `~/.factory/.env`. |

| `factory status [run]` | All recent runs, or one run's steps, cost and open card. |
| `factory show-card <run> [--pr]` | Prints the open card (or the PR text). |
| `factory answer <run> <hash> Q-1=A …` | Answers a question card. Terminal only. |
| `factory approve <run> <hash> [--note]` | Approves the plan. Terminal only. |
| `factory approve <run> <hash> --reject "<reason>"` | Rejects the plan: the spec and plan are revised with your reason and you get a new card. A second rejection parks the run. Terminal only. (`factory reject … --reason` does the same.) |
| `factory resume <run>` | Continues a run (after a park, crash or restart). |
| `factory waive-budget <run> <hash> --reason <text> [--ceiling <n>]` | Lets a run that reached its approved estimate (gate B5) continue to a higher limit, a multiple of the approved maximum (default: the card's suggestion, 25% more). Recorded with your name and reason. Terminal only. |
| `factory waive-cap <run> <hash>` | Accepts going past a limit (cost, time or attempts) shown on a limit card, and continues. Uses the card's suggestion unless you give `--cost`, `--minutes` or `--attempts`. Terminal only. |
| `factory pause <run>` / `stop <run>` | Pauses or stops at the next step boundary. |
| `factory steer <run> <file>` | Records a requirement change (applying it isn't built yet). |
| `factory verify-evidence <run>` | Re-runs every gate decision from the ledger. |
| `factory watch --project <p> [--once]` | Starts runs from Jira tickets labelled by allowed people, and posts updates to Jira and Slack. Decisions stay in the terminal. See *Start runs from Jira*. |
| `factory ui [--port <n>]` | Local web screens: start runs and watch them live (four views per run, dashboard, design, preview), and estimate runs with an Estimate tab (totals, tasks, API cost, screens, workbook downloads, plus DRAFT workbooks before approval). The estimate form can attach design frames, the demo page draws each screen as a themed page with its states and a Full data tab (wireframes only where a screen has no sample content), the Design tab has an Export panel for an approved design (formats, screens, states, widths, modes, languages, design version; earlier exports to download) and a Code panel (the UI target and why, the scaffold's screens, containers and files, another target to preview, Generate with a zip to run in fixture mode), and the New run form can export on approval like `--design-export` and pick a build's UI target like `--ui-target`. The screens work at phone width (375 px) with no sideways scroll. The Estimate form can start from an approved design run (`--from-design`), a change request to an approved estimate (`--revises`) or the other delivery model (`--from-run`), and can ask the model again (`--fresh`); a Brownfield build can start from an approved estimate or design run; the references section has a Check references button (`factory design check-refs`); approved Design and Estimate tabs have Next buttons that open these forms. It also shows build screenshots before/after with a pixel diff when `design.capture` is set. Plan approvals, answers and waivers stay in the terminal; the estimate lead can approve or reject an estimate on its Estimate tab, and approve or send back the design card on the run page (a send-back needs a reason; only what it points at is fixed, or the design is redrawn if that is what it needs). |
| `factory estimate …` | Estimates requirements instead of building them; the estimate commands (`approve`, `waive`, `edit-estimate`, `--revises`, `--hands-off`) are in *Use it on your own .NET repo*. |
| `factory start … --from-estimate <run>` | Builds an approved estimate, held to it by gates B1-B7. |
| `factory waive <run> <hash> --reason <text>` | Waives a waivable gate (estimate E1c, E3-E5; build B1, B3, B4, B6, B7) with your name and reason. Terminal only. |
| `factory edit-estimate <run> <hash> --anchor EST-1=6-12 --reason <text>` | Edits an estimate's anchors or ratios; recomputed in code, no model call, new card. Terminal only. |
| `factory calibrate [--actual-hours <file>] [--decisions]` | Compares approved estimates with what the factory spent and, with a file of `estimate-run,actual-hours` lines, with real hours. `--decisions` prints each logged size pick paired with what its build took, one JSON line each (docs/estimate-consistency.md, section 11). Changes nothing. |
| `factory calibrate --tune` / `--apply` / `--history` | After every estimate and build the factory proposes a tuned task catalogue in the background; nothing is sized from it until a person promotes it (docs/estimate-consistency.md, section 14). `--tune` shows what the tuning would change; `--apply` promotes it as a new version; `--history` lists the versions, why each changed, and a waiting proposal. |
| `factory logs <run> [-f] [--step <key>]` | Prints a run's log; `-f` follows it. |
| `factory report [run] [--all] [--json]` | Step scorecard for one run. Across runs (`--all`): outcome numbers first (delivered, cost per delivered change, time from request to branch, human stops, first-time pass), then a per-stage table. `--all --json` prints `{outcomes, stages}`. From the ledgers only, no AI. |
| `factory design start "<requirements>" [--project <p>] [--ref <ref>]…` | Design only: clarifies the requirements, writes the spec and draws the design (mock, clickable demo, look) from them and any references, then stops at the design card. Nothing is sized or built. Takes `--file`, `--jira`, `--frames`, `--client`, `--project-name`, `--no-repo`, `--max-cost`. Without `--project` the design is for a new product. |
| `factory design show <run> [--json]` | A run's design: stage (drafting, waiting for approval, approved), look, references with their colours and fonts, screens, and where the demo, screenshots and tokens are. Works on estimate runs too. |
| `factory design list [--all]` | Design runs with their stage, screens and cost (`--all` adds estimate runs). |
| `factory design open <run>` | Opens the run's clickable demo in your browser. |
| `factory design check-refs <ref>…` | Reads references as `--ref` would, without a run, a model or any cost: pictures, colours, fonts and corners found, or why one cannot be read. `--out <dir>` saves the pictures. |
| `factory design export <run> [--format png,pdf,html,tokens,json,figma\|all] [--version vN] [--pdf-per-screen] [--out <dir>]` | Exports the approved design: pictures, a PDF design book (or one PDF per screen), the clickable demo as a zip, tokens (W3C, CSS, Tailwind) and the design as JSON. Filters: `--screens`, `--states`, `--widths`, `--mode`, `--lang`. Each export goes to its own folder, `<run>/exports/vN/<n>/`: `vN` is the design version (`--version` picks another version of the same design), `<n>` counts the exports of it, and nothing is overwritten. Every file is tagged with the design's version and sha. `figma` writes `figma.json` for the AI Factory Import plugin (see below). |
| `factory design export list <run>` | A run's earlier exports, newest first, with their version, formats and folder. |
| `factory design kit list` / `factory design kit show [next-shadcn\|vite-shadcn]` | The UI kits, and what a target's kit has: framework, paths, packages, the component that draws each block, field kind and layer, and how blocks change with width. `--json`. |
| `factory design target <repo> [--ref <ref>] [--project <p>]` | Which UI target a build in that repo would use and why (the project's setting, or detection: Next.js or Vite with React takes the kit, another UI library keeps its own components). `--json`. |
| `factory design scaffold [run] [--target <t>] [--out <dir>] [--files]` | The files a build writes for a run's approved design: the kit, the theme, each screen's page, sample data and container (the agents' file), routes and frame, and the design-system task's to-dos. `--out` writes them (open any state with `?fixture=S-3:empty`); `--sample` uses a built-in sample design. `--json`. |
| `factory design fidelity <run> [--url <base>] [--json]` | The run's check of the built app against the approved design: each level (tokens, structure, accessibility block; layout, pixels advise), the findings and pages. `--url` checks an app you started (in fixture mode), without gates. |
| `factory design baseline <run> [pages…] [--all] --reason "…"` / `--list` | Accepts the run's built pictures as the design line's baseline (the next check compares pixels with them), recorded in the ledger with your name and reason. Needs a terminal. `--list` shows what is accepted. |
| `factory start … --ui-target <next-shadcn\|vite-shadcn\|repo>` | What the approved design is built in when the project's `design.uiTarget` sets nothing; otherwise detected from the repo. |
| `factory estimate --from-design <run>` / `factory start --project <p> --from-design <run>` | Sizes or builds an approved design run without drawing it again: its spec and approved design carry over (a build needs a design run made with that project). |
| `factory design inventory <repo>` | Scans a web app's look: theme settings, shared components and how often each is used, pages. No AI. |
| `factory design size` | Says how big a UI change is (no UI, screen tweak, new screen, or a change to the shared look), from a plan's file list or a git diff, with reasons. |
| `factory design lint` | Checks a change uses only the theme's colours and the app's existing components, and adds no new shared components. |
| `factory design brief <file>` | Cleans a design brief from outside (a Figma export, a brand guide) down to plain fields and shows what it dropped. |
| `factory design pixel <before> <after> --out <dir>` | Compares same-named screenshots in two folders and prints how much of each differs. Facts, not pass or fail. |

Run any `factory design` command with `--help` for its options.

The request can come from **any one** of a typed prompt, `--file` or `--jira`, or several at once (they're combined into one request, each part labelled). Up to about 25 KB of text in total; more is refused before anything is spent.

Decisions (`answer`, `approve`, `reject`, `steer`, `waive`, `waive-budget`, `waive-cap`, `edit-estimate`) only work from an interactive terminal, so no script, plugin or AI can approve its own plan.

---

## Use it from Claude Code

Setup registers an MCP server called **ai-factory** in Claude Code (if you have Claude Code installed). In any Claude Code session you can say things like *"start a factory run on shop-api to return 404 for missing orders"* or *"what's the status of my factory run?"*.

| Tool | Does |
|---|---|
| `factory_projects` | Lists your projects. |
| `factory_start` | Starts a run in the background. |
| `factory_status` | Shows a run (or recent runs). |
| `factory_show_card` | Shows the open card or the PR text. |
| `factory_verify_evidence` | Re-checks a run's decisions. |

By design it **can't approve plans**, and an MCP client can't answer questions. Those happen in your own terminal (`factory answer`, `factory approve`), so no AI can approve its own plan. The one web exception is the estimate lead, who can answer an estimate run's questions and approve its estimate on the `factory ui` run page (typed name and card hash required).

---

## Safety model

| Rule | How it's enforced |
|---|---|
| Your code stays on your machine | Repos live in local clones; only the model APIs you configure receive code. |
| Keys stay out of the AI's reach | Keys live only in `~/.factory/.env`. The coding container talks to a small factory proxy that adds the key; the container never holds it. |
| No internet for the AI | The coding container can reach only the model API through that proxy. Builds and tests run with no network at all. Package restore can reach only allowlisted feeds. |
| Repo code never runs on your host | The factory's own git disables hooks and filters; builds and tests run only in containers. |
| No live secrets where the AI works | Secret files are hidden from AI steps; the coding container gets dummy settings; packs are secret-scanned and redacted. |
| Client agent files don't steer the AI | `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.mcp.json`… are masked in the coding container; loading one fails the step. |
| Tests can't be weakened | Locked by fingerprint; test projects and runner config are protected; every expected test must actually run. |
| Nothing unverified ships | Pushed code = the exact commit the gates judged + one manifest-only commit. |
| Test database is disposable | A fresh Postgres per check, reachable only from the test container, with a non-superuser login. |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No usable container runtime` | Run `bash ~/ai-factory/scripts/setup.sh` again. Mac: `colima start`. Windows/Linux: `sudo systemctl start docker`. |
| `Docker Desktop is answering…` | Mac: `docker context use colima`. Windows: in Docker Desktop settings untick Ubuntu under WSL integration (or quit Docker Desktop). |
| `permission denied … /var/run/docker.sock` | Open a new terminal (setup added you to the `docker` group). Still failing on Windows: `wsl --shutdown` in PowerShell, reopen Ubuntu. |
| `Path … is on a Windows drive` | Use `factory init <path>`; it copies the repo into Ubuntu for you. |
| `X is missing in ~/.factory/.env` | Add that variable to `~/.factory/.env`. |
| `The untouched repo doesn't build in the test lab` | Check `dotnet.sdkImage` matches the repo's framework; check private NuGet feeds (not supported yet). |
| `baseline`: `MSB1003: Specify a project or solution file` | The factory couldn't find what to build. Set `dotnet.solution` in the project config to the `.sln` or `.csproj` path (relative to the repo root). |
| `baseline`: `Several solutions…` / `No solution file and several projects…` | Set `dotnet.solution`, or add a `.sln` at the repo root that includes the projects (`dotnet new sln` + `dotnet sln add …`). |
| `baseline`: `0 tests … valid=false` | The build worked but the repo has no test project. Add one (`dotnet new xunit`) and include it in the solution. The "verifying workloads" line in the log is a harmless SDK warning. |
| Many tests fail in `baseline` | Check whether they fail on your machine too. If yes, they're pre-existing and remembered. If not, compare DB settings (`database:`) and seed data. |
| `Repo is busy: run … is executing` | Only one run executes per repo at a time. Wait, or `factory stop` the other run. |
| A run is `parked` | `factory status <run>` shows why; fix it and `factory resume <run>`. |
| A file (e.g. `scripts/setup.sh`) keeps showing as changed, and comes back after *Discard* | VS Code is using Windows Git on the Ubuntu folder, which can't keep Linux's executable flag. Close that window, run `cd ~/ai-factory && code .` in the Ubuntu terminal (bottom-left must say *WSL: Ubuntu*), and run `git config core.fileMode false` once in the folder. |
| `.env` not visible in VS Code | It's in `~/.factory/`, not the project. `code ~/.factory/.env`. |
| Git asks for a password (Windows) | GitHub needs a token, not your password. Re-run `install.ps1`; it connects Ubuntu's git to your Windows GitHub sign-in. |
| Mac: builds are slow or run out of memory | `colima stop && colima start --cpu 6 --memory 12` |

Everything a run did is in `~/.factory/ledger/<run>/` (`events.jsonl` plus content-addressed artifacts and cards).

---

## Project layout

```
ai-factory/
├── src/
│   ├── contracts/   zod schemas: artifacts, ledger events, packs, test results
│   ├── ledger/      run manager: append-only ledger, locks, replay, caps, hardened git
│   ├── gates/       gate engine: pure checks, lock set, failure ladder, policy merge
│   ├── verify/      test lab: container runtime, .NET producer, TRX parsing
│   ├── context/     context builder: snapshot, read-only tools, repo map, redaction
│   ├── runners/     model runners: own read-only loop (API), Claude agent in a container, proxy
│   ├── stages/      the pipeline steps and the executor (build and estimate)
│   ├── estimate/    estimate mode: hours, cost, durations, gates E1-E7 and B1-B7, workbooks
│   ├── design/      design toolkit: app scan, UI change size, style checks, brief cleaner
│   ├── sources/     request inputs: .docx, exported Figma frames, Jira, design references (images, sites, Figma, PDF, Word)
│   ├── watch/       Jira and Slack watcher
│   ├── ui/          the local web screens (`factory ui`)
│   ├── mcp/         the MCP server for Claude Code
│   ├── selftest/    the free end-to-end check
│   ├── config/      project config and secrets loading
│   └── cli/         the `factory` command
├── bench/           benchmarks for the estimates path: calibration, gate cases, pinned public data
├── tests/           browser tests of the web screens (Playwright)
├── scripts/setup.sh  one-command setup (macOS, Ubuntu, WSL)
├── install.ps1       Windows installer (WSL + Ubuntu, then setup.sh)
├── docker/
│   ├── agent/       the coding container image (.NET SDK + Node + Claude Agent SDK)
│   └── proxy/       the egress proxy (adds API keys, allowlists package feeds)
└── docs/
    ├── design/      the design documents
    ├── design-step.md  where the design step plugs in, and what's still to wire
    ├── estimates-overview.md, estimates-design.md  the estimates path
    ├── estimate-consistency.md, estimate-local-model.md  research: repeatable estimates, a local sizing model
    ├── design-eval/ how the design toolkit scored on real Next.js commits
    └── project-example.yaml
```

Factory data lives outside the repo, in `~/.factory/`:

```
~/.factory/
├── .env             your secrets (you create it)
├── projects/        one YAML per target repo
├── ledger/<run>/    the evidence for each run
├── repos/<project>/ remembered baselines
├── wt/              git worktrees of running runs
└── tmp/             per-run package caches
```

---

## Development

```bash
npm test             # all tests, offline: no model calls, no Docker needed
npm run typecheck
npm run build
npm run bench        # estimate benchmarks: calibration and gate cases, read-only (see bench/README.md)
npm run test:bench   # the benchmarks' own tests
npm run test:ui      # the web screens in a real browser (Playwright, run in Docker: nothing to install)
npm run screens      # retake docs/screens/*.jpg, dark and light
```

- TypeScript (strict, ESM), Node 22, zod 4 as the single schema source, vitest.
- `src/stages/e2e.test.ts` runs the whole pipeline with a scripted model and a fake container runtime. Start there to understand the flow.
- Keep commits small; every module has tests next to it (`*.test.ts`).

## Design docs

Start with [`docs/design/BUILD-BRIEF.md`](docs/design/BUILD-BRIEF.md), then [`docs/design/stages-aligned.md`](docs/design/stages-aligned.md) (the source of truth for stages). Component designs: run manager, gate engine, verify runner, context builder, adapters. The design step for UI changes is in [`docs/design-step.md`](docs/design-step.md), with its test results in [`docs/design-eval/results.md`](docs/design-eval/results.md). Test-lab speed-ups (each commit built once, Integrate reusing the task's run, known failures skipped), before and after: [`docs/design/test-lab-reuse.md`](docs/design/test-lab-reuse.md).

The estimates path: [`docs/estimates-overview.md`](docs/estimates-overview.md) (one page), then [`docs/estimates-design.md`](docs/estimates-design.md) (the design, and its build status at the end). Why estimates can vary and what repeats them: [`docs/estimate-consistency.md`](docs/estimate-consistency.md); a local sizing model (research only): [`docs/estimate-local-model.md`](docs/estimate-local-model.md). Benchmarks and pinned public data: [`bench/README.md`](bench/README.md), [`bench/external/README.md`](bench/external/README.md). First real runs: [`docs/runs/2026-09-30-first-real-runs.md`](docs/runs/2026-09-30-first-real-runs.md).

---

**Status:** experimental proof of concept. Use it on repos and branches where a wrong change costs nothing, read every approval card, and review every PR before merging.
