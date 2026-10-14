# Approval: Import procurement and receiving data and map PO lines to lots and pen

Run 20261014-hackathon-problem-statement-fe-95ff · risk **high** · feature · size L · cost so far $0.09

## Your request (word for word, from Ch4_ Feed-to-Gain Intelligence Platform for Feedlot Operations-Problem Statement.pdf)
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


## Your answers
- Q-1 How should ration cost optimization produce candidate mixes? → **Generate candidate ingredient proportions against user-entered nutrition or animal-range constraints; show the cost and trade-offs, and require a user to save or assign a candidate.**
- Q-2 Which user roles and permissions should the app enforce? → **Use Administrator and Operator roles: administrators manage users, imports, and configuration; operators manage plans and record feeding and weights; both can view dashboards and reports.**
- Q-3 How should users sign in to the app? → **Use administrator-managed email and password accounts; defer SSO and self-service registration.**
- Q-4 When a PO line is split across multiple lots, how should its purchase costs be allocated to each lot’s financial baseline? → **Allocate costs in proportion to the received animal head count assigned to each lot.**
- Q-5 Should wastage appear as its own dated inventory movement, or only as a factor in usage and forecasts? → **Include wastage in the configured consumption estimate and projections, but do not create a separate wastage movement.**
- Q-6 How should the bunk rate be interpreted when generating a pen’s planned feed quantity? → **Pounds of as-fed ration per animal per day, multiplied by the planned animal count.**
- Q-7 Should feed-to-gain calculations use feed quantities as-fed or adjust them to dry matter? → **Use as-fed pounds for feed consumption and FCR.**
- Q-8 When a pen contains animals from multiple lots, how should a pen-level feeding plan or activity be attributed for lot rollups? → **Record a separate lot allocation for each portion of the pen’s planned or delivered feed.**

## Confirm these assumptions (high risk)
- [ ] ASM-1 What procurement and receiving source should ingestion connect to, and by what method? → assumed: Use a mock synchronized upstream source for this build; defer live connectivity and file upload.
- [ ] ASM-2 Which unit conventions should calculations use when ingredients and costs are entered in different units? → assumed: Normalize weights and feed quantities to pounds and costs to USD per pound for calculations; interpret a ton as a US short ton and retain entered units for display.
- [ ] ASM-3 How should the configured wastage ratio affect inventory when an actual feeding activity is saved? → assumed: Decrement inventory by the actual delivered quantity plus the configured wastage amount; include that total in the event’s inventory consumption.
- [ ] ASM-4 What should happen when a valid feeding activity would consume more stock than is available? → assumed: Reject the save and leave the activity, inventory, and lot totals unchanged.
- [ ] ASM-5 What does a bunk rate mean, and what unit should the plan use? → assumed: Daily feed quantity per animal, expressed as pounds as-fed per head per day; multiply by the pen animal count.
- [ ] ASM-6 Must every feeding activity correspond to a saved plan for the same pen and date? → assumed: Allow activities without a matching plan; when linked to a plan, use that plan’s planned quantity for variance.
- [ ] ASM-7 How should planned and actual feed be attributed when a pen contains animals from multiple lots? → assumed: Allocate planned and actual quantities across the lots in proportion to their current animal counts in the pen.
- [ ] ASM-8 How should authorized users correct or cancel an already saved feeding activity? → assumed: Allow edits and cancellation; adjust the associated inventory movements and lot totals to match the corrected activity.
- [ ] ASM-10 Should profitability mean feed-cost metrics only, or should the app calculate a broader lot ROI? → assumed: Report the specified feed cost of gain and label broader ROI unavailable until sale proceeds and other relevant costs are supplied.
- [ ] ASM-20 For procurement and receiving ingestion, which source path should the first version support? → assumed: Use a mock connected procurement/receiving source for the demo, with no file-upload flow.
- [ ] ASM-21 When a later synchronization returns a PO or receiving record that was imported before, how should the app handle it? → assumed: Match by the source record ID, update the imported record when the source changes, and report failed records without duplicating them.
- [ ] ASM-23 Should the configured wastage ratio change inventory decrements for recorded feeding activities, or only estimates and forecasts? → assumed: Apply the ratio to forecasts and estimates only; decrement inventory by the recorded actual feed quantity, with no separate wastage movement.
- [ ] ASM-25 How should users correct a saved feeding or weight record if they discover an error? → assumed: Allow an authorized user to correct the original record and recalculate affected inventory and lot metrics.
- [ ] ASM-26 What should lot profitability include beyond the feed-cost-based cost-of-gain calculation? → assumed: Include allocated animal purchase cost and feed cost, and include sale revenue only when it is recorded.

