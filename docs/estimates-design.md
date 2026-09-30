# The estimates path: design (2026-09-30)

## Summary

The factory gets an **estimate mode**. From a client's refined requirements (a new project) or from a repo plus a request (an existing project), it produces the estimate, in the general estimation workbook template (the one Folio3 uses), of the effort and cost to deliver the work **through the factory workflow**. A lead approves it in the terminal. The mode runs end to end (see "Build status" at the end): `factory estimate` takes requirements, a large document is specified per module, and a lead's approval leads to two workbooks.

**The run starts by choosing a delivery model.** Each model gets its own estimate, and the agentic one is smaller:

| | Option 1: HITL (supervisor + agents) | Option 2: Solely agentic |
|---|---|---|
| Who works | Agents build; a human supervisor gates and reviews | Agents run the whole workflow with no supervisor gates |
| Human hours | Clarify answers, approval card, lead review of every PR, parked runs, waivers, plus client-side work | Client-side work only: **client UAT, design approval, PM** (these stay in both models) |
| Factory running cost | Yes | Yes, higher share of the total |
| Elapsed time | Includes the gate and review queue | Agent time plus client waits |

Every estimate states three things:
- **Effort (hours):** human time the model needs. It is never modelled per task confirmation.
- **Cost in API credits (dollars):** what the factory spends on planning, specify, design, build and verification, calibrated from measured runs (see "Cost in API credits").
- **Elapsed time:** the critical path, with planning time shown separately.

There is one set of Min and Max columns per estimate. Human-only sizing stays internal.

The estimate:
- works for any project size and any stack (React, Next, Nest and .NET first);
- runs only after the requirements are refined;
- uses no seed table of hours: hours come from the project's own tasks, sized against anchors the model proposes;
- is checked by gates against scope creep and gold plating, at estimate time and during the build;
- is exported by code as two workbooks from one data model.

## Request types

| Type | Where the hours go | First estimate |
|---|---|---|
| New project | Building everything: setup, architecture, features, design | Full workbook |
| Feature in an existing repo | Understanding the area, changes by file scope, regression | Full workbook; onboarding replaces architecture |
| Bug fix | Finding the cause; the fix is usually small | **Diagnosis only**, with a wide range; the fix is quoted after diagnosis |
| Upgrade | Breaking changes and repairing what breaks | Workbook with a usage inventory |
| Migration | Converting every unit, plus data and cut-over | Workbook with an inventory; a sample sets the per-unit cost |
| Takeover | Reading, running, documenting | Audit estimate and a risk register; the full estimate comes after the audit |

## The pipeline

```
intake → [discover, ground: existing repo] → clarify → spec drafts → merge → specify (E1)
       → design: mock + clickable demo (UI only) → design baseline approved (E1b)
       → breakdown → estimate → gates E2–E6 → lead approval (E7) → export
```

| Step | New or reused | What it does |
|---|---|---|
| intake, ground, clarify, drafts, merge, specify | Reused | Produce the refined spec. Large documents are specified **per module** |
| discover (existing repo) | Reused, needs a stack-agnostic read | See "Prerequisites" |
| design (mock and clickable demo) | Reused, **to be hardened** | Screens linked to requirements; the approved mock and demo are the **baseline of the estimate** for UI work. See "Design baseline" |
| **breakdown** | New | Requirements → features → tasks (functionality identification) |
| **estimate** | New | Size band, anchors, sizing, one or three estimators, merge |
| **estimate gates** | New | E2–E6, defined with `defineGate` |
| **approve-estimate** | New (same card mechanism) | The lead approves in a terminal, tied to the estimate's hash |
| **export** | New | Deterministic code writes the two workbooks |

The estimate does not start until the spec passes lint, critic, round trip and has no open questions (gate E1), and, for any request with UI, the mock and clickable demo are approved (gate E1b). If it doesn't, the run goes back to clarify. It does not produce a soft estimate.

## Inputs

| Group | Examples | Handling |
|---|---|---|
| Request | One line, brief, transcript, PRD or spec, RFP, tickets | Untrusted text; read-only steps only |
| Design | Nothing, wireframes, exported Figma frames, screenshots, brand guide | Cleaned to typed fields; screens, routes and states are counted |
| Existing system | **The repo (the only artefact)** | Read in the locked room with no network |
| Context | Stack, platforms, compliance, hosting, client policy | Project config, plus clarify for what is missing |
| Run settings | **Delivery model (HITL or solely agentic; chosen at the start)**, stack source, Design in total, feedback rounds, optional rates | Set by a person, recorded in the run |

Document intake accepts a **.docx** (text, tables, embedded images) and **pre-exported Figma frames** placed with the request. The environment is isolated, so links are not fetched.

**Stack source** is a run setting:
- **Client-specified:** a fixed constraint.
- **Folio3 decides:** the pipeline proposes a stack from decide-architecture. The lead sees it on the approval card, and changing it re-runs the estimate.
- **Undecided:** a default pack is used and stated as an assumption.

Required inputs by type:

