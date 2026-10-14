// `factory explain <run> [step]`: each attempt of each step as a short story, read from the ledger alone: what ran, what each
// check said (or why it did not run), why the attempt was retried, parked or passed, and where its files are.
// It reads the raw events, so it also works on a run from before `attempt.summary` existed (with less to say); where a
// summary is there it adds the time split, the kept-or-wiped note, the skipped checks and the retry rule.
import type { LedgerEvent } from "../contracts/index.js";

type Data = Record<string, unknown>;
const d = (e?: LedgerEvent) => (e?.data ?? {}) as Data;

interface Attempt {
  step: string; attempt: number;
  started: LedgerEvent; end?: LedgerEvent; summary?: LedgerEvent;
  checks: LedgerEvent[]; skipped: LedgerEvent[]; usage: LedgerEvent[];
  parked?: LedgerEvent; closed?: LedgerEvent; card?: LedgerEvent;
}

function splitKey(key: string): { step: string; attempt: number } {
  const i = key.lastIndexOf("/"), n = Number(key.slice(i + 1));
  return i < 0 || !Number.isInteger(n) ? { step: key, attempt: 1 } : { step: key.slice(0, i), attempt: n };
}

/** The run's attempts, oldest first. A check result from before attempts were recorded on it goes to its step's open attempt. */
export function attemptsOf(events: LedgerEvent[]): Attempt[] {
  const all: Attempt[] = [];
  const open = new Map<string, Attempt>(), last = new Map<string, Attempt>();
  for (const e of events) {
    const data = d(e);
    if (e.type === "step.started" && e.key) {
      const a: Attempt = { ...splitKey(e.key), started: e, checks: [], skipped: [], usage: [] };
      all.push(a); open.set(a.step, a); last.set(a.step, a);
    } else if ((e.type === "step.completed" || e.type === "step.failed" || e.type === "step.interrupted") && e.key) {
      const a = open.get(splitKey(e.key).step);
      if (a && !a.end) a.end = e;
    } else if (e.type === "attempt.summary" && e.key) {
      const a = last.get(splitKey(e.key).step);
      if (a && a.attempt === splitKey(e.key).attempt) a.summary = e;
      open.delete(splitKey(e.key).step);
    } else if (e.type === "usage" && e.key) {
      const a = last.get(splitKey(e.key).step);
      if (a && a.attempt === splitKey(e.key).attempt) a.usage.push(e);
    } else if (e.type === "gate.result" || e.type === "gate.skipped") {
      const a = last.get(String(data.step ?? ""));
      if (a && (data.attempt === undefined || data.attempt === a.attempt)) (e.type === "gate.result" ? a.checks : a.skipped).push(e);
    } else if (e.type === "run.parked" || e.type === "human.requested") {
      const a = last.get(String(data.step ?? ""));
      if (a) { if (e.type === "run.parked") a.parked = e; else a.card = e; }
    } else if (e.type === "run.closed") {
      const a = all[all.length - 1];
      if (a) a.closed = e;
    }
  }
  return all;
}

