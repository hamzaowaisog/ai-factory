// Checking the one-time GitHub and Harness setup, so a misconfiguration is reported here rather
// than discovered through a stalled merge queue.
import { OWN_CHECK_NAME } from "../contracts/checks.js";

export interface MergeGateSetup {
  requiredChecks: string[];
  queueEnabled: boolean;
  delegateOnHost: boolean;
  conventionsApproved: boolean;
  /** GitHub's merge method for the base branch. A squash rewrites the gated commit. */
  mergeMethod?: "merge" | "squash" | "rebase";
}

export function mergeGateDoctor(a: MergeGateSetup): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!a.requiredChecks.includes(OWN_CHECK_NAME)) {
    problems.push(`"${OWN_CHECK_NAME}" is not a required status check on the base branch, so nothing stops a pull request merging without the gate. Add it in Settings → Branches → branch protection.`);
  }
  if (!a.queueEnabled) {
    problems.push(`The merge queue is off for the base branch, so nothing verifies the combination of pull requests about to land. Enable it in Settings → Branches → "Require merge queue".`);
  }
  if (!a.delegateOnHost) {
    problems.push(`No Harness Delegate is reachable on this host, so Harness cannot run the gate where ~/.factory and Docker are. Without it, this design does not apply.`);
  }
  if (!a.conventionsApproved) {
    problems.push(`The coding guidelines are missing or unapproved, so conventions.followed cannot check and will fail every pull request. Run \`factory conventions build\` then \`factory conventions approve\`.`);
  }
  if (a.mergeMethod && a.mergeMethod !== "merge") {
    problems.push(`The base branch merges by ${a.mergeMethod}, which rewrites the commit the factory gated — so what lands is not the commit the evidence describes. Use a merge commit, or accept that deliver.sha-binding no longer means anything.`);
  }
  return { ok: problems.length === 0, problems };
}
