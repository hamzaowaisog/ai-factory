# The estimates path: one page

Full design and build status: [estimates-design.md](estimates-design.md). Reliability research: [estimate-consistency.md](estimate-consistency.md), [estimate-local-model.md](estimate-local-model.md). Benchmarks: [../bench/README.md](../bench/README.md).

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
6. Duration and API cost come from **our own measured runs** (per phase, and per task class for build time). Until enough runs exist, they are labelled cold-start with wide ranges. A pinned public benchmark is only a flagged prior and never changes a number.
7. Gates check the result. A lead approves it. Two files are exported from one data model: team file and client file.

## Gates
| Gate | Checks |
|---|---|
| E1 Readiness | Spec is clean, no open questions |
| E1b Design baseline | Mock and clickable demo approved (UI work); with design references attached, drawn from them |
| E1c Design coverage | Every task's screen is in the approved design and every approved screen has a task |
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
| B5 Budget burn | Warn at 80% of approved maximum, stop at 100% (effort and API spend); the stop opens a budget card |
| B6 Screens planned | Every approved screen with a factory task is delivered by a plan task |
| B7 Screen scope | The task that builds an approved screen may touch that screen's file |

A gate that cannot check counts as failed. Only a person can waive a waivable gate (E3-E5, E1c, B1, B3-B7), in a terminal, and the waiver is recorded. B2 goes through a change request; the B5 stop continues with `factory waive-budget`.

## Request types
New project, feature, bug fix (diagnosis estimate first), upgrade, migration, takeover (audit estimate first).

## First measured numbers
A small bug fix through the factory: about **$1–2 and 20–30 minutes**, mostly the test lab (about 64%). A plain agent: about $0.20, with no test and no verification. Cost varied more than 3x with the lane. Larger phases have no measurements yet.

## Status
Built end to end: `factory estimate` to two workbooks, and `factory start --from-estimate` to build it under gates B1-B7. Both new and existing projects work for the estimate; the build side is still .NET only. What is not done is listed at the end of [estimates-design.md](estimates-design.md#build-status-2026-10-01).
