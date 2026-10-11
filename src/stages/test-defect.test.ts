import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts/index.js";
import { DEFAULT_LADDER, nextOnFailure, RUNGS, type AttemptRecord } from "../gates/ladder.js";
import { judgedTests, parkReason, relocked, rewrittenTests, testsToJudge, verdictNote, type Judged } from "./test-defect.js";

let seq = 0;
const ev = (type: string, key: string, data: Record<string, unknown>): LedgerEvent => ({ seq: ++seq, type, key, data } as unknown as LedgerEvent);
const j = (over: Partial<Judged>): Judged => ({ step: "implement/TASK-2", testId: "T::a", acId: "AC-1.1", file: "tests/a.test.ts", verdict: "code", why: "the handler returns 200, the criterion says 201", ...over });
const judged = (over: Partial<Judged>) => ev("test.judged", over.step ?? "implement/TASK-2", j(over) as unknown as Record<string, unknown>);
const rewritten = { sha: "new", was: "old", commit: "c1", run: "r1" };

describe("the test-or-code check: what the ledger says", () => {
  it("asks about the tests of the step's last failed attempt, once each", () => {
    const failed = ev("step.failed", "implement/TASK-2/2", { testCheck: ["T::a", "T::b"] });
    expect(testsToJudge([failed], "implement/TASK-2")).toEqual(["T::a", "T::b"]);
    expect(testsToJudge([failed, judged({ testId: "T::a" })], "implement/TASK-2")).toEqual(["T::b"]);
    // another task's failure, and a later failure of this task that asks nothing
    expect(testsToJudge([failed], "implement/TASK-20")).toEqual([]);
    expect(testsToJudge([failed], "implement/TASK")).toEqual([]);
    expect(testsToJudge([failed, ev("step.failed", "implement/TASK-2/3", {})], "implement/TASK-2")).toEqual([]);
  });

  it("locks a rewritten file at its new content and names the rewrite as an unlock", () => {
    const lock = { tests: [], lock: [{ file: "tests/a.test.ts", sha: "old" }, { file: "tests/b.test.ts", sha: "b" }] };
    expect(relocked(lock, [], "lock1")).toBe(lock);
    // a verdict with no accepted rewrite changes nothing
    expect(relocked(lock, [judged({}), judged({ verdict: "test", rejected: "it still passes" })], "lock1")).toBe(lock);
    const out = relocked(lock, [judged({ verdict: "test", rewritten }), judged({ verdict: "test", rewritten: { ...rewritten, sha: "newer", was: "new" } })], "lock1");
    expect(out.lock).toEqual([{ file: "tests/a.test.ts", sha: "newer" }, { file: "tests/b.test.ts", sha: "b" }]);
    expect(out.unlocks).toEqual([expect.objectContaining({ what: "tests/a.test.ts", acId: "AC-1.1", boundTo: "lock1", human: "factory (test-defect check)" })]);
    // a file a person unlocked is no longer in the lock, so its rewrite is not put back in
    expect(relocked({ tests: [], lock: [{ file: "tests/b.test.ts", sha: "b" }] }, [judged({ verdict: "test", rewritten })], "lock1").lock).toEqual([{ file: "tests/b.test.ts", sha: "b" }]);
  });

  it("lists every verdict and the newest accepted rewrite of each file", () => {
    const events = [judged({}), judged({ testId: "T::b", verdict: "test", rewritten }), ev("step.failed", "implement/TASK-2/3", {})];
    expect(judgedTests(events).map((x) => x.testId)).toEqual(["T::a", "T::b"]);
    expect(rewrittenTests(events).map((x) => x.testId)).toEqual(["T::b"]);
  });

  it("tells the coding task which tests are right and which were rewritten", () => {
    expect(verdictNote([])).toBeUndefined();
    expect(verdictNote([j({ verdict: "unclear" })])).toBeUndefined();
    const note = verdictNote([j({}), j({ testId: "T::b", verdict: "test", why: "it looks for a label the screen does not have", rewritten })])!;
    expect(note).toContain("The tests are right and the code is not");
    expect(note).toContain("- T::a (AC-1.1): the handler returns 200");
    expect(note).toContain("- T::b (AC-1.1) in tests/a.test.ts: it looks for a label");
  });

  it("says why the run stopped", () => {
    expect(parkReason([j({ verdict: "unclear", why: "" })])).toContain("the check gave no verdict");
    expect(parkReason([j({ verdict: "test", why: "wrong status", rejected: "it still passes on the old code" }), j({ testId: "T::b", verdict: "unclear", why: "reads both ways" })]))
      .toMatch(/^2 locked tests failed twice.*rewrite was not accepted: it still passes on the old code; T::b \(AC-1.1\): reads both ways/);
  });
});

describe("the ladder after a test-or-code check", () => {
  const opts = (a5Done: string[]) => ({ ...DEFAULT_LADDER, availableRungs: new Set(RUNGS), backoffSpentMs: 0, a5Done: new Set(a5Done) });
  const fail = (ids: string[], signature: string): AttemptRecord => ({ category: "locked-test", lockedFailedIds: ids, signature, rung: 0 });

  it("asks once about a test, then goes on climbing", () => {
    const h = [fail(["T::a"], "x"), fail(["T::a"], "y")];
    expect(nextOnFailure(h, opts([]))).toMatchObject({ action: "a5-check", testIds: ["T::a"] });
    // the executor's second look, with the tests it is about to send for a check counted as done
    expect(nextOnFailure(h, opts(["T::a"])).action).toBe("retry");
    // a third failure of the same test does not ask again; another test failing twice does
    expect(nextOnFailure([...h, fail(["T::a"], "z")], opts(["T::a"])).action).not.toBe("a5-check");
    expect(nextOnFailure([...h, fail(["T::a", "T::b"], "z"), fail(["T::b"], "w")], opts(["T::a"]))).toMatchObject({ action: "a5-check", testIds: ["T::b"] });
  });
});
