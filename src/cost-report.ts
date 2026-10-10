// Where a run's money and tokens went, and what was paid for and not used. Computed from the ledger and the
// run trace only (no model calls, no cost). `factory report <run> --cost`.
import type { Ledger } from "./ledger/ledger.js";
import { priceOf } from "./runners/pricing.js";
import { stageOf } from "./report.js";
import { readTrace, type TraceEvent } from "./util/trace.js";
import type { LedgerEvent } from "./contracts/index.js";

export interface KindUsd { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface AttemptCost {
  /** "implement/TASK-7/2" */
  key: string;
  model: string;
  costUsd: number;
  /** passed, failed, asked (stopped to ask a person), interrupted, or open (no outcome recorded) */
  outcome: "passed" | "failed" | "asked" | "interrupted" | "open";
  why?: string;
}

export interface SessionStats {
  step: string;
  attempt: number;
  turns: number;
  /** context size in tokens (input plus cache reads) */
  peak: number;
  avg: number;
  /** times the context was summarised; counted from large drops when the run did not record them */
  compactions: number;
  /** turns after the first that wrote most of the context to the cache again instead of reading it (a gap over the cache's lifetime) */
  rewrites?: number;
  /** per tool: calls and the characters they returned; only in runs that recorded it */
  tools?: Record<string, { calls: number; chars: number }>;
}

export interface CostReport {
  runId: string;
  costUsd: number;
  byKind: KindUsd;
  stages: ({ stage: string; costUsd: number } & KindUsd)[];
  attempts: AttemptCost[];
  /** spend on attempts that did not pass */
  notPassedUsd: number;
  sessions: SessionStats[];
  bigResults: { step: string; attempt: number; tool: string; target: string; chars: number }[];
  packs: { step: string; who: string; packTokens: number; budgetTokens: number; largest: { id: string; tokens: number }[] }[];
  rejected: { step: string; count: number; costUsd: number }[];
  cutOff: number;
  storedAnswers: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function sessionStats(trace: TraceEvent[]): SessionStats[] {
  const by = new Map<string, TraceEvent[]>();
  for (const e of trace) {
    if (!e.step || !["agent.turn", "agent.compact", "agent.summary"].includes(e.kind)) continue;
    const k = `${e.step}\0${e.attempt ?? 1}`;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  const out: SessionStats[] = [];
  for (const [k, evs] of by) {
    const [step, attempt] = k.split("\0") as [string, string];
    // one API message is logged several times as it streams: per id the largest values count (older runs have no id: equal neighbours collapse)
    const turns: { in: number; cacheWrite: number; known: boolean }[] = [];
    const byId = new Map<string, number>();
    for (const e of evs.filter((x) => x.kind === "agent.turn")) {
      const d = e.data, legacy = /in (\d+) out/.exec(e.msg);
      const t = { in: d ? num(d.in) : Number(legacy?.[1] ?? 0), cacheWrite: num(d?.cacheWrite), known: !!d };
      const id = typeof d?.id === "string" ? d.id : undefined;
      const at = id !== undefined ? byId.get(id) : turns.length && turns[turns.length - 1]!.in === t.in ? turns.length - 1 : undefined;
      if (at !== undefined) turns[at] = { in: Math.max(turns[at]!.in, t.in), cacheWrite: Math.max(turns[at]!.cacheWrite, t.cacheWrite), known: t.known };
      else { if (id !== undefined) byId.set(id, turns.length); turns.push(t); }
    }
    // a line written before the API reported the context has no size yet
    const sized = turns.filter((t) => t.in >= 100);
    if (!sized.length) continue;
    const recorded = evs.filter((x) => x.kind === "agent.compact").length;
    const drops = sized.filter((t, i) => i > 0 && sized[i - 1]!.in > 60_000 && t.in < sized[i - 1]!.in / 2).length;
    const merged: Record<string, { calls: number; chars: number }> = {};
    for (const e of evs.filter((x) => x.kind === "agent.summary")) {
      for (const [tool, v] of Object.entries((e.data?.tools ?? {}) as Record<string, { calls?: number; chars?: number }>)) {
        merged[tool] = { calls: (merged[tool]?.calls ?? 0) + num(v.calls), chars: (merged[tool]?.chars ?? 0) + num(v.chars) };
      }
    }
    out.push({
      step, attempt: Number(attempt), turns: sized.length, peak: Math.max(...sized.map((t) => t.in)),
      avg: Math.round(sized.reduce((n, t) => n + t.in, 0) / sized.length), compactions: recorded || drops,
      ...(sized.some((t) => t.known) ? { rewrites: sized.filter((t, i) => i > 0 && t.in > 20_000 && t.cacheWrite > t.in / 2).length } : {}),
      ...(Object.keys(merged).length ? { tools: merged } : {}),
    });
  }
  return out;
}

export function costReport(events: LedgerEvent[], trace: TraceEvent[], runId = events[0]?.runId ?? ""): CostReport {
  const outcomeOf = new Map<string, { outcome: AttemptCost["outcome"]; why?: string }>();
  const attempts = new Map<string, AttemptCost>();
  const stages = new Map<string, { stage: string; costUsd: number } & KindUsd>();
  const byKind: KindUsd = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    if (!ev.key) continue;
    if (ev.type === "step.completed") outcomeOf.set(ev.key, { outcome: "passed" });
    else if (ev.type === "step.failed") outcomeOf.set(ev.key, { outcome: "failed", why: String(d.signature ?? d.reason ?? d.category ?? "").slice(0, 80) });
    else if (ev.type === "step.interrupted") outcomeOf.set(ev.key, d.reason === "waiting" ? { outcome: "asked" } : { outcome: "interrupted", why: String(d.reason ?? "").slice(0, 80) });
    else if (ev.type === "usage") {
      const model = String(d["gen_ai.request.model"] ?? ""), p = priceOf(model), billed = num(d["gen_ai.usage.cost_usd"]);
      const raw: KindUsd = {
        input: num(d["gen_ai.usage.input_tokens"]) * p.input, output: num(d["gen_ai.usage.output_tokens"]) * p.output,
        cacheRead: num(d["gen_ai.usage.cache_read_tokens"]) * p.cacheRead, cacheWrite: num(d["gen_ai.usage.cache_write_tokens"]) * p.cacheWrite,
      };
      // the split follows the list prices; it is scaled to what the ledger billed, which may use a project's own prices
      const sum = raw.input + raw.output + raw.cacheRead + raw.cacheWrite, f = sum > 0 ? billed / sum : 0;
      const stage = stageOf(ev.key);
      const s = stages.get(stage) ?? { stage, costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) { s[k] += raw[k] * f; byKind[k] += raw[k] * f; }
      s.costUsd += billed;
      stages.set(stage, s);
      const a = attempts.get(ev.key) ?? { key: ev.key, model, costUsd: 0, outcome: "open" as const };
      a.costUsd += billed;
      if (model) a.model = model;
      attempts.set(ev.key, a);
    }
  }
  for (const a of attempts.values()) { const o = outcomeOf.get(a.key); if (o) { a.outcome = o.outcome; if (o.why) a.why = o.why; } }
  const list = [...attempts.values()];

  const packs = new Map<string, CostReport["packs"][number]>();
  const rejected = new Map<string, { step: string; count: number; costUsd: number }>();
  const bigResults: CostReport["bigResults"] = [];
  let cutOff = 0, storedAnswers = 0;
  for (const e of trace) {
    const d = e.data ?? {}, step = e.step ?? "run";
    if (e.kind === "pack") {
      const who = e.msg.split(": briefing")[0]!, k = `${step}\0${who}`, tokens = num(d.packTokens);
      // a step's retries send much the same briefing: the largest one is shown
      if (tokens > (packs.get(k)?.packTokens ?? -1)) {
        packs.set(k, { step, who, packTokens: tokens, budgetTokens: num(d.budgetTokens),
          largest: [...((d.sections ?? []) as { id: string; tokens: number }[])].sort((x, y) => y.tokens - x.tokens).slice(0, 4).map((x) => ({ id: x.id, tokens: x.tokens })) });
      }
    } else if (e.kind === "model.turn") {
      if (d.rejected === true || e.msg.includes("answer REJECTED")) {
        const r = rejected.get(step) ?? { step, count: 0, costUsd: 0 };
        rejected.set(step, { step, count: r.count + 1, costUsd: r.costUsd + num(d.costUsd) });
      }
      if (d.maxTokens === true || e.msg.includes("(hit max tokens)")) cutOff++;
    } else if (e.kind === "cache.hit") storedAnswers++;
    else if (e.kind === "agent.result") bigResults.push({ step, attempt: e.attempt ?? 1, tool: String(d.tool ?? ""), target: String(d.target ?? ""), chars: num(d.chars) });
  }
  return {
    runId, costUsd: list.reduce((n, a) => n + a.costUsd, 0), byKind,
    stages: [...stages.values()].sort((a, b) => b.costUsd - a.costUsd),
    attempts: list,
    notPassedUsd: list.filter((a) => a.outcome !== "passed" && a.outcome !== "asked").reduce((n, a) => n + a.costUsd, 0),
    sessions: sessionStats(trace),
    bigResults: bigResults.sort((a, b) => b.chars - a.chars).slice(0, 15),
    packs: [...packs.values()].sort((a, b) => b.packTokens - a.packTokens),
    rejected: [...rejected.values()].sort((a, b) => b.costUsd - a.costUsd),
    cutOff, storedAnswers,
  };
}

export function costReportFor(ledger: Ledger): CostReport {
  return costReport(ledger.events(), readTrace(ledger.dir));
}

const money = (n: number) => `$${n.toFixed(2)}`;
const kTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-");

export function formatCost(r: CostReport): string {
  const k = r.byKind;
  const lines = [
    `Run ${r.runId}: ${money(r.costUsd)} spent on model calls`,
    "",
    "Where the money went, by kind of token",
    `  answers written (output)        ${money(k.output).padStart(7)}  ${pct(k.output, r.costUsd)}`,
    `  context read again (cache read) ${money(k.cacheRead).padStart(7)}  ${pct(k.cacheRead, r.costUsd)}`,
    `  context stored (cache write)    ${money(k.cacheWrite).padStart(7)}  ${pct(k.cacheWrite, r.costUsd)}`,
    `  context sent uncached (input)   ${money(k.input).padStart(7)}  ${pct(k.input, r.costUsd)}`,
    "",
    `${"stage".padEnd(16)} ${"cost".padStart(7)} ${"output".padStart(7)} ${"read".padStart(7)} ${"stored".padStart(7)} ${"input".padStart(7)}`,
    ...r.stages.map((s) => `${s.stage.padEnd(16)} ${money(s.costUsd).padStart(7)} ${money(s.output).padStart(7)} ${money(s.cacheRead).padStart(7)} ${money(s.cacheWrite).padStart(7)} ${money(s.input).padStart(7)}`),
    "",
    `Attempts that did not pass: ${money(r.notPassedUsd)} of ${money(r.costUsd)} (${pct(r.notPassedUsd, r.costUsd)})`,
    ...r.attempts.filter((a) => a.outcome !== "passed" && a.outcome !== "asked" && a.costUsd >= 0.005).sort((a, b) => b.costUsd - a.costUsd)
      .map((a) => `  ${a.key.padEnd(24)} ${money(a.costUsd).padStart(7)}  ${a.model.padEnd(18)} ${a.outcome}${a.why ? `: ${a.why}` : ""}`),
  ];
  if (r.sessions.length) {
    lines.push("", "Coding agent sessions (context = what the agent reads again on every turn)",
      `  ${"session".padEnd(24)} ${"turns".padStart(5)} ${"peak".padStart(6)} ${"average".padStart(8)} ${"summarised".padStart(11)} ${"stored again".padStart(13)}`,
      ...r.sessions.map((s) => `  ${`${s.step}#${s.attempt}`.padEnd(24)} ${String(s.turns).padStart(5)} ${kTok(s.peak).padStart(6)} ${kTok(s.avg).padStart(8)} ${`${s.compactions}x`.padStart(11)} ${(s.rewrites === undefined ? "-" : `${s.rewrites}x`).padStart(13)}`));
    const tools = new Map<string, { calls: number; chars: number }>();
    for (const s of r.sessions) for (const [t, v] of Object.entries(s.tools ?? {})) tools.set(t, { calls: (tools.get(t)?.calls ?? 0) + v.calls, chars: (tools.get(t)?.chars ?? 0) + v.chars });
    if (tools.size) {
      lines.push("", "What the tool calls put into the context",
        ...[...tools].sort((a, b) => b[1].chars - a[1].chars).map(([t, v]) => `  ${t.padEnd(10)} ${String(v.calls).padStart(4)} calls  about ${kTok(v.chars / 4).padStart(5)} tokens  (${kTok(v.chars / 4 / Math.max(1, v.calls))} per call)`));
    } else lines.push("", "Tool result sizes were not recorded in this run; they are from the next agent session on.");
  }
  if (r.bigResults.length) lines.push("", "Largest tool results", ...r.bigResults.map((b) => `  about ${kTok(b.chars / 4).padStart(4)} tokens  ${`${b.step}#${b.attempt}`.padEnd(22)} ${b.tool} ${b.target}`));
  if (r.packs.length) {
    lines.push("", "Briefings (largest per step)",
      ...r.packs.map((p) => `  ${p.who.padEnd(24)} ${kTok(p.packTokens).padStart(5)} of ${kTok(p.budgetTokens).padStart(5)}  ${p.largest.filter((x) => x.tokens > 0).map((x) => `${x.id} ${kTok(x.tokens)}`).join(", ")}`));
  }
  const rejects = r.rejected.reduce((n, x) => n + x.count, 0);
  lines.push("", `Answers sent back for their shape: ${rejects}${rejects ? ` (${money(r.rejected.reduce((n, x) => n + x.costUsd, 0))}: ${r.rejected.map((x) => `${x.step} ${x.count}`).join(", ")})` : ""}`,
    `Answers cut off at the output limit: ${r.cutOff}`,
    `Stored answers reused (no model call): ${r.storedAnswers}`);
  return lines.join("\n");
}
