import { describe, expect, it } from "vitest";
import { estimateApiCost } from "./cost.js";
import { recordsFromRun } from "./records.js";
import type { RunScore, StepScore } from "../report.js";

const step = (name: string, costUsd: number, activeSec = 60, outcome = "completed"): StepScore => ({
  step: name, stage: name.split("/")[0]!, outcome, firstTimePass: true, attempts: 1, interruptions: 0, retryReasons: [], highestRung: 0, models: [],
  tokens: { input: 0, output: 0, cached: 0 }, costUsd, activeSec, gates: { passed: 0, failed: 0, failedIds: [] }, human: { cards: 0, decisions: [] },
});
const score = (steps: StepScore[]): RunScore => ({ runId: "r1", status: "delivered", request: "x", costUsd: 0, activeMin: 0, firstTimePassRate: 1, topCost: [], steps });

describe("benchmark records from a run", () => {
  it("sums each phase, and divides build and verification by the number of factory tasks", () => {
    const r = recordsFromRun(score([
      step("intake", 0.1), step("specify", 0.9), step("breakdown", 0.5), step("estimate", 0.5),
      step("author-tests", 1), step("implement/TASK-1", 2), step("implement/TASK-2", 3), step("integrate", 1), step("review", 1),
    ]));
    const by = Object.fromEntries(r.map((x) => [x.phase, x]));
    expect(by.planning).toMatchObject({ costUsd: 1, units: 1 });
    expect(by["breakdown-estimate"]).toMatchObject({ costUsd: 1, units: 1 });
    expect(by.build).toMatchObject({ costUsd: 6, units: 2 });
    expect(by.verification).toMatchObject({ costUsd: 2, units: 2 });
  });
  it("adds nothing for a phase that cost nothing, and no build records for a run that built nothing", () => {
    const r = recordsFromRun(score([step("intake", 0.2), step("integrate", 3)]));
    expect(r.map((x) => x.phase)).toEqual(["planning"]);
  });
  it("feeds the cost model: measured records replace the cold-start figure for their phase", () => {
    const records = recordsFromRun(score([step("intake", 2), step("implement/TASK-1", 4)]));
    const cost = estimateApiCost({ planning: 1, build: 3 }, records, "hitl");
    expect(cost.phases.find((p) => p.phase === "planning")!.usd).toEqual({ min: 2, max: 2 });
    expect(cost.phases.find((p) => p.phase === "build")!.usd).toEqual({ min: 12, max: 12 });
    expect(cost.records).toBe(2);
  });
});
