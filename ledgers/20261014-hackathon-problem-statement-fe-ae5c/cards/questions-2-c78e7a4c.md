# Questions before the spec (round 2)

Run 20261014-hackathon-problem-statement-fe-ae5c. Your request:
> Hackathon Problem Statement: Feedlot Management Solution
> 
> A feedlot is a specialized livestock operation focused on transforming young cattle (300–500 lbs)
> into market-ready livestock (1,200–1,400 lbs) over an 8- to 12-month cycle. The core business
> objective is to maximize the "feed-to-gain" ratio, as the operation's profitability is directly tied
> to how efficiently animals convert nutritional rations into body weight.
> 
> Management is split between two primary tiers: Lots and Pens. A "Lot" reflects the business
> unit (a specific group of cattle purchased and analyzed together for performance), while a "Pen"
> serves as the physical unit (where daily feeding and housing activities occur). Effective software
> must bridge these tiers, allowing for granular daily execution at the pen level while providing
> high-level performance metrics at the lot level.
> 
> Key Requirements
> ● Integrated Data Management
> ○ Procurement Ingestion: Seamlessly import animal data (weight, breed, age, and
> source) from the primary procurement system.
> ○ Lifecycle Forecasting: Automatically calculate projected market dates and target
> weights based on incoming data.
> ● Feed & Ration Management
> ○ Inventory Control & Projections: Monitor real-time ingredient levels and
> generate automated inventory forecasts across multiple time horizons—daily,
> weekly, monthly, quarterly, bi-annual, and annual.
> ○ Wastage Calibration: Integrate a configurable wastage ratio into all consumption
> estimates and inventory projections to account for feeding-loss and ensure
> procurement accuracy.
> ○ Ration & Cost Optimization: Manage complex nutritional recipes and perform
> cost-benefit analysis on different feed mixes to identify the most economical
> paths to weight gain.
> ○ Dynamic Bunk Management: Track daily bunk rates and consumption patterns at
> the pen level, allowing for real-time adjustments to feeding plans based on
> actual intake versus projections.
> ● Execution & Activity Tracking
> ○ Pen-Level Planning: Generate daily feeding schedules and plans for specific
> physical pens.
> ○ Activity Logging: Capture actual feeding data to identify variances between the
> plan and execution.
> ● Performance & Conversion Analytics
> 
> ○ Feed-to-Gain Ratio: Calculate the primary efficiency KPI (Total Feed Consumed vs.
> Total Weight Gained).
> ○ Lot-Level Profitability: Provide deep-dive analysis on specific groups to determine
> the financial ROI of each lot.
> ○ Predictive Insights: Suggest "next steps" for feeding adjustments or sale timing
> based on current weight-gain trends.
> 
> Additional Information & Requirements:
> 
> Create sample/mock data to support the system. Assume the following information is based on
> mock data fetched from other systems.
> 
> ● Automated Data Ingestion: Synchronize PO and Receiving data (Vendor, Costs, Head
> Count, Weights) to eliminate manual entry and establish the financial baseline for each
> lot.
> ● Dynamic Lot Mapping: Reflect complex upstream relationships where a single PO Line
> may split into multiple Lots, ensuring 1:1 or 1:N traceability.
> ● Entity Mapping (PO → Lot → Pen): Provide the foundation to link procurement data to
> physical locations. The system will reflect Pen ID, capacity, and current animal counts as
> fetched from the source.
> ● Centralized Operational Entities: Establish the Lot and Pen as the primary units for all
> downstream feeding and performance analytics.
> ● Lightweight Implementation: Focus on backend data connectivity rather than refined
> UI/UX, as these modules serve specifically to support the feed-to-gain engine.
> 
> The Feed-to-Gain Engine (The Core Challenge)
> 
> Inventory, Ration Module & Feed Plan per Pen
> 
> ● Allow users to maintain a feed Inventory with feed types, available quantities, and unit
> costs ($/lb or $/ton).
> ● Each inventory item may include:feed item name, feed category, quantity available, unit
> of measure, cost per unit, dry matter percentage, energy value, and storage location. It
> should also track stock movement by maintaining the opening stock, stock received,
> stock consumed, and closing stock for each feed item.
> 
> ● Allow users to create a Ration (a feed recipe) by combining multiple feed ingredients
> with specified proportions. Each ration has a calculated cost per pound based on its
> ingredient mix.
> ● A ration may include the Ration name, Ration type, Feed ingredients used, Quantity or
> percentage of each ingredient, Dry matter percentage, Energy value, Cost per unit, and
> Intended animal type or weight range.
> ● A feed plan per pen defines what ration needs to be fed to a specific pen, how much
> feed should be provided, and on which date it should be delivered. Since pens may
> contain animals from one or more lots, the feed plan helps operators manage feeding
> execution in a structured and organized way. The feed plan per pen may include the
> Feed plan date, Pen, Assigned lot, Number of animals in the pen, Selected ration,
> Planned feed quantity, Planned feeding time, Feed quantity per animal, Total feed cost,
> Expected energy intake, and Feed plan status, such as Planned, In progress, Completed,
> or Skipped. The system should allow users to generate a feed plan based on the daily
> bunk rate, selected ration, and number of animals in the pen.
> 
> Feeding Activity
> 
> ● Allow users to log a Feeding Activity against a specific Pen, capturing:
> ○ The feeding activity should capture the Feeding date, Pen, Lot, Ration, Planned
> feed quantity, Actual feed quantity delivered, Difference between planned and
> actual feed, Feed cost, Energy value, Inventory consumed, and Feeding status.
> ● On save, the system should:
> ○ Decrement the feed inventory based on the ration's ingredient mix
> ○ Calculate and store the total feed cost for that feeding event
> ○ Roll up cumulative feed consumption and feed cost at the lot level
> ● Suggested calculation: Feed Variance = Actual Feed Quantity - Planned Feed Quantity
> 
> Weight Measurement Activity
> 
> ● Allow users to log a Weight Measurement Activity against a Lot, capturing:
> ○ Lot
> ○ Measurement date
> ○ Number of animals weighed
> ○ Average animal weight
> ○ Total lot weight
> ○ Weight gain since last measurement
> ○ Notes
> ● Maintain a time-series of weight readings per lot to enable trend analysis.
> 
> Feed-to-Gain Calculation Engine
> 
> This is the most critical part. Build the calculation logic that derives the following metrics from
> feeding and weight data:
> 
> Feed-to-Gain Calculation Metrics
> 
> Metric Formula Why It Matters
> 
> Days on Feed (DOF) Current Date − Receiving Date Tracks how long the lot has
> been on feed
> 
> Total Weight Gain Current Avg Weight − Entry Avg Weight Total growth achieved so far
> 
> Average Daily Gain (ADG) Total Weight Gain ÷ DOF Primary performance
> benchmark
> 
> Total Feed Consumed Sum of all feeding events Total feed input
> 
> Feed Conversion Ratio
> (FCR)
> Total Feed Consumed (lbs) ÷ Total
> Weight Gain (lbs)
> Feed efficiency metric (lower
> is better)
> 
> Cost of Gain ($/lb) Total Feed Cost ÷ Total Weight Gain Core profitability indicator
> 
> Projected Ship Date DOF + ((Target Weight − Current Weight)
> ÷ ADG)
> Forecasted shipping readiness
> 
> These metrics should update automatically whenever a new feeding or weight event is
> recorded.
> 
> Dashboard & Reports (Visualization Layer)
> 
> Surface the engine's output in a way that helps a feedlot operator make decisions.
> 
> The dashboard should include:
> 
> ● Active lots
> ● Active pens
> ● Animals per lot and pen
> ● Feed inventory status
> ● Ration usage
> ● Daily bunk rate per pen
> ● Planned feed vs actual feed
> ● Total feed consumed
> ● Total feed cost
> ● Starting weight vs current weight
> ● Total weight gain
> ● Average Daily Gain
> ● Feed-to-gain ratio
> ● Feed cost per unit of gain
> ● Energy consumed
> ● Best and worst performing lots
> 
> The reports should help answer questions such as:
> 
> ● Which pen consumed the most feed?
> ● Which lot has the best feed-to-gain ratio?
> ● Which lot has the highest Average Daily Gain?
> ● Which ration is being used the most?
> ● Is actual feeding aligned with the feed plan?
> ● Which pens are being overfed or underfed?
> ● How much feed inventory is remaining?
> ● What is the feed cost per unit of weight gain?
> 
> Feed-to-Gain Report
> 
> A dedicated report screen that allows users to:
> 
> ● Compare ADG, FCR, and Cost of Gain across multiple lots
> ● Filter by date range, breed, sex, or pen
> 
> ● Export the report as a CSV or PDF
> 
> Yard-Level Summary (Stretch Goal)
> 
> A high-level dashboard showing aggregate metrics across all active lots — total head, average
> ADG, average Cost of Gain, total feed cost — to give the yard manager a single-glance overview.
> 
> Evaluation Criteria
> 
> Submissions will be evaluated on:
> 
> 1. Correctness of the Feed-to-Gain Calculations — Are the formulas implemented
> accurately? Do metrics update correctly as new data is entered?
> 2. Quality of the Dashboard & Visualizations — How effectively does the UI communicate
> performance to a non-technical operator?
> 3. Data Integrity — Are inventory decrements, feed cost calculations, and weight tracking
> consistent and reliable?
> 4. User Experience — Is the flow from PO → Lot → Daily Activities → Dashboard intuitive
> and frictionless?
> 5. Code Quality & Architecture — Is the solution modular and extensible for future
> activities (treatments, vaccinations, shipping, etc.)?
> 
> What to present and deliver:
> ● Proposed Solution (Approach) and Architectural Diagrams
> ● Demo of the App
> ● Overview Vibe Coding Super Prompt & Other prompts
> ● How was it tested and validated?
> ● What challenges did you face?
> ● How close is this to production readiness?
> ● Go to Market Strategy and Analysis (Extra Advantage) If you build a product based
> solution/offering & with a go-to-market insight.

