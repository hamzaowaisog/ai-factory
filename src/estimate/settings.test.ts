import { describe, expect, it } from "vitest";
import { humanReview, parseEstimateSettings, parseRates } from "./settings.js";

const base = { stackSource: "undecided", designInTotal: true, feedbackRounds: "2", repo: true };

describe("estimate settings from flags", () => {
  it("is always solely agentic and reviewed by a person by default, with nothing extra recorded", () => {
    expect(parseEstimateSettings(base)).toEqual({ deliveryModel: "agentic", stackSource: "undecided", designInTotal: true, feedbackRounds: 2, humanReview: true });
  });
  it("records rates, the no-repo flag and the header names", () => {
    expect(parseEstimateSettings({ ...base, designInTotal: false, repo: false, rate: ["backend=55", "default=40.5"], client: "Acme", pm: "A. Lead" })).toEqual({
      deliveryModel: "agentic", stackSource: "undecided", designInTotal: false, feedbackRounds: 2, rates: { backend: 55, default: 40.5 }, noRepo: true, client: "Acme", pm: "A. Lead", humanReview: true,
    });
  });
  it("records the human review choice; only an estimate run goes hands-off, and older runs keep their reviews", () => {
    expect(parseEstimateSettings({ ...base, review: true }).humanReview).toBe(true);
    // hands-off only when asked for
    expect(parseEstimateSettings({ ...base, review: false }).humanReview).toBe(false);
    expect(humanReview({ mode: "estimate", estimate: { humanReview: false } })).toBe(false);
    expect(humanReview({ mode: "estimate", estimate: { humanReview: true } })).toBe(true);
    expect(humanReview({ mode: "estimate", estimate: {} })).toBe(true);
    expect(humanReview({ mode: "design", estimate: { humanReview: false } })).toBe(true);
    expect(humanReview({ mode: "brownfield" })).toBe(true);
  });
  it("refuses bad values before any run exists", () => {
    expect(() => parseEstimateSettings({ ...base, stackSource: "x" })).toThrow(/stack-source/);
    expect(() => parseEstimateSettings({ ...base, feedbackRounds: "-1" })).toThrow(/feedback-rounds/);
    expect(() => parseRates(["backend"])).toThrow(/track=dollars/);
    expect(() => parseRates(["janitor=10"])).toThrow(/track=dollars/);
    expect(() => parseRates(["web=0"])).toThrow(/Can't read|more than 0/);
  });
});
