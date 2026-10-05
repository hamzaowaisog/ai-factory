// Estimate mode, the steps around the model: ground without a repo, the design baseline (E1b),
// waivers, the lead's approval (E7) and the export, with real ledgers and no model calls except where scripted.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Estimate, type Breakdown } from "../contracts/index.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import "../estimate/gates.js";
import "../estimate/lint.js";
import { loadWorkbook } from "../estimate/workbook-lint.js";
import { estimateApiCost } from "../estimate/cost.js";
import { gateHours } from "../estimate/gate-hours.js";
import { sizeTasks } from "../estimate/hours.js";
import { computeTotals } from "../estimate/totals.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { approveEstimateStep, exportStep } from "./estimate-approve.js";
import { designBaselineStep, makeDesignApprovalStep } from "./design-approve.js";
import { estimateGroundStep, newBuildBehaviour } from "./estimate-ground.js";
import { breakdownStep, estimateStep, setRecordsSource, setTaskRecordsSource } from "./estimate.js";
import { designQuality, designStep, mapDesign, MAX_DESIGN_REVISIONS } from "./design.js";
import type { StepContext, StepDef, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";
import { lightUi, LIGHT_UI_REQS } from "./lane.js";
import { NO_TRACE } from "../util/trace.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
let answer: (system: string) => unknown = () => { throw new Error("the model must not be called"); };
let modelCalls = 0;
const provider: Provider = {
  start(): Conversation {
    return { async next(_m?: unknown): Promise<Turn> { modelCalls++; return { calls: [{ id: "s", name: "submit_result", input: answer("") }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-flow-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  modelCalls = 0;
  setRecordsSource(() => []);
  setTaskRecordsSource(() => []);
  answer = () => { throw new Error("the model must not be called"); };
  setProviderFactory(() => provider);
});

let n = 0;
async function newRun(data: Record<string, unknown> = {}): Promise<Ledger> {
  const ledger = Ledger.create(`20260930-flow-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "a portal", operator: "sam", ...data } }, HUMAN_WRITER);
  return ledger;
}
async function complete(ledger: Ledger, step: string, output: unknown, extra: Record<string, unknown> = {}) {
  const out = ledger.putJson(output);
  await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [out], data: { named: { [step]: out }, ...extra } }, HUMAN_WRITER);
}
async function exec(ledger: Ledger, step: StepDef, attempt = 1): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
  const out = await step.run(ctx);
  if (out.kind === "done") await ledger.append({ type: "step.completed", key: `${step.key}/${attempt}`, inputsHash: sha, outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  return out;
}
/** What the executor records for a card, then what `factory approve|reject|waive` records for the decision. */
async function decide(ledger: Ledger, out: StepOutcome, step: string, decision: string, data: Record<string, unknown> = {}) {
  if (out.kind !== "wait") throw new Error(`expected a card, got ${out.kind}`);
  const c = out.card;
  await ledger.append({ type: "human.requested", data: { ...(c.extra ?? {}), cardId: c.cardId, kind: c.kind, artifactSha: c.artifactSha, step } }, HUMAN_WRITER);
  await ledger.append({ type: "human.decided", data: { cardId: c.cardId, decision, by: "lead", artifactSha: c.artifactSha, ...data } }, HUMAN_WRITER);
}

// ---------- fixtures ----------
const KIND: Record<string, string> = { backend: "be-crud", web: "ui-form", pm: "pm-management" };
const task = (id: string, featureId: string, track: string, executor: string, extra: object = {}) =>
  ({ id, title: `Task ${id}`, featureId, reqs: ["REQ-1"], items: ["field a"], track, kind: KIND[track], executor, dependsOn: [], complexity: "standard", ...extra });
const breakdown = {
  header: { kind: "work-breakdown", schemaVersion: 1, runId: "r", producedBy: { stage: "breakdown" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
  features: [{ id: "F-1", title: "Login", reqs: ["REQ-1"] }],
  tasks: [task("EST-1", "F-1", "backend", "human"), task("EST-2", "F-1", "web", "factory"), task("EST-3", "F-1", "pm", "human", { reqs: [], overhead: "project management" })],
  checklist: [{ item: "auth", included: true }], specSha: sha,
} as unknown as Breakdown;
const spec = { requirements: [{ id: "REQ-1", ears: "The system shall let a user sign in.", op: "ADDED", sources: ["I-1"], acceptance: [] }], nfrs: [], outOfScope: [], assumptions: [], lint: [], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } };

function estimateOf(opts: { flagged?: string[]; model?: "hitl" | "agentic" } = {}) {
  const model = opts.model ?? "hitl";
  const sizing = sizeTasks([{ taskId: "EST-1", hours: { min: 4, max: 8 } }], [
    { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "anchor", executor: "human" },
    { taskId: "EST-2", anchorId: "EST-1", ratio: 2, reason: "twice", executor: "factory" },
    { taskId: "EST-3", anchorId: "EST-1", ratio: 0.25, reason: "light", executor: "human" },
  ]).map((t) => ({ ...t, flagged: !!opts.flagged?.includes(t.taskId) }));
  const gates = gateHours(model, { questions: 2, approvalSections: 2, prs: { low: 1, medium: 0, high: 0 }, factoryTasks: 1, waivers: 0 });
  const totals = computeTotals(breakdown.tasks, sizing, [], gates, true);
  return Estimate.parse({
    header: { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
    deliveryModel: model, band: "S", uncertainty: "medium", breakdownSha: sha, specSha: sha,
    anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "typical login form" }], tasks: sizing, overheads: [], gateHours: gates, totals,
    apiCost: estimateApiCost({ planning: 1, build: 1, verification: 1 }, [], model),
    elapsed: { planningMinutes: 10, criticalPathDays: { min: 1, max: 2 } },
    settings: { stackSource: "client", designInTotal: true, feedbackRounds: 2 }, assumptions: ["Keys arrive before build"], suggested: [],
  });
}

async function readyRun(estimate = estimateOf(), data: Record<string, unknown> = {}) {
  const ledger = await newRun(data);
  await complete(ledger, "specify", spec);
  await complete(ledger, "breakdown", breakdown);
  await complete(ledger, "estimate", estimate);
  return ledger;
}

// ---------- ground ----------
describe("estimate ground step", () => {
  it("a requirements-only run states every span as new build work, without a model call", async () => {
    const ledger = await newRun({ estimate: { noRepo: true } });
    await complete(ledger, "intake", { source: "cli", spans: [{ id: "I-1", text: "a" }, { id: "I-2", text: "b" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false });
    const out = await exec(ledger, estimateGroundStep);
    expect(out.kind).toBe("done");
    const cb = ledger.getJson<ReturnType<typeof newBuildBehaviour>>((out as { outputs: Record<string, string> }).outputs.cb!)!;
    expect(cb.claims).toEqual([]);
    expect(cb.notFound.map((x) => x.span)).toEqual(["I-1", "I-2"]);
    expect(modelCalls).toBe(0);
  });
  it("its inputs depend on whether there is a repo, so adding one re-runs it", async () => {
    const a = await newRun();
    const b = await newRun({ repoPath: "/r", baseCommit: "c".repeat(40) });
    for (const l of [a, b]) await complete(l, "intake", { source: "cli", spans: [{ id: "I-1", text: "a" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false });
    expect(estimateGroundStep.inputs(replay(a.events()), a)).toMatchObject({ repo: false });
    expect(estimateGroundStep.inputs(replay(b.events()), b)).toMatchObject({ repo: true });
  });
});

describe("estimate ground step on an existing repo (any stack)", () => {
  function tsRepo(): { dir: string; commit: string } {
    const dir = mkdtempSync(join(tmpdir(), "factory-flow-repo-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "src/app"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0", pg: "8.0.0" }, devDependencies: { vitest: "3.0.0" } }));
    writeFileSync(join(dir, "src/app/page.tsx"), "export default function Page() { return <main>Hi</main>; }\n");
    writeFileSync(join(dir, "src/index.ts"), "export const greeting = 'hi';\n");
    writeFileSync(join(dir, "tests/index.test.ts"), "import { greeting } from '../src/index';\n");
    git("add", "-A"); git("commit", "-q", "-m", "init");
    return { dir, commit: git("rev-parse", "HEAD").trim() };
  }
  it("grounds with the normal step, then stores a language-neutral survey and the design inventory for UI work", async () => {
    const { dir, commit } = tsRepo();
    const ledger = await newRun({ repoPath: dir, baseCommit: commit, baseRef: "main" });
    await complete(ledger, "intake", uiIntent(true));
    answer = () => ({ claims: [{ id: "C-1", text: "The greeting is hi", spans: ["I-1"], anchors: [{ path: "src/index.ts", lineStart: 1, lineEnd: 1, quote: "export const greeting = 'hi';", symbol: "greeting" }] }], notFound: [] });
    const out = await exec(ledger, estimateGroundStep);
    expect(out.kind, JSON.stringify(out)).toBe("done");
    const named = (out as { outputs: Record<string, string> }).outputs;
    expect(Object.keys(named).sort()).toEqual(["cb", "design", "survey"]);
    const survey = ledger.getJson<{ languages: { name: string }[]; signals: string[]; tests: { present: boolean } }>(named.survey!)!;
    expect(survey.languages.map((l) => l.name)).toContain("TypeScript");
    expect(survey.signals).toEqual(expect.arrayContaining(["Next.js", "React", "PostgreSQL"]));
    expect(survey.tests.present).toBe(true);
    expect(ledger.getJson<{ framework?: unknown }>(named.design!)).toBeTruthy();
  });
  it("leaves out the design inventory when the request has no UI", async () => {
    const { dir, commit } = tsRepo();
    const ledger = await newRun({ repoPath: dir, baseCommit: commit, baseRef: "main" });
    await complete(ledger, "intake", uiIntent(false));
    answer = () => ({ claims: [{ id: "C-1", text: "The greeting is hi", spans: ["I-1"], anchors: [{ path: "src/index.ts", lineStart: 1, lineEnd: 1, quote: "export const greeting = 'hi';" }] }], notFound: [] });
    const out = await exec(ledger, estimateGroundStep);
    expect(Object.keys((out as { outputs: Record<string, string> }).outputs).sort()).toEqual(["cb", "survey"]);
  });
});

// ---------- E1b ----------
const uiIntent = (touchesUi: boolean) => ({ source: "cli", spans: [{ id: "I-1", text: "a" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi });
const design = (over: Record<string, unknown> = {}) => ({
  header: { kind: "design", schemaVersion: 1, runId: "r", producedBy: { stage: "design" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
  flow: "login then home", screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"] }], mapping: { unmappedReqs: [], orphanScreens: [] }, ...over,
});

describe("design baseline (E1b)", () => {
  it("passes at once for a request with no UI", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "intake", uiIntent(false));
    expect((await exec(ledger, designBaselineStep)).kind).toBe("done");
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("estimate.e1b-design-baseline:true");
  });
  it("parks a UI request that has no design yet: no soft estimate", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "intake", uiIntent(true));
    const out = await exec(ledger, designBaselineStep);
    expect(out.kind).toBe("park");
    expect((out as { reason: string }).reason).toMatch(/E1b/);
  });
  it("asks a person to approve the design, then passes; a rejection parks with the reason", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "intake", uiIntent(true));
    await complete(ledger, "design", design());
    const card = await exec(ledger, designBaselineStep);
    expect(card.kind).toBe("wait");
    expect((card as { card: { markdown: string } }).card.markdown).toMatch(/S-1 \/login .* REQ-1/);
    await decide(ledger, card, "design-baseline", "approve");
    expect((await exec(ledger, designBaselineStep)).kind).toBe("done");

    const other = await newRun();
    await complete(other, "specify", spec);
    await complete(other, "intake", uiIntent(true));
    await complete(other, "design", design());
    await decide(other, await exec(other, designBaselineStep), "design-baseline", "reject", { reason: "missing the error states" });
    // a rejection is not a stop: the design is sent back with the reason (its step now has new inputs) and a fresh card follows
    expect(designStep.inputs(replay(other.events()), other)).toMatchObject({ rejections: ["missing the error states"] });
    expect((await exec(other, designBaselineStep)).kind).toBe("wait");
  });
  it("sends a rejected design back to be redrawn, and stops only after too many rounds", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "intake", uiIntent(true));
    await complete(ledger, "design", design());
    const before = designStep.inputs(replay(ledger.events()), ledger);
    for (let i = 0; i <= MAX_DESIGN_REVISIONS; i++) {
      await decide(ledger, await exec(ledger, designBaselineStep), "design-baseline", "reject", { reason: `round ${i + 1}` });
      if (i < MAX_DESIGN_REVISIONS) expect(designStep.inputs(replay(ledger.events()), ledger)).not.toEqual(before);
    }
    const parked = await exec(ledger, designBaselineStep);
    expect(parked.kind).toBe("park");
    expect((parked as { reason: string }).reason).toMatch(/sent back 5 times.*round 5/);
  });
  it("asks about an approved design whose screen links to no requirement (another attempt cannot fix it)", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "intake", uiIntent(true));
    await complete(ledger, "design", design({ screens: [{ id: "S-1", route: "/login", file: "a.tsx", reqs: [] }] }));
    await decide(ledger, await exec(ledger, designBaselineStep), "design-baseline", "approve");
    const out = await exec(ledger, designBaselineStep);
    expect(out).toMatchObject({ kind: "ask", reason: expect.stringMatching(/gate E1b/) });
    expect((out as { failures: { check: string }[] }).failures.map((f) => f.check)).toContain("e1b-screen");
  });
});

// ---------- waivers ----------
describe("waiving a gate", () => {
  const badBreakdown = () => ({
    features: [{ id: "F-1", title: "Login", reqs: ["REQ-1"] }],
    tasks: [task("EST-1", "F-1", "backend", "factory"), task("EST-2", "F-1", "web", "factory", { reqs: [] })], // EST-2 has no requirement and no reason (E3)
    checklist: [{ item: "auth", included: true }],
  });
  async function breakdownRun() {
    const ledger = await newRun();
    await complete(ledger, "intake", uiIntent(false));
    await complete(ledger, "clarify", { round: 1, asked: [], assumptions: [], differences: [], conflicts: [] });
    await complete(ledger, "clarify-2", { round: 2, asked: [], assumptions: [], differences: [], conflicts: [] });
    await complete(ledger, "specify", spec);
    return ledger;
  }
  it("fails the first attempt, asks the lead on the second, and records the waiver on the third without another model call", async () => {
    const ledger = await breakdownRun();
    answer = () => badBreakdown();
    expect((await exec(ledger, breakdownStep, 1)).kind).toBe("fail");
    const card = await exec(ledger, breakdownStep, 2);
    expect(card.kind).toBe("wait");
    expect((card as { card: { kind: string; markdown: string } }).card.kind).toBe("waiver");
    expect((card as { card: { markdown: string } }).card.markdown).toMatch(/e3/);
    await decide(ledger, card, "breakdown", "waive", { reason: "support task, tracked under REQ-1 by the lead" });
    const calls = modelCalls;
    const out = await exec(ledger, breakdownStep, 3);
    expect(out.kind).toBe("done");
    expect(modelCalls).toBe(calls);
    const state = replay(ledger.events());
    expect(state.waivers).toBe(1);
    expect(state.steps.get("breakdown")!.data!.waivers).toEqual([expect.objectContaining({ human: "lead", gateIds: ["estimate.e3-task-to-req"], reason: expect.stringMatching(/support task/) })]);
  });
  it("never offers a waiver for a gate that cannot be waived (E2)", async () => {
    const ledger = await breakdownRun();
    answer = () => ({ ...badBreakdown(), tasks: [task("EST-1", "F-1", "backend", "factory", { reqs: [] , overhead: "x" })] }); // REQ-1 has no task
    expect((await exec(ledger, breakdownStep, 2)).kind).toBe("fail");
  });
});

// ---------- E7 ----------
describe("approve-estimate (E7)", () => {
  it("shows a card with the anchors first, then waits for a hash-bound approval", async () => {
    const ledger = await readyRun();
    const out = await exec(ledger, approveEstimateStep);
    expect(out.kind).toBe("wait");
    const md = (out as { card: { markdown: string; kind: string } }).card.markdown;
    expect(md.indexOf("## Anchors")).toBeLessThan(md.indexOf("## Totals"));
    expect(md).toMatch(/EST-1 Task EST-1: 4-8 h\. typical login form/);
    expect(md).toMatch(/API credits: \$/);
    expect(md).toMatch(/factory approve [\s\S]*Card hash/);
  });
  it("records the approval against the estimate's hash and finishes", async () => {
    const ledger = await readyRun();
    await decide(ledger, await exec(ledger, approveEstimateStep), "approve-estimate", "approve");
    const out = await exec(ledger, approveEstimateStep);
    expect(out.kind).toBe("done");
    const a = ledger.getJson<{ by: string; estimateHash: string }>((out as { outputs: Record<string, string> }).outputs.approval!)!;
    expect(a.by).toBe("lead");
    expect(a.estimateHash).toHaveLength(64);
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("estimate.e7-approval:true");
  });
  it("does not accept an approval that skips a low-confidence line: it asks again, and the sign-off passes", async () => {
    const ledger = await readyRun(estimateOf({ flagged: ["EST-2"] }));
    const first = await exec(ledger, approveEstimateStep);
    expect((first as { card: { markdown: string } }).card.markdown).toMatch(/--sign-off EST-2/);
    await decide(ledger, first, "approve-estimate", "approve");
    const again = await exec(ledger, approveEstimateStep);
    expect(again.kind).toBe("wait");
    expect((again as { card: { markdown: string } }).card.markdown).toMatch(/not accepted.*EST-2/s);
    await decide(ledger, again, "approve-estimate", "approve", { signOff: ["EST-2"] });
    expect((await exec(ledger, approveEstimateStep)).kind).toBe("done");
  });
  it("parks on a rejection with the reason, and a changed estimate needs a new card", async () => {
    const ledger = await readyRun();
    await decide(ledger, await exec(ledger, approveEstimateStep), "approve-estimate", "reject", { reason: "too low for the PDF export" });
    const out = await exec(ledger, approveEstimateStep);
    expect(out.kind).toBe("park");
    expect((out as { reason: string }).reason).toMatch(/too low for the PDF export/);
    // a different estimate (new sha) is a different card: the old rejection does not carry over
    await complete(ledger, "estimate", estimateOf({ model: "agentic" }));
    expect((await exec(ledger, approveEstimateStep)).kind).toBe("wait");
  });
  it("lists waivers on the card", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "breakdown", breakdown, { waivers: [{ gateIds: ["estimate.e4-checklist"], human: "lead", reason: "client runs CI", boundTo: sha }] });
    await complete(ledger, "estimate", estimateOf());
    const md = ((await exec(ledger, approveEstimateStep)) as { card: { markdown: string } }).card.markdown;
    expect(md).toMatch(/## Waivers\n- estimate.e4-checklist \(breakdown\): waived by lead\. client runs CI/);
  });
});

// ---------- export ----------
describe("export step", () => {
  async function approved(data: Record<string, unknown> = {}, estimate = estimateOf()) {
    const ledger = await readyRun(estimate, data);
    await decide(ledger, await exec(ledger, approveEstimateStep), "approve-estimate", "approve");
    expect((await exec(ledger, approveEstimateStep)).kind).toBe("done");
    return ledger;
  }
  it("writes both workbooks, lints them cell by cell, and records their hashes", async () => {
    const ledger = await approved({ estimate: { client: "Acme", projectName: "Portal", pm: "A. Lead" } });
    const out = await exec(ledger, exportStep);
    expect(out.kind).toBe("done");
    const m = ledger.getJson<{ team: string; client: string; teamSha256: string }>((out as { outputs: Record<string, string> }).outputs.manifest!)!;
    expect(existsSync(m.team) && existsSync(m.client)).toBe(true);
    expect(m.teamSha256).toHaveLength(64);
    const team = await loadWorkbook(m.team), client = await loadWorkbook(m.client);
    expect(team.getWorksheet("Summary")!.getCell("C5").value).toBe("Acme");
    expect(team.getWorksheet("Gates")).toBeTruthy();
    expect(client.getWorksheet("Gates")).toBeUndefined();
    // no rates given: no cost overlay in either file
    expect(team.getWorksheet("Cost")).toBeUndefined();
  });
  it("adds the cost overlay to the team file only when rates are given, and its totals recompute", async () => {
    const ledger = await approved({ estimate: { rates: { backend: 50, web: 60, default: 40 } } });
    const out = await exec(ledger, exportStep);
    expect(out.kind).toBe("done");
    const m = ledger.getJson<{ team: string; client: string }>((out as { outputs: Record<string, string> }).outputs.manifest!)!;
    const team = await loadWorkbook(m.team), client = await loadWorkbook(m.client);
    const cost = team.getWorksheet("Cost")!;
    expect(cost).toBeTruthy();
    expect(client.getWorksheet("Cost")).toBeUndefined();
    let total = 0, row = 0;
    cost.eachRow((r, i) => { if (r.getCell("B").value === "Total") { row = i; const v = cost.getCell(`D${i}`).value as { result?: number }; total = v.result ?? 0; } });
    expect(row).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
  });
  it("shows gate results and waivers in the team file's Gates sheet", async () => {
    const ledger = await newRun();
    await complete(ledger, "specify", spec);
    await complete(ledger, "breakdown", breakdown, { waivers: [{ gateIds: ["estimate.e4-checklist"], human: "lead", reason: "client runs CI", boundTo: sha }] });
    await complete(ledger, "estimate", estimateOf());
    await decide(ledger, await exec(ledger, approveEstimateStep), "approve-estimate", "approve");
    await exec(ledger, approveEstimateStep);
    const out = await exec(ledger, exportStep);
    const m = ledger.getJson<{ team: string }>((out as { outputs: Record<string, string> }).outputs.manifest!)!;
    const g = (await loadWorkbook(m.team)).getWorksheet("Gates")!;
    const cells: string[] = [];
    g.eachRow((r) => r.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain("estimate.e4-checklist");
    expect(cells.some((c) => /lead: client runs CI/.test(c))).toBe(true);
    expect(cells).toContain("estimate.e7-approval");
  });
  it("only starts after the approval", () => {
    return newRun().then((l) => expect(exportStep.inputs(replay(l.events()), l)).toBeUndefined());
  });
});

// ---------- design step ----------
describe("design step", () => {
  const twoReqs = { ...spec, requirements: [...spec.requirements, { id: "REQ-2", ears: "The system shall export a PDF report.", op: "ADDED", sources: ["I-1"], acceptance: [] }] };
  const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Epic MyChart", took: "calm white page, one blue action" }, { ref: "Linear", took: "hairline borders, compact tables" }] };
  const mock = { title: "Sign in", blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Sign in"] }], copy: {} };
  /** a finished-looking answer: every screen without a frame gets sample content, and the product has a theme */
  const dress = (o: { screens: Record<string, unknown>[] } & Record<string, unknown>) => ({ theme, ...o, screens: o.screens.map((s) => (s.mock || (s.frames as unknown[] | undefined)?.length ? s : { ...s, mock, mockFull: mock })) });
  const out = (over: Record<string, unknown> = {}) => dress({
    flow: "A user signs in, lands on the dashboard", screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new" }],
    noScreen: [{ req: "REQ-2", reason: "a scheduled job, no screen" }], ...over,
  } as never);
  async function uiRun(touchesUi = true) {
    const ledger = await newRun();
    await complete(ledger, "intake", uiIntent(touchesUi));
    await complete(ledger, "specify", twoReqs);
    return ledger;
  }
  it("draws no screens when the request has no UI, without a model call", async () => {
    const ledger = await uiRun(false);
    const o = await exec(ledger, designStep);
    expect(o.kind).toBe("done");
    expect(modelCalls).toBe(0);
    expect(ledger.getJson<{ skipped: boolean }>((o as { outputs: Record<string, string> }).outputs.design!).skipped).toBe(true);
  });
  it("records the screens, states and sizes the model proposes once every requirement is on a screen or exempt", async () => {
    const ledger = await uiRun();
    answer = () => out();
    const o = await exec(ledger, designStep);
    expect(o.kind).toBe("done");
    const d = ledger.getJson<{ screens: { id: string; states: string[] }[]; noScreen: unknown[] }>((o as { outputs: Record<string, string> }).outputs.design!);
    expect(d.screens[0]).toMatchObject({ id: "S-1", states: ["error"] });
    expect(d.noScreen).toHaveLength(1);
  });
  it("fails on a requirement that is on no screen, a screen that serves none, and an invented requirement", async () => {
    const ledger = await uiRun();
    answer = () => out({ noScreen: [], screens: [{ id: "S-1", route: "/a", file: "a.tsx", reqs: ["REQ-1", "REQ-7"] }, { id: "S-2", route: "/b", file: "b.tsx", reqs: [] }] });
    const o = await exec(ledger, designStep);
    expect(o.kind).toBe("fail");
    expect((o as { failures: { check: string }[] }).failures.map((f) => f.check).sort()).toEqual(["design-orphan", "design-unknown-req", "design-unmapped"]);
  });
  it("mapDesign reports both directions", () => {
    expect(mapDesign(["R-1", "R-2"], { flow: "f", screens: [{ id: "S-1", route: "/", file: "a", reqs: ["R-1"], states: [], size: "new", frames: [] }], noScreen: [] })).toMatchObject({ unmappedReqs: ["R-2"], orphanScreens: [], unknown: [], duplicateIds: [], duplicateRoutes: [] });
  });
  it("fails a duplicate screen id, a route used twice, and frames that are cited but not attached or attached but unused", async () => {
    const ledger = await newRun({ request: "Build a login.\n- F-1 home.png\n- F-2 login.png\n- F-3 export.json" });
    await complete(ledger, "intake", uiIntent(true));
    await complete(ledger, "specify", twoReqs);
    answer = () => out({ screens: [
      { id: "S-1", route: "/login", file: "a.tsx", reqs: ["REQ-1"], frames: ["F-1", "F-9"] },
      { id: "S-1", route: "/Login/", file: "b.tsx", reqs: ["REQ-1"] },
    ] });
    const o = await exec(ledger, designStep);
    expect(o.kind).toBe("fail");
    // F-3 is a JSON export, data not a screen, so it is not required
    expect((o as { failures: { check: string }[] }).failures.map((f) => f.check).sort()).toEqual(["design-duplicate-id", "design-duplicate-route", "design-frame-unused", "design-unknown-frame"]);
  });
  it("puts the clickable demo on the card, and for a change request the diff from the approved design", async () => {
    const earlier = { flow: "f", screens: [{ id: "S-1", route: "/login", file: "a.tsx", reqs: ["REQ-1"], states: [], size: "new", frames: [] }, { id: "S-2", route: "/old", file: "o.tsx", reqs: ["REQ-1"], states: [], size: "new", frames: [] }], noScreen: [] };
    const scratch = await newRun();
    const designSha = scratch.putJson(earlier);
    const ledger = await newRun({ parent: { runId: "p", kind: "change", estimateSha: sha, breakdownSha: sha, specSha: sha, designSha } });
    ledger.putJson(earlier);
    await complete(ledger, "intake", uiIntent(true));
    await complete(ledger, "specify", twoReqs);
    answer = () => out({ screens: [{ id: "S-1", route: "/login", file: "a.tsx", reqs: ["REQ-1"], states: ["error"] }, { id: "S-3", route: "/export", file: "e.tsx", reqs: ["REQ-2"] }], noScreen: [] });
    expect((await exec(ledger, designStep)).kind).toBe("done");
    const card = await exec(ledger, designBaselineStep);
    expect(card.kind).toBe("wait");
    const md = (card as { card: { markdown: string } }).card.markdown;
    expect(md).toMatch(/Clickable demo .*design-demo\.html/);
    expect(md).toMatch(/Added screen S-3 \/export/);
    expect(md).toMatch(/Changed screen S-1: states none -> error/);
    expect(md).toMatch(/Removed screen S-2 \/old/);
    expect(existsSync(join(ledger.dir, "design-demo.html"))).toBe(true);
  });
  it("its approved screens feed E1b end to end", async () => {
    const ledger = await uiRun();
    answer = () => out();
    await exec(ledger, designStep);
    const card = await exec(ledger, designBaselineStep);
    expect(card.kind).toBe("wait");
    expect((card as { card: { markdown: string } }).card.markdown).toMatch(/S-1 \/login.*REQ-1; new; states: error/);
    await decide(ledger, card, "design-baseline", "approve");
    expect((await exec(ledger, designBaselineStep)).kind).toBe("done");
  });

  describe("sending the design back", () => {
    const page = (title: string, extra: object = {}) => ({ title, blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Go"] }], copy: {}, ...extra });
    const sc = (id: string, route: string, title: string, reqs: string[]) => ({ id, route, file: `${id}.tsx`, reqs, states: [], size: "new", mock: page(title), mockFull: page(title) });
    const three = () => ({ flow: "f", screens: [sc("S-1", "/find", "Find a flight", ["REQ-1"]), sc("S-2", "/book", "Book your flight", ["REQ-2"]), sc("S-3", "/trips", "My trips", ["REQ-1"])], noScreen: [] });
    const triage = (o: object) => ({ verdict: "patch", summary: "s", items: [], fine: [], notDesign: [], ...o });
    async function rejected(reason: string) {
      const ledger = await uiRun();
      answer = () => dress(three() as never);
      await exec(ledger, designStep);
      const card = await exec(ledger, designBaselineStep);
      await decide(ledger, card, "design-baseline", "reject", { reason });
      return ledger;
    }
    const queue = (...xs: unknown[]) => { answer = () => { if (!xs.length) throw new Error("one model call too many"); return xs.shift(); }; };
    const latest = (ledger: Ledger) => ledger.getJson<{ screens: { id: string; mock?: { title: string } }[]; rework?: { mode: string; patched: string[]; lines: string[]; kept: string[] }[]; revision?: number }>(replay(ledger.events()).steps.get("design")!.outputs[0]!);
    const item = (o: object) => ({ part: "screen", screen: "S-2", quote: "the booking page is crowded", change: "fewer blocks, clearer steps", confidence: "high", ...o });

    it("fixes only the page the lead named: one cheap read and one page call, the rest untouched", async () => {
      const ledger = await rejected("the booking page is way too crowded, the trips list is fine");
      const before = latest(ledger);
      const fixed = sc("S-2", "/book", "Book your flight", ["REQ-2"]);
      queue(triage({ items: [item({})], fine: ["S-3"] }), { screen: { ...fixed, mock: page("Book your flight", { blocks: [{ type: "steps", items: ["Seats", "Extras", "Pay"], current: 0 }, { type: "actions", buttons: ["Continue"] }] }) } });
      modelCalls = 0;
      const o = await exec(ledger, designStep);
      expect(o.kind).toBe("done");
      expect(modelCalls).toBe(2);
      const after = latest(ledger);
      expect(after.screens[0]).toEqual(before.screens[0]);
      expect(after.screens[2]).toEqual(before.screens[2]);
      expect(after.screens[1]).not.toEqual(before.screens[1]);
      expect(after.rework![0]).toMatchObject({ mode: "patch", patched: ["S-2"], kept: ["Find a flight", "My trips"] });
      expect(after.rework![0]!.lines[0]).toMatch(/^Book your flight: fewer blocks, clearer steps \(you said: "the booking page is crowded"\)/);
      const md = ((await exec(ledger, designBaselineStep)) as { card: { markdown: string } }).card.markdown;
      expect(md).toMatch(/## What changed from your feedback/);
      expect(md).toMatch(/Kept exactly as before: Find a flight, My trips\./);
      expect(md).toMatch(/- Book your flight: S-2 \/book/);
    });
    it("redraws everything when the note is about the structure, and says so", async () => {
      const ledger = await rejected("the whole flow is wrong, there should be a basket page");
      queue(triage({ verdict: "redraw", items: [item({ part: "screen", screen: undefined, confidence: "low" })] }), dress(three() as never));
      modelCalls = 0;
      expect((await exec(ledger, designStep)).kind).toBe("done");
      expect(modelCalls).toBe(2);
      expect(latest(ledger).rework![0]).toMatchObject({ mode: "redraw" });
      expect(latest(ledger).rework![0]!.lines[0]).toMatch(/organised, so I redrew all of it/);
    });
    it("draws nothing for a request no requirement covers, and says it is not a design change", async () => {
      const ledger = await rejected("add a way to transfer a ticket to a friend");
      const before = latest(ledger);
      queue(triage({ notDesign: [{ quote: "transfer a ticket to a friend", why: "no requirement covers it" }] }));
      modelCalls = 0;
      expect((await exec(ledger, designStep)).kind).toBe("done");
      expect(modelCalls).toBe(1);
      expect(latest(ledger).screens).toEqual(before.screens);
      expect(((await exec(ledger, designBaselineStep)) as { card: { markdown: string } }).card.markdown).toMatch(/Not changed: "transfer a ticket to a friend".*factory estimate --revises/);
    });
    it("falls back to a full redraw when the fixed page keeps failing its checks", async () => {
      const ledger = await rejected("the booking page is crowded");
      const wrong = { screen: sc("S-9", "/other", "Book your flight", ["REQ-2"]) };
      queue(triage({ items: [item({})] }), wrong, wrong, dress(three() as never));
      modelCalls = 0;
      expect((await exec(ledger, designStep)).kind).toBe("done");
      expect(modelCalls).toBe(4);
      expect(latest(ledger).rework![0]!.lines[0]).toMatch(/did not hold up to the checks/);
    });
  });
});

// ---------- edits on the card ----------
describe("editing an estimate on its card", () => {
  const sizing = {
    stack: { backend: "ASP.NET Core Web API", database: "PostgreSQL", architecture: "modular monolith", basis: "assumed" as const, notes: "no stack named in the request" },
    anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "a typical endpoint for this stack" }],
    tasks: [
      { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "the anchor", size: "typical", verify: "moderate", context: "complete" },
      { taskId: "EST-2", anchorId: "EST-1", ratio: 2, reason: "twice the fields", size: "typical", verify: "moderate", context: "complete" },
      { taskId: "EST-3", anchorId: "EST-1", ratio: 0.25, reason: "light", size: "typical", verify: "moderate", context: "complete" },
    ],
  };
  async function sized() {
    const ledger = await newRun({ estimate: { noRepo: true } });
    await complete(ledger, "intake", uiIntent(false));
    await complete(ledger, "clarify", { round: 1, asked: [], assumptions: [], differences: [], conflicts: [] });
    await complete(ledger, "specify", spec);
    // anchor sizing (a breakdown from before task kinds), where a lead edits anchors and ratios freely
    await complete(ledger, "breakdown", { ...breakdown, tasks: breakdown.tasks.map(({ kind: _k, ...t }) => t) });
    answer = () => sizing;
    const first = await exec(ledger, estimateStep);
    expect(first.kind).toBe("done");
    return ledger;
  }
  it("recomputes from the stored proposals without asking the model again, and issues a new card", async () => {
    const ledger = await sized();
    const before = replay(ledger.events()).steps.get("estimate")!.outputs[0]!;
    const calls = modelCalls;
    const card = await exec(ledger, approveEstimateStep);
    await decide(ledger, card, "approve-estimate", "edit", { edits: { anchors: { "EST-1": { min: 8, max: 16 } }, ratios: { "EST-2": 3 } }, reason: "the stack is new to us" });
    const again = await exec(ledger, estimateStep);
    expect(again.kind).toBe("done");
    expect(modelCalls).toBe(calls);
    const now = ledger.getJson<Estimate>((again as { outputs: Record<string, string> }).outputs.estimate!);
    expect(replay(ledger.events()).steps.get("estimate")!.outputs[0]).not.toBe(before);
    expect(now.anchors[0]!.hours).toEqual({ min: 8, max: 16 });
    // the priced stack survives a lead's edit
    expect(now.stack).toMatchObject({ backend: "ASP.NET Core Web API", basis: "assumed" });
    expect(now.tasks.find((t) => t.taskId === "EST-2")!.ratio).toBe(3);
    expect(now.assumptions.some((a) => /Lead edit: anchor EST-1 set to 8-16 h, EST-2 ratio set to 3 \(lead: the stack is new to us\)/.test(a))).toBe(true);
    // every total followed the edit, and the new estimate gets its own card
    expect(now.totals.overall.max).toBeGreaterThan(ledger.getJson<Estimate>(before).totals.overall.max);
    const next = await exec(ledger, approveEstimateStep);
    expect(next.kind).toBe("wait");
    expect((next as { card: { artifactSha: string } }).card.artifactSha).not.toBe((card as { card: { artifactSha: string } }).card.artifactSha);
    expect((next as { card: { markdown: string } }).card.markdown).toMatch(/Lead edit: anchor EST-1/);
  });
  it("shows the edit command on the card", async () => {
    const ledger = await sized();
    expect(((await exec(ledger, approveEstimateStep)) as { card: { markdown: string } }).card.markdown).toMatch(/factory edit-estimate .* --anchor EST-1=<min>-<max>/);
  });
});

describe("design quality (a finished look, not a wireframe)", () => {
  const base = { flow: "f", noScreen: [] };
  const sc = (extra: object = {}) => ({ id: "S-1", route: "/a", file: "a.tsx", reqs: ["R-1"], states: [], size: "new", frames: [], ...extra });
  const mockOf = (blocks: unknown[]) => ({ title: "T", blocks, copy: {} });
  const two = [{ type: "actions", buttons: ["Go"] }, { type: "text", body: "Hello" }];
  it("asks for a theme and for sample content on every screen without a frame", () => {
    const checks = (o: object) => designQuality({ ...base, ...o } as never).map((q) => q.check);
    expect(checks({ screens: [sc()] })).toEqual(["design-no-theme", "design-no-mock"]);
    expect(checks({ theme: { brand: "#112233" }, screens: [sc({ mock: mockOf(two) })] })).toEqual([]);
    expect(checks({ theme: {}, screens: [sc({ mock: mockOf([{ type: "stats", items: [{ label: "A", value: "1" }] }, two[0]]) })] })).toEqual(["design-no-full-mock"]);
    expect(checks({ theme: {}, screens: [sc({ frames: ["F-1"] })] })).toEqual([]);
  });
  it("rejects thin pages, short tables and placeholder text", () => {
    const checks = (m: unknown) => designQuality({ ...base, theme: {}, screens: [sc({ mock: m })] } as never).map((q) => q.check).filter((c) => !c.includes("full-mock"));
    expect(checks(mockOf([two[0]]))).toEqual(["design-thin-mock"]);
    expect(checks(mockOf([...two, { type: "table", columns: ["A"], rows: [["x"]] }]))).toEqual(["design-thin-mock"]);
    expect(checks(mockOf([{ type: "list", items: [{ title: "Item 1", meta: "m" }] }, two[0]]))).toEqual(["design-placeholder"]);
  });
});

describe("a small UI fix gets a design note (PR #11 review, item 9)", () => {
  const twoReqs = { ...spec, requirements: [...spec.requirements, { id: "REQ-2", ears: "The system shall show a Remember me checkbox on sign in.", op: "ADDED", sources: ["I-1"], acceptance: [] }] };
  const existing = { pages: [{ path: "app/login/page.tsx", kind: "page", route: "/login", layout: ["Button", "Input"], heading: "Sign in" }], verdict: "consistent", tokens: { total: 12 }, primitives: [], composites: [], stack: {} };
  const note = (size = "tweak") => ({
    flow: "The user signs in on the existing page", noScreen: [],
    screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1", "REQ-2"], size, change: "Add a Remember me checkbox under the password field, using the existing Checkbox." }],
  });
  async function smallFix(intent = uiIntent(true)) {
    const ledger = await newRun();
    await complete(ledger, "intake", intent);
    const inv = ledger.putJson(existing);
    await ledger.append({ type: "step.completed", key: "ground/1", inputsHash: sha, outputs: [inv], data: { named: { design: inv } } }, HUMAN_WRITER);
    await complete(ledger, "specify", twoReqs);
    return ledger;
  }

  it("writes a text note in one small call, passes E1b with no card of its own, and shows the note on the estimate card", async () => {
    const ledger = await smallFix();
    answer = () => note();
    const o = await exec(ledger, designStep);
    expect(o.kind).toBe("done");
    expect(modelCalls).toBe(1);
    const d = ledger.getJson<{ note: boolean; screens: { change: string; mock?: unknown }[]; themeSource: string }>((o as { outputs: Record<string, string> }).outputs.design!);
    expect(d).toMatchObject({ note: true, themeSource: "repo" });
    expect(d.screens[0]!.mock).toBeUndefined();
    const base = await exec(ledger, designBaselineStep);
    expect(base.kind).toBe("done");
    expect(existsSync(join(ledger.dir, "design-demo.html"))).toBe(false);
    await complete(ledger, "breakdown", breakdown);
    await complete(ledger, "estimate", estimateOf());
    const card = await exec(ledger, approveEstimateStep);
    const md = (card as { card: { markdown: string } }).card.markdown;
    expect(md).toContain("## Design note (a small change to existing pages: no demo is drawn, and approving the estimate approves this note)");
    expect(md).toContain("- S-1 /login (app/login/page.tsx; tweak) -> REQ-1, REQ-2: Add a Remember me checkbox");
  });

  it("outside an estimate the note gets its own card, and only a person's approval passes it (PR #11 re-review, blocker 1)", async () => {
    for (const purpose of ["build", "design"] as const) {
      const ledger = await smallFix();
      answer = () => note();
      expect((await exec(ledger, designStep)).kind).toBe("done");
      const step = makeDesignApprovalStep({ purpose });
      const card = await exec(ledger, step);
      expect(card.kind).toBe("wait");
      const md = (card as { card: { markdown: string } }).card.markdown;
      expect(md).toContain("approve this note, or reject it with the reason");
      expect(md).not.toContain("approving the estimate");
      expect(md).toContain("- S-1 /login (app/login/page.tsx; tweak) -> REQ-1, REQ-2: Add a Remember me checkbox");
      expect(existsSync(join(ledger.dir, "design-demo.html"))).toBe(false);
      await decide(ledger, card, "design-baseline", "approve");
      const done = await exec(ledger, step);
      expect(done.kind).toBe("done");
      expect(ledger.getJson((done as { outputs: Record<string, string> }).outputs.baseline!)).toMatchObject({ ui: true, note: true, by: "lead" });
    }
  });

  it("draws the full design when the note needs a new page", async () => {
    const ledger = await smallFix();
    let calls = 0;
    answer = () => (++calls === 1 ? note("new") : { flow: "x", screens: [] });
    await exec(ledger, designStep).catch(() => undefined);
    expect(calls).toBeGreaterThan(1); // the note, then the full design (retried here on an empty answer)
  });

  it("is the path only for a light, low-risk change in an app of its own with no frames, references or earlier design", () => {
    const small = { risk: "low" as const, rigor: "light" as const, changeClass: "feature" as const };
    const o = { existingLook: true, frames: 0, references: 0, earlierDesign: false, reqs: 2 };
    expect(lightUi(small, o)).toBe(true);
    expect(lightUi({ ...small, rigor: "full" }, o)).toBe(false);
    expect(lightUi({ ...small, risk: "medium" }, o)).toBe(false);
    expect(lightUi(small, { ...o, existingLook: false })).toBe(false);
    expect(lightUi(small, { ...o, frames: 1 })).toBe(false);
    expect(lightUi(small, { ...o, references: 1 })).toBe(false);
    expect(lightUi(small, { ...o, earlierDesign: true })).toBe(false);
    expect(lightUi(small, { ...o, reqs: LIGHT_UI_REQS + 1 })).toBe(false);
    expect(lightUi(small, { ...o, off: true })).toBe(false);
  });
});
