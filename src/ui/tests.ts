// The Tests page of a run: every requirement, its acceptance criteria, the locked test that is meant to prove each one, how
// that test ran, what the reviewer said about it and what a person signed off by hand. Read from the ledger; pure code, no model.
import type { AcceptanceTests, Requirement, ReviewCoverage, TestRun } from "../contracts/index.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay, type RunState } from "../ledger/state.js";
import { readOutput } from "../stages/framework.js";
import { MANUAL_CARD, lastSignOff, type ManualBundle } from "../stages/manual-check.js";

const PROOF_GATE = "review.tests-prove-criteria";

/** proven: the reviewer read the test and it asserts the criterion · weak, no-test: the reviewer's other verdicts ·
 *  passing, failing, flaky: how the locked test last ran, before any review · locked: written and locked, not run on the new code yet ·
 *  not-written: no test yet · by-hand, signed, failed-by-hand: a criterion a person checks */
export type CriterionState = "proven" | "weak" | "no-test" | "passing" | "failing" | "flaky" | "locked" | "not-written" | "by-hand" | "signed" | "failed-by-hand";

export interface TestRow { testId: string; name: string; file: string; outcome?: string; flaky?: boolean; message?: string }
export interface ProbeRow { method: string; path: string; status: number; expectStatus: number }
export interface CriterionRow {
  id: string; given: string; when: string; then: string; level: string; state: CriterionState;
  tests: TestRow[]; probes: ProbeRow[];
  review?: { verdict: ReviewCoverage["verdict"]; why: string };
  manual?: { result: "pass" | "fail"; note: string; by: string };
}
export interface TestsMetrics {
  requirements: number; criteria: number; automated: number; byHand: number;
  /** automated criteria that have a locked test */
  withTest: number;
  /** what the reviewer said about the automated criteria; all zero until a review exists */
  proven: number; weak: number; noTest: number;
  lockedTests: number; passing: number; failing: number; flaky: number; characterisation: number;
  probes: { sent: number; ok: number };
  signedOff: number; failedByHand: number;
  /** times the test writer ran before its tests were accepted and locked */
  writerAttempts: number;
  nfrs: number;
}
export interface TestsView {
  runId: string; none?: string;
  /** how far the run's tests have come, and so what the rows can show */
  stage?: "spec" | "locked" | "run" | "reviewed";
  note?: string;
  /** the code commit the results are for */
  commit?: string;
  metrics?: TestsMetrics;
  requirements?: { id: string; text: string; op: string; criteria: CriterionRow[] }[];
  characterisation?: { target: string; testId: string; file: string; outcome?: string }[];
  /** non-functional requirements: listed because nothing tests them yet */
  nfrs?: { id: string; text: string; metric: string }[];
  /** the gate that reads the reviewer's verdicts, and the person who accepted a failing one */
  proof?: { passed: boolean; details: string; waivedBy?: string; reason?: string };
  /** the open manual-check card, answered on this page */
  signOff?: { hash: string; criteria: string[] };
}

type Lock = Pick<AcceptanceTests, "tests"> & { characterisation?: { target: string; file: string; testId: string }[] };
interface Evidence { items: { ac: string; http?: ProbeRow[] }[] }

/** The review the page shows: the finished step's, or the one a card of the review step is holding while a person decides. */
function reviewOf(s: RunState, ledger: Ledger): { coverage: ReviewCoverage[] } | undefined {
  const done = readOutput<{ coverage?: ReviewCoverage[] }>(s, ledger, "review");
  if (done) return { coverage: done.coverage ?? [] };
  const ev = [...ledger.events()].reverse().find((e) => e.type === "human.requested" && (e.data as { step?: string }).step === "review");
  const sha = (ev?.data as { reviewSha?: string } | undefined)?.reviewSha;
  if (!sha) return undefined;
  try { return { coverage: ledger.getJson<{ coverage?: ReviewCoverage[] }>(sha).coverage ?? [] }; } catch { return undefined; }
}

