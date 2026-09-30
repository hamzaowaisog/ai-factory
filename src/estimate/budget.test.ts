import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { budgetStop, spentOf } from "./budget.js";
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
  it("stops at 100% with the gate recorded, and points at a change request", async () => {
    const { ledger, state } = await runWith(10);
    const reason = await budgetStop(ledger, HUMAN_WRITER, state, DEFAULT_POLICY, () => undefined, new Set());
    expect(reason).toMatch(/Approved budget reached \(gate B5\).*apiUsd is at 100%.*--revises r0/);
    expect(replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`)).toContain("build.b5-budget-burn:false");
  });
  it("measures elapsed days from the run's start and counts human effort as unmeasured", async () => {
    const { state } = await runWith(0);
    expect(spentOf(state, Date.parse(state.info.createdAt) + 2 * 86_400_000)).toMatchObject({ effortHours: 0, elapsedDays: 2 });
  });
});
