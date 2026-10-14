---
name: transcript-distill
description: Read a Google Meet transcript (Gemini notes export) and extract the client's intent for ONE project - requirements with exact quotes, their status, constraints, out-of-scope items and open questions. Used by the factory's distill step whenever the request is a transcript.
---

# Transcript distill

You turn a meeting into a short, checkable statement of what the client wants.
A person reviews your output on the intent card before anything is built, and code
rejects any quote that is not in the transcript. Accuracy beats coverage: leave out
what you are unsure of and list it as an open question instead.

## What you are given

- TURNS: the transcript split into turns T-1..T-n, each with time, speaker and text.
  This is the only source of truth. Quote only from here.
- ROLES: each speaker tagged `client` or `team` (from the factory's roster).
- GEMINI NOTES: Google's own summary of the meeting. Unverified. Use it only to find
  places in the turns worth reading; never quote it and never take a requirement from it alone.

## Who counts

- The client's words define the intent. A requirement needs a client turn behind it.
- A team member's words count only when the client agrees in a later turn
  (says yes, repeats it, or restates the scope without the item).
- PENDING TEAM DECISION: a scope change by a team member that the client never answers
  is marked `open`, with the question "Client to confirm: <change>".
- Agreement words from the team ("All right", "Okay") confirm nothing.

## One project per transcript

- A transcript should cover one project. If the meeting moves to a different product
  (new name, new problem, new users), distill only the project that takes most of the
  conversation and add a warning: "Second project '<name>' from <time>; not distilled."
- Never mix requirements from the two projects. The warning does not stop the run; the person on the card decides.

## What to extract

1. **Project**: its name (if said) and its goal in one sentence, in the client's terms.
2. **Requirements** R-1..R-n: one thing the system must do each. Write it as a plain
   statement ("A QA reviewer can send a ticket back for rework and change its assignee"),
   then give the evidence: quote and turn id.
3. **Constraints**: deadlines, budget, platforms, tools suggested or ruled out
   ("12 weeks to early testers", "desktop web only", "a map provider was suggested; our choice").
   A constraint limits how; a requirement says what.
4. **Open questions**: what the meeting left unanswered or said it would settle later,
   phrased as a question the client can answer.
5. Ignore small talk, audio problems, greetings and the meeting's own logistics.
   Action items for our team ("send estimates", "roadmap by tomorrow") are not
   requirements; list one under constraints only if it sets a date the client gave.

## Status of each requirement

- `decided`: the client asked for it and nothing later withdrew it.
- `deferred`: wanted, but moved to later ("next call", "skip it for now", "separate meeting").
- `excluded`: explicitly not wanted in this scope ("skip the mobile app entirely").
- `open`: mentioned but unclear, contradicted, or changed by the team without client agreement.
- **Later turns win.** If T-12 adds a file module and T-40 defers it, the item is `deferred`,
  its evidence is T-40, and `supersedes` names T-12.
- If two client turns contradict each other and neither is clearly later or final, mark `open`.

## Quoting rules (code checks these)

- `quote` = 5 to 25 consecutive words copied exactly from the cited turn, mistakes included
  ("queue in progress", "gojson"). Do not fix spelling inside a quote.
- One turn id per quote. If the evidence spans turns, quote the most specific one.
- Never quote Gemini notes. Never quote yourself. Never stitch two fragments together.
- Fix speech-to-text errors only in your own statement text, never in the quote.

## Speech-to-text glossary (extend over time)

| Heard | Meant |
|---|---|
| queue in progress / queue started | QA in progress / QA started |
| validity insurance | quality assurance |
| gojson / GJS | GeoJSON |
| physible | feasible |
| CH (in a churn discussion) | churn |
| assigne | assignee |

## Output

Return JSON matching the factory's client-intent schema:
`project {name, goal}`, `requirements[] {id, text, status, quote, turn, supersedes?}`,
`constraints[] {text, quote, turn}`, `openQuestions[] {text, turn?}`, `warnings[]`.
Deferred and excluded items stay in `requirements`; the factory lists them as out of scope.
Speaker and role are filled in by code from the turn id; do not repeat them.

## Worked example (an invented meeting, for illustration only)

Turns (excerpt; roles shown instead of names):

```
T-4  [00:03:10] client: so uh patients can book an appointment online and uh cancel it up to 24 hours before
T-9  [00:06:40] client: and we want uh video consultations as well
T-15 [00:11:05] team:   video is a big piece, I suggest we keep it for phase two
T-16 [00:11:30] client: okay yeah, video in phase two, fine
T-21 [00:14:00] client: no mobile app for now, just the website
T-24 [00:16:20] client: the payment part we will decide with our accounts person next week
T-30 [00:21:45] client: one more thing, for our pharmacy business we need a stock system
```

Answer:

- R-1 decided: "Patients book appointments online and can cancel up to 24 hours before."
  Quote: "patients can book an appointment online and uh cancel it up to 24 hours before" (T-4).
  The filler "uh" stays in the quote; the statement drops it.
- R-2 deferred: "Video consultations, moved to phase 2." The team proposed it (T-15) and the
  client agreed (T-16), so it is deferred. Quote: "okay yeah, video in phase two, fine" (T-16).
  Supersedes T-9. Had the client not answered T-15, R-2 would be `open`:
  "Client to confirm: video consultations in phase 2".
- R-3 excluded: "A mobile app." Quote: "no mobile app for now, just the website" (T-21).
- Open question: "How are payments taken? To be decided with the client's accounts person." (T-24)
- Warning: "Second project 'pharmacy stock system' from 00:21:45; not distilled." (T-30 starts a
  different product; nothing from it becomes a requirement.)

## Do not

- Invent requirements the client did not say, even if they are obvious for this kind of product.
- Split one ask into many tiny items, or merge different asks into one.
- Decide technology unless the client required it; suggestions go under constraints.
- Use Gemini's summary as evidence.
