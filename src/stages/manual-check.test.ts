// The sign-off of the criteria only a person can check: what counts as an answer, and what the card says.
import { describe, expect, it } from "vitest";
import { manualBundle, manualCard, manualCriteria, readChecks, signOffFor } from "./manual-check.js";
import type { Requirement } from "../contracts/index.js";

const reqs: Requirement[] = [{
  id: "REQ-1", ears: "The page shall show the total", op: "ADDED", sources: ["I-1"],
  acceptance: [
    { id: "AC-1.1", given: "an order", when: "the API is called", then: "the total is returned", level: "api" },
    { id: "AC-1.2", given: "an order", when: "the page opens", then: "the total is in bold", level: "manual" },
    { id: "AC-1.3", given: "a phone", when: "the page opens", then: "nothing is cut off", level: "manual" },
  ],
}];
const criteria = manualCriteria(reqs);

describe("manual sign-off", () => {
  it("takes only the criteria with no automated test, with their requirement", () => {
    expect(criteria.map((c) => [c.id, c.req])).toEqual([["AC-1.2", "REQ-1"], ["AC-1.3", "REQ-1"]]);
  });

  it("needs an answer for every criterion on the card", () => {
    expect(readChecks({ "AC-1.2": { result: "pass" } }, criteria)).toEqual({ error: "Say whether AC-1.3 passes or fails: every criterion on the card needs an answer." });
  });

  it("refuses a criterion that is not on the card, so an automated one cannot be signed off by hand", () => {
    expect(readChecks({ "AC-1.1": { result: "pass" }, "AC-1.2": { result: "pass" }, "AC-1.3": { result: "pass" } }, criteria)).toEqual({ error: "AC-1.1 is not on this card." });
  });

  it("needs a note for a fail, and keeps the note", () => {
    expect(readChecks({ "AC-1.2": { result: "pass" }, "AC-1.3": { result: "fail", note: " " } }, criteria)).toEqual({ error: "Say what went wrong with AC-1.3: a failed check needs a note." });
    expect(readChecks({ "AC-1.2": { result: "pass" }, "AC-1.3": { result: "fail", note: " the footer is cut off " } }, criteria))
      .toEqual({ checks: { "AC-1.2": { result: "pass", note: "" }, "AC-1.3": { result: "fail", note: "the footer is cut off" } } });
  });

  it("the card names the commit, every criterion and the command with the card's hash", () => {
    const md = manualCard("run-1", "abcdef0123456789", manualBundle("1234567890abcdef", criteria));
    expect(md).toContain("# Check by hand before delivery (2 criteria)");
    expect(md).toContain("on commit 1234567890");
    expect(md).toContain("- Then the total is in bold");
    expect(md).toContain("factory sign-off run-1 abcdef01 --pass AC-1.2,AC-1.3");
    expect(md).toContain('factory sign-off run-1 abcdef01 --fail AC-1.2 --note "what went wrong" --pass AC-1.3');
  });

  it("a sign-off answers one card only: a different commit's card has none", () => {
    const decisions = [{ cardId: "manual-aaaa", decision: "sign-off", by: "sara", artifactSha: "aaaa", seq: 9, checks: { "AC-1.2": { result: "pass", note: "" } } }];
    expect(signOffFor(decisions, "aaaa")).toEqual({ by: "sara", checks: { "AC-1.2": { result: "pass", note: "" } } });
    expect(signOffFor(decisions, "bbbb")).toBeUndefined();
  });
});
