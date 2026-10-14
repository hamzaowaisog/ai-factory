# Meeting Transcript to Client Intent: Design (draft, 2026-10-14)

Team discussion doc: https://claude.ai/code/artifact/16d523d6-bcd6-4ca6-9f59-6bf92035a093
Skill draft: `.agents/skills/transcript-distill/SKILL.md`

Items marked **PENDING** are open for the team; the value given is the proposed default the plan builds,
each isolated so a different answer changes one place.

---

## 1. Goal

A Google Meet transcript (Gemini notes export, .docx) is a request source. The factory extracts the
client's intent for one project, with an exact quote and timestamp behind every requirement, and stops
for a human to edit and confirm it before intake. After approval the run continues unchanged.

Decisions made (2026-10-13/14):

| Question | Decision |
|---|---|
| Modes | Brownfield, greenfield, estimate, design-only |
| Input | Google Meet export as .docx (Gemini notes + transcript), given like any request file: `--file` on `factory start` / `estimate` / `design start`, or the web start form's file drop; detected automatically |
| Order | Find the client's intent first, then a human confirms it |
| Projects per transcript | One; a second is flagged with a non-blocking warning on the card (option A) |
| Who is the client | Team roster in config; anyone not on it is the client; roles fixable on the card |
| Card | Editable: status, remove, add with a note, fix roles, then approve |
| Approach | A distill step inside the run (option A) |
| Distill rules | A `transcript-distill` skill shipped in `.agents/skills/`; checks stay in code |

Out of scope: other transcript formats (Zoom, Teams, plain text), audio, multi-project splitting,
a web UI for the card (the UI shows the card read-only like other cards; decisions stay in the terminal).

## 2. Flow

```
factory start|estimate|design start --file meeting.docx
  → gatherRequest: a Meet export is detected → source kind "transcript"; run.created carries the
    rendered transcript as `request` and `transcript: true`; the parsed transcript is a ledger artifact
  → distill step (new, first step of the head in every mode; brownfield/greenfield after discover)
      1. roles: roster → client/team per speaker (+ role edits from the card)
      2. model (route "distill"): skill + turns + roles + Gemini notes (labelled unverified) → DistillOut
      3. quote check (code) → kept / dropped; one repair call if > 20% dropped or nothing kept
      4. apply card edits (code) → client intent
      5. wait on the intent card; on approve → done, data.brief = the rendered brief
  → replay: distill completed with data.brief → state.info.request = brief
  → intake → … unchanged
```

The head builders return `[distillStep]` alone until distill completes, so nothing downstream
(module split, intake) reads the raw transcript.

## 3. Artifacts (contracts)

```ts
Turn            = { id: "T-n", time: "HH:MM:SS", speaker: string, text: string }
Transcript      = { format: "gemini-meet", title?: string, date?: string, notes: string, turns: Turn[], speakers: string[] }
SpeakerRole     = { name: string, role: "client" | "team", source: "roster" | "default" | "card" }
Status          = "decided" | "deferred" | "excluded" | "open"

DistillOut (model) = {
  project: { name?: string, goal: string },
  requirements: { id: "R-n", text, status: Status, quote, turn: "T-n", supersedes?: string[] }[],
  constraints:  { id: "C-n", text, quote?, turn? }[],
  openQuestions:{ id: "Q-n", text, turn? }[],
  warnings: string[],
}

ClientIntent (stored, header + body) = DistillOut with each requirement extended by
  { speaker, role, addedBy?: { by, note } }   // speaker/role filled by code from the turn
  + speakers: SpeakerRole[]
  + dropped: { id, text, quote, turn, why }[]  // failed quote check
  + skill: { name, sha256 }
  + edits: number                                // card edits applied
```

Rendered brief (intake's request after approval):

```
# <project name or "Client request"> (from meeting <date>)
Goal: <goal>
## Requirements
- R-1: <text>            (decided only)
## To confirm
- R-7: <text>            (open)  + open questions Q-n
## Constraints
- C-1: <text>
## Out of scope
- R-8 (deferred): <text>
- R-10 (excluded): <text>
```

## 4. Parsing, roles and the quote check

**Detection** (`src/sources/transcript.ts`): a .docx whose text contains a line matching
`/ - Transcript$/` followed by `HH:MM:SS` lines and `Name: text` lines. Otherwise the .docx is an
ordinary document (unchanged behaviour).

**Parse:** text before the transcript heading → `notes`. In the transcript: an `HH:MM:SS` line sets the
current time; `Name: text` starts a turn (name = up to the first `: `, ≤ 60 chars, no digits-only names);
a line without a name continues the previous turn; "Session ended after …", "Transcription ended after …"
and the closing disclaimer are skipped. Turns are numbered T-1.. in order. Zero turns → error at start.

**Roster (project team):** two files, merged: the shared roster `~/.factory/team.yaml` (everyone on this machine, every
project) and the project's own roster `~/.factory/projects/<project>/team.yaml` (beside the project's other per-project data,
so the hand-written project YAML is never rewritten). Each lists `members: [{ name, aliases?, note? }]` and `domains: [...]`.
They are managed with a CLI command, not by hand:

