// Questions instead of a park (docs/estimates-design.md, "Gate questions"). In an estimate or a design run, a check that still fails
// after the retry with the failures fed back (a breakdown gate, gate E5, a design check, gate E1 on the spec) goes back to the client
// as clarify questions instead of more attempts or a parked run: a person answers them on a card, or a hands-off run takes each
// recommended answer as an assumption. The step runs again with the answers, which every model call of the step reads. After
// GATE_ROUNDS rounds the step carries what still fails as an open risk, stated on the estimate, and the run goes on. Gate E6 (the
// workbook's arithmetic) is never asked about or carried: it stays a hard stop. The executor asks; the steps read the answers and carry.
import { z } from "zod";
import type { Failure } from "../contracts/index.js";
import { humanReview } from "../estimate/settings.js";
import { SETTLE_MODES } from "../estimate/settled.js";
import type { Ledger } from "../ledger/ledger.js";
import { splitKey, type RunState } from "../ledger/state.js";
import { resolveAnswer, type ScoredQuestion } from "./clarify.js";
import { readOutput, type StepContext, type StepOutcome } from "./framework.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

/** Rounds of questions about a step's failing checks before what still fails is carried as an open risk. */
export const GATE_ROUNDS = 2;
/** Attempts of a step before (and after) each round: one, and the retry with the failures fed back. */
export const ROUND_ATTEMPTS = 2;
/** Questions on one round's card; one question may settle several failures. */
export const GATE_CAP = 6;

/** Runs whose failing checks are settled by questions: the ones that read a requirements document (estimate, design). */
export const asksGates = (state: Pick<RunState, "info">): boolean => SETTLE_MODES.has(state.info.mode ?? "");

export const GateQuestionsOut = z.object({
  questions: z.array(z.object({
    /** the numbers of the failures this question settles */
    failures: z.array(z.number().int().min(1)).min(1),
    text: z.string(), options: z.array(z.string()).min(2).max(4), recommended: z.string(), reason: z.string(),
    impact: z.number().int().min(1).max(3), impactReason: z.string(),
  })),
});

/** A question about a failing check, answered (or assumed), with the failures it settles. */
export interface GateAnswer { id: string; step: string; question: string; answer: string; by: string; how: "answered" | "assumed"; settles: string[] }

/** One round, filed on the step.failed event that asked it. */
export interface GateRound {
  step: string;
  round: number;
  asked: ScoredQuestion[];
  failures: Failure[];
  /** question id -> the numbers (1-based, into failures) it settles */
  failureOf: Record<string, number[]>;
  /** a hands-off run: the recommended answers, taken when the round was asked */
  answers?: Record<string, string>;
}

/** A round with its answers, when it has them (a card a person has not answered yet has none). */
export interface FiledRound extends GateRound { seq: number; cardSha?: string; answered?: Record<string, string>; by?: string }

