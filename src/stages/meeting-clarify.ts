// A transcript run's clarify (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §5b): what the meeting left open is always
// asked, and what the client deferred or excluded is never asked about. The client intent (distill's output) says which is which;
// the brief's `- <id>: ` lines say which clarify call (the whole brief, or one module of it) each open item belongs to.
import type { ClientIntentBody, Transcript } from "../contracts/index.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";
import type { Assumption } from "./clarify.js";
import { outputOf } from "./framework.js";

export interface MeetingItem { id: string; text: string; at?: string }
export interface MeetingContext { questions: MeetingItem[]; outOfScope: { id: string; status: string; text: string }[] }

/** What clarify must ask and must not ask, for the request text it is reading; undefined when the run was not distilled. */
export function meetingContext(state: RunState, ledger: Pick<Ledger, "getJson">, request: string): MeetingContext | undefined {
  const sha = outputOf(state, "distill");
  if (!sha) return undefined;
  const intent = ledger.getJson<ClientIntentBody>(sha);
  const t = state.info.transcriptSha ? ledger.getJson<Transcript>(state.info.transcriptSha) : undefined;
  const timeOf = new Map((t?.turns ?? []).map((x) => [x.id, `${x.id}, ${x.time}`]));
  const at = (turn?: string) => (turn ? timeOf.get(turn) ?? turn : undefined);
  const item = (id: string, text: string, turn?: string): MeetingItem => { const a = at(turn); return a ? { id, text, at: a } : { id, text }; };
  const questions = [
    ...intent.requirements.filter((r) => r.status === "open").map((r) => item(r.id, `Client to confirm: ${r.text}`, r.turn)),
    ...intent.openQuestions.map((q) => item(q.id, q.text, q.turn)),
  ].filter((q) => request.includes(`- ${q.id}: `));
  const outOfScope = intent.requirements.filter((r) => r.status === "deferred" || r.status === "excluded").map((r) => ({ id: r.id, status: r.status, text: r.text }));
  return { questions, outOfScope };
}

/** The clarifier's briefing section. Round 2 only gets the out-of-scope list: its job is follow-ups to answered questions. */
export function meetingPrompt(m: MeetingContext, round: 1 | 2): string {
  const lines: string[] = [];
  if (round === 1 && m.questions.length) {
    lines.push(`Left open in the client meeting. Each MUST become exactly one question; give the item's id (e.g. "${m.questions[0]!.id}") in "meeting":`,
      ...m.questions.map((q) => `- ${q.id}${q.at ? ` (${q.at})` : ""}: ${q.text}`));
  }
  if (m.outOfScope.length) {
    if (lines.length) lines.push("");
    lines.push("Out of scope by the client's decision in the meeting (deferred or excluded). Never ask about these, and never recommend building them:",
      ...m.outOfScope.map((o) => `- ${o.id} (${o.status}): ${o.text}`));
  }
  return lines.join("\n");
}

/** Marks the clarifier's questions that carry a meeting item: their reason says so, and they are asked whatever their score. */
export function meetingMarked<Q extends { id: string; meeting?: string; reason: string }>(qs: Q[], m: MeetingContext): { questions: Q[]; forced: Set<string>; missing: MeetingItem[] } {
  const byId = new Map(m.questions.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const forced = new Set<string>();
  const questions = qs.map((q) => {
    const item = q.meeting ? byId.get(q.meeting) : undefined;
    if (!item || seen.has(item.id)) return q;
    seen.add(item.id);
    forced.add(q.id);
    return { ...q, reason: `Left open in the meeting (${item.at ?? item.id}). ${q.reason}` };
  });
  return { questions, forced, missing: m.questions.filter((x) => !seen.has(x.id)) };
}

/** A meeting item the clarifier did not turn into a question: carried as a high-risk assumption, so it reaches the approval card. */
export function notAskedAssumption(item: MeetingItem, id: string): Assumption {
  return { id, text: `${item.text} (left open in the meeting${item.at ? `, ${item.at}` : ""}) → not asked; still open`, risk: "high", fromSpan: [], fromQuestion: item.id };
}
