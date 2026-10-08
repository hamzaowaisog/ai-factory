import { describe, expect, it } from "vitest";
import { costReport, formatCost } from "./cost-report.js";
import { agentTracer } from "./stages/build.js";
import type { LedgerEvent } from "./contracts/index.js";
import type { TraceEvent } from "./util/trace.js";

let seq = 0;
const ev = (type: string, key: string, data: Record<string, unknown> = {}) => ({ seq: seq++, ts: "2026-01-01T00:00:00.000Z", runId: "r1", epoch: 1, type, key, data }) as unknown as LedgerEvent;
const usage = (key: string, model: string, u: { in?: number; out?: number; read?: number; write?: number }, usd: number) => ev("usage", key, {
  "gen_ai.request.model": model, "gen_ai.usage.input_tokens": u.in ?? 0, "gen_ai.usage.output_tokens": u.out ?? 0,
  "gen_ai.usage.cache_read_tokens": u.read ?? 0, "gen_ai.usage.cache_write_tokens": u.write ?? 0, "gen_ai.usage.cost_usd": usd,
});
const tr = (kind: string, step: string, attempt: number, msg: string, data?: Record<string, unknown>): TraceEvent => ({ ts: "2026-01-01T00:00:00.000Z", elapsedMs: 0, step, attempt, kind, msg, ...(data ? { data } : {}) });

describe("costReport", () => {
  it("splits the billed cost by kind of token and counts attempts that did not pass", () => {
    const r = costReport([
      // sonnet: 1M output = $10, 10M cache read = $2
      usage("implement/TASK-1/1", "claude-sonnet-5", { out: 1_000_000, read: 10_000_000 }, 12), ev("step.failed", "implement/TASK-1/1", { signature: "locked-failed:x" }),
      usage("implement/TASK-1/2", "claude-sonnet-5", { out: 500_000 }, 5), ev("step.completed", "implement/TASK-1/2"),
      usage("clarify/1", "claude-haiku-4-5", { in: 1_000_000 }, 1), ev("step.interrupted", "clarify/1", { reason: "waiting" }),
    ], []);
    expect(r.costUsd).toBe(18);
    expect(r.byKind).toMatchObject({ output: 15, cacheRead: 2, input: 1, cacheWrite: 0 });
    expect(r.notPassedUsd).toBe(12); // a step that stopped to ask a person is not a failed attempt
    expect(r.stages[0]).toMatchObject({ stage: "implement", costUsd: 17 });
    expect(r.attempts.find((a) => a.key === "implement/TASK-1/1")).toMatchObject({ outcome: "failed", why: "locked-failed:x" });
    const text = formatCost(r);
    expect(text).toContain("Attempts that did not pass: $12.00 of $18.00 (67%)");
    expect(text).toContain("context read again (cache read)   $2.00  11%");
  });

  it("a model with its own price keeps the billed total", () => {
    const r = costReport([usage("review/1", "gpt-x", { in: 100, out: 100 }, 0.5)], []);
    expect(r.byKind.input + r.byKind.output).toBeCloseTo(0.5);
  });

  it("reads a session's context, its tool results and its briefing from the trace", () => {
    const lines: TraceEvent[] = [];
    const t = agentTracer({ trace: { event: (kind, msg, data) => { lines.push(tr(kind, "implement/TASK-2", 1, msg, data)); }, blob: () => undefined, setStep() {} } }, "implementer");
    t({ ts: 0, kind: "start", model: "claude-sonnet-5" });
    t({ ts: 0, kind: "turn", id: "m1", in: 2, out: 1 });
    t({ ts: 0, kind: "turn", id: "m1", in: 30_000, out: 50, cacheWrite: 30_000 });
    t({ ts: 0, kind: "tool", tool: "Bash", target: "cat big.json" });
    t({ ts: 0, kind: "result", tool: "Bash", target: "cat big.json", chars: 40_000 });
    t({ ts: 0, kind: "result", tool: "Read", target: "a.cs", chars: 400 });
    t({ ts: 0, kind: "turn", id: "m2", in: 90_000, out: 50, cacheRead: 30_000, cacheWrite: 60_000 });
    t({ ts: 0, kind: "compact", pre: 90_000 });
    t({ ts: 0, kind: "turn", id: "m3", in: 24_000, out: 50, cacheRead: 20_000, cacheWrite: 4000 });
    t({ ts: 0, kind: "end", status: "ok", turns: 3, costUsd: 0.2 });
    expect(lines.filter((l) => l.kind === "agent.result")).toHaveLength(1); // only the large result gets a line of its own
    lines.push(tr("pack", "implement/TASK-2", 1, "implementer TASK-2: briefing 12.0K tokens of 60.0K", { packTokens: 12_000, budgetTokens: 60_000, sections: [{ id: "spec", tokens: 9000, trimmed: false }, { id: "task", tokens: 3000, trimmed: false }] }));
    lines.push(tr("model.turn", "plan", 1, "plan turn 1 x  → answer REJECTED: too long", { costUsd: 0.3, rejected: true }));

    const r = costReport([], lines);
    expect(r.sessions).toEqual([{ step: "implement/TASK-2", attempt: 1, turns: 3, peak: 90_000, avg: 48_000, compactions: 1, rewrites: 1, tools: { Bash: { calls: 1, chars: 40_000 }, Read: { calls: 1, chars: 400 } } }]);
    expect(r.bigResults[0]).toMatchObject({ tool: "Bash", target: "cat big.json", chars: 40_000 });
    expect(r.packs[0]).toMatchObject({ who: "implementer TASK-2", packTokens: 12_000, largest: [{ id: "spec", tokens: 9000 }, { id: "task", tokens: 3000 }] });
    expect(r.rejected).toEqual([{ step: "plan", count: 1, costUsd: 0.3 }]);
    const text = formatCost(r);
    expect(text).toContain("Bash          1 calls  about   10K tokens");
    expect(text).toContain("implementer TASK-2");
  });

  it("an older run's trace (no numbers on the turn lines) still gives the context sizes", () => {
    const r = costReport([], [
      tr("agent.turn", "author-tests", 1, "test writer: turn  in 2 out 8"),
      tr("agent.turn", "author-tests", 1, "test writer: turn  in 80000 out 16"),
      tr("agent.turn", "author-tests", 1, "test writer: turn  in 80000 out 16"),
      tr("agent.turn", "author-tests", 1, "test writer: turn  in 100000 out 16"),
      tr("agent.turn", "author-tests", 1, "test writer: turn  in 20000 out 16"),
    ]);
    expect(r.sessions[0]).toMatchObject({ turns: 3, peak: 100_000, compactions: 1 });
    expect(r.sessions[0]!.rewrites).toBeUndefined();
    expect(formatCost(r)).toContain("Tool result sizes were not recorded in this run");
  });
});
