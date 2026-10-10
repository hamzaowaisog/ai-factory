// The one pure piece of the live wiring: what a repair is told about a merge result that failed.
import { describe, expect, it } from "vitest";
import { diffSummary, failureDetail } from "./live.js";

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

describe("the diff the size gate counts", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts", "index 1..2 100644", "--- a/src/a.ts", "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@", " keep", "-old", "+new", "+++ not a header, an added line",
    "diff --git a/gone.txt b/gone.txt", "deleted file mode 100644", "--- a/gone.txt", "+++ /dev/null",
    "@@ -1,2 +0,0 @@", "-one", "-two",
    "diff --git a/x.sh b/x.sh", "old mode 100644", "new mode 100755",
  ].join("\n");

  it("counts every added and removed line, a deleted file's included", () => {
    expect(diffSummary(diff)).toEqual([
      { path: "gone.txt", added: [], removed: ["one", "two"] },
      { path: "src/a.ts", added: ["new", "++ not a header, an added line"], removed: ["old"] },
    ]);
  });

  it("is empty for an empty diff", () => {
    expect(diffSummary("")).toEqual([]);
  });
});
