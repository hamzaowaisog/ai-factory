// Self-tuning catalogue (docs/estimate-consistency.md, section 14, Phase 3). After every estimate and every build,
// the factory measures the current catalogue version against what happened and, when a value is off, writes a
// proposal for the next version. No model call: arithmetic over the ledgers. Tuning is a suggestion: nothing is
// sized from a proposal until a person promotes it (`factory calibrate --apply`).
//   - Size, verify and context factors: from build pairs (catalogue-status.ts), a pick's measured ratio to its
//     baseline against the catalogue's, pooled over kinds and tracks (geometric mean, weighted by tasks).
//   - Hours: from finished projects' real hours (the actual-hours file), actual over the estimate's midpoint, as one
//     scale on every kind's hours.
// The aim is a fit, not the last project's numbers: a value within the band is left alone; otherwise it moves part
// of the way, by at most the cap per version, and never outside floor..ceiling x the repo file's value. Each
// version is judged only on evidence sized with it, so nothing is counted twice. A value that keeps hitting a limit
// is flagged: the kind's size wording is more likely wrong than its number.
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hoursRows, type HoursRow } from "./calibrate.js";
import { loadCatalogue, type Catalogue } from "./catalogue.js";
import { actualHoursFile, factorChecks } from "./catalogue-status.js";
import { cataloguesDir, clearProposal, currentCatalogue, generationOf, rootOf, saveProposal, saveTuned, tunedVersion } from "./catalogue-store.js";
import { decisionPairs, type DecisionPair } from "./decisions.js";

