# Stitch: popups on their page, and mobile design chosen per run

Date: 2026-10-15. Asked for by the lead after comparing the two design tracks on the same requirements: the JSON track
(planned by GPT-6 Luna) gave 4 to 5 screens, the Stitch track 20 to 25. Stitch's quality is wanted; its count is not.

## Why Stitch gives more

1. Every extra state (empty and error by default) and every phone-width drawing (up to 5) is a drawing of its own
   (`stitchJobs`, `src/stages/design-stitch.ts`). The JSON track shows the same things as tabs of one screen.
2. The Stitch screen list has no popups. The JSON rules put a modal, side panel, bottom sheet or confirm dialog on its page
   (`overlays`, `src/stages/design.ts`); the Stitch rules say "one screen per page" and name "a confirmation" as a page of its own.
   So "Add payee" and "Confirm delete" become pages, each with its own states and route.
3. The Stitch rules lack the JSON track's "Do not invent screens the requirements do not need."

Cause 1 is a project setting (`design.stitch.states`, `design.stitch.phone`). This change fixes 2 and 3 and lets a person turn the
phone drawings on or off when starting a run.

## What changes

### Popups (overlays) on the Stitch track

- The Stitch screen list gives each page an `overlays` list, at most 3: `kind` (`modal`, `drawer`, `sheet`, `confirm`), `title`,
  `trigger` (the exact words on the control that opens it) and `content` (what it holds).
- The planner rules forbid a screen for something that opens over a page. A page with an address of its own stays a screen.
  A message that an action worked is a line on its page, not a screen, unless the requirements give it a page.
  "Do not invent screens the requirements do not need" is added. The taste line no longer names "a confirmation" as a page.
- Each overlay is drawn once, as a frame of its page with state `overlay-<n>`: the same page with the layer open over it.
  It gets no empty, error or phone drawing of its own.
- The design keeps each Stitch screen's overlays (`kind`, `title`, `trigger`). The approval demo shows each as a tab named
  as the JSON track names it ("Dialog: Add payee"), with its own picture. The package pictures, the scaffold's states and
  the estimate (each overlay adds UI points to its page, as on the JSON track) read them too.
- A send-back that patches a screen keeps that screen's overlays and draws them again with its other states.

### Mobile design, chosen per run

- New run setting `mobileDesign` (true or false), saved with the run when it is created, so a resume or a send-back keeps it.
- Order: the run's setting, then the project's `design.stitch.phone`, then on (as today).
- Web form: when a design engine (Google Stitch, or the model drawing the pages) is picked on the design row, a
  "Mobile design" select (Yes / No) appears beside "planned by". It starts at the chosen project's setting; it is sent only
  when changed. The new-product (full stack) form does not show it.
- CLI: `--mobile-design <true|false>` on `factory start`, `factory estimate` and `factory design start`.
- Extra states stay a project setting (`design.stitch.states`).

## Not changed

- The JSON track. A JSON design has no top-level `overlays` (its overlays stay in `mock`), so every new branch is taken only
  for a Stitch screen.
- A design drawn for a phone (`design.stitch.device: MOBILE`) already draws every page at phone width; the setting has no effect there.