| Type | Must have | Should have |
|---|---|---|
| New project | Request, target platforms | Design source, stack, compliance |
| Feature | Request, repo | Design system verdict, tests running |
| Bug fix | Symptom text, repo | Logs, steps to reproduce |
| Upgrade | Current and target versions, repo | Test suite, lockfile |
| Migration | Source and target, repo | Inventory of what moves, data volumes |
| Takeover | Repo access | Any docs, a running environment |

A missing "must have" doesn't block the run. It becomes a clarify question, and if unanswered, a labelled assumption.

Each input dimension (scope clarity, design availability, technical context, code access, constraints known) gets a grade: missing, vague, adequate or precise. The grades feed the internal uncertainty grade.

## Starting from requirements only

The common case for a new project: functional requirements have been gathered (notes, transcript, brief, .docx, email thread), but there is **no formal spec and no code**. The spec is something the pipeline produces, not an input.

1. **Intake** takes the raw requirements as untrusted text.
2. **Discover and ground are skipped**, because there is no repo.
3. **Clarify** asks the lead what the material cannot answer.
4. **Spec drafts, merge and specify** turn the answers into a spec, per module when it is large.
5. **E1** checks the spec. Only then do breakdown and estimate start.

| Missing | How it is handled |
|---|---|
| Code | Every task is new build work. Size comes from counted units in the spec, not from touched files. |
| Stack | The stack-source run setting applies: client-specified, Folio3 decides (proposed stack on the approval card), or undecided (default pack as a stated assumption, optional second scenario). |
| Design | The design step produces the mock and clickable demo first; the estimate waits for their approval (E1b). Design-in-total stays a Summary switch. |
| Tests | The factory builds them; there is no baseline to read. |

If the gathered requirements are too thin, E1 fails and the run goes back to clarify. There is no soft or guessed estimate. Each question the lead cannot answer becomes a labelled assumption in the workbook, or a scenario when one big unknown decides the size.

## Design baseline

The mock and clickable demo are the baseline the estimate stands on. Screen counts, states, flows, reused components and design-system changes all come from them, so a weak demo gives a weak estimate.

- **Gate E1b blocks the estimate** until a person approves the mock and clickable demo in a terminal, tied to their hash. Any request with no UI skips it.
- A change to an approved design is a change request (`factory estimate --revises <run>`): the design step is given the approved screens and keeps their ids and routes, and the design card lists the screens added, removed and changed. A build run that finds a new requirement after approval parks at B2 and points there. (Nothing watches an approved design for edits outside that path; the approved design is content-addressed and copied into the change, sibling and build runs, so it cannot change silently.)
- **The clickable demo is drawn by code, not a model** (`src/estimate/demo.ts`): one self-contained page with a panel per screen, a button per state, links between screens, the requirement text each screen serves, and any attached Figma frame the design cites in place of the wireframe. It is a walkable inventory, not a visual design: layout and styling are not drawn. The card gives its path (`design-demo.html` in the run folder); the same page is under `preview/` for `factory ui` (Run: Preview). The approval is tied to the design and the exact page.
- **Checks in code:** the design step fails on a screen id or route used twice, and on an attached image frame no screen cites (or a cited frame that is not attached). Gate E1c (after breakdown) fails a task whose `screen` is not in the approved design, an approved screen no task builds, and a duplicate id or route; it is waivable by a lead. The sibling run keeps the approved design and its approval; a build run inherits the design (`estimateRef.designSha`) and gate B6 fails a plan that leaves out an approved screen's factory tasks.
- What the demo must carry for the estimator: every screen and state, every navigation flow, form fields and validations visible, reuse of existing components marked, and each screen linked to its requirement ids.
- **Work needed on the design module first** (it is a dependency of the estimate, not a side task): richer clickable flows, screen states (empty, loading, error), a per-screen size class, requirement links on every screen, and the pending wiring listed in "Prerequisites". The existing eval (56 labelled commits, drift lint) is the measure of progress.

## Size measurement

Size is **counted from typed units**, not judged by feel. Code counts what it can. The model proposes units from text, and code checks each against a source quote.

| Unit | From text or design | From code |
|---|---|---|
| Requirements (atomic statements) | Spec, brief | – |
| Personas or roles | Spec, brief | Auth and role code |
| Features, modules | Spec headings, prototype flows | Folders and route structure |
| Screens and their states | **Approved mock and clickable demo** (primary), spec | Pages found by the design inventory |
| Data entities | Spec data dictionary | Schema, ORM models, migrations |
| Endpoints and jobs | Spec flows | Route files |
| Integrations | Named third parties | Dependencies, client libraries |
| Non-functional items | Compliance, load, security notes | Config, CI files |
| Touched surface (existing code) | – | Files in the plan, dependents, size of touched modules, shared components affected |

Each unit carries a **complexity flag** from a fixed list (standard, rules or algorithm, external dependency, compliance-sensitive, real-time, new to this stack). Counts alone are a weak size hint: a 112-statement post-session review with voice input is not comparable to a 13-statement listing.

**Work size** is one of five bands:

| Band | Meaning |
|---|---|
| XS | One small change (a bug, a text or config change) |
| S | One feature area, a handful of units, no new integration |
| M | Several feature areas in one platform or team |
| L | Multiple modules or platforms, integrations, more than one team |
| XL | A product or programme, delivered in phases |

