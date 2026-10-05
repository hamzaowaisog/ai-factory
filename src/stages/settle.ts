// Settling a spec's problems by questions (docs/estimates-design.md, "The pipeline"). What the specify step's repairs leave
// open in an estimate or design run (a critical or high critic finding, a capability the request did not ask for, a lint
// check that does not block) goes back to the client as clarify questions instead of stopping the run at gate E1: a person
// answers them on a card, or a hands-off run takes each recommended answer as an assumption. The spec is repaired with the
// answers and checked again, for at most SETTLE_ROUNDS rounds; what is still open after that is carried as an open risk,
// stated on the estimate. Gate E1 lets a settled problem through.
import { z } from "zod";
import type { SettledProblem, SpecDraft as Spec } from "../contracts/index.js";
import { humanReview } from "../estimate/settings.js";
import { openProblems, SETTLE_MODES, unsettled, type Found, type Problem } from "../estimate/settled.js";
import { readiness } from "../estimate/gates.js";
import { runGate } from "../gates/engine.js";
import { hashJson } from "../util/hash.js";
import { clarifications, resolveAnswer, type ClarifyResult, type ScoredQuestion } from "./clarify.js";
import { readOutput, type StepContext, type StepOutcome } from "./framework.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

/** Rounds of questions before what is still open is carried as an open risk. */
export const SETTLE_ROUNDS = 2;
/** Questions on one round's card; one question may settle several related problems. */
export const SETTLE_CAP = 8;

export const SettleOut = z.object({
  questions: z.array(z.object({
    /** the numbers of the problems this question settles */
    problems: z.array(z.number().int().min(1)).min(1),
    text: z.string(), options: z.array(z.string()).min(2).max(4), recommended: z.string(), reason: z.string(),
    impact: z.number().int().min(1).max(3), impactReason: z.string(),
  })),
  /** capabilities flagged as not asked for that the request does ask for, with the request's own words */
  inRequest: z.array(z.object({ problem: z.number().int().min(1), quote: z.string() })),
});

/** A settled answer, in the shape the drafters, the critic and the round trip read clarify answers. */
export interface Answer { id: string; question: string; answer: string; by: string }
/** One round's decision on a question, with the problems it settles. */
export interface Decided extends Answer { problems: Problem[] }

/** Where the settling is: carried on the card, so the step goes on from it once the card is answered. */
export interface SettleState<C extends Found> {
  round: number;
  spec: Spec;
  checks: C;
  settled: SettledProblem[];
  /** every question settled so far, as answers */
  answers: Answer[];
  /** this round's questions while the card is open */
  asked: ScoredQuestion[];
  problems: Problem[];
  /** question id -> the numbers (1-based, into problems) it settles */
  problemOf: Record<string, number[]>;
}

export interface SettleIo<C extends Found> {
  /** repair the spec so it does what the answers say */
  repair(spec: Spec, answers: Answer[], decided: Decided[]): Promise<{ ok: true; spec: Spec } | { ok: false; outcome: StepOutcome }>;
  /** the spec's checks again, with the answers known */
  recheck(spec: Spec, answers: Answer[]): Promise<{ ok: true; checks: C } | { ok: false; outcome: StepOutcome }>;
  /** requested behaviour a repair dropped (intent span ids): the repair is not kept */
  lost(before: Spec, after: Spec): string[];
}

