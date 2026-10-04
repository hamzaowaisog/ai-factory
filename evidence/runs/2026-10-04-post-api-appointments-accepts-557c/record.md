# 20261004-post-api-appointments-accepts-557c

| | |
|---|---|
| Factory | 9252175 |
| Project / repo | eval-vsa / vsa-patient-double-booking-JDJcfV at 463a2c3 (main) |
| Ticket | POST /api/appointments accepts a second appointment for the same patient that ov |
| Outcome | **waiting** |
| Size / lane / risk | M / full / medium (impact: medium) |
| Recorded cost | $6.11 |
| Active / wall time | 29.2 / - min |
| Changed | 22 production lines in 1 files; 546 test lines in 3 files |
| Impact | must-change 0, breaks 0, check 17, callers 32, data 3, screens 0, tests 7 |

| Step | Cost | Tokens in (uncached / cached) / out | Minutes | Tries | Gate failures | Models |
|---|---|---|---|---|---|---|
| discover | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| intake | $0.00 | 1.1K / 0 / 570 | 0.1 | 1 | 0 | claude-haiku-4-5 |
| ground | $0.20 | 12 / 44.8K / 4.5K | 0.7 | 1 | 0 | claude-opus-5-5 |
| clarify | $0.21 | 15 / 2.2K / 10.2K | 1.0 | 1 | 0 | claude-sonnet-5, claude-haiku-4-5, claude-opus-5-5 |
| clarify-2 | $0.08 | 4 / 0 / 2.2K | 0.4 | 1 | 0 | claude-opus-5-5 |
| drafts | $1.07 | 14.8K / 72.0K / 33.8K | 4.5 | 2 (Retrying with the failures) | 0 | claude-opus-5-5, gpt-5.5 |
| merge | $0.21 | 4 / 0 / 6.9K | 0.9 | 1 | 0 | claude-opus-5-5 |
| specify | $2.13 | 32.6K / 99.0K / 69.9K | 10.9 | 1 | 0 | claude-sonnet-5, gpt-5.5, claude-haiku-4-5, claude-opus-5-5 |
| impact | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| plan | $0.24 | 10 / 67.4K / 4.7K | 0.7 | 1 | 0 | claude-opus-5-5 |
| approve | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| stub-commit | $0.00 | 0 / 0 / 0 | 0.0 | 1 | 0 |  |
| author-tests | $1.82 | 66 / 1217.3K / 51.1K | 10.1 | 2 (Retrying with the failures) | 1 | claude-opus-5-5 |
| implement/TASK-1 | $0.15 | 16 / 209.7K / 2.2K | 1.3 | 1 | 0 | claude-sonnet-5 |

| Card | Waited | Decision |
|---|---|---|
| question | 0 s | answer |
| question | 0 s | answer |
| approval | 0 s | approve |
| cap | still open | - |

The scrubbed ledger is in `ledger.tar.gz` (events, trace, cards, artifacts).
