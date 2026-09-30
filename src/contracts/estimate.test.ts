import { describe, expect, it } from "vitest";
import { BreakdownBody, Estimate, EstimateTaskId, toJsonSchema } from "./index.js";

const sha = "a".repeat(64);
const header = { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" };

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: "t", featureId: "F-1", reqs: ["REQ-1"], track: "backend", executor: "factory", ...extra,
});
const breakdown = (tasks: unknown[]) => ({ features: [{ id: "F-1", title: "f", reqs: ["REQ-1"] }], tasks });

describe("breakdown", () => {
  it("accepts a valid breakdown and defaults the optional lists", () => {
    const b = BreakdownBody.parse(breakdown([task("EST-1"), task("EST-2", { dependsOn: ["EST-1"] })]));
    expect(b.tasks[0]!.items).toEqual([]);
    expect(b.tasks[0]!.complexity).toBe("standard");
  });

  it("rejects duplicate ids, unknown dependencies, self-dependency and unknown features", () => {
    expect(BreakdownBody.safeParse(breakdown([task("EST-1"), task("EST-1")])).success).toBe(false);
    expect(BreakdownBody.safeParse(breakdown([task("EST-1", { dependsOn: ["EST-9"] })])).success).toBe(false);
    expect(BreakdownBody.safeParse(breakdown([task("EST-1", { dependsOn: ["EST-1"] })])).success).toBe(false);
    expect(BreakdownBody.safeParse(breakdown([task("EST-1", { featureId: "F-9" })])).success).toBe(false);
  });

  it("only takes EST-<number> ids", () => {
    expect(EstimateTaskId.safeParse("EST-12").success).toBe(true);
    expect(EstimateTaskId.safeParse("TASK-12").success).toBe(false);
  });

  it("produces a JSON schema for the model's structured output", () => {
    expect(toJsonSchema(BreakdownBody)).toHaveProperty("properties.tasks");
  });
});

const range = (min: number, max: number) => ({ min, max });
const sizing = (taskId: string, anchorId: string) => ({ taskId, anchorId, ratio: 1, reason: "r", hours: range(2, 4), executor: "factory" });
const estimate = (over: Record<string, unknown> = {}) => ({
  header, deliveryModel: "hitl", band: "S", uncertainty: "medium", breakdownSha: sha, specSha: sha,
  anchors: [{ taskId: "EST-1", hours: range(2, 4), reason: "typical screen" }],
  tasks: [sizing("EST-1", "EST-1"), sizing("EST-2", "EST-1")],
  gateHours: [{ source: "lead PR review", hours: range(1, 2), assumed: true }],
  totals: { byTrack: { backend: range(4, 8) }, overall: range(5, 10) },
  apiCost: { phases: [{ phase: "build", usd: range(1, 2) }], total: range(1, 2), confidence: "cold-start", records: 0 },
  elapsed: { planningMinutes: 20, criticalPathDays: range(2, 3) },
  settings: { stackSource: "client", designInTotal: true, feedbackRounds: 2 },
  ...over,
});

describe("estimate", () => {
  it("accepts a valid HITL estimate", () => {
    expect(Estimate.safeParse(estimate()).success).toBe(true);
  });

  it("accepts a solely agentic estimate with no gate hours", () => {
    expect(Estimate.safeParse(estimate({ deliveryModel: "agentic", gateHours: [] })).success).toBe(true);
  });

  it("rejects gate hours on the solely agentic model", () => {
    expect(Estimate.safeParse(estimate({ deliveryModel: "agentic" })).success).toBe(false);
  });

  it("rejects a range with min above max", () => {
    expect(Estimate.safeParse(estimate({ totals: { byTrack: {}, overall: range(9, 3) } })).success).toBe(false);
  });

  it("requires every anchor to be a sized task and every task to name an anchor", () => {
    expect(Estimate.safeParse(estimate({ anchors: [{ taskId: "EST-7", hours: range(1, 2), reason: "x" }] })).success).toBe(false);
    expect(Estimate.safeParse(estimate({ tasks: [sizing("EST-1", "EST-1"), sizing("EST-2", "EST-5")] })).success).toBe(false);
  });

  it("allows at most two scenarios and only labelled assumptions for gate hours", () => {
    const sc = { name: "web", changes: "admin is web", totals: range(1, 2) };
    expect(Estimate.safeParse(estimate({ scenarios: [sc, sc, sc] })).success).toBe(false);
    expect(Estimate.safeParse(estimate({ gateHours: [{ source: "x", hours: range(1, 2), assumed: false }] })).success).toBe(false);
  });
});
