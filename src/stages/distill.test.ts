// The distill step with a scripted model: the intent card, edits without a new model call, the repair and the rejects.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addMember } from "../config/team.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import { distillStep } from "./distill.js";
import type { StepContext, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const transcript = { format: "gemini-meet", notes: "Gemini says: tickets", speakers: ["Alex Morgan", "Jordan Lee"], turns: [
  { id: "T-1", time: "00:02:36", speaker: "Alex Morgan", text: "So uh patients can book an appointment online and uh cancel it up to 24 hours before" },
  { id: "T-2", time: "00:13:30", speaker: "Jordan Lee", text: "So I think let's skip it for now." },
] };
const good = { project: { name: "Clinic booking app", goal: "Track tickets" }, requirements: [
  { id: "R-1", text: "Patients book appointments online", status: "decided", quote: "patients can book an appointment online", turn: "T-1" },
  { id: "R-2", text: "Video consultations", status: "open", quote: "let's skip it for now", turn: "T-2" },
], constraints: [], openQuestions: [], warnings: [] };
let answers: unknown[] = [];
let calls = 0;
const provider: Provider = {
  start(): Conversation {
    return { async next(): Promise<Turn> { calls++; return { calls: [{ id: "s", name: "submit_result", input: answers.shift() }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-distill-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache(); calls = 0; answers = [];
  setProviderFactory(() => provider);
  addMember({ name: "Jordan Lee" }, "demo"); // the project's roster
});

async function newRun(estimate?: { humanReview: boolean }): Promise<Ledger> {
  const l = Ledger.create(`20261014-distill-${Math.random().toString(16).slice(2, 6)}`);
  const transcriptSha = l.putJson(transcript);
  await l.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "T-1 ...", operator: "sam", transcriptSha, ...(estimate ? { estimate } : {}) } }, HUMAN_WRITER);
  return l;
}
async function exec(l: Ledger, attempt = 1): Promise<StepOutcome> {
  const state = replay(l.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger: l, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
  const out = await distillStep.run(ctx);
  if (out.kind === "done") await l.append({ type: "step.completed", key: `distill/${attempt}`, inputsHash: sha, outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  return out;
}
/** What the executor records for a card (its extra rides on human.requested), then the person's decision. */
async function decide(l: Ledger, out: StepOutcome, decision: string, data: Record<string, unknown> = {}) {
  if (out.kind !== "wait") throw new Error(`expected a card, got ${out.kind}`);
  await l.append({ type: "human.requested", data: { ...(out.card.extra ?? {}), cardId: out.card.cardId, kind: out.card.kind, artifactSha: out.card.artifactSha, step: "distill" } }, HUMAN_WRITER);
  await l.append({ type: "human.decided", data: { cardId: out.card.cardId, decision, by: "lead", artifactSha: out.card.artifactSha, ...data } }, HUMAN_WRITER);
}

describe("distill step", () => {
  it("shows the intent card, with roles from the roster, then completes with the brief on approve", async () => {
    const l = await newRun();
    answers = [good];
    const card = await exec(l);
    if (card.kind !== "wait") throw new Error(`expected a card, got ${card.kind}`);
    expect(card.card.kind).toBe("intent");
    expect(card.card.markdown).toContain("Jordan Lee: team (roster)");
    await decide(l, card, "approve");
    const done = await exec(l, 2);
    if (done.kind !== "done") throw new Error(`expected done, got ${done.kind}`);
    expect(String(done.data!.brief)).toContain("- R-1: Patients book appointments online");
    expect(replay(l.events()).info.request).toContain("# Clinic booking app");
    expect(calls).toBe(1);
  });
  it("an edit makes a new card without asking the model again", async () => {
    const l = await newRun();
    answers = [good];
    const first = await exec(l);
    await decide(l, first, "edit", { edits: { status: { "R-2": "deferred" } }, reason: "client agreed on the call" });
    const second = await exec(l, 2);
    if (second.kind !== "wait" || first.kind !== "wait") throw new Error("expected cards");
    expect(second.card.artifactSha).not.toBe(first.card.artifactSha);
    expect(second.card.markdown).toMatch(/### deferred\n- R-2/);
    expect(calls).toBe(1);
  });
  it("repairs once when too many quotes fail, and lists what still fails", async () => {
    const l = await newRun();
    const bad = { ...good, requirements: [{ ...good.requirements[0]!, quote: "nobody said this at all", turn: "T-1" }] };
    answers = [bad, bad];
    const card = await exec(l);
    expect(calls).toBe(2);
    if (card.kind !== "wait") throw new Error("expected a card");
    expect(card.card.markdown).toContain("## Dropped (quote not found)");
  });
  it("a reject asks the model again with the reason; a second reject parks", async () => {
    const l = await newRun();
    answers = [good, good];
    const first = await exec(l);
    await decide(l, first, "reject", { reason: "missed the SMS reminder" });
    const second = await exec(l, 2);
    expect(calls).toBe(2);
    await decide(l, second, "reject", { reason: "still wrong" });
    expect((await exec(l, 3)).kind).toBe("park");
  });
  it("a hands-off estimate approves the checked intent itself and lists what nobody checked", async () => {
    const l = await newRun({ humanReview: false });
    const withBad = { ...good, requirements: [...good.requirements, { id: "R-3", text: "SMS reminders", status: "decided", quote: "nobody said this", turn: "T-1" }] };
    answers = [withBad, withBad]; // one quote in three fails: one repair call
    const done = await exec(l);
    if (done.kind !== "done") throw new Error(`expected done, got ${done.kind}`);
    expect(done.data).toMatchObject({ by: "factory", auto: true });
    expect(done.data!.assumed).toEqual([expect.objectContaining({ id: "R-3", risk: "high" })]);
    expect(replay(l.events()).info.request).toContain("- R-1: Patients book appointments online");
    expect(calls).toBe(2);
  });
  it("without a roster every speaker is the client and the card says how to fix it", async () => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-distill-")); // no roster here
    const l = await newRun();
    answers = [good];
    const card = await exec(l);
    if (card.kind !== "wait") throw new Error("expected a card");
    expect(card.card.markdown).toContain("Jordan Lee: client (default)");
    expect(card.card.markdown).toContain('factory team add "Full Name" --project demo');
  });
});
