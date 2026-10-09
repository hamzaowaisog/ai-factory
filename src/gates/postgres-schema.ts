// The tables, keys and foreign keys of a PostgreSQL database, as a data model the approved one can be compared with: one
// catalogue query (run with psql inside the lab's database container) and the reading of its answer. Like the SQLite
// reader (sqlite-schema.ts), column types are kept coarse: the comparison never looks at them.
import type { DataModel } from "../contracts/index.js";

const cols = (key: string, rel: string) =>
  `(select json_agg(a.attname order by k.ord) from unnest(${key}) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.attnum)`;

/** One row, one column: a JSON document of the public schema's tables, columns, constraints and unique indexes. */
export const POSTGRES_SCHEMA_SQL = `select json_build_object(
  'columns', (select coalesce(json_agg(json_build_object('t', c.relname, 'c', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull) order by c.oid, a.attnum), '[]'::json)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped),
  'keys', (select coalesce(json_agg(json_build_object('t', c.relname, 'kind', con.contype, 'cols', ${cols("con.conkey", "con.conrelid")},
      'ref', f.relname, 'refcols', ${cols("con.confkey", "con.confrelid")}, 'del', con.confdeltype)), '[]'::json)
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace left join pg_class f on f.oid = con.confrelid
    where n.nspname = 'public' and con.contype in ('p', 'u', 'f')),
  'indexes', (select coalesce(json_agg(json_build_object('t', c.relname, 'cols', ${cols("i.indkey::int2[]", "i.indrelid")})), '[]'::json)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indisunique and not i.indisprimary and i.indpred is null)
)`;

interface Answer {
  columns: { t: string; c: string; type: string; notnull: boolean }[];
  keys: { t: string; kind: "p" | "u" | "f"; cols: string[] | null; ref: string | null; refcols: string[] | null; del: string }[];
  indexes: { t: string; cols: string[] | null }[];
}

const typeOf = (t: string): "long" | "decimal" | "string" | "bool" | "datetime" =>
  /^(small|big)?int|^integer|serial/i.test(t) ? "long" : /^(numeric|decimal|real|double|money)/i.test(t) ? "decimal" : /^bool/i.test(t) ? "bool" : /^(timestamp|date)/i.test(t) ? "datetime" : "string";
const ON_DELETE: Record<string, "cascade" | "restrict" | "set-null"> = { c: "cascade", r: "restrict", a: "restrict", n: "set-null" };

/** The database's own tables (not the migrations history) with their keys, from the answer of POSTGRES_SCHEMA_SQL. */
export function postgresModel(answer: string): DataModel {
  const a = JSON.parse(answer) as Answer;
  const names = [...new Set(a.columns.map((c) => c.t))].filter((n) => !/^__EFMigrations(History|Lock)$/.test(n));
  return { tables: names.map((name) => {
    const keys = a.keys.filter((k) => k.t === name);
    const pk = keys.find((k) => k.kind === "p")?.cols ?? [];
    // a unique key is a constraint or a unique index over whole columns; one over an expression names no column and is left out
    const uniques = [...keys.filter((k) => k.kind === "u").map((k) => k.cols ?? []), ...a.indexes.filter((i) => i.t === name).map((i) => i.cols ?? [])]
      .filter((u, i, all) => u.length > 0 && all.findIndex((o) => o.join("\0") === u.join("\0")) === i);
    const columns = a.columns.filter((c) => c.t === name).map((c) => {
      // a foreign key over several columns is not something the model can say: only single-column ones are read
      const fk = keys.find((k) => k.kind === "f" && k.cols?.length === 1 && k.cols[0] === c.c && k.ref && k.refcols?.length === 1);
      const onDelete = fk ? ON_DELETE[fk.del] : undefined;
      return {
        name: c.c, type: typeOf(c.type), required: c.notnull || pk.includes(c.c),
        ...(pk.includes(c.c) ? { pk: true } : {}),
        ...(uniques.some((u) => u.length === 1 && u[0] === c.c) ? { unique: true } : {}),
        ...(fk ? { references: { table: fk.ref!, column: fk.refcols![0]!, ...(onDelete ? { onDelete } : {}) } } : {}),
      };
    });
    return { name, purpose: "", change: "new" as const, columns, uniques: uniques.filter((u) => u.length > 1) };
  }) };
}
