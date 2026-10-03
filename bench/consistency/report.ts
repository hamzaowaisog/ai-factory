// Consistency report (docs/estimate-consistency.md, section 10, step F): how far apart the estimates are for
// requirements that mean the same thing. Pure: it reads finished estimate runs and does arithmetic, no model calls.
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import type { Breakdown, Estimate } from "../../src/contracts/index.js";

/** Coefficient of variation a group may have and still pass (assumed, section 10). */
export const CV_TARGET = 0.1;

export interface Sample {
  group: string;
  /** the requirement file the run estimated */
  case: string;
  runId: string;
  /** overall hours range, when the estimate finished */
  total?: { min: number; max: number };
  tasks?: number;
  /** tasks per kind (the breakdown's `kind`, or track/complexity for breakdowns without one) */
  kinds?: Record<string, number>;
  error?: string;
}

export interface GroupStats {
  group: string;
  runs: number;
  /** runs with a finished estimate */
  ok: number;
  meanMid: number;
  minMid: number;
  maxMid: number;
  /** population standard deviation of the midpoints over their mean; 0 with fewer than two estimates */
  cv: number;
  tasks: { min: number; max: number };
  /** each kind's task count, lowest and highest across the runs (a kind missing from a run counts 0) */
  kinds: Record<string, { min: number; max: number }>;
  pass: boolean;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const mid = (r: { min: number; max: number }): number => (r.min + r.max) / 2;

/** What a breakdown task counts as when comparing runs. */
export const kindOf = (t: Pick<Breakdown["tasks"][number], "track" | "complexity"> & { kind?: string }): string => t.kind ?? `${t.track}/${t.complexity}`;

export function groupStats(samples: Sample[], target = CV_TARGET): GroupStats[] {
  const groups = [...new Set(samples.map((s) => s.group))];
  return groups.map((group) => {
    const all = samples.filter((s) => s.group === group);
    const ok = all.filter((s): s is Sample & { total: { min: number; max: number }; tasks: number; kinds: Record<string, number> } => !!s.total && s.tasks !== undefined && !!s.kinds);
    const mids = ok.map((s) => mid(s.total));
    const mean = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 0;
    const sd = mids.length > 1 ? Math.sqrt(mids.reduce((a, m) => a + (m - mean) ** 2, 0) / mids.length) : 0;
    const cv = mean > 0 ? sd / mean : 0;
    const names = [...new Set(ok.flatMap((s) => Object.keys(s.kinds)))].sort();
    const kinds = Object.fromEntries(names.map((k) => {
      const n = ok.map((s) => s.kinds[k] ?? 0);
      return [k, { min: Math.min(...n), max: Math.max(...n) }];
    }));
    const counts = ok.map((s) => s.tasks);
    return {
      group, runs: all.length, ok: ok.length,
      meanMid: r2(mean), minMid: r2(mids.length ? Math.min(...mids) : 0), maxMid: r2(mids.length ? Math.max(...mids) : 0), cv: Math.round(cv * 1000) / 1000,
      tasks: { min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0 },
      kinds,
      // a group with a failed run, or fewer than two estimates, has not shown it is consistent
      pass: ok.length === all.length && ok.length >= 2 && cv <= target,
    };
  });
}

export function formatStats(stats: GroupStats[], samples: Sample[], target = CV_TARGET): string {
  const lines: string[] = [`Target: coefficient of variation of the total ${Math.round(target * 100)}% or less per group.`];
  for (const g of stats) {
    lines.push("", `${g.group}: ${g.pass ? "PASS" : "FAIL"}  ${g.ok}/${g.runs} estimates, mean ${g.meanMid} h (${g.minMid}-${g.maxMid}), cv ${(g.cv * 100).toFixed(1)}%, tasks ${g.tasks.min}-${g.tasks.max}`);
    for (const s of samples.filter((x) => x.group === g.group)) {
      lines.push(`  ${s.case.padEnd(8)} ${s.runId}  ${s.total ? `${s.total.min}-${s.total.max} h, ${s.tasks} tasks` : `no estimate: ${s.error ?? "unknown"}`}`);
    }
    const varying = Object.entries(g.kinds).filter(([, r]) => r.min !== r.max);
    if (varying.length) lines.push(`  kinds that vary: ${varying.map(([k, r]) => `${k} ${r.min}-${r.max}`).join(", ")}`);
  }
  return lines.join("\n");
}

/** A sample from a run in the ledger home. A run without a finished estimate becomes a sample with its error. */
export function sampleFromRun(runId: string, group: string, kase: string): Sample {
  try {
    const ledger = Ledger.open(runId);
    const s = replay(ledger.events());
    const est = s.steps.get("estimate");
    if (est?.status !== "completed") {
      const at = [...s.steps.values()].find((x) => x.status !== "completed");
      return { group, case: kase, runId, error: at ? `stopped at ${at.step} (${at.status})` : `run ${s.status}${s.parkedReason ? `: ${s.parkedReason}` : ""}` };
    }
    const e = ledger.getJson(est.outputs[0]!) as Estimate;
    const b = ledger.getJson(s.steps.get("breakdown")!.outputs[0]!) as Breakdown;
    const kinds: Record<string, number> = {};
    for (const t of b.tasks) kinds[kindOf(t)] = (kinds[kindOf(t)] ?? 0) + 1;
    return { group, case: kase, runId, total: e.totals.overall, tasks: b.tasks.length, kinds };
  } catch (e) {
    return { group, case: kase, runId, error: (e as Error).message };
  }
}
