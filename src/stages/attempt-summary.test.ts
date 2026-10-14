// The one summary an attempt leaves in the ledger, and `factory explain`, which prints a run from it.
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts/index.js";
import { explainRun } from "../cli/explain.js";
import { attemptSummary, watchAttempt } from "./attempt-summary.js";

const sha = (c: string) => c.repeat(64);
let seq = 0;
const ev = (type: string, over: Partial<LedgerEvent> = {}): LedgerEvent => ({ seq: seq++, ts: new Date(1_800_000_000_000 + seq * 1000).toISOString(), runId: "r", epoch: 0, type: type as LedgerEvent["type"], ...over });
const usage = (key: string, usd: number) => ev("usage", { key, data: { "gen_ai.request.model": "gpt-6-luna", "gen_ai.usage.input_tokens": 1000, "gen_ai.usage.output_tokens": 200, "gen_ai.usage.cache_read_tokens": 0, "gen_ai.usage.cost_usd": usd } });
const ladder = { rule: "same-failure", attempts: 2, maxAttempts: 6, rung: 0, rungKind: "retry", attemptsAtRung: 2, attemptsPerRung: 2, sameSignature: true, sameDiff: false, rungsAvailable: ["retry", "upgrade-model"], rungsLeft: 1, nextRung: 1, nextRungKind: "upgrade-model" };

/** A failed second attempt of a task, with another step's events in between (steps can run side by side). */
const failedAttempt = (): LedgerEvent[] => [
  ev("step.started", { key: "implement/TASK-1/2", data: { rung: 0, route: { model: "gpt-6-luna", effort: "medium" } } }),
  usage("implement/TASK-1/2", 0.04), usage("implement/TASK-1/2", 0.011),
  ev("usage", { key: "implement/TASK-2/1", data: { "gen_ai.request.model": "other", "gen_ai.usage.cost_usd": 9 } }),
  ev("gate.result", { key: "task.diff-in-scope", outputs: [sha("a")], data: { gateId: "task.diff-in-scope", passed: true, safety: false, step: "implement/TASK-1", attempt: 2, inputs: { diff: sha("b") }, ms: 3 } }),
  ev("gate.result", { key: "x", outputs: [sha("9")], data: { gateId: "task.diff-in-scope", passed: false, step: "implement/TASK-2", attempt: 1, inputs: {} } }),
  ev("gate.result", { key: "contract.matches", outputs: [sha("c")], data: { gateId: "contract.matches", passed: false, safety: false, step: "implement/TASK-1", attempt: 2, inputs: { contract: sha("d"), built: sha("e") }, details: "The API does not match the locked contract: missing in the API: GET /api/x 503 body", failureCount: 1, facts: { operationsInContract: 12, operationsInApi: 4, differences: 1 }, ms: 9 } }),
  ev("gate.skipped", { key: "implement/TASK-1", data: { gateId: "design.fidelity-lint", step: "implement/TASK-1", attempt: 2, reason: "the task changed no UI files" } }),
  ev("step.failed", { key: "implement/TASK-1/2", outputs: [sha("f")], data: { category: "other", signature: "contract:x", rung: 0, retryMode: "keep", commit: "abc", action: "retry", nextRung: 1, waitMs: 0, reason: "Escalating after repeated failures", ladder } }),
];
const end = (over = {}) => ({ step: "implement/TASK-1", attempt: 2, rung: 0, outcome: "fail", startedAt: 1000, endedAt: 61_000, timeMs: { agent: 40_000, build: 12_000, tests: 8000 }, files: [{ what: "lab.build log", sha: sha("7") }], notes: { previousCode: "kept", previousCodeWhy: "the previous attempt failed only on contract" }, ...over });

