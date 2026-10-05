# The estimates path: design (2026-09-30)

## Summary

The factory gets an **estimate mode**. From a client's refined requirements (a new project) or from a repo plus a request (an existing project), it produces the estimate, in the general estimation workbook template (the one Folio3 uses), of the effort and cost to deliver the work **through the factory workflow**. It runs hands-off by default (see "Hands-off estimates"). The mode runs end to end (see "Build status" at the end): `factory estimate` takes requirements, a large document is specified per module, and the approved estimate leads to two workbooks.

**Every estimate is solely agentic (since 2026-10-03).** HITL was the other option; it is no longer offered (no `--delivery-model`, no `--from-run`, no choice on the UI form). Estimates made under HITL before still open and read as they were. The two models, for the record:

| | Option 1: HITL (supervisor + agents) | Option 2: Solely agentic |
|---|---|---|
| Who works | Agents build; a human supervisor gates and reviews | Agents run the whole workflow with no supervisor gates |
| Human hours | Clarify answers, approval card, lead review of every PR, parked runs, waivers, plus client-side work | Client-side work only: **client UAT, design approval, PM** (these stay in both models; PM is client liaison only, see "Agent hours and the human tasks") |
| Factory running cost | Yes | Yes, higher share of the total |
| Elapsed time | Includes the gate and review queue | Agent time plus client waits |

Every estimate states three things:
- **Effort (hours):** human time the model needs. It is never modelled per task confirmation. Beside it, every task shows the factory's own **agent hours** (see "Agent hours and the human tasks").
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
       → breakdown → estimate → gates E2–E6 → approval (E7: the factory, or a lead with review on) → export