Other assumptions: ASM-9 What target weight and gain assumption should drive lifecycle and ship-date projections, especially before a lot has usable weight history? → assumed: Set a configurable yard-level target weight and expected daily gain, allow lot-specific overrides, and show which assumption is used until observed gain is available.; ASM-11 Where should the date-range, breed, sex, and pen filters apply? → assumed: Apply the specified filters to the dedicated feed-to-gain report only; leave other dashboard and report filters to a later decision.; ASM-12 How should the sex field required by the feed-to-gain report filter be populated when the listed incoming data does not include it? → assumed: Import sex when the source provides it; otherwise retain an unknown value and allow the report to filter known values only.; ASM-13 How should a lot or pen count as active in dashboard summaries? → assumed: Treat a lot or pen with a current animal count above zero as active.; ASM-14 How should the requested demo, presentation materials, and prompts be delivered? → assumed: Provide an in-app demo/presentation view containing the architecture, demo flow, super prompt and other prompts, validation, challenges, readiness, and go-to-market material.; ASM-15 What accessibility conformance level is required? → assumed: WCAG 2.1 AA on the main flows.; ASM-16 Which browsers should be supported for the responsive web app? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-17 Must feeding and inventory workflows work without a network connection? → assumed: No; online only.; ASM-18 Which languages must the app support? → assumed: English only, left to right.; ASM-19 Where should the demo be hosted, and which deployment environments are required? → assumed: Two: staging and production, with a build pipeline.; ASM-22 What target-weight and growth-rate basis should lifecycle and projected market-date forecasts use? → assumed: Set a target weight for each lot and project timing from that lot’s measured ADG.; ASM-24 How should a feeding activity be handled when its date does not match a plan for that pen and lot? → assumed: Allow it as an unplanned activity and make the mismatch visible in reporting.; ASM-27 Where should the requested dashboard and report filters apply? → assumed: On-screen lists with filters and CSV export; no custom report builder.

## Requirements
- **REQ-1** (ADDED) The Feedlot web app shall provide email-and-password sign-in for administrator-managed accounts without self-service registration or SSO, allow Administrators to manage accounts and assign Administrator or Operator roles, and display controls and pages defined for each assigned role.
  - AC-1.1 [ui] Given An administrator-managed account exists and the sign-in page is open; when The user inspects the sign-in controls and submits the account credentials; then The screen shows email and password fields, no self-service registration or SSO controls, and the signed-in user's role and available pages
  - AC-1.2 [ui] Given An Administrator is signed in; when The Administrator opens user management and the main navigation; then The screen shows account controls with email, password, and Administrator and Operator role values, plus user, import, configuration, plan, feeding, weight, dashboard, and report controls
  - AC-1.3 [ui] Given An Operator is signed in; when The Operator opens the main navigation and user-management page; then The screen shows plan, feeding, weight, dashboard, and report controls and does not show user-management, import, or configuration controls
