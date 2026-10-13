# Questions about the spec (round 1 of at most 2)

Run 20261011-folio3-parking-app-introductio-c24e. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should all 21 requirements be approved for one implementation run, or should the work be split or reduced?
  A. Approve all 21 requirements for one implementation run.   ← recommended: This preserves the full requested feature without changing its scope; run planning can be adjusted separately if needed.
  B. Split into two runs: implement authentication, profiles, and administrator setup first; implement release, claim, verification, and reporting afterward.
  C. Defer weekly utilization reporting (REQ-21–24) from this run and implement the remaining requirements.
  (settles: L9 size: This spec has 21 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** How should the release confirmation and the parking’s current status be represented when a release is not yet claimable, or becomes claimable immediately?
  A. The release action confirms “Released”; the current parking status is “Claimable” once its availability time arrives (immediately for post-time same-day releases), then “Claimed” after allocation.   ← recommended: It preserves the release confirmation while making the current status accurately reflect when the space can be claimed.
  B. Use “Released” as the current status from release until a claim; represent claimability separately.
  C. Use “Claimable” as the status as soon as the release is made, even when it cannot be claimed until the configured time.
  (settles: REQ-10 requires a release response to report `Released`, while REQ-12 requires a same-day release saved at or after the configured time to have status `Claimable`, leaving the same request with conflicting required statuses.)

**Q-11** Should administrators be able to add report recipients directly, or should the pre-authorization restriction remain, and if so, how should the initial authorized list be established?
  A. Drop the pre-authorization restriction; administrators can directly add, update, and remove report recipients.   ← recommended: The request asks administrators to manage the stakeholder list but does not ask for a separate authorization mechanism.
  B. Keep the restriction and seed the authorized stakeholder addresses during deployment; administrators can manage only those addresses afterward.
  C. Keep the restriction and add an in-app approval workflow to authorize stakeholder addresses before administrators can select them.
  (settles: ASM-27 permits administrators to select only pre-authorized stakeholder addresses, but no requirement defines how any address is initially authorized, so the recipient list cannot be populated through the specified system.)

Answer with letters or your own words:
  factory answer 20261011-folio3-parking-app-introductio-c24e b96d73e4 Q-9=A Q-10=A Q-11=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: b96d73e4