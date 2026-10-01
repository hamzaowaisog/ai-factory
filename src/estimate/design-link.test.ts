import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { screenBrief, screenFor, screenScopeGaps, type ApprovedDesign } from "./design-link.js";
import { screenScope } from "./gates.js";
import { designQuality, hasExistingLook } from "../stages/design.js";

const bd = { tasks: [{ id: "EST-1", screen: "S-1" }, { id: "EST-2" }] } as never;
const screen = { id: "S-1", route: "/login", file: "src/pages/login.tsx", reqs: ["R-1"], states: ["error"], mock: { title: "Sign in" } };
const design: ApprovedDesign = { flow: "login then home", screens: [screen], theme: { brand: "#123456" }, themeSource: "new" };

describe("approved design reaches the build", () => {
  it("finds the screen an estimate task builds, and none for a skipped design or a task with no screen", () => {
    expect(screenFor(bd, design, "EST-1")?.id).toBe("S-1");
    expect(screenFor(bd, design, "EST-2")).toBeUndefined();
    expect(screenFor(bd, { skipped: true, screens: [] }, "EST-1")).toBeUndefined();
    expect(screenFor(bd, undefined, "EST-1")).toBeUndefined();
  });
  it("tells the implementer the new theme for a new product, and the existing app's tokens for an existing one", () => {
    expect(screenBrief(design, screen).look).toEqual({ brand: "#123456" });
    expect(String(screenBrief({ ...design, themeSource: "repo", theme: undefined }, screen).look)).toMatch(/existing app's design tokens/);
    expect(screenBrief(design, screen)).toMatchObject({ route: "/login", file: "src/pages/login.tsx", states: ["error"], sampleContent: { title: "Sign in" } });
  });
  it("B7 fails a plan task whose file scope leaves out the screen's file, and passes when it covers it", () => {
    const task = (fileScope: string[]) => ({ tasks: [{ id: "T-1", estimateTaskId: "EST-1", fileScope }] });
    expect(screenScopeGaps(task(["src/api/**"]), bd, design)).toEqual([{ task: "T-1", screen: "S-1", file: "src/pages/login.tsx" }]);
    expect(screenScopeGaps(task(["src/pages/**"]), bd, design)).toEqual([]);
    const run = (p: unknown) => screenScope.predicate({ plan: p, breakdown: bd, design } as never, DEFAULT_POLICY);
    expect(run(task(["src/api/**"])).passed).toBe(false);
    expect(run(task(["src/pages/login.tsx"])).passed).toBe(true);
  });
});

describe("an existing app keeps its look", () => {
  const out = { screens: [{ id: "S-1", route: "/a", file: "a", reqs: ["R-1"], states: [], size: "tweak", frames: [], mock: { title: "t", blocks: [{ type: "text", body: "x" }, { type: "text", body: "y" }] } }] } as never;
  it("needs a theme for a new product but not for an existing app", () => {
    expect(designQuality(out).map((q) => q.check)).toContain("design-no-theme");
    expect(designQuality(out, true).map((q) => q.check)).not.toContain("design-no-theme");
  });
  it("counts a repo as having a look only when it has pages and some design system", () => {
    const inv = (verdict: string, pages: number) => ({ verdict, pages: Array(pages).fill({}) }) as never;
    expect(hasExistingLook(inv("consistent", 3))).toBe(true);
    expect(hasExistingLook(inv("partial", 1))).toBe(true);
    expect(hasExistingLook(inv("none", 3))).toBe(false);
    expect(hasExistingLook(inv("consistent", 0))).toBe(false);
    expect(hasExistingLook(undefined)).toBe(false);
  });
});
