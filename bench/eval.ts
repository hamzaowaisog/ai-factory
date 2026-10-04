// One entry point for every eval:  npm run eval -- list  |  npm run eval -- <suite> [args...]
// It wraps the existing commands (they stay where they are). A paid suite runs only with --spend --max-cost <usd>;
// the suite itself prints the worst-case total and asks for --yes or a typed "yes" before spending.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Suite { name: string; cost: "free" | "free or paid"; measures: string; estimate?: string; cmd: string[]; paidWith?: string }
export const SUITES: Suite[] = [
  { name: "gates", cost: "free", measures: "each gate catches its seeded defects and passes clean input", cmd: ["bench/run.ts", "gates"] },
  { name: "calibrate", cost: "free", measures: "the ledger predicts its own cost and time (needs finished runs)", cmd: ["bench/run.ts", "calibrate"] },
  { name: "spec", cost: "free or paid", measures: "spec quality on 14 cases: expected behaviour found, scope creep, gaps raised", estimate: "about $0.50-1.00 per case run (estimate); --fake is free", cmd: ["bench/spec/run.ts"], paidWith: "--spend" },
  { name: "ripple", cost: "free", measures: "the impact code layer against files real commits changed (recall, precision)", cmd: ["bench/ripple/replay.ts"] },
  { name: "e2e", cost: "free or paid", measures: "a ticket to a delivered change, scored by hidden tests (5 cases); also a plain Claude Code baseline", estimate: "about $2-3 per factory run, about $0.20 per baseline run (estimate); validate and --fake are free", cmd: ["bench/e2e/run.ts"], paidWith: "--spend" },
  { name: "runs", cost: "free", measures: "one run's record from its ledger; compare runs and baselines; run-record tables", cmd: ["bench/runs/run.ts"] },
];

export function listText(): string {
  const w = Math.max(...SUITES.map((s) => s.name.length));
  return [
    "Evals (npm run eval -- <suite> ...):",
    ...SUITES.map((s) => `  ${s.name.padEnd(w)}  ${s.cost.padEnd(12)}  ${s.measures}${s.estimate ? `\n  ${"".padEnd(w)}  ${"".padEnd(12)}  cost: ${s.estimate}` : ""}`),
    "",
    "A paid run needs --spend --max-cost <usd> (the cap per run); it prints the worst-case total and asks before spending.",
  ].join("\n");
}

/** Why a suite may not run with these arguments (undefined when it may). */
export function refusal(s: Suite, args: string[]): string | undefined {
  if (!s.paidWith || !args.includes(s.paidWith)) return undefined;
  const i = args.indexOf("--max-cost");
  if (i < 0 || !(Number(args[i + 1]) > 0)) return `${s.name} with ${s.paidWith} spends real money: add --max-cost <usd> (the cap per run).`;
  return undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === "list") { console.log(listText()); process.exit(0); }
  const s = SUITES.find((x) => x.name === name);
  if (!s) { console.error(`No suite "${name}".\n\n${listText()}`); process.exit(2); }
  const why = refusal(s, rest);
  if (why) { console.error(why); process.exit(2); }
  const r = spawnSync(process.execPath, [...process.execArgv, join(HERE, "..", "node_modules", "tsx", "dist", "cli.mjs"), join(HERE, "..", s.cmd[0]!), ...s.cmd.slice(1), ...rest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