The cut-offs are structural for now. Numeric cut-offs are set in config as labelled assumptions and tuned later.

**Uncertainty grade** (low, medium, high) comes from input quality, stack familiarity, unknown integrations and compliance, repo health, and design maturity. It stays internal.

What the band and grade decide:
- **Breakdown depth:** XS lists every task; L works epic → feature → task and goes deep where uncertainty is highest; XL is phased, with a discovery phase first.
- **Overheads:** which lines apply and how they scale.
- **Range width and contingency.**
- **One phase or several.**
- **Whether the lead sees a short card or a full workbook.**

The **forgotten-work check** runs after counting. A generic list (auth, roles, environments, CI/CD, monitoring, error handling, migrations, notifications, reports and exports, admin tools, accessibility, feedback rounds, documentation, release) is marked in, or out with a reason. A zero always has a reason.

## How the hours are built

No seed table and no pooled medians. Two reference workbooks showed some tasks stable across projects and others varying widely, and the team's own point stands: functionality, framework and design differ per project.

1. **Tasks come from the refined requirements.** Each task lists the concrete things in the spec it must deliver (fields and validations, screen states, rules, endpoints, messages, entities), each citing its requirement.
2. **Anchors:** the model proposes a few reference tasks, estimated in detail for this project's stack, design and constraints. Every other task is sized relative to an anchor, with the reason stated ("about twice the anchor: 12 fields instead of 6, plus a state machine"). Code computes anchor × ratio.
3. **Estimators:** XS and S use **one** estimator. M and up use **three** independent estimators, merged by code in the same pattern as `drafts` in the spec stage. Disagreement between them sets the range and flags the item.
4. **Executors:** each task is labelled **factory**, **joint** or **human**.
   - Factory tasks carry only the human time their gates cost, computed from counts. **In the solely agentic model this is zero.**
   - Joint tasks mix factory work with human steps (obtaining keys, store accounts).
   - Human tasks carry full hours (client UAT, design approval, PM, client environment work). These are in both models.
5. **Code computes** the arithmetic: totals, overheads, gate hours, weeks, both output files. The model never does sums.
6. **The lead reviews once**, at the final approval. The anchors are listed first on the card, with the reason for each. Any anchor or line can be edited there, and everything recomputes.

Where hours can hide a pooled average, the design shows the reasoning instead: anchors, ratios and reasons per task.

### Human hours in the workflow

Rows marked **HITL** exist only in the HITL model. In the solely agentic model the supervisor gates are removed, and only client-side and human-only tasks remain.

| Source | Depends on | Basis |
|---|---|---|
| Clarify answers (HITL) | Number of questions (at most 5, then 3) | Assumed minutes per question; per run |
| Approval card (HITL) | Requirements, files listed, critic findings on the card | Assumed reading time per section; per run |
| **Lead PR review** (HITL) | Diff size and risk class of each PR (auth, payments, personal data and migrations weigh more) | Assumed minutes per PR; **per PR** |
| Parked runs (HITL) | Expected share of tasks that exhaust the retry ladder | Assumed rate; each costs a lead intervention |
| Waivers (HITL) | Rare; counted only if expected | Zero by default |
| Human-only and joint tasks (both models) | The task list, including client UAT, design approval and PM | Sized from the anchors |

The number of PRs comes from grouping tasks. Fewer, larger PRs shorten the review queue and lengthen each review, and the estimate shows that choice. In HITL a lead reviews every PR before merge, so the queue sets duration. In the solely agentic model merges are automatic and duration is agent time plus client waits.

All times are labelled **assumed** and editable per run. The ledger's event log records when a card was shown and decided, so measured values can replace them later.

### Other outputs
- **Factory running cost:** see "Cost in API credits" below.
- **Elapsed time:** the critical path through dependencies and, in HITL, the gate queue. Waiting for external keys, accounts and approvals appears as a dependency in duration, not as effort.
- **QA:** the factory runs the full suite, so regression shrinks. Exploratory testing, device checks and UAT stay human. The QA share is computed from these, not typed in as a percentage.
- **Bug buffer:** its own assumption, tied to the parked-run rate and to misread requirements that pass every check.
- **PM, PDM, design review:** mostly unchanged, and shown as such.

### Scenarios
When one big unknown remains after clarify (for example, whether the admin portal is a web app or part of the mobile app), one estimate can carry **two scenarios** side by side, differing only in what that unknown changes. All other tasks are shared.

## Cost in API credits

Every estimate says how many dollars of API credits the run will spend, broken down by phase: planning (intake, clarify, specify, design), breakdown and estimate, build (per task), and verification and integration.

- **Measured, not guessed.** The ledger already records spend (`gen_ai.usage.cost_usd`) and wall minutes per step. A finished test run gives the first real numbers: how long planning took, and what it cost. Those measured values calibrate the cost model. This is calibration of the factory's own throughput, not a pooled table of task hours, so it does not conflict with the "no seed table" decision.
- **Model:** cost per phase comes from the counted size (requirements, screens, tasks, files touched) times measured cost per unit for that phase, with a range from the spread across measured runs.
- **Both delivery models show it.** Solely agentic carries a larger build-and-verify share because no human takes over parked runs.
- **Shown as a range, labelled indicative,** and separate from any client rate card. B5 tracks actual against it during the build.
- **First measured points** (from `docs/runs/2026-09-30-first-real-runs.md`; a real .NET repo, planted one-line and API bugs, light lane, per-run cost caps):

