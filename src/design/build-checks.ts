// The build's two design checks over a real commit range (docs/design-step.md, "Wiring"): the fidelity lint
// for a task's diff, and the size cap for the whole change against the approved design. Both read git
// directly, so the build steps only call these and store the results for the gates.
import { diffFromGit, lintDiff, type CheckResult } from "./fidelity.js";
import { detectLayout } from "./layout.js";
import { buildInventory, type InventoryOptions } from "./inventory.js";
import { isUiPath, maxLevel, sizeFromGit, type Level, type SizeResult } from "./size.js";
import type { ProjectConfig } from "../config/project.js";
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
export function fidelityLint(repo: string, base: string, head: string, opts: InventoryOptions = {}): CheckResult[] {
  if (!touchesUiFiles(repo, base, head)) return [{ check: "lint", status: "PASS", detail: "no UI files changed, nothing to check" }];
  return lintDiff(buildInventory(gitSource(repo, base), opts), diffFromGit(repo, base, head));
}

/** The size of the UI change in the range. */
export function actualSize(repo: string, base: string, head: string, o: InventoryOptions & { navRaises?: boolean } = {}): SizeResult {
  const { navRaises, ...layoutOverrides } = o;
  return sizeFromGit(repo, base, head, { navRaises: !!navRaises, layout: detectLayout(gitSource(repo, head), layoutOverrides) });
}

/** The project's `design:` block as the options the toolkit takes (an unset field stays detected). */
export function designOptions(design: ProjectConfig["design"]): InventoryOptions & { navRaises: boolean } {
  return {
    ...(design?.sourceRoot !== undefined ? { sourceRoot: design.sourceRoot } : {}),
    ...(design?.uiDir ? { uiDir: design.uiDir } : {}),
    navRaises: !!design?.navRaises,
  };
}

/** A repo with a React or Next.js front end: some package.json lists react or next. */
export function hasReactApp(files: string[], read: (p: string) => string | undefined): boolean {
  return files.some((f) => /(^|\/)package\.json$/.test(f) && /"(react|next)"\s*:/.test(read(f) ?? ""));
}
