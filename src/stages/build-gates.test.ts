// Gates B1 and B2 in the plan step of a build run seeded from an approved estimate, and the seeding itself.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import "../gates/predicates.js";
import "../estimate/gates.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import type { StepContext, StepOutcome } from "./framework.js";
import { planStep } from "./spec.js";
import { setProviderFactory } from "./think.js";
import { NO_TRACE } from "../util/trace.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
let answer: () => unknown;
const provider: Provider = {
  start(): Conversation {
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answer() }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

function repo(): { dir: string; commit: string } {
  const dir = mkdtempSync(join(tmpdir(), "factory-bg-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/index.ts"), "export const greeting = 'hi';\n");
  git("add", "-A"); git("commit", "-q", "-m", "init");
  return { dir, commit: git("rev-parse", "HEAD").trim() };
}

const spec = { requirements: [{ id: "REQ-1", ears: "The system shall greet.", op: "ADDED", sources: ["I-1"], acceptance: [{ id: "AC-1.1", given: "a", when: "b", then: "the response says hi", level: "api" }] }], nfrs: [], outOfScope: [], assumptions: [], lint: [], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } };
const breakdown = {
  features: [{ id: "F-1", title: "Greeting", reqs: ["REQ-1"] }],
  tasks: [{ id: "EST-1", title: "Greeting endpoint", featureId: "F-1", reqs: ["REQ-1"], items: ["says hi"], track: "backend", executor: "factory", dependsOn: [], complexity: "standard" }],
  checklist: [],
};
const plan = (over: Record<string, unknown> = {}) => ({
  tasks: [{ id: "TASK-1", title: "Greeting", reqs: ["REQ-1"], fileScope: ["src/index.ts"], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 3, approach: "change the literal", estimateTaskId: "EST-1", ...over }],
  options: [{ id: "O-1", summary: "edit", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "config", simplest: false, tradeoffs: "more" }],
  chosen: "O-1", adr: "edit it", protectedPathsDeclared: [], newDependencies: [], stubs: [],
});

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-bg-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  setProviderFactory(() => provider);
});

/** `withDesign`: the approved estimate had a design with two screens, each built by its own factory task. */
async function seededRun(withDesign = false) {
  const { dir, commit } = repo();
  const ledger = Ledger.create(`20260930-bg-${Math.random().toString(16).slice(2, 6)}`);
  const bd = withDesign ? {
    ...breakdown,
    tasks: [{ ...breakdown.tasks[0]!, screen: "S-1" }, { ...breakdown.tasks[0]!, id: "EST-2", title: "Receipt page", screen: "S-2" }],
  } : breakdown;
  const designSha = withDesign ? ledger.putJson({ flow: "greet, then receipt", screens: [{ id: "S-1", route: "/hi", file: "src/index.ts", reqs: ["REQ-1"] }, { id: "S-2", route: "/receipt", file: "src/receipt.ts", reqs: ["REQ-1"] }] }) : undefined;
  const b = ledger.putJson(bd), sp = ledger.putJson(spec), e = ledger.putJson({ estimate: true });
  await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "x", repoPath: dir, baseCommit: commit, baseRef: "main", estimateRef: { runId: "r0", estimateSha: e, breakdownSha: b, specSha: sp, ...(designSha ? { designSha } : {}) } } }, HUMAN_WRITER);
  const done = async (step: string, out: unknown, named: Record<string, string> = {}) => {
    const o = ledger.putJson(out);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o, ...named } } }, HUMAN_WRITER);
  };
  await done("intake", { source: "cli", spans: [{ id: "I-1", text: "greet" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false });
  await done("ground", { claims: [], notFound: [{ span: "I-1", searched: ["x"] }] });
  await done("specify", spec, { critic: ledger.putJson({ findings: [] }) });
  return { ledger, dir, e, b, sp };
}
async function runPlan(ledger: Ledger, attempt = 1): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = { runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: state.info.repoPath!, stack: "dotnet" }), policy: DEFAULT_POLICY, attempt, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined };
  return planStep.run(ctx);
}

