# Questions about the spec (round 1 of at most 2)

Run 20261013-meridian-coldchain-platform-in-1d97. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should all 18 requirements be approved for this run, or should part of the scope be cut to fit?
  A. Approve all 18 requirements as one run.   ← recommended: The request asks for every operation in the locked API contract and the data behind them, so cutting these capabilities would leave requested scope out.
  B. Cut REQ-12 and defer the authenticated logger-gateway and temperature-reading processing capability.
  C. Cut REQ-13 and REQ-14 and defer quality disposition and recall workflows.
  (settles: L9 size: This spec has 18 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** How should the authenticated logger-gateway operation handle missing or invalid credentials, unknown devices, and malformed batches?
  A. Return an authentication error for missing or invalid credentials; reject the entire batch without storing readings if it contains an unknown device or malformed data.   ← recommended: Rejecting invalid batches as a unit adds clear failure behavior without introducing partial-write handling.
  B. Return an authentication error for missing or invalid credentials; accept valid readings and report each unknown device or malformed record as rejected.
  (settles: AC-12.8 only covers a gateway batch sent with valid configured credentials for known devices; there is no AC for invalid or missing gateway credentials, unknown devices, or malformed batches.)

Answer with letters or your own words:
  factory answer 20261013-meridian-coldchain-platform-in-1d97 4feeb2ce Q-9=A Q-10=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 4feeb2ce