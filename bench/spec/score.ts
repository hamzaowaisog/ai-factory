// Scores one eval run against its case, then summarises repeats: pass rate, how much repeats agree, cost.
// Pure functions over what the run left in its ledger; no model.
import { hits, type EvalCase } from "./case.js";
import type { OracleAnswer } from "./oracle.js";

export interface SpecLike {
  requirements: { id: string; ears: string; acceptance: { given: string; when: string; then: string; level: string }[] }[];
  nfrs: { text: string; metric: string }[];
}

export interface RunOutcome {
  caseId: string;
  repeat: number;
  runId?: string;
  /** "until" = reached the end of the spec stage; anything else is where the run stopped */
  status: string;
  message: string;
  costUsd: number;
  wallMs: number;
  spec?: SpecLike;
  questions: { text: string; options: string[] }[];
  assumptions: string[];
  oracle: OracleAnswer[];
  openFindings: string[];
  repairs: number;
  lane?: string;
}

export interface RunScore {
  caseId: string;
  repeat: number;
  runId?: string;
  completed: boolean;
  status: string;
  pass: boolean;
  expectHit: string[];
  expectMiss: string[];
  forbidHit: string[];
  gapsCaught: string[];
  gapsMissed: string[];
  questions: number;
  answeredFromFacts: number;
  assumptions: number;
  requirements: number;
  acs: number;
  openFindings: number;
  repairs: number;
  lane?: string;
  costUsd: number;
  wallMin: number;
}

export const reqText = (r: SpecLike["requirements"][number]) =>
  [r.ears, ...r.acceptance.map((a) => `Given ${a.given} when ${a.when} then ${a.then}`)].join("\n");

