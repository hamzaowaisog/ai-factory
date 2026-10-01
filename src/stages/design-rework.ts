// When a lead sends a design back, only a reason comes with it. This reads the reason against a compact index of the design
// (cheap model), then code decides: fix just the parts named, or redraw the whole design. Pure helpers here; the model
// calls that carry the decision out are in design.ts. Everything the lead reads uses page titles and their own words, never ids.
import { z } from "zod";

export const Triage = z.object({
  /** "patch" only when the note names things that can be fixed in place; "redraw" when the structure itself is wrong or nothing can be pinned down */
  verdict: z.enum(["patch", "redraw"]),
  summary: z.string().max(200),
  items: z.array(z.object({
    /** look: colours, mood, type, corners, motion. screen: a page's layout or behaviour. data: only the sample content of a page */
    part: z.enum(["look", "screen", "data"]),
    /** the id of the page, from the index (screen and data only) */
    screen: z.string().optional(),
    /** the lead's own words for this complaint */
    quote: z.string().min(1).max(200),
    /** what to change, in plain words a lead would read */
    change: z.string().min(1).max(240),
    confidence: z.enum(["high", "low"]),
  })).max(8).default([]),
  /** ids of pages the lead called fine */
  fine: z.array(z.string()).default([]),
  /** things asked for that no requirement covers: not fixable by drawing */
  notDesign: z.array(z.object({ quote: z.string().max(200), why: z.string().max(200) })).default([]),
});
export type Triage = z.infer<typeof Triage>;

export const TRIAGE_RULES = `You read a lead's note about a design they sent back, and say which parts of it to fix. You are a principal UI/UX engineer; the lead is not technical and talks about pages by what they show ("the booking page", "the colours", "the list of trips").
- You get an index of the design (its look, and each page with its id, title, what it is for, its blocks and states), and the requirements with the pages that serve them.
- Match what the lead says to pages by title and purpose. "part" is look (colours, mood, type, corners, motion, how modern it feels), screen (a page's layout, behaviour, a button, a state) or data (only the sample content of a page: names, amounts, dates, rows).
- One item per separate complaint, quoting the lead's own words and saying in plain words what to change. Say "confidence": low when you are guessing which page or part is meant; two pages equally likely means two items, or low.
- "fine": ids of pages the lead said are fine or good.
- Words such as export, report, send, download, share or print in the note are about the product being designed, never about this tool. Judge them against the requirements: if a requirement covers it (a button that is missing or hard to find on the page that serves it), it is a "screen" fix on that page. Only when no requirement covers it at all is it notDesign, with the reason.
- verdict "redraw" when the note says the structure is wrong (a page that should not exist, a missing page, the order of the pages, the whole flow), when it is about most of the design, or when nothing in it can be pinned to a part ("I do not like it", "it feels generic"). Otherwise "patch".
- Do not invent complaints the lead did not make.`;

export interface ReworkRound {
  round: number;
  mode: "patch" | "redraw" | "none";
  /** "look" and the ids of the pages redrawn */
  patched: string[];
  /** what changed, in the lead's terms */
  lines: string[];
  /** titles of pages kept exactly as they were */
  kept: string[];
  notDesign: { quote: string; why: string }[];
  fine: string[];
}

export interface DesignLike {
  flow?: string;
  theme?: { mood?: string; brand?: string; mode?: string; chrome?: string; fx?: string };
  screens: { id: string; route: string; file: string; reqs: string[]; states?: string[]; mock?: { title: string; blocks: { type: string }[] } }[];
  rework?: ReworkRound[];
  revision?: number;
}

/** The name a lead knows a page by. */
export const screenName = (s: { route: string; mock?: { title: string } }): string => s.mock?.title ?? s.route;

/** What the triage model reads: no sample data, so it stays small. */
export function designIndex(d: DesignLike, reqs: { id: string; ears: string }[]): unknown {
  const nameOf = new Map(d.screens.map((s) => [s.id, screenName(s)]));
  return {
    look: d.theme ?? "the existing app's own look",
    pages: d.screens.map((s) => ({ id: s.id, title: screenName(s), route: s.route, blocks: s.mock?.blocks.map((b) => b.type) ?? [], states: s.states ?? [] })),
    requirements: reqs.map((q) => ({ id: q.id, text: q.ears.slice(0, 140), shownOn: d.screens.filter((s) => s.reqs.includes(q.id)).map((s) => nameOf.get(s.id)) })),
  };
}

