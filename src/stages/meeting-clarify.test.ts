// Spec §5b: the meeting's open items are always asked; deferred and excluded items are never asked about.
import { describe, expect, it } from "vitest";
import type { ClientIntentBody } from "../contracts/index.js";
import type { RunState } from "../ledger/state.js";
import { selectQuestions, type ScoredQuestion } from "./clarify.js";
import { meetingContext, meetingMarked, meetingPrompt, notAskedAssumption } from "./meeting-clarify.js";

const intent: ClientIntentBody = {
  project: { name: "Clinic booking app", goal: "Track tickets" },
  requirements: [
    { id: "R-1", text: "Patients book appointments online", status: "decided", quote: "q", turn: "T-5" },
    { id: "R-3", text: "An SMS reminder the day before", status: "open", quote: "q", turn: "T-60" },
    { id: "R-8", text: "Video consultations", status: "deferred", quote: "q", turn: "T-58" },
    { id: "R-10", text: "A mobile app", status: "excluded", quote: "q", turn: "T-61" },
  ],
  constraints: [], openQuestions: [{ id: "Q-1", text: "Which map provider?", turn: "T-40" }], warnings: [],
  speakers: [], dropped: [], skill: { name: "transcript-distill", sha256: "a".repeat(64) }, edits: 0,
};
const transcript = { format: "gemini-meet", notes: "", speakers: ["A"], turns: [{ id: "T-40", time: "00:11:16", speaker: "A", text: "x" }] };
const ledger = { getJson: <T>(sha: string): T => (sha === "intent" ? intent : transcript) as T };
const state = (distilled: boolean) => ({
  info: { transcriptSha: "transcript" },
  steps: new Map(distilled ? [["distill", { status: "completed", outputs: ["intent"] }]] : []),
}) as unknown as RunState;
const brief = "# Clinic booking app\n\n## Requirements\n- R-1: Patients book appointments online\n\n## To confirm\n- R-3: An SMS reminder the day before\n- Q-1: Which map provider?";

const q = (id: string, score: number, extra: Partial<ScoredQuestion> = {}): ScoredQuestion => ({
  id, category: "scope", text: `question ${id}`, options: ["a", "b"], recommended: "a", reason: "why", spans: [], impact: 1, impactReason: "", uncertainty: 1, score, ...extra,
});

describe("the meeting in clarify", () => {
  it("is nothing for a run that was not distilled", () => {
    expect(meetingContext(state(false), ledger, brief)).toBeUndefined();
  });
  it("collects the open requirements and open questions in this request, with their times, and the out-of-scope list", () => {
    expect(meetingContext(state(true), ledger, brief)).toEqual({
      questions: [
        { id: "R-3", text: "Client to confirm: An SMS reminder the day before", at: "T-60" },
        { id: "Q-1", text: "Which map provider?", at: "T-40, 00:11:16" },
      ],
      outOfScope: [{ id: "R-8", status: "deferred", text: "Video consultations" }, { id: "R-10", status: "excluded", text: "A mobile app" }],
    });
  });
  it("a module of the brief only gets the open items whose lines it holds", () => {
    expect(meetingContext(state(true), ledger, "## To confirm\n- Q-1: Which map provider?")!.questions.map((x) => x.id)).toEqual(["Q-1"]);
  });
  it("round 1 is told to ask each open item and to leave the out-of-scope ones alone; round 2 only the latter", () => {
    const m = meetingContext(state(true), ledger, brief)!;
    const one = meetingPrompt(m, 1);
    expect(one).toContain("- Q-1 (T-40, 00:11:16): Which map provider?");
    expect(one).toContain("- R-8 (deferred): Video consultations");
    expect(one).toMatch(/Never ask about these/);
    const two = meetingPrompt(m, 2);
    expect(two).not.toContain("Which map provider?");
    expect(two).toContain("- R-10 (excluded): A mobile app");
  });
  it("marks the questions that carry a meeting item and lists the items no question carries", () => {
    const m = meetingContext(state(true), ledger, brief)!;
    const r = meetingMarked([q("x1", 2, { meeting: "Q-1" }), q("x2", 9), q("x3", 1, { meeting: "Q-1" })], m);
    expect([...r.forced]).toEqual(["x1"]);
    expect(r.questions[0]!.reason).toBe("Left open in the meeting (T-40, 00:11:16). why");
    expect(r.questions[2]!.reason).toBe("why"); // the same item twice: only the first carries it
    expect(r.missing.map((x) => x.id)).toEqual(["R-3"]);
  });
  it("asks forced questions first whatever their score, and keeps the cap for the rest", () => {
    const { asked, assumptions } = selectQuestions([q("a", 9), q("b", 6), q("m", 1)], 2, 1, undefined, new Set(["m"]));
    expect(asked.map((x) => x.text)).toEqual(["question m", "question a"]);
    expect(assumptions.map((x) => x.fromQuestion)).toEqual(["b"]);
  });
  it("a hands-off run (cap 0) asks nobody, the meeting questions included", () => {
    expect(selectQuestions([q("m", 1)], 0, 1, undefined, new Set(["m"])).asked).toEqual([]);
  });
  it("a meeting item nobody asked becomes a high-risk assumption", () => {
    expect(notAskedAssumption({ id: "R-3", text: "Client to confirm: X", at: "T-60" }, "ASM-9")).toEqual({
      id: "ASM-9", text: "Client to confirm: X (left open in the meeting, T-60) → not asked; still open", risk: "high", fromSpan: [], fromQuestion: "R-3",
    });
  });
});
