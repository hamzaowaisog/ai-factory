// The build's two design checks over a real commit range (docs/design-step.md, "Wiring"): the fidelity lint
// for a task's diff, and the size cap for the whole change against the approved design. Both read git
// directly, so the build steps only call these and store the results for the gates.
import { diffFromGit, lintDiff, type CheckResult } from "./fidelity.js";
import { detectLayout } from "./layout.js";
import { buildInventory, type InventoryOptions } from "./inventory.js";
import { cssTokensChanged, isUiPath, maxLevel, rank, sizeFromGit, type Level, type SizeResult } from "./size.js";
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

/**
 * Theme tokens a task changed in a stylesheet, when the approved design is smaller than a design-system change: the look was
 * approved with its theme, so a task builds with the theme's tokens and adds or changes none (run 3f0f: a task put tokens in
 * app/globals.css and the whole run parked at integrate). Undefined when the design allows it or no stylesheet changed.
 */
export function themeTokenLint(repo: string, base: string, head: string, approved: Level): CheckResult | undefined {
  if (rank(approved) >= rank("design-system")) return undefined;
  const sheets = gitSync(repo, ["diff", "--name-only", "--no-ext-diff", base, head]).split("\n").filter((p) => /\.(css|scss|pcss)$/.test(p));
  const at = (ref: string, p: string) => { try { return gitSync(repo, ["show", `${ref}:${p}`]); } catch { return undefined; } };
  const changed = sheets.filter((p) => cssTokensChanged(at(base, p), at(head, p)));
  if (!sheets.length) return undefined;
  return changed.length
    ? { check: "theme-tokens", status: "FAIL", detail: `theme tokens changed, but the approved design is a ${approved === "none" ? "change with no new look" : approved}: use the approved theme's tokens and put the stylesheet's tokens back as they were`, items: changed }
    : { check: "theme-tokens", status: "PASS", detail: "no theme token changed" };
}

/** A text colour made see-through (text-muted-foreground/70): it reads lighter than the theme's colour, whose contrast was checked. */
const FADED_TEXT = /(?<![\w:-])text-[a-z][\w-]*\/(?:\d{1,2}|\[0?\.\d+\])(?![\w/])/g;

/**
 * A screen page a task built from its approved Stitch screen, against that screen (run 3f0f review: the "Mark delivered" and
 * "Open delivery" buttons were missing, the IDs lost their monospace font, and text was 3.9 to 4.49:1 against its background):
 * - labels: every button the approved screen shows is somewhere in the app's source at `head`;
 * - fonts: a screen that sets text in monospace (its IDs, codes) still does in the task's change;
 * - contrast: no text colour the change adds is made see-through, below the theme's checked contrast.
 */
export function screenLint(repo: string, base: string, head: string, screen: { id: string; buttons: string[]; mono: boolean }): CheckResult[] {
  const has = (text: string, files: string[]) => { try { gitSync(repo, ["grep", "-q", "-F", "-i", "-e", text, head, "--", ...files]); return true; } catch { return false; } };
  const source = ["*.tsx", "*.jsx", "*.ts", "*.js", "*.json"];
  const missing = [...new Set(screen.buttons.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean))].filter((b) => !has(b, source));
  const changed = gitSync(repo, ["diff", "--name-only", "--no-ext-diff", base, head]).split("\n").filter((p) => /\.(tsx|jsx|css)$/.test(p));
  const added = changed.length ? gitSync(repo, ["diff", "-U0", "--no-ext-diff", base, head, "--", ...changed]).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")) : [];
  const faded = [...new Set(added.flatMap((l) => l.match(FADED_TEXT) ?? []))];
  const monoKept = !screen.mono || !changed.length || has("font-mono", changed) || has("monospace", changed);
  return [
    missing.length
      ? { check: "design labels", status: "FAIL", detail: `${screen.id}'s approved buttons are not in the page: give each one its approved words exactly`, items: missing }
      : { check: "design labels", status: "PASS", detail: `${screen.id}'s ${screen.buttons.length} approved button label(s) are all in the source` },
    monoKept
      ? { check: "design fonts", status: "PASS", detail: screen.mono ? "the monospace text the design shows is kept" : "the design sets no monospace text" }
      : { check: "design fonts", status: "FAIL", detail: `${screen.id}'s approved screen sets its IDs and codes in monospace (font-mono); the page sets none` },
    faded.length
      ? { check: "design contrast", status: "FAIL", detail: "a see-through text colour reads below 4.5:1 against its background: use the theme's text colours as they are (text-muted-foreground, not text-muted-foreground/70)", items: faded }
      : { check: "design contrast", status: "PASS", detail: "no see-through text colour added" },
  ];
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
