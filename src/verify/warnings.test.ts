// Analyzer warnings the build already emits and today discards.
import { describe, expect, it } from "vitest";
import { newFindings, parseBuildWarnings } from "./warnings.js";

const LOG = `
/src/Orders/OrderService.cs(42,13): warning CA1822: Member 'Total' does not access instance data [/src/Orders/Orders.csproj]
/src/Orders/OrderService.cs(51,9): warning SA1200: Using directive should appear within a namespace [/src/Orders/Orders.csproj]
/src/Api/Program.cs(8,1): error CS0246: The type or namespace name 'Foo' could not be found [/src/Api/Api.csproj]
  Determining projects to restore...
`;

describe("parseBuildWarnings", () => {
  it("reads analyzer warnings and leaves errors to parseBuildErrors", () => {
    const got = parseBuildWarnings(LOG);
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({
      ruleId: "CA1822", file: "Orders/OrderService.cs", line: 42,
      fingerprint: "Orders/OrderService.cs|CA1822", severity: "warning",
    });
  });

  it("fingerprints on file and code, never on line", () => {
    // a change elsewhere in a file shifts line numbers; keying on lines would report the whole file as new
    expect(parseBuildWarnings(LOG.replace("(42,13)", "(907,13)"))[0]!.fingerprint)
      .toBe(parseBuildWarnings(LOG)[0]!.fingerprint);
  });

  it("de-duplicates the same code in the same file", () => {
    expect(parseBuildWarnings(LOG + LOG)).toHaveLength(2);
  });

  it("keeps the same code in different files apart", () => {
    const two = "/src/A.cs(1,1): warning CA1822: x\n/src/B.cs(1,1): warning CA1822: x\n";
    expect(parseBuildWarnings(two).map((f) => f.file)).toEqual(["A.cs", "B.cs"]);
  });

  it("reads StyleCop, Sonar and IDE codes, not just CA", () => {
    const codes = "/src/A.cs(1,1): warning SA1600: x\n/src/A.cs(2,1): warning S1234: y\n/src/A.cs(3,1): warning IDE0051: z\n";
    expect(parseBuildWarnings(codes).map((f) => f.ruleId)).toEqual(["SA1600", "S1234", "IDE0051"]);
  });

  it("returns nothing for a clean log", () => {
    expect(parseBuildWarnings("Build succeeded.\n  0 Warning(s)\n")).toEqual([]);
  });
});

describe("newFindings", () => {
  const run = { kind: "lint" as const, tool: "dotnet-build", version: "9.0", findings: parseBuildWarnings(LOG) };

  it("blames the change only for findings absent from the baseline", () => {
    const base = [{ ruleId: "CA1822", file: "Orders/OrderService.cs", line: 1, fingerprint: "Orders/OrderService.cs|CA1822", severity: "warning" }];
    expect(newFindings(run, base, ["Orders/OrderService.cs"]).map((f) => f.ruleId)).toEqual(["SA1200"]);
  });

  it("ignores findings in files this change did not touch", () => {
    // otherwise the first run blocks on the whole repository's accumulated debt
    expect(newFindings(run, [], ["Api/Program.cs"])).toEqual([]);
  });

  it("is empty when the baseline already holds everything", () => {
    expect(newFindings(run, run.findings, ["Orders/OrderService.cs"])).toEqual([]);
  });

  it("reports both new findings when the baseline is empty and the file changed", () => {
    expect(newFindings(run, [], ["Orders/OrderService.cs"]).map((f) => f.ruleId)).toEqual(["CA1822", "SA1200"]);
  });
});
