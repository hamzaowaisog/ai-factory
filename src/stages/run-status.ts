// What a run's status means right now (`factory status`, the runs page, MCP). The ledger says "running" from a step's start
// until the executor writes how the run ended; when the executor process is gone (a crash, a closed terminal, a killed
// machine) nothing writes that, so a run whose executor no longer holds its lock is shown as interrupted, with the way on.
import { executorHolds } from "../ledger/exec-lock.js";
import { statusLabel, type RunState } from "../ledger/state.js";
import { stepsFor } from "./modes.js";

export const INTERRUPTED = "interrupted";

/** The status to show: the ledger's, except a "running" run with no executor, which is finished (every step done) or interrupted. */
export function shownStatus(s: RunState, held: (key: string, runId: string) => boolean = executorHolds): string {
  if (s.status !== "running" && s.status !== "created") return statusLabel(s.status);
  if (held(s.info.repoId ?? `run:${s.info.runId}`, s.info.runId)) return statusLabel(s.status);
  // a run that finished before runs recorded it (no run.finished event): every step is done
  try {
    const keys = stepsFor(s).map((x) => x.key);
    if (keys.length && keys.every((k) => s.steps.get(k)?.status === "completed")) return "finished";
  } catch { /* a mode with no step list: say interrupted */ }
  return s.status === "created" ? "created" : INTERRUPTED;
}

/** One line on what to do about a shown status, when there is something to do. */
export function statusHint(shown: string, runId: string): string | undefined {
  return shown === INTERRUPTED ? `the executor stopped mid-run; continue with: factory resume ${runId}` : undefined;
}
