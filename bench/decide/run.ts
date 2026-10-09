// Decision adapters compared on stored intakes (src/decide/decide.ts). Nothing here is part of a run.
//   npx tsx bench/decide/run.ts --dry                                          free: every case through the fake adapter
//   npx tsx bench/decide/run.ts --pairs llm:<model>,jev --spend --max-cost <usd> [--price <model>=<in>/<out>] [--yes]   PAID
// Cases: each distinct request in ledgers/ (with the intent its intake wrote) and every bench/decide/cases/*.json.
// --labels <file> (default bench/decide/labels.json) scores the picks. --max-cost caps the whole run, not one case.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { useEvalHome } from "../eval-home.js";
import { ProjectConfig } from "../../src/config/project.js";
import type { Intent } from "../../src/contracts/index.js";
import { decide, parsePair, QUESTIONS, signals, type DecisionRecord, type DecisionState } from "../../src/decide/decide.js";
import { DEFAULT_POLICY } from "../../src/gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { setPrice } from "../../src/runners/pricing.js";
import type { StepContext } from "../../src/stages/framework.js";
import { NO_TRACE } from "../../src/util/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** the most one llm call may cost (src/decide/decide.ts) */
const CALL_CAP_USD = 0.05;

export interface DecideCase { id: string; from: "ledger" | "written"; state: DecisionState }
export type Labels = Record<string, Record<string, string>>;
export interface DecideRow { caseId: string; pair: string; record: DecisionRecord }

/** One case per distinct request in a folder of run ledgers, then the hand-written ones. */
export function loadCases(ledgersDir: string, casesDir: string): DecideCase[] {
  const out: DecideCase[] = [];
  const seen = new Set<string>();
  for (const id of existsSync(ledgersDir) ? readdirSync(ledgersDir).sort() : []) {
    if (!existsSync(join(ledgersDir, id, "events.jsonl"))) continue;
    const ledger = Ledger.open(id, join(ledgersDir, id));
    const st = replay(ledger.events());
    const intake = st.steps.get("intake");
    const request = st.info.request ?? "";
    if (intake?.status !== "completed" || !intake.outputs[0] || seen.has(request)) continue;
    seen.add(request);
    const intent = ledger.getJson<Intent>(intake.outputs[0])!;
    out.push({ id, from: "ledger", state: { signals: signals(request), intent: { changeClass: intent.changeClass, risk: intent.risk, touchesUi: intent.touchesUi }, spans: intent.spans.map((s) => s.text) } });
  }
  for (const f of existsSync(casesDir) ? readdirSync(casesDir).filter((x) => x.endsWith(".json")).sort() : []) {
    const c = JSON.parse(readFileSync(join(casesDir, f), "utf8")) as { id: string; request: string; intent: DecisionState["intent"]; spans?: string[] };
    // no intake ran on a written case: its non-empty lines stand in for the spans
    out.push({ id: c.id, from: "written", state: { signals: signals(c.request), intent: c.intent, spans: c.spans ?? c.request.split("\n").filter((l) => l.trim()) } });
  }
  return out;
}

/** Per pair and question: right picks of the labelled ones, and the confident "full spec" picks that were wrong. */
export function score(rows: DecideRow[], labels: Labels, confident = 0.8): { pair: string; question: string; right: number; labelled: number; confidentWrongFullSpec: number }[] {
  const out = new Map<string, { pair: string; question: string; right: number; labelled: number; confidentWrongFullSpec: number }>();
  for (const r of rows) for (const a of r.record.answers) {
    const want = labels[r.caseId]?.[a.id];
    if (!want) continue;
    const k = `${r.pair} ${a.id}`;
    const s = out.get(k) ?? { pair: r.pair, question: a.id, right: 0, labelled: 0, confidentWrongFullSpec: 0 };
    s.labelled++;
    if (a.pick === want) s.right++;
    else if (a.pick === "full spec" && a.confidence >= confident) s.confidentWrongFullSpec++;
    out.set(k, s);
  }
  return [...out.values()];
}

