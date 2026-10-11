// Human decisions (run-manager §2.7, gate-engine §2.3, §2.7).
// `factory approve|reject|answer|waive|unlock <run> <hash-prefix>`: TTY only, hash checked
// under the ledger lock, identical repeats are no-ops.
import { existsSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { factoryHome } from "../util/paths.js";
import type { HumanDecision, LedgerEvent } from "../contracts/index.js";
import { HUMAN_WRITER, type Ledger } from "./ledger.js";
import { replay } from "./state.js";

export class DecisionError extends Error {}

export const MIN_PREFIX = 4;

export function assertTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DecisionError("Decisions can only be made from a terminal, not from a script or a plugin.");
  }
}

export interface DecideInput {
  decision: HumanDecision;
  hashPrefix: string;
  by?: string;
  data?: Record<string, unknown>;
}

export type DecideOutcome = { kind: "recorded"; event: LedgerEvent } | { kind: "repeat" };

/** The end-to-end eval harness answers its runs' cards as "eval", and only inside its own temporary factory home. */
export const EVAL_DECIDER = "eval";
const EVAL_HOME_MARKER = ".eval-home";
/** Marks a temporary factory home as the eval harness's own (bench/e2e); nothing else may write this. */
export function markEvalHome(home: string): void {
  writeFileSync(join(home, EVAL_HOME_MARKER), "This factory home belongs to the eval harness; cards here are answered by it.\n");
}

export async function decide(ledger: Ledger, input: DecideInput): Promise<DecideOutcome> {
  const prefix = input.hashPrefix.toLowerCase();
  if (prefix.length < MIN_PREFIX) throw new DecisionError(`Use at least ${MIN_PREFIX} characters of the hash.`);
  if (input.decision === "reject" && !String(input.data?.reason ?? "").trim()) {
    throw new DecisionError("A rejection needs a reason.");
  }
  const by = input.by ?? userInfo().username;
  // a real run's cards are a person's: "eval" decides only in the eval harness's own temporary home
  if (by === EVAL_DECIDER && !existsSync(join(factoryHome(), EVAL_HOME_MARKER))) {
    throw new DecisionError(`"${EVAL_DECIDER}" can't decide here: only the eval harness answers cards, in its own temporary factory home.`);
  }
  let repeat = false;
  const ev = await ledger.appendIf((events) => {
    const state = replay(events);
    const card = state.openCard;
    if (!card) {
      const last = state.decisions[state.decisions.length - 1];
      if (last && last.decision === input.decision && last.artifactSha.startsWith(prefix)) {
        repeat = true;
        return undefined;
      }
      throw new DecisionError("There is no open card on this run.");
    }
    if (!card.artifactSha.startsWith(prefix)) {
      throw new DecisionError(
        `Hash ${prefix} doesn't match the open card (${card.artifactSha.slice(0, 8)}). The card may have changed; run \`factory show-card\`.`,
      );
    }
    return {
      type: "human.decided",
      data: { cardId: card.cardId, decision: input.decision, by, artifactSha: card.artifactSha, ...(input.data ?? {}) },
    };
  }, HUMAN_WRITER);
  return repeat || !ev ? { kind: "repeat" } : { kind: "recorded", event: ev };
}

/** Files a person took out of a run's locked set (factory unlock), oldest first. */
export function unlockedFiles(events: LedgerEvent[]): { file: string; by: string; reason: string }[] {
  return events.filter((e) => e.type === "human.decided" && (e.data as { decision?: string }).decision === "unlock")
    .flatMap((e) => { const d = e.data as { files?: string[]; by?: string; reason?: string }; return (d.files ?? []).map((file) => ({ file, by: String(d.by ?? ""), reason: String(d.reason ?? "") })); });
}

/**
 * Take files out of a run's locked set, for this run only. Never a test: a locked test that is wrong is a different decision.
 * `locked` and `tests` come from the run's lock; `lockSha` is what the decision is bound to.
 */
export async function unlock(ledger: Ledger, input: { files: string[]; reason: string; locked: string[]; tests: string[]; lockSha: string; by?: string }): Promise<LedgerEvent> {
  if (!input.reason.trim()) throw new DecisionError("An unlock needs a reason.");
  if (!input.files.length) throw new DecisionError("Name the file to unlock.");
  for (const f of input.files) {
    if (!input.locked.includes(f)) throw new DecisionError(`${f} is not a locked file of this run.`);
    if (input.tests.includes(f)) throw new DecisionError(`${f} is a locked test: only a file that is not a test can be unlocked.`);
  }
  const by = input.by ?? userInfo().username;
  if (by === EVAL_DECIDER) throw new DecisionError(`"${EVAL_DECIDER}" can't unlock a file.`);
  return ledger.append({ type: "human.decided", data: { cardId: "unlock", decision: "unlock", by, artifactSha: input.lockSha, files: input.files, reason: input.reason.trim() } }, HUMAN_WRITER);
}

/**
 * Deadlines: any command that finds an expired deadline appends the default decision.
 * It never starts execution (run-manager §2.7).
 */
export async function applyExpiredDeadline(ledger: Ledger, now = new Date()): Promise<boolean> {
  const ev = await ledger.appendIf((events) => {
    const card = replay(events).openCard;
    if (!card?.deadline || !card.defaultDecision || Date.parse(card.deadline) > now.getTime()) return undefined;
    return {
      type: "human.decided",
      data: { cardId: card.cardId, decision: "answer", by: "default-timeout", artifactSha: card.artifactSha, ...card.defaultDecision },
    };
  }, HUMAN_WRITER);
  return ev !== undefined;
}
