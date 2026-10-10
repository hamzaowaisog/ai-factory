// The design step on the stitch engine: Claude lists the screens and writes a DESIGN.md by following the stitch-design-taste
// skill; Stitch draws each screen. Runs with an in-memory ledger, a scripted model and a fake Stitch client.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import { setStitchFactory, type StitchClient } from "../design/stitch.js";
import type { StepContext } from "./framework.js";
import { setProviderFactory } from "./think.js";
import { drawWithStitch, setA11yCheck, stitchArtifact, stitchFrames } from "./design-stitch.js";

const U = { inputTokens: 1000, outputTokens: 200, cacheRead: 0, cacheWrite: 0 };
const reqs = [{ id: "REQ-1", ears: "The system shall list payees." }, { id: "REQ-2", ears: "The system shall add a payee." }];
const spec = { requirements: reqs } as never;
const plan = (over: Record<string, unknown> = {}) => ({
  flow: "Payees, then add a payee.",
  screens: [
    { id: "S-1", title: "Payees", route: "/payees", file: "app/payees/page.tsx", reqs: ["REQ-1"], states: ["empty"], prompt: "A payees list for a bank app: name, bank, IBAN, status." },
    { id: "S-2", title: "Add payee", route: "/payees/new", file: "app/payees/new/page.tsx", reqs: ["REQ-2"], states: [], prompt: "A form to add a payee: name, bank, IBAN, nickname; submit Add payee." },
  ],
  noScreen: [], brand: { colours: ["#0F766E"], fonts: [] }, ...over,
});
const md = (brand = "#0F766E") => `# Design System: Payees\n## 1. Visual Theme & Atmosphere\nCalm, balanced, a daily banking app with clear hierarchy and quiet surfaces throughout.\n## 2. Color Palette & Roles\n- **Canvas** (#F9FAFB) — background\n- **Brand Teal** (${brand}) — the one accent\n## 3. Typography Rules\n- **Display:** Geist\n## 4. Component Stylings\nFlat buttons.\n## 5. Layout Principles\nGrid first.\n## 7. Anti-Patterns (Banned)\n- No emojis`;

