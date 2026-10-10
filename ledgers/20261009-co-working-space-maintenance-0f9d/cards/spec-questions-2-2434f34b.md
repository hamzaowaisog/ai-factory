# Questions about the spec (round 2 of at most 2)

Run 20261009-co-working-space-maintenance-0f9d. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-10** Should the 1280 px wide-layout viewport be a fixed requirement or configurable?
  A. Keep 1280 px as a fixed required viewport width.   ← recommended: The request specifies 1280 px explicitly, so keeping it fixed avoids adding configurability that was not requested.
  B. Make the wide-layout viewport width configurable.
  (settles: L12 literals: REQ-23 hardcodes "1280"; should it be configuration?)

Answer with letters or your own words:
  factory answer 20261009-co-working-space-maintenance-0f9d 2434f34b Q-10=A
  (use quotes for words: Q-10="only for trade customers")

Card hash: 2434f34b