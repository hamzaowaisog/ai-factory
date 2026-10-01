import { describe, expect, it } from "vitest";
import { formatCalibration, judge, parseActualHours } from "./calibrate.js";

describe("calibration", () => {
  it("judges an actual against a range and says how far from the middle", () => {
    expect(judge({ min: 2, max: 4 }, 3)).toEqual({ verdict: "within", ratio: 1 });
    expect(judge({ min: 2, max: 4 }, 1)).toEqual({ verdict: "under", ratio: 0.33 });
    expect(judge({ min: 2, max: 4 }, 9)).toEqual({ verdict: "over", ratio: 3 });
    expect(judge({ min: 0, max: 0 }, 1).ratio).toBe(0);
  });
  it("reads a file of finished projects, ignoring comments, blank lines and a header", () => {
    expect(parseActualHours("run,hours\n# done\n\nest-1, 120\nest-2;80.5\nbad,x\n")).toEqual([{ run: "est-1", hours: 120 }, { run: "est-2", hours: 80.5 }]);
  });
  it("prints a plain table, and says so when there is nothing to compare", () => {
    expect(formatCalibration([], [])).toMatch(/nothing to compare/);
    const out = formatCalibration(
      [{ estimateRun: "e1", buildRun: "b1", group: "build run", estimated: { min: 1, max: 2 }, actual: 5, verdict: "over", ratio: 3.33 }],
      [{ estimateRun: "e1", estimated: { min: 10, max: 20 }, actual: 15, verdict: "within", ratio: 1 }],
    );
    expect(out).toMatch(/over \(3.33× the middle\)/);
    expect(out).toMatch(/0 of 1 within range/);
    expect(out).toMatch(/1 of 1 within range/);
  });
});
