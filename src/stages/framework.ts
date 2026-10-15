// Stage framework: a mode is an ordered list of steps; `next(state)` is a pure function of
// the replayed ledger (run-manager §2.3). Each step reports one outcome; the executor writes
// the events and applies the failure ladder.
import type { Failure, Usage } from "../contracts/index.js";
import type { ProjectConfig } from "../config/project.js";
import type { Policy } from "../gates/policy.js";
import type { Ledger, Writer } from "../ledger/ledger.js";
import { splitKey, type RunInfo, type RunState, type StepKey } from "../ledger/state.js";
import type { FailureCategory } from "../gates/ladder.js";
import type { Trace } from "../util/trace.js";
import type { GateAnswer } from "./gate-questions.js";

/**
 * How many of a step's failures the ledger keeps for its next attempt. Twenty were kept once, so a retry was never told of
 * the rest and the whole cycle ran again for them (run 1679: 52 weak tests found, 20 passed on).
 */
export const FAILURES_KEPT = 200;

/**
 * A step's failures as a briefing lists them: every one, the failures of one check together, up to a size. Past it the rest
 * are counted by check, so the reader knows how many there are and of what kind.
 */
export function failureLines(failures: Failure[], maxChars = 16_000, frames = false): string {
  const checks = [...new Set(failures.map((f) => f.check))];
  const ordered = checks.flatMap((c) => failures.filter((f) => f.check === c));
  const lines: string[] = [];
  let used = 0, shown = 0;
  for (const f of ordered) {
    const line = `- [${f.check}] ${f.message}${frames && f.frames.length ? `\n    ${f.frames.join("\n    ")}` : ""}`;
    if (shown && used + line.length > maxChars) break;
    lines.push(line); used += line.length + 1; shown += 1;
  }
  const left = ordered.slice(shown);
  if (left.length) {
    const by = [...new Set(left.map((f) => f.check))].map((c) => `${left.filter((f) => f.check === c).length} × ${c}`);
    lines.push(`… and ${left.length} more not shown (${failures.length} in all): ${by.join(", ")}. Fix the kinds above everywhere they occur, not only in the lines shown.`);
  }
  return lines.join("\n");
}

export type StepOutcome =
  /** outputs: named artifact shas (first is the main one). */
  | { kind: "done"; outputs: Record<string, string>; treeSha?: string; data?: Record<string, unknown> }
  /** A human card was written; the executor exits. */
  /** extra: small metadata stored on human.requested (e.g. where the pending work is cached). */
  | { kind: "wait"; card: { cardId: string; kind: string; artifactSha: string; markdown: string; deadline?: string; defaultDecision?: Record<string, unknown>; extra?: Record<string, unknown> } }
  /** data: small metadata stored on step.failed (e.g. the commit judged, how the attempt started).
   *  gate: a check on the step's output failed (not the model's answer, the code or the environment); in an estimate or a design run,
   *  after the retry, the failures become questions instead of more attempts (src/stages/gate-questions.ts). */
  | { kind: "fail"; category: FailureCategory; failures: Failure[]; signature?: string; diffSha?: string; lockedFailedIds?: string[]; data?: Record<string, unknown>; gate?: boolean; holdRung?: boolean;
      /** the locked tests that failed cannot pass at this task (a later task completes what they run): failing twice is not "test or code wrong" */
      deferrable?: boolean;
      /** and each of them fails exactly as it did before the task started: they move to the later task on this failure, not the second */
      deferNow?: boolean }
  | { kind: "park"; reason: string; /** recorded on the step's failure event (an out-of-credit stop keeps its commit there) */ data?: Record<string, unknown> }
  /** A check failed that another attempt cannot fix (gate E1 on the spec, a breakdown the factory could not settle): questions now,
   *  in an estimate or a design run; elsewhere, and once the rounds of questions are used up, the run parks with the reason. */
  | { kind: "ask"; reason: string; failures: Failure[] }
  /** An earlier step has to run again first (this step changed its inputs, e.g. gate E1 sent the spec back to be settled); the run goes on with it. Not a failed attempt. */
  | { kind: "back"; reason: string }
  /** Run ends without delivery (e.g. not-reproduced). */
  | { kind: "close"; reason: "not-reproduced" | "stopped" };

export interface StepContext {
  runId: string;
  ledger: Ledger;
  writer: Writer;
  state: RunState;
  project: ProjectConfig;
  policy: Policy;
  attempt: number;
  /** ladder rung for this attempt: 0 retry, 1 raise effort, 2 stronger model, 3 other vendor */
  rung: number;
  /** failures from the previous attempt of this step (failures.json) */
  priorFailures: Failure[];
  log: (msg: string) => void;
  /** a fact about this attempt for its summary in the ledger (the last attempt's work was kept or wiped, and why) */
  note?: (name: string, value: string | number | boolean) => void;
  /** the run trace (model turns, tool calls, container phases); see src/util/trace.ts */
  trace: Trace;
  /** record model usage as it happens */
  usage: (u: Usage & { model: string; /** the route the call was made on, when it is not the step's own (the critic inside the spec step) */ route?: string }) => Promise<void>;
  /** steps running side by side, this one included; each gets its share of what's left of the run's cost limit */
  share?: number;
  /** answers to the questions this step's failing checks raised (src/stages/gate-questions.ts); every model call of the step reads them */
  gateAnswers?: GateAnswer[];
  /** the rounds of questions are used up: a check that still fails is carried as an open risk instead of failing the step */
  carryOn?: boolean;
}