```

A person answers the questions and approves the estimate by default; hands-off is an opt-in (see "Hands-off estimates"). The design approval (E1b) always waits for a person.

| Step | New or reused | What it does |
|---|---|---|
| intake, ground, clarify, drafts, merge, specify | Reused | Produce the refined spec. Large documents are specified **per module** |
| ground (existing repo) | Reused, plus a stack-agnostic survey | Estimate mode skips the .NET-shaped discover: ground reads any repo through the language-neutral repo map, and adds a survey (`src/context/survey.ts`) and, for UI work, the design inventory. See "Prerequisites" |
| design (mock and clickable demo) | Reused, hardened | Screens linked to requirements; the approved mock and demo are the **baseline of the estimate** for UI work. See "Design baseline" |
| **breakdown** | New | Requirements → features → tasks (functionality identification) |
| **estimate** | New | Size band, anchors, sizing, one or three estimators, merge |
| **estimate gates** | New | E2–E6, defined with `defineGate` |
| **approve-estimate** | New (same card mechanism) | By default the lead approves (terminal or the run page), tied to the estimate's hash. Hands-off (opt-in): the factory approves once the gates pass |
| **export** | New | Deterministic code writes the two workbooks |

The estimate does not start until the spec passes lint, critic, round trip and has no open questions (gate E1), and, for any request with UI, the mock and clickable demo are approved (gate E1b). It does not produce a soft estimate.

**Spec problems are settled by questions (built 2026-10-05).** What the specify step's repairs leave open in an estimate or design run (a critical or high critic finding, a capability the request did not ask for, a lint check that does not block) no longer stops the run at E1, after the design is paid for. The specify step turns those problems into clarify-style questions (`src/stages/settle.ts`, at most 8 a round, each with a recommended answer):

- **Who answers:** with review on, a person answers a question card (`factory answer` or the run page) and the step goes on from it; hands-off, each recommended answer is taken as an assumption.
- **Then:** the spec is fixed with the answers and checked again, for at most 2 rounds. What is still open after that is carried as an open risk.
- **Found in the request:** a capability flagged as not asked for that the request does ask for is settled by the request's own words; code checks the quote is in the request.
- **A fix that drops requested behaviour** is not kept: the spec stays and its problems are carried as open risks.
- **Recorded:** the spec carries `settled` (each problem, how it was settled, the question and answer). E1 lets a settled problem through; the estimate's assumptions list each one ("Spec question Q-n: … (answered)", "(assumed by the factory, hands-off)", "Open risk: …"). A dropped span is never settled by the spec step: E1 asks about it instead (see "Gate questions" under Gates).
- **Runs started earlier:** a run whose spec was written before this, at design or breakdown, records E1's verdict and goes back (`backToSettle`, the step outcome "back", not counted as a failure); the specify step then runs again from its stored spec, settles it, and the run goes on. A step that goes back twice with nothing completed in between parks instead of looping.

### Hands-off estimates (agreed and built 2026-10-03; opt-in since the PR #11 review)

**Revised after the PR #11 review (owner decision, 2026-10-03).** Estimates no longer approve themselves by default: a person answers and approves unless the run opts in with `factory estimate --hands-off`, the start form's "Hands-off" box, or the project's `estimate.humanReview: false` (the default is now true). A build never follows a hands-off estimate: `approvedEstimate(run, { build: true })` refuses an approval with `auto: true`, so `factory start --from-estimate` and the UI's build-from-estimate stop with a plain message. A change request (`--revises`) can still start from one. The text below describes the hands-off path as built.

Estimates are made from requirements that are already refined, so by default nobody is asked anything and nobody approves the figures: the run goes from the requirements to the workbooks on its own. The one stop left is the design approval (E1b): a request with UI still waits for a person to approve its mock and clickable demo.

- **The switch.** `info.estimate.humanReview`, recorded when the run starts: `factory estimate --hands-off` (or `--review` to override a project that opts out), the "Hands-off" box on the UI's start form, or the project's `estimate.humanReview` (default true). With it on, the run asks its questions and waits for the lead's approval, sign-off and edits as before. A run started before the switch has nothing recorded and keeps its reviews; a run keeps its choice for life. `humanReview(info)` in `src/estimate/settings.ts`; only estimate mode goes hands-off (design-only and build runs keep their questions). A sibling (`--from-run`) takes the review choice given now, not its parent's.
- **Clarify: assumptions only.** Round 1 still reads the requirements (three sketches, differences, the clarifier), then asks nobody: every question takes its recommended answer as an assumption (`selectQuestions(..., 0)`, `assumedFrom`), a high-impact one marked high risk; a restyle question becomes a high-risk assumption to keep the app's look. The result carries `assumedBy: "factory"`, kept when modules are joined. Round 2 is skipped (nothing was asked), which saves its model calls.
- **E7: the factory approves.** Once the gates pass, `approve-estimate` records an approval `by: "factory"`, `auto: true`, tied to the estimate's hash; no sign-off is asked for or listed (`FACTORY_APPROVER`, `leadApproval`). Its gate detail reads "approved by the factory (no human review)" on the team workbook's Gates sheet. `--revises` accepts it like a lead's; `--from-estimate` builds refuse it (see the revision note above).
- **What the reader sees.** The client and team workbooks' special considerations take a topic the factory assumed as "Assumed: ..." with "Factory assumption ASM-n, confirm with the client" as its source (an answer still wins). The Estimate tab shows "hands-off (no human review)" in the settings, "approved by the factory (no human review)", and an "Assumed by the factory" panel listing each assumption with its risk.

## Inputs

| Group | Examples | Handling |
|---|---|---|
| Request | One line, brief, transcript, PRD or spec, RFP, tickets | Untrusted text; read-only steps only |
| Design | Nothing, or references in any form: images (png, jpeg, ...), URLs, Figma links or exports, PDFs, brand guides, wireframes (see "Design references") | Turned into one form by code, read by a vision step, cleaned to typed fields; screens, routes and states are counted. None given: the look comes from the industry library as before |
| Existing system | **The repo (the only artefact)** | Read in the locked room with no network |
| Context | Stack, platforms, compliance, hosting, client policy | Project config, plus clarify for what is missing |
| Run settings | Delivery model (always solely agentic for new estimates), stack source, Design in total, feedback rounds, optional rates | Set by a person, recorded in the run |

Document intake accepts a **.docx** (text, tables, embedded images) and **pre-exported Figma frames** placed with the request. The environment is isolated, so links in the request text are not fetched. **Design references** (`--ref` and the factory UI; images, URLs, Figma links and exports, PDFs and Word documents; built 2026-10-02): links the user gives on purpose, and only those, are opened at intake (see "Design references").

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

A missing "must have" doesn't block the run. It becomes a clarify question, and if unanswered, a labelled assumption (in a hands-off run nobody is asked: it is an assumption straight away).

Each input dimension (scope clarity, design availability, technical context, code access, constraints known) gets a grade: missing, vague, adequate or precise. The grades feed the internal uncertainty grade.

## Starting from requirements only

The common case for a new project: functional requirements have been gathered (notes, transcript, brief, .docx, email thread), but there is **no formal spec and no code**. The spec is something the pipeline produces, not an input.

1. **Intake** takes the raw requirements as untrusted text. Whether the request touches UI is the model's judgement or a rule, never the model alone: a request that names screens, a UI, a dashboard, a wireframe or Figma, or comes with attached frames, is UI whatever the model said (`ruleUi`, like `ruleRisk`).
2. **Discover and ground are skipped**, because there is no repo.
3. **Clarify** asks the lead what the material cannot answer.
4. **Spec drafts, merge and specify** turn the answers into a spec, per module when it is large. An estimate or design run writes one draft (so the merge makes no model call), repairs it at most once, and runs the critic at medium effort: no tests are written from its criteria (`specLane` in `src/stages/lane.ts`). The modules' spec chains run side by side, at most four at a time, each with its share of what is left of the cost limit (`nextBatch` in `src/stages/executor.ts`). A briefing answered in one turn is not written to the prompt cache: nothing reads it back, and the write costs 1.25x input (`cachesConversation` in `src/runners/api.ts`).
5. **E1** checks the spec. Only then do breakdown and estimate start. What the repairs left open is settled by questions first (see "The pipeline").

| Missing | How it is handled |
|---|---|
| Code | Every task is new build work. Size comes from counted units in the spec, not from touched files. |
| Stack | The stack-source run setting applies: client-specified, Folio3 decides (proposed stack on the approval card), or undecided (default pack as a stated assumption, optional second scenario). |
| Design | The design step produces the mock and clickable demo first; the estimate waits for their approval (E1b). Design-in-total stays a Summary switch. Above 24 requirements the design is drawn in parts (`drawInParts` in `src/stages/design.ts`): one call lists the screens and chooses the look, checked before any page is paid for, then each page is drawn on its own, four at a time, with one more try for a page that fails its checks. A retry reads back the stored answer for the list and every page that passed, and pays only for the rest; an answer the checks reject is dropped from the store. One answer for the 2026-10-05 run's 136 requirements was cut off at the 64K output limit. A long answer logs its progress about every 45 s instead of the heartbeat's "no new activity". |
| Tests | The factory builds them; there is no baseline to read. |

If the gathered requirements are too thin (a source span the spec drops, an open question), E1 fails and the run parks; problems a question can settle are settled in the specify step first. There is no soft or guessed estimate. Each question the lead cannot answer becomes a labelled assumption in the workbook, or a scenario when one big unknown decides the size.

## Design baseline

The mock and clickable demo are the baseline the estimate stands on. Screen counts, states, flows, reused components and design-system changes all come from them, so a weak demo gives a weak estimate.

- **Rejecting the design does not stop the run, and does not always redraw it.** `factory reject --reason "..."` (the lead gives only the reason, in their own words; the CLI refuses a design rejection without one) sends the design back, and a new card follows. The design step then decides how much to redo, so a small complaint costs a small fix:
  1. **Triage** (`design-triage`, the small model, about 2k tokens): reads the reason against a compact index of the design (its look; each page's title, route, blocks and states; each requirement and the pages that show it; no sample data) and returns one item per complaint: the look, a page's layout or behaviour, or only a page's sample content, with the lead's own quote and the change in plain words. It also lists pages the lead called fine, and things no requirement covers.
  2. **Code decides** (`decideRework`, whatever the model said): fix the named parts only when every item is high-confidence and tied to a real page, fewer than half the pages are touched, the estimated cost is under 60% of a full redraw, and none of the parts was already fixed since the last full redraw. Otherwise the whole design is redrawn, with every reason in the briefing as before. A note with nothing to draw changes nothing.
  3. **Fix**: the look is one call returning a theme (with the reference checks of the next bullet group; the live brand read runs only here); each page is one call returning that page with its id, route, file and requirements unchanged, and for a sample-content complaint its block types and order unchanged. Everything else, including a page the lead called fine and the theme when only pages change, is copied from the previous design with no call, and restored exactly if a fix call returns it changed. Change requests keep the earlier sample content and theme unless a requirement asks otherwise. A fix that fails its checks twice falls back to the full redraw, so the worst case is the old cost plus the triage call.
  4. **Words the lead knows**: words such as "export" in a reason are about the product being designed, never this tool's estimate export; they are judged against the requirements (a covered but missing or hidden button is a fix on the page that serves it; a thing no requirement covers is reported as not a design change, with `factory estimate --revises` as the way to add it). Pages must have real titles (`design-generic-title` rejects "Page 3"); the card's "What changed from your feedback" section lists what changed and what was kept exactly, by page title and the lead's quoted words, never ids. The design records `revision` and `rework` per round. After 4 revisions (a fifth rejection) the run parks and asks for a changed request or an attached design frame.
- **An existing app is drawn in its own look** (revised after the PR #11 review, 2026-10-03, as built):
  - its pages are found in Vite + React (`src/pages`), Vue (`src/views`, `pages/`) and Angular (the components its routes files name) as well as Next.js, so such a repo counts as having a look of its own (`hasExistingLook`);
  - the look is read from its stylesheets (`src/design/repo-look.ts`, no model): the brand from `--primary`, `--brand`, `--accent` or `$primary` (hex, rgb, hsl, oklch and shadcn's bare channels; a coloured accent beats a grey primary), light or dark from the background, corners from `--radius`, the type from the body font. It is kept on the inventory (`look`);
  - the design keeps `themeSource: "repo"` and carries that look as its `theme`, so the demo and screenshots are drawn in the client's colours, not the default theme. The build still treats it as the repo's own look (no tokens, no new theme);
  - the design card has a **Current vs proposed** section: each tweak, reuse or design-system screen beside the existing page it changes (its file, route and the components it is built from) and the look read from the stylesheets.
  - **Also JS themes and pictures of the current pages** (the PR #11 re-review, item 6, 2026-10-04, as built):
    - the look is also read from a Tailwind config (colours, `borderRadius`, `fontFamily.sans`) and from MUI, antd and Chakra theme objects in JS/TS (`palette.primary.main`, `colorPrimary`, `background.default` / `colorBgLayout`, `borderRadius`, `fontFamily`, dark mode). They are read as text and never run (`jsThemeVars`). A stylesheet wins where both name the same thing; `node_modules` and build output are skipped;
    - with `design.capture` set, the approval step starts the app at the base commit (a git worktree, removed after) and takes each changed page with a fixed route at phone, tablet and desktop width into `preview/current/` (`src/design/current-pages.ts`, at most 8 pages). The card lists them under Current vs proposed and the run's Preview shows them beside the demo. Without `design.capture` the card says how to turn it on: it starts the app on this machine, so it stays opt-in. It never stops the step; a failure is a note.
- **Design note for a small fix** (added after the PR #11 review, item 9, 2026-10-03, as built). Some small changes go on a lighter path. A change qualifies when all of these hold:
  - it is in the light spec lane (low risk, with light rigor or a bug fix);
  - it is in an app with a look of its own;
  - there are no attached frames and no design references;
  - there is no earlier design to change;
  - it has at most 3 requirements.

  Such a change no longer pays for a drawn demo, screenshots and a card of its own just because the request says "button" or "UI":
  - the design step makes one small call (`read-small`, about 12k tokens) for a **text note**: each existing page the change touches (route, file, requirements, size) and one or two sentences on what changes there;
  - the note is checked against the requirements like a full design;
  - gate E1b passes on the note with no card;
  - the **estimate card (E7)** shows a "Design note" section, and approving the estimate approves the note. So there is one approval instead of two.
  - **Only in an estimate (the PR #11 re-review, blocker 1, 2026-10-04, as built).** A build or a design-only run has no estimate card, so there the note gets a short card of its own (`design-approval`, the note's pages and changes, no demo). Gate E1b passes only once a person approves it; a rejection sends it back to the design step with the reason. Before this fix, the note passed E1b with nobody approving it outside estimates.
  - there is no design package (nothing to export);
  - the build brief carries each page's `change` text.

  If the note says a page has to be made (`size: "new"`), the full design is drawn instead in the same step. `design.lightNote: false` in the project config sends every UI request to the full design.
- **Gate E1b blocks the estimate** until a person approves the mock and clickable demo in a terminal, tied to their hash. Any request with no UI skips it.
- A change to an approved design is a change request (`factory estimate --revises <run>`): the design step is given the approved screens and keeps their ids and routes, and the design card lists the screens added, removed and changed. A build run that finds a new requirement after approval parks at B2 and points there. (Nothing watches an approved design for edits outside that path; the approved design is content-addressed and copied into the change, sibling and build runs, so it cannot change silently.)
- **The clickable demo is drawn by code, not a model** (`src/design/demo.ts`): one self-contained page with a panel per screen, a button per state, links between screens, the requirement text each screen serves, and any attached Figma frame the design cites in place of the sample page. A screen with sample content is drawn as a finished page in the product's theme (colours, type, corners, surface, motion, `fx`), not a grey wireframe; a screen without sample content falls back to a drawn wireframe. The page is drawn the way a shipped product looks: inside a browser window with the product's own frame, which the theme chooses from the reference products (`shell`: a sidebar app, a top-bar site with a contained column, a menu button opening a drawer, a bottom tab bar, a minimal frame for a single task, or `auto`: a sidebar when most screens carry tables or figures; on a phone, a tab bar). A phone product (the reading's device, or an app's) is drawn inside a phone with its status bar and home indicator, laid out as on the phone even on a desktop screen (the page's layout follows the frame's width, not the window's). A product with more than one app (`apps`: a customer phone app and an admin portal, say) draws each screen in its own app's device and frame with the one theme, gives each app its own address (`admin.<product>.app`), and the walkthrough lists the screens under each app. Navigation lists an app's sections, named as a product names them ("Home", "Accounts"), and a detail page keeps its section lit instead of appearing in the menu. A page can carry a trail of the pages above it (`crumbs`; a narrow frame shows only a back link) and its own tabs (`tabs`), layers it opens over itself (`overlays`: a dialog, side panel, bottom sheet, confirmation or menu, opened from their own button and each shown open as its own tab and screenshot), toasts after an action (`toasts`, each its own tab and screenshot), slides (a `carousel` block, promo or media), answers that fold (an `accordion` block), view and period switches (`segments`, `ranges`), links that make rows, cards and buttons open the screen they lead to (`links`), the page title plain or on a brand band the first block overlaps (`hero`), charts in a soft, bold or mono style (`charts`), pill controls for round themes, the theme's logo mark and heading face, line icons on navigation, figures and buttons (`src/design/icons.ts`), colours built in OKLCH with brand-tinted greys and every text colour checked for WCAG AA contrast (`src/design/palette.ts`), smooth charts with hover readouts, figures with sparklines, and drawn photographs on picture cards (city, coast, mountain, stay, food, product and more, chosen from the card's and page's words, `src/design/scenes.ts`, in the light the theme picks with `imagery`, or icon tiles where a photo would be fake). Everything is inline SVG with its own ids, so the page still fetches nothing and is the same on every build. The card gives its path (`design-demo.html` in the run folder); the same page is under `preview/` for `factory ui` (Run: Preview). Screenshots of it (each screen and state, phone and desktop, the full page, labelled by page title) are taken when the card is built, with the browser found as in the live read (macOS and Windows included; `FACTORY_NO_SCREENSHOTS=1` turns them off) and shown in Run: Preview; they are not part of the approval hash. While they are taken, the text of each state is measured, and text that runs past the frame, is cut off or overlaps other text is listed on the card (the design step has already sent such problems back to the model once; see "Left over from Phase 1"). The approval is tied to the design and the exact page.
- **What each screen shows follows the refined requirements, not a template.** The model picks the blocks (stats, filters, table, form, chart, cards, carousel, accordion, steps, timeline, detail, list, actions, text) from what the requirements say: a trend that is watched is a chart, records that are scanned are a table, things chosen by picture are cards, a path is steps. Most screens need no chart and no table, and a block no requirement asks for fails review.
- **Pages are laid out, not stacked.** The model picks blocks and content; code arranges them the way a product designer would (`compose` in `demo.ts`): the page's buttons sit in its header (a form keeps its button at its end), search and filters become the table's toolbar, and a chart beside its list or a form beside its summary share a row on a wide screen (one column under 900 px). Tables right-align numbers and give a name column initials and a row count; stats show deltas and a meter for percentages; charts have gridlines, axis labels, a total and the peak marked; picture cards get a drawn picture per item instead of a letter. Statuses are coloured by the field's own words (Delayed, Cancelled, Boarding, Delivered, Out of stock and the like), not only generic ones.
- **The normal page always comes first.** The state tabs start with the normal page even when the design lists only special states (empty, error), then the listed states, then Full data. The preview, the screenshots and the demo's menus use page titles; two pages with the same title also show their route.
- **States keep their data in view.** Loading draws the page with everything static kept (titles, labels, column headers, filters, buttons) and only the data as skeleton shapes under a progress bar. Empty previews what the page fills with. Error keeps the last good data dimmed behind the message. A **Full data** tab shows the same page with fine-grained data (`mockFull`: tables of 8 to 14 rows using every status, charts of up to 14 points, fuller cards, lists and timelines, figures that agree with the charts). It densifies only the block types the normal page has. It is a demo tab, not a state: it does not change the state count the estimate uses.
- **The look is proved, not invented.** For a new product the design step briefs the model with the top real products of the matched field (`src/design/refs`, from the built-in reference library plus any you add under `~/.factory/design-refs/industries`), after silently reading their live sites for current colours (`ensureMeasured`: every design, up to 4 brands, capped at 45 s, best effort, off with `FACTORY_DESIGN_LIVE_REFS=0`, nothing shown to the user). The theme must cite at least two of those products and what it took from each (`theme.basis`, kept in the ledger, not shown in the demo or the cards). The references are guardrails, not a template. Code rejects a brand that is the same shade as a single reference brand, and a brand colour more than 40 degrees of hue from every reference colour unless the theme says in `departure` what in the product reading makes it leave the field's colours; a neon brand (lime, green, cyan or magenta at full strength) in a field people trust with money, health or duties (finance, care, public, operations) needs a departure too (`design-neon`), since only a few real ones (Robinhood, Lemonade) use one. A field with no references gets general look families and must name two or three real products itself, which code cannot verify. The theme also carries `fx` (`quiet`, `modern`, `futuristic`) for how much the page moves and how much detail its surfaces carry (fades only; hover lift, rise-in and drawn charts; plus a dot grid, lit card edges and live status dots). No level uses glows, blobs or gradient text. The model works as a principal UI/UX engineer held to a design-review standard.
- **Checks in code:** the design step fails on a screen id or route used twice, and on an attached image frame no screen cites (or a cited frame that is not attached). Gate E1c (after breakdown) fails a task whose `screen` is not in the approved design, an approved screen no task builds, and a duplicate id or route; it is waivable by a lead. The sibling run keeps the approved design and its approval; a build run inherits the design (`estimateRef.designSha`) and gate B6 fails a plan that leaves out an approved screen's factory tasks.
- What the demo must carry for the estimator: every screen and state, every navigation flow, form fields and validations visible, reuse of existing components marked, and each screen linked to its requirement ids.
- **Work needed on the design module first** (it is a dependency of the estimate, not a side task): richer clickable flows, screen states (empty, loading, error), a per-screen size class, requirement links on every screen, and the build wiring (all done; see "Prerequisites"). The existing eval (56 labelled commits, drift lint) is the measure of progress.

### Each product its own look (added 2026-10-02)

- **The product reading comes first.** Before any colour or frame the model reads the product from the requirements alone and returns it as `theme.reading`: who uses it, where and when, the device (`web`, `phone` or `both`), the tone, the one moment that matters most, and two to four traits that set it apart from competitors. Every other part of the theme must follow from that reading, so two products in the same field still look like themselves. Code rejects a new theme with no reading (`design-no-reading`) and a phone product drawn as a sidebar tool (`design-reading-mismatch`).
- **Recent looks are remembered.** Each approved new look (not a repo's own) is recorded under the factory home (`~/.factory/design-looks.json`, one entry per project name, else per run, the latest 50; `src/design/looks.ts`). Each entry keeps the field the product matched. The next new design is briefed with the six latest other projects' looks, plus up to three older ones in its own field (`recent-looks`), and must differ from each by at least 4 points: a different colour family counts 2 (a near one 1) and each of mode, frame, type (body and heading together), logo mark, corners, surfaces, hero, charts, pictures, greys and bar counts 1 (`design-look-repeat`). A change request keeps its approved look and is not compared; an existing app keeps the repo's look. The look-only fix after a rejection runs the same checks. Nothing in the record is shown to a client.
- **The brief follows the product, not only its field.** Besides the field's brands (with a lead brand that rotates per requirement), the brief lists the signals in this product's own requirement words (`requirementCues`: children, older users, on the move, desk all day, premium, urgent, worried users, learners, money, social, business buyers, night, patchy networks, playful; at most six), so a clinic's patient app and its back office start from different places.

### Design phases (agreed 2026-10-02)

- **Phase 1, in this order:** (1) product reading, the record of recent looks and the relaxed colour rule (done); (2) device and frames: a phone app frame, more than one app per project (for example a customer phone app and an admin portal), drawer and bottom-tab navigation, in-page tabs and breadcrumbs (done; the design step rejects a phone app in a sidebar or top bar, a web app with a bottom tab bar, and a screen whose app is missing or unknown, `design-app`); (3) overlays: modal, drawer, bottom sheet, confirm and menu, each opened from its button and shown as its own state tab and screenshot (done; an overlay's tab is a demo tab, not a counted state, and the design step rejects an overlay whose trigger is not a button on its page, `design-overlay-trigger`); (4) a carousel block (done; style "promo" for offers and announcements on the brand colour, "media" for a row of pictures, with arrows, dots and swipe); (5) linked screens: a button, row or card opens another screen of the demo (done; a screen's `links` name the label and the screen it opens, and `design-link` rejects a link to an unknown screen or from a label the page does not show); (6) a check of the rendered page for overflow, clipped text and overlaps (done; while the screenshots are taken, every line of text in each state is measured in the browser, and text past the app frame, cut off by its box or on top of other text is listed on the design card; scrolling rows and text shortened with an ellipsis are allowed).
- **Phase 2, done** (2026-10-02; the theme carried into the build as design tokens was done early):
  - **Charts by what the numbers are.** Besides bar and line: `stacked` (bars split into 2 to 4 `series`, each point's `parts` in that order, with a legend), `donut` (2 to 6 shares of a whole, the total and `unit` in the middle, each share's value and percent beside it), `progress` (1 to 4 goals as rings, percents, or against `max`) and `gauge` (one reading on a half ring against `max`, amber from 65% and red from 85% of the scale). Series and slices use the brand at three strengths, then two status hues and a grey; the mono chart style uses the brand and greys. The design step rejects numbers that do not fit the kind (`design-chart`: too few points, parts that do not match the series, a negative share, a ring over 100% with no `max`, a gauge with no scale or a reading past it). The full-data tab adds points only to charts over time.
  - **Form fields by what is entered.** Besides text, select, date, textarea and toggle: `radio` and `checkbox` (options shown at once, as tiles when there are three or fewer), `number` (with − and + buttons), `currency` (the code before the amount), `otp` (one box per digit, moving on as you type), `phone` (a country code beside the number), `search` (typed into, with suggestions), `slider` (its ends from `options`, the value shown as it moves) and `card` (number, expiry and code as placeholders only; the demo never shows a card number). Forms take up to 6 fields, 8 on the full-data tab. The validation state flags only fields that are typed in.
  - **Domain components.** Twelve blocks for the parts of a product its field is known for, each drawn and working in the demo: `calendar` (a month from its real first weekday, marked and closed days, the picked day's times with taken ones struck out, beside the month when there is room and under it in a narrow column such as beside a form; picking a day or time moves the selection), `map` (a drawn street map with pins, numbered stops and a route when `route` is set, the list beside it lit with the pin), `gallery` (`hero`: a large picture with thumbnails that swap into it; `grid`: equal tiles), `upload` (a drop zone and files done, uploading or failed, with retry and remove), `chat` (both sides, a live status, quick replies, sending appends a message), `kanban` (columns with counts, cards dragged between them), `plans` (pricing with one featured plan and a period switch that swaps every price), `reviews` (the score, stars filled to it, the share at each star, the reviews), `notifications` (grouped, unread counted, Unread filter, mark all read), `results` (search results with filters beside them, behind a Filters button on a phone, the ticked ones as removable chips), `compare` (things side by side, ticks and dashes for yes and no, the featured column tinted, scrolling sideways when it must) and `receipt` (an invoice as a document, with the amount due last). The prompt asks for the component whenever a requirement names one, never a list or table standing in for it. Cards, results, notifications, map pins and plan or comparison buttons can be linked from and can open overlays and toasts. The design step rejects numbers that do not agree (`design-component`: a calendar that is not the real month or picks a closed day or a taken time, a route with one stop, a one-sided chat, an empty board, two featured plans or a period with no second price, star shares that do not add to 100, a ticked filter that is not an option, a comparison row with the wrong number of values, a receipt whose lines, subtotal, adjustments and total do not add up). The full-data tab must show more results, notifications, reviews, pictures, messages and board cards. Template version 17.
  - **Languages and markets** (gaps 17 and 18). A product offered in a language other than English, right to left, or in two languages returns a `locale` (`src/design/locale.ts`). It has the `languages` (the first is the one it opens in; with two, one is English), the market `region`, its `currency`, the date order (`dates`: dmy, mdy or ymd), `digits` (`native` for a script's own digits, as in Saudi Arabia, else `latin`) and `strings` for the frame's words that no page carries (navigation groups, app names). The sample content stays in English, because code reads its statuses, amounts and dates. Each page carries its words in the other language as `tr` pairs (`mockFull` has its own).
    - **In the demo.** The frame gets a language button that names the other language in its own words. Switching it shows every page in that language: the page's words, the demo's own fixed words (built in for Arabic and Urdu: the frame, the states, toasts, weekdays, counts), placeholders and labels for screen readers. A right-to-left language (Arabic, Urdu, Persian, Hebrew) mirrors the canvas, because the demo's CSS uses logical properties. Icons that point along the reading direction (chevrons, arrows, send) flip. Drawers, toggles, menus and the selected-row marks change side. Plots, the address bar and the map stay left to right. Arabic script is set in its own fonts (Nastaliq for Urdu), with no letter spacing. With `native` digits, numbers show in the script's digits with Arabic separators. Buttons are still found by their English label, so links, overlays and toasts work in both languages.
    - **Calendars by region.** A calendar starts its week on the market's first day (Sunday in the US and Saudi Arabia, Saturday in Egypt, Monday in Pakistan, the Emirates and Europe) and shades the market's weekend (Friday and Saturday across most of the Gulf).
    - **Screenshots.** They add each page as it first shows in the other language ("In Urdu", at both widths), and the layout check measures it too.
  - **Tablet width and both colour modes** (gap 19, 2026-10-02). The screenshots and the layout check have a third width, a tablet (820 by 1180). Every state is measured there, but only each page as it first shows is pictured, so the pictures stay within the 64 limit (phone and desktop are taken first). A theme with `mode: "auto"` (both modes, following the viewer's setting) gives the demo frame a light/dark switch. The switch is a moon or a sun beside the language button, and it sets `data-mode` on the page. The screenshots add each page in dark mode ("Dark mode", at phone and desktop width), and the layout check measures dark mode too. The prompt asks for "auto" whenever the requirements ask for a dark mode, a theme switch or the system's appearance, and the design step rejects any other mode then (`design-mode`). The design tokens for an "auto" look add `:root[data-theme="light"]` and `[data-theme="dark"]` blocks after the system's, so the built app can offer the same switch. The built-app capture (`src/design/capture.ts`) also takes the tablet width. Template version 19.
  - **UI complexity in the estimate** (gap 21, 2026-10-02). Code counts each approved screen's UI from its sample page (`src/estimate/ui-complexity.ts`): listed states, each block (a table more with sorting, row selection and bulk actions; a form by its field count and its special fields such as card, one-time code or phone; charts; carousels; and the domain components most of all, a map with a route or a chat above a calendar or an upload), overlays (more with a form), toasts, in-page tabs and links. The points give a level: simple (under 8), moderate (8 to 15) or complex (16 and up). With the level come its drivers in plain words, the heaviest first. A change to an existing page or a reused one says so, and a screen with no sample page gets no level. The points only order screens: they are not hours or a rate. Product-wide factors are listed once: several apps, two languages, right to left, native digits, both colour modes, and an existing app's look reused.
    - **Where they go.** The breakdown gets each screen's `ui` and the `uiFactors`: a complex screen's parts become items of its task, or separate tasks. The estimator gets `ui` on every web or mobile task that builds a screen, and the factors. It sizes from the drivers, names the ones that differ from the anchor in the reason (the reason is in the team file's comments), and never sizes a complex screen below a simple one. Breakdown and estimate template version 2.
    - **Checked in code.** Gate E5 adds up each screen's web or mobile tasks per track and executor, and fails a complex screen sized below a simple one (`e5-ui-order`, waivable like the rest of E5). Moderate screens are not compared, and a screen with a flagged task is left to the lead.
    - **On the design card.** Each screen's line shows its level and top three drivers, and the factors are listed under the screens, so the lead approves the facts the estimate will use.
    - **Checks** (`design-locale`). The design step fails when:
      - the requirements name a language, right to left or bilingual, but the design has no `locale`;
      - a product has two languages and neither is English;
      - a page shows a word (title, crumbs, tabs, labels, field labels and options, buttons, column headers, statuses, chart titles, the words of its overlays and toasts) with no translation;
      - a translation is not written in the language's own script;
      - the sample content uses Arabic or Persian digits;
      - a numeric date breaks the date order;
      - most amounts are in a currency other than the product's.
    - **For the build.** The implementer gets the languages with their direction, the market's formats and week, and how to build them: logical properties, `dir` and `lang` on the root, mirrored icons with charts and maps left to right, and `Intl` formatting for the region and currency. Each page's `tr` pairs come with its sample content.
    - Template version 18.
  - **Tables people work in.** `sortBy` and `sortDir` draw the table in that order with the arrow on its header, and every header then sorts on click (text A to Z first, numbers high to low first; amounts, counts with k/m/bn, percents and dates sort as values). `selectable` adds a tick-box column with select all; `bulk` names what can be done to the ticked rows ("Export", "Mark paid"), shown in a bar once rows are ticked (the full-data tab shows two ticked). Bulk buttons can show toasts and open overlays like any page button. Paging is still drawn, not working.
- **Left over from Phase 1 (done 2026-10-02):**
  - **Type and mark.** Six body fonts (`font`: sans, humanist, serif, rounded, grotesk, book) and a heading face of its own (`heading`: match, serif, display, geometric, condensed, slab, mono), plus the logo mark (`mark`: a geometric glyph from twelve shapes, a monogram, an emblem drawn from the product's own icon, or a wordmark with no tile). The look record counts the mark, and the type as the body and heading pair, so two projects with the same body font but different headings differ.
  - **Navigation.** A sidebar or drawer with six or more sections groups them under headings (a screen's `group`). A product used on behalf of several accounts, workspaces, companies, locations or profiles gets a `switcher` (top level, or per app), drawn under the brand in a sidebar and in the top bar otherwise (only the initials on a phone). It opens a menu, and choosing one updates the button and shows a toast. Filters can carry `segments` (List / Map, Day / Week), and a chart can carry `ranges` (7D / 30D / 90D) in place of its legend.
  - **Accordions.** An `accordion` block (FAQs, settings sections, details that can wait), the first item open.
  - **Toasts as states.** A screen's `toasts` name the button, menu item or overlay action they follow (`after`), the text, the tone and an optional Undo. Each gets its own demo tab and screenshot after the overlays, and clicking that button in the demo shows that toast's text. The design step rejects a toast that follows nothing on its page (`design-toast-trigger`). Like overlays, a toast tab is a demo tab, not a counted state.
  - **Layout problems go back to the model.** After the design passes its checks, the demo is drawn and measured in a browser (no pictures taken). Text that runs past the frame, is cut off or overlaps other text is sent back as `design-layout` failures (at most 10, each with the screen, states and widths where it was seen). There is one fix round: if the retry still has problems, they are listed on the card as before. It is skipped with no browser, with `FACTORY_NO_SCREENSHOTS=1`, or with `FACTORY_DESIGN_LAYOUT_CHECK=0`. Each line is measured at its line height, so a script whose letters stand taller than its lines (Urdu's Nastaliq, about 2.5 times its size) is not reported as overlapping the lines around it.
  - **Charts in a phone frame.** A line chart is drawn twice, for a wide and a narrow frame. The narrow one has a shorter axis, fewer date labels (the last always) and text at a size that reads on a phone.

### Design gaps: status (checked 2026-10-02)

| # | Gap | Status |
|---|---|---|
| 1 | Look tied to the reference files | Done: colour outside the field allowed with a `departure` |
| 2 | Product never read first | Done: `theme.reading` required |
| 3 | No memory across projects | Done: `design-looks.json`, `design-look-repeat` |
| 4 | Brief barely changes within a field | Done: requirement signals in the brief; older projects in the same field compared too |
| 5 | Too few identity choices | Done: five picture styles, six body fonts with seven heading faces, four kinds of logo mark |
| 6 | Phone apps drawn as websites | Done: phone device and frame |
| 7 | One frame per project | Done: `apps`, each with its own device and frame |
| 8 | Missing navigation types | Done: drawer, in-page tabs, breadcrumbs, segmented controls, grouped sidebar, account switcher |
| 9 | Overlays | Done: modal, drawer, sheet, confirm, menu |
| 10 | Carousels, tabs, accordions | Done |
| 11 | Domain components | Done: calendar, map, gallery, upload, chat, kanban, plans, reviews, notifications, results, compare, receipt, with data checks |
| 12 | More chart types | Done: stacked, donut, progress rings and gauge, with data checks |
| 13 | More form field types | Done: radio, checkbox, number, currency, one-time code, phone, search, slider, card |
| 14 | Table sorting, selection, bulk actions | Done: sort order and header sorting, tick boxes, bulk bar (paging still drawn only) |
| 15 | Screens not linked | Done: `links`, `design-link` |
| 16 | Overlays and toasts not states | Done: both are tabs and screenshots |
| 17 | Right-to-left layout | Done: `locale`, the demo mirrors (logical CSS, flipped icons), right-to-left screenshots |
| 18 | Bilingual content, local formats | Done: `tr` per page, a language switch, native digits, the market's week, `design-locale` |
| 19 | Tablet and both colour modes | Done: a tablet width in the screenshots and layout check, a light/dark switch for `auto`, dark-mode screenshots, `design-mode` |
| 20 | No check of the drawn page | Done: layout problems sent back for one fix, the rest on the design card |
| 21 | UI complexity in the estimate | Done: each screen's level and drivers counted from the demo, to the breakdown and the estimator, `e5-ui-order`, on the design card |
| 22 | Build ignores the approved look | Done: design tokens to the plan and implementer, `tokens.css` in the preview |

### Design and build agree (added 2026-10-01)

- **Existing app keeps its look.** When the repo's UI inventory has pages and a design system (verdict consistent or partial), the design step is told to extend it: no theme is drawn or required, screens are marked reuse, tweak or new against the real pages, and the design records `themeSource: "repo"`. A new product (no repo, or no design system) still draws a theme (`themeSource: "new"`).
- **The build is shown the approved screen.** The implement prompt for a task that builds an approved screen includes its route, file, states, sample content and the look to follow: the new theme, or "use the existing app's tokens and components".
- **Design tokens (added 2026-10-02).** A new look reaches the build as design tokens (`src/design/tokens.ts`): colours by name for each mode (both when the theme follows the viewer), body and heading type, corners, spacing, shadows, glass blur and motion, plus the same set as CSS variables (`--color-brand`, `--radius`, ...). They are the exact values the approved demo was drawn with (the demo and the tokens share `themeValues`). The implementer gets them with the approved screen and is told to add the CSS block to the global stylesheet once and style with the variables. The plan is told to put that stylesheet in the first screen task's file scope. The preview folder holds `tokens.css` and `tokens.json` for people. Not checked in code yet: nothing fails a build that hard-codes other colours (the fidelity lint only runs for a repo with a `design` block).
- **B7** checks at the plan that the task building a screen can touch that screen's file, so the approved screen is the one built.
- **Size recorded.** Integrate stores the UI change class as built next to the class the approved design allowed (`uiSize`); `npm run bench -- calibrate` lists them.

### Design references (requirement 1, approved 2026-10-02; not built yet)

The user can attach design references to any run (a design-only run, estimate, brownfield, and greenfield once that mode exists), from the terminal or the factory UI. To see only the design, `factory design start` (step 3b) stops at the approved design; an estimate or a build carries it on with `--from-design`. The design is then based on the references and the requirements. **With no references nothing changes:** the product reading, the industry library, the live brand reads, the reference checks and the record of recent looks work as they do now, with no extra step and no extra cost.

**What was found (research, 2026-10-02)**

- Frames (png, jpg, webp, svg, json) and a .docx's images are already stored with the run, but only their file names reach the model: the pack's `images` is hard-coded to `[]` (`src/context/pack.ts`) and the API runner sends text only. Sending images is the main missing piece.
- The pack rule (no images or untrusted text in a step that writes code) allows images in the design step and in a new read step; neither writes code.
- `measureBrands` (`src/design/refs/measure.ts`) already opens a site in Chromium and reads computed colours, font and button corners; the Jira source (`src/sources/jira.ts`) is the pattern for a token in `~/.factory/.env`; `cleanBrief` (`src/design/brief.ts`) is the allow-list for design extracts and is not called anywhere yet; `fit.ts` has the colour family checks.
- Colours sampled from a screenshot are near the brand colour, never equal to it (compositing, anti-aliasing, JPEG), so exact values come from a site's CSS or a Figma file, and images give look and layout. A vision model judges layout well and reads exact values badly, so code measures and the model only chooses from the measured list.
- Figma REST API: a personal token works; a file read is about 120 requests a minute and an image export about 30 a minute per user, each answered within 55 seconds. Frame exports are capped.
- Greenfield has no step list yet (`stepsFor` throws for it), and the build reads the approved design only through an estimate (`estimateRef.designSha`). *Revised 2026-10-04 (as built):* greenfield now has a step list; see [Greenfield](#greenfield-a-new-product-as-built-the-pr-11-reviews-follow-up-2026-10-04).

**What the references decide**

| Attached | Look (colours, type, corners) | Layout |
|---|---|---|
| Nothing | As now | As now |
| `layout` references only | As now (library) | From the references for those screens |
| `inspire` references | Within the references' colour family; the library fills gaps | References and requirements |
| `match` references | The references' values exactly | References and requirements |

- Roles are optional per reference. Without one, a Figma file or a brand guide is `match`, any other image or URL is `inspire`. The existing `--frames` become `layout` references.
- The requirements beat a reference; a departure is written in the theme's `departure`.
- Every reference is used or set aside with a reason.
- A reference that cannot be read stops the run at intake with a plain message ("attach a screenshot or an export"). It never falls back to the library without saying so.
- A brownfield repo whose look differs from a `match` reference: the clarify card asks whether to restyle. A restyle is a design-system change in size and in the estimate.

**Input**

- Terminal: `--ref <file|url>` on `factory design start`, `factory estimate` and `factory start`, repeatable, with an optional role in front and a note after `|`: `--ref match:https://client.com`, `--ref "layout:dash.jpg|table like this"`. Refused with `--from-estimate` and `--from-run`, which reuse an approved design (new references there are a change request: `--revises`).
- Factory UI: a "Design references" section on the New run form for every mode (see below).
- Each reference becomes `R-1`, `R-2`, ... in a `Reference` contract. At most 12 references and 20 images sent to a model (about 1.5k input tokens each).

