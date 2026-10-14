import { describe, expect, it } from "vitest";
import type { ClientIntentBody } from "../contracts/index.js";
import { applyIntentEdits, checkIntentEdit, intentCard, intentEditsOf, parseIntentEditArgs, renderBrief, webIntentEdit } from "./intent-edits.js";

const intent = (): ClientIntentBody => ({
  project: { name: "Clinic booking app", goal: "Track work tickets across teams" },
  requirements: [
    { id: "R-1", text: "Patients book appointments online", status: "decided", quote: "patients can book an appointment online", turn: "T-5", speaker: "Alex Morgan", role: "client" },
    { id: "R-2", text: "Video consultations", status: "deferred", quote: "okay yeah, video in phase two, fine", turn: "T-60", speaker: "Alex Morgan", role: "client" },
    { id: "R-3", text: "An SMS reminder the day before", status: "open", quote: "And the reminder goes by uh SMS, the day before", turn: "T-60", speaker: "Alex Morgan", role: "client" },
  ],
  constraints: [{ id: "C-1", text: "Map provider is our choice" }], openQuestions: [{ id: "Q-1", text: "Which map provider?" }],
  warnings: ["Second project 'Project Comet' from 00:48:32; not distilled."],
  speakers: [{ name: "Alex Morgan", role: "client", source: "default" }, { name: "Jordan Lee", role: "team", source: "roster" }],
  dropped: [], skill: { name: "transcript-distill", sha256: "a".repeat(64) }, edits: 0,
});

describe("intent edits", () => {
  it("reads edit decisions on intent cards, oldest first", () => {
    const decisions = [
      { cardId: "intent-1", decision: "edit", by: "o", artifactSha: "x", edits: { remove: ["R-3"] }, reason: "not asked" },
      { cardId: "estimate-1", decision: "edit", by: "o", artifactSha: "y", edits: { anchors: {} }, reason: "z" },
    ] as never;
    expect(intentEditsOf({ decisions })).toEqual([{ remove: ["R-3"], by: "o", reason: "not asked" }]);
  });
  it("refuses unknown ids, statuses and speakers, and an empty edit", () => {
    expect(checkIntentEdit({ status: { "R-9": "decided" } }, intent())).toEqual(["R-9 is not a requirement (R-1, R-2, R-3)"]);
    expect(checkIntentEdit({ status: { "R-1": "maybe" as never } }, intent())).toEqual(["maybe is not a status (decided, deferred, excluded, open)"]);
    expect(checkIntentEdit({ roles: { Zed: "team" } }, intent())).toEqual(["Zed is not a speaker (Alex Morgan, Jordan Lee)"]);
    expect(checkIntentEdit({}, intent())).toEqual(["the edit changes nothing"]);
  });
  it("applies status, remove and add in order; added items take the next id", () => {
    const out = applyIntentEdits(intent(), [
      { status: { "R-3": "decided" }, by: "o", reason: "confirmed by email" },
      { remove: ["R-2"], add: ["Admins can export tickets"], by: "o", reason: "said after the call" },
    ]);
    expect(out.requirements.map((r) => [r.id, r.status])).toEqual([["R-1", "decided"], ["R-3", "decided"], ["R-4", "decided"]]);
    expect(out.requirements[2]!.addedBy).toEqual({ by: "o", note: "said after the call" });
    expect(out.edits).toBe(2);
  });
  it("an added item never takes the id of a dropped one (found testing the 2026-10-14 meeting)", () => {
    const withDropped = { ...intent(), dropped: [{ id: "R-4", text: "x", quote: "q", turn: "T-1", why: "the quote is not in T-1" }] };
    expect(applyIntentEdits(withDropped, [{ add: ["Y"], by: "o", reason: "r" }]).requirements.at(-1)!.id).toBe("R-5");
  });
  it("numbers an added item R-1 when nothing survived", () => {
    const empty = { ...intent(), requirements: [] };
    expect(applyIntentEdits(empty, [{ add: ["X"], by: "o", reason: "r" }]).requirements[0]!.id).toBe("R-1");
  });
  it("the brief puts decided items in, open ones to confirm, the rest out of scope", () => {
    const b = renderBrief(intent(), "Jan 5, 2026");
    expect(b).toContain("# Clinic booking app (from meeting Jan 5, 2026)");
    expect(b).toMatch(/## Requirements\n- R-1: Patients book appointments online/);
    expect(b).toMatch(/## To confirm\n- R-3: An SMS reminder the day before\n- Q-1: Which map provider\?/);
    expect(b).toMatch(/## Out of scope\n- R-2 \(deferred\): Video consultations/);
    expect(b).toMatch(/## Constraints\n- C-1: Map provider is our choice/);
  });
  it("the card shows warnings first, quotes with speaker and role, and the commands", () => {
    const md = intentCard("run-1", intent(), "abcd1234");
    expect(md.indexOf("Second project")).toBeLessThan(md.indexOf("## Requirements"));
    expect(md).toContain('"patients can book an appointment online" (T-5, Alex Morgan, client)');
    expect(md).toContain("factory edit-intent run-1 abcd1234");
    expect(md).toContain("factory approve run-1 abcd1234");
  });
});

describe("an edit sent from the run page", () => {
  it("reads statuses, removals, added lines and roles", () => {
    expect(webIntentEdit({ status: { "R-3": "deferred", "R-1": "" }, remove: ["R-7"], add: "Admins export tickets\n\n  Drivers get SMS  ", roles: { "Jordan Lee": "team" } })).toEqual({
      status: { "R-3": "deferred" }, remove: ["R-7"], add: ["Admins export tickets", "Drivers get SMS"], roles: { "Jordan Lee": "team" },
    });
  });
  it("leaves out what was not changed", () => {
    expect(webIntentEdit({ status: {}, remove: [], add: "  ", roles: {} })).toEqual({});
  });
  it("refuses a malformed body", () => {
    expect(() => webIntentEdit({ status: { "R-3": "maybe" } })).toThrow(/maybe is not a status/);
    expect(() => webIntentEdit({ remove: "R-7" })).toThrow(/remove/);
    expect(() => webIntentEdit({ roles: { A: "boss" } })).toThrow(/client or team/);
    expect(() => webIntentEdit({ add: "x".repeat(2001) })).toThrow(/too long/);
  });
});

describe("edit-intent arguments", () => {
  it("reads repeated flags", () => {
    expect(parseIntentEditArgs({ status: ["R-3=deferred"], remove: ["R-7"], add: ["Admins export tickets"], role: ["Jordan Lee=team"] })).toEqual({
      status: { "R-3": "deferred" }, remove: ["R-7"], add: ["Admins export tickets"], roles: { "Jordan Lee": "team" },
    });
  });
  it("names the argument it cannot read", () => {
    expect(() => parseIntentEditArgs({ status: ["R-3"] })).toThrow(/--status "R-3": use R-3=deferred/);
    expect(() => parseIntentEditArgs({ role: ["Ana=boss"] })).toThrow(/--role "Ana=boss": use "Name=client" or "Name=team"/);
  });
});
