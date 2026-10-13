# Approve the estimate (E7)

Run 20261010-co-working-space-maintenance-e182 · solely agentic · size M · uncertainty high
Hours from task catalogue 2026-10-06.1 (stack dotnet): reference hours, not yet measured.

## Anchors (check these first: every other task is sized against one)
- EST-1 Request data model, migrations, persistence, and seed data: 2.88-5.76 h (median of the estimators; the lead estimator read 2.4-4.8 h, and the ratios multiply that reading). 1 entity (Request) with migration, persistence and seed data; seed rows do not add entities: small. [be-data backend 4-8 h, small x0.6]
- EST-2 List requests API: 3.24-6.48 h (median of the estimators; the lead estimator read 2.7-5.4 h, and the ratios multiply that reading). One optional status filter plus newest-first ordering and status counts: typical. The filter makes this larger than the closest approved small endpoint, which had no filter. [be-endpoint backend 3-6 h, verify easy x0.9]
- EST-4 Create request operation and validation rules: 9.6-16.8 h (median of the estimators; the lead estimator read 12.8-22.4 h, and the ratios multiply that reading). 11 distinct rules: 3 creation assignments, 4 field validations, field-specific errors, fixed fields, no deletion, and an operation allowlist: large, matching the approved large task. [be-rules backend 8-14 h, large x1.6]
- EST-6 Web application shell and light theme: 12.48-21.84 h. One browser layout with an explicit light theme and shared responsive/accessibility UI factors: typical. The closest approved shell was small; this scope includes the explicit theme and shared UI factors. [ui-shell web 8-14 h, verify hard x1.3, context partial x1.2]
- EST-7 Requests list screen: 9.36-15.6 h. One status filter on a newest-first list, with loading/empty/error states and filter-retention behavior: typical. Responsive presentation and shared UI factors are not counted again beyond the shell. [ui-list web 6-10 h, verify hard x1.3, context partial x1.2]
- EST-8 New request dialog: 5.62-9.36 h. 4 labeled fields with validation and submit/cancel behavior: small (up to 5 fields). Dialog error and retry states do not add fields. [ui-form web 6-10 h, small x0.6, verify hard x1.3, context partial x1.2]
- EST-9 Request detail screen: 7.8-12.48 h. A detail view with one status-dependent action at a time, plus not-found and update-failure states: typical. [ui-detail web 5-8 h, verify hard x1.3, context partial x1.2]
- EST-10 Automated request business-rule test cases: 3.6-7.2 h (median of the estimators; the lead estimator read 2.7-5.4 h, and the ratios multiply that reading). 3 test flows: creation/validation, status transitions, and filtered listing/not-found behavior: typical. [qa-cases qa 3-6 h, verify easy x0.9]
- EST-11 Automated list-to-completion end-to-end test: 5.4-9 h. One multi-step list-to-completion workflow spanning list, create, detail, status changes and the Done filter; broader than a short flow: typical, matching the approved typical task. [qa-e2e qa 6-10 h, verify easy x0.9]
- EST-12 Client acceptance testing: 4-8 h. One client acceptance and regression round: typical, matching the approved typical task. [qa-uat qa 4-8 h, typical]
- EST-13 Client liaison and project management: 4-8 h. Client liaison, scope decisions and sign-offs across the project; assuming about a month of delivery: typical, matching the approved typical task. [pm-management pm 4-8 h, typical]

## Sized with approved past tasks as references
- EST-1 Request data model, migrations, persistence, and seed data: small; like EST-2 of 20261005-parts-quick-order-requirements-4974 (small, 2.16-4.32 h), EST-2 of 20261005-parts-quick-order-requirements-a8db (small, 2.16-4.32 h)
- EST-2 List requests API: typical; like EST-8 of 20261005-parts-quick-order-requirements-4974 (small, 1.62-3.24 h), EST-8 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h) (sized differently: see its reason)
- EST-3 Get request by ID API: small; like EST-8 of 20261005-parts-quick-order-requirements-4974 (small, 1.62-3.24 h), EST-8 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h)
- EST-4 Create request operation and validation rules: large; like EST-6 of 20261005-parts-quick-order-requirements-4974 (large, 12.8-22.4 h), EST-6 of 20261005-parts-quick-order-requirements-a8db (large, 12.8-22.4 h)
- EST-5 Request status-change operation and transition rules: typical; like EST-9 of 20261005-parts-quick-order-requirements-4974 (typical, 7.21-12.61 h), EST-9 of 20261005-parts-quick-order-requirements-a8db (typical, 7.21-12.61 h)
- EST-6 Web application shell and light theme: typical; like EST-10 of 20261005-parts-quick-order-requirements-4974 (small, 4.8-8.4 h), EST-10 of 20261005-parts-quick-order-requirements-a8db (small, 5.76-10.08 h) (sized differently: see its reason)
- EST-7 Requests list screen: typical; like EST-12 of 20261005-parts-quick-order-requirements-4974 (typical, 6-10 h), EST-12 of 20261005-parts-quick-order-requirements-a8db (typical, 6-10 h)
- EST-8 New request dialog: small; like EST-14 of 20261005-parts-quick-order-requirements-4974 (small, 5.04-8.4 h), EST-14 of 20261005-parts-quick-order-requirements-a8db (small, 5.04-8.4 h)
- EST-9 Request detail screen: typical; like EST-16 of 20261005-parts-quick-order-requirements-4974 (typical, 7-11.2 h), EST-16 of 20261005-parts-quick-order-requirements-a8db (typical, 7-11.2 h)
- EST-10 Automated request business-rule test cases: typical; like EST-17 of 20261005-parts-quick-order-requirements-4974 (typical, 3-6 h), EST-18 of 20261005-parts-quick-order-requirements-4974 (typical, 3-6 h)
- EST-11 Automated list-to-completion end-to-end test: typical; like EST-21 of 20261005-parts-quick-order-requirements-4974 (typical, 6-10 h), EST-21 of 20261005-parts-quick-order-requirements-a8db (typical, 6-10 h)
- EST-12 Client acceptance testing: typical; like EST-24 of 20261005-parts-quick-order-requirements-4974 (typical, 4-8 h), EST-24 of 20261005-parts-quick-order-requirements-a8db (typical, 4-8 h)
- EST-13 Client liaison and project management: typical; like EST-25 of 20261005-parts-quick-order-requirements-4974 (typical, 4-8 h), EST-25 of 20261005-parts-quick-order-requirements-a8db (typical, 4-8 h)

