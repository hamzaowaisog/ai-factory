import { describe, expect, it } from "vitest";
import { demoTry } from "./demo.js";

const ledger = (events: { seq: number; type: string; key?: string; data?: unknown }[]) => ({ events: () => events });

describe("a demo step's try", () => {
  it("counts failed attempts since the step last completed, not parks, rate limits or exceptions before the agent ran", () => {
    const key = "implement/TASK-1";
    expect(demoTry(ledger([]), key)).toBe(1);
    expect(demoTry(ledger([
      // run 3f0f: ENOENT on a screen's HTML, twice, before any agent started
      { seq: 1, type: "step.failed", key: `${key}/1`, data: { category: "other", signature: "exception:ENOENT: no such file" } },
      { seq: 2, type: "step.failed", key: `${key}/2`, data: { category: "other", signature: "exception:ENOENT: no such file" } },
      { seq: 3, type: "step.failed", key: `${key}/3`, data: { category: "other", signature: "park", parked: true } },
      { seq: 4, type: "step.failed", key: `${key}/4`, data: { category: "rate-limit", signature: "x" } },
      { seq: 5, type: "step.failed", key: `${key}/5`, data: { category: "locked-test", signature: "locked-failed:AC_1_1" } },
    ]), key)).toBe(2);
  });

  it("starts again after the step completed, and ignores other steps", () => {
    const key = "implement/TASK-2";
    expect(demoTry(ledger([
      { seq: 1, type: "step.failed", key: `${key}/1`, data: { category: "other", signature: "build" } },
      { seq: 2, type: "step.completed", key: `${key}/2` },
      { seq: 3, type: "step.failed", key: "implement/TASK-20/1", data: { category: "other", signature: "build" } },
    ]), key)).toBe(1);
  });
});
