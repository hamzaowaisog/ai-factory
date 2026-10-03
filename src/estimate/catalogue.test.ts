import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogueText, kindProblem, loadCatalogue } from "./catalogue.js";
import { proposalFromSizes, stacksFor } from "./catalogue-size.js";
import { taskKind } from "./gates.js";

const c = loadCatalogue();
const write = (body: unknown) => { const f = join(mkdtempSync(join(tmpdir(), "cat-")), "c.json"); writeFileSync(f, JSON.stringify(body)); return f; };

describe("task catalogue", () => {
  it("loads the repo catalogue with a scale for every kind, a typical size factor of 1, and no person's sign-off", () => {
    expect(c).not.toHaveProperty("status");
    expect(c).not.toHaveProperty("signedOffBy");
    expect(c.calibration.holdShare).toBeGreaterThan(0);
    expect(c.sizes.typical).toBe(1);
    expect(c.kinds.length).toBeGreaterThan(20);
    for (const k of c.kinds) expect(Object.keys(k.scale).sort()).toEqual(["large", "small", "typical", "very-large"]);
  });

  it("rejects a duplicate kind and a stack factor for an unknown kind", () => {
    const k = c.kinds[0]!;
    expect(() => loadCatalogue(write({ ...c, kinds: [k, k] }))).toThrow(/listed twice/);
    expect(() => loadCatalogue(write({ ...c, stacks: { x: { note: "n", factors: { "be-nope": 1.2 } } } }))).toThrow(/unknown kind be-nope/);
  });

  it("says why a task's kind does not fit: missing, unknown, or on the wrong track", () => {
    expect(kindProblem(c, { id: "EST-1", track: "web", kind: "ui-list" })).toBeUndefined();
    expect(kindProblem(c, { id: "EST-1", track: "web" })).toMatch(/has no kind/);
    expect(kindProblem(c, { id: "EST-1", track: "web", kind: "ui-nope" })).toMatch(/not in the catalogue/);
    expect(kindProblem(c, { id: "EST-1", track: "backend", kind: "ui-list" })).toMatch(/is for web, mobile/);
  });

  it("lists the kinds for the prompt, with the size scale only when asked", () => {
    expect(catalogueText(c)).toMatch(/^- be-crud \(backend\): /);
    expect(catalogueText(c)).not.toMatch(/very-large:/);
    expect(catalogueText(c, true)).toMatch(/very-large: over 25 fields/);
  });

  it("E2c judges against the catalogue in its inputs, so an old run still verifies after the catalogue changes", () => {
    const tasks = [{ id: "EST-1", track: "backend", kind: "be-old" }] as never;
    expect(taskKind.predicate({ breakdown: { tasks }, catalogue: { version: "v0", kinds: [{ ...c.kinds[0]!, id: "be-old" }] } }).passed).toBe(true);
    expect(taskKind.predicate({ breakdown: { tasks }, catalogue: { version: c.version, kinds: c.kinds } }).passed).toBe(false);
  });
});

describe("catalogue sizing", () => {
  const stack = { backend: "ASP.NET Core Web API", web: "Next.js + shadcn/ui", basis: "assumed" as const };
  const g = { verify: "moderate" as const, context: "complete" as const, reason: "r" };

  it("multiplies the kind's typical hours by size, complexity, UI level and the factory grades", () => {
    const p = proposalFromSizes(c, { stack, tasks: [{ taskId: "EST-1", size: "large", verify: "hard", context: "partial", reason: "18 fields" }] },
      [{ id: "EST-1", track: "backend", kind: "be-crud", complexity: "rules-or-algorithm", executor: "factory" }]);
    // 8-12 h x large 1.6 x rules 1.3 x hard 1.3 x partial 1.2
    expect(p.anchors[0]!.hours).toEqual({ min: 25.96, max: 38.94 });
    expect(p.tasks[0]!.reason).toBe("18 fields [be-crud backend 8-12 h, large x1.6, rules-or-algorithm x1.3, verify hard x1.3, context partial x1.2]");
  });

  it("does not apply a complexity flag the kind already covers, and gives a human task no grades", () => {
    const p = proposalFromSizes(c, { stack, tasks: [{ taskId: "EST-1", size: "typical", reason: "r" }, { taskId: "EST-2", size: "typical", reason: "r" }] }, [
      { id: "EST-1", track: "backend", kind: "be-integration", complexity: "external-dependency", executor: "human" },
      { id: "EST-2", track: "web", kind: "ui-list", complexity: "standard", executor: "human", ui: "complex" },
    ]);
    expect(p.anchors.map((a) => a.hours)).toEqual([{ min: 10, max: 18 }, { min: 8.4, max: 14 }]);
  });

  it("groups by kind and track: the first task is the anchor and the rest are ratios of it", () => {
    const p = proposalFromSizes(c, { stack, tasks: [{ taskId: "EST-1", size: "small", ...g }, { taskId: "EST-2", size: "very-large", ...g }, { taskId: "EST-3", size: "typical", ...g }] }, [
      { id: "EST-1", track: "web", kind: "ui-form", complexity: "standard", executor: "factory" },
      { id: "EST-2", track: "web", kind: "ui-form", complexity: "standard", executor: "factory" },
      { id: "EST-3", track: "mobile", kind: "ui-form", complexity: "standard", executor: "factory" },
    ]);
    expect(p.anchors.map((a) => a.taskId)).toEqual(["EST-1", "EST-3"]);
    expect(p.tasks.map((t) => [t.taskId, t.anchorId, t.ratio, t.size])).toEqual([["EST-1", "EST-1", 1, "small"], ["EST-2", "EST-1", 4.167, "very-large"], ["EST-3", "EST-3", 1, "typical"]]);
  });

  it("matches the priced stack to the catalogue's stacks, and says why a proposal is unusable", () => {
    expect(stacksFor(c, stack)).toEqual(["dotnet", "nextjs"]);
    expect(stacksFor(c, { backend: "Django", basis: "assumed" })).toEqual(["default"]);
    const t = [{ id: "EST-1", track: "backend" as const, kind: "be-crud", complexity: "standard" as const, executor: "factory" as const }];
    expect(() => proposalFromSizes(c, { stack, tasks: [] as never }, t)).toThrow(/EST-1 has no size/);
    expect(() => proposalFromSizes(c, { stack, tasks: [{ taskId: "EST-1", size: "typical", reason: "r" }] }, t)).toThrow(/give it "verify" and "context"/);
    expect(() => proposalFromSizes(c, { stack, tasks: [{ taskId: "EST-1", size: "typical", ...g }, { taskId: "EST-1", size: "typical", ...g }] }, t)).toThrow(/sized twice: EST-1/);
  });
});