export interface TuneChange { path: string; from: number; to: number; measured: number; evidence: number; limited?: "cap" | "bound" }
export interface TunePlan {
  /** the version measured */
  from: string;
  /** the new version, when anything changed */
  to?: string;
  changes: TuneChange[];
  /** values measured and inside the band */
  fitted: { path: string; measured: number; evidence: number }[];
  /** what is not measured yet, in words */
  waiting: string[];
  /** values that hit a limit again: check the kind's wording */
  flagged: string[];
  builds: number;
  projects: number;
  catalogue?: Catalogue;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** weighted geometric mean: ratios multiply, so 2x and 0.5x average to 1x */
const geomean = (xs: { v: number; w: number }[]): number => Math.exp(xs.reduce((a, x) => a + Math.log(x.v) * x.w, 0) / xs.reduce((a, x) => a + x.w, 0));

/** Where each factor question's picks live in the catalogue. The baseline pick (factor 1) is never tuned. */
const TABLES = [
  { question: "size", get: (c: Catalogue) => c.sizes as Record<string, number>, path: "sizes" },
  { question: "verify", get: (c: Catalogue) => c.factors.verify as Record<string, number>, path: "factors.verify" },
  { question: "context", get: (c: Catalogue) => c.factors.context as Record<string, number>, path: "factors.context" },
] as const;

/**
 * One value's next number. `ratio` is measured over expected; `original` is the repo file's value.
 * Returns undefined inside the band.
 */
export function nextValue(t: Catalogue["tuning"], current: number, ratio: number, original: number): { to: number; limited?: "cap" | "bound" } | undefined {
  if (Math.abs(ratio - 1) <= t.band) return undefined;
  let to = current * ratio ** t.step;
  let limited: "cap" | "bound" | undefined;
  const lo = current * (1 - t.cap), hi = current * (1 + t.cap);
  if (to < lo || to > hi) { to = Math.min(hi, Math.max(lo, to)); limited = "cap"; }
  const blo = original * t.floor, bhi = original * t.ceiling;
  if (to < blo || to > bhi) { to = Math.min(bhi, Math.max(blo, to)); limited = "bound"; }
  return { to: r3(to), ...(limited ? { limited } : {}) };
}

/** Measure one catalogue version and, when anything is off, the version that should follow it. */
export function planTune(c: Catalogue, original: Catalogue, pairs: DecisionPair[], hours: HoursRow[], now = new Date()): TunePlan {
  const cal = c.calibration, t = c.tuning;
  const builds = new Set(pairs.filter((p) => p.features.catalogue === c.version).map((p) => p.buildRun)).size;
  const rows = hours.filter((h) => h.catalogue === c.version && h.ratio > 0);
  const plan: TunePlan = { from: c.version, changes: [], fitted: [], waiting: [], flagged: [], builds, projects: rows.length };
  const limitedBefore = new Set(c.tuned?.changes.filter((x) => x.limited).map((x) => x.path) ?? []);
  const next: Catalogue = structuredClone(c);

  const consider = (path: string, current: number, ratio: number, orig: number, evidence: number, set: (v: number) => void) => {
    const measured = r3(ratio);
    const v = nextValue(t, current, ratio, orig);
    if (!v) { plan.fitted.push({ path, measured, evidence }); return; }
    if (v.limited && limitedBefore.has(path)) plan.flagged.push(path);
    if (v.to === current) return; // pinned at a bound: nothing left to move
    plan.changes.push({ path, from: current, to: v.to, measured, evidence, ...(v.limited ? { limited: v.limited } : {}) });
    set(v.to);
  };

  if (builds < cal.minBuilds) plan.waiting.push(`size factors: ${builds} of ${cal.minBuilds} builds on this version`);
  else {
    const checks = factorChecks(c, pairs);
    if (!checks.length) plan.waiting.push(`size factors: no pick has ${cal.minPerCell} finished tasks beside its baseline yet`);
    for (const tb of TABLES) {
      for (const pick of [...new Set(checks.filter((x) => x.question === tb.question).map((x) => x.pick))].sort()) {
        const cs = checks.filter((x) => x.question === tb.question && x.pick === pick);
        const ratio = geomean(cs.map((x) => ({ v: x.measured / x.expected, w: x.tasks })));
        consider(`${tb.path}.${pick}`, tb.get(c)[pick]!, ratio, tb.get(original)[pick]!, cs.reduce((a, x) => a + x.tasks, 0), (v) => { tb.get(next)[pick] = v; });
      }
    }
  }

  if (rows.length < cal.minProjects) plan.waiting.push(`hours: ${rows.length} of ${cal.minProjects} finished projects with real hours on this version`);
  else consider("hoursScale", c.hoursScale ?? 1, geomean(rows.map((r) => ({ v: r.ratio, w: 1 }))), original.hoursScale ?? 1, rows.length, (v) => { next.hoursScale = v; });

  if (plan.changes.length) {
    const root = rootOf(c.version);
    plan.to = tunedVersion(root, generationOf(c.version) + 1);
    plan.catalogue = { ...next, version: plan.to, tuned: { parent: c.version, at: now.toISOString(), builds, projects: rows.length, changes: plan.changes, flagged: plan.flagged } };
  }
  return plan;
}

/** The plan in words, for `factory calibrate --tune` and the bench. */
export function formatTunePlan(p: TunePlan): string {
  const lines = [`Catalogue ${p.from}: measured from ${p.builds} build(s) and ${p.projects} finished project(s).`];
  for (const x of p.changes) lines.push(`  ${x.path.padEnd(26)} ${x.from} -> ${x.to}  (measured x${x.measured} over ${x.evidence}${x.limited ? `, held to the ${x.limited}` : ""})`);
  for (const x of p.fitted) lines.push(`  ${x.path.padEnd(26)} fitted (measured x${x.measured} over ${x.evidence})`);
  for (const w of p.waiting) lines.push(`  waiting: ${w}`);
  for (const f of p.flagged) lines.push(`  check the wording: ${f} hit a limit twice in a row`);
  lines.push(p.to ? `New version: ${p.to}.` : p.changes.length ? "" : "No change.");
  return lines.filter(Boolean).join("\n");
}

/** One tuner at a time across processes: an exclusive lock file, taken over when older than ten minutes. */
export function withTuneLock<T>(f: () => T): T | undefined {
  mkdirSync(cataloguesDir(), { recursive: true });
  const lock = join(cataloguesDir(), ".tune.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 10 * 60_000) rmSync(lock, { force: true });
  let fd: number;
  try { fd = openSync(lock, "wx"); } catch { return undefined; }
  try { return f(); } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

/**
 * Measure the current version against every ledger and the actual-hours file. "report" only reports; "propose" (the
 * background tuner) writes the next version as a proposal, or clears a stale one when nothing is off; "apply" (a
 * person, `factory calibrate --apply`) writes the next version, which new estimates are then sized from.
 * Undefined when another tuner holds the lock.
 */
export function tuneNow(opts: { mode: "report" | "propose" | "apply" }): TunePlan | undefined {
  return withTuneLock(() => {
    const f = actualHoursFile();
    const plan = planTune(currentCatalogue(), loadCatalogue(), decisionPairs(), existsSync(f) ? hoursRows(f) : []);
    const root = rootOf(plan.from);
    if (opts.mode === "propose") { if (plan.catalogue) saveProposal(plan.catalogue); else clearProposal(root); }
    if (opts.mode === "apply" && plan.catalogue) { saveTuned(plan.catalogue); clearProposal(root); }
    return plan;
  });
}

/** Where background tuning writes what it did. */
export const tuneLog = (): string => join(cataloguesDir(), "tune.log");

/** The default trigger: `factory calibrate --auto` (writes a proposal only) as a detached process, so no run waits on it. */
function spawnTuner(): void {
  if (process.env.VITEST || process.env.FACTORY_NO_TUNE === "1") return;
  const js = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const args = existsSync(js) ? [js] : [...process.execArgv, fileURLToPath(new URL("../cli/index.ts", import.meta.url))];
  mkdirSync(cataloguesDir(), { recursive: true });
  const log = openSync(tuneLog(), "a");
  spawn(process.execPath, [...args, "calibrate", "--auto"], { detached: true, stdio: ["ignore", log, log] }).unref();
}

let trigger: () => void = spawnTuner;
/** Tests swap the trigger to count calls. */
export function setTuneTrigger(f: () => void): void { trigger = f; }

/** Start background tuning (a proposal, never a new version). Never throws: tuning must not break the run that triggered it. */
export function triggerTune(): void {
  try { trigger(); } catch (e) {
    try { appendFileSync(tuneLog(), `${new Date().toISOString()} trigger failed: ${(e as Error).message}\n`); } catch { /* nothing to log to */ }
  }
}
