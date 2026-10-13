# Questions about the spec (round 2 of at most 2)

Run 20261013-hackathon-problem-statement-fe-1679. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-12** When one pen contains multiple lots, how should the delivered feed quantity be allocated among them?
  A. Have the user enter a delivered quantity for each lot, with the lot quantities adding up to the pen total.   ← recommended: This directly provides the per-lot allocation the requirement calls for without adding an allocation rule.
  B. Allocate the pen total automatically among lots in proportion to their animal counts.
  C. Record a separate feeding event for each lot in the pen.
  (settles: AC-11.1 requires a delivered-quantity allocation for every lot in the feeding request, but the user enters only a pen-level delivered quantity and the spec defines no way to choose or derive allocations when a pen contains multiple lots.)

**Q-13** Should ration approval be required before a planner can assign a ration?
  A. Require an authorized ration manager to approve a ration before planners can assign it.
  B. Remove the approval requirement; planners may assign any saved ration.   ← recommended: The request asks for ration creation and management, but does not ask for an approval workflow.
  (settles: The requirement promises ration approval, but no acceptance criterion covers approving a ration or distinguishing approved from unapproved rations, while REQ-9 allows a planner to select a ration without an approval condition.)

**Q-14** Which financial return metric should the lot profitability view identify?
  A. Show service-returned ROI percentage (net return divided by investment), or show it as unavailable when not returned.   ← recommended: The request specifically asks for lot-level financial ROI, and this makes the displayed metric identifiable without adding client-side calculations.
  B. Show service-returned net profit or margin in currency, or show it as unavailable when not returned.
  C. Show cost of gain as the profitability metric.
  (settles: AC-19.1 checks only for unspecified 'available profitability values,' so the profitability view can pass without displaying any identifiable financial return, margin, or profit metric even for a user permitted to see profitability.)

**Q-15** Should the explicit no-horizontal-overflow and 44-by-44-pixel minimum target criteria be retained in addition to the responsive, touch-sized baseline?
  A. Retain both explicit criteria: no horizontal page overflow and a 44-by-44-pixel minimum target size.
  B. Omit these additional explicit criteria and rely on the responsive, touch-sized baseline.   ← recommended: The request does not specify these thresholds, so the smallest scope is to rely on the baseline responsive and touch-friendly requirement.
  (settles: Ensure every page works at phone, tablet, and desktop widths without horizontal page scrolling or overflow, and provide touch controls at narrow widths with a minimum target size of 44 by 44 CSS pixels.)

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-1679 4dbf670c Q-12=A Q-13=A Q-14=A Q-15=A
  (use quotes for words: Q-12="only for trade customers")

Card hash: 4dbf670c