export interface StepDef {
  key: StepKey;
  /** Stage name for templates/routing, e.g. "implement". */
  stage: string;
  /** Artifact shas + anything else this step depends on → inputsHash. Undefined = not ready. */
  inputs(state: RunState, ledger: Ledger): Record<string, unknown> | undefined;
  /** Model used this attempt (part of inputsHash). */
  model?(ctx: Pick<StepContext, "project" | "rung">): string | undefined;
  templateVersion: string;
  coding?: boolean;
  /** the same locked test failing twice does not park the run: the step's next attempt reads the test against its criterion itself (src/stages/test-defect.ts) */
  judgesTests?: boolean;
  /** the least left under the run's cost limit that this step is worth starting with (a coding agent); less, and the limit card comes first */
  needsUsd?: number;
  /** may run side by side with the other parallel steps next to it in the run (one module's spec chain beside another's) */
  parallel?: boolean;
  run(ctx: StepContext): Promise<StepOutcome>;
}

/** Latest completed output of a step (main artifact sha) or a named output. */
export function outputOf(state: RunState, step: StepKey, name?: string): string | undefined {
  const r = state.steps.get(step);
  if (r?.status !== "completed") return undefined;
  if (name) return (r.data?.named as Record<string, string> | undefined)?.[name];
  return r.outputs[0];
}

export function readOutput<T>(state: RunState, ledger: Ledger, step: StepKey, name?: string): T | undefined {
  const sha = outputOf(state, step, name);
  return sha ? ledger.getJson<T>(sha) : undefined;
}

export function requireOutput<T>(state: RunState, ledger: Ledger, step: StepKey, name?: string): T {
  const v = readOutput<T>(state, ledger, step, name);
  if (v === undefined) throw new Error(`Missing output of ${step}${name ? `:${name}` : ""}`);
  return v;
}

export function header(runId: string, kind: string, stage: string, inputsHash: string, model?: string) {
  return { kind, schemaVersion: 1 as const, runId, producedBy: { stage, model }, inputsHash, createdAt: new Date().toISOString() };
}

/**
 * What this step's last attempt left for its retry (the `data` of its failure), or undefined when the step has not failed since
 * it last completed. A step that failed its own checks stores the rejected answer here, so the retry fixes it and does not start over.
 */
export function lastFailureData(ledger: Ledger, step: StepKey): Record<string, unknown> | undefined {
  const evs = ledger.events().filter((e) => e.key && splitKey(e.key).step === step);
  const last = evs.filter((e) => e.type === "step.completed" || e.type === "step.failed" || e.type === "step.interrupted").at(-1);
  return last?.type === "step.failed" ? (last.data ?? {}) as Record<string, unknown> : undefined;
}

/** Reasons a person gave when sending back a card whose id starts with one of `prefixes`, oldest first (typed by a named person: trusted). */
export function rejectionsOf(state: RunState, ...prefixes: string[]): string[] {
  return state.decisions
    .filter((d) => d.decision === "reject" && prefixes.some((p) => d.cardId.startsWith(p)))
    .map((d) => String((d as unknown as { reason?: string }).reason ?? "").trim())
    .filter(Boolean);
}

/** Reasons a human gave when rejecting an approval card, oldest first. */
export const planRejections = (state: RunState): string[] => rejectionsOf(state, "approval-");

/**
 * Autonomous off (`autonomous: false` in the project, or `factory start --guided`): a person also checks what the factory
 * understood and the spec, each on its own card, before the design and the plan (src/stages/review-cards.ts).
 */
export const guided = (info: Pick<RunInfo, "autonomous">): boolean => info.autonomous === false;

export const UNDERSTOOD_CARD = "understood-";
export const SPEC_CARD = "spec-review-";

/** What a person sent back on the spec card (a guided run), oldest first. */
export const specRejections = (state: RunState): string[] => rejectionsOf(state, SPEC_CARD);

/** What a person corrected on the "what I understood" card (a guided run): handed to the spec writers. */
export function correction(state: RunState): string | undefined {
  const d = state.decisions.filter((x) => x.cardId.startsWith(UNDERSTOOD_CARD)).at(-1) as { note?: string; reason?: string } | undefined;
  return String(d?.reason ?? d?.note ?? "").trim() || undefined;
}
