// End to end: an estimate from requirements alone, through the real executor, with a scripted model.
// One question card, then the lead's approval card, then two workbooks on disk.
import { draftFile, estimateView } from "../ui/data.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import "../gates/predicates.js";
import "../estimate/gates.js";
import "../estimate/lint.js";
import { _resetEnvCache } from "../config/env.js";
import { verifyEvidence } from "../gates/engine.js";
import { loadWorkbook } from "../estimate/workbook-lint.js";
import { decide } from "../ledger/human.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { createRun, execute } from "./executor.js";
import { previewFile, readPreview } from "../ui/preview.js";
import { approvedEstimate } from "../estimate/lineage.js";
import { setRecordsSource, setTaskRecordsSource } from "./estimate.js";
import { setProviderFactory } from "./think.js";
import { setTuneTrigger } from "../estimate/tune.js";

const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const REQS = [
  { id: "REQ-1", ears: "When a user signs in with valid credentials, the system shall open the dashboard.", acceptance: [{ id: "AC-1.1", given: "a registered user", when: "they sign in", then: "the response is 200 with the dashboard in the body", level: "api" }] },
  { id: "REQ-2", ears: "When a user asks for a report, the system shall produce a PDF.", acceptance: [{ id: "AC-2.1", given: "a report exists", when: "the user exports", then: "the response body is a PDF file", level: "api" }] },
];
const draft = {
  requirements: REQS.map((r) => ({ ...r, op: "ADDED", sources: ["I-1"], anchors: [] })),
  nfrs: [], outOfScope: ["mobile apps"], assumptions: [], suggestions: [],
};
const breakdown = {
  features: [{ id: "F-1", title: "Sign in", reqs: ["REQ-1"] }, { id: "F-2", title: "Reports", reqs: ["REQ-2"] }],
  tasks: [
    { id: "EST-1", title: "Sign-in endpoint", featureId: "F-1", reqs: ["REQ-1"], items: ["email and password", "lockout after 5 tries"], track: "backend", kind: "be-auth", executor: "factory", dependsOn: [], complexity: "standard" },
    { id: "EST-2", title: "PDF report", featureId: "F-2", reqs: ["REQ-2"], items: ["one-page summary"], track: "backend", kind: "be-files", executor: "factory", dependsOn: ["EST-1"], complexity: "external-dependency" },
    { id: "EST-3", title: "Client UAT", featureId: "F-1", reqs: [], items: [], track: "qa", kind: "qa-uat", executor: "human", dependsOn: ["EST-2"], complexity: "standard", overhead: "client acceptance testing" },
  ],
  checklist: [{ item: "auth", included: true }, { item: "monitoring", included: false, reason: "client hosts and monitors" }],
};
const sizing = {
  stack: { backend: "ASP.NET Core Web API", database: "PostgreSQL", architecture: "modular monolith", basis: "assumed" as const, notes: "no stack named in the request" },
  anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "a typical endpoint with validation for this stack" }],
  tasks: [
    { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "the anchor", size: "typical", verify: "moderate", context: "complete" },
    { taskId: "EST-2", anchorId: "EST-1", ratio: 1.5, reason: "a PDF library on top of the same shape", size: "typical", verify: "moderate", context: "complete" },
    { taskId: "EST-3", anchorId: "EST-1", ratio: 1, reason: "a day of client testing", size: "typical", verify: "moderate", context: "complete" },
  ],
};

