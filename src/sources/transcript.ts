// A Google Meet transcript as Gemini exports it to Docs (.docx): Gemini's notes, then a "<title> - Transcript" heading,
// then HH:MM:SS lines and "Name: text" lines. Parsed by code; the distill step reads it (src/stages/distill.ts).
import type { Transcript, Turn } from "../contracts/index.js";

const HEADING = /^(.*) - Transcript\s*$/m;
const TIME = /^(\d{2}:\d{2}:\d{2})\s*$/;
const SPEAKER_LINE = /^([^:\n]{1,60}):\s(.*)$/;
const SKIP = [/^Session ended after /, /^Transcription ended after /, /^This editable transcript was computer generated/];

/** The .docx reader (src/sources/docx.ts) writes Word headings as Markdown (`## Meeting … - Transcript`, `### 00:00:41`): drop the marks. */
const plain = (text: string) => text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");

export function isMeetTranscript(raw: string): boolean {
  const text = plain(raw);
  const m = HEADING.exec(text);
  if (!m) return false;
  const after = text.slice(m.index + m[0].length).split("\n").map((l) => l.trim());
  return after.some((l) => TIME.test(l)) && after.some((l) => SPEAKER_LINE.test(l));
}

/** Meet labels a speaker by their account name: two or more capitalised words ("Sam Rivera"), unlike a word such as "Note". */
const FULL_NAME = /^\p{Lu}[\p{L}'.-]*(\s+\p{Lu}[\p{L}'.-]*)+$/u;

/** A name counts as a speaker when it starts at least two lines, Gemini's notes name it, or it is a full name (one line is enough). */
function speakersOf(lines: string[], notes: string): Set<string> {
  const count = new Map<string, number>();
  for (const l of lines) {
    const m = SPEAKER_LINE.exec(l);
    const name = m?.[1]?.trim();
    if (name && !/^\d/.test(name)) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return new Set([...count].filter(([name, n]) => n >= 2 || notes.includes(name) || FULL_NAME.test(name)).map(([name]) => name));
}

export function parseMeetTranscript(raw: string): Transcript {
  const text = plain(raw);
  const m = HEADING.exec(text);
  if (!m) throw new Error("Not a Google Meet transcript: the \"- Transcript\" heading is missing.");
  const notes = text.slice(0, m.index).trim();
  const lines = text.slice(m.index + m[0].length).split("\n").map((l) => l.trim()).filter((l) => l && !SKIP.some((r) => r.test(l)));
  const names = speakersOf(lines, notes);
  const turns: Turn[] = [];
  let time = "00:00:00";
  for (const l of lines) {
    const t = TIME.exec(l);
    if (t) { time = t[1]!; continue; }
    const s = SPEAKER_LINE.exec(l);
    if (s && names.has(s[1]!.trim())) turns.push({ id: `T-${turns.length + 1}`, time, speaker: s[1]!.trim(), text: s[2]!.trim() });
    else if (turns.length) turns[turns.length - 1]!.text += ` ${l}`;
  }
  if (!turns.length) throw new Error("No transcript turns found in this Meet export.");
  const title = m[1]!.trim();
  const date = /\b([A-Z][a-z]{2} \d{1,2}, \d{4})\b/.exec(title)?.[1];
  return { format: "gemini-meet", title, ...(date ? { date } : {}), notes, turns, speakers: [...new Set(turns.map((x) => x.speaker))] };
}

/** The turns as the model reads them: one `T-n [time] Speaker: text` line each. */
export function transcriptText(t: Transcript): string {
  return t.turns.map((x) => `${x.id} [${x.time}] ${x.speaker}: ${x.text}`).join("\n");
}
