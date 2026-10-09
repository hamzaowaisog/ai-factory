// The data model page of a run: where the model comes from (the plan, or the repo before the plan exists) and where each
// table sits in the diagram. The layout is worked out here so the page only draws; pure code, no model.
import { parse } from "yaml";
import { DataModel } from "../contracts/index.js";
import { loadProject } from "../config/project.js";
import { gitSource } from "../design/source.js";
import { DATA_MODEL_FILE, dataModelProblems, dataModelSummary, erdMermaid, joinTables, relationsOf, type Relation } from "../gates/data-model.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { readOutput } from "../stages/framework.js";

const ROW = 24, HEAD = 34, PAD = 12, EDGE = 28, CHAR = 7.3, GAP_X = 110, GAP_Y = 36, MIN_W = 190, MAX_W = 360;

export interface ErdRow { name: string; type: string; keys: string[]; optional: boolean; note?: string; y: number }
export interface ErdBox { name: string; change: "new" | "changed" | "unchanged"; purpose: string; x: number; y: number; w: number; h: number; rows: ErdRow[] }
export interface ErdEdge extends Relation {
  /** the foreign key's end (the "many" side) and the end at the table it points at; side is the box edge the line leaves from */
  a: { x: number; y: number; side: "left" | "right" }; b: { x: number; y: number; side: "left" | "right" };
  /** a line that skips over columns of tables runs level at y between x2 (nearer the foreign key) and x1, clear of the tables there */
  via?: { y: number; x1: number; x2: number };
}
export interface ErdLayout { width: number; height: number; boxes: ErdBox[]; edges: ErdEdge[] }

const lower = (s: string) => s.toLowerCase();
const counts = (m: DataModel) => ({ added: m.tables.filter((t) => t.change === "new").length, changed: m.tables.filter((t) => t.change === "changed").length, unchanged: m.tables.filter((t) => t.change === "unchanged").length });

/**
 * Tables in columns: a table sits one column to the right of the furthest table it points at, so foreign keys read right to
 * left. Within a column, tables are ordered by where the tables they point at sit, which keeps most lines from crossing.
 */