export function testsView(ledger: Ledger): TestsView {
  const s = replay(ledger.events());
  const runId = ledger.runId;
  const spec = readOutput<{ requirements: Requirement[]; nfrs?: { id: string; text: string; metric: string }[] }>(s, ledger, "specify");
  if (!spec?.requirements?.length) return { runId, none: "No acceptance criteria yet. They appear here as soon as the spec is written, and each one gets its test when the tests are written and locked." };

  const lock = readOutput<Lock>(s, ledger, "author-tests");
  const run = readOutput<TestRun>(s, ledger, "accept", "testRun") ?? readOutput<TestRun>(s, ledger, "integrate");
  const evidence = readOutput<Evidence>(s, ledger, "accept");
  const review = reviewOf(s, ledger);
  const commit = String(s.steps.get("integrate")?.data?.commit ?? "");
  const signed = lastSignOff(s, ledger);
  // a sign-off is for one commit: after the code changes it no longer counts
  const checks = signed && signed.commit === commit ? signed : undefined;

  const results = new Map((run?.results ?? []).map((r) => [r.id, r]));
  const verdicts = new Map((review?.coverage ?? []).map((c) => [c.acId, c]));
  const row = (a: Requirement["acceptance"][number]): CriterionRow => {
    const tests: TestRow[] = (lock?.tests ?? []).filter((t) => t.acId === a.id).map((t) => {
      const r = results.get(t.testId);
      return { testId: t.testId, name: t.name, file: t.file, ...(r ? { outcome: r.outcome, ...(r.flaky ? { flaky: true } : {}), ...(r.outcome === "failed" && r.message ? { message: r.message.slice(0, 300) } : {}) } : {}) };
    });
    const probes = (evidence?.items.find((i) => i.ac === a.id)?.http ?? []).map((p) => ({ method: p.method, path: p.path, status: p.status, expectStatus: p.expectStatus }));
    const base = { id: a.id, given: a.given, when: a.when, then: a.then, level: a.level, tests, probes };
    if (a.level === "manual") {
      const c = checks?.checks[a.id];
      return { ...base, state: c ? (c.result === "pass" ? "signed" : "failed-by-hand") : "by-hand", ...(c ? { manual: { ...c, by: checks!.by } } : {}) };
    }
    const v = verdicts.get(a.id);
    const ran = tests.filter((t) => t.outcome);
    const state: CriterionState = v ? (v.verdict === "proves-it" ? "proven" : v.verdict)
      : !tests.length ? "not-written"
      : !ran.length ? "locked"
      : ran.some((t) => t.outcome !== "passed") || probes.some((p) => p.status !== p.expectStatus) ? "failing"
      : ran.some((t) => t.flaky) ? "flaky" : "passing";
    return { ...base, state, ...(v ? { review: { verdict: v.verdict, why: v.why } } : {}) };
  };
  const requirements = spec.requirements.map((r) => ({ id: r.id, text: r.ears, op: r.op, criteria: r.acceptance.map(row) }));
  const all = requirements.flatMap((r) => r.criteria);
  const automated = all.filter((c) => c.level !== "manual");
  const lockedTests = (lock?.tests ?? []).map((t) => results.get(t.testId));
  const probes = all.flatMap((c) => c.probes);
  const characterisation = (lock?.characterisation ?? []).map((c) => ({ target: c.target, testId: c.testId, file: c.file, ...(results.get(c.testId) ? { outcome: results.get(c.testId)!.outcome } : {}) }));
  const count = (st: CriterionState) => all.filter((c) => c.state === st).length;

  const gate = [...s.gates].reverse().find((g) => g.gateId === PROOF_GATE);
  const details = gate ? String((ledger.events().find((e) => e.seq === gate.seq)?.data as { details?: string } | undefined)?.details ?? "") : "";
  const waiver = gate && !gate.passed ? s.decisions.find((d) => {
    if (d.decision !== "waive") return false;
    try { const b = ledger.getJson<{ gateIds?: string[]; scope?: string }>(d.artifactSha); return !!b.gateIds?.includes(PROOF_GATE) && b.scope === commit; } catch { return false; }
  }) as ({ by: string; reason?: string } | undefined) : undefined;

  const building = s.info.mode !== "estimate" && s.info.mode !== "design";
  const stage = review ? "reviewed" : run ? "run" : lock ? "locked" : "spec";
  const note = stage === "reviewed" ? "The reviewer opened each locked test and said whether it proves its criterion. A weak or missing test stops the run until a person accepts it."
    : stage === "run" ? "The locked tests ran on the new code. The review comes next: it reads each test and says whether it proves its criterion."
    : stage === "locked" ? "The tests are written and locked: each one failed on the old code twice. They run on the new code as it is built."
    : building ? "From the spec. The tests are written, and locked, after the plan is approved." : "From the spec. This run builds nothing, so no tests are written for it.";
  const card = s.openCard?.kind === MANUAL_CARD ? s.openCard : undefined;
  let cardCriteria: string[] = [];
  if (card) { try { cardCriteria = ledger.getJson<ManualBundle>(card.artifactSha).criteria.map((c) => c.id); } catch { /* the card file is gone: the terminal still answers it */ } }

  return {
    runId, stage, note, ...(commit ? { commit } : {}),
    metrics: {
      requirements: requirements.length, criteria: all.length, automated: automated.length, byHand: all.length - automated.length,
      withTest: automated.filter((c) => c.tests.length).length,
      proven: count("proven"), weak: count("weak"), noTest: count("no-test"),
      lockedTests: lockedTests.length,
      passing: lockedTests.filter((r) => r?.outcome === "passed" && !r.flaky).length,
      failing: lockedTests.filter((r) => r && r.outcome !== "passed").length,
      flaky: lockedTests.filter((r) => r?.flaky).length,
      characterisation: characterisation.length,
      probes: { sent: probes.length, ok: probes.filter((p) => p.status === p.expectStatus).length },
      signedOff: count("signed"), failedByHand: count("failed-by-hand"),
      writerAttempts: s.steps.get("author-tests")?.attempts ?? 0,
      nfrs: spec.nfrs?.length ?? 0,
    },
    requirements, characterisation, nfrs: spec.nfrs ?? [],
    ...(gate ? { proof: { passed: gate.passed, details, ...(waiver ? { waivedBy: waiver.by, reason: String(waiver.reason ?? "") } : {}) } } : {}),
    ...(card && cardCriteria.length ? { signOff: { hash: card.artifactSha.slice(0, 8), criteria: cardCriteria } } : {}),
  };
}
