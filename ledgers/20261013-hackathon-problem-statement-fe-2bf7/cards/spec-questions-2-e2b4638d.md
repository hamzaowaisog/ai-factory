# Questions about the spec (round 2 of at most 2)

Run 20261013-hackathon-problem-statement-fe-2bf7. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** What must AC-10.2 verify after a confirmed sample reset or replacement?
  A. Check only that the operation reports completed and the resulting recordCount is correct.
  B. Verify the affected sample records were actually removed by reset or replaced by the replacement sample records, in addition to checking completion and recordCount.   ← recommended: This is the smallest addition that confirms the requested reset or replacement actually affected the sample data.
  (settles: AC-10.2 checks only a completed status and resulting recordCount after a confirmed reset or replacement, so it could pass without verifying that the sample records were actually removed or replaced.)

**Q-10** What should the sign-in acceptance criteria cover for incorrect credentials sent to POST /auth/sign-in?
  A. Keep only the valid-credentials case.
  B. Add one case confirming incorrect credentials receive the contract-defined rejection response.   ← recommended: One negative case closes the explicit coverage gap without expanding into additional credential scenarios.
  C. Add separate rejection cases for an incorrect username and an incorrect password.
  (settles: AC-2.1 tests only valid sign-in credentials and AC-1.2 applies to protected operations, leaving no explicit rejection case for incorrect credentials sent to POST /auth/sign-in.)

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-2bf7 e2b4638d Q-9=A Q-10=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: e2b4638d