let prompts: string[] = [];
/** tool names each spec drafter got, and the critic's instructions */
let drafterTools: string[][] = [];
let criticSystems: string[] = [];
/** a large document: two modules, each with its own intake span, no questions, four requirements in all */
let modular = false;
let intakeCalls = 0;
/** a request with UI: intake says so, the design step draws two screens, and the breakdown builds each */
let ui = false;
const UI_DESIGN = {
  flow: "A user signs in, then exports a report.",
  screens: [
    { id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["empty", "error"], size: "new", frames: [] },
    { id: "S-2", route: "/reports", file: "app/reports/page.tsx", reqs: ["REQ-2"], states: ["loading"], size: "new", frames: [] },
  ],
  noScreen: [],
};
let uiDesign: unknown = UI_DESIGN;
const withScreens = (b: typeof breakdown) => ({ ...b, tasks: b.tasks.map((t) => (t.id === "EST-1" ? { ...t, track: "web", kind: "ui-form", screen: "S-1" } : t.id === "EST-2" ? { ...t, track: "web", kind: "ui-detail", screen: "S-2" } : t)) });
const MODULE_SPANS = ["ALPHA sign in flow", "BETA report export flow"];
const bigBreakdown = () => ({
  features: [{ id: "F-1", title: "Alpha", reqs: ["REQ-1", "REQ-2"] }, { id: "F-2", title: "Beta", reqs: ["REQ-3", "REQ-4"] }],
  tasks: [
    ...[1, 2, 3, 4].map((n) => ({ id: `EST-${n}`, title: `Build ${n}`, featureId: n <= 2 ? "F-1" : "F-2", reqs: [`REQ-${n}`], items: [`item ${n}`], track: "backend", kind: "be-crud", executor: "factory", dependsOn: n > 1 ? [`EST-${n - 1}`] : [], complexity: "standard" })),
    { id: "EST-5", title: "Client UAT", featureId: "F-1", reqs: [], items: [], track: "qa", kind: "qa-uat", executor: "human", dependsOn: ["EST-4"], complexity: "standard", overhead: "client acceptance testing" },
  ],
  checklist: breakdown.checklist,
});
const bigSizing = () => ({
  anchors: sizing.anchors, stack: sizing.stack,
  tasks: [1, 2, 3, 4, 5].map((n) => ({ taskId: `EST-${n}`, anchorId: "EST-1", ratio: n === 1 ? 1 : 1.25, reason: n === 1 ? "the anchor" : "a little more than the anchor", size: "typical", verify: "moderate", context: "complete" })),
});
function answerFor(system: string): unknown {
  prompts.push(system.slice(0, 60));
  if (modular && system.includes("intake step")) return { source: "cli", spans: [{ id: "I-1", text: MODULE_SPANS[intakeCalls++ % 2]! }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false };
  if (modular && system.includes("sizing the tasks")) return bigSizing();
  if (modular && system.includes("turning a finished spec")) return bigBreakdown();
  if (modular && system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("drawing the screen inventory")) {
    const d = uiDesign as { screens: Record<string, unknown>[] };
    const mock = { title: "Open orders", blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Continue"] }], copy: {} };
    return { theme: { mood: "calm", brand: "#1f6feb", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "one blue action" }] }, ...d, screens: d.screens.map((x) => ({ mock, mockFull: mock, ...x })) };
  }
  if (system.includes("intake step")) return { source: "cli", spans: [{ id: "I-1", text: "sign in and export reports" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: ui };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "user signs in", kind: "happy" }, { text: "user exports a PDF", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Requirements analyst")) return system.includes("already answered") ? { questions: [], conflicts: [] } : {
    questions: [{ id: "q1", category: "scope", text: "Web or mobile?", options: ["web", "mobile"], recommended: "web", reason: "the request says portal", spans: ["I-1"], impact: 3, impactReason: "decides the platform" }], conflicts: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: REQS.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`] })), conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Users sign in." }, { n: 2, text: "Users export a PDF report." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }, { n: 2, spans: ["I-1"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("sizing the tasks")) return sizing;
  if (system.includes("turning a finished spec")) return ui ? withScreens(breakdown) : breakdown;
  throw new Error(`unscripted system prompt: ${system.slice(0, 80)}`);
}
const provider: Provider = {
  start(_m, _e, system, _u, tools): Conversation {
    if (system.includes("Senior engineer writing a behaviour spec")) drafterTools.push(tools.map((t) => t.name));
    if (system.includes("Adversarial reviewer")) criticSystems.push(system);
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answerFor(system) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

/** background tuning starts counted, never spawned */
let tunes = 0;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-est-e2e-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "demo.yaml"), stringify({ project: "demo", repo: mkdtempSync(join(tmpdir(), "factory-est-repo-")), stack: "dotnet" }));
  setProviderFactory(() => provider);
  setRecordsSource(() => []);
  setTaskRecordsSource(() => []);
  tunes = 0;
  setTuneTrigger(() => { tunes++; });
  prompts = [];
  drafterTools = [];
  criticSystems = [];
  modular = false;
  intakeCalls = 0;
  ui = false;
  uiDesign = UI_DESIGN;
});

describe("estimate mode end to end (requirements only, scripted model)", () => {
  it("runs from requirements to an approved estimate and two workbooks", async () => {
    const runId = await createRun("Build a client portal where users sign in and export reports.", "demo", "sam", {
      mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", designInTotal: true, feedbackRounds: 2, noRepo: true, client: "Acme", projectName: "Portal", pm: "A. Lead", rates: { backend: 50, default: 40 } },
    });
    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    expect(tunes).toBe(0); // no estimate yet: nothing new to tune from
    const ledger = Ledger.open(runId);
    const q = replay(ledger.events()).openCard!;
    expect(q.kind).toBe("question");
    await decide(ledger, { decision: "answer", hashPrefix: q.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } });

    const r2 = await execute(runId);
    expect(r2.status, r2.message).toBe("waiting");
    const card = replay(ledger.events()).openCard!;
    expect(card.kind).toBe("estimate-approval");
    const md = ledger.readCard(card.cardId);
    // hours from the catalogue: be-auth at the typical size is 10-16 h
    expect(md).toMatch(/## Anchors[\s\S]*EST-1 Sign-in endpoint: 10-16 h/);
    expect(md).toMatch(/estimate\.e1-readiness/);
    // before approval the web UI can still hand out a draft of each workbook
    for (const who of ["team", "client"]) {
      const d = await draftFile(ledger, who);
      expect(d?.name).toMatch(/^DRAFT-.*\.xlsx$/);
      expect(d?.body.subarray(0, 2).toString()).toBe("PK");
    }
    expect(await draftFile(ledger, "other")).toBeUndefined();
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });

    const r3 = await execute(runId);
    expect(r3.status, r3.message).not.toBe("waiting");
    const s = replay(ledger.events());
    for (const step of ["intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "design-baseline", "breakdown", "estimate", "approve-estimate", "export"]) {
      expect(s.steps.get(step)?.status, step).toBe("completed");
    }
    // no repo, no build steps, no model call for ground
    expect(s.steps.has("plan")).toBe(false);
    expect(s.steps.get("ground")!.data).toMatchObject({ repo: false });
    // no repo: drafters get no repo tools, the critic isn't asked about existing code
    expect(drafterTools.length).toBeGreaterThan(0);
    expect(drafterTools.flat().filter((t) => t === "read_file" || t === "search")).toEqual([]);
    expect(criticSystems.length).toBeGreaterThan(0);
    for (const c of criticSystems) { expect(c).toContain("There is no existing codebase"); expect(c).not.toContain("without anchors"); }
    const gates = s.gates.map((g) => `${g.gateId}:${g.passed}`);
    for (const g of ["estimate.e1-readiness", "estimate.e1b-design-baseline", "estimate.e2-req-to-task", "estimate.e3-task-to-req", "estimate.e4-checklist", "estimate.e5-consistency", "estimate.e6-lint", "estimate.e7-approval"]) expect(gates, g).toContain(`${g}:true`);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);

    const files = s.steps.get("export")!.data as { team: string; client: string };
    expect(existsSync(files.team) && existsSync(files.client)).toBe(true);
    const team = await loadWorkbook(files.team), client = await loadWorkbook(files.client);
    expect(team.getWorksheet("Summary")!.getCell("C5").value).toBe("Acme");
    expect(team.getWorksheet("Cost")).toBeTruthy();
    expect(client.getWorksheet("Cost")).toBeUndefined();
    expect(client.getWorksheet("Anchors")).toBeUndefined();
  });

  it("runs hands-off: no question card, no approval card, the questions become the factory's assumptions", async () => {
    const runId = await createRun("Build a client portal where users sign in and export reports.", "demo", "sam", {
      mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", designInTotal: true, feedbackRounds: 2, noRepo: true, humanReview: false },
    });
    const r = await execute(runId);
    expect(r.status, r.message).not.toBe("waiting");
    expect(tunes).toBe(1); // the finished estimate starts background tuning once
    const ledger = Ledger.open(runId);
    const s = replay(ledger.events());
    expect(s.decisions).toEqual([]);
    for (const step of ["clarify", "clarify-2", "specify", "estimate", "approve-estimate", "export"]) expect(s.steps.get(step)?.status, step).toBe("completed");
    const c1 = ledger.getJson<{ asked: unknown[]; assumptions: { text: string; risk: string }[]; assumedBy?: string }>(s.steps.get("clarify")!.outputs[0]!)!;
    expect(c1.asked).toEqual([]);
    expect(c1.assumedBy).toBe("factory");
    expect(c1.assumptions).toEqual([expect.objectContaining({ text: "Web or mobile? → assumed: web", risk: "high" })]);
    expect(s.steps.get("clarify-2")!.data).toMatchObject({ skipped: true, handsOff: true });
    expect(s.steps.get("approve-estimate")!.data).toMatchObject({ by: "factory", auto: true });
    expect(s.gates.find((g) => g.gateId === "estimate.e7-approval")).toMatchObject({ passed: true });
    // an estimate the factory approved can be revised, but no build is held to a budget nobody approved
    expect(approvedEstimate(runId).runId).toBe(runId);
    expect(() => approvedEstimate(runId, { build: true })).toThrow(/approved by the factory/);
    // the Estimate tab says who approved it and lists what the factory assumed
    const v = estimateView(ledger) as { handsOff?: boolean; approved?: { auto?: boolean; by: string }; factoryAssumptions?: { id: string; risk: string }[] };
    expect(v.handsOff).toBe(true);
    expect(v.approved).toMatchObject({ by: "factory", auto: true });
    expect(v.factoryAssumptions).toEqual([expect.objectContaining({ id: "ASM-1", risk: "high" })]);
  });

  it("specifies a large document module by module, joins the modules, and estimates the whole", async () => {
    modular = true;
    const filler = "The system shall behave as described in this paragraph of the document. ".repeat(160);
    const doc = `# Module one\n\nALPHA sign in flow. ${filler}\n\n# Module two\n\nBETA report export flow. ${filler}`;
    expect(doc.length).toBeGreaterThan(20_000);
    const runId = await createRun(doc, "demo", "sam", { mode: "estimate", estimate: { noRepo: true, deliveryModel: "agentic" } });
    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    const ledger = Ledger.open(runId);
    const card = replay(ledger.events()).openCard!;
    expect(card.kind).toBe("estimate-approval");
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });
    const r2 = await execute(runId);
    expect(r2.status, r2.message).not.toBe("waiting");
    const s = replay(ledger.events());
    for (const step of ["intake:m1", "intake:m2", "intake", "clarify:m1", "clarify:m2", "clarify", "clarify-2", "drafts:m1", "specify:m1", "drafts:m2", "specify:m2", "specify", "breakdown", "estimate", "export"]) {
      expect(s.steps.get(step)?.status, step).toBe("completed");
    }
    // the joined spec carries both modules' requirements, numbered again
    const spec = ledger.getJson<{ requirements: { id: string }[] }>(s.steps.get("specify")!.outputs[0]!)!;
    expect(spec.requirements.map((q) => q.id)).toEqual(["REQ-1", "REQ-2", "REQ-3", "REQ-4"]);
    const est = ledger.getJson<{ band: string; deliveryModel: string; gateHours: unknown[] }>(s.steps.get("estimate")!.outputs[0]!)!;
    expect(est.deliveryModel).toBe("agentic");
    expect(est.gateHours).toEqual([]);
  });

  /** An approved single-document run to build on. */
  async function approvedRun(): Promise<string> {
    const runId = await createRun("Build a client portal where users sign in and export reports.", "demo", "sam", { mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", designInTotal: true, feedbackRounds: 2, noRepo: true } });
    await execute(runId);
    const ledger = Ledger.open(runId);
    const q = replay(ledger.events()).openCard!;
    await decide(ledger, { decision: "answer", hashPrefix: q.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } });
    await execute(runId);
    const card = replay(ledger.events()).openCard!;
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });
    const done = await execute(runId);
    expect(done.status, done.message).not.toBe("waiting");
    return runId;
  }

  it("refuses to build on an estimate that is not approved yet", async () => {
    const runId = await createRun("Build a client portal.", "demo", "sam", { mode: "estimate", estimate: { noRepo: true } });
    await execute(runId);
    expect(() => approvedEstimate(runId)).toThrow(/no approved estimate yet/);
  });

  it("re-estimates under the other delivery model as a sibling run over the approved breakdown, with a comparison", async () => {
    const parent = await approvedRun();
    const approved = approvedEstimate(parent);
    expect(approved.deliveryModel).toBe("hitl");
    const runId = await createRun(approved.request, "demo", "sam", { mode: "estimate", estimate: { ...approved.settings, deliveryModel: "agentic" }, lineage: { kind: "sibling", approved } });
    prompts = [];
    const r = await execute(runId);
    expect(r.status, r.message).toBe("waiting");
    // no intake, clarify, spec or breakdown work: only the sizing was asked of the model
    expect(prompts.every((p) => /sizing the tasks/.test(p))).toBe(true);
    const ledger = Ledger.open(runId);
    const card = replay(ledger.events()).openCard!;
    const md = ledger.readCard(card.cardId);
    expect(md).toMatch(/## Compared with the HITL estimate/);
    expect(md).toMatch(/Delivery model: hitl -> agentic/);
    expect(md).toMatch(/solely agentic/);
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });
    const done = await execute(runId);
    expect(done.status, done.message).not.toBe("waiting");
    const s = replay(ledger.events());
    expect(s.steps.get("export")!.status).toBe("completed");
    const est = ledger.getJson<{ parentEstimate?: string; deliveryModel: string; gateHours: unknown[] }>(s.steps.get("estimate")!.outputs[0]!);
    expect(est.parentEstimate).toBe(approved.estimateSha);
    expect(est.deliveryModel).toBe("agentic");
    expect(est.gateHours).toEqual([]);
  });

  it("a change request is a full estimate whose card shows what changed from the approved one, and whose file says version 2", async () => {
    const parent = await approvedRun();
    const approved = approvedEstimate(parent);
    const runId = await createRun("Build a client portal where users sign in, export reports and pay.", "demo", "sam", { mode: "estimate", estimate: approved.settings, lineage: { kind: "change", approved } });
    const r = await execute(runId);
    expect(r.status, r.message).toBe("waiting");
    const ledger = Ledger.open(runId);
    const q = replay(ledger.events()).openCard!;
    await decide(ledger, { decision: "answer", hashPrefix: q.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } });
    const r2 = await execute(runId);
    expect(r2.status, r2.message).toBe("waiting");
    const card = replay(ledger.events()).openCard!;
    expect(ledger.readCard(card.cardId)).toMatch(/## Change from the approved estimate[\s\S]*Overall: /);
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });
    await execute(runId);
    const files = replay(ledger.events()).steps.get("export")!.data as { team: string };
    expect((await loadWorkbook(files.team)).getWorksheet("Summary")!.getCell("C8").value).toBe("2");
  });

  it("seeds a build run from the approved estimate: its spec, tasks and critic record, ready for gates B1-B5", async () => {
    const parent = await approvedRun();
    const approved = approvedEstimate(parent);
    const repo = mkdtempSync(join(tmpdir(), "factory-est-build-repo-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
    writeFileSync(join(repo, "a.txt"), "x");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo, env });
    writeFileSync(join(process.env.FACTORY_HOME!, "projects", "build.yaml"), stringify({ project: "build", repo, stack: "dotnet" }));
    const runId = await createRun(approved.request, "build", "sam", { lineage: { kind: "build", approved } });
    const s = replay(Ledger.open(runId).events());
    expect(s.info.mode).toBe("brownfield");
    expect(s.info.estimateRef).toMatchObject({ runId: parent, estimateSha: approved.estimateSha, breakdownSha: approved.breakdownSha, specSha: approved.specSha });
    const ledger = Ledger.open(runId);
    // the artifacts came across under their own hashes, with the approved run's own critic record
    expect(ledger.getJson(approved.estimateSha)).toBeTruthy();
    expect(ledger.getJson<{ findings: unknown[] }>(s.info.estimateRef!.criticSha!).findings).toEqual([]);
  });
});

