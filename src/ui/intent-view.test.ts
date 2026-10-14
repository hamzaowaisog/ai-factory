// The run page's view of an open client-intent card (spec 2026-10-14 transcript-intent §5c).
import { describe, expect, it } from "vitest";
import { intentOf } from "./data.js";

const intent = {
  project: { name: "Project Orbit", goal: "Track deliveries" },
  requirements: [
    { id: "R-1", text: "Doctors see only their own appointments", status: "decided", quote: "Each doctor sees only uh his own appointments", turn: "T-13", speaker: "Alex Morgan", role: "client" },
    { id: "R-24", text: "SMS when out for delivery", status: "decided", addedBy: { by: "lead", note: "said after the call" } },
  ],
  constraints: [{ id: "C-1", text: "Pilot in 12 weeks" }], openQuestions: [{ id: "Q-1", text: "iOS later?" }],
  warnings: ["Second project 'Comet' from 00:48:32; not distilled."],
  speakers: [{ name: "Alex Morgan", role: "client", source: "default" }],
  dropped: [{ id: "R-21", text: "Paraphrase", quote: "q", turn: "T-41", why: "the quote is not in T-41" }],
  skill: { name: "transcript-distill", sha256: "a".repeat(64) }, edits: 1,
};
const ledger = { getJson: <T>(sha: string): T => (sha === "card" ? { card: "intent", intent } : undefined) as T };

describe("the intent card on the run page", () => {
  it("gives the page the card's requirements, speakers, warnings and dropped items as data", () => {
    expect(intentOf(ledger, "card")).toEqual({
      project: { name: "Project Orbit", goal: "Track deliveries" },
      requirements: [
        { id: "R-1", text: "Doctors see only their own appointments", status: "decided", quote: "Each doctor sees only uh his own appointments", turn: "T-13", speaker: "Alex Morgan", role: "client" },
        { id: "R-24", text: "SMS when out for delivery", status: "decided", added: "lead: said after the call" },
      ],
      speakers: [{ name: "Alex Morgan", role: "client", source: "default" }],
      constraints: ["C-1: Pilot in 12 weeks"], openQuestions: ["Q-1: iOS later?"],
      warnings: ["Second project 'Comet' from 00:48:32; not distilled."],
      dropped: ["R-21: Paraphrase (the quote is not in T-41)"],
    });
  });
  it("gives each quote the whole turn it is from, when the run's transcript is there", () => {
    const withTurns = { getJson: <T>(sha: string): T => (sha === "t" ? { turns: [{ id: "T-13", time: "00:20:00", speaker: "Alex Morgan", text: "Right. Each doctor sees only uh his own appointments, not the others." }] } : ledger.getJson(sha)) as T };
    const v = intentOf(withTurns, "card", "t")!;
    expect(v.requirements[0]!.said).toBe("Right. Each doctor sees only uh his own appointments, not the others.");
    expect(v.requirements[1]!.said).toBeUndefined();
  });
  it("is nothing when the card's data is missing", () => {
    expect(intentOf(ledger, "other")).toBeUndefined();
  });
});
