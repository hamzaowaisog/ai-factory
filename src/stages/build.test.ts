import { describe, expect, it } from "vitest";
import { failure } from "../gates/engine.js";
import type { LedgerEvent } from "../contracts/index.js";
import { coversIntegrate, usesEmptyBaseline, keepPassingTests, earlierTests, labelRegressions, previousAttempt, patchLines, retryMode, checkOf, limitsNote, TEST_SCOPE, testRetryMode, testWriterTampering, labelRejectionLifted, rewriteHasRoom } from "./build.js";
import { ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { attemptSpend, startNeed } from "./executor.js";
import { matchesAny } from "../util/glob.js";

describe("earlier tasks' locked tests", () => {
  const plan = { tasks: [{ id: "TASK-1" }, { id: "TASK-2" }, { id: "TASK-3" }] };
  const owners = new Map([["AC-1.1", "TASK-1"], ["AC-2.1", "TASK-2"], ["AC-3.1", "TASK-3"]]);
  const tests = [{ acId: "AC-1.1", testId: "t1" }, { acId: "AC-2.1", testId: "t2" }, { acId: "AC-3.1", testId: "t3" }];

  it("takes only tasks before this one in plan order", () => {
    expect([...earlierTests(plan, owners, tests, "TASK-1").keys()]).toEqual([]);
    expect([...earlierTests(plan, owners, tests, "TASK-2").entries()]).toEqual([["t1", { taskId: "TASK-1", acId: "AC-1.1" }]]);
    expect([...earlierTests(plan, owners, tests, "TASK-3").keys()]).toEqual(["t1", "t2"]);
  });

  it("relabels an earlier test's failure as a regression and leaves the rest alone", () => {
    const earlier = earlierTests(plan, owners, tests, "TASK-3");
    const out = labelRegressions([
      failure("locked-failed", "t1 failed: boom", { testId: "t1", frames: ["at A.B()"] }),
      failure("locked-not-executed", "Expected test didn't run: t2", { testId: "t2" }),
      failure("locked-failed", "t3 failed: own", { testId: "t3" }),
      failure("new-failure", "New failure vs baseline: t1", { testId: "t1" }),
    ], earlier);
    expect(out.map((f) => f.check)).toEqual(["regression", "regression", "locked-failed", "new-failure"]);
    expect(out[0]).toEqual({ check: "regression", testId: "t1", frames: ["at A.B()"], message: "Your change broke TASK-1's locked test t1 (AC-1.1): t1 failed: boom" });
    expect(out[1]!.message).toMatch(/^Your change broke TASK-2's locked test t2 \(AC-2\.1\)/);
  });
});

describe("retry: keep the previous attempt's code or reset", () => {
  const prev = (checks: string[], over: { rung?: number; interrupted?: boolean } = {}) => ({ checks, rung: over.rung ?? 0, interrupted: over.interrupted ?? false });
  const mode = (checks: string[], rung = 0, over: { rung?: number; interrupted?: boolean } = {}) => retryMode(prev(checks, over), rung).mode;

  it("keeps when only behaviour or the build was wrong, at the same rung", () => {
    expect(mode(["locked-failed"])).toBe("keep");
    expect(mode(["build", "locked-failed", "locked-failed"])).toBe("keep");
    expect(mode(["regression"])).toBe("keep");
    expect(mode(["new-failure", "locked-flaky"], 1, { rung: 1 })).toBe("keep");
    expect(retryMode(prev(["locked-failed"]), 0).reason).toMatch(/failed only on locked-failed/);
  });

  it("keeps on a move up the ladder when only behaviour or the build was wrong, and resets on anything else", () => {
    expect(retryMode(prev(["locked-failed"]), 1)).toEqual({ mode: "keep", reason: "moved from rung 0 to rung 1; the previous attempt failed only on locked-failed" });
    expect(mode(["regression"], 3, { rung: 2 })).toBe("keep");
    expect(mode(["build", "locked-failed"], 1)).toBe("keep");
    expect(retryMode(prev(["agent-error"]), 1).mode).toBe("reset");
    expect(retryMode(prev(["locked-failed", "secret"]), 1).mode).toBe("reset");
    expect(retryMode(prev([]), 1)).toEqual({ mode: "reset", reason: "moved from rung 0 to rung 1" });
  });

  it("tells the agent the limits of its session in whole dollars", () => {
    const note = limitsNote({ maxTurns: 80, maxUsd: 3.42, timeoutSec: 2700 }, "Return early.");
    expect(note).toContain("80 turns, 45 minutes or about $3 of model use");
    expect(note).toMatch(/Return early\.$/);
    expect(limitsNote({ maxTurns: 80, maxUsd: 0.4, timeoutSec: 60 }, "x")).toContain("about $1");
  });

  it("keeps on a move up the ladder when fewer locked tests failed than the attempt before", () => {
    const at = (checks: string[], locked?: number, lockedBefore?: number) => retryMode({ checks, rung: 0, interrupted: false, locked, lockedBefore }, 1);
    expect(at(["locked-failed"], 4, 20)).toEqual({ mode: "keep", reason: "fewer locked tests failed than the attempt before (4, was 20)" });
    expect(at(["locked-failed", "locked-flaky"], 1, 2).mode).toBe("keep");
    // not closer or nothing to compare with: still kept, as any behaviour failure is; a safety failure starts fresh
    expect(at(["locked-failed"], 20, 20).mode).toBe("keep");
    expect(at(["locked-failed"], 4).mode).toBe("keep");
    expect(at(["locked-failed", "build"], 4, 20).mode).toBe("keep");
    expect(at(["locked-failed", "secret"], 4, 20).mode).toBe("reset");
  });

  it("keeps the code of an attempt that stopped when the model account ran out of credit", () => {
    let seq = 0;
    const ev = (data: Record<string, unknown>) => [{ seq: seq++, ts: "", runId: "r", epoch: 0, type: "step.failed", key: "implement/TASK-1/1", data }] as LedgerEvent[];
    // parked with its commit: kept, at any rung, and not treated as an attempt that did not finish
    const kept = previousAttempt(ev({ rung: 0, parked: true, noCredit: true, commit: "abc" }), "implement/TASK-1", [])!;
    expect(kept).toMatchObject({ interrupted: false, noCredit: true, commit: "abc" });
    expect(retryMode(kept, 0)).toEqual({ mode: "keep", reason: "the previous attempt stopped when the model account ran out of credit" });
    // nothing was written before the credit ran out, or an ordinary park: start clean
    expect(retryMode(previousAttempt(ev({ rung: 0, parked: true, noCredit: true }), "implement/TASK-1", [])!, 0).mode).toBe("reset");
    expect(retryMode(previousAttempt(ev({ rung: 0, parked: true, commit: "abc" }), "implement/TASK-1", [])!, 0).mode).toBe("reset");
  });

  it("reads how many locked tests failed in the last two attempts", () => {
    let seq = 0;
    const ev = (type: string, key: string, data: Record<string, unknown> = {}) => ({ seq: seq++, ts: "", runId: "r", epoch: 0, type, key, data }) as LedgerEvent;
    const evs = [
      ev("step.failed", "implement/TASK-1/1", { rung: 0, category: "locked-test", lockedFailedIds: ["a", "b", "c"] }),
      ev("step.failed", "implement/TASK-2/1", { rung: 0, category: "locked-test", lockedFailedIds: ["a"] }),
      ev("step.failed", "implement/TASK-1/2", { rung: 0, category: "locked-test", lockedFailedIds: ["d"] }),
    ];
    expect(previousAttempt(evs, "implement/TASK-1", ["locked-failed"])).toMatchObject({ locked: 1, lockedBefore: 3 });
    expect(previousAttempt(evs, "implement/TASK-2", ["locked-failed"])).toEqual({ checks: ["locked-failed"], rung: 0, interrupted: false, commit: undefined, locked: 1 });
    // an attempt that ended on something else is no measure of how close the code was
    const other = [...evs, ev("step.failed", "implement/TASK-1/3", { rung: 1, category: "other" }), ev("step.failed", "implement/TASK-1/4", { rung: 1, category: "locked-test", lockedFailedIds: ["d"] })];
    expect(previousAttempt(other, "implement/TASK-1", ["locked-failed"])).toMatchObject({ locked: 1 });
    expect(previousAttempt(other, "implement/TASK-1", ["locked-failed"])!.lockedBefore).toBeUndefined();
  });

  it("resets after safety, scope, escape hatches, agent errors and bad evidence", () => {
    for (const c of ["lock-set", "config-integrity", "secret", "diff-in-scope", "escape-hatch", "agent-timeout", "agent-error", "exception", "evidence", "locked-not-executed", "expected-fail-passed"]) {
      expect(mode(["locked-failed", c]), c).toBe("reset");
    }
    expect(retryMode(prev(["locked-failed", "secret"]), 0).reason).toBe("the previous attempt failed on secret");
  });

  it("resets after an interrupted attempt, and on the first attempt", () => {
    expect(mode(["locked-failed"], 0, { interrupted: true })).toBe("reset");
    expect(retryMode(undefined, 0)).toEqual({ mode: "reset", reason: "no previous attempt" });
    expect(mode([])).toBe("reset");
  });

  it("reads the last attempt since the step last completed from the ledger", () => {
    let seq = 0;
    const ev = (type: string, key: string, data?: Record<string, unknown>) => ({ seq: seq++, ts: "", runId: "r", epoch: 0, type, key, data }) as LedgerEvent;
    const k = "implement/TASK-1";
    const failed = [ev("step.started", `${k}/1`), ev("step.failed", `${k}/1`, { rung: 0, commit: "abc" }), ev("step.started", `${k}/2`)];
    expect(previousAttempt(failed, k, ["locked-failed"])).toEqual({ checks: ["locked-failed"], rung: 0, interrupted: false, commit: "abc" });
    const crashed = [...failed, ev("step.interrupted", `${k}/2`), ev("step.started", `${k}/3`)];
    expect(previousAttempt(crashed, k, ["locked-failed"])!.interrupted).toBe(true);
    const parked = [ev("step.failed", `${k}/1`, { rung: 0, parked: true })];
    expect(previousAttempt(parked, k, [])!.interrupted).toBe(true);
    const done = [...failed, ev("step.completed", `${k}/2`), ev("step.started", `${k}/3`)];
    expect(previousAttempt(done, k, [])).toBeUndefined();
    expect(previousAttempt(failed, "implement/TASK-2", [])).toBeUndefined();
  });

  it("reads a budget stop that was stored as a plain agent error as out of budget, so its code is kept", () => {
    const stored = { check: "agent-error", message: "Claude Code returned an error result: Reached maximum budget ($5.003289200000005)" };
    expect(checkOf(stored)).toBe("agent-over-budget");
    expect(checkOf({ check: "agent-error", message: "socket hang up" })).toBe("agent-error");
    expect(checkOf({ check: "locked-failed", message: "Reached maximum budget" })).toBe("locked-failed");
    expect(retryMode(prev([checkOf(stored)]), 1).mode).toBe("keep");
  });

  it("keeps unfinished code (out of budget or turns) even after a move up the ladder", () => {
    expect(retryMode(prev(["agent-over-budget"]), 1)).toEqual({ mode: "keep", reason: "the previous attempt ran out of budget or turns" });
    expect(mode(["agent-timeout"], 2, { rung: 0 })).toBe("keep");
    expect(mode(["agent-over-budget"], 0, { interrupted: true })).toBe("reset");
    expect(mode(["agent-over-budget", "secret"])).toBe("reset");
  });

  it("the test writer keeps its tests after a fixable failure, at any rung, and starts again after a safety one", () => {
    for (const c of ["ac-coverage", "tests-compile", "test-not-found", "agent-over-budget", "agent-timeout", "passes-on-base", "wrong-failure-kind", "characterisation", "not-executed", "keep-passing"]) {
      expect(testRetryMode(prev([c], { rung: 1 })).mode, c).toBe("keep");
    }
    expect(testRetryMode(prev(["ac-coverage", "ac-coverage"])).reason).toBe("the previous attempt failed only on ac-coverage");
    for (const c of ["author-tests-scope", "author-tests-deleted", "author-tests-removed", "author-tests-skip", "agent-error", "agent-bad-output", "exception", "evidence"]) {
      expect(testRetryMode(prev(["ac-coverage", c])).mode, c).toBe("reset");
    }
    expect(testRetryMode(undefined).mode).toBe("reset");
    expect(testRetryMode(prev([])).mode).toBe("reset");
    // out of credit with its tests committed: kept, though the attempt has no failures to fix; a budget stop stored as a plain error reads as one
    expect(testRetryMode({ checks: [], rung: 1, interrupted: false, noCredit: true, commit: "abc" }).mode).toBe("keep");
    expect(testRetryMode(prev([{ check: "agent-error", message: "Claude Code returned an error result: Reached maximum budget ($4.01)" }].map(checkOf))).mode).toBe("keep");
    expect(testRetryMode(prev(["ac-coverage"], { interrupted: true })).mode).toBe("reset");
  });

  it("lifts a rejection that was only a wrong label, read again from the stored reports", () => {
    const trx = (msg: string) => `<?xml version="1.0"?><TestRun><TestDefinitions><UnitTest name="AC_1_2" id="t1"><TestMethod className="App.Tests.ContractTests" name="AC_1_2" /></UnitTest></TestDefinitions>
<Results><UnitTestResult testId="t1" testName="AC_1_2" outcome="Failed" duration="00:00:00.01"><Output><ErrorInfo><Message>${msg}</Message><StackTrace>   at App.Tests.ContractTests.AC_1_2() in /src/App.Tests/ContractTests.cs:line 33</StackTrace></ErrorInfo></Output></UnitTestResult></Results></TestRun>`;
    const ledgerWith = (msg: string, runner = "vstest") => {
      const blobs: Record<string, string> = { report: trx(msg), run: JSON.stringify({ runner, reportShas: ["report"] }) };
      return {
        events: () => [{ seq: 0, ts: "", runId: "r", epoch: 0, type: "gate.result", treeSha: "c1", data: { gateId: "author-tests.fails-on-base", inputs: { run1: "run", run2: "run" } } }] as LedgerEvent[],
        getJson: <T,>(sha: string) => JSON.parse(blobs[sha]!) as T, getArtifact: (sha: string) => Buffer.from(blobs[sha]!), hasArtifact: (sha: string) => sha in blobs,
      };
    };
    const wrong = [{ check: "wrong-failure-kind", testId: "app.tests::App.Tests.ContractTests.AC_1_2", message: "fails with exception", frames: [] }];
    expect(labelRejectionLifted(ledgerWith("29 differences:"), "c1", wrong)).toBe(true);
    // a real crash stays rejected, and so does anything the reports cannot show
    expect(labelRejectionLifted(ledgerWith("System.NullReferenceException : Object reference not set"), "c1", wrong)).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:"), "c2", wrong)).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:"), undefined, wrong)).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:", "vitest"), "c1", wrong)).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:"), "c1", [...wrong, { check: "ac-coverage", message: "No test for AC-1.1", frames: [] }])).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:"), "c1", [{ ...wrong[0]!, testId: "app.tests::App.Tests.Other.Missing" }])).toBe(false);
    expect(labelRejectionLifted(ledgerWith("29 differences:"), "c1", [])).toBe(false);
  });

  it("adds up what each attempt since the step last completed cost", () => {
    let seq = 0;
    const ev = (type: string, key: string, usd?: number) => ({ seq: seq++, ts: "", runId: "r", epoch: 0, type, key, data: usd === undefined ? {} : { "gen_ai.usage.cost_usd": usd } }) as LedgerEvent;
    const evs = [ev("usage", "design/1", 9), ev("step.completed", "design/1"), ev("usage", "design/2", 1.5), ev("usage", "design/2", 0.25), ev("usage", "design/3", 0.5), ev("usage", "design-export/1", 7)];
    expect(attemptSpend(evs, "design")).toEqual([1.75, 0.5]);
    expect(attemptSpend(evs, "plan")).toEqual([]);
  });

  it("starts a coding step's first attempt only with what an earlier step of its stage needed", () => {
    let seq = 0;
    const ev = (key: string, usd: number) => ({ seq: seq++, ts: "", runId: "r", epoch: 0, type: "usage", key, data: { "gen_ai.usage.cost_usd": usd } }) as LedgerEvent;
    const evs = [ev("author-tests/1", 6), ev("implement/TASK-1/1", 2.19), ev("implement/TASK-1/2", 2.5), ev("implement/TASK-1/2", 0.09), ev("implement/TASK-2/1", 0.4)];
    const step = (key: string, needsUsd?: number) => ({ key, stage: key.split("/")[0]!, needsUsd });
    expect(startNeed(evs, step("implement/TASK-3", 1))).toBeCloseTo(2.59);
    // its own attempts say more than its neighbours' (the retry rule reads those), and the first coding step has only the floor
    expect(startNeed(evs, step("implement/TASK-2", 1))).toBe(1);
    expect(startNeed([], step("implement/TASK-1", 1))).toBe(1);
    expect(startNeed(evs, step("review"))).toBeUndefined();
  });
});