describe("estimate mode for a request with UI (scripted model)", () => {
  /** Answer whatever card is open until the run stops waiting; returns the cards seen, in order. */
  async function drive(runId: string, hook: (kind: string, md: string) => void = () => undefined, stopAt?: string): Promise<string[]> {
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await execute(runId);
      if (r.status !== "waiting") { expect(r.status, r.message).not.toBe("failed"); return seen; }
      const ledger = Ledger.open(runId);
      const c = replay(ledger.events()).openCard!;
      seen.push(c.kind);
      hook(c.kind, ledger.readCard(c.cardId));
      if (c.kind === stopAt) return seen;
      await decide(ledger, c.kind === "question"
        ? { decision: "answer", hashPrefix: c.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } }
        : { decision: "approve", hashPrefix: c.artifactSha.slice(0, 6), by: "lead" });
    }
    throw new Error("the run kept waiting");
  }
  const start = (request = "Build a client portal where users sign in and export reports.", extra: Record<string, unknown> = {}) =>
    createRun(request, "demo", "sam", { mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", designInTotal: true, feedbackRounds: 2, noRepo: true, client: "Acme", projectName: "Portal" }, ...extra });

  it("draws the screens, shows a clickable demo for approval, checks the breakdown against them, then estimates and exports", async () => {
    ui = true;
    const runId = await start();
    let demo = "";
    const cards = await drive(runId, (kind, md) => { if (kind === "design-approval") demo = md; });
    expect(cards).toEqual(["question", "design-approval", "estimate-approval"]);
    expect(demo).toMatch(/S-1 \/login .*states: empty, error/);
    expect(demo).toMatch(/Clickable demo .*design-demo\.html/);
    const ledger = Ledger.open(runId);
    const html = readFileSync(join(ledger.dir, "design-demo.html"), "utf8");
    expect(html).toMatch(/id="S-2"/);
    // the same page is what `factory ui` shows under Run: Preview
    const pv = readPreview(ledger);
    expect("preview" in pv && pv.preview.site?.screens.map((x) => x.title)).toEqual(["Open orders (/login)", "Open orders (/reports)"]);
    expect(previewFile(ledger, "index.html")?.body.toString()).toBe(html);
    const s = replay(ledger.events());
    for (const step of ["design", "design-baseline", "breakdown", "estimate", "approve-estimate", "export"]) expect(s.steps.get(step)?.status, step).toBe("completed");
    const gates = s.gates.map((g) => `${g.gateId}:${g.passed}`);
    for (const g of ["estimate.e1b-design-baseline", "estimate.e1c-design-coverage"]) expect(gates, g).toContain(`${g}:true`);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
    const bd = ledger.getJson<{ tasks: { id: string; screen?: string }[] }>(s.steps.get("breakdown")!.outputs[0]!);
    expect(bd.tasks.filter((t) => t.screen).map((t) => t.screen).sort()).toEqual(["S-1", "S-2"]);
  });

  it("refuses a breakdown whose screen nobody approved, feeding the failure back", async () => {
    ui = true;
    const runId = await start();
    await drive(runId);
    // a second run whose model cites a screen that is not in the approved design
    const bad = await start();
    const saved = provider.start;
    let asked = 0;
    (provider as { start: typeof provider.start }).start = (m, e, system, ...rest) => {
      if (system.includes("turning a finished spec")) asked++;
      return saved.call(provider, m, e, system, ...rest);
    };
    uiDesign = { ...UI_DESIGN, screens: [UI_DESIGN.screens[0]!], noScreen: [{ req: "REQ-2", reason: "a report job with no screen" }] };
    try {
      const r = await (async () => { for (let i = 0; i < 3; i++) { const x = await execute(bad); if (x.status === "waiting") { const l = Ledger.open(bad); const c = replay(l.events()).openCard!; await decide(l, c.kind === "question" ? { decision: "answer", hashPrefix: c.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } } : { decision: "approve", hashPrefix: c.artifactSha.slice(0, 6), by: "lead" }); } else return x; } return undefined; })();
      // the scripted breakdown cites S-2, which this design does not have: E1c fails and the run cannot finish
      expect(r?.status).not.toBe("completed");
      const gates = replay(Ledger.open(bad).events()).gates.map((g) => `${g.gateId}:${g.passed}`);
      expect(gates).toContain("estimate.e1c-design-coverage:false");
      expect(asked).toBeGreaterThan(0);
    } finally { (provider as { start: typeof provider.start }).start = saved; }
  });

  it("the other delivery model reuses the approved design without redrawing it, and a build inherits it", async () => {
    ui = true;
    const parent = await start();
    await drive(parent);
    const approved = approvedEstimate(parent);
    expect(approved.designSha).toBeTruthy();
    expect(approved.baselineSha).toBeTruthy();
    prompts = [];
    const sib = await createRun(approved.request, "demo", "sam", { mode: "estimate", estimate: { ...approved.settings, deliveryModel: "agentic" }, lineage: { kind: "sibling", approved } });
    const cards = await drive(sib);
    expect(cards).toEqual(["estimate-approval"]);
    expect(prompts.some((p) => /screen inventory/.test(p))).toBe(false);
    const s = replay(Ledger.open(sib).events());
    expect(s.steps.get("design-baseline")!.status).toBe("completed");
    expect(s.gates.map((g) => g.gateId)).not.toContain("estimate.e1b-design-baseline");

    const repo = mkdtempSync(join(tmpdir(), "factory-est-build-ui-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
    writeFileSync(join(repo, "a.txt"), "x");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo, env });
    writeFileSync(join(process.env.FACTORY_HOME!, "projects", "build.yaml"), stringify({ project: "build", repo, stack: "dotnet" }));
    const build = await createRun(approved.request, "build", "sam", { lineage: { kind: "build", approved } });
    const info = replay(Ledger.open(build).events()).info;
    expect(info.estimateRef?.designSha).toBe(approved.designSha);
    expect(Ledger.open(build).getJson<{ screens: unknown[] }>(approved.designSha!).screens).toHaveLength(2);
  });

  it("a change request shows the design diff against the approved design", async () => {
    ui = true;
    const parent = await start();
    await drive(parent);
    const approved = approvedEstimate(parent);
    uiDesign = { ...UI_DESIGN, screens: [...UI_DESIGN.screens, { id: "S-3", route: "/pay", file: "app/pay/page.tsx", reqs: ["REQ-1"], states: [], size: "new", frames: [] }] };
    const cr = await createRun("Build a client portal where users sign in, export reports and pay.", "demo", "sam", { mode: "estimate", estimate: approved.settings, lineage: { kind: "change", approved } });
    let card = "";
    // the scripted breakdown does not build the new screen, so the run would stop at E1c after this card: look at the card only
    await drive(cr, (kind, md) => { if (kind === "design-approval") card = md; }, "design-approval");
    expect(card).toMatch(/## Change from the approved design[\s\S]*Added screen S-3 \/pay/);
  });
});
