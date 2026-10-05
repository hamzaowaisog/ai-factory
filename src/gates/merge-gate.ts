// Gates the merge gate adds. All new, all deterministic, all pure functions of their inputs.
import type { BuildRun, Convention, Failure, LintRun, ReviewFinding } from "../contracts/index.js";
import type { Violation } from "../conventions/check.js";
import { newFindings } from "../verify/warnings.js";
import { type ExternalChecks, OWN_CHECK_NAME } from "../contracts/checks.js";
import { defineGate, failure, verdict } from "./engine.js";

/**
 * Zero compilation errors as an explicit recorded decision. Today a build failure surfaces only as
 * a step-level failure feeding the ladder; making it a gate puts "it compiles" in the evidence
 * manifest as something `factory verify-evidence` can re-check.
 */
export const buildClean = defineGate<{ build: BuildRun }>({
  id: "build.clean", after: "implement", safety: true, waiver: "none",
  // the errors array decides, not `ok`: a producer's summary flag is a claim, the parsed errors are
  // the evidence, and the evidence outranks the claim
  predicate: ({ build }) => verdict(
    build.errors.map((e) => failure("build", `${e.file}:${e.line} ${e.code}: ${e.msg}`, { location: `${e.file}:${e.line}` })),
    "0 compilation errors"),
});

/**
 * All required external checks green. The only gate whose input is a THIRD PARTY'S ASSERTION rather
 * than evidence the factory produced, so the payload is recorded verbatim and this predicate
 * re-evaluates the stored copy — a replay must never depend on what GitHub happens to answer today.
 */
export const externalGreen = defineGate<{ checks: ExternalChecks; head: { sha: string } }>({
  id: "checks.external-green", after: "deliver", safety: false, waiver: "human",
  predicate: ({ checks, head }) => {
    const fs: Failure[] = [];
    // a green result from an earlier commit proves nothing about this tree
    if (checks.headSha !== head.sha) {
      fs.push(failure("external-checks", `Checks were gathered against a different commit: ${checks.headSha.slice(0, 10)}, judging ${head.sha.slice(0, 10)}`));
    }
    // exclude our own check by name, or this gate waits on itself and the merge queue deadlocks
    for (const name of checks.required.filter((n) => n !== OWN_CHECK_NAME)) {
      const c = checks.checks.find((x) => x.name === name);
      if (!c) { fs.push(failure("external-checks", `Required check "${name}" is absent from the payload`)); continue; }
      // pending reads as failed: a gate that cannot check counts as failed
      if (c.status !== "completed") { fs.push(failure("external-checks", `Required check "${name}" is ${c.status}, not completed`)); continue; }
      if (c.conclusion !== "success" && c.conclusion !== "neutral") {
        fs.push(failure("external-checks", `Required check "${name}" concluded ${c.conclusion ?? "with nothing"}${c.detailsUrl ? ` (${c.detailsUrl})` : ""}`));
      }
    }
    return verdict(fs, `${checks.required.filter((n) => n !== OWN_CHECK_NAME).length} required checks green on ${head.sha.slice(0, 10)}`);
  },
});

export const lintNoNewFindings = defineGate<{
  lint: Pick<LintRun, "findings">;
  baseline: { findings: LintRun["findings"] };
  diff: { files: { path: string }[] };
}>({
  id: "lint.no-new-findings", after: "integrate", safety: false, waiver: "human",
  predicate: ({ lint, baseline, diff }) => verdict(
    newFindings(lint, baseline.findings, diff.files.map((f) => f.path))
      .map((f) => failure("lint", `${f.file}:${f.line} ${f.ruleId}`, { location: `${f.file}:${f.line}` })),
    `${lint.findings.length} analyzer findings, none new against the baseline`),
});

/**
 * A `confirmed` convention carrying a `check` was broken in a file the change touched.
 *
 * Not a safety gate, and waivable: unlike `secrets.none` or `tests.expectations`, a style violation
 * does not make the code unverified — it makes it untidy. An analyzer can be wrong, and a
 * convention can be legitimately broken for a stated reason.
 */
export const conventionsFollowed = defineGate<{
  guidelines: { conventions: Convention[] } | { unapproved: string };
  violations: Violation[];
}>({
  id: "conventions.followed", after: "integrate", safety: false, waiver: "human",
  predicate: ({ guidelines, violations }) => {
    // a gate that cannot check counts as failed, never as passed and never as skipped: missing,
    // unapproved, edited-since-approval and unparseable all arrive here as `unapproved`
    if ("unapproved" in guidelines) {
      return { passed: false, details: `Cannot check conventions: ${guidelines.unapproved}`, failures: [failure("conventions", guidelines.unapproved)] };
    }
    // only a confirmed rule carrying a check blocks; candidate and stackpack rules advise
    const blocking = new Map(guidelines.conventions.filter((c) => c.status === "confirmed" && c.check).map((c) => [c.id, c]));
    const fs = violations.filter((v) => blocking.has(v.conventionId)).map((v) => {
      const c = blocking.get(v.conventionId)!;
      return failure("conventions", `${v.conventionId} ${v.file}:${v.line} breaks "${c.rule}" (see ${c.exemplar}): ${v.detail}`, { location: `${v.file}:${v.line}` });
    });
    return verdict(fs, `${violations.length} convention notes, ${fs.length} blocking`);
  },
});

/** Findings that undermine the EVIDENCE block. Tidiness findings do not — the deterministic gates own those. */
const EVIDENCE_BREAKING = new Set(["use-case-gap", "test-quality"]);

/**
 * Blocking findings from the independent merge reviewer.
 *
 * Waivable, and not a safety gate: these are model judgements, so an unwaivable block would let one
 * false positive stop a merge with no override. A `convention` or `best-practice` finding never
 * blocks at all — `conventions.followed` and `lint.no-new-findings` already cover the mechanically
 * checkable part, so a model opinion there is advisory on purpose.
 */
export const review2Blocking = defineGate<{
  review: { findings: ReviewFinding[] };
  families: { implementer: string; reviewer: string; reviewer2: string };
}>({
  id: "review-2.no-blocking", after: "review", safety: false, waiver: "human",
  predicate: ({ review, families }, policy) => {
    // the same confidence floor review.no-blocking uses (see isBlocking in predicates.ts)
    const fs = review.findings
      .filter((f) => EVIDENCE_BREAKING.has(f.category) || (f.category === "plan-deviation" && f.severity === "critical"))
      .filter((f) => f.confidence >= policy.reviewConfidence)
      .map((f) => failure("review-2", `${f.id} [${f.category}/${f.severity}] ${f.file}:${f.line} ${f.text}`, { location: `${f.file}:${f.line}` }));
    const notes = [
      families.reviewer2 === families.implementer ? "the merge reviewer is the same family as the implementer" : "",
      families.reviewer2 === families.reviewer ? "the merge reviewer is the same family as the pre-PR reviewer" : "",
    ].filter(Boolean);
    const v = verdict(fs, `${review.findings.length} findings, none blocking`);
    return { ...v, details: notes.length ? `${v.details} (${notes.join("; ")})` : v.details };
  },
});
