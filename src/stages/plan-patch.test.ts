import { describe, expect, it } from "vitest";
import { PlanBody } from "../contracts/index.js";
import { applyPlanPatch, PlanPatch } from "./plan-patch.js";

const task = (n: number, over: Record<string, unknown> = {}) => ({ id: `TASK-${n}`, title: `Part ${n}`, reqs: [`REQ-${n}`], fileScope: [`src/p${n}.ts`], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 3, approach: "small edit", ...over });
const prev = PlanBody.parse({
  tasks: [task(1), task(2)],
  options: [{ id: "O-1", summary: "a", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "b", simplest: false, tradeoffs: "more" }],
  chosen: "O-1", adr: "Keep it small.", protectedPathsDeclared: [], newDependencies: [],
  stubs: [{ path: "contracts/openapi.yaml", content: "openapi: 3.0.3\npaths:\n  /a:\n    get: {}\n", reason: "contract" }, { path: "src/p1.ts", content: "export const a = 1;\n", reason: "tests call it" }],
});
const patch = (p: Record<string, unknown>) => applyPlanPatch(prev, PlanPatch.parse(p));
const planOf = (r: ReturnType<typeof applyPlanPatch>) => { if (!("plan" in r)) throw new Error(r.problem); return r.plan; };

describe("a plan patch", () => {
  it("changes a task in place, adds a new one last, and keeps everything it does not name", () => {
    const plan = planOf(patch({ tasks: [task(3), task(1, { reqs: ["REQ-1", "REQ-4"] })] }));
    expect(plan.tasks.map((t) => t.id)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    expect(plan.tasks[0]!.reqs).toEqual(["REQ-1", "REQ-4"]);
    expect(plan.tasks[1]).toEqual(prev.tasks[1]);
    expect(plan.stubs).toEqual(prev.stubs);
    expect(plan.adr).toBe("Keep it small.");
    expect(PlanBody.safeParse(plan).success).toBe(true);
  });

  it("drops and reorders tasks", () => {
    expect(planOf(patch({ dropTasks: ["TASK-1"] })).tasks.map((t) => t.id)).toEqual(["TASK-2"]);
    expect(planOf(patch({ tasks: [task(3)], order: ["TASK-3", "TASK-1", "TASK-2"] })).tasks.map((t) => t.id)).toEqual(["TASK-3", "TASK-1", "TASK-2"]);
    expect(patch({ order: ["TASK-1"] })).toMatchObject({ problem: expect.stringMatching(/order must list every task/) });
    expect(patch({ dropTasks: ["TASK-9"] })).toMatchObject({ problem: expect.stringMatching(/TASK-9/) });
    expect(patch({ dropTasks: ["TASK-1", "TASK-2"] })).toMatchObject({ problem: expect.stringMatching(/no task/) });
  });

  it("edits a stub by its one matching text, and rewrites, adds or drops whole stubs", () => {
    const plan = planOf(patch({
      stubEdits: [{ path: "contracts/openapi.yaml", find: "    get: {}", replace: "    get: {}\n    post: {}" }],
      stubs: [{ path: "src/p2.ts", content: "export const b = 2;\n", reason: "new" }], dropStubs: ["src/p1.ts"],
    }));
    expect(plan.stubs.map((s) => s.path)).toEqual(["contracts/openapi.yaml", "src/p2.ts"]);
    expect(plan.stubs[0]!.content).toBe("openapi: 3.0.3\npaths:\n  /a:\n    get: {}\n    post: {}\n");
    // an edit whose text is not there once cannot be applied: the planner writes the whole plan again
    expect(patch({ stubEdits: [{ path: "contracts/openapi.yaml", find: "nowhere", replace: "x" }] })).toMatchObject({ problem: expect.stringMatching(/occurs 0 times/) });
    expect(patch({ stubEdits: [{ path: "contracts/openapi.yaml", find: " ", replace: "x" }] })).toMatchObject({ problem: expect.stringMatching(/times, not once/) });
    expect(patch({ stubEdits: [{ path: "src/none.ts", find: "a", replace: "b" }] })).toMatchObject({ problem: expect.stringMatching(/not a stub/) });
  });

  it("an empty patch is refused, and a top-level field is replaced only when given", () => {
    expect(patch({})).toMatchObject({ problem: "the patch changes nothing" });
    expect(planOf(patch({ adr: "Changed." })).adr).toBe("Changed.");
  });
});
