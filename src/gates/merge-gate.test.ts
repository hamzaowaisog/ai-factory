// The gates the merge gate adds. All deterministic, all pure functions of their loaded inputs.
import { describe, expect, it } from "vitest";
import { buildClean, conventionsFollowed, externalGreen, lintNoNewFindings, review2Blocking } from "./merge-gate.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { DEFAULT_POLICY } from "./policy.js";

describe("build.clean", () => {
  it("passes on a clean build", () => {
    const v = buildClean.predicate({ build: { kind: "build", ok: true, errors: [] } }, DEFAULT_POLICY);
    expect(v.passed).toBe(true);
    expect(v.details).toMatch(/0 compilation errors/);
  });

  it("reports file, line and compiler code for each error", () => {
    const v = buildClean.predicate({ build: { kind: "build", ok: false, errors: [
      { file: "Api/Program.cs", line: 8, code: "CS0246", msg: "The type or namespace name 'Foo' could not be found" },
    ] } }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/Api\/Program\.cs:8 CS0246/);
  });

  it("fails on errors even when the producer claimed ok — the evidence outranks the claim", () => {
    const v = buildClean.predicate(
      { build: { kind: "build", ok: true, errors: [{ file: "A.cs", line: 1, code: "CS1002", msg: "; expected" }] } },
      DEFAULT_POLICY);
    expect(v.passed).toBe(false);
  });

  it("records a location on every failure, so it can be shown inline on the PR", () => {
    const v = buildClean.predicate({ build: { kind: "build", ok: false, errors: [
      { file: "A.cs", line: 3, code: "CS1002", msg: "; expected" },
    ] } }, DEFAULT_POLICY);
    expect(v.failures![0]!.location).toBe("A.cs:3");
  });

  it("is a safety gate and cannot be waived", () => {
    expect(buildClean.safety).toBe(true);
    expect(buildClean.waiver).toBe("none");
  });
});

const SHA = "a".repeat(40);
const checks = (cs: unknown[], required = ["ci/build"]) =>
  ({ headSha: SHA, required, checks: cs as never });
const ok = (name: string) => ({ name, status: "completed", conclusion: "success", completedAt: "2026-10-05T00:00:00Z" });

describe("checks.external-green", () => {
  it("passes when every required check is completed and successful", () => {
    expect(externalGreen.predicate({ checks: checks([ok("ci/build")]), head: { sha: SHA } }, DEFAULT_POLICY).passed).toBe(true);
  });

  it("treats a required check that is absent as a failure", () => {
    const v = externalGreen.predicate({ checks: checks([]), head: { sha: SHA } }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/ci\/build.*absent/i);
  });

  it("treats pending as failed — a gate that cannot check counts as failed", () => {
    const v = externalGreen.predicate({ checks: checks([{ name: "ci/build", status: "in_progress" }]), head: { sha: SHA } }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/in_progress/);
  });

  it("accepts neutral, rejects skipped and cancelled", () => {
    const at = (conclusion: string) =>
      externalGreen.predicate({ checks: checks([{ name: "ci/build", status: "completed", conclusion }]), head: { sha: SHA } }, DEFAULT_POLICY).passed;
    expect(at("neutral")).toBe(true);
    expect(at("skipped")).toBe(false);
    expect(at("cancelled")).toBe(false);
    expect(at("timed_out")).toBe(false);
  });

  it("rejects a green result gathered against a different commit", () => {
    const v = externalGreen.predicate({ checks: checks([ok("ci/build")]), head: { sha: "b".repeat(40) } }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/different commit/i);
  });

  it("excludes the factory's own check, or the gate waits on itself forever", () => {
    const v = externalGreen.predicate(
      { checks: checks([ok("ci/build"), { name: OWN_CHECK_NAME, status: "in_progress" }], ["ci/build", OWN_CHECK_NAME]), head: { sha: SHA } },
      DEFAULT_POLICY);
    expect(v.passed).toBe(true);
  });

  it("reports every missing or failing check, not just the first", () => {
    const v = externalGreen.predicate(
      { checks: checks([{ name: "ci/lint", status: "completed", conclusion: "failure" }], ["ci/build", "ci/lint"]), head: { sha: SHA } },
      DEFAULT_POLICY);
    expect(v.failures).toHaveLength(2);
  });

  it("is waivable: external CI breaks for reasons unrelated to the change", () => {
    expect(externalGreen.waiver).toBe("human");
    expect(externalGreen.safety).toBe(false);
  });
});

const lf = (file: string, code: string) => ({ ruleId: code, file, line: 1, fingerprint: `${file}|${code}`, severity: "warning" });
const lint = (fs: ReturnType<typeof lf>[]) => ({ findings: fs });

