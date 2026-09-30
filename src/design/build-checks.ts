// The build's two design checks over a real commit range (docs/design-step.md, "Wiring"): the fidelity lint
// for a task's diff, and the size cap for the whole change against the approved design. Both read git
// directly, so the build steps only call these and store the results for the gates.
import { diffFromGit, lintDiff, type CheckResult } from "./fidelity.js";
import { buildInventory } from "./inventory.js";
import { isUiPath, maxLevel, sizeFromGit, type Level, type SizeResult } from "./size.js";
import { gitSource, gitSync } from "./source.js";

const SIZE_OF: Record<string, Level> = { reuse: "tweak", tweak: "tweak", new: "new-screen", "design-system": "design-system" };

/** The biggest UI change an approved design allows: its largest screen size. A skipped design or no screens allows none. */
export function approvedLevel(design: { skipped?: boolean; screens?: { size?: string }[] } | undefined): Level {
  if (!design || design.skipped) return "none";
  return (design.screens ?? []).reduce<Level>((l, s) => maxLevel(l, SIZE_OF[s.size ?? "new"] ?? "new-screen"), "none");
}

/** Does the range change any file a person sees? Cheap, so non-UI runs never build an inventory. */
export function touchesUiFiles(repo: string, base: string, head: string): boolean {
  return gitSync(repo, ["diff", "--name-only", "-M", "--no-ext-diff", base, head]).split("\n").some((p) => p && isUiPath(p));
}

/** Token and component lint of the range, against the inventory at its base. A range with no UI files is one PASS. */
export function fidelityLint(repo: string, base: string, head: string): CheckResult[] {
  if (!touchesUiFiles(repo, base, head)) return [{ check: "lint", status: "PASS", detail: "no UI files changed, nothing to check" }];
  return lintDiff(buildInventory(gitSource(repo, base)), diffFromGit(repo, base, head));
}

/** The size of the UI change in the range. */
export const actualSize = (repo: string, base: string, head: string): SizeResult => sizeFromGit(repo, base, head);
