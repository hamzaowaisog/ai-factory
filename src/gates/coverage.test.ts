// A review that skipped an acceptance criterion did not review the change.
import { describe, expect, it } from "vitest";
import { reviewCoversCriteria } from "./coverage.js";
import { DEFAULT_POLICY } from "./policy.js";
import type { Requirement, ReviewCoverage } from "../contracts/index.js";

const req = (id: string, acs: string[]): Requirement => ({
  id, ears: `The system shall ${id}`, op: "ADDED", sources: ["S-1"],
  acceptance: acs.map((a) => ({ id: a, given: "g", when: "w", then: "t", level: "api" as const })),
});
const spec = { requirements: [req("R-1", ["AC-1", "AC-2"]), req("R-2", ["AC-3"])] };
const cov = (acId: string, verdict: ReviewCoverage["verdict"] = "proves-it"): ReviewCoverage =>
  ({ acId, testId: "Orders.Tests::X.Y", verdict, why: "because" });

describe("review.covers-every-criterion", () => {
  it("passes when every criterion has a verdict", () => {
    const v = reviewCoversCriteria.predicate(
      { review: { coverage: [cov("AC-1"), cov("AC-2"), cov("AC-3")] }, spec }, DEFAULT_POLICY);
    expect(v.passed).toBe(true);
    expect(v.details).toMatch(/3 of 3/);
  });

  it("passes whatever the verdicts say: a weak test is a finding, not a gap in the report", () => {
    const v = reviewCoversCriteria.predicate(
      { review: { coverage: [cov("AC-1", "weak"), cov("AC-2", "no-test"), cov("AC-3")] }, spec }, DEFAULT_POLICY);
    expect(v.passed).toBe(true);
  });

  it("fails and names the criteria the reviewer skipped", () => {
    const v = reviewCoversCriteria.predicate(
      { review: { coverage: [cov("AC-1")] }, spec }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/AC-2/);
    expect(v.details).toMatch(/AC-3/);
  });

  it("fails on a verdict for a criterion that does not exist — the reviewer invented it", () => {
    const v = reviewCoversCriteria.predicate(
      { review: { coverage: [cov("AC-1"), cov("AC-2"), cov("AC-3"), cov("AC-9")] }, spec }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/AC-9/);
  });

  it("counts a duplicate verdict once, and does not let it stand in for a missing one", () => {
    const v = reviewCoversCriteria.predicate(
      { review: { coverage: [cov("AC-1"), cov("AC-1", "weak"), cov("AC-2")] }, spec }, DEFAULT_POLICY);
    expect(v.passed).toBe(false);
    expect(v.details).toMatch(/AC-3/);
  });

  it("fails an empty report against a spec that has criteria", () => {
    expect(reviewCoversCriteria.predicate({ review: { coverage: [] }, spec }, DEFAULT_POLICY).passed).toBe(false);
  });

  it("passes on a spec with no criteria rather than dividing by zero", () => {
    const v = reviewCoversCriteria.predicate({ review: { coverage: [] }, spec: { requirements: [] } }, DEFAULT_POLICY);
    expect(v.passed).toBe(true);
    expect(v.details).toMatch(/0 of 0/);
  });

  it("reports every missing criterion, not just the first", () => {
    const v = reviewCoversCriteria.predicate({ review: { coverage: [] }, spec }, DEFAULT_POLICY);
    expect(v.failures).toHaveLength(3);
  });

  it("cannot be waived: a review that skipped a requirement did not review the change", () => {
    expect(reviewCoversCriteria.safety).toBe(true);
    expect(reviewCoversCriteria.waiver).toBe("none");
  });
});