let answers: unknown[] = [];
let systems: string[] = [];
let users: string[] = [];
let models: string[] = [];
const provider: Provider = {
  start(m, _e, system, user): Conversation {
    models.push(m);
    return { async next(): Promise<Turn> { systems.push(system); users.push(user); const a = answers.shift(); if (!a) throw new Error("no scripted answer"); return { calls: [{ id: "s", name: "submit_result", input: a }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

const theme = { colorMode: "LIGHT", headlineFont: "GEIST", bodyFont: "GEIST", roundness: "ROUND_EIGHT", customColor: "#0F766E" };
interface Made { projects: string[]; systems: { name: string; theme: Record<string, unknown> }[]; generated: { prompt: string; device: string }[]; edits: { screenId: string; prompt: string }[]; closed: number }
let made: Made;
const fakeStitch = (fail = false): StitchClient => ({
  async createProject(title) { made.projects.push(title); return "proj-1"; },
  async createDesignSystem(_p, name, t) { made.systems.push({ name, theme: t }); },
  async generate(_p, prompt, device) { if (fail) throw new Error("Stitch is down"); made.generated.push({ prompt, device }); const n = made.generated.length; return { screenId: `scr-${n}`, htmlUrl: `html-${n}`, imageUrl: `img-${n}` }; },
  async download(url) { return new TextEncoder().encode(url.startsWith("html") ? `<html><body><h1>Page ${url}</h1><button>Save payee</button></body></html>` : `PNG-${url}`); },
  async edit(_p, screenId, prompt) { made.edits.push({ screenId, prompt }); const n = made.generated.length + made.edits.length; return { screenId: `edited-${n}`, htmlUrl: `html-e${n}`, imageUrl: `img-e${n}` }; },
  async close() { made.closed++; },
});

const CREATED = { seq: 1, ts: "2026-10-09T00:00:00.000Z", runId: "r1", type: "run.created", data: { mode: "design", project: "demo", request: "payees", operator: "sam" } } as never;
function memoryLedger() {
  const dir = mkdtempSync(join(tmpdir(), "stitch-ledger-"));
  const store = new Map<string, Buffer>();
  const put = (c: string | Uint8Array) => { const b = Buffer.from(c); const sha = createHash("sha256").update(b).digest("hex"); store.set(sha, b); return sha; };
  return {
    dir, events: () => [CREATED],
    putArtifact: put, putJson: (v: unknown) => put(JSON.stringify(v)),
    getArtifact: (sha: string) => store.get(sha)!,
    getJson: <T>(sha: string) => JSON.parse(store.get(sha)!.toString()) as T,
  };
}

const project = (design: Record<string, unknown> = {}) => ProjectConfig.parse({ project: "demo", repo: "-", stack: "dotnet", design: { engine: "stitch", allowStitch: true, tier: "standard", ...design } });
function ctxFor(ledger: ReturnType<typeof memoryLedger>, rung = 0, design: Record<string, unknown> = {}): StepContext {
  return {
    runId: "r1", ledger: ledger as never, writer: {} as never, state: replay([CREATED]),
    project: project(design), policy: DEFAULT_POLICY, attempt: 1, rung, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
}

beforeEach(() => {
  process.env.FACTORY_NO_CACHE = "1";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "stitch-home-"));
  _resetEnvCache();
  answers = []; systems = []; users = []; models = [];
  made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
  setProviderFactory(() => provider);
  setStitchFactory(() => fakeStitch());
  setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: [] })));
});
afterEach(() => { setStitchFactory(undefined); setA11yCheck(undefined); delete process.env.FACTORY_NO_CACHE; });

describe("the stitch design artifact", () => {
  it("points each screen at its frames, the normal page first, and keeps routes and requirements", () => {
    const a = stitchArtifact(plan() as never, [
      { id: "S-2", state: "normal", name: "stitch-S-2-normal-22222222.png", screenId: "scr-2", html: "h2", image: "i2" },
      { id: "S-1", state: "empty", name: "stitch-S-1-empty-33333333.png", screenId: "scr-3", html: "h3", image: "i3" },
      { id: "S-1", state: "normal", name: "stitch-S-1-normal-11111111.png", screenId: "scr-1", html: "h1", image: "i1" },
    ], { projectId: "proj-1", model: "stitch-default", designMd: "m" }, ["REQ-1", "REQ-2"]);
    expect(a.engine).toBe("stitch");
    expect(a.screens.map((s) => [s.id, s.route, s.reqs, s.frames])).toEqual([["S-1", "/payees", ["REQ-1"], ["ST-1", "ST-2"]], ["S-2", "/payees/new", ["REQ-2"], ["ST-3"]]]);
    expect(a.mapping).toEqual({ unmappedReqs: [], orphanScreens: [] });
    expect(a.stitch.frames["ST-1"]).toEqual({ screen: "S-1", state: "normal", name: "stitch-S-1-normal-11111111.png", screenId: "scr-1", html: "h1", image: "i1" });
    expect(a.stitch.frames["ST-2"]).toMatchObject({ screen: "S-1", state: "empty" });
  });

  it("lists the Stitch frames for the approval card, and none for a JSON design", () => {
    expect(stitchFrames({ stitch: { frames: { "ST-1": { name: "stitch-S-1.png" } } } })).toEqual([{ id: "ST-1", name: "stitch-S-1.png" }]);
    expect(stitchFrames({})).toEqual([]);
  });
});

describe("drawing with stitch", () => {
  it("writes DESIGN.md with the taste skill, makes one project and design system, and draws each screen with the tier's model", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    expect(systems[1]).toContain("Stitch Design Taste");
    expect(systems[1]).toContain("win over the skill's taste rules");
    expect(made.projects).toHaveLength(1);
    expect(made.systems).toEqual([{ name: expect.any(String), theme: { ...theme, designMd: md() } }]);
    // S-1 lists an empty state, which the default design.stitch.states draws: three generations
    expect(made.generated.map((g) => g.device)).toEqual(["DESKTOP", "DESKTOP", "DESKTOP"]);
    expect(made.generated.filter((g) => /empty state/.test(g.prompt))).toHaveLength(1);
    expect(models).toEqual(["claude-sonnet-5", "claude-sonnet-5"]);
    expect(made.closed).toBe(1);
    const files = readdirSync(join(ledger.dir, "attachments", "frames"));
    expect(files).toHaveLength(3);
    for (const f of files) expect(f).toMatch(/^stitch-S-\d+-(normal|empty)-[0-9a-f]{8}\.png$/);
    const d = ledger.getJson<{ engine: string; theme: unknown; themeSource: string; screens: { frames: string[]; facts?: { title?: string; buttons: string[] } }[]; stitch: { model: string; theme: unknown } }>((out as { outputs: { design: string } }).outputs.design);
    expect(d.theme).toMatchObject({ brand: "#0F766E", mode: "light" });
    expect(d.themeSource).toBe("new");
    expect(d.screens[0]!.facts).toMatchObject({ title: "Page html-1", buttons: ["Save payee"] });
    expect(d.stitch.theme).toEqual(theme);
    expect(d.engine).toBe("stitch");
    expect(d.stitch.model).toBe("stitch-default");
    expect(d.screens.map((s) => s.frames)).toEqual([["ST-1", "ST-2"], ["ST-3"]]);
  });

  it("plans with the next tier's Claude model after a step up", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger(), 2), spec);
    expect(models).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
  });

  it("fails a screen list that leaves a requirement out, before any Stitch call", async () => {
    answers = [plan({ screens: [plan().screens[0]] })];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "design-unmapped" })] });
    expect(made.projects).toEqual([]);
  });

  it("fails a DESIGN.md that drops the brand colour, before any Stitch call", async () => {
    answers = [plan(), { designMd: md("#2563EB"), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "stitch-designmd-brand" })] });
    expect(made.projects).toEqual([]);
  });

  it("parks on a Stitch error instead of climbing to a stronger model, and still closes the client", async () => {
    setStitchFactory(() => fakeStitch(true));
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/Stitch failed: Stitch is down/) });
    expect(made.closed).toBe(1);
  });

  it("gives both calls the lead's send-back reasons, the existing look and the references", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec, { feedback: ["make the header teal"], look: { brand: "#0F766E", font: "Lato" }, refs: { refs: [{ id: "R-1", took: "card layout" }] } });
    for (const u of users) { expect(u).toContain("make the header teal"); expect(u).toContain("Lato"); expect(u).toContain("card layout"); }
    expect(users).toHaveLength(2);
  });

  it("holds DESIGN.md to the project's brand fonts", async () => {
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger(), 0, { brandFonts: ["Lato"] }), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "stitch-designmd-brand", message: expect.stringContaining("Lato") })] });
  });
});

