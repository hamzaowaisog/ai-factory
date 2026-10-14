// One `attempt.summary` event per attempt of a step, written when the attempt ends, however it ends: what ran, what each
// check said (or why it did not run), what the retry rules decided and on what, and every file the attempt left in the
// ledger, by name. Everything in it is already in the ledger or the trace; this puts one attempt's story in one place, so a
// run that got stuck can be read without joining four files by hand (`factory explain <run>` prints it).
import type { LedgerEvent } from "../contracts/index.js";
import type { Trace } from "../util/trace.js";

/** What part of an attempt a trace line belongs to. The time up to the next line counts to it. */
function phaseOf(kind: string): string {
  if (kind.startsWith("agent.")) return "agent";
  if (kind.startsWith("model.")) return "model";
  if (kind.startsWith("lab.")) return kind === "lab.tests" || kind === "lab.rerun" || kind === "lab.probe" ? "tests" : "build";
  if (kind === "gate") return "checks";
  if (kind === "container") return "containers";
  return "other";
}

export interface AttemptWatch {
  trace: Trace;
  /** milliseconds by part of the attempt (agent, model, build, tests, checks, containers, other), up to now */
  timeMs(): Record<string, number>;
  /** files saved through the trace (a failing build's log, a model turn), by what saved them */
  files(): { what: string; sha: string }[];
  /** what the step said about this attempt (kept or wiped the last attempt's work, and why) */
  notes: Record<string, string | number | boolean>;
}

/** The step's trace, watched: where the attempt's time went, and which files it saved. */
export function watchAttempt(inner: Trace, now: () => number = Date.now): AttemptWatch {
  const spent: Record<string, number> = {};
  const saved: { what: string; sha: string }[] = [];
  let phase = "other", at = now();
  const close = () => { const t = now(); spent[phase] = (spent[phase] ?? 0) + (t - at); at = t; };
  return {
    notes: {},
    trace: {
      event(kind, msg, data) {
        if (kind !== "heartbeat") { close(); phase = phaseOf(kind); }
        for (const [k, v] of Object.entries(data ?? {})) if (/sha$/i.test(k) && typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) saved.push({ what: `${kind} ${k.replace(/sha$/i, "") || "file"}`.trim(), sha: v });
        inner.event(kind, msg, data);
      },
      blob: (c) => inner.blob(c),
      setStep: (s, a) => inner.setStep(s, a),
    },
    timeMs() { close(); return Object.fromEntries(Object.entries(spent).filter(([, ms]) => ms > 0)); },
    files: () => saved,
  };
}

export interface AttemptEnd {
  step: string; attempt: number; rung: number;
  /** how the step itself ended the attempt (done, fail, park, wait, back, ask, close) */
  outcome: string;
  startedAt: number; endedAt: number;
  timeMs: Record<string, number>;
  files: { what: string; sha: string }[];
  notes: Record<string, string | number | boolean>;
}

type Data = Record<string, unknown>;

/**
 * The summary of one attempt, from the events appended since it started. `events` may hold other steps' events (steps that
 * ran beside this one); only this attempt's are read.
 */
