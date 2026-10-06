// Path A, sequenced. Fakes for the forge, the test lab and the model — so the ORDER is tested:
// what runs, what does not, and above all what never costs money.
import { describe, expect, it, vi } from "vitest";
import { reviewPr, type MergeResult, type ReviewPrDeps, type RunFacts } from "./orchestrate.js";

const SHA = "a".repeat(40);
const hashes = (over: Record<string, string> = {}) =>
  new Map(Object.entries({ "build.clean": "h1", "tests.expectations": "h2", "review.covers-every-criterion": "h3", ...over }));

const runFacts = (over: Partial<RunFacts> = {}): RunFacts => ({
  gatedSha: SHA, recordedBaseSha: "base1", recorded: hashes(),
  evidenceReconciles: true, priorReverifyConcluded: true, attemptsThisPr: 0,
  ...over,
});

const mergeResult = (over: Partial<MergeResult> = {}): MergeResult => ({
  mergesClean: true, testsPass: true, current: hashes(), diffSha: "d1", mergeSha: "m1", ...over,
});

// `null` means "no ledger on this host". Passing `undefined` would trigger the default parameter.
function deps(over: Partial<ReviewPrDeps> = {}, run: RunFacts | null = runFacts()) {
  const calls = { mergeVerify: 0, review2: 0, repair: 0, gates: 0, notify: [] as string[], checks: [] as { conclusion: string; title: string }[], comments: 0 };
  const d: ReviewPrDeps = {
    getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base1", state: "open", merged: false }),
    findReviewBody: async () => "<!-- factory-review:run-1 -->",
    openRun: () => run ?? undefined,
    commitsSince: async () => [],
    mergeVerify: async () => { calls.mergeVerify++; return mergeResult(); },
    review2: async () => { calls.review2++; },
    runGates: async (x) => { calls.gates++; return x.ids.map((id) => ({ id, passed: true, details: "ok" })); },
    repair: async () => { calls.repair++; return { pushed: true, why: "merged base in" }; },
    writeCheck: async (x) => { calls.checks.push({ conclusion: x.conclusion, title: x.title }); },
    writeComment: async () => { calls.comments++; },
    notify: async (m) => { calls.notify.push(m); },
    now: () => Date.parse("2026-10-05T12:00:00Z"),
    ...over,
  };
  return { d, calls };
}

describe("reviewPr: nothing expensive before everything cheap agrees", () => {
  it("an unchanged tree starts no container and calls no model", async () => {
    const { d, calls } = deps();
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("unchanged");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.review2).toBe(0);
    expect(got.conclusion).toBe("success");
  });

  it("an evidence mismatch stops before the tree is touched", async () => {
    const { d, calls } = deps({}, runFacts({ evidenceReconciles: false }));
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("evidence-mismatch");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.review2).toBe(0);
    expect(calls.repair).toBe(0);
    expect(calls.notify).toHaveLength(1);
    expect(calls.checks[0]!.conclusion).toBe("failure");
  });

  it("a missing ledger is an evidence mismatch, not a quiet pass", async () => {
    const { d, calls } = deps({}, null);
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("evidence-mismatch");
    expect(calls.mergeVerify).toBe(0);
  });

  it("a self-push concludes from the prior result without a container or a model", async () => {
    const { d, calls } = deps(
      { commitsSince: async () => [{ sha: "r1", trailers: ["Factory-Repair: rv-1"] }],
        getPr: async () => ({ headSha: "newhead", headRef: "factory/run-1", baseRef: "main", baseSha: "base1", state: "open", merged: false }) },
      runFacts({ priorConclusion: "success" }));
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("self-push");
    expect(got.conclusion).toBe("success");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.review2).toBe(0);
  });

  it("an unattributable pull request fails and notifies, and never starts work", async () => {
    const { d, calls } = deps({
      findReviewBody: async () => undefined,
      getPr: async () => ({ headSha: SHA, headRef: "feature/by-hand", baseRef: "main", baseSha: "base1", state: "open", merged: false }),
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("anomaly");
    expect(got.conclusion).toBe("failure");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.notify).toHaveLength(1);
  });

  it("writes nothing to a pull request that was merged or closed meanwhile", async () => {
    for (const pr of [{ merged: true, state: "closed" }, { merged: false, state: "closed" }]) {
      const { d, calls } = deps({
        getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base1", ...pr }),
      });
      const got = await reviewPr(d, { pr: 42 });
      expect(got.cls).toBe("abandoned");
      expect(calls.checks).toHaveLength(0);
      expect(calls.comments).toBe(0);
    }
  });
});

