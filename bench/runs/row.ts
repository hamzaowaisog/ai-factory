// One run as one row, read from its ledger (or an archived .tar.gz of the run folder). No model calls. Per-step cost,
// tokens, time and retries come from the run scorecard (src/report.ts), so a row always agrees with `factory report`;
// the row adds what the scorecard doesn't keep: commit, size, lane, risk, impact, lines changed, locked tests, card waits.
import "../../src/stages/modes.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { scoreRun } from "../../src/report.js";
import { readOutput } from "../../src/stages/framework.js";
import { lightBuild } from "../../src/stages/lane.js";
import { TEST_SCOPE } from "../../src/stages/build.js";
import { matchesAny } from "../../src/util/glob.js";

export interface StepRow { step: string; costUsd: number; tokens: { input: number; cached: number; output: number }; minutes: number; attempts: number; retryReasons: string[]; gateFailures: number; models: string[] }
export interface Changes { prodLines: number; prodFiles: number; testLinesAdded: number; testFiles: number; files: string[] }
export interface RunRow {
  kind: "factory";
  runId: string;
  factoryCommit?: string;
  ticket: string;
  project: string;
  repo: { name?: string; baseRef?: string; baseCommit?: string };
  outcome: string;
  parkedReason?: string;
  size?: string;
  lane?: "light" | "full";
  risk: { intake?: string; impact?: string };
  impact?: Record<string, number>;
  steps: StepRow[];
  costUsd: number;
  activeMin: number;
  wallMin?: number;
  /** from the delivered branch in the run's repo; absent when the branch or repo is gone */
  changes?: Changes;
  lockedTests?: { total: number; passed: number; failed: string[] };
  cards: { kind: string; waitedSec?: number; decision?: string }[];
  models: string[];
}

/** A run id, a run folder, or an archived run (.tar.gz of the run folder): the ledger to read. */
export function openRun(ref: string): Ledger {
  if (ref.endsWith(".tar.gz") || ref.endsWith(".tgz")) {
    const dir = mkdtempSync(join(tmpdir(), "run-row-"));
    execFileSync("tar", ["-xzf", ref, "-C", dir]);
    const runId = readdirSync(dir).find((d) => existsSync(join(dir, d, "events.jsonl")));
    if (!runId) throw new Error(`${ref} holds no run folder (events.jsonl)`);
    return Ledger.open(runId, join(dir, runId));
  }
  if (existsSync(join(ref, "events.jsonl"))) return Ledger.open(basename(ref), ref);
  return Ledger.open(ref);
}

/** Lines and files the delivered branch changed against the base: production vs tests, the manifest left out. */
export function changesOf(repo: string, base: string, head: string): Changes | undefined {
  let out: string;
  try { out = execFileSync("git", ["-C", repo, "diff", "--numstat", "--no-renames", base, head], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return undefined; }
  const c: Changes = { prodLines: 0, prodFiles: 0, testLinesAdded: 0, testFiles: 0, files: [] };
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [a, d, path] = line.split("\t") as [string, string, string];
    if (path.startsWith(".factory/")) continue;
    c.files.push(path);
    const added = Number(a) || 0, removed = Number(d) || 0;
    if (matchesAny(path, TEST_SCOPE)) { c.testFiles++; c.testLinesAdded += added; } else { c.prodFiles++; c.prodLines += added + removed; }
  }
  return c;
}

const minutes = (a?: string, b?: string) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60_000 : undefined);

export function rowOf(ledger: Ledger, opts: { factoryCommit?: string } = {}): RunRow {
  const events = ledger.events();
  const st = replay(events);
  const score = scoreRun(ledger);
  const info = st.info;
  const intake = readOutput<{ risk?: string; rigor?: string; changeClass?: string }>(st, ledger, "intake");
  const impactStep = st.steps.get("impact");
  const size = typeof st.steps.get("plan")?.data?.complexity === "string" ? String(st.steps.get("plan")!.data!.complexity) : info.complexity;
  const gateFails = new Map<string, number>();
  for (const e of events) if (e.type === "gate.result" && !(e.data as { passed?: boolean }).passed) { const k = String((e.data as { step?: string }).step ?? e.key ?? "?"); gateFails.set(k, (gateFails.get(k) ?? 0) + 1); }
  // cards: asked → decided, by card id
  const asked = new Map<string, { kind: string; ts: string }>();
  const cards: RunRow["cards"] = [];
  for (const e of events) {
    const d = (e.data ?? {}) as { cardId?: string; kind?: string; decision?: string };
    if (e.type === "human.requested" && d.cardId) asked.set(d.cardId, { kind: d.kind ?? "card", ts: e.ts });
    if (e.type === "human.decided" && d.cardId && asked.has(d.cardId)) {
      const a = asked.get(d.cardId)!;
      cards.push({ kind: a.kind, waitedSec: Math.round((Date.parse(e.ts) - Date.parse(a.ts)) / 1000), decision: d.decision });
      asked.delete(d.cardId);
    }
  }
  for (const a of asked.values()) cards.push({ kind: a.kind });
  // locked tests: accept's evidence, criterion by criterion
  const ev = readOutput<{ items: { ac: string; kind: string; testIds: string[]; passed: boolean }[] }>(st, ledger, "accept");
  const tested = ev?.items.filter((i) => i.kind !== "manual" && i.testIds.length) ?? [];
  const branch = st.workspace?.branch ?? `factory/${info.runId}`;
  const changes = info.repoPath && info.baseCommit ? changesOf(info.repoPath, info.baseCommit, branch) : undefined;
  const created = events.find((e) => e.type === "run.created")?.ts;
  const delivered = events.find((e) => e.type === "run.delivered")?.ts;
  return {
    kind: "factory", runId: info.runId,
    ...(opts.factoryCommit ?? info.versions?.commit ? { factoryCommit: opts.factoryCommit ?? info.versions!.commit } : {}),
    ticket: info.sources?.find((s) => s.kind === "jira")?.key ?? (info.request ?? "").replace(/\s+/g, " ").slice(0, 80),
    project: info.project,
    repo: { name: info.repoPath ? basename(info.repoPath) : undefined, baseRef: info.baseRef, baseCommit: info.baseCommit },
    outcome: score.status, ...(score.parkedReason ? { parkedReason: score.parkedReason } : {}),
    ...(size ? { size } : {}),
    ...(intake && size ? { lane: lightBuild(intake as never, size) ? "light" as const : "full" as const } : {}),
    risk: { intake: intake?.risk, impact: impactStep?.data?.risk as string | undefined },
    ...(impactStep?.data?.counts ? { impact: impactStep.data.counts as Record<string, number> } : {}),
    steps: score.steps.map((s) => ({
      step: s.step, costUsd: s.costUsd, tokens: { input: s.tokens.input, cached: s.tokens.cached, output: s.tokens.output },
      minutes: s.activeSec / 60, attempts: s.attempts, retryReasons: s.retryReasons, gateFailures: gateFails.get(s.step) ?? gateFails.get(s.stage) ?? 0, models: s.models,
    })),
    costUsd: score.costUsd, activeMin: score.activeMin, ...(minutes(created, delivered) !== undefined ? { wallMin: minutes(created, delivered) } : {}),
    ...(changes ? { changes } : {}),
    ...(ev ? { lockedTests: { total: tested.length, passed: tested.filter((i) => i.passed).length, failed: tested.filter((i) => !i.passed).map((i) => i.ac) } } : {}),
    cards, models: [...new Set(score.steps.flatMap((s) => s.models))].sort(),
  };
}