describe("criterion tests that already pass on the old code", () => {
  const t = (acId: string, testId: string) => ({ acId, testId, failsOnBase: true });
  it("become must-keep-passing when some test in the run still fails on the old code", () => {
    const out = keepPassingTests([t("AC-1.1", "a"), t("AC-1.4", "k"), t("AC-2.1", "b")], new Set(["k", "b"]));
    expect(out.map((x) => [x.testId, x.failsOnBase])).toEqual([["a", true], ["k", false], ["b", false]]);
    // nothing fails today: nothing changes, and the fails-on-base check rejects the run
    expect(keepPassingTests([t("AC-1.1", "a")], new Set(["a"]))[0]!.failsOnBase).toBe(true);
  });
});

describe("integrate reuses the last task's run", () => {
  const run = { treeSha: "abc", valid: true, expectPass: ["t1", "t2", "c1"], compareToBaseline: ["b1", "b2"] };

  it("when the run judged the same commit and required at least what integrate requires", () => {
    expect(coversIntegrate(run, "abc", ["t1", "t2", "c1"], ["b1", "b2"])).toBe(true);
    expect(coversIntegrate(run, "abc", ["t1"], ["b1"])).toBe(true);
  });

  it("not for another commit, an invalid run, or a run that didn't require every locked test or the whole baseline", () => {
    expect(coversIntegrate(run, "def", ["t1"], ["b1"])).toBe(false);
    expect(coversIntegrate({ ...run, valid: false }, "abc", ["t1"], ["b1"])).toBe(false);
    expect(coversIntegrate(run, "abc", ["t1", "t3"], ["b1"])).toBe(false);
    expect(coversIntegrate(run, "abc", ["t1"], ["b1", "b3"])).toBe(false);
  });
});

