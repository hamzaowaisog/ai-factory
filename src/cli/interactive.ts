// Ask the open question card in the terminal, so an estimate run does not stop and wait for a second command.
// The card is the same one `factory answer` records against; only the way the answers are collected changes.
import { createInterface } from "node:readline/promises";
import type { Ledger } from "../ledger/ledger.js";
import { decide } from "../ledger/human.js";
import { replay } from "../ledger/state.js";
import { resolveAnswer, type Assumption, type ScoredQuestion } from "../stages/clarify.js";

export interface PromptIO { ask(prompt: string): Promise<string>; out(line: string): void }

export function terminalIO(out: (m: string) => void): PromptIO & { close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { ask: (p) => rl.question(p), out, close: () => rl.close() };
}

/** Can we ask a person here? Not from a script or a pipe, and not when switched off. */
export const canPrompt = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.FACTORY_NO_PROMPT !== "1";

export function formatQuestion(q: ScoredQuestion, n: number, of: number): string[] {
  return [
    `\nQuestion ${n} of ${of} (${q.id}): ${q.text}`,
    ...q.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}${o === q.recommended ? `   <- recommended: ${q.reason}` : ""}`),
    `  why it matters: ${q.impactReason}`,
  ];
}

/**
 * If the run is waiting on a question card, ask each question and record the answers. Enter takes the
 * recommended option; a letter picks an option; anything else is your own words. Returns false when
 * there was no question card to answer.
 */
export async function answerOpenQuestions(ledger: Ledger, io: PromptIO): Promise<boolean> {
  const card = replay(ledger.events()).openCard;
  if (card?.kind !== "question") return false;
  const body = ledger.getJson<{ asked: ScoredQuestion[]; assumptions: Assumption[] }>(card.artifactSha);
  if (!body?.asked?.length) return false;
  io.out(`\nBefore the estimate can go on, ${body.asked.length} question${body.asked.length === 1 ? "" : "s"} need an answer. Enter keeps the recommended option.`);
  const answers: Record<string, string> = {};
  for (const [i, q] of body.asked.entries()) {
    for (const l of formatQuestion(q, i + 1, body.asked.length)) io.out(l);
    const raw = (await io.ask("  your answer (letter, words, or Enter): ")).trim();
    answers[q.id] = raw ? raw : q.recommended;
    io.out(`  -> ${resolveAnswer(q, answers[q.id]!)}`);
  }
  if (body.assumptions.length) io.out(`\nAssumed unless you say otherwise on the approval card: ${body.assumptions.map((a) => a.id).join(", ")}`);
  await decide(ledger, { decision: "answer", hashPrefix: card.artifactSha.slice(0, 8), data: { answers } });
  return true;
}