export function attemptSummary(events: LedgerEvent[], end: AttemptEnd): Data {
  const key = `${end.step}/${end.attempt}`;
  const mine = events.filter((e) => e.key === key);
  const d = (e?: LedgerEvent) => (e?.data ?? {}) as Data;
  const ofStep = (e: LedgerEvent) => d(e).step === end.step && (d(e).attempt === undefined || d(e).attempt === end.attempt);
  const started = mine.find((e) => e.type === "step.started");
  const completed = mine.find((e) => e.type === "step.completed");
  const failed = mine.find((e) => e.type === "step.failed");
  const interrupted = mine.find((e) => e.type === "step.interrupted");
  const parked = events.find((e) => e.type === "run.parked" && d(e).step === end.step);
  const closed = events.find((e) => e.type === "run.closed");
  const asked = events.find((e) => e.type === "human.requested" && d(e).step === end.step);

  const usage = mine.filter((e) => e.type === "usage");
  const models = new Map<string, { calls: number; in: number; out: number; cacheRead: number; costUsd: number }>();
  for (const u of usage) {
    const m = String(d(u)["gen_ai.request.model"] ?? "?");
    const a = models.get(m) ?? { calls: 0, in: 0, out: 0, cacheRead: 0, costUsd: 0 };
    models.set(m, {
      calls: a.calls + 1, in: a.in + Number(d(u)["gen_ai.usage.input_tokens"] ?? 0), out: a.out + Number(d(u)["gen_ai.usage.output_tokens"] ?? 0),
      cacheRead: a.cacheRead + Number(d(u)["gen_ai.usage.cache_read_tokens"] ?? 0), costUsd: a.costUsd + Number(d(u)["gen_ai.usage.cost_usd"] ?? 0),
    });
  }

  const checks = events.filter((e) => e.type === "gate.result" && ofStep(e)).map((e) => ({
    gateId: String(d(e).gateId), passed: !!d(e).passed, safety: !!d(e).safety,
    ...(d(e).passed ? {} : { details: String(d(e).details ?? "").slice(0, 600), failureCount: Number(d(e).failureCount ?? 0) }),
    ...(d(e).facts ? { facts: d(e).facts } : {}), ...(d(e).ms !== undefined ? { ms: d(e).ms } : {}), seq: e.seq,
  }));
  const skipped = events.filter((e) => e.type === "gate.skipped" && ofStep(e)).map((e) => ({ gateId: String(d(e).gateId), reason: String(d(e).reason ?? "") }));

  const f = d(failed);
  const result = completed ? "passed"
    : failed ? (f.parked || parked ? "parked" : closed ? "closed" : f.action === "retry" ? "retry" : f.action === "backoff" ? "wait-and-retry" : String(f.action ?? "failed"))
    : interrupted ? (d(interrupted).reason === "back" ? "went-back" : "waiting-for-a-person") : end.outcome;

  // every file this attempt left in the ledger's artifacts folder, by name
  const files: { what: string; sha: string }[] = [];
  const named = (d(completed).named ?? {}) as Record<string, string>;
  for (const [name, sha] of Object.entries(named)) files.push({ what: `output ${name}`, sha });
  if (failed?.outputs?.[0]) files.push({ what: "failures (every failure, uncut)", sha: failed.outputs[0] });
  for (const e of events.filter((x) => x.type === "gate.result" && ofStep(x))) {
    if (e.outputs?.[0]) files.push({ what: `check ${d(e).gateId} result`, sha: e.outputs[0] });
    for (const [name, sha] of Object.entries((d(e).inputs ?? {}) as Record<string, string>)) files.push({ what: `check ${d(e).gateId} input ${name}`, sha });
  }
  files.push(...end.files);
  const seen = new Set<string>();

  return {
    step: end.step, attempt: end.attempt, rung: end.rung, ...(d(started).route ? { route: d(started).route } : {}),
    result, outcome: end.outcome,
    ms: end.endedAt - end.startedAt, timeMs: end.timeMs,
    costUsd: Number([...models.values()].reduce((n, m) => n + m.costUsd, 0).toFixed(6)), modelCalls: usage.length, models: Object.fromEntries(models),
    checks, skipped,
    ...(Object.keys(end.notes).length ? { notes: end.notes } : {}),
    ...(failed ? {
      failure: { category: f.category, signature: f.signature, ...(f.diffSha ? { diffSha: f.diffSha } : {}), ...(Array.isArray(f.lockedFailedIds) && f.lockedFailedIds.length ? { lockedFailed: f.lockedFailedIds } : {}) },
      decision: { action: f.action ?? (f.parked ? "park" : undefined), ...(f.reason ? { reason: f.reason } : {}), ...(f.nextRung !== undefined ? { nextRung: f.nextRung } : {}), ...(f.waitMs ? { waitMs: f.waitMs } : {}), ...(f.ladder ? { ladder: f.ladder } : {}), ...(f.testCheck ? { testCheck: f.testCheck } : {}) },
    } : {}),
    ...(parked ? { parked: d(parked).reason } : {}), ...(closed && !completed ? { closed: d(closed).reason } : {}),
    ...(asked ? { card: { kind: d(asked).kind, cardId: d(asked).cardId } } : {}),
    ...(completed?.treeSha ? { treeSha: completed.treeSha } : {}),
    files: files.filter((x) => !seen.has(`${x.what}\n${x.sha}`) && !!seen.add(`${x.what}\n${x.sha}`)),
  };
}
