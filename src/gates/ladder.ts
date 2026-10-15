// One failure ladder (gate-engine §2.6). Checked in order; the first match wins.
export type FailureCategory = "safety" | "locked-test" | "rate-limit" | "other";

export interface AttemptRecord {
  category: FailureCategory;
  signature: string;          // normalised failure signature
  diffSha?: string;           // hash of the attempt's diff; same as previous = no change
  rung: number;               // rung this attempt ran at
  lockedFailedIds?: string[]; // locked tests that failed on this attempt
  /** a narrow failure the retry puts right in place (weak tests after the tests failed as they should): it does not use up its rung */
  holdRung?: boolean;
}

export type Rung = "retry" | "raise-effort" | "stronger-model" | "other-vendor";
export const RUNGS: Rung[] = ["retry", "raise-effort", "stronger-model", "other-vendor"];

export type LadderAction =
  | { action: "retry"; rung: number; reason: string }
  | { action: "a5-check"; testIds: string[]; reason: string }
  | { action: "backoff"; waitMs: number; reason: string }
  | { action: "park"; reason: string };

export interface LadderOptions {
  maxAttempts: number;              // 6
  attemptsPerRung: number;          // 2
  availableRungs: Set<Rung>;        // e.g. no other-vendor under localOnly
  backoffSpentMs: number;
  backoffCapMs: number;             // 15 min
  a5Done: Set<string>;              // locked tests already judged "code wrong"
  /** stronger-model rungs in a row: a design tier ladder has one per tier above its start; default 1 */
  modelSteps?: number;
}

export const DEFAULT_LADDER: Omit<LadderOptions, "availableRungs" | "backoffSpentMs" | "a5Done"> = {
  maxAttempts: 6, attemptsPerRung: 2, backoffCapMs: 15 * 60_000,
};

/** What rung `n` is: 0 retry, 1 raise effort, then `modelSteps` stronger-model rungs, then other vendor; past that, none. */
export function rungKind(n: number, modelSteps = 1): Rung | undefined {
  if (n < 2) return RUNGS[n];
  if (n < 2 + modelSteps) return "stronger-model";
  return n === 2 + modelSteps ? "other-vendor" : undefined;
}

function nextAvailable(from: number, avail: Set<Rung>, modelSteps = 1): number | undefined {
  for (let r = from; rungKind(r, modelSteps); r++) if (avail.has(rungKind(r, modelSteps)!)) return r;
  return undefined;
}

/** Which rule of the ladder decided, in the order they are checked. */
export type LadderRule = "rate-limit" | "attempts-used" | "safety" | "same-locked-test" | "same-error" | "same-failure" | "rung-used" | "retry";

/** What the ladder looked at when it decided, for the ledger: a retry that cannot be explained cannot be fixed. */
export interface LadderFacts {
  rule: LadderRule;
  /** attempts that count (a rate limit does not), this one included, and the most allowed */
  attempts: number; maxAttempts: number;
  /** the rung this attempt ran at, how many attempts ran there, and how many a rung gets */
  rung: number; rungKind?: Rung; attemptsAtRung: number; attemptsPerRung: number;
  /** the failure is the same as the attempt before; the change is the same as the attempt before */
  sameSignature: boolean; sameDiff: boolean;
  /** the rungs this step has (a project with one model has no stronger one), and those above this one */
  rungsAvailable: Rung[]; rungsLeft: number;
  /** the rung the next attempt runs at, when there is one */
  nextRung?: number; nextRungKind?: Rung;
}

