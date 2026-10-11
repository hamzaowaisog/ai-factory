# Design Tier Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The design step picks its model from a locked engine (`claude` / `openai` / `stitch`) and tier (`light` / `standard` / `heavy`) in the project config, steps up one tier after two failed attempts, and never swaps a chosen engine for another vendor silently.

**Architecture:** One new module, `src/config/design-route.ts`, holds the locked names, the default tier table and the resolution (`designRoute`). `routeFor(project, "design")` returns the resolved route, so every design call (plan, page, redraw, patch) follows it. The failure ladder learns to have several stronger-model rungs (`modelSteps`), one per tier above the start. A project with no `design.engine` / `design.tier` keeps today's behaviour exactly: Opus 5.5, no step-up.

**Tech Stack:** TypeScript (ESM), zod 4.6.5, vitest 5.

**Spec:** "Design Engine Adapter: End-to-End Plan", https://claude.ai/code/artifact/45b47c28-7a02-4ea8-b8a8-6fc67e7fa9ab (sections "Recommendation", "Locked names", "Blockers for the design phase", "How the engine and tier are chosen", "JSON track").

**Scope of this plan:** design-phase blockers 1 and 2, the locked names, the `design` config fields, the tier ladder and route logging. Not in this plan: the intake decision hook / Jev, CLI and UI pins, the Stitch engine itself, the critic pin, the `design` eval suite. Blocker 3 (Sonnet 5.5 price) is handled by using the priced `claude-sonnet-5` as the default `standard` model and refusing any unpriced tier model at start-up.

## Global Constraints

