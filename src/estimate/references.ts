// Approved past tasks as references (docs/estimate-consistency.md, section 12, Phase 2). When a catalogue-sized
// estimate is made, each task is matched against the tasks of earlier approved estimates on the same catalogue root
// (any tuned version of it): same kind, track, complexity and executor, ranked by UI level, then by how close the item count is, then
// newest first. The estimators see the closest matches and their sizes; they still pick a size from the catalogue
// scale, so the hours still come from code. An estimate counts as approved when its approve-estimate step passed,
// whether the factory approved it (hands-off, gate E7) or a person did. Matching reads categories and counts only.
import type { Breakdown, Estimate, SizeStep } from "../contracts/index.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Range } from "./assumptions.js";
import { rootOf } from "./catalogue-store.js";
import { decisionLogFor } from "./decisions.js";

export interface PastTask {
  runId: string;
  taskId: string;
  kind: string;
  track: string;
  complexity: string;
  executor: string;
  ui: string;
  items: number;
  size: SizeStep;
  hours: Range;
  catalogue: string;
  /** when the approval was recorded, for newest-first ranking */
  approvedAt: string;
}

/** A past task shown as a reference for one task of this estimate. */
export interface TaskReference { runId: string; taskId: string; size: SizeStep; hours: Range; sameUi: boolean; itemsDiff: number }

/** Tasks of one run's approved estimate, or none when it has no approval or was not sized against the catalogue. */
export function pastTasksOfRun(ledger: Ledger): PastTask[] {
  const state = replay(ledger.events());
  const step = state.steps.get("approve-estimate");
  if (step?.status !== "completed") return [];
  const sha = (step.data?.named as Record<string, string> | undefined)?.approval ?? step.outputs[0];
  if (!sha) return [];
  const approval = ledger.getJson<{ estimateSha: string; decision: string }>(sha);
  if (approval.decision !== "approved") return [];
  const est = ledger.getJson<Pick<Estimate, "tasks" | "catalogue" | "breakdownSha">>(approval.estimateSha);
  if (!est.catalogue) return [];
  const bd = ledger.getJson<Pick<Breakdown, "tasks">>(est.breakdownSha);
  const task = new Map(bd.tasks.map((t) => [t.id, t]));
  const approvedAt = ledger.events().filter((e) => e.type === "step.completed" && e.key?.startsWith("approve-estimate/")).at(-1)?.ts ?? "";
  // the screen's UI level is not on the breakdown; the estimate's decision log recorded it as a feature
  const log = decisionLogFor({ runId: state.info.runId, estimateSha: approval.estimateSha });
  const ui = new Map(log?.decisions.filter((d) => d.question === "size").map((d) => [d.taskId, String(d.features.ui ?? "none")]) ?? []);
  return est.tasks.flatMap((s) => {
    const t = task.get(s.taskId);
    if (!t?.kind || !s.size) return [];
    return [{ runId: state.info.runId, taskId: s.taskId, kind: t.kind, track: t.track, complexity: t.complexity, executor: t.executor, ui: ui.get(s.taskId) ?? "none", items: t.items.length, size: s.size, hours: s.hours, catalogue: est.catalogue!.version, approvedAt }];
  });
}

/**
 * Tasks of every other run's approved, catalogue-sized estimate on this catalogue's root. Tuned versions of one root
 * share the kinds and the size wording (tuning changes numbers only), so their sizes stay comparable.
 * An unreadable run adds nothing.
 */
export function loadPastTasks(exceptRun: string, catalogue: string): PastTask[] {
  const out: PastTask[] = [];
  for (const id of Ledger.listRuns()) {
    if (id === exceptRun) continue;
    try { out.push(...pastTasksOfRun(Ledger.open(id)).filter((p) => rootOf(p.catalogue) === rootOf(catalogue))); } catch { /* skip */ }
  }
  return out;
}

export const MAX_REFERENCES = 2;

/** The closest approved past tasks for one task: same kind, track, complexity and executor; then UI level, item count, newest. */
export function nearMatches(t: { kind?: string | undefined; track: string; complexity: string; executor: string; items: unknown[] }, ui: string | undefined, past: PastTask[], max = MAX_REFERENCES): TaskReference[] {
  const level = ui ?? "none";
  return past
    .filter((p) => p.kind === t.kind && p.track === t.track && p.complexity === t.complexity && p.executor === t.executor)
    .map((p) => ({ p, sameUi: p.ui === level, itemsDiff: Math.abs(p.items - t.items.length) }))
    .sort((a, b) => Number(b.sameUi) - Number(a.sameUi) || a.itemsDiff - b.itemsDiff || b.p.approvedAt.localeCompare(a.p.approvedAt) || a.p.runId.localeCompare(b.p.runId))
    .slice(0, max)
    .map(({ p, sameUi, itemsDiff }) => ({ runId: p.runId, taskId: p.taskId, size: p.size, hours: p.hours, sameUi, itemsDiff }));
}

/** The references as the estimator reads them: one line per task that has any. */
export function referencesText(refs: Map<string, TaskReference[]>): string {
  return [...refs].filter(([, rs]) => rs.length).map(([id, rs]) => `- ${id}: ${rs.map((r) => `${r.size} (${r.hours.min}-${r.hours.max} h; ${r.sameUi ? "same UI level" : "different UI level"}; ${r.itemsDiff === 0 ? "same item count" : `${r.itemsDiff} item(s) apart`})`).join(", ")}`).join("\n");
}