| Run | Cost | Active time | Outcome |
|---|---|---|---|
| Bug 1, light lane | $1.75 (plus about $0.3–0.6 unrecorded) | 28.5 min | Delivered: 1-line fix + 4 unit tests |
| Bug 1, before the light lane | $5.20 | 28 min | Stopped at the cost cap, no code |
| Bug 2, light lane | $1.33 | 18 min | Stopped by us in author-tests |
| Bug 1, plain agent (no factory) | $0.20 | 24 s | Fix with no test, never compiled (optimistic baseline) |

  What they already tell the estimate:
  - a **small fix costs about $1–2 and 20–30 minutes** through the factory, and the time is mostly the test lab (about 64%; coding agents about 20%, model calls about 16%);
  - the same fix without the factory costs about $0.20, so the factory's extra cost buys a locked failing test, sealed verification and evidence, and the estimate should show that as the price of the workflow;
  - **cost varies by more than 3x with the lane** ($5.20 versus $1.75 for the same bug), so cost must be estimated per lane and size class, not from one average;
  - spend is under-recorded for interrupted attempts (finding F7), so measured cost is a floor until that is fixed;
  - these are bug fixes only: nothing yet covers planning for a large feature, design, or a full build, so those phases stay **cold-start**.
- **Until enough data exists:** the model starts from the first test run and other available runs, marks values as assumed, and tightens as the ledger grows.

## Task duration: the internal harness

How long a task takes is not decided by the model's opinion. A **duration harness** evaluates each task class and returns a duration and cost range, and code uses it alongside the anchors.

Internal data is the source of truth. An external source is **optional and later**:

1. **Internal (self-benchmark).** Our own ledger: wall minutes, retries, cost and outcome per step and per task class, by stack and size. This is ground truth for the factory itself, and it improves with every run.
2. **External (optional, later).** A published benchmark of agent task time and reliability, added only if the ledger stays too thin for too long. Public benchmarks measure open-source or lab tasks, not client work, and the available estimators are unvalidated, so it is a weak prior at best. If ever added, it is a **pinned offline snapshot** in the repo with its version and provenance recorded, never a live call, since the runtime has no network. It is not part of the first build.

How they combine:
- The harness classifies each task (for example, standard CRUD screen, integration, rules-heavy logic, migration unit).
- It returns a duration and cost range per class from the internal data. Where the ledger has too few runs, the range is wide and labelled cold-start; it is not filled from an external source.
- Where the two disagree beyond a tolerance, the item is flagged on the approval card. The internal measurement wins once it has enough runs.
- The harness sets the **factory time** and **cost**. Human gate time, client UAT and PM still come from counts and anchors.
- The external option was researched at first pass (2026-09-30, from published docs only, nothing run) and is **not required for the build**:

| Candidate | Useful for us | Limit |
|---|---|---|
| agent-estimate (Apache 2.0) | Three-point ranges, XS–XL tiers, review overhead, a `calibrate` step that scores estimates against observed minutes | Its model limits (for example 90 min for Opus 4.7) are stated as unmeasured local policy; per-tier priors are not published; about 5 stars |
| agent-estimation (MIT) | Tool-call rounds as the unit, risk coefficient 1.0–2.0, about 3 minutes per round | Constants are defaults, with no independent validation |
| ACEM (MIT) | Cost from tokens, revision, context growth and HITL intensity; p10/p50/p90 bands; labels cold-start, partial, calibrated | The authors say every constant is a placeholder and the model is unvalidated |
| METR time horizons, SWE-bench Pro | Credible task-difficulty and resolve-rate priors, with public data | Well-specified open-source or lab tasks, no cost data for METR |

- **Decision:** the harness is internal-only for the build. It borrows the structures (three-point ranges, rounds, Monte Carlo bands, and the cold-start / partial / calibrated confidence label). No external candidate is adopted. Until enough ledger runs exist, every duration and cost is labelled **cold-start**.

### Internal benchmark record

Each finished step or task adds one record, taken from ledger events:
- run id, step or task class, stack, size band, delivery model;
- wall minutes, retries, tokens and dollars (`gen_ai.usage.cost_usd`), outcome;
- for the plan and design steps: counted units (requirements, screens, tasks), so cost per unit can be computed.

The harness reads these records and returns, per task class, a p10/p50/p90 range for duration and cost, with the record count and the confidence label. The first records are the summary numbers already recorded above. Every later run, including the first estimate runs, adds records automatically, so no separate data collection is needed to start.

## Gates

A gate is a pure check over ledger artifacts. It fails closed: a gate that could not check anything counts as failed. A person can waive only those marked waivable, in a terminal, and every waiver is recorded and shown on the next approval card.

### Estimate time

