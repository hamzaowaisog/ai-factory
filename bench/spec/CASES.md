# Spec-stage eval cases

One YAML file per case in `bench/spec/cases/`. A case is a change request against a public .NET repo pinned at
a commit, plus what a careful person would know and expect. The eval runs the real pipeline from intake to the
final spec, answers the question cards from the case's facts, and scores what comes out. No client code, ever.

```yaml
id: vsa-cancel-reason            # kebab-case, unique; prefix with the repo short name
repo: vsa                        # a key in bench/spec/repos.yaml
kind: feature                    # feature | bugfix | refactor (what a person would call it)
request: |                       # the ticket, written the way a person types one: short, a little vague
  Patients should give a reason when they cancel an appointment ...
facts:                           # the person's knowledge: the oracle answers questions from these
  - id: F1
    about: [[reason], [required, optional, mandatory, must]]   # matcher (see below) run on question text + options
    answer: The reason is required and at most 500 characters.
gaps:                            # ambiguities planted in the request that clarify should raise (question or assumption)
  - id: G1
    match: [[reason], [required, optional, mandatory, empty, blank]]
    fact: F1                     # optional: the fact that settles it
expect:                          # behaviour the final spec must contain, each inside ONE requirement (EARS + its ACs)
  - id: E1
    match: [[cancel], [reason]]
    why: the core ask
forbid:                          # traps: behaviour the request does not ask for (scope creep)
  - id: X1
    match: [[email, sms, notif]]
    why: nobody asked to notify anyone
```

## Matchers

A matcher is a list of groups; each group is a list of alternatives. It hits when **every** group has at least
one alternative in the text. Alternatives match at the start of a word, case-insensitive (so `notif` catches notify and notification, and `tax` does not hit syntax);
an alternative written `/.../` is a regular expression. Keep groups short and generous with synonyms: the model
words things its own way, and a miss caused by wording is a scorer bug, not a model failure.

A fact, gap or forbid matcher with a single group must not rest on a loose word (status, error, response, order,
empty, who, again, a bare status code, ...: the list is `LOOSE` in `case.ts`). Those words turn up in almost every
question, so the oracle would answer the wrong question with that fact. Put them in a second group next to the
topic instead, e.g. `[[cancel], [status, state]]`. The tests enforce this.

## Writing a good case

- The request is 1 to 6 sentences, like a real ticket. It names real things in the repo at its pinned commit.
- Plant 1 to 3 real gaps: a missing rule (required or optional, limits, who may do it), an unhappy path, existing
  data, or a term with two readings. Each gap must be something a careful engineer would ask before coding.
- 3 to 6 expects. Only behaviour the request plus facts clearly imply. Not implementation details.
- 1 to 3 forbids: the scope creep a model is tempted by for this ticket.
- Facts answer the gaps and anything else a person would know. A question no fact matches gets the card's
  recommended option, as a person in a hurry would.
- Bugfix cases describe a symptom, not the fix, and should stay small (the spec allows at most 4 requirements).
