// Step 12: evaluate the merge gates and record every verdict in the ledger.
//
// This does NOT go through the executor, and it does not need to. What the executor would give us
// here is ledger writes, and `runGate` already does that itself: it evaluates the predicate, stores
// the result, and appends a `gate.result` event carrying everything `factory verify-evidence` needs
// to re-check the decision later. What the executor adds beyond that — the failure ladder and the
// per-step cost caps — belongs to steps that call models, not to pure predicates over stored
// artifacts. A gate cannot fail transiently and cannot cost anything.
import type { BuildRun, LintRun, ReviewFinding, Requirement, ReviewCoverage, TestRun } from "../contracts/index.js";
import type { ExternalChecks } from "../contracts/checks.js";
import type { Convention } from "../contracts/index.js";
import type { Violation } from "../conventions/check.js";
import { type GateDef, runGate } from "../gates/engine.js";
import type { Policy } from "../gates/policy.js";
import { diffSize, noSecrets, shaBinding, testExpectations } from "../gates/predicates.js";
import { reviewCoversCriteria } from "../gates/coverage.js";
import { buildClean, conventionsFollowed, externalGreen, lintNoNewFindings, review2Blocking } from "../gates/merge-gate.js";
import type { Ledger, Writer } from "../ledger/ledger.js";
import type { GateOutcome } from "./orchestrate.js";

/** Everything the merge gates judge, already computed by steps 7 and 11. */
export interface MergeEvidence {
  build: BuildRun;
  testRun: TestRun;
  baseline?: TestRun;
  lint?: LintRun;
  lintBaseline: LintRun["findings"];
  secretScan: { kind: "secrets"; commit: string; hits: unknown[] };
  diff: { files: { path: string; added: string[]; removed: string[] }[] };
  guidelines: { conventions: Convention[] } | { unapproved: string };
  violations: Violation[];
  spec: { requirements: Requirement[] };
  review2?: { findings: ReviewFinding[]; coverage: ReviewCoverage[] };
  families?: { implementer: string; reviewer: string; reviewer2: string };
  externalChecks?: ExternalChecks;
  head: { sha: string };
  pushed?: { headParent: string; manifestOnly: boolean; changed: string[] };
  gatedSha: string;
}

/**
 * The order is load-bearing and is asserted by `gateOrder`'s tests:
 *  - deterministic gates first, so a change that does not compile costs nothing further;
 *  - coverage before the review verdict, because an incomplete review is not yet a review;
 *  - `checks.external-green` LAST, because a repair push restarts every external check and a
 *    verdict gathered earlier cites a commit that is no longer the head.
 */
function planned(e: MergeEvidence): { def: GateDef; inputs: Record<string, unknown> }[] {
  const out: { def: GateDef; inputs: Record<string, unknown> }[] = [
    { def: buildClean as GateDef, inputs: { build: e.build } },
    { def: testExpectations as GateDef, inputs: { run: e.testRun, ...(e.baseline ? { baseline: e.baseline } : {}) } },
    { def: noSecrets as GateDef, inputs: { scan: e.secretScan } },
    { def: diffSize as GateDef, inputs: { diff: e.diff } },
  ];
  if (e.pushed) out.push({ def: shaBinding as GateDef, inputs: { pushed: e.pushed, gatedSha: e.gatedSha } });
  if (e.lint) {
    out.push({ def: lintNoNewFindings as GateDef, inputs: { lint: e.lint, baseline: { findings: e.lintBaseline }, diff: e.diff } });
  }
  out.push({ def: conventionsFollowed as GateDef, inputs: { guidelines: e.guidelines, violations: e.violations } });
  if (e.review2) {
    out.push({ def: reviewCoversCriteria as GateDef, inputs: { review: e.review2, spec: e.spec } });
    if (e.families) out.push({ def: review2Blocking as GateDef, inputs: { review: e.review2, families: e.families } });
  }
  // last, always
  if (e.externalChecks) out.push({ def: externalGreen as GateDef, inputs: { checks: e.externalChecks, head: e.head } });
  return out;
}

/**
 * Runs the planned gates, recording each verdict. `replay` names gates whose inputs hash is
 * unchanged since they were last decided: those are reported from the recorded verdict and their
 * predicate is not evaluated again, because the same inputs cannot give a different answer.
 */
export async function runMergeGates(
  ledger: Ledger, writer: Writer, policy: Policy,
  a: { evidence: MergeEvidence; step: string; treeSha: string; replay?: Map<string, GateOutcome> },
): Promise<GateOutcome[]> {
  const out: GateOutcome[] = [];
  for (const { def, inputs } of planned(a.evidence)) {
    const recorded = a.replay?.get(def.id);
    if (recorded) { out.push(recorded); continue; }
    // the engine loads inputs from the ledger by sha, so each one is stored first — which is also
    // what makes the decision re-checkable long afterwards
    const shas = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, ledger.putJson(v)]));
    const r = await runGate(def, ledger, writer, shas, policy, { step: a.step, treeSha: a.treeSha });
    out.push({ id: def.id, passed: r.passed, details: r.details });
  }
  return out;
}

/** The gate ids this evidence would produce, in order, without evaluating anything. */
export function plannedGateIds(e: MergeEvidence): string[] {
  return planned(e).map((p) => p.def.id);
}
