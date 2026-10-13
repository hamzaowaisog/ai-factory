# Questions about the spec (round 2 of at most 2)

Run 20261012-folio3-parking-app-introductio-d447. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-11** After a Parking Administrator intervenes to reverse a claimed release, what should happen to the space, given that the claimant’s temporary authorization is not automatically revoked?
  A. Keep the space allocated to the original claimant for that date; record the intervention and do not make the space available to the holder or another claimant.   ← recommended: This preserves the specified authorization and avoids allocating the same space to multiple users.
  B. Return the space to the holder, while leaving the original claimant’s authorization valid for that date.
  C. Return the space to the holder only after the administrator explicitly revokes the original claimant’s authorization.
  D. Make the space available for another claim while leaving the original claimant’s authorization valid for that date.
  (settles: Rubric 1: REQ-13 preserves the claimant’s authorization after reversing a claimed release but does not define whether the space remains allocated, returns to the holder, or becomes claimable again, leaving allocation semantics potentially inconsistent with REQ-16’s no-double-allocation rule.)

**Q-12** Should this specification define how Parking Administrator and Security Guard role assignments are provisioned?
  A. Keep role provisioning out of scope; assume staff role assignments are handled outside this system.   ← recommended: The request specifies staff roles and their responsibilities, but does not ask for a role-provisioning process.
  B. Allow an existing Parking Administrator to assign or remove the Parking Administrator and Security Guard roles in the application.
  C. Define a separate controlled process for authorizing and provisioning these staff roles.
  (settles: Rubric 2: REQ-33 and REQ-27 assume authenticated Parking Administrator and Security Guard roles but specify no role assignment or provisioning path, so the spec does not define how legitimate staff obtain these privileges or prevent unauthorized promotion.)

**Q-13** For a temporary parking claim, must the selected vehicle be active, or may an employee select a registered vehicle that has been deactivated?
  A. Require selection of an active vehicle registered to the claimant; deactivated vehicles cannot be used for claims.   ← recommended: This adds the active-status check to the vehicle-selection requirement while keeping claims tied to the claimant’s own registered vehicles.
  B. Allow selection of any vehicle registered to the claimant, including deactivated vehicles.
  C. Allow a claimant or Parking Administrator to choose whether a deactivated vehicle can be used for a claim.
  (settles: Rubric 2: REQ-18 requires a registered vehicle selection but never requires that the vehicle be active and owned by the claimant, allowing the claim API to authorize another employee’s plate or a deactivated vehicle unless an unstated check is added.)

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-d447 e0b8b930 Q-11=A Q-12=A Q-13=A
  (use quotes for words: Q-11="only for trade customers")

Card hash: e0b8b930