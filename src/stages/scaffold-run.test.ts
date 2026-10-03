// The scaffold of a run (docs/estimates-design.md, "Kit and scaffold", step 4 wiring): the target per app, the changed screens of a
// change request, the plan's checks (design-system task first, containers in scope, generated files out of scope), gate B7 on the
// containers, and the preview the CLI and the UI show.
import { uiBase } from "./workspace.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import type { ProjectConfig } from "../config/project.js";
import { sampleDesign } from "../design/kit/index.js";
import type { FileSource } from "../design/source.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";
import { screenScopeGaps } from "../design/design-link.js";
import { changedScreens, checkPlanScaffold, designForScopeGate, scaffoldForPlan, scaffoldForRun, scaffoldOfRun, scaffoldPreview, scaffoldView, targetForRun } from "./scaffold-run.js";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-scaffold-"));
  _resetEnvCache();
});

const files = (m: Record<string, string>): FileSource => ({ list: () => Object.keys(m), read: (p) => m[p] });
const nextRepo = files({ "package.json": JSON.stringify({ dependencies: { next: "15.5.0", react: "19.1.0" } }), "components.json": "{}", "app/page.tsx": "export default function P() { return null; }" });
const nextTailwind = files({ "package.json": JSON.stringify({ dependencies: { next: "15.5.0", react: "19.1.0", tailwindcss: "4" } }), "app/page.tsx": "export default function P() { return null; }" });
const viteMui = files({ "package.json": JSON.stringify({ dependencies: { vite: "7", react: "19", "@mui/material": "7" } }), "src/main.tsx": "" });
const project = (design: Partial<NonNullable<ProjectConfig["design"]>> = {}): ProjectConfig => ({ project: "demo", design: { brandFonts: [], navRaises: false, allowPrivateRefs: false, uiTargets: {}, ...design } }) as unknown as ProjectConfig;
const state = (info: Partial<RunState["info"]> = {}): RunState => ({ info: { runId: "run-1", mode: "brownfield", project: "demo", createdAt: "", ...info }, steps: new Map(), decisions: [] }) as unknown as RunState;
const design = sampleDesign();

