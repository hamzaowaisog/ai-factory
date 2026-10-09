// The sign-off of the criteria only a person can check (level "manual": a screen, a look, anything with no locked test).
// The run stops on a card before delivery; a person tries each one on the reviewed commit and records whether it holds,
// with their name. The card is bound to the commit and the criteria, so a different commit needs a new sign-off.
import type { Requirement } from "../contracts/index.js";
import type { Ledger } from "../ledger/ledger.js";
import type { Decision, RunState } from "../ledger/state.js";

export const MANUAL_CARD = "manual-check";
export const SIGN_OFF = "sign-off";

export interface ManualCriterion { id: string; req: string; given: string; when: string; then: string }
export interface ManualCheck { result: "pass" | "fail"; note: string }
export interface ManualBundle { kind: typeof MANUAL_CARD; commit: string; criteria: ManualCriterion[] }
export interface ManualSignOff { by: string; checks: Record<string, ManualCheck> }

export function manualCriteria(requirements: Requirement[]): ManualCriterion[] {
  return requirements.flatMap((r) => r.acceptance.filter((a) => a.level === "manual").map((a) => ({ id: a.id, req: r.id, given: a.given, when: a.when, then: a.then })));
}

/** What a person sent, checked against the card: every criterion on it answered, nothing else, and a note for each one that fails. */
export function readChecks(raw: unknown, criteria: { id: string }[]): { checks: Record<string, ManualCheck> } | { error: string } {
  const sent = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const known = new Set(criteria.map((c) => c.id));
  const stray = Object.keys(sent).filter((id) => !known.has(id));
  if (stray.length) return { error: `${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} not on this card.` };
  const checks: Record<string, ManualCheck> = {};
  for (const c of criteria) {
    const v = sent[c.id] as { result?: unknown; note?: unknown } | undefined;
    const result = v?.result === "pass" || v?.result === "fail" ? v.result : undefined;
    if (!result) return { error: `Say whether ${c.id} passes or fails: every criterion on the card needs an answer.` };
    const note = typeof v?.note === "string" ? v.note.trim() : "";
    if (note.length > 1000) return { error: `The note for ${c.id} is too long (1000 characters at most).` };
    if (result === "fail" && !note) return { error: `Say what went wrong with ${c.id}: a failed check needs a note.` };
    checks[c.id] = { result, note };
  }
  return { checks };
}

export function manualBundle(commit: string, criteria: ManualCriterion[]): ManualBundle {
  return { kind: MANUAL_CARD, commit, criteria };
}

export function manualCard(runId: string, hash: string, b: ManualBundle): string {
  const h8 = hash.slice(0, 8);
  return [
    `# Check by hand before delivery (${b.criteria.length} ${b.criteria.length === 1 ? "criterion" : "criteria"})`, ``,
    `Run ${runId} passed its automated tests and its review. ${b.criteria.length === 1 ? "This criterion has" : "These criteria have"} no automated test, so a person tries ${b.criteria.length === 1 ? "it" : "each one"} on commit ${b.commit.slice(0, 10)} and records the result.`, ``,
    ...b.criteria.flatMap((c) => [`## ${c.id} (${c.req})`, `- Given ${c.given}`, `- When ${c.when}`, `- Then ${c.then}`, ``]),
    `Your name is recorded with each result. The sign-off covers this commit only; a different one needs a new sign-off.`,
    `On the run page: the Tests tab. Or in your terminal:`,
    `  factory sign-off ${runId} ${h8} --pass ${b.criteria.map((c) => c.id).join(",")}`,
    `  factory sign-off ${runId} ${h8} --fail ${b.criteria[0]!.id} --note "what went wrong"${b.criteria.length > 1 ? ` --pass ${b.criteria.slice(1).map((c) => c.id).join(",")}` : ""}`,
    `A failed check parks the run: nothing is delivered until the code changes or the run is stopped.`, ``,
    `Card hash: ${h8}`,
  ].join("\n");
}

/** The sign-off a person gave for this card, if any. */
export function signOffFor(decisions: Decision[], bundleSha: string): ManualSignOff | undefined {
  const d = decisions.find((x) => x.artifactSha === bundleSha && x.decision === SIGN_OFF) as (Decision & { checks?: Record<string, ManualCheck> }) | undefined;
  return d ? { by: d.by, checks: d.checks ?? {} } : undefined;
}

/** The newest sign-off of a run and the card it answered, for the Tests tab and the pull request text. */
export function lastSignOff(state: Pick<RunState, "decisions">, ledger: Pick<Ledger, "getJson">): (ManualSignOff & { commit: string; criteria: ManualCriterion[] }) | undefined {
  const d = [...state.decisions].reverse().find((x) => x.decision === SIGN_OFF) as (Decision & { checks?: Record<string, ManualCheck> }) | undefined;
  if (!d) return undefined;
  try {
    const b = ledger.getJson<ManualBundle>(d.artifactSha);
    return { by: d.by, checks: d.checks ?? {}, commit: b.commit, criteria: b.criteria };
  } catch { return undefined; }
}