describe("Stitch screens on the approval demo", () => {
  it("shows a Stitch screenshot in place of a drawn page", async () => {
    const { buildDemo, frameDataUri } = await import("../design/demo.js");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const dataUri = frameDataUri("stitch-S-1.png", png, 0)!;
    const html = buildDemo({
      title: "Payees", flow: "Payees", requirements: { "REQ-1": "The system shall list payees." }, noScreen: [],
      screens: [{ id: "S-1", route: "/payees", file: "app/payees/page.tsx", reqs: ["REQ-1"], states: [], size: "new", frames: ["ST-1"] }],
      frames: { "ST-1": { name: "stitch-S-1.png", dataUri } },
    });
    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(html).toContain(dataUri);
  });
});

describe("the approval step's frames", () => {
  it("adds the design's Stitch frames to the frames the request attached", async () => {
    const { framesFor } = await import("./design-approve.js");
    const request = "a payees page";
    expect(framesFor(request, { stitch: { frames: { "ST-1": { name: "stitch-S-1.png" } } } })).toEqual([{ id: "ST-1", name: "stitch-S-1.png" }]);
    expect(framesFor(request, {})).toEqual([]);
  });
});

describe("extra states", () => {
  it("draws only the states a screen lists and the project allows", async () => {
    answers = [plan({ screens: [{ ...plan().screens[0], states: ["empty", "loading"] }, { ...plan().screens[1], states: ["validation"] }] }), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger(), 0, { stitch: { states: ["validation", "loading"] } }), spec);
    expect(out.kind).toBe("done");
    expect(made.generated.map((g) => /in its (\w+) state/.exec(g.prompt)?.[1] ?? "normal").sort()).toEqual(["loading", "normal", "normal", "validation"]);
  });
});

