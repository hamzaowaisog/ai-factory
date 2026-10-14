// The same locked test failed twice at a task: is the test wrong, or the code? (the test-defect check, A5)
// A reviewer's model reads the criterion, the test, the failure and the last change and says "code", "test" or "unclear".
// "code": the task goes on with the reason in its briefing. "test": the test writer rewrites that one test, it must fail
// again before the task's code and still assert what it did, and it is locked again. "scope": the test is right and needs a
// file another task of the plan lists, which opens to this task. "unclear": the run stops for a person.
// This file holds the parts with no lab and no agent in them; the coding step (build.ts) runs the check.
import { z } from "zod";
import type { LedgerEvent } from "../contracts/index.js";

export type TestVerdict = "code" | "test" | "scope" | "unclear";

/** One locked test judged in a run, as its `test.judged` event records it. */
export interface Judged {
  /** the step that asked (the coding task) */ step: string;
  testId: string; acId: string; file: string;
  verdict: TestVerdict;
  why: string;
  /** "test": the test as rewritten and locked again */
  rewritten?: { sha: string; was: string; commit: string; run: string };
  /** "test": why the rewrite was not accepted (the old test stays locked); "scope": why no file could be opened */
  rejected?: string;
  /** "scope": the files of other tasks opened to this task, so its change may reach them */
  opened?: string[];
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

/** The files opened to a task by the check, beyond the plan's list for it (each is in a `test.judged` event, so the pull request can name it). */
export function openedFiles(events: LedgerEvent[], stepKey?: string): { step: string; file: string; testId: string; acId: string; why: string }[] {
  const seen = new Set<string>();
  return judgedTests(events).filter((j) => j.verdict === "scope" && (!stepKey || j.step === stepKey))
    .flatMap((j) => (j.opened ?? []).map((file) => ({ step: j.step, file, testId: j.testId, acId: j.acId, why: j.why })))
    .filter((o) => !seen.has(`${o.step}\n${o.file}`) && !!seen.add(`${o.step}\n${o.file}`));
}

/** How many files one verdict may open: a test that needs more than a few of another task's files is a fault in the plan. */
export const OPEN_MAX = 5;

/**
 * Which of the files a "scope" verdict names may open to the task, and why the others may not. Only a file the approved plan
 * lists for some task of this run opens: the plan was approved with it as part of the change, so the file-scope check (a
 * safety check) is not widened past what a person saw. A locked file, a test and a file nobody planned to change never open.
 */
export function filesToOpen(named: string[], a: { mine: string[]; planned: string[]; locked: string[]; tests: string[]; matches: (file: string, globs: string[]) => boolean }): { open: string[]; refused: string[] } {
  const open: string[] = [], refused: string[] = [];
  for (const raw of [...new Set(named.map((f) => f.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))]) {
    if (a.matches(raw, a.mine)) continue;
    if (raw.includes("*") || raw.startsWith("/") || raw.split("/").includes("..")) refused.push(`${raw} (not a file in the repo)`);
    else if (a.locked.includes(raw)) refused.push(`${raw} (locked)`);
    else if (a.matches(raw, a.tests)) refused.push(`${raw} (a test)`);
    else if (!a.matches(raw, a.planned)) refused.push(`${raw} (no task of the plan lists it)`);
    else if (open.length >= OPEN_MAX) refused.push(`${raw} (more than ${OPEN_MAX} files)`);
    else open.push(raw);
  }
  return { open, refused };
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
    verdict: z.enum(["code", "test", "scope", "unclear"]),
    /** one or two sentences: what in the test or in the code is wrong, for whoever fixes it */
    why: z.string(),
    /** "scope": the files outside the task's list that must change for the test to pass, as paths in the repo */
    files: z.array(z.string()).default([]),
  })),
});

/** What the check of a rewritten test answers: it still asserts what the locked test did, or it asserts less. */
export const RewriteCheckOut = z.object({
  verdicts: z.array(z.object({ testId: z.string(), verdict: z.enum(["keeps", "loosened"]), why: z.string() })),
});

export const REWRITE_CHECK_TEMPLATE = `A locked acceptance test was found to be wrong in one respect and has been rewritten. Check the rewrite of each test in "tests" against the test as it was locked.
You get each test's criterion, what was found wrong with it ("why"), and the change made to its file (lines with - are the locked test, lines with + the rewrite).
- "keeps": apart from fixing what "why" names, the rewrite asserts everything the locked test asserted. Changing a wait, a selector, an import, a set-up step or the one wrong value named in "why" keeps it.
- "loosened": the rewrite removes or weakens an assertion that "why" does not name: a check deleted, an exact value turned into "anything", a case dropped, the test body emptied or made to pass on any code.
Judge only what the change removed or weakened. The locked test was accepted as it was: do not ask the rewrite for assertions the locked test never had.
Answer with one verdict per test, by its testId, and say in "why" which assertion was lost, quoting its line.`;

