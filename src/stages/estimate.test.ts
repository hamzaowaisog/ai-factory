// The estimate model steps with a scripted model: no network, no repo, no containers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Breakdown, Estimate } from "../contracts/index.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { verifyEvidence } from "../gates/engine.js";
import "../estimate/gates.js";
import "../estimate/lint.js";
import { specRefused } from "../estimate/settled.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { breakdownStep, estimateStep, setPastTasksSource, setRecordsSource, setTaskRecordsSource } from "./estimate.js";
import type { DecisionLog } from "../estimate/decisions.js";
import { approveEstimateStep } from "./estimate-approve.js";
import { loadPastTasks, pastTasksOfRun } from "../estimate/references.js";
import { loadCatalogue } from "../estimate/catalogue.js";
import { saveTuned, tunedVersion } from "../estimate/catalogue-store.js";
import type { StepContext, StepDef, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";
import { NO_TRACE } from "../util/trace.js";

const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const req = (n: number) => ({ id: `REQ-${n}`, ears: `The system shall do ${n}.`, op: "ADDED", sources: ["I-1"], acceptance: [] });
const spec = (n: number, over: Record<string, unknown> = {}) => ({
  requirements: Array.from({ length: n }, (_, i) => req(i + 1)), nfrs: [], outOfScope: [], assumptions: [],
  lint: [{ check: "ears", passed: true, details: "" }], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] }, ...over,
});

/** One feature per requirement, one factory task per requirement, plus a PM overhead. */
function breakdown(n: number, over: { drop?: number; noChecklist?: boolean } = {}) {
  const reqs = Array.from({ length: n }, (_, i) => i + 1).filter((i) => i !== over.drop);
  return {
    features: Array.from({ length: n }, (_, i) => ({ id: `F-${i + 1}`, title: `Feature ${i + 1}`, reqs: [`REQ-${i + 1}`] })),
    tasks: [
      ...reqs.map((i) => ({ id: `EST-${i}`, title: `Build ${i}`, featureId: `F-${i}`, reqs: [`REQ-${i}`], items: [`item ${i}`], track: i % 2 ? "backend" : "web", kind: i % 2 ? "be-crud" : "ui-form", executor: "factory", dependsOn: i > 1 && i - 1 !== over.drop ? [`EST-${i - 1}`] : [], complexity: "standard" })),
      { id: `EST-${n + 1}`, title: "Project management", featureId: "F-1", reqs: [], items: [], track: "pm", kind: "pm-management", executor: "human", dependsOn: [], complexity: "standard", overhead: "coordination across the build" },
    ],
    checklist: over.noChecklist ? [] : [{ item: "auth", included: false, reason: "no login in this request" }, { item: "logging", included: true }],
  };
}

/** Sizing for a breakdown: every task against the first task as the only anchor. */
function sizing(tasks: { id: string }[], scale = 1, size = "typical") {
  const first = tasks[0]!.id;
  return {
    stack: { backend: "ASP.NET Core Web API", database: "PostgreSQL", architecture: "modular monolith", basis: "assumed" as const, notes: "no stack named in the request" },
    anchors: [{ taskId: first, hours: { min: 4 * scale, max: 8 * scale }, reason: "a typical screen plus endpoint for this stack" }],
    tasks: tasks.map((t, i) => ({ taskId: t.id, anchorId: first, ratio: i === 0 ? 1 : 1.5, reason: i === 0 ? "the anchor" : "a bit more fields than the anchor", size, verify: "moderate", context: "complete" })),
  };
}

