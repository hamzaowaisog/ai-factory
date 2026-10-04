// Design gates, in the style of src/gates/predicates.ts: pure predicates over ledger artifacts.
// The producers (the size classifier over the real diff, the fidelity lint) run in the core and
// store their results; these only read them.
import type { z } from "zod";
import type { Approval, Breakdown, Design, PlanTask, SpecDraft } from "../contracts/index.js";
import { defineGate, failure, verdict } from "../gates/engine.js";
import { matchesAny } from "../util/glob.js";
import { screenScopeGaps, type ApprovedDesign } from "./design-link.js";
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
      // advice only (an own look's tokens, an in-place screen's structure): shown on the report, not held against the build
      if (l.status === "WARN") return verdict([], `${LEVEL_TITLE[level]} WARN: ${l.detail}`);
      const found = fidelity.findings.filter((f) => f.level === level && !f.advice);
      const items = found.length ? found.slice(0, 20).map((f) => `${f.message}${f.pages.length ? ` (${f.pages.slice(0, 3).join(", ")}${f.pages.length > 3 ? `, +${f.pages.length - 3}` : ""})` : ""}`) : [l.detail];
      return verdict(items.map((m) => failure(`design-${level}`, `${l.status === "UNCHECKED" ? "could not check: " : ""}${m}`)), `${LEVEL_TITLE[level]} ${l.status}`);
    },
  });
}
export const designTokensGate = fidelityGate("tokens");
export const designStructureGate = fidelityGate("structure");
export const designA11yGate = fidelityGate("a11y");
export const FIDELITY_GATES = [designTokensGate, designStructureGate, designA11yGate];

// ---------- the design against the estimate and the plan (moved from src/estimate/gates.ts, the PR #11 re-review, item 14) ----------

type ScreenLike = { id: string; route?: string };

export const designBaseline = defineGate<{ ui: boolean; design?: z.infer<typeof Design>; approval?: Pick<z.infer<typeof Approval>, "decision" | "by">; note?: boolean }>({
  id: "estimate.e1b-design-baseline", after: "design", safety: false, waiver: "none",
  predicate: ({ ui, design, approval, note }) => {
    if (!ui) return { passed: true, details: "no UI in this request" };
    // a small fix's text note is approved by the person who approves the estimate (E7), on the same card
    const withEstimate = note && design?.note === true;
    const fs = [];
    if (!design) fs.push(failure("e1b-design", "the request has UI but there is no design"));
    else {
      for (const s of design.screens) if (s.reqs.length === 0) fs.push(failure("e1b-screen", `screen ${s.id} links to no requirement`));
      for (const r of design.mapping.unmappedReqs) fs.push(failure("e1b-mapping", `requirement ${r} has no screen`));
      for (const s of design.mapping.orphanScreens) fs.push(failure("e1b-mapping", `screen ${s} maps to no requirement`));
      if (design.screens.length === 0) fs.push(failure("e1b-design", "the design has no screens"));
      const ids = design.screens.map((x) => x.id);
      for (const x of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) fs.push(failure("e1b-duplicate", `two screens share the id ${x}`));
    }
    if (!withEstimate && (approval?.decision !== "approved" || !approval.by)) fs.push(failure("e1b-approval", "the mock and clickable demo are not approved by a person"));
    return verdict(fs, withEstimate ? `design note: ${design!.screens.length} page(s) linked to requirements, approved with the estimate (E7)` : `${design?.screens.length ?? 0} screens approved and linked to requirements`);
  },
});

/** The breakdown and the approved design agree: each task's screen exists, each approved screen is built, no id or route twice. */
export const designCoverage = defineGate<{ design?: { skipped?: boolean; screens: ScreenLike[] }; breakdown: Pick<Breakdown, "tasks"> }>({
  id: "estimate.e1c-design-coverage", after: "breakdown", safety: false, waiver: "human",
  predicate: ({ design, breakdown }) => {
    const screens = design && !design.skipped ? design.screens : [];
    const ids = new Set(screens.map((s) => s.id));
    const fs = [];
    const dup = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
    for (const x of dup(screens.map((s) => s.id))) fs.push(failure("e1c-duplicate-id", `two approved screens share the id ${x}`));
    for (const x of dup(screens.flatMap((s) => (s.route ? [s.route.trim().toLowerCase().replace(/\/+$/, "") || "/"] : [])))) fs.push(failure("e1c-duplicate-route", `two approved screens share the route ${x}`));
    for (const t of breakdown.tasks) {
      if (t.screen && !ids.has(t.screen)) fs.push(failure("e1c-unknown-screen", `${t.id} builds screen ${t.screen}, which is not in the approved design${screens.length ? "" : " (there is none)"}`));
    }
    const built = new Set(breakdown.tasks.map((t) => t.screen).filter(Boolean));
    for (const s of screens) if (!built.has(s.id)) fs.push(failure("e1c-unbuilt-screen", `approved screen ${s.id} is built by no task`));
    return verdict(fs, screens.length ? `all ${screens.length} approved screens are built by a task, and every task screen is approved` : "no approved screens, and no task cites one");
  },
});

