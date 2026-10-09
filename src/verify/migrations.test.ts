import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { efMigrations } from "./dotnet.js";

describe("a backend whose database comes from EF Core migrations", () => {
  it("finds the project holding the model snapshot and the EF version it was written with", () => {
    const src = mkdtempSync(join(tmpdir(), "factory-mig-"));
    mkdirSync(join(src, "src/Data/Migrations"), { recursive: true });
    writeFileSync(join(src, "src/Data/Data.csproj"), "<Project />");
    writeFileSync(join(src, "src/Data/Migrations/AppDbModelSnapshot.cs"), 'modelBuilder.HasAnnotation("ProductVersion", "8.0.11");');
    expect(efMigrations(src)).toEqual({ project: "src/Data/Data.csproj", major: "8" });
  });

  it("is nothing for a repo with no migrations", () => {
    const src = mkdtempSync(join(tmpdir(), "factory-mig-"));
    writeFileSync(join(src, "App.csproj"), "<Project />");
    expect(efMigrations(src)).toBeUndefined();
  });
});
