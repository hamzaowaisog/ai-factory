import { describe, it, expect } from "vitest";
import { DataModel } from "../contracts/index.js";
import { dataModelBrief, dataModelDiff, dataModelProblems, dataModelSummary, dataModelYaml, erdMermaid, joinTables, mergeDataModel, nearModel, relationsOf, withKnown } from "./data-model.js";
import { parse } from "yaml";

const col = (name: string, type: string, over: Record<string, unknown> = {}) => ({ name, type, required: true, ...over });
const model = (tables: { name: string; columns: unknown[]; uniques?: string[][]; change?: string; purpose?: string }[]) => DataModel.parse({ tables: tables.map((t) => ({ purpose: "", ...t })) });

const studio = () => model([
  { name: "Instructor", columns: [col("id", "int", { pk: true }), col("name", "string")] },
  { name: "Session", columns: [col("id", "int", { pk: true }), col("instructorId", "int", { references: { table: "Instructor", column: "id" } }), col("status", "enum", { values: ["open", "cancelled"] })] },
  { name: "Booking", columns: [col("id", "int", { pk: true }), col("sessionId", "int", { references: { table: "Session", column: "id", onDelete: "cascade" } }), col("memberId", "int"), col("undoOf", "int", { required: false, unique: true, references: { table: "Booking", column: "id" } })], uniques: [["sessionId", "memberId"]] },
]);

describe("data model", () => {
  it("finds nothing wrong with a sound model", () => {
    expect(dataModelProblems(studio())).toEqual([]);
  });

  it("names what is wrong in words the planner can act on", () => {
    const bad = model([
      { name: "A", columns: [col("id", "int", { pk: true, required: false }), col("id", "int"), col("kind", "enum"), col("bId", "int", { references: { table: "B", column: "id" } }), col("cId", "string", { references: { table: "C", column: "name" } }), col("dId", "int", { references: { table: "C", column: "nope" } })], uniques: [["bId", "gone"]] },
      { name: "C", columns: [col("id", "int"), col("name", "string")] },
      { name: "a", columns: [col("id", "uuid", { pk: true })] },
    ]);
    const p = dataModelProblems(bad);
    expect(p).toContain("A.id is part of the primary key, so it cannot be optional");
    expect(p).toContain("A.id is listed twice");
    expect(p).toContain("A.kind is an enum with no values");
    expect(p).toContain("A.bId points at table B, which is not in the model");
    expect(p).toContain("A.cId points at C.name, which is not that table's primary key or a unique column");
    expect(p).toContain("A.dId points at C.nope, which is not a column of that table");
    expect(p).toContain("Table A has a unique key over gone, which is not one of its columns");
    expect(p).toContain("Table C has no primary key");
    expect(p).toContain("Table a is listed twice");
    const types = model([{ name: "P", columns: [col("id", "uuid", { pk: true })] }, { name: "Q", columns: [col("id", "int", { pk: true }), col("pId", "int", { references: { table: "P", column: "id", onDelete: "set-null" } })] }]);
    expect(dataModelProblems(types)).toEqual(["Q.pId is int but points at P.id, which is uuid", "Q.pId is required, so it cannot be emptied when the row it points at is deleted (onDelete set-null)"]);
  });

  it("reads each foreign key as a relation, one to one when the key column is unique", () => {
    const r = relationsOf(studio());
    expect(r.map((x) => [x.from, x.column, x.to, x.kind, x.required])).toEqual([
      ["Session", "instructorId", "Instructor", "many-to-one", true],
      ["Booking", "sessionId", "Session", "many-to-one", true],
      ["Booking", "undoOf", "Booking", "one-to-one", false],
    ]);
    expect(r[1]!.onDelete).toBe("cascade");
    const tags = model([
      { name: "Post", columns: [col("id", "int", { pk: true })] }, { name: "Tag", columns: [col("id", "int", { pk: true })] },
      { name: "PostTag", columns: [col("postId", "int", { pk: true, references: { table: "Post", column: "id" } }), col("tagId", "int", { pk: true, references: { table: "Tag", column: "id" } })] },
    ]);
    expect(dataModelProblems(tags)).toEqual([]);
    expect(joinTables(tags)).toEqual([{ table: "PostTag", between: ["Post", "Tag"] }]);
    expect(joinTables(studio())).toEqual([]);
  });

  it("draws the diagram with keys marked and each relation's kind", () => {
    const d = erdMermaid(studio());
    expect(d.split("\n")[0]).toBe("erDiagram");
    expect(d).toContain('  Instructor ||--o{ Session : "instructorId"');
    expect(d).toContain('  Booking |o--o| Booking : "undoOf"');
    expect(d).toContain("    int id PK");
    expect(d).toContain("    int sessionId FK");
    expect(d).toContain('    int undoOf FK, UK "optional"');
    expect(d).toContain('    enum status "open | cancelled"');
  });

  it("sums the model up for a card and writes the repo file", () => {
    const s = dataModelSummary(studio());
    expect(s[2]).toBe("**Booking**: id int [PK], sessionId int [FK], memberId int, undoOf int [FK, UK]?, unique (sessionId, memberId)");
    expect(s).toContain("Booking.sessionId → Session.id (many Booking to one Session, on delete cascade)");
    expect(s).toContain("Booking.undoOf → Booking.id (one to one, optional)");
    const y = dataModelYaml(studio());
    expect(DataModel.parse(parse(y))).toEqual(studio());
  });

  it("compares a built database with the model: strict on tables, keys and relations, lenient on extra columns", () => {
    expect(dataModelDiff(studio(), studio())).toEqual({ differences: [], extra: [] });
    const built = model([
      { name: "instructor", columns: [col("ID", "int", { pk: true }), col("name", "string"), col("createdAt", "datetime")] },
      { name: "Session", columns: [col("id", "int", { pk: true }), col("instructorId", "int", { required: false }), col("status", "string")] },
      { name: "Booking", columns: [col("id", "int", { pk: true }), col("sessionId", "int", { references: { table: "Instructor", column: "id" } }), col("undoOf", "int", { required: false, references: { table: "Booking", column: "id" } })] },
      { name: "Audit", columns: [col("id", "int", { pk: true })] },
    ]);
    const d = dataModelDiff(studio(), built);
    expect(d.extra).toEqual(["Instructor.createdAt is in the database but not in the model"]);
    expect(d.differences).toEqual([
      "Session.instructorId: the model has it required, the database optional",
      "Session.instructorId: the model points it at Instructor.id, the database has no foreign key there",
      "Booking.sessionId: the model points it at Session.id, the database at Instructor.id",
      "Booking.memberId is in the model but not in the database",
      "Booking.undoOf: the model has it unique, the database does not",
      "Table Booking: the model has a unique key over (sessionId, memberId), the database does not",
      "Table Audit is in the database but not in the model",
    ]);
  });
});