export function erdLayout(m: DataModel): ErdLayout {
  const byName = new Map(m.tables.map((t) => [lower(t.name), t]));
  const targets = (name: string) => [...new Set((byName.get(name)?.columns ?? []).flatMap((c) => (c.references && byName.has(lower(c.references.table)) && lower(c.references.table) !== name ? [lower(c.references.table)] : [])))];
  const level = new Map<string, number>();
  const depth = (name: string, seen: Set<string>): number => {
    if (level.has(name)) return level.get(name)!;
    if (seen.has(name)) return 0; // a cycle: break it here
    seen.add(name);
    const d = Math.max(-1, ...targets(name).map((t) => depth(t, seen))) + 1;
    level.set(name, d);
    return d;
  };
  for (const t of m.tables) depth(lower(t.name), new Set());

  const w = Math.min(MAX_W, Math.max(MIN_W, ...m.tables.map((t) => Math.max(t.name.length * 8.4 + 2 * PAD + 70,
    ...t.columns.map((c) => (c.name.length + c.type.length + 3) * CHAR + 2 * PAD + 62)))));
  const boxes = new Map<string, ErdBox>();
  const levels = [...new Set(level.values())].sort((a, b) => a - b);
  const columns = levels.map((l) => m.tables.filter((t) => level.get(lower(t.name)) === l));
  const heightOf = (n: number) => HEAD + n * ROW + 6;
  const colHeight = (ts: typeof m.tables) => ts.reduce((s, t) => s + heightOf(t.columns.length), 0) + GAP_Y * Math.max(0, ts.length - 1);
  const tallest = Math.max(0, ...columns.map(colHeight));
  columns.forEach((ts, i) => {
    const centre = (t: (typeof ts)[number]) => {
      const ys = targets(lower(t.name)).flatMap((n) => { const b = boxes.get(n); return b ? [b.y + b.h / 2] : []; });
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.MAX_SAFE_INTEGER;
    };
    const ordered = i ? ts.map((t, k) => ({ t, k, c: centre(t) })).sort((p, q) => p.c - q.c || p.k - q.k).map((x) => x.t) : ts;
    let y = EDGE + (tallest - colHeight(ts)) / 2;
    for (const t of ordered) {
      const h = heightOf(t.columns.length);
      boxes.set(lower(t.name), {
        name: t.name, change: t.change, purpose: t.purpose, x: PAD + i * (w + GAP_X), y, w, h,
        rows: t.columns.map((c, k) => ({
          name: c.name, type: c.type, optional: !c.required, y: y + HEAD + k * ROW + ROW / 2,
          keys: [c.pk ? "PK" : "", c.references ? "FK" : "", c.unique && !c.pk ? "UK" : ""].filter(Boolean),
          ...(c.values?.length ? { note: c.values.join(" | ") } : {}),
        })),
      });
      y += h + GAP_Y;
    }
  });

  const lanes: number[] = [];
  const edges: ErdEdge[] = relationsOf(m).flatMap((r) => {
    const from = boxes.get(lower(r.from)), to = boxes.get(lower(r.to));
    const fr = from?.rows.find((x) => lower(x.name) === lower(r.column)), tr = to?.rows.find((x) => lower(x.name) === lower(r.toColumn));
    if (!from || !to || !fr || !tr) return [];
    // the table pointed at sits to the left: leave by the left edge, arrive at its right edge. Same column (or a table
    // pointing at itself): both ends on the right edge, and the line loops round outside.
    const across = to.x < from.x;
    const e: ErdEdge = { ...r, a: { x: across ? from.x : from.x + from.w, y: fr.y, side: across ? "left" : "right" }, b: { x: to.x + to.w, y: tr.y, side: "right" } };
    // columns of tables between the two ends: run level through a gap there, the one nearest the straight line
    const between = [...boxes.values()].filter((x) => x.x > to.x && x.x < from.x);
    if (between.length) {
      const free = (y: number) => between.every((x) => y < x.y - 8 || y > x.y + x.h + 8);
      const want = (e.a.y + e.b.y) / 2;
      const gaps = [Math.min(...between.map((x) => x.y)) - 16, Math.max(...between.map((x) => x.y + x.h)) + 16, ...between.map((x) => x.y + x.h + GAP_Y / 2)].filter(free);
      const base = gaps.sort((p, q) => Math.abs(p - want) - Math.abs(q - want))[0]!;
      const taken = lanes.filter((l) => Math.abs(l - base) < 5).length;
      lanes.push(base);
      // a second line through the same gap sits beside the first, not on it
      e.via = { y: base + (taken ? (taken % 2 ? 1 : -1) * 7 * Math.ceil(taken / 2) : 0), x1: Math.min(...between.map((x) => x.x)), x2: Math.max(...between.map((x) => x.x + x.w)) };
    }
    return [e];
  });
  const loops = edges.some((e) => e.a.side === "right");
  return { width: 2 * PAD + columns.length * w + Math.max(0, columns.length - 1) * GAP_X + (loops ? 60 : 0), height: tallest + 2 * EDGE, boxes: [...boxes.values()], edges };
}

export type DataModelView = { runId: string } & ({ none: string } | {
  /** where this model comes from: the plan, the approved model in the repo, or the database the untouched code creates */ source: "plan" | "repo" | "database";
  /** an existing backend: tables the plan adds or changes sit among ones that stay as they are (how many of each) */
  existing?: { added: number; changed: number; unchanged: number };
  /** true once the plan holding it was approved */ approved: boolean;
  note: string; layout: ErdLayout; summary: string[]; mermaid: string; file: string;
  tables: number; relations: number; joins: { table: string; between: [string, string] }[];
  /** the last comparison of the built database with the model, once a build was checked */
  built?: { matches: boolean; step: string; details: string };
});

