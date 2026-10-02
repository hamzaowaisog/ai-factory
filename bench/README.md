# bench/

Benchmarks for the estimates path (see `estimates-design.md`). Read-only: no model calls, no cost.

```
npm run bench -- all                      # both checks; saves to bench/results/ (git-ignored)
npm run bench -- calibrate --home <dir>   # <dir> holds ledger/<runId>/ copied from another machine
npm run bench -- gates
npm run bench -- all --no-save
```
Exit code is 1 if a gate misses a seeded defect, flags clean input, or throws.

## calibrate: does the ledger predict its own cost and time?
Turns each finished step into a record (`calibration/records.ts`), then holds one run out at a time and predicts
its steps from the other runs' steps of the same stage. Reports, per stage and for cost and wall minutes:
- **coverage**: how often the actual falls inside p10-p90 (target 80%);
- **med.err** and **bias**: error of the p50 prediction;
- **confidence**: cold-start (<3 records), partial (<10), calibrated. Cut-offs are assumptions in `stats.ts`.

Needs at least 3 records per stage from *other* runs, so it prints bands but no coverage until more ledgers exist.
Not yet available: per-unit cost (requirements, screens), stack and size band. Those need counted units in the ledger.

## gates: does each gate catch what it should?
`gates/cases.ts` lists seeded defects (`must-fail`) and clean controls (`must-pass`) per gate. The runner calls the
registered gate's predicate directly. Results: caught, missed, ok, false-positive, error, or **pending** when the
gate isn't registered yet (E1-E6 today). Pending never fails the run.

E-gate cases use a provisional `EstimateFixture` (`gates/fixture.ts`). When a gate is built, adapt its cases' `input`
to the real artifact; the mutators (one seeded defect each) carry over.

## spec: how good are the specs the factory writes?
`spec/` runs the real pipeline from intake to the final spec on fixed cases, answers the question cards from each
case's facts, stops before plan, and scores the spec. Cases are change requests against public .NET repos pinned
at a commit (`spec/repos.yaml`); no client code. How to write one: `spec/CASES.md`.

```
npm run bench:spec -- --fake                       # free dry run: scripted model, temporary home; proves the plumbing only
npm run bench:spec -- --spend --like <project>     # real models, real cost; prices and routes copied from <project>
npm run bench:spec -- --spend --like <project> --case vsa-no-show --repeats 1 --max-cost 3
```
Every case runs `--repeats` times (default 3) under a hard per-run cap (`--max-cost`, default $4). Per case it
reports: **pass** (reached a spec, every expected behaviour inside one requirement, nothing forbidden), **found**
(share of expected behaviours), **creep** (runs that added something the request didn't ask for), **gaps**
(planted ambiguities raised as a question or assumption), **agree** (expected behaviours that every repeat found or
every repeat missed), requirement count range, cost and minutes. Results go to `spec/results/` (git-ignored).
A paid run uses the factory home: it adds `eval-<repo>` projects and clones the pinned repos under `eval-repos/`.

Limits to keep in mind: the scorers match words, so a spec that says the right thing in unusual words counts as a
miss (fix the matcher, not the spec); the oracle answers from keyword-matched facts, so a question no fact covers
gets the card's recommended option.
