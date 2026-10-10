// A backend's data model (tables, columns, keys), written at plan time and approved on the plan card: what is wrong with one,
// its relations, the entity-relationship diagram drawn from it, and how a built database differs from it. Pure code: no model.
import { stringify } from "yaml";
import type { DataColumn, DataModel, DataTable } from "../contracts/index.js";

export const DATA_MODEL_FILE = "contracts/data-model.yaml";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const tableOf = (m: DataModel, name: string) => m.tables.find((t) => same(t.name, name));
const columnOf = (t: DataTable, name: string) => t.columns.find((c) => same(c.name, name));
const pkOf = (t: DataTable) => t.columns.filter((c) => c.pk);
/** a column no two rows share: the whole primary key, or marked unique */
const isKey = (t: DataTable, c: DataColumn) => !!c.unique || (!!c.pk && pkOf(t).length === 1);

/** What is wrong with a data model, in words its writer can act on. Empty when it is sound. */
export function dataModelProblems(m: DataModel): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of m.tables) {
    const key = t.name.toLowerCase();
    if (seen.has(key)) out.push(`Table ${t.name} is listed twice`);
    seen.add(key);
    // a table the plan leaves as it is is the backend's own: what is odd about it is not the plan's to fix
    if (t.change === "unchanged") continue;
    const cols = new Set<string>();
    for (const c of t.columns) {
      if (cols.has(c.name.toLowerCase())) out.push(`${t.name}.${c.name} is listed twice`);
      cols.add(c.name.toLowerCase());
      if (c.pk && !c.required) out.push(`${t.name}.${c.name} is part of the primary key, so it cannot be optional`);
      if (c.type === "enum" && !c.values?.length) out.push(`${t.name}.${c.name} is an enum with no values`);
      if (c.references) {
        const target = tableOf(m, c.references.table);
        const col = target && columnOf(target, c.references.column);
        if (!target) out.push(`${t.name}.${c.name} points at table ${c.references.table}, which is not in the model`);
        else if (!col) out.push(`${t.name}.${c.name} points at ${target.name}.${c.references.column}, which is not a column of that table`);
        else {
          if (!isKey(target, col)) out.push(`${t.name}.${c.name} points at ${target.name}.${col.name}, which is not that table's primary key or a unique column`);
          if (col.type !== c.type) out.push(`${t.name}.${c.name} is ${c.type} but points at ${target.name}.${col.name}, which is ${col.type}`);
        }
        if (c.references.onDelete === "set-null" && c.required) out.push(`${t.name}.${c.name} is required, so it cannot be emptied when the row it points at is deleted (onDelete set-null)`);
      }
    }
    if (!pkOf(t).length) out.push(`Table ${t.name} has no primary key`);
    for (const u of t.uniques) for (const n of u) if (!columnOf(t, n)) out.push(`Table ${t.name} has a unique key over ${n}, which is not one of its columns`);
  }
  return out;
}

export interface Relation {
  /** the table holding the foreign key, and the column */ from: string; column: string;
  /** the table it points at, and the column */ to: string; toColumn: string;
  kind: "one-to-one" | "many-to-one";
  /** false when the foreign key may be empty */ required: boolean;
  onDelete?: "cascade" | "restrict" | "set-null";
}

/** Every foreign key as a relation; one to one when the key column is itself unique. */
export function relationsOf(m: DataModel): Relation[] {
  return m.tables.flatMap((t) => t.columns.filter((c) => c.references).map((c) => ({
    from: t.name, column: c.name, to: tableOf(m, c.references!.table)?.name ?? c.references!.table, toColumn: c.references!.column,
    kind: isKey(t, c) ? "one-to-one" as const : "many-to-one" as const, required: c.required,
    ...(c.references!.onDelete ? { onDelete: c.references!.onDelete } : {}),
  })));
}

/** Tables that only join two others (every primary-key column is a foreign key, to two tables): a many-to-many relation. */
export function joinTables(m: DataModel): { table: string; between: [string, string] }[] {
  return m.tables.flatMap((t) => {
    const pk = pkOf(t);
    const targets = [...new Set(pk.filter((c) => c.references).map((c) => c.references!.table))];
    return pk.length >= 2 && pk.every((c) => c.references) && targets.length === 2 ? [{ table: t.name, between: [targets[0]!, targets[1]!] as [string, string] }] : [];
  });
}

/**
 * An existing backend's whole model: the database as it is now (read from what the untouched code creates) with the plan's
 * tables laid over it. The plan states only what it adds or changes; whether a table is new, changed or unchanged is worked
 * out here by comparing, not taken from the plan's word. A table the plan marks unchanged is kept exactly as the database has it.
 */
