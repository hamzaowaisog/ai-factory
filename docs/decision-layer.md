# Decision layer (slice 1)

A decision is a pick from a fixed list of options, with a confidence from 0 to 1. One port asks the question; the
adapter behind it can be swapped. **Nothing in a run calls it yet.** Slice 1 is the port, four adapters and a bench
that compares them on stored intakes, so an adapter can be judged before any run depends on it.

## Where things are
| What | Where |
|---|---|
| Port, adapters, questions, signals | `src/decide/decide.ts` |
| Tests | `src/decide/decide.test.ts` |
| Replay bench | `bench/decide/run.ts` (suite `decide` in `npm run eval -- list`) |
| Hand-written cases | `bench/decide/cases/*.json` |
| Labels | `bench/decide/labels.json` |

## The two questions
The models are shown exactly these meanings. **Label with the same lines**, or the models and the labellers judge
different things.

| id | Option | Meaning |
|---|---|---|
| `maturity` | casual idea | a goal in a sentence or two; no roles, screens or rules are named |
| `maturity` | partial spec | names some roles, screens or rules, but leaves behaviour open |
| `maturity` | full spec | names the roles, the screens, and testable rules or acceptance criteria |
| `genre` | common product type | a familiar kind of app (a shop, bookings, a to-do list, a CRM, a portal) that needs no special domain knowledge |
| `genre` | niche or domain-heavy | depends on the rules or vocabulary of one industry or regulation |

## Adapters
An adapter is named as a pair, `adapter[:model]`, for example `llm:claude-haiku-5-5` or `jev`.

| Adapter | What it does | What it is sent |
|---|---|---|
| `llm` | A structured-output call through `think()`. The vendor is the model id and nothing else: an OpenAI id goes to OpenAI, a Claude id to Anthropic. | Measured signals, intake's labels and intake's spans |
| `jev` | TypeSafe's Jev over HTTPS. Needs `TYPESAFE_API_KEY` in `~/.factory/.env`. | Measured signals and intake's labels only. Never the request's words: Jev is hosted outside the factory's vendors. So it is asked only `maturity`; `genre` cannot be told from counts. |
| `fake` | A fixed answer from the signals. No model, $0. | Nothing leaves the machine |
| `off` | Asks nothing and returns no record. | Nothing |

"Measured signals" are counted by code from the request: words, acceptance-criteria-like lines, and screens, roles
and numbers named. "Intake's labels" are `changeClass`, `risk` and `touchesUi`.

## What the port guarantees
- A pick that is not one of the question's options, or a confidence outside 0-1, is dropped and named on the record.
- A failed call never throws: the record carries `error`. The one exception is a lost lease, which is thrown.
- An `llm` call is capped at 2 turns, $0.05 and 30 seconds, and never inherits a retry's failure text, raised effort
  or stronger model. A `jev` call times out after 30 seconds.

## Running the bench
```
npm run eval -- decide --dry                         # free: every case through `fake`
npm run eval -- decide --pairs llm:claude-haiku-5-5,jev --spend --max-cost 0.50      # PAID
```
- **Cases:** one per distinct request in `ledgers/` (6 today), plus every file in `bench/decide/cases/`.
- **`--max-cost`** caps the whole run. A paid run asks for a typed "yes" (or `--yes`) first.
- **`--price <model>=<in>/<out>`** gives a price in USD per million tokens for a model the price table lacks.
  Without it, an unknown model is costed at $10/$50, which overstates the spend.
- **Output:** pick, confidence, cost and latency per case and pair; then, against the labels, right picks per
  question and the count of confident (0.8 or more) wrong "full spec" picks. Results are saved to
  `bench/decide/results/` (git-ignored).
- Paid runs are started by Ahsan only.

## Adding a case and its label
A case file in `bench/decide/cases/`:
```json
{
  "id": "written-my-case",
  "request": "The request text, as a person would send it.",
  "intent": { "changeClass": "feature", "risk": "low", "touchesUi": true }
}
```
Its label in `bench/decide/labels.json`, keyed by the case id (a ledger case's id is its run folder name):
```json
{ "written-my-case": { "maturity": "partial spec", "genre": "common product type" } }
```
Never add a client's request here: the repo is public.

**Still to do by people:** about 13 more written cases, from casual to full spec and common to niche, and labels
for the 6 ledger cases. Two people label independently; their agreement is the ceiling an adapter is held to.

## The bar for switching an adapter on
Zero confident wrong "full spec" picks, and agreement with the two people on the rest.

## Known limits
- The Jev request and answer format is written from TypeSafe's docs and has not met the live API. Expect the first
  real call to need adjusting.
- The signals count each Given, When and Then line as its own acceptance line, so one scenario counts as three.
  Tune this once labels exist.

## Not built yet
- The hook after intake, and a `decisions:` block in the project config. When it comes, it must stay optional with
  no defaults (a defaulted field changes the config fingerprint in every delivery's evidence), add no model route,
  and leave intake's outputs alone.
- `compare`: it will list pairs (`llm:<model>`, `jev`), not adapter names.
- Using the answers to choose a lane or a design engine. That is the next slice and belongs to its owners.
