# Stitch Path: Design to Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A design drawn by Google Stitch goes through the same stages as a JSON-track design: approval (with screens fixed one by one on send-back, and extra states), the design package (tokens, HTML per screen), and the build (the coding agent, the test writer and the fidelity check all get what the Stitch screens show).

**Architecture:** The Stitch design artifact gains what the JSON track's later stages read: a `theme` in our format (mapped from Stitch's theme), and per screen the `facts` read from Stitch's HTML (title, buttons, fields, columns). Everything downstream that already reads `theme` and screen words then works unchanged; the few places that read only `mock` learn to read `facts`. Rework edits only the screens the lead named, through Stitch's `edit_screens`; extra states are fresh generations from the screen's prompt. The package and the coding brief carry each screen's Stitch HTML.

**Tech Stack:** TypeScript ESM, zod 4, vitest 5, `@google/stitch-sdk` 0.3.5, `cheerio` (already installed by the SDK; made a direct dependency).

**Spec:** "Design Engine Adapter: End-to-End Plan" (https://claude.ai/code/artifact/45b47c28-7a02-4ea8-b8a8-6fc67e7fa9ab), sections "Stitch track" and "Package and build"; and the previous plan `docs/superpowers/plans/2026-10-09-design-tier-ladder.md` (Tasks 6-10 and their live-test fixes).

**Greenfield (Tasks 8 and 9):** the kit scaffold (`src/design/kit/scaffold.ts`) builds pages from JSON mock blocks. For a Stitch screen it now writes everything except the page's look: the route, the navigation entry, the theme (Task 1's mapped theme), and a `container.tsx` the coding task owns, which it fills by rebuilding the Stitch page with the kit's components and must open in fixture mode (`?fixture=S-1:<state>`). Nothing generated for a Stitch screen is protected, because the coding task writes the page itself. This keeps the approved Stitch page as the target instead of converting it to our blocks.

**Accessibility (Task 10):** Stitch's HTML is checked with axe-core in headless Chromium, with its scripts stripped and the network blocked; structural rules only (contrast is checked on the theme, as in the JSON track). One fix round through Stitch; what stays open is shown on the approval card.

## Global Constraints

- Agent steps never receive images (`src/runners/claude-agent.ts:148`); the coding agent gets Stitch HTML as text only, in an untrusted section.
- Stitch HTML is never rendered unsandboxed; it is written into the package as a file and shown to agents as text.
- Stitch's default model only: no `modelId` is sent (the live service refused every documented id on 9 Oct 2026).
- Extra states are capped by `design.stitch.states` (default `["empty", "error"]`) and only for screens whose plan lists that state; each costs one Stitch generation.
- A rework edits only the screens the lead's reasons name; when the reasons name none, or name the whole look, the design is redrawn whole (today's behaviour).
- Frame files are named `stitch-<screen>-<state>-<sha8>.png`, so a redraw never overwrites an earlier version's pictures.
- JSON-track designs behave exactly as before: every new branch is taken only when the design has `engine: "stitch"` or a screen has `facts` and no `mock`.
- Commit messages carry no `Co-Authored-By` line (user rule).

## Review Focus

- **A send-back naming one screen of five:** only that screen is edited (one `edit` call); the other four keep their frames, HTML and facts byte for byte. Pinned in Task 4.
- **A send-back about the whole look ("make it darker"):** the triage says redraw, and the whole design is drawn again with the reasons. Pinned in Task 4.
- **Stitch HTML with `<script>` tags or 300 KB of markup in the coding brief:** scripts and inline data URIs are removed and the HTML is capped, so the brief stays within budget. Pinned in Task 6.
- **A Stitch design in the package:** `tokens.json` exists (look `design`, not `repo`) and every screen's HTML is in `screens/`. Pinned in Task 5.
- **A JSON-track design through all changed code:** same brief, same facts, same package files, same fidelity expectations and the same scaffold files as before. Pinned in Tasks 2, 5, 6, 7 and 8.
- **A greenfield design mixing JSON and Stitch screens** (a change request on a Stitch product drawn earlier, or a project switching engines): each screen goes its own way in one scaffold, and a Stitch screen's container is never protected. Pinned in Task 8.

