// Resolving a pull request to its run, and classifying what moved since it was gated.
import { describe, expect, it } from "vitest";
import { classify, isRepairable, repairTrailer, resolveRunId } from "./sync.js";

describe("resolveRunId", () => {
  it("prefers the marker in the review body", () => {
    expect(resolveRunId({ reviewBody: "text\n<!-- factory-review:run-20261005-abc -->", headRef: "factory/run-other" }))
      .toEqual({ runId: "run-20261005-abc", via: "marker" });
  });

  it("falls back to the branch name: a body can be edited, a branch cannot", () => {
    expect(resolveRunId({ reviewBody: "someone deleted the marker", headRef: "factory/run-20261005-abc" }))
      .toEqual({ runId: "run-20261005-abc", via: "branch" });
  });

  it("reads a branch that carries a Jira key as well as the run id", () => {
    expect(resolveRunId({ headRef: "factory/SHOP-42-run-20261005-abc" }))
      .toEqual({ runId: "run-20261005-abc", via: "branch" });
  });

  it("is an anomaly when neither resolves — never neutral, never ignored", () => {
    expect(resolveRunId({ headRef: "feature/hand-written" }))
      .toEqual({ anomaly: expect.stringMatching(/cannot be attributed/) });
  });
});

describe("repairTrailer", () => {
  it("marks a repair commit so the next webhook recognises it as ours", () => {
    expect(repairTrailer("rv-123")).toBe("Factory-Repair: rv-123");
  });

  it("adds no attribution of any other kind", () => {
    expect(repairTrailer("rv-123")).not.toMatch(/Co-Authored-By/i);
  });
});

const base = {
  ledgerPresent: true, evidenceReconciles: true,
  headSha: "h1", gatedSha: "h1", baseSha: "b1", recordedBaseSha: "b1",
  newCommits: [] as { sha: string; trailers: string[] }[],
  mergesClean: true, mergeTestsPass: true, priorReverifyConcluded: true,
};
const repair = { sha: "r1", trailers: ["Factory-Repair: rv-1"] };
const theirs = { sha: "x1", trailers: [] as string[] };

describe("classify", () => {
  it("unchanged when nothing moved", () => {
    expect(classify(base).cls).toBe("unchanged");
  });

  it("evidence-mismatch when the ledger is absent on this host", () => {
    const got = classify({ ...base, ledgerPresent: false });
    expect(got.cls).toBe("evidence-mismatch");
    expect(got.why).toMatch(/ledger/i);
  });

  it("evidence-mismatch when the recorded decisions do not reconcile", () => {
    expect(classify({ ...base, evidenceReconciles: false }).cls).toBe("evidence-mismatch");
  });

  it("checks evidence-mismatch ABOVE the loop guard, so a repair push cannot mask tampering", () => {
    expect(classify({ ...base, evidenceReconciles: false, headSha: "h2", newCommits: [repair] }).cls)
      .toBe("evidence-mismatch");
  });

  it("evidence-mismatch outranks unexpected-commits", () => {
    expect(classify({ ...base, evidenceReconciles: false, headSha: "h2", newCommits: [theirs] }).cls)
      .toBe("evidence-mismatch");
  });

  it("self-push when every new commit is a concluded repair of ours", () => {
    expect(classify({ ...base, headSha: "h2", newCommits: [repair] }).cls).toBe("self-push");
  });

  it("not self-push when the prior reverify never concluded", () => {
    expect(classify({ ...base, headSha: "h2", priorReverifyConcluded: false, newCommits: [repair] }).cls)
      .not.toBe("self-push");
  });

  it("not self-push when our repair is mixed with somebody else's commit", () => {
    expect(classify({ ...base, headSha: "h2", newCommits: [repair, theirs] }).cls).toBe("unexpected-commits");
  });

  it("unexpected-commits names the commits it will not repair over", () => {
    const got = classify({ ...base, headSha: "h2", newCommits: [theirs] });
    expect(got.cls).toBe("unexpected-commits");
    expect(got.why).toMatch(/x1/);
    expect(got.why).toMatch(/never repairing/);
  });

  it("conflict when the base moved and the branch no longer merges", () => {
    expect(classify({ ...base, baseSha: "b2", mergesClean: false }).cls).toBe("conflict");
  });

  it("broken-merge when it merges but the locked tests fail", () => {
    expect(classify({ ...base, baseSha: "b2", mergeTestsPass: false }).cls).toBe("broken-merge");
  });

  it("base-moved-clean when the base moved and everything still passes", () => {
    expect(classify({ ...base, baseSha: "b2" }).cls).toBe("base-moved-clean");
  });

  it("conflict even when the base did not move, if the branch does not merge", () => {
    expect(classify({ ...base, mergesClean: false }).cls).toBe("conflict");
  });
});

describe("isRepairable", () => {
  it("allows only a textual conflict and a broken merge", () => {
    expect(isRepairable("conflict")).toBe(true);
    expect(isRepairable("broken-merge")).toBe(true);
  });

  it("never repairs an evidence mismatch or somebody else's commits", () => {
    for (const cls of ["evidence-mismatch", "unexpected-commits", "self-push", "unchanged", "base-moved-clean"] as const) {
      expect(isRepairable(cls)).toBe(false);
    }
  });
});
