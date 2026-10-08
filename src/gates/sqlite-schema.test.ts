import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DataModel } from "../contracts/index.js";
import { dataModelDiff } from "./data-model.js";
import { isSqliteFile, sqliteModel } from "./sqlite-schema.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } };

function database(sql: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "factory-sqlite-")), "app.db");
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  return file;
}

// as Entity Framework writes a schema: quoted names, a named constraint per key, an index per foreign key
const EF = `
CREATE TABLE "__EFMigrationsHistory" ("MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY, "ProductVersion" TEXT NOT NULL);
CREATE TABLE "Instructors" ("Id" INTEGER NOT NULL CONSTRAINT "PK_Instructors" PRIMARY KEY AUTOINCREMENT, "Email" TEXT NOT NULL, "Bio" TEXT NULL);
CREATE UNIQUE INDEX "IX_Instructors_Email" ON "Instructors" ("Email");
CREATE TABLE "Sessions" ("Id" INTEGER NOT NULL CONSTRAINT "PK_Sessions" PRIMARY KEY AUTOINCREMENT, "InstructorId" INTEGER NULL, "StartsAt" TEXT NOT NULL,
  CONSTRAINT "FK_Sessions_Instructors_InstructorId" FOREIGN KEY ("InstructorId") REFERENCES "Instructors" ("Id") ON DELETE SET NULL);
CREATE INDEX "IX_Sessions_InstructorId" ON "Sessions" ("InstructorId");
CREATE TABLE "Bookings" ("Id" INTEGER NOT NULL CONSTRAINT "PK_Bookings" PRIMARY KEY AUTOINCREMENT, "SessionId" INTEGER NOT NULL, "Member" TEXT NOT NULL, "RowVersion" INTEGER NOT NULL,
  CONSTRAINT "FK_Bookings_Sessions_SessionId" FOREIGN KEY ("SessionId") REFERENCES "Sessions" ("Id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "IX_Bookings_SessionId_Member" ON "Bookings" ("SessionId", "Member");`;

const col = (name: string, type: string, x: Record<string, unknown> = {}) => ({ name, type, required: true, ...x });
const PLANNED = DataModel.parse({ tables: [
  { name: "Instructors", purpose: "", columns: [col("Id", "long", { pk: true }), col("Email", "string", { unique: true }), col("Bio", "text", { required: false })] },
  { name: "Sessions", purpose: "", columns: [col("Id", "long", { pk: true }), col("InstructorId", "long", { required: false, references: { table: "Instructors", column: "Id", onDelete: "set-null" } }), col("StartsAt", "datetime")] },
  { name: "Bookings", purpose: "", uniques: [["SessionId", "Member"]], columns: [col("Id", "long", { pk: true }), col("SessionId", "long", { references: { table: "Sessions", column: "Id", onDelete: "cascade" } }), col("Member", "string")] },
] });

describe("reading a SQLite database's schema", () => {
  it("reads tables, primary keys, unique keys and foreign keys as Entity Framework writes them, and leaves out the bookkeeping tables", () => {
    const built = sqliteModel(database(EF));
    expect(DataModel.safeParse(built).success).toBe(true);
    expect(built.tables.map((t) => t.name)).toEqual(["Instructors", "Sessions", "Bookings"]);
    const [instructors, sessions, bookings] = built.tables;
    expect(instructors!.columns).toEqual([{ name: "Id", type: "long", required: true, pk: true }, { name: "Email", type: "string", required: true, unique: true }, { name: "Bio", type: "string", required: false }]);
    expect(sessions!.columns[1]).toEqual({ name: "InstructorId", type: "long", required: false, references: { table: "Instructors", column: "Id", onDelete: "set-null" } });
    expect(bookings!.uniques).toEqual([["SessionId", "Member"]]);
    // against the approved model: nothing differs, and the code's own column is only reported
    expect(dataModelDiff(PLANNED, built)).toEqual({ differences: [], extra: ["Bookings.RowVersion is in the database but not in the model"] });
  });

  it("shows a dropped foreign key, a missing unique key and a table the model does not have", () => {
    const built = sqliteModel(database(EF.replace(/,\s*CONSTRAINT "FK_Bookings[^;]*\);/, ");").replace(/CREATE UNIQUE INDEX "IX_Instructors_Email"[^;]*;/, "") + `CREATE TABLE "Audit" ("Id" INTEGER PRIMARY KEY);`));
    expect(dataModelDiff(PLANNED, built).differences).toEqual([
      "Instructors.Email: the model has it unique, the database does not",
      "Bookings.SessionId: the model points it at Sessions.Id, the database has no foreign key there",
      "Table Audit is in the database but not in the model",
    ]);
  });

  it("tells a SQLite file from any other", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-sqlite-"));
    writeFileSync(join(dir, "notes.db"), "not a database");
    expect(isSqliteFile(join(dir, "notes.db"))).toBe(false);
    expect(isSqliteFile(join(dir, "missing.db"))).toBe(false);
    expect(isSqliteFile(database(`CREATE TABLE "T" ("Id" INTEGER PRIMARY KEY);`))).toBe(true);
  });
});
