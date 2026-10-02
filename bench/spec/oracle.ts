// Stands in for the person on the question card. It answers from the case's facts, in the person's own words;
// a question no fact covers is left to the card's recommended option, as a person in a hurry would. No model.
import { hits, strength, type EvalCase } from "./case.js";

export interface CardQuestion { id: string; text: string; options: string[]; recommended: string }
export interface OracleAnswer { question: string; text: string; fact?: string; answer?: string }

export function answer(q: CardQuestion, facts: EvalCase["facts"]): OracleAnswer {
  const text = `${q.text} ${q.options.join(" ")}`;
  const best = facts.filter((f) => hits(f.about, text)).sort((a, b) => strength(b.about, text) - strength(a.about, text))[0];
  return best ? { question: q.id, text: q.text, fact: best.id, answer: best.answer } : { question: q.id, text: q.text };
}

/** The answers map `factory answer` would record: fact-backed answers only; the rest take the recommendation. */
export function answerCard(questions: CardQuestion[], facts: EvalCase["facts"]): { answers: Record<string, string>; log: OracleAnswer[] } {
  const log = questions.map((q) => answer(q, facts));
  return { answers: Object.fromEntries(log.filter((a) => a.answer).map((a) => [a.question, a.answer!])), log };
}
