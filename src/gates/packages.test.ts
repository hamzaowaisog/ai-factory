import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "./policy.js";
import { changedPackages, isPackageManifest, manifestPackages, packagesPlanned, type PackageChange } from "./packages.js";

const csproj = (refs: string) => `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n${refs}\n  </ItemGroup>\n</Project>\n`;
const npgsql = `    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="9.0.2" />`;
const gate = (changes: PackageChange[], planned: string[] = []) =>
  packagesPlanned.predicate({ packages: { kind: "packages", from: "a", to: "b", changes }, plan: { newDependencies: planned.map((name) => ({ name, version: "1.0.0", registry: "nuget.org" })) } }, DEFAULT_POLICY);

describe("packages a commit adds or changes", () => {
  it("knows which files name packages", () => {
    expect(["App.Api/App.Api.csproj", "Directory.Packages.props", "web/package.json", "package.json"].every(isPackageManifest)).toBe(true);
    expect(["web/node_modules/x/package.json", "src/A.cs", "package-lock.json", "App.sln"].some(isPackageManifest)).toBe(false);
  });

  it("reads a .NET project file: attributes in any order, a version as a child element, central versions", () => {
    const p = manifestPackages("A.csproj", csproj(`${npgsql}\n    <PackageReference Version="1.2.3" Include="Dapper" />\n    <PackageReference Include="Serilog">\n      <Version>4.0.0</Version>\n    </PackageReference>\n    <PackageReference Include="NoVersion" />`));
    expect([...p.values()]).toEqual([{ name: "Npgsql.EntityFrameworkCore.PostgreSQL", version: "9.0.2" }, { name: "Dapper", version: "1.2.3" }, { name: "Serilog", version: "4.0.0" }, { name: "NoVersion", version: "" }]);
    expect([...manifestPackages("Directory.Packages.props", `<PackageVersion Include="Dapper" Version="2.0.0" />`).values()]).toEqual([{ name: "Dapper", version: "2.0.0" }]);
  });

  it("reads every dependency section of a package.json, and nothing else in it", () => {
    const p = manifestPackages("web/package.json", JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "15.0.0" }, devDependencies: { vitest: "^3.0.0" }, optionalDependencies: { fsevents: "2.3.3" } }));
    expect([...p.keys()]).toEqual(["next", "vitest", "fsevents"]);
    expect(manifestPackages("package.json", "{ not json").size).toBe(0);
  });

  it("finds an added package and a changed version, and ignores a moved or untouched line", () => {
    const before = csproj(npgsql);
    expect(changedPackages("A.csproj", before, csproj(`    <PackageReference Include="Evil.Pkg" Version="6.6.6" />\n${npgsql}`))).toEqual([{ file: "A.csproj", name: "Evil.Pkg", version: "6.6.6" }]);
    expect(changedPackages("A.csproj", before, csproj(npgsql.replace("9.0.2", "8.0.0")))).toEqual([{ file: "A.csproj", name: "Npgsql.EntityFrameworkCore.PostgreSQL", version: "8.0.0", was: "9.0.2" }]);
    // NuGet ignores case, so a re-cased name is the same package
    expect(changedPackages("A.csproj", before, csproj(npgsql.replace("Npgsql.EntityFrameworkCore", "npgsql.entityframeworkcore")))).toEqual([]);
    expect(changedPackages("A.csproj", before, before.replace("<ItemGroup>", "<ItemGroup>\n    <Compile Remove=\"x.cs\" />"))).toEqual([]);
    // a new project file: every package in it is new; a deleted one adds nothing
    expect(changedPackages("B.csproj", undefined, before)).toHaveLength(1);
    expect(changedPackages("A.csproj", before, undefined)).toEqual([]);
  });
});

describe("task.packages-planned", () => {
  const added = { file: "App.Api/App.Api.csproj", name: "Evil.Pkg", version: "6.6.6" };
  it("passes when nothing changed, and when the plan lists the package", () => {
    expect(gate([]).passed).toBe(true);
    expect(gate([added], ["evil.pkg"]).passed).toBe(true);
  });

  it("fails on a package the plan does not list, and says which file and what to do", () => {
    const v = gate([added, { file: "web/package.json", name: "left-pad", version: "1.3.0", was: "1.0.0" }], ["Dapper"]);
    expect(v.passed).toBe(false);
    expect(v.failures?.map((f) => f.check)).toEqual(["packages-planned", "packages-planned"]);
    expect(v.failures?.[0]?.message).toMatch(/App\.Api\/App\.Api\.csproj adds the package Evil\.Pkg 6\.6\.6.*Take it out/);
    expect(v.failures?.[1]?.message).toMatch(/changes the package left-pad from 1\.0\.0 to 1\.3\.0.*Put the version back/);
  });

  it("is a safety gate nobody can waive", () => {
    expect(packagesPlanned.safety).toBe(true);
    expect(packagesPlanned.waiver).toBe("none");
  });
});
