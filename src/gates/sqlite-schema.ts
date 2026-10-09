// The tables, keys and foreign keys of a SQLite database file, as a data model the approved one can be compared with.
// Read with Node's own SQLite (no package, no model). Column types come back as SQLite stores them (text, whole number,
// number), which says little about what the code meant, so the comparison never looks at them.
import { createRequire } from "node:module";
import { closeSync, openSync, readSync } from "node:fs";
import type { DataModel } from "../contracts/index.js";

interface Db { prepare(sql: string): { all(): Record<string, unknown>[] }; close(): void }

/** True for a file that starts as a SQLite database does. */
export function isSqliteFile(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    try { const b = Buffer.alloc(16); return readSync(fd, b, 0, 16, 0) === 16 && b.toString("latin1") === "SQLite format 3\0"; } finally { closeSync(fd); }
  } catch { return false; }
}

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
const typeOf = (declared: string): "long" | "decimal" | "string" => (/INT/i.test(declared) ? "long" : /REAL|FLOA|DOUB|NUM|DEC/i.test(declared) ? "decimal" : "string");
const ON_DELETE: Record<string, "cascade" | "restrict" | "set-null"> = { CASCADE: "cascade", RESTRICT: "restrict", "NO ACTION": "restrict", "SET NULL": "set-null" };

/** The database's own tables (not SQLite's bookkeeping, not the migrations history) with their keys. */
export function sqliteModel(file: string): DataModel {
  // loaded here, not at the top: Node prints a one-time notice when its SQLite is first used, and most commands never read a database
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Db };
  const db = new DatabaseSync(file);
  try {
    const names = db.prepare("select name from sqlite_master where type = 'table' order by rowid").all().map((r) => String(r.name))
      .filter((n) => !/^sqlite_/i.test(n) && !/^__EFMigrations(History|Lock)$/.test(n));
    return { tables: names.map((name) => {
      const fks = db.prepare(`pragma foreign_key_list(${quoted(name)})`).all();
      const indexes = db.prepare(`pragma index_list(${quoted(name)})`).all().filter((i) => Number(i.unique) === 1 && i.origin !== "pk")
        .map((i) => db.prepare(`pragma index_info(${quoted(String(i.name))})`).all().map((c) => String(c.name)));
      const columns = db.prepare(`pragma table_info(${quoted(name)})`).all().map((c) => {
        const fk = fks.find((f) => String(f.from) === String(c.name));
        const onDelete = fk ? ON_DELETE[String(fk.on_delete).toUpperCase()] : undefined;
        return {
          name: String(c.name), type: typeOf(String(c.type ?? "")),
          // a primary-key column is never empty, whatever its declaration says
          required: Number(c.notnull) === 1 || Number(c.pk) > 0,
          ...(Number(c.pk) > 0 ? { pk: true } : {}),
          ...(indexes.some((i) => i.length === 1 && i[0] === String(c.name)) ? { unique: true } : {}),
          // a foreign key with no column named points at the other table's primary key
          ...(fk ? { references: { table: String(fk.table), column: String(fk.to ?? "") || pkOf(db, String(fk.table)), ...(onDelete ? { onDelete } : {}) } } : {}),
        };
      });
      return { name, purpose: "", change: "new" as const, columns, uniques: indexes.filter((i) => i.length > 1) };
    }) };
  } finally { db.close(); }
}

function pkOf(db: Db, table: string): string {
  return String(db.prepare(`pragma table_info(${quoted(table)})`).all().find((c) => Number(c.pk) > 0)?.name ?? "");
}
