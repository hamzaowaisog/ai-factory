# bench/

Benchmarks for the estimates path (see `estimates-design.md`). Read-only: no model calls, no cost.

```
npm run bench -- all                      # calibrate + gates; saves to bench/results/ (git-ignored)
npm run bench -- calibrate --home <dir>   # <dir> holds ledger/<runId>/ copied from another machine
npm run bench -- gates
npm run bench -- external                 # pinned public data (see external/README.md)
npm run bench -- compare                  # an estimate read against that data
npm run bench -- evidence <estimate.json> # e.g. bench/external/fixtures/estimate-sample.json
npm run bench -- consistency             # same requirement, different words (LIVE model calls, needs ANTHROPIC_API_KEY)
npm run bench -- consistency --group portal --runs 3
npm run bench -- consistency --report portal/a=<run> portal/b=<run>   # runs that already exist, no model calls
npm run bench -- all --no-save
npm run test:bench                        # the benchmarks' own tests (bench/vitest.config.ts)
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

It also prints two things the estimate itself reads (`src/estimate/durations.ts`, `calibrate.ts`):
- **Factory task classes**: measured minutes and turns per task class (track/complexity), from finished build runs seeded
  from an approved estimate. A class needs 3 records before its minutes replace the sized hours on the critical path.
- **UI size: approved design vs built**: the UI change class the approved design allowed next to what integrate measured.
- **Size picks vs build actuals**: the decision log paired with what each task's build took (docs/estimate-consistency.md, section 11).
- **Task catalogue**: the current version's status from evidence and every factor check (section 13).
- **Self-tuning**: what the next background tuning would change, what is fitted and what it still waits for (section 14).

They stay empty (or "waiting") until a build has finished from an approved estimate.

## gates: does each gate catch what it should?
`gates/cases.ts` lists seeded defects (`must-fail`) and clean controls (`must-pass`) per gate. The runner calls the
registered gate's predicate directly. Results: caught, missed, ok, false-positive, error, or **pending** when the
gate isn't registered. Pending never fails the run, but `bench.test.ts` requires none: every gate E1-E7 (with E1b, E1c)
and B1-B7 has cases.

The estimate-gate cases are in `gates/estimate-cases.ts`. They are built from the real estimate fixture
(`src/estimate/fixture.ts`) and the real gate inputs, one seeded defect each. When a gate's input changes, change its case.

## consistency: do similar requirements get similar estimates?
`consistency/cases/<group>/*.md` are requirement files that mean the same thing in different words (a web portal, an
API-only service, a mobile booking app; three wordings each). Each is estimated hands-off from requirements alone with the
cross-run cache off; the design approval card, the only human card left, is approved by `bench`. Per group the report
gives the mean total, the coefficient of variation of the totals (target 10% or less, `CV_TARGET` in `report.ts`), the
task-count range and the task kinds whose count varies. Exit code 1 if a group fails or a run did not finish.
Not part of `all`: it costs real model calls. `--runs n` repeats every case to separate rewording from sampling noise.
See `docs/estimate-consistency.md`, section 10.

## ripple: does the impact code layer find what real commits changed?
`npx tsx bench/ripple/replay.ts [--lenses]` (free; clones the pinned repos in `ripple/repos.yaml` to `~/.factory/bench-repos`).
Replays 15-20 real commits: seed = the most-changed non-test file (a stand-in for ground), truth = the other existing
code files the commit changed. Reports recall for ground-only vs ground + code layer, and the layer's precision.
Truth includes the seed, so ground-only recall is 1/truth; "beyond seed" leaves it out (ground-only is 0% there).
Results are split by stack (.NET, Next.js). `--lenses` counts each lens's briefing tokens locally; no model is called.

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