| # | Gate | Checks | Waiver |
|---|---|---|---|
| E1 | Readiness | Spec passes lint, critic, round trip; no open questions | None |
| E1b | Design baseline | For any request with UI, the mock and clickable demo are approved, and every screen links to a requirement | None |
| E1c | Design coverage | Every task's screen is in the approved design, every approved screen is built by a task, no screen id or route twice | Lead |
| E2 | Requirement → task | Every requirement has at least one task | None |
| E3 | Task → requirement | Every task cites a requirement, or a named overhead with a reason. Anything else is an extra and goes to a separate **Suggested, not included** block, outside the totals until the lead adds it | Lead |
| E4 | Forgotten-work checklist | Each generic item marked in, or out with a reason | Lead |
| E5 | Consistency | Similar tasks within a stated tolerance; no unexplained outlier | Lead |
| E6 | Workbook lint | Code recomputes every total and cross-sheet link; known template faults cannot appear | None |
| E7 | Lead approval | Terminal approval tied to the estimate's hash; low-confidence lines need sign-off. In the solely agentic model the approver is the client-side owner, not a supervisor gate in the build | None |

### During the build

| # | Gate | Checks | Hook |
|---|---|---|---|
| B1 | Scope lock | Every plan task maps to an approved estimate task | After plan; needs `estimateTaskId` on plan tasks |
| B2 | Change request | A new or changed requirement creates estimate v2 with a diff against v1 | New estimate run whose parent is the approved one; same approval |
| B3 | Size cap | Finished change is no bigger than approved | Extends `integrate.diff-size` and the design size-cap |
| B6 | Screens planned | Every approved screen that has a factory task is delivered by some plan task | After plan; needs the design in `estimateRef` |
| B4 | Unrequested behaviour | The diff traces to requirements; new behaviour with no requirement is flagged (extra screens, options, endpoints) | New review finding category |
| B5 | Budget burn | Effort, **API credit spend** and time so far against the approved figure | Extends the spend caps. Warn at **80% of the approved maximum**, stop at **100%** |

In the solely agentic model B1–B4 stay as automatic checks, and the B5 stop at 100% still ends the run for a person to decide. B1–B5 are waivable by a lead, with the reason recorded. All decisions (approve, reject, waive) happen in a terminal by a person, as elsewhere in the factory.

## Budget

A budget does not have to exist beforehand.
- **No budget:** the approved estimate is the baseline; approving it at E7 records the lead's number.
- **Budget known before or after:** it is an optional input. Code produces a **fit check** (over, under or within, and by how much). If over, it offers **scope options**: with the requirements' priorities (must, should, could), it shows the total with lower-priority items removed. The lead chooses, and that creates a new version through the change-request gate. Hours are never squeezed to fit.
- **API credit cost** is a headline number of the estimate (see "Cost in API credits"), and is also capped by the run policy.
- **Costing** is per project. Rates are an optional input and cost is labelled indicative, not a quote.

## The workbook

Two files come from one data model, so they cannot disagree.

| | Team file | Client file |
|---|---|---|
| The six template sheets | Yes | Yes |
| Confidence and uncertainty grade | Yes (extra sheet) | No |
| Anchors and ratios | Yes (extra sheet) | No |
| Requirements and traceability | Yes (extra sheet) | No |
| Assumed parameters, gate and waiver log | Yes (extra sheets) | Parameters block on Summary only |
| Cost overlay | Yes, if rates were given | No: hours only |

**All six sheets are mandatory:** Summary, Backend, Mobile, Web, QA, Design. A track that is out of scope keeps its sheet with "Not in scope: reason" and zero totals.

### Development sheets (Backend, Mobile, Web)

| Col | Content |
|---|---|
| B | S.No |
| C | Task |
| D, E | Min, Max (hours) |
| F | Comments: what the task includes |
| G | Executor: Factory / Joint / Human |
| H | Requirement id(s) |

- Modules → tasks; module totals are `SUM` over the module's own rows.
- **Other Development Activities:** bug fixing (parameter %), deployment (staging, production, app store), lead PR review, code fixing after review, documentation; memory leaks for mobile only.
- Research tasks, Assumptions, Risks and the template Notes follow.
- Each piece of work appears in **one** sheet. Other sheets get a zero-hour reference row pointing to it.

### Summary
- **Header:** client, project, PM, date, version, mode.
- **Task summary:** one row per track (Backend, Mobile, Web/Admin, QA, GD, PM, PDM, Design) with Min, Max, Avg, resources, and weeks as a formula (hours ÷ 40 ÷ resources).
- **Total:** `SUM(track rows) + IF(include Design = "Yes", Design)`. The switch is a visible cell and the Design row always shows.
- **Delivery model** shown in the header, and one estimate per model.
- **Lines** for API credit cost (with a per-phase breakdown) and elapsed time (planning time shown apart).
- **Special considerations** filled from the inputs and clarify answers.
- **Assumptions and Risks** that are safe for the client.
- **Parameters block:** every percentage and rate the formulas use, in one place.

### QA and Design
- **QA:** test plan, environments, validation cycles (later cycles as fractions by rule), smoke tests, device and browser checks, UAT (from the rounds input), miscellaneous.
- **Design:** direction and moodboard; screen lines sized by the design classes (new screen, screen tweak, design-system change, reuse of existing components); feedback and revisions from the rounds input; design review; design QA on built screens. Rows that don't apply to design (memory leaks, deployment) are removed.