const dur = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`; };
const short = (sha: unknown) => String(sha ?? "").slice(0, 12);
const indent = (text: string, by: string) => text.split("\n").map((l) => by + l).join("\n");

function how(a: Attempt): string {
  const f = d(a.end);
  if (!a.end) return "did not finish (no end recorded)";
  if (a.end.type === "step.completed") return "passed";
  if (a.end.type === "step.interrupted") return f.reason === "back" ? `went back to an earlier step${f.why ? `: ${f.why}` : ""}` : f.reason === "waiting" ? "waiting for a person" : `interrupted (${f.reason ?? "no reason recorded"})`;
  if (a.parked || f.parked || f.action === "park") return "PARKED";
  if (a.closed || f.action === "close") return "run closed";
  if (f.action === "retry") return `failed, retried${f.nextRung !== undefined && f.nextRung !== f.rung ? ` on rung ${f.nextRung}` : " on the same rung"}`;
  if (f.action === "backoff") return `failed, waited ${dur(Number(f.waitMs ?? 0))} and retried`;
  if (f.action === "defer") return "failed on tests a later task must make pass; moved on";
  if (f.action === "questions") return "failed; its checks were turned into questions";
  if (f.action === "a5-check") return "PARKED (the same locked test failed twice)";
  return `failed (${f.action ?? "no decision recorded"})`;
}

function ladderLine(l: Data): string {
  const rule: Record<string, string> = {
    "rate-limit": "a rate limit or outage: wait, then the same attempt again",
    "attempts-used": "every attempt this step is allowed has been used",
    safety: "a safety check failed",
    "same-locked-test": "the same locked test failed twice",
    "same-error": "the same error was thrown twice in a row, so another attempt cannot change it",
    "same-failure": "the same failure (or the same change) twice in a row",
    "rung-used": "this rung's attempts are used up",
    retry: "a first failure at this rung",
  };
  return `rule: ${rule[String(l.rule)] ?? l.rule}. Attempts ${l.attempts} of ${l.maxAttempts}; rung ${l.rung}${l.rungKind ? ` (${l.rungKind})` : ""} used ${l.attemptsAtRung} of ${l.attemptsPerRung}; `
    + `same failure as before: ${l.sameSignature ? "yes" : "no"}; same change as before: ${l.sameDiff ? "yes" : "no"}; stronger rungs left: ${l.rungsLeft}`
    + (l.nextRung !== undefined ? `; next: rung ${l.nextRung}${l.nextRungKind ? ` (${l.nextRungKind})` : ""}` : "");
}

/** One attempt, as lines of text. `full`: every check's whole detail and every file. */
export function explainAttempt(a: Attempt, o: { full?: boolean } = {}): string {
  const s = d(a.summary), f = d(a.end), st = d(a.started);
  const cost = a.usage.reduce((n, u) => n + Number(d(u)["gen_ai.usage.cost_usd"] ?? 0), 0);
  const models = [...new Set(a.usage.map((u) => String(d(u)["gen_ai.request.model"] ?? "")).filter(Boolean))];
  const route = (st.route ?? {}) as Data;
  const ms = a.summary ? Number(s.ms ?? 0) : a.end ? Date.parse(a.end.ts) - Date.parse(a.started.ts) : 0;
  const out: string[] = [];
  out.push(`${a.step}  attempt ${a.attempt}  rung ${st.rung ?? 0}${models.length ? `  ${models.join(", ")}` : route.model ? `  ${route.model}` : ""}  ${dur(ms)}  $${cost.toFixed(3)}  →  ${how(a)}`);
  const notes = (s.notes ?? {}) as Data;
  if (notes.previousCode) out.push(`  last attempt's code: ${notes.previousCode} (${notes.previousCodeWhy ?? "no reason recorded"})${notes.previousCodeDiff ? `; its change is file ${short(notes.previousCodeDiff)}` : ""}`);
  else if (f.retryMode) out.push(`  last attempt's work: ${f.retryMode === "keep" ? "kept" : "wiped"} (${f.retryReason ?? "no reason recorded"})`);
  if (notes.previousTests) out.push(`  last attempt's tests: ${notes.previousTests} (${notes.previousTestsWhy ?? "no reason recorded"})`);
  const time = Object.entries((s.timeMs ?? {}) as Record<string, number>).filter(([, v]) => v >= 1000).sort((x, y) => y[1] - x[1]);
  if (time.length) out.push(`  time: ${time.map(([k, v]) => `${k} ${dur(v)}`).join(", ")}`);
  if (a.checks.length || a.skipped.length) out.push("  checks:");
  for (const c of a.checks) {
    const cd = d(c), facts = Object.entries((cd.facts ?? {}) as Data).map(([k, v]) => `${k}=${v}`).join(", ");
    out.push(`    ${cd.passed ? "pass" : "FAIL"}  ${cd.gateId}${cd.safety ? " (safety)" : ""}${!cd.passed && cd.failureCount ? `  ${cd.failureCount} failure${cd.failureCount === 1 ? "" : "s"}` : ""}${facts ? `  [${facts}]` : ""}`);
    if (!cd.passed) {
      const details = String(cd.details ?? "");
      out.push(indent(o.full ? details : details.split("\n").slice(0, 6).join("\n").slice(0, 900) + (details.length > 900 || details.split("\n").length > 6 ? "\n... (whole result: file " + short(c.outputs?.[0]) + ")" : ""), "          "));
    }
  }
  for (const k of a.skipped) out.push(`    not run  ${d(k).gateId}: ${d(k).reason}`);
  if (a.end?.type === "step.failed") {
    if (f.signature && f.signature !== "park") out.push(`  failure: kind ${f.category ?? "?"}, signature ${String(f.signature).slice(0, 80)}${Array.isArray(f.lockedFailedIds) && f.lockedFailedIds.length ? `, locked tests failing: ${(f.lockedFailedIds as string[]).join(", ")}` : ""}`);
    if (f.reason) out.push(`  decision: ${f.action ?? "park"}: ${f.reason}`);
    if (f.ladder) out.push(`  ${ladderLine(f.ladder as Data)}`);
    if (Array.isArray(f.testCheck)) out.push(`  next attempt opens with the test-or-code check of: ${(f.testCheck as string[]).join(", ")}`);
  }
  if (a.parked) out.push(`  parked: ${d(a.parked).reason}`);
  if (a.closed) out.push(`  closed: ${d(a.closed).reason}`);
  if (a.card) out.push(`  card: ${d(a.card).kind} ${d(a.card).cardId}`);
  const files = (s.files ?? []) as { what: string; sha: string }[];
  const fallback = [...(a.end?.type === "step.failed" && a.end.outputs?.[0] ? [{ what: "failures (every failure, uncut)", sha: a.end.outputs[0] }] : []), ...a.checks.filter((c) => !d(c).passed && c.outputs?.[0]).map((c) => ({ what: `check ${d(c).gateId} result`, sha: c.outputs![0]! }))];
  const shown = files.length ? (o.full ? files : files.filter((x) => !/^check .* (result|input)/.test(x.what) || a.checks.some((c) => !d(c).passed && x.what.startsWith(`check ${d(c).gateId} `)))) : fallback;
  if (shown.length) {
    out.push("  files (artifacts/<name> in the run's ledger folder):");
    for (const x of shown) out.push(`    ${x.sha}  ${x.what}`);
  }
  return out.join("\n");
}

/** The whole run, or one step of it (`implement/TASK-1`, or `implement` for every task). */
export function explainRun(events: LedgerEvent[], o: { step?: string; full?: boolean } = {}): string {
  const attempts = attemptsOf(events).filter((a) => !o.step || a.step === o.step || a.step.startsWith(`${o.step}/`));
  if (!attempts.length) return o.step ? `No attempt of ${o.step} in this run.` : "No step has started in this run.";
  const bySteps = new Map<string, Attempt[]>();
  for (const a of attempts) bySteps.set(a.step, [...(bySteps.get(a.step) ?? []), a]);
  const head = [...bySteps].map(([step, as]) => {
    const failed = as.filter((a) => a.end?.type === "step.failed").length;
    return `${step}: ${as.length} attempt${as.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}, ended ${how(as[as.length - 1]!)}`;
  });
  const old = attempts.some((a) => !a.summary && a.end);
  return [
    ...head, "",
    ...attempts.map((a) => explainAttempt(a, o)),
    ...(old ? ["", "Some attempts are from before per-attempt summaries were recorded: they show no time split, no skipped checks and no retry rule."] : []),
  ].join("\n\n").replace(/\n{3,}/g, "\n\n");
}