- **REQ-2** (ADDED) When an Administrator starts synchronization, the Feedlot web app shall request procurement and receiving records from the configured mock source and display returned records, source identifiers, per-record synchronization outcomes, and errors.
  - AC-2.1 [ui] Given The mock source contains PO and receiving records with vendor, cost, head count, weight, breed, age, and source fields; when An Administrator starts synchronization; then The request targets the configured mock source and the screen shows the returned record fields and synchronization status for each record
  - AC-2.2 [ui] Given A source record has a previously imported source record ID and another source record has failed synchronization; when An Administrator starts another synchronization; then The screen shows the returned update outcome for the previously imported ID and the failed record's ID and error, without showing the failed record as a successful import
- **REQ-3** (ADDED) The Feedlot web app shall display PO-line-to-lot-to-pen traceability, available procurement and animal fields, pen capacity and current animal counts, and lot purchase-cost allocations proportional to assigned received head counts.
  - AC-3.1 [ui] Given The API provides a PO line mapped to multiple lots and pens, with available procurement and animal fields; when A user opens the imported record details or procurement traceability view; then The screen shows the PO line, source identifiers, related lots and pens, available vendor, cost, head-count, weight, breed, age, and source fields, and each pen's capacity and current animal count
  - AC-3.2 [ui] Given A PO line has a total cost of 1000 USD and two lots assigned 60 and 40 received animals; when A user opens the PO line's lot allocations; then The screen shows purchase-cost allocation values of 600 USD and 400 USD for the respective lots
  - AC-3.3 [ui] Given The source response omits an animal's sex; when A user opens that animal's imported details; then The screen shows the sex field as Unknown
- **REQ-4** (ADDED) When a user opens a lot lifecycle view, the Feedlot web app shall display target weight, lifecycle milestones, projected market date, and the growth assumption used, using measured ADG when available and otherwise the configured yard expected daily gain.
  - AC-4.1 [ui] Given The API provides a lot target weight, receiving date, and measured ADG; when A user opens that lot's lifecycle view; then The screen shows the target weight, lifecycle milestones, measured ADG as the projection assumption, and projected market date
  - AC-4.2 [ui] Given The API provides no usable measured ADG and provides the yard expected daily gain and any lot-specific target override; when A user opens that lot's lifecycle view; then The screen shows the projected market date, target weight used, and configured yard expected daily gain as the projection assumption
- **REQ-5** (ADDED) The Feedlot web app shall allow users to view and enter feed inventory item fields, retain entered units for display, show normalized calculation values where applicable, and display opening, received, consumed, and closing stock values.
  - AC-5.1 [ui] Given The API provides an inventory item with stock values, entered units, cost, nutrition fields, and storage location; when A user opens the feed inventory item; then The screen shows the item name, category, available quantity, entered unit, cost, dry-matter percentage, energy value, storage location, and opening, received, consumed, and closing stock values
  - AC-5.2 [ui] Given An inventory item is entered in tons with a cost per ton; when A user opens its cost details; then The screen shows the entered units and normalized calculation values in pounds and USD per pound
- **REQ-6** (ADDED) When a user opens inventory projections, the Feedlot web app shall display estimates for daily, weekly, monthly, quarterly, six-month, and annual horizons using the configured wastage ratio in estimates and projections, without displaying a separate wastage stock movement.
  - AC-6.1 [ui] Given Inventory, projected consumption, and a configured wastage ratio are available; when A user opens inventory projections; then The screen shows estimates for daily, weekly, monthly, quarterly, six-month, and annual horizons and the wastage ratio used
  - AC-6.2 [ui] Given The inventory movement response contains receipts and feed consumption; when A user reviews the movement list and forecast; then The screen shows the returned stock movements and no separate wastage movement
- **REQ-7** (ADDED) The Feedlot web app shall allow users to create and view rations with ingredient proportions, nutritional values, intended animal or weight range, and calculated cost per pound using normalized calculation units while retaining entered units for display.
  - AC-7.1 [ui] Given A user enters a ration name, type, ingredients, proportions, and intended animal type or weight range; when The user saves and opens the ration; then The screen shows the returned ration's ingredients, proportions, dry-matter percentage, energy value, intended range, and calculated cost per pound in USD
  - AC-7.2 [ui] Given A ration's ingredients have costs entered in different supported weight units; when The user opens the ration cost details; then The screen shows the calculated cost in USD per pound and retains the entered units for display
