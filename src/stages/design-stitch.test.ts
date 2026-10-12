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
import { setStitchFactory, setStitchTimeouts, type StitchClient } from "../design/stitch.js";
import type { StepContext } from "./framework.js";
import { S, setProviderFactory } from "./think.js";
import { projectForRun, resolveRun } from "./routing.js";
import { setPagePicture } from "./design-pages.js";
import { drawWithStitch, setA11yCheck, setTellCheck, stitchArtifact, stitchFrames, stitchJobs, withShared } from "./design-stitch.js";

const U = { inputTokens: 1000, outputTokens: 200, cacheRead: 0, cacheWrite: 0 };
const reqs = [{ id: "REQ-1", ears: "The system shall list payees." }, { id: "REQ-2", ears: "The system shall add a payee, in the brand colour #0F766E." }];
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
  setTellCheck(() => []);
});
afterEach(() => { setStitchFactory(undefined); setA11yCheck(undefined); setTellCheck(undefined); delete process.env.FACTORY_NO_CACHE; });

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

  it("tells every page the look's own colours and fonts, gives Stitch its neutral, and has a page that left them fixed", async () => {
    const palette = { canvas: "#F9FAFB", surface: "#0F766E", ink: "#0F766E", good: "#0F766E", mono: "Geist Mono" };
    let looks: unknown[] = [];
    setTellCheck((_h, look) => { looks.push(look); return []; });
    answers = [plan(), { designMd: md(), theme, palette }];
    const ledger = memoryLedger();
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    expect(made.systems[0]!.theme).toMatchObject({ overridePrimaryColor: "#0F766E", overrideNeutralColor: "#F9FAFB" });
    for (const g of made.generated) {
      expect(g.prompt).toContain("page background #F9FAFB on the body");
      expect(g.prompt).toContain("Headings in Geist, everything else in Geist, numbers, codes and times in Geist Mono; load no other font.");
    }
    expect(looks[0]).toMatchObject({ canvas: "#F9FAFB", accent: "#0F766E", body: "Geist", mono: "Geist Mono" });
    // the design keeps the palette, so a page edited after a send-back is checked against it too
    const design = ledger.getJson<{ stitch: { palette?: unknown } }>((out as { outputs: { design: string } }).outputs.design);
    expect(design.stitch.palette).toEqual(palette);

    // a palette with a colour the DESIGN.md does not have is not told to the screens
    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    answers = [plan(), { designMd: md(), theme, palette: { ...palette, canvas: "#123456" } }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(made.generated[0]!.prompt).not.toContain("page background");
    expect(made.systems[0]!.theme).not.toHaveProperty("overrideNeutralColor");
  });

  it("writes the design system's rules for a page into every screen's prompt, and gives the screen list the skill's page rules", async () => {
    const digest = "Corners are 6 px on panels, fields and buttons. Panels are edged with a 1 px rule and no shadow. Table rows are 44 px high.";
    answers = [plan(), { designMd: md(), theme, digest }];
    expect((await drawWithStitch(ctxFor(memoryLedger()), spec)).kind).toBe("done");
    for (const g of made.generated) expect(g.prompt).toContain(`The design system's rules for every page; follow them, and show none of these words on the page: ${digest}`);
    // the step that writes the prompts gets the layout rules, anti-patterns and component replacements, and not the whole skill
    const listCall = systems[0] + users[0];
    expect(listCall).toContain("Define Layout Principles");
    expect(listCall).toContain("Anti-Vibe-Coded Components");
    expect(listCall).not.toContain("Motion Tokens (encode exactly)");
    // a one-task page outside any shell is a centred panel, whatever the skill says of centred heroes (the parking sign-in page, 12 Oct 2026)
    expect(listCall).toContain("centred on the page both ways");
    // a design system without a digest draws as before
    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(made.generated[0]!.prompt).not.toContain("The design system's rules for every page");
  });

  it("sends the design system without its colour overrides when Stitch refuses them", async () => {
    setStitchFactory(() => ({ ...fakeStitch(), async createDesignSystem(_p, name, t) { if ("overridePrimaryColor" in t) throw new Error("unknown field"); made.systems.push({ name, theme: t }); } }));
    answers = [plan(), { designMd: md(), theme }];
    expect((await drawWithStitch(ctxFor(memoryLedger()), spec)).kind).toBe("done");
    expect(made.systems).toEqual([{ name: expect.any(String), theme: { ...theme, designMd: md() } }]);
  });

  it("draws the pages marked for a phone a second time at phone width, five at most, unless the project says no", async () => {
    const phones = plan({ screens: plan().screens.map((x) => ({ ...x, phone: true, states: [] })) });
    const jobs = stitchJobs(phones.screens as never, [], undefined, true);
    expect(jobs.map((j) => `${j.id} ${j.state} ${j.device ?? ""}`.trim())).toEqual(["S-1 normal", "S-1 phone MOBILE", "S-2 normal", "S-2 phone MOBILE"]);
    expect(jobs[1]!.prompt).toContain("at phone width (about 390 px)");
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...phones.screens[0]!, id: `S-${i + 1}` }));
    expect(stitchJobs(seven as never, [], undefined, true).filter((j) => j.state === "phone")).toHaveLength(5);
    expect(stitchJobs(phones.screens as never, []).some((j) => j.state === "phone")).toBe(false);

    answers = [phones, { designMd: md(), theme }];
    const ledger = memoryLedger();
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(made.generated.map((g) => g.device).sort()).toEqual(["DESKTOP", "DESKTOP", "MOBILE", "MOBILE"]);
    // the phone drawing is a frame of its screen, after its page
    const design = ledger.getJson<{ screens: { frames: string[] }[]; stitch: { frames: Record<string, { state: string }> } }>((out as { outputs: { design: string } }).outputs.design);
    expect(design.screens[0]!.frames.map((f) => design.stitch.frames[f]!.state)).toEqual(["normal", "phone"]);

    made = { projects: [], systems: [], generated: [], edits: [], closed: 0 };
    answers = [phones, { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger(), 0, { stitch: { phone: false } }), spec);
    expect(made.generated.map((g) => g.device)).toEqual(["DESKTOP", "DESKTOP"]);
  });

  it("gives a page of a shell its title as its one heading", () => {
    const shared = withShared(plan({ shells: [{ id: "customer", header: "The brand reads \"Payees\" on the left with the menu beside it." }], screens: [{ ...plan().screens[0], shell: "customer" }, plan().screens[1]] }) as never);
    expect(shared.screens[0]!.prompt).toContain('The page\'s one heading reads "Payees".');
    expect(shared.screens[1]!.prompt).not.toContain("one heading");
  });

  it("gives every page of a shell the same header and every page the same sample data, and keeps a page to what its user needs", () => {
    const shared = withShared(plan({
      shells: [{ id: "customer", header: "The brand reads \"Payees\" on the left with the menu beside it; the right holds Sam Rivera, Customer." }],
      sample: "Sam Rivera, customer; payee Dana Cole, Northwind Bank.",
      screens: [{ ...plan().screens[0], shell: "customer" }, plan().screens[1]],
    }) as never);
    const [list, , form] = stitchJobs(shared.screens, ["empty"]);
    expect(list!.prompt).toContain("The page's header, the same on every page: The brand reads \"Payees\" on the left with the menu beside it; the right holds Sam Rivera, Customer. Draw nothing else in the header, and no footer.");
    // a page outside any shell is told of no header, and still of the sample data
    expect(form!.prompt).not.toContain("The page's header");
    for (const j of [list!, form!]) {
      expect(j.prompt).toContain("use it exactly: Sam Rivera, customer; payee Dana Cole, Northwind Bank.");
      expect(j.prompt).toContain("no build or version numbers");
    }
    // the design keeps the prompt as drawn, so a state drawn again after a send-back is told the same
    expect(stitchArtifact(shared as never, [], { projectId: "p", model: "m", designMd: "m" }, ["REQ-1", "REQ-2"]).stitch.prompts["S-1"]).toContain("The page's header");
    expect(withShared(plan({ shells: [], sample: "" }) as never).screens[0]!.prompt).toBe(plan().screens[0]!.prompt);
  });

  it("tells Stitch the words of each link the screen list gave, and keeps where each leads for the live demo", () => {
    const linked = plan({ screens: [
      { ...plan().screens[0], links: [{ label: "Add a payee", to: "S-2" }, { label: "add a payee", to: "S-2" }, { label: "Nowhere", to: "S-9" }, { label: "Here", to: "S-1" }] },
      { ...plan().screens[1], links: [{ label: "All payees", to: "S-1" }] },
    ] });
    const jobs = stitchJobs(linked.screens as never, ["empty"]);
    expect(jobs.map((j) => `${j.id} ${j.state}`)).toEqual(["S-1 normal", "S-1 empty", "S-2 normal"]);
    for (const j of jobs.slice(0, 2)) expect(j.prompt).toContain('The controls that open other pages are these, worded exactly: "Add a payee". Draw no other menu item, tab or footer link that would open a page.');
    expect(jobs[2]!.prompt).toContain('exactly: "All payees".');
    // each drawing is one state: Stitch draws no row of switches between states into the page
    for (const j of jobs) expect(j.prompt).toContain("Draw this one state only");
    expect(stitchJobs(plan().screens as never, [])[0]!.prompt).not.toContain("controls that open other pages");
    const a = stitchArtifact(linked as never, [], { projectId: "p", model: "m", designMd: "m" }, ["REQ-1", "REQ-2"]);
    expect(a.stitch.links).toEqual({ "S-1": [{ label: "Add a payee", to: "S-2" }], "S-2": [{ label: "All payees", to: "S-1" }] });
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
    // Stitch is given the accent as its primary too: left to itself it darkens it
    expect(made.systems).toEqual([{ name: expect.any(String), theme: { ...theme, designMd: md(), overridePrimaryColor: "#0F766E" } }]);
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

  it("fills the run's preview in as each screen comes back, the rest as wireframes, marked a draft", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const drafts: { draft: { drawn: number; total: number }; site: { screens: { title: string; pending?: boolean }[] } }[] = [];
    const read = () => drafts.push(JSON.parse(readFileSync(join(ledger.dir, "preview", "preview.json"), "utf8")));
    // the preview as it stands when each Stitch call starts: nothing drawn at the first, one frame more at each one after
    setStitchFactory(() => { const c = fakeStitch(); return { ...c, generate: async (p, prompt, device) => { read(); return c.generate(p, prompt, device); } }; });
    expect((await drawWithStitch({ ...ctxFor(ledger), project: project({ stitch: { states: ["empty"] } }) }, spec)).kind).toBe("done");
    read();
    expect(drafts[0]!.draft).toEqual({ drawn: 0, total: 3, failed: 0 });
    expect(drafts[0]!.site.screens.map((x) => [x.title, x.pending])).toEqual([["Payees", true], ["Add payee", true]]);
    expect(drafts.at(-1)!.draft).toEqual({ drawn: 3, total: 3, failed: 0 });
    expect(drafts.at(-1)!.site.screens.every((x) => !x.pending)).toBe(true);
    // each drawn frame is its own live page beside the demo, which frames it
    expect(readdirSync(join(ledger.dir, "preview", "stitch")).sort()).toEqual(["S-1-empty.html", "S-1-normal.html", "S-2-normal.html"]);
    expect(readFileSync(join(ledger.dir, "preview", "stitch", "S-2-normal.html"), "utf8")).toContain("Save payee");
    expect(readFileSync(join(ledger.dir, "preview", "index.html"), "utf8")).toContain('src="stitch/S-1-normal.html"');
  });

  it("plans with the next tier's Claude model after a step up", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger(), 2), spec);
    expect(models).toEqual(["claude-opus-5-5", "claude-opus-5-5"]);
  });

  it("plans with the model picked beside Google Stitch at the start, and names it on the design", async () => {
    const ledger = memoryLedger();
    process.env.OPENAI_API_KEY = "sk-test-not-real"; _resetEnvCache();
    answers = [plan(), { designMd: md(), theme }];
    const base = ProjectConfig.parse({ project: "demo", repo: "-", stack: "dotnet" });
    const out = await drawWithStitch({ ...ctxFor(ledger), project: projectForRun(base, resolveRun(base, { picks: { design: "stitch:gpt-6-luna" } })) }, spec);
    delete process.env.OPENAI_API_KEY; _resetEnvCache();
    expect(out.kind).toBe("done");
    expect(models).toEqual(["gpt-6-luna", "gpt-6-luna"]);
    expect(ledger.getJson<{ header: { producedBy: { model: string } } }>((out as { outputs: { design: string } }).outputs.design).header.producedBy.model).toBe("gpt-6-luna");
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
    const frames = { "ST-1": { name: "stitch-S-1.png", dataUri: "data:image/png;base64,AA", state: "normal" }, "ST-2": { name: "stitch-S-2.png", state: "normal" }, "F-1": { name: "notes.pdf" }, "ST-4": { name: "stitch-S-4.png", state: "normal" } };
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

  it("puts each fixed page in the run's preview as its fix comes back, and counts it so the page showing the draft sees the change", async () => {
    setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: [{ id: "button-name", targets: ["button.icon"] }] })));
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const preview = () => JSON.parse(readFileSync(join(ledger.dir, "preview", "preview.json"), "utf8")).draft as { drawn: number; fixed?: number };
    const live = (id: string) => readFileSync(join(ledger.dir, "preview", "stitch", `${id}-normal.html`), "utf8");
    // the preview as it stands when each fix starts (one at a time here, so the second fix sees the first one in place)
    const seen: { fixed?: number; pages: string }[] = [];
    setStitchFactory(() => {
      const c = fakeStitch();
      let turn = Promise.resolve();
      return { ...c, edit: (p, screenId, prompt, device) => { const r = turn.then(() => { seen.push({ ...(preview().fixed ? { fixed: preview().fixed! } : {}), pages: live("S-1") + live("S-2") }); return c.edit(p, screenId, prompt, device); }); turn = r.then(() => new Promise<void>((done) => setTimeout(done, 20))); return r; } };
    });
    expect((await drawWithStitch(ctxFor(ledger), spec)).kind).toBe("done");
    expect(seen).toHaveLength(2);
    expect(seen[0]!.fixed).toBeUndefined();
    expect(seen[0]!.pages).not.toMatch(/Page html-e/);
    expect(seen[1]!.fixed).toBe(1);
    expect(seen[1]!.pages.match(/Page html-e/g)).toHaveLength(1);
    expect(preview().fixed).toBe(2);
    expect((live("S-1") + live("S-2")).match(/Page html-e/g)).toHaveLength(2);
  });

  it("records what still fails after the fix", async () => {
    setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: p.id === "S-2" ? [{ id: "label", targets: ["input"] }] : [] })));
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(made.edits).toHaveLength(1);
    expect(ledger.getJson<D>((out as { outputs: { design: string } }).outputs.design).stitch.a11y).toEqual([{ screen: "S-2", rules: ["label"] }]);
  });

  it("gives a page that looks generated or stands still one fix, with its accessibility fix when it has both, and never pays for a soft tell alone", async () => {
    setA11yCheck(async (pages) => pages.map((p) => ({ id: p.id, violations: p.id === "S-1" ? [{ id: "button-name", targets: ["button"] }] : [] })));
    let seen = 0;
    // the first two reads are the drawn pages (S-1, S-2); a fixed page reads clean
    setTellCheck(() => (++seen <= 2 ? [{ id: "static", fix: "add the motion" }, { id: "reduced-motion", fix: "add a reduced-motion rule", soft: true }] : []));
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(made.edits).toHaveLength(2);
    const prompts = made.edits.map((e) => e.prompt).sort();
    expect(prompts[0]).toBe("Change this and nothing else: add the motion; add a reduced-motion rule.");
    expect(prompts[1]).toMatch(/^Fix these accessibility problems and change nothing else: button-name \(button\)\. Also add the motion; add a reduced-motion rule\.$/);

    made.edits = [];
    setA11yCheck(async () => undefined);
    setTellCheck(() => [{ id: "reduced-motion", fix: "add a reduced-motion rule", soft: true }]);
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(made.edits).toHaveLength(0);
  });

  it("asks every screen for the design's motion by name, and gives the design system the project's mood", async () => {
    const motion = { signature: "Plate chips flip in over 260ms.", ambient: "The live dot breathes on a 6s cycle." };
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme, motion }];
    const out = await drawWithStitch(ctxFor(ledger, 0, { stitch: { mood: "futuristic" } }), spec);
    for (const g of made.generated) {
      expect(g.prompt).toContain("into a <style> block");
      expect(g.prompt).toContain("The signature motion: Plate chips flip in over 260ms. The one ambient animation: The live dot breathes on a 6s cycle.");
    }
    expect(systems.join("\n") + users.join("\n")).toContain("The project asks for a futuristic look");
    expect(ledger.getJson<{ stitch: { motion?: unknown } }>((out as { outputs: { design: string } }).outputs.design).stitch.motion).toEqual(motion);
  });

  const bank = { requirements: [{ id: "REQ-1", ears: "The system shall list the bank account's payees with their IBAN." }, { id: "REQ-2", ears: "The system shall add a payee for a bank transfer." }] } as never;
  it("stands the look on the field's real products when the client named no brand, and stores what it took from them", async () => {
    const ledger = memoryLedger();
    const free = plan({ brand: { colours: [], fonts: [] } });
    const navy = { ...theme, customColor: "#1E3A8A" };
    const basis = [{ ref: "Bank of America", took: "navy headings, red only for alerts" }, { ref: "Chase", took: "white page, blue on the primary action" }];
    answers = [free, { designMd: md("#1E3A8A"), theme: navy, basis }];
    const out = await drawWithStitch(ctxFor(ledger), bank);
    const sent = systems.join("\n") + users.join("\n");
    expect(sent).toContain("Design references (how real products in this field look)");
    expect(sent).toContain("Bank of America");
    expect(sent).toContain("it is proof-driven, not invented");
    expect(ledger.getJson<{ theme: { basis?: unknown } }>((out as { outputs: { design: string } }).outputs.design).theme.basis).toEqual(basis);
  });

  it("sends the design system back when its accent is outside the field's colours without a reason, or it names no product it stands on", async () => {
    const free = plan({ brand: { colours: [], fonts: [] } });
    answers = [free, { designMd: md("#C026D3"), theme: { ...theme, customColor: "#C026D3" } }];
    const out = await drawWithStitch(ctxFor(memoryLedger()), bank) as { kind: string; failures?: { check: string; message: string }[] };
    expect(out.kind).toBe("fail");
    expect(out.failures!.map((f) => f.check)).toEqual(expect.arrayContaining(["design-off-reference", "design-no-basis"]));
    expect(out.failures!.map((f) => f.message).join(" ")).toContain("theme.customColor");
    expect(made.generated).toEqual([]);
  });

  it("gives the screen list how the field's products arrange their pages, whatever sets the colours, and the client's references as sent", async () => {
    answers = [plan(), { designMd: md(), theme }];
    const refSections = [S.artifact("client-references", "references", [{ id: "R-1", role: "layout" }])];
    await drawWithStitch(ctxFor(memoryLedger()), bank, { refs: { refs: [] }, refSections });
    const listCall = systems[0] + users[0];
    expect(listCall).toContain("How the leading products of this field arrange their pages");
    expect(listCall).toContain("What their pages share: Calm, near-white pages");
    expect(listCall).not.toMatch(/Bank of America: #/);
    expect(listCall).toContain('"R-1"');
    expect(systems[1] + users[1]).toContain("CLIENT REFERENCES");
  });

  it("gives a retry's failures only to the call they are about, so a rejected design system leaves the screen list's briefing as it was", async () => {
    answers = [plan(), { designMd: md(), theme }];
    const ctx = { ...ctxFor(memoryLedger()), priorFailures: [{ check: "stitch-designmd-black", message: "DESIGN.md uses pure black", frames: [] }] };
    await drawWithStitch(ctx as never, spec);
    expect(users[0]).not.toContain("pure black");
    expect(users[1]).toContain("pure black");
  });

  it("goes on from the accepted screen list and design system after a park, with no model call", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    setStitchFactory(() => fakeStitch(true));
    expect((await drawWithStitch(ctxFor(ledger), spec)).kind).toBe("park");
    setStitchFactory(() => fakeStitch());
    answers = [];
    const out = await drawWithStitch(ctxFor(ledger), spec);
    expect(out.kind).toBe("done");
    expect(made.generated.length).toBeGreaterThan(0);
  });

  it("asks only for the design system again when its checks sent it back", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md("#2563EB"), theme }];
    expect((await drawWithStitch(ctxFor(ledger), spec)).kind).toBe("fail");
    answers = [{ designMd: md(), theme }];
    const ctx = { ...ctxFor(ledger), priorFailures: [{ check: "stitch-designmd-brand", message: "DESIGN.md drops the brand colour", frames: [] }] };
    expect((await drawWithStitch(ctx as never, spec)).kind).toBe("done");
    expect(answers).toEqual([]);
  });

  it("tells both calls of a design run that a mobile app is drawn as the responsive web app", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(systems.length).toBe(2);
    for (const sys of systems) expect(sys).toContain("PLATFORM. This product is designed and built as a web app");
  });

  it("puts pure black in the design system right itself, with no second model call", async () => {
    answers = [plan(), { designMd: md().replace("#F9FAFB", "#000000"), theme }];
    expect((await drawWithStitch(ctxFor(memoryLedger()), spec)).kind).toBe("done");
    expect(JSON.stringify(made.systems)).not.toContain("#000000");
  });

  it("leaves the field's products out when the client named its brand colour", async () => {
    answers = [plan(), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), spec);
    expect(systems.join("\n") + users.join("\n")).not.toContain("Design references (how real products");
  });

  it("does not take a colour the requirements never gave as the client's brand", async () => {
    const bank = { requirements: [{ id: "REQ-1", ears: "The system shall list the bank account's payees with their IBAN." }, { id: "REQ-2", ears: "The system shall add a payee for a bank transfer." }] } as never;
    answers = [plan({ brand: { colours: ["#18181B"], fonts: [] } }), { designMd: md(), theme }];
    await drawWithStitch(ctxFor(memoryLedger()), bank);
    expect(systems.join("\n") + users.join("\n")).toContain("Design references (how real products");
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

describe("Stitch calls: cost, limits, timeouts and resume (PR review)", () => {
  let logged: { model: string; estUsd: number; inputTokens: number }[] = [];
  const metered = (ledger: ReturnType<typeof memoryLedger>, design: Record<string, unknown> = {}) => {
    const c = ctxFor(ledger, 0, design);
    c.usage = async (u) => { logged.push(u); };
    return c;
  };
  const script = () => { answers = [plan(), { designMd: md(), theme }]; };
  beforeEach(() => { logged = []; });
  afterEach(() => setStitchTimeouts(undefined));

  it("logs each Stitch call as a usage row at the project's price per call", async () => {
    script();
    const out = await drawWithStitch(metered(memoryLedger(), { stitch: { usdPerCall: 0.05 } }), spec);
    expect(out.kind).toBe("done");
    const rows = logged.filter((u) => u.model === "stitch");
    expect(rows).toHaveLength(3); // S-1, S-1 empty, S-2
    expect(rows.every((u) => u.estUsd === 0.05 && u.inputTokens === 0)).toBe(true);
  });

  it("parks before drawing anything when the design needs more Stitch calls than the run allows", async () => {
    script();
    const out = await drawWithStitch(metered(memoryLedger(), { stitch: { maxCalls: 2 } }), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/3 Stitch calls.*limit of 2/) });
    expect(made.projects).toEqual([]);
    expect(made.generated).toEqual([]);
  });

  it("counts the Stitch calls earlier attempts of the run already made", async () => {
    script();
    const ledger = memoryLedger();
    const used = { type: "usage", key: "design#1", data: { "gen_ai.request.model": "stitch", "gen_ai.usage.cost_usd": 0 } } as never;
    ledger.events = () => [CREATED, used, used];
    const out = await drawWithStitch(metered(ledger, { stitch: { maxCalls: 4 } }), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/2 already used/) });
  });

  it("has no call limit unless the project sets one", async () => {
    script();
    const ledger = memoryLedger();
    const used = { type: "usage", key: "design#1", data: { "gen_ai.request.model": "stitch", "gen_ai.usage.cost_usd": 0 } } as never;
    ledger.events = () => [CREATED, ...Array<never>(60).fill(used)];
    const out = await drawWithStitch(metered(ledger, {}), spec);
    expect(out.kind).toBe("done");
  });

  it("parks before drawing when the calls would pass the run's cost limit", async () => {
    script();
    const out = await drawWithStitch(metered(memoryLedger(), { stitch: { usdPerCall: 50 } }), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/cost limit/) });
    expect(made.generated).toEqual([]);
  });

  it("parks on a Stitch call that never answers instead of hanging the run", async () => {
    script();
    setStitchTimeouts({ callMs: 50, downloadMs: 50 });
    setStitchFactory(() => ({ ...fakeStitch(), generate: () => new Promise(() => undefined) }));
    const out = await drawWithStitch(metered(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/timed out/) });
  });

  it("parks on a download that never finishes", async () => {
    script();
    setStitchTimeouts({ callMs: 1000, downloadMs: 50 });
    setStitchFactory(() => ({ ...fakeStitch(), download: () => new Promise(() => undefined) }));
    const out = await drawWithStitch(metered(memoryLedger()), spec);
    expect(out).toMatchObject({ kind: "park", reason: expect.stringMatching(/timed out/) });
  });

  it("resumes a parked draw in the same Stitch project, drawing only the screens still missing", async () => {
    const ledger = memoryLedger();
    let down = true;
    setStitchFactory(() => {
      const f = fakeStitch();
      return { ...f, async generate(p, prompt, device) { if (down && prompt.includes("form to add a payee")) throw new Error("Stitch is down"); return f.generate(p, prompt, device); } };
    });
    script();
    expect((await drawWithStitch(metered(ledger), spec)).kind).toBe("park");
    expect(made.generated).toHaveLength(2); // S-1 and its empty state were drawn and paid for
    down = false;
    script();
    const out = await drawWithStitch(metered(ledger), spec);
    expect(out.kind).toBe("done");
    expect(made.projects).toHaveLength(1);
    expect(made.systems).toHaveLength(1);
    expect(made.generated).toHaveLength(3); // only S-2 the second time
    const design = ledger.getJson<{ screens: { id: string; frames: string[] }[] }>((out as { outputs: { design: string } }).outputs.design);
    expect(design.screens.map((s) => [s.id, s.frames.length])).toEqual([["S-1", 2], ["S-2", 1]]);
  });

  it("starts a new Stitch project when the resumed plan is not the one drawn", async () => {
    const ledger = memoryLedger();
    setStitchFactory(() => { const f = fakeStitch(); return { ...f, async generate(p, prompt, device) { if (prompt.includes("form to add a payee")) throw new Error("down"); return f.generate(p, prompt, device); } }; });
    script();
    await drawWithStitch(metered(ledger), spec);
    setStitchFactory(() => fakeStitch());
    // the lead sent it back in between: the list is written again, and a list that differs is drawn in a project of its own
    answers = [plan({ flow: "Another flow." }), { designMd: md(), theme }];
    expect((await drawWithStitch(metered(ledger), spec, { feedback: ["Make the list denser."] })).kind).toBe("done");
    expect(made.projects).toHaveLength(2);
  });
});

