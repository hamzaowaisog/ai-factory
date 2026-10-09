// review.covers-every-criterion: the reviewer accounted for every acceptance criterion.
// review.tests-prove-criteria: and what it said about each locked test counts.
import type { Requirement, ReviewCoverage } from "../contracts/index.js";
import { defineGate, failure, verdict } from "./engine.js";

/**
 * Asking a model to go through each acceptance criterion and trusting that it did is how criteria
 * get silently skipped: the report comes back shorter than the spec and nothing notices. The schema
 * makes the reviewer report one verdict per criterion; this gate checks the SET is exactly right —
 * nothing missing, nothing invented.
 *
 * It judges completeness only. What each verdict SAYS is `review.tests-prove-criteria`'s business:
 * a "weak" verdict is a finding to act on, not a hole in the report.
 */
export const reviewCoversCriteria = defineGate<{
  review: { coverage: ReviewCoverage[] };
  spec: { requirements: Requirement[] };
}>({
  id: "review.covers-every-criterion", after: "review", safety: true, waiver: "none",
  predicate: ({ review, spec }) => {
    const wanted = new Set(spec.requirements.flatMap((r) => r.acceptance.map((a) => a.id)));
    const got = new Set(review.coverage.map((c) => c.acId));
    const fs = [
      ...[...wanted].filter((id) => !got.has(id)).sort()
        .map((id) => failure("coverage", `The review reported no verdict for acceptance criterion ${id}`)),
      ...[...got].filter((id) => !wanted.has(id)).sort()
        .map((id) => failure("coverage", `The review reported a verdict for ${id}, which is not a criterion in the spec`)),
    ];
    // a Set counts a duplicated acId once, so two verdicts for one criterion cannot cover another
    return verdict(fs, `${got.size} of ${wanted.size} acceptance criteria accounted for`);
  },
});

/** The criteria the reviewer said are not proven by a locked test. A manual criterion has no test by design: a person signs it off. */
export function unprovenCriteria(coverage: ReviewCoverage[], requirements: Requirement[]): { acId: string; verdict: "weak" | "no-test"; testId: string; why: string }[] {
  const manual = new Set(requirements.flatMap((r) => r.acceptance.filter((a) => a.level === "manual").map((a) => a.id)));
  const seen = new Set<string>();
  return coverage.flatMap((c) => {
    if (c.verdict === "proves-it" || manual.has(c.acId) || seen.has(c.acId)) return [];
    seen.add(c.acId);
    return [{ acId: c.acId, verdict: c.verdict, testId: c.testId, why: c.why }];
  });
}

/**
 * A locked test that runs and passes can still assert nothing the criterion asks for, and the model that wrote the code
 * wrote that test. The reviewer reads each test and reports a verdict; until this gate, nothing read the verdict.
 *
 * Waivable, and not a safety gate: the verdict is a model's judgement, and the tests are locked, so no retry can change
 * them. A person reads the reason and either accepts the test as it stands, with their name, or stops the run.
 */
export const testsProveCriteria = defineGate<{
  review: { coverage: ReviewCoverage[] };
  spec: { requirements: Requirement[] };
}>({
  id: "review.tests-prove-criteria", after: "review", safety: false, waiver: "human",
  predicate: ({ review, spec }) => {
    const bad = unprovenCriteria(review.coverage, spec.requirements);
    const automated = spec.requirements.flatMap((r) => r.acceptance).filter((a) => a.level !== "manual").length;
    return verdict(
      bad.map((b) => failure("test-proof", b.verdict === "weak"
        ? `${b.acId}: its locked test${b.testId ? ` ${b.testId}` : ""} passes but does not prove the criterion (${b.why})`
        : `${b.acId}: no locked test covers it (${b.why})`)),
      `${automated} automated ${automated === 1 ? "criterion is" : "criteria are"} each proven by a locked test`);
  },
});