describe("test writer: scope and tampering", () => {
  it("scope is test folders only", () => {
    for (const p of ["tests/Shop.Tests/OrdersTests.cs", "src/Shop.Tests/A.cs", "src/ShopTests/A.cs", "src/shop-tests/a.cs", "src/Shop_Test/A.cs", "test/a.cs", "src/Tests/A.cs", "x/test/a.cs", "src/MyApp.Tests.Unit/A.cs", "src/MyApp.Test.Helpers/A.cs", "web/src/__tests__/a.ts", "src/MyApp.tests.integration/A.cs", "src/my-app-tests.e2e/a.ts"])
      expect(matchesAny(p, TEST_SCOPE), p).toBe(true);
    for (const p of ["src/Latest/A.cs", "src/Contest/A.cs", "src/Attestation/A.cs", "src/Shop/OrdersTests.cs", "src/latest-test.cs", "src/Latest.Api/A.cs", "src/Contest.Web/A.cs", "src/latest.api/a.cs", "src/contest.web/a.cs"])
      expect(matchesAny(p, TEST_SCOPE), p).toBe(false);
  });

  it("may add files and lines; deleting, removing lines or adding skips fails", () => {
    const f = (status: string, added: string[] = [], removed: string[] = []) => ({ status, path: "tests/A.Tests/X.cs", added, removed });
    expect(testWriterTampering([f("A", ["[Fact] public void AC_1_1_X() {}"]), f("M", ["using Foo;"])])).toEqual([]);
    expect(testWriterTampering([f("D")]).map((x) => x.check)).toEqual(["author-tests-deleted"]);
    expect(testWriterTampering([f("M", ["[Fact] public void Old() {}"], ["[Fact] public void Old() { Assert.True(x); }"])]).map((x) => x.check)).toEqual(["author-tests-removed"]);
    expect(testWriterTampering([f("M", ['[Fact(Skip = "later")]'])]).map((x) => x.check)).toEqual(["author-tests-skip"]);
    expect(testWriterTampering([f("M", ['<Compile Remove="OrdersTests.cs" />'])]).map((x) => x.check)).toEqual(["author-tests-skip"]);
    expect(testWriterTampering([f("A", ["<IsTestProject>false</IsTestProject>"])]).map((x) => x.check)).toEqual(["author-tests-skip"]);
  });

  it("reads -U0 patches by hunk: '--' content lines count, a last line re-added for a missing newline doesn't", () => {
    const patch = ["diff --git a/x.sql b/x.sql", "--- a/x.sql", "+++ b/x.sql", "@@ -2 +1,0 @@", "--- seed", "@@ -9 +9,2 @@", "-}", "\\ No newline at end of file", "+}", "+// AC_1_1"].join("\n");
    expect(patchLines(patch)).toEqual({ added: ["}", "// AC_1_1"], removed: ["-- seed"] });
  });

  it("a removed line whose text also appears among the additions still counts (an existing test can't lose its [Fact])", () => {
    // removes [Fact] from the existing test, adds a new test that has its own [Fact]
    const patch = ["diff --git a/T.cs b/T.cs", "--- a/T.cs", "+++ b/T.cs", "@@ -3 +2,0 @@", "-    [Fact]", "@@ -5,0 +5,3 @@", "+", "+    [Fact]", "+    public void AC_1_1_New() { }"].join("\n");
    const lines = patchLines(patch);
    expect(lines.removed).toEqual(["    [Fact]"]);
    expect(testWriterTampering([{ status: "M", path: "tests/A.Tests/T.cs", ...lines }]).map((x) => x.check)).toEqual(["author-tests-removed"]);
    // a closing brace removed mid-file and re-added elsewhere is still a removal; only the no-newline last line is forgiven
    const brace = ["diff --git a/T.cs b/T.cs", "--- a/T.cs", "+++ b/T.cs", "@@ -4 +3,0 @@", "-}", "@@ -9,0 +9,1 @@", "+}"].join("\n");
    expect(patchLines(brace).removed).toEqual(["}"]);
  });
});