export function mergeDataModel(existing: DataModel, planned: DataModel | undefined): DataModel {
  const stated = planned?.tables ?? [];
  const asIs = new Set<string>();
  const tables: DataTable[] = existing.tables.map((e) => {
    const p = stated.find((t) => same(t.name, e.name));
    if (!p || p.change === "unchanged") { asIs.add(e.name.toLowerCase()); return { ...structuredClone(e), purpose: p?.purpose || e.purpose, change: "unchanged" as const }; }
    const d = dataModelDiff({ tables: [p] }, { tables: [e] });
    return { ...structuredClone(p), name: e.name, change: d.differences.length || d.extra.length ? "changed" as const : "unchanged" as const };
  });
  for (const p of stated) if (!tableOf(existing, p.name)) tables.push({ ...structuredClone(p), change: "new" });
  // a database says little about a column's type (a number, some text): where a foreign key joins a table read from the database
  // and one the plan wrote, the plan's type stands on both ends
  const m = { tables };
  for (const t of tables) for (const c of t.columns) {
    const target = c.references && tableOf(m, c.references.table);
    const col = target && columnOf(target, c.references!.column);
    if (!col || col.type === c.type) continue;
    const mine = asIs.has(t.name.toLowerCase()), theirs = asIs.has(target!.name.toLowerCase());
    if (theirs && !mine) col.type = c.type;
    else if (mine && !theirs) c.type = col.type;
  }
  return m;
}

/** The database as read, with what an approved model in the repo knows better: each table's purpose, column types, enum values. */
export function withKnown(existing: DataModel, known: DataModel | undefined): DataModel {
  if (!known) return existing;
  return { tables: existing.tables.map((e) => {
    const k = tableOf(known, e.name);
    if (!k) return e;
    return { ...e, purpose: e.purpose || k.purpose, columns: e.columns.map((c) => {
      const kc = columnOf(k, c.name);
      return kc ? { ...c, type: kc.type, ...(kc.values?.length ? { values: kc.values } : {}) } : c;
    }) };
  }) };
}

/**
 * The part of a model a person approving a change needs in front of them: the tables the plan adds or changes and the tables
 * joined to those by a foreign key, either way. A model with nothing unchanged (a new product) is returned whole. `others` is
 * how many tables are left out; a foreign key to one of them is left out with it.
 */
export function nearModel(m: DataModel): { model: DataModel; others: number } {
  const touched = m.tables.filter((t) => t.change !== "unchanged");
  if (!touched.length || touched.length === m.tables.length) return { model: m, others: 0 };
  const near = new Set(touched.map((t) => t.name.toLowerCase()));
  for (const t of touched) for (const c of t.columns) if (c.references) near.add(c.references.table.toLowerCase());
  for (const t of m.tables) if (t.columns.some((c) => c.references && touched.some((x) => same(x.name, c.references!.table)))) near.add(t.name.toLowerCase());
  const tables = m.tables.filter((t) => near.has(t.name.toLowerCase())).map((t) => ({
    ...t, columns: t.columns.map((c) => { if (!c.references || near.has(c.references.table.toLowerCase())) return c; const { references: _r, ...rest } = c; return rest; }),
  }));
  return { model: { tables }, others: m.tables.length - tables.length };
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies|es|s)$/, "");

/**
 * The database as it is now, for the planner: every table with its columns and keys while the database is small; in a big one,
 * the tables the change is about (`focus`: the stored data the impact step found) and their neighbours in full, the rest by
 * name, primary key and the tables they point at.
 */
export function dataModelBrief(m: DataModel, focus: string[], fullLimit = 30): string[] {
  const line = (t: DataTable) => `${t.name}: ${[...t.columns.map((c) => `${c.name} ${c.type}${keysOf(c).length ? ` [${keysOf(c).join(", ")}]` : ""}${c.required ? "" : "?"}${c.references ? ` → ${c.references.table}.${c.references.column}` : ""}`), ...t.uniques.map((u) => `unique (${u.join(", ")})`)].join(", ")}`;
  if (m.tables.length <= fullLimit) return m.tables.map(line);
  const wanted = focus.map(plain).filter(Boolean);
  const hit = new Set(m.tables.filter((t) => wanted.some((w) => w.includes(plain(t.name)) || plain(t.name).includes(w))).map((t) => t.name.toLowerCase()));
  const full = new Set(hit);
  for (const t of m.tables) for (const c of t.columns) if (c.references) {
    if (hit.has(t.name.toLowerCase())) full.add(c.references.table.toLowerCase());
    if (hit.has(c.references.table.toLowerCase())) full.add(t.name.toLowerCase());
  }
  return m.tables.map((t) => {
    if (full.has(t.name.toLowerCase())) return line(t);
    const to = [...new Set(t.columns.flatMap((c) => (c.references ? [c.references.table] : [])))];
    return `${t.name}: key ${pkOf(t).map((c) => c.name).join(", ") || "none"}${to.length ? `; points at ${to.join(", ")}` : ""} (${t.columns.length} columns; read its entity for the rest)`;
  });
}

