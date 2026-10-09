// The design step on the stitch engine: Claude lists the screens and writes a DESIGN.md by following the stitch-design-taste
// skill; Stitch draws each screen. Runs with an in-memory ledger, a scripted model and a fake Stitch client.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
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
import { drawWithStitch, stitchArtifact, stitchFrames } from "./design-stitch.js";

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
const provider: Provider = {
  start(_m, _e, system): Conversation {
    return { async next(): Promise<Turn> { systems.push(system); const a = answers.shift(); if (!a) throw new Error("no scripted answer"); return { calls: [{ id: "s", name: "submit_result", input: a }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

interface Made { projects: string[]; systems: { name: string; guidelines: string }[]; generated: { prompt: string; device: string; model: string }[]; closed: number }
let made: Made;
const fakeStitch = (fail = false): StitchClient => ({
  async createProject(title) { made.projects.push(title); return "proj-1"; },
  async createDesignSystem(_p, name, guidelines) { made.systems.push({ name, guidelines }); },
  async generate(_p, prompt, device, model) { if (fail) throw new Error("Stitch is down"); made.generated.push({ prompt, device, model }); const n = made.generated.length; return { screenId: `scr-${n}`, htmlUrl: `html-${n}`, imageUrl: `img-${n}` }; },
  async download(url) { return new TextEncoder().encode(url.startsWith("html") ? `<html>${url}</html>` : `PNG-${url}`); },
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
function ctxFor(ledger: ReturnType<typeof memoryLedger>, rung = 0): StepContext {
  return {
    runId: "r1", ledger: ledger as never, writer: {} as never, state: replay([CREATED]),
    project: project(), policy: DEFAULT_POLICY, attempt: 1, rung, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
}

beforeEach(() => {
  process.env.FACTORY_NO_CACHE = "1";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "stitch-home-"));
  _resetEnvCache();
  answers = []; systems = [];
  made = { projects: [], systems: [], generated: [], closed: 0 };
  setProviderFactory(() => provider);
  setStitchFactory(() => fakeStitch());
});
afterEach(() => { setStitchFactory(undefined); delete process.env.FACTORY_NO_CACHE; });

describe("the stitch design artifact", () => {
  it("points each screen at its Stitch frame and keeps routes and requirements", () => {
    const a = stitchArtifact(plan() as never, [
      { id: "S-1", screenId: "scr-1", html: "h1", image: "i1" },
      { id: "S-2", screenId: "scr-2", html: "h2", image: "i2" },
    ], { projectId: "proj-1", model: "GEMINI_3_PRO", designMd: "m" }, ["REQ-1", "REQ-2"]);
    expect(a.engine).toBe("stitch");
    expect(a.screens.map((s) => [s.id, s.route, s.reqs, s.frames])).toEqual([["S-1", "/payees", ["REQ-1"], ["ST-1"]], ["S-2", "/payees/new", ["REQ-2"], ["ST-2"]]]);
    expect(a.mapping).toEqual({ unmappedReqs: [], orphanScreens: [] });
    expect(a.stitch.frames["ST-1"]).toEqual({ name: "stitch-S-1.png", screenId: "scr-1", html: "h1", image: "i1" });
  });

  it("lists the Stitch frames for the approval card, and none for a JSON design", () => {
    expect(stitchFrames({ stitch: { frames: { "ST-1": { name: "stitch-S-1.png" } } } })).toEqual([{ id: "ST-1", name: "stitch-S-1.png" }]);
    expect(stitchFrames({})).toEqual([]);
  });
});

describe("drawing with stitch", () => {
  it("writes DESIGN.md with the taste skill, makes one project and design system, and draws each screen with the tier's model", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md() }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    expect(systems[1]).toContain("Stitch Design Taste");
    expect(systems[1]).toContain("win over the skill's taste rules");
    expect(made.projects).toHaveLength(1);
    expect(made.systems).toEqual([{ name: expect.any(String), guidelines: md() }]);
    expect(made.generated.map((g) => [g.device, g.model])).toEqual([["DESKTOP", "GEMINI_3_PRO"], ["DESKTOP", "GEMINI_3_PRO"]]);
    expect(made.closed).toBe(1);
    expect(existsSync(join(ledger.dir, "attachments", "frames", "stitch-S-1.png"))).toBe(true);
    const d = ledger.getJson<{ engine: string; screens: { frames: string[] }[]; stitch: { model: string } }>((out as { outputs: { design: string } }).outputs.design);
    expect(d.engine).toBe("stitch");
    expect(d.stitch.model).toBe("GEMINI_3_PRO");
    expect(d.screens.map((s) => s.frames)).toEqual([["ST-1"], ["ST-2"]]);
  });

  it("draws with the next tier's Stitch model after a step up", async () => {
    answers = [plan(), { designMd: md() }];
    await drawWithStitch(ctxFor(memoryLedger(), 2), spec);
    expect(made.generated[0]!.model).toBe("GEMINI_3_1_PRO");
  });

  it("fails a screen list that leaves a requirement out, before any Stitch call", async () => {
    answers = [plan({ screens: [plan().screens[0]] })];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "design-unmapped" })] });
    expect(made.projects).toEqual([]);
  });

  it("fails a DESIGN.md that drops the brand colour, before any Stitch call", async () => {
    answers = [plan(), { designMd: md("#2563EB") }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "stitch-designmd-brand" })] });
    expect(made.projects).toEqual([]);
  });

  it("turns a Stitch error into a failed attempt and still closes the client", async () => {
    setStitchFactory(() => fakeStitch(true));
    answers = [plan(), { designMd: md() }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "fail", failures: [expect.objectContaining({ check: "stitch-call" })] });
    expect(made.closed).toBe(1);
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
