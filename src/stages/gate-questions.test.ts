// Questions about failing checks (src/stages/gate-questions.ts): the round's questions, how a round is read back, hands-off and
// answered by a person, and what the estimate and the run page say about them. A scripted model: no network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import type { Failure } from "../contracts/index.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import type { StepContext } from "./framework.js";
import {
  answersOf, asksGates, carriedLines, carries, factoryAssumed, gateCard, gateNotes, gateRounds, nextQuestionId, settledBy, writeGateQuestions, type GateRound,
} from "./gate-questions.js";
import { setProviderFactory } from "./think.js";

const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
let answer: unknown;
let asked: string[] = [];
const provider: Provider = {
  start(_m, _e, _system, user): Conversation {
    asked.push(user);
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answer }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

const FAILS: Failure[] = [
  { check: "estimate.e2-coverage", message: "REQ-2 is delivered by no task" },
  { check: "estimate.e2c-task-kind", message: "EST-3 kind ui-form does not fit a backend task", location: "EST-3" },
];

async function makeRun(humanReview: boolean) {
  const ledger = Ledger.create(`20261006-gq-${Math.random().toString(16).slice(2, 8)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "a portal", estimate: { humanReview } } }, HUMAN_WRITER);
  const complete = async (step: string, output: unknown, data: Record<string, unknown> = {}) =>
    ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs: [ledger.putJson(output)], data }, HUMAN_WRITER);
  await complete("clarify", { asked: [{ id: "Q-1", text: "Web or mobile?" }, { id: "Q-2", text: "Languages?" }], answers: { "Q-1": "web", "Q-2": "English" }, assumptions: [] });
  await complete("specify", { requirements: [{ id: "REQ-1", ears: "The system shall do 1." }, { id: "REQ-2", ears: "The system shall do 2." }], settled: [{ ref: "Q-3" }] });
  return ledger;
}

const ctxOf = (ledger: Ledger): StepContext => {
  const state = replay(ledger.events());
  return {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 2, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
};

const QUESTIONS = { questions: [
  { failures: [1], text: "Is the PDF export in scope?", options: ["Yes", "No: leave it out of the estimate"], recommended: "No: leave it out of the estimate", reason: "the smallest scope", impact: 3, impactReason: "changes scope" },
  { failures: [2, 9], text: "Is EST-3 a screen or an endpoint?", options: ["A screen", "An endpoint"], recommended: "An endpoint", reason: "the requirement names an API", impact: 2, impactReason: "a visible flow" },
] };

/** File a round as the executor does: the round JSON, and a card for a person in review mode. */
async function fileRound(ledger: Ledger, round: number, handsOff: boolean, firstId: number) {
  answer = QUESTIONS;
  const q = await writeGateQuestions(ctxOf(ledger), { step: "breakdown", failures: FAILS, earlier: [], firstId });
  if (!q.ok) throw new Error("questions not written");
  const filed: GateRound = { step: "breakdown", round, asked: q.asked, failures: FAILS, failureOf: q.failureOf, ...(handsOff ? { answers: Object.fromEntries(q.asked.map((x) => [x.id, x.recommended])) } : {}) };
  const roundSha = ledger.putJson(filed);
  const cardSha = handsOff ? undefined : ledger.putJson({ key: "gate", step: "breakdown", round, asked: q.asked, assumptions: [] });
  await ledger.append({ type: "step.failed", key: `breakdown/${round * 2}`, data: { category: "other", signature: "x", rung: 0, action: "questions", nextRung: 0, round, roundSha, ...(cardSha ? { cardSha } : {}) } }, HUMAN_WRITER);
  if (cardSha) await ledger.append({ type: "human.requested", data: { cardId: `check-questions-${round}`, kind: "question", artifactSha: cardSha, step: "breakdown" } }, HUMAN_WRITER);
  return { ...q, cardSha };
}

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-gq-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  asked = [];
  setProviderFactory(() => provider);
});

describe("questions about failing checks", () => {
  it("asks only in runs that read a requirements document", () => {
    expect(asksGates({ info: { mode: "estimate" } as never })).toBe(true);
    expect(asksGates({ info: { mode: "design" } as never })).toBe(true);
    expect(asksGates({ info: { mode: "build" } as never })).toBe(false);
  });

  it("numbers the questions after the clarify and spec questions, and drops failures the model made up", async () => {
    const ledger = await makeRun(false);
    const first = nextQuestionId(ledger, replay(ledger.events()));
    expect(first).toBe(4);
    const q = await fileRound(ledger, 1, true, first);
    expect(q.asked.map((x) => x.id)).toEqual(["Q-4", "Q-5"]);
    expect(q.failureOf).toEqual({ "Q-4": [1], "Q-5": [2] });
    expect(q.asked[0]!.options).toContain(q.asked[0]!.recommended);
    expect(asked[0]).toContain("REQ-2 is delivered by no task");
    // the next round goes on from the last one
    expect(nextQuestionId(ledger, replay(ledger.events()))).toBe(6);
  });

  it("hands-off: the recommended answers are assumed, settle their failures, and show among the factory's assumptions", async () => {
    const ledger = await makeRun(false);
    await fileRound(ledger, 1, true, 4);
    const rounds = gateRounds(ledger, replay(ledger.events()), "breakdown");
    expect(rounds).toHaveLength(1);
    const answers = answersOf(rounds);
    expect(answers.map((a) => [a.id, a.answer, a.how, a.by])).toEqual([
      ["Q-4", "No: leave it out of the estimate", "assumed", "factory"],
      ["Q-5", "An endpoint", "assumed", "factory"],
    ]);
    expect(settledBy(answers, "REQ-2 is delivered by no task.")?.id).toBe("Q-4");
    expect(settledBy(answers, "REQ-9 is delivered by no task")).toBeUndefined();
    expect(factoryAssumed(ledger)).toEqual([
      { id: "Q-4", text: "Is the PDF export in scope? → No: leave it out of the estimate (a breakdown check)", risk: "high" },
      { id: "Q-5", text: "Is EST-3 a screen or an endpoint? → An endpoint (a breakdown check)", risk: "medium" },
    ]);
  });

  it("review: a round is unanswered until the person decides its card, then reads their answers", async () => {
    const ledger = await makeRun(true);
    const q = await fileRound(ledger, 1, false, 4);
    expect(answersOf(gateRounds(ledger, replay(ledger.events()), "breakdown"))).toEqual([]);
    const card = gateCard("run-1", "breakdown", 1, q.asked, FAILS, q.failureOf, q.cardSha!);
    expect(card).toContain(`factory answer run-1 ${q.cardSha!.slice(0, 8)} Q-4=A Q-5=A`);
    expect(card).toContain("← recommended: the smallest scope");
    await ledger.append({ type: "human.decided", data: { cardId: "check-questions-1", decision: "answer", by: "lead", artifactSha: q.cardSha, answers: { "Q-4": "A", "Q-5": "only for trade customers" } } }, HUMAN_WRITER);
    const answers = answersOf(gateRounds(ledger, replay(ledger.events()), "breakdown"));
    expect(answers.map((a) => [a.id, a.answer, a.how, a.by])).toEqual([
      ["Q-4", "Yes", "answered", "lead"],
      ["Q-5", "only for trade customers", "answered", "lead"],
    ]);
    expect(factoryAssumed(ledger)).toEqual([]);
  });

  it("a completed step starts afresh, and the estimate's assumptions list its answers and carried risks", async () => {
    const ledger = await makeRun(false);
    await fileRound(ledger, 1, true, 4);
    const risks = carriedLines("gate E2", [FAILS[0]!]);
    await ledger.append({ type: "step.completed", key: "breakdown/3", inputsHash: "a".repeat(64), outputs: [ledger.putJson({})], data: { openRisks: risks } }, HUMAN_WRITER);
    const state = replay(ledger.events());
    expect(gateRounds(ledger, state, "breakdown")).toEqual([]);
    expect(gateNotes(ledger, state, "estimate")).toEqual([
      "Check question Q-4 (breakdown): Is the PDF export in scope? → No: leave it out of the estimate (assumed by the factory, hands-off)",
      "Check question Q-5 (breakdown): Is EST-3 a screen or an endpoint? → An endpoint (assumed by the factory, hands-off)",
      "Open risk: REQ-2 is delivered by no task (gate E2 still fails after 2 rounds of questions; the factory carried it on so the run goes on)",
    ]);
    expect(gateNotes(ledger, state, "breakdown")).toEqual([]);
  });

  it("carries only with carryOn, and never a design that does not hold together", () => {
    expect(carries({}, [FAILS[0]!])).toBe(false);
    expect(carries({ carryOn: true }, [FAILS[0]!])).toBe(true);
    expect(carries({ carryOn: true }, [{ check: "design-duplicate-route" }])).toBe(false);
  });
});