### Formula rules (gate E6)
- Every total is a formula over exact ranges, recomputed independently by code.
- No typed-in numbers where a sheet total exists.
- Every Summary row links to its sheet's own total.
- Notes and assumptions are generated per project, never copied from another sheet.
- A formula that points at an empty row fails the export.

The two reference workbooks contained these faults, which the rules block: a backend maximum that summed the minimum column into the maximum, Summary totals that left out rows or linked to different cells per track, typed-in durations and design totals, review lines at 0 against a note saying 6 to 10%, assumptions copied from another sheet, and stray formulas pointing at blank cells.

## Fit with the code

- **Mode:** a new `estimateSteps(state)` manifest in `src/stages/modes.ts`, in the same shape as `brownfieldSteps`. `Mode` already includes `"estimate"`.
- **Stages:** `breakdown` and `estimate` already exist in `StageName`. Steps implement `StepDef` (inputs, run, outcome `done` / `wait` / `fail` / `park`).
- **Artifacts:** two new typed artifacts, defined in zod with the standard header and stored in the ledger by hash:
  - **Breakdown:** features and tasks. Each task has an id (`EST-n`), title, requirement ids, the concrete spec items it delivers, track, executor, dependencies and an optional design screen link.
  - **Estimate:** delivery model, size band, uncertainty grade, anchors, per-task Min and Max, overheads, gate hours, API credit cost per phase (range), elapsed time, harness confidence label and record count, run settings, scenarios, and the "Suggested, not included" block.
- **Gates:** `defineGate` predicates with the `waiver` field set as in the tables above. The stage names for `after` come from `StageName`.
- **Approval:** the same `wait` card mechanism as the plan approval; answered only from a terminal.
- **Task id continuity:** `PlanTask` gains an optional `estimateTaskId`. One estimate task maps to many plan tasks. A plan task that maps to nothing fails B1 and becomes a change request. Each implement step's data records its `EST-n`, so actual effort and cost can be grouped per estimate task.
- **Build seeded from an estimate** (gap G4 in `docs/design/core-design.md`): a build run takes the approved estimate's hash as input, inherits the spec, skips clarify and specify, and creates plan tasks against the estimate tasks.
- **Change requests:** a v2 estimate run with the approved estimate as parent; the card shows the diff of tasks and hours.
- **Model use:** the model does breakdown and estimation (locked-room style: read-only tools, structured output). Code does sizing arithmetic, overheads, totals, gate hours, estimator merge, all gates and export.
- **Export:** ExcelJS, pinned (adopted in `docs/design/reuse.md`). Whether to fill a copy of the estimation template or draw the workbook is decided by a test on the real template, since formatting survival is marked "to verify".

## Prerequisites

1. **Stack-agnostic discover and ground.** Today they are .NET-shaped and refuse other repos. The estimate needs a read based on universal signals: files by language, dependency manifests, tests present, change history, and a language-neutral code map.
2. **Design wiring.** The inventory and size check are built, but not yet called from discover and integrate (listed as pending in `docs/design-step.md`).
3. **Decide-architecture and scaffold** for estimates without a repo. Both are named in the contracts and not built.
4. **Document intake:** a step that extracts text, tables and images from a .docx, and accepts pre-exported Figma frames.
5. **Per-module specify:** specify, drafts, critic and round trip run per module when the document is large, and their cost belongs in the run's cost.
6. **Actuals logging** per estimate task, for later calibration of cost and duration.
7. **Design module hardening** (mock and clickable demo), plus the E1b gate. The estimate depends on it.
8. **Duration harness (internal):** build the self-benchmark records and the range calculation from the ledger. An external snapshot is a later, optional addition.
9. **First calibration data:** the summary numbers in `docs/runs/2026-09-30-first-real-runs.md` are recorded above. The raw ledgers stay on the owner's laptop; `report.json` (model, agent and lab seconds per step) from those runs is the next thing to bring over, without the client code.

## What the reference material showed

Two workbooks built on the general estimation template (Few Center, September 2025; Single Safety, January 2026), the Few Center product spec (February 2026) and the Few Center frontend repo's history were studied. Only general lessons are used here; nothing from them sets a number.

- **Missing scope is the largest error source.** Tasks average about 3 hours and 80% fall between 1 and 8 hours, so per-task error averages out. A feature left out moves the total far more. The frontend repo's branches show work that appeared later and was not estimated: sockets, PDF reports, CI/CD, UAT feedback, client support and a user manual. This is why E2–E4 and B2 exist.
- **The range was a habit.** Max divided by min has a median of 1.5, and only 8% of tasks have equal min and max. The design derives range width from estimator disagreement and named unknowns instead.
- **Effort and duration diverge.** The Few Center plan was 11 to 13 weeks; the frontend repo shows about 19 weeks of heavy activity followed by a long tail. Team size, parallel work and waiting decide duration, so it is computed apart from effort.
- **UAT and feedback recur.** 59 commit messages mention UAT, against a fixed 80-hour UAT block. Feedback rounds are an input, not a constant.
- **The team's AI factor was a guess** (a flat 20% cut, applied unevenly). The workflow model replaces it with counted gate time.
- **Design was nearly absent** from one workbook and separate in the other. New screens cost 3 to 4 hours each and reused ones 0.25 to 1 hour, which is the reuse effect the design size classes capture.

