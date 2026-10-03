// Calibration: how the approved estimate compares with what the factory then spent (docs/estimates-design.md,
// "Benchmarks"). Two sources, both from ledgers already on disk:
//   - API cost, by phase group: the estimate's planning, design and breakdown phases against the estimate run's
//     own spend, and its build and verification phases against the build run that followed it.
//   - Hours, optional: a file of `estimate-run,actual-hours` for projects a team has since finished (the
//     factory cannot measure human hours), compared with the estimate's overall hours range.
// Nothing here changes an estimate. Measured cost already feeds the next estimate through the benchmark records.
import { readFileSync } from "node:fs";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { scoreRun } from "../report.js";
import { Estimate } from "../contracts/estimate.js";
import type { CostPhase } from "./cost.js";

export type Verdict = "under" | "within" | "over";
export interface CostRow { estimateRun: string; buildRun?: string; group: "estimate run" | "build run"; estimated: { min: number; max: number }; actual: number; verdict: Verdict; ratio: number }
export interface HoursRow { estimateRun: string; estimated: { min: number; max: number }; actual: number; verdict: Verdict; ratio: number; /** the catalogue version the estimate was sized from */ catalogue?: string }

const ESTIMATE_PHASES: CostPhase[] = ["planning", "design", "breakdown-estimate"];

export function judge(range: { min: number; max: number }, actual: number): { verdict: Verdict; ratio: number } {
  const mid = (range.min + range.max) / 2;
  return { verdict: actual < range.min ? "under" : actual > range.max ? "over" : "within", ratio: mid > 0 ? Math.round((actual / mid) * 100) / 100 : 0 };
}

const sumPhases = (e: Estimate, want: (p: CostPhase) => boolean) =>
  e.apiCost.phases.filter((p) => want(p.phase)).reduce((a, p) => ({ min: a.min + p.usd.min, max: a.max + p.usd.max }), { min: 0, max: 0 });

/** Cost rows for every finished build run that followed an approved estimate, plus that estimate run's own spend. */
export function costRows(runIds: string[] = Ledger.listRuns()): CostRow[] {
  const rows: CostRow[] = [];
  const seenEstimates = new Set<string>();
  for (const id of runIds) {
    try {
      const ledger = Ledger.open(id);
      const ref = replay(ledger.events()).info.estimateRef;
      if (!ref) continue;
      const est = Estimate.parse(Ledger.open(ref.runId).getJson(ref.estimateSha));
      const build = scoreRun(ledger);
      const buildEst = sumPhases(est, (p) => !ESTIMATE_PHASES.includes(p));
      rows.push({ estimateRun: ref.runId, buildRun: id, group: "build run", estimated: buildEst, actual: build.costUsd, ...judge(buildEst, build.costUsd) });
      if (!seenEstimates.has(ref.runId)) {
        seenEstimates.add(ref.runId);
        const spent = scoreRun(Ledger.open(ref.runId)).costUsd;
        const planEst = sumPhases(est, (p) => ESTIMATE_PHASES.includes(p));
        rows.push({ estimateRun: ref.runId, group: "estimate run", estimated: planEst, actual: spent, ...judge(planEst, spent) });
      }
    } catch { /* a run that cannot be read or has no estimate adds no row */ }
  }
  return rows;
}

/** `estimate-run,actual-hours` per line; blank lines, `#` comments and a header line are ignored. */
export function parseActualHours(text: string): { run: string; hours: number }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).flatMap((l) => {
    const [run, h] = l.split(/[,\t;]/).map((x) => x.trim());
    const hours = Number(h);
    return run && Number.isFinite(hours) && hours > 0 ? [{ run, hours }] : [];
  });
}

export function hoursRows(file: string): HoursRow[] {
  const rows: HoursRow[] = [];
  for (const { run, hours } of parseActualHours(readFileSync(file, "utf8"))) {
    try {
      const ledger = Ledger.open(run);
      const sha = replay(ledger.events()).steps.get("estimate")?.outputs[0];
      if (!sha) continue;
      const est = Estimate.parse(ledger.getJson(sha));
      rows.push({ estimateRun: run, estimated: est.totals.overall, actual: hours, ...judge(est.totals.overall, hours), ...(est.catalogue ? { catalogue: est.catalogue.version } : {}) });
    } catch { /* unknown run */ }
  }
  return rows;
}

export function formatCalibration(cost: CostRow[], hours: HoursRow[]): string {
  const lines: string[] = [];
  const usd = (n: number) => `$${n.toFixed(2)}`;
  if (cost.length) {
    lines.push("API cost: estimate vs spent", `${"estimate run".padEnd(24)} ${"what".padEnd(13)} ${"estimated".padEnd(17)} ${"spent".padStart(8)}  verdict`);
    for (const r of cost) lines.push(`${r.estimateRun.padEnd(24)} ${r.group.padEnd(13)} ${`${usd(r.estimated.min)}–${usd(r.estimated.max)}`.padEnd(17)} ${usd(r.actual).padStart(8)}  ${r.verdict} (${r.ratio}× the middle)`);
    const miss = cost.filter((r) => r.verdict !== "within").length;
    lines.push(`${cost.length - miss} of ${cost.length} within range.`);
  } else lines.push("API cost: no build run has followed an approved estimate yet, so there is nothing to compare.");
  if (hours.length) {
    lines.push("", "Hours: estimate vs actual", `${"estimate run".padEnd(24)} ${"estimated".padEnd(15)} ${"actual".padStart(7)}  verdict`);
    for (const r of hours) lines.push(`${r.estimateRun.padEnd(24)} ${`${r.estimated.min}–${r.estimated.max} h`.padEnd(15)} ${`${r.actual} h`.padStart(7)}  ${r.verdict} (${r.ratio}× the middle)`);
    lines.push(`${hours.filter((r) => r.verdict === "within").length} of ${hours.length} within range.`);
  }
  return lines.join("\n");
}

export interface UiSizeRow { buildRun: string; estimateRun: string; approved: string; actual: string; verdict: "within" | "bigger" | "smaller" }
const LEVELS = ["none", "tweak", "new-screen", "design-system"];

/** The UI change each build produced against the size class its approved design allowed (recorded at integrate). */
export function uiSizeRows(runIds: string[] = Ledger.listRuns()): UiSizeRow[] {
  const rows: UiSizeRow[] = [];
  for (const id of runIds) {
    try {
      const state = replay(Ledger.open(id).events());
      const ref = state.info.estimateRef;
      const size = state.steps.get("integrate")?.data?.uiSize as { approved: string; actual: string } | undefined;
      if (!ref || !size) continue;
      const d = LEVELS.indexOf(size.actual) - LEVELS.indexOf(size.approved);
      rows.push({ buildRun: id, estimateRun: ref.runId, ...size, verdict: d > 0 ? "bigger" : d < 0 ? "smaller" : "within" });
    } catch { /* a run that cannot be read adds no row */ }
  }
  return rows;
}