const keysOf = (c: DataColumn) => [c.pk ? "PK" : "", c.references ? "FK" : "", c.unique && !c.pk ? "UK" : ""].filter(Boolean);
const word = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

/** The model as a Mermaid entity-relationship diagram (GitHub draws it in a pull request, the web page draws its own). */
export function erdMermaid(m: DataModel): string {
  const lines = ["erDiagram"];
  for (const r of relationsOf(m)) {
    // parent side: exactly one, or zero or one when the key may be empty; child side: zero or one (one to one), or zero or many
    lines.push(`  ${word(r.to)} ${r.required ? "||" : "|o"}--${r.kind === "one-to-one" ? "o|" : "o{"} ${word(r.from)} : "${r.column}"`);
  }
  for (const t of m.tables) {
    lines.push(`  ${word(t.name)} {`);
    for (const c of t.columns) {
      const keys = keysOf(c).join(", ");
      const note = [c.required ? "" : "optional", c.values?.length ? c.values.join(" | ") : ""].filter(Boolean).join("; ");
      lines.push(`    ${c.type} ${word(c.name)}${keys ? ` ${keys}` : ""}${note ? ` "${note.replace(/"/g, "'")}"` : ""}`);
    }
    lines.push("  }");
  }
  return lines.join("\n");
}

/** The model in a few plain lines per table, for a card: columns with their keys, then the relations. */
export function dataModelSummary(m: DataModel): string[] {
  const out = m.tables.map((t) => {
    const cols = t.columns.map((c) => `${c.name} ${c.type}${keysOf(c).length ? ` [${keysOf(c).join(", ")}]` : ""}${c.required ? "" : "?"}`);
    const uniques = t.uniques.map((u) => `unique (${u.join(", ")})`);
    return `**${t.name}**${t.change === "new" ? "" : ` (${t.change})`}: ${[...cols, ...uniques].join(", ")}`;
  });
  const joins = joinTables(m);
  const rel = relationsOf(m).map((r) => `${r.from}.${r.column} → ${r.to}.${r.toColumn} (${r.kind === "one-to-one" ? "one to one" : `many ${r.from} to one ${r.to}`}${r.required ? "" : ", optional"}${r.onDelete ? `, on delete ${r.onDelete}` : ""})`);
  return [...out, ...rel, ...joins.map((j) => `${j.table} joins ${j.between[0]} and ${j.between[1]} (many to many)`)];
}

/** The file kept in the repo beside the API contract. */
export function dataModelYaml(m: DataModel): string {
  return `# The approved data model: tables, columns and keys. Written by the factory from the approved plan; the built database is compared with it.\n${stringify(m)}`;
}

/**
 * How a built database differs from the approved model. Tables, keys and relations are held strictly; a column the model does
 * not name is reported apart (`extra`) and does not fail the build, since code may add its own bookkeeping columns.
 */
export function dataModelDiff(planned: DataModel, built: DataModel): { differences: string[]; extra: string[] } {
  const differences: string[] = [], extra: string[] = [];
  for (const t of planned.tables) {
    const b = tableOf(built, t.name);
    if (!b) { differences.push(`Table ${t.name} is in the model but not in the database`); continue; }
    for (const c of t.columns) {
      const bc = columnOf(b, c.name);
      if (!bc) { differences.push(`${t.name}.${c.name} is in the model but not in the database`); continue; }
      if (!!c.pk !== !!bc.pk) differences.push(`${t.name}.${c.name}: the model ${c.pk ? "has it in" : "leaves it out of"} the primary key, the database does not`);
      if (isKey(t, c) && !isKey(b, bc)) differences.push(`${t.name}.${c.name}: the model has it unique, the database does not`);
      if (c.required !== bc.required) differences.push(`${t.name}.${c.name}: the model has it ${c.required ? "required" : "optional"}, the database ${bc.required ? "required" : "optional"}`);
      const want = c.references, got = bc.references;
      if (want && !got) differences.push(`${t.name}.${c.name}: the model points it at ${want.table}.${want.column}, the database has no foreign key there`);
      else if (want && got && (!same(want.table, got.table) || !same(want.column, got.column))) differences.push(`${t.name}.${c.name}: the model points it at ${want.table}.${want.column}, the database at ${got.table}.${got.column}`);
      else if (!want && got) differences.push(`${t.name}.${c.name}: the database has a foreign key to ${got.table}.${got.column} that the model does not`);
    }
    for (const u of t.uniques) {
      const has = b.uniques.some((x) => x.length === u.length && u.every((n) => x.some((y) => same(y, n))));
      if (!has) differences.push(`Table ${t.name}: the model has a unique key over (${u.join(", ")}), the database does not`);
    }
    for (const bc of b.columns) if (!columnOf(t, bc.name)) extra.push(`${t.name}.${bc.name} is in the database but not in the model`);
  }
  for (const b of built.tables) if (!tableOf(planned, b.name)) differences.push(`Table ${b.name} is in the database but not in the model`);
  return { differences, extra };
}
