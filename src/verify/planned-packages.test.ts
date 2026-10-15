import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plannedProject, targetFramework } from "./dotnet.js";

// run 7850: TASK-1's agent had no JwtBearer for 16 minutes; the plan's packages are now restored before the agent starts
describe("restoring the plan's new packages before the implement agent", () => {
  it("reads the target framework from the repo's project files", () => {
    const src = mkdtempSync(join(tmpdir(), "factory-planned-"));
    mkdirSync(join(src, "App.Api"), { recursive: true });
    writeFileSync(join(src, "App.Api/App.Api.csproj"), "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>");
    expect(targetFramework(src)).toBe("net8.0");
    rmSync(src, { recursive: true, force: true });
  });

  it("takes the first of several frameworks, and net9.0 when no project names one", () => {
    const src = mkdtempSync(join(tmpdir(), "factory-planned-"));
    expect(targetFramework(src)).toBe("net9.0");
    writeFileSync(join(src, "Lib.csproj"), "<Project><PropertyGroup><TargetFrameworks>net9.0;net8.0</TargetFrameworks></PropertyGroup></Project>");
    expect(targetFramework(src)).toBe("net9.0");
    rmSync(src, { recursive: true, force: true });
  });

  it("writes a project naming only the planned packages, outside central package versions", () => {
    const p = plannedProject("net9.0", [{ name: "Microsoft.AspNetCore.Authentication.JwtBearer", version: "9.0.0" }]);
    expect(p).toContain(`<PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="9.0.0" />`);
    expect(p).toContain("<TargetFramework>net9.0</TargetFramework>");
    expect(p).toContain("<ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>");
  });
});