describe("plan against an approved design (B6)", () => {
  const two = () => ({
    ...plan(),
    tasks: [plan().tasks[0]!, { ...plan().tasks[0]!, id: "TASK-2", fileScope: ["src/receipt.ts"], estimateTaskId: "EST-2" }],
  });
  it("fails a plan that delivers no task of an approved screen, and says which screen", async () => {
    const { ledger } = await seededRun(true);
    answer = () => plan();
    const out = await runPlan(ledger);
    expect(out.kind).toBe("fail");
    const fails = (out as { failures: { check: string; message: string }[] }).failures;
    expect(fails.map((f) => f.check)).toContain("b6-screen");
    expect(fails.find((f) => f.check === "b6-screen")!.message).toContain("S-2");
  });
  it("accepts a plan that delivers every approved screen, and records the gate", async () => {
    const { ledger } = await seededRun(true);
    answer = two;
    const out = await runPlan(ledger);
    expect(out.kind, JSON.stringify(out)).toBe("done");
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("build.b6-screens-planned:true");
  });
  it("fails B7 when the task that builds a screen cannot touch the screen's file", async () => {
    const { ledger } = await seededRun(true);
    answer = () => ({ ...two(), tasks: two().tasks.map((t) => (t.id === "TASK-2" ? { ...t, fileScope: ["src/other.ts"] } : t)) });
    const out = await runPlan(ledger);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string; message: string }[] }).failures.find((f) => f.check === "b7-screen-scope")!.message).toContain("src/receipt.ts");
  });
  it("puts the approved design in the planner's prompt", async () => {
    const { ledger } = await seededRun(true);
    let prompt = "";
    setProviderFactory(() => ({ start(...a: Parameters<Provider["start"]>) { prompt = `${a[2]}\n${a[3]}`; return provider.start(...a); } }));
    answer = two;
    await runPlan(ledger);
    expect(prompt).toContain("approved-design");
    expect(prompt).toContain("/receipt");
  });
  it("does not run B6 for an estimate that had no design", async () => {
    const { ledger } = await seededRun();
    answer = () => plan();
    await runPlan(ledger);
    expect(replay(ledger.events()).gates.map((g) => g.gateId)).not.toContain("build.b6-screens-planned");
  });
});

describe("plan against a design approved in a design-only run (--from-design; PR #11 review, item 10)", () => {
  const spec2 = { ...spec, requirements: [...spec.requirements, { ...spec.requirements[0]!, id: "REQ-2", ears: "The system shall show a receipt." }] };
  async function fromDesign() {
    const { dir, commit } = repo();
    const ledger = Ledger.create(`20261003-bgd-${Math.random().toString(16).slice(2, 6)}`);
    const designSha = ledger.putJson({ flow: "greet, then receipt", screens: [{ id: "S-1", route: "/hi", file: "src/index.ts", reqs: ["REQ-1"] }, { id: "S-2", route: "/receipt", file: "src/receipt.ts", reqs: ["REQ-2"] }] });
    const sp = ledger.putJson(spec2);
    await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "x", repoPath: dir, baseCommit: commit, baseRef: "main", designRef: { runId: "d0", designSha, baselineSha: sha, intakeSha: sha, specSha: sp } } }, HUMAN_WRITER);
    const done = async (step: string, out: unknown, named: Record<string, string> = {}) => {
      const o = ledger.putJson(out);
      await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o, ...named } } }, HUMAN_WRITER);
    };
    await done("intake", { source: "cli", spans: [{ id: "I-1", text: "greet" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true });
    await done("ground", { claims: [], notFound: [{ span: "I-1", searched: ["x"] }] });
    await done("specify", spec2, { critic: ledger.putJson({ findings: [] }) });
    return ledger;
  }
  const task = (id: string, reqs: string[], fileScope: string[]) => ({ ...plan().tasks[0]!, id, reqs, fileScope, estimateTaskId: undefined });

  it("fails a plan that leaves out a screen, delivers an unapproved requirement, or cannot touch a screen's file", async () => {
    const ledger = await fromDesign();
    answer = () => ({ ...plan(), tasks: [task("TASK-1", ["REQ-1", "REQ-9"], ["src/index.ts"])] });
    let out = await runPlan(ledger);
    expect(out.kind).toBe("fail");
    let fails = (out as { failures: { check: string; message: string }[] }).failures;
    expect(fails.map((f) => f.check)).toEqual(expect.arrayContaining(["b1-unknown", "b6-screen"]));
    expect(fails.find((f) => f.check === "b6-screen")!.message).toContain("S-2");
    answer = () => ({ ...plan(), tasks: [task("TASK-1", ["REQ-1"], ["src/index.ts"]), task("TASK-2", ["REQ-2"], ["src/other.ts"])] });
    out = await runPlan(ledger);
    fails = (out as { failures: { check: string; message: string }[] }).failures;
    expect(fails.map((f) => f.check)).toEqual(["b7-screen-scope"]);
    expect(fails[0]!.message).toContain("src/receipt.ts");
  });

  it("accepts a plan that builds every approved screen from the approved requirements, and records the gates", async () => {
    const ledger = await fromDesign();
    answer = () => ({ ...plan(), tasks: [task("TASK-1", ["REQ-1"], ["src/index.ts"]), task("TASK-2", ["REQ-2"], ["src/receipt.ts"])] });
    const out = await runPlan(ledger);
    expect(out.kind, JSON.stringify(out)).toBe("done");
    const gates = replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`);
    expect(gates).toEqual(expect.arrayContaining(["build.b1-design-scope:true", "build.b2-change-request:true", "build.b6-design-screens:true"]));
  });
});

describe("plan against an approved estimate (B1, B2)", () => {
  it("accepts a plan whose every task maps to an approved estimate task, and records both gates", async () => {
    const { ledger } = await seededRun();
    answer = () => plan();
    const out = await runPlan(ledger);
    expect(out.kind, JSON.stringify(out)).toBe("done");
    const gates = replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`);
    expect(gates).toContain("build.b1-scope-lock:true");
    expect(gates).toContain("build.b2-change-request:true");
  });
  it("fails a plan task that maps to no estimate task (B1)", async () => {
    const { ledger } = await seededRun();
    answer = () => plan({ estimateTaskId: undefined });
    const out = await runPlan(ledger);
    expect(out.kind).toBe("fail");
    expect((out as { failures: { check: string }[] }).failures.map((f) => f.check)).toContain("b1-unmapped");
  });
  it("fails a plan task that maps to an estimate task that was never approved (B1)", async () => {
    const { ledger } = await seededRun();
    answer = () => plan({ estimateTaskId: "EST-9" });
    const out = await runPlan(ledger);
    expect((out as { failures: { check: string }[] }).failures.map((f) => f.check)).toContain("b1-unknown");
  });
  it("parks, without asking the model, when a requirement change was recorded after approval (B2)", async () => {
    const { ledger } = await seededRun();
    await ledger.append({ type: "change.received", data: { sha: sha } }, HUMAN_WRITER);
    answer = () => { throw new Error("the model must not be called"); };
    const out = await runPlan(ledger);
    expect(out.kind).toBe("park");
    expect((out as { reason: string }).reason).toMatch(/B2.*factory estimate --revises r0/);
  });
  it("a plan for a run that follows no estimate is not held to B1", async () => {
    const { ledger } = await seededRun();
    // the same run, minus the estimate reference
    const state = replay(ledger.events());
    expect(state.info.estimateRef).toBeTruthy();
    answer = () => plan({ estimateTaskId: undefined });
    const plain = Ledger.create(`20260930-bg-plain-${Math.random().toString(16).slice(2, 6)}`);
    await plain.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "x", repoPath: state.info.repoPath, baseCommit: state.info.baseCommit, baseRef: "main" } }, HUMAN_WRITER);
    for (const [step, out, named] of [["intake", { source: "cli", spans: [{ id: "I-1", text: "greet" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false }, {}], ["ground", { claims: [], notFound: [] }, {}], ["specify", spec, { critic: plain.putJson({ findings: [] }) }]] as const) {
      const o = plain.putJson(out);
      await plain.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o, ...named } } }, HUMAN_WRITER);
    }
    expect((await runPlan(plain)).kind).toBe("done");
  });
});

