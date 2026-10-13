# Questions about the spec (round 1 of at most 2)

Run 20261006-boutique-fitness-studio-class-b497. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** The spec has 60 requirements, which is about 5 runs of work. Should it be built in one run, or should part of it be cut or moved to a later run?
  A. Approve as one run: the request asks for all 3 screens, the rules, the design system and the tests together   ← recommended: The request calls itself a deliberately small 3-screen release and asks for all of these parts, so cutting any of them would drop something it asks for.
  B. Cut the design-system polish (dark mode, motion, typography tokens) to a later run
  C. Cut the tests (REQ-60, REQ-61) to a later run
  D. Split the work into a business-rules/data run and a screens run
  (settles: L9 size: This spec has 60 requirements, about 5 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** REQ-33 points to REQ-32 by number, and REQ-58 uses 1023 px as the top of the tablet range. Should either of these be configuration?
  A. Keep both as fixed values: the REQ-32 reference is a link between requirements, and 1023 px is just the step below the 1024 px desktop breakpoint   ← recommended: The request fixes these breakpoints and never asks for them to be configurable.
  B. Make the responsive breakpoints (768 / 1024 px) configurable design tokens
  (settles: L12 literals: REQ-33 hardcodes "REQ-32"; should it be configuration?; REQ-58 hardcodes "1023"; should it be configuration?)

Answer with letters or your own words:
  factory answer 20261006-boutique-fitness-studio-class-b497 5cd65e60 Q-9=A Q-10=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 5cd65e60