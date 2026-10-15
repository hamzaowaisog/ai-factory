// DEMO MODE (FACTORY_DEMO=1): relaxed gates so a run reaches a delivered product for a presentation.
// Every relaxation reads demoMode() and logs "DEMO:" in the run log. Unset FACTORY_DEMO to get the normal gates back;
// to remove the mode for good, delete this file and every `demoMode()` branch (grep DEMO).

/** Demo mode is on for this process. */
export function demoMode(): boolean {
  return process.env.FACTORY_DEMO === "1";
}

/** Attempts a step gets in demo mode, at most (the normal budget is policy.retryBudget, 6): the first and one retry. */
export const DEMO_RETRY_BUDGET = 2;

/**
 * From this attempt on, a demo step accepts what it has instead of retrying: failed locked tests, a weak or missing test,
 * a lint finding. Attempt 1 still gets one retry with its failures fed back (a changed input). FACTORY_DEMO_ACCEPT_AFTER=1
 * accepts on the first attempt (fastest, least working code).
 */
export function demoAcceptFrom(): number {
  const n = Number(process.env.FACTORY_DEMO_ACCEPT_AFTER ?? 2);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

/**
 * This step's try in demo terms: 1 + its failed attempts since it last completed. ctx.attempt counts every start, so a pause,
 * a park and resume or a plan sent back (run b587: author-tests attempts 1, 3, 4, 5) would bring acceptance on too early.
 * Parked and rate-limited attempts are not counted, as in the retry ladder.
 */
export function demoTry(ledger: { events(): { seq: number; type: string; key?: string; data?: unknown }[] }, step: string): number {
  const evs = ledger.events().filter((e) => e.key && (e.key === step || e.key.startsWith(`${step}/`)) && !e.key.slice(step.length + 1).includes("/"));
  const lastDone = Math.max(-1, ...evs.filter((e) => e.type === "step.completed").map((e) => e.seq));
  return 1 + evs.filter((e) => {
    const d = e.data as { parked?: boolean; category?: string; signature?: string } | undefined;
    // an exception before the agent ran (run 3f0f: ENOENT on a screen's HTML, twice) is not a try of the work
    return e.type === "step.failed" && e.seq > lastDone && !d?.parked && d?.category !== "rate-limit" && !d?.signature?.startsWith("exception:");
  }).length;
}