describe("a finished Stitch draw (PR review)", () => {
  it("is never reused: drawing the same plan again is a new drawing", async () => {
    const ledger = memoryLedger();
    answers = [plan(), { designMd: md(), theme }];
    expect((await drawWithStitch(ctxFor(ledger), spec)).kind).toBe("done");
    answers = [plan(), { designMd: md(), theme }];
    expect((await drawWithStitch(ctxFor(ledger), spec)).kind).toBe("done");
    expect(made.projects).toHaveLength(2);
    expect(made.generated).toHaveLength(6);
  });
});

describe("Stitch on an existing app (PR #32 review)", () => {
  it("is refused with the reason: Stitch draws a new product's screens", async () => {
    const { stitchOnExistingApp } = await import("./design-stitch.js");
    expect(stitchOnExistingApp(undefined)).toBeUndefined();
    expect(stitchOnExistingApp({ pages: [], verdict: "none" } as never)).toBeUndefined();
    expect(stitchOnExistingApp({ pages: [{ route: "/" }], verdict: "kit" } as never)).toMatch(/existing app.*engine claude or openai/);
  });
});

describe("the approval preview's frames for a JSON design (PR #32 review)", () => {
  it("lists a too-large frame only for Stitch: a request's own attached frame is listed only when it is shown", async () => {
    const { previewFrames } = await import("./design-approve.js");
    const screens = [{ id: "S-1", frames: ["F-1"] }, { id: "S-2", frames: ["ST-1"] }];
    const frames = { "F-1": { name: "mock.png" }, "ST-1": { name: "stitch-S-2-normal-aaaaaaaa.png", state: "normal" } };
    expect(previewFrames(screens, frames, () => true).map((x) => x.name)).toEqual(["stitch-S-2-normal-aaaaaaaa.png"]);
  });
});