describe("lint.no-new-findings", () => {
  it("passes when every finding is already in the baseline", () => {
    expect(lintNoNewFindings.predicate(
      { lint: lint([lf("A.cs", "CA1822")]), baseline: { findings: [lf("A.cs", "CA1822")] }, diff: { files: [{ path: "A.cs" }] } },
      DEFAULT_POLICY).passed).toBe(true);
  });

  it("fails on a new finding, naming file and code", () => {
    const v = lintNoNewFindings.predicate(
      { lint: lint([lf("A.cs", "SA1200")]), baseline: { findings: [] }, diff: { files: [{ path: "A.cs" }] } },
      DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/A\.cs/);
    expect(v.details).toMatch(/SA1200/);
  });

  it("ignores a new finding in a file this change did not touch", () => {
    expect(lintNoNewFindings.predicate(
      { lint: lint([lf("B.cs", "SA1200")]), baseline: { findings: [] }, diff: { files: [{ path: "A.cs" }] } },
      DEFAULT_POLICY).passed).toBe(true);
  });

  it("is waivable and is not a safety gate — untidy is not unverified", () => {
    expect(lintNoNewFindings.safety).toBe(false);
    expect(lintNoNewFindings.waiver).toBe("human");
  });
});

describe("conventions.followed", () => {
  const confirmed = {
    id: "CV-1", appliesTo: ["**/*.cs"], rule: "No raw SQL strings", exemplar: "src/Orders/Repo.cs:34",
    evidence: { matching: 40, total: 41, recentMatching: 12, recentTotal: 12 },
    status: "confirmed" as const, source: "mined" as const, check: { tool: "grep" as const, ref: "SELECT\s" },
  };
  const candidate = { ...confirmed, id: "CV-2", status: "candidate" as const, source: "stackpack" as const };
  const broke = (id: string) => ({ conventionId: id, file: "A.cs", line: 9, detail: "SELECT " });

  it("blocks on a confirmed convention with a check", () => {
    const v = conventionsFollowed.predicate({ guidelines: { conventions: [confirmed] }, violations: [broke("CV-1")] }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/CV-1/);
    expect(v.details).toMatch(/src\/Orders\/Repo\.cs:34/);
  });

  it("never blocks on a candidate or stackpack rule", () => {
    expect(conventionsFollowed.predicate({ guidelines: { conventions: [candidate] }, violations: [broke("CV-2")] }, DEFAULT_POLICY).passed).toBe(true);
  });

  it("fails when the guidelines are unapproved: a gate that cannot check counts as failed", () => {
    const v = conventionsFollowed.predicate({ guidelines: { unapproved: "never approved" }, violations: [] }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/never approved/);
  });

  it("is waivable: an analyzer can be wrong and a rule can be broken for a stated reason", () => {
    expect(conventionsFollowed.safety).toBe(false);
    expect(conventionsFollowed.waiver).toBe("human");
  });
});

const find = (p: Partial<{ category: string; severity: string; axis: string; confidence: number }>) => ({
  id: "RR-1", category: "test-quality", axis: "spec", file: "A.cs", line: 1,
  text: "asserts the wrong thing", confidence: 0.9, severity: "high", ...p,
}) as never;
const fams = (reviewer2 = "c") => ({ implementer: "a", reviewer: "b", reviewer2 });

describe("review-2.no-blocking", () => {
  it("blocks on a use-case gap: it breaks the proof", () => {
    expect(review2Blocking.predicate({ review: { findings: [find({ category: "use-case-gap" })] }, families: fams() }, DEFAULT_POLICY).passed)
      .toBe(false);
  });

  it("blocks on test-quality: a test that proves nothing is the gap this gate exists for", () => {
    expect(review2Blocking.predicate({ review: { findings: [find({ category: "test-quality" })] }, families: fams() }, DEFAULT_POLICY).passed)
      .toBe(false);
  });

  it("does not block on convention or best-practice: the deterministic gates own those", () => {
    for (const category of ["convention", "best-practice"]) {
      expect(review2Blocking.predicate({ review: { findings: [find({ category, severity: "critical" })] }, families: fams() }, DEFAULT_POLICY).passed)
        .toBe(true);
    }
  });

  it("blocks on a plan deviation only when it is critical", () => {
    expect(review2Blocking.predicate({ review: { findings: [find({ category: "plan-deviation", severity: "critical" })] }, families: fams() }, DEFAULT_POLICY).passed)
      .toBe(false);
    expect(review2Blocking.predicate({ review: { findings: [find({ category: "plan-deviation", severity: "medium" })] }, families: fams() }, DEFAULT_POLICY).passed)
      .toBe(true);
  });

  it("ignores a finding the model is not confident about", () => {
    expect(review2Blocking.predicate({ review: { findings: [find({ confidence: 0.2 })] }, families: fams() }, DEFAULT_POLICY).passed)
      .toBe(true);
  });

  it("notes when the third reviewer shares a family with the implementer", () => {
    const v = review2Blocking.predicate({ review: { findings: [] }, families: fams("a") }, DEFAULT_POLICY);
    expect(v.passed).toBe(true);
    expect(v.details).toMatch(/same family as the implementer/);
  });

  it("notes when it shares a family with the pre-PR reviewer", () => {
    expect(review2Blocking.predicate({ review: { findings: [] }, families: fams("b") }, DEFAULT_POLICY).details)
      .toMatch(/same family as the pre-PR reviewer/);
  });

  it("says nothing about families when all three differ", () => {
    expect(review2Blocking.predicate({ review: { findings: [] }, families: fams() }, DEFAULT_POLICY).details)
      .not.toMatch(/same family/);
  });

  it("is waivable: these are model judgements, so a false positive must be overridable", () => {
    expect(review2Blocking.waiver).toBe("human");
    expect(review2Blocking.safety).toBe(false);
  });
});