describe("the empty baseline is greenfield only (PR #17 follow-up)", () => {
  it("an empty repo skips the baseline only in a greenfield run; brownfield, estimate and design never even ask", () => {
    let asked = 0;
    const empty = () => { asked++; return true; };
    expect(usesEmptyBaseline("greenfield", empty)).toBe(true);
    expect(usesEmptyBaseline("greenfield", () => false)).toBe(false);
    asked = 0;
    for (const mode of ["brownfield", "estimate", "design", undefined]) expect(usesEmptyBaseline(mode, empty)).toBe(false);
    expect(asked).toBe(0);
  });
});

describe("a weak test goes back to its writer only while the ladder has somewhere to go", () => {
  const ctx = (o: { steps?: Record<string, unknown>; rung: number; attempt: number; extra?: number }) => ({
    project: ProjectConfig.parse({ project: "p", repo: "-", stack: "dotnet", ...(o.steps ? { steps: o.steps } : {}) }),
    policy: DEFAULT_POLICY, rung: o.rung, attempt: o.attempt, state: { capOverrides: { extraAttempts: o.extra ?? 0 } },
  }) as never;

  it("moves up a rung each time, and stops asking at the top: a failure there would park the run for a person", () => {
    // the first rungs always have more effort above them
    expect(rewriteHasRoom(ctx({ rung: 0, attempt: 1 }))).toBe(true);
    // a writer on the lighter model has a stronger one to move to; at that model there is nothing above
    const light = { "author-tests": { tier: "light" } };
    expect(rewriteHasRoom(ctx({ steps: light, rung: 1, attempt: 3 }))).toBe(true);
    expect(rewriteHasRoom(ctx({ steps: light, rung: 2, attempt: 4 }))).toBe(false);
    // a writer already on the strongest model stops one rung earlier
    expect(rewriteHasRoom(ctx({ steps: { "author-tests": { model: "claude-opus-5-5" } }, rung: 1, attempt: 3 }))).toBe(false);
  });

  it("never spends the step's last attempt on it", () => {
    expect(rewriteHasRoom(ctx({ rung: 0, attempt: DEFAULT_POLICY.retryBudget - 1 }))).toBe(true);
    expect(rewriteHasRoom(ctx({ rung: 0, attempt: DEFAULT_POLICY.retryBudget }))).toBe(false);
    expect(rewriteHasRoom(ctx({ rung: 0, attempt: DEFAULT_POLICY.retryBudget, extra: 2 }))).toBe(true);
  });
});
