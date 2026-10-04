## Honest gaps
- **Few paid runs.** Three factory runs and one plain Claude Code baseline on public code, each run once: they show what
  works and what fails, not averages.
  The e2e suite reports each case on its own for this reason, and supports `--repeats`.
- **One e2e case so far with real models.** `vsa-patient-double-booking` stopped at its $6 cap before two fixes (light
  lane for bug fixes; clarify recommends the smallest change), then delivered with 3/3 hidden tests for $2.50. The other
  four cases are validated and proven with scripted models only.
- **The first VSA run predates the hidden-test harness.** It delivered a GitHub PR with 9/9 of its own locked tests,
  but no hidden tests scored it.
- **On a small, clear bug, plain Claude Code did as well for far less.** Same ticket, same hidden tests: Claude Code
  passed 3/3 for $0.20 in 2.4 minutes (no tests written); the factory passed 3/3 for $2.50 in 13.8 minutes, with tests
  written first and locked, a spec, a plan, a review and evidence. The extra cost buys verification, not a more correct
  fix here; a whole feature is the fairer test and is next.
- **The test writer is the costliest step** (about half of the passing run), and its first attempt was rejected for a
  characterisation test that didn't pass on the old code.
- **Calibration is not published:** its records come partly from runs on private client code.
