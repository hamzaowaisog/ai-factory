# The design step: where it plugs into the factory (2026-09-29)

## Summary

The design research gave us a set of free, scripted checks for UI changes. They are now ported to TypeScript in `src/design/`, with tests. They work on Next.js apps (app router and pages router, with or without `src/`) as well as on the Vite app they were first written for. They use no model and no network.

*Revised after the PR #11 review, item 14 (2026-10-03, as built):* all design code now lives in `src/design/`. The demo and its parts moved out of `src/estimate/`: `demo.ts` (the drawn demo, its states and labels), `screenshots.ts`, `tokens.ts`, `palette.ts`, `icons.ts`, `locale.ts`, `wireframe.ts`, `scenes.ts`, and `diff.ts` (`diffDesigns`, from `estimate/lineage.ts`), with their tests. `src/estimate/` keeps the estimate and imports from `src/design/`; code in `src/design/` imports nothing from `src/estimate/` (only one test does).

*PR #11 review, item 15 (2026-10-03, planned, not built):* the demo should in the end be drawn by the kit, so that the approved pictures and the built app come from one set of components.
- **Today.** Two renderers exist: `src/design/demo.ts` draws the demo as one self-contained HTML page, and `kits/shadcn` builds the app.
- **Why they can drift.** Their output is held together by tests: the fidelity check, the scaffold tests, and the kit test that every block, field and layer is drawn. The code itself is not shared.
- **The plan.**
  - Render the demo by building the scaffolded kit app in fixture mode (`?fixture=S-n:state`) and saving it as a static export.
  - Keep `demo.ts` only for a repo whose stack the kit does not cover.
- **Why it waits.** It needs a Node build in the design step, which takes about a minute per design. It also changes what an approval hashes, so already-approved designs need a migration.

The four pieces, and where each sits in a run:

| Piece | What it does | Where it plugs in | State |
|---|---|---|---|
| **Inventory** | Scans the app: framework, theme tokens, shared building blocks (for example `components/ui`), shared components with how often each is used, pages, and how much styling sits outside the design system | **Discover**, into the repo profile | Built, with a CLI command. Called by discover for React and Next.js repos |
| **UI change size** | Sorts a change into **no UI**, **screen tweak**, **new screen** or **design-system change**, with a plain list of reasons | **After plan**, from the plan's file list; again **after integrate**, from the real diff | Built. The approval card now shows the size |
| **Size-cap check** | Fails when the finished diff is a bigger UI change than the size that was approved | **After integrate**, as a gate | Wired into integrate |
| **Fidelity check** | Lint of the diff: theme tokens only, existing components only, no new building blocks. Also traces requirements to screens both ways, and compares layout and accessibility between the approved mock and the final screens | **After implement** (lint) and at **accept** (screenshots) | Lint wired into implement. Comparisons built; `factory design capture` and `compare` take the screenshots by hand |
| **Brief cleaner** | Turns an untrusted design extract (Figma export, screenshot reading, brand guide) into typed fields only | In the **`design-refs`** step (the design-read of `stages-aligned.md`), in the locked room | Built; called by `design-refs` (see below) |

What the size decides:
- **No UI:** no design step.
- **Screen tweak:** a short screen note, no mock, plus a before/after screenshot.
- **New screen:** a mock in the real app on a design branch, and state screenshots at 390 and 1280 px on the approval card.
- **Design-system change:** as for a new screen, plus a diff of the tokens or building blocks for the human to accept.

On real repos, the ported size check agrees with hand labels on 47 of 56 commits; the teammate's original got 32. It finds every page on two Next.js apps, where the original found none. See `docs/design-eval/results.md`.

