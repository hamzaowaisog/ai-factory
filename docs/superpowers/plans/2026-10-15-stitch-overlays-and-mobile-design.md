# Stitch Overlays and Mobile Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Stitch track, popups (modal, side panel, bottom sheet, confirm) are drawn on their page instead of becoming pages, the planner stops inventing screens, and a person chooses per run whether phone-width drawings are made.

**Architecture:** (1) The Stitch screen list (`StitchPlan`) gains `overlays` per screen; the planner rules forbid a screen for a popup; `stitchJobs` draws each overlay once as a frame of its page with state `overlay-<n>`. (2) The design artifact keeps each Stitch screen's overlays, and the demo, package pictures, scaffold and estimate read them through one helper (`frameStateOf`) and the existing `overlayLabel`. (3) A run setting `mobileDesign` (saved in `run.created`) beats the project's `design.stitch.phone`; it is set from the CLI (`--mobile-design`) or the web form (a select beside "planned by").

**Tech Stack:** TypeScript ESM, zod, vitest, commander, the plain-JS web UI in `src/ui/static/app.js`.

**Spec:** `docs/superpowers/specs/2026-10-15-stitch-overlays-and-mobile-design.md`

## Global Constraints

- JSON-track designs are unchanged: every new branch is taken only for a screen with a top-level `overlays` (Stitch screens) or a run whose design engine is Stitch or pages.
- Overlay frame state is exactly `overlay-1`, `overlay-2`, `overlay-3` (filesystem-safe: it becomes `screens/S-1-overlay-1.html` in the package).
- At most 3 overlays per screen (same limit as the JSON track).
- An overlay gets no empty, error or phone drawing of its own.
- Order of the phone setting: run `mobileDesign` → project `design.stitch.phone` → `true`.
- Commit messages carry no `Co-Authored-By` line (the user's global rule).
- Run `npm run typecheck` and the named vitest files after each task; `npm test` at the end.

## Review Focus

- A Stitch plan whose screen has two overlays with the same title: refused by the plan check (duplicate demo tabs otherwise). Test in Task 1.
- A design stored before this change (screens with no `overlays`, frames with no `overlay-*` state) still builds its demo, package and estimate exactly as before. Test in Task 2.
- A send-back that patches a screen with overlays keeps them and redraws them. Test in Task 2.
- `mobileDesign: false` on the run while the project says `phone: true`: no MOBILE drawing. And the reverse. Test in Task 3.
- A web start with `mobileDesign: "yes"` (not a boolean) is refused with a clear message. Test in Task 3.

---

### Task 1: Planner rules and drawing overlays

**Files:**
- Modify: `src/design/demo.ts` (add `overlayFrameState` next to `overlayLabel`, ~line 79)
- Modify: `src/stages/design-stitch.ts` (`StitchPlan` ~line 36, `STITCH_PLAN_RULES` ~line 51-69, `stitchJobs` ~line 119, `planFaults` ~line 257)
- Test: `src/stages/design-stitch.test.ts`

**Interfaces:**
- Produces: `overlayFrameState(i: number): string` in `src/design/demo.ts` → `"overlay-1"` for `i = 0`.
- Produces: `StitchPlan.screens[].overlays: { kind: "modal" | "drawer" | "sheet" | "confirm"; title: string; trigger: string; content: string }[]` (default `[]`, max 3).
- Produces: `stitchJobs` emits, per screen, in order: `normal`, its allowed states, one job per overlay (`state: overlayFrameState(i)`), then `phone`.

- [ ] **Step 1: Write the failing tests**

In `src/stages/design-stitch.test.ts`, add this fixture right below `const plan = ...` (Task 2's tests use it too):

```ts
const withOverlays = () => plan({ screens: [{ ...plan().screens[0], states: ["empty"], phone: true, overlays: [
  { kind: "modal", title: "Add payee", trigger: "Add payee", content: "Name, bank and IBAN fields; Save payee and Cancel." },
  { kind: "confirm", title: "Delete payee", trigger: "Delete", content: "Says the payee and their history are removed for good." },
] }, plan().screens[1]] });
```

Then add a new `describe("overlays", ...)` block after `describe("extra states", ...)`:

```ts
describe("overlays", () => {

  it("draws each overlay once as a frame of its page, after its states and before its phone drawing", () => {
    const jobs = stitchJobs(withOverlays().screens as never, ["empty"], undefined, true);
    expect(jobs.filter((j) => j.id === "S-1").map((j) => j.state)).toEqual(["normal", "empty", "overlay-1", "overlay-2", "phone"]);
    const modal = jobs.find((j) => j.state === "overlay-1")!;
    expect(modal.prompt).toContain('the dialog "Add payee" open over it, as the "Add payee" control opens it');
    expect(modal.prompt).toContain("It holds: Name, bank and IBAN fields; Save payee and Cancel.");
    expect(modal.prompt).toContain("Keep the layout, navigation and header of the page behind identical to the normal page.");
    expect(jobs.find((j) => j.state === "overlay-2")!.prompt).toContain('the confirmation dialog "Delete payee"');
    // an overlay has no state or phone drawing of its own
    expect(jobs.filter((j) => j.state.startsWith("overlay-"))).toHaveLength(2);
  });

  it("tells the screen list to keep popups on their page and not to invent screens", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    const listCall = systems[0] + users[0];
    expect(listCall).toContain("Do not invent screens the requirements do not need.");
    expect(listCall).toContain('"overlays" lists what opens over this page instead of a page of its own');
    expect(listCall).not.toContain("(sign in, a confirmation, a message that access is refused)");
  });

  it("refuses a screen list with two overlays of the same title on one page", async () => {
    const o = { kind: "modal", title: "Add payee", trigger: "Add payee", content: "Name, bank and IBAN fields; Save payee and Cancel." };
    answers = [plan({ screens: [{ ...plan().screens[0], overlays: [o, { ...o, trigger: "New payee" }] }, plan().screens[1]] })];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "design-duplicate-overlay" })] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stages/design-stitch.test.ts -t overlays`
Expected: FAIL (no overlay jobs; rule text missing; no `design-duplicate-overlay`).

- [ ] **Step 3: Add `overlayFrameState` to `src/design/demo.ts`**

Directly below the `overlayLabel` line:

```ts
/** The frame state of a Stitch screen's i-th overlay, drawn as its page with the layer open: "overlay-1". */
export const overlayFrameState = (i: number): string => `overlay-${i + 1}`;
```

- [ ] **Step 4: Extend `StitchPlan` in `src/stages/design-stitch.ts`**

In the `screens` object, after `shell: z.string().optional(), phone: z.boolean().optional(),` add:

```ts
    /** what opens over this page instead of a page of its own: each drawn once, as the page with it open */
    overlays: z.array(z.object({
      kind: z.enum(["modal", "drawer", "sheet", "confirm"]), title: z.string().min(1).max(60), trigger: z.string().min(1), content: z.string().min(10),
    })).max(3).default([]),
```

- [ ] **Step 5: Change `STITCH_PLAN_RULES`**

Replace the second line of the rules:

```ts
- One screen per page a user sees: ids S-1, S-2, ..., each with its route, a proposed file path and the requirement ids it serves in "reqs".
```

with:

```ts
- One screen per page a user sees: ids S-1, S-2, ..., each with its route, a proposed file path and the requirement ids it serves in "reqs". Do not invent screens the requirements do not need.
- "overlays" lists what opens over this page instead of a page of its own, three at most: kind "modal" (a short form or record, such as Add payee), "drawer" (a side panel with a record's details or filters), "sheet" (a bottom sheet on a phone) or "confirm" (a yes-or-no before a step that deletes, cancels, pays or cannot be undone); its "title"; its "trigger", the exact words on the control on this page that opens it; and its "content", what it holds (its fields and buttons, the record's facts, or what the step does). One of these is never a screen of its own and never in "links". A page with an address of its own (a booking's confirmation page, a record's page) stays a screen. A message that an action worked is a line on the page it happened on, not a screen, unless the requirements give it a page.
```

In the `"taste"` line, replace `(sign in, a confirmation, a message that access is refused)` with `(sign in, a message that access is refused)`.

- [ ] **Step 6: Draw overlays in `stitchJobs`**

Change the import from `../design/demo.js` to `import { buildDemo, frameDataUri, overlayFrameState, stateKind } from "../design/demo.js";`

Above `export function stitchJobs`, add:

```ts
/** How each overlay is named and placed in its drawing. */
const OVERLAY_WORD: Record<string, string> = { modal: "dialog", drawer: "side panel", sheet: "bottom sheet", confirm: "confirmation dialog" };
const OVERLAY_PLACE: Record<string, string> = {
  modal: "Centre it over the page, which is dimmed behind it.",
  drawer: "It comes in from the right edge, full height, over the dimmed page.",
  sheet: "It rises from the bottom edge over the dimmed page.",
  confirm: "A small dialog centred over the dimmed page: what will happen in one sentence, the action's button and Cancel.",
};
```

In `stitchJobs`, between the `...kinds.map(...)` line and the `...(narrow.has(s.id) ...` line, add:

```ts
      ...(s.overlays ?? []).map((o, i) => ({ id: s.id, state: overlayFrameState(i), prompt: `${s.prompt}${names}\nShow this same page with the ${OVERLAY_WORD[o.kind] ?? "dialog"} "${o.title.trim()}" open over it, as the "${o.trigger.trim()}" control opens it. It holds: ${o.content.trim()} ${OVERLAY_PLACE[o.kind] ?? OVERLAY_PLACE.modal} Keep the layout, navigation and header of the page behind identical to the normal page.${ONE_STATE}${FOLLOW}` })),
```

Update the doc comment above `stitchJobs` to: `/** What to draw: each screen's normal page, each state it lists that the project allows (once per kind), each overlay open over it, then its phone drawing. */`

- [ ] **Step 7: Refuse duplicate overlay titles in `planFaults`**

Inside the returned array of `planFaults`, after the `design-duplicate-route` line, add:

```ts
    ...p.screens.flatMap((s) => dup((s.overlays ?? []).map((o) => o.title.trim().toLowerCase())).map((x) => failure("design-duplicate-overlay", `${s.id} has two overlays titled "${x}"; give each its own title or drop one`))),
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/stages/design-stitch.test.ts`
Expected: PASS (all, including the existing phone and states tests).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/design/demo.ts src/stages/design-stitch.ts src/stages/design-stitch.test.ts
git commit -m "Stitch: popups are drawn on their page, and the screen list invents no screens"
```

---

### Task 2: Carry overlays through the design, demo, package, scaffold and estimate

**Files:**
- Modify: `src/contracts/artifacts.ts` (`DesignBody.screens`, ~line 486)
- Modify: `src/stages/design-stitch.ts` (`stitchArtifact` ~line 278, `stitchDraftPreview` ~line 341, `reworkStitch` ~line 396)
- Modify: `src/design/demo.ts` (`demoStates` ~line 69, new `frameStateOf`, `statePane` ~line 1791)
- Modify: `src/design/package.ts` (`ownShots` ~line 296)
- Modify: `src/design/kit/scaffold.ts` (`screenStates` ~line 98)
- Modify: `src/estimate/ui-complexity.ts` (`screenUi` ~line 77, `designUi` ~line 116)
- Test: `src/stages/design-stitch.test.ts`, `src/design/demo.test.ts`, `src/design/kit/stitch-scaffold.test.ts`, `src/estimate/ui-complexity.test.ts`

**Interfaces:**
- Consumes: `overlayFrameState(i)` (Task 1), `overlayLabel(o)` (existing, `src/design/demo.ts`).
- Produces: `DesignBody.screens[].overlays?: { kind: string; title: string; trigger: string; content?: string }[]`.
- Produces: `frameStateOf(s: { overlays?: { kind: string; title: string }[] }, tab: string, k: number): string` in `src/design/demo.ts`: `"normal"` for `k === 0`, `"phone"` for the Phone tab, `overlay-<n>` for an overlay's tab, otherwise `stateKind(tab)`.

- [ ] **Step 1: Write the failing tests**

In `src/stages/design-stitch.test.ts`, add inside `describe("overlays", ...)`:

```ts
  it("keeps each screen's overlays in the design, with their frames after its states", async () => {
    answers = [withOverlays(), { designMd: md(), theme }];
    const ledger = memoryLedger();
    const out = await drawWithStitch(ctxFor(ledger, 0, { stitch: { phone: false } }), spec);
    const d = ledger.getJson<{ screens: { id: string; frames: string[]; overlays?: { kind: string; title: string; trigger: string }[] }[]; stitch: { frames: Record<string, { state: string }> } }>((out as { outputs: { design: string } }).outputs.design);
    const s1 = d.screens.find((s) => s.id === "S-1")!;
    expect(s1.frames.map((f) => d.stitch.frames[f]!.state)).toEqual(["normal", "empty", "overlay-1", "overlay-2"]);
    expect(s1.overlays).toEqual([
      { kind: "modal", title: "Add payee", trigger: "Add payee", content: "Name, bank and IBAN fields; Save payee and Cancel." },
      { kind: "confirm", title: "Delete payee", trigger: "Delete", content: "Says the payee and their history are removed for good." },
    ]);
    expect(d.screens.find((s) => s.id === "S-2")!.overlays).toBeUndefined();
  });
```

In the existing `describe("rework of a Stitch design", ...)`, add a test (it uses the block's `first` helper pattern; the triage answer names S-1):

```ts
  it("keeps a patched screen's overlays and draws them again", async () => {
    const ledger = memoryLedger();
    answers = [withOverlays(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger, 0, { stitch: { phone: false } }), spec);
    const prev = ledger.getJson((out as { outputs: { design: string } }).outputs.design);
    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    answers = [{ redraw: false, screens: [{ id: "S-1", change: "Make the IBAN column wider." }] }];
    const again = await drawWithStitch(ctxFor(ledger, 0, { stitch: { phone: false } }), spec, { previous: prev as never, feedback: ["The IBAN column is too narrow."] });
    const d = ledger.getJson<{ screens: { id: string; overlays?: unknown[] }[] }>((again as { outputs: { design: string } }).outputs.design);
    expect(d.screens.find((s) => s.id === "S-1")!.overlays).toHaveLength(2);
    expect(made.generated.filter((g) => g.prompt.includes("open over it"))).toHaveLength(2);
  });
```

In `src/design/demo.test.ts`, add:

```ts
describe("a Stitch screen's overlays on the demo", () => {
  it("gives each overlay its own tab with its own picture, and leaves a screen with none as it was", async () => {
    const { buildDemo, demoStates, frameDataUri, frameStateOf } = await import("./demo.js");
    const pic = (n: number) => frameDataUri("x.png", Buffer.from(`89504e470d0a1a0a0000000d494844${n}${n}`, "hex"), 0)!;
    const s = { id: "S-1", route: "/payees", file: "app/payees/page.tsx", reqs: ["REQ-1"], states: [], size: "new" as const, frames: ["ST-1", "ST-2"], overlays: [{ kind: "modal", title: "Add payee", trigger: "Add payee" }] };
    expect(demoStates(s)).toEqual(["default", "Dialog: Add payee"]);
    expect(frameStateOf(s, "Dialog: Add payee", 1)).toBe("overlay-1");
    expect(frameStateOf(s, "Phone", 2)).toBe("phone");
    expect(frameStateOf(s, "empty", 1)).toBe("empty");
    expect(frameStateOf(s, "default", 0)).toBe("normal");
    const html = buildDemo({
      title: "Payees", flow: "Payees", requirements: { "REQ-1": "The system shall list payees." }, noScreen: [], screens: [s],
      frames: { "ST-1": { name: "a.png", state: "normal", dataUri: pic(5) }, "ST-2": { name: "b.png", state: "overlay-1", dataUri: pic(6) } },
    });
    expect(html).toContain("Dialog: Add payee");
    expect(html).toContain(pic(6));
    // a Stitch screen stored before overlays: its states as before
    expect(demoStates({ ...s, overlays: undefined })).toEqual(["default"]);
  });
});
```

In `src/design/kit/stitch-scaffold.test.ts`, add:

```ts
describe("a Stitch screen's overlays in the scaffold", () => {
  it("lists each overlay as a state of its screen", async () => {
    const { screenStates } = await import("./scaffold.js");
    const st = screenStates(DesignBody.parse({ ...sampleDesign(), screens: [{ id: "S-9", route: "/payees", file: "app/payees/page.tsx", reqs: ["R-9"], frames: ["ST-1", "ST-2"], overlays: [{ kind: "confirm", title: "Delete payee", trigger: "Delete" }], facts }] }).screens[0]!);
    expect(Object.values(st).find((v) => v.name === "Confirm: Delete payee")).toMatchObject({ overlay: 0 });
  });
});
```

In `src/estimate/ui-complexity.test.ts`, add:

```ts
  it("sizes a Stitch screen's overlays as parts of its page", () => {
    const facts = { title: "Payees", buttons: [], fields: [], columns: [], headings: [], ui: [[3, "a table"]] as [number, string][] };
    expect(screenUi({ facts, overlays: [{ kind: "modal" }, { kind: "confirm" }] })).toMatchObject({ points: 7, drivers: ["2 overlays (modal, confirm)", "a table"] });
    expect(screenUi({ facts })).toMatchObject({ points: 3 });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stages/design-stitch.test.ts src/design/demo.test.ts src/design/kit/stitch-scaffold.test.ts src/estimate/ui-complexity.test.ts`
Expected: FAIL (no `overlays` on the design screen; `frameStateOf` not exported; overlay state not listed; overlays unsized).

- [ ] **Step 3: Add `overlays` to the design contract**

In `src/contracts/artifacts.ts`, inside `DesignBody.screens`' object, after the `change` field:

```ts
    /** a Stitch screen: what opens over it (each drawn as a frame of the screen, state overlay-<n>); a JSON screen's overlays are in its mock */
    overlays: z.array(z.object({ kind: z.string(), title: z.string(), trigger: z.string(), content: z.string().optional() })).optional(),
```

- [ ] **Step 4: Keep overlays in `stitchArtifact`, the draft preview and the rework**

In `stitchArtifact`, change the `rank` function to:

```ts
    const rank = (a: StitchAsset) => (a.state === "normal" ? -1
      : a.state.startsWith("overlay-") ? s.states.length + Number(a.state.slice(8)) - 1
      : a.state === PHONE_STATE ? s.states.length + (s.overlays?.length ?? 0) : s.states.findIndex((x) => stateKind(x) === a.state));
```

and in its `screens: p.screens.map(...)` return object, append after `...(facts ? { facts } : {})`:

```ts
, ...(s.overlays?.length ? { overlays: s.overlays.map(({ kind, title, trigger, content }) => ({ kind, title, trigger, content })) } : {})
```

In `stitchDraftPreview`, in the `buildDemo({ screens: plan.screens.map(...) })` object, append the same `...(s.overlays?.length ? { overlays: s.overlays.map(({ kind, title, trigger }) => ({ kind, title, trigger })) } : {})`.

In `reworkStitch`, in the `screens: prev.screens.map((s) => ({ ... }))` that rebuilds the plan, add after `links: ...`:

```ts
 overlays: (s.overlays ?? []).map((o) => ({ kind: o.kind as "modal" | "drawer" | "sheet" | "confirm", title: o.title, trigger: o.trigger, content: o.content ?? o.title })),
```

(`content` falls back to the title only for a design stored before this change, which has no overlays anyway.)

- [ ] **Step 5: Show overlays on the demo**

In `src/design/demo.ts`, change `demoStates`' parameter type to add `overlays?: { kind: string; title: string }[]` and its frames branch to:

```ts
  if (s.frames?.length) return [...own, ...(s.overlays ?? []).map(overlayLabel)];
```

Below `overlayFrameState`, add:

```ts
/** The frame state a demo tab of a Stitch screen shows: the page, its phone drawing, an overlay open over it, or a state. */
export function frameStateOf(s: { overlays?: { kind: string; title: string }[] }, tab: string, k: number): string {
  if (k === 0) return "normal";
  if (tab === PHONE_TAB) return "phone";
  const i = (s.overlays ?? []).findIndex((o) => overlayLabel(o) === tab);
  return i >= 0 ? overlayFrameState(i) : stateKind(tab);
}
```

In `statePane` (inside the Stitch branch of the demo builder), replace

```ts
      const kind = k === 0 ? "normal" : st === PHONE_TAB ? "phone" : stateKind(st);
```

with

```ts
      const kind = frameStateOf(s, st, k);
```

- [ ] **Step 6: Package pictures and scaffold states**

In `src/design/package.ts` `ownShots`, replace `x.kind === (k === 0 ? "normal" : stateKind(st))` with `x.kind === frameStateOf(s as never, st, k)` and import `frameStateOf` from `./demo.js` (drop `stateKind` from that import if nothing else in the file uses it; check with a search first).

In `src/design/kit/scaffold.ts` `screenStates`, replace

```ts
  const overlays = (s.mock?.overlays ?? []).map(overlayLabel), toasts = (s.mock?.toasts ?? []).map(toastLabel);
```

with

```ts
  const overlays = (s.mock?.overlays ?? s.overlays ?? []).map(overlayLabel), toasts = (s.mock?.toasts ?? []).map(toastLabel);
```

- [ ] **Step 7: Size overlays in the estimate**

In `src/estimate/ui-complexity.ts` `screenUi`, add `overlays?: { kind: string }[]` to the parameter type and, right after `if (counted) parts.push(...counted);`, add:

```ts
  // a Stitch screen's overlays: drawn as frames of their own, not in the page's HTML, so counted here as the JSON track counts them
  const sov = !m ? s.overlays ?? [] : [];
  if (sov.length) parts.push([sov.length * 2, `${plural(sov.length, "overlay")} (${sov.map((o) => o.kind).join(", ")})`]);
```

In `designUi`, add `overlays?: { kind: string }[]` to the `screens` element type.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/stages/design-stitch.test.ts src/design/demo.test.ts src/design/kit/stitch-scaffold.test.ts src/estimate/ui-complexity.test.ts src/design/package.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/contracts/artifacts.ts src/stages/design-stitch.ts src/stages/design-stitch.test.ts src/design/demo.ts src/design/demo.test.ts src/design/package.ts src/design/kit/scaffold.ts src/design/kit/stitch-scaffold.test.ts src/estimate/ui-complexity.ts src/estimate/ui-complexity.test.ts
git commit -m "Stitch overlays: kept in the design, shown as demo tabs, pictured, scaffolded and sized"
```

---

### Task 3: Mobile design chosen per run (run setting, CLI, web form, docs)

**Files:**
- Modify: `src/ledger/state.ts` (`RunInfo`, beside `uiTarget` ~line 101)
- Modify: `src/stages/executor.ts` (`createRun` opts ~line 94 and `run.created` data ~line 160)
- Modify: `src/stages/design-stitch.ts` (new `phoneViews`, used at ~line 575)
- Modify: `src/cli/models.ts` (new `MOBILE_DESIGN_HELP`, `mobileDesignOption`)
- Modify: `src/cli/index.ts` (`start` ~line 81 and `estimate` ~line 146 commands), `src/cli/design-runs.ts` (`design start` ~line 86)
- Modify: `src/ui/start.ts` (input ~line 75, parse ~line 230, `createRun` ~line 341)
- Modify: `src/ui/data.ts` (`ProjectRow`, `projectsView`)
- Modify: `src/ui/static/app.js` (`modelPicker` ~line 2546, `requestScreen` ~line 351 and ~line 567, full-stack picker ~line 2610)
- Modify: `docs/project-example.yaml` (stitch block), `docs/model-choice.md` (Stitch paragraph)
- Test: `src/stages/design-stitch.test.ts`, `src/cli/models.test.ts` (create), `src/ui/ui.test.ts`

**Interfaces:**
- Produces: `RunInfo.mobileDesign?: boolean`; `createRun(..., { mobileDesign?: boolean })`.
- Produces: `phoneViews(ctx: Pick<StepContext, "state" | "project">): boolean` in `src/stages/design-stitch.ts`.
- Produces: `mobileDesignOption(v: string | undefined): boolean | undefined` in `src/cli/models.ts`; throws on anything but `true`/`false`.
- Produces: `/api/projects` rows carry `mobileDesign: boolean`; `POST /api/runs` takes `mobileDesign?: boolean`.

- [ ] **Step 1: Write the failing tests**

In `src/stages/design-stitch.test.ts`, add to the phone test's `describe` (or a new `describe("mobile design per run", ...)`):

```ts
describe("mobile design per run", () => {
  const withRun = (ctx: StepContext, mobileDesign: boolean): StepContext => ({ ...ctx, state: replay([{ ...(CREATED as object), data: { ...(CREATED as { data: object }).data, mobileDesign } } as never]) });
  const phones = () => plan({ screens: plan().screens.map((x) => ({ ...x, phone: true, states: [] })) });

  it("the run's choice beats the project's", async () => {
    answers = [phones(), { designMd: md(), theme }];
    await drawWithStitch(withRun(ctxFor(memoryLedger(), 0, { stitch: { phone: true } }), false), spec);
    expect(made.generated.map((g) => g.device)).toEqual(["DESKTOP", "DESKTOP"]);

    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    answers = [phones(), { designMd: md(), theme }];
    await drawWithStitch(withRun(ctxFor(memoryLedger(), 0, { stitch: { phone: false } }), true), spec);
    expect(made.generated.map((g) => g.device).sort()).toEqual(["DESKTOP", "DESKTOP", "MOBILE", "MOBILE"]);
  });

  it("follows the project, then on, when the run says nothing", async () => {
    const { phoneViews } = await import("./design-stitch.js");
    expect(phoneViews(ctxFor(memoryLedger()))).toBe(true);
    expect(phoneViews(ctxFor(memoryLedger(), 0, { stitch: { phone: false } }))).toBe(false);
    expect(phoneViews(withRun(ctxFor(memoryLedger(), 0, { stitch: { phone: false } }), true))).toBe(true);
  });
});
```

Create `src/cli/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mobileDesignOption } from "./models.js";

describe("--mobile-design", () => {
  it("takes true or false, and nothing else", () => {
    expect(mobileDesignOption(undefined)).toBeUndefined();
    expect(mobileDesignOption("true")).toBe(true);
    expect(mobileDesignOption("FALSE")).toBe(false);
    expect(() => mobileDesignOption("yes")).toThrow(/--mobile-design takes true or false, not "yes"/);
  });
});
```

In `src/ui/ui.test.ts`, next to the `uiTarget` start test (~line 1641), add:

```ts
  it("a run started from the UI can choose mobile design, and the projects list says each project's setting", async () => {
    _resetStarting();
    expect(((await call("/api/projects")).json().projects as { name: string; mobileDesign: boolean }[]).find((p) => p.name === "web")!.mobileDesign).toBe(true);
    const b = await post({ project: "web", prompt: "Add an orders page", mobileDesign: false });
    expect(b.status).toBe(201);
    expect(replay(Ledger.open(b.json().runId).events()).info.mobileDesign).toBe(false);
    _resetStarting();
    expect((await post({ project: "web", prompt: "x", mobileDesign: "yes" })).json().error).toMatch(/Mobile design is true or false/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stages/design-stitch.test.ts src/cli/models.test.ts src/ui/ui.test.ts -t "mobile"`
Expected: FAIL (`phoneViews`, `mobileDesignOption` not exported; `mobileDesign` not stored or listed).

- [ ] **Step 3: The run setting**

In `src/ledger/state.ts` `RunInfo`, after `uiTarget?`:

```ts
  /** `--mobile-design` or the start form: whether a Stitch or pages design draws its main pages at phone width too; over the project's design.stitch.phone. Set at the start, so a run keeps what it began with */
  mobileDesign?: boolean;
```

In `src/stages/executor.ts` `createRun`, add `mobileDesign?: boolean;` to `opts` (after `uiTarget?: RunInfo["uiTarget"];`) and in the `run.created` data, after the `uiTarget` line:

```ts
      ...(opts.mobileDesign !== undefined ? { mobileDesign: opts.mobileDesign } : {}),
```

- [ ] **Step 4: The design step reads it**

In `src/stages/design-stitch.ts`, above `drawWithStitch`, add:

```ts
/** Whether a design drawn for a wide screen draws its main pages at phone width too: the run's choice, then the project's, then on. */
export function phoneViews(ctx: Pick<StepContext, "state" | "project">): boolean {
  return ctx.state.info.mobileDesign ?? ctx.project.design?.stitch?.phone ?? true;
}
```

Replace

```ts
  const jobs = stitchJobs(plan.screens, allowed, out.motion, device === "DESKTOP" && (ctx.project.design?.stitch?.phone ?? true));
```

with

```ts
  const jobs = stitchJobs(plan.screens, allowed, out.motion, device === "DESKTOP" && phoneViews(ctx));
```

and change the comment above it to `// a design drawn for a wide screen shows its most used pages at phone width too, unless the run or the project says no`.

- [ ] **Step 5: The CLI option**

In `src/cli/models.ts`, after `PRESET_HELP`:

```ts
export const MOBILE_DESIGN_HELP = "true or false: whether a Google Stitch design draws its main pages (five at most) at phone width too; over the project's design.stitch.phone (default true)";
/** `--mobile-design`: true, false, or not given. */
export function mobileDesignOption(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const t = v.trim().toLowerCase();
  if (t === "true" || t === "false") return t === "true";
  throw new Error(`--mobile-design takes true or false, not "${v}"`);
}
```

In each of the three run-starting commands (`src/cli/index.ts` `start` at ~line 81 and `estimate` at ~line 146, `src/cli/design-runs.ts` `design start` at ~line 86):
1. import `MOBILE_DESIGN_HELP, mobileDesignOption` beside `PRESET_HELP`;
2. add `.option("--mobile-design <true|false>", MOBILE_DESIGN_HELP)` right after the `--preset` option;
3. add `mobileDesign?: string` to the action's `o` type;
4. at the top of the action, beside the other option parsing, `const mobileDesign = mobileDesignOption(o.mobileDesign);`
5. in that command's `createRun(...)` options object, add `...(mobileDesign !== undefined ? { mobileDesign } : {}),`.

- [ ] **Step 6: The web start and the projects list**

In `src/ui/start.ts`, add to the input interface after `uiTarget?: unknown;`:

```ts
  /** whether a Stitch design draws its main pages at phone width too, like --mobile-design; over the project's design.stitch.phone */
  mobileDesign?: unknown;
```

After the `uiTarget` parsing block:

```ts
  if (input.mobileDesign !== undefined && input.mobileDesign !== null && typeof input.mobileDesign !== "boolean") throw new StartError("Mobile design is true or false.");
  const mobileDesign = typeof input.mobileDesign === "boolean" ? input.mobileDesign : undefined;
```

In the `createRun(...)` options, after `...(uiTarget ? { uiTarget } : {}),`:

```ts
    ...(mobileDesign !== undefined ? { mobileDesign } : {}),
```

In `src/ui/data.ts`, change `ProjectRow` to `{ name: string; busy?: { runId: string }; empty?: true; mobileDesign: boolean }` and in `projectsView`'s loop:

```ts
    let empty = false, mobileDesign = true;
    try { const p = loadProject(name); empty = p.stack === "node" && repoIsEmpty(p.repo, p.baseBranch); mobileDesign = p.design?.stitch?.phone ?? true; } catch { /* a broken config is listed as it is */ }
    projects.push({ name, mobileDesign, ...(busy ? { busy } : {}), ...(empty ? { empty: true as const } : {}) });
```

- [ ] **Step 7: The select in the form**

In `src/ui/static/app.js` `modelPicker(catalogue, id, also = "", mobile = true)` (add the 4th parameter):

After the `plannerLabel` line add:

```js
    // a design engine draws at phone width too unless the run says no: shown beside the planner, starting at the project's setting
    const mobileSel = s.engines?.length && mobile ? h("select", { "aria-label": "Mobile design", hidden: true }, h("option", { value: "true" }, "Yes"), h("option", { value: "false" }, "No")) : null;
    const mobileLabel = mobileSel ? h("span", { class: "faint small", hidden: true }, " mobile design ") : null;
```

Add `mobileLabel, mobileSel` to the row's cell right after `plannerLabel, planner`. In `sync`, inside `if (planner) { ... }`, add `if (mobileSel) mobileSel.hidden = mobileLabel.hidden = !engine;`. Return `mobileSel` from the row object (`return { step: s.step, pick, sync, row, on, moved, value, mobileSel };`).

Before `const picked = () => {`, add:

```js
  let mobileDefault = true;
  const setMobileDefault = (on) => { mobileDefault = on; for (const r of rows) if (r.mobileSel) r.mobileSel.value = String(on); };
  setMobileDefault(true);
```

Change `picked` to add the choice only when a design engine is picked and the select is off the project's setting:

```js
  const picked = () => {
    const picks = Object.fromEntries(rows.filter((r) => r.pick?.value).map((r) => [r.step, r.value()]));
    const m = rows.find((r) => r.mobileSel && !r.mobileSel.hidden)?.mobileSel;
    const mobile = m && m.value !== String(mobileDefault) ? { mobileDesign: m.value === "true" } : {};
    return { ...(preset.value || Object.keys(picks).length ? { models: { ...(preset.value ? { preset: preset.value } : {}), ...(Object.keys(picks).length ? { picks } : {}) } } : {}), ...mobile };
  };
```

and return `setMobileDefault` from `modelPicker` (`return { preset, table: ..., hint, picked, setMobileDefault };`).

In `requestScreen`, after `const modelPreset = picker.preset, ...` add:

```js
  const syncMobile = () => picker.setMobileDefault(meta.projects.find((p) => p.name === project.value)?.mobileDesign ?? true);
  project.addEventListener("change", syncMobile);
  syncMobile();
```

The full-stack form's picker (~line 2610) passes `false` as the 4th argument: `modelPicker(catalogue, "fs-models", "With the API, the API run uses the same choice. ", false)`.

- [ ] **Step 8: Docs**

In `docs/project-example.yaml`, in the `stitch:` block after the `states:` line:

```yaml
#     phone: true                    # also draw the main pages (five at most) at phone width; each is one more call. A run's
#                                    # --mobile-design or the start form's "mobile design" wins over it
```

In `docs/model-choice.md`, at the end of the Google Stitch paragraph (line ~121), add: `Beside the planner, "mobile design" (Yes / No, or --mobile-design true|false) says whether the main pages are drawn at phone width too; it starts at the project's design.stitch.phone.`

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/stages/design-stitch.test.ts src/cli/models.test.ts src/ui/ui.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/ledger/state.ts src/stages/executor.ts src/stages/design-stitch.ts src/stages/design-stitch.test.ts src/cli/models.ts src/cli/models.test.ts src/cli/index.ts src/cli/design-runs.ts src/ui/start.ts src/ui/data.ts src/ui/static/app.js src/ui/ui.test.ts docs/project-example.yaml docs/model-choice.md
git commit -m "Mobile design is chosen per run: --mobile-design and the start form, over the project's stitch.phone"
```

---

### Task 4: Whole-suite check and a look at the form

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm test`
Expected: all pass. If a test elsewhere asserted the old Stitch rules text or `ProjectRow` shape, update it to the new text/shape and say so in the commit.

- [ ] **Step 2: See the form**

Start the web UI (`npm run factory -- ui`), open New design, pick Google Stitch on the design row: "planned by" and "mobile design" appear; "mobile design" starts at the chosen project's setting and switches to the other project's when the project changes. Pick a model instead of Stitch: both hide.

- [ ] **Step 3: Commit any fixes from Steps 1-2**

```bash
git add -A
git commit -m "Stitch overlays and mobile design: fixes from the full test run"
```
