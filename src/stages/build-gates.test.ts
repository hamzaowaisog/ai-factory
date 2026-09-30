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

async function seededRun() {
  const { dir, commit } = repo();
  const ledger = Ledger.create(`20260930-bg-${Math.random().toString(16).slice(2, 6)}`);
  const b = ledger.putJson(breakdown), sp = ledger.putJson(spec), e = ledger.putJson({ estimate: true });
  await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "x", repoPath: dir, baseCommit: commit, baseRef: "main", estimateRef: { runId: "r0", estimateSha: e, breakdownSha: b, specSha: sp } } }, HUMAN_WRITER);
  const done = async (step: string, out: unknown, named: Record<string, string> = {}) => {
    const o = ledger.putJson(out);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o, ...named } } }, HUMAN_WRITER);
  };
  await done("intake", { source: "cli", spans: [{ id: "I-1", text: "greet" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false });
  await done("ground", { claims: [], notFound: [{ span: "I-1", searched: ["x"] }] });
  await done("specify", spec, { critic: ledger.putJson({ findings: [] }) });
  return { ledger, dir, e, b, sp };
}
async function runPlan(ledger: Ledger): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = { runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: state.info.repoPath!, stack: "dotnet" }), policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined };
  return planStep.run(ctx);
}

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
