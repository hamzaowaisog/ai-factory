// Where an external rule disagrees with what this repository demonstrably does.
import { describe, expect, it } from "vitest";
import { findConflicts } from "./build.js";
import type { Convention } from "../contracts/index.js";

const c = (p: Partial<Convention>): Convention => ({
  id: "CV-1", appliesTo: ["**/*.cs"], rule: "", exemplar: "",
  evidence: { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
  status: "candidate", source: "stackpack", ...p,
});
const mined = (id: string, rule: string) => c({
  id, rule, source: "mined", status: "confirmed",
  evidence: { matching: 41, total: 43, recentMatching: 12, recentTotal: 13 },
});

describe("findConflicts", () => {
  it("flags an external rule naming a test framework the repo does not use", () => {
    expect(findConflicts([
      c({ id: "CV-ext", rule: "Use MSTest framework with FluentAssertions for assertions" }),
      mined("CV-mined", "Tests use xunit"),
    ])).toEqual([{ a: "CV-ext", b: "CV-mined", why: 'names "mstest"; this repo uses "xunit" (41/43 files)' }]);
  });

  it("is quiet when the external rule agrees with the repo", () => {
    expect(findConflicts([
      c({ id: "CV-ext", rule: "Use xUnit with FluentAssertions" }),
      mined("CV-mined", "Tests use xunit"),
    ])).toEqual([]);
  });

  it("never flags two mined rules against each other: the repo cannot conflict with itself", () => {
    expect(findConflicts([
      mined("A", "Tests use mstest"),
      mined("B", "Tests use xunit"),
    ])).toEqual([]);
  });

  it("ignores a repo rule that is only mixed, not confirmed", () => {
    expect(findConflicts([
      c({ id: "CV-ext", rule: "Use MSTest framework" }),
      c({ id: "CV-m", rule: "Tests use xunit", source: "mined", status: "mixed" }),
    ])).toEqual([]);
  });

  it("catches a mocking library disagreement too, not just test frameworks", () => {
    const got = findConflicts([
      c({ id: "CV-ext", rule: "Use Moq for mocking dependencies" }),
      mined("CV-m", "Tests fake collaborators with NSubstitute"),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.why).toMatch(/nsubstitute/);
  });

  it("is quiet when neither side names a mutually exclusive choice", () => {
    expect(findConflicts([
      c({ id: "CV-ext", rule: "Keep methods focused and cohesive" }),
      mined("CV-m", "Services live under src/<Area>"),
    ])).toEqual([]);
  });

  it("does not match a term inside a longer word", () => {
    expect(findConflicts([
      c({ id: "CV-ext", rule: "Avoid the xunitlike helper pattern entirely" }),
      mined("CV-m", "Tests use mstest"),
    ])).toEqual([]);
  });
});
