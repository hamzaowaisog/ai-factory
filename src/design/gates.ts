// Design gates, in the style of src/gates/predicates.ts: pure predicates over ledger artifacts.
// The producers (the size classifier over the real diff, the fidelity lint) run in the core and
// store their results; these only read them.
import { defineGate, failure, verdict } from "../gates/engine.js";
import type { CheckResult } from "./fidelity.js";
import { LEVEL_TITLE, type FidelityLevel, type FidelityReport } from "./fidelity-app.js";
import { LEVEL_NAMES, rank, type Level, type SizeResult } from "./size.js";

/** Size-cap check: the finished diff may not be a bigger UI change than the one approved. */
export function sizeCapVerdict(actual: Pick<SizeResult, "level" | "reasons">, approved: { level: Level }) {
  if (rank(actual.level) <= rank(approved.level)) {
    return { passed: true, details: `UI change is a ${LEVEL_NAMES[actual.level]}, within the approved ${LEVEL_NAMES[approved.level]}` };
  }
  const over = actual.reasons.filter((r) => r.startsWith(LEVEL_NAMES[actual.level]));
  return {
    passed: false,
    details: `UI change is a ${LEVEL_NAMES[actual.level]}, bigger than the approved ${LEVEL_NAMES[approved.level]}`,
    failures: [failure("design-size-cap", `The change is a ${LEVEL_NAMES[actual.level]}, but a ${LEVEL_NAMES[approved.level]} was approved`),
      ...over.slice(0, 10).map((r) => failure("design-size-cap", r))],
  };
}

export const designSizeCap = defineGate<{ actual: SizeResult; approved: { level: Level } }>({
  id: "design.size-cap", after: "integrate", safety: false, waiver: "human",
  predicate: ({ actual, approved }) => sizeCapVerdict(actual, approved),
});

/** Fidelity lint: FAIL fails; a check that couldn't run fails too (a gate never passes on nothing). */
export const designFidelityLint = defineGate<{ lint: CheckResult[] }>({
  id: "design.fidelity-lint", after: "implement", safety: false, waiver: "human",
  predicate: ({ lint }) => verdict(
    lint.filter((r) => r.status === "FAIL" || r.status === "UNCHECKED")
      .map((r) => failure("design-fidelity", `${r.check}: ${r.status === "UNCHECKED" ? "could not check: " : ""}${r.detail}`)),
    lint.map((r) => `${r.check} ${r.status}`).join("; ") || "nothing to check",
  ),
});

/**
 * Fidelity gates (docs/estimates-design.md, "Fidelity and tests"): the built app against the approved design, one gate per blocking
 * level (tokens, structure, accessibility). A level that failed or could not be checked fails its gate with its findings; each is
 * waivable by a person on the waiver card. Layout and pixels are advice and have no gate.
 */
function fidelityGate(level: FidelityLevel) {
  return defineGate<{ fidelity: FidelityReport }>({
    id: `design.${level}`, after: "accept", safety: false, waiver: "human",
    predicate: ({ fidelity }) => {
      const l = fidelity.levels.find((x) => x.level === level);
      if (!l) return verdict([failure(`design-${level}`, `${LEVEL_TITLE[level]}: not checked${fidelity.skipped ? ` (${fidelity.skipped})` : ""}`)], "not checked");
      if (l.status === "PASS") return verdict([], `${LEVEL_TITLE[level]} PASS: ${l.detail}`);
      // a level the check does not hold the build to (the tokens of an app that keeps its own look) passes with its reason
      if (!l.blocking && l.status === "UNCHECKED") return verdict([], `${LEVEL_TITLE[level]} not compared: ${l.detail}`);
      const found = fidelity.findings.filter((f) => f.level === level);
      const items = found.length ? found.slice(0, 20).map((f) => `${f.message}${f.pages.length ? ` (${f.pages.slice(0, 3).join(", ")}${f.pages.length > 3 ? `, +${f.pages.length - 3}` : ""})` : ""}`) : [l.detail];
      return verdict(items.map((m) => failure(`design-${level}`, `${l.status === "UNCHECKED" ? "could not check: " : ""}${m}`)), `${LEVEL_TITLE[level]} ${l.status}`);
    },
  });
}
export const designTokensGate = fidelityGate("tokens");
export const designStructureGate = fidelityGate("structure");
export const designA11yGate = fidelityGate("a11y");
export const FIDELITY_GATES = [designTokensGate, designStructureGate, designA11yGate];
