// Spec-stage eval.  npm run bench:spec -- [--fake | --spend] [options]
//   --fake            scripted model, temporary factory home, no cost: proves the plumbing, says nothing about quality
//   --spend           real models, the factory home's own .env and prices; refuses to start without it
//   --repeats N       runs per case (default 3)
//   --case a,b        only these case ids (default: all in bench/spec/cases)
//   --max-cost USD    hard cap for each run (default 4); a run that hits it stops and counts as not passed
//   --like PROJECT    copy prices, model routes and policy from this real project (recommended with --spend)
//   --no-save         don't write bench/spec/results/<date>.json
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const fake = flag("fake"), spend = flag("spend");
if (fake === spend) { console.error("Say --fake (free dry run) or --spend (real models, real cost)."); process.exit(2); }
const repeats = Number(opt("repeats") ?? 3), maxCost = Number(opt("max-cost") ?? 4);
if (!(repeats >= 1) || !(maxCost > 0)) { console.error("--repeats must be ≥ 1 and --max-cost > 0"); process.exit(2); }

// a dry run never touches the real factory home: its own ledgers, a fake key
if (fake) {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-spec-eval-"));
  writeFileSync(join(process.env.FACTORY_HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-fake-eval-000000000000\nOPENAI_API_KEY=sk-fake-eval-000000000000\n", { mode: 0o600 });
}

const { HERE, loadCases, loadRepos } = await import("./case.js");
const { prepareRepo, runCase, writeProject } = await import("./eval.js");
const { formatReport, overall, scoreRun, summariseCase } = await import("./score.js");
const { loadProject } = await import("../../src/config/project.js");

const repos = loadRepos();
const only = opt("case")?.split(",").map((s) => s.trim()).filter(Boolean);
const cases = loadCases().filter((c) => !only || only.includes(c.id));
if (only) for (const id of only) if (!cases.some((c) => c.id === id)) { console.error(`No case "${id}"`); process.exit(2); }
if (!cases.length) { console.error("No cases."); process.exit(2); }

const likeName = opt("like");
const like = likeName ? loadProject(likeName) : undefined;
console.log(`${fake ? "Dry run (fake model)" : "PAID run"}: ${cases.length} cases × ${repeats} = ${cases.length * repeats} runs${spend ? `, at most $${(cases.length * repeats * maxCost).toFixed(0)} in total ($${maxCost} cap per run)` : ""}`);
if (spend && !like) console.log("No --like project: prices and routes are the factory defaults (a model without a price is costed at the fallback rate).");

if (fake) {
  const { setProviderFactory } = await import("../../src/stages/think.js");
  const { fakeProvider } = await import("./fake.js");
  setProviderFactory(() => fakeProvider(() => current!));
}

for (const key of new Set(cases.map((c) => c.repo))) {
  console.log(`repo ${key}: ${repos[key]!.url} @ ${repos[key]!.commit.slice(0, 10)}`);
  writeProject(key, prepareRepo(key, repos[key]!), repos[key]!.commit, like);
}

let current: (typeof cases)[number] | undefined;
const scores: ReturnType<typeof scoreRun>[] = [];
const outcomes: Awaited<ReturnType<typeof runCase>>[] = [];
for (const c of cases) {
  for (let r = 1; r <= repeats; r++) {
    current = c;
    const o = await runCase(c, r, { maxCostUsd: maxCost, log: (m) => console.log(`  ${m}`) });
    const s = scoreRun(c, o);
    outcomes.push(o);
    scores.push(s);
    console.log(`  ${c.id} #${r}: ${s.pass ? "PASS" : "fail"} (${s.status}; found ${s.expectHit.length}/${c.expect.length}${s.forbidHit.length ? `, creep ${s.forbidHit.join(",")}` : ""}; $${s.costUsd.toFixed(2)}, ${s.wallMin.toFixed(1)} min)`);
  }
}

const sums = cases.map((c) => summariseCase(c, scores.filter((s) => s.caseId === c.id)));
const all = overall(sums);
console.log("\n" + formatReport(sums, all, scores));

if (!flag("no-save")) {
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
  const dir = join(HERE, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}${fake ? "-fake" : ""}.json`);
  writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), commit, fake, repeats, maxCost, like: likeName, overall: all, cases: sums, runs: scores, outcomes }, null, 2));
  console.log(`\nSaved ${file}`);
}
