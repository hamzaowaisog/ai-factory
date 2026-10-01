import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { approvedTokens, screenBrief, screenFor, screenScopeGaps, TOKENS_NOTE, type ApprovedDesign } from "./design-link.js";
import { themeCss } from "./demo.js";
import { designTokens } from "./tokens.js";
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
  it("hands a new look to the build as design tokens, and none for an existing app's look", () => {
    const b = screenBrief(design, screen);
    expect(b.tokensNote).toBe(TOKENS_NOTE);
    expect((b.tokens as ReturnType<typeof designTokens>).colour.light!.brand).toBe("#123456");
    expect(screenBrief({ ...design, themeSource: "repo", theme: undefined }, screen).tokens).toBeUndefined();
    expect(approvedTokens({ ...design, theme: "not a theme" })).toBeUndefined();
  });
  it("gives the build the very values the approved demo was drawn with", () => {
    const theme = { brand: "#0A6E5C", mode: "light", font: "humanist", heading: "slab", radius: "round", density: "compact", surface: "soft", neutral: "warm" } as never;
    const tk = designTokens(theme), demo = themeCss(theme);
    expect(Object.keys(tk.colour)).toEqual(["light"]);
    for (const [short, name] of [["bg", "background"], ["sf", "surface"], ["ink", "text"], ["br", "brand"], ["on", "on-brand"], ["bad", "danger"]] as const) {
      expect(demo).toContain(`--${short}:${tk.colour.light![name]};`);
      expect(tk.css).toContain(`--color-${name}:${tk.colour.light![name]};`);
    }
    expect(tk).toMatchObject({ radiusPx: 18, space: { padPx: 12, rowPx: 40 }, type: { headingWeight: 650 } });
    expect(tk.type.heading).toMatch(/Rockwell/);
    expect(tk.css).toContain("--radius:18px;");
    expect(tk.css).not.toContain("prefers-color-scheme");
  });
  it("gives both modes when the look follows the viewer's setting, and the body face for a matching heading", () => {
    const tk = designTokens({ brand: "#1F6FEB", mode: "auto", heading: "match", font: "sans" } as never);
    expect(Object.keys(tk.colour)).toEqual(["light", "dark"]);
    expect(tk.colour.dark!.background).not.toBe(tk.colour.light!.background);
    expect(tk.css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n  :root \{\n    --color-background:/);
    expect(tk.type.heading).toBe(tk.type.body);
    expect(tk.css).toContain("--font-heading:var(--font-body);");
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
