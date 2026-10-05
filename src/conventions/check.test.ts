// Evaluating confirmed conventions against the files a change touched.
import { describe, expect, it } from "vitest";
import { checkConventions } from "./check.js";
import type { Convention } from "../contracts/index.js";

const conv = (p: Partial<Convention>): Convention => ({
  id: "CV-1", appliesTo: ["**/*.cs"], rule: "No raw SQL strings", exemplar: "src/Orders/Repo.cs:34",
  evidence: { matching: 40, total: 41, recentMatching: 12, recentTotal: 12 },
  status: "confirmed", source: "mined", check: { tool: "grep", ref: "SELECT\\s" }, ...p,
});

describe("checkConventions", () => {
  it("reports a line that breaks a confirmed grep convention", () => {
    expect(checkConventions([conv({})], [{ path: "src/A.cs", text: 'var q = "SELECT * FROM x";\n' }]))
      .toEqual([{ conventionId: "CV-1", file: "src/A.cs", line: 1, detail: "SELECT " }]);
  });

  it("ignores a convention that is not confirmed", () => {
    for (const status of ["mixed", "candidate"] as const) {
      expect(checkConventions([conv({ status })], [{ path: "src/A.cs", text: 'q = "SELECT *";\n' }])).toEqual([]);
    }
  });

  it("ignores a confirmed convention with no check: the gate needs something to evaluate", () => {
    expect(checkConventions([conv({ check: undefined })], [{ path: "src/A.cs", text: 'q = "SELECT *";\n' }])).toEqual([]);
  });

  it("leaves eslint, roslyn and the rest to the analyzers, which arrive as LintRun", () => {
    for (const tool of ["eslint", "roslyn", "depcruise", "archunit"] as const) {
      expect(checkConventions([conv({ check: { tool, ref: "SELECT\\s" } })], [{ path: "src/A.cs", text: 'q = "SELECT *";\n' }])).toEqual([]);
    }
  });

  it("only looks at files the convention applies to", () => {
    expect(checkConventions([conv({ appliesTo: ["src/Orders/**"] })], [{ path: "src/Api/A.cs", text: 'q = "SELECT *";\n' }])).toEqual([]);
    expect(checkConventions([conv({ appliesTo: ["src/Orders/**"] })], [{ path: "src/Orders/A.cs", text: 'q = "SELECT *";\n' }])).toHaveLength(1);
  });

  it("matches ** across folders and * within one segment", () => {
    const c = conv({ appliesTo: ["src/*/Repo.cs"] });
    expect(checkConventions([c], [{ path: "src/Orders/Repo.cs", text: '"SELECT *"\n' }])).toHaveLength(1);
    expect(checkConventions([c], [{ path: "src/Orders/Deep/Repo.cs", text: '"SELECT *"\n' }])).toEqual([]);
  });

  it("reports every offending line, with its own line number", () => {
    const got = checkConventions([conv({})], [{ path: "src/A.cs", text: 'a\n"SELECT x"\nb\n"SELECT y"\n' }]);
    expect(got.map((v) => v.line)).toEqual([2, 4]);
  });

  it("reports the same violation whether the file arrives LF or CRLF", () => {
    const lf = checkConventions([conv({})], [{ path: "A.cs", text: 'var q = "SELECT *";\nvar b = 1;\n' }]);
    const crlf = checkConventions([conv({})], [{ path: "A.cs", text: 'var q = "SELECT *";\r\nvar b = 1;\r\n' }]);
    expect(crlf).toEqual(lf);
  });

  it("does not shift the reported line because of trailing whitespace", () => {
    const plain = checkConventions([conv({})], [{ path: "A.cs", text: 'a\nvar q = "SELECT *";\n' }]);
    const padded = checkConventions([conv({})], [{ path: "A.cs", text: 'a   \nvar q = "SELECT *";   \n' }]);
    expect(padded).toEqual(plain);
    expect(plain[0]!.line).toBe(2);
  });

  it("survives a convention whose pattern is not a valid regular expression", () => {
    expect(() => checkConventions([conv({ check: { tool: "grep", ref: "([unclosed" } })], [{ path: "A.cs", text: "x\n" }]))
      .not.toThrow();
  });
});
