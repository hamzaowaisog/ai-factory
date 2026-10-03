import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { approvedTokens, screenBrief, screenFacts, screenFor, screenForTask, screenScopeGaps, TOKENS_NOTE, type ApprovedDesign } from "./design-link.js";
import { themeCss } from "../design/demo.js";
import { designTokens } from "../design/tokens.js";
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
  it("finds a plan task's screen without an estimate: by its page file in scope, else by the one screen sharing its requirements", () => {
    const two: ApprovedDesign = { screens: [screen, { id: "S-2", route: "/home", file: "src/pages/home.tsx", reqs: ["R-2", "R-3"] }] };
    expect(screenForTask(two, { fileScope: ["src/pages/home.tsx", "src/api/**"] })?.id).toBe("S-2");
    expect(screenForTask(two, { fileScope: ["src/api/**"], reqs: ["R-1"] })?.id).toBe("S-1");
    // a glob over both pages, or requirements no screen has: no one screen is this task's
    expect(screenForTask(two, { fileScope: ["src/pages/**"], reqs: ["R-1"] })).toBeUndefined();
    expect(screenForTask(two, { fileScope: ["src/api/**"], reqs: ["R-9"] })).toBeUndefined();
    // the estimate's own link wins, and a skipped design gives none
    expect(screenForTask(two, { fileScope: ["src/pages/home.tsx"] }, screen)?.id).toBe("S-1");
    expect(screenForTask({ skipped: true, screens: [screen] }, { fileScope: ["src/pages/login.tsx"] })).toBeUndefined();
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
    // an in-app switch overrides the viewer's setting either way
    expect(tk.css).toContain(`:root[data-theme="dark"] {\n  color-scheme:dark;\n  --color-background:${tk.colour.dark!.background};`);
    expect(tk.css).toContain(`:root[data-theme="light"] {\n  color-scheme:light;\n  --color-background:${tk.colour.light!.background};`);
    expect(designTokens({ brand: "#1F6FEB", mode: "light", heading: "match", font: "sans" } as never).css).not.toContain("data-theme");
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

describe("the acceptance tests see the approved screens (PR #11 review, item 13)", () => {
  const design: ApprovedDesign = { flow: "f", screens: [
    { id: "S-1", route: "/payees", file: "a.tsx", reqs: ["REQ-1"], states: ["empty", "error"], mock: {
      title: "Payees", copy: { emptyTitle: "No payees yet", error: "We couldn't load your payees" },
      blocks: [{ type: "form", fields: [{ label: "IBAN" }, { label: "Nickname" }], submit: "Add payee" }, { type: "table", columns: ["Name", "IBAN"] }, { type: "actions", buttons: ["Export", { label: "Delete", variant: "danger" }] }],
      toasts: [{ after: "Add payee", text: "Payee added" }],
    } },
    { id: "S-2", route: "/settings", file: "b.tsx", reqs: ["REQ-2"], change: "Add a Remember me checkbox." },
  ] };
  it("gives each criterion's screen its route, states and exact words, and a note's change", () => {
    expect(screenFacts(design, ["REQ-1"])).toEqual([{
      screen: "S-1", route: "/payees", reqs: ["REQ-1"], states: ["empty", "error"], title: "Payees",
      buttons: ["Add payee", "Export", "Delete"], fields: ["IBAN", "Nickname"], columns: ["Name", "IBAN"],
      messages: { emptyTitle: "No payees yet", error: "We couldn't load your payees" }, toasts: ["Payee added"],
    }]);
    expect(screenFacts(design, ["REQ-2"])[0]).toMatchObject({ screen: "S-2", change: "Add a Remember me checkbox.", buttons: [] });
    expect(screenFacts(design, ["REQ-9"])).toEqual([]);
    expect(screenFacts({ ...design, skipped: true }, ["REQ-1"])).toEqual([]);
  });
});
