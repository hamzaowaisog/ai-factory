# Questions about the spec (round 1 of at most 2)

Run 20261013-hackathon-problem-statement-fe-1679. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should all 22 requirements be approved as one run, or should some requirements be cut?
  A. Approve all 22 requirements as one run.   ← recommended: The request describes the full feedlot solution, so approving it preserves the requested scope.
  B. Reject this run and identify which requirements to cut.
  (settles: L9 size: This spec has 22 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** How should the app handle a feeding save that times out when it cannot reliably tell whether the event was saved?
  A. Remove the uncertain-save reconciliation requirement; show a timed-out save as unknown and leave retry resolution to the existing service/user workflow.   ← recommended: The request asks for feeding activity logging and reliable inventory handling, but does not ask for new idempotency or status-lookup machinery.
  B. Add a stable save idempotency key and authoritative status lookup; retry only after the service confirms no event was saved.
  C. Keep using matching event fields in a refreshed activity list to infer whether the save succeeded.
  (settles: AC-11.8–11.9 treats matching event fields in a refreshed activity list as proof of whether a timed-out save succeeded, so an older identical event can be mistaken for the new save and a delayed or omitted event can lead to a duplicate feeding and inventory decrement.)

**Q-11** Should dashboard and yard-summary aggregates be guaranteed to exclude sample records, even when the service returns aggregates mixed with operational data?
  A. Display the returned aggregate values as provided, without a sample-free guarantee.   ← recommended: The request asks for sample data and aggregate views, but does not require sample records to be excluded from those views.
  B. Require the service to return dashboard and yard-summary aggregates that exclude sample records.
  C. Calculate these aggregates client-side from returned records, excluding sample records.
  (settles: AC-20.7 requires sample-free dashboard and yard-summary totals even when the response mixes sample and operational records, while REQ-15 and REQ-21 require displaying returned summary and aggregate values, leaving no consistent client behavior if those returned aggregates include sample data.)

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-1679 0c0be270 Q-9=A Q-10=A Q-11=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 0c0be270