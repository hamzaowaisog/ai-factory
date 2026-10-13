# Questions before the spec (round 2)

Run 20261013-hackathon-problem-statement-fe-1679. Your request:
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

**Q-6** Who may create, revise, optimize, and approve ration definitions?
  A. Only users with authorized ration-management access may perform these actions; other users may view rations.   ← recommended: This limits changes to an authorized group without imposing an administrator-only restriction.
  B. Any signed-in operational user may perform these actions.
  C. Only administrators may perform these actions.
  (why it matters: Ration permissions control changes to recipes that affect feed delivery, costs, and inventory.)

**Q-7** How should feed-plan creation or adjustment permissions differ from updating a plan's execution status?
  A. Authorized planners generate or adjust plans; operators may update execution status for their assigned pens.   ← recommended: This separates planning changes from daily execution while supporting pen-level operations.
  B. Any operational user may plan and update execution status for any pen.
  C. Only administrators may plan or update execution status.
  (why it matters: These permissions determine who can change planned quantities and who can record completed or skipped work.)

**Q-8** Who may add weight measurements to a lot's history?
  A. Only authorized livestock or operations users may add measurements; other users may view them.   ← recommended: This confines changes to operationally responsible users without restricting viewing unnecessarily.
  B. Any signed-in user may add measurements.
  C. Only administrators may add measurements.
  (why it matters: Measurement permissions control changes to the data used for growth and ship-date calculations.)

Assumed unless you say otherwise:
- ASM-23: For the procurement and receiving ingestion demo, should the app connect to a live source system or demonstrate synchronization with mock source data? → assumed: Demonstrate the integration flow using mock source data; defer live connectivity until a source interface is specified.
- ASM-24 (high risk, confirm on the approval card): How should repeated imports identify records already received from procurement so they do not create duplicate PO lines, lots, or receiving records? → assumed: Match records using source-system identifiers and update the corresponding imported records.
- ASM-25 (high risk, confirm on the approval card): How should animal quantities be represented when a PO line splits across lots and lots or pens contain animals from multiple groups? → assumed: Track allocated animal quantities for each PO-line-to-lot and lot-to-pen relationship.
- ASM-26: What basis should the initial market-date forecast use when incoming records provide no measured growth history? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-27: Which consumption basis should inventory projections use across the requested forecast horizons? → assumed: Project from saved upcoming feed plans, applying the configured wastage ratio.
- ASM-28 (high risk, confirm on the approval card): How should the configurable wastage ratio affect actual feeding activity and stock movements, as distinct from estimates and projections? → assumed: Apply wastage to estimates and projections only; decrement actual stock by the quantity recorded as delivered.
- ASM-29: What does ration cost optimization need to do beyond calculating nutrition and ingredient-mix cost? → assumed: Compare user-defined candidate mixes and show their nutrition and cost.
- ASM-30 (high risk, confirm on the approval card): If bunk rates, animal counts, or ration assignments change after a feed plan is generated, what should happen to the saved plan? → assumed: Keep the saved plan unchanged and require an authorized user to confirm an update or regenerate it.
- ASM-31 (high risk, confirm on the approval card): What should happen when a feeding event would consume more stock than is available? → assumed: Block the event until stock is sufficient or an authorized inventory adjustment is recorded.
- ASM-32 (high risk, confirm on the approval card): How should a saved feeding event be corrected or voided if it was entered incorrectly? → assumed: Who created and last changed each record, and when; no full audit trail.
- ASM-33: How should a projected ship date be presented when a lot has no positive ADG or has not yet recorded enough weight data to calculate one? → assumed: Show the projected date as unavailable until a positive ADG can be calculated or configured.
- ASM-34 (high risk, confirm on the approval card): Should ration ingredient proportions and feed quantities use an as-fed or dry-matter basis for cost and consumption calculations? → assumed: Use as-fed quantities for inventory and delivery calculations, and report dry-matter values separately.
- ASM-35: The feed-to-gain report requires a sex filter, but the listed incoming animal fields do not include sex. How should the filter be supported? → assumed: Import and retain sex when the source provides it; show the filter as unavailable for records without it.
- ASM-36: Should dashboard metrics open their contributing lot, pen, feeding, or weight records, or remain summary-only? → assumed: Keep dashboards summary-only; use the lot and report views for detail.
- ASM-37 (high risk, confirm on the approval card): How should sample data be loaded and reset without mixing it with live operational records? → assumed: Keep sample data distinct from operational records and prevent accidental duplicate loading; require confirmation before reset.
- ASM-38: How should the yard summary calculate average ADG and Cost of Gain across active lots? → assumed: Calculate aggregate ADG and Cost of Gain from total gain and total feed cost across the included lots.

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-1679 c79b499f Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: c79b499f