```
factory team list   [--project <name>]
factory team add    "Full Name" [--alias "Short"]... [--note "architect"] [--project <name>]
factory team remove "Full Name" [--project <name>]
```

Names and aliases match case-insensitively, ignoring extra spaces (Meet labels speakers by account name; aliases cover short
forms). Domains are kept for exports that carry emails (Meet .docx does not). A speaker not on the roster is `client`
(source `default`). No roster at all → every speaker is `client` and the card warns, naming the command to fix it. Estimate and
design runs with no project use the shared roster. A role fixed on the intent card applies to that run only; to make it stick,
add the person with `factory team add`.

**Quote check** (`src/stages/quote-check.ts`, pure): normalise both sides (lower case, punctuation
removed, fillers `uh um uhm hmm` removed, whitespace collapsed); the normalised quote must be a
substring of the normalised cited turn and be 3–40 words after normalising (the skill asks for 5–25;
the check is looser on purpose). Failing items move to `dropped` with the reason. Repair: if more than
20% of requirements are dropped, or none survive, one more model call gets the failures as feedback;
the second result is checked the same way and kept as is. **PENDING:** the 20% threshold.

**Second project** (decided 2026-10-14: option A, non-blocking): one project per transcript is expected. If a meeting covers
another, the model distills only the project that takes most of the conversation and reports the other in `warnings`
("Second project '<name>' from <time>; not distilled."). The warning is shown first on the card and does not block approval;
the person approves, edits out stray items, or rejects with a reason. The other project needs its own run with its own
transcript. Code does not detect it (a new project and a new topic look alike); the card's quotes and timestamps are the check.

**Team scope changes:** **PENDING**; default as in the skill: a team member's change the client never
answers is `open` with "Client to confirm".

## 5. The intent card and its edits

Card (kind `intent`, id `intent-<sha8>`), one screen: project and goal; speakers with roles; requirements
grouped by status with quote, time and speaker; constraints; open questions; dropped items; warnings;
then the commands.

```
factory edit-intent <run> <hash> [--status R-3=deferred]... [--remove R-7]... [--add "text"]...
                                 [--role "Name=client|team"]... --reason "why"
factory approve <run> <hash>
factory reject  <run> <hash> --reason "what is wrong"
```

- `edit-intent` (terminal only, like `edit-estimate`) validates against the current intent: ids exist,
  statuses valid, role names are speakers, at least one change. Recorded as decision `edit` on the card;
  the run resumes and the step re-applies all edits in order (no model call), producing a new card.
- Added items get the next free R-id, status `decided`, no quote, `addedBy`.
- A role change re-labels the speaker everywhere and is listed on the card; it does not re-run the model.
- `reject --reason`: the model runs again once with the reason as feedback; a second reject parks the run.
- `approve`: the step completes with the client intent as its output and `data.brief`.
- **PENDING (hands-off):** default A: the intent card always shows, even with `factory estimate --hands-off`.

The step caches the model result as a named output of its first attempt (as clarify does), so edits and
resumes never pay for the model again; the cache key includes the transcript sha, the skill sha and the
reject reasons.

## 5b. Meeting questions and out-of-scope items in clarify (added 2026-10-14)

After approval, clarify uses the client intent directly, not only as text in the brief:

- **Open questions from the meeting are always asked.** The meeting's open questions (`Q-n`) and its `open` requirements
  (`R-n`, "Client to confirm: …") are given to the clarifier, which must turn each into one multiple-choice question and name
  its id in a new optional field `meeting`. Code asks those questions regardless of the impact × uncertainty threshold, first
  on the question card, with the reason prefixed "Left open in the meeting (T-12, 00:11:16)."
