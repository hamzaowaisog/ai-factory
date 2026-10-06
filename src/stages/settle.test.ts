// Settling a spec's open problems by questions (src/stages/settle.ts): which problems count and which are settled, a capability
// the request does ask for settled by a quote code checks, a fix that drops requested behaviour carried as a risk, and how a
// settled problem reads on the estimate.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { SpecDraft } from "../contracts/index.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { isSettled, openProblems, specRefused, unsettled, type Found } from "../estimate/settled.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import type { StepContext } from "./framework.js";
import { settle, settledText, type SettleIo } from "./settle.js";
import { setProviderFactory } from "./think.js";

const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const REQUEST = "Buyers order parts. The API must reject a request without a valid session with status 401.";
const spec: SpecDraft = { requirements: [{ id: "REQ-1", ears: "The system shall list parts.", op: "ADDED", sources: ["I-1"], acceptance: [] }], nfrs: [], outOfScope: [], assumptions: [] } as unknown as SpecDraft;
const found = (over: Partial<Found> = {}): Found => ({ lint: [], critic: [], roundTrip: { inventedCapabilities: [] }, ...over });

let users: string[] = [];
let answer: () => unknown;
const provider: Provider = {
  start(_m, _e, _s, user): Conversation {
    return { async next(): Promise<Turn> { users.push(user); return { calls: [{ id: "s", name: "submit_result", input: answer() }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-settle-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  delete process.env.FACTORY_NO_CACHE;
  _resetEnvCache();
  users = [];
  setProviderFactory(() => provider);
});

async function ctxFor(handsOff = true): Promise<StepContext> {
  const ledger = Ledger.create(`20261005-settle-${Math.random().toString(16).slice(2, 8)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: REQUEST, estimate: { noRepo: true, humanReview: !handsOff } } }, HUMAN_WRITER);
  const state = replay(ledger.events());
  return {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
}

/** a fix that keeps the spec, and a check that finds nothing more (or what `after` says) */
const io = (after: Found = found(), lost: string[] = []): SettleIo<Found> & { repairs: number } => {
  const o = {
    repairs: 0,
    repair: async (s: SpecDraft) => { o.repairs++; return { ok: true as const, spec: { ...s, assumptions: [...s.assumptions, "fixed"] } }; },
    recheck: async () => ({ ok: true as const, checks: after }),
    lost: () => lost,
  };
  return o;
};
const question = (problems: number[]) => ({ problems, text: "Retry once on a network error?", options: ["Retry once with the same order key", "No retry"], recommended: "Retry once with the same order key", reason: "smallest", impact: 3, impactReason: "orders" });

describe("the problems a question settles", () => {
  it("counts non-blocking lint, critical and high critic findings and invented capabilities, once each, less what is settled", () => {
    const f = found({
      lint: [{ check: "ears", passed: false, details: "REQ-2 has no trigger" }, { check: "ids", passed: false, details: "duplicate", blocking: true }, { check: "ok", passed: true, details: "" }],
      critic: [{ finding: "No idempotency on retry.", severity: "high" }, { finding: "no idempotency on retry", severity: "critical" }, { finding: "wording", severity: "medium" }],
      roundTrip: { inventedCapabilities: ["401 without a session"] },
    });
    expect(openProblems(f).map((p) => `${p.kind}:${p.text}`)).toEqual(["lint:ears: REQ-2 has no trigger", "critic:No idempotency on retry.", "invented:401 without a session"]);
    const settled = [{ kind: "critic" as const, problem: "NO IDEMPOTENCY on retry", how: "assumed" as const, decision: "x" }];
    expect(isSettled(settled, "critic", "No idempotency on retry.")).toBe(true);
    expect(isSettled(settled, "invented", "No idempotency on retry.")).toBe(false);
    expect(openProblems(f, settled)).toHaveLength(2);
    // a spec is unsettled only when it was written before settling (no settled list) and E1 would refuse it
    expect(unsettled(f)).toBe(true);
    expect(unsettled({ ...f, settled: [] })).toBe(false);
    expect(unsettled(found())).toBe(false);
  });

  it("knows E1 refused a spec written before settling, and keeps knowing it after the spec is settled", async () => {
    const ctx = await ctxFor();
    const gate = async (spec: unknown, passed: boolean) => ctx.ledger.append({ type: "gate.result", data: { gateId: "estimate.e1-readiness", passed, inputs: { spec: ctx.ledger.putJson(spec) }, details: "" } }, HUMAN_WRITER);
    expect(specRefused(replay(ctx.ledger.events()), ctx.ledger)).toBe(false);
    // a refusal for something a question cannot settle (a dropped span) does not send the spec back
    await gate({ ...found(), settled: [] }, false);
    expect(specRefused(replay(ctx.ledger.events()), ctx.ledger)).toBe(false);
    await gate(found({ critic: [{ finding: "gap", severity: "high" }] }), false);
    await gate({ ...found({ critic: [{ finding: "gap", severity: "high" }] }), settled: [{ kind: "critic", problem: "gap", how: "assumed", decision: "x" }] }, true);
    expect(specRefused(replay(ctx.ledger.events()), ctx.ledger)).toBe(true);
  });
});

describe("settling a spec", () => {
  it("settles a capability the request asks for by its quote, without a question; a quote the request does not have settles nothing", async () => {
    const ctx = await ctxFor();
    const start = () => ({ spec, checks: found({ roundTrip: { inventedCapabilities: ["Reject requests without a session with 401", "Email the buyer a receipt"] } }) });
    answer = () => ({ questions: [question([2])], inRequest: [{ problem: 1, quote: "reject a request without a valid  session with status 401" }, { problem: 2, quote: "buyers get an email receipt" }] });
    const fix = io();
    const r = await settle(ctx, { key: "k", start, request: REQUEST, firstId: 3, io: fix });
    if (!r.ok) throw new Error("settle failed");
    expect(r.settled).toEqual([
      expect.objectContaining({ kind: "invented", problem: "Reject requests without a session with 401", how: "in-request", ref: "Q-4", decision: expect.stringContaining("The request asks for it") }),
      expect.objectContaining({ kind: "invented", problem: "Email the buyer a receipt", how: "assumed", ref: "Q-3" }),
    ]);
    // the quote is an answer from now on, so the round trip maps the requirement to it
    expect(r.answers.map((a) => a.id)).toEqual(["Q-4", "Q-3"]);
    expect(r.answers[0]).toMatchObject({ by: "factory", answer: expect.stringContaining("Yes:") });
    expect(fix.repairs).toBe(1);
    // the question writer saw the open problems
    expect(users[0]).toContain('"problem":"Email the buyer a receipt"');
  });

  it("carries the problems as open risks, and keeps the spec, when the fix would drop requested behaviour", async () => {
    const ctx = await ctxFor();
    answer = () => ({ questions: [question([1])], inRequest: [] });
    const r = await settle(ctx, { key: "k", start: () => ({ spec, checks: found({ critic: [{ finding: "gap", severity: "high" }] }) }), request: REQUEST, firstId: 1, io: io(found(), ["I-1"]) });
    if (!r.ok) throw new Error("settle failed");
    expect(r.spec).toBe(spec);
    expect(r.settled).toEqual([expect.objectContaining({ problem: "gap", how: "open-risk", decision: expect.stringContaining("not applied") })]);
    expect(settledText(r.settled[0]!)).toBe("Open risk: gap");
  });

  it("asks nothing when nothing is open", async () => {
    const ctx = await ctxFor(false);
    answer = () => { throw new Error("the model must not be called"); };
    const r = await settle(ctx, { key: "k", start: () => ({ spec, checks: found() }), request: REQUEST, firstId: 1, io: io() });
    expect(r).toMatchObject({ ok: true, settled: [], answers: [] });
  });
});