**Turned into one form at intake, by code (`src/sources/refs.ts`)**

| Input | What code keeps |
|---|---|
| Any image (png, jpeg, webp, gif, avif, svg, bmp) | Decoded in Chromium (no new image library), PNG with the long edge at most 1568 px, main colours with their share of the area (marked approximate) |
| URL | Screenshots at 390 and 1280 px; computed styles: colours by role (brand, theme, header, button, page, text, link), body and heading fonts, the main button's corners, shadows (exact) |
| Figma link | With `FIGMA_TOKEN`: up to 8 screen-sized frames (the linked node, or the first page that has some) as PNG, and the look read from their nodes: colours by role (from style names such as Primary or Background, else the buttons' fill for brand, the frame fill for page, the most used text fill), body and heading fonts, the buttons' corners, shadows (exact) |
| Figma JSON export | The same look from its nodes, no pictures; a `.fig` file is refused |
| PDF | The first 6 pages as images (long edge 1568 px) and up to 4,000 characters of text (`pdfjs-dist`, run in Chromium); colours from page 1 (approximate); a password or a damaged file stops it |
| DOCX | Up to 6 embedded images (the largest, in document order; emf, wmf and tiff left out with a note) and the first 4,000 characters of text |
| Other formats, a login wall, a private Figma file | Stop with a plain message |

Only URLs the user gives are fetched: https only, no cookies, private addresses refused unless the project config allows them. Pages behind a login are out of the first version; the user attaches screenshots.

*Revised after the PR #11 review, item 17 (2026-10-03, as built):* the check now holds at connection time (`src/util/safe-fetch.ts`).
- Every request a reference page makes is fetched from Node by the route handler. The connection uses a DNS lookup that refuses a private answer, so the address checked is the address connected to: a name cannot pass the check with a public address and then connect to a private one (DNS rebinding).
- Redirects go back to the browser unfollowed, so each hop is checked again. Cookies are dropped.
- Each resource is capped at 15 MB, and a page's resources at 80 MB in all.
- The browser itself starts behind a proxy that is not there, so anything that gets past the handler (a WebSocket, a prefetch) reaches nothing.
- `isPrivateAddress` reads IPv6 in full. An IPv4 address inside IPv6 is caught in every spelling: `::ffff:7f00:1` (how a URL writes `::ffff:127.0.0.1`), IPv4-compatible, NAT64 `64:ff9b::/96` and 6to4 `2002::/16`. Site-local `fec0::/10` and the benchmark range `198.18.0.0/15` are refused too.
- Figma's frame pictures are read up to 25 MB each, with redirects refused, and its API answers up to 60 MB, without loading the whole body first.

**`design-refs` step (new, read-only, only when references exist)**

A vision model sees the images and the measured values and returns, per reference: its kind (brand, screen, component, mood board), which measured colour plays which role, the type style, corners and density, the navigation pattern, the layout regions, and the screen or requirement it relates to. The answer goes through `cleanBrief`. Text inside a reference is untrusted and never followed. A step that writes code never sees a reference, only typed tokens.

**Design step**

With references, a reference brief replaces the industry brief and the images go into the design call; `theme.basis` cites R-ids; template version 20. Checks in code (a failure goes back to the model, as today):

| Check | Role | Fails when |
|---|---|---|
| `design-ref-colour` | match | the brand or accent is not near the reference value |
| `design-ref-font` | match, exact source | the type pair differs from the reference |
| `design-ref-family` | inspire | the brand is outside the reference palette's family with no `departure` |
| `design-ref-layout` | layout | the rendered demo's regions (bar, sidebar, grid, tabs) differ from the reference's |
| `design-ref-unused` | all | a reference is neither cited nor set aside |

The recent-looks check is skipped for `match` (a client's brand may repeat); it stays for `inspire`.

**Factory UI**

- **New run form**, every mode (today frames are estimate-only and refused on a build run):
  - a drop zone for files (any image, PDF, DOCX, Figma JSON), each listed with a role picker (auto, match, inspire, layout), an optional note and a remove button;
  - a box to add URLs and Figma links, one per row, with the same role and note;
  - the Figma line says whether `FIGMA_TOKEN` is set (from `/api/projects`, like Jira);
  - the existing size limits, plus the 12-reference cap, are checked in the page and again on the server.
- **Intake errors** (a site behind a login, a private Figma file, a format we cannot read) show on the run page with the reference named and what to attach instead.
- **Design tab:** a References panel: each `R-n` with a thumbnail, its source and role, the measured colours and fonts (exact or approximate), and where it was used or why it was set aside.
- **Design card (approval):** each screen shows the reference that shaped it beside the demo screenshot.
- **API:** `POST /api/runs` takes `refs: [{ kind: "file" | "url", name?, data?, url?, role?, note? }]` (replacing `frames`, which stays as an alias); `GET /api/runs/:id/references` lists them; reference images are served only as PNG from the run's `refs/` folder with the preview key, like preview files.

**Built to plug into greenfield**

Greenfield is not built yet. The design work is built as one piece that any mode adds to its step list: *(Revised 2026-10-04, as built: greenfield builds a design approved in a design-only run, and draws none of its own; see [Greenfield](#greenfield-a-new-product-as-built-the-pr-11-reviews-follow-up-2026-10-04).)*

- `designSteps(opts)` (`src/stages/design-pipeline.ts`) returns `[design-refs?, design, design-baseline]` (the `design-refs` slot comes in step 5). Estimate, brownfield and later greenfield call it; nothing in it names a mode. The step keys are the same in every mode, so the UI, lineage and the build read them one way.
- **Inputs through named sources**, not fixed step keys: `DesignSources` (`src/stages/design-inputs.ts`) names the step holding the intent, the step holding the spec, and the repo's design inventory when the mode has a repo (left out for greenfield, which means a new look). The estimate passes `ESTIMATE_SOURCES` (intake, specify, ground's design inventory).
- **One approval step**, generic: `makeDesignApprovalStep({ sources, purpose })` is the estimate's E1b and the shared design approval. `purpose: "estimate"` keeps the E1b card word for word; `"build"` says the build follows the approved design.
- **One way out:** `approvedDesignFor(state, ledger)` returns the approved design from the estimate a build was seeded from, or else from this run's own approved design steps. Plan and implement read only this, so a build gets tokens and approved screens whichever way its design was approved. The plan's inputs carry this run's approval, so a design approved in the run replans; with none the hash is what it was.
- **A fixed component list for a new app** (2026-10-03): with no repo to read, a mode can give `DesignSources.components` (`StarterComponents`: where the list comes from, the framework and component system, and each component's name, kind and variants), such as greenfield's starter template. The design step then draws onto it ("NEW APP FROM A STARTER": every screen new, "design-system" only for a component the starter lacks). It is used only when the repo has no look of its own; an existing app's inventory always wins. `kitComponents()` (`src/design/kit/kit.ts`) gives the factory's shadcn kit as such a list. Without it, the inputs and prompt are what they were.
- **Proof** (`design-pipeline.test.ts`): a stand-in greenfield list (its own intake and spec steps, `designSteps`, a plan stub) draws, asks for approval in build words, approves, and the plan sees the approved design; the estimate's steps have the same keys, versions and inputs as before. When greenfield is built it adds `...designSteps({ sources, purpose: "build" })` and nothing else.

**Build order**

1. **Images to the model.** Fill the pack's `images` and send image blocks in the API runner (Anthropic; OpenAI as an option), images in the cache key. **Done 2026-10-02:** an image section (`S.image`, untrusted, user message only) puts a numbered `<untrusted_image n="k">` marker in the text and its ledger sha in `images`; each image counts 1,600 tokens and a briefing takes at most 20 (`src/util/image.ts`). The runner loads the bytes, reads the type from them (PNG, JPEG, GIF, WebP only, at most 5 MB) and sends `Image k:` then the picture before the briefing, for Anthropic, OpenAI Responses and local chat servers; a bad image stops the step before any model call. The pack sha and the cache key cover the images. The agent runner refuses images. `UNTRUSTED_IMAGE_NOTE` is the rule text for steps that show pictures.
2. **Design pipeline as one piece.** `designSteps`, `DesignSources`, `approvedDesignFor`, the generic approval step; estimate moved onto it with no change in behaviour (existing tests unchanged); the greenfield stand-in test. **Done 2026-10-02:** `makeDesignStep(sources)` and `makeDesignApprovalStep({ sources, purpose })` with the estimate's `designStep` and `designBaselineStep` as their defaults (same keys, template versions 19 and 1, same inputs); `designSteps` in `estimateSteps`; `approvedDesignFor` in plan, implement and the integrate size-cap. All 674 existing tests pass unchanged, plus 4 new ones.
3. **Reference intake.** `--ref`, the `Reference` contract, images, URLs and DOCX, colours measured in Chromium. **Done 2026-10-02:** `src/sources/refs.ts` and `src/contracts/reference.ts`. `--ref` on `estimate` and `start`; everything is read before the run exists, so a reference that cannot be read stops with `R-n (source): what to attach instead` and costs nothing. Pictures are decoded in Chromium, stored as PNG (long edge 1568 px, under 5 MB) with up to 8 main colours and their share (approximate). A site is opened with no cookies, every request checked (https only; private addresses refused, also for redirects and sub-requests, unless `design.allowPrivateRefs`), a login page, 401/403 or an error status stops it; it gives two screenshots and its computed look (exact). A brand guide (by its name or opening text) defaults to `match`, anything else to `inspire`. At most 12 references and 20 pictures. Pictures are stored as ledger artifacts and as `refs/R-n-k.png`, and the references go in `run.created` (`info.references`). Figma links and PDFs were refused until step 4. Checked live against stripe.com (brand `#533afd` read from its button, 15 s). 12 new tests.
3b. **Design-only runs and the design commands** (added 2026-10-02: a design could only be seen by running a whole estimate). **Done 2026-10-02:**
    - **Mode `design`** (`designOnlySteps`, `src/stages/modes.ts`): the estimate's road to the spec (`requirementsHead`: intake, ground, both clarify rounds, the spec pipeline, per module for a large document), then `designSteps({ purpose: "design" })`, and it stops at the approved design. No breakdown, sizing, estimate approval or workbooks. Stored answers are shared with estimates (same briefing, same answer), so designing then estimating the same requirements pays for the spec once. With no project the design is for a new product (no repo); with one it follows that app's look.
    - **Card wording** `purpose: "design"`: "Approve the design ... design only", with the two ways on (estimate or build) spelled out.
    - **Carried on, never redrawn** (`approvedDesign`, `src/estimate/lineage.ts`; `info.designRef`): `factory estimate --from-design <run>` seeds intake, ground, the clarify rounds, the spec, the design and its approval under the same hashes and only sizes; `factory start --project <p> --from-design <run>` seeds the spec (as `--from-estimate` does) and `approvedDesignFor` hands the approved design to plan and implement. A design run without a repo can be estimated but not built (greenfield comes later). *Revised 2026-10-04 (as built):* it is built as a greenfield run into a project whose repo is empty; see [Greenfield](#greenfield-a-new-product-as-built-the-pr-11-reviews-follow-up-2026-10-04). Refused with a prompt, `--file`, `--jira`, `--ref`, `--from-run` or `--revises`.
    - **Commands** (`src/cli/design-runs.ts`, ahead of the toolkit under `factory design`): `start` (the same inputs as `estimate`: prompt, `--file`, `--jira`, `--frames`, `--ref`, plus `--project`, `--no-repo`, `--client`, `--project-name`, `--max-cost`, `--fresh`), `show <run>` (stage, look, references with colours and fonts, screens, demo, screenshots and tokens; works on estimate runs), `list [--all]`, `open <run>` (the demo in the browser), `check-refs <ref...>` (reads references as `--ref` would, with no run and no cost; `--out` saves the pictures). Approve and send back with the usual `factory approve` / `factory reject`, or on the run page.
    - **Factory UI:** New run has a fourth card, Design: project or none, requirements, product name and client, frames, spend limit; `POST /api/runs` takes `mode: "design"` with `design: { noRepo, client, projectName }`. The run page's Preview shows the demo and the design card can be approved there, as for an estimate. The references section of the form came with step 8.
    - Tests: the mode's step list; seeding an estimate and a build from a design; a design run drawn, approved in its own words and carried into an estimate with no second model call; the web start. 696 tests pass.
4. **Figma and PDF.** `FIGMA_TOKEN` (Jira pattern, rate limits respected), `pdfjs-dist`. **Done 2026-10-02:**
    - **Figma** (`src/sources/figma.ts`): `figma.com/{design,file,proto,board}/<key>` links, branch links and `node-id` (`12-34` or `12:34`). The token comes from `FIGMA_TOKEN` in `~/.factory/.env` or the environment; without it the reference stops with how to set it or to export PNGs. Three API calls (the outline at depth 2, the chosen frames in full, one image export) plus one fetch per picture; a 429 is waited out when Figma asks for 60 s or less (twice at most), 403 and 404 say to share the file with the token's account. Frames are picked as screens (at least 200 px both ways, visible, inside pages, sections and groups; icons skipped); a link to one frame takes that frame. The look is read by code from the nodes (exact) and the model never sees the JSON. Default role `match`. A Figma link is never opened in the browser, so the private-address check does not apply to it.
      - **The pictures are fetched pinned** (the PR #11 re-review, item 17, 2026-10-04, as built). Each exported PNG is fetched with `pinnedRequest` (`src/util/safe-fetch.ts`): the connection goes only to the address its own DNS lookup checked, so a name that resolves to a private address, or changes between the check and the connection, is never reached. No redirect is followed. Before, only the URL's hostname was checked.
    - **Figma JSON export** (`.json`): a file, a nodes answer or a single node; the same look, no pictures, with a note. A `.fig` file is refused.
    - **PDF**: pdf.js runs in Chromium; its scripts, fonts and cmaps are served from `node_modules/pdfjs-dist` under a made-up origin and nothing else is fetched. The first 6 pages are drawn and pass through the same decode as a picture (size cap, colours); text from the first pages up to 4,000 characters. A brand guide (by name or opening text) is matched. A password, a damaged file or a file without a PDF header stops with a plain message.
    - Tests: links, the look from nodes, frame picking, JSON exports, API refusals and rate limits (no network), a PDF drawn page by page with its text, a damaged PDF, a Figma link read end to end with a stand-in API. 705 tests pass.
5. **`design-refs` step.** Prompt, schema, `cleanBrief`, skipped without references. **Done 2026-10-02:**
    - **Only with references** (`src/stages/design-refs.ts`): `designSteps({ refs })` puts `design-refs` before `design` when the run has references; estimate and design-only runs pass it. A run with none has the same step list and the same design inputs as before. With references the design step waits for the reading, and its inputs carry the reading's hash (`refRead`), so a new reading redraws.
    - **The briefing:** the requirements, each reference's code-measured values (colours with their part and share, fonts, corners, shadows, picture labels; trusted), its pictures (`S.image`, untrusted) and the user's note and a document's text (fenced as untrusted). Stage `design-read`, route `design-read` (Sonnet, medium effort, Opus on escalation), read-only, no tools, 60,000-token budget. Runs with no UI skip it with no model call.
    - **The answer, per reference:** kind (brand, screen, component, mood), the part each measured colour plays, the type style of body and headings (a style, never a family), corners, density, navigation, each picture's screen and regions, the requirements it relates to, up to six notes.
    - **Checked by code** (a failure goes back to the model): a colour that is not one of that reference's measured values (`design-refs-colour`), an unknown requirement (`design-refs-req`), an unknown, repeated or missing reference.
    - **Cleaned by `cleanBrief`:** palette names are the parts, hex values only from intake (the model's roles first, then the roles code measured on a site); fonts only those intake measured; screen and region names plain words; notes filtered for instruction-like text and kept as `untrustedNotes` (read-only steps only). What was dropped is kept in the artifact and logged.
    - `factory design show` prints each reference's reading (kind, navigation, colour parts, requirements).
    - The design step does not use the reading yet (step 6). Tests: the step list with and without references, the briefing (pictures, measured values, fenced note), the allow-list, the checks, the skip with no UI, and the design step waiting. 710 tests pass.
6. **Design step. Done.** With references, the design step reads the `design-refs` output (`src/design/ref-checks.ts`).
    - Briefing: the typed reading as `client-references` (trusted), the reader's and the client's notes fenced as untrusted, the reference pictures, and the `ref-rules` template (match, inspire, layout, basis by R-id, screen `refs`, `refUse`).
    - With any match or inspire reference (and no existing look), the field's library section, its live measuring and `themeFit` are dropped; with only match references the recent-looks check is skipped too. Layout-only references keep the library.
    - Code checks (`refFit`): `design-ref-unknown`, `design-ref-unused` (every reference used or set aside with a reason), `design-ref-colour` (match brand and accent are the reference's colours), `design-ref-font` (match type styles), `design-ref-family` (inspire hue unless `departure`), `design-ref-basis` (basis cites R-ids). An app that keeps its own look gets only the first two.
    - The artifact keeps each screen's `refs` and the top-level `refUse`; `theme.families` carries an exact match reference's own fonts (set by code), and the demo puts them first.
    - Template version stays 19: a run with references already hashes differently through the `refRead` input, so runs without references keep their keys, inputs and briefing. The rendered layout check is step 7. 717 tests pass.
7. **Rendered layout check** (`design-ref-layout`). **Done 2026-10-02:**
    - **Read from the drawn demo:** each block in the demo carries its type (`data-b`). For the screens that cite a layout reference, `readDemoLayout` (`src/design/screenshots.ts`) opens the demo at desktop width and reads each page as it first opens: its frame, the navigation a person sees (sidebar rail, top links, tab bar, menu button, page tabs, breadcrumbs) and its visible blocks top to bottom.
    - **Compared by code** (`refLayoutGaps`, `src/design/ref-checks.ts`): the reference's navigation (sidebar, top-and-side, top-bar, bottom-tabs, tabs) must show in the frame; each region of the pictured screen the page follows (the only one, or the one whose name shares the page's words) must be drawn by a block that can show it ("data table" a table, "KPI tiles" stats, "filters" filters, "breadcrumbs" and "tabs" the page's own). A region that names no block (app bar, pager), navigation read as none or unclear, a reference set aside, and inspire or match references are not checked. Order is not checked.
    - **One fix round, shared with the text layout check:** the gaps go back to the model with the text problems in one failure. After that round what is left is kept on the design (`refLayout`) and printed by `factory design show` (with how each reference was used and which references shaped each screen); the run goes on. No browser, no check.
    - A run with no layout references opens no extra page; the text check behaves as before. The demo for every run now carries `data-b` on its blocks (no visible change; a marker broke the table toolbar until fixed and covered by a test).
    - Tests: region names to blocks, gaps and fixes, which pictured screen a page follows, the demo read in Chromium, the design step sending a page without its regions back once and keeping the gap after. 727 tests pass.
8. **Factory UI.** Form section for every mode, `refs` in `POST /api/runs`, intake errors, References panel, references on the design card, `GET /api/runs/:id/references`. **Done 2026-10-02:**
    - **New run, every mode:** a "Design references" section (numbered in estimate and design, a field in brownfield, hidden when building from an estimate): drop or choose files (images, PDF, `.docx`, Figma JSON), an https link with Add, and per row the R-id, the source, a role (auto, match, inspire, layout) and a note, with remove. The page refuses at once more than 12, a duplicate, a `.fig` file, a file over 25 MB (Word 50 MB), more than 50 MB together and a link that is not https. Whether Figma links can be read is shown from `GET /api/projects` (`figma.configured`).
    - **`POST /api/runs` takes `refs`** (`[{ kind: "file", name, data, role?, note? } | { kind: "url", url, role?, note? }]`), checked again on the server (`checkUploadedRefs`, `src/ui/start.ts`; only the base name of a file is kept) and read by `gatherReferences`, as `--ref` is. References with a build from an estimate are refused. The body limit for a start is 80 MB.
    - **Intake errors show on the form**, not on a run page: the references are read before the run exists, so a reference that can't be read comes back from `POST /api/runs` with `R-n (source): what to attach instead` and nothing is created.
    - **References panel** on the Design tab and a strip on the design card: each reference's pictures (click to enlarge), role, kind, source, note, colours and fonts (Design tab), the reading, how it was used or why it was set aside, the screens it shaped and the layout gaps left (`GET /api/runs/:id/references`). The card's Markdown gains a "Design references" section (`refCardLines`).
    - **Pictures are served by the session key**, like the visual check's: `GET /refs/<run>/R-n-k.png`, only that name pattern, inside the run's `refs` folder, no symlinks. Not the preview key, which only opens the demo.
    - Tests: bad references refused before any run exists, the build-from-estimate refusal, a run started with references keeping them, the references view, the picture route (key needed, bad names and a symlink give 404), the Figma flag, the card's lines. Checked in the browser on a seeded run. 732 tests pass.
9. **Brownfield.** `designSteps()` before plan when the request touches UI and the run is not from an approved estimate; the restyle question on the clarify card. **Done 2026-10-02:**
    - **Step list** (`brownfieldSteps`, `src/stages/modes.ts`): a direct build runs `design-refs` (with references), `design` and `design-baseline` (build wording) between `specify` and `plan`. Not when it is built from an approved estimate or design (it follows that one), not once intake says the request has no UI (intake now records `touchesUi` in its step data), and not for a run that had already started its plan before this change (it goes on without replanning).
    - **The app's own look:** brownfield's ground step (`brownfieldGroundStep`, `src/stages/estimate-ground.ts`) keeps the repo's design inventory as the named output `design` when the request touches UI, as the estimate's does (same key, version and inputs); the design step reads it through `BROWNFIELD_SOURCES`. With a look of its own the design keeps it (`themeSource: "repo"`, the existing-app rules) and references shape layout and content only.
    - **The restyle question** (`restyleQuestion`, `src/stages/clarify.ts`): when the run has a `match` reference and the repo has a look of its own, code adds one question to the round-1 card (any mode with a repo, not split modules): keep the app's look and use the reference for layout and content (recommended), or restyle the whole app to it. Impact 3, so it never takes the default by itself. It is asked whenever both meet: the inventory keeps token names, not values, so code cannot tell the two looks already agree.
    - **Restyled** (`restyleChosen`): the design step drops the existing-app rules for `RESTYLE_RULES` (theme from the references, the app's pages, routes and shared components kept), the look and its checks are those of the match reference as for a new product (`refFit` in full), and the design says `restyle: true` with `themeSource: "new"`. Its inputs gain `restyle`, so the answer redraws; without a restyle they are unchanged.
    - **Sized as a design-system change:** the design card and `factory design show` say so; the estimate lists it as a UI factor; in a build the plan is told to put the tokens in the global stylesheet once (as for an estimate's new look), and the planned theme file makes the UI size a design-system change (`src/design/size.ts`).
    - The run's Design tab offers the clickable demo for a brownfield run that drew one.
    - Tests: the step list (direct, with references, no UI, from an estimate or design, planned before the change), the question and its answer, the card with no auto answer, the design kept and restyled, the card and estimate lines. 740 tests pass.
10. **Docs, tests and a visual check.** Fixtures per input type; a run with no references unchanged; one live run each with a URL, a JPEG and a Figma link (needs `ANTHROPIC_API_KEY` and `FIGMA_TOKEN` in `~/.factory/.env`).

### Design handoff (requirements 2 and 3, approved 2026-10-02; steps 1 to 6 built, 7 and 8 skipped)

Two requirements, planned together because they read the same thing:

- **Requirement 2:** after a design is approved, how it is stored, and how it becomes screens in the project's chosen tech stack.
- **Requirement 3:** the approved design can be exported to Figma, as PNGs, as a PDF and in other forms, from commands and from an Export button in the factory UI, in brownfield, greenfield and estimate runs.

They apply to every mode that uses the design pipeline (`designSteps`): estimate, design-only, brownfield and greenfield once it exists.

**What we have today (checked in the code, 2026-10-02)**

- **Storage.** The approved design is one JSON object in the run's ledger (`putJson`). Later runs find it through `approvedDesignFor` (`src/stages/design-inputs.ts`) and `--from-design` / `--from-estimate`. The approval step also writes `<run>/preview/`: the demo (`index.html`), `tokens.css`, `tokens.json`, frames and screenshots (`src/stages/estimate-approve.ts`).
- **Conversion.** An implement task that builds an approved screen gets `screenBrief` (`src/design/design-link.ts`): route, file, states, sample content, the look and the tokens. The model writes the screen from scratch. B7 checks the plan task can touch the screen's file.
  - **A task that covers several screens** (the PR #11 re-review, item 5, 2026-10-04, as built) gets a brief for each (`screensForTask`, `screensBrief`), up to 4, and the rest named. The screens are found from the estimate task's screen first; then from each screen file in the task's file scope, narrowed to the screens that share its requirements when that leaves any; else from the shared requirements alone. Before, such a task got no brief.
  - **Moved out of estimate** (the PR #11 re-review, item 14, 2026-10-04): the screen briefs are in `src/design/design-link.ts`; the design gates (E1b, E1c, B6, B7 and their design-run forms) are in `src/design/gates.ts`; and the design approval step is in `src/stages/design-approve.ts`. `src/estimate/gates.ts` imports the design gates so that everything that registers the estimate gates registers these too. The gate ids are unchanged.
- **Checks.** The token and component lint (`design.fidelity-lint`), the UI size cap (`design.size-cap`) and the opt-in visual check. The visual check compares the base commit with the head, not with the approved mock.

**Gaps**

1. The design lives only inside one run's ledger. There is no versioned copy per project or in the repo, and no way to change it after approval.
2. The model rebuilds tables, forms and charts on every screen, so screens drift from each other and from the demo.
3. Nothing compares the built screens with the approved demo.
4. Tokens come out as CSS only, and `Stack` is `dotnet | node-express | react-vite | nextjs`. There is no UI target per app (a phone app and an admin portal need different stacks).
5. There is no export beyond the run's preview folder, and nothing goes to Figma.
6. Some common controls cannot be described (see "Common controls" below).

**Research (2026-10-02)**

- **Converting designs to code.**
  - Screenshot to code (screenshot-to-code, v0, the Design2Code benchmark) gets layouts and states wrong, and we don't need it: the approved design is typed data built from a fixed set of about 30 block types.
  - What works:
    - tokens in the W3C Design Tokens format (stable since 2025.10), generated for each platform, as Style Dictionary does;
    - a mapping from design components to the codebase's real components (Figma Code Connect);
    - ready-made component kits copied into the repo (the shadcn registry);
    - screenshot comparison to check the result.
  - Compiling one component to many frameworks (Mitosis) is heavy and limited, and is not used.
- **Writing to Figma.**
  - Figma's official MCP server can write: `use_figma` (frames, components, variants, variables, auto layout, text), `generate_figma_design` (captures a running web page, localhost included, as editable layers) and `create_new_file`. Limits:
    - Only the remote server (`mcp.figma.com/mcp`) writes.
    - It takes OAuth only, from clients on Figma's allowlist (Claude Code, Cursor, VS Code, Codex, ...). Personal access tokens are refused and a custom OAuth app cannot get the MCP scope. **The factory runtime cannot call it**, and its locked network rules it out anyway.
    - Writing needs a full seat and edit access to the file; a Dev seat is read-only.
    - It is free during the beta and will become a usage-based paid feature.
    - `use_figma` handles no images and no custom fonts yet, and answers at most 20 KB per call.
    - `generate_figma_design` gives flat layers (no components or variants).
  - Figma's REST API (what our `FIGMA_TOKEN` reader uses) cannot create layers.
  - A Figma plugin can do everything, images and fonts included, with any client and any plan that can edit the file.
  - Community MCP servers that bridge to a plugin over a websocket work from any client, but they are third-party code with write access to client files. They are not used.
- Sources:
  - [Figma: write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas)
  - [Figma MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
  - [Figma MCP FAQs](https://help.figma.com/hc/en-us/articles/39252411778583-Figma-MCP-server-FAQs)
  - [GitHub changelog, 2026-03-06](https://github.blog/changelog/2026-03-06-figma-mcp-server-can-now-generate-design-layers-from-vs-code/)
  - [Scalekit: Figma MCP vs API](https://www.scalekit.com/blog/figma-mcp-vs-api)

**Principles (UI/UX, engineering and QA review, agreed 2026-10-02)**

1. **Block only on checks that give the same answer every time.** The demo and a real stack always differ in pixels (fonts, anti-aliasing, how each kit renders), so pixels never block. Tokens, structure and accessibility do.
2. **The approved design generates tests as well as code.** Every state, link, overlay, toast and form field becomes a test, tagged with its requirement id.
3. **Screen code is generated once and then owned by the repo.** The generator never runs again over code the model or a developer has edited. A later design version becomes a change task built from the diff.
4. **Code does the look; the model does the behaviour.** Generated presentational components take props; the model writes the containers (data, APIs, validation, state).
5. **Build one kit first.** Add a stack only when a real project needs it.

```
requirements ─► design (approved, vN) ─► design package vN ─┬─► exports: png · pdf · html · tokens · json · figma   (req 3)
                                                            └─► build: theme → kit → scaffold → model → fidelity   (req 2)
```

#### Common controls (built first; Done, design template 20)

What the design can describe today:

| Control | Today |
|---|---|
| Dropdown | Form field `select` (single choice, up to 8 options), `search` (type to filter), the sort control on results, the `menu` overlay |
| Checkbox | Form field `checkbox` (tiles at 3 or fewer options), table row tick boxes with select all, filter facets |
| Radio | Form field `radio` (tiles at 3 or fewer options) |
| Toggle | Form field `toggle` |
| Buttons | `actions` (1 to 4 labels, the first primary), form submit, buttons on cards, plans and overlays; danger only guessed on a confirm |
| Other inputs | text, textarea, date, number, currency, phone, one-time code, slider, card, upload |
| Navigation, overlays, feedback | Sidebar, top bar, bottom tabs, drawer, tabs, breadcrumbs, segments, switcher; modal, drawer, sheet, confirm, menu; toasts; empty, loading, error, success and validation states |

Added in design template 20 (Done), with plain labels still accepted where a field becomes an object:

- **Buttons:** `{ label, variant, icon?, iconOnly?, state? }`:
  - `variant`: primary, secondary, ghost, danger or link;
  - `state`: disabled or loading.

  This applies to `actions`, overlay actions, bulk actions and toolbar buttons. A button may also carry a `hint` (its tooltip) and a `menu` of up to six more choices, which makes it a split button.
- **Fields:**
  - new kinds `password` (show/hide), `email`, `time`, `daterange`, `multiselect`, `combobox` (type to filter, picked items as chips) and `consent` (one "I agree" checkbox);
  - per field: `required`, `help`, `disabled`, `readOnly` and `error` (its own message for the validation state).
- **Blocks:**
  - `alert`: an inline banner, with a tone, title, text and an optional action;
  - `toolbar`: dropdowns, search and buttons outside a form, such as "Sort by" or a split "Export" button;
  - linear `progress`: one to four bars.
- **Tables:** paging that works (`pages`, `page`).
- **Overlays:** `popover`, and tooltips as a `hint` on a button or field.
- **Small parts:**
  - a standalone status `badge` beside a page title or a detail value (Active, Overdue), not only inside cards, tables and results;
  - an avatar group (`people`: up to five names, then +N) on cards, list rows and detail.
- **The Components page.** A demo page, generated by code, showing every control the design uses, in the project's theme, in each state: default, hover, focus, pressed, disabled, error, loading. It is pictured and exported like a screen. It is what the Figma export turns into components and variants, what a stack kit must match, and a page of the design PDF.
- **Accessibility checks in the design step, by code:**
  - WCAG 2.2 AA contrast for every text-on-surface token pair, in each mode;
  - touch targets of at least 44 px on a phone (24 px on the web);
  - a visible focus token;
  - a label on every field.

  A theme that fails goes back to the model (`design-a11y`). As built:
  - the palette now makes every text colour readable on the page, cards and the raised grey, so a generated theme passes by construction;
  - the check (`contrastIssues` in `src/design/palette.ts`, `a11yFit` in `src/stages/design.ts`) covers the cases the palette cannot fix, and asks for a name on every field and button;
  - button labels on the brand need 4.5:1, or 3:1 when neither white nor dark ink reaches 4.5:1 on that brand;
  - touch targets are sized by the demo's CSS (44 px on a phone, with a larger hit area around small icons) and measured by a browser test, not by the model.
- **UI complexity** (`src/estimate/ui-complexity.ts`) counts the new parts: the new field kinds, field validation, table paging, the alert, toolbar (each dropdown and split button), progress, split buttons and avatar groups.
- **As built, the demo:** split menus, paging, show/hide password, combobox filtering and multiselect chips, the popover and tooltips all work; menus and lists close on Escape or a click elsewhere. The Components page is listed under "Design system" in the walkthrough, pictured on the approval card, and leaves out the rarer parts no page uses.
- Later, only when a project needs them: rating input (reviews are shown today but cannot be given), tags input (combobox chips cover most uses), colour picker, tree view, rich text.

#### The design package (requirement 2: storage; Done)

A new step, `design-export`, runs after `design-baseline` is approved. It writes a package that does not depend on any stack:

```
design/vN/
  manifest.json   version, schemaVersion, design sha, approved by and when, run id, references used, template version
  design.json     the approved design: screens, blocks, states, overlays, toasts, links, theme, locale
  tokens.json     W3C Design Tokens: primitive values, and semantic names the code uses (color.brand, color.text-muted)
  demo/           the clickable demo as static files
  shots/          reference screenshots: screen × state × width × mode × language, and the Components page
```

- **Never changed after approval.** The ledger stays the source of truth (the package is an export of it), and `design.json` carries a `schemaVersion` with migrations.
- **Kept in two places:** the factory project store, and the repo's `design/` folder, committed with the first build commit so developers and later brownfield runs see it.
- **Reproducible shots:** a frozen clock, no animation, fonts loaded, fixed viewports and the approved sample data. The same package gives the same pictures on every run; the fidelity check and the exports depend on this. *Revised after the PR #11 review, item 21 (2026-10-03, as built):*
  - **What made it flaky.** On a loaded machine the screenshot test failed now and then, by a few edge pixels one shade apart. The cause was Chromium's GPU and parallel raster threads, not timing.
  - **Drawing.** Reproducible pictures are now drawn in software on one raster thread, in plain sRGB, with no LCD text (`STILL_RASTER` in `src/design/screenshots.ts`).
  - **Settling.** The page waits for its fonts, its decoded pictures and two drawn frames, instead of a fixed 250 ms. A picture is retaken until two in a row match.
  - **Timeouts.** Actions get 30 s, not 10 s.
  - **Result.** Two rounds of six runs at once, six capture pairs per run, all gave identical bytes. Before the change, half of four parallel runs differed.
- **A change after approval** makes v(N+1): the design step runs again on the change, and the approval card shows the old and new screens side by side. The build pins a version by sha, and only the screens that changed are planned again, as change tasks.

As built (`src/design/package.ts`, `src/stages/design-export.ts`):

- **Where.** The store is `<FACTORY_HOME>/designs/<project>/<line>/vN/`; the repo (only with `design.commitPackage: true`) is `.factory/design/<line>/vN/`. The *line* is the run that approved v1, and every later version of that design keeps it, so two designs in one repo never clash. Besides the files above, the package holds `tokens.css` (the same look as CSS variables). There is no `tokens.json` when the look is the repo's own (`themeSource: "repo"`); the manifest says `look: "repo"`.
- **Manifest.** `kind`, `schemaVersion` (1), line, version, `designSha`, `demoSha`, run, product, `approved {by, at}`, template version, `designSchemaVersion`, references (with each one's use), screens, `previous` and `changes` (a change only), shots, and every file's sha-256. `checkPackage` finds a missing or changed file. `readDesignJson` applies migrations and refuses a format newer than the factory knows.
- **Written once.** The folder is filled under a temporary name and then moved into place, so it is never half written. Writing the same design again returns the existing package; a different design in the same version is refused.
- **Tokens.** W3C Design Tokens 2025.10. `primitive.color.<mode>.*` holds the values (colour objects with `components` and `hex`). The semantic names (`color.brand`, `color.text-muted`, ...) are aliases into the default mode, and a product with both modes names the dark alias under `$extensions["ai.factory.modes"]`. Also included: font family and weight, radius, space, shadow, and motion (`cubicBezier`).
- **Reproducible shots.** Chromium with the clock fixed at 2026-01-15 10:00 UTC, reduced motion, animations and transitions off, caret hidden, fonts awaited, scale 1, `en-US` locale and UTC. Capped at 240 pictures. A test checks that two captures are byte for byte the same. Without a browser, the manifest says why there are no pictures.
- **When.** The `design-export` step comes last in every mode's design pipeline. A run seeded from another run's design (a sibling estimate, `--from-design`, a build from an estimate) uses that run's package. A run approved before packages existed gets its package written the first time one is needed. Brownfield runs whose stubs were already committed do not gain the step, so they are not redone.
- **Versions and the change card.** A change request's design becomes the next version in the line of the design it changes, with `previous` and `changes` (the screen diff). If the earlier package is missing, it is written first. The change card says "this change becomes vN of design L (vM was approved in R)". The earlier version's matching pictures are copied into `preview/before/`, so the run page's Preview shows them before / after. A run with no earlier pictures says so on the card.
- **The first build commit.** `stub-commit` copies the package into `design/<line>/vN/` (manifest last) and commits it on its own (`factory: design L vN (approved by X) for <run>`) before the stubs. Diffs that judge the build start after that commit (`codeBase`): the size check, the UI size cap, the review and the PR lines. The secret scan still covers everything. The design inventory and the size checks skip `design/<line>/vN/`, so later runs never read the package as app code. *Revised after the PR #11 review, item 11 (2026-10-03, as built):* the UI size cap (`design.size-cap`) measures from the scaffold commit when there is one (`uiBase`). This means the kit, theme and pages the factory generated from the approved design are not counted against the agents' change.
  *Revised for greenfield (2026-10-04, as built):* the other diffs that judge the work now start there too: integrate's diff size and test-infrastructure lock, the review's diff and the PR's review lines. A new product's whole app is scaffold, and its `vitest.config.ts` would otherwise count as the agents changing test infrastructure. `codeBase` still decides whether any UI changed for the visual check. *Revised after the PR #17 review, item 1 (2026-10-04, as built):* only on a greenfield run (`changeBase`, `src/stages/workspace.ts`). Every other mode keeps those four on `codeBase`, so a scaffold that rewrites an existing app's screens is still reviewed and counted toward `maxDiffLines`; only the UI size cap starts after the scaffold there.
  *Revised after the PR #11 review, item 12 (2026-10-03, as built):* the package commit is **opt-in**.
  - **By default** (`design.commitPackage: false`) the client's branch gets no package: the build reads the package from the store. The diffs start at the base commit, or at the scaffold commit for the UI cap.
  - **With `design.commitPackage: true`** the package goes to `.factory/design/<line>/vN/`, not to `design/<line>/vN/`, a shape a client's own folders can have. Listings skip `.factory/design/<line>/vN/`. They skip an older `design/<line>/vN/` only where its `manifest.json` is the factory's (it names `designSha` and `templateVersion`). A client's own `design/tokens/v2/` is read as app code.
- **Only the changed screens are planned again.** Done in step 4: a change request's plan gets only the screens added or changed since the previous version (`changedScreens`, from the package's `previous`), and the stub commit writes only those screens again (see "Kit and scaffold (as built)").

#### Exports (requirement 3)

One command for any run with an approved design (estimate, design-only, brownfield, greenfield):

```
factory design export <run> [--format png|pdf|html|tokens|json|figma|all] [--out <dir>]
                            [--screens S-1,S-3] [--states ...] [--widths phone,tablet,desktop]
                            [--mode light,dark] [--lang en,ar] [--version vN] [--pdf-per-screen]
factory design export list <run>
```

(`factory design figma`, route B below, is not built.)

| Format | What it gives |
|---|---|
| `png` | Every screen × state × width × mode × language, and the Components page, named `S-1_empty_phone_dark_ar.png` |
| `pdf` | One design book: cover, the product reading, the look and tokens, the Components page, then each screen with its states, the flow and its requirement links. `--pdf-per-screen` gives one PDF per screen. Drawn by Chromium's `page.pdf` with the fonts embedded; no new dependency |
| `html` | The clickable demo as a standalone zip |
| `tokens` | `tokens.json` (W3C), `tokens.css` and the Tailwind v4 `@theme` block; the stack outputs below as they are built |
| `json` | `design.json` and `manifest.json` |
| `figma` | `figma.json` for the AI Factory Import plugin (route A below) |
| `all` | All of the above |

- **Default is on demand.** `--design-export png,pdf` on `factory estimate`, `factory start`, `factory design start` (and greenfield later) exports automatically right after the design is approved.
- **Files go to** `<run>/exports/vN/...`. Every file is tagged with the design version and sha, so a PDF sent to a client always matches what was approved.
- **The estimate** puts the design PDF beside the client workbook as its own file, not inside the Excel.
- **Factory UI: an Export button** on the design card and the run's Design tab, in every mode that has an approved design. Its menu offers:
  - PNG (zip);
  - PDF (design book, or one per screen);
  - Clickable demo (zip);
  - Design tokens;
  - Design JSON;
  - **Figma**: `figma.json` for the plugin, and a link to download the plugin;
  - Everything.

  The options shown are the same as on the command line (screens, widths, modes, languages). An export runs as a job on the server (`POST /api/runs/:id/exports`, `GET /api/runs/:id/exports`), shows progress, and the files are downloaded through the run's session key like the preview. Earlier exports are listed with their version.


As built (`src/design/export.ts`, `src/stages/design-export.ts`, `src/ui/exports.ts`):

- **Command.** `factory design export <run>` with `--format` (default `all`), `--out`, `--screens`, `--states`, `--widths`, `--mode`, `--lang`, `--version vN`, `--pdf-per-screen` and `--json`; `factory design export list <run>` lists earlier exports. `figma` writes `figma.json` (see "Figma (as built)"), and the command then prints the two lines that bring it into Figma. `--version` picks another version of the same design line and names the versions there are when it is missing. A run with no approved design is refused, and one waiting for approval says so.
- **Where.** Each export is its own numbered folder, `<run>/exports/vN/<n>/`, with `export.json` written last (line, version, design sha, options, every file with its sha-256 and format, and notes). `--out` writes elsewhere.
- **Versions.** An export has two numbers, and only the first is a design version:
  - **`vN` is the design version**, taken from the package, never chosen by the export. A design's first approval is v1 of a *line* named after the run that approved it; every run that draws its own design (an estimate, `factory design start`, a brownfield run with UI) starts its own line at v1. Only a change request (`factory estimate --revises <run>`) adds a version to an existing line: its design becomes the next free version of the line of the design it changes: `max(highest version in the line, the version it changes) + 1`. Two changes made from v1 become v2 and v3, and each records v1 as its `previous` with its own screen diff. A run seeded from another run's design (`--from-design`, `--from-estimate`, a sibling estimate) has no version of its own: it exports the package of the run it came from. A package is never changed, so the same `vN` always holds the same design sha (`writePackage` refuses a different design under a taken version).
  - **`<n>` is the export number**: 1, 2, 3, ... per run and per design version, the next after the highest folder already there. Exporting twice gives two folders; neither is overwritten. The files of two exports of one version differ only in what was asked for (formats, screens, widths, modes, languages), and `export.json` records those options and its time.
  - **An older version.** `--version vN` (or the UI's version picker) exports another version of the same line from the project's package store; the folder is `<run>/exports/vN/<n>/` of the run you exported from. A version the line does not have is refused with the versions it has. With no `--version`, the run's own approved version is exported.
  - **Names outside the run.** A whole-export download is `design-<line>-vN-export-<n>.zip` and a single file `design-<line>-vN-export-<n>-<file>`; the estimate's book is `<run>-design-vN.pdf`. Every file inside also carries the tag below, so the version survives a rename.
  - `factory design export list <run>` and the UI list the exports newest first by time, with `vN/<n>`, the design sha and the formats.
- **Tagged.** Every file says which design it shows: `ai-factory design L vN (sha12), approved by X on date`. PNGs carry it as a `tEXt` chunk (`ai-factory-design`), PDFs in the footer of every page (with page numbers), `tokens.css` and `tailwind.css` in a comment, `tokens.json` under `$extensions["ai.factory.design"]`, and the demo zip in its `README.txt`.
- **Formats.**
  - `png`: the package's pictures, never new ones (a package never changes), named `S-1_empty_phone_dark_ar.png`; the dark and other-language pictures show the screen's first state. The package's other-language pictures now record the language code.
  - `pdf`: an A4 landscape design book (cover, the product reading and basis, the look with swatches and type, the Components page, then each screen with its route, requirement links with their EARS text, and each state at its widths side by side, one state never split over two pages: a tall capture is scaled to fit, and the PNG export has it full size), printed by Chromium's `page.pdf`. `--pdf-per-screen` gives `pdf/S-1.pdf` and so on.
  - `html`: `demo.zip` (the approved `index.html` and a README), dated at the approval, so the same version always gives the same bytes.
  - `tokens`: `tokens/tokens.json` (W3C), `tokens/tokens.css` and `tokens/tailwind.css` (a Tailwind v4 `@theme` block with colours, fonts, radius, spacing, shadows and easing, and the dark values under `prefers-color-scheme` and `[data-theme]`).
  - `json`: `json/design.json` and `json/manifest.json`.
  - `figma`: `figma.json`, layers read from the approved demo in Chromium (see "Figma (as built)").
- **Never a failure.** What cannot be made is a note in `export.json`, and the rest is still written: no browser (no PDF, no figma.json), a package with no pictures, a design that keeps the app's own look (no tokens), or filters that match no picture.
- **`--design-export`** on `factory start`, `factory estimate` and `factory design start` (and Export on approval on the UI's New run form) is recorded on the run. The `design-export` step exports those formats right after it writes the package; a failed export is logged and the run goes on. A run seeded from another run's design (`--from-design`, `--from-estimate`, a sibling) has no design step of its own, so it exports at once when the run is created.
- **The estimate.** The `export` step writes `<run>-design-vN.pdf` beside the client workbook (never inside the Excel), and the manifest records its path, sha-256 and version, or a `designNote` saying why there is none (no browser). An estimate with no UI has no book.
- **UI.** `GET /api/runs/:id/exports` (what can be exported: the design's version, versions in its line, screens with states, widths, modes, languages, earlier exports and jobs) and `POST /api/runs/:id/exports` (a job: 202, one at a time per run, 409 while one runs, 400 for bad options). Downloads are `/design-exports/<run>/vN/<n>.zip` (the whole export) and `/design-exports/<run>/vN/<n>/<file>` (only files the export recorded), with the session key, no symlinks and nothing outside the run's `exports/`. These are the only writes the UI makes besides starting a run and the lead's decisions, and they write only under `exports/`.
- **The Export button** is on the run's Design tab: a menu (PNG zip, PDF design book, PDF one per screen, clickable demo zip, tokens, JSON, Figma, Everything), a version picker when the line has several, the screens, states, widths, modes and languages as checkboxes, progress while the job runs, and the earlier exports with their version and direct links to the book, demo and tokens. The design card is shown only before approval, when there is nothing to export yet, so it carries a greyed "Export after approval" button, and after Approve its message links to the Design tab's Export. The estimate page has a "Design book (.pdf)" link beside the workbooks. The New run form (Design, Estimate and Brownfield) has an **Export on approval** checklist (PNG, PDF design book, demo, tokens, JSON, Figma), the same as `--design-export` (`designExport` in `POST /api/runs`, checked the same way); a build from an estimate exports at once, as an export job the Design tab shows. The web design card is worded for its run: an estimate stands on the design, a design-only run keeps it and sizes or builds nothing, a build follows it.
- **The other design commands in the UI** (`src/ui/start.ts`, `src/ui/static/app.js`). `POST /api/runs` takes `fromDesign` (estimate or build), `revises` (estimate only) and `fresh` (estimate and design runs), with the command line's refusals: one starting point at a time; a design brings its own requirements, so a request, file, Jira key, frames or references are refused; a run seeded from another belongs to that run's project; a design with no repo cannot be built. `fromRun` (the other delivery model) is refused since estimates became solely agentic. `fresh` starts the background run with `FACTORY_NO_CACHE=1`. A seeded run with Export on approval exports at once, as with `--from-estimate`. The Estimate form has **Start from** (new requirements, an approved design run, a change request to an approved estimate) with a run picker; the project follows the run and the sections it brings are hidden. The Brownfield form's **Build from** lists approved estimates and approved design runs (a design with no repo shown greyed). Both forms take links: `#/new/estimate/<design|revises>/<run>` and `#/new/brownfield/<estimate|design>/<run>`. An approved design-only run's Design tab and an approved estimate's Estimate tab have a **Next** panel with those links. **Check references** in the references section posts to `POST /api/check-refs`, which reads them as `factory design check-refs` does (no run, no model, no cost) and shows each one's pictures, colours, fonts, corners and notes. `/api/projects` lists approved design runs (`designs`) and each approved estimate's delivery model (HITL only on older ones).

#### Figma

- **Supported route (A): our own Figma plugin, "AI Factory Import".**
  - The user opens it in Figma and picks a `figma.json`. It builds:
    - a page per app;
    - a frame per screen × state × width, with auto layout;
    - a components page with a component and variants for each control and block in each state;
    - variables (light and dark modes) from the tokens;
    - the screenshots as images where layers would be lossy (maps, charts as pictures in the first version).
  - The plugin reads only the chosen file, has no network access and needs only edit rights on the file. It lives in this repo (`figma-plugin/`), is built with the factory, and is installed from its manifest (published to the team's Figma organisation later).
- **Optional route (B): Claude Code with Figma's MCP server.** Not built (2026-10-03): it needs a paid Figma seat, and route A covers the need on the free plan.
  - `factory design figma <run>` serves the approved demo on localhost and prints, or hands to Claude Code, the instructions to capture each screen and state with `generate_figma_design` and add the token variables with `use_figma`.
  - It needs Claude Code (or another allowlisted client) signed in to Figma, a full seat and the beta. It runs only when the user starts it, outside the locked runtime, with no factory secrets.
  - The result is flat layers, good for review.
  - The Figma file link is recorded in the manifest.
- **Not used:** community MCP bridges.
- **Coming back from Figma.** If a designer changes the file, its link is attached as a `match` reference (the existing read-only `FIGMA_TOKEN` reader). That makes design v(N+1) through the normal approval card. The build always follows the approved package, never Figma directly.

#### Figma (as built)

Route A only (`src/design/figma.ts`, `figma-plugin/`). No Figma token, API key or paid seat is needed: a development plugin imported from its manifest runs on every plan, the free Starter plan included.

- **Command and UI.** `factory design export <run> --format figma` (also in `all` and `--design-export`) writes `figma.json`, then prints the two lines to run it in Figma. The Design tab's Export menu has **Figma (figma.json for the AI Factory Import plugin)**, says how to use it, and links **Download the plugin (.zip)** (`GET /figma-plugin.zip`, with the session key). Export on approval has Figma too.
- **How the layers are read.** For each picture the export asks for (the same screen, state, width, mode and language filters as PNG), the approved demo is opened in Chromium. It is set up the way its pictures were taken (the state's tab, `__lang`, `__mode("dark")`, a fixed clock, no motion, scale 1), and a walker reads the stage:
  - **frames:** fill, gradient, border per side, corners, shadows, clipping;
  - **text:** the characters, font families, weight, italic, size, line height, letter spacing, case, underline and strike, colour, alignment and line count, plus input placeholders and values;
  - **icons:** SVG, with `currentColor` resolved;
  - **pictures:** native controls (check boxes, radios, selects, ranges), images, canvases and background images, cropped from a screenshot of the same view.

  Any CSS colour (`oklch`, `color-mix`, `color(srgb ...)`) is read through a canvas. Auto layout is worked out from positions: children one after another with equal gaps and lined up on the other axis become a horizontal or vertical auto layout with its padding (fixed sizes, so nothing moves). Other frames keep absolute positions. Each frame gets its approved picture as a hidden, locked "Approved picture (reference)" layer, for comparison. A frame has at most 4000 layers.
- **`figma.json`** (`kind: "ai-factory/figma"`, `schemaVersion` 1): the tag, line, version, design sha, product and apps, the tokens as variables (`color/<name>` per mode, `radius/base`, `space/pad`, `space/row`, `font/body`, `font/heading`, `font/heading-weight`; only when the package has tokens), the fonts used, notes, and the frames (screen, title, app, state, width, mode, language, direction, size, layer tree and picture). The sample design gives 84 frames and about 15,000 layers in about 14 MB.
- **The check.** `figma.frames` (in `export.json`) passes when every screen state that has a picture in the package has a frame with layers.
- **The plugin** ("AI Factory Import", `figma-plugin/`: `manifest.json`, `code.js`, `ui.html`, `README.md`). It is a plain script with no build step, no network access (`allowedDomains: ["none"]`) and `documentAccess: dynamic-page`. It reads the chosen file in its window and builds:
  - a page per app, named `<app> - <line> vN`, with each screen's frames in a row (light, dark and other languages beside each other);
  - a variable collection with Light and Dark modes. The free plan allows one mode per collection, so there the dark values go in a second collection (`... - Dark`), and a note says so;
  - colours that equal a token, bound to its variable, and dark frames set to the dark mode (or bound to the dark collection);
  - fonts that this Figma has, matched by family and nearest weight. A missing font is shown in Inter and named in a note;
  - a "Component sets" page: each grid on the Components page becomes a component set with `Variant=<row>, State=<column>` variants, and each row of chips becomes one with `Name=<label>` variants. They are copies; the screens' layers stay plain frames;
  - plugin data on each frame (screen, state, width, mode, language, design sha), so a frame can be traced back to the design.

  It ends with a summary: pages, frames, layers, auto layouts, component sets and variants, variables, bound colours and notes. A file of another kind or a newer `schemaVersion` is refused.
- **Install** (once per Figma user): in the Figma desktop app, Plugins > Development > Import plugin from manifest..., then pick `figma-plugin/manifest.json` (from the repo or the downloaded zip). Then in any file you can edit: Plugins > Development > AI Factory Import, choose `figma.json`, Import.
- **Limits.**
  - The plugin has been tested against a stand-in for Figma's plugin API, not inside Figma itself. The first real import should be checked against the reference pictures.
  - `::before` and `::after` content (such as status dots) is not read, and text can wrap a little differently from Chromium.
  - The Components page's dark and other-language frames are named after its single state ("All states").
  - No `factory design figma` (route B). Nothing is read back from Figma automatically; a changed file comes back as a `match` reference, as planned.
- **Tests** (`src/design/figma.test.ts`): auto layout from positions, the variables, layers read from a page in Chromium (any colour syntax, inputs, icons, native controls, the component grid), a full export of the sample demo with its check, and the plugin run against a stand-in for Figma on a plan with modes and on the free plan (pages, frames, auto layout, bound colours, the dark collection, component sets and unique variant names, the font note, refusals).

#### Conversion to the chosen stack (requirement 2)

1. **A UI target per app.** `uiTarget` is set per app in the design (`next-shadcn`, `vite-shadcn`, later `expo`), and is separate from the backend `Stack`; a .NET backend with a Next.js portal is normal. It comes from the stack source (client, Folio3, undecided) and the app's device. An undecided target is asked on the clarify card before the build.
2. **Tokens → the stack's theme, by our own small generators** (no Style Dictionary):
   - CSS variables and Tailwind v4's CSS-first `@theme` for React, Next.js and Vite;
   - later, `theme.ts` for React Native, `ThemeData` for Flutter and a `wwwroot` stylesheet for Blazor.

   Code only ever uses the semantic names.
3. **A kit per UI target.** A versioned package in the factory, with its own component tests, copied into the project the shadcn way (the repo owns it).
   - It maps every control and block to a component. For `next-shadcn`:
     - Button, Select, Combobox (Command), Checkbox, RadioGroup, Switch and Input;
     - Dialog, Sheet, DropdownMenu, Popover, Tooltip and Alert;
     - Progress, Pagination, Tabs, Breadcrumb, Accordion, Calendar with a date picker, and Sonner (toasts);
     - TanStack Table for tables, Recharts for charts, Leaflet for maps.
   - The kit sets how each block changes with width once, for every screen: a table becomes cards on a phone, a sidebar becomes a drawer, a toolbar folds into a menu.
   - It goes into the repo in the first task (the design-system task) with the tokens.
   - **Brownfield:** the mapping points at the repo's own components from the design inventory, not the kit.
4. **Screen scaffold by code, generated once.** From `design.json` and the kit:
   - the route file, frame and navigation;
   - each block as a presentational component;
   - the states, overlays, toasts and translated text;
   - fixtures made from the approved sample data.

   The implement task (the model) then writes the containers: data, APIs, validation and the behaviour the requirements ask for. It is told not to restyle. A UI target with no kit falls back to today's route (the model writes the screen from `screenBrief`).
5. **Planning.** The plan's first UI task is the design-system task (tokens, kit, frame); then one task per screen, whose file scope covers its scaffold (B7 already checks this).
6. **Kits in order:** `next-shadcn` and `vite-shadcn` first; `expo` when a project needs a phone app; Flutter, Angular and Blazor only on demand.

#### Kit and scaffold (as built, step 4, 2026-10-03)

- **The UI target.** One of `next-shadcn`, `vite-shadcn` or `repo` (the repo's own components, no scaffold). It is chosen per run, in this order:
  - the project's `design.uiTargets` (per app id), then `design.uiTarget`;
  - the run's `--ui-target` (`factory start`, and the UI target select on the New run form, builds only), stored as `info.uiTarget`;
  - detection from the repo (`detectUiTarget`): an existing Next.js or Vite + React app takes the kit only when it already uses shadcn/ui (`components.json` or `components/ui/button.tsx`); a Tailwind-only or plain app, MUI, Chakra, Angular, Vue, Blazor and the like keep their own components and pages (a package.json with no pages yet takes the kit);
  - otherwise a run with no repo gets a fresh `next-shadcn` app, and an existing repo whose stack nothing shows is built with its own components, so a new app is never put into a repo unasked.

  A phone app is always built with the repo's components until the `expo` kit exists. One kit target serves every web app of a run. It is not asked on the clarify card: the project setting or `--ui-target` is the way to override detection.
- **The kit** is `kits/shadcn/` (`kit.json`, version 1.1.0): shadcn/ui components on Radix and Tailwind v4, a component for every block, form field kind and layer the schema has, the frame (`app-frame`, `screen-shell`, `overlay`) and helpers (class names, translations, fixture states, navigation per target). `kit.json` lists both targets (paths, stylesheet, routes) and the packages. A kit file is rewritten per target: `// @client` becomes `"use client"` for Next.js, `x.next.tsx` / `x.vite.tsx` are a target's own file, and `@/` imports stay when the repo maps `@/*` to the source root and become relative otherwise. Code: `src/design/kit/kit.ts`.
  *Revised after the PR #11 review, item 19 (2026-10-03, as built):* the kit is now version 1.2.0, and it is set up as follows.
  - **Exact versions.** Every package in `kit.json`, and the `@playwright/test` the scaffold adds, has an exact version, with no `^`. The versions are the ones the old ranges resolved to on 2026-10-03.
  - **Licences.** `components/ui/LICENSE` (shadcn/ui's MIT licence) is copied into a repo along with those components. `kits/shadcn/NOTICE` lists every package's licence.
  - **Build output.** `npm run build` copies `kits/` to `dist/kits`, and a build reads the kit from there.
  - **CI.** `npm run test:kit` scaffolds both targets, then installs, builds and typechecks each one. `.github/workflows/kit.yml` runs it when the kit or the scaffold changes. It passed locally on 2026-10-03.
- **The theme generator** (`src/design/kit/theme.ts`, no Style Dictionary): the approved tokens under the names shadcn reads (`--background`, `--primary`, `--muted-foreground`, ...), the design's extras (success, warning, info, shadows, density, heading type), dark values for a product in both modes, and Tailwind v4 `@theme inline`. The values are the demo's, so the built pages use the colours the lead approved. The first line carries the design tag (`ai-factory design L vN` or the design's sha).
- **The scaffold** (`src/design/kit/scaffold.ts`) is a pure function from the design to files, so the plan knows every path before anything is written:
  - the kit (written when absent; the repo owns it after) and the theme;
  - per screen `components/screens/<s-id>/screen.tsx` (the page as approved: blocks, states, layers, messages, links, `data-b` markers), `fixtures.ts` (the approved sample data) and `container.tsx` (the implement task's file, written when absent);
  - a route per screen (Next: `app/<route>/page.tsx`; Vite: `design-routes.tsx`), the frame and navigation, the translations;
  - a fresh app's skeleton (package.json, config, layout) when the repo has none.

  Every page opens in any state without a backend: `?fixture=S-3:empty`. Factory-owned files carry `Written by ai-factory` and are protected from the agents; containers and Next page files are the app's. In an existing repo nothing of its own is overwritten: what the kit needs there (packages, the stylesheet import) becomes the design-system task's to-do list.

  **Revised after the PR #11 review (2026-10-03), as built.** An existing app gets no parallel app beside it:
  - only its genuinely **new** screens are generated; a tweak, reuse or design-system screen is listed as `inPlace` and is changed in the app's own page file by a plan task (the plan gets `changeInPlace`, and `plan-scaffold` fails a plan with no task scoped to that page);
  - no frame or providers are written (`components/screens/frame.ts`, `providers.tsx` are a fresh app's only); the to-do is to link the new pages from the app's own navigation, inside its existing layout;
  - with no new screens nothing is generated at all (no kit, no theme, no design-system task). Checked by a build of both targets (`FACTORY_KIT_E2E=1`: npm install and a production build).
- **Plan wiring** (`src/stages/scaffold-run.ts`, `planStep`). The plan is given the scaffold (`ui-scaffold`) and rules: TASK-1 is the design-system task (its file scope covers the design-system files), then one task per screen whose scope has its container; the tasks write behaviour only; a change request plans only the changed screens. `plan-scaffold` fails a plan whose first task is not the design-system task, that leaves a screen's container out of every scope, or that lists a generated file. Gate B7 checks each screen task against its container (the page is generated).
- **Stub commit and implement** (`build.ts`). After the design package commit, the stub commit writes the scaffold and commits it on its own (`factory: scaffold <target> (kit shadcn 1.1.0) for <run>`), and records it as the `scaffold` output. Implement reads it:
  - the generated files are added to the protected paths (`extraProtected`);
  - a screen task gets the behaviour-only prompt (container, screen, fixtures; data, `onAction` and state; no restyling; keep the fixture branch);
  - the design-system task gets its to-do list.

  If the scaffold cannot be made, the build logs `scaffold: not generated (why)` and goes on with today's route (the model writes the screen from `screenBrief`).
- **Commands.** `factory design kit list`, `factory design kit show [target]` (framework, paths, packages, the component for each block, field kind and layer, the width rules), `factory design target <repo>` (what detection picks and why), `factory design scaffold [run] [--target] [--out dir] [--files]` (`--sample` scaffolds a built-in sample design), and `factory start --ui-target`. All take `--json`.
- **UI.** The Design tab has a **Code: kit and scaffold** panel: the run's target and why, a target select to preview another, counts by owner, the screens with their routes, containers and states, the design-system to-do list, every file, and **Generate**, which writes a copy under the run's `scaffold/<target>/` with a zip to download and run in fixture mode. API: `GET /api/runs/:id/scaffold[/:target]`, `POST /api/runs/:id/scaffold`, download `/scaffolds/<run>/<target>.zip`. The New run form has the UI target select for builds.
- **Every UI task gets its screen brief** (revised after the PR #11 review). The implement prompt's `approved-screen` no longer needs an estimate or a kit scaffold: the estimate task's screen first, then the scaffold's, then `screenForTask` (the one approved screen whose page file is in the task's scope, else the one sharing its requirements). So MUI/antd, Razor and `--from-design` builds get it too.
- **The acceptance tests see the approved screens** (revised after the PR #11 review, item 13, 2026-10-03, as built). The test writer gets an `approved-screens` section (`screenFacts` in `src/design/design-link.ts`). It lists each approved screen that serves the criteria' requirements, with:
  - its route and states;
  - the exact words on it: title, buttons, field labels, column headers, the empty, error, success and validation messages, toasts;
  - a design note's `change` text.

  It is told to take expected values from there, word for word, where a criterion is about what the user sees. The test writer's template version is now 3.
- **Tests.** `kit.test.ts` (15, plus the e2e build), `scaffold-run.test.ts` (17), `design-link.test.ts` and UI route tests.

#### Greenfield: a new product (as built, the PR #11 review's follow-up, 2026-10-04)

A design approved in a design-only run with no repo (`factory design start --no-repo`) is built as a new product into an empty git repo. Nothing is drawn or specified again: the run is seeded from the design run, like a brownfield `--from-design` build.

- **The project.** `factory init <folder>` on an empty repo writes a Node project (`stack: node`). "Empty" means no commit, or only a README, a licence, `.gitignore`, `.gitattributes` or `.editorconfig` (`src/config/greenfield.ts`). A repo with no commit gets an empty base commit ("Start (factory init: a new product)") so a run has something to branch from. The scaffold writes the app's own `.gitignore` in the first build commit. `--branch` names the branch of a repo with no commits.
- **Starting it.** `factory start --project <p> --from-design <run>`, or Build on the web UI, with a no-repo design. The run's mode is `greenfield`. It is refused, with what to do, when the project's repo already has code, when the project is `stack: dotnet`, or when the project has no repo. A no-repo design may be built in any project (it was designed under the standalone project), and a design with a repo only in its own. The web form labels empty-repo projects "(empty repo: for a new product)" and picks the only one for a no-repo design. The design screen's "Build this design" link now shows for a no-repo design too.
- **The steps** (`greenfieldSteps`, `src/stages/modes.ts`): discover; intake, ground, the clarify rounds and the spec, seeded from the design run; plan, approve, stub-commit, author-tests, implement per task, integrate, accept, design-fidelity, design-check, review, deliver. A design run with no ground output gets `newProductGroundStep`, which writes the new-build behaviour with no model call. Discover records an empty, valid baseline: there is nothing to build or test yet.
- **The app.** An empty repo's UI target is a fresh `next-shadcn` app (`targetForRun`: "an empty repo: a fresh app"); `--ui-target` or the project setting can override it. Stub-commit writes the scaffold as its own commit. The plan is checked against it as for any scaffold. The design package is found under the standalone project the design was drawn in (`packageForRun`).
- **The Node lab** (`src/verify/node.ts`, chosen by `labFor(project)`): install with `npm ci` (or `npm install` with no lock file) through the feed proxy, npm registry only, with no install scripts. Then `npm run build --if-present` and vitest (JSON report) with no network. Test IDs are `file::describe > title`, and a targeted run is a `-t` title pattern. Failed tests that aren't locked are re-run once, as in .NET. Accept boots the built app with `npm start`, or `vite preview`, and sends the probes. A coding agent gets the checkout's `node_modules` installed before it starts. The prompts for the planner and the agents say TypeScript, vitest and `tests/` instead of .NET (`src/stages/stack-text.ts`). A Node project with `database:` is refused.
- **After the PR #17 review (2026-10-04, as built).**
  - Item 1: the diff size, the test-infrastructure lock, the review's diff and the PR's review lines start after the scaffold only on a greenfield run (`changeBase`); see "The first build commit".
  - Item 2: `factory init` refuses a repo with no commits that has anything but starter files staged or in the working tree (`assertNothingWaiting`), before it writes anything, so the "empty" base commit never takes in code.
  - Item 3: on a detached HEAD, brownfield `factory init` takes the branch as `HEAD`, as it did before greenfield (`currentBranch`).
  - Item 4: `commitAt` is undefined only for a ref that does not exist; any other git error throws, so a repo is never read as empty by mistake. Discover's empty baseline is used only on a greenfield run.
  - Item 5: `stack: node` is for a new product only. A brownfield run on a Node project is refused at `createRun` until changing an existing Node app is decided.
  - Item 6: a vitest file that fails to load is a failed result (`<file>::(the file did not load)`, `loadFailures`), and the runner's exit code stands. `tests.expectations` fails on it (`load-error`), locked or not, unless the same file failed to load before the change. It is not re-run.
  - Item 7: a coding agent's `node_modules` is installed again whenever `package.json` or the lockfile changed since the last install (`installKey`, kept in `node_modules/.factory-install-key`).
  - Item 8: `greenfield.test.ts` checks fidelity on a new product's app in a real browser: the scaffold's screen is opened, and a page that is not the design stops the run on a waiver. The `scaffold-run.test.ts` case for a repo whose stack nothing shows asserts `source: "default"` again.
- **Copies are logged.** Each copy of a run's scaffold that someone takes (`factory design scaffold --out`, the UI's Generate and its zip download) is a `scaffold.copied` event in the run's ledger: who, which target, and where it went.
- **Tests.**
  - `greenfield.test.ts`: an approved no-repo design is built into an empty repo with a scripted model and a fake Node lab. It goes through to a delivered branch holding the scaffold, the tests and the screen's code, and the refusals are checked too.
  - `config/greenfield.test.ts`, `verify/node.test.ts` (13), and the greenfield cases in `modes.test.ts`, `scaffold-run.test.ts` and `ui.test.ts`.
  - `npm run test:lab` runs the Node lab with real containers. It scaffolds an app with two tests, then installs, builds and tests it, and boots it for a probe. It needs Docker or Colima, and it passed on 2026-10-04 (about 6 minutes).

#### Fidelity and tests (QA)

The built app runs in fixture mode (`?fixture=S-3:empty`, any state without a backend), at the widths, modes and languages of the package's `shots/`. It is checked at four levels:

| Level | What it checks | Gate |
|---|---|---|
| 1. Tokens | Every colour, font, radius and shadow computed on the page is in the token set | Blocking (`design.tokens`) |
| 2. Structure | Every approved block, field, button, column, tab and label is there with the approved text (the `data-b` markers) | Blocking (`design.structure`) |
| 3. Accessibility | axe-core critical and serious issues, keyboard tab order, focus visible | Blocking (`design.a11y`) |
| 4. Layout and pixels | Layout boxes within a tolerance (`compareLayout`), pixel diff (`pixelDiff`) | Advisory. Layout becomes blocking once calibrated on real runs; pixels never block |

Like the other build gates, the blocking ones can be waived with a reason on the waiver card.

- **Tests generated from `design.json`** (Playwright, in the repo, tagged with requirement ids):
  - every state, from its fixture;
  - every link (it navigates);
  - every overlay (it opens from its trigger);
  - every toast (it shows after its action);
  - every form (required fields, field kinds, error text).

  This traces each requirement to its screen, its components and its tests.
- **Devices and browsers:** phone, tablet and desktop widths on Chromium, and WebKit at phone width. Dark mode and right to left only when the design has them.
- **Baselines:** differences show on the accept card beside the approved picture. Accepting a deliberate change makes it the new baseline, recorded in the ledger, never silently.
- **Exports are checked too:** the PDF has every screen, its fonts embedded, and a page count that matches the manifest; the PNG count matches the screens × states matrix.

#### Fidelity and tests (as built)

- **The step.** `design-fidelity` (no model) runs after `accept` in builds, before `design-check`. **On by default since the PR #11 review (2026-10-03):** it runs whenever the factory generated the screens:
  - the run has a kit scaffold with screens (`next-shadcn` or `vite-shadcn`, not the repo's own components);
  - the run has an approved design;
  - the project has not switched it off (`design.fidelity: false`).

  It builds and starts the app in containers (the PR #11 re-review, blocker 2, 2026-10-04, as built; before, it ran on this machine in the run's worktree), `src/design/app-container.ts`:
  - a copy of the commit is installed in the agent image with only the package feeds reachable (through the feed proxy);
  - the app is built and started in the same image with **no network**;
  - the check reaches it through a small bridge on this machine's loopback, which pipes each connection into the container (`docker exec -i … node`). No port is published, and nothing in the container can reach out.

  `allowHost: true` keeps the old way: on this machine, in the worktree, with a scratch HOME and none of the factory's secrets. Otherwise it logs `fidelity check skipped: <why>` and passes. When it runs, it:
  - installs the app (`npm install --no-audit --no-fund`), builds it and starts it on `$PORT` (`next build && next start`, or `vite build && vite preview`);
  - opens every page the package pictures, at most `maxPages`. That is every state at phone and desktop width, the first state at tablet width, and the first state in dark mode and in the other language when the design has them.

  The report and pictures go to the run's `design-fidelity/` folder. Code: `src/stages/design-fidelity.ts`, `src/design/fidelity-app.ts`, `src/design/fidelity-read.ts`.
- **Tokens against the approved theme.** The token level compares with the approved new look only (`approvedTheme`); there is no fallback to the default theme. An app that keeps its own look is not compared: the tokens level is `UNCHECKED`, not blocking, with the reason, and its gate passes.
- **Existing apps and screens changed in place** (the PR #11 re-review, item 8, 2026-10-04, as built; before, both were skipped):
  - **Tokens of an app that keeps its own look** are compared with the values its own source names at the base commit (`ownTokens`, `src/design/repo-look.ts`, read as text): every colour literal and custom property in its stylesheets and theme files, the fonts they name, their corners (and Tailwind's corner steps), and their shadows. A value the source names nowhere is a finding, but it is **advice**: the level shows `WARN` and its gate passes, because a source read as text does not list everything (a Tailwind palette class, say; the report says so). With no such values the level stays `UNCHECKED` as before.
  - **Screens changed in place** (no kit scaffold, the brownfield path) are checked too: every approved screen the kit does not build, outside a phone app and not a design-system entry (`inPlaceScreens`). Each is opened once per width at its route as the app runs it, with no fixtures, so only a fixed route (no `:id`) can be opened; the others are named in the notes. Its structure is advice, since the app shows its own data. Accessibility blocks as for the kit.
  - The app starts with `design.fidelity.start`, else its own scripts: `npm run build && npm start` (start reads `$PORT`), or its Vite preview on `$PORT`. With neither, the step skips and says to set `design.fidelity.start`. It runs in the same containers.
  - A finding marked advice (`advice: true`) never fails its level; a level whose findings are all advice is `WARN`. `factory design fidelity <run> --url` checks the same screens.
- **Config.** `design.fidelity` is optional (the defaults below) or `false`. It takes:
  - `allowHost: true` to run the app on this machine instead of in containers (your consent to run the agents' code and its install scripts here, with network access);
  - `install` and `start` (start reads `$PORT`);
  - `port` (default 4320), `readyPath` (default `/`), `timeoutSec` (default 600) and `env`;
  - `maxPages` (default 160).

  See `docs/project-example.yaml`.
- **The levels.**
  - **Tokens:** every colour, font, corner and shadow drawn on the page is one of the design's. Scrims, round pills and focus rings in a design colour pass.
  - **Structure:** what each state must show is worked out from `design.json`. That covers the page title and tabs, each block in order with its words, the state's message, the open layer and the toast. Blocks are matched by their `data-b` markers.
  - **Accessibility:** axe critical and serious issues, keyboard focus order, and visible focus.
  - **Layout:** advisory. It flags a block present on only one side, blocks in another order, and a block's width share off by more than 25% against the approved demo.
  - **Pixels:** advisory, and compares only against an accepted baseline.

  WebKit runs a structure and axe pass at phone width (findings prefixed `WebKit:`). When WebKit is not installed the report says so; install it with `npx playwright install webkit`.
- **Gates.** `design.tokens`, `design.structure` and `design.a11y` (`src/design/gates.ts`). Each lists up to 20 findings with their pages, and a level that could not be checked fails. A failure goes to the waiver card: the gate wording is generic now ("Run X these gates fail:"), and a waiver covers that commit only.
- **Baselines** (`src/design/baselines.ts`). Accepting copies the run's built pictures into the design line's `baselines/` folder, beside its versions, so a later version is compared with what was accepted before. It also writes `index.json` (file, sha256, run, design version, who, when, why). It needs a name and a reason, and refuses a page the run did not picture. The ledger records `human.decided` with `cardId design-baseline` and `decision accept-baseline`. Accepting happens from the command only (the Fidelity panel shows it), not on the accept card or the page.
- **Generated tests** (`src/design/kit/e2e.ts`). The scaffold writes `e2e/design/<screen>.spec.ts` for each kit screen, tagged `@S-n` and with the screen's requirement ids. Each spec tests:
  - every state from its fixture;
  - every link (desktop and tablet only);
  - every layer (it opens from its trigger and closes on Escape);
  - every toast (it shows after its action);
  - every form's labels.

  A layer's button opens the layer first, and a table's bulk action ticks a row first. It also writes `playwright.design.config.ts`, with these projects:
  - `phone`, `tablet` and `desktop` on Chromium;
  - `desktop-dark` when the design has dark mode;
  - `webkit-phone`, unless `DESIGN_BROWSERS=chromium`.

  Run them with `npm run test:design`:
  - `DESIGN_BASE_URL` tests an app that is already running; otherwise the tests build and start it on port 3100;
  - `DESIGN_CHANNEL=chrome` uses the installed Chrome.

  A fresh app gets the `test:design` script and `@playwright/test` (`^1.55.0`), and its tsconfig leaves the e2e files out. An existing repo gets both as design-system to-dos. On the sample app: 107 passed, 5 skipped (phone click-throughs).
- **Kit 1.1.0.** Tabs now act like any button, so an overlay triggered by a tab opens. The fixture toast stays visible (it does not time out). There is a `Segmented` control. The theme writes `0 0 #0000` for "no shadow".
- **Export checks** (`src/design/export-check.ts`). Each export's `export.json` has `checks`, also shown as chips on the export list:
  - `pdf.screens`: every screen's named destination `screen-<id>` is in the book;
  - `pdf.fonts`: every font is embedded (Type3 or a font file);
  - `pdf.pages`: at least the cover plus one page per screen;
  - `png.count`: every screen × state has a picture, with one file per picture.

  On the sample package all four pass (47 pages, 7 screens, 84 PNGs covering 21 screen states).
- **Commands.**
  - `factory design fidelity <run> [--url <base>] [--json]` shows the run's report. With `--url` it checks an app that is already running, without gates.
  - `factory design baseline <run> [pages...] | --all --reason "..."` needs a terminal and records your login name. `--list` shows the accepted pictures.
  - `factory design export` prints the checks.
- **UI.** The Design tab has a **Fidelity to the approved design** panel:
  - the overall result and what ran;
  - the five levels (blocking or advice) and any waivers;
  - the findings;
  - a page picker (optionally only pages with findings), showing the approved picture, the built picture, the accepted baseline and the difference in red;
  - the page's findings;
  - accepting the pictures as the baseline is a terminal decision: the panel shows the `factory design baseline` command (removed from the page after the PR #11 review: a web accept was not hash-bound or lock-checked).

  API:
  - `GET /api/runs/:id/fidelity`;
  - pictures at `/fidelity-shots/<run>/<built|approved|baseline|diff>/<name>.png`, needing the key, by file name only.
- **Tests.** `src/design/fidelity.test.ts` (15) covers:
  - pages, words, expectations, structure, tokens and layout;
  - the gates and baselines;
  - the PDF facts and export checks;
  - the presses, the spec, the config and the scaffold's e2e files;
  - the step's skip.

  Also: a UI route test (the panel, picture paths, accept validation, the ledger event), the waiver wording, and the kit's change request (S-2's spec is rewritten with it).
- **Live run on the sample app** (70 pages, about 100 s): tokens, structure and accessibility pass. Layout gives 7 findings: the demo draws detail and receipt side by side and widths differ, which is why layout stays advisory until it is calibrated. Pixels are not checked until a baseline is accepted.

#### Decisions (2026-10-02)

| # | Decision |
|---|---|
| 1 | The common controls, the Components page and the design-time accessibility checks come first |
| 2 | Package kept in the factory store and the repo's `design/`; never changed after approval; `schemaVersion` with migrations |
| 3 | Screens are scaffolded by code once; the model writes behaviour; later versions arrive as change tasks |
| 4 | First kit `next-shadcn` / `vite-shadcn` only; `expo` when a project needs it |
| 5 | Fidelity at four levels: tokens, structure and accessibility block; layout advisory then blocking; pixels never block |
| 6 | Our own token generators, with semantic tokens and Tailwind v4 `@theme` |
| 7 | A change after approval makes a new version, with old and new shown on the approval card; only the changed screens are planned again |
| 8 | Figma through our own plugin; the Claude Code + MCP route is optional; no community bridges |
| 9 | PDF: one design book by default, `--pdf-per-screen` as an option |
| 10 | Exports on demand, from the command or the UI's Export button; `--design-export` makes them automatic on approval |
| 11 | The estimate's client delivery includes the design PDF as its own file |

#### Build order

1. **Common controls.** Done.
   - The schema additions, drawn and working in the demo, with data checks.
   - The Components page; `design-a11y`; UI complexity points.
   - Design template 20. `docs/design-references.md` lists the new controls.
2. **Design package.** Done (as built under "The design package"). The `design-export` step, `manifest.json`, `schemaVersion`, W3C tokens with semantic names, reproducible reference shots, versions and the side-by-side change card, and the repo `design/` folder on the first build commit.
3. **Exports.** Done (as built under "Exports"). `factory design export` (png, pdf, html, tokens, json) and `export list`, `--design-export` on every mode, the export API and the **Export button** (on the Design tab; the design card links to it after approval), and the design PDF beside the estimate's client workbook.
4. **Kit and scaffold.** Done (as built under "Kit and scaffold (as built)"). `uiTarget`, the token generator for web, the `next-shadcn` / `vite-shadcn` kit with its tests, the scaffold generator, and plan and implement wiring (design-system task first, behaviour-only implement prompt, only the changed screens for a change request); the `design kit`, `design target` and `design scaffold` commands, `--ui-target`, and the Code panel.
5. **Fidelity and tests.** Done (as built under "Fidelity and tests (as built)"). The `design-fidelity` step in fixture mode, the four levels with gates `design.tokens`, `design.structure` and `design.a11y`, Playwright tests generated from the design (Chromium at three widths, WebKit at phone width), baselines accepted with a reason into the ledger (from the command or the Fidelity panel), and export checks.
6. **Figma.** Done, route A only (as built under "Figma (as built)"). `figma.json` from `factory design export --format figma` and the Export button, and the AI Factory Import plugin, with no Figma token or paid seat. Route B (`factory design figma`) is not built.
7. **More kits on demand.** Skipped for now (2026-10-03): no project needs a phone app yet. `expo` comes first when one does.
8. **Docs, tests and live runs.** Skipped for now (2026-10-03), with step 7. Docs and tests were written with each step; live runs need `ANTHROPIC_API_KEY` (route B's full Figma seat no longer applies).

Steps 1 to 3 are useful on their own: clients get PNG and PDF exports straight away. If a client needs Figma before code, step 6 can move ahead of step 4.

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
2. **Catalogue sizing (2026-10-03 on):** every task has a kind from the pinned task catalogue (`src/estimate/assets/catalogue.json`). The model picks a size step per task against the kind's written scale, plus verify and context grades for factory work. Code reads the hours: typical hours × size × complexity × UI level × grades × stack factor. The result is written as anchors and ratios (the first task of each kind is the anchor), so steps 3 to 6 below are unchanged. See docs/estimate-consistency.md, section 10. The catalogue's status comes from evidence, not a sign-off (section 13), and the factory tunes its factors and hours from builds and real project hours as new versions, each run pinned to the version it was sized with (section 14). Breakdowns made before kinds use the anchors in the next paragraph.
   **Anchors (before catalogue sizing):** the model proposes a few reference tasks, estimated in detail for this project's stack, design and constraints. Every other task is sized relative to an anchor, with the reason stated ("about twice the anchor: 12 fields instead of 6, plus a state machine"). Code computes anchor × ratio.
3. **Estimators:** every band uses **three** independent estimators (changed 2026-10-03; before, XS and S used one). Code merges them by **median**: each task's range is the median of the three mins and the median of the three maxes, so one estimator that reads high or low does not move it. Disagreement beyond the tolerance flags the item. Gate E6 recomputes the median. See `docs/estimate-consistency.md`, section 10.
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

### The stack priced

The estimate records the stack and architecture it priced as fields, `estimate.stack` (`StackChoice` in `src/contracts/estimate.ts`): `backend`, `web`, `mobile`, `database`, `hosting`, `architecture` (each left out when the work does not need it), `basis` (`repo`, `request` or `assumed`) and `notes` (what was assumed). The estimator fills it in, given what is already known (`knownStack`: the repo's backend and web framework, the chosen UI target, and who chooses the stack), and a lead's edit keeps it. A build, greenfield in particular, builds what was priced instead of choosing again. The Estimate tab shows it under **Stack priced**. Estimates made before 2026-10-03 have none. The estimate step's template version is 3.

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
- **Eval runs feed it too (built 2026-10-06).** Estimate and design runs never build, so the ledger alone leaves build and verification cold-start. The paid eval runs published under `evidence/` (`evidence/runs/*/row.json` and each case's run in `evidence/evals/e2e/*.json`, read once per run id) add build and verification records (`loadEvalRecords` in `src/estimate/records.ts`). Their planning is a ticket's, not a requirements document's, so it is not used. A run the ledger home already has is not read twice.
- **Each phase says what it is based on (built 2026-10-06).** Every phase stores `basis: { ledger, eval }`, the measured runs behind it; none of either means the cold-start figure. The Summary's API block has a "Based on" column ("measured: p10-p90 of N runs", or "assumed: no measured runs yet"); the team file's Confidence sheet also names the sources (ledger runs, eval runs). Estimates made before have no basis and show none.
- **Per task (built 2026-10-06).** Every task also shows its own API cost, min and max: its share of the build and verification phases, by its sized hours (the midpoint, so a task's min never passes its max), in whole cents that add up to those phases exactly (`apiCostByTask` in `src/estimate/cost.ts`, stored as `apiUsd` on each sized task). Factory and joint tasks have a share, since the factory builds and verifies a joint task's code too (both count as build units from now on; before, only factory tasks did). A human task costs nothing. Planning, design, breakdown and estimate are spent once per run, so they stay per phase only. Where it shows: columns L and M ("API min ($)", "API max ($)") on every task sheet of both workbooks, with module rows adding them up (J and K hold the agent hours); a note under the Summary's API block; an "API cost" column on the run page's task table; the five costliest tasks on the approval card. Gate E6 checks that the tasks' shares add up to build and verification (`cost-tasks`). Estimates made before this have no `apiUsd` and show none.

## Agent hours and the human tasks (built 2026-10-06)

Hamza, on the d7a6 workbooks: the solely agentic estimate showed 17 of 23 tasks at 0 hours and looked empty, and asked why PM is there at all. What changed:

- **Agent hours on every task.** Columns J and K ("Agent min (h)", "Agent max (h)") on every task sheet, in both files, beside the human hours in D and E (now headed "Human min (h)", "Human max (h)"). A factory task has agent hours and no human hours; a **joint task has both**; a human task (client UAT, design approval, PM) has human hours only. Every module, total and Grand Total row adds them up ("Agent total (h)" beside each sheet's Grand Total), and the Summary carries them in F and G ("Agent (in hours)") with their own Total. Human hours stay what the totals, weeks and cost overlay count.
- **Where agent hours come from** (`agentHours` in `src/estimate/durations.ts`, the same rule as the critical path): a factory task takes its class's measured duration (p10-p90 of this factory's builds of that track and complexity) once the ledger has 3 or more; until then, its sized hours, a reference size and not a measurement (cold-start). A joint task takes its sized hours. The Summary and the Confidence sheet say which ("Agent hours basis"). Old estimates show agent hours on re-export, since they are read from the stored sizes.
- **All Tasks sheet, both files.** Every task on one sheet (task id, task, track, module, executor, requirements, human, agent and API hours) with a filter on every column, the header frozen, and a "Total (rows shown)" row of `SUBTOTAL(9, …)`, so the totals follow the filter. The track sheets keep the template's layout; this sheet is for sorting and filtering. The client file still differs from the team file by the five team sheets and the estimators' reasons.
- **PM is client liaison only.** In the solely agentic model the factory plans and coordinates its own work, so PM stays only for what a person must do with the client: calls, scope decisions, sign-offs. Catalogue `pm-management` is 4-8 h at typical (was 16-24 h), catalogue version 2026-10-06.1.
- **Design approval is a task.** When the request has an approved design, the breakdown adds one human task on the design track for the client's review and approval (kind `design-approval`, 2-4 h at typical: a walkthrough and two feedback rounds), so the Design sheet is no longer empty. The breakdown rules name the three human tasks every delivery has: client UAT, PM, design approval.
- **Gate E6** checks each task's agent hours against the estimate (`workbook-agent-hours`) and that both files carry the All Tasks sheet; the task-row count skips that sheet.

## Task duration: the internal harness

How long a task takes is not decided by the model's opinion. A **duration harness** evaluates each task class and returns a duration and cost range, and code uses it alongside the anchors.

Internal data is the source of truth. An external source is **optional and later**:

1. **Internal (self-benchmark).** Our own ledger: wall minutes, retries, cost and outcome per step and per task class, by stack and size. This is ground truth for the factory itself, and it improves with every run.
2. **External (a flagged prior only).** Published data on agent task time and reliability. Public benchmarks measure open-source or lab tasks, not client work, so they are a weak prior at best. They are **pinned offline snapshots** in the repo (`bench/external/`, with version, licence and caveats), never a live call, since the runtime has no network. The estimate reads one of them, the OpenHands tool-call rounds band (`src/estimate/assets/priors.json`), and only to flag a task class whose measured turns fall outside it. It never supplies a number.

How they combine:
- The harness classifies each task (for example, standard CRUD screen, integration, rules-heavy logic, migration unit).
- It returns a duration and cost range per class from the internal data. Where the ledger has too few runs, the range is wide and labelled cold-start; it is not filled from an external source.
- Where the two disagree beyond a tolerance, the item is flagged on the approval card (`CHECK` line). The internal measurement always wins; the prior never changes a figure.
- The harness sets the **factory time** and **cost**. Human gate time, client UAT and PM still come from counts and anchors.
- The estimation methods below were researched at first pass (2026-09-30, from published docs only, nothing run). None is adopted; the public data actually read is listed in `bench/external/README.md`:

| Candidate | Useful for us | Limit |
|---|---|---|
| agent-estimate (Apache 2.0) | Three-point ranges, XS–XL tiers, review overhead, a `calibrate` step that scores estimates against observed minutes | Its model limits (for example 90 min for Opus 4.7) are stated as unmeasured local policy; per-tier priors are not published; about 5 stars |
| agent-estimation (MIT) | Tool-call rounds as the unit, risk coefficient 1.0–2.0, about 3 minutes per round | Constants are defaults, with no independent validation |
| ACEM (MIT) | Cost from tokens, revision, context growth and HITL intensity; p10/p50/p90 bands; labels cold-start, partial, calibrated | The authors say every constant is a placeholder and the model is unvalidated |
| METR time horizons, SWE-bench Pro | Credible task-difficulty and resolve-rate priors, with public data | Well-specified open-source or lab tasks, no cost data for METR |

- **Decision:** the harness is internal. It borrows the structures (three-point ranges, rounds, Monte Carlo bands, and the cold-start / partial / calibrated confidence label). No estimation method above is adopted; the only outside data used is the pinned rounds band as a flag. Until enough ledger runs exist (3 for partial, 15 for calibrated), every duration and cost is labelled **cold-start**.

### Internal benchmark record

Each finished step or task adds one record, taken from ledger events:
- run id, step or task class, stack, size band, delivery model;
- wall minutes, retries, tokens and dollars (`gen_ai.usage.cost_usd`), outcome;
- for the plan and design steps: counted units (requirements, screens, tasks), so cost per unit can be computed.

The harness reads these records and returns, per task class, a p10/p50/p90 range for duration and cost, with the record count and the confidence label. The first records are the summary numbers already recorded above. Every later run, including the first estimate runs, adds records automatically, so no separate data collection is needed to start.

## Gates

A gate is a pure check over ledger artifacts. It fails closed: a gate that could not check anything counts as failed. A person can waive only those marked waivable, in a terminal, and every waiver is recorded and shown on the next approval card.

**Hands-off fallbacks (built 2026-10-06).** A hands-off estimate run has no person to waive a gate, so after the retry with the failures fed back (attempt 2 on), the factory decides by rule instead of opening a waiver card (`src/estimate/fallbacks.ts`):
- E3: a citation of a requirement the spec does not have is dropped; a task that then cites none and names no overhead moves to **Suggested, not included**, and other tasks stop depending on it.
- E4: an item left out with no reason is marked "not assessed by the factory (hands-off): confirm with the client"; an empty checklist lists every item so.
- E1c: a task naming a screen the approved design does not have is sized with no screen.
- E2, E2c and an approved screen no task builds (E1c): one small model call writes only the missing tasks and fixes only the listed kinds (new ids follow the last one); the rest of the breakdown stays as it was.
- E5: each task an outlier or UI-order failure names is flagged, with the gate's reason as an open risk. Its range stays the estimators' median, because E6 recomputes it.
- Every gate then runs again and is recorded. What still fails goes to the questions below instead of parking the run.
- Each decision is a "Factory decision (hands-off, gate …)" or "Open risk: …" line in the estimate's assumptions, on the approval card and in the workbooks.
- A run with review keeps the waiver card for a failure only E3, E4 or E5 raise, until a round of questions was asked.

**Gate questions (built 2026-10-06).** In an estimate or a design run, a gate that still fails after the retry with the failures fed back no longer parks the run: it becomes clarify questions, so the pipeline does not stop (`src/stages/gate-questions.ts`, the executor's `askRound`).
- **Which failures:** a breakdown gate (E2, E2c, E3, E4, E1c), E5, a design check (the plan, a page, the design note), E1 on the spec and E1b on the design. A step marks such a failure `gate: true`; E1 and E1b return the outcome `ask`, since retrying the same step cannot fix its input. A model output error, an exception, a rate limit, a safety stop and E6 keep the normal retry ladder and park as before. A build run never asks.
- **The questions:** one small model call per round reads the failing checks, the spec's requirements, earlier answers and the request, and writes at most 6 questions. Each has 2-4 options, a recommended answer (the smallest change that does what the request asks) and the failures it settles.
- **Like the clarify questions:** they are numbered Q-n after the run's clarify and spec questions. With review on, the card is a `question` card, answered in the same three places: the terminal prompt (Enter keeps the recommended option), the run page's questions panel, or `factory answer <run> <hash> Q-n=A`. Hands-off, each recommended answer is taken as an assumption and listed in the Estimate tab's "Assumed by the factory" panel.
- **Then:** the step runs again, and every model call of the step reads the answers. An E1 or E1b failure that an answer settles passes. The step gets two more attempts per round, for at most 2 rounds.
- **After 2 rounds:** what still fails is carried as an open risk and the run goes on. A breakdown task whose kind still does not fit loses its kind and is sized by anchors and ratios; a flagged E5 task reads as low confidence; a design screen that still fails its check is kept. Each carried failure is an "Open risk: … (gate … still fails after 2 rounds of questions …)" line on the estimate.
- **Never carried:** a design with two screens sharing one id or route, a frame that does not exist, no design at all, or no approval. These park after the rounds. E6 and E7 stay hard stops.
- **Recorded:** each round is a `step.failed` event with `action: "questions"` and the round's JSON (`roundSha`); the person's answers are the card's decision. The estimate's assumptions list each question ("Check question Q-n (step): … → … (answered by X)" or "(assumed by the factory, hands-off)") and each open risk. A questions round resets the step's attempt count, so the attempts cap does not trip between rounds.

### Estimate time

| # | Gate | Checks | Waiver |
|---|---|---|---|
| E1 | Readiness | Spec passes lint, critic, round trip; no open questions. A lint failure, critic finding or invented capability settled by a question passes, and so does a failure a check question settles | None (questions, then carried as an open risk) |
| E1b | Design baseline | For any request with UI, the mock and clickable demo are approved, and every screen links to a requirement | None |
| E1c | Design coverage | Every task's screen is in the approved design, every approved screen is built by a task, no screen id or route twice | Lead |
| E2 | Requirement → task | Every requirement has at least one task | None (questions, then carried as an open risk) |
| E3 | Task → requirement | Every task cites a requirement, or a named overhead with a reason. Anything else is an extra and goes to a separate **Suggested, not included** block, outside the totals until the lead adds it | Lead (hands-off: moved to Suggested by the factory) |
| E2c | Task kind | Every task has a kind from the pinned task catalogue (`src/estimate/assets/catalogue.json`), on a track that kind lists. The gate reads the catalogue recorded in its inputs, so old runs still verify after the catalogue changes | None |
| E4 | Forgotten-work checklist | Each generic item marked in, or out with a reason | Lead (hands-off: "not assessed, confirm with the client") |
| E5 | Consistency | Similar tasks within a stated tolerance; no unexplained outlier; a screen counted as complex in the approved demo not sized below a simple one | Lead (hands-off: flagged as an open risk) |
| E6 | Workbook lint | Code recomputes every total and cross-sheet link; known template faults cannot appear | None |
| — | Breakdown shape | Checked when the breakdown is read (the schema, so the model is asked again): unique task ids, known features, and `dependsOn` naming only real tasks, never itself and never in a loop (EST-2 → EST-3 → EST-2; `dependencyLoops` in `src/contracts/estimate.ts`). A build orders tasks by `dependsOn`, so a loop cannot be built | None |
| E7 | Approval | A lead approves (the default), in a terminal or on the run page, and low-confidence lines need sign-off. Hands-off (opt-in, `--hands-off`): the factory approves once the gates pass, tied to the estimate's hash, with no sign-off; no build follows it | None |

### During the build

| # | Gate | Checks | Hook |
|---|---|---|---|
| B1 | Scope lock | Every plan task maps to an approved estimate task | After plan; needs `estimateTaskId` on plan tasks |
| B2 | Change request | A new or changed requirement creates estimate v2 with a diff against v1 | New estimate run whose parent is the approved one; same approval |
| B3 | Size cap | Finished change is no bigger than approved | Extends `integrate.diff-size` and the design size-cap |
| B4 | Unrequested behaviour | The diff traces to requirements; new behaviour with no requirement is flagged (extra screens, options, endpoints) | New review finding category |
| B5 | Budget burn | Effort (human decisions counted at assumed gate times), **API credit spend** and time so far against the approved figure | Extends the spend caps. Warn at **80% of the approved maximum**, stop at **100%** |
| B6 | Screens planned | Every approved screen that has a factory task is delivered by some plan task | After plan; needs the design in `estimateRef` |
| B7 | Screen scope | The plan task that builds an approved screen may touch that screen's file (`src/design/design-link.ts`); waivable at the plan like B6 | After plan; needs the design in `estimateRef` |

**A build from an approved design (`--from-design`)** has no estimate, so these gates now key on the design run's approved spec and screens instead (revised after the PR #11 review, item 10, 2026-10-03, as built):
- **B1** (`build.b1-design-scope`): every plan task delivers requirements of the approved spec, and none delivers a requirement that spec does not have.
- **B2**: a requirement changed after approval parks the run, and asks for the changed design to be drawn and approved first. The `changeRequest` gate also compares the spec with the approved one.
- **B6 and B7** (`build.b6-design-screens`): each approved screen is delivered by a plan task that serves its requirements, and one of those tasks can touch the screen's file (with a kit, the file is the screen's container).
- **B4**: runs on the review, as for an estimated build.
- **B3**: has no hours to cap against. The design size cap (`design.size-cap`) still holds the UI change to the approved design.

B1, B6 and B7 are waivable at the plan, as for an estimated build. The screen brief comes from `screenForTask`, which looks for the screen through the task's file scope or requirements.

In the solely agentic model B1–B4 stay as automatic checks, and the B5 stop at 100% opens a budget card for a person to decide. B1, B3, B4, B6 and B7 are waivable by a lead at the gate, and B5 by `factory waive-budget`, with the reason recorded (B2 goes through a change request). All decisions (approve, reject, waive) happen in a terminal by a person, as elsewhere in the factory.

## Budget

A budget does not have to exist beforehand.
- **No budget:** the approved estimate is the baseline; approving it at E7 (the factory, or a lead with review on) records the number.
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
| All Tasks (every task, filterable) | Yes | Yes |

**All six sheets are mandatory:** Summary, Backend, Mobile, Web, QA, Design. A track that is out of scope keeps its sheet with "Not in scope: reason" and zero totals.

### Development sheets (Backend, Mobile, Web)

| Col | Content |
|---|---|
| B | S.No |
| C | Task |
| D, E | Human min, max (hours) |
| F | Comments: what the task includes |
| G | Executor: Factory / Joint / Human |
| H | Requirement id(s) |
| I | Task id |
| J, K | Agent min, max (hours): the factory's own hours on the task (both files; see "Agent hours and the human tasks") |
| L, M | API min, max ($): what the factory spends in API credits building and verifying the task (both files, estimates from 2026-10-06; see "Cost in API credits") |

- Modules → tasks; module totals are `SUM` over the module's own rows.
- **Other Development Activities:** bug fixing (parameter %), deployment (staging, production, app store), lead PR review, code fixing after review, documentation; memory leaks for mobile only.
- Research tasks, Assumptions, Risks and the template Notes follow.
- Each piece of work appears in **one** sheet. Other sheets get a zero-hour reference row pointing to it.

### Summary
- **Header:** client, project, PM, date, version, mode.
- **Task summary:** one row per track (Backend, Mobile, Web/Admin, QA, GD, PM, PDM, Design) with human Min, Max, agent Min, Max (F, G), Avg, resources, and weeks as a formula (human hours ÷ 40 ÷ resources).
- **Total:** `SUM(track rows) + IF(include Design = "Yes", Design)`. The switch is a visible cell and the Design row always shows.
- **Delivery model** shown in the header, and one estimate per model.
- **Lines** for API credit cost (with a per-phase breakdown) and elapsed time (planning time shown apart).
- **Special considerations** filled from the inputs and clarify answers (in a hands-off run, the factory's assumptions, labelled as such).
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

Checked against the code on 2026-10-02. Only the last one is open.

1. **Stack-agnostic read of a repo: done for the estimate.** Estimate mode does not run discover. Its ground step (`src/stages/estimate-ground.ts`) reads any repo through the language-neutral repo map and adds a survey from universal signals (`src/context/survey.ts`: files by language, dependency manifests, tests present, change history). A requirements-only run has no repo and states every span as new build work. Discover and the build itself stay .NET-shaped: a build on another stack is parked, which is outside the estimate.
2. **Design wiring: done.** The token and component lint runs on each implement step that changes UI files (`design.fidelity-lint`), integrate compares the real size with the approved one (`design.size-cap`), and discover stores the design inventory for React and Next.js repos (`docs/design-step.md`, "Wiring").
3. **Decide-architecture and scaffold: not needed for the estimate.** An estimate without a repo runs from the requirements alone. Both steps are still only names in the contracts; a build with no repo would need them.
4. **Document intake: done.** `--file` takes a .docx and reads its headings, lists, tables and embedded images offline (`src/sources/docx.ts`); `--frames` takes a folder of frames exported from Figma.
5. **Per-module specify: done.** A large document is split into modules by code; intake, both clarify rounds and the spec pipeline run per module and are joined under the usual step keys (`src/stages/modular.ts`), and their cost is part of the run's cost.
6. **Actuals logging: done.** Each implement step that delivers an approved estimate task records its `EST-n`; `src/estimate/durations.ts` groups the records per task, and `factory calibrate` compares approved estimates with what the runs spent. Each size pick is paired with its build's actuals (docs/estimate-consistency.md, section 11), and those pairs plus `~/.factory/actual-hours.csv` drive the catalogue's status and its self-tuning (sections 13 and 14).
7. **Design module hardening and E1b: done.** States, flows, size classes, requirement links, languages, colour modes, the layout check, the UI count in the estimate, and the design card decided on the web (E1b).
8. **Duration harness: done.** Records come from the ledger's finished implement steps and give a measured p10 to p90 per task class; a class without enough records falls back to the sized hours, labelled cold-start (`src/estimate/durations.ts`, `src/estimate/records.ts`). No external snapshot.
9. **First calibration data: open.** The summary numbers in `docs/runs/2026-09-30-first-real-runs.md` are recorded above. The raw ledgers stay on the owner's laptop; `report.json` (model, agent and lab seconds per step) from those runs is the next thing to bring over, without the client code.

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
- Three estimators for every band, merged by median (changed 2026-10-03; was one for XS and S, three for M and up, with disagreement widening the range).
- **Solely agentic only (changed 2026-10-03).** Two delivery models were planned, HITL (supervisor + agents) and solely agentic, with the second sized on request as a child run. Estimates are now always solely agentic; HITL estimates made before stay readable. Client UAT, design approval and PM stay (PM as client liaison only, 4-8 h, since 2026-10-06).
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
- **Design handoff** (2026-10-02, see "Design handoff"): an approved design becomes a versioned design package (factory store and the repo's `design/`); it is exported on demand (PNG, PDF design book, demo, tokens, JSON, Figma through our own plugin) from `factory design export` or the UI's Export button; the build converts it to the chosen UI target by code (tokens, a per-stack kit, a scaffold generated once) with the model writing behaviour; fidelity blocks on tokens, structure and accessibility, never on pixels.

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

## Build status (2026-10-01)

Built and tested, with a scripted model, through the real executor (`src/stages/estimate-e2e.test.ts`):

| Slice | What exists |
|---|---|
| Schemas, mode manifest, deterministic core, workbook export and lint | `src/contracts/estimate.ts`, `src/estimate/*` |
| Gates E1-E7 (with E1b, E1c) and B1-B7 as `defineGate` predicates | `src/estimate/gates.ts`; E-gates run inside the estimate steps, B-gates in the build run's plan, implement, integrate and review steps (see "Build from an estimate") |
| Model steps | `breakdown` and `estimate` in `src/stages/estimate.ts`. Above 48 requirements the breakdown is written in parts (`breakdownInParts`), as the design is drawn: one call plans the features, the shared tasks (app shell, data model, services several features use, overheads) and the checklist, checked before any part is paid for; then each group of features (at most 24 requirements) gets its tasks written on its own, four at a time, with only its requirements and the screens it builds (each screen in the part holding most of its requirements). A part that fails its checks gets one more try with its own failures; a step retry pays only for the parts that failed. Code numbers the tasks EST-1 onwards and the gates run on the joined breakdown as before. The breakdown reads each screen's page, never its full-data variant or translations. |
| Document intake, per-module specify | `.docx` and pre-exported Figma frames in `src/sources/`; `splitModules` and the per-module intake, clarify and spec steps in `src/stages/modular.ts`. Each module asks its own clarify questions, so a large document means one question card per module |
| Stack-agnostic ground | `estimateGroundStep`: no repo means every span is new build work (no model call); a repo gets the normal grounding step plus `src/context/survey.ts` and, for UI work, the design inventory |
| Design step and E1b | `design` step (UI requests only): the model proposes the screen inventory (flow, screens with route, states and size, the requirements each serves, a reason for each requirement with no screen); code checks the links both ways. `design-baseline` (E1b) then needs a person's approval of that inventory. It is an inventory of screens with themed sample content; a code-drawn clickable demo of it is what the lead approves (see "Design baseline"). E1c and B6 check the breakdown and the build plan against it |
| E7 approval | `approve-estimate` step: one card, anchors first, hash-bound, sign-off for each low-confidence line (`factory approve --sign-off EST-2,EST-5`). Hands-off is an opt-in: the factory approves, with no sign-off, and no build follows it (see "Hands-off estimates") |
| Waivers | E3, E4, E5 (estimate time) and B1, B3, B4, B6 (build time), after one retry where the model can fix it (E3-E5, B1, B6): a waiver card, then `factory waive <run> <hash> --reason "..."`; recorded with the name and reason, shown on the card and in the team file's Gates sheet. Build waivers are bound to the gate ids and a scope, not to failure text: the code commit for B3 and B4, the approved spec and tasks for B1 and B6, so a different commit needs a new decision (`src/estimate/build-waiver.ts`). B5 has its own card (below) |
| Template (open item 3, decided) | Filling a copy works: the Folio3 template (Example_Estimation.xlsx, v 0.5) survives a load and save through ExcelJS with its sheets, merges, formulas and styles (only a column width or two on the QA sheet is dropped). The export uses its layout (sheet names, Summary rows 11 onwards, title block, Grand Total at the top, numbered modules, Other Development Activities, Research) and, when `estimateTemplate:` is set in the project config or `FACTORY_ESTIMATE_TEMPLATE` in the environment, draws on a fresh copy of it so its theme, fonts and cell styles carry over. Without it the same layout is drawn in plain styles. The repo ships a copy with every cell's text cleared (`src/estimate/assets/estimation-template.xlsx`: styles, theme, widths and sheet names only, no client data), used by default, so the template tests always run; a path in config or the environment overrides it |
| QA sheet and notes blocks | The QA sheet uses the template's own shape: an Estimation Summary of eight items (Test Plan/Strategy, Test Environments, Validation and Smoke test cases, Validation testing, Smoke testing, Multi Browser Compatibility, UAT, Misc. Optional), then the validation detail by testing cycle with each feature a numbered module. Code places each QA task by plain words in its title (`qaPlace`); a feature test with requirements is validation cycle 1, a regression pass is cycle 2, anything else with no requirement is Misc. No hours are invented: cycle 2 and later exist only when the breakdown has tasks for them (the template's "half of cycle 1" formula is not applied). Every track sheet with work ends with the template's Assumptions & Constraints and Risks blocks. The Summary's special considerations (platforms, browsers, deployment, performance, security, documentation) come from the client's clarify answers: a question whose text names the topic gives the row its answer and its id; a topic nobody asked about reads "Not specified" |
| Export | `export` step writes both workbooks to `<ledger>/export/` and lints each file cell by cell |
| CLI | `factory estimate` with `--file` (Markdown, text or .docx), `--frames`, `--jira`, `--review` / `--hands-off`, `--stack-source`, `--no-design-in-total`, `--feedback-rounds`, `--rate track=usd`, `--no-repo`, `--client`, `--project-name`, `--pm`, `--max-cost` |
| Benchmark records | `src/estimate/records.ts` reads every other run in the ledger home, and the paid eval runs under `evidence/` for build and verification; a phase with records replaces its cold-start figure and says what it is based on |
| Task-class durations and external prior | `src/estimate/durations.ts` records each approved estimate task a build delivered (class = track/complexity, active minutes, turns, cost). A class with 3 or more completed records gives its factory tasks a measured p10-p90 duration for the critical path; others keep the sized hours as an assumed duration. `elapsed.basis` says which, and the approval card lists it. `src/estimate/priors.ts` reads a pinned copy of the OpenHands rounds band (`assets/priors.json`, source and revision recorded) and flags a class whose median turns fall outside p10-p90; it never changes a number. `npm run bench` (calibrate, gates, compare, external, evidence) and `npm run test:bench` run the benchmarks; the gate cases use the real E1-E7 and B1-B6 predicates |
| Cost overlay | Team file's Cost sheet when `--rate` is given; the client file never has it |
| Edit on the card | `factory edit-estimate <run> <hash> --anchor EST-1=6-12 --ratio EST-4=2 --reason "..."`: the stored proposals are edited, the estimate is assembled again by the same code (no new model call), and a new card follows. The edit is listed in the estimate's assumptions |
| Change request (B2) | `factory estimate --revises <run>`: a full estimate whose card shows what changed from the approved one; the file says version 2; `parentEstimate` points at the approved estimate |
| Second delivery model | Removed 2026-10-03: estimates are solely agentic, so `--delivery-model` and `--from-run` are gone (and `fromRun` in the UI). The sibling steps stay only so a sibling run already started can finish |
| Build from an estimate (B1-B7) | `factory start --from-estimate <run>`: inherits the spec (no clarify or specify); the plan step maps each plan task to an approved estimate task (B1) and parks a recorded requirement change (B2); integrate checks the change size against the approved cap (B3); review flags behaviour no requirement asked for (B4); before every step the run is checked against the approved budget, with a warning at 80% and a stop at 100% (B5). The stop opens a budget card; `factory waive-budget <run> <hash> --reason "..." [--ceiling 1.5]` lets the run go on to a higher ceiling (25% more by default, recorded with name and reason, and repeatable: the next stop is at the new ceiling). *Revised after the PR #11 review, item 16 (2026-10-03, as built):* `--ceiling` must be above the current limit and at most 3 (300% of the approved maximum, `MAX_BUDGET_CEILING`); replay clamps a larger recorded value, and a stop at the cap offers only a change request, a new estimate or stop. Effort is measured: human decisions in the ledger counted at the assumed gate times (answered questions, one approval section per approval or design card, waiver time for waiver, limit and budget cards; PR review comes after the run and is not counted), held against the estimate's own gate hours. The agentic model has no gate hours, so no effort limit. Each implement step records its `EST-n` |

Added since 2026-09-30 (all in the web UI or the design step, covered in "In the web UI"):
- Clarification questions are asked one at a time as option buttons; the chosen option is the answer. They can be answered in the terminal or on the run page, whichever comes first, for estimate and build runs alike.
- The design card can be approved or sent back on the web (typed name, hash, reason). A rejected design is fixed where the reason points, or redrawn when it needs that (see "Design baseline"); the run parks only after four revisions.
- The design step rejects a UI design that has no theme, no real sample content per screen, no full-data page for a screen with data, no cited reference products, a generic page title such as "Page 3", or a brand colour far from (or identical to) the field's references, and asks again. The default look is softer and livelier.
- A cross-run cache for model steps (`--fresh` skips it), and estimates without a project.
- Not part of this feature: the specify pipeline (lane, spec loop, spec lint) is handled by another developer. An estimate-specific lean lane and L9 size skip were tried and reverted, so estimates use the normal specify loop.

Not done:
- **A rendered mock in the real app.** The design step produces a screen inventory, a clickable wireframe demo and screenshots of that demo (headless Chromium, one per screen and state at phone and desktop width, plus each screen at tablet width and, for a product in both colour modes, in dark mode, `src/design/screenshots.ts`; if no browser is found the card says so and the run goes on). Rendering a mock in the real app and the pixel comparisons (`docs/design-step.md`) are separate work.
- **Effort in B5 is counted, not timed.** It is the number of human decisions at the assumed gate times, a lower bound for long cards. Real minutes per decision would need the lead's time on the card, which is not recorded.
- **A visual check of the workbook in Excel.** The export is verified by reading the files back and linting every cell, and by tests on a copy of the real template, but it has not been opened in Excel or LibreOffice (LibreOffice would not start in the build container).
- **Design handoff** (requirements 2 and 3, approved 2026-10-02): planned under "Design handoff". Steps 1 (common controls, design template 20), 2 (design package), 3 (exports), 4 (kit and scaffold), 5 (fidelity and tests) and 6 (Figma, route A: our own plugin, no paid seat) are Done; steps 7 and 8 are skipped for now (no mobile requirement). The Figma plugin has not yet been run inside Figma itself. The kit builds in both targets; no build run has yet gone from an approved design through the scaffold to working containers with a real model.
- **Design references** (approved 2026-10-02): built (steps 1 to 9 and 3b under "Design references"); only step 10's live runs remain, which need `ANTHROPIC_API_KEY` and `FIGMA_TOKEN`. No reference path has run against a real model yet.
- **`factory calibrate --apply` promotes the stored proposal** (the PR #11 re-review, item 3, 2026-10-04, as built). Before, it measured again and wrote whatever came out, which could differ from the proposal that was reviewed. Now `--tune` keeps the plan it shows as the proposal (as the background tuner does), and `--apply` promotes exactly that file. It refuses when there is no proposal, or when the proposal was made from another version than the current one; then `--tune` proposes again.
- **Cost calibration from `report.json` of the first real runs** stays open; records come from the ledger home only. `factory calibrate` (`src/estimate/calibrate.ts`) now compares each approved estimate with what its estimate run and its build run spent, and, given a file of `estimate-run,actual-hours` lines, with real hours of finished projects. It needs ledgers or hours that exist; it changes nothing. The task catalogue does change from the same evidence: it tunes itself in the background after every estimate and build (`factory calibrate --tune`, `--history`; docs/estimate-consistency.md, section 14). Try the estimate on `examples/requirements.md`.

## In the web UI

`factory ui` can start an estimate run (New run, then Estimate) with the same settings as `factory estimate`, and an estimate run gets an Estimate tab: totals and band, API cost, elapsed time, per-task hours with anchors, the approved screens, and team/client workbook downloads once exported. The lead can approve or reject the estimate there too (typed name, card hash, sign-off for low-confidence tasks; recorded as "via web"). An estimate run's clarification questions are answered there too. A parked run of any mode has a Resume run button, which is `factory resume` and decides nothing (a paused run is resumed in the terminal, like pausing it). Every other decision stays terminal-only (since the PR #11 review): the design card (E1b), a build or design run's questions, plan approvals, waivers and fidelity baselines; the page shows the command. The form can attach design frames (png/jpg/webp, size-capped and stored beside the run); a "Design references" section for every mode (files, URLs and Figma links with a role each, a References panel on the Design tab, references on the design card) is built. The Design tab also has the Export panel and a Code panel (the scaffold a build writes for the approved design, with Generate and a zip), and the New run form a UI target select for builds. Every page fits a phone (375 px) with no sideways scroll: below 760 px the top bar puts its links on a second row and drops the host label, the run and request tabs scroll in place, and the closed step drawer is clipped (checked by a Chromium test in `ui.test.ts`). The clickable demo page draws each screen as a themed page with its states and a Full data tab; a screen with no sample content gets a wireframe drawn by rule from the requirement wording (no model). Per-track rates and docx upload are terminal-only.

An estimate can also start with no project (requirements alone, no repo). The Brownfield form has an optional Estimate picker listing approved, exported estimates: choosing one builds it (the same as `factory start --from-estimate`), taking its request, spec and tasks, and the request box is hidden. With none chosen it is a plain change request with no estimate gates.
