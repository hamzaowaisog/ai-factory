// The same locked test failed twice at a task: is the test wrong, or the code? (the test-defect check, A5)
// A reviewer's model reads the criterion, the test, the failure and the last change and says "code", "test" or "unclear".
// "code": the task goes on with the reason in its briefing. "test": the test writer rewrites that one test, it must fail
// again before the task's code and prove its criterion, and it is locked again. "unclear": the run stops for a person.
// This file holds the parts with no lab and no agent in them; the coding step (build.ts) runs the check.
import { z } from "zod";
import type { LedgerEvent } from "../contracts/index.js";

export type TestVerdict = "code" | "test" | "unclear";

/** One locked test judged in a run, as its `test.judged` event records it. */
export interface Judged {
  /** the step that asked (the coding task) */ step: string;
  testId: string; acId: string; file: string;
  verdict: TestVerdict;
  why: string;
  /** "test": the test as rewritten and locked again */
  rewritten?: { sha: string; was: string; commit: string; run: string };
  /** "test": why the rewrite was not accepted (the old test stays locked) */
  rejected?: string;
}

/** Every locked test judged in this run, oldest first. Each is judged once: the ladder does not ask about it again. */
export function judgedTests(events: LedgerEvent[]): Judged[] {
  return events.filter((e) => e.type === "test.judged").map((e) => e.data as unknown as Judged);
}

/** The locked test files rewritten in this run: the newest accepted rewrite of each. */
export function rewrittenTests(events: LedgerEvent[]): (Judged & { rewritten: NonNullable<Judged["rewritten"]> })[] {
  const by = new Map<string, Judged & { rewritten: NonNullable<Judged["rewritten"]> }>();
  for (const j of judgedTests(events)) if (j.rewritten) by.set(j.file, j as Judged & { rewritten: NonNullable<Judged["rewritten"]> });
  return [...by.values()];
}

/** A lock with its rewritten test files at the hash they were locked again with, and each rewrite named as a test-defect unlock. */
export function relocked<L extends { lock: { file: string; sha: string }[]; unlocks?: unknown[] }>(lock: L, events: LedgerEvent[], boundTo: string): L {
  const rw = rewrittenTests(events).filter((j) => lock.lock.some((l) => l.file === j.file));
  if (!rw.length) return lock;
  const sha = new Map(rw.map((j) => [j.file, j.rewritten.sha]));
  return {
    ...lock,
    lock: lock.lock.map((l) => (sha.has(l.file) ? { ...l, sha: sha.get(l.file)! } : l)),
    unlocks: [...(lock.unlocks ?? []), ...rw.map((j) => ({ what: j.file, acId: j.acId, human: "factory (test-defect check)", reason: `test-defect: ${j.why}`, boundTo }))],
  };
}

/**
 * The locked tests the ladder sent for a check after this step's last failed attempt, less those judged since.
 * `stepKey` is the step's own key; its attempts are recorded as `<stepKey>/<n>`.
 */
export function testsToJudge(events: LedgerEvent[], stepKey: string): string[] {
  const last = [...events].reverse().find((e) => e.type === "step.failed" && String(e.key ?? "").startsWith(`${stepKey}/`));
  const asked = (last?.data as { testCheck?: string[] } | undefined)?.testCheck ?? [];
  const done = new Set(judgedTests(events).map((j) => j.testId));
  return asked.filter((id) => !done.has(id));
}

export const JudgeOut = z.object({
  verdicts: z.array(z.object({
    testId: z.string(),
    verdict: z.enum(["code", "test", "unclear"]),
    /** one or two sentences: what in the test or in the code is wrong, for whoever fixes it */
    why: z.string(),
  })),
});

export const JUDGE_TEMPLATE = `A locked acceptance test failed on two attempts of a coding task. Decide, for each test in "tests", whether the code or the test is wrong.
You get the criterion each test was written for, the test (open its file), how it failed, the change the last attempt made, and which files the task may change.
- "code": the test asks for what the criterion says, and code this task may write could make it pass. The last attempt simply does not do it yet. This is the usual case: choose it unless you can point at the fault in the test.
- "test": the test itself is wrong. It asserts something the criterion does not ask for or that contradicts it (another message, status code, order, field name or value); it sets up or looks for something in a way no correct code would satisfy (a wrong import, selector, label or route); or it can only pass by changing a file the task may not change (a locked file, the generated API client, the contract, another repo's behaviour). Quote the line of the test that is at fault.
- "unclear": the criterion can be read both ways, or you cannot tell from what you have.
Judge only against the criterion's own words. A test is not wrong because it is strict, and code is not right because it is reasonable.
Answer with one verdict per test, by its testId. In "why", say what is wrong in a sentence or two that the one who fixes it can act on.`;

export const REWRITE_RULES = `A locked acceptance test was found to be wrong, and you are rewriting it. Everything else stays locked.
- Change only the tests named in "tests-to-fix", in the files they are in. Keep each test's name (its it() title or method name) exactly as it is.
- Do not change, remove or skip any other test in those files, and do not touch any other file: no production code, no other test, no test support file.
- Fix what "why" says is wrong, and nothing more. The test must still prove its criterion in full: every value, message and case the criterion names.
- The code for this criterion may already be in the checkout. Do not read it to decide what to assert: assert what the criterion says. A test bent to whatever the code does today proves nothing.
- The test must fail on the code as it was before this task, with a failed assertion or "not implemented", and the factory checks that.`;

/** A file-by-file answer for the briefing of the task that goes on after a check. */
export function verdictNote(judged: Judged[]): string | undefined {
  if (!judged.length) return undefined;
  const code = judged.filter((j) => j.verdict === "code"), fixed = judged.filter((j) => j.rewritten);
  return [
    ...(code.length ? [`TEST CHECK. These locked tests failed twice, so a reviewer read each against its criterion and your last change. The tests are right and the code is not; they stay locked, so change the code:\n${code.map((j) => `- ${j.testId} (${j.acId}): ${j.why}`).join("\n")}`] : []),
    ...(fixed.length ? [`TEST CHECK. These locked tests failed twice and were found to be wrong. Each was rewritten and locked again, so read it again before you change any code:\n${fixed.map((j) => `- ${j.testId} (${j.acId}) in ${j.file}: ${j.why}`).join("\n")}`] : []),
  ].join("\n\n") || undefined;
}

/** What the run stops with when a check does not settle a test. */
export function parkReason(open: Judged[]): string {
  return `${open.length === 1 ? "A locked test" : `${open.length} locked tests`} failed twice and the test-or-code check did not settle ${open.length === 1 ? "it" : "them"}: ${open.map((j) =>
    `${j.testId} (${j.acId}): ${j.rejected ? `the test was judged wrong (${j.why}), but its rewrite was not accepted: ${j.rejected}` : j.why || "the check gave no verdict"}`).join("; ")}. Read the test and the last attempt's change, then resume or stop the run.`;
}
