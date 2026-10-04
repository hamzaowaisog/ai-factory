// End-to-end eval with hidden tests.
//   npx tsx bench/e2e/run.ts validate [--case <id>]                     free: base fails, reference passes x3, broken caught
//   npx tsx bench/e2e/run.ts run --fake [--patch reference|broken] [--case <id>] [--repeats n]   free: scripted model and agent
//   npx tsx bench/e2e/run.ts run --spend --max-cost <usd> --like <project> [--case <id>] [--repeats n] [--yes]       PAID
//   npx tsx bench/e2e/run.ts run --baseline claude-code --spend --max-cost <usd> [--case <id>] [--repeats n] [--yes] PAID
//   npx tsx bench/e2e/run.ts score --case <id> --patch <file>            free: score any diff (e.g. a baseline's)
// Each case and each repeat is reported on its own; there is no overall percentage. Results go to e2e/results/.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse } from "yaml";
import { markEvalHome } from "../../src/ledger/human.js";
import { setAgentScript } from "../../src/runners/claude-agent.js";
import { setProviderFactory } from "../../src/stages/think.js";
import { dirtyWarning } from "../../src/stages/executor.js";
import { HERE, loadE2ECases, patchSize, type E2ECase } from "./case.js";
import { e2eAgent, e2eProvider } from "./fake.js";
import { commitWith, freshBase, WORK } from "./lab.js";
import { runClaudeCode, runFactory, runPatch, type E2ERow } from "./run-case.js";
import { validateCase } from "./validate.js";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The patched files a scripted implementer writes: the patch applied to a fresh base. */
function patchedFiles(c: E2ECase, patch: string): Record<string, string> {
  const { dir, commit } = freshBase(c);
  commitWith(dir, commit, "fake-impl", { patch });
  return Object.fromEntries(patchSize(patch).files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

export function formatRows(rows: E2ERow[]): string {
  const lines = ["case                          mode         rep  outcome     hidden   cost    min  lines/ref  creep  cards  leaks"];
  for (const r of rows) {
    const h = r.hidden ? `${r.hidden.passed}/${r.hidden.total}${r.hidden.flaky ? " ~" : ""}` : "-";
    lines.push(`${r.caseId.padEnd(29)} ${r.mode.padEnd(12)} ${String(r.repeat).padStart(3)}  ${r.outcome.slice(0, 10).padEnd(10)}  ${h.padEnd(7)} ${`$${r.costUsd.toFixed(2)}`.padStart(6)} ${r.minutes.toFixed(1).padStart(5)}  ${r.linesVsReference === undefined ? "-".padStart(9) : `${r.prodLines}/${pct(r.linesVsReference)}`.padStart(9)}  ${String(r.creepFiles.length).padStart(5)}  ${String(r.cardsAnswered).padStart(5)}  ${String(r.leaks.length).padStart(5)}`);
    if (r.stoppedAt) lines.push(`    stopped: ${r.stoppedAt}`);
    if (r.hidden?.brokeExisting.length) lines.push(`    broke existing tests: ${r.hidden.brokeExisting.slice(0, 3).join(", ")}`);
    for (const l of r.leaks.slice(0, 3)) lines.push(`    LEAK: ${l}`);
  }
  // per case, over its repeats: never one overall number
  const byCase = new Map<string, E2ERow[]>();
  for (const r of rows) byCase.set(`${r.caseId} (${r.mode})`, [...(byCase.get(`${r.caseId} (${r.mode})`) ?? []), r]);
  lines.push("", "per case (a case passes a repeat when every hidden test passed both scoring runs):");
  for (const [k, rs] of byCase) {
    const passes = rs.filter((r) => r.hidden?.pass).length;
    const disagree = passes > 0 && passes < rs.length;
    lines.push(`  ${k}: passed ${passes} of ${rs.length}${disagree ? "  ← repeats disagree" : ""}${rs.some((r) => r.hidden?.flaky) ? "  ← a hidden test was flaky" : ""}; cost ${rs.map((r) => `$${r.costUsd.toFixed(2)}`).join(", ")}`);
  }
  return lines.join("\n");
}

function save(kind: string, data: unknown): string {
  const dir = join(HERE, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}.json`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

/** The eval harness's own temporary factory home (cards there are answered by it); a paid run takes the keys file. */
function evalHome(paid: boolean): string {
  // under the factory's home folder: the same disk as the shared package cache (hard links), and shared with Docker's VM
  mkdirSync(WORK, { recursive: true });
  const home = mkdtempSync(join(WORK, "home-"));
  process.env.FACTORY_HOME = home;
  markEvalHome(home);
  if (paid) copyFileSync(join(homedir(), ".factory", ".env"), join(home, ".env"));
  else writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-fake-e2e-000000000000\nOPENAI_API_KEY=sk-fake-e2e-000000000000\n", { mode: 0o600 });
  return home;
}

async function confirm(total: number): Promise<boolean> {
  if (flag("yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`This can spend up to $${total.toFixed(2)}. Type yes to go on: `);
  rl.close();
  return a.trim() === "yes";
}

if (process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js")) {
  const cases = loadE2ECases().filter((c) => !opt("case") || c.id === opt("case"));
  if (!cases.length) { console.error(`No case ${opt("case") ?? ""}`); process.exit(2); }
  if (cmd === "validate") {
    const out = [];
    for (const c of cases) {
      const v = await validateCase(c, console.log);
      out.push(v);
      console.log(`${v.caseId}: ${v.ok ? "OK" : "NOT OK"}${v.unstable ? " (unstable: not scored)" : ""}; reference ${v.referenceSize.lines} lines in ${v.referenceSize.files.length} file(s); guards: ${v.guards.join(", ") || "none"}${v.problems.length ? `\n    ${v.problems.join("\n    ")}` : ""}`);
    }
    console.log(`\nSaved ${save("validate", out)}`);
    if (out.some((v) => !v.ok)) process.exit(1);
  } else if (cmd === "score") {
    const c = cases[0]!;
    const r = await runPatch(c, 1, readFileSync(opt("patch")!, "utf8"), "patch", console.log);
    console.log(formatRows([r]));
  } else if (cmd === "run") {
    const repeats = Number(opt("repeats") ?? (flag("spend") ? 2 : 1));
    if (flag("fake") === flag("spend")) { console.error("Say --fake (free, scripted) or --spend --max-cost <usd> (real models, real cost)."); process.exit(2); }
    const rows: E2ERow[] = [];
    if (flag("fake")) {
      evalHome(false);
      const which = (opt("patch") ?? "reference") as "reference" | "broken";
      let current = cases[0]!; let files: Record<string, string> = {};
      setProviderFactory(() => e2eProvider(() => current, () => current[which]));
      setAgentScript(e2eAgent(() => current, () => files));
      for (const c of cases) for (let i = 1; i <= repeats; i++) {
        current = c; files = patchedFiles(c, c[which]);
        rows.push(await runFactory(c, i, { maxCostUsd: c.maxCostUsd, log: console.log }));
      }
    } else {
      const maxCost = Number(opt("max-cost"));
      if (!(maxCost > 0)) { console.error("A paid run needs --max-cost <usd> (the cap per run)."); process.exit(2); }
      const total = cases.length * repeats * maxCost;
      console.log(`PAID: ${cases.length} case(s) x ${repeats} repeat(s) x $${maxCost} cap = at most $${total.toFixed(2)}, a hard stop.`);
      const dirty = dirtyWarning(); if (dirty) console.log(dirty);
      if (!(await confirm(total))) { console.log("Nothing spent."); process.exit(1); }
      evalHome(true);
      let spent = 0;
      const like = opt("like") ? parse(readFileSync(join(homedir(), ".factory", "projects", `${opt("like")}.yaml`), "utf8")) as Record<string, unknown> : undefined;
      const key = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(join(homedir(), ".factory", ".env"), "utf8"))?.[1]?.trim() ?? "";
      for (const c of cases) for (let i = 1; i <= repeats; i++) {
        if (spent + maxCost > total + 1e-9) { console.log(`Stopped: the next run could pass the $${total.toFixed(2)} total.`); break; }
        const r = opt("baseline") === "claude-code"
          ? await runClaudeCode(c, i, { model: "claude-sonnet-5", maxCostUsd: maxCost, apiKey: key, log: console.log })
          : await runFactory(c, i, { maxCostUsd: maxCost, like: like ? { prices: like.prices, steps: like.steps, policy: like.policy } : undefined, log: console.log });
        rows.push(r); spent += r.costUsd;
      }
      console.log(`spent $${spent.toFixed(2)} of at most $${total.toFixed(2)}`);
    }
    console.log(`\n${formatRows(rows)}\n\nSaved ${save(flag("fake") ? "fake" : "paid", rows)}`);
    if (flag("fake") && rows.some((r) => r.leaks.length)) { console.error("LEAK: the run could read the hidden tests"); process.exit(1); }
  } else {
    console.error("Use: validate | run --fake | run --spend --max-cost <usd> | score --case <id> --patch <file>");
    process.exit(2);
  }
}