---

### Task 1: Stitch's theme in our format

**Files:** Create `src/design/stitch-theme.ts`, `src/design/stitch-theme.test.ts`; modify `src/stages/design-stitch.ts` (`stitchArtifact`, `drawWithStitch`), `src/contracts/artifacts.ts` (`DesignBody.stitch.theme`), `src/stages/design-stitch.test.ts`.

**Interfaces:**
- Produces: `stitchThemeToDesign(t: StitchTheme, mood: string): DesignTheme`; the Stitch artifact sets `theme` (mapped), `themeSource: "new"` and `stitch.theme` (the raw Stitch theme).
- Mapping: `brand` = `customColor`; `mode` = `colorMode` lower-cased; `radius` = `ROUND_FOUR` → `sharp`, `ROUND_EIGHT`/`ROUND_TWELVE` → `soft`, `ROUND_FULL` → `round`; `font` = serif families (`NEWSREADER`, `NOTO_SERIF`, `DOMINE`, `LIBRE_CASLON_TEXT`, `EB_GARAMOND`, `LITERATA`, `SOURCE_SERIF_FOUR`) → `book`, `SPACE_GROTESK`/`HANKEN_GROTESK` → `grotesk`, `NUNITO_SANS`/`RUBIK` → `rounded`, else `sans`; `heading` = `serif` when the headline font is a serif and the body is not, else `match`; `families` = the display names (`GEIST` → `Geist`, `DM_SANS` → `DM Sans`, `SOURCE_SERIF_FOUR` → `Source Serif 4`, `SOURCE_SANS_THREE` → `Source Sans 3`, otherwise words title-cased); `mood` = the given text cut to 40 characters. The result must parse with `DesignTheme`.

