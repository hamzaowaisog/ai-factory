// A third party's assertion about a commit, recorded VERBATIM so a replay re-evaluates the stored
// payload rather than asking GitHub again. This is the only gate input the factory did not produce
// itself in a sealed container, so it is modelled explicitly as such.
import { z } from "zod";
import { GitSha } from "./common.js";

/** The factory's own check, reported under this one name on both the PR and the merge queue ref. */
export const OWN_CHECK_NAME = "factory/merge-gate";

export const ExternalChecks = z.object({
  /** The commit the checks ran against. A green result from another commit proves nothing. */
  headSha: GitSha,
  required: z.array(z.string()),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(["queued", "in_progress", "completed"]),
    conclusion: z.enum(["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"]).optional(),
    detailsUrl: z.string().optional(),
    completedAt: z.string().optional(),
  })),
});
export type ExternalChecks = z.infer<typeof ExternalChecks>;
