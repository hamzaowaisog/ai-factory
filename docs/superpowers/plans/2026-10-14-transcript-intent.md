# Transcript to Client Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google Meet transcript (.docx) becomes a request source: a new `distill` step extracts the client's intent with verified quotes, a human edits and approves it on an intent card, and the approved brief becomes intake's request in every mode.

**Architecture:** Parsing, roles, the quote check, card edits and the brief are plain code; one model call (route `distill`) reads the transcript under the `transcript-distill` skill. The step waits on an `intent` card using the existing wait/decision mechanism (edits recorded as `edit` decisions, like `edit-estimate`). `stepsFor` puts the distill step at the head of transcript runs, and replay replaces `info.request` with the approved brief so every later step is unchanged.

**Tech Stack:** TypeScript (ESM, NodeNext), zod v4, vitest, commander, JSZip (existing `readDocx`).

**Spec:** `docs/superpowers/specs/2026-10-14-transcript-intent-design.md` (team doc: https://claude.ai/code/artifact/16d523d6-bcd6-4ca6-9f59-6bf92035a093)

## Global Constraints

- Only Google Meet Gemini exports are transcripts; any other .docx behaves exactly as today.
- A transcript run has exactly one distill step; seeded runs (`--from-estimate`, `--from-design`, sibling, resize) never distill.
- Quotes are checked by code against the cited turn; a requirement is never kept on the model's word alone.
- Statuses are exactly `decided | deferred | excluded | open`.
- Human decisions on the intent card are terminal-only (`assertTty()`), like every other card.
- Decided: a second project in a transcript is a non-blocking warning shown first on the card (option A); nothing in code blocks approval on it.
- PENDING items use these defaults, each in one constant: repair threshold `REPAIR_DROP_SHARE = 0.2`; hands-off still shows the card; distill tier heavy, effort medium.
- Distill marks the transcript for prompt caching (`CACHE_TRANSCRIPT = true`, one constant) so a repair re-reads it at the cache price.
- Skill lookup order: `<repo>/.claude/skills/transcript-distill/SKILL.md`, then `~/.factory/skills/transcript-distill/SKILL.md`, then `.agents/skills/transcript-distill/SKILL.md`.
- Never append `Co-Authored-By: Claude` to commits (user rule).
- Delete nothing permanently; if a file must go, use the recycle bin (user rule).

## Review Focus

1. A Meet export whose turns span "Session ended after" breaks and resumes (the sample has two sessions) - turns after the break must still parse and number on. Pinned in Task 2.
2. A speaker name with a colon-like pattern inside text ("Note: we need X" said mid-turn) must not start a fake turn - continuation lines without a known-speaker prefix stay in the previous turn. Pinned in Task 2.
3. Quotes with curly apostrophes vs straight ones ("let’s" vs "let's") must match. Pinned in Task 5.
4. `edit-intent --add` on a card where every requirement was dropped (R-numbering starts at R-1, not NaN). Pinned in Task 6.
5. Resuming after an edit must not call the model again (cost) - pinned in Task 9 by counting provider calls.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/contracts/artifacts.ts` (modify) | `Turn`, `Transcript`, `IntentStatus`, `DistillOut`, `ClientIntent` schemas |
| `src/contracts/common.ts` (modify) | add `"distill"` to `StageName` |
| `src/sources/transcript.ts` (new) | detect + parse a Gemini Meet export into a `Transcript`; render it as text |
| `src/sources/fixtures/meet-sample.txt` (new) | a small invented meeting in the .docx reader's format, for tests (no real meeting is committed) |
| `src/sources/request.ts` (modify) | `.docx` that is a Meet export → source kind `transcript`, `GatheredRequest.transcript` |
| `src/stages/executor.ts` (modify) | `createRun` stores the transcript artifact, `transcriptSha` in `run.created` |
| `src/ledger/state.ts` (modify) | `RunInfo.transcriptSha`, source kind; replay: distill's `data.brief` → `info.request` |
| `src/config/team.ts` (new) | roster: shared `~/.factory/team.yaml` + per-project `~/.factory/projects/<project>/team.yaml` → `rolesFor(speakers)`; add/remove |
| `src/cli/index.ts` (modify, Task 4) | `factory team list|add|remove [--project]` |
| `src/stages/quote-check.ts` (new) | normalise + verify quotes against turns |
| `src/stages/intent-edits.ts` (new) | read/validate/apply card edits; render brief and card markdown |
| `src/stages/distill-skill.ts` (new) | find + read the skill, with its sha256 |
| `src/stages/models.ts`, `src/stages/routing.ts`, `src/ui/static/app.js` (modify) | `distill` route and its model-picker dropdown |
| `src/context/pack.ts`, `src/runners/api.ts`, `src/stages/think.ts` (modify) | `userStable` + `cacheBriefing`: cache the briefing's stable head (Task 8b) |
| `src/stages/distill.ts` (new) | the distill step |
| `src/stages/modes.ts` (modify) | `withDistill` in `stepsFor` |
| `src/cli/index.ts`, `src/cli/design-runs.ts` (modify) | pass `transcript` to `createRun`; `edit-intent` command |

---

### Task 1: Contracts

**Files:**
- Modify: `src/contracts/artifacts.ts` (after `export type Intent` near line 96)
- Modify: `src/contracts/common.ts:43-47` (StageName)
- Test: `src/contracts/transcript-contracts.test.ts`

**Interfaces:**
- Produces: `Turn`, `Transcript`, `IntentStatus`, `DistillOut`, `ClientIntentBody`, `ClientIntent` (zod + types), all exported from `src/contracts/index.js`; `StageName` includes `"distill"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/contracts/transcript-contracts.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/contracts/transcript-contracts.test.ts`
Expected: FAIL - `Transcript` / `DistillOut` / `ClientIntentBody` not exported.

- [ ] **Step 3: Implement**

In `src/contracts/common.ts`, add `"distill"` to the `// stages-aligned §6 additions` line:

```ts
  "discover-read", "sketches", "clarifier", "merge", "lint", "critic", "round-trip",
  "spec-gate", "design-read", "design-mock", "stub-commit", "a5-check",
  "conflict-resolve", "revise-classify", "distill",
```

In `src/contracts/artifacts.ts`, after `export type Intent = z.infer<typeof Intent>;`:

```ts
/** A Google Meet transcript (Gemini notes export), parsed by code (src/sources/transcript.ts). */
export const Turn = z.object({ id: Id, time: z.string(), speaker: z.string(), text: z.string() });
export type Turn = z.infer<typeof Turn>;
export const Transcript = z.object({
  format: z.literal("gemini-meet"), title: z.string().optional(), date: z.string().optional(),
  /** Gemini's own notes: unverified, a pointer for the model, never evidence */
  notes: z.string(), turns: z.array(Turn).min(1), speakers: z.array(z.string()),
});
export type Transcript = z.infer<typeof Transcript>;

export const IntentStatus = z.enum(["decided", "deferred", "excluded", "open"]);
export type IntentStatus = z.infer<typeof IntentStatus>;
export const SpeakerRole = z.object({ name: z.string(), role: z.enum(["client", "team"]), source: z.enum(["roster", "default", "card"]) });
export type SpeakerRole = z.infer<typeof SpeakerRole>;

/** distill: the model's answer (speaker and role are filled in by code from the turn). */
export const DistillOut = z.object({
  project: z.object({ name: z.string().optional(), goal: z.string() }),
  requirements: z.array(z.object({ id: Id, text: z.string(), status: IntentStatus, quote: z.string(), turn: Id, supersedes: z.array(z.string()).optional() })),
  constraints: z.array(z.object({ id: Id, text: z.string(), quote: z.string().optional(), turn: Id.optional() })),
  openQuestions: z.array(z.object({ id: Id, text: z.string(), turn: Id.optional() })),
  warnings: z.array(z.string()),
});
export type DistillOut = z.infer<typeof DistillOut>;

/** distill: the client intent as stored and shown on the intent card. */
export const ClientIntentBody = DistillOut.extend({
  requirements: z.array(z.object({
    id: Id, text: z.string(), status: IntentStatus, quote: z.string().optional(), turn: Id.optional(), supersedes: z.array(z.string()).optional(),
    speaker: z.string().optional(), role: z.enum(["client", "team"]).optional(),
    addedBy: z.object({ by: z.string(), note: z.string() }).optional(),
  })),
  speakers: z.array(SpeakerRole),
  dropped: z.array(z.object({ id: Id, text: z.string(), quote: z.string(), turn: z.string(), why: z.string() })),
  skill: z.object({ name: z.string(), sha256: z.string() }),
  edits: z.number().int().min(0),
});
export type ClientIntentBody = z.infer<typeof ClientIntentBody>;
export const ClientIntent = withHeader(ClientIntentBody.shape);
export type ClientIntent = z.infer<typeof ClientIntent>;
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/contracts/transcript-contracts.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/artifacts.ts src/contracts/common.ts src/contracts/transcript-contracts.test.ts
git commit -m "Add transcript and client-intent contracts"
```

---

### Task 2: Transcript parser

**Files:**
- Create: `src/sources/transcript.ts`
- Create: `src/sources/fixtures/meet-sample.txt` (a small **invented** meeting written in the format the factory's .docx reader produces: `##`/`###` headings, Gemini-style notes, timestamped turns, a `Session ended after` break, a speaker who talks once, a speech-to-text error, a scope change and a second project. No real meeting is committed.)
- Test: `src/sources/transcript.test.ts`

**Interfaces:**
- Consumes: `Transcript`, `Turn` (Task 1).
- Produces: `isMeetTranscript(text: string): boolean`, `parseMeetTranscript(text: string): Transcript`, `transcriptText(t: Transcript): string` (turns as `T-n [time] Speaker: text` lines).

- [ ] **Step 1: Write the fixture**

Write the invented meeting by hand (about 60 lines). To match the real format, compare it with what the reader gives for any
Meet export you have locally (do not commit that output):

```bash
npx tsx -e "import('./src/sources/docx.ts').then(async m => console.log((await m.readDocx(require('node:fs').readFileSync(process.argv[1]))).text))" "<your Meet export>.docx"
```

Check the fixture has `## Meeting Jan 5, 2026 at 10:00 PKT - Transcript`, `### 00:00:41`, `### Session ended after 00:16:59`, `### 00:48:32`.

- [ ] **Step 2: Write the failing test**

```ts
// src/sources/transcript.test.ts
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
  });
  it("keeps parsing after a session break", () => {
    const t = parseMeetTranscript(sample);
    expect(t.turns.some((x) => x.time === "00:48:32")).toBe(true);
    expect(t.turns.every((x) => !x.text.includes("Session ended after"))).toBe(true);
  });
  it("lists each speaker once", () => {
    expect(parseMeetTranscript(sample).speakers.sort()).toEqual(["Sam Rivera", "Alex Morgan", "Jordan Lee"]);
  });
  it("a line that is not a known-speaker prefix continues the previous turn", () => {
    const text = "Meeting X - Transcript\n00:00:01\n\nAna: first line\nNote: this is still Ana\nBen: hi\nAna: again\n";
    const t = parseMeetTranscript(text);
    expect(t.turns).toHaveLength(3);
    expect(t.turns[0]!.text).toBe("first line Note: this is still Ana");
  });
  it("a speaker is a name that starts a line before at least two turns, or appears in Gemini's notes", () => {
    const text = "Meeting X - Transcript\n00:00:01\nAna: one\nBen: two\nAna: three\nIdea: not a person\n";
    expect(parseMeetTranscript(text).speakers.sort()).toEqual(["Ana", "Ben"]);
  });
  it("refuses an export with no turns", () => {
    expect(() => parseMeetTranscript("Meeting X - Transcript\n00:00:01\n")).toThrow(/no transcript turns/);
  });
  it("renders turns for the model", () => {
    expect(transcriptText(parseMeetTranscript(sample)).split("\n")[0]).toMatch(/^T-1 \[00:00:41\] Alex Morgan: /);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/sources/transcript.test.ts`
Expected: FAIL - module `./transcript.js` not found.

- [ ] **Step 4: Implement**

```ts
// src/sources/transcript.ts
// A Google Meet transcript as Gemini exports it to Docs (.docx): Gemini's notes, then a "<title> - Transcript" heading,
// then HH:MM:SS lines and "Name: text" lines. Parsed by code; the distill step reads it (src/stages/distill.ts).
import type { Transcript, Turn } from "../contracts/index.js";

const HEADING = /^(.*) - Transcript\s*$/m;
const TIME = /^(\d{2}:\d{2}:\d{2})\s*$/;
const SPEAKER_LINE = /^([^:\n]{1,60}):\s(.*)$/;
const SKIP = [/^Session ended after /, /^Transcription ended after /, /^This editable transcript was computer generated/];

export function isMeetTranscript(text: string): boolean {
  const m = HEADING.exec(text);
  if (!m) return false;
  const after = text.slice(m.index + m[0].length);
  return after.split("\n").some((l) => TIME.test(l.trim())) && after.split("\n").some((l) => SPEAKER_LINE.test(l.trim()));
}

/** A name counts as a speaker when it starts at least two lines, or Gemini's notes name it. */
function speakersOf(lines: string[], notes: string): Set<string> {
  const count = new Map<string, number>();
  for (const l of lines) {
    const m = SPEAKER_LINE.exec(l);
    if (m && !/^\d/.test(m[1]!)) count.set(m[1]!.trim(), (count.get(m[1]!.trim()) ?? 0) + 1);
  }
  return new Set([...count].filter(([name, n]) => n >= 2 || notes.includes(name)).map(([name]) => name));
}

export function parseMeetTranscript(text: string): Transcript {
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
  const date = /\b([A-Z][a-z]{2} \d{1,2}, \d{4})\b/.exec(m[1]!)?.[1];
  return { format: "gemini-meet", title: m[1]!.trim(), ...(date ? { date } : {}), notes, turns, speakers: [...new Set(turns.map((x) => x.speaker))] };
}

export function transcriptText(t: Transcript): string {
  return t.turns.map((x) => `${x.id} [${x.time}] ${x.speaker}: ${x.text}`).join("\n");
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/sources/transcript.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/sources/transcript.ts src/sources/transcript.test.ts src/sources/fixtures/meet-sample.txt
git commit -m "Parse Google Meet transcripts into turns"
```

---

### Task 3: Request intake and run creation

**Files:**
- Modify: `src/sources/request.ts` (`RequestSource.kind`, `GatheredRequest`, the `.docx` branch of `gatherRequest`)
- Modify: `src/ledger/state.ts:70` (`RunInfo.sources` kind union) and add `transcriptSha?: string` to `RunInfo`
- Modify: `src/stages/executor.ts:94-165` (`createRun` opts + `run.created` data)
- Modify: `src/cli/index.ts:115`, `src/cli/index.ts:199`, `src/cli/design-runs.ts:100` (pass `transcript`)
- Modify: `src/ui/start.ts:333` (the web start form's `createRun`: pass `transcript`; its upload already goes through `gatherRequest` at `:316`, like `--file`)
- Modify: `src/ui/static/app.js:411` (drop-zone hint mentions meeting transcripts)
- Test: `src/sources/sources.test.ts` (add cases), `src/stages/transcript-run.test.ts` (new), `src/ui/ui.test.ts` (add a case after `:398`)

How a transcript is given, in every entry point (nothing new to learn: the existing file inputs take it):

| Where | How |
|---|---|
| Build (brownfield / greenfield) | `factory start --project shop --file "Meeting ... - Notes by Gemini.docx"` |
| Estimate | `factory estimate --file "Meeting ... .docx"` (with or without `--project`) |
| Design-only | `factory design start --file "Meeting ... .docx"` |
| Web UI | New run → drop the .docx on "Drop a .md, .txt, .docx or .pdf file here" (up to 50 MB, `reqMax` in `app.js:240`) |

The .docx is the one Google Meet saves to Drive ("Notes by Gemini", with the transcript at the end). Download it from Drive
(File → Download → Microsoft Word) and pass that file. Detection is automatic (`isMeetTranscript`): no flag is needed, and any
other .docx is read as an ordinary document. A transcript must be the whole request: a typed prompt, `--jira` or frames beside it
are refused with a message.

**Interfaces:**
- Consumes: `isMeetTranscript`, `parseMeetTranscript`, `transcriptText` (Task 2).
- Produces: `GatheredRequest.transcript?: Transcript`; `RequestSource.kind` includes `"transcript"`; `createRun(..., { transcript?: Transcript })` stores it with `ledger.putJson` and writes `transcriptSha` in `run.created`, so `state.info.transcriptSha` is set; `info.request` = `transcriptText(transcript)` at creation.

- [ ] **Step 1: Write the failing tests**

Add to `src/sources/sources.test.ts` (it already builds .docx files in tests; reuse its docx helper - search the file for the helper that writes a minimal `word/document.xml`, and call it with the fixture's text split into paragraphs):

```ts
import { readFileSync } from "node:fs";
it("a Meet export is a transcript source with parsed turns", async () => {
  const text = readFileSync(new URL("./fixtures/meet-sample.txt", import.meta.url), "utf8");
  const file = writeDocx(text.split("\n"));          // the file's existing docx helper
  const r = await gatherRequest({ file });
  expect(r.sources[0]!.kind).toBe("transcript");
  expect(r.transcript!.turns.length).toBeGreaterThan(50);
  expect(r.text.split("\n")[0]).toMatch(/^T-1 \[00:00:41\]/);
});
it("an ordinary .docx stays a docx source", async () => {
  const r = await gatherRequest({ file: writeDocx(["Requirements", "Users can log in."]) });
  expect(r.sources[0]!.kind).toBe("docx");
  expect(r.transcript).toBeUndefined();
});
```

New `src/stages/transcript-run.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-tr-")); });

it("run.created carries the transcript's sha into the run info", async () => {
  const l = Ledger.create(`20261014-tr-${Math.random().toString(16).slice(2, 6)}`);
  const t = { format: "gemini-meet", notes: "", turns: [{ id: "T-1", time: "00:00:01", speaker: "A", text: "hi" }], speakers: ["A"] };
  const sha = l.putJson(t);
  await l.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "T-1 [00:00:01] A: hi", operator: "sam", transcriptSha: sha, sources: [{ kind: "transcript", name: "m.docx" }] } }, HUMAN_WRITER);
  expect(replay(l.events()).info.transcriptSha).toBe(sha);
});
```

Add to `src/ui/ui.test.ts`, after the test "an uploaded Word document is read like --file" (it uses that file's `post` and `makeDocx` helpers; import `readFileSync` from `node:fs` if the file does not already):

```ts
it("an uploaded Meet transcript starts a transcript run", async () => {
  const text = readFileSync(new URL("../sources/fixtures/meet-sample.txt", import.meta.url), "utf8");
  const r = await post({ project: "web", file: { name: "meeting.docx", data: (await makeDocx(text.split("\n"))).toString("base64") } });
  expect(r.status).toBe(201);
  const s = replay(Ledger.open(r.json().runId).events());
  expect(s.info.sources?.map((x) => x.kind)).toEqual(["transcript"]);
  expect(s.info.transcriptSha).toMatch(/^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/sources/sources.test.ts src/stages/transcript-run.test.ts`
Expected: FAIL - kind is `docx`; `transcriptSha` missing from the `RunInfo` type (typecheck) / undefined.

- [ ] **Step 3: Implement**

`src/sources/request.ts`:

```ts
import type { Transcript } from "../contracts/index.js";
import { isMeetTranscript, parseMeetTranscript, transcriptText } from "./transcript.js";

export interface RequestSource { kind: "prompt" | "file" | "jira" | "docx" | "pdf" | "frames" | "transcript"; name?: string; key?: string; url?: string; summary?: string }
export interface GatheredRequest { text: string; sources: RequestSource[]; attachments: Attachment[]; /** a Google Meet export: the distill step reads it */ transcript?: Transcript }
```

In the `.docx` branch, after `const d = await readDocx(...)`:

```ts
    if (isMeetTranscript(d.text)) {
      transcript = parseMeetTranscript(d.text);
      parts.push({ heading: `Meeting ${basename(o.file)}`, text: transcriptText(transcript), source: { kind: "transcript", name: basename(o.file), summary: `${transcript.turns.length} turns, ${transcript.speakers.length} speakers` } });
    } else {
      attachments.push(...d.images.map((i) => ({ name: `docx/${i.name}`, bytes: i.bytes })));
      parts.push({ heading: `From ${basename(o.file)}`, text: d.text, source: { kind: "docx", name: basename(o.file), summary: `${d.headings} headings, ${d.tables} tables, ${d.images.length} images` } });
    }
```

Declare `let transcript: Transcript | undefined;` at the top of `gatherRequest`, and before the size check add:

```ts
  if (transcript && parts.length > 1) throw new Error("A meeting transcript is the whole request: drop the prompt, --jira and frames, or send them in a later run.");
```

Return `{ text, sources: ..., attachments, ...(transcript ? { transcript } : {}) }`. Update `describeSources` so `kind === "transcript"` prints `meeting ${s.name}`.

`src/ledger/state.ts` `RunInfo`: add `"transcript"` to the `sources` kind union and

```ts
  /** a Google Meet transcript request: the parsed transcript's artifact; the distill step reads it, and its approved brief replaces `request` */
  transcriptSha?: string;
```

`src/stages/executor.ts` `createRun`: add `transcript?: Transcript` to `opts` (import the type from `../contracts/index.js`), and before `ledger.append({ type: "run.created", ...})`:

```ts
  const transcriptSha = opts.transcript ? ledger.putJson(opts.transcript) : undefined;
```

and in the `data` object: `...(transcriptSha ? { transcriptSha } : {}),`.

CLI call sites (`src/cli/index.ts:115`, `src/cli/index.ts:199`, `src/cli/design-runs.ts:100`): add to the `createRun` options object

```ts
      ...("transcript" in req && req.transcript ? { transcript: req.transcript } : {}),
```

The same line goes into the web start path's `createRun` options at `src/ui/start.ts:333` (its `req` comes from the same
`gatherRequest`, or from a seed, which has no transcript).

`src/ui/static/app.js:411`, the drop-zone hint:

```js
  const drop = h("label", { class: "drop" }, fileInput, icon("upload"), h("strong", {}, "Drop a .md, .txt, .docx or .pdf file here"), h("span", { class: "small" }, "or click to choose one · read like --file · a Google Meet transcript (.docx) is read as a meeting"));
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/sources src/stages/transcript-run.test.ts src/ui/ui.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/request.ts src/sources/sources.test.ts src/ledger/state.ts src/stages/executor.ts src/stages/transcript-run.test.ts src/cli/index.ts src/cli/design-runs.ts src/ui/start.ts src/ui/static/app.js src/ui/ui.test.ts
git commit -m "Accept a Meet transcript as a request and store it with the run"
```

---

### Task 4: Team roster and `factory team`

The roster says which meeting speakers are **our team**; everyone else is the client (spec §4). It has two layers, merged:
the shared roster for everyone on this machine, and one roster per project. Each project's roster is its own file beside the
project's other per-project data (`~/.factory/projects/<project>/`, as `src/conventions/store.ts` keeps conventions), so the
command never rewrites the hand-written project YAML. A person may be listed with aliases, because Meet labels speakers by
their account name ("Sam Rivera") while people say short forms. Roles changed on the intent card apply to that run only.

**Files:**
- Create: `src/config/team.ts`
- Modify: `src/cli/index.ts` (a `team` command group next to `init`, ~line 569)
- Test: `src/config/team.test.ts`

**Interfaces:**
- Consumes: `SpeakerRole` (Task 1), `factoryHome()` (`src/util/paths.js`).
- Produces:
  - `interface Member { name: string; aliases?: string[]; note?: string }`
  - `interface Roster { members: Member[]; domains: string[]; found: boolean }`
  - `rosterPath(project?: string): string` (`~/.factory/team.yaml` or `~/.factory/projects/<project>/team.yaml`)
  - `readRoster(project?: string): Omit<Roster, "found">` (one layer)
  - `loadRoster(project: string | undefined): Roster` (shared + project, project last)
  - `addMember(m: Member, project?: string): void`, `removeMember(name: string, project?: string): boolean`
  - `rolesFor(speakers: string[], roster: Roster, cardRoles?: Record<string, "client" | "team">): SpeakerRole[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/config/team.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addMember, loadRoster, readRoster, removeMember, rolesFor, rosterPath } from "./team.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-team-")); });

describe("roster", () => {
  it("keeps the shared roster and each project's roster in their own files", () => {
    expect(rosterPath()).toBe(join(process.env.FACTORY_HOME!, "team.yaml"));
    expect(rosterPath("shop")).toBe(join(process.env.FACTORY_HOME!, "projects", "shop", "team.yaml"));
  });
  it("adds and removes members; adding the same name twice updates it", () => {
    addMember({ name: "Sam Rivera" });
    addMember({ name: "Jordan Lee", aliases: ["Jordan"], note: "architect" }, "shop");
    addMember({ name: "Jordan Lee", aliases: ["Jordan", "J. Lee"] }, "shop");
    expect(readRoster("shop").members).toEqual([{ name: "Jordan Lee", aliases: ["Jordan", "J. Lee"], note: "architect" }]);
    expect(removeMember("jordan lee", "shop")).toBe(true);
    expect(removeMember("Nobody", "shop")).toBe(false);
  });
  it("merges the shared roster with the project's", () => {
    addMember({ name: "Sam Rivera" });
    addMember({ name: "Jordan Lee" }, "shop");
    const r = loadRoster("shop");
    expect(r.members.map((m) => m.name)).toEqual(["Sam Rivera", "Jordan Lee"]);
    expect(r.found).toBe(true);
    expect(loadRoster(undefined).members.map((m) => m.name)).toEqual(["Sam Rivera"]);
  });
  it("matches names and aliases ignoring case and spaces; anyone else is the client", () => {
    addMember({ name: "Jordan Lee", aliases: ["Jordan"] }, "shop");
    expect(rolesFor(["Alex Morgan", "jordan  lee", "JORDAN"], loadRoster("shop"))).toEqual([
      { name: "Alex Morgan", role: "client", source: "default" },
      { name: "jordan  lee", role: "team", source: "roster" },
      { name: "JORDAN", role: "team", source: "roster" },
    ]);
  });
  it("a role set on the intent card wins for that run", () => {
    expect(rolesFor(["A"], loadRoster(undefined), { A: "team" })).toEqual([{ name: "A", role: "team", source: "card" }]);
  });
  it("no roster at all is not an error, and says so", () => {
    expect(loadRoster("shop")).toEqual({ members: [], domains: [], found: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/config/team.test.ts`
Expected: FAIL - module `./team.js` not found.

- [ ] **Step 3: Implement the roster**

```ts
// src/config/team.ts
// Who is on our side of a meeting (spec §4). ~/.factory/team.yaml is shared by every project on this machine;
// ~/.factory/projects/<project>/team.yaml adds that project's people. A speaker on neither is the client.
// A role set on the intent card wins for that run only. `factory team` edits these files; nothing else writes them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { SpeakerRole } from "../contracts/index.js";
import { factoryHome } from "../util/paths.js";

export interface Member { name: string; aliases?: string[]; note?: string }
export interface Roster { members: Member[]; domains: string[]; found: boolean }

const key = (n: string) => n.toLowerCase().replace(/\s+/g, " ").trim();
export const rosterPath = (project?: string): string => project ? join(factoryHome(), "projects", project, "team.yaml") : join(factoryHome(), "team.yaml");

export function readRoster(project?: string): Omit<Roster, "found"> {
  const p = rosterPath(project);
  if (!existsSync(p)) return { members: [], domains: [] };
  const y = (parse(readFileSync(p, "utf8")) ?? {}) as { members?: Member[]; domains?: string[] };
  return { members: y.members ?? [], domains: y.domains ?? [] };
}

function write(r: Omit<Roster, "found">, project?: string): void {
  const p = rosterPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `# Our team, for meeting transcripts: a speaker listed here is the team, anyone else the client. Edit with factory team.\n${stringify(r)}`);
}

export function addMember(m: Member, project?: string): void {
  const r = readRoster(project);
  const at = r.members.findIndex((x) => key(x.name) === key(m.name));
  const merged = at < 0 ? m : { ...r.members[at]!, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) };
  write({ ...r, members: at < 0 ? [...r.members, merged] : r.members.map((x, i) => (i === at ? merged : x)) }, project);
}

export function removeMember(name: string, project?: string): boolean {
  const r = readRoster(project);
  const left = r.members.filter((x) => key(x.name) !== key(name));
  if (left.length === r.members.length) return false;
  write({ ...r, members: left }, project);
  return true;
}

export function loadRoster(project: string | undefined): Roster {
  const shared = readRoster(), own = project ? readRoster(project) : { members: [], domains: [] };
  const byName = new Map<string, Member>();
  for (const m of [...shared.members, ...own.members]) byName.set(key(m.name), m);
  return {
    members: [...byName.values()], domains: [...new Set([...shared.domains, ...own.domains])],
    found: existsSync(rosterPath()) || (!!project && existsSync(rosterPath(project))),
  };
}

export function rolesFor(speakers: string[], roster: Roster, cardRoles: Record<string, "client" | "team"> = {}): SpeakerRole[] {
  const team = new Set(roster.members.flatMap((m) => [m.name, ...(m.aliases ?? [])]).map(key));
  return speakers.map((name) => cardRoles[name] ? { name, role: cardRoles[name]!, source: "card" as const }
    : team.has(key(name)) ? { name, role: "team" as const, source: "roster" as const }
    : { name, role: "client" as const, source: "default" as const });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/config/team.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add `factory team` to the CLI**

In `src/cli/index.ts`, next to the `init` command (imports: `addMember`, `loadRoster`, `readRoster`, `removeMember`, `rosterPath` from `../config/team.js`):

```ts
const team = program.command("team").description("our people, for meeting transcripts: a speaker on this list is the team, anyone else the client");
const where = (project?: string) => (project ? `project ${project}` : "every project on this machine");
team.command("list").option("--project <name>", "this project's roster with the shared one (leave it out for the shared roster only)")
  .action((o: { project?: string }) => {
    if (o.project) loadProject(o.project); // an unknown project is an error, not an empty roster
    const r = o.project ? loadRoster(o.project) : { ...readRoster(), found: true };
    if (!r.members.length) return log(`No one on the roster for ${where(o.project)}. Add people with: factory team add "Full Name"${o.project ? ` --project ${o.project}` : ""}`);
    for (const m of r.members) log(`- ${m.name}${m.aliases?.length ? ` (also: ${m.aliases.join(", ")})` : ""}${m.note ? `: ${m.note}` : ""}`);
  });
team.command("add").argument("<name>", "the name as Google Meet shows it, e.g. \"Sam Rivera\"")
  .option("--alias <name>", "another name this person appears under; repeat it", (v: string, prev: string[] = []) => [...prev, v])
  .option("--note <text>", "who they are, e.g. architect")
  .option("--project <name>", "add to this project's roster (leave it out to add for every project)")
  .action((name: string, o: { alias?: string[]; note?: string; project?: string }) => {
    if (o.project) loadProject(o.project);
    if (!name.trim()) throw new Error("Give a name.");
    addMember({ name: name.trim(), ...(o.alias?.length ? { aliases: o.alias } : {}), ...(o.note ? { note: o.note } : {}) }, o.project);
    log(`${name.trim()} is on the roster for ${where(o.project)} (${rosterPath(o.project)}).`);
  });
team.command("remove").argument("<name>").option("--project <name>", "remove from this project's roster")
  .action((name: string, o: { project?: string }) => {
    log(removeMember(name, o.project) ? `${name} is off the roster for ${where(o.project)}.` : `${name} is not on the roster for ${where(o.project)}.`);
  });
```

- [ ] **Step 6: Check the command by hand**

```bash
npm run build
node dist/cli/index.js team add "Sam Rivera"
node dist/cli/index.js team add "Jordan Lee" --alias Jordan --note architect --project <an existing project>
node dist/cli/index.js team list --project <that project>
node dist/cli/index.js team remove "Sam Rivera"
```

Expected: the list shows both people (the shared one first) and the files appear at the paths printed.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/config/team.ts src/config/team.test.ts src/cli/index.ts
git commit -m "Add the team roster and factory team"
```

---

### Task 5: Quote check

**Files:**
- Create: `src/stages/quote-check.ts`
- Test: `src/stages/quote-check.test.ts`

**Interfaces:**
- Consumes: `DistillOut`, `Turn` (Task 1).
- Produces: `normalise(s: string): string`, `checkQuotes(out: DistillOut, turns: Turn[]): { kept: DistillOut["requirements"]; dropped: { id: string; text: string; quote: string; turn: string; why: string }[] }`, `REPAIR_DROP_SHARE = 0.2`, `needsRepair(kept: number, dropped: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stages/quote-check.test.ts
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
    expect(r.dropped[1]!.why).toMatch(/3 words/);
  });
  it("asks for a repair above 20% dropped or with nothing kept", () => {
    expect(needsRepair(8, 2)).toBe(false);
    expect(needsRepair(7, 3)).toBe(true);
    expect(needsRepair(0, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/quote-check.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/quote-check.ts
// Every requirement the model keeps must quote its cited turn. Speech-to-text is messy, so both sides are normalised first:
// case, punctuation, curly quotes, fillers and spacing do not count. The skill asks for 5-25 words; the check takes 3-40.
import type { DistillOut, Turn } from "../contracts/index.js";

export const REPAIR_DROP_SHARE = 0.2; // PENDING team decision (spec §4)
const FILLERS = new Set(["uh", "um", "uhm", "hmm", "erm"]);
const MIN_WORDS = 3, MAX_WORDS = 40;

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[’‘`]/g, "'").replace(/'/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter((w) => w && !FILLERS.has(w)).join(" ");
}

export interface Dropped { id: string; text: string; quote: string; turn: string; why: string }

export function checkQuotes(out: DistillOut, turns: Turn[]): { kept: DistillOut["requirements"]; dropped: Dropped[] } {
  const byId = new Map(turns.map((t) => [t.id, ` ${normalise(t.text)} `]));
  const kept: DistillOut["requirements"] = [], dropped: Dropped[] = [];
  for (const r of out.requirements) {
    const q = normalise(r.quote), words = q ? q.split(" ").length : 0, turn = byId.get(r.turn);
    const why = !turn ? `no turn ${r.turn}`
      : words < MIN_WORDS ? `the quote is ${words} words; at least ${MIN_WORDS}`
      : words > MAX_WORDS ? `the quote is ${words} words; at most ${MAX_WORDS}`
      : !turn.includes(` ${q} `) ? `the quote is not in ${r.turn}`
      : undefined;
    if (why) dropped.push({ id: r.id, text: r.text, quote: r.quote, turn: r.turn, why }); else kept.push(r);
  }
  return { kept, dropped };
}

export function needsRepair(kept: number, dropped: number): boolean {
  return kept === 0 || dropped / (kept + dropped) > REPAIR_DROP_SHARE;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stages/quote-check.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stages/quote-check.ts src/stages/quote-check.test.ts
git commit -m "Check distilled requirements against their cited turns"
```

---

### Task 6: Card edits, the brief and the card

**Files:**
- Create: `src/stages/intent-edits.ts`
- Test: `src/stages/intent-edits.test.ts`

**Interfaces:**
- Consumes: `ClientIntentBody`, `IntentStatus` (Task 1); `RunState["decisions"]`.
- Produces:
  - `interface IntentEdit { status?: Record<string, IntentStatus>; remove?: string[]; add?: string[]; roles?: Record<string, "client" | "team">; by: string; reason: string }`
  - `INTENT_CARD = "intent-"`
  - `intentEditsOf(state: Pick<RunState, "decisions">): IntentEdit[]`
  - `checkIntentEdit(e: Omit<IntentEdit, "by" | "reason">, intent: ClientIntentBody): string[]`
  - `applyIntentEdits(intent: ClientIntentBody, edits: IntentEdit[]): ClientIntentBody` (roles are applied by the step through `rolesFor`, not here; this function re-labels requirements from `intent.speakers`)
  - `renderBrief(intent: ClientIntentBody, date?: string): string`
  - `intentCard(runId: string, intent: ClientIntentBody, hash: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/stages/intent-edits.test.ts
import { describe, expect, it } from "vitest";
import type { ClientIntentBody } from "../contracts/index.js";
import { applyIntentEdits, checkIntentEdit, intentCard, intentEditsOf, renderBrief } from "./intent-edits.js";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/intent-edits.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/intent-edits.ts
// A person's edits on the intent card (spec §5). Edits are recorded as `edit` decisions and applied here by code,
// in order, to the checked model answer, so a resumed step never asks the model again.
import { IntentStatus, type ClientIntentBody } from "../contracts/index.js";
import type { RunState } from "../ledger/state.js";

export const INTENT_CARD = "intent-";
export interface IntentEdit { status?: Record<string, IntentStatus>; remove?: string[]; add?: string[]; roles?: Record<string, "client" | "team">; by: string; reason: string }
type Changes = Omit<IntentEdit, "by" | "reason">;

export function intentEditsOf(state: Pick<RunState, "decisions">): IntentEdit[] {
  return state.decisions
    .filter((d) => d.cardId.startsWith(INTENT_CARD) && d.decision === "edit")
    .map((d) => {
      const x = d as unknown as { edits?: Changes; reason?: string };
      return { ...(x.edits ?? {}), by: d.by, reason: String(x.reason ?? "").trim() };
    });
}

export function checkIntentEdit(e: Changes, intent: ClientIntentBody): string[] {
  const out: string[] = [];
  const ids = intent.requirements.map((r) => r.id), names = intent.speakers.map((s) => s.name);
  for (const id of [...Object.keys(e.status ?? {}), ...(e.remove ?? [])]) if (!ids.includes(id)) out.push(`${id} is not a requirement (${ids.join(", ")})`);
  for (const s of Object.values(e.status ?? {})) if (!IntentStatus.safeParse(s).success) out.push(`${s} is not a status (${IntentStatus.options.join(", ")})`);
  for (const n of Object.keys(e.roles ?? {})) if (!names.includes(n)) out.push(`${n} is not a speaker (${names.join(", ")})`);
  for (const t of e.add ?? []) if (!t.trim()) out.push("an added requirement needs words");
  const n = Object.keys(e.status ?? {}).length + (e.remove?.length ?? 0) + (e.add?.length ?? 0) + Object.keys(e.roles ?? {}).length;
  if (!n) out.push("the edit changes nothing");
  return out;
}

const nextId = (rs: { id: string }[]) => `R-${Math.max(0, ...rs.map((r) => Number(/^R-(\d+)$/.exec(r.id)?.[1] ?? 0))) + 1}`;

export function applyIntentEdits(intent: ClientIntentBody, edits: IntentEdit[]): ClientIntentBody {
  let rs = intent.requirements.map((r) => ({ ...r }));
  for (const e of edits) {
    rs = rs.filter((r) => !e.remove?.includes(r.id)).map((r) => (e.status?.[r.id] ? { ...r, status: e.status[r.id]! } : r));
    for (const text of e.add ?? []) rs.push({ id: nextId(rs), text: text.trim(), status: "decided", addedBy: { by: e.by, note: e.reason } });
  }
  const roleOf = new Map(intent.speakers.map((s) => [s.name, s.role]));
  rs = rs.map((r) => (r.speaker && roleOf.has(r.speaker) ? { ...r, role: roleOf.get(r.speaker)! } : r));
  return { ...intent, requirements: rs, edits: intent.edits + edits.length };
}

export function renderBrief(intent: ClientIntentBody, date?: string): string {
  const by = (s: IntentStatus) => intent.requirements.filter((r) => r.status === s);
  const lines = [`# ${intent.project.name ?? "Client request"}${date ? ` (from meeting ${date})` : ""}`, ``, `Goal: ${intent.project.goal}`, ``, `## Requirements`, ...by("decided").map((r) => `- ${r.id}: ${r.text}`)];
  const confirm = [...by("open").map((r) => `- ${r.id}: ${r.text}`), ...intent.openQuestions.map((q) => `- ${q.id}: ${q.text}`)];
  if (confirm.length) lines.push(``, `## To confirm`, ...confirm);
  if (intent.constraints.length) lines.push(``, `## Constraints`, ...intent.constraints.map((c) => `- ${c.id}: ${c.text}`));
  const out = [...by("deferred"), ...by("excluded")];
  if (out.length) lines.push(``, `## Out of scope`, ...out.map((r) => `- ${r.id} (${r.status}): ${r.text}`));
  return lines.join("\n");
}

export function intentCard(runId: string, intent: ClientIntentBody, hash: string): string {
  const ev = (r: ClientIntentBody["requirements"][number]) => r.quote ? ` - "${r.quote}" (${r.turn}, ${r.speaker ?? "?"}, ${r.role ?? "?"})` : r.addedBy ? ` - added by ${r.addedBy.by}: ${r.addedBy.note}` : "";
  const group = (s: IntentStatus) => intent.requirements.filter((r) => r.status === s).map((r) => `- ${r.id}: ${r.text}${ev(r)}`);
  return [
    `# Client intent: ${intent.project.name ?? "(no project name)"}`, ``,
    ...(intent.warnings.length ? [`## Warnings`, ...intent.warnings.map((w) => `- ${w}`), ``] : []),
    `Goal: ${intent.project.goal}`, ``,
    `## Speakers`, ...intent.speakers.map((s) => `- ${s.name}: ${s.role} (${s.source})`), ``,
    `## Requirements`,
    ...(["decided", "open", "deferred", "excluded"] as const).flatMap((s) => { const g = group(s); return g.length ? [`### ${s}`, ...g] : []; }), ``,
    ...(intent.constraints.length ? [`## Constraints`, ...intent.constraints.map((c) => `- ${c.id}: ${c.text}`), ``] : []),
    ...(intent.openQuestions.length ? [`## Open questions`, ...intent.openQuestions.map((q) => `- ${q.id}: ${q.text}`), ``] : []),
    ...(intent.dropped.length ? [`## Dropped (quote not found)`, ...intent.dropped.map((d) => `- ${d.id}: ${d.text} - ${d.why}`), ``] : []),
    `## Decide`,
    `  factory edit-intent ${runId} ${hash} --status R-3=deferred --remove R-7 --add "text" --role "Name=team" --reason "why"`,
    `  factory approve ${runId} ${hash}`,
    `  factory reject  ${runId} ${hash} --reason "what is wrong"`,
    ``, `Card hash: ${hash}`,
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stages/intent-edits.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stages/intent-edits.ts src/stages/intent-edits.test.ts
git commit -m "Apply intent card edits and render the brief"
```

---

### Task 7: Skill loader

**Files:**
- Create: `src/stages/distill-skill.ts`
- Already created: `.agents/skills/transcript-distill/SKILL.md` (review it in this task; it ships as is)
- Test: `src/stages/distill-skill.test.ts`

**Interfaces:**
- Produces: `DISTILL_SKILL = "transcript-distill"`, `BUILTIN_DISTILL_SKILL: string` (absolute path), `loadDistillSkill(repo?: string, builtin = BUILTIN_DISTILL_SKILL): { text: string; sha256: string; path: string } | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stages/distill-skill.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_DISTILL_SKILL, loadDistillSkill } from "./distill-skill.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-skill-")); });
const put = (dir: string, text: string) => { mkdirSync(join(dir, "transcript-distill"), { recursive: true }); writeFileSync(join(dir, "transcript-distill", "SKILL.md"), text); };

describe("distill skill", () => {
  it("ships with the factory", () => {
    const s = loadDistillSkill(undefined)!;
    expect(s.path).toBe(BUILTIN_DISTILL_SKILL);
    expect(s.text).toContain("name: transcript-distill");
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the shared copy overrides the built-in one, and the repo's overrides both", () => {
    put(join(process.env.FACTORY_HOME!, "skills"), "shared");
    expect(loadDistillSkill(undefined)!.text).toBe("shared");
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    put(join(repo, ".claude", "skills"), "project");
    expect(loadDistillSkill(repo)!.text).toBe("project");
  });
  it("is missing when no copy exists", () => {
    expect(loadDistillSkill(undefined, join(tmpdir(), "none", "SKILL.md"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/distill-skill.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/distill-skill.ts
// The rules for reading a meeting (spec §8). Ours, reviewed in PRs, so not pinned by hash; its sha256 is recorded with every
// client intent and is part of the distill step's cache key. Lookup order matches src/conventions/skills.ts: repo, shared, built-in.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectSkillsDir, sharedSkillsDir } from "../conventions/skills.js";

export const DISTILL_SKILL = "transcript-distill";
export const BUILTIN_DISTILL_SKILL = fileURLToPath(new URL(`../../.agents/skills/${DISTILL_SKILL}/SKILL.md`, import.meta.url));

export function loadDistillSkill(repo: string | undefined, builtin = BUILTIN_DISTILL_SKILL): { text: string; sha256: string; path: string } | undefined {
  const candidates = [...(repo ? [join(projectSkillsDir(repo), DISTILL_SKILL, "SKILL.md")] : []), join(sharedSkillsDir(), DISTILL_SKILL, "SKILL.md"), builtin];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return undefined;
  const text = readFileSync(path, "utf8");
  return { text, sha256: createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex"), path };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stages/distill-skill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stages/distill-skill.ts src/stages/distill-skill.test.ts .agents/skills/transcript-distill/SKILL.md
git commit -m "Ship the transcript-distill skill and its loader"
```

---

### Task 8: The distill route and its model-picker dropdown

The model picker (start form dropdowns, `factory start|estimate|design start --model step=model`, `--preset`, and a project's
`steps:` block) is built from one table, `STEPS` in `src/stages/models.ts` ("a new step adds a line to STEPS and gets the picker,
the presets, the checks and the route log with it"). The form reads `/api/models/:mode` → `modelsView(mode)` → `stepsOf(mode)`:
every `STEPS` key for a build, `ESTIMATE_ROUTES` / `DESIGN_ROUTES` for an estimate / design run. So the `STEPS` line plus the
two route lists give distill its dropdown in all four modes; this task pins that with tests.

**Files:**
- Modify: `src/stages/models.ts:75-87` (`STEPS`: the `distill` line goes **first**, before `intake`, so the dropdown appears in pipeline order)
- Modify: `src/stages/routing.ts:185-189` (`THINKING_STEPS`, `ESTIMATE_ROUTES` - first entry; `DESIGN_ROUTES` follows from it)
- Modify: `src/ui/static/app.js:681` (`SPEC` phase set: add `"distill"`, so the run page shows the step under "Spec")
- Test: `src/stages/routing.test.ts` (add cases)

**Interfaces:**
- Produces: route key `"distill"` resolvable by `modelFor(project, "distill", ...)`; listed by `modelsView` for builds, estimates and design runs, with `offered` = the thinking group's models and a model per preset; pickable as `--model distill=<model>` and in the UI dropdown; overridable per project with `steps: { distill: { ... } }`.

- [ ] **Step 1: Write the failing tests** (append to `src/stages/routing.test.ts`, using the file's existing imports - add `DESIGN_ROUTES` to the import list)

```ts
describe("distill in the model picker", () => {
  const project = ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" });
  it("has a route on the heavy tier, effort medium", () => {
    expect(resolveRun(project, {}).distill).toMatchObject({ runner: "api", effort: "medium", tier: "heavy" });
  });
  it("gets a dropdown in every kind of run, first in the list, with models to pick and a model per preset", () => {
    for (const mode of [undefined, "greenfield", "estimate", "design"]) {
      const v = modelsView(mode);
      const d = v.steps.find((s) => s.step === "distill")!;
      expect(d, `mode ${mode}`).toBeDefined();
      expect(v.steps[0]!.step).toBe("distill");
      expect(d.offered).toEqual(expect.arrayContaining(["claude-opus-5-5", "claude-sonnet-5-5"]));
      expect(Object.keys(d.presets).length).toBe(v.presets.length);
    }
  });
  it("a person's pick goes into the run's routes and is recorded as a pick", () => {
    const r = resolveRun(project, { picks: { distill: "claude-sonnet-5-5" } });
    expect(r.distill).toMatchObject({ model: "claude-sonnet-5-5", source: "pick" });
  });
  it("a model the step does not offer is refused before the run starts", () => {
    expect(checkRoutes(project, ESTIMATE_ROUTES, { picks: { distill: "not-a-model" } }).join("\n")).toMatch(/distill/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stages/routing.test.ts -t "distill in the model picker"`
Expected: FAIL - `routes.distill` undefined; no `distill` row in `modelsView`.

- [ ] **Step 3: Implement**

`src/stages/models.ts` `STEPS`, as the **first** line of the object (before `intake`):

```ts
  // reads a whole meeting and judges decided / deferred / excluded: the clarifier's tier (PENDING team decision, spec §7)
  distill: { runner: "api", group: "thinking", vendor: "anthropic", tier: "heavy", effort: "medium" },
```

`src/stages/routing.ts`: add `"distill"` to `THINKING_STEPS`, and as the first entry of `ESTIMATE_ROUTES`:

```ts
export const ESTIMATE_ROUTES = ["distill", "intake", "ground", /* …the rest unchanged… */] as const;
```

`src/ui/static/app.js:681`:

```js
const SPEC = new Set(["discover", "distill", "intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "plan", "approve"]);
```

The dropdown shows for every run of these kinds, transcript or not (the picker lists a mode's steps before the request is read,
as it does for the design step on a run that turns out to touch no UI); a pick for distill on a non-transcript run is simply
never used.

- [ ] **Step 4: Run the routing and UI tests**

Run: `npx vitest run src/stages/routing.test.ts src/ui/ui.test.ts`
Expected: PASS. If a snapshot of the full route table or of `/api/models/:mode` fails, update it with `-u` and check the diff adds only the `distill` row.

- [ ] **Step 5: Commit**

```bash
git add src/stages/models.ts src/stages/routing.ts src/stages/routing.test.ts src/ui/static/app.js
git commit -m "Add the distill route and its model-picker dropdown"
```

---

### Task 8b: Cache the transcript so the repair call reads it cheaply

**Why:** the runner already caches the system prompt (skill + instructions), but the transcript sits in the user message
(untrusted text may not go in the system prompt, `src/context/pack.ts:111`), and the user message is not cached on a
single-turn call (`cachesConversation`, `src/runners/api.ts:53`). So a repair call pays full price for the whole transcript
again. Marking the stable head of the user message (everything before feedback / task / recap, which `pack.ts` already
sorts last) lets the repair read it at $0.20/M instead of $4/M. Prices and limits from the Claude API reference
(prompt caching): 5-minute write = 1.25x input, Opus 5.5 read = $0.20/MTok, minimum cacheable prefix 512 tokens on Opus 5.5 /
Sonnet 5.5, at most 4 breakpoints per request (this adds one: system + this = 2).

**Files:**
- Modify: `src/context/pack.ts:131-134` (`render`) and the `ContextPack` type - add `userStable: number`
- Modify: `src/runners/api.ts:41-44` (`Provider.start` gains an optional `opts?: { cacheUserPrefix?: number }`), `:58` (`anthropicUserContent`), `:149-170` (Anthropic provider passes it through)
- Modify: `src/stages/think.ts:29-50` (`ThinkSpec.cacheBriefing?: boolean`) and `:462` (pass `{ cacheUserPrefix: pack.userStable }` when set)
- Test: `src/runners/api-cache.test.ts` (new), `src/context/pack.test.ts` (add a case)

**Interfaces:**
- Produces: `ContextPack.userStable` (character length of the user message's stable head, 0 when there is none); `anthropicUserContent(user, images, cachePrefix?: number)`; `ThinkSpec.cacheBriefing`.
- Consumed by: Task 9 (`cacheBriefing: CACHE_TRANSCRIPT`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/runners/api-cache.test.ts
import { describe, expect, it } from "vitest";
import { anthropicUserContent } from "./api.js";

describe("caching the head of the briefing", () => {
  it("splits the user message at the stable head and marks it for caching", () => {
    expect(anthropicUserContent("HEAD\n\nTAIL", [], 4)).toEqual([
      { type: "text", text: "HEAD", cache_control: { type: "ephemeral" } },
      { type: "text", text: "\n\nTAIL" },
    ]);
  });
  it("leaves a message alone with no head to cache", () => {
    expect(anthropicUserContent("ALL", [], 0)).toBe("ALL");
    expect(anthropicUserContent("ALL", [])).toBe("ALL");
  });
});
```

Append to `src/context/pack.test.ts` (use the file's existing `buildPack` input helper):

```ts
it("userStable ends where feedback, task and recap begin", () => {
  const p = buildPack({ ...baseInput, sections: [
    S.untrusted("turns", "transcript", "T-1 [00:00:01] A: hi"),
    S.task("Extract."),
    S.recap(["R-1: the quote is not in T-1"]),
  ] });
  expect(p.user.slice(0, p.userStable)).toContain("T-1 [00:00:01] A: hi");
  expect(p.user.slice(0, p.userStable)).not.toContain("Extract.");
  expect(p.user.slice(p.userStable)).toContain("R-1: the quote is not in T-1");
});
```

(`S` is exported from `src/stages/think.ts`; if `pack.test.ts` builds sections by hand, build these three the same way with sources `doc`, `task`, `recap`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/runners/api-cache.test.ts src/context/pack.test.ts`
Expected: FAIL - `anthropicUserContent` ignores the third argument; `userStable` undefined.

- [ ] **Step 3: Implement**

`src/context/pack.ts`, in `render`:

```ts
  // the sources that change between calls of one step (a retry's feedback, the task, a repair's recap) are sorted last;
  // everything before them is the briefing's stable head, which a step may ask to cache (ThinkSpec.cacheBriefing)
  const VOLATILE = new Set<SectionSpec["source"]>(["feedback", "task", "recap"]);
  const render = () => {
    const sys = prepared.filter((p) => p.s.spec.placement === "system").map((p) => wrap(p.s, p.text, p.imageN));
    const userParts = prepared.filter((p) => p.s.spec.placement === "user");
    const usr = userParts.map((p) => wrap(p.s, p.text, p.imageN));
    const firstVolatile = userParts.findIndex((p) => VOLATILE.has(p.s.spec.source));
    const head = firstVolatile === -1 ? usr : usr.slice(0, firstVolatile);
    return { system: sys.join("\n\n"), user: usr.join("\n\n"), userStable: head.join("\n\n").length };
  };
```

and add `userStable: number` to the `ContextPack` type where `system` and `user` are declared; make sure the final `return { ...body, manifest }` carries it.

`src/runners/api.ts`:

```ts
export interface Provider {
  /** `images` go with the first user message, each labelled "Image n" to match the briefing's markers.
   *  `opts.cacheUserPrefix`: characters at the start of `user` to mark for prompt caching (a step re-sends the same head). */
  start(model: string, effort: Effort | undefined, system: string, user: string, tools: ToolSpec[], images?: ModelImage[], opts?: { cacheUserPrefix?: number }): Conversation;
}

/** Anthropic: each image after its label, then the briefing (images before the text that refers to them); a cached head marked. */
export function anthropicUserContent(user: string, images: ModelImage[] = [], cachePrefix = 0): string | Anthropic.ContentBlockParam[] {
  const text: Anthropic.ContentBlockParam[] = cachePrefix > 0 && cachePrefix < user.length
    ? [{ type: "text", text: user.slice(0, cachePrefix), cache_control: { type: "ephemeral" } }, { type: "text", text: user.slice(cachePrefix) }]
    : [{ type: "text", text: user }];
  if (!images.length) return text.length === 1 ? user : text;
  return [
    ...images.flatMap((m, i): Anthropic.ContentBlockParam[] => [
      { type: "text", text: imageLabel(i) },
      { type: "image", source: { type: "base64", media_type: m.mediaType, data: m.base64 } },
    ]),
    ...text,
  ];
}
```

(Keep the existing image branch's exact block shapes - copy them from the current function body rather than the sketch above if they differ.) In the Anthropic provider's `start(...)`, accept `opts` and build `messages` with `anthropicUserContent(user, images, opts?.cacheUserPrefix)`. The OpenAI provider (`:232`) accepts and ignores `opts` (OpenAI caches long prefixes automatically).

`src/stages/think.ts`: add to `ThinkSpec`

```ts
  /** mark the briefing's stable head (everything before feedback, task and recap) for prompt caching: for a step that may call
   *  the model twice in a row over the same large input (distill's repair) */
  cacheBriefing?: boolean;
```

and at the provider call (`:462`) pass `job.cacheBriefing ? { cacheUserPrefix: job.pack.userStable } : undefined` as the 7th argument (thread `cacheBriefing` from the spec into `job` alongside `model` and `effort`).

- [ ] **Step 4: Run tests, typecheck, full suite**

Run: `npx vitest run src/runners src/context && npm run typecheck && npm test`
Expected: PASS; no other step changes behaviour (none sets `cacheBriefing`).

- [ ] **Step 5: Commit**

```bash
git add src/context/pack.ts src/context/pack.test.ts src/runners/api.ts src/runners/api-cache.test.ts src/stages/think.ts
git commit -m "Let a step cache the stable head of its briefing"
```

---

### Task 9: The distill step

**Files:**
- Create: `src/stages/distill.ts`
- Test: `src/stages/distill.test.ts`

**Interfaces:**
- Consumes: `Transcript`, `DistillOut`, `ClientIntentBody` (Task 1); `transcriptText` (Task 2); `loadRoster`, `rolesFor` (Task 4); `checkQuotes`, `needsRepair` (Task 5); `INTENT_CARD`, `intentEditsOf`, `applyIntentEdits`, `renderBrief`, `intentCard` (Task 6); `loadDistillSkill` (Task 7); route `distill` (Task 8); `think`, `S`, `UNTRUSTED_NOTE` (`./think.js`); `header`, `StepDef`, `StepOutcome` (`./framework.js`).
- Produces: `distillStep: StepDef` (key `"distill"`, stage `"distill"`); on approve: `{ kind: "done", outputs: { intent: <sha> }, data: { brief: string, requirements: number } }`; `MAX_INTENT_REJECTS = 2`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stages/distill.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import { distillStep } from "./distill.js";
import type { StepContext, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";
import { addMember } from "../config/team.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const transcript = { format: "gemini-meet", notes: "Gemini says: tickets", speakers: ["Alex Morgan", "Jordan Lee"], turns: [
  { id: "T-1", time: "00:02:36", speaker: "Alex Morgan", text: "So uh patients can book an appointment online and uh cancel it up to 24 hours before" },
  { id: "T-2", time: "00:13:30", speaker: "Jordan Lee", text: "So I think let's skip it for now." },
] };
const good = { project: { name: "Clinic booking app", goal: "Track tickets" }, requirements: [
  { id: "R-1", text: "Patients book appointments online", status: "decided", quote: "patients can book an appointment online", turn: "T-1" },
  { id: "R-2", text: "Video consultations", status: "open", quote: "let's skip it for now", turn: "T-2" },
], constraints: [], openQuestions: [], warnings: [] };
let answers: unknown[] = [];
let calls = 0;
const provider: Provider = { start(): Conversation { return { async next(): Promise<Turn> { calls++; return { calls: [{ id: "s", name: "submit_result", input: answers.shift() }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} }; } };

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-distill-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache(); calls = 0; answers = [];
  setProviderFactory(() => provider);
  addMember({ name: "Jordan Lee" }, "demo"); // the project's roster (Task 4)
});

async function newRun(): Promise<Ledger> {
  const l = Ledger.create(`20261014-distill-${Math.random().toString(16).slice(2, 6)}`);
  const transcriptSha = l.putJson(transcript);
  await l.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "T-1 ...", operator: "sam", transcriptSha } }, HUMAN_WRITER);
  return l;
}
async function exec(l: Ledger, attempt = 1): Promise<StepOutcome> {
  const state = replay(l.events());
  const ctx: StepContext = { runId: state.info.runId, ledger: l, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined };
  const out = await distillStep.run(ctx);
  if (out.kind === "done") await l.append({ type: "step.completed", key: `distill/${attempt}`, inputsHash: sha, outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  return out;
}
async function decide(l: Ledger, out: StepOutcome, decision: string, data: Record<string, unknown> = {}) {
  if (out.kind !== "wait") throw new Error(`expected a card, got ${out.kind}`);
  // as the executor records it: the card's extra (the model cache) rides on human.requested
  await l.append({ type: "human.requested", data: { ...(out.card.extra ?? {}), cardId: out.card.cardId, kind: out.card.kind, artifactSha: out.card.artifactSha, step: "distill" } }, HUMAN_WRITER);
  await l.append({ type: "human.decided", data: { cardId: out.card.cardId, decision, by: "lead", artifactSha: out.card.artifactSha, ...data } }, HUMAN_WRITER);
}

describe("distill step", () => {
  it("shows the intent card, with roles from the roster, then completes with the brief on approve", async () => {
    const l = await newRun();
    answers = [good];
    const card = await exec(l);
    expect(card.kind).toBe("wait");
    if (card.kind !== "wait") return;
    expect(card.card.kind).toBe("intent");
    expect(card.card.markdown).toContain("Jordan Lee: team (roster)");
    await decide(l, card, "approve");
    const done = await exec(l, 2);
    expect(done.kind).toBe("done");
    if (done.kind !== "done") return;
    expect(String(done.data!.brief)).toContain("- R-1: Patients book appointments online");
    expect(replay(l.events()).info.request).toContain("# Clinic booking app");
    expect(calls).toBe(1);
  });
  it("an edit makes a new card without asking the model again", async () => {
    const l = await newRun();
    answers = [good];
    const first = await exec(l);
    await decide(l, first, "edit", { edits: { status: { "R-2": "deferred" } }, reason: "client agreed on the call" });
    const second = await exec(l, 2);
    expect(second.kind).toBe("wait");
    if (second.kind !== "wait" || first.kind !== "wait") return;
    expect(second.card.artifactSha).not.toBe(first.card.artifactSha);
    expect(second.card.markdown).toMatch(/### deferred\n- R-2/);
    expect(calls).toBe(1);
  });
  it("repairs once when too many quotes fail, and lists what still fails", async () => {
    const l = await newRun();
    const bad = { ...good, requirements: [{ ...good.requirements[0]!, quote: "nobody said this at all", turn: "T-1" }] };
    answers = [bad, bad];
    const card = await exec(l);
    expect(calls).toBe(2);
    if (card.kind !== "wait") throw new Error("expected a card");
    expect(card.card.markdown).toContain("## Dropped (quote not found)");
  });
  it("a reject asks the model again with the reason; a second reject parks", async () => {
    const l = await newRun();
    answers = [good, good];
    const first = await exec(l);
    await decide(l, first, "reject", { reason: "missed the SMS reminder" });
    const second = await exec(l, 2);
    expect(calls).toBe(2);
    await decide(l, second, "reject", { reason: "still wrong" });
    expect((await exec(l, 3)).kind).toBe("park");
  });
});
```

Also add to `src/ledger/state.ts` replay (in `case "step.completed":` after the `complexity` line) - this is what the first test's `info.request` assertion pins:

```ts
        // a transcript run: the approved client intent's brief is the request every later step reads (spec §2)
        if (step === "distill" && typeof data.brief === "string") s.info.request = data.brief;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/distill.test.ts`
Expected: FAIL - module `./distill.js` not found.

- [ ] **Step 3: Implement**

```ts
// src/stages/distill.ts
// distill (spec §2-§5): a Google Meet transcript → the client's intent, checked by code and confirmed by a person on the
// intent card before intake. The model's checked answer is cached as a named output, so edits and resumes cost nothing.
import { ClientIntentBody, DistillOut, type Transcript } from "../contracts/index.js";
import { loadRoster, rolesFor } from "../config/team.js";
import { transcriptText } from "../sources/transcript.js";
import { loadDistillSkill, DISTILL_SKILL } from "./distill-skill.js";
import { header, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { applyIntentEdits, INTENT_CARD, intentCard, intentEditsOf, renderBrief } from "./intent-edits.js";
import { checkQuotes, needsRepair, type Dropped } from "./quote-check.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";
import { hashJson } from "../util/hash.js";

export const MAX_INTENT_REJECTS = 2;
/** cache the transcript on the first call so a repair reads it at $0.20/M instead of $4/M; costs +25% on the transcript when no
 *  repair follows. Worth it while about 1 run in 5 or more needs a repair - check against real runs and switch off if not (spec §7). */
export const CACHE_TRANSCRIPT = true;
const rejectsOf = (ctx: StepContext) => ctx.state.decisions.filter((d) => d.cardId.startsWith(INTENT_CARD) && d.decision === "reject").map((d) => String((d as unknown as { reason?: string }).reason ?? ""));
const decisionOn = (ctx: StepContext, sha: string) => [...ctx.state.decisions].reverse().find((d) => d.artifactSha === sha);

async function ask(ctx: StepContext, t: Transcript, skill: string, roles: string, feedback: string[]): Promise<{ ok: true; out: DistillOut; model: string } | { ok: false; outcome: StepOutcome }> {
  const r = await think(ctx, {
    stage: "distill", route: "distill", cls: "read-large", budgetTokens: 60_000, tools: [], schema: DistillOut, cacheBriefing: CACHE_TRANSCRIPT,
    sections: [
      S.template("skill", skill),
      S.template("tpl", `You are the distill step of a software factory. Follow the transcript-distill rules above.\n${UNTRUSTED_NOTE}`),
      S.reference("roles", roles),
      S.untrusted("notes", "gemini-notes", `UNVERIFIED Gemini notes (never evidence):\n${t.notes}`),
      S.untrusted("turns", "transcript", transcriptText(t)),
      ...(feedback.length ? [S.recap(feedback)] : []),
      S.task("Extract the client's intent for one project."),
    ],
  });
  return r.ok ? { ok: true, out: r.output, model: r.model } : { ok: false, outcome: r.outcome };
}

export const distillStep: StepDef = {
  key: "distill", stage: "distill", templateVersion: "1",
  inputs: (s) => (s.info.transcriptSha ? { transcript: s.info.transcriptSha, edits: intentEditsOf(s), rejects: s.decisions.filter((d) => d.cardId.startsWith(INTENT_CARD) && d.decision === "reject").length } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const rejects = rejectsOf(ctx);
    if (rejects.length >= MAX_INTENT_REJECTS) return { kind: "park", reason: `the client intent was rejected ${rejects.length} times; last reason: ${rejects.at(-1)}` };
    const t = ctx.ledger.getJson<Transcript>(ctx.state.info.transcriptSha!)!;
    const skill = loadDistillSkill(ctx.state.info.repoPath);
    if (!skill) return { kind: "park", reason: `the ${DISTILL_SKILL} skill is not installed (.agents/skills/${DISTILL_SKILL}/SKILL.md)` };
    const roster = loadRoster(ctx.project.project);
    const cardRoles = Object.assign({}, ...intentEditsOf(ctx.state).map((e) => e.roles ?? {})) as Record<string, "client" | "team">;
    const speakers = rolesFor(t.speakers, roster, cardRoles);
    // the model's checked answer, cached per transcript, skill and rejection (spec §5)
    const cacheKey = hashJson({ step: "distill", transcript: ctx.state.info.transcriptSha, skill: skill.sha256, rejects });
    let base = pendingFor(ctx, cacheKey);
    if (!base) {
      const roles = speakers.map((s) => `- ${s.name}: ${s.role}`).join("\n") + (roster.found ? "" : "\n(no team roster is set up: everyone is treated as the client)");      const feedback = rejects.map((r) => `A person rejected the last intent: ${r}`);
      let a = await ask(ctx, t, skill.text, roles, feedback);
      if (!a.ok) return a.outcome;
      let chk = checkQuotes(a.out, t.turns);
      if (needsRepair(chk.kept.length, chk.dropped.length)) {
        const fix = await ask(ctx, t, skill.text, roles, [...feedback, ...chk.dropped.map((d) => `${d.id}: ${d.why}; quote "${d.quote}" again exactly from the turn, or leave the item out`)]);
        if (!fix.ok) return fix.outcome;
        a = fix; chk = checkQuotes(a.out, t.turns);
      }
      base = { out: { ...a.out, requirements: chk.kept }, dropped: chk.dropped, model: a.model };
    }
    const pendingSha = ctx.ledger.putJson(base);
    const speakerOf = new Map(t.turns.map((x) => [x.id, x.speaker]));
    const roleOf = new Map(speakers.map((s) => [s.name, s.role]));
    const draft = ClientIntentBody.parse({
      ...base.out,
      requirements: base.out.requirements.map((r) => ({ ...r, speaker: speakerOf.get(r.turn), role: roleOf.get(speakerOf.get(r.turn) ?? "") })),
      speakers, dropped: base.dropped, skill: { name: DISTILL_SKILL, sha256: skill.sha256 }, edits: 0,
      warnings: [...base.out.warnings, ...(roster.found ? [] : [`No team roster is set up, so every speaker is treated as the client. Add our people with: factory team add "Full Name" --project ${ctx.project.project}`])],
    });
    const intent = applyIntentEdits(draft, intentEditsOf(ctx.state).map((e) => ({ ...e, roles: undefined })));
    const cardSha = ctx.ledger.putJson({ card: "intent", intent });
    const decision = decisionOn(ctx, cardSha);
    if (decision?.decision === "approve") {
      const sha = ctx.ledger.putJson({ header: header(ctx.runId, "client-intent", "distill", "", base.model), ...intent });
      return { kind: "done", outputs: { intent: sha }, data: { brief: renderBrief(intent, t.date), requirements: intent.requirements.length } };
    }
    const hash = cardSha.slice(0, 8);
    // the cache travels on the card, as clarify's does (src/stages/clarify.ts:283-285, pendingFor at :355)
    return { kind: "wait", card: { cardId: `${INTENT_CARD}${hash}`, kind: "intent", artifactSha: cardSha, markdown: intentCard(ctx.runId, intent, hash), extra: { cacheKey, pendingSha } } };
  },
};

type Pending = { out: DistillOut; dropped: Dropped[]; model: string };
/** The model's checked answer from an earlier attempt of this step, carried on its card (the same lookup as clarify's pendingFor). */
function pendingFor(ctx: StepContext, cacheKey: string): Pending | undefined {
  const ev = [...ctx.ledger.events()].reverse().find((e) => e.type === "human.requested" && (e.data as { cacheKey?: string })?.cacheKey === cacheKey);
  const sha = (ev?.data as { pendingSha?: string } | undefined)?.pendingSha;
  return sha ? ctx.ledger.getJson<Pending>(sha) : undefined;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stages/distill.test.ts && npm run typecheck`
Expected: PASS (4 tests). The `calls` counts prove edits and resumes don't call the model.

- [ ] **Step 5: Commit**

```bash
git add src/stages/distill.ts src/stages/distill.test.ts src/ledger/state.ts
git commit -m "Add the distill step and the intent card"
```

---

### Task 10: Put distill at the head of transcript runs

**Files:**
- Modify: `src/stages/modes.ts:164-172` (`stepsFor`)
- Test: `src/stages/modes.test.ts` (add cases)

**Interfaces:**
- Consumes: `distillStep` (Task 9), `RunState.info.transcriptSha`.
- Produces: `withDistill(state: RunState, steps: StepDef[]): StepDef[]`.

- [ ] **Step 1: Write the failing test** (append to `src/stages/modes.test.ts`; build states the way that file already does, adding `transcriptSha`)

```ts
describe("transcript runs", () => {
  it("an estimate from a transcript runs distill alone until it completes", () => {
    const s = stateWith({ mode: "estimate", request: "T-1 [00:00:01] A: hi", transcriptSha: "t".repeat(64) });
    expect(stepsFor(s).map((x) => x.key)).toEqual(["distill"]);
  });
  it("after distill, the usual head follows it", () => {
    const s = stateWith({ mode: "estimate", request: "# Brief\n\n## Requirements\n- R-1: x", transcriptSha: "t".repeat(64) }, { distill: "completed" });
    expect(stepsFor(s).map((x) => x.key).slice(0, 2)).toEqual(["distill", "intake"]);
  });
  it("a brownfield transcript run distills after discover", () => {
    const s = stateWith({ mode: "brownfield", request: "T-1", transcriptSha: "t".repeat(64) });
    expect(stepsFor(s).map((x) => x.key)).toEqual(["discover", "distill"]);
  });
  it("a run without a transcript is unchanged", () => {
    const s = stateWith({ mode: "estimate", request: "a portal" });
    expect(stepsFor(s).map((x) => x.key)).not.toContain("distill");
  });
});
```

If `modes.test.ts` has no `stateWith` helper, add one at the top of the new `describe`:

```ts
const stateWith = (info: Record<string, unknown>, steps: Record<string, "completed"> = {}) => {
  const s = replay([{ seq: 1, ts: "2026-10-14T00:00:00Z", type: "run.created", runId: "r", data: { project: "demo", operator: "sam", ...info } }] as never);
  for (const [k, status] of Object.entries(steps)) s.steps.set(k, { status, outputs: ["o".repeat(64)], attempts: 1, data: {} } as never);
  return s;
};
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/modes.test.ts -t "transcript runs"`
Expected: FAIL - no `distill` in the step list.

- [ ] **Step 3: Implement** in `src/stages/modes.ts`

```ts
import { distillStep } from "./distill.js";

/**
 * A transcript run (spec §2, §6): distill comes first (after discover in a build), and nothing after it is listed
 * until it completes, so no step reads the raw transcript as a request. Seeded runs never carry a transcript.
 */
export function withDistill(state: RunState, steps: StepDef[]): StepDef[] {
  if (!state.info.transcriptSha) return steps;
  const at = steps[0]?.key === "discover" ? 1 : 0;
  const head = [...steps.slice(0, at), distillStep];
  return state.steps.get("distill")?.status === "completed" ? [...head, ...steps.slice(at)] : head;
}

/** The ordered steps for the run's mode. */
export function stepsFor(state: RunState): StepDef[] {
  const steps = (() => {
    switch (state.info.mode) {
      case "brownfield": return brownfieldSteps(state);
      case "greenfield": return greenfieldSteps(state);
      case "estimate": return estimateSteps(state);
      case "design": return designOnlySteps(state);
      default: throw new Error(`No step list for mode "${state.info.mode}" yet`);
    }
  })();
  return withDistill(state, steps);
}
```

- [ ] **Step 4: Run the mode tests and the whole suite**

Run: `npx vitest run src/stages/modes.test.ts && npm test`
Expected: PASS; no existing test changes (runs without `transcriptSha` are untouched).

- [ ] **Step 5: Commit**

```bash
git add src/stages/modes.ts src/stages/modes.test.ts
git commit -m "Run distill first in transcript runs"
```

---

### Task 11: `factory edit-intent`

**Files:**
- Modify: `src/cli/index.ts` (new command next to `edit-estimate`, ~line 300)
- Modify: `src/stages/intent-edits.ts` (add `parseIntentEditArgs`)
- Test: `src/stages/intent-edits.test.ts` (add cases)
- Modify: `docs/design/stages-aligned.md` §1 (one line under each mode: `intake` is preceded by `distill` for a transcript request)

**Interfaces:**
- Consumes: `checkIntentEdit`, `INTENT_CARD` (Task 6), `assertTty`, `decide`, `DecisionError`, `openRun`, `replay`, `runAndReport` (existing in `src/cli/index.ts`).
- Produces: `parseIntentEditArgs(o: { status?: string[]; remove?: string[]; add?: string[]; role?: string[] }): Omit<IntentEdit, "by" | "reason">` (throws `Error` with the bad argument named).

- [ ] **Step 1: Write the failing test** (append to `src/stages/intent-edits.test.ts`)

```ts
import { parseIntentEditArgs } from "./intent-edits.js";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stages/intent-edits.test.ts -t "edit-intent arguments"`
Expected: FAIL - `parseIntentEditArgs` not exported.

- [ ] **Step 3: Implement**

Append to `src/stages/intent-edits.ts`:

```ts
export function parseIntentEditArgs(o: { status?: string[]; remove?: string[]; add?: string[]; role?: string[] }): Omit<IntentEdit, "by" | "reason"> {
  const status: Record<string, IntentStatus> = {}, roles: Record<string, "client" | "team"> = {};
  for (const s of o.status ?? []) {
    const m = /^(R-\d+)=(\w+)$/.exec(s.trim());
    if (!m) throw new Error(`--status "${s}": use R-3=deferred`);
    status[m[1]!] = m[2] as IntentStatus;
  }
  for (const r of o.role ?? []) {
    const m = /^(.+)=(client|team)$/.exec(r.trim());
    if (!m) throw new Error(`--role "${r}": use "Name=client" or "Name=team"`);
    roles[m[1]!.trim()] = m[2] as "client" | "team";
  }
  return {
    ...(Object.keys(status).length ? { status } : {}), ...(o.remove?.length ? { remove: o.remove } : {}),
    ...(o.add?.length ? { add: o.add } : {}), ...(Object.keys(roles).length ? { roles } : {}),
  };
}
```

In `src/cli/index.ts`, after the `edit-estimate` command:

```ts
const collect = (v: string, prev: string[] = []) => [...prev, v];
program.command("edit-intent").argument("<run>").argument("<hash>", "first characters of the intent card's hash")
  .option("--status <R-n=status>", "set a requirement's status: decided, deferred, excluded or open; repeat it", collect)
  .option("--remove <R-n>", "remove a requirement; repeat it", collect)
  .option("--add <text>", "add a requirement the meeting agreed but the card missed; repeat it", collect)
  .option("--role <Name=client|team>", "fix a speaker's role; repeat it", collect)
  .requiredOption("--reason <text>", "why (recorded with your name and shown on the card)")
  .description("edit the open client-intent card; the card is rebuilt from your edits without asking the model again (terminal only)")
  .action(async (run: string, hash: string, o: { status?: string[]; remove?: string[]; add?: string[]; role?: string[]; reason: string }) => {
    assertTty();
    const l = openRun(run);
    const state = replay(l.events());
    if (state.openCard?.kind !== "intent") throw new DecisionError("The open card is not a client-intent card.");
    let edits;
    try { edits = parseIntentEditArgs(o); } catch (e) { throw new DecisionError((e as Error).message); }
    const shown = l.getJson<{ intent: ClientIntentBody }>(state.openCard.artifactSha)!.intent;
    const problems = checkIntentEdit(edits, shown);
    if (problems.length) throw new DecisionError(`Can't apply that edit: ${problems.join("; ")}`);
    const r = await decide(l, { decision: "edit", hashPrefix: hash, data: { edits, reason: o.reason } });
    if (r.kind === "repeat") return log("Already recorded.");
    log("Edit recorded. Rebuilding the card…");
    await runAndReport(l.runId);
  });
```

Add the imports (`checkIntentEdit`, `parseIntentEditArgs` from `../stages/intent-edits.js`; `type ClientIntentBody` from `../contracts/index.js`). If `state.openCard` has no `artifactSha` field, read it the way `edit-estimate` finds its proposals (`src/cli/index.ts:306-313`).

In `docs/design/stages-aligned.md` §1, under Brownfield, Greenfield and Estimate, add: `(a Google Meet transcript request: distill → [intent card, H] comes before intake; docs/superpowers/specs/2026-10-14-transcript-intent-design.md)`.

- [ ] **Step 4: Run tests, typecheck, full suite**

Run: `npx vitest run src/stages/intent-edits.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Manual check with the real sample** (needs an Anthropic key; costs about $0.11-0.34)

```bash
npm run build
node dist/cli/index.js estimate --file "<your Meet export>.docx"
```

Expected: the run stops at a client-intent card listing the meeting's requirements, the file module as deferred with Jordan Lee as team (after `factory team add "Jordan Lee"`; without it the card warns that no roster is set up), and the warning about Project Comet. Try one `factory edit-intent ... --status R-x=deferred --reason test`, check the card changes and the cost report shows one distill model call, then `factory approve`, and check intake's briefing in the run's trace shows the brief, not the transcript.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts src/stages/intent-edits.ts src/stages/intent-edits.test.ts docs/design/stages-aligned.md
git commit -m "Add factory edit-intent for the client-intent card"
```

---

### Task 12: Meeting questions and out-of-scope items in clarify (spec §5b)

**Files:**
- Create: `src/stages/meeting-clarify.ts`
- Modify: `src/stages/clarify.ts` (`ClarifierOut` gains `meeting?: string`; `selectQuestions` gains an optional `forced` set; `runClarifier` gains the meeting section; `clarifyStep` / `clarify2Step` pass the meeting context and add the "not asked" assumptions)
- Test: `src/stages/meeting-clarify.test.ts`

**Interfaces:**
- Consumes: `ClientIntentBody`, `Transcript` (Task 1); `renderBrief`'s `- <id>: ` lines (Task 6); distill's output (Task 9); `outputOf` (`./framework.js`).
- Produces:
  - `interface MeetingItem { id: string; text: string; at?: string }`, `interface MeetingContext { questions: MeetingItem[]; outOfScope: { id: string; status: string; text: string }[] }`
  - `meetingContext(state, ledger, request: string): MeetingContext | undefined` (undefined when the run has no distill output)
  - `meetingPrompt(m: MeetingContext, round: 1 | 2): string`
  - `meetingMarked<Q extends { id: string; meeting?: string; reason: string }>(qs: Q[], m: MeetingContext): { questions: Q[]; forced: Set<string>; missing: MeetingItem[] }`
  - `notAskedAssumption(item: MeetingItem, id: string): Assumption`
  - `selectQuestions(scored, cap, idStart?, defaults?, forced?: Set<string>)`: forced questions are asked first, whatever their score, when `cap > 0`; the rest fill what is left of the cap.

- [ ] **Step 1: Write the failing tests** (`src/stages/meeting-clarify.test.ts`): context from the distill output (open requirements + open questions, filtered by the brief lines in the request, times from the transcript, out-of-scope list); prompt text for rounds 1 and 2; forced and missing marking; `selectQuestions` asks forced questions below the threshold and first, keeps the cap for the rest, and asks none when the cap is 0; the not-asked assumption is high risk.
- [ ] **Step 2: Implement** `meeting-clarify.ts`, then wire it into `clarify.ts`; add `meeting` (the distill output's sha) to clarify's cache key.
- [ ] **Step 3: Typecheck** (`npm run typecheck`, and the test files with `.tmp/tsconfig.tests.json`).

---

### Task 13: The intent card on the web run page (spec §5c)

**Files:**
- Modify: `src/stages/intent-edits.ts` (add `webIntentEdit(input: unknown): Changes`, the web body → an edit, throwing on a malformed one)
- Modify: `src/ui/start.ts` (`WEB_DECIDED` + `"intent"`; new `editIntent(ledger, input, deps)`)
- Modify: `src/ui/server.ts` (route `POST /api/runs/:id/intent-edit`)
- Modify: `src/ui/data.ts` (`intentOf(ledger, sha)`; `runView` adds `card.intent` for an intent card)
- Modify: `src/ui/static/app.js` (`intentPanel(r)` in `cardPanel`; a pipeline note for the intent card)
- Test: `src/stages/intent-edits.test.ts` (webIntentEdit), `src/ui/intent-view.test.ts` (intentOf with a fake ledger; the panel route is ledger-backed and runs in CI)

**Interfaces:**
- Consumes: `checkIntentEdit`, `INTENT_CARD`, `ClientIntentBody` (Tasks 1, 6); `decide`, `record`, `typedName`, `StartError` (existing in start.ts).
- Produces: `webIntentEdit(input: unknown): { status?, remove?, add?, roles? }`; `intentOf(ledger: Pick<Ledger, "getJson">, sha: string): IntentView`; `editIntent(ledger, input, deps): Promise<{ recorded: boolean }>`.

- [ ] **Step 1: Write the failing tests** for `webIntentEdit` (reads statuses, removes, adds one per line, roles; refuses a bad status, a non-string add, an empty edit shape) and `intentOf` (requirements with quote/time/speaker, speakers, warnings, dropped).
- [ ] **Step 2: Implement** `webIntentEdit`, `intentOf`, `editIntent`, the route, `WEB_DECIDED`, and the panel.
- [ ] **Step 3: Run** the Windows-safe tests and typecheck.