export function formatRows(rows: DecideRow[]): string {
  const lines = [`${"case".padEnd(44)} ${"pair".padEnd(26)} ${QUESTIONS.map((q) => q.id.padEnd(30)).join(" ")}    cost     ms`];
  for (const r of rows) {
    const cell = (id: string) => { const a = r.record.answers.find((x) => x.id === id); return (a ? `${a.pick} (${a.confidence.toFixed(2)})` : "-").padEnd(30); };
    lines.push(`${r.caseId.slice(0, 44).padEnd(44)} ${r.pair.slice(0, 26).padEnd(26)} ${QUESTIONS.map((q) => cell(q.id)).join(" ")} ${`$${r.record.costUsd.toFixed(5)}`.padStart(8)} ${String(r.record.ms).padStart(6)}`);
    if (r.record.error) lines.push(`    error: ${r.record.error}`);
    if (r.record.dropped.length) lines.push(`    dropped (not an option, or no confidence): ${r.record.dropped.join(", ")}`);
  }
  return lines.join("\n");
}

/** Every case through every pair, stopping once `maxCost` is spent. */
export async function runPairs(cases: DecideCase[], pairs: string[], maxCost: number): Promise<DecideRow[]> {
  const ledger = Ledger.create("decide-bench");
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "decide-bench", changeClass: "feature", request: "-" } }, HUMAN_WRITER);
  const ctx: StepContext = {
    runId: "decide-bench", ledger, writer: HUMAN_WRITER, state: replay(ledger.events()), project: ProjectConfig.parse({ project: "decide-bench", repo: "-", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
  const rows: DecideRow[] = [];
  let spent = 0;
  for (const c of cases) for (const pair of pairs) {
    if (spent >= maxCost) { console.log(`Stopped: $${spent.toFixed(4)} spent, the cap is $${maxCost}.`); return rows; }
    const record = await decide(ctx, pair, c.state);
    if (!record) continue;
    spent += record.costUsd;
    rows.push({ caseId: c.id, pair, record });
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (k: string) => args.includes(`--${k}`);
  const dry = flag("dry");
  const pairs = dry ? ["fake"] : (opt("pairs") ?? "").split(",").filter(Boolean);
  const maxCost = Number(opt("max-cost") ?? 0);
  if (!pairs.length) { console.error("Give --pairs (for example llm:claude-haiku-5-5,jev) or --dry."); process.exit(2); }
  for (const p of pairs) parsePair(p);
  if (!dry && !(flag("spend") && maxCost > 0)) { console.error("This calls real models: add --spend --max-cost <usd> (the cap for the whole run), or use --dry."); process.exit(2); }
  for (const p of (opt("price") ?? "").split(",").filter(Boolean)) {
    const m = /^(.+)=([\d.]+)\/([\d.]+)$/.exec(p);
    if (!m) { console.error(`--price is <model>=<input>/<output> in USD per million tokens, got "${p}".`); process.exit(2); }
    setPrice(m[1]!, { input: Number(m[2]), output: Number(m[3]), cacheRead: 0, cacheWrite: 0 });
  }
  const cases = loadCases(opt("ledgers") ?? join(HERE, "..", "..", "ledgers"), opt("cases") ?? join(HERE, "cases"));
  const labelsFile = opt("labels") ?? join(HERE, "labels.json");
  const labels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, "utf8")) as Labels : {};
  console.log(`${cases.length} cases (${cases.filter((c) => c.from === "ledger").length} from ledgers, ${cases.filter((c) => c.from === "written").length} written), pairs: ${pairs.join(", ")}`);
  if (!dry) {
    const worst = Math.min(maxCost, cases.length * pairs.length * CALL_CAP_USD);
    const rl = flag("yes") ? undefined : createInterface({ input: process.stdin, output: process.stdout });
    const a = rl ? await rl.question(`This can spend up to $${worst.toFixed(2)}. Type yes to go on: `) : "yes";
    rl?.close();
    if (a.trim() !== "yes") process.exit(1);
  }
  useEvalHome("decide", { paid: !dry });
  const rows = await runPairs(cases, pairs, dry ? Infinity : maxCost);
  console.log(formatRows(rows));
  const scores = score(rows, labels);
  if (scores.length) {
    console.log("\nagainst the labels:");
    for (const s of scores) console.log(`  ${s.pair.padEnd(26)} ${s.question.padEnd(9)} ${s.right} of ${s.labelled} right; confident wrong "full spec": ${s.confidentWrongFullSpec}`);
  } else console.log(`\nNo labels for these cases in ${labelsFile}: nothing scored.`);
  console.log(`\ntotal $${rows.reduce((n, r) => n + r.record.costUsd, 0).toFixed(5)}`);
  mkdirSync(join(HERE, "results"), { recursive: true });
  const file = join(HERE, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${dry ? "dry" : "paid"}.json`);
  writeFileSync(file, `${JSON.stringify({ pairs, rows, scores }, null, 2)}\n`);
  console.log(`saved ${file}`);
}
