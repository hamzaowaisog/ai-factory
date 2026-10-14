import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts/index.js";
import { DEFAULT_LADDER, nextOnFailure, RUNGS, type AttemptRecord } from "../gates/ladder.js";
import { matchesAny } from "../util/glob.js";
import { filesToOpen, judgedTests, lenientTests, openedFiles, OPEN_MAX, parkReason, relocked, rewrittenTests, settledTests, testsToJudge, verdictNote, type Judged } from "./test-defect.js";

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

  it("asks once more about a rewritten test that fails again, and never a third time (run ae5c, TASK-10)", () => {
    const failed = ev("step.failed", "implement/TASK-2/4", { testCheck: ["T::a"] });
    const first = judged({ verdict: "test", rewritten });
    expect(testsToJudge([first, failed], "implement/TASK-2")).toEqual(["T::a"]);
    expect(settledTests([first])).toEqual(new Set());
    // judged as the code's fault, a rewrite refused, or judged twice: settled
    expect(settledTests([judged({ verdict: "code" })])).toEqual(new Set(["T::a"]));
    expect(settledTests([judged({ verdict: "test", rejected: "touched another test" })])).toEqual(new Set(["T::a"]));
    expect(testsToJudge([first, judged({ verdict: "test", rewritten }), failed], "implement/TASK-2")).toEqual([]);
  });

  it("is lenient by default; a project or FACTORY_LENIENT_TESTS=0 turns it off", () => {
    const was = process.env.FACTORY_LENIENT_TESTS;
    try {
      delete process.env.FACTORY_LENIENT_TESTS;
      expect([lenientTests({}), lenientTests({ lenientTests: false })]).toEqual([true, false]);
      process.env.FACTORY_LENIENT_TESTS = "0";
      expect([lenientTests({}), lenientTests({ lenientTests: true })]).toEqual([false, true]);
    } finally { process.env.FACTORY_LENIENT_TESTS = was; }
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

describe("the test-or-code check: a test that needs another task's file", () => {
  const a = { mine: ["components/screens/s-4/container.tsx"], planned: ["components/screens/s-4/container.tsx", "components/screens/s-41/container.tsx", "lib/auth/**"], locked: ["tests/a.test.tsx", "lib/api/client.ts"], tests: ["tests/**"], matches: matchesAny };

  it("opens only a file the plan lists for some task, as run 9fcb needed", () => {
    // TASK-5's test opened screen 41, which TASK-42 builds
    expect(filesToOpen(["components/screens/s-41/container.tsx"], a)).toEqual({ open: ["components/screens/s-41/container.tsx"], refused: [] });
    expect(filesToOpen(["./lib/auth/session.ts", "lib/auth/session.ts"], a).open).toEqual(["lib/auth/session.ts"]);
    // its own file needs no opening
    expect(filesToOpen(["components/screens/s-4/container.tsx"], a)).toEqual({ open: [], refused: [] });
  });

  it("never opens a locked file, a test, a file nobody planned to change, or a path that is not one file", () => {
    const r = filesToOpen(["lib/api/client.ts", "tests/a.test.tsx", "tests/new.test.tsx", "next.config.js", "../other/x.ts", "/etc/passwd", "lib/auth/*"], { ...a, planned: [...a.planned, "lib/api/**", "tests/**"] });
    expect(r.open).toEqual([]);
    expect(r.refused).toEqual(["lib/api/client.ts (locked)", "tests/a.test.tsx (locked)", "tests/new.test.tsx (a test)", "next.config.js (no task of the plan lists it)", "../other/x.ts (not a file in the repo)", "/etc/passwd (not a file in the repo)", "lib/auth/* (not a file in the repo)"]);
  });

  it("opens a few files at most", () => {
    const many = Array.from({ length: OPEN_MAX + 2 }, (_, i) => `lib/auth/f${i}.ts`);
    const r = filesToOpen(many, a);
    expect(r.open).toHaveLength(OPEN_MAX);
    expect(r.refused).toEqual([`lib/auth/f${OPEN_MAX}.ts (more than ${OPEN_MAX} files)`, `lib/auth/f${OPEN_MAX + 1}.ts (more than ${OPEN_MAX} files)`]);
  });

  it("reads the openings back from the ledger, tells the task, and says why a run stopped when nothing could open", () => {
    const events = [judged({ step: "implement/TASK-5", verdict: "scope", why: "the denial is drawn by screen 41", opened: ["components/screens/s-41/container.tsx"] }),
      judged({ step: "implement/TASK-5", testId: "T::b", verdict: "scope", opened: ["components/screens/s-41/container.tsx"] }),
      judged({ step: "implement/TASK-6", testId: "T::c", verdict: "scope", rejected: "next.config.js (no task of the plan lists it)" })];
    expect(openedFiles(events)).toEqual([{ step: "implement/TASK-5", file: "components/screens/s-41/container.tsx", testId: "T::a", acId: "AC-1.1", why: "the denial is drawn by screen 41" }]);
    expect(openedFiles(events, "implement/TASK-6")).toEqual([]);
    const note = verdictNote(judgedTests(events).filter((x) => x.step === "implement/TASK-5"))!;
    expect(note).toContain("are right, but they could not pass with this task's own files");
    expect(note).toContain("- T::a (AC-1.1): components/screens/s-41/container.tsx. the denial is drawn by screen 41");
    expect(parkReason(judgedTests(events).filter((x) => x.rejected))).toContain("the test is right but needs a file this task may not change");
    // an opening changes no lock
    const lock = { tests: [], lock: [{ file: "tests/a.test.ts", sha: "old" }] };
    expect(relocked(lock, events, "lock1")).toBe(lock);
  });
});