let answer: (system: string, call: number) => unknown;
let calls: string[] = [];
/** what each call was asked (the user message) */
let asked: string[] = [];
const provider: Provider = {
  start(model, _e, system, user): Conversation {
    calls.push(model);
    asked.push(user);
    const n = calls.length;
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answer(system, n) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

async function makeRun(specBody: unknown, opts: { estimate?: Record<string, unknown>; design?: unknown } = {}) {
  const ledger = Ledger.create(`20260930-est-${Math.random().toString(16).slice(2, 8)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "a portal", ...(opts.estimate ? { estimate: opts.estimate } : {}) } }, HUMAN_WRITER);
  const complete = async (step: string, output: unknown, extra: Record<string, unknown> = {}) => {
    const sha = ledger.putJson(output);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs: [sha], data: { named: { [step]: sha }, ...extra } }, HUMAN_WRITER);
  };
  const round = { asked: [{ id: "Q-1", text: "Web or mobile?", recommended: "web" }], answers: { "Q-1": "web" }, answeredBy: "lead", assumptions: [{ id: "ASM-1", text: "English only", risk: "low", fromSpan: ["I-1"] }], conflicts: [] };
  await complete("intake", { source: "cli", spans: [{ id: "I-1", text: "a portal" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true });
  await complete("clarify", round);
  await complete("clarify-2", { asked: [], answers: {}, assumptions: [], conflicts: [] });
  await complete("specify", specBody);
  if (opts.design) await complete("design", opts.design);
  return ledger;
}

/** Run a step the way the executor does: a fresh replay of the ledger, and its outputs recorded for the next step. */
async function exec(ledger: Ledger, step: StepDef, priorFailures: StepContext["priorFailures"] = [], attempt = 1, extra: Partial<StepContext> = {}): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt, rung: 0, priorFailures, log: () => undefined, trace: NO_TRACE,
    usage: async () => undefined, ...extra,
  };
  const out = await step.run(ctx);
  if (out.kind === "done") {
    await ledger.append({ type: "step.completed", key: `${step.key}/1`, inputsHash: "b".repeat(64), outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  }
  return out;
}

/** Record the breakdown again without its kinds, as one made before step C would be. */
async function stripKinds(ledger: Ledger): Promise<void> {
  const b = ledger.getJson(replay(ledger.events()).steps.get("breakdown")!.outputs[0]!) as { tasks: { kind?: string }[] };
  const sha = ledger.putJson({ ...b, tasks: b.tasks.map(({ kind: _k, ...t }) => t) });
  await ledger.append({ type: "step.completed", key: "breakdown/2", inputsHash: "c".repeat(64), outputs: [sha], data: { named: { breakdown: sha } } }, HUMAN_WRITER);
}

/** the text of one reference section in a prompt */
const artifactIn = (user: string, id: string): string => { const at = user.indexOf(id); return user.slice(at, at + 4000); };

const breakdownAnswer = (b: unknown) => (system: string) => {
  if (system.includes("work breakdown")) return b;
  throw new Error(`unscripted system prompt: ${system.slice(0, 80)}`);
};

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-estimate-"));
  process.env.FACTORY_HOME = home;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  calls = [];
  asked = [];
  setRecordsSource(() => []);
  setTaskRecordsSource(() => []);
  setPastTasksSource(() => []);
  setProviderFactory(() => provider);
});

describe("breakdown step", () => {
  it("turns a ready spec into a valid breakdown and records gates E1-E4", async () => {
    const ledger = await makeRun(spec(3));
    answer = breakdownAnswer(breakdown(3));
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("done");
    const b = Breakdown.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.breakdown!));
    expect(b.tasks).toHaveLength(4);
    expect(b.header.kind).toBe("work-breakdown");
    const gates = replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`);
    for (const g of ["estimate.e1-readiness", "estimate.e2-req-to-task", "estimate.e3-task-to-req", "estimate.e4-checklist"]) expect(gates).toContain(`${g}:true`);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  it("asks, without asking the model, when the spec is not ready (E1); an answer settles it, and after the rounds it is carried", async () => {
    const ledger = await makeRun(spec(3, { roundTrip: { droppedSpans: ["I-1"], inventedCapabilities: [] } }));
    answer = () => { throw new Error("the model must not be called"); };
    const out = await exec(ledger, breakdownStep);
    expect(out).toMatchObject({ kind: "ask", reason: expect.stringMatching(/E1.*dropped/), failures: [expect.objectContaining({ message: "source span I-1 was dropped" })] });
    expect(calls).toHaveLength(0);
    // an answer that settles the failure lets the breakdown go on, and the model reads the answer
    answer = breakdownAnswer(breakdown(3));
    const gateAnswers = [{ id: "Q-4", step: "breakdown", question: "Is the dropped sentence in scope?", answer: "No: leave it out of the estimate", by: "factory", how: "assumed" as const, settles: ["source span I-1 was dropped"] }];
    expect((await exec(ledger, breakdownStep, [], 1, { gateAnswers })).kind).toBe("done");
    expect(asked[0]).toContain("Q-4: Is the dropped sentence in scope? → No: leave it out of the estimate");
    // after the rounds of questions an open failure is carried as an open risk instead
    const carried = await makeRun(spec(3, { roundTrip: { droppedSpans: ["I-1"], inventedCapabilities: [] } }));
    const done = await exec(carried, breakdownStep, [], 5, { carryOn: true });
    expect(done.kind).toBe("done");
    expect((done as { data: { openRisks: string[] } }).data.openRisks).toEqual([expect.stringMatching(/^Open risk: source span I-1 was dropped \(gate E1 still fails after 2 rounds of questions/)]);
  });

  it("goes back to the specify step, without asking the model, when a spec from before settling has problems a question settles", async () => {
    const ledger = await makeRun(spec(3, { critic: [{ finding: "conflicting rules", severity: "high" }] }));
    answer = () => { throw new Error("the model must not be called"); };
    const out = await exec(ledger, breakdownStep);
    expect(out).toMatchObject({ kind: "back", reason: expect.stringMatching(/E1 refused the spec \(1 open problem\).*settles it with questions/) });
    expect(calls).toHaveLength(0);
    // E1's verdict is recorded, so the specify step sees it and runs again
    const state = replay(ledger.events());
    expect(state.gates.find((g) => g.gateId === "estimate.e1-readiness")).toMatchObject({ passed: false });
    expect(specRefused(state, ledger)).toBe(true);
    // once settled (here: carried as an open risk), E1 passes it and the breakdown goes on
    const done = await makeRun(spec(3, { critic: [{ finding: "conflicting rules", severity: "high" }], settled: [{ kind: "critic", problem: "conflicting rules", how: "open-risk", decision: "carried" }] }));
    answer = breakdownAnswer(breakdown(3));
    expect((await exec(done, breakdownStep)).kind).toBe("done");
  });

  it("fails on a requirement with no task (E2) and feeds the failures back on the retry", async () => {
    const ledger = await makeRun(spec(3));
    answer = breakdownAnswer(breakdown(3, { drop: 2 }));
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("fail");
    const f = (out as { failures: { check: string; message: string }[] }).failures;
    expect(f.some((x) => x.check === "e2-uncovered" && /REQ-2/.test(x.message))).toBe(true);
    // the next attempt carries the failures in its pack
    let seen = "";
    answer = (system) => { seen = system; return breakdown(3); };
    const again = await exec(ledger, breakdownStep, f.map((x) => ({ ...x, frames: [] })));
    expect(again.kind).toBe("done");
  });

  /** a breakdown that misses REQ-2, has a task no requirement asks for, cites a requirement the spec lacks and leaves an item out with no reason */
  const messy = () => {
    const b = breakdown(3, { drop: 2 });
    b.tasks = [
      ...b.tasks.map((t) => (t.id === "EST-3" ? { ...t, reqs: ["REQ-3", "REQ-99"] } : t)),
      { id: "EST-9", title: "Audit log", featureId: "F-1", reqs: [], items: ["log every change"], track: "backend", kind: "be-crud", executor: "factory", dependsOn: [], complexity: "standard" },
    ];
    b.tasks = b.tasks.map((t) => (t.id === "EST-4" ? { ...t, dependsOn: ["EST-9"] } : t));
    b.checklist.push({ item: "monitoring", included: false } as never);
    return b;
  };
  const patchTask = { id: "EST-10", title: "Build 2", featureId: "F-2", reqs: ["REQ-2"], items: ["item 2"], track: "web", kind: "ui-form", executor: "factory", dependsOn: [], complexity: "standard" };
  const isPatch = (system: string) => system.includes("Most of it is fine");

  it("hands-off, on the retry: the factory settles what the gates still find, asks only for the missing work, and writes each decision down", async () => {
    const ledger = await makeRun(spec(3), { estimate: { humanReview: false } });
    answer = (system) => (isPatch(system) ? { tasks: [patchTask], kinds: [] } : messy());
    const out = await exec(ledger, breakdownStep, [], 2);
    expect(out.kind).toBe("done");
    // one breakdown call, then one small call that saw only the missing requirement
    expect(calls).toHaveLength(2);
    expect(asked[1]).toContain("REQ-2");
    expect(asked[1]).not.toContain("The system shall do 3.");
    const b = Breakdown.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.breakdown!));
    expect(b.tasks.map((t) => t.id)).toEqual(["EST-1", "EST-3", "EST-4", "EST-10"]);
    expect(b.tasks.find((t) => t.id === "EST-3")!.reqs).toEqual(["REQ-3"]);
    expect(b.tasks.find((t) => t.id === "EST-4")!.dependsOn).toEqual([]);
    expect(b.checklist.find((c) => c.item === "monitoring")!.reason).toMatch(/not assessed.*confirm with the client/);
    expect(b.suggested).toEqual([{ title: "Audit log", reason: expect.stringContaining("no requirement asks for it") }]);
    expect(b.factoryFixes!.join("\n")).toMatch(/E3.*REQ-99[\s\S]*E3.*Audit log[\s\S]*E4.*monitoring[\s\S]*E2.*EST-10.*REQ-2/);
    // every gate ran again on the settled breakdown and passed
    const last = new Map(replay(ledger.events()).gates.map((g) => [g.gateId, g.passed]));
    for (const g of ["estimate.e2-req-to-task", "estimate.e3-task-to-req", "estimate.e4-checklist", "estimate.e2c-task-kind"]) expect(last.get(g)).toBe(true);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
    // the estimate carries them: the task outside the total, the decisions in its assumptions
    calls = [];
    answer = (system) => { if (system.includes("sizing the tasks")) return sizing(b.tasks); throw new Error("unscripted"); };
    const est = await exec(ledger, estimateStep);
    const e = Estimate.parse(ledger.getJson((est as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.suggested.map((x) => x.title)).toEqual(["Audit log"]);
    expect(e.assumptions.filter((a) => a.startsWith("Factory decision (hands-off"))).toHaveLength(4);
  });

  it("hands-off: fails for questions, never parks, when the small call still leaves a requirement with no task; after the rounds it carries it", async () => {
    const ledger = await makeRun(spec(3), { estimate: { humanReview: false } });
    answer = (system) => (isPatch(system) ? { tasks: [], kinds: [] } : messy());
    const out = await exec(ledger, breakdownStep, [], 2);
    expect(out).toMatchObject({ kind: "fail", gate: true, failures: expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/REQ-2/) })]) });
    // the rounds are used up: the breakdown goes on, and the estimate states the gap as an open risk
    const done = await exec(ledger, breakdownStep, [], 5, { carryOn: true });
    expect(done.kind).toBe("done");
    expect((done as { data: { openRisks: string[] } }).data.openRisks.join("\n")).toMatch(/^Open risk: .*REQ-2.*\(gate E2 still fails after 2 rounds of questions/m);
    calls = [];
    const b = Breakdown.parse(ledger.getJson(replay(ledger.events()).steps.get("breakdown")!.outputs[0]!));
    answer = (system) => { if (system.includes("sizing the tasks")) return sizing(b.tasks); throw new Error("unscripted"); };
    const est = await exec(ledger, estimateStep);
    const e = Estimate.parse(ledger.getJson((est as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.assumptions.some((a) => /^Open risk: .*REQ-2.*gate E2/.test(a))).toBe(true);
  });

  it("with review, once the failures were asked about, the retry fails for the next round instead of a waiver card", async () => {
    const ledger = await makeRun(spec(3));
    answer = () => messy();
    const gateAnswers = [{ id: "Q-4", step: "breakdown", question: "Keep the audit log?", answer: "No", by: "Ann", how: "answered" as const, settles: [] }];
    const out = await exec(ledger, breakdownStep, [], 3, { gateAnswers });
    expect(out).toMatchObject({ kind: "fail", gate: true });
  });

  it("hands-off keeps the first try: it fails with the failures fed back, as with review", async () => {
    const ledger = await makeRun(spec(3), { estimate: { humanReview: false } });
    answer = (system) => (isPatch(system) ? { tasks: [patchTask], kinds: [] } : messy());
    expect((await exec(ledger, breakdownStep)).kind).toBe("fail");
    expect(calls).toHaveLength(1);
  });

  it("with review, the retry still asks for a waiver (E3, E4) and never settles anything itself", async () => {
    const ledger = await makeRun(spec(3));
    const b = messy();
    b.tasks.push({ ...patchTask, dependsOn: [] });
    answer = (system) => { if (isPatch(system)) throw new Error("the model must not be asked for a patch"); return b; };
    const out = await exec(ledger, breakdownStep, [], 2);
    expect(out).toMatchObject({ kind: "wait", card: { kind: "waiver" } });
  });

  it("fails an empty forgotten-work checklist (E4)", async () => {
    const ledger = await makeRun(spec(3));
    answer = breakdownAnswer(breakdown(3, { noChecklist: true }));
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string }[] }).failures.map((x) => x.check)).toContain("e4-empty");
  });
});

