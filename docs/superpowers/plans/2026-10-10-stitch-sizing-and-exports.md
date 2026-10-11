# Stitch Sizing and Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stitch design is sized by the estimate as precisely as a JSON design, and its exports (package pictures, PNGs, PDF book, demo, Figma) show each Stitch screen and state exactly as Stitch drew it.

**Architecture:** (1) When a Stitch screen is drawn, its HTML is counted into the same UI points the JSON blocks give (fields, tables, charts, dialogs, tabs, uploads); the estimate's `screenUi` reads them for a screen with no mock. (2) The approval demo gives each Stitch state its own pane with its own screenshot and no app frame around it, so the package's per-state pictures, and every export made from them, are exact. (3) Screenshots are fetched larger when Stitch allows it, falling back to the default picture. (4) The Figma export reads the per-state Stitch pane as a picture layer.

**Tech Stack:** TypeScript ESM, cheerio, vitest, headless Chromium (Playwright), as in `docs/superpowers/plans/2026-10-10-stitch-design-to-build.md`.

**Spec:** the user's request of 10 Oct 2026 ("fix all things which you proposed") after the check that found: Stitch screens unsized in the estimate; per-state package pictures identical; a second app frame around Stitch screenshots; 512 px screenshots; Figma likely empty.

## Global Constraints

- JSON-track designs: the estimate's points, the demo HTML, the package pictures and the Figma export are unchanged (every new branch is taken only for a screen with `facts` and no `mock`, or a frame with a `state`).
- Dark-mode and second-language pictures need no change: a mapped Stitch theme is never `auto` and a Stitch design has no locale.
- A larger screenshot is used only when Stitch returns an image (PNG, JPEG or WebP) of at most 2 MB (the demo's per-frame embed limit); otherwise the default picture.
- Commit messages carry no `Co-Authored-By` line.

## Review Focus

- A Stitch page with a 12-field form and a table is sized above a page with one button.
- A Stitch screen with normal and empty frames: the Default and Empty package pictures differ and each shows only its own screenshot.
- Stitch refusing the size suffix (403/404, HTML, or a 5 MB image): the default picture is used, nothing fails.
- The Figma export of a Stitch design has one frame per screen and state, each with the Stitch picture.

---

### Task 1: Size a Stitch screen from its HTML
- Files: `src/design/stitch-facts.ts` (`StitchFacts.ui?: [number, string][]`, counted after the frame is set aside), `src/estimate/ui-complexity.ts` (`screenUi` uses `facts.ui` when there is no mock), `src/contracts/artifacts.ts` (facts schema), tests in `src/design/stitch-facts.test.ts`.
- Counting (same weights as the JSON blocks): a form of n fields (`input` other than hidden/submit/button/search, `select`, `textarea`) = 1 + ceil(n/2) + one per rich kind (`date`/`time` picker, `tel` phone, `password`, `select` dropdown, `file` upload counts as an upload component 4) + 1 when any field is `required` or its label ends with `*` (field validation); each `table` = 2; each chart (`canvas`, or an `svg` with 5+ `rect`/`path`/`circle` shapes, or an element whose class names a chart) = 2, at most 3; each `dialog`/`[role=dialog]` = 2 (3 with a form); a `[role=tablist]` = 2.
- Tests: the real fixture `src/design/fixtures/stitch-book-appointment.html` is at least moderate with a form driver; a page with one button is simple with 0 points beyond its states; a mock screen's `screenUi` is unchanged; a facts screen without `ui` keeps today's "no sample page" driver.

### Task 2: One pane per Stitch state, without our app frame
- Files: `src/design/demo.ts` (`DemoInput.frames[id].state?`; a screen whose frames carry states renders `states.map` panes, each holding the frame whose state is that pane's state kind, normal for the default, and its canvas holds only the panes, no app frame); `src/stages/design-stitch.ts` (`stitchFrames` returns `state`); `src/stages/design-approve.ts` (frames carry `state`); tests in `src/stages/design-stitch.test.ts`.
- Tests: `buildDemo` for a Stitch screen with normal and empty frames writes two panes (`data-wf="0"` with the normal picture, `data-wf="1"` hidden with the empty one) and no `topbar`; a JSON screen's demo HTML is byte for byte as before (compare against a build without the change's inputs); `stitchFrames` carries the state; and in headless Chromium (skipped without it) the package's captured Default and Empty pictures differ.

### Task 3: Larger screenshots when Stitch allows
- Files: `src/stages/design-stitch.ts` (`saveAsset` downloads `imageUrl + "=w1600"` first and keeps it only when it is an image of at most 2 MB, else the default URL); tests in `src/stages/design-stitch.test.ts`.
- Tests: a fake client that serves a larger PNG for the suffixed URL gets it; one that returns 404, HTML, or a 3 MB image for it falls back to the default picture; a fake whose download throws for the suffixed URL falls back too.

### Task 4: Figma export of a Stitch design
- Files: `src/design/figma.ts` only if the test shows a need; test `src/design/stitch-export.test.ts`.
- Test (headless Chromium, skipped without it): a package folder written by the test (manifest, design.json, the Task 2 demo with normal and empty frames) through `figmaDoc` gives one frame per screen and state, each with a reference picture and a root layer; Default and Empty differ.
