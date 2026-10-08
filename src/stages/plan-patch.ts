// A plan that failed its checks is fixed by a patch, not written again: the planner returns only the tasks and stubs that
// change. On the web run of 2026-10-06 two uncovered requirements made the planner rewrite 51,000 output tokens ($1.30).
import { z } from "zod";
import { DataModel, InterfaceStub, PlanBody, PlanTask } from "../contracts/index.js";

type Plan = z.infer<typeof PlanBody>;

export const PlanPatch = z.object({
  /** tasks that change or are new, each whole; a task keeps its place by id, a new one goes last */
  tasks: z.array(PlanTask).default([]),
  dropTasks: z.array(z.string()).default([]),
  /** every task id in the new order, only when the order has to change */
  order: z.array(z.string()).optional(),
  /** stub files that are new or rewritten, each whole */
  stubs: z.array(InterfaceStub).default([]),
  /** a small change inside a stub that stays: `find` is text that occurs exactly once in the file */
  stubEdits: z.array(z.object({ path: z.string(), find: z.string().min(1), replace: z.string() })).default([]),
  dropStubs: z.array(z.string()).default([]),
  options: PlanBody.shape.options.optional(),
  chosen: PlanBody.shape.chosen.optional(),
  adr: z.string().optional(),
  protectedPathsDeclared: z.array(z.string()).optional(),
  newDependencies: z.array(z.object({ name: z.string(), version: z.string(), registry: z.string() })).optional(),
  /** the data model, whole, only when it changes */
  dataModel: DataModel.optional(),
});
export type PlanPatch = z.infer<typeof PlanPatch>;

export const PATCH_RULES = `THE PLAN IS FIXED, NOT REWRITTEN. "previous-plan" is the plan you wrote; it failed the checks listed under the failures. Return only what changes, and everything you leave out stays as it is:
- tasks: each task that changes, or a new task, written whole. A task keeps its place by id; a new task goes last (give "order", every task id in the new order, only when the order must change). dropTasks: ids of tasks to remove.
- stubs: a stub file that is new or mostly rewritten, written whole. stubEdits: a small change in a stub that stays, as { path, find, replace }, where "find" is text copied exactly from that file that occurs in it once. dropStubs: paths of stubs to remove.
- options, chosen, adr, protectedPathsDeclared, newDependencies, dataModel: give one only when it changes (then whole).
Change nothing the failures do not ask for.`;

/** The previous plan with the patch applied, or why it cannot be applied (the caller then asks for a whole plan). */
export function applyPlanPatch(prev: Plan, p: PlanPatch): { plan: Plan } | { problem: string } {
  const changed = new Map(p.tasks.map((t) => [t.id, t]));
  const dropped = new Set(p.dropTasks);
  for (const id of dropped) if (!prev.tasks.some((t) => t.id === id)) return { problem: `dropTasks names ${id}, which is not a task of the plan` };
  let tasks = [
    ...prev.tasks.filter((t) => !dropped.has(t.id)).map((t) => changed.get(t.id) ?? t),
    ...p.tasks.filter((t) => !prev.tasks.some((x) => x.id === t.id) && !dropped.has(t.id)),
  ];
  if (!tasks.length) return { problem: "the patch leaves the plan with no task" };
  if (p.order) {
    const by = new Map(tasks.map((t) => [t.id, t]));
    if (p.order.length !== tasks.length || new Set(p.order).size !== tasks.length || p.order.some((id) => !by.has(id))) return { problem: "order must list every task id of the patched plan once" };
    tasks = p.order.map((id) => by.get(id)!);
  }
  const gone = new Set(p.dropStubs);
  const rewritten = new Map(p.stubs.map((s) => [s.path, s]));
  const stubs = [
    ...prev.stubs.filter((s) => !gone.has(s.path)).map((s) => rewritten.get(s.path) ?? s),
    ...p.stubs.filter((s) => !prev.stubs.some((x) => x.path === s.path) && !gone.has(s.path)),
  ];
  for (const e of p.stubEdits) {
    const i = stubs.findIndex((s) => s.path === e.path);
    if (i < 0) return { problem: `stubEdits names ${e.path}, which is not a stub of the plan` };
    const n = stubs[i]!.content.split(e.find).length - 1;
    if (n !== 1) return { problem: `the text to find in ${e.path} occurs ${n} times, not once: ${JSON.stringify(e.find.slice(0, 80))}` };
    stubs[i] = { ...stubs[i]!, content: stubs[i]!.content.replace(e.find, () => e.replace) };
  }
  const nothing = !p.tasks.length && !p.dropTasks.length && !p.order && !p.stubs.length && !p.stubEdits.length && !p.dropStubs.length
    && [p.options, p.chosen, p.adr, p.protectedPathsDeclared, p.newDependencies, p.dataModel].every((x) => x === undefined);
  if (nothing) return { problem: "the patch changes nothing" };
  return {
    plan: {
      tasks, stubs,
      options: p.options ?? prev.options, chosen: p.chosen ?? prev.chosen, adr: p.adr ?? prev.adr,
      protectedPathsDeclared: p.protectedPathsDeclared ?? prev.protectedPathsDeclared, newDependencies: p.newDependencies ?? prev.newDependencies,
      ...(p.dataModel ?? prev.dataModel ? { dataModel: p.dataModel ?? prev.dataModel } : {}),
    },
  };
}
