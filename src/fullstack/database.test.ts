import { describe, expect, it } from "vitest";
import { newProductDatabase } from "./database.js";

describe("the database of a new product", () => {
  it("is PostgreSQL, whatever the request reads like", () => {
    for (const text of ["A demo of a to-do list on my laptop.", "Members make bookings for classes; hosted on AWS.", "Store it in Postgres."])
      expect(newProductDatabase(text)).toEqual({ kind: "postgres", reason: "Every new product's API is built on PostgreSQL." });
  });

  it("says when the request names a database the factory does not set up", () => {
    expect(newProductDatabase("An orders app, on SQLite for now.").reason).toBe("Every new product's API is built on PostgreSQL. The request names SQLite, which the factory does not set up for a new product.");
    expect(newProductDatabase("Orders for a shop. We use MySQL.").reason).toMatch(/names MySQL, which the factory does not set up/);
  });
});
