# Questions about the spec (round 1 of at most 2)

Run 20261012-folio3-parking-app-introductio-dd8b. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should all 22 requirements proceed together as one run, or should the scope be reduced?
  A. Approve all 22 requirements as one run.   ← recommended: This keeps the requested functionality intact and settles the scope check without choosing cuts the request did not specify.
  B. Reject this scope and identify which requirements to cut before proceeding.
  (settles: L9 size: This spec has 22 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** If an entrance check fails because the camera, plate recognition, network, or indicator is unavailable, should the vehicle be held for manual verification or denied entry until service is restored?
  A. Hold the vehicle and allow entry only after an approved manual verification.
  B. Deny entry until service is restored; do not provide a manual-verification path.   ← recommended: The request says vehicles without valid authorization are not permitted to enter, and does not ask for an outage exception.
  (settles: (1) ASM-3 calls for holding vehicles for approved manual verification during an outage, while ASM-13 says to deny entry until service is restored, and REQ-17 does not choose between these outcomes.)

**Q-11** How should the app ensure an employee can access only their own profile and vehicle data?
  A. Require the signed-in Folio3 Google identity to match the corporate email used to retrieve the profile, and restrict employee and vehicle data to that employee (with administrators retaining their authorized access).   ← recommended: This directly closes the identity-binding and cross-employee access gaps while preserving the stated administrator role.
  B. Match the signed-in identity to the corporate email, but do not add an employee-level data access restriction.
  C. Do not require an identity-to-email match or employee-level data restriction beyond Folio3 account authentication.
  (settles: (2) REQ-2 retrieves profiles by corporate email but never requires binding that email to the authenticated identity or restricting profile and vehicle data to the employee who owns it, leaving cross-employee PII access unspecified.)

**Q-12** If a permanent-sticker holder enters using a space that was released and allocated temporarily, what should happen to the temporary claimant’s authorization?
  A. Treat the permanent holder’s detected entry as use of that space, cancel the temporary allocation, and deny the temporary claimant authorization for that space.   ← recommended: This prevents authorizing a temporary claimant for a space already used by its permanent holder.
  B. Keep the temporary allocation valid for the rest of the day, even after the permanent holder enters.
  C. Have the guard or an administrator resolve the conflict manually, without automatically changing the allocation.
  (settles: (1) REQ-15 authorizes any plate with a valid temporary allocation without checking whether the released space is occupied, so it can authorize the temporary claimant after a permanent-sticker holder uses the space, contrary to the Q-6 access scenario.)

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-dd8b 69f0b26a Q-9=A Q-10=A Q-11=A Q-12=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 69f0b26a