describe("the approval preview's frames", () => {
  it("lists an image frame too large to embed, but not a missing or non-image one", async () => {
    const { previewFrames } = await import("./design-approve.js");
    const screens = [{ id: "S-1", frames: ["ST-1"] }, { id: "S-2", frames: ["ST-2"] }, { id: "S-3", frames: ["F-1"] }, { id: "S-4", frames: ["ST-4"] }];
    const frames = { "ST-1": { name: "stitch-S-1.png", dataUri: "data:image/png;base64,AA" }, "ST-2": { name: "stitch-S-2.png" }, "F-1": { name: "notes.pdf" }, "ST-4": { name: "stitch-S-4.png" } };
    const has = (n: string) => n !== "stitch-S-4.png";
    expect(previewFrames(screens, frames, has).map((x) => [x.screen.id, x.name])).toEqual([["S-1", "stitch-S-1.png"], ["S-2", "stitch-S-2.png"]]);
  });
});

describe("rework of a Stitch design", () => {
  type D = { screens: { id: string; frames: string[]; facts?: { title?: string } }[]; revision?: number; rework?: { patched: string[] }[]; stitch: { projectId: string; frames: Record<string, { screen: string; state: string; name: string; html: string }>; prompts: Record<string, string> } };
  async function first(ledger: ReturnType<typeof memoryLedger>): Promise<D> {
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    const d = ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design);
    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    return d;
  }

  it("edits only the screen the lead named and keeps the rest", async () => {
    const ledger = memoryLedger();
    const prev = await first(ledger);
    expect(prev.stitch.prompts["S-2"]).toContain("form to add a payee");
    answers = [{ redraw: false, screens: [{ id: "S-2", change: "The submit button says Save payee." }] }];
    const out = await drawWithStitch(ctxFor(ledger), spec, { feedback: ["make the Add payee button say Save payee"], previous: prev as never });
    expect(out.kind).toBe("done");
    expect(made.edits).toHaveLength(1);
    expect(made.edits[0]!.prompt).toContain("Save payee");
    expect(made.generated).toEqual([]);
    expect(made.projects).toEqual([]);
    expect(made.systems).toEqual([]);
    const d = ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design);
    const s1 = (x: D) => Object.values(x.stitch.frames).filter((f) => f.screen === "S-1");
    expect(s1(d)).toEqual(s1(prev));
    expect(d.stitch.projectId).toBe(prev.stitch.projectId);
    expect(d.revision).toBe(1);
    expect(d.rework?.[0]?.patched).toEqual(["S-2"]);
  });

  it("redraws the whole design when the triage says so", async () => {
    const ledger = memoryLedger();
    const prev = await first(ledger);
    answers = [{ redraw: true, screens: [] }, plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec, { feedback: ["make it darker"], previous: prev as never });
    expect(out.kind).toBe("done");
    expect(made.projects).toHaveLength(1);
    expect(made.edits).toEqual([]);
    expect(made.generated.length).toBeGreaterThanOrEqual(2);
  });

  it("redraws the whole design when the triage names no screen the design has", async () => {
    const ledger = memoryLedger();
    const prev = await first(ledger);
    answers = [{ redraw: false, screens: [{ id: "S-9", change: "Use a two-column layout." }] }, plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec, { feedback: ["change the settings page"], previous: prev as never });
    expect(out).toMatchObject({ kind: "done" });
    expect(made.projects).toHaveLength(1);
    expect(made.edits).toEqual([]);
  });
});