- **REQ-8** (ADDED) When a user submits nutrition or animal-range constraints for ration optimization, the Feedlot web app shall display candidate ingredient mixes with costs and trade-offs and require an explicit save or assign action before a candidate is saved, assigned, or used.
  - AC-8.1 [ui] Given A user has entered nutrition or animal-range constraints and candidate mixes are returned; when The user requests and views candidate mixes; then The screen shows each candidate's ingredient proportions, cost, and trade-offs without marking it saved or assigned
  - AC-8.2 [ui] Given An optimization candidate is displayed; when The user selects save or assign and that action is accepted; then The screen shows the returned candidate as saved or assigned only after the action is accepted
- **REQ-9** (ADDED) When a user generates a dated pen feeding plan, the Feedlot web app shall display planned quantity as the bunk rate in pounds of as-fed ration per animal per day multiplied by planned animal count, with plan details and separate lot allocations proportional to current lot animal counts in the pen.
  - AC-9.1 [ui] Given A pen plan uses a bunk rate of 25 pounds per animal per day and a planned animal count of 40; when A user generates the plan; then The screen shows a planned feed quantity of 1000 pounds and the plan date, pen, ration, feeding time, cost, expected energy, and status
  - AC-9.2 [ui] Given A pen plan is for 1000 pounds and its current animals are split 60 to one lot and 40 to another; when A user opens the plan's lot allocations; then The screen shows separate planned-feed allocations of 600 and 400 pounds for the respective lots
- **REQ-10** (ADDED) ⚠ only one draft had this When a user opens pen feeding schedules, the Feedlot web app shall show plans by delivery date and pen with planned quantity and Planned, In progress, Completed, or Skipped status.
  - AC-10.1 [ui] Given Pen plans exist with delivery dates and statuses; when A user opens feeding schedules; then The screen shows each plan's date, pen, ration, planned quantity, and Planned, In progress, Completed, or Skipped status
- **REQ-11** (ADDED) When an Operator records a feeding activity, the Feedlot web app shall allow an activity with or without a matching plan, submit the activity details and lot allocations, and display the returned planned and actual quantities, variance when linked to a plan, inventory result, feed cost, energy, feeding status, lot allocations, and lot rollups.
  - AC-11.1 [ui] Given A linked plan is for 900 pounds and an accepted activity records 950 pounds delivered; when The Operator opens the activity details; then The screen shows planned feed of 900 pounds, actual feed of 950 pounds, and a variance of 50 pounds, along with the activity fields
  - AC-11.2 [ui] Given A pen contains animals from multiple lots and the API returns lot allocations for an activity; when The Operator views the saved activity; then The request contains separate lot allocations and the screen shows the returned delivered-feed allocations and corresponding lot consumption and cost rollups
  - AC-11.3 [ui] Given No matching plan exists for the activity date and the save response is successful; when The Operator saves and views the feeding activity; then The screen shows the activity as unplanned, the returned activity, and lot totals
  - AC-11.4 [ui] Given An activity does not match the available plan date, pen, or lot; when The activity is displayed in a list or detail view; then The screen shows a plan-mismatch indicator
- **REQ-12** (ADDED) When a feeding activity is accepted, the Feedlot web app shall display the inventory consumption and lot allocations returned by the API without asserting a web-side inventory decrement formula.
  - AC-12.1 [ui] Given The API response for an accepted activity contains ingredient consumption and multiple lot allocations; when The activity and affected inventory or lot summaries are displayed; then The screen shows the returned ingredient quantities, as-fed lot quantities, feed costs, and separate lot allocations
  - AC-12.2 [ui] Given An accepted activity returns inventory results that include a wastage-based decrement; when The Operator views the saved activity and affected inventory; then The screen shows the returned inventory result without replacing it with a web-calculated value