describe("estimate step", () => {
  async function withBreakdown(n: number, estimate?: Record<string, unknown>, legacy = false) {
    const ledger = await makeRun(spec(n), { estimate });
    answer = breakdownAnswer(breakdown(n));
    expect((await exec(ledger, breakdownStep)).kind).toBe("done");
    // a breakdown approved before task kinds (2026-10-03) is still sized by anchors and ratios
    if (legacy) await stripKinds(ledger);
    calls = [];
    return ledger;
  }
  const tasksOf = (n: number) => breakdown(n).tasks;

  it("uses three estimators even for a small job and computes every figure in code", async () => {
    const ledger = await withBreakdown(3);
    answer = (system) => { if (system.includes("sizing the tasks")) return sizing(tasksOf(3)); throw new Error("unscripted"); };
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    expect(calls).toHaveLength(3);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.band).toBe("S");
    expect(e.stack).toMatchObject({ backend: "ASP.NET Core Web API", database: "PostgreSQL", basis: "assumed" });
    expect(e.tasks).toHaveLength(4);
    // factory tasks add no human effort; only the PM task and the gate hours do (HITL)
    expect(e.totals.byTrack.backend?.min).toBeGreaterThan(0); // the lead PR review gate lands on backend
    expect(e.gateHours.length).toBeGreaterThan(0);
    expect(e.apiCost.confidence).toBe("cold-start");
    expect(e.assumptions).toContain("English only");
    const gates = replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`);
    expect(gates).toContain("estimate.e5-consistency:true");
    expect(gates).toContain("estimate.e6-lint:true");
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  it("sizes a kinded breakdown from the catalogue: the model picks steps, code reads the hours, and the status stays off the client's copy", async () => {
    const ledger = await withBreakdown(3, { deliveryModel: "agentic" });
    let k = 0;
    // three estimators word their reasons differently, and one reads every task a step larger
    answer = () => { const n = k++; return { ...sizing(tasksOf(3), 1, n === 1 ? "large" : "typical"), tasks: sizing(tasksOf(3), 1, n === 1 ? "large" : "typical").tasks.map((t) => ({ ...t, reason: `reading ${n}` })) }; };
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    expect(artifactIn(asked.at(-1)!, "Task kinds and what each size step means")).toMatch(/be-crud \(backend\): .*\n\s+small: up to 5 fields/);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    const t = (id: string) => e.tasks.find((x) => x.taskId === id)!;
    // EST-1 and EST-3 are be-crud on backend: one group, EST-1 its anchor; typical be-crud is 8-12 h
    expect(t("EST-1")).toMatchObject({ anchorId: "EST-1", ratio: 1, size: "typical", hours: { min: 8, max: 12 } });
    expect(t("EST-3")).toMatchObject({ anchorId: "EST-1", ratio: 1, hours: { min: 8, max: 12 } });
    expect(t("EST-2")).toMatchObject({ anchorId: "EST-2", hours: { min: 6, max: 10 } }); // ui-form on web
    expect(t("EST-4")).toMatchObject({ hours: { min: 4, max: 8 } }); // pm-management (client liaison), a human task: no grades
    expect(t("EST-1").reason).toMatch(/\[be-crud backend 8-12 h, typical\]/);
    // the large reading is one of three: the median keeps typical
    expect(t("EST-1").estimators[0]).toEqual({ min: 12.8, max: 19.2 });
    expect(e.catalogue).toEqual({ version: "2026-10-06.1", status: "draft", stack: "dotnet", splitAboveHours: 16, evidence: { builds: 0, checks: 0, held: 0, projects: 0, projectsWithin: 0 } });
    // the status is data on the estimate and shown on internal views; the assumptions (the client's copy) never mention it
    expect(e.assumptions.some((x) => /catalogue|signed off|DRAFT/i.test(x))).toBe(false);
    const card = (await exec(ledger, approveEstimateStep)) as { card: { markdown: string } };
    expect(card.card.markdown).toContain("Hours from task catalogue 2026-10-06.1 (stack dotnet): reference hours, not yet measured.");
    expect(card.card.markdown).not.toMatch(/delivery lead|signed off/);
    // Phase 2: every pick is logged as a decision record, lead's choice with the estimators' agreement, derived features only
    const log = ledger.getJson((out as { outputs: Record<string, string> }).outputs.decisions!) as DecisionLog;
    expect(log).toMatchObject({ catalogue: "2026-10-06.1", stack: "dotnet", estimators: 3, edits: 0 });
    const d = (id: string, q: string) => log.decisions.find((x) => x.taskId === id && x.question === q);
    expect(d("EST-1", "size")).toMatchObject({ choice: "typical", backend: "llm", votes: ["typical", "large", "typical"], confidence: 0.67, features: { kind: "be-crud", track: "backend", executor: "factory" } });
    expect(d("EST-1", "verify")).toMatchObject({ choice: "moderate", confidence: 1 });
    expect(d("EST-4", "size")).toBeDefined();
    expect(d("EST-4", "verify")).toBeUndefined(); // a human task has no grades
    expect(JSON.stringify(log)).not.toMatch(/Build 1|reading \d/); // no titles or reasons travel with the features
    expect((out as { data: Record<string, unknown> }).data.decisions).toBe(log.decisions.length);
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("estimate.e6-lint:true");
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  it("pins a run to the catalogue version its breakdown was made with, while new runs take the newest tuned version", async () => {
    const root = loadCatalogue();
    const tuned = (gen: number, hoursScale: number) => ({ ...root, version: tunedVersion(root.version, gen), hoursScale, tuned: { parent: root.version, at: "2026-10-03T00:00:00Z", builds: 12, projects: 10, changes: [{ path: "hoursScale", from: 1, to: hoursScale, measured: 1.5, evidence: 10 }], flagged: [] } });
    saveTuned(tuned(1, 1.25));
    const ledger = await withBreakdown(3, { deliveryModel: "agentic" });
    expect(replay(ledger.events()).steps.get("breakdown")?.data?.catalogue).toBe(`${root.version}+t1`);
    // a newer version arrives after the breakdown: this run keeps t1
    saveTuned(tuned(2, 1.5));
    answer = () => sizing(tasksOf(3));
    const out = await exec(ledger, estimateStep);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.catalogue).toMatchObject({ version: `${root.version}+t1`, status: "draft", tuned: { generation: 1, builds: 12, projects: 10 } });
    const card = (await exec(ledger, approveEstimateStep)) as { card: { markdown: string } };
    expect(card.card.markdown).toContain(`Hours from task catalogue ${root.version}+t1 (stack dotnet): self-tuned once, last from 12 builds and 10 finished projects; this version not yet measured.`);
    expect(e.assumptions.some((x) => /tuned|catalogue/i.test(x))).toBe(false); // the client's copy never says so
    expect(e.tasks.find((x) => x.taskId === "EST-1")).toMatchObject({ hours: { min: 10, max: 15 } }); // be-crud 8-12 x1.25
    expect(e.tasks.find((x) => x.taskId === "EST-1")!.reason).toMatch(/tuned hours x1\.25/);
    // a new run is sized from t2
    const fresh = await withBreakdown(3, { deliveryModel: "agentic" });
    expect(replay(fresh.events()).steps.get("breakdown")?.data?.catalogue).toBe(`${root.version}+t2`);
  });

  it("advises splitting agent work that is very large or over the catalogue's threshold, never a human task", async () => {
    const ledger = await withBreakdown(3);
    // EST-1 be-crud very large (20-30 h); EST-2 ui-form hard + partial (6-10 x 1.56 = 9.36-15.6 h, under 16); EST-4 PM is human
    answer = () => ({ ...sizing(tasksOf(3)), tasks: sizing(tasksOf(3)).tasks.map((t) => (t.taskId === "EST-1" ? { ...t, size: "very-large" } : t.taskId === "EST-2" ? { ...t, verify: "hard", context: "partial" } : t.taskId === "EST-4" ? { ...t, size: "very-large" } : t)) });
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.tasks.filter((t) => t.splitAdvised).map((t) => t.taskId)).toEqual(["EST-1"]);
    expect(e.tasks.find((t) => t.taskId === "EST-1")!.hours).toEqual({ min: 20, max: 30 });
    expect(e.catalogue?.splitAboveHours).toBe(16);
    expect(e.assumptions).toContain("Split before the build: EST-1 (agent work over 16 h or very large is split into smaller tasks; the hours stay as estimated).");
    const card = await exec(ledger, approveEstimateStep);
    expect((card as { card: { markdown: string } }).card.markdown).toMatch(/## Split before the build[^\n]*\n- EST-1 Build 1: 20-30 h, very large/);
  });

  it("shows the closest tasks of an agent-approved past estimate as references; the hours still come from the catalogue", async () => {
    // a hands-off run: estimated, then approved by the factory (gate E7), with no person involved
    const first = await withBreakdown(3, { humanReview: false });
    answer = () => sizing(tasksOf(3), 1, "large");
    expect((await exec(first, estimateStep)).kind).toBe("done");
    expect(await exec(first, approveEstimateStep)).toMatchObject({ kind: "done", data: { by: "factory", auto: true } });
    const past = pastTasksOfRun(first);
    expect(past.map((p) => `${p.taskId} ${p.kind} ${p.size} ${p.ui}`)).toEqual(["EST-1 be-crud large none", "EST-2 ui-form large none", "EST-3 be-crud large none", "EST-4 pm-management large none"]);
    // an estimate that is not approved yet is no reference
    const unapproved = await withBreakdown(3);
    answer = () => sizing(tasksOf(3));
    await exec(unapproved, estimateStep);
    expect(pastTasksOfRun(unapproved)).toEqual([]);

    setPastTasksSource(loadPastTasks);
    const ledger = await withBreakdown(3);
    answer = () => sizing(tasksOf(3));
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    const section = artifactIn(asked.at(-1)!, "Closest tasks of earlier approved estimates");
    expect(section).toMatch(/- EST-1: large \(12\.8-19\.2 h; same UI level; same item count\), large/);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    const t1 = e.tasks.find((t) => t.taskId === "EST-1")!;
    expect(t1.hours).toEqual({ min: 8, max: 12 }); // typical picked: the reference does not move the hours
    expect(t1.references).toHaveLength(2);
    expect(t1.references![0]).toMatchObject({ runId: first.runId, size: "large", hours: { min: 12.8, max: 19.2 } });
    expect(e.assumptions.some((x) => /references/.test(x))).toBe(false); // internal: on the card, not the client's copy
    const log = ledger.getJson((out as { outputs: Record<string, string> }).outputs.decisions!) as DecisionLog;
    expect(log.decisions.find((d) => d.taskId === "EST-1" && d.question === "size")!.features).toMatchObject({ pastMatches: 2, pastSize: "large" });
    const card = await exec(ledger, approveEstimateStep);
    expect((card as { card: { markdown: string } }).card.markdown).toMatch(/## Sized with approved past tasks as references\n- EST-1 Build 1: typical; like EST-1 of \S+ \(large, 12\.8-19\.2 h\), EST-3 of \S+ \(large, [^)]+\) \(sized differently: see its reason\)/);
  });

  it("fails a factory task sized without its verify and context grades, feeding the reason back", async () => {
    const ledger = await withBreakdown(3);
    answer = () => ({ ...sizing(tasksOf(3)), tasks: sizing(tasksOf(3)).tasks.map((t) => (t.taskId === "EST-2" ? { ...t, verify: undefined } : t)) });
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string; message: string }[] }).failures[0]).toMatchObject({ check: "estimate-proposal", message: expect.stringMatching(/EST-2 is a factory task: give it "verify" and "context"/) });
  });

  it("the solely agentic model carries no gate hours", async () => {
    const ledger = await withBreakdown(3, { deliveryModel: "agentic" });
    answer = () => sizing(tasksOf(3));
    const out = await exec(ledger, estimateStep);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.deliveryModel).toBe("agentic");
    expect(e.gateHours).toEqual([]);
  });

  it("by anchors (a breakdown without kinds): merges three independent estimators by median; one that disagrees flags the task without moving it", async () => {
    const ledger = await withBreakdown(5, undefined, true);
    let k = 0;
    // estimators 2 and 3 read the anchor much higher
    answer = () => sizing(tasksOf(5), [1, 4, 1][k++ % 3]);
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    expect(calls).toHaveLength(3);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.band).toBe("M");
    expect((out as { outputs: Record<string, string> }).outputs.decisions).toBeUndefined(); // no catalogue picks to log
    expect(e.tasks[0]!.estimators).toHaveLength(2);
    expect(e.tasks.every((t) => t.flagged)).toBe(true);
    // estimator 2 read the anchor 4x higher; the median of 1x, 4x, 1x is the 1x reading
    expect(e.tasks[0]!.estimators[0]!.max).toBeGreaterThanOrEqual(32);
    expect(e.tasks[0]!.hours).toEqual(e.anchors[0]!.hours);
  });

  it("by anchors: fails a proposal that misses a task or sizes an anchor against another task", async () => {
    const ledger = await withBreakdown(3, undefined, true);
    const all = tasksOf(3);
    answer = () => sizing(all.slice(0, 3)); // EST-4 has no size
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string; message: string }[] }).failures[0]).toMatchObject({ check: "estimate-proposal" });
    expect((out as { failures: { message: string }[] }).failures[0]!.message).toMatch(/EST-4 has no size/);
    answer = () => ({ ...sizing(all), tasks: sizing(all).tasks.map((t, i) => (i === 0 ? { ...t, ratio: 2 } : t)) });
    const out2 = await exec(ledger, estimateStep);
    expect((out2 as { failures: { message: string }[] }).failures[0]!.message).toMatch(/ratio 1/);
  });

  it("by anchors: fails an unflagged outlier (E5)", async () => {
    const ledger = await withBreakdown(9, undefined, true); // five backend factory tasks form one comparison group
    const p = sizing(tasksOf(9));
    p.tasks[8] = { ...p.tasks[8]!, ratio: 40 };
    answer = () => p;
    // M band: three estimators all agree, so nothing is flagged
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string }[] }).failures.map((x) => x.check)).toContain("e5-outlier");
  });

  it("by anchors, hands-off on the retry: flags the outlier E5 still finds, with its reason as an open risk", async () => {
    const ledger = await withBreakdown(9, { humanReview: false }, true);
    const p = sizing(tasksOf(9));
    p.tasks[8] = { ...p.tasks[8]!, ratio: 40 };
    answer = () => p;
    const out = await exec(ledger, estimateStep, [], 2);
    expect(out.kind).toBe("done");
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.tasks.find((t) => t.taskId === "EST-9")!.flagged).toBe(true);
    expect(e.assumptions.some((a) => /^Open risk: EST-9 flagged by the factory \(hands-off, gate E5\).*median/.test(a))).toBe(true);
    const e5 = replay(ledger.events()).gates.filter((g) => g.gateId === "estimate.e5-consistency").map((g) => g.passed);
    expect(e5).toEqual([false, true]);
    // the factory approves it (a flagged task needs no sign-off when nobody reviews)
    expect((await exec(ledger, approveEstimateStep)).kind).toBe("done");
  });
});

describe("cross-run cache", () => {
  const breakdownOf = async (ledger: Ledger) => {
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("done");
    return ledger.getJson((out as { outputs: Record<string, string> }).outputs.breakdown!);
  };
  beforeEach(() => { process.env.FACTORY_NO_CACHE = "0"; });
  afterEach(() => { process.env.FACTORY_NO_CACHE = "1"; });

  it("a second run with the same inputs reuses the stored answer and makes no model call", async () => {
    answer = breakdownAnswer(breakdown(3));
    const first = await breakdownOf(await makeRun(spec(3)));
    expect(calls).toHaveLength(1);
    // the model would now say something different; the cache must not ask it
    answer = breakdownAnswer(breakdown(3, { noChecklist: false }));
    calls = [];
    const second = await breakdownOf(await makeRun(spec(3)));
    expect(calls).toHaveLength(0);
    expect((second as { tasks: unknown }).tasks).toEqual((first as { tasks: unknown }).tasks);
  });

  it("a changed requirement is a different key and asks the model again", async () => {
    answer = breakdownAnswer(breakdown(3));
    await breakdownOf(await makeRun(spec(3)));
    answer = breakdownAnswer(breakdown(4));
    calls = [];
    await breakdownOf(await makeRun(spec(4)));
    expect(calls).toHaveLength(1);
  });

  it("FACTORY_NO_CACHE=1 (factory estimate --fresh) skips the cache both ways", async () => {
    answer = breakdownAnswer(breakdown(3));
    await breakdownOf(await makeRun(spec(3)));
    process.env.FACTORY_NO_CACHE = "1";
    calls = [];
    await breakdownOf(await makeRun(spec(3)));
    expect(calls).toHaveLength(1);
  });

  it("a stored answer that no longer fits the schema is ignored", async () => {
    answer = breakdownAnswer(breakdown(3));
    await breakdownOf(await makeRun(spec(3)));
    const { readdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { cacheDir } = await import("../estimate/cache.js");
    for (const f of readdirSync(cacheDir())) {
      const p = join(cacheDir(), f);
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), output: { nonsense: true } }));
    }
    calls = [];
    await breakdownOf(await makeRun(spec(3)));
    expect(calls).toHaveLength(1);
  });
});

describe("UI complexity from the approved design", () => {
  const design = {
    flow: "track a delivery", theme: { mode: "auto" }, mapping: { unmappedReqs: [], orphanScreens: [] },
    screens: [{
      id: "S-1", route: "/track", file: "app/track/page.tsx", reqs: ["REQ-2"], states: ["loading", "error"],
      mock: {
        title: "Track", copy: {},
        blocks: [{ type: "map", pins: [{ label: "Depot" }, { label: "Home" }], route: true }, { type: "chat", with: "Driver", messages: [{ from: "them", text: "Here" }, { from: "me", text: "Ok" }] }],
        overlays: [{ kind: "confirm", trigger: "Cancel", title: "Cancel it?" }],
      },
    }],
  };
  const withScreen = () => { const b = breakdown(3); b.tasks[1] = { ...b.tasks[1]!, screen: "S-1" } as never; return b; };

  /** the JSON of one artifact in a prompt */
  const artifact = (user: string, id: string): any => { const at = user.indexOf(`<artifact id="${id}"`); return JSON.parse(user.slice(user.indexOf(">", at) + 1, user.indexOf("</artifact>", at))); };

  it("gives the breakdown and the estimator each screen's level and drivers, and the product-wide factors", async () => {
    const ledger = await makeRun(spec(3), { design });
    answer = breakdownAnswer(withScreen());
    expect((await exec(ledger, breakdownStep)).kind).toBe("done");
    const d = artifact(asked[0]!, "design");
    expect(d.screens[0].ui).toMatchObject({ level: "complex", drivers: expect.arrayContaining(["map with a route and stops", "live chat", "2 states (loading, error)"]) });
    expect(d.uiFactors).toEqual(["both colour modes: every page in light and dark, with a switch"]);
    answer = () => sizing(withScreen().tasks);
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    const tasks = artifact(asked[1]!, "breakdown").tasks as { id: string; ui?: { level: string; drivers: string[] } }[];
    expect(tasks.find((t) => t.id === "EST-2")!.ui).toEqual({ level: "complex", drivers: d.screens[0].ui.drivers });
    // a backend task has no screen UI
    expect(tasks.find((t) => t.id === "EST-1")!.ui).toBeUndefined();
    expect(artifact(asked[1]!, "ui-factors")).toEqual(d.uiFactors);
  });
});
