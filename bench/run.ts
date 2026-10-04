// Benchmark runner.  npm run bench -- <calibrate|gates|all> [--home <dir>] [--no-save]
//   calibrate  back-test cost and wall-time predictions from the ledger (read-only)
//   gates      seeded-defect check of the gates
//   compare    read the ledger against the pinned external numbers (needs implement steps to say much)
//   evidence <estimate.json>  evidence pack for an estimate: each figure against measured and external data
//   external   print the pinned external reference tables (bench/external/snapshots)
//   consistency [--group g ...] [--runs n] [--report g/case=run ...]  same requirement, different words: how far apart
//              the estimates are (live model calls unless --report; docs/estimate-consistency.md section 10)
// --home points at a copied ledger (sets FACTORY_HOME), e.g. the run from the other machine.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("--")) ?? "all";
const flag = (n: string) => args.includes(`--${n}`);
const homeIdx = args.indexOf("--home");
if (homeIdx >= 0) {
  const home = args[homeIdx + 1];
  if (!home) { console.error("--home needs a directory"); process.exit(2); }
  process.env.FACTORY_HOME = home;
}
if (!["calibrate", "gates", "external", "compare", "evidence", "consistency", "all"].includes(cmd)) { console.error(`Unknown command "${cmd}". Use calibrate, gates, external, compare, evidence, consistency or all.`); process.exit(2); }
const values = (n: string): string[] => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] && !args[i + 1]!.startsWith("--") ? [args[i + 1]!] : []));

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), "results");
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const stamp = { date: new Date().toISOString(), commit };
const history: Record<string, unknown> = { ...stamp };
let failed = false;

if (cmd === "calibrate" || cmd === "all") {
  const { loadRecords } = await import("./calibration/records.js");
  const { backtest, formatBacktest } = await import("./calibration/backtest.js");
  const { records, runs, skipped } = loadRecords();
  const results = backtest(records);
  console.log("== Calibration ==\n" + formatBacktest(results, { runs, records: records.length }));
  if (skipped.length) console.log(`\nSkipped ${skipped.length} unreadable run(s):\n  ${skipped.join("\n  ")}`);
  history.calibration = { runs, records: records.length, results };
  const { loadTaskRecords, classMinutes } = await import("../src/estimate/durations.js");
  const tr = loadTaskRecords();
  const classes = [...new Set(tr.map((r) => r.taskClass))].sort().map((c) => classMinutes(c, tr));
  console.log("\n== Factory task classes (what the estimate's build time reads) ==");
  console.log(classes.length ? classes.map((c) => `${c.taskClass.padEnd(34)} ${String(c.records).padStart(3)} record(s)  ${c.confidence.padEnd(10)} ${c.minutes ? `${c.minutes.min.toFixed(1)}-${c.minutes.max.toFixed(1)} min` : "not measured yet"}`).join("\n") : "No finished build has followed an approved estimate yet, so every factory task uses the sized hours as its duration (cold-start).");
  history.taskClasses = classes;
  const { uiSizeRows } = await import("../src/estimate/calibrate.js");
  const ui = uiSizeRows();
  console.log("\n== UI size: approved design vs built ==");
  console.log(ui.length ? ui.map((r) => `${r.buildRun.slice(0, 40).padEnd(40)} approved ${r.approved.padEnd(13)} built ${r.actual.padEnd(13)} ${r.verdict}`).join("\n") : "No build with an approved design has finished yet.");
  history.uiSize = ui;
  const { decisionPairs, formatPairs } = await import("../src/estimate/decisions.js");
  const pairs = decisionPairs();
  console.log("\n== Size picks vs build actuals (decision log, for comparing a backend such as Jev) ==");
  console.log(formatPairs(pairs));
  history.decisionPairs = pairs.length;
  const { currentCatalogue, generationOf } = await import("../src/estimate/catalogue-store.js");
  const { catalogueEvidence, catalogueStatusText, actualHoursFile } = await import("../src/estimate/catalogue-status.js");
  const { hoursRows } = await import("../src/estimate/calibrate.js");
  const { existsSync } = await import("node:fs");
  const cat = currentCatalogue();
  const hrs = existsSync(actualHoursFile()) ? hoursRows(actualHoursFile()) : [];
  const ev = catalogueEvidence(cat, pairs, hrs);
  console.log(`\n== Task catalogue ${cat.version}: ${ev.status} ==`);
  console.log(`${catalogueStatusText({ status: ev.status, evidence: ev, ...(cat.tuned ? { tuned: { generation: generationOf(cat.version), builds: cat.tuned.builds, projects: cat.tuned.projects } } : {}) })}. ${ev.builds} build(s), ${ev.checks.filter((x) => x.held).length} of ${ev.checks.length} factor check(s) held, ${ev.projectsWithin} of ${ev.projects} finished project(s) within range (thresholds in the catalogue's "calibration", assumed).`);
  for (const x of ev.checks) console.log(`  ${x.question} ${x.pick} vs base, ${x.kind} ${x.track}: expected ${x.expected}x, measured ${x.measured}x (${x.tasks} tasks) ${x.held ? "holds" : "DOES NOT HOLD"}`);
  const { formatTunePlan, planTune } = await import("../src/estimate/tune.js");
  const { loadCatalogue } = await import("../src/estimate/catalogue.js");
  const plan = planTune(cat, loadCatalogue(), pairs, hrs);
  console.log(`\n== Self-tuning (what the next proposal would be; a person promotes it with factory calibrate --apply) ==\n${formatTunePlan(plan)}`);
  history.tuning = { from: plan.from, ...(plan.to ? { to: plan.to } : {}), changes: plan.changes.length, fitted: plan.fitted.length, flagged: plan.flagged };
  history.catalogue = { version: cat.version, status: ev.status, builds: ev.builds, checks: ev.checks.length, held: ev.checks.filter((x) => x.held).length, projects: ev.projects, projectsWithin: ev.projectsWithin };
}