/** B6: a build that follows an approved estimate plans every approved screen, through the estimate tasks that build it. */
export const screensPlanned = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "estimateTaskId">[] }; breakdown: Pick<Breakdown, "tasks">; design?: { skipped?: boolean; screens: ScreenLike[] } }>({
  id: "build.b6-screens-planned", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, breakdown, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved estimate has no design" };
    const planned = new Set(plan.tasks.map((t) => t.estimateTaskId).filter(Boolean));
    const fs = [];
    for (const s of design.screens) {
      const builders = breakdown.tasks.filter((t) => t.screen === s.id && t.executor !== "human");
      // a screen that only humans build (no factory task) is outside this plan
      if (builders.length && !builders.some((t) => planned.has(t.id))) fs.push(failure("b6-screen", `approved screen ${s.id} is built by ${builders.map((t) => t.id).join(", ")}, and the plan delivers none of them`));
    }
    return verdict(fs, `every approved screen with a factory task is in the plan (${design.screens.length})`);
  },
});

/** B7: the plan task that builds an approved screen may touch that screen's file, so the screen that was approved is the one built. */
export const screenScope = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "estimateTaskId" | "fileScope">[] }; breakdown: Pick<Breakdown, "tasks">; design?: ApprovedDesign }>({
  id: "build.b7-screen-scope", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, breakdown, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved estimate has no design" };
    return verdict(
      screenScopeGaps(plan, breakdown, design).map((g) => failure("b7-screen-scope", `plan task ${g.task} builds approved screen ${g.screen}, but its file scope does not include ${g.file}`)),
      "every plan task that builds an approved screen can touch that screen's file",
    );
  },
});

/**
 * B1 for a build from an approved design (`--from-design`, no estimate): every plan task delivers requirements of the approved
 * spec, and none delivers one the design run did not approve (PR #11 review, item 10).
 */
export const designScopeLock = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "reqs">[] }; approvedSpec: Pick<SpecDraft, "requirements"> }>({
  id: "build.b1-design-scope", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, approvedSpec }) => {
    const approved = new Set(approvedSpec.requirements.map((r) => r.id));
    return verdict(
      plan.tasks.flatMap((t) => !t.reqs.length
        ? [failure("b1-unmapped", `plan task ${t.id} delivers no approved requirement`)]
        : t.reqs.filter((r) => !approved.has(r)).map((r) => failure("b1-unknown", `plan task ${t.id} delivers ${r}, which the approved design's spec does not have`))),
      "every plan task delivers approved requirements",
    );
  },
});

/**
 * B6 and B7 for a build from an approved design: each approved screen is delivered by a plan task that serves its
 * requirements, and one of those tasks can touch the screen's file, so the screen that was approved is the one built.
 */
export const designScreensPlanned = defineGate<{ plan: { tasks: Pick<PlanTask, "id" | "reqs" | "fileScope">[] }; design?: ApprovedDesign }>({
  id: "build.b6-design-screens", after: "plan", safety: false, waiver: "human",
  predicate: ({ plan, design }) => {
    if (!design || design.skipped) return { passed: true, details: "the approved design has no screens" };
    const fs = [];
    for (const s of design.screens) {
      const serving = plan.tasks.filter((t) => t.reqs.some((r) => s.reqs.includes(r)));
      if (!serving.length) fs.push(failure("b6-screen", `approved screen ${s.id} (${s.route}) serves ${s.reqs.join(", ")}, and no plan task delivers them`));
      else if (s.file && !serving.some((t) => matchesAny(s.file, t.fileScope))) fs.push(failure("b7-screen-scope", `approved screen ${s.id} is delivered by ${serving.map((t) => t.id).join(", ")}, but none of their file scopes includes ${s.file}`));
    }
    return verdict(fs, `every approved screen (${design.screens.length}) is planned, by a task that can touch its file`);
  },
});
