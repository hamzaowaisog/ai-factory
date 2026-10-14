# Questions before the spec (round 1)

Run 20261014-hackathon-problem-statement-fe-95ff. Your request:
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

**Q-1** How should ration cost optimization produce candidate mixes?
  A. Generate candidate ingredient proportions against user-entered nutrition or animal-range constraints; show the cost and trade-offs, and require a user to save or assign a candidate.   ← recommended: This supports identifying economical feed mixes while keeping operational ration changes under user control.
  B. Compare only rations users have already created; do not generate new ingredient proportions.
  C. Automatically replace the active ration with the lowest-cost eligible mix.
  (why it matters: Generated or automatically applied mixes can change which ration is used and its cost.)

**Q-2** Which user roles and permissions should the app enforce?
  A. Use Administrator and Operator roles: administrators manage users, imports, and configuration; operators manage plans and record feeding and weights; both can view dashboards and reports.   ← recommended: This supplies the authorization distinctions already implied by the workflows with the fewest role types.
  B. Use Administrator, Manager, Operator, and Read-only roles, with separate permissions for each operational area.
  C. Use one shared role with access to all workflows; defer role-based restrictions.
  (why it matters: Roles determine who can change procurement, inventory, plans, and operational records.)

**Q-3** How should users sign in to the app?
  A. Use administrator-managed email and password accounts; defer SSO and self-service registration.   ← recommended: This supports the specified role-based permissions without adding an external identity integration.
  B. Use the organization’s single sign-on provider.
  C. Allow the demo without sign-in and do not enforce user-specific permissions.
  (why it matters: Sign-in determines whether permissions can be applied to identifiable users.)

**Q-4** When a PO line is split across multiple lots, how should its purchase costs be allocated to each lot’s financial baseline?
  A. Allocate costs in proportion to the received animal head count assigned to each lot.   ← recommended: This provides a consistent lot baseline using the allocation quantity already required for traceability.
  B. Allocate costs in proportion to the received weight assigned to each lot.
  C. Require source-provided lot-level costs; flag the lot baseline as incomplete if they are absent.
  D. Let an authorized user enter the cost allocation for each lot.
  (why it matters: Cost allocation changes lot-level financial results.)

**Q-5** Should wastage appear as its own dated inventory movement, or only as a factor in usage and forecasts?
  A. Include wastage in the configured consumption estimate and projections, but do not create a separate wastage movement.   ← recommended: This follows the stated wastage calibration without adding an unrequested movement type.
  B. Record actual wastage as a separate dated stock movement, in addition to applying the configured ratio to forecasts.
  C. Support both recorded wastage movements and a configured ratio, and distinguish them in balances and forecasts.
  (why it matters: Movement treatment changes stock balances and consumption totals.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): What procurement and receiving source should ingestion connect to, and by what method? → assumed: Use a mock synchronized upstream source for this build; defer live connectivity and file upload.
- ASM-2 (high risk, confirm on the approval card): Which unit conventions should calculations use when ingredients and costs are entered in different units? → assumed: Normalize weights and feed quantities to pounds and costs to USD per pound for calculations; interpret a ton as a US short ton and retain entered units for display.
- ASM-3 (high risk, confirm on the approval card): How should the configured wastage ratio affect inventory when an actual feeding activity is saved? → assumed: Decrement inventory by the actual delivered quantity plus the configured wastage amount; include that total in the event’s inventory consumption.
- ASM-4 (high risk, confirm on the approval card): What should happen when a valid feeding activity would consume more stock than is available? → assumed: Reject the save and leave the activity, inventory, and lot totals unchanged.
- ASM-5 (high risk, confirm on the approval card): What does a bunk rate mean, and what unit should the plan use? → assumed: Daily feed quantity per animal, expressed as pounds as-fed per head per day; multiply by the pen animal count.
- ASM-6 (high risk, confirm on the approval card): Must every feeding activity correspond to a saved plan for the same pen and date? → assumed: Allow activities without a matching plan; when linked to a plan, use that plan’s planned quantity for variance.
- ASM-7 (high risk, confirm on the approval card): How should planned and actual feed be attributed when a pen contains animals from multiple lots? → assumed: Allocate planned and actual quantities across the lots in proportion to their current animal counts in the pen.
- ASM-8 (high risk, confirm on the approval card): How should authorized users correct or cancel an already saved feeding activity? → assumed: Allow edits and cancellation; adjust the associated inventory movements and lot totals to match the corrected activity.
- ASM-9: What target weight and gain assumption should drive lifecycle and ship-date projections, especially before a lot has usable weight history? → assumed: Set a configurable yard-level target weight and expected daily gain, allow lot-specific overrides, and show which assumption is used until observed gain is available.
- ASM-10 (high risk, confirm on the approval card): Should profitability mean feed-cost metrics only, or should the app calculate a broader lot ROI? → assumed: Report the specified feed cost of gain and label broader ROI unavailable until sale proceeds and other relevant costs are supplied.
- ASM-11: Where should the date-range, breed, sex, and pen filters apply? → assumed: Apply the specified filters to the dedicated feed-to-gain report only; leave other dashboard and report filters to a later decision.
- ASM-12: How should the sex field required by the feed-to-gain report filter be populated when the listed incoming data does not include it? → assumed: Import sex when the source provides it; otherwise retain an unknown value and allow the report to filter known values only.
- ASM-13: How should a lot or pen count as active in dashboard summaries? → assumed: Treat a lot or pen with a current animal count above zero as active.
- ASM-14: How should the requested demo, presentation materials, and prompts be delivered? → assumed: Provide an in-app demo/presentation view containing the architecture, demo flow, super prompt and other prompts, validation, challenges, readiness, and go-to-market material.
- ASM-15: What accessibility conformance level is required? → assumed: WCAG 2.1 AA on the main flows.
- ASM-16: Which browsers should be supported for the responsive web app? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-17: Must feeding and inventory workflows work without a network connection? → assumed: No; online only.
- ASM-18: Which languages must the app support? → assumed: English only, left to right.
- ASM-19: Where should the demo be hosted, and which deployment environments are required? → assumed: Two: staging and production, with a build pipeline.

Answer with letters or your own words:
  factory answer 20261014-hackathon-problem-statement-fe-95ff 562108f1 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 562108f1