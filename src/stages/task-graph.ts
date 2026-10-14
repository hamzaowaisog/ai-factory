// Which coding tasks of a plan could run side by side. The planner's dependsOn is a hint; code adds every edge a task
// could need and never drops one, so a missing dependsOn can make tasks wait, never collide. Today this is a report on the
// plan card only (the tasks still run one after another): it shows what running them side by side would save.
import { matchesAny } from "../util/glob.js";

export interface GraphTask { id: string; reqs: string[]; fileScope: string[]; dependsOn: string[]; plannedLoc: number }

/** Why one task waits for another. */
export type EdgeWhy = "planner" | "shared file" | "shared set-up file" | "layered plan";
export interface TaskEdge { from: string; to: string; why: EdgeWhy }

/**
 * Files no two tasks may change side by side, whoever lists them: the packages and their lock, the app's frame and theme,
 * the data model and migrations, the API contract and the client generated from it, config. A task that changes one waits
 * for every task before it, and every task after it waits for it.
 */
export const SERIAL_FILES = [
  "package.json", "package-lock.json", "**/*.csproj", "*.sln", "Directory.Build.props", "global.json", "nuget.config",
  "app/layout.*", "app/globals.css", "src/main.*", "src/App.*", "src/index.css", "tailwind.config.*", "next.config.*", "vite.config.*", "tsconfig*.json",
  "contracts/**", "lib/api/**", "orval.config.cjs", "**/Migrations/**", "**/migrations/**", "**/Program.cs", "**/AppDb.cs", "**/*DbContext.cs",
  "appsettings*.json", ".env.example",
];

const touchesSerial = (t: GraphTask): boolean => t.fileScope.some((f) => matchesAny(f, SERIAL_FILES) || SERIAL_FILES.some((g) => matchesAny(g, [f])));
const overlap = (a: GraphTask, b: GraphTask): boolean =>
  a.fileScope.some((p) => b.fileScope.includes(p) || matchesAny(p, b.fileScope)) || b.fileScope.some((q) => matchesAny(q, a.fileScope));

/**
 * The dependency graph of a plan, in plan order. `layered`: the plan holds criteria at a later task than the one that lists
 * them (planShowsLayers), so a task's tests run through tasks after it: such a plan stays one chain.
 */
export function taskGraph(tasks: GraphTask[], layered = false): { edges: TaskEdge[]; problems: string[] } {
  const edges: TaskEdge[] = [];
  const problems: string[] = [];
  const at = new Map(tasks.map((t, i) => [t.id, i]));
  const add = (from: string, to: string, why: EdgeWhy) => { if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, why }); };
  tasks.forEach((t, i) => {
    for (const d of t.dependsOn) {
      const j = at.get(d);
      if (j === undefined) problems.push(`${t.id} depends on unknown ${d}`);
      else if (j >= i) problems.push(`${t.id} depends on ${d}, which does not come before it`);
      else add(d, t.id, "planner");
    }
    for (let j = 0; j < i; j++) {
      const e = tasks[j]!;
      if (layered) add(tasks[i - 1]!.id, t.id, "layered plan");
      else if (touchesSerial(t) || touchesSerial(e)) add(e.id, t.id, "shared set-up file");
      else if (overlap(e, t)) add(e.id, t.id, "shared file");
    }
  });
  return { edges, problems };
}

/** The tasks in waves: each wave's tasks wait only for tasks in earlier waves, so a wave's tasks could run side by side. */
export function waves(tasks: GraphTask[], edges: TaskEdge[]): string[][] {
  const level = new Map<string, number>();
  for (const t of tasks) level.set(t.id, 1 + Math.max(0, ...edges.filter((e) => e.to === t.id).map((e) => level.get(e.from) ?? 0)));
  const out: string[][] = [];
  for (const t of tasks) (out[level.get(t.id)! - 1] ??= []).push(t.id);
  return out;
}

/** The plan card's lines: the waves, and planned lines in sequence against along the longest chain (a size, not a time). */
export function graphReport(tasks: GraphTask[], layered = false): string[] {
  const { edges, problems } = taskGraph(tasks, layered);
  const w = waves(tasks, edges);
  const chain = new Map<string, number>();
  for (const t of tasks) chain.set(t.id, t.plannedLoc + Math.max(0, ...edges.filter((e) => e.to === t.id).map((e) => chain.get(e.from) ?? 0)));
  const total = tasks.reduce((s, t) => s + t.plannedLoc, 0), longest = Math.max(0, ...chain.values());
  const why = (id: string) => [...new Set(edges.filter((e) => e.to === id).map((e) => e.why))].join(", ");
  return [
    `## Task order (${w.length} wave${w.length === 1 ? "" : "s"} for ${tasks.length} task${tasks.length === 1 ? "" : "s"}; the tasks run one after another today)`,
    ...w.map((ids, i) => `- Wave ${i + 1}: ${ids.map((id) => `${id}${i ? ` (after: ${why(id)})` : ""}`).join(", ")}`),
    ...(w.length < tasks.length ? [`Side by side, the longest chain is ${longest} of ${total} planned lines.`] : []),
    ...problems.map((p) => `- ⚠ ${p}`),
  ];
}
