// The spec problems a question can settle (src/stages/settle.ts) and which of them are settled, for gate E1 and the specify
// step. Pure: no model, no ledger writes.
import type { SettledProblem } from "../contracts/index.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";

export type ProblemKind = SettledProblem["kind"];
export interface Problem { kind: ProblemKind; text: string; reqId?: string }

/** What a spec's checks report, as stored on the spec or fresh from the check (lint then also says whether it blocks). */
export interface Found {
  lint: { check: string; passed: boolean; details: string; blocking?: boolean }[];
  critic: { finding: string; reqId?: string; severity: string }[];
  roundTrip: { inventedCapabilities: string[] };
  settled?: SettledProblem[];
}

/**
 * Whether a run settles its spec problems and failing design checks by questions and reads a large request per module, as an
 * estimate does: estimate and design runs always; a build (brownfield, greenfield) when it began so (`info.asks`, set at the start:
 * every greenfield run, a brownfield run when its project turns `brownfield.questions` on). A build started before builds asked
 * has no `asks` and goes on as it began. A run whose spec is seeded from another run has no specify step.
 */
export const settles = (info: Pick<RunState["info"], "mode" | "asks">): boolean => info.mode === "estimate" || info.mode === "design" || info.asks === true;

/** Problems compared loosely (case, spacing, trailing punctuation), with their kind. */
const keyOf = (kind: ProblemKind, text: string) => `${kind}:${text.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,\s]+$/, "").trim()}`;
export const lintText = (l: { check: string; details: string }) => `${l.check}: ${l.details}`;

export function isSettled(settled: SettledProblem[] | undefined, kind: ProblemKind, text: string): boolean {
  const k = keyOf(kind, text);
  return !!settled?.some((s) => keyOf(s.kind, s.problem) === k);
}

/**
 * What gate E1 refuses that a question can settle, less what is settled already: a lint check that does not block the spec
 * (a blocking one fails the specify step itself), a critical or high critic finding, and a capability the request did not ask
 * for. A dropped span is not here: the repairs add it, and E1 still refuses a spec that drops one.
 */
export function openProblems(f: Found, settled: SettledProblem[] = f.settled ?? []): Problem[] {
  const all: Problem[] = [
    ...f.lint.filter((l) => !l.passed && l.blocking !== true).map((l) => ({ kind: "lint" as const, text: lintText(l) })),
    ...f.critic.filter((c) => c.severity === "critical" || c.severity === "high").map((c) => ({ kind: "critic" as const, text: c.finding, ...(c.reqId ? { reqId: c.reqId } : {}) })),
    ...f.roundTrip.inventedCapabilities.map((t) => ({ kind: "invented" as const, text: t })),
  ];
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = keyOf(p.kind, p.text);
    if (seen.has(k) || isSettled(settled, p.kind, p.text)) return false;
    seen.add(k);
    return true;
  });
}

/** A spec written before problems were settled by questions, with problems E1 would refuse. */
export const unsettled = (spec: Found | undefined): boolean => !!spec && !spec.settled && openProblems(spec).length > 0;

/**
 * Whether gate E1 has refused a spec that was written before problems were settled by questions: the specify step then
 * runs again to settle them (a run that parked at breakdown before this existed goes on from its spec on resume). Stays
 * true once it is, so the specify step's inputs do not change again after it has settled them.
 */
export function specRefused(state: Pick<RunState, "gates">, ledger: Pick<Ledger, "events" | "getJson">): boolean {
  if (!state.gates.some((g) => g.gateId === "estimate.e1-readiness" && !g.passed)) return false;
  return ledger.events().some((e) => {
    const d = e.data as { gateId?: string; passed?: boolean; inputs?: { spec?: string } } | undefined;
    return e.type === "gate.result" && d?.gateId === "estimate.e1-readiness" && d.passed === false && !!d.inputs?.spec
      && unsettled(ledger.getJson<Found>(d.inputs.spec));
  });
}
