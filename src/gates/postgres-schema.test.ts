import { describe, expect, it } from "vitest";
import { dataModelDiff } from "./data-model.js";
import { postgresModel } from "./postgres-schema.js";

const answer = JSON.stringify({
  columns: [
    { t: "Instructors", c: "Id", type: "integer", notnull: true }, { t: "Instructors", c: "Email", type: "text", notnull: true },
    { t: "Bookings", c: "Id", type: "integer", notnull: true }, { t: "Bookings", c: "InstructorId", type: "integer", notnull: true },
    { t: "Bookings", c: "Day", type: "date", notnull: true }, { t: "Bookings", c: "Note", type: "character varying(200)", notnull: false },
    { t: "__EFMigrationsHistory", c: "MigrationId", type: "character varying(150)", notnull: true },
  ],
  keys: [
    { t: "Instructors", kind: "p", cols: ["Id"], ref: null, refcols: null, del: " " },
    { t: "Bookings", kind: "p", cols: ["Id"], ref: null, refcols: null, del: " " },
    { t: "Bookings", kind: "f", cols: ["InstructorId"], ref: "Instructors", refcols: ["Id"], del: "c" },
  ],
  // as EF Core writes them: unique indexes, not constraints
  indexes: [{ t: "Instructors", cols: ["Email"] }, { t: "Bookings", cols: ["InstructorId", "Day"] }],
});

describe("the tables and keys of a PostgreSQL database", () => {
  it("reads tables, primary keys, unique keys and foreign keys, and leaves the migrations history out", () => {
    const m = postgresModel(answer);
    expect(m.tables.map((t) => t.name)).toEqual(["Instructors", "Bookings"]);
    expect(m.tables[0]!.columns).toEqual([
      { name: "Id", type: "long", required: true, pk: true },
      { name: "Email", type: "string", required: true, unique: true },
    ]);
    const b = m.tables[1]!;
    expect(b.columns.find((c) => c.name === "InstructorId")).toMatchObject({ references: { table: "Instructors", column: "Id", onDelete: "cascade" } });
    expect(b.columns.find((c) => c.name === "Note")).toMatchObject({ required: false, type: "string" });
    expect(b.uniques).toEqual([["InstructorId", "Day"]]);
  });

  it("compares with an approved model as a SQLite database does", () => {
    const planned = postgresModel(answer);
    expect(dataModelDiff(planned, postgresModel(answer)).differences).toEqual([]);
    const noKey = JSON.parse(answer) as { keys: { kind: string }[] };
    noKey.keys = noKey.keys.filter((k) => k.kind !== "f");
    expect(dataModelDiff(planned, postgresModel(JSON.stringify(noKey))).differences.join("; ")).toMatch(/no foreign key there/);
  });

  it("reads an empty database as no tables", () => {
    expect(postgresModel('{"columns":[],"keys":[],"indexes":[]}').tables).toEqual([]);
  });
});
