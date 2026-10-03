// The design checks added around the approved screen inventory: breakdown/design coverage (E1c), the build's
// screens-planned gate (B6), the clickable demo, and the design diff a change request shows.
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { buildDemo, frameDataUri } from "../design/demo.js";
import { designBaseline, designCoverage, screensPlanned } from "./gates.js";
import { diffDesigns } from "../design/diff.js";

const run = (g: { predicate: (i: any, p: any) => { passed: boolean; details: string; failures?: { check: string }[] } }, input: unknown) => g.predicate(input, DEFAULT_POLICY);
const checks = (g: Parameters<typeof run>[0], input: unknown) => (run(g, input).failures ?? []).map((f) => f.check).sort();
const task = (id: string, screen?: string, executor = "factory") => ({ id, title: id, featureId: "F-1", reqs: ["REQ-1"], items: [], track: "web", executor, dependsOn: [], complexity: "standard", ...(screen ? { screen } : {}) });
const design = { screens: [{ id: "S-1", route: "/login" }, { id: "S-2", route: "/home" }] };

describe("E1c: the breakdown and the approved design agree", () => {
  it("passes when every task screen is approved and every approved screen is built", () => {
    expect(run(designCoverage, { design, breakdown: { tasks: [task("EST-1", "S-1"), task("EST-2", "S-2"), task("EST-3")] } }).passed).toBe(true);
  });
  it("fails a task that cites a screen nobody approved, and an approved screen no task builds", () => {
    expect(checks(designCoverage, { design, breakdown: { tasks: [task("EST-1", "S-1"), task("EST-2", "S-9")] } })).toEqual(["e1c-unbuilt-screen", "e1c-unknown-screen"]);
  });
  it("fails a task that cites a screen when the request has no design", () => {
    expect(checks(designCoverage, { design: { skipped: true, screens: [] }, breakdown: { tasks: [task("EST-1", "S-1")] } })).toEqual(["e1c-unknown-screen"]);
    expect(checks(designCoverage, { design: null, breakdown: { tasks: [task("EST-1", "S-1")] } })).toEqual(["e1c-unknown-screen"]);
    expect(run(designCoverage, { design: null, breakdown: { tasks: [task("EST-1")] } }).passed).toBe(true);
  });
  it("fails a screen id or route used twice, however the route is cased or ends", () => {
    const d = { screens: [{ id: "S-1", route: "/login" }, { id: "S-1", route: "/Login/" }] };
    expect(checks(designCoverage, { design: d, breakdown: { tasks: [task("EST-1", "S-1")] } })).toEqual(["e1c-duplicate-id", "e1c-duplicate-route"]);
  });
  it("E1b also refuses a duplicate id in an approved design", () => {
    const d = { flow: "f", screens: [{ id: "S-1", route: "/a", file: "a", reqs: ["R-1"] }, { id: "S-1", route: "/b", file: "b", reqs: ["R-1"] }], mapping: { unmappedReqs: [], orphanScreens: [] } };
    expect(checks(designBaseline, { ui: true, design: d, approval: { decision: "approved", by: "lead" } })).toEqual(["e1b-duplicate"]);
  });
});

describe("B6: the build plans every approved screen", () => {
  const breakdown = { tasks: [task("EST-1", "S-1"), task("EST-2", "S-2"), task("EST-3", "S-2", "human")] };
  it("passes when the plan delivers a factory task for each screen", () => {
    expect(run(screensPlanned, { plan: { tasks: [{ id: "T-1", estimateTaskId: "EST-1" }, { id: "T-2", estimateTaskId: "EST-2" }] }, breakdown, design }).passed).toBe(true);
  });
  it("fails a screen whose factory tasks the plan leaves out; a human-only screen is outside the plan", () => {
    expect(checks(screensPlanned, { plan: { tasks: [{ id: "T-1", estimateTaskId: "EST-1" }] }, breakdown, design })).toEqual(["b6-screen"]);
    expect(run(screensPlanned, { plan: { tasks: [{ id: "T-1", estimateTaskId: "EST-1" }] }, breakdown: { tasks: [task("EST-1", "S-1"), task("EST-3", "S-2", "human")] }, design }).passed).toBe(true);
  });
  it("passes when the estimate had no design", () => {
    expect(run(screensPlanned, { plan: { tasks: [] }, breakdown, design: { skipped: true, screens: [] } }).passed).toBe(true);
  });
});

describe("the clickable demo", () => {
  const screen = (over = {}) => ({ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["empty", "error"], size: "new" as const, frames: [], ...over });
  const base = { title: "Portal", flow: "Sign in, then home", requirements: { "REQ-1": "The user shall sign in." }, noScreen: [{ req: "REQ-2", reason: "a job" }] };
  it("has a panel per screen, a button per state, links between screens and nothing fetched", () => {
    const html = buildDemo({ ...base, screens: [screen(), screen({ id: "S-2", route: "/home", states: [] })] });
    expect(html).toMatch(/id="S-1"/);
    expect(html).toMatch(/id="S-2"/);
    // the normal page always comes first, even when the listed states are all special ones
    expect(html).toMatch(/data-state="0" class="on">default</);
    expect(html).toMatch(/data-state="2">error</);
    expect(html).toMatch(/href="#S-2"/);
    expect(html).toMatch(/The user shall sign in\./);
    expect(html).toMatch(/default-src 'none'/);
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("escapes everything that came from the model or the request", () => {
    const html = buildDemo({ ...base, flow: "<script>alert(1)</script>", requirements: { "REQ-1": "<img src=x onerror=alert(2)>" }, screens: [screen({ route: '"><b>x', states: ["<u>"] })] });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<b>x/);
    expect(html).not.toMatch(/<u>/);
  });
  it("shows a cited frame in place of the wireframe", () => {
    const uri = frameDataUri("home.png", new Uint8Array([1, 2, 3]))!;
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const html = buildDemo({ ...base, screens: [screen({ frames: ["F-1"] })], frames: { "F-1": { name: "home.png", dataUri: uri } } });
    expect(html).toContain(`<img src="${uri}"`);
    expect(html).not.toMatch(/class="wire"/);
  });
  it("embeds only images that are small enough", () => {
    expect(frameDataUri("export.json", new Uint8Array(3))).toBeUndefined();
    expect(frameDataUri("huge.png", new Uint8Array(2_000_001))).toBeUndefined();
    expect(frameDataUri("a.png", new Uint8Array(10), 7_999_995)).toBeUndefined();
  });
});

describe("the design diff of a change request", () => {
  const s = (id: string, route: string, reqs: string[], states: string[] = []) => ({ id, route, reqs, states, size: "new" });
  it("lists added, removed and changed screens, and nothing when the design is unchanged", () => {
    const from = { screens: [s("S-1", "/login", ["R-1"]), s("S-2", "/old", ["R-1"])] };
    expect(diffDesigns(from, { screens: [s("S-1", "/login", ["R-1"]), s("S-2", "/old", ["R-1"])] })).toEqual([]);
    expect(diffDesigns(from, { screens: [s("S-1", "/signin", ["R-1", "R-2"], ["error"]), s("S-3", "/new", ["R-2"])] })).toEqual([
      "Changed screen S-1: route /login -> /signin; requirements R-1 -> R-1, R-2; states none -> error",
      "Added screen S-3 /new (R-2)",
      "Removed screen S-2 /old",
    ]);
  });
  it("treats an earlier estimate with no design as every screen added", () => {
    expect(diffDesigns(undefined, { screens: [s("S-1", "/a", ["R-1"])] })).toEqual(["Added screen S-1 /a (R-1)"]);
  });
});
