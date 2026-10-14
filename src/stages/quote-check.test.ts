import { describe, expect, it } from "vitest";
import { checkQuotes, needsRepair, normalise } from "./quote-check.js";

const turns = [
  { id: "T-1", time: "00:03:10", speaker: "A", text: "So uh patients can book an appointment online. And uh they can cancel it up to 24 hours before." },
  { id: "T-2", time: "00:13:30", speaker: "B", text: "So I think let’s skip it for now." },
];
const req = (id: string, quote: string, turn: string) => ({ id, text: "x", status: "decided" as const, quote, turn });
const out = (rs: ReturnType<typeof req>[]) => ({ project: { goal: "g" }, requirements: rs, constraints: [], openQuestions: [], warnings: [] });

describe("quote check", () => {
  it("normalises case, punctuation, fillers, curly quotes and spaces", () => {
    expect(normalise("So, uh, I THINK  let’s skip it!")).toBe("so i think lets skip it");
  });
  it("keeps an exact quote", () => {
    expect(checkQuotes(out([req("R-1", "And uh they can cancel it up to 24 hours before", "T-1")]), turns).kept).toHaveLength(1);
  });
  it("keeps a quote with fillers removed or a straight apostrophe", () => {
    const r = checkQuotes(out([req("R-1", "And they can cancel it up to 24 hours", "T-1"), req("R-2", "let's skip it for now", "T-2")]), turns);
    expect(r.kept.map((x) => x.id)).toEqual(["R-1", "R-2"]);
  });
  it("drops a quote from the wrong turn", () => {
    expect(checkQuotes(out([req("R-1", "let's skip it for now", "T-1")]), turns).dropped[0]!.why).toMatch(/not in T-1/);
  });
  it("drops an unknown turn, a too-short quote and a stitched quote", () => {
    const r = checkQuotes(out([req("R-1", "can book an appointment online", "T-9"), req("R-2", "online", "T-1"), req("R-3", "book an appointment online cancel it up to", "T-1")]), turns);
    expect(r.dropped.map((d) => d.id)).toEqual(["R-1", "R-2", "R-3"]);
    expect(r.dropped[0]!.why).toMatch(/no turn T-9/);
    expect(r.dropped[1]!.why).toMatch(/1 word/);
  });
  it("asks for a repair above 20% dropped or with nothing kept", () => {
    expect(needsRepair(8, 2)).toBe(false);
    expect(needsRepair(7, 3)).toBe(true);
    expect(needsRepair(0, 0)).toBe(true);
  });
});