**Q-6** What should ration optimization treat as its objective and constraints, and should a suggested ration ever be applied automatically?
  A. Present feasible low-cost mixes for user-specified nutritional targets or constraints; require the user to select a suggestion before using it.   ← recommended: This makes the optimization objective explicit while keeping the requested management decision with the user.
  B. Rank mixes by estimated cost for an intended animal or weight range, without enforcing nutritional constraints.
  C. Automatically apply the lowest-cost mix that meets configured nutritional constraints to eligible pen plans.
  (why it matters: The choice affects ration composition, costs, and potentially what feed is assigned to animals.)

**Q-7** Must each actual feeding activity be linked to an existing feed plan, or may operators record feedings when no plan exists?
  A. Allow an activity against a pen and date without a plan; link it to a plan when one exists so variance can be shown.   ← recommended: This supports actual activity logging even when plans are missing while still enabling the requested planned-versus-actual comparison.
  B. Require every activity to reference a plan, and reject activity entry when no plan exists.
  C. Allow unplanned activities but do not compare them with planned quantities.
  (why it matters: The choice determines whether feeding records can be saved and whether inventory and performance totals update for them.)

**Q-8** How should lot-level total weight gain be derived when measurements record an average weight and a number of animals weighed?
  A. Calculate lot total gain from the average-weight change multiplied by the lot headcount applicable at the measurement dates.   ← recommended: This makes the gain denominator comparable to total feed consumed and supports the requested lot-level FCR and cost-of-gain metrics.
  B. Calculate gain only for the number of animals weighed, and use that same cohort for the corresponding feed-to-gain calculation.
  C. Report average gain per animal and label feed-to-gain as a per-animal metric.
  (why it matters: The selected population basis directly changes lot weight gain, FCR, ADG rollups, and cost of gain.)

