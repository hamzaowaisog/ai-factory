// End to end: an estimate from requirements alone, through the real executor, with a scripted model.
// One question card, then the lead's approval card, then two workbooks on disk.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
import { setRecordsSource } from "./estimate.js";
import { setProviderFactory } from "./think.js";

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
    { id: "EST-1", title: "Sign-in endpoint", featureId: "F-1", reqs: ["REQ-1"], items: ["email and password", "lockout after 5 tries"], track: "backend", executor: "factory", dependsOn: [], complexity: "standard" },
    { id: "EST-2", title: "PDF report", featureId: "F-2", reqs: ["REQ-2"], items: ["one-page summary"], track: "backend", executor: "factory", dependsOn: ["EST-1"], complexity: "external-dependency" },
    { id: "EST-3", title: "Client UAT", featureId: "F-1", reqs: [], items: [], track: "qa", executor: "human", dependsOn: ["EST-2"], complexity: "standard", overhead: "client acceptance testing" },
  ],
  checklist: [{ item: "auth", included: true }, { item: "monitoring", included: false, reason: "client hosts and monitors" }],
};
const sizing = {
  anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "a typical endpoint with validation for this stack" }],
  tasks: [
    { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "the anchor" },
    { taskId: "EST-2", anchorId: "EST-1", ratio: 1.5, reason: "a PDF library on top of the same shape" },
    { taskId: "EST-3", anchorId: "EST-1", ratio: 1, reason: "a day of client testing" },
  ],
};

let prompts: string[] = [];
/** a large document: two modules, each with its own intake span, no questions, four requirements in all */
let modular = false;
let intakeCalls = 0;
const MODULE_SPANS = ["ALPHA sign in flow", "BETA report export flow"];
const bigBreakdown = () => ({
  features: [{ id: "F-1", title: "Alpha", reqs: ["REQ-1", "REQ-2"] }, { id: "F-2", title: "Beta", reqs: ["REQ-3", "REQ-4"] }],
  tasks: [
    ...[1, 2, 3, 4].map((n) => ({ id: `EST-${n}`, title: `Build ${n}`, featureId: n <= 2 ? "F-1" : "F-2", reqs: [`REQ-${n}`], items: [`item ${n}`], track: "backend", executor: "factory", dependsOn: n > 1 ? [`EST-${n - 1}`] : [], complexity: "standard" })),
    { id: "EST-5", title: "Client UAT", featureId: "F-1", reqs: [], items: [], track: "qa", executor: "human", dependsOn: ["EST-4"], complexity: "standard", overhead: "client acceptance testing" },
  ],
  checklist: breakdown.checklist,
});
const bigSizing = () => ({
  anchors: sizing.anchors,
  tasks: [1, 2, 3, 4, 5].map((n) => ({ taskId: `EST-${n}`, anchorId: "EST-1", ratio: n === 1 ? 1 : 1.25, reason: n === 1 ? "the anchor" : "a little more than the anchor" })),
});
function answerFor(system: string): unknown {
  prompts.push(system.slice(0, 60));
  if (modular && system.includes("intake step")) return { source: "cli", spans: [{ id: "I-1", text: MODULE_SPANS[intakeCalls++ % 2]! }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false };
  if (modular && system.includes("sizing the tasks")) return bigSizing();
  if (modular && system.includes("turning a finished spec")) return bigBreakdown();
  if (modular && system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("intake step")) return { source: "cli", spans: [{ id: "I-1", text: "sign in and export reports" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false };
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
  if (system.includes("turning a finished spec")) return breakdown;
  throw new Error(`unscripted system prompt: ${system.slice(0, 80)}`);
}
const provider: Provider = {
  start(_m, _e, system): Conversation {
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answerFor(system) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-est-e2e-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "demo.yaml"), stringify({ project: "demo", repo: mkdtempSync(join(tmpdir(), "factory-est-repo-")), stack: "dotnet" }));
  setProviderFactory(() => provider);
  setRecordsSource(() => []);
  prompts = [];
  modular = false;
  intakeCalls = 0;
});

describe("estimate mode end to end (requirements only, scripted model)", () => {
  it("runs from requirements to an approved estimate and two workbooks", async () => {
    const runId = await createRun("Build a client portal where users sign in and export reports.", "demo", "sam", {
      mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", designInTotal: true, feedbackRounds: 2, noRepo: true, client: "Acme", projectName: "Portal", pm: "A. Lead", rates: { backend: 50, default: 40 } },
    });
    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    const ledger = Ledger.open(runId);
    const q = replay(ledger.events()).openCard!;
    expect(q.kind).toBe("question");
    await decide(ledger, { decision: "answer", hashPrefix: q.artifactSha.slice(0, 6), by: "lead", data: { answers: { "Q-1": "A" } } });

    const r2 = await execute(runId);
    expect(r2.status, r2.message).toBe("waiting");
    const card = replay(ledger.events()).openCard!;
    expect(card.kind).toBe("estimate-approval");
    const md = ledger.readCard(card.cardId);
    expect(md).toMatch(/## Anchors[\s\S]*EST-1 Sign-in endpoint: 4-8 h/);
    expect(md).toMatch(/estimate\.e1-readiness/);
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
    const gates = s.gates.map((g) => `${g.gateId}:${g.passed}`);
    for (const g of ["estimate.e1-readiness", "estimate.e1b-design-baseline", "estimate.e2-req-to-task", "estimate.e3-task-to-req", "estimate.e4-checklist", "estimate.e5-consistency", "estimate.e6-lint", "estimate.e7-approval"]) expect(gates, g).toContain(`${g}:true`);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);

    const files = s.steps.get("export")!.data as { team: string; client: string };
    expect(existsSync(files.team) && existsSync(files.client)).toBe(true);
    const team = await loadWorkbook(files.team), client = await loadWorkbook(files.client);
    expect(team.getWorksheet("Summary")!.getCell("C3").value).toBe("Acme");
    expect(team.getWorksheet("Cost")).toBeTruthy();
    expect(client.getWorksheet("Cost")).toBeUndefined();
    expect(client.getWorksheet("Anchors")).toBeUndefined();
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
});
