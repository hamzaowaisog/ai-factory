// The rules a hands-off estimate run settles its gates by (src/estimate/fallbacks.ts).
import { describe, expect, it } from "vitest";
import type { BreakdownBody, Estimate } from "../contracts/index.js";
import type { z } from "zod";
import { loadCatalogue } from "./catalogue.js";
import { applyPatch, breakdownGaps, CHECKLIST_ITEMS, fixBreakdown, flagOutliers, NOT_ASSESSED } from "./fallbacks.js";

type Body = z.infer<typeof BreakdownBody>;
const task = (id: string, over: Partial<Body["tasks"][number]> = {}) => ({ id, title: `Task ${id}`, featureId: "F-1", reqs: ["REQ-1"], items: [], track: "web", kind: "ui-form", executor: "factory", dependsOn: [], complexity: "standard", ...over }) as Body["tasks"][number];
const body = (tasks: Body["tasks"], checklist: Body["checklist"] = [{ item: "auth", included: true }]): Body => ({ features: [{ id: "F-1", title: "F", reqs: ["REQ-1"] }], tasks, checklist });

describe("hands-off breakdown fixes", () => {
  it("fills an empty checklist with every item not assessed, and drops a screen the design does not have", () => {
    const fx = fixBreakdown(body([task("EST-1", { screen: "S-9" })], []), ["REQ-1"], ["S-1"]);
    expect(fx.body.checklist).toHaveLength(CHECKLIST_ITEMS.length);
    expect(fx.body.checklist.every((c) => !c.included && c.reason === NOT_ASSESSED)).toBe(true);
    expect(fx.body.tasks[0]!.screen).toBeUndefined();
    expect(fx.notes.join("\n")).toMatch(/E1c.*S-9[\s\S]*E4.*empty/);
    expect(fx.suggested).toEqual([]);
  });

  it("keeps an overhead with no requirement, and changes nothing that passes", () => {
    const b = body([task("EST-1"), task("EST-2", { reqs: [], overhead: "deployment" })]);
    const fx = fixBreakdown(b, ["REQ-1"], []);
    expect(fx.body.tasks).toEqual(b.tasks);
    expect(fx.notes).toEqual([]);
  });

  it("lists what only a model can add, and merges its patch, refusing a clashing id", () => {
    const cat = loadCatalogue();
    const b = body([task("EST-1", { kind: "be-crud" })]);
    const gaps = breakdownGaps(b, { requirements: [{ id: "REQ-1" }, { id: "REQ-2" }, { id: "REQ-3", op: "REMOVED" }] }, ["S-1"], cat);
    expect(gaps.uncovered).toEqual(["REQ-2"]);
    expect(gaps.unbuilt).toEqual(["S-1"]);
    expect(gaps.kinds.map((k) => k.taskId)).toEqual(["EST-1"]);
    expect(applyPatch(b, { tasks: [task("EST-1")], kinds: [] }, gaps)).toEqual({ error: "the patch reuses task ids EST-1" });
    const ok = applyPatch(b, { tasks: [task("EST-2", { reqs: ["REQ-2"], screen: "S-1" })], kinds: [{ taskId: "EST-1", kind: "ui-form" }] }, gaps);
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.body.tasks.map((t) => `${t.id}:${t.kind}`)).toEqual(["EST-1:ui-form", "EST-2:ui-form"]);
    expect(breakdownGaps(ok.body, { requirements: [{ id: "REQ-1" }, { id: "REQ-2" }] }, ["S-1"], cat)).toEqual({ uncovered: [], unbuilt: [], kinds: [] });
    expect(ok.notes.join("\n")).toMatch(/added EST-2.*REQ-2, S-1[\s\S]*re-kinded EST-1 as ui-form/);
  });

  it("flags every task an E5 failure names, once, with the gate's reason", () => {
    const e = { tasks: [{ taskId: "EST-1", flagged: false }, { taskId: "EST-2", flagged: false }, { taskId: "EST-3", flagged: false }], assumptions: ["a"] } as unknown as Estimate;
    const fx = flagOutliers(e, [
      { check: "e5-ui-order", message: "screen S-2 is complex but sized below S-1", frames: [], location: "EST-1,EST-2" },
      { check: "e5-outlier", message: "EST-2 is far from the median", frames: [], location: "EST-2" },
    ]);
    expect(fx.estimate.tasks.map((t) => t.flagged)).toEqual([true, true, false]);
    expect(fx.notes).toHaveLength(2);
    expect(fx.estimate.assumptions[2]).toMatch(/^Open risk: EST-2 .*complex but sized below/);
  });
});