const norm = (t: string) => t.toLowerCase().replace(/[\s"'“”‘’]+/g, " ").trim();

/** The question card's text: one question per line, the problems it settles, and how to answer. */
export function settleCard(runId: string, round: number, asked: ScoredQuestion[], problems: Problem[], problemOf: Record<string, number[]>, cardHash: string): string {
  return [
    `# Questions about the spec (round ${round} of at most ${SETTLE_ROUNDS})`,
    ``,
    `Run ${runId}. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.`,
    ``,
    ...asked.flatMap((q) => [
      `**${q.id}** ${q.text}`,
      ...q.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}${o === q.recommended ? "   ← recommended: " + q.reason : ""}`),
      `  (settles: ${(problemOf[q.id] ?? []).map((n) => problems[n - 1]?.text).filter(Boolean).join(" | ")})`,
      ``,
    ]),
    `Answer with letters or your own words:`,
    `  factory answer ${runId} ${cardHash.slice(0, 8)} ${asked.map((q) => `${q.id}=A`).join(" ")}`,
    `  (use quotes for words: ${asked[0]?.id ?? "Q-1"}="only for trade customers")`,
    ``,
    `Card hash: ${cardHash.slice(0, 8)}`,
  ].join("\n");
}

/**
 * One round's questions for the open problems (one model call): grouped, at most SETTLE_CAP, each with a recommended answer.
 * A capability the request does ask for comes back as a quote instead, and code checks the quote is in the request.
 */
export async function writeQuestions(ctx: StepContext, a: { problems: Problem[]; spec: Spec; request: string; answers: Answer[]; firstId: number }):
  Promise<{ ok: true; asked: ScoredQuestion[]; problemOf: Record<string, number[]>; inRequest: { problem: number; quote: string }[] } | { ok: false; outcome: StepOutcome }> {
  const r = await think(ctx, {
    stage: "clarifier", route: "clarifier", label: "spec questions", cls: "read-large", budgetTokens: 30000, tools: [], schema: SettleOut, maxTurns: 4,
    sections: [
      S.template("tpl", `Requirements analyst. The spec below was checked and these problems are still open. Write the questions a client answers to settle them; you don't fix the spec.
- One question settles one problem or several closely related ones; list their numbers in "problems". At most ${SETTLE_CAP} questions: settle the problems that change data, money, permissions or who sees what first.
- Each question has 2-4 options and one "recommended" (copy the option text exactly) with a one-line reason; impact 1-3 with a reason (3 = changes data or who sees what: writes, orders, permissions, money; 2 = a visible flow; 1 = wording).
- The recommended option is always the smallest change that fully does what the request asks. Never recommend new infrastructure, schema or concurrency machinery the request doesn't ask for: offer it as another option.
- A "not asked for" problem: first look for it in the request. If the request does ask for it (in any words), don't ask: put it in "inRequest" with the request's exact words in "quote". Otherwise ask whether to keep it, and recommend leaving it out.
- A "lint" problem is a format check that does not block: ask the question it raises (for example whether a fixed value should be configuration).
- Never ask what the request, the earlier answers or the spec already settle.
${UNTRUSTED_NOTE}`),
      S.artifact("problems", "problems", a.problems.map((p, n) => ({ n: n + 1, kind: p.kind === "invented" ? "not asked for" : p.kind, ...(p.reqId ? { req: p.reqId } : {}), problem: p.text }))),
      S.artifact("spec", "spec", { requirements: a.spec.requirements.map((q) => ({ id: q.id, ears: q.ears })), nfrs: a.spec.nfrs.map((x) => x.text), outOfScope: a.spec.outOfScope }),
      ...(a.answers.length ? [S.artifact("answers", "answers", a.answers)] : []),
      S.untrusted("request", "cli", a.request),
      S.task("Write the questions."),
    ],
  });
  if (!r.ok) return r;
  const n = a.problems.length;
  const req = norm(a.request);
  // a quote that is not in the request settles nothing: the problem stays open for a question
  const inRequest = r.output.inRequest.filter((x) => x.problem <= n && a.problems[x.problem - 1]!.kind === "invented" && x.quote.trim().length >= 8 && req.includes(norm(x.quote)));
  const quoted = new Set(inRequest.map((x) => x.problem));
  const asked: ScoredQuestion[] = [];
  const problemOf: Record<string, number[]> = {};
  for (const q of r.output.questions) {
    const ps = [...new Set(q.problems)].filter((p) => p <= n && !quoted.has(p));
    if (!ps.length || asked.length >= SETTLE_CAP) continue;
    const id = `Q-${a.firstId + asked.length}`;
    // the recommended answer is one of the options, so Enter (or no answer) picks it
    const options = q.options.includes(q.recommended) ? q.options : [q.recommended, ...q.options].slice(0, 4);
    const impact = q.impact as 1 | 2 | 3;
    asked.push({
      id, category: ps.some((p) => a.problems[p - 1]!.kind === "invented") ? "scope" : "errors", text: q.text, options, recommended: q.recommended, reason: q.reason,
      spans: [], impact, impactReason: q.impactReason, uncertainty: 3, score: impact * 3,
    });
    problemOf[id] = ps;
  }
  return { ok: true, asked, problemOf, inRequest };
}

/** The settle card last posted for this spec, and the decision on it when there is one. */
export function lastSettle<C extends Found>(ctx: Pick<StepContext, "ledger" | "state">, key: string): { state: SettleState<C>; artifactSha: string; answers?: Record<string, string>; by?: string } | undefined {
  const ev = [...ctx.ledger.events()].reverse().find((e) => e.type === "human.requested" && (e.data as { settleKey?: string } | undefined)?.settleKey === key);
  if (!ev) return undefined;
  const d = ev.data as { pendingSha: string; artifactSha: string };
  const state = ctx.ledger.getJson<SettleState<C>>(d.pendingSha)!;
  const decision = [...ctx.state.decisions].reverse().find((x) => x.artifactSha === d.artifactSha);
  return { state, artifactSha: d.artifactSha, ...(decision ? { answers: (decision as unknown as { answers?: Record<string, string> }).answers ?? {}, by: decision.by } : {}) };
}

function card<C extends Found>(ctx: StepContext, key: string, st: SettleState<C>): StepOutcome {
  const cardSha = ctx.ledger.putJson({ key: "settle", settleKey: key, round: st.round, asked: st.asked, assumptions: [] });
  return {
    kind: "wait",
    card: {
      cardId: `spec-questions-${st.round}-${cardSha.slice(0, 8)}`, kind: "question", artifactSha: cardSha,
      markdown: settleCard(ctx.runId, st.round, st.asked, st.problems, st.problemOf, cardSha),
      extra: { settleKey: key, pendingSha: ctx.ledger.putJson(st) },
    },
  };
}

/** A round's answers applied: the spec repaired with them and checked again, and the round's problems settled. */
async function applyRound<C extends Found>(st: SettleState<C>, raw: Record<string, string>, how: "answered" | "assumed", by: string, io: SettleIo<C>, log: (m: string) => void):
  Promise<{ ok: true; st: SettleState<C> } | { ok: false; outcome: StepOutcome }> {
  const decided: Decided[] = st.asked.map((q) => ({
    id: q.id, question: q.text, answer: resolveAnswer(q, raw[q.id] ?? q.recommended), by,
    problems: (st.problemOf[q.id] ?? []).map((n) => st.problems[n - 1]!).filter(Boolean),
  }));
  const answers = [...st.answers, ...decided.map(({ problems: _p, ...x }) => x)];
  const rep = await io.repair(st.spec, answers, decided);
  if (!rep.ok) return rep;
  const lost = io.lost(st.spec, rep.spec);
  const settledNow = (h: SettledProblem["how"], note = ""): SettledProblem[] => decided.flatMap((d) => d.problems.map((p) => ({ kind: p.kind, problem: p.text, how: h, ref: d.id, decision: `${d.question} → ${d.answer}${note}` })));
  if (lost.length) {
    // an answer that could only be applied by dropping requested behaviour: keep the spec, carry the problems as risks
    log(`specify: fixing the spec with round ${st.round}'s answers dropped intent span${lost.length > 1 ? "s" : ""} ${lost.join(", ")}; kept the spec, the problems are carried as open risks`);
    return { ok: true, st: { ...st, settled: [...st.settled, ...settledNow("open-risk", " (not applied: it would drop requested behaviour)")], answers, asked: [], problems: [], problemOf: {} } };
  }
  const ch = await io.recheck(rep.spec, answers);
  if (!ch.ok) return ch;
  return { ok: true, st: { ...st, spec: rep.spec, checks: ch.checks, settled: [...st.settled, ...settledNow(how)], answers, asked: [], problems: [], problemOf: {} } };
}

/**
 * Settle the spec's open problems: questions, the answers (a person's on a card, or the recommended ones in a hands-off run),
 * a repair and a fresh check, round after round. Resumes from the card when one was answered. Returns the settled spec and its
 * checks, or the outcome to return (a card to wait on, a failure).
 */
export async function settle<C extends Found>(ctx: StepContext, a: { key: string; start: () => { spec: Spec; checks: C }; request: string; firstId: number; io: SettleIo<C> }):
  Promise<{ ok: true; spec: Spec; checks: C; settled: SettledProblem[]; answers: Answer[] } | { ok: false; outcome: StepOutcome }> {
  const handsOff = !humanReview(ctx.state.info);
  let st: SettleState<C>;
  const last = lastSettle<C>(ctx, a.key);
  if (last) {
    // the card was answered (or another card took its place before it was): go on from where it was posted
    if (!last.answers) return { ok: false, outcome: card(ctx, a.key, last.state) };
    ctx.log(`specify: fixing the spec with the answers to round ${last.state.round}'s questions`);
    const r = await applyRound(last.state, last.answers, "answered", last.by ?? "human", a.io, ctx.log);
    if (!r.ok) return r;
    st = r.st;
  } else {
    const s0 = a.start();
    st = { round: 0, spec: s0.spec, checks: s0.checks, settled: [], answers: [], asked: [], problems: [], problemOf: {} };
  }
  for (;;) {
    const open = openProblems(st.checks, st.settled);
    if (!open.length) break;
    if (st.round >= SETTLE_ROUNDS) {
      ctx.log(`specify: ${open.length} problem${open.length > 1 ? "s" : ""} still open after ${SETTLE_ROUNDS} rounds of questions; the estimate carries ${open.length > 1 ? "them" : "it"} as open risks`);
      st = { ...st, settled: [...st.settled, ...open.map((p) => ({ kind: p.kind, problem: p.text, how: "open-risk" as const, decision: `Still open after ${SETTLE_ROUNDS} rounds of questions: carried as a risk` }))] };
      break;
    }
    const q = await writeQuestions(ctx, { problems: open, spec: st.spec, request: a.request, answers: st.answers, firstId: a.firstId + st.answers.length });
    if (!q.ok) return q;
    const round = st.round + 1;
    // a capability the request does ask for is settled without a question; as an answer, the round trip maps it from now on
    const next = a.firstId + st.answers.length + q.asked.length;
    const quoted = q.inRequest.map((x, k) => ({ id: `Q-${next + k}`, text: open[x.problem - 1]!.text, quote: x.quote.trim() }));
    const found = quoted.map((x) => ({ kind: "invented" as const, problem: x.text, how: "in-request" as const, ref: x.id, decision: `The request asks for it: "${x.quote}"` }));
    st = {
      ...st, round, settled: [...st.settled, ...found], asked: q.asked, problems: open, problemOf: q.problemOf,
      answers: [...st.answers, ...quoted.map((x) => ({ id: x.id, question: `Does the request ask for this: ${x.text}`, answer: `Yes: "${x.quote}"`, by: "factory" }))],
    };
    ctx.log(`specify: round ${round}: ${open.length} open problem${open.length > 1 ? "s" : ""}, ${q.asked.length} question${q.asked.length === 1 ? "" : "s"}${found.length ? `, ${found.length} found in the request` : ""}${handsOff && q.asked.length ? " (hands-off: the recommended answers are assumed)" : ""}`);
    if (!q.asked.length) continue;
    if (!handsOff) return { ok: false, outcome: card(ctx, a.key, st) };
    const r = await applyRound(st, Object.fromEntries(q.asked.map((x) => [x.id, x.recommended])), "assumed", "factory", a.io, ctx.log);
    if (!r.ok) return r;
    st = r.st;
  }
  return { ok: true, spec: st.spec, checks: st.checks, settled: st.settled, answers: st.answers };
}

/** The key a spec's settling is filed under: the merged spec it started from and the request (a module's own text). */
export const settleKey = (mergedSha: string, request: string) => hashJson({ step: "settle", merged: mergedSha, request });

/** How a settled problem reads on the estimate's assumptions. */
export function settledText(s: SettledProblem): string {
  switch (s.how) {
    case "answered": return `Spec question ${s.ref ?? ""}: ${s.decision} (answered)`;
    case "assumed": return `Spec question ${s.ref ?? ""}: ${s.decision} (assumed by the factory, hands-off)`;
    case "in-request": return `Spec check: "${s.problem}" is in scope. ${s.decision}`;
    case "open-risk": return `Open risk: ${s.problem}`;
  }
}

/**
 * A run started before problems were settled by questions reaches design or breakdown with a spec gate E1 refuses: record
 * E1's verdict and go back, so the specify step settles that spec's problems (it runs again once E1 has refused it) instead of
 * the run drawing screens from it or parking. A run whose spec is seeded from another run (an approved design, a sibling
 * estimate) has no specify step to go back to: undefined, and the step goes on as before.
 */
export async function backToSettle(ctx: StepContext, step: string, specStep = "specify"): Promise<StepOutcome | undefined> {
  if (!SETTLE_MODES.has(ctx.state.info.mode ?? "") || ctx.state.info.designRef || ctx.state.info.parent?.kind === "sibling") return undefined;
  const spec = readOutput<Found & { requirements: unknown[] }>(ctx.state, ctx.ledger, specStep);
  if (!unsettled(spec)) return undefined;
  const c = clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));
  const questions = { questions: c.answers.map((a) => ({ id: a.id, answer: a.answer })) };
  const e1 = await runGate(readiness, ctx.ledger, ctx.writer, { spec: ctx.ledger.putJson(spec), questions: ctx.ledger.putJson(questions) }, ctx.policy, { step });
  if (e1.passed) return undefined;
  const n = openProblems(spec!).length;
  return { kind: "back", reason: `gate E1 refused the spec (${n} open problem${n > 1 ? "s" : ""}); the spec step runs again and settles ${n > 1 ? "them" : "it"} with questions` };
}
