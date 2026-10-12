# Questions about the spec (round 1 of at most 2)

Run 20261012-folio3-parking-app-introductio-0790. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should all 24 requirements proceed as one implementation run, or should scope be reduced for this run?
  A. Approve all 24 requirements as one run.   ← recommended: This preserves the full requested scope without introducing a cut the request does not specify.
  B. Split the work: proceed with REQ-1–18 now and move REQ-19–24 (utilization and reporting) to a later run.
  C. Split the work: proceed with REQ-1–18 now and move REQ-1–5 (authentication, profiles, and administration) to a later run.
  (settles: L9 size: This spec has 24 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** How must an LPR verification request prove it comes from trusted Folio3 equipment before it can activate the entrance indicator?
  A. Require the request to be authenticated as coming from trusted Folio3 LPR equipment.   ← recommended: This adds only the trust check needed to prevent forged requests from activating the indicator.
  B. Accept requests from any source if the plate matches a temporary authorization.
  C. Allow any configured integration source to submit verification requests without source authentication.
  (settles: [Rubric 2] REQ-16 does not require the LPR verification request to be authenticated as coming from trusted Folio3 equipment, so a forged request matching a temporary authorization could activate the entrance indicator.)

**Q-11** Who may view employee utilization records and export them as CSV?
  A. Only Parking Administrators may view and export utilization records; deny access to all other roles.   ← recommended: This makes the existing administrator-only intent an explicit access boundary without adding access for other roles.
  B. Parking Administrators may view all records; employees may view and export only their own records.
  C. Parking Administrators and Security Guards may view and export all records.
  (settles: [Rubric 2] REQ-22 exposes employee utilization records and CSV export to administrators but defines no denial or access-control behavior for non-administrators, leaving sensitive employee data without a specified authorization boundary.)

**Q-12** What should deployment do if no designated active Folio3 bootstrap account is supplied?
  A. Do not complete administrator setup until deployment configuration supplies a designated active Folio3 account; grant that account the initial Parking Administrator role.   ← recommended: This reuses the specified bootstrap mechanism and avoids an unclaimed administrator role or a new self-service setup flow.
  B. Allow the first active Folio3 employee who signs in to claim the initial Parking Administrator role.
  C. Start without a Parking Administrator and require an operator to assign one later through a separate process.
  (settles: [Rubric 2] REQ-5 defines initial administrator creation only when a bootstrap account is supplied and gives no behavior for setup without one, which can leave the system with no administrator able to configure or use it.)

**Q-13** When verification fails while the green indicator may already be active, what should the system do with the indicator?
  A. Explicitly set the green indicator inactive on every verification failure.   ← recommended: This directly ensures failure leaves the indicator off, including when it was previously active.
  B. Make no activation call on failure and leave the indicator in its current state.
  C. Set the indicator inactive only when no valid authorization is found, but leave it unchanged for other verification failures.
  (settles: [Rubric 3] REQ-17 requires the indicator to remain inactive on verification failure, but AC-17.1 checks only that no activation call is made, so it does not establish that a previously active indicator is turned off.)

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-0790 a993fc86 Q-9=A Q-10=A Q-11=A Q-12=A Q-13=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: a993fc86