- **REQ-13** (ADDED) When a feeding save is refused for insufficient stock, the Feedlot web app shall retain entered activity values and display the returned error without presenting the activity as saved or displaying updated inventory or lot totals.
  - AC-13.1 [ui] Given An Operator enters a feeding activity and the feed service refuses it for insufficient stock, returning unchanged totals; when The Operator saves the activity; then The screen retains the entered values, shows the returned error, does not show the activity as saved, and continues to show the prior inventory and lot totals
- **REQ-14** (ADDED) When an authorized user edits or cancels a saved feeding activity, the Feedlot web app shall display the returned activity state, inventory totals, and lot totals, or display the returned error if the API refuses the change.
  - AC-14.1 [ui] Given The API accepts an edit or cancellation and returns updated totals; when The user views the activity and affected summaries; then The screen shows the returned corrected or canceled activity and recalculated inventory and lot total values
  - AC-14.2 [ui] Given The API refuses an edit or cancellation; when An authorized user views the action result; then The screen shows the returned error message and existing activity details
- **REQ-15** (ADDED) When an Operator records a lot weight measurement, the Feedlot web app shall submit the dated measurement fields and display the returned measurement in the lot's dated weight history and trend.
  - AC-15.1 [ui] Given An Operator enters a measurement with date, number of animals weighed, average weight, total lot weight, gain since the prior measurement, and notes; when The Operator saves and opens the lot's weight history; then The screen shows the returned measurement fields in the lot's dated weight history and trend
  - AC-15.2 [ui] Given The API accepts a correction to a saved weight measurement and returns updated values; when An authorized user opens the lot history and metrics; then The screen shows the corrected record and returned recalculated metrics and weight trend
- **REQ-16** (ADDED) When a user opens lot performance, the Feedlot web app shall display returned days on feed, total weight gain, ADG, total as-fed feed consumed, FCR, feed cost of gain, and projected ship date, and refresh those values after an accepted feeding or weight event.
  - AC-16.1 [ui] Given The API supplies lot metrics for a lot with receiving date, entry and current average weights, feeding events, and target weight; when A user opens the lot performance view; then The screen shows days on feed, total weight gain, ADG, total as-fed feed consumed, FCR using as-fed pounds, feed cost of gain, and projected ship date
  - AC-16.2 [ui] Given A feeding or weight event has been accepted and the API supplies refreshed lot metrics; when A user views the lot performance screen after the event; then The screen shows the refreshed metric values returned for that lot
- **REQ-17** (ADDED) When a user opens lot financial performance and insights, the Feedlot web app shall display feed cost of gain separately, available purchase and feed costs and recorded sale revenue, label broader ROI unavailable when required data is missing, and display returned feeding or sale-timing recommendations.
  - AC-17.1 [ui] Given A lot has purchase and feed costs but no sale proceeds or complete relevant costs; when A user opens lot profitability; then The screen shows available purchase and feed cost components, feed cost of gain, and a broader ROI unavailable label
  - AC-17.2 [ui] Given The API supplies recorded sale proceeds, required costs, and recommendations based on feeding and weight trends; when A user opens lot financial performance and insights; then The screen shows recorded sale revenue, returned broader profitability values, and returned feeding-adjustment or sale-timing recommendations
- **REQ-18** (ADDED) When a user opens the operations dashboard, the Feedlot web app shall display active lots and pens, operational counts and inventory, ration and plan information, feed and weight performance, energy use, and lot rankings.
  - AC-18.1 [ui] Given The API supplies dashboard data for lots, pens, inventory, rations, plans, activities, and weights; when A user opens the operations dashboard; then The screen shows active lots and pens based on current animal counts above zero, animal counts per lot and pen, inventory status, ration usage, daily pen bunk rates, planned versus actual feed, total feed and cost, starting and current weights, weight gain, ADG, FCR, cost per unit of gain, energy consumed, and best- and worst-performing lots
