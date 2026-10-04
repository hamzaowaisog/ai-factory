// Run records from the ledger, not by hand. Free: reads ledgers and git, no model calls.
//   npx tsx bench/runs/run.ts row <run-id | run folder | run.tar.gz> [--factory-commit <sha>] [--no-save]
//   npx tsx bench/runs/run.ts baseline <claude-code result.json> --name <id> [--repo <dir> --base <sha> --head <ref>]
//   npx tsx bench/runs/run.ts compare <row.json> [<row.json> ...]
//   npx tsx bench/runs/run.ts md <row.json>        the run record's tables (docs/runs/*.md); the narrative is written by hand
// Rows are saved to bench/runs/results/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changesOf, openRun, rowOf, type Changes, type RunRow } from "./row.js";

export interface BaselineRow {
  kind: "baseline";
  runId: string;
  outcome: string;
  costUsd: number;
  activeMin: number;
  turns?: number;
  models: string[];
  changes?: Changes;
}
export type AnyRow = RunRow | BaselineRow;

/** A plain Claude Code run (`claude -p … --output-format json`) as a row: cost, minutes, turns, and lines from its diff. */
export function baselineRow(result: { total_cost_usd?: number; duration_ms?: number; num_turns?: number; is_error?: boolean; subtype?: string; modelUsage?: Record<string, unknown> }, name: string, changes?: Changes): BaselineRow {
  return {
    kind: "baseline", runId: name, outcome: result.is_error ? `error (${result.subtype ?? "?"})` : (result.subtype ?? "done"),
    costUsd: result.total_cost_usd ?? 0, activeMin: (result.duration_ms ?? 0) / 60_000, turns: result.num_turns,
    models: Object.keys(result.modelUsage ?? {}).sort(), ...(changes ? { changes } : {}),
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const mins = (n?: number) => (n === undefined ? "-" : n.toFixed(1));

export function compareTable(rows: AnyRow[]): string {
  const head = ["run", "kind", "outcome", "cost", "active min", "prod lines/files", "test lines/files", "locked tests", "models"];
  const body = rows.map((r) => [
    r.runId, r.kind, r.outcome, money(r.costUsd), mins(r.activeMin),
    r.changes ? `${r.changes.prodLines}/${r.changes.prodFiles}` : "-",
    r.changes ? `${r.changes.testLinesAdded}/${r.changes.testFiles}` : "-",
    r.kind === "factory" && r.lockedTests ? `${r.lockedTests.passed}/${r.lockedTests.total}` : "-",
    r.models.join(", "),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  return [head, ...body].map((cells) => cells.map((c, i) => c.padEnd(w[i]!)).join("  ").trimEnd()).join("\n");
}

/** The tables of a run record (docs/runs/*.md), generated from the row. */
export function markdown(r: RunRow): string {
  const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  return [
    `| | |`, `|---|---|`,
    `| Factory | ${r.factoryCommit ?? "not recorded"} |`,
    `| Project / repo | ${r.project} / ${r.repo.name ?? "-"} at ${r.repo.baseCommit?.slice(0, 7) ?? "-"} (${r.repo.baseRef ?? "-"}) |`,
    `| Ticket | ${r.ticket} |`,
    `| Outcome | **${r.outcome}**${r.parkedReason ? ` (${r.parkedReason})` : ""} |`,
    `| Size / lane / risk | ${r.size ?? "-"} / ${r.lane ?? "-"} / ${r.risk.intake ?? "-"}${r.risk.impact ? ` (impact: ${r.risk.impact})` : ""} |`,
    `| Recorded cost | ${money(r.costUsd)} |`,
    `| Active / wall time | ${mins(r.activeMin)} / ${mins(r.wallMin)} min |`,
    ...(r.changes ? [`| Changed | ${r.changes.prodLines} production lines in ${r.changes.prodFiles} files; ${r.changes.testLinesAdded} test lines in ${r.changes.testFiles} files |`] : []),
    ...(r.lockedTests ? [`| Locked tests | ${r.lockedTests.passed}/${r.lockedTests.total} passed${r.lockedTests.failed.length ? ` (failed: ${r.lockedTests.failed.join(", ")})` : ""} |`] : []),
    ...(r.impact ? [`| Impact | ${Object.entries(r.impact).map(([k, v]) => `${k} ${v}`).join(", ")} |`] : []),
    ``,
    `| Step | Cost | Tokens in (uncached / cached) / out | Minutes | Tries | Gate failures | Models |`,
    `|---|---|---|---|---|---|---|`,
    ...r.steps.map((s) => `| ${s.step} | ${money(s.costUsd)} | ${tok(s.tokens.input)} / ${tok(s.tokens.cached)} / ${tok(s.tokens.output)} | ${mins(s.minutes)} | ${s.attempts}${s.retryReasons.length ? ` (${s.retryReasons[0]})` : ""} | ${s.gateFailures} | ${s.models.join(", ")} |`),
    ``,
    `| Card | Waited | Decision |`, `|---|---|---|`,
    ...(r.cards.length ? r.cards.map((c) => `| ${c.kind} | ${c.waitedSec === undefined ? "still open" : `${c.waitedSec} s`} | ${c.decision ?? "-"} |`) : [`| none | | |`]),
  ].join("\n");
}

const HERE = dirname(fileURLToPath(import.meta.url));
function save(row: AnyRow): string {
  const dir = join(HERE, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${row.runId}.json`);
  writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`);
  return file;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  const pos = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
  if (cmd === "row" && pos[0]) {
    const row = rowOf(openRun(pos[0]), { factoryCommit: opt("factory-commit") });
    console.log(JSON.stringify(row, null, 2));
    if (!rest.includes("--no-save")) console.error(`saved ${save(row)}`);
  } else if (cmd === "baseline" && pos[0] && opt("name")) {
    const repo = opt("repo"), base = opt("base"), head = opt("head");
    const row = baselineRow(JSON.parse(readFileSync(pos[0], "utf8")), opt("name")!, repo && base && head ? changesOf(repo, base, head) : undefined);
    console.log(JSON.stringify(row, null, 2));
    if (!rest.includes("--no-save")) console.error(`saved ${save(row)}`);
  } else if (cmd === "compare" && pos.length) {
    console.log(compareTable(pos.map((f) => JSON.parse(readFileSync(f, "utf8")) as AnyRow)));
  } else if (cmd === "md" && pos[0]) {
    console.log(markdown(JSON.parse(readFileSync(pos[0], "utf8")) as RunRow));
  } else {
    console.error("Use: row <run|folder|.tar.gz> | baseline <result.json> --name <id> [--repo --base --head] | compare <rows…> | md <row.json>");
    process.exit(2);
  }
}
