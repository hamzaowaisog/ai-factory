// Repair lives on path A only. Pushing to a branch already in the merge queue EJECTS it, so a
// repair during in-queue verification would destroy the very thing it was verifying — and do it to
// a queue entry other speculated entries are stacked on top of.

/** "Try your best" inside a budget of two: attempt 1 retries, attempt 2 climbs a rung, then park. */
export const REPAIR_LADDER = { maxAttempts: 2, attemptsPerRung: 1 } as const;

/** Guard 3's ceiling. Two runs each spending their two attempts is already four pushes. */
export const MAX_ATTEMPTS_PER_PR = 6;
/** Guard 4: a burst of pushes collapses into one run. */
export const COOLDOWN_MS = 5 * 60 * 1000;

export interface RepairBudget {
  path: "A" | "B";
  attemptsThisRun: number;
  attemptsThisPr: number;
  lastRunAt?: number;
  now: number;
}

export function mayRepair(a: RepairBudget): { ok: true } | { ok: false; why: string } {
  if (a.path === "B") {
    return { ok: false, why: "Path B never pushes: a push to a branch in the merge queue ejects it. The next path A run repairs this." };
  }
  if (a.attemptsThisRun >= REPAIR_LADDER.maxAttempts) {
    return { ok: false, why: `Already used ${REPAIR_LADDER.maxAttempts} repair attempts in this run. Parking for a person.` };
  }
  if (a.attemptsThisPr >= MAX_ATTEMPTS_PER_PR) {
    return { ok: false, why: `Already used ${a.attemptsThisPr} repair attempts on this pull request across all runs. Parking for a person.` };
  }
  if (a.lastRunAt !== undefined && a.now - a.lastRunAt < COOLDOWN_MS) {
    return { ok: false, why: `Cooldown: the last reverify of this pull request was ${Math.round((a.now - a.lastRunAt) / 1000)}s ago, under the ${COOLDOWN_MS / 1000}s minimum.` };
  }
  return { ok: true };
}

export interface RepairPlan {
  action: "merge-base-into-branch" | "implement-loop";
  thenFullVerification: boolean;
  testsLocked: boolean;
  after: string[];
}

/** What to do after any repair, in order. `checks.external-green` is last for a reason: a repair
 * push restarts every external check, so a verdict gathered earlier is stale. */
const AFTER = [
  "rerun-gates-whose-inputs-changed",
  "rebind-sha-binding",
  "update-evidence-manifest",
  "mark-repair-commit",
  "evaluate-external-checks",
];

export function repairPlan(cls: "conflict" | "broken-merge"): RepairPlan {
  return cls === "conflict"
    // the merged result goes through the FULL merge-result verification: resolving a conflict is
    // frequently a semantic decision, not a textual one, so it earns no shortcuts
    ? { action: "merge-base-into-branch", thenFullVerification: true, testsLocked: true, after: [...AFTER] }
    // the implement loop is built for exactly this, and the tests are already locked, so the loop
    // cannot weaken them to pass
    : { action: "implement-loop", thenFullVerification: true, testsLocked: true, after: [...AFTER] };
}
