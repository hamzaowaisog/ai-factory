# Questions about the spec (round 1 of at most 2)

Run 20261010-co-working-space-maintenance-e182. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-6** Should the 1280 px table-layout target be configurable, or remain the fixed target specified for this release?
  A. Keep 1280 px as the fixed table-layout target.   ← recommended: This preserves the requested layout target without adding configuration that was not requested.
  B. Make the table-layout breakpoint configurable.
  (settles: L12 literals: REQ-22 hardcodes "1280"; should it be configuration?; REQ-23 hardcodes "2026"; should it be configuration?)

**Q-7** Should the request detail screen add states for loading a request and for failures other than not-found?
  A. Keep the specified detail behavior: show the request on success and “Request not found.” for an unknown ID; add no other fetch states.   ← recommended: The request specifies only success and not-found detail behavior, so this avoids adding unrequested states and controls.
  B. Add a loading state and a generic load-failure state with a Retry control.
  C. Add a loading state and a generic load-failure state without a Retry control.
  (settles: The detail screen has no loading state and no load-failure state for errors other than not-found (such as a network or server error); only success and "Request not found." are covered.)

Answer with letters or your own words:
  factory answer 20261010-co-working-space-maintenance-e182 7092e25c Q-6=A Q-7=A
  (use quotes for words: Q-6="only for trade customers")

Card hash: 7092e25c