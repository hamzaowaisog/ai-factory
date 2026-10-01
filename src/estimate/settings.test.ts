import { describe, expect, it } from "vitest";
import { parseEstimateSettings, parseRates } from "./settings.js";

const base = { deliveryModel: "hitl", stackSource: "undecided", designInTotal: true, feedbackRounds: "2", repo: true };

describe("estimate settings from flags", () => {
  it("defaults to the HITL model with nothing extra recorded", () => {
    expect(parseEstimateSettings(base)).toEqual({ deliveryModel: "hitl", stackSource: "undecided", designInTotal: true, feedbackRounds: 2 });
  });
  it("records rates, the no-repo flag and the header names", () => {
    expect(parseEstimateSettings({ ...base, deliveryModel: "agentic", designInTotal: false, repo: false, rate: ["backend=55", "default=40.5"], client: "Acme", pm: "A. Lead" })).toEqual({
      deliveryModel: "agentic", stackSource: "undecided", designInTotal: false, feedbackRounds: 2, rates: { backend: 55, default: 40.5 }, noRepo: true, client: "Acme", pm: "A. Lead",
    });
  });
  it("refuses bad values before any run exists", () => {
    expect(() => parseEstimateSettings({ ...base, deliveryModel: "robots" })).toThrow(/hitl or agentic/);
    expect(() => parseEstimateSettings({ ...base, stackSource: "x" })).toThrow(/stack-source/);
    expect(() => parseEstimateSettings({ ...base, feedbackRounds: "-1" })).toThrow(/feedback-rounds/);
    expect(() => parseRates(["backend"])).toThrow(/track=dollars/);
    expect(() => parseRates(["janitor=10"])).toThrow(/track=dollars/);
    expect(() => parseRates(["web=0"])).toThrow(/Can't read|more than 0/);
  });
});