**Not built:** the screenshot step (it needs a Node + Chromium lab container), a mock rendered in the real app (the estimate's design step draws a screen inventory and a themed clickable demo with every state and a Full data tab instead, see `estimates-design.md`), direction proposals for new apps (their data files are missing), the pixel diff, and the calls from discover and integrate.

## Design references and one design pipeline for every mode (approved 2026-10-02, built; live runs pending)

Full plan: `docs/estimates-design.md`, "Design references". In short:

- **References in any form, in every mode.** `--ref "[role:]<file|url>[|note]"` (role `match`, `inspire` or `layout`; images, URLs, Word documents in `src/sources/refs.ts`, Figma in `src/sources/figma.ts`, PDF through pdf.js) on the terminal, and a "Design references" section on the factory UI's New run form for every mode. Images, URLs, Figma links and exports, PDFs and brand guides are turned into one form by code at intake (pictures as PNG, measured colours, exact styles where the source has them). A read-only vision step, `design-refs`, reads them into typed fields through the brief cleaner. With no references, nothing changes.
- **Images reach the model (built).** A thinking step can carry image sections (`S.image`): untrusted, in the user message only, numbered `<untrusted_image n="k">` markers, at most 20 per briefing, 1,600 tokens each. The runner reads the type from the bytes (PNG, JPEG, GIF, WebP, at most 5 MB) and sends Anthropic, OpenAI and local chat servers `Image k:` then the picture. Agent steps (which write code) refuse images; they get only the typed design and tokens.
- **A Stitch design moves, and is checked for a generated look (built).** The design system names one signature motion and one ambient animation, and every screen's prompt asks Stitch for the motion itself (tokens and keyframes in a `<style>` block, CSS only, with a reduced-motion rule) and names those two. `design.stitch.mood` (calm, bold or futuristic) sets the look's dials; futuristic is a dark, precise instrument look with fast, exact motion, and still bans glows, neon, gradient blobs and glass. Each drawn page is then read for what gives it away (no motion, bouncing or pinging, blurred blobs, placeholder copy, marketing clichés, emojis), and a page with one gets a single Stitch fix, the same one that fixes its accessibility. Motion shows in the live preview and the HTML export, not in the PNG, PDF or Figma exports.
- **A Stitch design stands on its field's real products (built).** When the client named no brand colour, attached no reference that sets the look, and the product has no look yet, the design system step works as a design drawn by Claude does: it reads the live sites of the field's leading products for their colours (off with `FACTORY_DESIGN_LIVE_REFS=0`), gives the step that list with how each uses colour, and the factory's latest other looks so it does not repeat one. The accent must sit in the field's colour family in a shade of its own, or come with a one-sentence reason (`departure`), and the step names two to four of those products with what it took from each (`theme.basis` in the design, shown where a Claude design shows it). A design system that fails this is written again before any Stitch call is spent. Not carried over: the wider repeat check (bar, layout, density), which a Stitch theme has no fields for.
- **A Stitch screen list takes its page ideas from what was seen (built).** The step that lists the screens and writes each Stitch prompt gets how the leading products of the field arrange their pages (their bars, corners and the pattern their pages share, without their colours), whatever sets the colours, and asks for the fitting component by what it is and holds, never a product's name or logo. When the client attached references, both that step and the design system step get them as a Claude design does: the reading, the client's words and the pictures. Stitch never sees a picture, so each prompt says in words what is taken from a reference: the navigation and regions of a layout or match reference, the feel of an inspire reference. Each prompt also composes its page: what the eye meets first, the order of the sections, what sits beside what, and enough real rows to fill every list.
- **A Stitch design's pages read as one product (built).** The screen list names the frame each kind of user's pages share (`shells`: the brand's words, where the menu sits, what is on the right) and one set of sample data (`sample`: the people, their things, the time zone, the shared counts). Every screen's prompt is given its shell's header word for word and the sample data, and the design keeps the prompt that way, so a state drawn again after a send-back is told the same. Every prompt also asks for only what a user needs (no build numbers, protocol or node names, sync readouts or chips that are no record's status), and the screen list words its labels as a user would, with one primary action a page. A page that still shows a build number, a protocol or node name or the briefing's own words gets the one Stitch fix (`src/design/stitch-tells.ts`, the `console` tell).
- **A Stitch page keeps the design system's own colours and fonts (built).** Stitch makes its tokens from the accent alone: neutrals tinted towards it and the accent darkened (a brick accent gave a pink `#fff8f6` page and a `#8b3e2a` button on 12 Oct 2026), and some pages loaded other fonts. The design system call now also returns its `palette` (page background, surface, text, muted, rule, the three status colours, the mono font), as its DESIGN.md has them. Stitch is given the accent as `overridePrimaryColor` and the page background as `overrideNeutralColor` (sent again without them if it refuses), every screen's prompt names the values themselves, and a drawn page whose HTML lacks the background, the accent or the fonts gets the `off-look` fix along with its accessibility fix (`src/design/stitch-tells.ts`, no browser, no call to find it).
- **A Stitch design shows its most used pages at phone width (built).** The screen list marks up to five pages a person opens on a phone (`phone: true`); each is drawn once more with Stitch's MOBILE device and kept as the screen's `phone` frame: a Phone tab in the demo and a phone picture in the package. `design.stitch.phone: false` turns it off; it applies when `design.stitch.device` is DESKTOP.
- **A Stitch page has no furniture of its own invention (built).** The screen list gives each page its one heading (a menu page's is its menu label), one dated list of events that every log, history and report page takes its rows from, and the brand mark and the user's picture as part of the shared header. A page is told to add no field, id, switch or place the list did not name, no panel that repeats the menu, no Apply button on filters, no score or line about the system itself; version chips and grid names ("Registry V2.4", "12-col ledger") are found in the HTML and fixed.
- **A Stitch DESIGN.md's words stay off the pages (built).** What the file said came back as page content on 12 Oct 2026: its "12-column grid" as a "12-col ledger" chip, its fingerprint ("a paired hairline beside the space identifier") as stray bars in the data, its "uppercase metadata" as code-style labels, and its ban on avatars against the screen prompts' photographs. The rules for the file (`TASTE_OVERRIDES`) now ask for photographs of what the product shows, a fingerprint that is a property of the look, grid and numerals written as what the CSS does, sentence case, motion said once (section 6 points to the motion system), no real product's name (they stay in `basis`), and no sentence about sample data or process.
- **A Stitch page is told the design system's rules itself (built).** Stitch's drawing call takes a prompt alone, so the skill never reaches it and the DESIGN.md is only attached to the project. The design system call also returns a `digest` (six to ten sentences: corners, edges, spacing, type sizes, table rows, buttons and fields), written into every screen's prompt beside the look's colours and fonts and cut at about 1,100 characters. The step that lists the screens gets the skill's layout rules, anti-patterns and component replacements (`tastePageRules`), so the prompts are composed by them; the skill's colour, font and motion parts stay with the design system.
- **A design drawn by Claude or OpenAI is composed by the same taste rules (built).** The skill's layout rules, anti-patterns and component replacements (`tastePageRules`, the three parts the Stitch screen list gets) go into the screen list and every page call, under a note that says what applies: what a page is made of and what its words and figures say. Its lines on fonts, CSS, shadows and motion do not apply there (the theme and the factory's components set those), and the requirements win. An existing app, and a restyle of one, is drawn without them: it keeps the way its pages are composed. A missing skill is a log note; a changed copy stops the run at start-up.
- **A design can be sent back more than twice (built).** A run parks after two rejections (`MAX_REJECTIONS`, `src/ledger/caps.ts`). A design sent back on its design-approval card is now counted apart (`designRejections`) with a limit of five (`MAX_DESIGN_REJECTIONS`): a look is settled over a few rounds, and the parking app's run parked on its second send-back on 12 Oct 2026 before any redraw. Spec and plan rejections keep their limit of two, and neither limit can be waived from a card.
- **The research behind a look is the same on every engine (built).** `src/design/research.ts` is the one place that gathers it, and the claude, openai and stitch engines all call it: the field's products with the colours their live sites show today, the values the colour check uses, the factory's latest other looks, and the ui-ux-pro-max design system for the field. The engines differ in who draws, not in what the look stands on. On Stitch a client's match reference must give the accent its own colour and an inspire reference its colour family (or a `departure`), as on the other engines. What Stitch cannot take over: the checks on fields its theme does not have (the bar and frame, the type pair of a match reference, the full repeat check) and the rendered layout check against a layout reference.
- **A design run and a new product are web only (built).** Where the requirements ask for a mobile, iOS or Android app, a design run and a new product draw and build the same features as one responsive web app; nothing parks or is left out for it. Every model call of those runs is told so (`WEB_ONLY` in `src/config/platform.ts`, added in `src/stages/think.ts`), and a design answer that still names a phone app or a bottom tab bar is turned into a web app with a top bar in code (`asWeb`), with no second call. A new product no longer refuses an estimate that prices a phone app. An estimate run is untouched: it still prices mobile development when the client asks for it. This is temporary, until the factory builds phone apps: a project sets `webOnly: false` to get a phone app drawn as one again (phone frame, bottom tab bar), and the default turns then.
- **A Stitch drawing keeps its planning and repairs small faults itself (built).** The accepted screen list and design system are kept with the run (`attachments/stitch-plan.json`), so a park or a rejected design system goes on without paying for them again. Pure black in the design system is swapped for `#18181B` in place; a line that only bans it is ignored. A colour counts as the client's brand only when the requirements or a reference give it. When Stitch returns a photograph as a screen of its own ahead of the page, the page is the one taken (`pageOf` in `src/design/stitch.ts`).
- **A design shows on the Preview page while it is drawn, on every engine (built 2026-10-12).** A design drawn by Claude or OpenAI is always drawn in parts: one call lists the screens and chooses the look, then each page is drawn on its own, four at a time, and the Preview page shows the listed screens as wireframes and fills each in as its page comes back. Until then only a request above 24 requirements was drawn that way; a smaller one was one answer, and its Preview stayed empty until the whole design was back (a Stitch design already showed each screen as Stitch drew it). A small design costs one more call for the screen list. A run whose last failed attempt was one answer still has only its failing pages drawn again, with the same draft on the Preview page. A Stitch page that gets a fix after the checks (accessibility, a generated look) replaces the one drawn first as soon as its fix is back, not when the whole round is over; the draft counts the fixed pages (`draft.fixed`), which is how the Preview page knows a drawn page changed.
- **A Stitch design is walked live (built).** On a run's Preview page in `factory ui`, a Stitch screen is shown as Stitch's own page in a sandboxed frame, and a link, button or tab opens the screen it leads to, as in a Claude or OpenAI demo. The screen list gives each page its links (the words on the control and the screen it opens), Stitch is told to use those words, to draw no other menu item or link to a page, and to draw one state per picture with no switches between states, and the live page follows that map; a control the list did not name falls back to a screen named like it, then to the one screen whose route shares its words (never for an action such as Save or Remove, a switch between states, or a footer link such as Terms or Help). A click that means the page it is on stays there, and a control that only shares one word with a screen's name opens nothing: a wrong page misleads more than a click that does nothing. A design drawn before the screen list named links has only the fallbacks; a "Live / Picture" switch shows the picture instead. The page is rebuilt first (`src/design/stitch-live.ts`): nothing runs but Tailwind's browser build and its settings, its policy names the hosts it may load from (Tailwind, Google's fonts, Stitch's pictures) and lets it connect to none, and it is never run on the factory host. It needs the internet for Tailwind and the fonts. The approved, hashed and exported `design-demo.html` keeps pictures only. For Safari, the server sends the demo without the policy in its `<meta>` and names itself as a frame source in the header: Safari loads no frame in a sandboxed page with a `<meta>` policy, and does not take `'self'` to mean the server there.
- **A Stitch design's exports are Stitch's own pictures (built).** The design package of a Stitch design holds each screen and state Stitch drew as its full-size picture (desktop width, unless the project draws for phones), in place of pictures of the demo page. The PNG export, the PDF book and the Figma frames are made from them: one per drawn state. A state Stitch did not draw (it draws the normal page and the empty and error states) is left out and named in the export's notes, never shown as a placeholder. In Figma each frame is that picture at its drawn size, not layers. The HTML export (`demo.zip`) is the design as web pages: `index.html` lists the screens, `pages/S-1.html` (and `pages/S-1-error.html` for a state) is Stitch's own page made safe as the live page is, and its links and buttons open the other pages' files; the pages need the network for Tailwind and Google Fonts. The demo the lead approved is beside them as `approved-demo.html`. A package written before this keeps its old pictures (a package never changes).
- **One design pipeline.** `designSteps({ sources, purpose })` (`src/stages/design-pipeline.ts`, built) returns `[design-refs?, design, design-baseline]` and is what estimate (today), brownfield and later greenfield add to their step lists. `sources` names the steps it reads (intent, spec, repo inventory if any); `purpose` picks the approval card's wording. Plan, implement and the size-cap read the result only through `approvedDesignFor(state, ledger)`, so a build gets the approved screens and tokens whether its design was approved in the same run or in the estimate it came from. Greenfield has no step list yet; when it is built it adds `...designSteps()`.
- **Brownfield builds get the design step** before plan when the request touches UI and the run is not seeded from an approved estimate. When a `match` reference meets an app with its own look, the clarify card asks whether to keep the app's look (recommended) or restyle it; a restyle is a design-system change. (Code cannot tell whether the two looks differ, since the inventory keeps token names but not values, so it always asks.)

## Design handoff: package, exports, stack conversion and fidelity (approved 2026-10-02; controls, package, exports, stack conversion, fidelity and Figma built)

Full plan: `docs/estimates-design.md`, "Design handoff". In short:

- **Common controls first (built).** Button variants and states, password, email, time, date range, multi-select, combobox and consent fields, field required/help/disabled/error, inline alerts, toolbars, linear progress, working paging, popovers and tooltips. A Components page shows every control in every state. Design-time accessibility checks (`design-a11y`): contrast, touch targets, focus, labels.
- **Design package (built).** A `design-export` step writes the package to the store, `<FACTORY_HOME>/designs/<project>/<line>/vN/` (manifest, `design.json` with a `schemaVersion`, W3C tokens, `tokens.css`, the demo, reproducible reference shots), and, when the project sets `design.commitPackage: true` (off by default since the PR #11 review), the first build commit copies it to the repo's `.factory/design/<line>/vN/`. It is never changed after approval. The *line* is the run that approved v1; a change request (`factory estimate --revises`) becomes the next version of the line it changes, with `previous` and the screen diff, and any other run that draws its own design starts a new line.
- **Exports (built).** `factory design export <run> --format png|pdf|html|tokens|json|figma|all` (plus `--version vN`, `--pdf-per-screen` and filters) and `factory design export list <run>`, in every mode; `--design-export` exports on approval; an **Export panel** on the run's Design tab. Each export is `<run>/exports/vN/<n>/`: `vN` is the design version, `<n>` counts that run's exports of it, and nothing is overwritten. Every file is tagged with the line, version and sha.
- **Figma (built, route A).** `--format figma` (and Figma in the Export panel) writes `figma.json`: layers read from the approved demo in Chromium for each picture (frames with auto layout worked out from positions, text with its fonts, SVG icons, pictures for native controls and images), the tokens as variables, the Components page's grids as component sets, and each frame's approved picture as a hidden reference layer. Our own "AI Factory Import" plugin (`figma-plugin/`, no network access) builds it in Figma on any plan, the free one included, with no token or paid seat. It is installed once from its manifest (Plugins > Development > Import plugin from manifest...). The export's `figma.frames` check covers every pictured state. Figma's MCP server can write only from allowlisted clients over OAuth with a paid seat, so the optional Claude Code route (`factory design figma`) is not built. The plugin is tested against a stand-in for Figma, not yet inside Figma.
- **Stack conversion (built).** A UI target per run (`next-shadcn`, `vite-shadcn` or `repo`), from the project's `design.uiTarget` / `design.uiTargets`, `factory start --ui-target`, or detection from the repo (Next.js or Vite with React takes the kit; another UI library, or an existing repo whose stack nothing shows, keeps its own components). The theme is generated from the approved tokens under shadcn's variable names with Tailwind v4 `@theme`; the `kits/shadcn` kit (1.1.0) has a component for every block, field and layer. The stub commit writes the scaffold: the kit, the theme, and per screen a page as approved (`screen.tsx`), its sample data (`fixtures.ts`) and a `container.tsx` the model fills with data and behaviour only. Every page opens in any state with `?fixture=S-3:empty`. The plan's first task is the design-system task, each screen task has its container in scope (`plan-scaffold`, B7), the generated files are protected, and a change request plans only the changed screens. `factory design kit list|show`, `factory design target <repo>`, `factory design scaffold [run]` and the Design tab's **Code** panel (preview another target, Generate, zip).
- **Fidelity (built).** The `design-fidelity` step runs after accept on a kit build when the project sets `design.fidelity`. It builds and starts the app in fixture mode, then opens every state at phone and desktop width, the first state at tablet width, and dark mode and the other language when the design has them. Tokens, structure and accessibility block (gates `design.tokens`, `design.structure` and `design.a11y`, waivable per commit). Layout and pixels are advice, and pixels compare only against an accepted baseline. WebKit runs at phone width when it is installed. The scaffold also writes Playwright tests per screen, tagged with requirement ids (`npm run test:design`). Baselines are accepted with a reason: `factory design baseline <run>`, or the Design tab's **Fidelity** panel, which shows the approved, built, baseline and difference pictures. They are recorded in the ledger. `factory design fidelity <run> [--url]` shows the report, or checks an app that is already running. Each export now records PDF and PNG checks (screens, fonts, pages, screens × states). The base-versus-head `design-check` below still runs for `design.capture`.

## The four sizes, precisely

The classifier (`src/design/size.ts`) takes a list of files, each marked add, modify or delete. In git mode it also reads each file before and after the change.

- **Design-system change:**
  - a new building block (a new file under the app's building-block folder, for example `components/ui/`);
  - a building block whose running code changes;
  - a stylesheet whose custom properties or `@theme` block change;
  - Tailwind theme settings that change (colours, fonts, container, animations);
  - a new app.
- **New screen:**
  - a new page: Next.js `app/**/page.tsx`, a pages-router page, a feature folder entry, or a file route;
  - a new file whose name contains the whole word dialog, drawer, sheet, modal, form or wizard (so `user-form.tsx` counts, `platform-badge.tsx` doesn't).
- **Screen tweak:** any other change to a UI file (`.tsx`, `.jsx`, stylesheets), including navigation, layouts, `loading`/`error`/`not-found`, and helper components in private `_components` folders.
- **No UI:** nothing above. Tests, stories, email templates and `public/` don't count.

Rules that keep it from over-ranking:
- Deleting a file never makes a change bigger than a screen tweak.
- A file moved without changes doesn't count, unless it is a page whose URL changes (then it is a screen tweak).
- In git mode, a building-block edit that is a pure reorder of classes, changes only types, or changes only imports stays a screen tweak. Both versions are compiled without types and compared.
- `globals.css` counts as a design-system change only when its tokens change. In plan mode, where there is no content yet, a planned `globals.css` edit is a screen tweak with a note: the size-cap check after the build catches it if it turns out to touch tokens.

Where the app keeps things is detected, not hard-coded:
- **Source root:** `src/` or the repo root.
- **Import aliases:** from `tsconfig.json` or `jsconfig.json` paths, defaulting to `@/`.
- **Building-block folder:** from `components.json`, else `components/ui`, else `ui/`.
- **Page conventions:** from the framework and folders.

The CLI takes overrides for the source root and the building-block folder.

## Where each piece plugs in

### Discover: inventory into the repo profile
- `buildInventory(dirSource(snapshot.root))` over the run's snapshot. It is a file walk that takes about a second, so it reruns on every run. There is no cache and no "should we re-extract" decision (see "Dropped").
- Run it only when the repo (or a folder in it) has a `package.json` with `react` or `next`.
- Store it as part of the repo profile. Two things go on the onboarding card: the verdict (consistent, partial or no design system) and the summary lines from `inventorySummary()`.
- If the verdict is "no design system", record that on the onboarding card. New pages then copy their nearest sibling page. Don't start a design-system extraction unless the human asks.

### After plan: the size, from the plan's file list
- `plannedChanges(fileScope, snapshotFiles, layout)` turns the plan's paths and globs into planned changes:
  - an existing path is a modify;
  - a missing path is an add;
  - a glob that matches nothing under `app/` is read as a new page.
- `sizeChange()` then gives the size and the reasons.

### Approval card: the size, and later the mock
- **Built now.** The card gets one line under "Files the plan will touch", for example: `UI size: **new screen** (new page app/(shop)/invoices/page.tsx (route /invoices)). Design work: …`. The line is left out when the plan touches no UI, so .NET runs see the same card as before. The change to `src/stages/spec.ts` is three added lines; the logic is in `src/design/card.ts`.
- **Later:** for a new screen or bigger, the card shows the mock screenshots (390 and 1280 px, every state), and the requirement-to-screen trace. The approved size is stored with the approval, so the size-cap check can read it. The human can raise the size on the card, but never lower it.

### After implement: fidelity lint (per task)
- `lintDiff(inventoryAtBase, diffFromGit(worktree, taskStart, head))`, then the `design.fidelity-lint` gate. It fails:
  - on hex colours;
  - on arbitrary Tailwind values the app's own building blocks don't already use;
  - on inline styles;
  - on imports of components that are neither in the inventory nor added by this change;
  - on any new building block.
- If the inventory found no components, the lint reports "could not check" and the gate fails. A gate that passes having checked nothing is worse than no gate.

### After integrate: size-cap check
- Producer: `sizeFromGit(worktree, base, integratedHead)`, stored as an artifact.
- Gate: `design.size-cap` with inputs `{ actual, approved: { level } }`. It fails when the real change is bigger than the approved size, and lists the reasons.
- It can be waived by a human, like the diff-size gate.

### Accept: screenshots and comparisons (see "Visual check")
The screenshot step writes one report per state: element boxes, accessibility results, and whether the page scrolls sideways. `compareReports(approved, final)` then:
- **fails** on a new accessibility problem. That includes a new element that breaks a rule the page already broke, because the comparison is by rule and element, not by rule alone;
- **fails** on a missing state or sideways scrolling;
- reports moved or missing elements as evidence for the PR reviewer, not as a new human stop.

## Wiring: what is done and what is still to do

Done, in `src/stages/build.ts` (helpers in `src/design/build-checks.ts`):

- **Implement:** when a task's commit changes UI files, the token and component lint runs on that commit range against the inventory at the task's start, and `design.fidelity-lint` decides. A task with no UI files, or a project with no `design` block in its config, adds no gate.
- **Integrate:** for a build that follows an approved estimate whose design was not skipped (or was, which allows no UI), when the range changes UI files, `design.size-cap` compares the real size (`sizeFromGit`) with the biggest screen size the approved design allows (`approvedLevel`: reuse and tweak are a screen tweak, new is a new screen, design-system is a design-system change). A UI change where the design was skipped fails the cap, so a request the model judged as having no UI cannot quietly build one. A human can waive either gate; the waiver is logged.

- **Discover:** a repo with a React or Next.js `package.json` gets the design inventory as a second named output, `design`, and the verdict and summary are logged. The snapshot leaves out `noGo` paths, so a front end under one is not inventoried. Nothing reads the output yet: the lint builds its own inventory from git at the task's start commit.
- **Project config:** an optional `design:` block (`sourceRoot`, `uiDir`, `brandFonts`, `navRaises`, `uiTarget`, `uiTargets`), passed to the inventory, the lint and the size cap (see `docs/project-example.yaml`).
- **Capture and compare the built app:** `factory design capture --page name=url --out dir` screenshots and reports pages of a running app at 390 and 1280 px (layout boxes, basic accessibility checks, sideways scroll), and `factory design compare approved.json final.json` runs `compareReports`. Accessibility comes from axe-core (WCAG A and AA rules). If the package is missing, a small built-in set (alt text, names, labels, page language) is used and the note says so. Problems already on the page before the change show as warnings; only new ones fail.

- **Visual check inside the build:** see below.

## Visual check (built, opt-in, advisory)

`src/stages/design-check.ts` runs after accept on a build whose change touches UI files. It needs a `design.capture` block in the project config (see `docs/project-example.yaml`). Without one the step is skipped and says why.

What it does: checks out the base commit, runs `install` and `start`, waits for `readyPath`, screenshots each listed page at 390 and 1280 px, stops the app, repeats for the head, then compares layout and accessibility (`compareReports`) and pixels (`pixelDiff`). Pictures and a report go in the run's `design-check/` folder (`base/`, `final/`, `diff/`). The Design tab shows them side by side, and they are served by `factory ui` only as png files from that folder, with the key.

Things to know:
- **Host risk.** The project's install and start commands run on this machine, not in a container, on code the factory just generated. That is why `allowHost: true` is required. The app gets a minimal environment plus `env` from the config, and no factory secrets. The process group is killed afterwards.
- **Advisory.** It never blocks the build. A change request is meant to change how pages look, so the output is evidence for the reviewer.
- **The "approved" side is the base commit**, the app as it was before the change, not the design mock. Comparing against a mock image is not attempted.
- **Only UI-changing builds** are captured.

## Pixel diff

`factory design pixel <before-dir> <after-dir> --out <dir> [--tolerance n] [--json]` compares same-named pngs in two folders and prints, per pair, the share of pixels that differ, whether the size changed, and whether the change is noticeable (over `NOTICEABLE_RATIO`). It gives figures, not pass or fail. Comparison runs in headless Chromium on a canvas, so no image library is needed. Pages with clocks, animations or live data will differ run to run; fixtures, a frozen clock and mocked network are not built.

## Brief cleaner and the untrusted-text rule

`cleanBrief(raw, inventory, { brandFonts })` keeps only typed fields:
- palette entries (a plain name plus a hex colour);
- font names (Google Fonts, generic families, or the project's configured brand fonts);
- spacing and radius numbers in range;
- screens made of named regions, mapped to components in the inventory.

Everything else is dropped and logged. Text is folded to plain letters (NFKC) before it is checked, so full-width look-alike letters don't slip past the filter.

Free-text notes are kept apart as `untrustedNotes`. Following the context builder's rule that untrusted text is only allowed in read-only steps, `writerView(brief)` (what a writing step such as design-mock or implement may see) never contains them. The notes may go to design-read (read-only, locked room), fenced as untrusted.

The filter on notes is a first pass only. The real protection is that the notes never reach a writing step, and that the human approves the resulting design on the card.

## Dropped

The **extraction cache and its "should we re-extract" check** (`should-extract`, `update-extraction-cache`) are not ported. They guard an expensive extraction step that exists in none of the shared material. The inventory itself is a cheap file walk, so it reruns on every run, from the run's own snapshot. If the teammate later shows an expensive model-driven extraction, the cache can come back in front of that step only.

## Not ported, and what a Next.js screenshot step needs

- **Direction proposals** (`propose-directions`) need five ui-ux-pro-max data files we don't have. Without them, it alternates density at random. That leaves the new-app style pick out for now.
- **State screenshots and the acceptance probe** (`capture-states`, `accept-user-detail`) only work on a Vite dev server: they import fixture modules by source path inside the browser. A Next.js-capable replacement needs:
  - **Seeded fixtures by id, or MSW:** one fixture set, served the same way to the mock, the screenshots and accept. Otherwise every pixel diff fails.
  - **A frozen clock and fixed random seed,** so "3 minutes ago" and generated data don't change between runs.
  - **Reduced motion and no animations,** and waits on network idle and fonts loaded.
  - **Fixed viewports** at 390 and 1280 px, one screenshot and one report (element boxes, accessibility results, sideways scroll) per state.
  - **A Node + Chromium lab container with no network,** reading the run's snapshot or worktree, not the developer's folder. It builds the app (`next build` and `next start`, or the dev server) with packages restored read-only, like the .NET test lab.
  - **Playwright tests with a machine-readable report** for the acceptance checks, written by our test writer from the acceptance criteria and locked by hash. Not hand-written probe scripts.
- **The pixel diff** needs image libraries (pixelmatch, pngjs). They are not added until the screenshot step exists. The layout comparison already catches the case where a real layout change falls under the pixel threshold.

## Running it by hand

```
factory design inventory <repo> [--ref <commit>] [--json] [--source-root src] [--ui-dir src/components/ui]
factory design size --plan <file.json> [--repo <repo>]      # { files: [{ path, change }] } or a plan with tasks[].fileScope
factory design size --git <base> <head> [--repo <repo>] [--nav-raises]
factory design lint --git <base> <head> [--repo <repo>]     # exits 1 unless everything passed
factory design brief <extract.json> [--repo <repo>] [--brand-font "Acme Sans"]
```

## Known limits

- Code edits to a building block that don't change its look (a removed prop, an export style change) still count as design-system changes. So do class rewrites to an equivalent shorter form (`min-w-[8rem]` → `min-w-32`). Only a before/after screenshot can settle these.
- The size check from a plan's file list has not been measured on real plans yet, because there are none. In plan mode there is no file content, so building-block edits are always read as design-system changes.
- Apps without Tailwind or shadcn (MUI, CSS modules) get an inventory and a size, but the token lint knows only Tailwind arbitrary values and hex colours.
