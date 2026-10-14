import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMeetTranscript, parseMeetTranscript, transcriptText } from "./transcript.js";

const sample = readFileSync(new URL("./fixtures/meet-sample.txt", import.meta.url), "utf8");

describe("Meet transcript", () => {
  it("recognises a Gemini Meet export and nothing else", () => {
    expect(isMeetTranscript(sample)).toBe(true);
    expect(isMeetTranscript("# Requirements\n\nUsers can log in.")).toBe(false);
    expect(isMeetTranscript("Alex Morgan: hello")).toBe(false); // no transcript heading
  });
  it("splits Gemini notes from turns and numbers turns in order", () => {
    const t = parseMeetTranscript(sample);
    expect(t.notes).toContain("Decisions");
    expect(t.turns[0]).toMatchObject({ id: "T-1", time: "00:00:41", speaker: "Alex Morgan" });
    expect(t.turns.map((x) => x.id)).toEqual(t.turns.map((_, i) => `T-${i + 1}`));
    expect(t.date).toBe("Jan 5, 2026");
    expect(t.turns).toHaveLength(15);
  });
  it("keeps parsing after a session break", () => {
    const t = parseMeetTranscript(sample);
    expect(t.turns.some((x) => x.time === "00:48:32")).toBe(true);
    expect(t.turns.every((x) => !x.text.includes("Session ended after"))).toBe(true);
  });
  it("lists each speaker once", () => {
    expect([...parseMeetTranscript(sample).speakers].sort()).toEqual(["Alex Morgan", "Jordan Lee", "Sam Rivera"]); // Jordan Lee speaks once
  });
  it("a line that is not a known-speaker prefix continues the previous turn", () => {
    const text = "Meeting X - Transcript\n00:00:01\n\nAna: first line\nNote: this is still Ana\nBen Stone: hi\nAna: again\n";
    const t = parseMeetTranscript(text);
    expect(t.turns).toHaveLength(3);
    expect(t.turns[0]!.text).toBe("first line Note: this is still Ana");
  });
  it("a person who speaks once is still a speaker when Meet shows a full name", () => {
    const text = "Meeting X - Transcript\n00:00:01\nAna: one\nAna: two\nBen Stone: just one line\nIdea: not a person\n";
    const t = parseMeetTranscript(text);
    expect([...t.speakers].sort()).toEqual(["Ana", "Ben Stone"]);
    expect(t.turns.map((x) => x.speaker)).toEqual(["Ana", "Ana", "Ben Stone"]);
  });
  it("a speaker is a name that starts at least two lines, or appears in Gemini's notes", () => {
    const text = "Meeting X - Transcript\n00:00:01\nAna: one\nBen: two\nAna: three\nIdea: not a person\nBen: four\n";
    expect([...parseMeetTranscript(text).speakers].sort()).toEqual(["Ana", "Ben"]);
  });
  it("reads the export as the factory's .docx reader writes it: headings as Markdown", () => {
    const text = "## Meeting Jan 6, 2026 at 09:30 PKT\n\n### Details\n\nNotes here.\n\n## Meeting Jan 6, 2026 at 09:30 PKT - Transcript\n\n### 00:00:41\n\nAna Lee: Okay. Can you hear me?\n\nBen Stone: Yes.\n\n### 00:01:52\n\nAna Lee: Let's start.\n\n### Session ended after 00:16:59\n\n### Transcription ended after 00:22:27\n\nThis editable transcript was computer generated and might contain errors.";
    expect(isMeetTranscript(text)).toBe(true);
    const t = parseMeetTranscript(text);
    expect(t.title).toBe("Meeting Jan 6, 2026 at 09:30 PKT");
    expect(t.turns.map((x) => [x.time, x.speaker, x.text])).toEqual([
      ["00:00:41", "Ana Lee", "Okay. Can you hear me?"], ["00:00:41", "Ben Stone", "Yes."], ["00:01:52", "Ana Lee", "Let's start."],
    ]);
  });
  it("refuses an export with no turns", () => {
    expect(() => parseMeetTranscript("Meeting X - Transcript\n00:00:01\n")).toThrow(/no transcript turns/i);
  });
  it("renders turns for the model", () => {
    expect(transcriptText(parseMeetTranscript(sample)).split("\n")[0]).toMatch(/^T-1 \[00:00:41\] Alex Morgan: /);
  });
});
