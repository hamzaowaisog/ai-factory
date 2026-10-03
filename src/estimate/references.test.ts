import { describe, expect, it } from "vitest";
import { nearMatches, referencesText, type PastTask } from "./references.js";

const past = (taskId: string, over: Partial<PastTask> = {}): PastTask => ({
  runId: "r1", taskId, kind: "be-crud", track: "backend", complexity: "standard", executor: "factory", ui: "none", items: 3,
  size: "typical", hours: { min: 8, max: 12 }, catalogue: "c1", approvedAt: "2026-10-01T00:00:00Z", ...over,
});
const task = { kind: "be-crud", track: "backend", complexity: "standard", executor: "factory", items: ["a", "b", "c"] };

describe("near matches among approved past tasks", () => {
  it("only matches the same kind, track, complexity and executor", () => {
    const ps = [past("EST-1", { kind: "be-endpoint" }), past("EST-2", { track: "web" }), past("EST-3", { complexity: "real-time" }), past("EST-4", { executor: "joint" }), past("EST-5")];
    expect(nearMatches(task, undefined, ps).map((r) => r.taskId)).toEqual(["EST-5"]);
  });

  it("ranks the same UI level first, then the closest item count, then the newest, and keeps two", () => {
    const ps = [
      past("EST-1", { items: 9 }), past("EST-2", { items: 4, approvedAt: "2026-09-01T00:00:00Z" }), past("EST-3", { items: 4, approvedAt: "2026-10-02T00:00:00Z" }),
      past("EST-4", { ui: "complex", items: 3 }),
    ];
    const r = nearMatches(task, undefined, ps);
    expect(r.map((x) => x.taskId)).toEqual(["EST-3", "EST-2"]);
    expect(r[0]).toMatchObject({ sameUi: true, itemsDiff: 1 });
    expect(nearMatches(task, "complex", ps)[0]!.taskId).toBe("EST-4");
  });

  it("finds nothing without approved past tasks, and writes one line per task that has references", () => {
    expect(nearMatches(task, undefined, [])).toEqual([]);
    const refs = new Map([["EST-1", nearMatches(task, undefined, [past("EST-9", { size: "large", hours: { min: 12.8, max: 19.2 } })])], ["EST-2", []]]);
    expect(referencesText(refs)).toBe("- EST-1: large (12.8-19.2 h; same UI level; same item count)");
  });
});
