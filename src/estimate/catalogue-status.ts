// The catalogue's status, from evidence (docs/estimate-consistency.md, section 13). No person signs the catalogue off.
//   draft               reference hours, not yet measured
//   calibrated-factors  enough builds show the size, verify and context factors match actual agent time
//   calibrated-hours    the factors hold, and real project hours (the actual-hours file) fall inside the estimates
// Agent minutes can only test the catalogue's ratios, never its absolute hours: a typical be-crud task taking the
// agent 25 minutes says nothing about 8-12 engineer hours. Only finished projects' real hours can test those.
// The thresholds live in the catalogue file (`calibration`) and are assumed placeholders until real data exists.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { factoryHome } from "../util/paths.js";
import { hoursRows, type HoursRow } from "./calibrate.js";
import type { Catalogue, CatalogueStatus } from "./catalogue.js";
import { decisionPairs, type DecisionPair } from "./decisions.js";

export interface FactorCheck { question: string; kind: string; track: string; pick: string; expected: number; measured: number; held: boolean; tasks: number }
export interface CatalogueEvidence {
  status: CatalogueStatus;
  /** build runs of this catalogue version that followed an estimate */
  builds: number;
  checks: FactorCheck[];
  /** finished projects of this version with real hours, and how many fell inside the estimate */
  projects: number;
  projectsWithin: number;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Each question's baseline pick and the catalogue factor of every other pick against it. */
function factorTables(c: Catalogue): { question: string; base: string; factor: Record<string, number> }[] {
  return [
    { question: "size", base: "typical", factor: c.sizes },
    { question: "verify", base: "moderate", factor: c.factors.verify },
    { question: "context", base: "complete", factor: c.factors.context },
  ];
}

/**
 * Within one kind and track, a pick's median build minutes against the baseline pick's: the measured factor. It holds
 * when it is within the catalogue's factor x or / the tolerance. A side with fewer finished tasks than `minPerCell`
 * gives no check.
 */
export function factorChecks(c: Catalogue, pairs: DecisionPair[]): FactorCheck[] {
  const cal = c.calibration;
  const done = pairs.filter((p) => p.actual.outcome === "completed" && p.actual.activeMin > 0 && p.features.catalogue === c.version);
  const out: FactorCheck[] = [];
  for (const { question, base, factor } of factorTables(c)) {
    const groups = new Map<string, DecisionPair[]>();
    for (const p of done.filter((x) => x.question === question)) { const k = `${p.features.kind}|${p.features.track}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
    for (const [k, ps] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const [kind, track] = k.split("|") as [string, string];
      const baseMin = ps.filter((p) => p.choice === base).map((p) => p.actual.activeMin);
      if (baseMin.length < cal.minPerCell) continue;
      for (const pick of Object.keys(factor).filter((x) => x !== base).sort()) {
        const m = ps.filter((p) => p.choice === pick).map((p) => p.actual.activeMin);
        if (m.length < cal.minPerCell) continue;
        const expected = factor[pick]! / factor[base]!;
        const measured = r2(median(m) / median(baseMin));
        out.push({ question, kind, track, pick, expected, measured, held: measured >= expected / cal.tolerance && measured <= expected * cal.tolerance, tasks: m.length + baseMin.length });
      }
    }
  }
  return out;
}

/** The status from the evidence: pairs of size picks and build actuals, and real project hours. */
export function catalogueEvidence(c: Catalogue, pairs: DecisionPair[], hours: (HoursRow & { catalogue?: string })[]): CatalogueEvidence {
  const cal = c.calibration;
  const builds = new Set(pairs.filter((p) => p.features.catalogue === c.version).map((p) => p.buildRun)).size;
  const checks = factorChecks(c, pairs);
  const projectRows = hours.filter((h) => h.catalogue === c.version);
  const projectsWithin = projectRows.filter((h) => h.verdict === "within").length;
  const factorsOk = builds >= cal.minBuilds && checks.length >= cal.minChecks && checks.filter((x) => x.held).length / checks.length >= cal.holdShare;
  const hoursOk = factorsOk && projectRows.length >= cal.minProjects && projectsWithin / projectRows.length >= cal.holdShare;
  return { status: hoursOk ? "calibrated-hours" : factorsOk ? "calibrated-factors" : "draft", builds, checks, projects: projectRows.length, projectsWithin };
}

/** Where the real project hours are kept: `estimate-run,actual-hours` lines, the format `factory calibrate --actual-hours` reads. */
export const actualHoursFile = (): string => join(factoryHome(), "actual-hours.csv");

/** The evidence from the ledger home: every build's pairs, and the actual-hours file when there is one. */
export function loadCatalogueEvidence(c: Catalogue): CatalogueEvidence {
  const f = actualHoursFile();
  return catalogueEvidence(c, decisionPairs(), existsSync(f) ? hoursRows(f) : []);
}

/** The status in words, for the internal views (card, web UI, team workbook). Never on the client's copy. */
export function catalogueStatusText(c: { status: CatalogueStatus; evidence?: { builds: number; projects: number } | undefined; tuned?: { generation: number; builds: number; projects: number } | undefined }): string {
  const n = (x: number, one: string) => `${x} ${one}${x === 1 ? "" : "s"}`;
  // a tuned version starts its own evidence afresh (tune.ts), so its draft is not the repo file's reference hours
  const tuned = c.tuned ? `self-tuned ${c.tuned.generation === 1 ? "once" : `${c.tuned.generation} times`}, last from ${n(c.tuned.builds, "build")} and ${n(c.tuned.projects, "finished project")}` : "";
  const status = c.status === "calibrated-hours" ? `hours measured against ${n(c.evidence?.projects ?? 0, "finished project")}`
    : c.status === "calibrated-factors" ? `size factors measured from ${n(c.evidence?.builds ?? 0, "build")}; hours not yet measured against finished projects`
    : tuned ? "this version not yet measured" : "reference hours, not yet measured";
  return tuned ? `${tuned}; ${status}` : status;
}
