# Questions about the spec (round 2 of at most 2)

Run 20261011-folio3-parking-app-introductio-c24e. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-12** How should actual entry by a permanent-sticker vehicle be recorded for utilization, given that it bypasses temporary authorization verification?
  A. Record LPR-detected entry for utilization without performing authorization verification.   ← recommended: This reuses the requested LPR entry records while preserving the existing sticker process and avoiding an added manual step.
  B. Have security manually record each permanent-sticker vehicle's actual entry.
  C. Do not record permanent-sticker vehicle entry; classify dedicated parking using the available records.
  (settles: Rubric 1: REQ-22 classifies dedicated parking with no actual-entry record as unused, but REQ-18 bypasses system verification for permanent-sticker vehicles and REQ-21 records actual entry only after temporary verification, so ordinary dedicated-space use cannot produce the evidence needed to avoid being classified as unused.)

**Q-13** Should an employee be able to cancel a successful temporary claim, and if so, who may cancel it?
  A. Remove temporary-claim cancellation; a successful claim remains assigned.   ← recommended: The request asks for cancellation of scheduled releases, not cancellation of successful temporary claims, so removing this extra capability is the smallest requested scope.
  B. Allow only the claimant to cancel their successful temporary claim.
  C. Allow any employee to cancel a successful temporary claim.
  (settles: Rubric 1: REQ-17 makes a cancelled space immediately available without limiting cancellation to the claimant, while REQ-5 restricts employees to their own records, leaving the cancellation authorization rules inconsistent.)

Answer with letters or your own words:
  factory answer 20261011-folio3-parking-app-introductio-c24e fc8ec7ce Q-12=A Q-13=A
  (use quotes for words: Q-12="only for trade customers")

Card hash: fc8ec7ce