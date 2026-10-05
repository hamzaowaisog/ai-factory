// What the repository declares about itself. These files are already protected from edits in a
// pull request (src/gates/protected.ts), so a rule drawn from them cannot be weakened to dodge the
// gate — which is exactly why they are worth mining.
import type { Convention } from "../contracts/index.js";
import { sha256 } from "../util/hash.js";

interface Declared { path: string; tool: NonNullable<Convention["check"]>["tool"]; what: string; appliesTo: string[] }

const DECLARED: Declared[] = [
  { path: ".editorconfig", tool: "roslyn", what: "the formatting and analyzer settings", appliesTo: ["**/*"] },
  { path: ".globalconfig", tool: "roslyn", what: "the analyzer severities", appliesTo: ["**/*.cs"] },
  { path: "stylecop.json", tool: "roslyn", what: "the StyleCop rules", appliesTo: ["**/*.cs"] },
  { path: ".eslintrc.json", tool: "eslint", what: "the ESLint rules", appliesTo: ["**/*.{ts,tsx,js,jsx}"] },
  { path: ".eslintrc.cjs", tool: "eslint", what: "the ESLint rules", appliesTo: ["**/*.{ts,tsx,js,jsx}"] },
  { path: "eslint.config.js", tool: "eslint", what: "the ESLint rules", appliesTo: ["**/*.{ts,tsx,js,jsx}"] },
  { path: ".prettierrc", tool: "eslint", what: "the formatting rules", appliesTo: ["**/*"] },
];

/**
 * One rule per config file the repo actually has. `confirmed` with evidence 1/1 because the repo
 * declaring it IS the evidence — every file is subject to it, and there is nothing to count.
 *
 * The `check` names the analyzer that enforces it, not a pattern: the analyzer's own findings reach
 * the gate through `LintRun`, so `conventions.followed` never tries to evaluate these itself.
 */
export function fromToolConfig(has: (path: string) => boolean): Convention[] {
  return DECLARED.filter((d) => has(d.path)).map((d) => ({
    id: `CV-${sha256(Buffer.from(`tool|${d.path}`)).slice(0, 8)}`,
    appliesTo: d.appliesTo,
    rule: `Follow ${d.what} this repository declares in ${d.path}`,
    exemplar: d.path,
    evidence: { matching: 1, total: 1, recentMatching: 1, recentTotal: 1 },
    status: "confirmed" as const,
    check: { tool: d.tool, ref: d.path },
    source: "tool-config" as const,
  }));
}