describe("reviewPr: when the base has moved", () => {
  const movedPr = async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false });

  it("verifies the merge result and concludes green", async () => {
    const { d, calls } = deps({ getPr: movedPr });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("base-moved-clean");
    expect(calls.mergeVerify).toBe(1);
    expect(got.conclusion).toBe("success");
  });

  it("repairs a conflict, then verifies the REPAIRED tree, not the one it classified", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("conflict");
    expect(calls.repair).toBe(1);
    expect(got.repaired).toBe(true);
    expect(calls.mergeVerify).toBe(2);
  });

  it("repairs a broken merge the same way", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ testsPass: calls.mergeVerify > 1 }); },
    });
    expect((await reviewPr(d, { pr: 42 })).cls).toBe("broken-merge");
    expect(calls.repair).toBe(1);
  });

  it("parks instead of repairing when the per-PR budget is spent", async () => {
    const { d, calls } = deps(
      { getPr: movedPr, mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); } },
      runFacts({ attemptsThisPr: 6 }));
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(calls.repair).toBe(0);
    expect(calls.notify[0]).toMatch(/parked/);
  });

  it("parks instead of repairing inside the cooldown", async () => {
    const { d, calls } = deps(
      { getPr: movedPr, mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); } },
      runFacts({ lastReverifyAt: Date.parse("2026-10-05T11:59:00Z") }));
    expect((await reviewPr(d, { pr: 42 })).conclusion).toBe("failure");
    expect(calls.repair).toBe(0);
  });

  it("NEVER repairs over commits that are not the factory's", async () => {
    const { d, calls } = deps({
      getPr: async () => ({ headSha: "theirs", headRef: "factory/run-1", baseRef: "main", baseSha: "base1", state: "open", merged: false }),
      commitsSince: async () => [{ sha: "x1", trailers: [] }],
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("unexpected-commits");
    expect(calls.repair).toBe(0);
    expect(calls.mergeVerify).toBe(1);     // verified and reported, never rewritten
  });
});

describe("reviewPr: the model only runs when it would read something new", () => {
  const movedPr = async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false });

  it("skips the model when every recorded hash still matches", async () => {
    const { d, calls } = deps({ getPr: movedPr });
    await reviewPr(d, { pr: 42 });
    expect(calls.review2).toBe(0);
  });

  it("runs the model when the review's own inputs moved", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ current: hashes({ "review.covers-every-criterion": "CHANGED" }) }); },
    });
    await reviewPr(d, { pr: 42 });
    expect(calls.review2).toBe(1);
  });

  it("does not run the model merely because a deterministic gate moved", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ current: hashes({ "build.clean": "CHANGED" }) }); },
    });
    await reviewPr(d, { pr: 42 });
    expect(calls.review2).toBe(0);
  });

  it("--force re-runs the model on an unchanged tree, and says it was forced", async () => {
    const { d, calls } = deps();
    const got = await reviewPr(d, { pr: 42, force: true });
    expect(calls.review2).toBe(1);
    expect(got.forced).toBe(true);
  });
});

describe("reviewPr: what gets written back", () => {
  it("fails the check and notifies when a gate blocks", async () => {
    const { d, calls } = deps({
      runGates: async (x) => { calls.gates++; return x.ids.map((id) => ({ id, passed: id !== "build.clean", details: id === "build.clean" ? "A.cs:1 CS1002" : "ok" })); },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(calls.checks[0]!.conclusion).toBe("failure");
    expect(calls.notify[0]).toMatch(/build\.clean/);
  });

  it("stays silent on Slack when everything passes", async () => {
    const { d, calls } = deps();
    await reviewPr(d, { pr: 42 });
    expect(calls.notify).toEqual([]);
  });

  it("writes exactly one check and one comment", async () => {
    const { d, calls } = deps();
    await reviewPr(d, { pr: 42 });
    expect(calls.checks).toHaveLength(1);
    expect(calls.comments).toBe(1);
  });

  it("tells a reviewer when the diff was repaired after their approval", async () => {
    const bodies: string[] = [];
    const { d, calls } = deps({
      getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false }),
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      writeComment: async (x) => { calls.comments++; bodies.push(x.body); },
    });
    await reviewPr(d, { pr: 42 });
    expect(bodies[0]).toMatch(/Repaired automatically since your approval/);
  });

  it("always reports under the one check name both paths share", async () => {
    const names: string[] = [];
    const { d } = deps({ writeCheck: async (x) => { names.push(x.name); } });
    await reviewPr(d, { pr: 42 });
    expect(names).toEqual(["factory/merge-gate"]);
  });
});
