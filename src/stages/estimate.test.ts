// The estimate model steps with a scripted model: no network, no repo, no containers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Breakdown, Estimate } from "../contracts/index.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { verifyEvidence } from "../gates/engine.js";
import "../estimate/gates.js";
import "../estimate/lint.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { breakdownStep, estimateStep } from "./estimate.js";
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
      ...reqs.map((i) => ({ id: `EST-${i}`, title: `Build ${i}`, featureId: `F-${i}`, reqs: [`REQ-${i}`], items: [`item ${i}`], track: i % 2 ? "backend" : "web", executor: "factory", dependsOn: i > 1 && i - 1 !== over.drop ? [`EST-${i - 1}`] : [], complexity: "standard", ...(i % 2 ? {} : { screen: `Screen ${i}` }) })),
      { id: `EST-${n + 1}`, title: "Project management", featureId: "F-1", reqs: [], items: [], track: "pm", executor: "human", dependsOn: [], complexity: "standard", overhead: "coordination across the build" },
    ],
    checklist: over.noChecklist ? [] : [{ item: "auth", included: false, reason: "no login in this request" }, { item: "logging", included: true }],
  };
}

/** Sizing for a breakdown: every task against the first task as the only anchor. */
function sizing(tasks: { id: string }[], scale = 1) {
  const first = tasks[0]!.id;
  return {
    anchors: [{ taskId: first, hours: { min: 4 * scale, max: 8 * scale }, reason: "a typical screen plus endpoint for this stack" }],
    tasks: tasks.map((t, i) => ({ taskId: t.id, anchorId: first, ratio: i === 0 ? 1 : 1.5, reason: i === 0 ? "the anchor" : "a bit more fields than the anchor" })),
  };
}

let answer: (system: string, call: number) => unknown;
let calls: string[] = [];
const provider: Provider = {
  start(model, _e, system): Conversation {
    calls.push(model);
    const n = calls.length;
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answer(system, n) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

async function makeRun(specBody: unknown, opts: { estimate?: Record<string, unknown> } = {}) {
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
  return ledger;
}

/** Run a step the way the executor does: a fresh replay of the ledger, and its outputs recorded for the next step. */
async function exec(ledger: Ledger, step: StepDef, priorFailures: StepContext["priorFailures"] = []): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures, log: () => undefined, trace: NO_TRACE,
    usage: async () => undefined,
  };
  const out = await step.run(ctx);
  if (out.kind === "done") {
    await ledger.append({ type: "step.completed", key: `${step.key}/1`, inputsHash: "b".repeat(64), outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  }
  return out;
}

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

  it("parks, without asking the model, when the spec is not ready (E1)", async () => {
    const ledger = await makeRun(spec(3, { critic: [{ finding: "conflicting rules", severity: "high" }] }));
    answer = () => { throw new Error("the model must not be called"); };
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("park");
    expect((out as { reason: string }).reason).toMatch(/E1.*clarify/);
    expect(calls).toHaveLength(0);
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

  it("fails an empty forgotten-work checklist (E4)", async () => {
    const ledger = await makeRun(spec(3));
    answer = breakdownAnswer(breakdown(3, { noChecklist: true }));
    const out = await exec(ledger, breakdownStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string }[] }).failures.map((x) => x.check)).toContain("e4-empty");
  });
});

describe("estimate step", () => {
  async function withBreakdown(n: number, estimate?: Record<string, unknown>) {
    const ledger = await makeRun(spec(n), { estimate });
    answer = breakdownAnswer(breakdown(n));
    expect((await exec(ledger, breakdownStep)).kind).toBe("done");
    calls = [];
    return ledger;
  }
  const tasksOf = (n: number) => breakdown(n).tasks;

  it("uses one estimator for a small job and computes every figure in code", async () => {
    const ledger = await withBreakdown(3);
    answer = (system) => { if (system.includes("sizing the tasks")) return sizing(tasksOf(3)); throw new Error("unscripted"); };
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    expect(calls).toHaveLength(1);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.band).toBe("S");
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

  it("the solely agentic model carries no gate hours", async () => {
    const ledger = await withBreakdown(3, { deliveryModel: "agentic" });
    answer = () => sizing(tasksOf(3));
    const out = await exec(ledger, estimateStep);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.deliveryModel).toBe("agentic");
    expect(e.gateHours).toEqual([]);
  });

  it("uses three independent estimators for M and up; disagreement widens the range and flags the task", async () => {
    const ledger = await withBreakdown(5);
    let k = 0;
    // estimators 2 and 3 read the anchor much higher
    answer = () => sizing(tasksOf(5), [1, 4, 1][k++ % 3]);
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("done");
    expect(calls).toHaveLength(3);
    const e = Estimate.parse(ledger.getJson((out as { outputs: Record<string, string> }).outputs.estimate!));
    expect(e.band).toBe("M");
    expect(e.tasks[0]!.estimators).toHaveLength(2);
    expect(e.tasks.every((t) => t.flagged)).toBe(true);
    expect(e.tasks[0]!.hours.max).toBeGreaterThanOrEqual(32); // 4x the anchor's 8 h maximum
  });

  it("fails a proposal that misses a task or sizes an anchor against another task", async () => {
    const ledger = await withBreakdown(3);
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

  it("fails an unflagged outlier (E5)", async () => {
    const ledger = await withBreakdown(9); // five backend factory tasks form one comparison group
    const p = sizing(tasksOf(9));
    p.tasks[8] = { ...p.tasks[8]!, ratio: 40 };
    answer = () => p;
    // M band: three estimators all agree, so nothing is flagged
    const out = await exec(ledger, estimateStep);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string }[] }).failures.map((x) => x.check)).toContain("e5-outlier");
  });
});
