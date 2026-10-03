import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { MAX_BUDGET_CEILING, replay } from "../ledger/state.js";
import { budgetStop, effortHoursOf, spentOf } from "./budget.js";
import "./gates.js";

const sha = "a".repeat(64);
const estimate = Estimate.parse({
  header: { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
  deliveryModel: "hitl", band: "S", uncertainty: "low", breakdownSha: sha, specSha: sha,
  anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "x" }],
  tasks: [{ taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "a", hours: { min: 4, max: 8 }, executor: "factory", estimators: [], flagged: false }],
  totals: { byTrack: {}, overall: { min: 4, max: 8 } }, apiCost: { phases: [], total: { min: 5, max: 10 }, confidence: "cold-start", records: 0 },
  elapsed: { planningMinutes: 1, criticalPathDays: { min: 1, max: 3 } }, settings: { stackSource: "client", designInTotal: true, feedbackRounds: 1 },
});

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-budget-")); });

async function runWith(costUsd: number, withRef = true) {
  const ledger = Ledger.create(`20260930-budget-${Math.random().toString(16).slice(2, 6)}`);
  const est = ledger.putJson(estimate);
  await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x", ...(withRef ? { estimateRef: { runId: "r0", estimateSha: est, breakdownSha: sha, specSha: sha } } : {}) } }, HUMAN_WRITER);
  if (costUsd) await ledger.append({ type: "usage", key: "intake/1", data: { "gen_ai.request.model": "m", "gen_ai.usage.cost_usd": costUsd } }, HUMAN_WRITER);
  return { ledger, state: replay(ledger.events()) };
}

describe("budget burn (B5)", () => {
  it("does nothing for a run that does not follow an estimate", async () => {
    const { ledger, state } = await runWith(50, false);
    expect(await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, () => undefined, new Set())).toBeUndefined();
  });
  it("warns once at 80% of the approved maximum and does not stop", async () => {
    const { ledger, state } = await runWith(8.5);
    const logs: string[] = [];
    const warned = new Set<string>();
    expect(await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, (m) => logs.push(m), warned)).toBeUndefined();
    await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, (m) => logs.push(m), warned);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/API credit spend is at 85%/);
  });
  it("at 100% records gate B5 and opens a hash-bound budget card instead of ending the run", async () => {
    const { ledger, state } = await runWith(10);
    const card = await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, () => undefined, new Set());
    expect(card).toMatchObject({ ceiling: 1, proposed: 1.25 });
    expect(card!.reason).toMatch(/Approved budget reached \(gate B5\).*apiUsd is at 100%/);
    expect(card!.markdown).toMatch(/factory waive-budget .* --reason/);
    expect(card!.markdown).toMatch(/--revises r0/);
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("build.b5-budget-burn:false");
  });
  it("a recorded budget waiver raises the ceiling; the next stop is at the new ceiling and proposes a further step", async () => {
    const { ledger, state } = await runWith(10);
    const card = (await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, () => undefined, new Set()))!;
    await ledger.append({ type: "human.requested", data: { cardId: card.cardId, kind: "budget", artifactSha: card.artifactSha } }, HUMAN_WRITER);
    await ledger.append({ type: "human.decided", data: { cardId: card.cardId, decision: "waive-budget", by: "lead", artifactSha: card.artifactSha, reason: "scope grew", ceiling: 1.25 } }, HUMAN_WRITER);
    let after = replay(ledger.events());
    expect(after.budgetCeiling).toBe(1.25);
    expect(await budgetStop(ledger, HUMAN_WRITER, after, DEFAULT_POLICY, () => undefined, new Set())).toBeUndefined();
    await ledger.append({ type: "usage", key: "x/1", data: { "gen_ai.request.model": "m", "gen_ai.usage.cost_usd": 3 } }, HUMAN_WRITER);
    after = replay(ledger.events());
    const next = await budgetStop(ledger, HUMAN_WRITER, after, DEFAULT_POLICY, () => undefined, new Set());
    expect(next).toMatchObject({ ceiling: 1.25, proposed: 1.5 });
    expect(next!.artifactSha).not.toBe(card.artifactSha);
  });
  it("a waiver cannot raise the limit past MAX_BUDGET_CEILING; at the cap the card offers only a change request (PR #11 review, item 16)", async () => {
    const { ledger, state } = await runWith(10);
    const card = (await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, () => undefined, new Set()))!;
    await ledger.append({ type: "human.requested", data: { cardId: card.cardId, kind: "budget", artifactSha: card.artifactSha } }, HUMAN_WRITER);
    await ledger.append({ type: "human.decided", data: { cardId: card.cardId, decision: "waive-budget", by: "lead", artifactSha: card.artifactSha, reason: "x", ceiling: 1e9 } }, HUMAN_WRITER);
    let after = replay(ledger.events());
    expect(after.budgetCeiling).toBe(MAX_BUDGET_CEILING);
    await ledger.append({ type: "usage", key: "x/2", data: { "gen_ai.request.model": "m", "gen_ai.usage.cost_usd": 30 } }, HUMAN_WRITER);
    after = replay(ledger.events());
    const next = (await budgetStop(ledger, HUMAN_WRITER, after, DEFAULT_POLICY, () => undefined, new Set()))!;
    expect(next).toMatchObject({ ceiling: MAX_BUDGET_CEILING, proposed: MAX_BUDGET_CEILING });
    expect(next.markdown).not.toMatch(/factory waive-budget/);
    expect(next.markdown).toMatch(/--revises r0/);
  });
  it("measures elapsed days from the run's start", async () => {
    const { state } = await runWith(0);
    expect(spentOf(state, Date.parse(state.info.createdAt) + 2 * 86_400_000)).toMatchObject({ elapsedDays: 2 });
  });
  it("counts human effort from recorded decisions at the assumed gate times", async () => {
    const { ledger } = await runWith(0);
    const dec = (cardId: string, kind: string, extra: Record<string, unknown> = {}) => [
      { type: "human.requested" as const, data: { cardId, kind, artifactSha: cardId } },
      { type: "human.decided" as const, data: { cardId, decision: "answer", by: "lead", artifactSha: cardId, ...extra } },
    ];
    expect(effortHoursOf(ledger.events())).toBe(0);
    for (const e of [...dec("q1", "question", { answers: { a: "x", b: "y" } }), ...dec("w1", "waiver"), ...dec("p1", "plan")]) await ledger.append(e, HUMAN_WRITER);
    // 2 questions x 3.5 min + waiver 10 min + one approval section 5.5 min = 22.5 min
    expect(effortHoursOf(ledger.events())).toBe(0.38);
    expect(spentOf(replay(ledger.events()), Date.now(), ledger.events()).effortHours).toBe(0.38);
  });
});
