import { describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS } from "./assumptions.js";
import { classMinutes, classOf, taskDurations, type TaskRecord } from "./durations.js";
import { priorFlag, withPrior, loadRoundsPrior } from "./priors.js";
import { durationLines } from "../stages/estimate-approve.js";
import { fixture } from "./fixture.js";

const rec = (taskClass: string, activeMin: number, turns = 50, outcome = "completed"): TaskRecord => ({ runId: "r", estimateTaskId: "EST-9", taskClass, activeMin, costUsd: 1, turns, attempts: 1, outcome });
const task = (id: string, executor: string, track = "backend", complexity = "standard") => ({ id, track, complexity, executor }) as never;
const sized = (taskId: string, min: number, max: number) => ({ taskId, hours: { min, max } });

describe("factory durations from the ledger", () => {
  it("classes tasks by track and complexity", () => expect(classOf({ track: "web", complexity: "real-time" })).toBe("web/real-time"));

  it("measures nothing until a class has enough completed records, and ignores unfinished ones", () => {
    expect(classMinutes("backend/standard", [rec("backend/standard", 10), rec("backend/standard", 20)]).minutes).toBeUndefined();
    const c = classMinutes("backend/standard", [rec("backend/standard", 10), rec("backend/standard", 20), rec("backend/standard", 30), rec("backend/standard", 99, 50, "partial"), rec("web/standard", 500)]);
    expect(c.records).toBe(3);
    expect(c.confidence).toBe("partial");
    expect(c.minutes).toEqual({ min: 12, max: 28 });
  });

  it("gives a factory task its class's measured time and keeps human tasks on their sized hours", () => {
    const records = [10, 20, 30].map((m) => rec("backend/standard", m));
    const r = taskDurations([task("EST-1", "factory"), task("EST-2", "human"), task("EST-3", "factory", "web")], [sized("EST-1", 8, 16), sized("EST-2", 4, 6), sized("EST-3", 3, 5)], records);
    expect(r.duration.get("EST-1")).toEqual({ min: 0.2, max: 0.47 });
    expect(r.duration.get("EST-2")).toEqual({ min: 4, max: 6 });
    expect(r.duration.get("EST-3")).toEqual({ min: 3, max: 5 }); // web class has no records: cold-start fallback
    expect(r.basis!.confidence).toBe("cold-start"); // the weakest class decides
    expect(r.basis!.byClass.map((c) => c.taskClass)).toEqual(["backend/standard", "web/standard"]);
  });

  it("has no basis when no task is built by the factory", () => {
    expect(taskDurations([task("EST-1", "human")], [sized("EST-1", 1, 2)], []).basis).toBeUndefined();
  });

  it("is calibrated only when every factory class has enough records", () => {
    const many = Array.from({ length: DEFAULT_ASSUMPTIONS.cost.calibratedFrom }, (_, i) => rec("backend/standard", 10 + i));
    expect(taskDurations([task("EST-1", "factory")], [sized("EST-1", 1, 2)], many).basis!.confidence).toBe("calibrated");
  });
});

describe("external prior", () => {
  const p = loadRoundsPrior()!;
  it("ships a pinned prior with its source and revision", () => {
    expect(p.source.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(p.resolvedRounds.p10).toBeLessThan(p.resolvedRounds.p90);
  });
  it("flags a measured class outside the band and leaves the rest alone", () => {
    expect(priorFlag(p.resolvedRounds.p90 + 1, p)).toBe("above p90");
    expect(priorFlag(p.resolvedRounds.p10 - 1, p)).toBe("below p10");
    expect(priorFlag(p.resolvedRounds.p50, p)).toBeUndefined();
    expect(priorFlag(undefined, p)).toBeUndefined();
  });
  it("puts the flag on the approval card and keeps the estimate valid", () => {
    const records = [10, 20, 30].map((m) => rec("backend/standard", m, p.resolvedRounds.p90 + 40));
    const { duration, basis } = taskDurations([task("EST-1", "factory")], [sized("EST-1", 1, 2)], records);
    expect(duration.get("EST-1")!.max).toBeLessThan(1);
    const e = fixture().estimate;
    const withBasis = Estimate.parse({ ...e, elapsed: { ...e.elapsed, basis: withPrior(basis!, p) } });
    const lines = durationLines(withBasis).join("\n");
    expect(lines).toMatch(/CHECK backend\/standard.*above p90/);
    expect(lines).toMatch(/Build time basis: partial/);
    expect(durationLines(e)).toEqual([]);
  });
});

describe("records from a build run", () => {
  it("reads class, turns and attempts for each approved task a build delivered, and nothing from other runs", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { HUMAN_WRITER, Ledger } = await import("../ledger/ledger.js");
    const { taskRecordsFromRun, loadTaskRecords } = await import("./durations.js");
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-dur-"));
    const f = fixture();
    const est = Ledger.create("20261001-est-0001");
    await est.append({ type: "run.created", data: { mode: "estimate", project: "p", request: "x" } }, HUMAN_WRITER);
    const breakdownSha = est.putJson(f.breakdown);
    const estimateSha = est.putJson(f.estimate);
    const build = Ledger.create("20261001-build-0001");
    await build.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x", estimateRef: { runId: "20261001-est-0001", estimateSha, breakdownSha, specSha: "b".repeat(64) } } }, HUMAN_WRITER);
    for (const [step, task] of [["implement/T-1", "EST-2"], ["implement/T-2", "EST-2"]] as const) {
      await build.append({ type: "step.started", key: `${step}/1` }, HUMAN_WRITER);
      await build.append({ type: "usage", key: `${step}/1`, data: { "gen_ai.request.model": "m", "gen_ai.usage.cost_usd": 0.5 } }, HUMAN_WRITER);
      await build.append({ type: "usage", key: `${step}/1`, data: { "gen_ai.request.model": "m", "gen_ai.usage.cost_usd": 0.5 } }, HUMAN_WRITER);
      await build.append({ type: "step.completed", key: `${step}/1`, inputsHash: "c".repeat(64), outputs: [], data: { estimateTaskId: task } }, HUMAN_WRITER);
    }
    const rs = taskRecordsFromRun(build);
    // two plan tasks delivered one approved task: one record, summed
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ estimateTaskId: "EST-2", taskClass: "web/standard", turns: 4, attempts: 2, outcome: "completed", sizeBand: "M" });
    expect(rs[0]!.costUsd).toBeCloseTo(2, 5);
    expect(taskRecordsFromRun(est)).toEqual([]);
    expect(loadTaskRecords("20261001-build-0001")).toEqual([]);
    expect(loadTaskRecords()).toHaveLength(1);
  });
});
