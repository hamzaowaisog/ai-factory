import { describe, expect, it } from "vitest";
import { combineClarify, combineIntents } from "./modular.js";
import type { ClarifyResult } from "./clarify.js";

const intent = (over: Record<string, unknown> = {}) => ({
  source: "cli" as const, spans: [{ id: "I-1", text: "a" }, { id: "I-2", text: "b" }], changeClass: "feature" as const, risk: "low" as const,
  riskTags: [] as string[], rigor: "light" as const, touchesUi: false, ...over,
});

describe("combineIntents", () => {
  it("numbers spans again, takes the highest risk, any UI, and full rigor if any module needs it", () => {
    const c = combineIntents([intent(), intent({ risk: "high", riskTags: ["pii"], touchesUi: true, rigor: "full", changeClass: "migration" }), intent({ riskTags: ["auth"] })]);
    expect(c.spans.map((s) => s.id)).toEqual(["I-1", "I-2", "I-3", "I-4", "I-5", "I-6"]);
    expect(c).toMatchObject({ risk: "high", touchesUi: true, rigor: "full", changeClass: "feature" });
    expect(c.riskTags.sort()).toEqual(["auth", "pii"]);
  });
});

describe("combineClarify", () => {
  const q = (id: string, text: string) => ({ id, category: "scope", text, options: ["A", "B"], recommended: "A", impact: 2 as const, uncertainty: 2 as const, score: 4 });
  const round = (asked: ReturnType<typeof q>[], answers: Record<string, string>, by: string): ClarifyResult => ({
    round: 1, asked, answers, answeredBy: by, conflicts: [], differences: [],
    assumptions: asked.map((x) => ({ id: "ASM-1", text: `assume ${x.id}`, risk: "low" as const, fromSpan: ["I-1"], fromQuestion: x.id })),
  });
  it("renumbers questions and assumptions across modules and keeps each module's answers", () => {
    const c = combineClarify([round([q("Q-1", "web?")], { "Q-1": "B" }, "lead"), round([q("Q-1", "sms?"), q("Q-2", "pdf?")], { "Q-1": "A" }, "lead")]);
    expect(c.asked.map((x) => x.id)).toEqual(["Q-1", "Q-2", "Q-3"]);
    expect(c.answers).toEqual({ "Q-1": "B", "Q-2": "A", "Q-3": "A" });
    expect(c.assumptions.map((a) => `${a.id}:${a.fromQuestion}`)).toEqual(["ASM-1:Q-1", "ASM-2:Q-2", "ASM-3:Q-3"]);
    expect(c.answeredBy).toBe("lead");
  });
  it("an empty round stays empty", () => {
    expect(combineClarify([round([], {}, "x")]).asked).toEqual([]);
  });
  it("keeps the hands-off mark when any module's questions became the factory's assumptions", () => {
    expect(combineClarify([{ ...round([], {}, "x"), assumedBy: "factory" }, round([], {}, "x")]).assumedBy).toBe("factory");
    expect(combineClarify([round([], {}, "x")]).assumedBy).toBeUndefined();
  });
});
