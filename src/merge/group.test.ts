// Path B: the tree the merge queue is about to make main.
import { describe, expect, it } from "vitest";
import { lockedTestUnion, parseMergeGroupRef } from "./group.js";

describe("parseMergeGroupRef", () => {
  it("reads the base and the speculative sha", () => {
    expect(parseMergeGroupRef("refs/heads/gh-readonly-queue/main/pr-42-abc123"))
      .toEqual({ base: "main", sha: "pr-42-abc123" });
  });

  it("handles a base branch containing a slash", () => {
    expect(parseMergeGroupRef("refs/heads/gh-readonly-queue/release/2.0/pr-7-def"))
      .toEqual({ base: "release/2.0", sha: "pr-7-def" });
  });

  it("refuses an ordinary branch ref", () => {
    expect(() => parseMergeGroupRef("refs/heads/main")).toThrow(/not a merge queue ref/);
  });

  it("refuses a ref with nothing after the base", () => {
    expect(() => parseMergeGroupRef("refs/heads/gh-readonly-queue/main")).toThrow(/not a merge queue ref/);
  });
});

describe("lockedTestUnion", () => {
  it("runs the union of every member's locked tests, not just this one's", () => {
    const got = lockedTestUnion([
      { runId: "r1", lockedTestIds: ["T1", "T2"] },
      { runId: "r2", lockedTestIds: ["T2", "T3"] },
    ]);
    expect(got.ids).toEqual(["T1", "T2", "T3"]);
    expect(got.incomplete).toEqual([]);
  });

  it("reports a member with no locked tests rather than quietly shrinking the union", () => {
    const got = lockedTestUnion([
      { runId: "r1", lockedTestIds: ["T1"] },
      { runId: "r2", lockedTestIds: [] },
    ]);
    expect(got.ids).toEqual(["T1"]);
    expect(got.incomplete).toEqual([{ runId: "r2", why: "no locked tests: its run never completed author-tests" }]);
  });

  it("reports a member whose run could not be resolved at all", () => {
    const got = lockedTestUnion([
      { runId: "r1", lockedTestIds: ["T1"] },
      { runId: undefined, anomaly: "no marker, and no run id in the branch" },
    ]);
    expect(got.incomplete).toEqual([{ runId: "(unresolved)", why: "no marker, and no run id in the branch" }]);
  });

  it("is deterministic: the union is sorted however the members arrived", () => {
    const a = lockedTestUnion([{ runId: "r1", lockedTestIds: ["T9", "T1"] }, { runId: "r2", lockedTestIds: ["T5"] }]);
    const b = lockedTestUnion([{ runId: "r2", lockedTestIds: ["T5"] }, { runId: "r1", lockedTestIds: ["T1", "T9"] }]);
    expect(a.ids).toEqual(b.ids);
    expect(a.ids).toEqual(["T1", "T5", "T9"]);
  });

  it("returns an empty union and no complaint for an empty group", () => {
    expect(lockedTestUnion([])).toEqual({ ids: [], incomplete: [] });
  });
});