## Split before the build (agent work this size fails and retries more)
- EST-4 Create request operation and validation rules: 9.6-16.8 h, over 16 h
- EST-5 Request status-change operation and transition rules: 9.6-16.8 h, over 16 h
- EST-6 Web application shell and light theme: 12.48-21.84 h, over 16 h

## Totals (hours to deliver, as the workbooks show them; human hours in brackets)
- backend: 27.26-49.73 h (human 0-0 h)
- web: 35.26-59.28 h (human 0-0 h)
- qa: 13-24.2 h (human 4-8 h)
- pm: 4-8 h (human 4-8 h)
- Overall: 79.52-141.21 h (human 8-16 h; design included)

## Cost and time
- API credits: $12.66-$64.09, partial (21 measured records); indicative, not a quote
- API credits per task (its share of build and verification, by hours; every task's on the task sheets): EST-6 Web application shell and light theme $2.04-$9.78; EST-4 Create request operation and validation rules $1.57-$7.53; EST-5 Request status-change operation and transition rules $1.57-$7.53; EST-7 Requests list screen $1.48-$7.11; EST-9 Request detail screen $1.20-$5.78; and 6 more
- Planning: 15 min · build critical path: 3.71-6.51 days
- Build time basis: cold-start (0 of 4 task classes measured from earlier builds; the rest use the sized hours as an assumed duration)

## Low-confidence lines (estimators disagree; each needs your sign-off)
- EST-1 Request data model, migrations, persistence, and seed data: 2.88-5.76 h
- EST-2 List requests API: 3.24-6.48 h
- EST-3 Get request by ID API: 1.94-3.89 h
- EST-4 Create request operation and validation rules: 9.6-16.8 h
- EST-5 Request status-change operation and transition rules: 9.6-16.8 h
- EST-10 Automated request business-rule test cases: 3.6-7.2 h
- EST-11 Automated list-to-completion end-to-end test: 5.4-9 h

## Suggested, not included
none

## Assumptions
- Spec question Q-6: Should the 1280 px table-layout target be configurable, or remain the fixed target specified for this release? → Keep 1280 px as the fixed table-layout target. (answered)
- Spec question Q-7: Should the request detail screen add states for loading a request and for failures other than not-found? → Keep the specified detail behavior: show the request on success and “Request not found.” for an unknown ID; add no other fetch states. (answered)
- Spec question Q-8: How should AC-1.1 verify that a newly created request can be retrieved? → Compare the create response with a separate get-by-ID API response. (answered)
- No design was drawn for this estimate (it was left out at the start): the UI tasks are sized from the requirements alone, with no approved screens behind them, so their range is wider. A build from this estimate draws the design and has it approved before its plan.
- Gate time, cost and duration are assumed figures, labelled cold-start until the ledger has measured runs.
- Split before the build: EST-4, EST-5, EST-6 (agent work over 16 h or very large is split into smaller tasks; the hours stay as estimated).

## Gates
- passed estimate.e1-readiness: 24 requirements, lint, critic and round trip clean (3 problems settled by questions), no open questions
- passed estimate.e2-req-to-task: all 24 requirements have a task
- passed estimate.e3-task-to-req: every task cites a requirement or a named overhead
- passed estimate.e2c-task-kind: every task has a catalogue kind that fits its track (catalogue 2026-10-06.1)
- passed estimate.e4-checklist: 14 checklist items each in, or out with a reason
- passed estimate.e1c-design-coverage: no approved screens, and no task cites one
- passed estimate.e5-consistency: similar tasks are within tolerance
- passed estimate.e6-lint: totals, ratios and costs recompute cleanly

## Waivers
none

Approve: factory approve 20261010-co-working-space-maintenance-e182 50e51b23 --sign-off EST-1,EST-2,EST-3,EST-4,EST-5,EST-10,EST-11
Edit:    factory edit-estimate 20261010-co-working-space-maintenance-e182 50e51b23 --anchor EST-1=<min>-<max> --ratio <EST-n>=<multiple> --reason "why"   (everything recomputes; you get a new card)
Reject:  factory reject 20261010-co-working-space-maintenance-e182 50e51b23 --reason "why"

Card hash: 50e51b23