## Paper proof: the Few Center spec

A walk-through of the spec (no hours) tested the design:
- **Units counted:** 3 personas; 34 features; about 1,250 statements; about 285 quoted messages; 94 data-dictionary fields across 18 tables; integrations for AI transcription, email OTP and report generation; HIPAA; landscape only. **Band: L**, with Sessions (12 features) holding about half the statements.
- **E1 readiness would fail today** on: the platform (the spec describes a mobile app and its Supported Browsers section is empty, while the earlier estimate had web and admin web apps), the Client persona (a Forgot Password section next to view-only access), a copy-pasted breadcrumb in Signin, and a version change inside the document ("Updated Report Requirements").
- **E2 and E3 against the earlier workbook** would flag, for the lead: spec features without tasks (Admin Image Library View, Edit and Delete; Delete Client and Restore Client) and tasks without requirements (backend user registration and licence verification). Some may have been cut after the estimate; there is no change history.
- **E4 items** the spec does not mention: CI/CD, environments, monitoring, HIPAA audit trails, realtime, PDF export, user manual, store release, feedback rounds, accessibility, data retention.
- **Gate load (HITL):** about 34 features at roughly one PR each means 34 or more lead reviews. The queue is the largest human cost and sets the duration. The solely agentic model has no such queue.
- **Problems found in the design, now resolved:**
  - a 1,250-statement document cannot go through specify in one pass, so specify runs per module;
  - a .docx with 49 embedded images is a real input, so document intake was added;
  - waiting for keys, accounts and approvals is duration and not effort;
  - the estimate records the spec version by hash so later changes become a v2 diff;
  - an unresolved big unknown can carry two scenarios.

## Decisions on record

- Estimate after requirements are refined; no seed table; model-proposed anchors with the lead's single review at approval.
- One estimator for XS and S; three for M and up.
- **Two delivery models chosen at the start: HITL (supervisor + agents) and solely agentic.** Each has its own estimate; the second is produced on request as a **child run** over the approved breakdown, with its own approval. A lead reviews every PR only in HITL. Client UAT, design approval and PM stay in both.
- **API credit cost is a headline number**, calibrated from measured runs, not guessed.
- **Durations come from an internal harness built on the ledger**; external benchmarks are optional, later, and only as a pinned offline prior. Until data exists, values are labelled cold-start.
- **The mock and clickable demo are the estimation baseline; the estimate is blocked until they are approved (E1b).**
- One set of Min and Max columns per estimate: delivery effort through the factory.
- All six sheets mandatory; Design in the total is a run setting.
- Confidence and anchors stay internal; the client file is hours only.
- Repo is the only artefact for existing projects.
- Stack source is a run setting (client, Folio3, or undecided).
- Budget-burn thresholds: warn at 80% of the approved maximum, stop at 100%.
- Specify per module; .docx and pre-exported Figma frames as inputs; up to two scenarios per estimate.

## Open items

1. Whether an external prior is ever added, if the ledger stays thin. Default: no. The per-step `report.json` from the first real runs, if brought over, would tighten the first estimates but does not block anything.
2. Numeric band cut-offs, and every gate-time and share assumption, start as labelled assumptions in config and are tuned as the ledger provides measured values.
3. The estimation template: fill a copy or draw, decided by a test on the real file.
4. How the estimate treats a bug fix's second phase (the fix quote after diagnosis) in the ledger: a child estimate run, or a second step in the same run.
5. Whether "Suggested, not included" items also appear in the client file, or only in the team file. The default is the team file only.

## Suggested build order

0. Design module hardening and gate E1b (in parallel; the estimate depends on it), (the internal harness is built with the deterministic core in step 2).
1. Artifact schemas (breakdown, estimate, with delivery model and cost) and the `estimate` mode manifest with no model steps.
2. The deterministic core: size band, anchors-and-ratios arithmetic, overheads, gate hours per delivery model, API cost model from ledger data, workbook lint (E6).
3. Excel export from a fixture estimate, tested against the real template; both files.
4. Gates E1–E7 and B1–B5 with tests.
5. Model steps (breakdown, estimators, merge) tested with a scripted model, as `src/stages/e2e.test.ts` does.
6. Document intake and per-module specify.
7. Stack-agnostic discover and ground for existing repos, and the design wiring.

## Build status (2026-09-30)

Built and tested, with a scripted model, through the real executor (`src/stages/estimate-e2e.test.ts`):