- **REQ-19** (ADDED) When a user opens the yard summary, the Feedlot web app shall display aggregate metrics across active lots, including total head, average ADG, average cost of gain, and total feed cost.
  - AC-19.1 [ui] Given The API supplies aggregate values for active lots; when A user opens the yard summary; then The screen shows total head, average ADG, average cost of gain, and total feed cost
- **REQ-20** (ADDED) When a user opens the dedicated Feed-to-Gain report, the Feedlot web app shall display lot comparisons for ADG, FCR, and cost of gain and provide date-range, breed, sex, and pen filters, with sex filtering limited to known values.
  - AC-20.1 [ui] Given The report has lot data including known and unknown sex values; when A user opens the report and applies date-range, breed, sex, or pen filters; then The screen shows matching lots with ADG, FCR, and cost of gain, and the sex filter offers known values only
  - AC-20.2 [ui] Given A user selects report filters; when The report results refresh; then The screen shows only rows matching the selected date range, breed, known sex, and pen values
- **REQ-21** (ADDED) When a user exports the Feed-to-Gain report, the Feedlot web app shall provide the displayed or filtered report data as a CSV or PDF file.
  - AC-21.1 [ui] Given A user has a Feed-to-Gain report displayed with or without filters; when The user selects CSV or PDF export; then The browser download list contains a file in the selected format with the displayed report data
- **REQ-22** (ADDED) When a user opens the demo and presentation view, the Feedlot web app shall show mock operational data and materials covering the proposed solution and architecture diagrams, demo flow, coding prompts, validation, challenges, production readiness, and go-to-market analysis.
  - AC-22.1 [ui] Given Mock demo data and presentation content are available; when A user opens or reviews the demo and presentation view; then The screen shows sample operational data and sections for the proposed solution, architecture diagrams, demo flow, coding super prompt and other prompts, testing and validation, challenges, production readiness, and go-to-market analysis

Not changing: Native iOS or Android applications, app-store release steps, and phone-only layouts; all product features are delivered in one responsive web app.; Durable storage and restart persistence for imported records, inventory, rations, plans, activities, measurements, and calculated values; this web spec verifies screens and values returned by the API.; Execution of procurement-source synchronization, source-ID deduplication and updates, failed-record processing, PO-line cost allocation, and persistence of PO-to-lot-to-pen relationships; the web requirements verify synchronization outcomes and mappings displayed to users.; Inventory movement accounting, wastage application to actual consumption, stock sufficiency enforcement, and atomic rollback of rejected activities; the web requirements verify returned inventory results and errors.; Calculation correctness for forecasts, ration optimization, inventory projections, feeding costs, lot rollups, weight metrics, FCR, profitability, and recommendations; the web requirements verify values and recommendations displayed from API responses.; Enforcing account authentication, role authorization, and server-side permission checks; the web requirements verify sign-in and role-specific screens.; Supplying or seeding demo records and producing report data; the web requirements verify supplied sample data and exported report files.; Live procurement or receiving connectivity, file-upload ingestion, self-service registration, SSO, and offline operation.

