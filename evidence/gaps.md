## Honest gaps
- **Few paid runs.** Three factory runs and one plain Claude Code baseline on public code, each run once: they show what
  works and what fails, not averages.
  The e2e suite reports each case on its own for this reason, and supports `--repeats`.
- **The passing double-booking run is not a clean result.** After the first failure we changed the factory and this
  case's answers (its facts), then re-ran it; the 3/3 is a retest of a changed case on a known exam (case v2). The cases
  below were not changed: `vsa-specialty-filter`, `todo-clear-completed`, `vsa-state-conflict-409` and
  `todo-create-complete-ignored` are still at version 1, validated and proven with scripted models only, and are the
  clean tests still to run.
- **The first VSA run predates the hidden-test harness.** It delivered a GitHub PR with 9/9 of its own locked tests,
  but no hidden tests scored it.
- **On a small, clear bug, plain Claude Code did as well for far less.** Same ticket, same hidden tests: Claude Code
  passed 3/3 for $0.20 in 2.4 minutes (no tests written); the factory passed 3/3 for $2.50 in 13.8 minutes, with tests
  written first and locked, a spec, a plan, a review and evidence. The extra cost buys verification, not a more correct
  fix here; a whole feature is the fairer test and is next.
- **The test writer is the costliest step** (about half of the passing run), and its first attempt was rejected for a
  characterisation test that didn't pass on the old code.
- **Calibration is not published:** its records come partly from runs on private client code.
