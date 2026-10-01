import { describe, expect, it } from "vitest";
import { applyEdits, checkEdit, editsOf, parseAnchorSpec, parseRatioSpec } from "./edits.js";
import type { Proposal } from "./assemble.js";

const p = (scale = 1): Proposal => ({
  anchors: [{ taskId: "EST-1", hours: { min: 4 * scale, max: 8 * scale }, reason: "typical" }],
  tasks: [{ taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "anchor" }, { taskId: "EST-2", anchorId: "EST-1", ratio: 2, reason: "twice" }],
});

describe("estimate edits", () => {
  it("applies an anchor range and a ratio to every estimator's reading", () => {
    const out = applyEdits([p(), p(1.2)], [{ anchors: { "EST-1": { min: 6, max: 12 } }, ratios: { "EST-2": 3 }, by: "lead", reason: "more fields" }]);
    for (const x of out) {
      expect(x.anchors[0]!.hours).toEqual({ min: 6, max: 12 });
      expect(x.tasks.find((t) => t.taskId === "EST-2")!.ratio).toBe(3);
      expect(x.tasks.find((t) => t.taskId === "EST-1")!.ratio).toBe(1);
    }
  });
  it("refuses edits that cannot apply: unknown ids, a ratio on an anchor, a bad range, nothing", () => {
    expect(checkEdit({ anchors: { "EST-2": { min: 1, max: 2 } } }, p())).toEqual([expect.stringMatching(/not an anchor/)]);
    expect(checkEdit({ ratios: { "EST-1": 2 } }, p())).toEqual([expect.stringMatching(/is an anchor/)]);
    expect(checkEdit({ ratios: { "EST-9": 2 } }, p())).toEqual([expect.stringMatching(/not a sized task/)]);
    expect(checkEdit({ anchors: { "EST-1": { min: 9, max: 2 } } }, p())[0]).toMatch(/not valid/);
    expect(checkEdit({}, p())).toEqual(["the edit changes nothing"]);
    expect(() => applyEdits([p()], [{ ratios: { "EST-1": 2 }, by: "lead", reason: "x" }])).toThrow(/edit by lead/);
  });
  it("reads edit decisions on estimate cards only, oldest first", () => {
    const d = (cardId: string, decision: string, extra: object = {}) => ({ cardId, decision, by: "lead", artifactSha: "a", seq: 1, ...extra });
    const edits = editsOf({ decisions: [d("estimate-1", "edit", { edits: { ratios: { "EST-2": 3 } }, reason: "r1" }), d("design-1", "edit"), d("estimate-2", "approve"), d("estimate-3", "edit", { edits: { ratios: { "EST-2": 4 } }, reason: "r2" })] as never });
    expect(edits.map((e) => e.reason)).toEqual(["r1", "r2"]);
  });
  it("parses the flags", () => {
    expect(parseAnchorSpec("EST-1=6-12.5")).toEqual(["EST-1", { min: 6, max: 12.5 }]);
    expect(parseRatioSpec("EST-4=2")).toEqual(["EST-4", 2]);
    expect(() => parseAnchorSpec("EST-1=6")).toThrow(/EST-1=min-max/);
    expect(() => parseRatioSpec("4=2")).toThrow(/EST-4=2/);
  });
});