## Files the plan will touch (21)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-10/container.tsx  ← not found by grounding; check it
- components/screens/s-11/container.tsx  ← not found by grounding; check it
- components/screens/s-12/container.tsx  ← not found by grounding; check it
- components/screens/s-13/container.tsx  ← not found by grounding; check it
- components/screens/s-14/container.tsx  ← not found by grounding; check it
- components/screens/s-15/container.tsx  ← not found by grounding; check it
- components/screens/s-16/container.tsx  ← not found by grounding; check it
- components/screens/s-17/container.tsx  ← not found by grounding; check it
- components/screens/s-18/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- components/screens/s-5/container.tsx  ← not found by grounding; check it
- components/screens/s-6/container.tsx  ← not found by grounding; check it
- components/screens/s-7/container.tsx  ← not found by grounding; check it
- components/screens/s-8/container.tsx  ← not found by grounding; check it
- components/screens/s-9/container.tsx  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: A (chosen): Implement one wired API-backed slice per approved screen, with shared app foundation first and the API contract generated separately for both repos. | B: Build shared data/service layers for all features first, then wire the screens in a later integration task.
Decision: Decision: choose option A, a responsive web app delivered as wired screen slices.
The scaffold owns page structure and component styling; containers add validation, API data, and interactions.
Both repos use the shared OpenAPI contract and the web app uses only its generated lib/api client.
API-side persistence, calculations, synchronization, and authorization enforcement remain outside this web implementation.
- TASK-1 Establish responsive app foundation and design tokens → REQ-1, NFR-1; builds towards a later task (no criteria of its own)
- TASK-2 Wire sign-in → REQ-1; builds towards a later task (no criteria of its own)
- TASK-3 Wire operations overview → REQ-18; must pass AC-18.1
- TASK-4 Wire lot traceability → REQ-3; must pass AC-3.1, AC-3.2, AC-3.3
- TASK-5 Wire lot lifecycle → REQ-4; must pass AC-4.1, AC-4.2
- TASK-6 Wire feed inventory and receipts → REQ-5; must pass AC-5.1, AC-5.2
- TASK-7 Wire inventory projections → REQ-6; must pass AC-6.1, AC-6.2
- TASK-8 Wire ration creation and saved rations → REQ-7; must pass AC-7.1, AC-7.2
- TASK-9 Wire ration optimizer → REQ-8; must pass AC-8.1, AC-8.2
- TASK-10 Wire feeding plans and schedule → REQ-9, REQ-10; must pass AC-9.1, AC-9.2, AC-10.1
- TASK-11 Wire feeding log and activity outcomes → REQ-11, REQ-12, REQ-13, REQ-14; must pass AC-11.1, AC-11.2, AC-11.3, AC-11.4, AC-12.1, AC-12.2, AC-13.1, AC-14.1, AC-14.2
- TASK-12 Wire lot weight history and corrections → REQ-15; must pass AC-15.1, AC-15.2
- TASK-13 Wire yard summary → REQ-19; must pass AC-19.1
- TASK-14 Wire Feed-to-Gain report and exports → REQ-20, REQ-21; must pass AC-20.1, AC-20.2, AC-21.1
- TASK-15 Wire administrator account management → REQ-1; must pass AC-1.1, AC-1.2, AC-1.3
- TASK-16 Wire source synchronization → REQ-2; must pass AC-2.1, AC-2.2
- TASK-17 Wire demo and presentation view → REQ-22; must pass AC-22.1
- TASK-18 Wire lot performance → REQ-16; must pass AC-16.1, AC-16.2
- TASK-19 Wire lot financials and recommendations → REQ-17; must pass AC-17.1, AC-17.2

## Task order (2 waves for 19 tasks; the tasks run one after another today)
- Wave 1: TASK-1
- Wave 2: TASK-2 (after: planner), TASK-3 (after: planner), TASK-4 (after: planner), TASK-5 (after: planner), TASK-6 (after: planner), TASK-7 (after: planner), TASK-8 (after: planner), TASK-9 (after: planner), TASK-10 (after: planner), TASK-11 (after: planner), TASK-12 (after: planner), TASK-13 (after: planner), TASK-14 (after: planner), TASK-15 (after: planner), TASK-16 (after: planner), TASK-17 (after: planner), TASK-18 (after: planner), TASK-19 (after: planner)
Side by side, the longest chain is 260 of 1995 planned lines.