- [ ] **Step 1: Write the failing tests** (`src/design/stitch-theme.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { DesignTheme } from "../contracts/artifacts.js";
import { stitchThemeToDesign } from "./stitch-theme.js";

const base = { colorMode: "LIGHT", headlineFont: "GEIST", bodyFont: "DM_SANS", roundness: "ROUND_EIGHT", customColor: "#0F766E" } as const;

describe("Stitch theme to our theme", () => {
  it("maps colour, mode, corners and fonts, and parses as a DesignTheme", () => {
    const t = stitchThemeToDesign(base, "Calm, balanced front-desk tool for a clinic");
    expect(t).toMatchObject({ brand: "#0F766E", mode: "light", radius: "soft", font: "sans", heading: "match", families: { heading: "Geist", body: "DM Sans" } });
    expect(t.mood.length).toBeLessThanOrEqual(40);
    expect(DesignTheme.safeParse(t).success).toBe(true);
  });
  it("reads serif, grotesk and full-round choices", () => {
    expect(stitchThemeToDesign({ ...base, headlineFont: "NEWSREADER", roundness: "ROUND_FULL", colorMode: "DARK" }, "x")).toMatchObject({ heading: "serif", radius: "round", mode: "dark" });
    expect(stitchThemeToDesign({ ...base, bodyFont: "SPACE_GROTESK", roundness: "ROUND_FOUR" }, "x")).toMatchObject({ font: "grotesk", radius: "sharp" });
    expect(stitchThemeToDesign({ ...base, bodyFont: "SOURCE_SERIF_FOUR", headlineFont: "SOURCE_SERIF_FOUR" }, "x")).toMatchObject({ font: "book", heading: "match", families: { body: "Source Serif 4" } });
  });
});
```

And in `src/stages/design-stitch.test.ts`, in the "writes DESIGN.md…" test, add: `expect(d.theme).toMatchObject({ brand: "#0F766E", mode: "light" }); expect(d.themeSource).toBe("new"); expect(d.stitch.theme).toEqual(theme);` (widen the `getJson` type accordingly).

- [ ] **Step 2: Run, see them fail** — `npx vitest run src/design/stitch-theme.test.ts src/stages/design-stitch.test.ts`.
- [ ] **Step 3: Implement `stitch-theme.ts`** with the mapping above (a `SERIFS` set, a `NAMES` map for the four irregular names, title-case otherwise), returning `DesignTheme.parse({ mood, brand, mode, radius, font, heading, families })` so defaults fill the rest. In `stitchArtifact`, take a `theme: StitchTheme` and `mood: string` in `meta`, set `theme: stitchThemeToDesign(meta.theme, meta.mood)`, `themeSource: "new"`, and `stitch.theme: meta.theme`. In `drawWithStitch`, pass `theme: m.output.theme` and `mood: plan.flow`. Add `theme: StitchTheme.optional()` (the schema from `src/design/stitch-taste.ts`) to `DesignBody.stitch`.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` → clean. **Commit:** `Give a Stitch design our theme, mapped from Stitch's, so tokens and the look follow it`.

### Task 2: Facts read from Stitch's HTML

**Files:** Modify `package.json` (`cheerio` as a direct dependency at the version already in `package-lock.json`); create `src/design/stitch-facts.ts`, `src/design/stitch-facts.test.ts`; modify `src/stages/design-stitch.ts`, `src/contracts/artifacts.ts` (screen `facts`), `src/design/design-link.ts` (`ApprovedScreen.facts`, `screenFacts`).

**Interfaces:**
- Produces: `interface StitchFacts { title?: string; buttons: string[]; fields: string[]; columns: string[]; headings: string[] }`; `stitchFacts(html: string): StitchFacts` (each list unique, trimmed, at most 20; `title` = the first `h1`, else the first `h2`; `buttons` = text of `button`, `[role=button]`, `input[type=submit]` values; `fields` = `label` text; `columns` = `th` text; `headings` = `h1`-`h3` text; Material icon ligature words such as `search`, `add` inside `.material-symbols-outlined` / `.material-icons` are dropped); `DesignBody.screens[].facts?: StitchFacts`; `screenFacts()` uses `s.facts` for a screen with no `mock`.

- [ ] **Step 1: Write the failing tests:**

```ts
// src/design/stitch-facts.test.ts
import { describe, expect, it } from "vitest";
import { stitchFacts } from "./stitch-facts.js";

const html = `<html><body><h1>Today's Appointments</h1><h2>Next up</h2>
<button><span class="material-symbols-outlined">add</span> Book appointment</button><button>Book appointment</button>
<a role="button">Check in</a><input type="submit" value="Save">
<label>Patient name</label><label>Phone</label>
<table><tr><th>Time</th><th>Patient</th><th>Status</th></tr></table><script>alert(1)</script></body></html>`;

describe("facts from Stitch HTML", () => {
  it("reads the title, buttons, fields, columns and headings, without icon words or scripts", () => {
    expect(stitchFacts(html)).toEqual({
      title: "Today's Appointments", buttons: ["Book appointment", "Check in", "Save"], fields: ["Patient name", "Phone"],
      columns: ["Time", "Patient", "Status"], headings: ["Today's Appointments", "Next up"],
    });
  });
  it("is empty for empty HTML", () => {
    expect(stitchFacts("")).toEqual({ buttons: [], fields: [], columns: [], headings: [] });
  });
});
```

In `src/stages/design-stitch.test.ts`, make the fake download return HTML with an `<h1>` and a `<button>` and assert `d.screens[0].facts` holds them. Add a test file case for `screenFacts` (in `src/design/stitch-facts.test.ts`): a design whose screen has `facts` and no `mock` gives `{ title, buttons, fields, columns }` from the facts; a screen with a `mock` gives exactly what it gave before (assert against a small mock with one form field and one button).

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** `stitchFacts` with `cheerio.load(html)`: remove `script, style, .material-symbols-outlined, .material-icons, .material-symbols-rounded` first, then collect. In `drawWithStitch`, after downloading each screen's HTML, set `facts: stitchFacts(htmlText)` on its asset and carry it into `stitchArtifact`'s screens. In `screenFacts`, when `!s.mock && s.facts`, build the result from `s.facts` (`title`, `buttons`, `fields`, `columns`; `messages: {}`, `toasts: []`).
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Read each Stitch screen's title, buttons, fields and columns from its HTML for the tests and checks`.

### Task 3: Extra states and versioned frames

**Files:** Modify `src/stages/design-stitch.ts`, `src/config/project.ts` (`design.stitch.states`), `src/stages/design-stitch.test.ts`.

**Interfaces:**
- Produces: `design.stitch.states: ("empty" | "error" | "loading" | "success" | "validation")[]` (default `["empty", "error"]`); each screen's frames are `[normal, ...one per drawn state]`; frame names `stitch-<id>-<state>-<sha8>.png` (`state` = `normal` for the page itself); `stitch.frames[fid]` gains `state: string`.
- A state is drawn when the plan lists it for the screen (case-insensitive match on the state kind) and it is in `design.stitch.states`. Its prompt: `${screen.prompt}\nShow this same page in its ${state} state: ${STATE_HINT[state]}. Keep the layout, navigation and header identical to the normal page.` with `STATE_HINT` = empty: "no records yet, with a short message and the one action that adds the first", error: "the data failed to load, with an inline error message and a retry action", loading: "skeleton placeholders where the data will appear", success: "a confirmation that the action worked", validation: "the form with its required fields flagged and their error messages".

- [ ] **Step 1: Write the failing tests** in `src/stages/design-stitch.test.ts`: (a) the plan's S-1 lists `states: ["empty"]` and S-2 lists `["validation"]`; with the default config, Stitch gets 3 generations (S-1 normal, S-1 empty, S-2 normal), `d.screens[0].frames` has 2 ids and `d.screens[1].frames` 1; the empty prompt contains "empty state"; (b) with `design.stitch.states: ["validation"]`, S-2 gets its validation frame and S-1 no empty frame; (c) every frame file name matches `/^stitch-S-\d+-(normal|empty|validation)-[0-9a-f]{8}\.png$/` and exists in `attachments/frames`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**: build the job list (screen, state) before the pool; run every job through the pool; name each PNG by its sha; group the results back per screen in screen order (normal first). Update `stitchArtifact` to take per-screen asset lists.
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Draw the extra states a Stitch screen needs, and name frames by version`.

### Task 4: Rework by editing only the named screens

**Files:** Modify `src/design/stitch.ts` (`edit`), `src/stages/design-stitch.ts`, `src/stages/design.ts` (pass the previous Stitch design), `src/design/stitch.test.ts`, `src/stages/design-stitch.test.ts`.

**Interfaces:**
- Produces: `StitchClient.edit(projectId: string, screenId: string, prompt: string, device: StitchDevice): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>` (SDK: `stitch.project(projectId).screen(screenId).edit(prompt, device)`); `StitchInputs.previous?: StitchDesign` (the earlier Stitch design artifact of this run); `StitchTriage` zod `{ redraw: boolean, screens: { id: string; change: string }[] }`.
- Flow when `previous` and `feedback` are present: one `think` call on route `design-triage` (`label: "design rework triage (stitch)"`, sections: the reasons, the previous screens as `{ id, title, route, facts.title }`, rules: "name the screens the reasons ask to change, each with the change in one sentence; set redraw when a reason is about the whole look, the flow or which screens exist"). `redraw` true, or no named screen that exists → full draw (the existing path, with the feedback). Otherwise: reuse `previous.stitch.projectId` and its DESIGN.md; for each named screen call `edit` on its normal frame's Stitch screen id with the change, download, take facts, and redraw that screen's extra states with `generate` (prompt + the change + the state line); every other screen keeps its frames, HTML and facts as they were. The result carries `revision: (previous.revision ?? 0) + 1` and `rework: [{ round, mode: "patch", patched: [ids], lines: [changes], kept: [ids], notDesign: [], fine: [] }]` appended to the previous rework list.
- In `src/stages/design.ts`, pass `previous` = the design step's previous output when it has `engine: "stitch"` (`ctx.state.steps.get("design")?.outputs[0]`, read with `ctx.ledger.getJson`).

- [ ] **Step 1: Write the failing tests**: (a) a previous two-screen Stitch design and the reason "make the Add payee button say Save payee"; the triage answer names S-2; Stitch gets exactly one `edit` (for S-2's screen id) and no `generate`, no new project, no new design system; S-1's frames and facts are unchanged; `revision` is 1 and `rework[0].patched` is `["S-2"]`; (b) the triage answer `redraw: true` gives a full draw (a new project, `generate` per screen); (c) the triage naming an unknown id `S-9` gives a full draw. `src/design/stitch.test.ts`: nothing new (the SDK path is covered by the live check below).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** as above. Fake client in the test records `edit` calls.
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Fix only the Stitch screens the lead named, with Stitch's edit, and keep the rest`.

### Task 5: Stitch HTML in the design package

**Files:** Modify `src/design/package.ts` (`PackageInput.extraFiles`), `src/stages/design-export.ts` (pass them), add tests to `src/design/stitch-facts.test.ts` or a new `src/design/stitch-package.test.ts` for the pure part.

**Interfaces:**
- Produces: `PackageInput.extraFiles?: { path: string; content: string | Uint8Array }[]` written into the package folder (inside `tmp`, before the manifest's file list is built, so each gets its sha-256 in the manifest); `stitchPackageFiles(design, getArtifact: (sha: string) => Buffer): { path: string; content: Buffer }[]` in `src/stages/design-stitch.ts` returning `screens/<id>.html` for each normal frame, `screens/<id>-<state>.html` for each state frame, and `screens/DESIGN.md`; empty for a JSON design.
- Tokens: no change needed in `package.ts`; Task 1's `theme` + `themeSource: "new"` make `look` = `design`.

- [ ] **Step 1: Write the failing tests**: `stitchPackageFiles` for a design with S-1 (normal + empty) and S-2 gives `["screens/DESIGN.md", "screens/S-1.html", "screens/S-1-empty.html", "screens/S-2.html"]` with the stored contents; for a JSON design `[]`. If `writePackage` can run natively (check: it uses `factoryHome()` and `captureDemo`), add a test that a package with `extraFiles` lists them in `manifest.files`; otherwise rule it out in the ledger and rely on the pure test plus a WSL run.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**; in `design-export.ts` pass `extraFiles: stitchPackageFiles(design, (s) => ledger.getArtifact(s))`.
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Put each Stitch screen's HTML and the DESIGN.md in the design package`.

### Task 6: The coding agent gets the Stitch screen

**Files:** Modify `src/design/design-link.ts` (`screenBrief`), `src/stages/build.ts` (the implement pack, around the `approved-screen` section), tests in `src/design/stitch-facts.test.ts` (pure parts).

**Interfaces:**
- Produces: `stitchBriefHtml(html: string, maxBytes = 30_000): string` — removes `<script>…</script>`, `<link …>`, `<meta …>`, `data:` URIs inside attributes (replaced by `data:…`), collapses whitespace, and cuts at `maxBytes` with a final `<!-- cut: N more bytes -->`; `screenBrief` adds for a screen with `facts` and no `mock`: `stitch: { facts, note: STITCH_NOTE }` where `STITCH_NOTE` = "This screen was drawn by Google Stitch and approved as drawn. Rebuild it in this app's own stack, components and design tokens to look like the Stitch HTML that follows (layout, sections, order, words); do not paste its markup, Tailwind CDN script or inline styles into the app."; in `build.ts`, for each brief screen that has a Stitch normal frame, one `S.untrusted(\`stitch-html-${id}\`, "stitch", stitchBriefHtml(html))` section after the approved-screen section, at most 3 screens per task.
- JSON-track screens: `screenBrief` output unchanged.

- [ ] **Step 1: Write the failing tests**: `stitchBriefHtml` drops scripts, links, metas and data URIs, keeps classes and text, and caps a 100 KB input to at most 30 KB plus the cut note; `screenBrief` for a facts-only screen includes `stitch.facts` and `stitch.note`, and for a mock screen equals its old output (compare to a fixture built before the change).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**; the HTML is read with `ctx.ledger.getArtifact(sha)` from `approvedDesign.stitch.frames`.
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Brief the coding agent with each Stitch screen's facts and cleaned HTML`.

### Task 7: The fidelity check reads a Stitch screen's facts

**Files:** Modify `src/design/fidelity-app.ts` (`expectedFor`), add a test in `src/design/stitch-facts.test.ts`.

**Interfaces:**
- Produces: `expectedFor` for a screen with no `mock` and with `facts`: `page` = `[facts.title]` (when present), `blocks` = one block `{ type: "stitch", words: [...facts.buttons, ...facts.fields, ...facts.columns] }` in the normal state; empty/error/loading states as today (they read `mock?.copy` defaults). JSON screens unchanged.

- [ ] **Step 1: Write the failing test**: `expectedFor({ id: "S-1", route: "/a", reqs: [], states: [], facts: { title: "Payees", buttons: ["Add payee"], fields: ["IBAN"], columns: ["Name"], headings: [] } } as never, "default")` gives `{ page: ["Payees"], blocks: [{ type: "stitch", words: ["Add payee", "IBAN", "Name"] }] }`; a mock screen's result is unchanged.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement.** Check that `structureFindings` matches a block of type `stitch` by its words against the page's words (read it; if it requires a matching block type in `got`, match the `stitch` block against the whole page's words instead and say so in a comment).
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Hold the built app to the words each approved Stitch screen shows`.

### Task 8: The greenfield scaffold takes Stitch screens

**Files:** Modify `src/design/kit/scaffold.ts` (`ScaffoldScreen.stitch`, the `drawn` filter, the per-screen loop, the frame's titles, `protected`); test in `src/design/kit/kit.test.ts` (or a new `src/design/kit/stitch-scaffold.test.ts` that calls `scaffold()` the way `kit.test.ts` does).

**Interfaces:**
- Produces: `ScaffoldScreen.stitch?: true`; for a screen with `facts` and no `mock`: `drawn` includes it (same app rules); its title is `facts.title ?? s.id`; it gets the route file (Next `app/<route>/page.tsx`, Vite `design-routes.tsx` entry) and the navigation entry exactly as a JSON screen; it gets **no** `screen.tsx` and **no** `fixtures.ts` (`screen: ""`, `fixtures: ""` on its `ScaffoldScreen`); its `container.tsx` (owner `app`, `regenerate: false`) is a starting page:

```tsx
// S-1 Today's Appointments (/appointments): the approved Stitch page, built by the coding task in this file.
// Rebuild the approved Stitch screen here with the kit's components (components/ui, components/blocks) and the theme;
// match its layout, sections and words. Fixture mode (?fixture=S-1:<state>) must show the approved sample content in
// that state with no backend; the states the design drew: default, empty.
export function TodaySAppointmentsContainer({ fixture }: { fixture?: string }) {
  return (
    <main data-screen="S-1" data-state={fixture ?? "default"}>
      <h1>Today's Appointments</h1>
    </main>
  );
}
```

  (the `"use client"` line and imports follow the target exactly as for JSON screens; the component name is `pascal(title)` + `Container`, de-duplicated as today; the `<h1>` text is escaped for JSX.)
- `protected` filters out empty paths, so nothing of a Stitch screen is protected; the scaffold's `notes` gains `"drawn by Stitch, built by its coding task: S-1, S-2"`.
- JSON screens: every file byte for byte as before.

- [ ] **Step 1: Write the failing tests**: for a design with one JSON screen (mock) and one Stitch screen (facts, no mock, states `["empty"]`) on `next-shadcn`: the Stitch screen's `ScaffoldScreen` has `stitch: true`, `screen: ""`, `fixtures: ""`, a page file at `app/appointments/page.tsx`, and a `container.tsx` containing `data-screen="S-2"` and the title; no `components/screens/s-2/screen.tsx` or `fixtures.ts` is written; `protected` contains no `s-2` path; the navigation file lists the Stitch screen's title; the JSON screen's files equal those of a scaffold run on a design with only that screen (compare `files` filtered to `s-1`).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests and `src/design/kit/kit.test.ts` (natively where it can; `test:kit` E2E needs WSL — rule in the ledger) → PASS; tsc clean. **Commit:** `Scaffold Stitch screens in greenfield: route, navigation and a container the coding task fills`.

### Task 9: The greenfield coding task builds the Stitch page

**Files:** Modify `src/stages/build.ts` (the `scaffoldScreen` brief), test the pure template in `src/design/stitch-facts.test.ts` (export it from `src/design/design-link.ts` as `stitchScaffoldBrief`).

**Interfaces:**
- Produces: `stitchScaffoldBrief(s: ScaffoldScreen, states: string[]): string` — "This task builds ${id}'s page in ${container}: the approved Stitch screen. Rebuild it with the kit's components (components/ui, components/blocks) and the approved theme so it matches the Stitch HTML (layout, sections, order, words); do not paste the Stitch markup or its Tailwind CDN script. Load the real data, handle the page's actions, and keep fixture mode: ?fixture=${id}:<state> shows the approved sample content in that state with no backend, for ${states.join(", ")}. Server code, API clients and validation go in the other files of your scope." In `build.ts`, when `scaffoldScreen?.stitch`, use this template instead of the behaviour-only one (the Task 6 Stitch HTML section is added as for any Stitch screen).

- [ ] **Step 1: Write the failing test** for `stitchScaffoldBrief` (names the container, the fixture address and each state; says not to paste the markup).
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement**, wiring it in `build.ts` next to the existing `behaviour-only` section.
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Brief the greenfield coding task to build each Stitch page in its container, with fixture mode`.

### Task 10: Accessibility check on Stitch's HTML

**Files:** Create `src/design/stitch-a11y.ts`, `src/design/stitch-a11y.test.ts`; modify `src/stages/design-stitch.ts`, `src/stages/design-approve.ts` (card lines), `src/contracts/artifacts.ts` (`DesignBody.stitch.a11y`).

**Interfaces:**
- Produces: `a11yHtml(html: string): string` — the HTML with every `<script>…</script>`, `<link …>` and `on…=` attribute removed (untrusted code never runs on the factory host); `checkStitchA11y(pages: { id: string; html: string }[]): Promise<{ id: string; violations: A11yViolation[] }[] | undefined>` — opens each cleaned page in headless Chromium (`findChromium`, as `captureReports` does) with every network request aborted, injects axe-core (`loadAxe`, `runAxe`) with the rule `color-contrast` disabled (styles are gone with the scripts), and returns the violations; `undefined` when no Chromium or no axe (a note, never a failure); `themeContrast(theme: DesignTheme)` = the existing `a11yFit({ screens: [], theme })` from `src/stages/design.ts`, moved to `src/design/stitch-a11y.ts`'s caller unchanged.
- In `drawWithStitch` (and after a rework's edits): run `checkStitchA11y` on the normal frames; for each screen with violations, one `edit` with the prompt "Fix these accessibility problems and change nothing else: <rule id: selectors>, …"; check again; what still fails is stored as `stitch.a11y: { screen: string; rules: string[] }[]` and listed on the approval card under "Accessibility, still open" (the card does not block approval). Theme contrast problems from `a11yFit` on the mapped theme go the same way as the JSON track's: a failure fed back to the DESIGN.md writer (before any Stitch call).

- [ ] **Step 1: Write the failing tests**: `a11yHtml` removes scripts, links and `onclick`, and keeps the rest; `checkStitchA11y` (skipped with `it.skipIf(!findChromium())`) finds `button-name` on `<button></button>` and `label` on `<input>` without a label, and finds nothing on a clean page; with no Chromium it resolves `undefined`; in `design-stitch.test.ts`, with `checkStitchA11y` replaced through a test seam (`setA11yCheck`), a screen with violations gets one fix `edit`, and a violation that stays is in `stitch.a11y`; a mapped theme whose brand colour fails contrast makes the step fail with `design-a11y` before any Stitch call.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; tsc clean. **Commit:** `Check Stitch screens for accessibility, fix them once with Stitch, and show what stays open`.

### Task 11: Live check

- [ ] **Step 1:** Extend the scratch live script (not in the repo) to: draw two screens with one extra state, then run a rework that names one screen, then build the package files, one coding brief, and a greenfield scaffold (`next-shadcn`) from the result. Run it with `STITCH_API_KEY` from the environment. Record in the ledger: calls made, seconds, frame names, the facts read from real Stitch HTML, the brief's HTML size.
- [ ] **Step 2:** Fix anything the live run shows, each with a failing test first.