describe("Stitch files for the design package", () => {
  it("lists the DESIGN.md and each frame's HTML, by screen and state", async () => {
    const { stitchPackageFiles } = await import("./design-stitch.js");
    const store = new Map<string, Buffer>([["md", Buffer.from("# DS")], ["h1", Buffer.from("<p>1</p>")], ["h1e", Buffer.from("<p>1e</p>")], ["h2", Buffer.from("<p>2</p>")]]);
    const design = { engine: "stitch", stitch: { designMd: "md", frames: {
      "ST-1": { screen: "S-1", state: "normal", html: "h1" }, "ST-2": { screen: "S-1", state: "empty", html: "h1e" }, "ST-3": { screen: "S-2", state: "normal", html: "h2" },
    } } };
    const files = stitchPackageFiles(design as never, (sha) => store.get(sha)!);
    expect(files.map((f) => f.path)).toEqual(["screens/DESIGN.md", "screens/S-1.html", "screens/S-1-empty.html", "screens/S-2.html"]);
    expect(files[2]!.content.toString()).toBe("<p>1e</p>");
    expect(stitchPackageFiles({ screens: [] } as never, () => Buffer.alloc(0))).toEqual([]);
  });
});

describe("accessibility of Stitch screens", () => {
  type D = { stitch: { a11y?: { screen: string; rules: string[] }[] } };
  it("gives a failing screen one Stitch fix and records nothing open when the fix works", async () => {
    let round = 0;
    setA11yCheck(async (pages) => { round++; return pages.map((p) => ({ id: p.id, violations: round === 1 && p.id === "S-1" ? [{ id: "button-name", targets: ["button.icon"] }] : [] })); });
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(made.edits).toHaveLength(1);
    expect(made.edits[0]!.prompt).toMatch(/button-name/);
    expect(ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design).stitch.a11y).toBeUndefined();
  });

  it("records what still fails after the fix", async () => {
    setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: p.id === "S-2" ? [{ id: "label", targets: ["input"] }] : [] })));
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(made.edits).toHaveLength(1);
    expect(ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design).stitch.a11y).toEqual([{ screen: "S-2", rules: ["label"] }]);
  });

  it("goes on with a note when no browser can check", async () => {
    setA11yCheck(async () => undefined);
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out.kind).toBe("done");
    expect(made.edits).toEqual([]);
  });
});

describe("the approval card", () => {
  it("lists the accessibility problems Stitch could not fix", async () => {
    const { designCard } = await import("./design-approve.js");
    const design = { flow: "f", screens: [{ id: "S-1", route: "/", file: "x", reqs: ["REQ-1"], states: [], frames: [] }], mapping: { unmappedReqs: [], orphanScreens: [] }, stitch: { a11y: [{ screen: "S-1", rules: ["button-name"] }] } };
    const card = designCard("r1", design as never, "a".repeat(64));
    expect(card).toContain("Accessibility, still open (Stitch could not fix these):");
    expect(card).toContain("- S-1: button-name");
  });
});