describe("the summary of one attempt", () => {
  it("holds what ran, each check's result or why it did not run, the retry decision with its rule, and every file by name", () => {
    const s = attemptSummary(failedAttempt(), end());
    expect(s).toMatchObject({
      step: "implement/TASK-1", attempt: 2, rung: 0, route: { model: "gpt-6-luna" }, result: "retry", outcome: "fail", ms: 60_000,
      timeMs: { agent: 40_000, build: 12_000, tests: 8000 }, costUsd: 0.051, modelCalls: 2, models: { "gpt-6-luna": { calls: 2, in: 2000, out: 400 } },
      skipped: [{ gateId: "design.fidelity-lint", reason: "the task changed no UI files" }],
      notes: { previousCode: "kept" },
      failure: { category: "other", signature: "contract:x" },
      decision: { action: "retry", reason: "Escalating after repeated failures", nextRung: 1, ladder: { rule: "same-failure", rungsLeft: 1 } },
    });
    // only this attempt's checks: the other task's failed check is not this attempt's
    expect((s.checks as { gateId: string; passed: boolean }[]).map((c) => [c.gateId, c.passed])).toEqual([["task.diff-in-scope", true], ["contract.matches", false]]);
    expect((s.checks as Record<string, unknown>[])[1]).toMatchObject({ details: expect.stringContaining("503 body"), failureCount: 1, facts: { operationsInContract: 12 } });
    expect(s.files).toEqual([
      { what: "failures (every failure, uncut)", sha: sha("f") },
      { what: "check task.diff-in-scope result", sha: sha("a") }, { what: "check task.diff-in-scope input diff", sha: sha("b") },
      { what: "check contract.matches result", sha: sha("c") }, { what: "check contract.matches input contract", sha: sha("d") }, { what: "check contract.matches input built", sha: sha("e") },
      { what: "lab.build log", sha: sha("7") },
    ]);
  });

  it("is written for an attempt that passed, parked, waited or went back, each named as what it was", () => {
    const k = "plan/1", at = { step: "plan", attempt: 1, notes: {}, files: [] };
    const passed = attemptSummary([ev("step.started", { key: k, data: { rung: 0 } }), ev("step.completed", { key: k, treeSha: "a".repeat(40), outputs: [sha("1")], data: { named: { plan: sha("1") } } })], end({ ...at, outcome: "done" }));
    expect(passed).toMatchObject({ result: "passed", checks: [], skipped: [], treeSha: "a".repeat(40), files: [{ what: "output plan", sha: sha("1") }] });
    expect(passed.failure).toBeUndefined();
    const parked = attemptSummary([ev("step.started", { key: k }), ev("step.failed", { key: k, data: { category: "other", signature: "park", rung: 0, parked: true, action: "park", reason: "the briefing does not fit" } }), ev("run.parked", { data: { reason: "the briefing does not fit", step: "plan" } })], end({ ...at, outcome: "park" }));
    expect(parked).toMatchObject({ result: "parked", parked: "the briefing does not fit", decision: { action: "park", reason: "the briefing does not fit" } });
    const waiting = attemptSummary([ev("step.started", { key: k }), ev("step.interrupted", { key: k, data: { reason: "waiting" } }), ev("human.requested", { data: { step: "plan", kind: "approval", cardId: "c1" } })], end({ ...at, outcome: "wait" }));
    expect(waiting).toMatchObject({ result: "waiting-for-a-person", card: { kind: "approval", cardId: "c1" } });
    expect(attemptSummary([ev("step.started", { key: k }), ev("step.interrupted", { key: k, data: { reason: "back" } })], end({ ...at, outcome: "back" }))).toMatchObject({ result: "went-back" });
  });
});

describe("the watched trace of an attempt", () => {
  it("counts the time between lines to the part the earlier line belongs to, and lists the files the lines saved", () => {
    let now = 0;
    const lines: string[] = [];
    const w = watchAttempt({ event: (kind) => { lines.push(kind); }, blob: () => sha("5"), setStep() {} }, () => now);
    w.trace.event("agent.start", "agent started"); now = 30_000;
    w.trace.event("heartbeat", "still waiting"); now = 40_000;
    w.trace.event("lab.build", "lab: build FAILED", { logSha: sha("5") }); now = 52_000;
    w.trace.event("lab.tests", "lab: tests"); now = 60_000;
    w.trace.event("gate", "gate x passed"); now = 61_000;
    w.trace.event("agent.transcript", "full session kept", { transcriptSha: sha("6") });
    expect(w.timeMs()).toEqual({ agent: 40_000, build: 12_000, tests: 8000, checks: 1000 });
    expect(w.files()).toEqual([{ what: "lab.build log", sha: sha("5") }, { what: "agent.transcript transcript", sha: sha("6") }]);
    // every line still reaches the trace
    expect(lines).toHaveLength(6);
  });
});

describe("factory explain", () => {
  it("tells an attempt's story from the ledger: checks, skipped checks, why it was retried, where its files are", () => {
    const events = failedAttempt();
    events.push(ev("attempt.summary", { key: "implement/TASK-1/2", data: attemptSummary(events, end()) }));
    const text = explainRun(events, { step: "implement/TASK-1" });
    expect(text).toMatch(/^implement\/TASK-1: 1 attempt, 1 failed, ended failed, retried on rung 1/);
    expect(text).toMatch(/implement\/TASK-1 {2}attempt 2 {2}rung 0 {2}gpt-6-luna {2}1m00s {2}\$0\.051 {2}→ {2}failed, retried on rung 1/);
    expect(text).toContain("last attempt's code: kept (the previous attempt failed only on contract)");
    expect(text).toContain("time: agent 40s, build 12s, tests 8s");
    expect(text).toContain("pass  task.diff-in-scope");
    expect(text).toMatch(/FAIL {2}contract\.matches {2}1 failure {2}\[operationsInContract=12, operationsInApi=4, differences=1\]/);
    expect(text).toContain("missing in the API: GET /api/x 503 body");
    expect(text).toContain("not run  design.fidelity-lint: the task changed no UI files");
    expect(text).toContain("decision: retry: Escalating after repeated failures");
    expect(text).toMatch(/rule: the same failure \(or the same change\) twice in a row\. Attempts 2 of 6; rung 0 \(retry\) used 2 of 2; .*stronger rungs left: 1; next: rung 1 \(upgrade-model\)/);
    expect(text).toContain(`${sha("f")}  failures (every failure, uncut)`);
    expect(text).toContain(`${sha("7")}  lab.build log`);
    // the other task is not this step's story
    expect(text).not.toContain("TASK-2");
    expect(explainRun(events, { step: "deliver" })).toBe("No attempt of deliver in this run.");
  });

  it("reads a run from before summaries were recorded, and says what it cannot show", () => {
    const old = failedAttempt().map((e) => (e.type === "gate.result" ? { ...e, data: { ...e.data, attempt: undefined, facts: undefined } } : e)).filter((e) => e.type !== "gate.skipped");
    const text = explainRun(old, { step: "implement/TASK-1" });
    expect(text).toContain("FAIL  contract.matches");
    expect(text).toContain("last attempt's work: kept");
    expect(text).toContain(`${sha("c")}  check contract.matches result`);
    expect(text).toMatch(/from before per-attempt summaries were recorded/);
  });
});
