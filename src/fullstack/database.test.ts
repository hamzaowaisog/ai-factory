import { describe, expect, it } from "vitest";
import { chooseDatabase, databaseOption } from "./database.js";

describe("the database of a new product's API", () => {
  it("takes a person's option before anything the request says", () => {
    expect(chooseDatabase("A demo of a to-do list", "postgres")).toMatchObject({ kind: "postgres", by: "option" });
    expect(chooseDatabase("Orders in production on PostgreSQL", "sqlite")).toMatchObject({ kind: "sqlite", by: "option" });
  });

  it("takes the database the request names", () => {
    expect(chooseDatabase("A to-do list. Store it in Postgres.")).toEqual({ kind: "postgres", reason: "The request names PostgreSQL.", by: "request" });
    expect(chooseDatabase("An orders app in production, on SQLite for now.")).toMatchObject({ kind: "sqlite", by: "request" });
    // both named: neither is a choice, so the words decide
    expect(chooseDatabase("A notes app. SQLite or Postgres, whichever fits.")).toMatchObject({ kind: "sqlite", by: "proposal" });
  });

  it("proposes SQLite when nothing asks for a server, and for something small or local", () => {
    expect(chooseDatabase("Staff sign in and see today's appointments.")).toMatchObject({ kind: "sqlite", by: "proposal", reason: expect.stringMatching(/Nothing in the request asks for a database server/) });
    const demo = chooseDatabase("A demo of an orders app with a local database.");
    expect(demo).toMatchObject({ kind: "sqlite", by: "proposal" });
    expect(demo.reason).toMatch(/small or local \("demo", "local database"\)/);
  });

  it("proposes PostgreSQL for shared writes, hosting, or money and audit data, and says which words", () => {
    expect(chooseDatabase("Members make bookings for classes; staff manage the inventory.").reason).toMatch(/several people change the same records at once \("bookings", "inventory"\)/);
    expect(chooseDatabase("A notes app deployed on AWS.")).toMatchObject({ kind: "postgres", reason: expect.stringMatching(/hosted where a local file does not last/) });
    expect(chooseDatabase("Clerks raise invoices and every change is in an audit trail.")).toMatchObject({ kind: "postgres", reason: expect.stringMatching(/money, audit or reporting data \("invoices", "audit"\)/) });
    // hosting wins over a word that says small
    expect(chooseDatabase("A prototype, but it goes to production on Azure next month.")).toMatchObject({ kind: "postgres" });
  });

  it("gives the same request the same answer, and says so when the request names a database it does not set up", () => {
    const text = "An orders app for the warehouse, data in MySQL.";
    expect(chooseDatabase(text)).toEqual(chooseDatabase(text));
    expect(chooseDatabase(text)).toMatchObject({ kind: "postgres", reason: expect.stringMatching(/names MySQL, which the factory does not set up/) });
  });

  it("reads the option as typed", () => {
    expect([databaseOption(undefined), databaseOption("auto"), databaseOption("SQLite"), databaseOption("postgresql")]).toEqual([undefined, undefined, "sqlite", "postgres"]);
    expect(() => databaseOption("mysql")).toThrow(/use sqlite, postgres, or auto/);
  });
});