const norm = (t: string) => t.toLowerCase().replace(/[\s"'“”‘’.]+/g, " ").trim();

/** The rounds of questions a step asked, oldest first, between two of its completions (default: since it last completed). */
function roundsBetween(ledger: Ledger, state: Pick<RunState, "decisions">, step: string, after: number, before = Infinity): FiledRound[] {
  const out: FiledRound[] = [];
  for (const e of ledger.events()) {
    if (e.seq <= after || e.seq >= before || e.type !== "step.failed" || !e.key || splitKey(e.key).step !== step) continue;
    const d = e.data as { action?: string; roundSha?: string; cardSha?: string } | undefined;
    if (d?.action !== "questions" || !d.roundSha) continue;
    const r = ledger.getJson<GateRound>(d.roundSha);
    if (!r) continue;
    const dec = d.cardSha ? [...state.decisions].reverse().find((x) => x.artifactSha === d.cardSha) : undefined;
    const answered = r.answers ?? (dec ? (dec as unknown as { answers?: Record<string, string> }).answers ?? {} : undefined);
    out.push({ ...r, seq: e.seq, ...(d.cardSha ? { cardSha: d.cardSha } : {}), ...(answered ? { answered } : {}), by: r.answers ? "factory" : dec?.by ?? "human" });
  }
  return out;
}

const completions = (ledger: Ledger, step: string): number[] =>
  ledger.events().filter((e) => e.type === "step.completed" && e.key && splitKey(e.key).step === step).map((e) => e.seq);

/** The rounds this step asked since it last completed (a changed input starts afresh). */
export function gateRounds(ledger: Ledger, state: Pick<RunState, "decisions">, step: string): FiledRound[] {
  return roundsBetween(ledger, state, step, Math.max(-1, ...completions(ledger, step)));
}

/** The answers of answered rounds, as the step and its model calls read them. */
export function answersOf(rounds: FiledRound[]): GateAnswer[] {
  return rounds.flatMap((r) => (r.answered ? r.asked.map((q) => ({
    id: q.id, step: r.step, question: q.text, answer: resolveAnswer(q, r.answered![q.id] ?? q.recommended), by: r.by ?? "human",
    how: r.answers ? "assumed" as const : "answered" as const,
    settles: (r.failureOf[q.id] ?? []).map((n) => r.failures[n - 1]?.message).filter((m): m is string => !!m),
  })) : []));
}

/** The answer that settles this failure, when one does (gate E1 lets a failure an answer settles through, as it does a settled spec problem). */
export const settledBy = (answers: GateAnswer[] | undefined, message: string): GateAnswer | undefined =>
  answers?.find((a) => a.settles.some((m) => norm(m) === norm(message)));

/** Checks never carried as a risk: the output would not hold together (two screens with one id or route, no design at all, no approval). */
export const NEVER_CARRIED = new Set(["design-duplicate-id", "design-duplicate-route", "design-unknown-frame", "e1b-duplicate", "e1b-design", "e1b-approval"]);
/** Whether a step that ran with carryOn may carry these failures. */
export const carries = (ctx: Pick<StepContext, "carryOn">, failures: Pick<Failure, "check">[]): boolean => !!ctx.carryOn && !failures.some((f) => NEVER_CARRIED.has(f.check));

/** What a step carries after the rounds of questions, as lines for the estimate's assumptions. */
export const carriedLines = (gate: string, failures: Pick<Failure, "message">[]): string[] =>
  failures.map((f) => `Open risk: ${f.message} (${gate} still fails after ${GATE_ROUNDS} rounds of questions; the factory carried it on so the run goes on)`);

/**
 * The questions and the carried risks of the steps that fed an estimate, as lines for its assumptions: each answered question of the
 * rounds before a step's last completion, and each open risk a step carried. `except` is the step asking (its own lines are its own).
 */
export function gateNotes(ledger: Ledger, state: RunState, except: string): string[] {
  const lines: string[] = [];
  for (const [step, rec] of state.steps) {
    if (step === except || rec.status !== "completed") continue;
    const done = completions(ledger, step);
    const last = done[done.length - 1];
    if (last === undefined) continue;
    for (const a of answersOf(roundsBetween(ledger, state, step, done.length > 1 ? done[done.length - 2]! : -1, last))) {
      lines.push(`Check question ${a.id} (${step}): ${a.question} → ${a.answer} (${a.how === "assumed" ? "assumed by the factory, hands-off" : `answered by ${a.by}`})`);
    }
    const risks = rec.data?.openRisks;
    if (Array.isArray(risks)) lines.push(...risks.filter((x): x is string => typeof x === "string"));
  }
  return lines;
}

/** The section every model call of a step reads once its failing checks were asked about. */
export function answersText(answers: GateAnswer[]): string {
  return [
    "Questions about this step's earlier failing checks were put to the client. Follow these answers; they settle the failures named:",
    ...answers.map((a) => `- ${a.id}: ${a.question} → ${a.answer}${a.settles.length ? ` (settles: ${a.settles.join(" | ")})` : ""}`),
  ].join("\n");
}

/** The card a person answers in review mode: one question per line, the failures it settles, and how to answer. */
export function gateCard(runId: string, step: string, round: number, asked: ScoredQuestion[], failures: Failure[], failureOf: Record<string, number[]>, cardHash: string): string {
  return [
    `# Questions about the ${step} step's checks (round ${round} of at most ${GATE_ROUNDS})`,
    ``,
    `Run ${runId}. The ${step} step's checks still fail after a retry. Instead of parking the run, the factory asks you: each question settles one or more of the failures, and the step runs again with your answers. What still fails after ${GATE_ROUNDS} rounds is carried as an open risk on the estimate.`,
    ``,
    ...asked.flatMap((q) => [
      `**${q.id}** ${q.text}`,
      ...q.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}${o === q.recommended ? "   ← recommended: " + q.reason : ""}`),
      `  (settles: ${(failureOf[q.id] ?? []).map((n) => failures[n - 1]?.message).filter(Boolean).join(" | ")})`,
      ``,
    ]),
    `Answer with letters or your own words:`,
    `  factory answer ${runId} ${cardHash.slice(0, 8)} ${asked.map((q) => `${q.id}=A`).join(" ")}`,
    `  (use quotes for words: ${asked[0]?.id ?? "Q-1"}="only for trade customers")`,
    ``,
    `Card hash: ${cardHash.slice(0, 8)}`,
  ].join("\n");
}

/** One round's questions for a step's failing checks (one small model call): grouped, at most GATE_CAP, each with a recommended answer. */
export async function writeGateQuestions(ctx: StepContext, a: { step: string; failures: Failure[]; earlier: GateAnswer[]; firstId: number }):
  Promise<{ ok: true; asked: ScoredQuestion[]; failureOf: Record<string, number[]> } | { ok: false; outcome: StepOutcome }> {
  const spec = readOutput<{ requirements?: { id: string; ears: string }[] }>(ctx.state, ctx.ledger, "specify");
  const r = await think({ ...ctx, priorFailures: [], gateAnswers: undefined }, {
    stage: "clarifier", route: "clarifier", label: "check questions", cls: "read-large", budgetTokens: 30000, tools: [], schema: GateQuestionsOut, maxTurns: 4,
    sections: [
      S.template("tpl", `Requirements analyst. The factory's ${a.step} step was checked and these checks still fail after a retry. Write the questions a client answers so the step can be redone and pass; you don't redo the step.
- A failure usually means the requirements leave something open: which requirements the estimate covers, what a screen or task is for, how big something is, what is in or out of scope. Ask the question that decides it.
- One question settles one failure or several closely related ones; list their numbers in "failures". At most ${GATE_CAP} questions: settle the failures that change scope, data, money or who sees what first.
- Each question has 2-4 options and one "recommended" (copy the option text exactly) with a one-line reason; impact 1-3 with a reason (3 = changes data, money or scope; 2 = a visible flow; 1 = wording).
- The recommended option is always the smallest change that fully does what the request asks. Never recommend work the request doesn't ask for: offer it as another option. Leaving a thing out of the estimate, stated as an assumption, is an option when the request does not settle it.
- Never ask what the request, the requirements or the earlier answers already settle.
${UNTRUSTED_NOTE}`),
      S.artifact("failures", "failures", a.failures.map((f, n) => ({ n: n + 1, check: f.check, failure: f.message, ...(f.location ? { where: f.location } : {}) }))),
      ...(spec?.requirements?.length ? [S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears })))] : []),
      ...(a.earlier.length ? [S.artifact("answers", "answers", a.earlier.map(({ id, question, answer }) => ({ id, question, answer })))] : []),
      S.untrusted("request", "cli", ctx.state.info.request ?? ""),
      S.task("Write the questions."),
    ],
  });
  if (!r.ok) return r;
  const n = a.failures.length;
  const asked: ScoredQuestion[] = [];
  const failureOf: Record<string, number[]> = {};
  for (const q of r.output.questions) {
    const fs = [...new Set(q.failures)].filter((x) => x <= n);
    if (!fs.length || asked.length >= GATE_CAP) continue;
    const id = `Q-${a.firstId + asked.length}`;
    // the recommended answer is one of the options, so Enter (or no answer) picks it
    const options = q.options.includes(q.recommended) ? q.options : [q.recommended, ...q.options].slice(0, 4);
    const impact = q.impact as 1 | 2 | 3;
    asked.push({ id, category: "scope", text: q.text, options, recommended: q.recommended, reason: q.reason, spans: [], impact, impactReason: q.impactReason, uncertainty: 3, score: impact * 3 });
    failureOf[id] = fs;
  }
  return { ok: true, asked, failureOf };
}

/**
 * The next question number in the run, so a question about a failing check reads like the others (Q-n, after the clarify questions,
 * the spec's questions and earlier rounds): the highest Q number any spec-chain step's output or round used, plus one.
 */
export function nextQuestionId(ledger: Ledger, state: RunState): number {
  let max = 0;
  const see = (id: unknown) => { const m = typeof id === "string" ? /^Q-(\d+)$/.exec(id) : null; if (m) max = Math.max(max, Number(m[1])); };
  for (const [step, rec] of state.steps) {
    if (rec.status === "completed" && /^(clarify|specify)/.test(step) && rec.outputs[0]) {
      const o = ledger.getJson<{ asked?: { id: string }[]; settled?: { ref?: string }[]; answers?: Record<string, string> }>(rec.outputs[0]);
      for (const q of o?.asked ?? []) see(q.id);
      for (const x of o?.settled ?? []) see(x.ref);
      for (const id of Object.keys(o?.answers ?? {})) see(id);
    }
  }
  for (const e of ledger.events()) {
    const sha = e.type === "step.failed" ? (e.data as { roundSha?: string } | undefined)?.roundSha : undefined;
    if (sha) for (const q of ledger.getJson<GateRound>(sha)?.asked ?? []) see(q.id);
  }
  return max + 1;
}

/** A hands-off run's answers to questions about failing checks, as the run page lists the factory's assumptions (beside clarify's). */
export function factoryAssumed(ledger: Ledger): { id: string; text: string; risk: string }[] {
  return ledger.events().flatMap((e) => {
    const sha = e.type === "step.failed" ? (e.data as { roundSha?: string } | undefined)?.roundSha : undefined;
    const r = sha ? ledger.getJson<GateRound>(sha) : undefined;
    return r?.answers ? r.asked.map((q) => ({ id: q.id, text: `${q.text} → ${resolveAnswer(q, r.answers![q.id] ?? q.recommended)} (a ${r.step} check)`, risk: q.impact === 3 ? "high" : q.impact === 2 ? "medium" : "low" })) : [];
  });
}

/** Whether the run asks a person (review) or takes the recommended answers (hands-off). */
export const asksPerson = (state: Pick<RunState, "info">): boolean => humanReview(state.info);