describe("the UI target of a run", () => {
  it("builds the web apps with the detected kit and the phone app with the repo's own components", () => {
    const t = targetForRun({ design, src: nextRepo });
    expect(t).toMatchObject({ target: "next-shadcn", source: "detected", apps: ["portal"], repoApps: ["mobile"] });
  });

  it("takes the project's setting over the run's, and the run's over detection", () => {
    expect(targetForRun({ design, config: project({ uiTarget: "vite-shadcn" }).design, run: "next-shadcn", src: nextRepo })).toMatchObject({ target: "vite-shadcn", source: "config" });
    expect(targetForRun({ design, run: "vite-shadcn", src: nextRepo })).toMatchObject({ target: "vite-shadcn", source: "run" });
    // an app set to "repo" is built with the repo's own components; another kit app still gets the kit
    expect(targetForRun({ design: { apps: [{ id: "a", name: "A", device: "web" }, { id: "b", name: "B", device: "web" }] } as never, config: project({ uiTargets: { a: "repo" } }).design, src: nextRepo })).toMatchObject({ target: "next-shadcn", apps: ["b"], repoApps: ["a"] });
  });

  it("does not put a new app into an existing repo whose stack nothing shows, unless a target is set", () => {
    const bare = files({ "README.md": "# api", "main.go": "package main" });
    expect(targetForRun({ design, src: bare })).toMatchObject({ target: "repo" });
    expect(targetForRun({ design, src: bare, run: "vite-shadcn" })).toMatchObject({ target: "vite-shadcn", source: "run" });
    expect(targetForRun({ design })).toMatchObject({ target: "next-shadcn", source: "default" });
  });

  it("gives an empty repo (a new product, greenfield) a fresh next-shadcn app, like no repo at all", () => {
    for (const src of [files({}), files({ "README.md": "# shop", ".gitignore": "node_modules", "LICENSE": "MIT" })]) {
      expect(targetForRun({ design, src })).toMatchObject({ target: "next-shadcn", source: "default", detected: { why: "an empty repo: a fresh app" } });
      expect(targetForRun({ design, src, run: "vite-shadcn" })).toMatchObject({ target: "vite-shadcn", source: "run" });
    }
  });

  it("keeps a repo with another component library on its own components: no scaffold", () => {
    const s = scaffoldForRun({ state: state(), project: project(), design, designSha: "d".repeat(64), src: viteMui });
    expect(s).toMatchObject({ target: "repo", source: "detected" });
    expect(s.layout).toBeUndefined();
    expect(scaffoldView(s).files).toEqual([]);
  });

  it("keeps a Next.js app with Tailwind but not shadcn/ui on its own pages: no parallel kit app", () => {
    const s = scaffoldForRun({ state: state(), project: project(), design, designSha: "d".repeat(64), src: nextTailwind });
    expect(s).toMatchObject({ target: "repo", source: "detected" });
    expect(s.layout).toBeUndefined();
  });

  it("changes an existing app's tweaked and reused screens in its own page files; only new screens are generated", () => {
    const sized = { ...design, screens: design.screens.map((x, i) => ({ ...x, size: i === 0 ? "tweak" : i === 1 ? "reuse" : "new", ...(i === 0 ? { file: "app/page.tsx" } : {}) })) } as never;
    const s = scaffoldForRun({ state: state(), project: project(), design: sized, designSha: "d".repeat(64), src: nextRepo });
    const l = s.layout!;
    expect(l.inPlace.map((x) => [x.id, x.size])).toEqual([["S-1", "tweak"], ["S-2", "reuse"]]);
    expect(l.screens.map((x) => x.id)).not.toContain("S-1");
    expect(l.files.some((f) => f.path.includes("components/screens/s-1/"))).toBe(false);
    expect(l.files.some((f) => f.path.endsWith("frame.ts") || f.path.endsWith("providers.tsx"))).toBe(false);
    expect((scaffoldForPlan(s) as { changeInPlace: { id: string }[] }).changeInPlace.map((x) => x.id)).toEqual(["S-1", "S-2"]);
    const ds = { id: "TASK-1", fileScope: l.designSystem.files };
    const rest = l.screens.map((x, i) => ({ id: `TASK-${i + 2}`, fileScope: [x.container] }));
    const s2 = l.inPlace[1]!.file!;
    expect(checkPlanScaffold({ tasks: [ds, ...rest] }, s)).toEqual(["Screen S-1 (/, tweak): no task has its existing page app/page.tsx in scope", `Screen S-2 (/invoices/:id, reuse): no task has its existing page ${s2} in scope`]);
    expect(checkPlanScaffold({ tasks: [ds, ...rest, { id: "TASK-9", fileScope: ["app/page.tsx", s2] }] }, s)).toEqual([]);
    // only tweaks: nothing is generated, not even the kit or the theme
    const allTweak = { ...design, screens: design.screens.map((x) => ({ ...x, size: "tweak" })) } as never;
    const t = scaffoldForRun({ state: state(), project: project(), design: allTweak, designSha: "d".repeat(64), src: nextRepo }).layout!;
    expect(t.files).toEqual([]);
    expect(t.designSystem).toEqual({ files: [], todo: [] });
    expect(checkPlanScaffold({ tasks: [{ id: "TASK-1", fileScope: ["app/**"] }] }, { ...s, layout: t })).toEqual([]);
  });

  it("scaffolds a run with no repo as a fresh app, under the design's sha when there is no package yet", () => {
    const s = scaffoldForRun({ state: state(), project: project(), design, designSha: "d".repeat(64) });
    expect(s).toMatchObject({ target: "next-shadcn", source: "default" });
    expect(s.layout!.fresh).toBe(true);
    expect(s.layout!.files.find((f) => f.owner === "theme")!.text.split("\n")[0]).toContain(`ai-factory design ${"d".repeat(12)}`);
  });
});

describe("a change request", () => {
  it("names the screens added or changed and the ones removed", () => {
    const after = { screens: [{ ...design.screens[0]!, mock: { ...design.screens[0]!.mock!, title: "Home" } }, design.screens[1]!, { ...design.screens[2]!, id: "S-9" }] } as never;
    expect(changedScreens({ screens: design.screens.slice(0, 3) } as never, after)).toEqual({ changed: ["S-1", "S-9"], removed: ["S-3"] });
    expect(changedScreens(undefined, after)).toBeUndefined();
  });
});

