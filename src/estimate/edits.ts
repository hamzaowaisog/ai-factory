// A lead's edits on the approval card (docs/estimates-design.md: "Any anchor or line can be edited there,
// and everything recomputes"). An edit changes an anchor's hours or a task's ratio; it never types a total.
// Edits are recorded as decisions, applied to the stored proposals, and the estimate is assembled again by
// the same code, so every sum, gate and workbook cell follows.
import type { RunState } from "../ledger/state.js";
import type { Proposal } from "./assemble.js";

export interface Edit {
  anchors?: Record<string, { min: number; max: number }>;
  ratios?: Record<string, number>;
  by: string;
  reason: string;
}

/** All edit decisions on estimate cards, oldest first. */
export function editsOf(state: Pick<RunState, "decisions">): Edit[] {
  return state.decisions
    .filter((d) => d.cardId.startsWith("estimate-") && d.decision === "edit")
    .map((d) => {
      const x = d as unknown as { edits?: Pick<Edit, "anchors" | "ratios">; reason?: string };
      return { anchors: x.edits?.anchors, ratios: x.edits?.ratios, by: d.by, reason: String(x.reason ?? "").trim() };
    });
}

/** Problems with an edit against the proposals it would change; empty when it can be applied. */
export function checkEdit(e: Pick<Edit, "anchors" | "ratios">, lead: Proposal): string[] {
  const out: string[] = [];
  const anchors = new Set(lead.anchors.map((a) => a.taskId));
  const tasks = new Set(lead.tasks.map((t) => t.taskId));
  for (const [id, r] of Object.entries(e.anchors ?? {})) {
    if (!anchors.has(id)) out.push(`${id} is not an anchor (anchors: ${[...anchors].join(", ")})`);
    if (!(r.min >= 0) || !(r.max >= r.min)) out.push(`${id}: the range ${r.min}-${r.max} is not valid`);
  }
  for (const [id, v] of Object.entries(e.ratios ?? {})) {
    if (!tasks.has(id)) out.push(`${id} is not a sized task`);
    else if (anchors.has(id)) out.push(`${id} is an anchor: change its hours instead of its ratio`);
    if (!(v > 0)) out.push(`${id}: the ratio must be more than 0`);
  }
  if (!Object.keys(e.anchors ?? {}).length && !Object.keys(e.ratios ?? {}).length) out.push("the edit changes nothing");
  return out;
}

/** The proposals with every edit applied, in order. Throws on an edit that cannot apply. */
export function applyEdits(proposals: Proposal[], edits: Edit[]): Proposal[] {
  let cur = proposals;
  for (const e of edits) {
    const bad = checkEdit(e, cur[0]!);
    if (bad.length) throw new Error(`edit by ${e.by}: ${bad.join("; ")}`);
    // the lead's word is final: every estimator's reading of that anchor or ratio follows it
    cur = cur.map((p) => ({
      ...p,
      anchors: p.anchors.map((a) => (e.anchors?.[a.taskId] ? { ...a, hours: e.anchors[a.taskId]! } : a)),
      tasks: p.tasks.map((t) => (e.ratios?.[t.taskId] !== undefined && !p.anchors.some((a) => a.taskId === t.taskId) ? { ...t, ratio: e.ratios[t.taskId]! } : t)),
    }));
  }
  return cur;
}

export const describeEdit = (e: Edit): string => [
  ...Object.entries(e.anchors ?? {}).map(([id, r]) => `anchor ${id} set to ${r.min}-${r.max} h`),
  ...Object.entries(e.ratios ?? {}).map(([id, v]) => `${id} ratio set to ${v}`),
].join(", ") + ` (${e.by}${e.reason ? `: ${e.reason}` : ""})`;

/** `EST-1=6-12` -> a range; `EST-4=2` -> a ratio. Throws a readable error on anything else. */
export function parseAnchorSpec(spec: string): [string, { min: number; max: number }] {
  const m = /^(EST-\d+)=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(spec.trim());
  if (!m) throw new Error(`Can't read --anchor "${spec}". Use EST-1=min-max in hours (for example EST-1=6-12).`);
  return [m[1]!, { min: Number(m[2]), max: Number(m[3]) }];
}
export function parseRatioSpec(spec: string): [string, number] {
  const m = /^(EST-\d+)=(\d+(?:\.\d+)?)$/.exec(spec.trim());
  if (!m) throw new Error(`Can't read --ratio "${spec}". Use EST-4=2 (a multiple of its anchor).`);
  return [m[1]!, Number(m[2])];
}