- **A meeting question the clarifier did not turn into a question** becomes a high-risk assumption ("… left open in the
  meeting; not asked, still open"), so it reaches the approval card instead of disappearing.
- **Deferred and excluded items** are listed for the clarifier as out of scope by the client's decision: never ask about them
  or recommend building them. (Prompt rule; code cannot reliably tell a question "about" an item.)
- **Which questions belong to which clarify call:** a meeting item is handled by the clarify call whose request text contains
  its brief line (`- Q-1: …`). The whole brief → all of them; a large brief split into modules → each in the module that holds
  its line, so none is asked twice.
- **Hands-off estimates** ask nobody: the meeting questions become assumptions like every other question.
- Round 2 of clarify gets only the out-of-scope list (its job is follow-ups to answered questions).

## 5c. The intent card on the web run page (added 2026-10-14)

The intent card is decided on the run page as well as in the terminal, like the design, plan, understood and spec-review cards.

- **Approve / send back:** the existing `POST /api/runs/:id/decision` route, with `intent` added to its decided kinds
  (`WEB_DECIDED`): typed name (recorded as "<name> (via web)"), the card hash, a note to approve, a reason to send back.
- **Edit:** a new route `POST /api/runs/:id/intent-edit` with `{ hash, by, reason, status: {R-n: status}, remove: [R-n], add: [text],
  roles: {name: client|team} }`. It checks the open card is an intent card, the name, the reason, and the edit against the shown
  intent with the same `checkIntentEdit` the CLI uses, then records the same `edit` decision `factory edit-intent` records. The run
  rebuilds the card (no model call) and the page shows the new one.
- **The panel:** each requirement with its quote, time and speaker, a status dropdown and a remove box; a box to add requirements
  (one per line); a role dropdown per speaker; a reason; "Save edits"; then the usual approve / send-back form. Warnings and dropped
  items are shown above the editor. What is typed survives the page's redraws, like the other forms.
- **Run view:** for an open intent card, `GET /api/runs/:id` adds `intent` (requirements, speakers, warnings, dropped) read from the
  card's artifact, so the page does not parse markdown.
- Unchanged: the CLI commands; the roster is still managed with `factory team` (a roster screen is not part of this).

## 6. Modes

| Mode | Head |
|---|---|
| Brownfield / greenfield | discover → distill → (existing head) |
| Estimate | distill → (existing head) |
| Design-only | distill → (existing head) |

Seeded runs (`--from-estimate`, `--from-design`, sibling, resize) do not distill: they inherit the
parent's spec, which was written from the confirmed brief. Distill is added only when `info.transcript`.

## 7. Model and cost

New route `distill`: Anthropic, tier heavy, effort medium (like the clarifier). **PENDING:** tier.

The model is configurable like every other model step, from the same table (`STEPS`, `src/stages/models.ts`): a dropdown in
the start form's model picker (first in the list, in all four modes), `--model distill=<model>` and `--preset` on the CLI, and a
project's `steps: { distill: ... }` block. The offered models are the same as for the other thinking steps (`offeredFor`,
group `thinking`); the tier above is only the default.

Cost grows with talk time (input) and the number of requirements (output); output is 5x the input price, so it dominates
short meetings. Estimates on Opus 5.5, one call: 15 min talk ~$0.09, 30 min ~$0.12, 60 min ~$0.17, 120 min ~$0.24;
largest build request (100 KB) ~$0.23, largest estimate request (400 KB) ~$0.54. Card edits cost nothing; a reject is one more call.

**Prompt caching for the repair.** The system part (skill + instructions) is already cached by the runner. The transcript is
in the user message (untrusted text may not go in the system prompt) and today is re-sent at full price on a repair. Distill
marks the user message's stable head (roles, Gemini notes, turns: everything before feedback, task and recap) for caching
(`CACHE_TRANSCRIPT`, plan Task 8b). For a 60-minute meeting (~15K transcript tokens), using the API's prices for Opus 5.5
(5-minute cache write 1.25x = $5/M, cache read $0.20/M):

| | No caching | With caching |
|---|---|---|
| First call, transcript input | $0.060 | $0.075 (+$0.015, the write premium) |
| Repair call, transcript input | $0.060 | $0.003 (-$0.057) |
| Run with no repair | baseline | +$0.015 |
| Run with a repair | baseline | -$0.042 |

It pays off when about 1 run in 5 or more needs a repair (0.015 / 0.072 = 21%). The repair rate is unknown until real runs, so
the switch is one constant; check `cache_read_input_tokens` and the repair count in the first runs' cost reports and turn it off
if repairs are rare. A reject does not benefit: a person's review usually takes longer than the 5-minute cache lifetime, and
the 1-hour TTL (2x write) would cost more on every run than it saves.

## 8. The skill

Loaded from `.agents/skills/transcript-distill/SKILL.md`, overridden by `~/.factory/skills/transcript-distill/`
then `<repo>/.claude/skills/transcript-distill/` (same order as `src/conventions/skills.ts`). Its sha256 is
recorded in the client intent and is part of the cache key. Missing skill → the step parks with
"the transcript-distill skill is not installed". It is not hash-pinned (it is ours, reviewed in PRs).

## 9. Errors

| Case | Behaviour |
|---|---|
| .docx is not a Meet export | Ordinary document, no distill |
| Meet export with zero turns | Refused at start: "no transcript turns found" |
| Over the request size limit | Existing limit message |
| Skill missing | Step parks with the reason |
| Model output fails the schema | Existing think() retry/park ladder |
| Nothing survives the quote check after repair | Card shows the dropped list and a warning; human adds, rejects or approves |
| `edit-intent` with an unknown id/status/name | Refused before recording, with the valid values |

## 10. Testing

- Parser: a small invented fixture in the .docx reader's format (notes, Markdown headings, turns, a session break, a one-line speaker, a second project); no real meeting is committed.
- Quote check: exact, filler, punctuation, wrong turn, too short, stitched fragments.
- Roster: shared + project merge, aliases, case-insensitivity, add/update/remove, no roster; `factory team` by hand.
- Edits: status, remove, add, role, order of application, validation errors.
- Brief rendering: sections and which statuses go where.
- Distill step with a scripted provider: done-after-approve, edit → new card without a model call,
  repair path, reject path, second reject parks, skill missing parks.
- Modes: each head starts with distill for a transcript run and is unchanged otherwise; replay sets
  `info.request` to the brief.
- CLI: `edit-intent` validation; terminal-only.