describe("the plan against the scaffold", () => {
  const s = scaffoldForRun({ state: state(), project: project(), design, designSha: "d".repeat(64), src: nextRepo });
  const l = s.layout!;
  const ds = { id: "TASK-1", fileScope: l.designSystem.files };
  const screenTasks = l.screens.map((x, i) => ({ id: `TASK-${i + 2}`, fileScope: [x.container, "src/api/**"] }));

  it("gives the plan the design-system task's files and to-dos and each screen's container", () => {
    const v = scaffoldForPlan(s) as { designSystemTask: { fileScope: string[]; todo: string[] }; screens: { container: string }[] };
    expect(v.designSystemTask.fileScope).toEqual(expect.arrayContaining(["package.json", "app/layout.tsx"]));
    expect(v.designSystemTask.todo.join("\n")).toMatch(/link the new pages .* from the app's own navigation/);
    expect(v.designSystemTask.todo.join("\n")).not.toMatch(/DesignProviders/);
    expect(v.screens.map((x) => x.container)).toContain("components/screens/s-1/container.tsx");
  });

  it("passes a plan with the design-system task first and every container in scope", () => {
    expect(checkPlanScaffold({ tasks: [ds, ...screenTasks] }, s)).toEqual([]);
  });

  it("fails a plan whose first task is not the design-system task, that misses a container, or that lists a generated file", () => {
    const out = checkPlanScaffold({ tasks: [...screenTasks.slice(1), ds, { id: "TASK-9", fileScope: [l.screens[1]!.screen] }] }, s);
    expect(out[0]).toMatch(/first task must be the design-system task/);
    expect(out.some((m) => /Screen S-1 .*container/.test(m))).toBe(true);
    expect(out.some((m) => /TASK-9 lists .*s-2\/screen\.tsx, a file the factory generates/.test(m))).toBe(true);
  });

  it("plans only the changed screens of a change request", () => {
    const only = { ...s, changed: ["S-2"] };
    expect((scaffoldForPlan(only) as { screens: { id: string }[] }).screens.map((x) => x.id)).toEqual(["S-2"]);
    expect(checkPlanScaffold({ tasks: [ds, screenTasks[1]!] }, only)).toEqual([]);
  });

  it("points gate B7 at each screen's container, since the page is generated", () => {
    const breakdown = { tasks: l.screens.map((x, i) => ({ id: `EST-${i + 1}`, screen: x.id })) } as never;
    const plan = { tasks: screenTasks.map((t, i) => ({ ...t, estimateTaskId: `EST-${i + 1}` })) };
    expect(screenScopeGaps(plan, breakdown, design as never).length).toBeGreaterThan(0);
    expect(screenScopeGaps(plan, breakdown, designForScopeGate(design, s) as never)).toEqual([]);
    expect(designForScopeGate(design, undefined)).toBe(design);
  });

  it("protects the generated files and leaves the containers and routes to the tasks", () => {
    expect(l.protected).toEqual(expect.arrayContaining(["components/screens/s-1/screen.tsx", "components/screens/s-1/fixtures.ts"]));
    expect(l.protected).not.toContain("components/screens/frame.ts"); // an existing app keeps its own frame
    for (const x of l.screens) expect(l.protected).not.toContain(x.container);
    expect(l.protected).not.toContain("app/page.tsx");
  });
});

describe("the scaffold of a run's approved design", () => {
  const ledger = { getJson: () => design } as unknown as Ledger;
  const seeded = state({ designRef: { runId: "run-0", designSha: "e".repeat(64) } as never, uiTarget: "vite-shadcn" });

  it("is computed from the approved design with the run's --ui-target", () => {
    const s = scaffoldOfRun({ state: seeded, ledger, project: project(), log: () => {} });
    expect(s).toMatchObject({ target: "vite-shadcn", source: "run" });
    expect(s!.layout!.screens.map((x) => x.id)).toEqual(["S-1", "S-2", "S-3", "S-4", "S-5", "S-7"]);
  });

  it("is absent without an approved design, and logged instead of failing the build when it cannot be made", () => {
    expect(scaffoldOfRun({ state: state(), ledger, project: project(), log: () => {} })).toBeUndefined();
    const logs: string[] = [];
    const broken = { getJson: () => ({ ...design, get theme() { throw new Error("unreadable theme"); } }) } as unknown as Ledger;
    expect(scaffoldOfRun({ state: seeded, ledger: broken, project: project(), log: (m) => logs.push(m) })).toBeUndefined();
    expect(logs[0]).toMatch(/scaffold: not generated \(unreadable theme\)/);
  });

  it("previews another target for the CLI and the UI, and refuses a run with no design", () => {
    const p = scaffoldPreview(seeded, ledger, project({ uiTarget: "vite-shadcn" }), { target: "next-shadcn" });
    expect(p).toMatchObject({ target: "next-shadcn", source: "config" });
    const v = scaffoldView(p);
    expect(v.files.some((f) => f.path === "app/design-theme.css" && f.owner === "theme" && f.regenerate)).toBe(true);
    expect(v.summary).toMatch(/UI target next-shadcn/);
    expect(() => scaffoldPreview(state(), ledger, project())).toThrow(/no approved design/);
  });
});

describe("the design size cap's starting point (PR #11 review, item 11)", () => {
  const state = (data: Record<string, unknown> | undefined) => ({ info: { baseCommit: "base" }, steps: new Map(data ? [["stub-commit", { data }]] : []) }) as never;
  it("measures the agents' UI change from the scaffold commit, so the generated pages are not counted", () => {
    expect(uiBase(state({ designCommit: "design", scaffold: { commit: "scaffold" } }))).toBe("scaffold");
    expect(uiBase(state({ designCommit: "design", scaffold: { target: "repo" } }))).toBe("design");
    expect(uiBase(state({}))).toBe("base");
    expect(uiBase(state(undefined))).toBe("base");
  });
});
