// Catalogue sizing (docs/estimate-consistency.md, section 10, steps A and B). The estimator picks a size step for
// each task against its kind's written scale, and for a factory task two grades: how hard its work is to check, and
// how complete its context is. Code reads the hours from the catalogue and applies the factors. The result is put in
// the anchor-and-ratio shape the rest of the estimate already uses: the first task of each kind and track is that
// group's anchor, and every other task in the group is a ratio of it. Merging, lint E6 and a lead's edits then work
// unchanged, and the model never writes an hour.
import { z } from "zod";
import { StackChoice, type ComplexityFlag, type Executor, type Track } from "../contracts/index.js";
import type { Proposal } from "./assemble.js";
import { ContextGrade, kindById, SizeStep, VerifyGrade, type Catalogue } from "./catalogue.js";
import type { UiLevel } from "./ui-complexity.js";

export const SizeOut = z.object({
  tasks: z.array(z.object({
    taskId: z.string(),
    size: SizeStep,
    /** factory and joint tasks only */
    verify: VerifyGrade.optional(),
    context: ContextGrade.optional(),
    reason: z.string().min(1),
  })).min(1),
  stack: StackChoice,
});
export type SizeOut = z.infer<typeof SizeOut>;

export interface SizeTask { id: string; track: Track; kind?: string | undefined; complexity: ComplexityFlag; executor: Executor; ui?: UiLevel | undefined }

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The catalogue stacks the priced stack matches (by any of its parts); "default" when none does. */
export function stacksFor(c: Pick<Catalogue, "stacks">, stack: StackChoice): string[] {
  const text = [stack.backend, stack.web, stack.mobile].filter(Boolean).join(" | ");
  const hit = Object.entries(c.stacks).filter(([, s]) => s.match?.some((m) => new RegExp(m, "i").test(text))).map(([n]) => n);
  return hit.length ? hit : ["default"];
}

/** A task's multiplier on its kind's typical hours, and the parts of it in words. */
export function multiplier(c: Catalogue, t: SizeTask, s: SizeOut["tasks"][number], stacks: string[]): { mult: number; parts: string[] } {
  const kind = kindById(c, t.kind)!;
  const parts: [string, number][] = [[s.size, c.sizes[s.size]]];
  if (!kind.covers?.includes(t.complexity)) parts.push([t.complexity, c.factors.complexity[t.complexity]]);
  if (t.ui) parts.push([`${t.ui} UI`, c.factors.ui[t.ui]]);
  if (t.executor !== "human") parts.push([`verify ${s.verify}`, c.factors.verify[s.verify!]], [`context ${s.context}`, c.factors.context[s.context!]]);
  for (const n of stacks) { const f = c.stacks[n]?.factors?.[kind.id]; if (f) parts.push([`${n} stack`, f]); }
  // a tuned version's hours scale, measured from finished projects (tune.ts)
  if (c.hoursScale && c.hoursScale !== 1) parts.push(["tuned hours", c.hoursScale]);
  const shown = parts.filter(([, f]) => f !== 1);
  return { mult: parts.reduce((m, [, f]) => m * f, 1), parts: shown.length ? shown.map(([n, f]) => `${n} x${f}`) : ["typical"] };
}

/** One estimator's sizes as a Proposal. Throws a readable Error on a task sized twice, missed, or missing its grades. */
export function proposalFromSizes(c: Catalogue, out: SizeOut, tasks: SizeTask[]): Proposal {
  const byId = new Map(out.tasks.map((s) => [s.taskId, s]));
  for (const s of out.tasks) if (!tasks.some((t) => t.id === s.taskId)) throw new Error(`${s.taskId} is not in the breakdown`);
  if (byId.size !== out.tasks.length) throw new Error(`a task is sized twice: ${out.tasks.map((s) => s.taskId).filter((id, i, a) => a.indexOf(id) !== i).join(", ")}`);
  const stacks = stacksFor(c, out.stack);
  const anchors: Proposal["anchors"] = [];
  const sized: Proposal["tasks"] = [];
  const groupAnchor = new Map<string, { id: string; mult: number }>();
  for (const t of tasks) {
    const s = byId.get(t.id);
    if (!s) throw new Error(`${t.id} has no size`);
    if (t.executor !== "human" && (!s.verify || !s.context)) throw new Error(`${t.id} is a ${t.executor} task: give it "verify" and "context"`);
    const kind = kindById(c, t.kind);
    const base = kind?.hours[t.track];
    if (!kind || !base) throw new Error(`${t.id} has no catalogue hours for kind ${t.kind ?? "(none)"} on ${t.track}`);
    const { mult, parts } = multiplier(c, t, s, stacks);
    const grades = { ...(s.verify && t.executor !== "human" ? { verify: s.verify } : {}), ...(s.context && t.executor !== "human" ? { context: s.context } : {}) };
    const why = `${s.reason} [${kind.id} ${t.track} ${base.min}-${base.max} h, ${parts.join(", ")}]`;
    const group = `${kind.id}/${t.track}`;
    const a = groupAnchor.get(group);
    if (!a) {
      groupAnchor.set(group, { id: t.id, mult });
      anchors.push({ taskId: t.id, hours: { min: r2(base.min * mult), max: r2(base.max * mult) }, reason: why });
      sized.push({ taskId: t.id, anchorId: t.id, ratio: 1, reason: why, size: s.size, ...grades });
    } else {
      sized.push({ taskId: t.id, anchorId: a.id, ratio: r3(mult / a.mult), reason: why, size: s.size, ...grades });
    }
  }
  return { anchors, tasks: sized, stack: out.stack };
}