Assumed unless you say otherwise:
- ASM-11 (high risk, confirm on the approval card): Which procurement/receiving source and connection method should the demo support, given that no primary system is named? → assumed: Use the stated mock upstream data only; demonstrate PO and receiving synchronization with supplied sample records.
- ASM-12 (high risk, confirm on the approval card): How should imported PO lines or receiving records that cannot be mapped to a lot or pen be handled? → assumed: Keep them visibly pending and exclude them from pen operations until mapped.
- ASM-13 (high risk, confirm on the approval card): What should happen when a PO-line-to-lot assignment would exceed the fetched pen capacity? → assumed: Reject the over-capacity assignment and explain the capacity limit.
- ASM-14 (high risk, confirm on the approval card): How should repeated imports of the same PO or receiving records be recognized and handled? → assumed: Use upstream record identifiers when available, skip records already imported, and report that they were duplicates.
- ASM-15: Which target weight and gain-rate assumptions should drive market-date forecasts when incoming data alone does not provide them? → assumed: Use a configurable target weight and gain-rate assumption for each lot, editable by users and retained with its forecast.
- ASM-16: Should inventory forecasts also generate low-stock or stockout alerts, or only show projected levels across the requested horizons? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-17 (high risk, confirm on the approval card): How may a saved lot weight measurement be corrected if an entry is later found to be wrong or out of order? → assumed: Allow an authorized user to edit or delete the reading, validate the resulting series, and recalculate affected metrics.
- ASM-18 (high risk, confirm on the approval card): What should happen when an activity would consume more feed than the inventory currently shows as available? → assumed: Reject the activity and explain the shortage; let the user correct inventory or quantity before saving.
- ASM-19: How should the feed-to-gain report respond to an invalid date range or an unsupported filter value? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-20: What should users see if loading the sample dataset encounters duplicates or only some records can be loaded? → assumed: Report added, already-present, and failed records separately, and do not label a partial load as complete.
- ASM-21: Should the yard-level aggregate dashboard be included in the core deliverable or treated as the stated stretch goal? → assumed: Treat it as a stretch goal; prioritize lot- and pen-level dashboards and reports.

Answer with letters or your own words:
  factory answer 20261014-hackathon-problem-statement-fe-ae5c c78e7a4c Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: c78e7a4c