Stub commit (throws NotImplemented until implemented): components/screens/s-1/container.tsx, components/screens/s-2/container.tsx, components/screens/s-3/container.tsx, components/screens/s-4/container.tsx, components/screens/s-5/container.tsx, components/screens/s-6/container.tsx, components/screens/s-7/container.tsx, components/screens/s-8/container.tsx, components/screens/s-9/container.tsx, components/screens/s-10/container.tsx, components/screens/s-11/container.tsx, components/screens/s-12/container.tsx, components/screens/s-13/container.tsx, components/screens/s-14/container.tsx, components/screens/s-15/container.tsx, components/screens/s-16/container.tsx, components/screens/s-17/container.tsx, components/screens/s-18/container.tsx

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- POST /api/v1/auth/sign-in -> 200, 400, 401, 403, 503
- GET /api/v1/overview -> 200, 401, 403, 500
- GET /api/v1/lots -> 200, 401, 403, 500
- GET /api/v1/lots/{lotId}/lifecycle -> 200, 400, 401, 403, 404
- GET /api/v1/inventory -> 200, 401, 403, 500
- POST /api/v1/inventory/receipts -> 201, 400, 401, 403, 422
- GET /api/v1/inventory/projections -> 200, 401, 403, 500
- GET /api/v1/rations -> 200, 401, 403, 500
- POST /api/v1/rations -> 201, 400, 401, 403, 422
- POST /api/v1/rations/optimization -> 200, 400, 401, 403, 422
- POST /api/v1/rations/candidates/{candidateId}/save -> 200, 400, 401, 403, 404
- POST /api/v1/rations/candidates/{candidateId}/assign -> 200, 400, 401, 403, 404
- GET /api/v1/feeding-plans -> 200, 401, 403, 500
- POST /api/v1/feeding-plans -> 201, 400, 401, 403, 422
- GET /api/v1/feeding-activities -> 200, 401, 403, 500
- POST /api/v1/feeding-activities -> 201, 400, 401, 403, 409, 422
- DELETE /api/v1/feeding-activities/{activityId} -> 200, 401, 403, 404, 409
- PATCH /api/v1/feeding-activities/{activityId} -> 200, 400, 401, 403, 404, 409, 422
- GET /api/v1/weight-measurements -> 200, 401, 403, 500
- POST /api/v1/weight-measurements -> 201, 400, 401, 403, 422
- PATCH /api/v1/weight-measurements/{measurementId} -> 200, 400, 401, 403, 404, 422
- GET /api/v1/yard-summary -> 200, 401, 403, 500
- GET /api/v1/reports/feed-to-gain -> 200, 400, 401, 403
- GET /api/v1/reports/feed-to-gain/export -> 200, 400, 401, 403
- GET /api/v1/admin/accounts -> 200, 401, 403
- POST /api/v1/admin/accounts -> 201, 400, 401, 403, 409, 422
- PATCH /api/v1/admin/accounts/{accountId} -> 200, 400, 401, 403, 404, 422
- POST /api/v1/admin/sync -> 200, 401, 403, 503
- GET /api/v1/admin/demo -> 200, 401, 403
- POST /api/v1/admin/demo/flow -> 200, 400, 401, 403
- GET /api/v1/lots/{lotId}/performance -> 200, 401, 403, 404
- GET /api/v1/lots/{lotId}/financials -> 200, 401, 403, 404

## Critic findings (0)
_The critic was off for this run: pick a model for the critic step at the start to turn it on._

## Still open after 0 repairs
- [round trip] not asked for: Make every page responsive for phone, tablet, and desktop widths, with touch-sized controls on narrow screens.

## Settled by questions, and open risks
- Spec question Q-9: Should the full 22-requirement scope be approved as one run, split across runs, or reduced? → Approve all 22 requirements as one run. (answered)
- Open risk: Make every page responsive for phone, tablet, and desktop widths, with touch-sized controls on narrow screens.

**This spec has 22 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261014-hackathon-problem-statement-fe-95ff <hash> --note "your risk note"
  factory reject  20261014-hackathon-problem-statement-fe-95ff <hash> --reason "why"

Card hash: cc8f12c9