/** The facts behind nextOnFailure's decision on the same inputs. */
export function ladderFacts(history: AttemptRecord[], o: LadderOptions): LadderFacts {
  const last = history[history.length - 1]!, prev = history[history.length - 2];
  const counted = history.filter((h) => h.category !== "rate-limit");
  const action = nextOnFailure(history, o);
  const sameSignature = !!prev && prev.signature === last.signature, sameDiff = !!prev && !!last.diffSha && prev.diffSha === last.diffSha;
  const attemptsAtRung = counted.filter((h) => h.rung === last.rung && !h.holdRung).length;
  const rule: LadderRule = last.category === "rate-limit" ? "rate-limit"
    : counted.length >= o.maxAttempts ? "attempts-used"
    : last.category === "safety" ? "safety"
    : action.action === "a5-check" ? "same-locked-test"
    : sameSignature && last.signature.startsWith("exception:") ? "same-error"
    : sameSignature || sameDiff ? "same-failure"
    : attemptsAtRung >= o.attemptsPerRung ? "rung-used" : "retry";
  let rungsLeft = 0;
  for (let r = last.rung + 1; rungKind(r, o.modelSteps); r++) if (o.availableRungs.has(rungKind(r, o.modelSteps)!)) rungsLeft++;
  return {
    rule, attempts: counted.length, maxAttempts: o.maxAttempts, rung: last.rung, rungKind: rungKind(last.rung, o.modelSteps), attemptsAtRung, attemptsPerRung: o.attemptsPerRung,
    sameSignature, sameDiff, rungsAvailable: RUNGS.filter((r) => o.availableRungs.has(r)), rungsLeft,
    ...(action.action === "retry" ? { nextRung: action.rung, nextRungKind: rungKind(action.rung, o.modelSteps) } : {}),
  };
}

/** Decide what to do after the latest failed attempt. `history` is oldest first and counted attempts only. */
export function nextOnFailure(history: AttemptRecord[], o: LadderOptions): LadderAction {
  const last = history[history.length - 1];
  if (!last) throw new Error("nextOnFailure needs at least one attempt");
  const prev = history[history.length - 2];

  // 3. rate limit / outage: back off, not counted, then park
  if (last.category === "rate-limit") {
    if (o.backoffSpentMs >= o.backoffCapMs) return { action: "park", reason: "Model provider unavailable for 15 minutes" };
    const waitMs = Math.min(o.backoffCapMs - o.backoffSpentMs, 30_000 * 2 ** Math.min(5, history.filter((h) => h.category === "rate-limit").length - 1));
    return { action: "backoff", waitMs, reason: "Rate limit or outage" };
  }
  const counted = history.filter((h) => h.category !== "rate-limit");
  if (counted.length >= o.maxAttempts) return { action: "park", reason: `${counted.length} attempts used` };

  // 1. safety: retry once with the failure, second time park
  if (last.category === "safety") {
    const safetyCount = counted.filter((h) => h.category === "safety").length;
    if (safetyCount >= 2) return { action: "park", reason: `Safety check failed twice: ${last.signature}` };
    return { action: "retry", rung: last.rung, reason: `Safety check failed: ${last.signature}` };
  }

  // 2. the same locked test failed on 2 attempts → test-defect check (A5)
  if (last.category === "locked-test" && prev?.lockedFailedIds && last.lockedFailedIds) {
    const twice = last.lockedFailedIds.filter((id) => prev.lockedFailedIds!.includes(id) && !o.a5Done.has(id));
    if (twice.length) return { action: "a5-check", testIds: twice, reason: "The same locked test failed twice" };
  }

  // an error thrown by the factory itself (no container runtime, a failed install), the same twice: nothing a model
  // writes can change it, so a stronger one is not tried (four runs spent 14 attempts on such errors)
  if (prev && last.signature.startsWith("exception:") && prev.signature === last.signature) return { action: "park", reason: `The same error twice, so another attempt cannot change it: ${last.signature.slice("exception:".length)}` };

  // 4. anything else: climb the ladder
  const stuck = !!prev && (prev.signature === last.signature || (!!last.diffSha && prev.diffSha === last.diffSha));
  // a held attempt (run b587 attempt 5: only weak tests, so the stronger rung was not needed) leaves its rung as it was;
  // the same failure again still moves up
  const atRung = counted.filter((h) => h.rung === last.rung && !h.holdRung).length;
  const move = stuck || atRung >= o.attemptsPerRung;
  const target = nextAvailable(move ? last.rung + 1 : last.rung, o.availableRungs, o.modelSteps);
  if (target === undefined) return { action: "park", reason: "Every retry option is used up" };
  return {
    action: "retry", rung: target,
    reason: stuck ? "Same failure again; escalating" : move ? "Escalating after repeated failures" : "Retrying with the failures",
  };
}

/** A normalised failure signature: strip numbers, paths, hex and whitespace noise. */
export function failureSignature(parts: string[]): string {
  return parts
    .map((p) => p.replace(/0x[0-9a-f]+|[0-9a-f]{7,}|\d+/gi, "#").replace(/\s+/g, " ").trim())
    .sort()
    .join(" | ")
    .slice(0, 500);
}
