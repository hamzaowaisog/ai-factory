// review.covers-every-criterion: the reviewer accounted for every acceptance criterion.
import type { Requirement, ReviewCoverage } from "../contracts/index.js";
import { defineGate, failure, verdict } from "./engine.js";

/**
 * Asking a model to go through each acceptance criterion and trusting that it did is how criteria
 * get silently skipped: the report comes back shorter than the spec and nothing notices. The schema
 * makes the reviewer report one verdict per criterion; this gate checks the SET is exactly right —
 * nothing missing, nothing invented.
 *
 * It judges completeness only. What each verdict SAYS is `review-2.no-blocking`'s business: a
 * "weak" verdict is a finding to act on, not a hole in the report.
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
