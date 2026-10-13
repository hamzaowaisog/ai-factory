# Questions about the spec (round 1 of at most 2)

Run 20261013-hackathon-problem-statement-fe-2bf7. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-5** Should all 13 requirements be approved as one run, or should the work be split by cutting or deferring a part?
  A. Approve all 13 requirements in one run.   ← recommended: The request explicitly calls for implementing the entire locked API contract in this run.
  B. Split into two runs: implement REQ-1 through REQ-8 first, then REQ-9 through REQ-13.
  C. Split into two runs: implement REQ-1 through REQ-7 first, then REQ-8 through REQ-13.
  (settles: L9 size: This spec has 13 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-6** Should lot-list responses apply an additional authorizedYards restriction beyond the filtering and security rules declared in the API contract?
  A. Apply only the lot-list filtering and security rules declared in contracts/openapi.yaml; add no authorizedYards restriction.   ← recommended: The request asks for the locked contract as written and does not ask for an additional yard-authorization rule.
  B. Also withhold every lot outside the authenticated user's authorizedYards, even when contract filters match.
  (settles: AC-2.1 and AC-2.2 cover only valid credentials and tokens, while AC-2.4 checks query filters but not whether lots outside the user's authorizedYards are withheld.)

**Q-7** How should the profitability permission checks be covered for users with view and export permissions independently?
  A. Add separate cases for the contract-defined view-only and export-only paths, checking their respective redaction and export-denial behavior.   ← recommended: Separate checks cover the distinct permission paths without expanding to every permission combination.
  B. Keep only the existing case that removes both profitability.view and profitability.export together.
  C. Test every combination of profitability.view and profitability.export.
  (settles: AC-9.6 removes both profitability.view and profitability.export at once, leaving the distinct view-only and export-only permission paths untested for redaction or export denial.)

**Q-8** After correcting or voiding a feeding event, how should the resulting stock be calculated when other persisted movements affect the same items?
  A. Calculate stock using opening stock and all persisted receipts, adjustments, and feeding events, incorporating the correction or void.   ← recommended: This preserves the effects of other persisted movements while applying the event correction or void.
  B. Calculate stock using opening stock adjusted only for the corrected or voided event, as AC-8.3 currently states.
  (settles: AC-8.3 requires stock after correction or void to equal opening stock adjusted only for that event, disregarding other persisted receipts, adjustments, or feeding events that may affect the same items.)

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-2bf7 4e8fca22 Q-5=A Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-5="only for trade customers")

Card hash: 4e8fca22