/** A run passes when it reached a spec, every expected behaviour is in one requirement, and nothing forbidden is. */
export function scoreRun(c: EvalCase, o: RunOutcome): RunScore {
  const reqs = o.spec?.requirements ?? [];
  const texts = reqs.map(reqText);
  const forbidTexts = [...texts, ...(o.spec?.nfrs ?? []).map((n) => `${n.text} ${n.metric}`)];
  const expectHit = c.expect.filter((e) => texts.some((t) => hits(e.match, t))).map((e) => e.id);
  const forbidHit = c.forbid.filter((f) => forbidTexts.some((t) => hits(f.match, t))).map((f) => f.id);
  const raised = [...o.questions.map((q) => `${q.text} ${q.options.join(" ")}`), ...o.assumptions];
  const gapsCaught = c.gaps.filter((g) => raised.some((t) => hits(g.match, t))).map((g) => g.id);
  const completed = o.status === "until" && !!o.spec;
  return {
    caseId: c.id, repeat: o.repeat, runId: o.runId, completed, status: o.status,
    pass: completed && expectHit.length === c.expect.length && forbidHit.length === 0,
    expectHit, expectMiss: c.expect.map((e) => e.id).filter((id) => !expectHit.includes(id)), forbidHit,
    gapsCaught, gapsMissed: c.gaps.map((g) => g.id).filter((id) => !gapsCaught.includes(id)),
    questions: o.questions.length, answeredFromFacts: o.oracle.filter((a) => a.fact).length, assumptions: o.assumptions.length,
    requirements: reqs.length, acs: reqs.reduce((n, r) => n + r.acceptance.length, 0),
    openFindings: o.openFindings.length, repairs: o.repairs, lane: o.lane,
    costUsd: o.costUsd, wallMin: o.wallMs / 60_000,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface CaseSummary {
  caseId: string;
  runs: number;
  passRate: number;
  completedRate: number;
  /** share of expected behaviours found, averaged over runs */
  expectRate: number;
  /** each expected behaviour: in how many runs it was found (1 = every run) */
  perExpect: Record<string, number>;
  forbidRate: number;
  gapRate: number;
  /** repeats that agree with each other: share of expected behaviours found in all runs or in none */
  agreement: number;
  reqs: { min: number; max: number };
  costUsd: { mean: number; max: number };
  wallMin: number;
}

export function summariseCase(c: EvalCase, scores: RunScore[]): CaseSummary {
  const n = scores.length;
  const perExpect = Object.fromEntries(c.expect.map((e) => [e.id, n ? scores.filter((s) => s.expectHit.includes(e.id)).length / n : 0]));
  const done = scores.filter((s) => s.completed);
  return {
    caseId: c.id, runs: n,
    passRate: n ? scores.filter((s) => s.pass).length / n : 0,
    completedRate: n ? done.length / n : 0,
    expectRate: mean(scores.map((s) => s.expectHit.length / c.expect.length)),
    perExpect,
    forbidRate: n ? scores.filter((s) => s.forbidHit.length).length / n : 0,
    gapRate: c.gaps.length ? mean(scores.map((s) => s.gapsCaught.length / c.gaps.length)) : 1,
    agreement: mean(Object.values(perExpect).map((v) => (v === 0 || v === 1 ? 1 : 0))),
    reqs: { min: done.length ? Math.min(...done.map((s) => s.requirements)) : 0, max: Math.max(0, ...done.map((s) => s.requirements)) },
    costUsd: { mean: mean(scores.map((s) => s.costUsd)), max: Math.max(0, ...scores.map((s) => s.costUsd)) },
    wallMin: mean(scores.map((s) => s.wallMin)),
  };
}

export interface Overall { cases: number; runs: number; passRate: number; completedRate: number; expectRate: number; forbidRate: number; gapRate: number; agreement: number; costUsd: number; costPerRun: number }

export function overall(sums: CaseSummary[]): Overall {
  const runs = sums.reduce((n, s) => n + s.runs, 0);
  const w = (f: (s: CaseSummary) => number) => (runs ? sums.reduce((n, s) => n + f(s) * s.runs, 0) / runs : 0);
  const cost = sums.reduce((n, s) => n + s.costUsd.mean * s.runs, 0);
  return {
    cases: sums.length, runs, passRate: w((s) => s.passRate), completedRate: w((s) => s.completedRate), expectRate: w((s) => s.expectRate),
    forbidRate: w((s) => s.forbidRate), gapRate: w((s) => s.gapRate), agreement: mean(sums.map((s) => s.agreement)), costUsd: cost, costPerRun: runs ? cost / runs : 0,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatReport(sums: CaseSummary[], all: Overall, scores: RunScore[]): string {
  const lines = [
    `Spec eval: ${all.cases} cases, ${all.runs} runs, $${all.costUsd.toFixed(2)} ($${all.costPerRun.toFixed(2)} a run)`,
    `  passed ${pct(all.passRate)} · reached a spec ${pct(all.completedRate)} · expected behaviour found ${pct(all.expectRate)} · scope creep ${pct(all.forbidRate)} · gaps raised ${pct(all.gapRate)} · repeats agree ${pct(all.agreement)}`,
    ``,
    `case                              pass  spec  found  creep  gaps  agree  reqs   $/run  min/run`,
  ];
  for (const s of sums) {
    lines.push(`${s.caseId.padEnd(33)} ${pct(s.passRate).padStart(4)}  ${pct(s.completedRate).padStart(4)}  ${pct(s.expectRate).padStart(5)}  ${pct(s.forbidRate).padStart(5)}  ${pct(s.gapRate).padStart(4)}  ${pct(s.agreement).padStart(5)}  ${`${s.reqs.min}-${s.reqs.max}`.padStart(5)}  ${s.costUsd.mean.toFixed(2).padStart(6)}  ${s.wallMin.toFixed(1).padStart(7)}`);
  }
  const misses = scores.filter((s) => !s.pass);
  if (misses.length) {
    lines.push(``, `Runs that didn't pass:`);
    for (const s of misses) {
      const why = !s.completed ? `stopped: ${s.status}` : [s.expectMiss.length ? `missing ${s.expectMiss.join(", ")}` : "", s.forbidHit.length ? `not asked for: ${s.forbidHit.join(", ")}` : ""].filter(Boolean).join("; ");
      lines.push(`  ${s.caseId} #${s.repeat}${s.runId ? ` (${s.runId})` : ""}: ${why}`);
    }
  }
  return lines.join("\n");
}
