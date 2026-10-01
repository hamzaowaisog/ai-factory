import { describe, expect, it } from "vitest";
import { LANE, specLane } from "./lane.js";

const intent = (o: Partial<Parameters<typeof specLane>[0]> = {}) => ({ risk: "high", rigor: "full", changeClass: "feature", ...o }) as Parameters<typeof specLane>[0];

describe("specLane", () => {
  it("an estimate keeps three drafts but allows one repair and a medium critic", () => {
    const l = specLane(intent(), "estimate");
    expect(l).toBe(LANE.estimate);
    expect(l.drafts).toBe(3);
    expect(l.maxRepairs).toBe(1);
    expect(l.criticEffort).toBe("medium");
  });
  it("a build run keeps the full lane", () => expect(specLane(intent(), "brownfield")).toBe(LANE.full));
  it("a small low-risk change is light in any mode", () => expect(specLane(intent({ risk: "low", rigor: "light" }), "estimate")).toBe(LANE.light));
});