describe("an existing backend's model: the plan's tables over the database as it is", () => {
  // as a database reader returns it: every table "new", coarse types
  const db = () => model([
    { name: "Users", columns: [col("Id", "long", { pk: true }), col("Email", "string", { unique: true })] },
    { name: "Orders", columns: [col("Id", "long", { pk: true }), col("UserId", "long", { references: { table: "Users", column: "Id" } }), col("Total", "decimal")] },
    { name: "Audit", columns: [col("Id", "long", { pk: true }), col("What", "string")] },
    { name: "Keyless", columns: [col("Line", "string")] },
  ]);

  it("marks each table by comparing: new, changed, unchanged, whatever the plan called it", () => {
    const planned = model([
      // called new by the plan, though it exists: one column added
      { name: "orders", columns: [col("Id", "int", { pk: true }), col("UserId", "int", { references: { table: "Users", column: "Id" } }), col("Total", "decimal"), col("Note", "text", { required: false })] },
      // restated in full with nothing different
      { name: "Audit", change: "changed", columns: [col("Id", "int", { pk: true }), col("What", "string")] },
      { name: "Refunds", columns: [col("Id", "int", { pk: true }), col("OrderId", "int", { references: { table: "Orders", column: "Id" } })] },
    ]);
    const m = mergeDataModel(db(), planned);
    expect(m.tables.map((t) => `${t.name} ${t.change}`)).toEqual(["Users unchanged", "Orders changed", "Audit unchanged", "Keyless unchanged", "Refunds new"]);
    // the plan's type stands on both ends of a foreign key into a table read from the database
    expect(m.tables[0]!.columns[0]!.type).toBe("int");
    // a table of the backend's own with no primary key is not the plan's problem
    expect(dataModelProblems(m)).toEqual([]);
    // the merge of a merged model is itself: a patched plan is merged again
    expect(mergeDataModel(db(), m).tables.map((t) => `${t.name} ${t.change}`)).toEqual(m.tables.map((t) => `${t.name} ${t.change}`));
    // no plan tables: the database as it is
    expect(mergeDataModel(db(), undefined).tables.every((t) => t.change === "unchanged")).toBe(true);
  });

  it("keeps a table the plan marks unchanged exactly as the database has it, and a removed column makes a table changed", () => {
    const m = mergeDataModel(db(), model([
      { name: "Users", change: "unchanged", purpose: "who signs in", columns: [col("Id", "int", { pk: true })] },
      { name: "Audit", columns: [col("Id", "int", { pk: true })] },
    ]));
    expect(m.tables[0]).toMatchObject({ name: "Users", purpose: "who signs in", change: "unchanged" });
    expect(m.tables[0]!.columns.map((c) => c.name)).toEqual(["Id", "Email"]);
    expect(m.tables.find((t) => t.name === "Audit")!.change).toBe("changed");
  });

  it("takes purposes, types and enum values from the repo's approved model", () => {
    const known = model([{ name: "users", purpose: "who signs in", columns: [col("id", "uuid", { pk: true }), col("Email", "enum", { values: ["a", "b"] })] }]);
    const m = withKnown(db(), known);
    expect(m.tables[0]).toMatchObject({ purpose: "who signs in", columns: [{ name: "Id", type: "uuid" }, { name: "Email", type: "enum", values: ["a", "b"] }] });
    expect(withKnown(db(), undefined)).toEqual(db());
  });

  it("shows the card the touched tables and the ones joined to them, and counts the rest", () => {
    const m = mergeDataModel(db(), model([{ name: "Refunds", columns: [col("Id", "int", { pk: true }), col("OrderId", "int", { references: { table: "Orders", column: "Id" } })] }]));
    const near = nearModel(m);
    expect(near.model.tables.map((t) => t.name)).toEqual(["Orders", "Refunds"]);
    expect(near.others).toBe(3);
    // Orders points at Users, which is not shown: the line to it is left out with it
    expect(near.model.tables[0]!.columns.find((c) => c.name === "UserId")!.references).toBeUndefined();
    // a new product's model is shown whole
    expect(nearModel(studio())).toEqual({ model: studio(), others: 0 });
  });

  it("briefs the planner in full on a small database, and by name and key away from the change on a big one", () => {
    expect(dataModelBrief(db(), [])).toEqual([
      "Users: Id long [PK], Email string [UK]",
      "Orders: Id long [PK], UserId long [FK] → Users.Id, Total decimal",
      "Audit: Id long [PK], What string",
      "Keyless: Line string",
    ]);
    // a change that touches no stored data: one short line per table
    expect(dataModelBrief(db(), [], 0)[1]).toBe("Orders: key Id; points at Users (3 columns; read its entity for the rest)");
    const brief = dataModelBrief(db(), ["Order"], 2);
    expect(brief[0]).toBe("Users: Id long [PK], Email string [UK]");
    expect(brief[1]).toContain("Orders: Id long [PK]");
    expect(brief[2]).toBe("Audit: key Id (2 columns; read its entity for the rest)");
    expect(brief[3]).toBe("Keyless: key none (1 columns; read its entity for the rest)");
  });
});

describe("when a plan must give a data model", () => {
  it("asks on a new product's first backend build and when stored data is touched, never of a web app", async () => {
    const { needsDataModel } = await import("../stages/spec.js");
    expect(needsDataModel({ stack: "dotnet", contract: {} }, undefined, false)).toBe(true);
    // the product's backend already has its model: a change that touches no stored data need not give one
    expect(needsDataModel({ stack: "dotnet", contract: {} }, { entities: [] }, true)).toBe(false);
    expect(needsDataModel({ stack: "dotnet", contract: {} }, { entities: ["Booking"] }, true)).toBe(true);
    expect(needsDataModel({ stack: "dotnet" }, { entities: ["Order"] }, false)).toBe(true);
    expect(needsDataModel({ stack: "dotnet" }, { entities: [] }, false)).toBe(false);
    expect(needsDataModel({ stack: "node", contract: {} }, { entities: ["Order"] }, false)).toBe(false);
  });
});
