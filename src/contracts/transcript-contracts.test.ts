import { describe, expect, it } from "vitest";
import { ClientIntentBody, DistillOut, StageName, Transcript } from "./index.js";

describe("transcript contracts", () => {
  it("a transcript has turns with ids, times and speakers", () => {
    const t = Transcript.parse({ format: "gemini-meet", notes: "", turns: [{ id: "T-1", time: "00:00:58", speaker: "A", text: "hi" }], speakers: ["A"] });
    expect(t.turns[0]!.id).toBe("T-1");
  });
  it("the model's answer needs a quote and a turn per requirement", () => {
    expect(() => DistillOut.parse({ project: { goal: "g" }, requirements: [{ id: "R-1", text: "x", status: "decided" }], constraints: [], openQuestions: [], warnings: [] })).toThrow();
  });
  it("statuses are the four agreed ones", () => {
    expect(() => DistillOut.parse({ project: { goal: "g" }, requirements: [{ id: "R-1", text: "x", status: "maybe", quote: "q", turn: "T-1" }], constraints: [], openQuestions: [], warnings: [] })).toThrow();
  });
  it("a stored intent carries speakers, dropped items and the skill", () => {
    const b = ClientIntentBody.parse({
      project: { goal: "g" }, requirements: [{ id: "R-1", text: "x", status: "decided", quote: "q", turn: "T-1", speaker: "A", role: "client" }],
      constraints: [], openQuestions: [], warnings: [], speakers: [{ name: "A", role: "client", source: "default" }], dropped: [], skill: { name: "transcript-distill", sha256: "a".repeat(64) }, edits: 0,
    });
    expect(b.requirements[0]!.role).toBe("client");
  });
  it("distill is a stage", () => expect(StageName.parse("distill")).toBe("distill"));
});