- Engine names, exactly: `claude`, `openai`, `stitch`. Tier names, exactly: `light`, `standard`, `heavy`, in that ladder order.
- Every module that needs these names imports them from `src/config/design-route.ts`; no other file spells them as string unions.
- A project with no `design.engine` and no `design.tier` must resolve to `claude-opus-5-5`, `escalate: []`, and keep the `raise-effort` rung (today's behaviour).
- A project that sets `steps.design` by hand keeps that route; the tier ladder does not apply.
- `stitch` is refused at start-up while `design.allowStitch` is not `true` (default `false`), and refused with "not built yet" when it is `true`.
- A design model on the `openai` engine with no `OPENAI_API_KEY` parks the step; it is never replaced by Opus.
- Every model on a design ladder must have a price (`src/runners/pricing.ts` or the project's `prices`), checked at start-up.
- Commit messages carry no `Co-Authored-By` line (user rule).

## Review Focus

- **No `design` block at all (every existing project, the standalone estimate project):** resolves to Opus 5.5 with `raise-effort` kept and one stronger-model rung, so nothing changes. Pinned in Task 2 and Task 4 tests.
- **`engine: openai` without `OPENAI_API_KEY`:** start-up reports it and `modelFor` returns `blocked`; the model is never `claude-opus-5-5` on a light or standard rung. Pinned in Task 4.
- **`engine: openai` with no OpenAI model configured in `design.tiers`:** a clear start-up problem naming `design.tiers`, not a crash. Pinned in Task 2 and Task 4.
- **A tier model with no price (for example `gpt-6-luna` before `prices` lists it):** a start-up problem naming `prices`, so the cost caps never fall back to $10 / $50 unnoticed. Pinned in Task 4.
- **Climbing past the last tier:** after the top model fails twice, the ladder parks ("Every retry option is used up") instead of looping or indexing past the list. Pinned in Task 3 and Task 4.

Known behaviour, not changed here: in estimate, design and greenfield runs, a failing gate check turns into a question round after 2 attempts (`ROUND_ATTEMPTS`, `src/stages/executor.ts:446`); the next attempt after the answers runs on the next rung, so the step-up follows the question round.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from `main`**

```bash
git checkout main
git checkout -b design-tier-ladder
```

Do not add the untracked `.agents/` folder or `skills-lock.json`; they are the user's.

---

### Task 1: Locked names and the `design` config fields

**Files:**
- Create: `src/config/design-route.ts`
- Modify: `src/config/project.ts` (the `StepRoute` schema at the top; the `design: z.object({ ... })` block around line 106)
- Test: `src/config/design-route.test.ts`

**Interfaces:**
- Produces: `DESIGN_ENGINES`, `DESIGN_TIERS`, `type DesignEngine`, `type DesignTier` (from `design-route.ts`); `StepRoute` gains `tiered?: boolean` and `strict?: boolean`; `ProjectConfig["design"]` gains `engine?: DesignEngine`, `tier?: DesignTier`, `tiers?: Partial<Record<DesignTier, Partial<Record<DesignEngine, string>>>>`, `allowStitch: boolean` (default `false`).

- [ ] **Step 1: Write the failing test**

Create `src/config/design-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "./project.js";
import { DESIGN_ENGINES, DESIGN_TIERS } from "./design-route.js";

const base = { project: "p", repo: "-", stack: "dotnet" };

describe("locked design names", () => {
  it("has the three engines and the three tiers in ladder order", () => {
    expect(DESIGN_ENGINES).toEqual(["claude", "openai", "stitch"]);
    expect(DESIGN_TIERS).toEqual(["light", "standard", "heavy"]);
  });

  it("reads engine, tier, tiers and allowStitch from the project's design block", () => {
    const p = ProjectConfig.parse({ ...base, design: { engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" } } } });
    expect(p.design?.engine).toBe("openai");
    expect(p.design?.tier).toBe("light");
    expect(p.design?.tiers?.light?.openai).toBe("gpt-6-luna");
    expect(p.design?.allowStitch).toBe(false);
  });

  it("refuses a misspelt engine or tier when the project is loaded", () => {
    expect(() => ProjectConfig.parse({ ...base, design: { engine: "gemini" } })).toThrow();
    expect(() => ProjectConfig.parse({ ...base, design: { tier: "medium" } })).toThrow();
    expect(() => ProjectConfig.parse({ ...base, design: { tiers: { medium: { claude: "x" } } } })).toThrow();
  });

  it("keeps a project with no design block valid", () => {
    expect(ProjectConfig.parse(base).design).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/config/design-route.test.ts`
Expected: FAIL, cannot find module `./design-route.js`.

- [ ] **Step 3: Create `src/config/design-route.ts` with the names**

```ts
// The design step's engine and tier (docs/superpowers/plans/2026-10-09-design-tier-ladder.md): the one place that names
// them, so the project config, the design step and the ledger spell them the same way.
export const DESIGN_ENGINES = ["claude", "openai", "stitch"] as const;
/** Ladder order: a step up is the next one. light = T1, standard = T2, heavy = T3 (docs/design/workflow-design.md). */
export const DESIGN_TIERS = ["light", "standard", "heavy"] as const;
export type DesignEngine = (typeof DESIGN_ENGINES)[number];
export type DesignTier = (typeof DESIGN_TIERS)[number];
```

- [ ] **Step 4: Add the fields to `src/config/project.ts`**

Add the import below the existing imports:

```ts
import { DESIGN_ENGINES, DESIGN_TIERS } from "./design-route.js";
```

Extend `StepRoute` (keep the existing four fields, add two):

```ts
const StepRoute = z.object({
  runner: z.enum(["api", "claude-agent", "codex", "jcode"]),
  model: z.string(),
  escalate: z.array(z.string()).default([]),
  effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  /** a tier ladder (the design step): each escalate model is its own rung, with no raise-effort rung before them */
  tiered: z.boolean().optional(),
  /** the vendor was chosen on purpose: a missing key parks the step instead of swapping in another vendor's model */
  strict: z.boolean().optional(),
});
```

Inside the existing `design: z.object({ ... })` block, after `brandFonts`, add:

```ts
    /** who draws the design: claude or openai write the design JSON; stitch is not built yet */
    engine: z.enum(DESIGN_ENGINES).optional(),
    /** the starting tier; two failed attempts on a tier step up to the next */
    tier: z.enum(DESIGN_TIERS).optional(),
    /** model per tier and engine, over the defaults in src/config/design-route.ts (DEFAULT_TIERS) */
    tiers: z.partialRecord(z.enum(DESIGN_TIERS), z.partialRecord(z.enum(DESIGN_ENGINES), z.string())).optional(),
    /** Stitch sends the requirements to Google (training-data disclaimer): off unless a project says so */
    allowStitch: z.boolean().default(false),
```

- [ ] **Step 5: Run the test and the existing config-dependent tests**

Run: `npx vitest run src/config/design-route.test.ts src/stages/routing.test.ts src/stages/design-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`src/stages/design-fidelity.ts:90` reads `ProjectConfig.shape.design.unwrap().shape.fidelity`; adding fields keeps that path valid.)

- [ ] **Step 7: Commit**

```bash
git add src/config/design-route.ts src/config/design-route.test.ts src/config/project.ts
git commit -m "Lock the design engine and tier names and add them to the project's design block"
```

---

### Task 2: Resolve a design route from engine and tier

**Files:**
- Modify: `src/config/design-route.ts`
- Test: `src/config/design-route.test.ts`

**Interfaces:**
- Consumes: `DESIGN_ENGINES`, `DESIGN_TIERS`, `DesignEngine`, `DesignTier` (Task 1); `ProjectConfig`, `StepRoute` types from `./project.js` (type-only import, so no import cycle at run time).
- Produces:
  - `type RouteSource = "project-pin" | "hook" | "default"`
  - `interface DesignPick { engine: DesignEngine; tier: DesignTier; source: { engine: RouteSource; tier: RouteSource }; dropped?: string }`
  - `mergeDesignRoute(design: ProjectConfig["design"], hook?: { engine?: DesignEngine; tier?: DesignTier }): DesignPick`
  - `tierModels(engine: DesignEngine, tier: DesignTier, tiers: TierTable): { tier: DesignTier; model: string }[]`
  - `interface DesignRoute extends DesignPick { ladder: { tier: DesignTier; model: string }[]; route: StepRoute }`
  - `designRoute(project: Pick<ProjectConfig, "design">, hook?: ...): DesignRoute`, which throws an `Error` with a message fit for a start-up problem when the route cannot be resolved.

- [ ] **Step 1: Write the failing tests**

Append to `src/config/design-route.test.ts` (and add `designRoute, mergeDesignRoute, tierModels, DEFAULT_TIERS` to its import from `./design-route.js`):

```ts
describe("design route", () => {
  const cfg = (design?: unknown) => ProjectConfig.parse({ ...base, ...(design ? { design } : {}) });

  it("keeps today's design model when the project pins nothing", () => {
    const r = designRoute(cfg());
    expect(r.engine).toBe("claude");
    expect(r.tier).toBe("heavy");
    expect(r.source).toEqual({ engine: "default", tier: "default" });
    expect(r.route).toMatchObject({ runner: "api", model: "claude-opus-5-5", escalate: [], effort: "high", strict: true });
    expect(r.route.tiered).toBeFalsy();
  });

  it("climbs from standard to heavy on the claude engine", () => {
    const r = designRoute(cfg({ engine: "claude", tier: "standard" }));
    expect(r.ladder).toEqual([{ tier: "standard", model: "claude-sonnet-5" }, { tier: "heavy", model: "claude-opus-5-5" }]);
    expect(r.route).toMatchObject({ model: "claude-sonnet-5", escalate: ["claude-opus-5-5"], tiered: true });
  });

  it("starts claude at standard when light has no claude model", () => {
    expect(designRoute(cfg({ engine: "claude", tier: "light" })).ladder[0]).toEqual({ tier: "standard", model: "claude-sonnet-5" });
  });

  it("climbs the openai tiers and steps to Claude's heavy model at the top", () => {
    const r = designRoute(cfg({ engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" }, standard: { openai: "gpt-6-sol" } } }));
    expect(r.ladder.map((x) => x.model)).toEqual(["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5"]);
  });

  it("lets the project's tier table replace a default cell", () => {
    expect(designRoute(cfg({ engine: "claude", tier: "standard", tiers: { standard: { claude: "claude-sonnet-5-5" } } })).route.model).toBe("claude-sonnet-5-5");
  });

  it("says what to add when the engine has no model of its own at or above the tier", () => {
    // openai with no OpenAI model configured: only Claude's heavy would remain, which would be a silent vendor swap
    expect(() => designRoute(cfg({ engine: "openai", tier: "light" }))).toThrow(/No openai model.*design\.tiers/);
    expect(tierModels("openai", "light", {})).toEqual([]);
  });

  it("refuses stitch while allowStitch is off, and as not built when it is on", () => {
    expect(() => designRoute(cfg({ engine: "stitch" }))).toThrow(/allowStitch/);
    expect(() => designRoute(cfg({ engine: "stitch", allowStitch: true }))).toThrow(/not built yet/);
  });

  it("puts a pin over the hook and the hook over the default", () => {
    expect(mergeDesignRoute(cfg({ tier: "standard" }).design, { engine: "openai", tier: "light" })).toMatchObject({
      engine: "openai", tier: "standard", source: { engine: "hook", tier: "project-pin" },
    });
    expect(mergeDesignRoute(undefined, undefined).source).toEqual({ engine: "default", tier: "default" });
  });

  it("drops a hook's stitch suggestion when the project does not allow Stitch", () => {
    const pick = mergeDesignRoute(cfg().design, { engine: "stitch" });
    expect(pick.engine).toBe("claude");
    expect(pick.source.engine).toBe("default");
    expect(pick.dropped).toMatch(/stitch/);
  });

  it("only lists priced Claude models as defaults", () => {
    expect(DEFAULT_TIERS).toEqual({ standard: { claude: "claude-sonnet-5" }, heavy: { claude: "claude-opus-5-5" } });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/config/design-route.test.ts`
Expected: FAIL, `designRoute` / `mergeDesignRoute` / `tierModels` / `DEFAULT_TIERS` are not exported.

- [ ] **Step 3: Implement in `src/config/design-route.ts`**

Add below the type exports:

```ts
import type { ProjectConfig, StepRoute } from "./project.js";

export type RouteSource = "project-pin" | "hook" | "default";
type TierTable = Partial<Record<DesignTier, Partial<Record<DesignEngine, string>>>>;

/** Models per tier and engine when a project names none: priced Claude models only. An OpenAI ladder needs the project's own `design.tiers` and `prices`. */
export const DEFAULT_TIERS: TierTable = {
  standard: { claude: "claude-sonnet-5" },
  heavy: { claude: "claude-opus-5-5" },
};
/** Until the design eval has compared the tiers, a project that pins nothing keeps today's model: Opus 5.5, no step-up. */
const DEFAULT_ENGINE: DesignEngine = "claude";
const DEFAULT_TIER: DesignTier = "heavy";

export interface DesignPick { engine: DesignEngine; tier: DesignTier; source: { engine: RouteSource; tier: RouteSource }; dropped?: string }
export interface DesignRoute extends DesignPick { ladder: { tier: DesignTier; model: string }[]; route: StepRoute }
type Design = ProjectConfig["design"];
type Hook = { engine?: DesignEngine; tier?: DesignTier };

/** What a person pinned in the project beats what the intake hook suggests, which beats the default. */
export function mergeDesignRoute(design: Design, hook?: Hook): DesignPick {
  let dropped: string | undefined;
  // a suggestion the project does not allow is dropped, not refused: nobody asked for it
  const suggested = hook?.engine === "stitch" && !design?.allowStitch ? (dropped = "the hook suggested stitch, which this project does not allow", undefined) : hook?.engine;
  const engine: [DesignEngine, RouteSource] = design?.engine ? [design.engine, "project-pin"] : suggested ? [suggested, "hook"] : [DEFAULT_ENGINE, "default"];
  const tier: [DesignTier, RouteSource] = design?.tier ? [design.tier, "project-pin"] : hook?.tier ? [hook.tier, "hook"] : [DEFAULT_TIER, "default"];
  return { engine: engine[0], tier: tier[0], source: { engine: engine[1], tier: tier[1] }, ...(dropped ? { dropped } : {}) };
}

/**
 * The models a design run climbs, from its starting tier up: the engine's model on each tier that has one. On the openai
 * engine the heavy tier is Claude's (a cross-vendor step: the ladder has no OpenAI model above standard).
 */
export function tierModels(engine: DesignEngine, tier: DesignTier, tiers: TierTable): { tier: DesignTier; model: string }[] {
  const out: { tier: DesignTier; model: string }[] = [];
  for (const t of DESIGN_TIERS.slice(DESIGN_TIERS.indexOf(tier))) {
    const model = tiers[t]?.[engine] ?? (engine === "openai" && t === "heavy" ? tiers.heavy?.claude : undefined);
    if (model && !out.some((x) => x.model === model)) out.push({ tier: t, model });
  }
  return out;
}

/** The design step's route from the project's engine and tier. Throws a start-up problem when it cannot be resolved. */
export function designRoute(project: Pick<ProjectConfig, "design">, hook?: Hook): DesignRoute {
  const d = project.design;
  const pick = mergeDesignRoute(d, hook);
  if (pick.engine === "stitch") {
    throw new Error(d?.allowStitch ? "design.engine is stitch, and the Stitch engine is not built yet; set design.engine to claude or openai"
      : "design.engine is stitch, but design.allowStitch is off; Stitch sends the requirements to Google, so a project must allow it");
  }
  const tiers: TierTable = {};
  for (const t of DESIGN_TIERS) tiers[t] = { ...DEFAULT_TIERS[t], ...d?.tiers?.[t] };
  const ladder = tierModels(pick.engine, pick.tier, tiers);
  // the engine needs a model of its own on the ladder; a ladder of only the cross-vendor heavy step would swap vendors silently
  if (!ladder.some((x) => tiers[x.tier]?.[pick.engine] === x.model)) throw new Error(`No ${pick.engine} model for the design step at tier ${pick.tier} or above; add one under design.tiers`);
  return {
    ...pick, ladder,
    route: { runner: "api", model: ladder[0]!.model, escalate: ladder.slice(1).map((x) => x.model), effort: "high", strict: true, ...(ladder.length > 1 ? { tiered: true } : {}) },
  };
}
```

Move the `import type` line to the top of the file with the other imports.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/config/design-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/design-route.ts src/config/design-route.test.ts
git commit -m "Resolve the design step's model ladder from its engine and tier"
```

---

### Task 3: Several stronger-model rungs in the failure ladder

**Files:**
- Modify: `src/gates/ladder.ts` (`LadderOptions`, `nextAvailable`, the call in `nextOnFailure` around line 71)
- Test: `src/gates/ladder.test.ts` (new)

**Interfaces:**
- Produces: `LadderOptions.modelSteps?: number` (default 1); `rungKind(n: number, modelSteps?: number): Rung | undefined`. With `modelSteps` 1 every rung number means what it means today (0 retry, 1 raise-effort, 2 stronger-model, 3 other-vendor).

- [ ] **Step 1: Write the failing tests**

Create `src/gates/ladder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LADDER, nextOnFailure, rungKind, type AttemptRecord, type Rung } from "./ladder.js";

const opts = (avail: Rung[], modelSteps?: number) => ({
  ...DEFAULT_LADDER, availableRungs: new Set<Rung>(avail), backoffSpentMs: 0, a5Done: new Set<string>(), ...(modelSteps ? { modelSteps } : {}),
});
const at = (rung: number, n: number): AttemptRecord => ({ category: "other", signature: `fail-${rung}-${n}`, rung });

describe("rung kinds", () => {
  it("keeps today's numbering with one model step", () => {
    expect([0, 1, 2, 3, 4].map((n) => rungKind(n))).toEqual(["retry", "raise-effort", "stronger-model", "other-vendor", undefined]);
  });
  it("gives each extra model step its own stronger-model rung", () => {
    expect([2, 3, 4, 5].map((n) => rungKind(n, 2))).toEqual(["stronger-model", "stronger-model", "other-vendor", undefined]);
  });
});

describe("a tier ladder", () => {
  const tiers = opts(["retry", "stronger-model"], 2);

  it("moves to the first model step after two failures on the start tier", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2)], tiers)).toMatchObject({ action: "retry", rung: 2 });
  });

  it("moves to the second model step after two failures on the first", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2), at(2, 1), at(2, 2)], tiers)).toMatchObject({ action: "retry", rung: 3 });
  });

  it("parks after the top model fails twice", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2), at(2, 1), at(2, 2), at(3, 1), at(3, 2)], tiers)).toMatchObject({ action: "park" });
  });

  it("climbs exactly as before without modelSteps", () => {
    const today = opts(["retry", "raise-effort", "stronger-model"]);
    expect(nextOnFailure([at(0, 1), at(0, 2)], today)).toMatchObject({ rung: 1 });
    expect(nextOnFailure([at(0, 1), at(0, 2), at(1, 1), at(1, 2)], today)).toMatchObject({ rung: 2 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/gates/ladder.test.ts`
Expected: FAIL, `rungKind` is not exported.

- [ ] **Step 3: Implement in `src/gates/ladder.ts`**

Add to `LadderOptions`:

```ts
  /** stronger-model rungs in a row: a design tier ladder has one per tier above its start; default 1 */
  modelSteps?: number;
```

Replace `nextAvailable` with:

```ts
/** What rung `n` is: 0 retry, 1 raise effort, then `modelSteps` stronger-model rungs, then other vendor; past that, none. */
export function rungKind(n: number, modelSteps = 1): Rung | undefined {
  if (n < 2) return RUNGS[n];
  if (n < 2 + modelSteps) return "stronger-model";
  return n === 2 + modelSteps ? "other-vendor" : undefined;
}

function nextAvailable(from: number, avail: Set<Rung>, modelSteps = 1): number | undefined {
  for (let r = from; rungKind(r, modelSteps); r++) if (avail.has(rungKind(r, modelSteps)!)) return r;
  return undefined;
}
```

In `nextOnFailure`, change the call:

```ts
  const target = nextAvailable(move ? last.rung + 1 : last.rung, o.availableRungs, o.modelSteps);
```

- [ ] **Step 4: Run the tests and the executor suites that use the ladder**

Run: `npx vitest run src/gates/ladder.test.ts src/stages/executor-versions.test.ts src/stages/e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates/ladder.ts src/gates/ladder.test.ts
git commit -m "Let the failure ladder have one stronger-model rung per model step"
```

---

### Task 4: Route the design step by its tiers, and never swap a chosen engine

**Files:**
- Modify: `src/stages/routing.ts` (`routeFor`, `modelFor`, `availableRungs`, `checkRoutes`; new `modelSteps`)
- Modify: `src/stages/executor.ts:440-443` (pass `modelSteps`)
- Test: `src/stages/routing.test.ts`

**Interfaces:**
- Consumes: `designRoute` (Task 2), `rungKind` semantics and `LadderOptions.modelSteps` (Task 3), `StepRoute.tiered` / `strict` (Task 1).
- Produces: `routeFor(project, "design")` returns the tier route unless `project.steps.design` is set; `modelSteps(project: ProjectConfig, stage: string): number`; `modelFor` picks `escalate[rung - 2]` (capped at the last) on stronger-model rungs and returns `blocked` for a strict route with no OpenAI key; `checkRoutes` reports design-route errors, strict-key problems and unpriced ladder models.

- [ ] **Step 1: Write the failing tests**

Append to `src/stages/routing.test.ts` (add `modelSteps` and `routeFor` to the import from `./routing.js`):

```ts
describe("design tier routes", () => {
  const saved = { home: process.env.FACTORY_HOME, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  beforeEach(() => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "routes-"));
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.OPENAI_API_KEY;
    _resetEnvCache();
  });
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["ANTHROPIC_API_KEY", saved.a], ["OPENAI_API_KEY", saved.o]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache();
  });
  const cfg = (extra: Record<string, unknown> = {}) => ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet", ...extra });
  const openai = { design: { engine: "openai", tier: "light", tiers: { light: { openai: "gpt-6-luna" }, standard: { openai: "gpt-6-sol" } } } };
  const prices = { prices: { "gpt-6-luna": { input: 0.2, output: 1.2 }, "gpt-6-sol": { input: 4, output: 20 } } };

  it("keeps today's design route and rungs when the project pins nothing", () => {
    const p = cfg();
    expect(modelFor(p, "design", 0).model).toBe("claude-opus-5-5");
    expect(modelFor(p, "design", 2).model).toBe("claude-opus-5-5");
    expect([...availableRungs(p, "design", false)]).toEqual(["retry", "raise-effort"]);
    expect(modelSteps(p, "design")).toBe(1);
  });

  it("climbs one model per stronger-model rung, without a raise-effort rung", () => {
    process.env.OPENAI_API_KEY = "sk-o"; _resetEnvCache();
    const p = cfg({ ...openai, ...prices });
    expect([0, 2, 3, 4].map((r) => modelFor(p, "design", r).model)).toEqual(["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5", "claude-opus-5-5"]);
    expect([...availableRungs(p, "design", false)]).toEqual(["retry", "stronger-model"]);
    expect(modelSteps(p, "design")).toBe(2);
  });

  it("parks an openai design without a key instead of running Opus", () => {
    const p = cfg({ ...openai, ...prices });
    const r = modelFor(p, "design", 0);
    expect(r.blocked).toMatch(/OPENAI_API_KEY/);
    expect(r.model).toBe("gpt-6-luna");
    expect(checkRoutes(p, ["design"]).join("\n")).toMatch(/OPENAI_API_KEY/);
  });

  it("reports an unpriced ladder model at start-up", () => {
    process.env.OPENAI_API_KEY = "sk-o"; _resetEnvCache();
    expect(checkRoutes(cfg(openai), ["design"]).join("\n")).toMatch(/gpt-6-luna has no price/);
    expect(checkRoutes(cfg({ ...openai, ...prices }), ["design"])).toEqual([]);
  });

  it("reports stitch at start-up instead of crashing", () => {
    expect(checkRoutes(cfg({ design: { engine: "stitch" } }), ["design"]).join("\n")).toMatch(/allowStitch/);
    expect(checkRoutes(cfg({ design: { engine: "stitch", allowStitch: true } }), ["design"]).join("\n")).toMatch(/not built yet/);
  });

  it("keeps a design route the project set by hand", () => {
    const p = cfg({ design: { engine: "claude", tier: "standard" }, steps: { design: { runner: "api", model: "claude-sonnet-5" } } });
    expect(routeFor(p, "design")).toMatchObject({ model: "claude-sonnet-5", escalate: [] });
    expect(routeFor(p, "design").tiered).toBeUndefined();
  });

  it("leaves other steps' escalation as it was", () => {
    expect(modelFor(cfg(), "implement", 2).model).toBe("claude-opus-5-5");
    expect(modelSteps(cfg(), "implement")).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/stages/routing.test.ts`
Expected: FAIL, `modelSteps` is not exported and the design model is still the fixed Opus route.

- [ ] **Step 3: Implement in `src/stages/routing.ts`**

Add imports:

```ts
import { designRoute } from "../config/design-route.js";
import { hasPrice } from "../runners/pricing.js";
```

Replace `routeFor`:

```ts
export function routeFor(project: ProjectConfig, stage: string): StepRoute {
  // the design step climbs its engine's tiers, unless the project routes it by hand
  if (stage === "design" && !project.steps.design) return designRoute(project).route;
  const r = project.steps[stage] ?? DEFAULT_ROUTES[stage];
  if (!r) throw new Error(`No model route for step ${stage}`);
  return r;
}
```

Replace `modelFor` with:

```ts
/** The model a rung runs: the route's own on rungs 0 and 1, then one escalate model per stronger-model rung (the last one stays). */
function wanted(r: StepRoute, rung: number): string {
  return rung >= 2 && r.escalate.length ? r.escalate[Math.min(rung - 2, r.escalate.length - 1)]! : r.model;
}

export function modelFor(project: ProjectConfig, stage: string, rung: number, policy?: Pick<Policy, "allowedModels">, prior: { check: string }[] = []): { model: string; effort: Effort; singleFamilyNote?: string; blocked?: string } {
  const r = routeFor(project, stage);
  const effort: Effort = rung >= 1 && !mechanical(prior) ? "xhigh" : (r.effort ?? "high");
  const want = wanted(r, rung);
  const noOpenAi = /^gpt|^o\d/.test(want) && !hasSecret("OPENAI_API_KEY");
  // a vendor chosen on purpose (a design engine) parks rather than run another vendor's model
  if (noOpenAi && r.strict) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or choose another design engine` };
  if (policy && !policy.allowedModels.includes("*")) {
    let model = want, note: string | undefined;
    if (noOpenAi) {
      if (!modelAllowed(policy, OPUS)) return { model: want, effort, blocked: `${stage} needs ${want} but OPENAI_API_KEY is missing; add the key or allow ${OPUS} for this step` };
      model = OPUS;
      note = `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)`;
    }
    if (!modelAllowed(policy, model)) return { model, effort, blocked: blockedText(stage, model, policy) };
    return { model, effort, singleFamilyNote: note };
  }
  if (noOpenAi) return { model: OPUS, effort, singleFamilyNote: `No OpenAI key: ${stage} ran on ${OPUS} (same family as the implementer)` };
  return { model: want, effort };
}
```

Replace `availableRungs` and add `modelSteps` below it:

```ts
/** The step's route, or undefined for a deterministic step or a route that cannot be resolved (checkRoutes reports that). */
function routeOrNone(project: ProjectConfig, stage: string): StepRoute | undefined {
  try { return routeFor(project, stage); } catch { return undefined; }
}

/** Rungs this step can use. Other-vendor needs the Codex runner, which isn't built yet. */
export function availableRungs(project: ProjectConfig, stage: string, localOnly: boolean): Set<Rung> {
  const r = routeOrNone(project, stage);
  // deterministic steps (discover, stub-commit, integrate, accept, deliver, cards) have no model: retry only
  if (!r) return new Set<Rung>(["retry"]);
  // a tier ladder steps up after two failures on a tier: no raise-effort rung in between
  const s = new Set<Rung>(r.tiered ? ["retry"] : ["retry", "raise-effort"]);
  // localOnly: no escalation to a hosted model
  if (r.escalate.length && (!localOnly || family(r.escalate[0]!) === "local")) s.add("stronger-model");
  // "other-vendor" is added once the Codex runner exists, and never under localOnly.
  return s;
}

/** Stronger-model rungs the step has (LadderOptions.modelSteps): one per model above the first on a tier ladder, else one. */
export function modelSteps(project: ProjectConfig, stage: string): number {
  const r = routeOrNone(project, stage);
  return r?.tiered ? Math.max(1, r.escalate.length) : 1;
}
```

In `checkRoutes`, replace the loop body's first lines so a design-route error, a strict-key block and an unpriced ladder model are reported:

```ts
  for (const stage of only ?? Object.keys(DEFAULT_ROUTES)) {
    let r: StepRoute;
    try { r = routeFor(project, stage); } catch (e) { problems.push((e as Error).message); continue; }
    if (THINKING_STEPS.has(stage) && r.runner !== "api") problems.push(`${stage} is a thinking step and must use the api runner`);
    if (CODING_STEPS.has(stage) && r.runner === "api") problems.push(`${stage} is a coding step and needs an agent runner`);
    const { model, blocked } = modelFor(project, stage, 0);
    if (blocked) problems.push(blocked);
    if (model.startsWith("claude-") && !hasSecret("ANTHROPIC_API_KEY")) noKey.push(stage);
    // every model on a tier ladder is costed, so the caps never fall back to the unknown-model rate
    if (r.tiered || r.strict) for (const m of [r.model, ...r.escalate]) if (!hasPrice(m) && !project.prices[m]) problems.push(`${stage}: ${m} has no price; add it under prices so the cost caps hold`);
    if ((r.runner === "codex" || r.runner === "jcode")) problems.push(`${stage}: the ${r.runner} runner isn't built yet`);
  }
```

- [ ] **Step 4: Pass `modelSteps` to the ladder in `src/stages/executor.ts`**

Change the import at line 30:

```ts
import { availableRungs, modelSteps, routeFor } from "./routing.js";
```

And the `nextOnFailure` options at lines 440-443:

```ts
        const action: LadderAction = nextOnFailure([...history, rec2], {
          // policy.retryBudget (default 6; a trial project can say 2)
          ...DEFAULT_LADDER, maxAttempts: policy.retryBudget + state.capOverrides.extraAttempts, availableRungs: availableRungs(project, step.stage, policy.localOnly), modelSteps: modelSteps(project, step.stage), backoffSpentMs: backoffSpent, a5Done: new Set(),
        });
```

- [ ] **Step 5: Run the routing tests and the full suite**

Run: `npx vitest run src/stages/routing.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS (the other routes keep a single escalation, so their rungs and models are unchanged).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stages/routing.ts src/stages/routing.test.ts src/stages/executor.ts
git commit -m "Route the design step by its engine's tiers, step up per tier, and park instead of swapping a chosen engine"
```

---

### Task 5: Log the design route and document the config

**Files:**
- Modify: `src/stages/design.ts` (import; `run` of `makeDesignStep`, after the "no UI" early return around line 913)
- Modify: `docs/project-example.yaml`

**Interfaces:**
- Consumes: `designRoute` (Task 2).

- [ ] **Step 1: Log the route at the start of a drawing design step**

Add the import with the other `../config` / `./` imports in `src/stages/design.ts`:

```ts
import { designRoute } from "../config/design-route.js";
```

In `makeDesignStep(...).run`, directly after the line that returns for `!intent.touchesUi`, add:

```ts
      // route-source logging: which engine and tier draw this design, and where each came from
      if (!ctx.project.steps.design) {
        const dr = designRoute(ctx.project);
        const line = `design: engine ${dr.engine} (${dr.source.engine}), tier ${dr.tier} (${dr.source.tier}): ${dr.ladder.map((x) => `${x.tier} ${x.model}`).join(" → ")}${dr.dropped ? `; ${dr.dropped}` : ""}`;
        ctx.log(line);
        ctx.trace.event("route.design", line, { engine: dr.engine, tier: dr.tier, source: dr.source, ladder: dr.ladder });
      }
```

- [ ] **Step 2: Document the fields in `docs/project-example.yaml`**

Find the existing `design:` section (or add one at the end if there is none) and add these commented lines under it:

```yaml
# design:
#   engine: claude          # claude | openai | stitch (stitch: not built yet, and needs allowStitch)
#   tier: standard          # light | standard | heavy; two failed attempts on a tier step up to the next
#   tiers:                  # model per tier and engine, over the defaults (standard: claude-sonnet-5, heavy: claude-opus-5-5)
#     light:    { openai: gpt-6-luna }
#     standard: { openai: gpt-6-sol }
#   allowStitch: false      # Stitch sends the requirements to Google; off by default
# prices:                   # every model on the design ladder needs a price
#   gpt-6-luna: { input: 0.2, output: 1.2 }
```

- [ ] **Step 3: Run the design suites and the typecheck**

Run: `npx vitest run src/stages/design-pipeline.test.ts src/stages/design-rework.test.ts src/stages/brownfield-design.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/stages/design.ts docs/project-example.yaml
git commit -m "Log the design step's engine, tier and ladder, and document the design route fields"
```

---

## Addendum (user request, 9 Oct 2026): the Stitch path, designed with the stitch-design-taste skill

When a project picks `engine: stitch` (and `allowStitch: true`), the design step: (1) lists the screens with the run's Claude tier model, (2) writes a `DESIGN.md` design system by following the installed skill `.agents/skills/stitch-design-taste/SKILL.md`, with the client's brand and existing look winning over the skill's taste rules, (3) creates a Stitch project and design system from that `DESIGN.md` (`styleGuidelines`), (4) generates each screen with the Stitch model of the tier, and (5) stores each screen's HTML and screenshot. The screenshots are saved as frames, so the existing demo, approval card and package pictures show them without a second renderer.

Facts from the SDK (`@google/stitch-sdk` 0.3.5, read from its type definitions): `new Stitch(new StitchToolClient({ apiKey }))`; `stitch.createProject(title)`; `project.createDesignSystem({ displayName, styleGuidelines, designTokens?, theme? })`; `project.generate(prompt, deviceType, modelId)` with `modelId` one of `GEMINI_3_FLASH`, `GEMINI_3_PRO`, `GEMINI_3_1_PRO`; `screen.getHtml()` and `screen.getImage()` return download URLs; `client.close()`.

Still out of scope after the addendum: Stitch rework by `edit()`, extra states by `edit()`, axe checks on Stitch HTML, Stitch HTML in the design package, and the build reading Stitch HTML. A Stitch design that is sent back is redrawn whole.

Addendum Global Constraints:
- The skill is read at run time from `.agents/skills/stitch-design-taste/SKILL.md` (resolved from the factory's own root); it is not copied into `src/`. A missing file is a start-up problem.
- Stitch tier models: `light` = `GEMINI_3_FLASH`, `standard` = `GEMINI_3_PRO`, `heavy` = `GEMINI_3_1_PRO`. The planner and the `DESIGN.md` writer use the Claude ladder of the same tier.
- `STITCH_API_KEY` must be present for `engine: stitch`; it is a start-up problem otherwise.
- Stitch HTML is stored in the ledger as an artifact and never rendered unsandboxed; only the PNG screenshots enter the demo.

### Task 6: Stitch as a routable engine

**Files:** Modify `src/config/design-route.ts`, `src/config/design-route.test.ts`, `src/stages/routing.ts`, `src/stages/routing.test.ts`.

**Interfaces:**
- Produces: `STITCH_MODELS: Record<DesignTier, "GEMINI_3_FLASH" | "GEMINI_3_PRO" | "GEMINI_3_1_PRO">`; `DesignRoute.ladder[i].stitch?: string` (set on the stitch engine); `designRoute` resolves `engine: "stitch"` (with `allowStitch`) to the Claude ladder of the tier plus a Stitch model per rung; `ladderAt(dr: DesignRoute, rung: number)` returns the ladder entry a rung runs (rungs 0-1 the first, then one per stronger-model rung, capped at the last).

- [ ] **Step 1: Replace the "not built yet" test and add stitch tests** in `src/config/design-route.test.ts`:

```ts
  it("refuses stitch while allowStitch is off", () => {
    expect(() => designRoute(cfg({ engine: "stitch" }))).toThrow(/allowStitch/);
  });

  it("plans stitch with the Claude ladder and draws with the tier's Stitch model", () => {
    const r = designRoute(cfg({ engine: "stitch", allowStitch: true, tier: "standard" }));
    expect(r.ladder).toEqual([
      { tier: "standard", model: "claude-sonnet-5", stitch: "GEMINI_3_PRO" },
      { tier: "heavy", model: "claude-opus-5-5", stitch: "GEMINI_3_1_PRO" },
    ]);
    expect(r.route.model).toBe("claude-sonnet-5");
    expect([0, 1, 2, 5].map((n) => ladderAt(r, n).stitch)).toEqual(["GEMINI_3_PRO", "GEMINI_3_PRO", "GEMINI_3_1_PRO", "GEMINI_3_1_PRO"]);
  });
```

(Delete the earlier test "refuses stitch while allowStitch is off, and as not built when it is on"; add `ladderAt` to the import.)

- [ ] **Step 2: Run, see it fail** — `npx vitest run src/config/design-route.test.ts` → FAIL (`ladderAt` missing, stitch throws "not built yet").

- [ ] **Step 3: Implement** in `src/config/design-route.ts`:

```ts
/** The Stitch model per tier (SDK 0.3.5 model ids). */
export const STITCH_MODELS = { light: "GEMINI_3_FLASH", standard: "GEMINI_3_PRO", heavy: "GEMINI_3_1_PRO" } as const satisfies Record<DesignTier, string>;
```

Change `DesignRoute.ladder` to `{ tier: DesignTier; model: string; stitch?: string }[]`. In `designRoute`, replace the stitch `throw` with: refuse only while `allowStitch` is off (keep that message), and resolve stitch through the Claude ladder:

```ts
  const planner = pick.engine === "stitch" ? "claude" : pick.engine;
  const ladder = tierModels(planner, pick.tier, tiers).map((x) => (pick.engine === "stitch" ? { ...x, stitch: STITCH_MODELS[x.tier] } : x));
  if (!ladder.some((x) => tiers[x.tier]?.[planner] === x.model)) throw new Error(`No ${pick.engine} model for the design step at tier ${pick.tier} or above; add one under design.tiers`);
```

Add:

```ts
/** The ladder entry a rung runs: rungs 0 and 1 the first, then one per stronger-model rung, the last one kept. */
export function ladderAt(dr: Pick<DesignRoute, "ladder">, rung: number): DesignRoute["ladder"][number] {
  return dr.ladder[Math.min(Math.max(0, rung - 1), dr.ladder.length - 1)]!;
}
```

- [ ] **Step 4: Start-up check for the key** — in `src/stages/routing.ts` `checkRoutes`, after the `routeFor` try/catch, add:

```ts
    if (stage === "design" && !project.steps.design && project.design?.engine === "stitch" && !hasSecret("STITCH_API_KEY")) problems.push("design.engine is stitch, but STITCH_API_KEY is missing from ~/.factory/.env");
```

In `src/stages/routing.test.ts`, replace the stitch test with:

```ts
  it("reports stitch without allowStitch or without its key at start-up", () => {
    expect(checkRoutes(cfg({ design: { engine: "stitch" } }), ["design"]).join("\n")).toMatch(/allowStitch/);
    expect(checkRoutes(cfg({ design: { engine: "stitch", allowStitch: true } }), ["design"]).join("\n")).toMatch(/STITCH_API_KEY/);
    process.env.STITCH_API_KEY = "st"; _resetEnvCache();
    expect(checkRoutes(cfg({ design: { engine: "stitch", allowStitch: true } }), ["design"])).toEqual([]);
    delete process.env.STITCH_API_KEY; _resetEnvCache();
  });
```

- [ ] **Step 5: Run** `npx vitest run src/config/design-route.test.ts src/stages/routing.test.ts` → PASS. **Commit:** `Route the stitch engine through the Claude planner ladder with a Stitch model per tier`.

### Task 7: The DESIGN.md writer's briefing and checks (stitch-design-taste)

**Files:** Create `src/design/stitch-taste.ts`, `src/design/stitch-taste.test.ts`.

**Interfaces:**
- Produces: `TASTE_SKILL_PATH: string` (absolute path to `.agents/skills/stitch-design-taste/SKILL.md` from the factory root); `loadTasteSkill(path?: string): string` (the skill body without its front matter; throws `Error` naming the path when missing); `TASTE_OVERRIDES: string` (the rules that put the client first); `DesignMdOut` (zod: `{ designMd: string }`); `designMdFaults(md: string, brand: { colours: string[]; fonts: string[] }): { check: string; message: string }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designMdFaults, loadTasteSkill, TASTE_SKILL_PATH } from "./stitch-taste.js";

const good = "# Design System: Ledgerly\n## 1. Visual Theme & Atmosphere\nCalm.\n## 2. Color Palette & Roles\n- **Canvas** (#F9FAFB) — background\n- **Brand Teal** (#0F766E) — accent\n## 3. Typography Rules\n- **Display:** Geist\n## 4. Component Stylings\n## 5. Layout Principles\n## 7. Anti-Patterns (Banned)\n- No emojis";

describe("the taste skill", () => {
  it("points at the installed skill in the factory root", () => {
    expect(TASTE_SKILL_PATH.replace(/\\/g, "/")).toMatch(/\.agents\/skills\/stitch-design-taste\/SKILL\.md$/);
  });
  it("reads the skill without its front matter", () => {
    const f = join(mkdtempSync(join(tmpdir(), "taste-")), "SKILL.md");
    writeFileSync(f, "---\nname: x\n---\n# Body\nRules");
    expect(loadTasteSkill(f)).toBe("# Body\nRules");
  });
  it("names the missing file", () => {
    expect(() => loadTasteSkill("/nope/SKILL.md")).toThrow(/nope.*SKILL\.md/);
  });
});

describe("DESIGN.md checks", () => {
  it("passes a complete design system that keeps the brand", () => {
    expect(designMdFaults(good, { colours: ["#0f766e"], fonts: [] })).toEqual([]);
  });
  it("flags missing sections, pure black, and a dropped brand colour or font", () => {
    const checks = designMdFaults("# Design System: X\n## 2. Color Palette & Roles\n- Ink (#000000)", { colours: ["#0F766E"], fonts: ["Lato"] }).map((f) => f.check);
    expect(checks).toEqual(expect.arrayContaining(["stitch-designmd-section", "stitch-designmd-black", "stitch-designmd-brand"]));
  });
});
```

- [ ] **Step 2: Run, see it fail** — `npx vitest run src/design/stitch-taste.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/design/stitch-taste.ts`**

```ts
// The Stitch design system (DESIGN.md), written by following the installed stitch-design-taste skill
// (.agents/skills/stitch-design-taste/SKILL.md). The skill sets the taste; the client's brand and existing look come first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** From src/design or dist/design, two levels up is the factory's root. */
export const TASTE_SKILL_PATH = fileURLToPath(new URL("../../.agents/skills/stitch-design-taste/SKILL.md", import.meta.url));

export function loadTasteSkill(path = TASTE_SKILL_PATH): string {
  if (!existsSync(path)) throw new Error(`The stitch-design-taste skill is missing at ${path}; install it (skills-lock.json) before using the stitch engine`);
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export const TASTE_OVERRIDES = `You write the DESIGN.md for this product by following the skill above, with these rules first:
- The client's brand colours and fonts, and an existing app's look, win over the skill's taste rules and bans. Keep every brand hex and font named in "brand" exactly.
- Use the skill's output structure (sections 1 to 7). Every colour has a descriptive name, its hex code and its role.
- Choose the dials from the product: software screens and dashboards are Density 5 to 7 and Variance 3 to 5; a marketing site may go higher.
- Describe the screens' shared look only. Never list screens, invent features, or describe content the requirements do not ask for.
Return the whole file as "designMd".`;

export const DesignMdOut = z.object({ designMd: z.string().min(200) });

const SECTIONS = [/^##\s*1\.\s/m, /^##\s*2\.\s/m, /^##\s*3\.\s/m, /^##\s*4\.\s/m, /^##\s*5\.\s/m, /anti-patterns/i];

export function designMdFaults(md: string, brand: { colours: string[]; fonts: string[] }): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  if (SECTIONS.some((re) => !re.test(md))) bad.push({ check: "stitch-designmd-section", message: "DESIGN.md must have the skill's sections: 1 atmosphere, 2 colour palette, 3 typography, 4 components, 5 layout, and the anti-patterns." });
  if (/#000000\b|#000\b/i.test(md)) bad.push({ check: "stitch-designmd-black", message: "DESIGN.md uses pure black (#000000); use an off-black such as #18181B." });
  const lost = [...brand.colours.filter((c) => !md.toLowerCase().includes(c.toLowerCase())), ...brand.fonts.filter((f) => !md.includes(f))];
  if (lost.length) bad.push({ check: "stitch-designmd-brand", message: `DESIGN.md drops the client's brand: ${lost.join(", ")}. The brand wins over the skill's taste rules; keep each one with its role.` });
  return bad;
}
```

- [ ] **Step 4: Run** → PASS. **Commit:** `Add the DESIGN.md writer's briefing and checks from the stitch-design-taste skill`.

### Task 8: The Stitch client

**Files:** Modify `package.json` (dependency `@google/stitch-sdk` pinned to `0.3.5`); create `src/design/stitch.ts`, `src/design/stitch.test.ts`.

**Interfaces:**
- Produces:
  - `interface StitchClient { createProject(title: string): Promise<string>; createDesignSystem(projectId: string, name: string, styleGuidelines: string): Promise<void>; generate(projectId: string, prompt: string, device: StitchDevice, model: string): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>; download(url: string): Promise<Uint8Array>; close(): Promise<void> }`
  - `type StitchDevice = "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC"`
  - `stitchClient(): StitchClient` (the factory in use; throws without `STITCH_API_KEY`); `setStitchFactory(f: () => StitchClient): void` for tests.

- [ ] **Step 1: Install the dependency** — `npm install --save-exact @google/stitch-sdk@0.3.5`.

- [ ] **Step 2: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { setStitchFactory, stitchClient } from "./stitch.js";

describe("stitch client", () => {
  const saved = { home: process.env.FACTORY_HOME, key: process.env.STITCH_API_KEY };
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["STITCH_API_KEY", saved.key]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache(); setStitchFactory(undefined);
  });
  it("refuses without STITCH_API_KEY", () => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "stitch-")); delete process.env.STITCH_API_KEY; _resetEnvCache();
    expect(() => stitchClient()).toThrow(/STITCH_API_KEY/);
  });
  it("uses the factory a test sets", () => {
    const fake = { createProject: async () => "p1" } as never;
    setStitchFactory(() => fake);
    expect(stitchClient()).toBe(fake);
  });
});
```

- [ ] **Step 3: Run, see it fail** → module missing.

- [ ] **Step 4: Implement `src/design/stitch.ts`**

```ts
// Google Stitch through its SDK (@google/stitch-sdk): one small interface, so the design step can be tested with a fake.
// No MCP server is set up; the SDK talks to Stitch's hosted endpoint with STITCH_API_KEY.
import { Stitch, StitchToolClient } from "@google/stitch-sdk";
import { secret } from "../config/env.js";

export type StitchDevice = "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
export interface StitchClient {
  createProject(title: string): Promise<string>;
  createDesignSystem(projectId: string, name: string, styleGuidelines: string): Promise<void>;
  generate(projectId: string, prompt: string, device: StitchDevice, model: string): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

function sdkClient(apiKey: string): StitchClient {
  const tools = new StitchToolClient({ apiKey });
  const stitch = new Stitch(tools);
  return {
    async createProject(title) { return (await stitch.createProject(title)).id; },
    async createDesignSystem(projectId, name, styleGuidelines) { await stitch.project(projectId).createDesignSystem({ displayName: name, styleGuidelines }); },
    async generate(projectId, prompt, device, model) {
      const screen = await stitch.project(projectId).generate(prompt, device, model as never);
      return { screenId: screen.id, htmlUrl: await screen.getHtml(), imageUrl: await screen.getImage() };
    },
    async download(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Stitch download failed: ${res.status} ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    close: () => tools.close(),
  };
}

let factory: (() => StitchClient) | undefined;
/** Tests replace the client; undefined goes back to the SDK. */
export function setStitchFactory(f: (() => StitchClient) | undefined): void { factory = f; }

export function stitchClient(): StitchClient {
  if (factory) return factory();
  const key = secret("STITCH_API_KEY");
  if (!key) throw new Error("STITCH_API_KEY is missing from ~/.factory/.env; the stitch design engine needs it");
  return sdkClient(key);
}
```

- [ ] **Step 5: Run** `npx vitest run src/design/stitch.test.ts` and `npx tsc --noEmit` → PASS / no errors. **Commit:** `Add a Stitch client over @google/stitch-sdk with a test seam`.

### Task 9: The design step draws with Stitch

**Files:** Create `src/stages/design-stitch.ts`, `src/stages/design-stitch.test.ts`; modify `src/stages/design.ts` (branch in `makeDesignStep(...).run` after the route log); modify `src/contracts/artifacts.ts` (`DesignBody` gains optional `engine` and `stitch`).

**Interfaces:**
- Consumes: `designRoute`, `ladderAt` (Task 6); `loadTasteSkill`, `TASTE_OVERRIDES`, `DesignMdOut`, `designMdFaults` (Task 7); `stitchClient`, `StitchClient` (Task 8); `think`, `S` (`src/stages/think.ts`); `mapDesign`, `failure`.
- Produces: `drawWithStitch(ctx: StepContext, spec: Spec): Promise<StepOutcome>`; `StitchPlan` zod; `stitchArtifact(plan, assets, meta)` pure builder; `DesignBody.engine?: "json" | "stitch"`; `DesignBody.stitch?: { projectId: string; model: string; designMd: string; frames: Record<string, { name: string; screenId: string; html: string; image: string }> }` (shas).
- Frame ids are `ST-1`, `ST-2`, ... in screen order; each PNG is written to `<ledger dir>/attachments/frames/stitch-<screen id>.png`, the same folder the approval step reads frames from.

- [ ] **Step 1: Write the failing tests** (`src/stages/design-stitch.test.ts`): (a) `stitchArtifact` puts each screen's frame id in `screens[].frames`, keeps `reqs` and `route`, sets `engine: "stitch"`, and fills `mapping` from `mapDesign`; (b) `drawWithStitch`, run with a fake `StitchClient` (via `setStitchFactory`) and scripted model answers (via `setProviderFactory` from `think.ts`, following the existing design-step tests' harness in `src/stages/design-pipeline.test.ts`), creates one project, one design system whose `styleGuidelines` is the returned DESIGN.md, one `generate` per screen with the tier's Stitch model, and writes `stitch-S-1.png` into `attachments/frames`; (c) a plan that leaves a requirement without a screen fails with `design-unmapped` before any Stitch call; (d) a DESIGN.md that drops the brand colour fails with `stitch-designmd-brand` before any Stitch call.

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement `drawWithStitch`** in `src/stages/design-stitch.ts`:
  1. `const dr = designRoute(ctx.project); const at = ladderAt(dr, ctx.rung);`
  2. Plan: `think(ctx, { stage: "design", label: "design screen list (stitch)", route: "design", cls: "read-large", budgetTokens: 60000, tools: [], schema: StitchPlan, maxTurns: 3, sections: [S.template("tpl", STITCH_PLAN_RULES), S.artifact("reqs", "requirements", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))), S.task("List every screen and write one Stitch prompt for each.")] })`, where `StitchPlan = z.object({ flow: z.string(), screens: z.array(z.object({ id: z.string().regex(/^S-\d+$/), title: z.string(), route: z.string().min(1), file: z.string().min(1), reqs: z.array(z.string()), states: z.array(z.string()).default([]), prompt: z.string().min(20) })).min(1), noScreen: z.array(z.object({ req: z.string(), reason: z.string() })).default([]), brand: z.object({ colours: z.array(z.string()).default([]), fonts: z.array(z.string()).default([]) }).default({ colours: [], fonts: [] }) })` and `STITCH_PLAN_RULES` says: one screen per page a user sees, ids S-1.., each requirement on a screen or in noScreen with a reason, each prompt describes that page's purpose, sections and real sample content for the domain (no lorem ipsum, no generic names), `brand` lists the client's colours (hex) and fonts only when the requirements or references name them.
  3. Map check: `mapDesign(reqIds, { screens: plan.screens, noScreen: plan.noScreen } as never)`; any unmapped requirement, orphan screen or duplicate id/route → `{ kind: "fail", category: "other", failures, signature: "stitch-plan:...", gate: true }`.
  4. DESIGN.md: `think(ctx, { ..., label: "design system (stitch-design-taste)", schema: DesignMdOut, sections: [S.template("taste", loadTasteSkill()), S.template("taste-rules", TASTE_OVERRIDES), S.artifact("brand", "brand", plan.brand), S.artifact("product", "product", { flow: plan.flow, screens: plan.screens.map((x) => x.title) }), S.task("Write DESIGN.md.")] })`, then `designMdFaults(md, plan.brand)` → fail outcome with those checks.
  5. Stitch: `const c = stitchClient()`; `projectId = await c.createProject(title)`; `await c.createDesignSystem(projectId, title, md)`; for each screen in a pool of 3 (`inPool` from `src/util/pool.ts`): `generate(projectId, screen.prompt + "\nFollow the project's design system exactly.", device, at.stitch!)`, then `download` the HTML and the image; `ctx.ledger.putArtifact(html)`, `ctx.ledger.putArtifact(png)`, and write the PNG to `join(ctx.ledger.dir, "attachments", "frames", \`stitch-${id}.png\`)`. `device` is `project.design.stitch?.device ?? "DESKTOP"` (add `stitch: z.object({ device: z.enum(["MOBILE","DESKTOP","TABLET","AGNOSTIC"]).default("DESKTOP") }).optional()` to the project's `design` block). Always `c.close()` in `finally`. A thrown Stitch error → `{ kind: "fail", category: "other", failures: [failure("stitch-call", message)], signature: "stitch-call" }`.
  6. Output: `{ kind: "done", outputs: { design: ctx.ledger.putJson({ ...stitchArtifact(plan, assets, { projectId, model: at.stitch!, designMd: mdSha }), header: header(ctx.runId, "design", "design", "", at.model) }) }, data: { screens: n, engine: "stitch" } }`.
- In `src/stages/design.ts` `run`, directly after the route log from Task 5: `if (!ctx.project.steps.design && designRoute(ctx.project).engine === "stitch") return drawWithStitch(ctx, specOf<Spec>(ctx.state, ctx.ledger, src));` (place it before the earlier-design rework branch, so a sent-back Stitch design is redrawn whole).

- [ ] **Step 4: Run** `npx vitest run src/stages/design-stitch.test.ts src/stages/design-pipeline.test.ts` and `npx tsc --noEmit` → PASS. **Commit:** `Draw the design with Stitch from a DESIGN.md written by the stitch-design-taste skill`.

### Task 10: The approval card shows Stitch screens

**Files:** Modify `src/stages/design-approve.ts` (frames, around line 202); test in `src/stages/design-stitch.test.ts`.

**Interfaces:**
- Produces: `stitchFrames(design: { stitch?: { frames: Record<string, { name: string }> } }): { id: string; name: string }[]` exported from `src/stages/design-stitch.ts`; the approval step adds these to the frames it reads from `attachments/frames`, so `buildDemo` shows each Stitch screenshot in place of a drawn page and the card's pictures include them.

- [ ] **Step 1: Write the failing test** — `stitchFrames` returns `[{ id: "ST-1", name: "stitch-S-1.png" }]` for a design with one Stitch frame and `[]` for a JSON design; and a `buildDemo` call with that frame's data URI and a screen whose `frames` is `["ST-1"]` and no `mock` contains `<img` with that data URI.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** `stitchFrames` and, in `design-approve.ts`, extend the frame list it builds from `listedFrames(request)` with `stitchFrames(d)` before the loop that reads each frame file.
- [ ] **Step 4: Run** `npx vitest run src/stages/design-stitch.test.ts src/stages/design-pipeline.test.ts` and `npm test` → PASS. **Commit:** `Show Stitch screens on the design approval card through the frame path`.

## Self-review notes

- Spec coverage: locked names (Task 1), engine and tier fields with `allowStitch` default off (Task 1), tier table and ladder with cross-vendor heavy on openai (Task 2), merge of pin over hook over default with a dropped Stitch suggestion (Task 2), step-up after two failures per tier (Tasks 3 and 4), no silent vendor swap (Task 4), priced models only (Task 4), route-source logging (Task 5). The hook itself, CLI/UI pins, Stitch, the critic pin and the eval suite are out of scope (see "Scope of this plan").
- Default deliberately stays `heavy` (Opus 5.5) instead of the spec's `standard`, because the spec also says no default changes before the Phase 1 measurement. A project opts into `standard` with `design.tier: standard`.
