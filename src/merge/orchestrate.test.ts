// Path A, sequenced. Fakes for the forge, the test lab and the model — so the ORDER is tested:
// what runs, what does not, and above all what never costs money.
import { describe, expect, it, vi } from "vitest";
import { reviewPr, type MergeResult, type ReverifyRecord, type ReviewPrDeps, type RunFacts } from "./orchestrate.js";

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
  const calls = {
    mergeVerify: 0, review2: 0, repair: 0, gates: 0, push: 0, notify: [] as string[], comments: 0,
    checks: [] as { conclusion: string; title: string; headSha: string }[], records: [] as ReverifyRecord[],
  };
  const d: ReviewPrDeps = {
    getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base1", state: "open", merged: false }),
    findReviewBody: async () => "<!-- factory-review:run-1 -->",
    openRun: () => run ?? undefined,
    commitsSince: async () => [],
    mergeVerify: async () => { calls.mergeVerify++; return mergeResult(); },
    review2: async () => { calls.review2++; },
    runGates: async (x) => { calls.gates++; return x.ids.map((id) => ({ id, passed: true, details: "ok" })); },
    repair: async () => { calls.repair++; return { made: true, why: "merged base in" }; },
    pushRepair: async () => { calls.push++; return { pushed: true, why: "pushed", sha: "pushed1" }; },
    recordReverify: async (r) => { calls.records.push(r); },
    writeCheck: async (x) => { calls.checks.push({ conclusion: x.conclusion, title: x.title, headSha: x.headSha }); },
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

  it("hands the repair the conflicted paths, instead of leaving it to find them", async () => {
    let subject: string[] | undefined;
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1, conflicts: ["src/A.cs", "src/B.cs"] }); },
      repair: async (_cls, x) => { calls.repair++; subject = x.subject; return { made: true, why: "resolved" }; },
    });
    await reviewPr(d, { pr: 42 });
    expect(subject).toEqual(["src/A.cs", "src/B.cs"]);
  });

  it("hands the repair the failing locked tests for a broken merge", async () => {
    let subject: string[] | undefined;
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ testsPass: calls.mergeVerify > 1, failedTests: ["Orders.Tests::Rejects"] }); },
      repair: async (_cls, x) => { calls.repair++; subject = x.subject; return { made: true, why: "fixed" }; },
    });
    await reviewPr(d, { pr: 42 });
    expect(subject).toEqual(["Orders.Tests::Rejects"]);
  });

  it("tells the repair which branch to push to", async () => {
    // without this the repair commits locally and the pull request never receives it
    let got: { headRef: string } | undefined;
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      pushRepair: async (x) => { calls.push++; got = x; return { pushed: true, why: "pushed", sha: "pushed1" }; },
    });
    await reviewPr(d, { pr: 42 });
    expect(got?.headRef).toBe("factory/run-1");
  });

  it("reports a failure, not a repair, when the fix could not be pushed", async () => {
    // the edits exist locally but the pull request has not moved: calling that repaired would
    // claim the tree was fixed when the tree a person sees is unchanged
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      pushRepair: async () => { calls.push++; return { pushed: false, why: "GITHUB_TOKEN is missing in ~/.factory/.env" }; },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(got.repaired).toBe(false);
    expect(calls.checks[0]!.title).toMatch(/Could not push/);
    expect(calls.notify[0]).toMatch(/GITHUB_TOKEN/);
  });

  it("reports a failure when the repair declined or could not be made", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); },
      repair: async () => { calls.repair++; return { made: false, why: "the repair declined: two versions of one rule" }; },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(calls.checks[0]!.title).toMatch(/Could not repair/);
    expect(calls.push).toBe(0);
  });

  it("never pushes a repair whose tree does not verify", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(calls.repair).toBe(1);
    expect(calls.mergeVerify).toBe(2);
    expect(calls.push).toBe(0);
    expect(got.conclusion).toBe("failure");
    expect(calls.checks[0]!.title).toMatch(/did not verify/);
  });

  it("never pushes a repair a gate blocks", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      runGates: async (x) => { calls.gates++; return x.ids.map((id) => ({ id, passed: id !== "build.clean", details: "x" })); },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(calls.push).toBe(0);
    expect(got.repaired).toBe(false);
    expect(got.conclusion).toBe("failure");
  });

  it("pushes only after the gates pass, and writes the check to the pushed head", async () => {
    const order: string[] = [];
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; order.push("verify"); return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      runGates: async (x) => { order.push("gates"); return x.ids.map((id) => ({ id, passed: true, details: "ok" })); },
      pushRepair: async () => { order.push("push"); return { pushed: true, why: "pushed", sha: "pushed1" }; },
    });
    const got = await reviewPr(d, { pr: 42 });
    expect(order).toEqual(["verify", "verify", "gates", "push"]);
    expect(got.repaired).toBe(true);
    expect(calls.checks.map((c) => c.headSha)).toEqual(["pushed1"]);
    expect(calls.records[0]).toMatchObject({ headSha: "pushed1", baseSha: "base2", conclusion: "success", attemptsThisPr: 1 });
  });

  it("tells the second verification to judge the REPAIRED tree, not the head again", async () => {
    // rebuilding from the head would discard the repair commit and verify the broken tree in its
    // place — and then throw anyway, since the worktree is already there
    const flags: (boolean | undefined)[] = [];
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async (x) => { calls.mergeVerify++; flags.push(x.afterRepair); return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
    });
    await reviewPr(d, { pr: 42 });
    expect(flags).toEqual([false, true]);
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

  it("waits out the cooldown instead of starting work, and writes nothing", async () => {
    const { d, calls } = deps(
      { getPr: movedPr, mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); } },
      runFacts({ lastReverifyAt: Date.parse("2026-10-05T11:59:00Z") }));
    const got = await reviewPr(d, { pr: 42 });
    expect(got.cls).toBe("deferred");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.repair).toBe(0);
    expect(calls.checks).toHaveLength(0);
    expect(calls.records).toHaveLength(0);
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

  it("says on the pull request that the tree moved under it, so the diff is read again", async () => {
    const bodies: string[] = [];
    const { d, calls } = deps({
      getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false }),
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: calls.mergeVerify > 1 }); },
      writeComment: async (x) => { calls.comments++; bodies.push(x.body); },
    });
    await reviewPr(d, { pr: 42 });
    // nobody approves these pull requests — the gates decide — so the note names what actually
    // happened: the tree changed after it was last reported on
    expect(bodies[0]).toMatch(/Repaired automatically after this pull request was last reported on/);
    expect(bodies[0]).not.toMatch(/your approval/);
  });

  it("always reports under the one check name both paths share", async () => {
    const names: string[] = [];
    const { d } = deps({ writeCheck: async (x) => { names.push(x.name); } });
    await reviewPr(d, { pr: 42 });
    expect(names).toEqual(["factory/merge-gate"]);
  });
});