if (cmd === "compare" || cmd === "all") {
  const { loadRecords } = await import("./calibration/records.js");
  const { compareRounds, formatCompare } = await import("./external/compare.js");
  const { records } = loadRecords();
  const c = compareRounds(records);
  console.log((cmd === "all" ? "\n" : "") + formatCompare(c, records));
  history.compare = { rounds: c };
}

if (cmd === "evidence") {
  const file = args.filter((a) => !a.startsWith("--"))[1];
  if (!file) { console.error("evidence needs an estimate JSON, e.g. bench/external/fixtures/estimate-sample.json"); process.exit(2); }
  const { readFileSync } = await import("node:fs");
  const { loadRecords } = await import("./calibration/records.js");
  const { buildEvidence, formatEvidence } = await import("./external/evidence.js");
  const rows = buildEvidence(JSON.parse(readFileSync(file, "utf8")), loadRecords().records);
  console.log(formatEvidence(rows));
  history.evidence = { file, rows };
}

if (cmd === "consistency") {
  // reworded requirements must miss the cache like a client's would, and a repeat of the same file must call the model again
  process.env.FACTORY_NO_CACHE = "1";
  const { groupStats, formatStats, sampleFromRun } = await import("./consistency/report.js");
  const { listCases, parseReportArgs, runCase } = await import("./consistency/run.js");
  const samples = [];
  const reports = values("report");
  if (reports.length) {
    for (const r of parseReportArgs(reports)) samples.push(sampleFromRun(r.runId, r.group, r.name));
  } else {
    const { hasSecret } = await import("../src/config/env.js");
    if (!hasSecret("ANTHROPIC_API_KEY")) { console.error("The consistency suite makes live model calls: add ANTHROPIC_API_KEY to ~/.factory/.env, or pass --report for runs that already exist."); process.exit(2); }
    const runs = Number(values("runs")[0] ?? 1);
    if (!Number.isInteger(runs) || runs < 1) { console.error("--runs must be a whole number from 1"); process.exit(2); }
    const cases = listCases(undefined, values("group"));
    if (!cases.length) { console.error("No cases match."); process.exit(2); }
    console.log(`Estimating ${cases.length} case(s) x ${runs} run(s), cache off. This makes live model calls.`);
    for (let k = 0; k < runs; k++) for (const c of cases) samples.push(await runCase({ ...c, name: runs > 1 ? `${c.name}#${k + 1}` : c.name }, (s) => console.log(`  ${s}`)));
  }
  const stats = groupStats(samples);
  console.log("== Estimate consistency ==\n" + formatStats(stats, samples));
  history.consistency = { stats, samples };
  if (stats.some((g) => !g.pass)) failed = true;
}

if (cmd === "gates" || cmd === "all") {
  const { runCases, formatGates, summarise, allGood } = await import("./gates/run.js");
  const results = runCases();
  console.log((cmd === "all" ? "\n" : "") + "== Gate efficacy ==\n" + formatGates(results));
  history.gates = { summary: summarise(results), cases: results };
  if (!allGood(results)) failed = true;
}

if (cmd === "external" || cmd === "all") {
  const { formatExternal } = await import("./external/priors.js");
  console.log((cmd === "all" ? "\n" : "") + formatExternal());
}

if (cmd !== "external" && !flag("no-save")) {
  mkdirSync(resultsDir, { recursive: true });
  appendFileSync(join(resultsDir, "history.jsonl"), JSON.stringify(history) + "\n");
  writeFileSync(join(resultsDir, "latest.json"), JSON.stringify(history, null, 2));
  console.log(`\nSaved to bench/results/ (history.jsonl, latest.json) at ${commit}`);
}
process.exitCode = failed ? 1 : 0;