/** The run's data model: the plan's as soon as the plan exists (approved or not), before that the one in the repo, if any. */
export function dataModelView(ledger: Ledger): DataModelView {
  const s = replay(ledger.events());
  const runId = ledger.runId;
  let stack = "";
  try { stack = loadProject(s.info.project).stack; } catch { /* a run whose project config is gone still shows what its ledger has */ }
  if (stack === "node") return { runId, none: "This run builds a web app, which stores nothing of its own. The data model is on the product's API run." };
  // the newest check of a built database against the model: integrate's (the whole model) when it ran, else the last task's
  const checks = s.gates.filter((g) => g.gateId === "data-model.matches");
  const last = [...checks].reverse().find((g) => g.step === "integrate") ?? checks[checks.length - 1];
  const details = last ? String((ledger.events().find((e) => e.seq === last.seq)?.data as { details?: string } | undefined)?.details ?? "") : "";
  const built = last ? { built: { matches: last.passed, step: String(last.step ?? ""), details } } : {};
  const shown = (model: DataModel, source: "plan" | "repo" | "database", approved: boolean, note: string): DataModelView => ({
    runId, source, approved, note, ...(counts(model).unchanged ? { existing: counts(model) } : {}), layout: erdLayout(model), summary: dataModelSummary(model), mermaid: erdMermaid(model), file: DATA_MODEL_FILE,
    tables: model.tables.length, relations: relationsOf(model).length, joins: joinTables(model), ...built,
  });
  const plan = s.steps.get("plan");
  const planDone = plan?.status === "completed" && !!plan.outputs[0];
  if (planDone) {
    try {
      const m = DataModel.safeParse(ledger.getJson<{ dataModel?: unknown }>(plan!.outputs[0]!).dataModel);
      if (m.success && m.data.tables.length && !dataModelProblems(m.data).length) {
        const approved = s.steps.get("approve")?.status === "completed";
        const c = counts(m.data);
        const whole = c.unchanged ? ` The whole database is shown: ${c.added} table${c.added === 1 ? "" : "s"} added, ${c.changed} changed, ${c.unchanged} as ${c.unchanged === 1 ? "it was" : "they were"}.` : "";
        return shown(m.data, "plan", approved, (approved
          ? "Approved with the plan and locked with the tests. The built database is compared with it."
          : "From the plan, not approved yet. It is on the approval card; ask for changes there.") + whole);
      }
    } catch { /* an unreadable plan: fall through to the repo's model */ }
  }
  const { repoPath, baseCommit } = s.info;
  const text = repoPath && baseCommit ? gitSource(repoPath, baseCommit).read(DATA_MODEL_FILE) : undefined;
  if (text) {
    try {
      const m = DataModel.safeParse(parse(text));
      if (m.success && m.data.tables.length) return shown(m.data, "repo", true, planDone
        ? "This change touches no stored data, so its plan has no data model. This is the product's current model, from the repo."
        : "The plan is not written yet. This is the product's current model, from the repo; the plan's model replaces it here as soon as the plan exists.");
    } catch { /* not a model the page can draw */ }
  }
  // an existing backend with no approved model in its repo: the database the untouched code creates, as discover read it
  const read = DataModel.safeParse(readOutput<{ model?: unknown }>(s, ledger, "discover", "schema")?.model);
  if (read.success && read.data.tables.length) {
    return shown(read.data, "database", true, planDone
      ? "This change touches no stored data, so its plan has no data model. This is the database as it is now, read from the tables the untouched code creates."
      : "The plan is not written yet. This is the database as it is now, read from the tables the untouched code creates; the plan's changes are marked here as soon as the plan exists.");
  }
  return { runId, none: planDone ? "This run's plan has no data model: the change touches no stored data." : "No data model yet. It appears here as soon as the plan is written, before you approve it." };
}