describe("reviewPr: it remembers what it judged, so nothing loops", () => {
  const movedPr = async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false });

  it("records every verdict it reaches: head, base, conclusion and attempts", async () => {
    const { d, calls } = deps({ getPr: movedPr });
    await reviewPr(d, { pr: 42 });
    expect(calls.records).toHaveLength(1);
    expect(calls.records[0]).toMatchObject({ runId: "run-1", headSha: SHA, baseSha: "base2", conclusion: "success", cls: "base-moved-clean", attemptsThisPr: 0 });
  });

  it("counts a failed repair against the per-PR budget", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ mergesClean: false }); },
      repair: async () => { calls.repair++; return { made: false, why: "declined" }; },
    }, runFacts({ attemptsThisPr: 2 }));
    await reviewPr(d, { pr: 42 });
    expect(calls.records[0]!.attemptsThisPr).toBe(3);
  });

  it("concludes from the last judgement when neither head nor base moved since, without a container or a notification", async () => {
    const { d, calls } = deps({ getPr: movedPr },
      runFacts({ judgedHeadSha: SHA, recordedBaseSha: "base2", priorConclusion: "failure" }));
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(calls.mergeVerify).toBe(0);
    expect(calls.review2).toBe(0);
    expect(calls.repair).toBe(0);
    expect(calls.notify).toEqual([]);
    expect(calls.checks).toHaveLength(1);
  });

  it("does not pay for review-2 again on a diff it already reviewed", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ current: hashes({ "review.covers-every-criterion": "diffA" }) }); },
    }, runFacts({ reviewed: new Map([["review.covers-every-criterion", "diffA"]]) }));
    await reviewPr(d, { pr: 42 });
    expect(calls.review2).toBe(0);
  });

  it("records what review-2 read, so the next pass can tell", async () => {
    const { d, calls } = deps({
      getPr: movedPr,
      mergeVerify: async () => { calls.mergeVerify++; return mergeResult({ current: hashes({ "review.covers-every-criterion": "diffB" }) }); },
    });
    await reviewPr(d, { pr: 42 });
    expect(calls.review2).toBe(1);
    expect(calls.records[0]!.reviewed).toMatchObject({ "review.covers-every-criterion": "diffB" });
  });

  it("does not notify again for an evidence mismatch it already reported on this head and base", async () => {
    const { d, calls } = deps({}, runFacts({ evidenceReconciles: false, judgedHeadSha: SHA, priorConclusion: "failure" }));
    await reviewPr(d, { pr: 42 });
    expect(calls.notify).toEqual([]);
    expect(calls.checks[0]!.conclusion).toBe("failure");
  });
});

describe("reviewPr: what it will not gate", () => {
  it("refuses a fork: a repair would push somewhere the factory does not own", async () => {
    const { d, calls } = deps({ getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "base2", state: "open", merged: false, fromFork: true }) });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(got.why).toMatch(/fork/);
    expect(calls.mergeVerify).toBe(0);
    expect(calls.repair).toBe(0);
  });

  it("refuses a pull request whose head is the base branch", async () => {
    const { d, calls } = deps({ getPr: async () => ({ headSha: SHA, headRef: "main", baseRef: "main", baseSha: "base2", state: "open", merged: false }) });
    const got = await reviewPr(d, { pr: 42 });
    expect(got.conclusion).toBe("failure");
    expect(calls.mergeVerify).toBe(0);
  });

  it("with onlyLocal, leaves alone what is not this host's: a fork, an unattributable PR, a ledger elsewhere", async () => {
    const cases: [Partial<ReviewPrDeps>, RunFacts | null][] = [
      [{ getPr: async () => ({ headSha: SHA, headRef: "factory/run-1", baseRef: "main", baseSha: "b", state: "open", merged: false, fromFork: true }) }, runFacts()],
      [{ findReviewBody: async () => undefined, getPr: async () => ({ headSha: SHA, headRef: "by-hand", baseRef: "main", baseSha: "b", state: "open", merged: false }) }, runFacts()],
      [{}, null],
    ];
    for (const [over, run] of cases) {
      const { d, calls } = deps(over, run);
      const got = await reviewPr(d, { pr: 42, onlyLocal: true });
      expect(got.cls).toBe("not-here");
      expect(calls.checks).toHaveLength(0);
      expect(calls.notify).toEqual([]);
    }
  });
});
