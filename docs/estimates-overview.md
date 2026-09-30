# The estimates path: one page

Full design: [estimates-design.md](estimates-design.md). Nothing here is built yet.

## What it is
An **estimate mode** for the factory. From refined requirements (new project) or a repo plus a request (existing project), it produces the estimate in the general estimation workbook: **hours**, **API credit cost** and **elapsed time**. A lead approves it in the terminal.

## Two delivery models, chosen at the start
| | HITL (supervisor + agents) | Solely agentic |
|---|---|---|
| Agents build | Yes | Yes |
| Human supervisor gates, lead reviews every PR | Yes | No |
| Client UAT, design approval, PM | Yes | Yes |
| Size of estimate | Larger | Smaller |

Each model has its own estimate. The second is produced on request as a child run over the approved breakdown, with its own approval.

## How it works
1. Requirements are refined first. No soft estimates.
2. For UI work, the **mock and clickable demo** are approved first. They are the sizing baseline.
3. Requirements become features and tasks. Each task cites its requirement.
4. The model proposes a few reference tasks; every other task is sized against one, with the reason stated. Code does all arithmetic.
5. Small work uses one estimator; medium and larger use three, and their disagreement sets the range.
6. Duration and API cost come from **our own measured runs**. Until enough runs exist, they are labelled cold-start with wide ranges.
7. Gates check the result. A lead approves it. Two files are exported from one data model: team file and client file.

## Gates
| Gate | Checks |
|---|---|
| E1 Readiness | Spec is clean, no open questions |
| E1b Design baseline | Mock and clickable demo approved (UI work) |
| E2 Requirement → task | Every requirement has a task |
| E3 Task → requirement | Every task traces to a requirement; extras go to "Suggested, not included" |
| E4 Forgotten work | CI/CD, environments, monitoring, etc. each marked in, or out with a reason |
| E5 Consistency | Similar tasks, similar hours; no unexplained outlier |
| E6 Workbook lint | Code recomputes every total and link |
| E7 Lead approval | Terminal approval tied to the estimate's hash |
| B1 Scope lock | Every plan task maps to an approved estimate task |
| B2 Change request | New or changed requirement creates estimate v2 with a diff |
| B3 Size cap | Finished change no bigger than approved |
| B4 Unrequested behaviour | Diff traces to requirements |
| B5 Budget burn | Warn at 80% of approved maximum, stop at 100% (hours and API spend) |

A gate that cannot check counts as failed. Only a person can waive a waivable gate, in a terminal, and the waiver is recorded.

## Request types
New project, feature, bug fix (diagnosis estimate first), upgrade, migration, takeover (audit estimate first).

## First measured numbers
A small bug fix through the factory: about **$1–2 and 20–30 minutes**, mostly the test lab (about 64%). A plain agent: about $0.20, with no test and no verification. Cost varied more than 3x with the lane. Larger phases have no measurements yet.

## Status
Design written and committed. Build starts at slice 1 after team approval.
