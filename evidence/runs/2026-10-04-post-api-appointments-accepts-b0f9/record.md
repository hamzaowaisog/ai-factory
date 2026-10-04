# 20261004-post-api-appointments-accepts-b0f9

| | |
|---|---|
| Factory | c66539e |
| Project / repo | eval-vsa / vsa-patient-double-booking-VfY6VV at 7eda034 (main) |
| Ticket | POST /api/appointments accepts a second appointment for the same patient that ov |
| Outcome | **delivered** |
| Size / lane / risk | S / light / medium (impact: medium) |
| Recorded cost | $2.50 |
| Active / wall time | 13.8 / 14.6 min |
| Changed | 16 production lines in 1 files; 190 test lines in 2 files |
| Locked tests | 5/5 passed |
| Impact | must-change 0, breaks 0, check 10, callers 18, data 0, screens 0, tests 5 |

| Step | Cost | Tokens in (uncached / cached) / out | Minutes | Tries | Gate failures | Models |
|---|---|---|---|---|---|---|
| discover | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| intake | $0.00 | 1.1K / 0 / 494 | 0.1 | 1 | 0 | claude-haiku-4-5 |
| ground | $0.38 | 22 / 83.7K / 9.0K | 1.3 | 2 (Retrying with the failures) | 1 | claude-opus-5-5 |
| clarify | $0.17 | 3.8K / 2.1K / 8.5K | 0.8 | 1 | 0 | claude-sonnet-5, claude-haiku-4-5, claude-opus-5-5 |
| clarify-2 | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| drafts | $0.07 | 2 / 0 / 4.7K | 0.7 | 1 | 0 | claude-sonnet-5 |
| merge | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| specify | $0.24 | 10.6K / 1.5K / 7.5K | 1.0 | 1 | 0 | claude-sonnet-5, gpt-5.5, claude-haiku-4-5, claude-opus-5-5 |
| impact | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| plan | $0.12 | 6 / 13.9K / 1.8K | 0.3 | 1 | 0 | claude-opus-5-5 |
| approve | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| stub-commit | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| author-tests | $1.27 | 126 / 2902.9K / 40.3K | 8.6 | 2 (Retrying with the failures) | 1 | claude-sonnet-5 |
| implement/TASK-1 | $0.09 | 8 / 69.4K / 1.1K | 0.7 | 1 | 0 | claude-sonnet-5 |
| integrate | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| accept | $0.00 | 0 / 0 / 0 | 0.1 | 1 | 0 |  |
| design-fidelity | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| design-check | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| review | $0.16 | 4.0K / 0 / 4.7K | 0.9 | 1 | 0 | gpt-5.5 |
| deliver | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |

| Card | Waited | Decision |
|---|---|---|
| question | 0 s | answer |
| approval | 0 s | approve |

The scrubbed ledger is in `ledger.tar.gz` (events, trace, cards, artifacts).
