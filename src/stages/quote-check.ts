// Every requirement the distill model keeps must quote its cited turn (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §4).
// Speech-to-text is messy, so both sides are normalised first: case, punctuation, curly quotes, fillers and spacing do not count.
// The skill asks for 5-25 words; the check takes 3-40 on purpose.
import type { DistillOut, Turn } from "../contracts/index.js";

/** More than this share of requirements dropped, or none kept: one repair call (PENDING team decision, spec §4). */
export const REPAIR_DROP_SHARE = 0.2;
const FILLERS = new Set(["uh", "um", "uhm", "hmm", "erm"]);
const MIN_WORDS = 3, MAX_WORDS = 40;

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[’‘`']/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter((w) => w && !FILLERS.has(w)).join(" ");
}

export interface Dropped { id: string; text: string; quote: string; turn: string; why: string }

export function checkQuotes(out: DistillOut, turns: Turn[]): { kept: DistillOut["requirements"]; dropped: Dropped[] } {
  const byId = new Map(turns.map((t) => [t.id, ` ${normalise(t.text)} `]));
  const kept: DistillOut["requirements"] = [], dropped: Dropped[] = [];
  for (const r of out.requirements) {
    const q = normalise(r.quote), words = q ? q.split(" ").length : 0, turn = byId.get(r.turn);
    const why = !turn ? `no turn ${r.turn}`
      : words < MIN_WORDS ? `the quote is ${words} word${words === 1 ? "" : "s"}; at least ${MIN_WORDS}`
      : words > MAX_WORDS ? `the quote is ${words} words; at most ${MAX_WORDS}`
      : !turn.includes(` ${q} `) ? `the quote is not in ${r.turn}`
      : undefined;
    if (why) dropped.push({ id: r.id, text: r.text, quote: r.quote, turn: r.turn, why });
    else kept.push(r);
  }
  return { kept, dropped };
}

export function needsRepair(kept: number, dropped: number): boolean {
  return kept === 0 || dropped / (kept + dropped) > REPAIR_DROP_SHARE;
}
