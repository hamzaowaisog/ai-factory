// The one pure piece of the live wiring: what a repair is told about a merge result that failed.
import { describe, expect, it } from "vitest";
import { failureDetail } from "./live.js";

const result = (id: string, message?: string) => ({ id, outcome: "failed" as const, durationMs: 1, ...(message ? { message } : {}) });

describe("what a repair is told about the failure", () => {
  it("gives the compile errors when the merge result does not build, since no test ran", () => {
    const d = failureDetail(
      { kind: "build", ok: false, errors: [{ file: "src/Cart.cs", line: 12, code: "CS0103", msg: "The name 'Total' does not exist" }] },
      [result("T1", "Build failed")], ["T1"],
    );
    expect(d).toContain("does not build");
    expect(d).toContain("src/Cart.cs:12 CS0103 The name 'Total' does not exist");
    expect(d).not.toContain("T1");
  });

  it("gives each failing test's message, and only for the tests that count as failing", () => {
    const d = failureDetail({ kind: "build", ok: true, errors: [] },
      [result("T1", "expected 3 but was 2"), result("T2", "failed before this run")], ["T1"]);
    expect(d).toContain("- T1: expected 3 but was 2");
    expect(d).not.toContain("T2");
  });

  it("says nothing when the tests reported nothing", () => {
    expect(failureDetail({ kind: "build", ok: true, errors: [] }, [result("T1")], ["T1"])).toBeUndefined();
  });
});
