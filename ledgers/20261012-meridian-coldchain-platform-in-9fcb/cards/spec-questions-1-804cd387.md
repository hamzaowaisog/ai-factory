# Questions about the spec (round 1 of at most 2)

Run 20261012-meridian-coldchain-platform-in-9fcb. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** The 28 requirements are estimated at about four runs of work. How would you like the scope handled?
  A. Approve all 28 requirements as one run.
  B. Split the full scope across about four runs; keep all requirements.   ← recommended: This accommodates the stated size estimate without dropping requested functionality.
  C. Reduce the scope before starting; identify which requirements to cut.
  (settles: L9 size: This spec has 28 requirements, about 4 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** What should happen to unsynchronized driver actions when a driver signs out or the API reports the account disabled, especially if another user later signs in on the same browser?
  A. Clear unsynchronized actions on sign-out or disabled-account response; do not sync them later.
  B. Retain unsynchronized actions in a queue tied to the originating driver; sync only after that same driver signs in again, and erase or reject the queue if access is refused or the account is disabled.   ← recommended: This preserves offline work while preventing another user from submitting it and honoring disabled-account rejection.
  (settles: AC-24.8 keeps queued actions, which contain recipient names, after sign-out or a disabled account and later tries to sync them, contradicting REQ-3's rule to clear protected data when access is refused and ASM-17's rule that a disabled driver's queued actions are not accepted. | After a driver signs out with actions still queued, nothing says whose identity the later sync runs under or stops a different user on the same browser from submitting the first driver's queued handovers.)

**Q-11** When a temperature-history gap affects stock, should the stock be automatically placed On Hold while the gap is unresolved, or should the gap be flagged for review without automatically changing stock status?
  A. Flag the gap for review and show the API-returned stock status; do not automatically place the stock On Hold.   ← recommended: This resolves the conflict without adding an automatic hold that the request does not specify for gaps.
  B. Automatically place affected stock On Hold until the gap is resolved and quality staff make a decision.
  (settles: ASM-2 (flag the gap for review without automatically placing stock On Hold) and ASM-18 (keep affected stock On Hold until resolved) directly conflict, and REQ-21 defers to 'the stock status returned by the API' instead of settling which rule applies.)

**Q-12** May a temperature-profile version have an effective date in the past, and if so, how should recalculated results affect stock that was already released or had a quality decision?
  A. Require effective dates to be today or later; do not recalculate earlier decisions.   ← recommended: This avoids retroactively changing prior stock decisions, which the request does not require.
  B. Allow backdating; recalculate affected budgets and statuses, place stock that no longer qualifies On Hold, and reopen affected quality decisions for review.
  C. Allow backdating and recalculate results, but preserve prior release and quality decisions while flagging conflicts for review.
  (settles: AC-6.2 and AC-6.4 allow backdated profile versions that recalculate earlier decisions, but Q-8 never approved backdating, and nothing says what happens to stock already released or already approved by quality that now fails the recalculated budget.)

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 804cd387 Q-9=A Q-10=A Q-11=A Q-12=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 804cd387