describe("waiving B1 and B6 at the plan", () => {
  const decide = (ledger: Ledger, card: { cardId: string; artifactSha: string }, reason = "the extra task is housekeeping") =>
    ledger.append({ type: "human.decided", data: { cardId: card.cardId, decision: "waive", by: "lead", artifactSha: card.artifactSha, reason } }, HUMAN_WRITER);
  it("keeps failing on the first attempt: the model gets its retry before a waiver is offered", async () => {
    const { ledger } = await seededRun();
    answer = () => plan({ estimateTaskId: undefined });
    expect((await runPlan(ledger, 1)).kind).toBe("fail");
  });
  it("asks a lead on the second attempt, then accepts the plan once that exact scope is waived", async () => {
    const { ledger } = await seededRun();
    answer = () => plan({ estimateTaskId: undefined });
    const ask = await runPlan(ledger, 2);
    expect(ask.kind).toBe("wait");
    const card = (ask as { card: { cardId: string; kind: string; artifactSha: string; markdown: string } }).card;
    expect(card.kind).toBe("waiver");
    expect(card.markdown).toMatch(/build\.b1-scope-lock.*maps to no estimate task/);
    expect(card.markdown).toContain("factory waive");
    await decide(ledger, card);
    const out = await runPlan(ledger, 3);
    expect(out.kind, JSON.stringify(out)).toBe("done");
    expect((out as { data: { waivers: { gateIds: string[]; human: string; reason: string }[] } }).data.waivers).toMatchObject([{ gateIds: ["build.b1-scope-lock"], human: "lead", reason: "the extra task is housekeeping" }]);
  });
  it("does not offer a waiver while another, unwaivable check also fails (B2)", async () => {
    const { ledger } = await seededRun();
    await ledger.append({ type: "change.received", data: { sha } }, HUMAN_WRITER);
    answer = () => plan({ estimateTaskId: undefined });
    expect((await runPlan(ledger, 2)).kind).not.toBe("wait");
  });
});