export const JUDGE_TEMPLATE = `A locked acceptance test failed on two attempts of a coding task. Decide, for each test in "tests", whether the code or the test is wrong.
You get the criterion each test was written for, the test (open its file), how it failed, the change the last attempt made, and which files the task may change.
- "code": the test asks for what the criterion says, and code this task may write could make it pass. The last attempt simply does not do it yet. This is the usual case: choose it unless you can point at the fault in the test.
- "test": the test itself is wrong. It asserts something the criterion does not ask for or that contradicts it (another message, status code, order, field name or value); it sets up or looks for something in a way no correct code would satisfy (a wrong import, selector, label or route, a wait shorter than the answer it waits for); or it can only pass by changing a file under "locked" (a locked test, the generated API client, the contract) or another repo's behaviour. Quote the line of the test that is at fault.
- "scope": the test asks for what the criterion says, and the only thing in the way is the task's file list: to pass, a file that is neither under "mayChange" nor under "locked" has to change (a screen, a route or a shared module another task lists). Give those files in "files", as paths in the repo, the fewest that are needed. Do not choose this for a file under "locked", and do not choose it when code in "mayChange" could make the test pass.
- "unclear": the criterion can be read both ways, or you cannot tell from what you have.
Judge only against the criterion's own words. A test is not wrong because it is strict, and code is not right because it is reasonable.
A test is also wrong when it fails for a reason other than the code: it reads the real date or time, relies on rows or state another test left behind, expects an order the criterion does not name, compares a computed decimal exactly, asserts a generated value, or looks a value up page-wide when it appears more than once. Say which, and name the line that holds the wrong value or the shared set-up at fault.
Answer with one verdict per test, by its testId. In "why", say what is wrong in a sentence or two that the one who fixes it can act on.`;

export const REWRITE_RULES = `A locked acceptance test was found to be wrong, and you are rewriting it. Everything else stays locked.
- Change only the tests named in "tests-to-fix", in the files they are in. Keep each test's name (its it() title or method name) exactly as it is.
- Do not change, remove or skip any other test in those files, and do not touch any other file: no production code, no other test, no test support file.
- When "why" names the file's shared set-up as the fault (a fixture, a helper, a beforeEach or a class constructor, for example one database shared by every test, or a value read from the real clock), you may change that set-up too. Change no other test's own body.
- Fix what "why" says is wrong, and nothing more. The test must still prove its criterion in full: every value, message and case the criterion names.
- The code for this criterion may already be in the checkout. Do not read it to decide what to assert: assert what the criterion says. A test bent to whatever the code does today proves nothing.
- The test must fail on the code as it was before this task, with a failed assertion or "not implemented", and the factory checks that.`;

/** A file-by-file answer for the briefing of the task that goes on after a check. */
export function verdictNote(judged: Judged[]): string | undefined {
  if (!judged.length) return undefined;
  const code = judged.filter((j) => j.verdict === "code"), fixed = judged.filter((j) => j.rewritten), opened = judged.filter((j) => j.opened?.length);
  return [
    ...(code.length ? [`TEST CHECK. These locked tests failed twice, so a reviewer read each against its criterion and your last change. The tests are right and the code is not; they stay locked, so change the code:\n${code.map((j) => `- ${j.testId} (${j.acId}): ${j.why}`).join("\n")}`] : []),
    ...(fixed.length ? [`TEST CHECK. These locked tests failed twice and were found to be wrong. Each was rewritten and locked again, so read it again before you change any code:\n${fixed.map((j) => `- ${j.testId} (${j.acId}) in ${j.file}: ${j.why}`).join("\n")}`] : []),
    ...(opened.length ? [`TEST CHECK. These locked tests failed twice and are right, but they could not pass with this task's own files. The files named are open to you now; change in them only what the test needs, and leave the rest to the task that builds them:\n${opened.map((j) => `- ${j.testId} (${j.acId}): ${j.opened!.join(", ")}. ${j.why}`).join("\n")}`] : []),
  ].join("\n\n") || undefined;
}

/** What the run stops with when a check does not settle a test. */
export function parkReason(open: Judged[]): string {
  return `${open.length === 1 ? "A locked test" : `${open.length} locked tests`} failed twice and the test-or-code check did not settle ${open.length === 1 ? "it" : "them"}: ${open.map((j) =>
    `${j.testId} (${j.acId}): ${j.verdict === "scope" ? `the test is right but needs a file this task may not change (${j.why}), and none could be opened: ${j.rejected ?? "no file was named"}`
      : j.rejected ? `the test was judged wrong (${j.why}), but its rewrite was not accepted: ${j.rejected}` : j.why || "the check gave no verdict"}`).join("; ")}. Read the test and the last attempt's change, then resume or stop the run.`;
}

/** A locked test left out of the checks in a lenient run (lenientTests), with why. */
export interface Disputed { step: string; testId: string; acId: string; file: string; why: string }

/** Every locked test disputed in this run, oldest first, once each. */
export function disputedTests(events: LedgerEvent[]): Disputed[] {
  const seen = new Map<string, Disputed>();
  for (const e of events) if (e.type === "test.disputed") { const d = e.data as unknown as Disputed; if (!seen.has(d.testId)) seen.set(d.testId, d); }
  return [...seen.values()];
}

/** Whether a run lets a wrong locked test go instead of parking (lenientTests, or FACTORY_LENIENT_TESTS=1). */
export const lenientTests = (project: { lenientTests?: boolean }): boolean => project.lenientTests ?? process.env.FACTORY_LENIENT_TESTS === "1";