/** Parts patched since the last full redraw: a part complained about again was not fixed by the first patch. */
export function patchedSinceRedraw(rework: ReworkRound[] = []): Set<string> {
  const out = new Set<string>();
  for (let i = rework.length - 1; i >= 0; i--) {
    if (rework[i]!.mode === "redraw") break;
    for (const p of rework[i]!.patched) out.add(p);
  }
  return out;
}

export const COST = { look: 4, screen: 10, full: 80, share: 0.6 } as const;

export type ReworkPlan =
  | { mode: "patch"; look: boolean; screens: string[]; items: Triage["items"] }
  | { mode: "none" }
  | { mode: "redraw"; why: "structure" | "vague" | "wide" | "repeat" | "cost" };

/** Code's decision, whatever the model said. Anything doubtful costs a full redraw, which is never worse than today. */
export function decideRework(t: Triage, d: DesignLike): ReworkPlan {
  const ids = new Set(d.screens.map((s) => s.id));
  if (!t.items.length) return t.notDesign.length && t.verdict === "patch" ? { mode: "none" } : { mode: "redraw", why: "vague" };
  if (t.verdict === "redraw") return { mode: "redraw", why: "structure" };
  if (t.items.some((i) => i.confidence === "low")) return { mode: "redraw", why: "vague" };
  if (t.items.some((i) => i.part !== "look" && (!i.screen || !ids.has(i.screen)))) return { mode: "redraw", why: "vague" };
  const done = patchedSinceRedraw(d.rework);
  const parts = t.items.map((i) => (i.part === "look" ? "look" : i.screen!));
  if (parts.some((p) => done.has(p))) return { mode: "redraw", why: "repeat" };
  const screens = [...new Set(t.items.filter((i) => i.part !== "look").map((i) => i.screen!))];
  const look = t.items.some((i) => i.part === "look");
  if (screens.length * 2 > d.screens.length) return { mode: "redraw", why: "wide" };
  if ((look ? COST.look : 0) + screens.length * COST.screen > COST.full * COST.share) return { mode: "redraw", why: "cost" };
  return { mode: "patch", look, screens, items: t.items };
}

const WHY: Record<Extract<ReworkPlan, { mode: "redraw" }>["why"] | "failed", string> = {
  structure: "Your feedback is about how the design is organised, so I redrew all of it with your note in mind.",
  vague: "I could not tie your note to a single page or part, so I redrew the whole design with it in mind.",
  wide: "Your feedback touched most of the design, so I redrew all of it.",
  repeat: "This part was already adjusted once, so I redrew the whole design to fix the underlying problem.",
  cost: "Fixing each point separately would have cost as much as starting over, so I redrew the design.",
  failed: "A targeted change did not hold up to the checks, so I redrew the whole design.",
};
export const redrawLine = (why: keyof typeof WHY): string => WHY[why];

/** The lines for the card: what was done, in the lead's words. */
export function roundOf(args: { round: number; plan: ReworkPlan | { mode: "redraw"; why: "failed" }; t?: Triage; design: DesignLike; patched?: string[] }): ReworkRound {
  const { plan, t, design } = args;
  const fine = (t?.fine ?? []).filter((id) => design.screens.some((s) => s.id === id));
  const name = (id?: string) => { const s = design.screens.find((x) => x.id === id); return s ? screenName(s) : "this page"; };
  const notDesign = t?.notDesign ?? [];
  if (plan.mode === "redraw") return { round: args.round, mode: "redraw", patched: [], lines: [redrawLine(plan.why)], kept: [], notDesign, fine };
  const items = plan.mode === "patch" ? plan.items : [];
  const lines = items.map((i) => `${i.part === "look" ? "Colours and style" : name(i.screen)}: ${i.change} (you said: "${i.quote}")`);
  const patched = args.patched ?? [];
  const kept = design.screens.filter((s) => !patched.includes(s.id)).map(screenName);
  return { round: args.round, mode: plan.mode, patched, lines: lines.length ? lines : ["Nothing in your note was a design change."], kept, notDesign, fine };
}

/** The card section. Empty when the design has not been sent back. */
export function reworkCardLines(design: DesignLike): string[] {
  const r = design.rework?.[design.rework.length - 1];
  if (!r) return [];
  return [
    `## What changed from your feedback`,
    ...r.lines.map((l) => `- ${l}`),
    ...r.notDesign.map((n) => `- Not changed: "${n.quote}" (${n.why}). If this is a missing feature, add it with a change request: factory estimate --revises <run>.`),
    ...(r.mode === "patch" && r.kept.length ? [``, `Kept exactly as before: ${r.kept.join(", ")}.`] : []),
    ``, `Not right yet? Reject again and say what is still wrong.`, ``,
  ];
}