| Slice | What exists |
|---|---|
| Schemas, mode manifest, deterministic core, workbook export and lint | `src/contracts/estimate.ts`, `src/estimate/*` |
| Gates E1-E7 and B1-B5 as `defineGate` predicates | `src/estimate/gates.ts`; E1-E7 run inside the estimate steps, B1-B5 are predicates only (see below) |
| Model steps | `breakdown` and `estimate` in `src/stages/estimate.ts` |
| Document intake, per-module specify | `.docx` and pre-exported Figma frames in `src/sources/`; `splitModules` and the per-module intake, clarify and spec steps in `src/stages/modular.ts`. Each module asks its own clarify questions, so a large document means one question card per module |
| Stack-agnostic ground | `estimateGroundStep`: no repo means every span is new build work (no model call); a repo gets the normal grounding step plus `src/context/survey.ts` and, for UI work, the design inventory |
| Design step and E1b | `design` step (UI requests only): the model proposes the screen inventory (flow, screens with route, states and size, the requirements each serves, a reason for each requirement with no screen); code checks the links both ways. `design-baseline` (E1b) then needs a person's approval of that inventory. It is an inventory of screens; a code-drawn clickable demo of it is what the lead approves (see "Design baseline"). E1c and B6 check the breakdown and the build plan against it |
| E7 approval | `approve-estimate` step: one card, anchors first, hash-bound, sign-off for each low-confidence line (`factory approve --sign-off EST-2,EST-5`) |
| Waivers | E3, E4, E5 only, after one retry: a waiver card, then `factory waive <run> <hash> --reason "..."`; recorded with the name and reason, shown on the card and in the team file's Gates sheet |
| Template (open item 3, decided) | Filling a copy works: the Folio3 template (Example_Estimation.xlsx, v 0.5) survives a load and save through ExcelJS with its sheets, merges, formulas and styles (only a column width or two on the QA sheet is dropped). The export uses its layout (sheet names, Summary rows 11 onwards, title block, Grand Total at the top, numbered modules, Other Development Activities, Research) and, when `estimateTemplate:` is set in the project config or `FACTORY_ESTIMATE_TEMPLATE` in the environment, draws on a fresh copy of it so its theme, fonts and cell styles carry over. Without it the same layout is drawn in plain styles. The repo ships a copy with every cell's text cleared (`src/estimate/assets/estimation-template.xlsx`: styles, theme, widths and sheet names only, no client data), used by default, so the template tests always run; a path in config or the environment overrides it |
| QA sheet and notes blocks | The QA sheet uses the template's own shape: an Estimation Summary of eight items (Test Plan/Strategy, Test Environments, Validation and Smoke test cases, Validation testing, Smoke testing, Multi Browser Compatibility, UAT, Misc. Optional), then the validation detail by testing cycle with each feature a numbered module. Code places each QA task by plain words in its title (`qaPlace`); a feature test with requirements is validation cycle 1, a regression pass is cycle 2, anything else with no requirement is Misc. No hours are invented: cycle 2 and later exist only when the breakdown has tasks for them (the template's "half of cycle 1" formula is not applied). Every track sheet with work ends with the template's Assumptions & Constraints and Risks blocks. The Summary's special considerations (platforms, browsers, deployment, performance, security, documentation) come from the client's clarify answers: a question whose text names the topic gives the row its answer and its id; a topic nobody asked about reads "Not specified" |
| Export | `export` step writes both workbooks to `<ledger>/export/` and lints each file cell by cell |
| CLI | `factory estimate` with `--file` (Markdown, text or .docx), `--frames`, `--jira`, `--delivery-model`, `--stack-source`, `--no-design-in-total`, `--feedback-rounds`, `--rate track=usd`, `--no-repo`, `--client`, `--project-name`, `--pm`, `--max-cost` |
| Benchmark records | `src/estimate/records.ts` reads every other run in the ledger home; a phase with records replaces its cold-start figure |
| Cost overlay | Team file's Cost sheet when `--rate` is given; the client file never has it |

| Edit on the card | `factory edit-estimate <run> <hash> --anchor EST-1=6-12 --ratio EST-4=2 --reason "..."`: the stored proposals are edited, the estimate is assembled again by the same code (no new model call), and a new card follows. The edit is listed in the estimate's assumptions |
| Change request (B2) | `factory estimate --revises <run>`: a full estimate whose card shows what changed from the approved one; the file says version 2; `parentEstimate` points at the approved estimate |
| Second delivery model | `factory estimate --from-run <run> --delivery-model agentic` (or `hitl`): a sibling run seeded with the approved spec, answers and tasks; only sizing is redone; the card compares it with the first |
| Build from an estimate (B1-B5) | `factory start --from-estimate <run>`: inherits the spec (no clarify or specify); the plan step maps each plan task to an approved estimate task (B1) and parks a recorded requirement change (B2); integrate checks the change size against the approved cap (B3); review flags behaviour no requirement asked for (B4); before every step the run is checked against the approved budget, with a warning at 80% and a stop at 100% (B5). Each implement step records its `EST-n` |

Not done:
- **A rendered mock and clickable demo.** The design step produces a screen inventory. Rendering a mock in the app, the screenshot lab and the pixel comparisons (`docs/design-step.md`) are separate work.
- **Effort in B5.** Human effort hours are not measured in the ledger yet, so only API credit spend and elapsed days can stop a run; effort counts as zero.
- **Waiving B1-B4 and B5.** The predicates are marked waivable, but only E3, E4 and E5 have a waiver card. B1, B3 and B4 fail or park the step; a B5 stop ends the run. The way forward is a change request or a new estimate.
- **A visual check of the workbook in Excel.** The export is verified by reading the files back and linting every cell, and by tests on a copy of the real template, but it has not been opened in Excel or LibreOffice (LibreOffice would not start in the build container).
- **Cost calibration from `report.json` of the first real runs** stays open; records come from the ledger home only.
