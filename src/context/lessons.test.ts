import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { lessonPointers, readLessons, recordTestLesson, usableLessons } from "./lessons.js";

let root: string;
const put = (p: string, text: string) => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), text); };

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-lessons-"));
  root = mkdtempSync(join(tmpdir(), "factory-lessons-repo-"));
  put("Shop.UnitTests/Shop.UnitTests.csproj", '<Project><ItemGroup><PackageReference Include="xunit" Version="2.9.2" /><PackageReference Include="FluentAssertions" Version="6.12.0" /></ItemGroup></Project>');
  put("Shop.UnitTests/Orders/OrderTitleTests.cs", "public class OrderTitleTests { [Fact] public void Works() {} }");
  put("Shop.UnitTests/Orders/Helpers.cs", "static class Helpers {}");
  put("Shop.UnitTests/Orders/NewCriteriaTests.cs", "public class NewCriteriaTests { [Fact] public void AC_1_1_X() {} }");
});

describe("repo lessons", () => {
  it("records where locked tests went: the project, its libraries, and existing tests to copy the style from", () => {
    recordTestLesson("shop", root, ["Shop.UnitTests/Orders/NewCriteriaTests.cs"]);
    const l = readLessons("shop").tests[0]!;
    expect(l).toMatchObject({ dir: "Shop.UnitTests/Orders", csproj: "Shop.UnitTests/Shop.UnitTests.csproj", packages: ["xunit", "FluentAssertions"], uses: 1 });
    // only a file that already existed (not this run's own, not a non-test helper)
    expect(l.examples).toEqual(["Shop.UnitTests/Orders/OrderTitleTests.cs"]);
    recordTestLesson("shop", root, ["Shop.UnitTests/Orders/NewCriteriaTests.cs"]);
    expect(readLessons("shop").tests).toHaveLength(1);
    expect(readLessons("shop").tests[0]!.uses).toBe(2);
    expect(lessonPointers(readLessons("shop").tests)[0]!.reason).toMatch(/put tests in Shop.UnitTests\/Orders \(2×\); libraries: xunit, FluentAssertions/);
  });

  it("uses a lesson only if its files still exist in this code", () => {
    recordTestLesson("shop", root, ["Shop.UnitTests/Orders/NewCriteriaTests.cs"]);
    rmSync(join(root, "Shop.UnitTests/Orders/OrderTitleTests.cs"));
    expect(usableLessons(readLessons("shop"), root)[0]!.examples).toEqual([]);
    rmSync(join(root, "Shop.UnitTests/Shop.UnitTests.csproj"));
    expect(usableLessons(readLessons("shop"), root)).toEqual([]);
  });

  it("no lessons yet, or none for this project: nothing changes", () => {
    expect(readLessons("never-ran").tests).toEqual([]);
    expect(usableLessons(readLessons("never-ran"), root)).toEqual([]);
    // tests outside any project leave no lesson
    put("loose/Tests.cs", "[Fact]");
    rmSync(join(root, "Shop.UnitTests/Shop.UnitTests.csproj"));
    expect(recordTestLesson("shop", root, ["loose/Tests.cs"]).tests).toEqual([]);
  });

  it("keeps at most 5, most used first", () => {
    for (let i = 0; i < 7; i++) {
      put(`P${i}/P${i}.csproj`, "<Project />");
      put(`P${i}/T.cs`, "[Fact]");
      recordTestLesson("shop", root, [`P${i}/T.cs`]);
    }
    recordTestLesson("shop", root, ["P6/T.cs"]);
    const ls = readLessons("shop").tests;
    expect(ls).toHaveLength(5);
    expect(ls[0]!.dir).toBe("P6");
  });
});