describe("rework guards (review C1, I1, I2)", () => {
  type D = { revision?: number; mapping: { unmappedReqs: string[] }; stitch: { prompts?: Record<string, string>; frames: Record<string, Record<string, unknown>> } };
  async function first(ledger: ReturnType<typeof memoryLedger>): Promise<D> {
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    users = [];
    return ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design);
  }
  const designOf = (ledger: ReturnType<typeof memoryLedger>, out: unknown) => ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design);

  it("does not rework again when every send-back is already answered, and keeps the revision", async () => {
    const ledger = memoryLedger();
    const prev = { ...(await first(ledger)), revision: 1 };
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec, { feedback: ["rename the button"], previous: prev as never });
    expect(made.edits).toEqual([]);
    expect(made.projects).toHaveLength(1);
    expect(designOf(ledger, out).revision).toBe(1);
  });

  it("redraws whole when the spec gained a requirement the earlier screens do not cover", async () => {
    const ledger = memoryLedger();
    const prev = await first(ledger);
    const spec3 = { requirements: [...reqs, { id: "REQ-3", ears: "The system shall export payees." }] } as never;
    const p3 = plan({ screens: [plan().screens[0], { ...plan().screens[1], reqs: ["REQ-2", "REQ-3"] }] });
    answers = [p3, { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec3, { feedback: ["rename the button"], previous: prev as never });
    expect(made.edits).toEqual([]);
    expect(made.projects).toHaveLength(1);
    expect(designOf(ledger, out).mapping.unmappedReqs).toEqual([]);
    expect(designOf(ledger, out).revision).toBe(1);
  });

  it("gives the triage only the new reasons, the answered ones as reference", async () => {
    const ledger = memoryLedger();
    const prev = { ...(await first(ledger)), revision: 1 };
    answers = [{ redraw: false, screens: [{ id: "S-2", change: "The submit button is teal." }] }];
    await drawWithStitch(ctxFor(ledger), spec, { feedback: ["old: rename the button", "new: make the button teal"], previous: prev as never });
    const triage = users[0]!;
    expect(triage).toMatch(/"reasons":\s*\[\s*"new: make the button teal"/);
    expect(triage).toMatch(/"alreadyAnswered":\s*\[\s*"old: rename the button"/);
  });

  it("redraws whole, without a crash, a Stitch design stored before frames named their screen", async () => {
    const ledger = memoryLedger();
    const prev = await first(ledger);
    const legacy = { ...prev, stitch: { ...prev.stitch, prompts: undefined, frames: Object.fromEntries(Object.entries(prev.stitch.frames).map(([k, f]) => [k, { name: f.name, screenId: f.screenId, html: f.html, image: f.image }])) } };
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec, { feedback: ["rename the button"], previous: legacy as never });
    expect(out.kind).toBe("done");
    expect(made.edits).toEqual([]);
    expect(made.projects).toHaveLength(1);
  });
});

describe("accessibility faults never cost the drawn screens (review I3)", () => {
  it("goes on when the browser check throws", async () => {
    setA11yCheck(async () => { throw new Error("chromium: missing libnss3"); });
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out.kind).toBe("done");
    expect(made.edits).toEqual([]);
  });

  it("keeps the page and records the rules open when the Stitch fix fails", async () => {
    setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: p.id === "S-1" ? [{ id: "button-name", targets: ["button"] }] : [] })));
    setStitchFactory(() => ({ ...fakeStitch(), async edit() { throw new Error("edit_screens failed"); } }));
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    const d = ledger.getJson<{ screens: { frames: string[] }[]; stitch: { a11y?: unknown } }>((out as { outputs: { design: string } }).outputs.design);
    expect(d.stitch.a11y).toEqual([{ screen: "S-1", rules: ["button-name"] }]);
    expect(d.screens[0]!.frames.length).toBeGreaterThan(0);
  });
});

describe("larger Stitch screenshots", () => {
  const PNG = (tag: string, size = 64) => { const b = Buffer.alloc(size, 0); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write(tag, 8); return new Uint8Array(b); };
  async function drawWith(large: (url: string) => Promise<Uint8Array>) {
    setStitchFactory(() => ({ ...fakeStitch(), async download(url: string) {
      if (url.startsWith("html")) return new TextEncoder().encode("<html><body><h1>Page</h1></body></html>");
      return url.endsWith("=w1600") ? large(url) : PNG("small");
    } }));
    const ledger = memoryLedger();
    answers = [plan({ screens: [{ ...plan().screens[0], states: [] }, plan().screens[1]] }), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    const dir = join(ledger.dir, "attachments", "frames");
    return readdirSync(dir).map((n) => readFileSync(join(dir, n)).subarray(8, 13).toString());
  }
  it("keeps the larger picture when Stitch gives one", async () => {
    expect(await drawWith(async () => PNG("large"))).toEqual(["large", "large"]);
  });
  it("falls back to the normal picture when the larger one fails, is not an image, or is too big to show", async () => {
    expect(await drawWith(async () => { throw new Error("403"); })).toEqual(["small", "small"]);
    expect(await drawWith(async () => new TextEncoder().encode("<html>no</html>"))).toEqual(["small", "small"]);
    expect(await drawWith(async () => PNG("large", 2_100_000))).toEqual(["small", "small"]);
    expect(await drawWith(async () => PNG("large", 700_000))).toEqual(["small", "small"]);
  });
});