describe("the pages engine: the design step's model draws each page in Stitch's place", () => {
  const pageHtml = (n: number) => `<!DOCTYPE html><html lang="en"><head><title>P${n}</title><style>body{background:#F9FAFB}</style><script>alert(1)</script></head><body><main><h1>Payees ${n}</h1><p>Everyone you have paid before.</p><button type="button">Add payee</button></main></body></html>`;
  let logged: { model: string }[] = [];
  const pagesCtx = (ledger: ReturnType<typeof memoryLedger>) => {
    const c = ctxFor(ledger, 0, { engine: "pages", allowStitch: false });
    c.usage = async (u) => { logged.push(u); };
    return c;
  };
  beforeEach(() => { logged = []; setPagePicture(async (_html, device) => Buffer.from(`PNG-${device}`)); setStitchFactory(() => { throw new Error("Stitch must not be called"); }); });
  afterEach(() => setPagePicture(undefined));

  it("draws every page with the model, keeps it without its scripts, and records the model as the drawer", async () => {
    answers = [plan(), { designMd: md(), theme }, { html: pageHtml(1) }, { html: pageHtml(2) }, { html: pageHtml(3) }];
    const ledger = memoryLedger();
    const out = await drawWithStitch(pagesCtx(ledger), spec);
    expect((out as { reason?: string }).reason).toBeUndefined();
    expect(out).toMatchObject({ kind: "done", data: { screens: 2, engine: "stitch" } });
    const design = ledger.getJson<{ engine: string; stitch: { model: string; projectId: string; frames: Record<string, { html: string; image: string; screenId: string }> } }>((out as { outputs: { design: string } }).outputs.design);
    // the same shape as a Stitch design, so the preview, the checks and the export read it unchanged
    expect(design.engine).toBe("stitch");
    expect(design.stitch.model).toBe("claude-sonnet-5");
    expect(design.stitch.projectId).toMatch(/^pages-/);
    const frames = Object.values(design.stitch.frames);
    expect(frames).toHaveLength(3); // S-1, S-1 empty, S-2
    for (const f of frames) {
      const html = ledger.getArtifact(f.html).toString();
      expect(html).toContain("<h1>Payees");
      expect(html).not.toContain("<script");
      expect(f.screenId).toBe(f.html);
      expect(ledger.getArtifact(f.image).toString()).toBe("PNG-DESKTOP");
    }
    // the page calls are told the design system and the page's prompt, and no Stitch call is counted
    expect(systems.slice(2).every((s) => s.includes("writes production HTML"))).toBe(true);
    expect(users.slice(2).every((u) => u.includes("# Design System: Payees"))).toBe(true);
    expect(logged.some((u) => u.model === "stitch")).toBe(false);
  });

  it("parks with the model's name, never Stitch's, when a page cannot be drawn", async () => {
    answers = [plan(), { designMd: md(), theme }, { html: "x".repeat(300) }, { html: pageHtml(2) }, { html: pageHtml(3) }];
    const out = await drawWithStitch(pagesCtx(memoryLedger()), spec);
    expect(out.kind).toBe("park");
    expect((out as { reason: string }).reason).toMatch(/could not draw the pages: the model's answer was not a page/);
    expect((out as { reason: string }).reason).not.toMatch(/STITCH_API_KEY/);
  });
});
