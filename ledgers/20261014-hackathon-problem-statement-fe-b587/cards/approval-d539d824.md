# Approval: Import procurement PO and receiving data, map PO lines to lots and pen

Run 20261014-hackathon-problem-statement-fe-b587 · risk **high** · feature · size L · cost so far $6.52

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
- Q-1 What user access model is required for operational and financial records? → **Use one shared access level for all users; do not distinguish permissions by role.**
- Q-2 When a pen contains multiple lots, how must a feeding plan allocate its planned quantity? → **Require a quantity allocation to each lot and flag allocations that do not reconcile with the plan.**
- Q-3 How should the configured wastage ratio affect inventory decrements for an actual feeding event? → **Decrement stock by the actual delivered quantity and apply wastage only to estimated consumption and forecasts.**
- Q-4 How should total lot weight be handled when a user records average weight and the number of animals weighed? → **Calculate total measured weight as average weight multiplied by the number weighed; do not accept a conflicting independent total.**
- Q-5 What cost basis should the lot-level profitability analysis include? → **Show feed cost per unit of weight gain using recorded feed costs only.**
- Q-6 How should users sign in, given that all users have the same access level? → **No sign-in; anyone with the app link can access the shared workspace.**
- Q-7 When a pen contains multiple lots, how should an actual feeding quantity be attributed to those lots for lot-level consumption and cost metrics? → **Allocate the actual quantity to lots in proportion to their planned quantities.**
- Q-8 Which ingredient cost should be used to calculate the cost of a saved feeding event when the ingredient's unit cost changes over time? → **Use the ingredient unit cost recorded when the feeding event is saved.**

## Confirm these assumptions (high risk)
- [ ] ASM-1 Which procurement/receiving source and connection mode should the import use? → assumed: Use a mocked source adapter with representative PO and receiving records for the demo.
- [ ] ASM-2 When a repeated import finds an existing PO or receiving record whose source values have changed, how should the system reconcile it with existing lot mappings? → assumed: Update source-owned fields while preserving user-created lot and pen mappings; flag conflicts for review.
- [ ] ASM-4 How should a stock movement that would take available inventory below zero be handled? → assumed: Block the movement and require a receipt or correction before it can be saved.
- [ ] ASM-7 How should users correct or remove a saved feeding or weight record after it has affected inventory or lot metrics? → assumed: Allow editing or voiding the record and recalculate affected balances and metrics while retaining the original record in history.
- [ ] ASM-9 How should unit and currency differences be handled across inventory, rations, and feeding records? → assumed: Store calculations in pounds and one configured currency, converting supported ton-based prices to a per-pound basis for display and calculations.
- [ ] ASM-10 How should changes in lot head count, such as transfers, deaths, or sales, be represented after the initial receiving record? → assumed: Keep receiving head count fixed and do not account for later changes in the requested metrics.
- [ ] ASM-11 When procurement/receiving data is synchronized again and source values or mappings have changed, how should the import reconcile them? → assumed: Reject and report duplicate or conflicting imports without overwriting mappings; correct the issue and retry.
- [ ] ASM-13 What should happen when a stock movement would make an ingredient's available balance negative? → assumed: Block the movement and show the resulting shortage.
- [ ] ASM-20 After a feeding, weight, or inventory entry is saved, how may users correct it? → assumed: Who created and last changed each record, and when; no full audit trail.

Other assumptions: ASM-3 What demand should the inventory forecasts use when projecting balances and shortages across the requested horizons? → assumed: Use dated feeding plans, apply the configured wastage ratio, and mark periods without a plan as unavailable.; ASM-5 Which date rule should determine the projected ship date from current weight, target weight, and ADG? → assumed: Use the current date plus the days remaining to target weight at current ADG.; ASM-6 Should the selectable date, breed, sex, and pen filters apply to dashboards as well as the dedicated Feed-to-Gain report? → assumed: Apply them to the dedicated Feed-to-Gain report only.; ASM-8 What inputs define a lot's target weight and the gain assumption used for its initial lifecycle forecast? → assumed: Set a target weight and gain assumption per lot; use recorded performance trends for later projections when available.; ASM-12 What should inventory forecasts project and compare across the requested horizons? → assumed: Estimate ingredient balances and shortages from available stock and expected feed demand, applying configured wastage to estimated consumption.; ASM-14 How should the projected ship date be calculated from current weight, target weight, and ADG? → assumed: Use the current date plus the days needed to reach target weight at the current ADG; show no date when ADG is zero or negative.; ASM-15 Should date, lot, pen, breed, and sex filters be available only on the dedicated feed-to-gain report or across dashboards and other reports as well? → assumed: Keep filters on the dedicated feed-to-gain report and retain its selected scope in exports.; ASM-16 For the hackathon build, what procurement integration is expected beyond the requested mock data fetched from other systems? → assumed: Simulate synchronization using mock PO and receiving data; no live external connector is required.; ASM-17 How is the daily bunk rate supplied when generating a pen's feed plan? → assumed: Enter a per-animal daily rate and multiply it by the pen's animal count.; ASM-18 Are ration ingredient proportions specified on an as-fed basis or a dry-matter basis? → assumed: Use as-fed proportions, based on the ingredient quantities mixed.; ASM-19 How should the target weight used for lifecycle and sale-date forecasts be determined when it is not supplied by procurement data? → assumed: Use one configurable yard-level target weight for all lots.; ASM-21 Which browsers and browser versions must the responsive web app support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-22 What accessibility conformance level should the web app target? → assumed: WCAG 2.1 AA on the main flows.

## Requirements
- **REQ-1** (ADDED) The Feedlot web app shall provide a shared workspace from its app link without a sign-in screen and present the same operational and financial controls to all users without role-specific permission choices.
  - AC-1.1 [ui] Given A browser has no authenticated session.; when A user opens the app link.; then The screen displays the shared workspace without a sign-in screen or role selector.
  - AC-1.2 [ui] Given Two browser sessions open the shared workspace.; when Both users view the same operational and financial screens.; then The screen displays the same available controls in both sessions.
- **REQ-2** (ADDED) When an operator starts a mock procurement synchronization, the Feedlot web app shall request PO and receiving records from the mock source adapter and display the returned procurement and receiving fields.
  - AC-2.1 [ui] Given The mock source adapter contains representative PO and receiving records.; when The operator starts synchronization.; then The request contains PO line, vendor, cost, head count, weight, breed, age, and source fields.
  - AC-2.2 [ui] Given The mock source adapter returns procurement and receiving records.; when The synchronization result is displayed.; then The screen displays the returned vendor, cost, head count, weight, breed, age, and source values.
- **REQ-3** (ADDED) The Feedlot web app shall let users map one PO line to one or multiple lots and map those lots to pens while showing PO-line traceability, pen ID, capacity, and returned current animal count.
  - AC-3.1 [ui] Given A PO line and available lots and pens are displayed.; when A user assigns the PO line to one lot or splits it across multiple lots and assigns the lots to pens.; then The screen displays each PO-line-to-lot-to-pen association and the pen ID, capacity, and returned animal count.
- **REQ-4** (ADDED) When an import result identifies duplicate, changed, or conflicting source records, the Feedlot web app shall display the affected records, returned conflict status and mapping information, and a review action.
  - AC-4.1 [ui] Given An import response identifies a duplicate or conflicting source record and may identify an existing mapping.; when The operator opens the import results or review screen.; then The screen displays each affected record, its returned conflict status, any returned existing mapping, and a review action.
- **REQ-5** (ADDED) When lifecycle forecast data is returned, the Feedlot web app shall display each lot's target weight and projected market or ship date, leaving the projected-date field empty when ADG is zero or negative.
  - AC-5.1 [ui] Given A lot forecast response contains a target weight, positive ADG, and projected date.; when The operator opens the lot forecast or detail page.; then The screen displays the returned target weight and projected date.
  - AC-5.2 [ui] Given A lot forecast response has zero or negative ADG and no projected date.; when The operator opens the lot forecast or detail page.; then The projected-date field is empty on the screen.
- **REQ-6** (ADDED) The Feedlot web app shall display a lot-specific target and gain assumption when available and use the configured yard target when procurement does not supply a target.
  - AC-6.1 [ui] Given A lot has a procurement target, a lot-specific target, or no procurement target and a configured yard target.; when The operator opens the lot lifecycle forecast.; then The screen displays the target weight selected by the returned lot-specific or yard-target configuration.
- **REQ-7** (ADDED) The Feedlot web app shall display the configured yard-level target weight for all lots.
  - AC-7.1 [ui] Given The yard has one configured target weight and multiple lot forecasts are available.; when The operator opens the lot forecasts.; then The screen displays the same configured yard target-weight value for each lot.
- **REQ-8** (ADDED) The Feedlot web app shall let users view and enter feed inventory items and display their category, available quantity, unit, unit cost, dry-matter percentage, energy value, storage location, and opening, received, consumed, and closing stock values.
  - AC-8.1 [ui] Given The inventory response contains feed item details and stock movement totals.; when A user opens the inventory view.; then The screen displays each item's name, category, available quantity, unit of measure, unit cost, dry-matter percentage, energy value, storage location, and opening, received, consumed, and closing stock values.
  - AC-8.2 [ui] Given A user enters values for a new inventory item.; when The user submits the inventory form and receives a successful result.; then The inventory screen displays the returned item and its submitted field values.
- **REQ-9** (ADDED) When the inventory service refuses a stock movement that would make available inventory negative, the Feedlot web app shall show the returned shortage and refusal message and leave the movement visibly unsaved for correction.
  - AC-9.1 [ui] Given The inventory service returns a refusal and shortage amount for a movement that would create a negative balance.; when The user submits that movement.; then The screen displays the returned error and shortage value, keeps the movement form displayed, and does not show a saved movement record.
- **REQ-10** (ADDED) The Feedlot web app shall let users configure a wastage ratio and display ingredient balance and shortage forecasts for daily, weekly, monthly, quarterly, bi-annual, and annual horizons using dated feeding-plan demand and wastage-adjusted estimated consumption.
  - AC-10.1 [ui] Given The forecast response contains balance and shortage estimates for the six requested horizons and a configured wastage ratio.; when A user opens inventory forecasts and selects each horizon.; then The screen displays the wastage ratio and returned ingredient balance and shortage values for daily, weekly, monthly, quarterly, bi-annual, and annual horizons.
  - AC-10.2 [ui] Given A forecast response marks a period without a dated feeding plan as unavailable.; when The forecast is displayed.; then The screen marks that period unavailable rather than displaying a numeric estimate.
- **REQ-11** (ADDED) The Feedlot web app shall let users create and view rations with a name, type, ingredient quantities or as-fed proportions, dry-matter percentage, energy value, intended animal type or weight range, and returned calculated cost per pound.
  - AC-11.1 [ui] Given Feed ingredients, unit costs, nutrition values, and ration attributes are available.; when The operator creates and saves a ration.; then The screen displays the saved ration's ingredient quantities or as-fed proportions, returned cost per pound, dry-matter percentage, energy value, and intended animal type or weight range.
- **REQ-12** (ADDED) The Feedlot web app shall provide a ration comparison view showing returned ration costs and associated lot performance or cost-of-gain values, and identify the mix with the lowest returned cost of gain when that comparison value is available.
  - AC-12.1 [ui] Given The comparison response contains multiple rations, costs, and associated lot performance or cost-of-gain values.; when The operator opens ration comparison.; then The screen displays a comparison list with each returned ration cost and performance or cost-of-gain value, and identifies the lowest returned cost-of-gain value when provided.
- **REQ-13** (ADDED) Where inventory or ration screens display ton-denominated prices, the Feedlot web app shall display the equivalent per-pound price in the configured currency and display calculation quantities in pounds.
  - AC-13.1 [ui] Given An inventory item or ration has a ton-denominated price and the configured currency is available.; when The item or ration is displayed.; then The screen displays the equivalent per-pound price in the configured currency and quantities in pounds.
- **REQ-14** (ADDED) The Feedlot web app shall let users generate a dated pen feeding plan from a selected ration, per-animal daily bunk rate, pen animal count, date, and planned feeding time, and display the returned planned quantity, quantity per animal, total feed cost, expected energy intake, and plan status.
  - AC-14.1 [ui] Given A pen has an animal count and the user selects a ration, date, feeding time, and per-animal daily rate.; when The user generates the feeding plan.; then The screen displays planned quantity equal to the per-animal rate multiplied by animal count, along with quantity per animal, total feed cost, expected energy intake, and plan status.
  - AC-14.2 [ui] Given A plan response contains a status.; when The plan is displayed.; then The status field displays the returned value, including Planned, In progress, Completed, or Skipped when returned.
- **REQ-15** (ADDED) When a feeding plan is for a pen containing multiple lots, the Feedlot web app shall require a planned quantity allocation for every lot and flag allocations that do not reconcile with the plan total.
  - AC-15.1 [ui] Given A pen contains multiple lots and an allocation total differs from the plan total.; when A user creates or edits the feeding plan.; then The screen displays an allocation reconciliation flag and the difference from the plan total.
  - AC-15.2 [ui] Given A pen contains multiple lots and one lot has no allocation.; when The user attempts to save the plan.; then The screen identifies the lot without an allocation and does not show the plan as saved.
  - AC-15.3 [ui] Given A pen contains one lot.; when A user creates its feeding plan.; then The screen displays the single lot allocation field.
- **REQ-16** (ADDED) When a user saves an actual feeding event, the Feedlot web app shall display the returned planned quantity, actual delivered quantity, actual-minus-planned variance, feed cost, energy value, inventory decrement based on delivered quantity, feeding status, lot allocation, and the ingredient unit-cost snapshot recorded at save time.
  - AC-16.1 [ui] Given A feeding plan exists and the user enters actual delivered quantity and feeding details.; when The user saves the feeding event and opens its detail screen.; then The screen displays the returned planned and actual quantities, variance equal to actual minus planned quantity, feed cost, energy value, inventory consumption, and feeding status.
  - AC-16.2 [ui] Given A feeding event is saved with planned allocations to multiple lots.; when The event details are opened.; then The screen displays each lot's returned actual quantity allocated in proportion to planned quantities and the event cost returned for the save.
  - AC-16.3 [ui] Given An ingredient unit cost changes after an earlier feeding event has been saved.; when The user saves a new feeding event and views both event details.; then The screen displays the earlier event cost using its saved unit-cost value and the new event cost using the unit-cost value at the new event save.
  - AC-16.4 [ui] Given A feeding event has nonzero wastage configured.; when The user saves the event and opens its detail screen.; then The screen displays the actual delivered quantity as the inventory decrement and any wastage-adjusted estimated consumption separately.
- **REQ-17** (ADDED) ⚠ only one draft had this When an actual feeding activity differs from its plan, the Feedlot web app shall show the planned-versus-actual variance and provide an action to adjust a future feeding plan.
  - AC-17.1 [ui] Given A saved feeding activity has different planned and actual quantities.; when The operator opens the pen's feeding plan view.; then The screen displays the planned quantity, actual quantity, variance, and an action to adjust a future plan.
  - AC-17.2 [ui] Given The operator selects the future-plan adjustment action.; when The adjustment form opens.; then The screen displays editable future plan quantity fields and the selected pen and ration.
- **REQ-18** (ADDED) The Feedlot web app shall let users record lot weight measurements with measurement date, number of animals weighed, average animal weight, and notes; calculate total measured weight as average weight multiplied by number weighed; and provide no independent total-weight entry field.
  - AC-18.1 [ui] Given The weight measurement form is open.; when The operator enters an average weight and number weighed.; then The screen displays total measured weight equal to average weight multiplied by number weighed and has no independently editable total-weight field.
  - AC-18.2 [ui] Given A user enters an average weight of 500 pounds and 20 animals weighed.; when The user views and saves the weight measurement.; then The screen displays a calculated total measured weight of 10,000 pounds and the saved measurement record in the lot weight history.
- **REQ-19** (ADDED) The Feedlot web app shall display each lot's weight measurement history as a time-ordered list of dated records including average weight, number weighed, total measured weight, weight gain since the prior measurement, and notes when returned.
  - AC-19.1 [ui] Given A lot response contains multiple dated weight measurements.; when A user opens the lot weight history.; then The screen displays a time-ordered list of returned measurement records and their date, number weighed, average weight, total weight, weight gain since the prior measurement, and notes when returned.
- **REQ-20** (ADDED) When a user edits or voids a saved feeding or weight record, the Feedlot web app shall display returned revised balances and metrics while retaining the original record in the record history.
  - AC-20.1 [ui] Given A saved feeding or weight record is available for correction and has affected displayed balances or metrics.; when The user edits or voids the record and the service returns revised data.; then The screen displays the returned revised balances and metrics and retains the original record in the record history.
- **REQ-22** (ADDED) The Feedlot web app shall display returned lot feed-to-gain metrics for days on feed, total weight gain, average daily gain, total feed consumed, feed conversion ratio, feed cost per unit of weight gain, and projected ship date, using recorded feed costs only for feed cost per unit of gain.
  - AC-22.1 [ui] Given A lot metrics response contains the requested feed-to-gain fields.; when A user opens the lot performance view.; then The screen displays each returned metric and the returned feed-cost-per-gain value.
  - AC-22.2 [ui] Given A lot has a receiving date 100 days before the current date, entry average weight of 1,000 pounds, current average weight of 1,200 pounds, 10,000 pounds total feed consumed, and 4,000 currency units of recorded feed cost.; when The user opens the lot performance screen.; then The screen displays 100 days on feed, 200 pounds total weight gain, ADG of 2 pounds per day, FCR of 50, and cost of gain of 20 currency units per pound.
  - AC-22.3 [ui] Given A lot has non-feed costs as well as recorded feed costs and positive total weight gain.; when The user opens the cost-of-gain detail.; then The screen displays cost of gain calculated from recorded feed costs only.
- **REQ-23** (ADDED) When a feeding or weight event is saved and updated metrics or predictive insights are returned, the Feedlot web app shall refresh the displayed lot metrics and show returned feeding-adjustment or sale-timing suggestions.
  - AC-23.1 [ui] Given A feeding or weight event is saved and a response contains updated metrics and insights.; when The event-save flow completes.; then The screen displays the returned updated metric values and next-step feeding or sale-timing suggestions without requiring the user to re-enter the event.
- **REQ-24** (ADDED) The Feedlot web app shall provide an operational dashboard showing active lots and pens, animals per lot and pen, feed inventory status, ration usage, daily bunk rate per pen, planned versus actual feed, total feed consumed, total feed cost, starting and current weight, total weight gain, average daily gain, feed-to-gain ratio, feed cost per unit of gain, energy consumed, and best- and worst-performing lots.
  - AC-24.1 [ui] Given The dashboard response contains operational and performance data.; when A user opens the dashboard.; then The screen displays each requested dashboard measure and identifies the returned best- and worst-performing lots.
- **REQ-25** (ADDED) The Feedlot web app shall provide operational report views identifying the highest-feed-consuming pen, best feed-to-gain lot, highest-ADG lot, most-used ration, plan-versus-actual alignment, overfed or underfed pens, remaining inventory, and feed cost per unit of weight gain.
  - AC-25.1 [ui] Given The operational report response contains rankings and variance data.; when A user opens operational reports.; then The screen displays the returned highest-consuming pen, best feed-to-gain lot, highest-ADG lot, most-used ration, feeding alignment, overfed or underfed pens, remaining inventory, and cost-per-gain values.
- **REQ-26** (ADDED) The Feedlot web app shall provide a dedicated Feed-to-Gain report with date-range, lot, breed, sex, and pen filters to compare ADG, FCR, and cost of gain across lots.
  - AC-26.1 [ui] Given Multiple lot results are returned for a Feed-to-Gain report.; when A user selects date-range, lot, breed, sex, or pen filters.; then The screen displays the selected filter values and returned matching lots with ADG, FCR, and cost-of-gain fields.
  - AC-26.2 [ui] Given The report is displayed with selected filters.; when A user changes a date-range, lot, breed, sex, or pen filter.; then The screen displays the selected filter values and results returned for that scope.
- **REQ-27** (ADDED) When a user exports the Feed-to-Gain report, the Feedlot web app shall provide CSV and PDF files containing the report results for the selected filter scope.
  - AC-27.1 [ui] Given A Feed-to-Gain report is filtered to a selected scope.; when The user exports CSV.; then The downloaded file is a CSV containing the displayed report results and selected scope.
  - AC-27.2 [ui] Given A Feed-to-Gain report is filtered to a selected scope.; when The user exports PDF.; then The downloaded file is a PDF containing the displayed report results and selected scope.
- **REQ-28** (ADDED) The Feedlot web app shall provide a yard-level summary showing aggregate total head, average ADG, average cost of gain, and total feed cost across active lots.
  - AC-28.1 [ui] Given The yard summary response contains aggregate values for active lots.; when A user opens the yard-level summary.; then The screen displays total head, average ADG, average cost of gain, and total feed cost.
- **REQ-29** (ADDED) The Feedlot web app shall provide representative mock operational data and a project presentation page containing the proposed solution, architecture diagrams, demo walkthrough, coding prompts, testing and validation overview, challenges, production-readiness assessment, and go-to-market strategy and analysis.
  - AC-29.1 [ui] Given The demo workspace is open and sample operational data is available.; when The operator loads the sample data or opens the mock-data area.; then The screen displays representative procurement, lot, pen, inventory, ration, feeding, and weight records.
  - AC-29.2 [ui] Given A user opens the solution presentation page.; when The page renders.; then The page displays sections for the proposed solution, architecture diagrams, demo walkthrough, prompts, testing and validation, challenges, production readiness, and go-to-market analysis.

Not changing: API-SIDE: durable persistence, database schemas and seeded rows; procurement source retrieval and import reconciliation policy; transactional stock validation and inventory decrement; server-side ration, allocation, cost, weight, forecast, and Feed-to-Gain calculations; and recalculation after edits or voids. The web app criteria cover requests sent and API-returned values, messages, and screen rendering; separate API tests must prove server behavior.; A live external procurement connector is excluded; the demo uses a mock source adapter.; Later changes to head count from transfers, deaths, or sales are not represented in the requested metrics.; A full audit trail beyond creator and last-change metadata is not included.

## Files the plan will touch (7)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: OPTION-1 (chosen): Use the generated OpenAPI client directly from each scaffolded screen container, with each screen owning its complete API and interaction slice. | OPTION-2: Add shared domain-service modules that normalize API data and coordinate the screen containers.
Decision: Decision: use the generated OpenAPI client directly from each screen container.
Each screen owns its data loading, form behavior, and rendering in a working slice.
This avoids a handwritten client and premature shared-service layer.
The API contract remains the shared boundary for the web and API repositories.
- TASK-1 Design system and scaffold build → REQ-1, NFR-3; must pass AC-1.1, AC-1.2
- TASK-2 Wire the yard overview screen → REQ-24, REQ-28, NFR-3; must pass AC-24.1, AC-28.1
- TASK-3 Wire procurement, lot lifecycle, and weight records → REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7, REQ-18, REQ-19, REQ-20, REQ-22, REQ-23, NFR-3; must pass AC-2.1, AC-2.2, AC-3.1, AC-4.1, AC-5.1, AC-5.2, AC-6.1, AC-7.1, AC-18.1, AC-18.2, AC-19.1, AC-22.1, AC-22.2, AC-22.3
- TASK-4 Wire feed inventory, rations, plans, and deliveries → REQ-8, REQ-9, REQ-10, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-20, REQ-23, NFR-3; must pass AC-8.1, AC-8.2, AC-9.1, AC-10.1, AC-10.2, AC-11.1, AC-12.1, AC-13.1, AC-14.1, AC-14.2, AC-15.1, AC-15.2, AC-15.3, AC-16.1, AC-16.2, AC-16.3, AC-16.4, AC-17.1, AC-17.2, AC-20.1, AC-23.1
- TASK-5 Wire operational insights and project brief → REQ-25, REQ-26, REQ-27, REQ-29, NFR-3; must pass AC-25.1, AC-26.1, AC-26.2, AC-27.1, AC-27.2, AC-29.1, AC-29.2

## Task order (2 waves for 5 tasks; the tasks run one after another today)
- Wave 1: TASK-1
- Wave 2: TASK-2 (after: planner), TASK-3 (after: planner), TASK-4 (after: planner), TASK-5 (after: planner)
Side by side, the longest chain is 590 of 1540 planned lines.

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /api/overview -> 200, 400
- GET /api/yard/records -> 200, 400
- POST /api/yard/sync -> 200, 400, 409
- POST /api/yard/mappings -> 201, 400, 409
- GET /api/yard/conflicts -> 200, 400
- GET /api/yard/conflicts/{recordId}/review -> 200, 404
- GET /api/lots/forecasts -> 200, 400
- GET /api/lots/{lotId}/forecast -> 200, 404
- GET /api/lots/{lotId}/metrics -> 200, 404
- GET /api/lots/{lotId}/weights -> 200, 404
- POST /api/lots/{lotId}/weights -> 201, 400, 404
- PUT /api/weights/{weightId} -> 200, 400, 404
- POST /api/weights/{weightId}/void -> 200, 400, 404
- GET /api/feed/inventory -> 200, 400
- POST /api/feed/inventory -> 201, 400
- POST /api/feed/stock-movements -> 201, 400, 409
- PUT /api/feed/forecast-settings -> 200, 400
- GET /api/feed/forecasts -> 200, 400, 404
- GET /api/feed/rations -> 200, 400
- POST /api/feed/rations -> 201, 400
- GET /api/feed/ration-comparison -> 200, 400
- GET /api/feed/plans -> 200, 400
- POST /api/feed/plans -> 201, 400, 404
- PATCH /api/feed/plans/{planId} -> 200, 400, 404
- POST /api/feed/events -> 201, 400, 404, 409
- PUT /api/feed/events/{eventId} -> 200, 400, 404, 409
- POST /api/feed/events/{eventId}/void -> 200, 400, 404
- GET /api/insights/operational -> 200, 400
- GET /api/insights/feed-to-gain -> 200, 400
- GET /api/insights/feed-to-gain/export.csv -> 200, 400
- GET /api/insights/feed-to-gain/export.pdf -> 200, 400
- GET /api/insights/yard-summary -> 200, 400
- GET /api/insights/project-brief -> 200, 400

## Critic findings (0)
_The critic was off for this run: pick a model for the critic step at the start to turn it on._

## Still open after 0 repairs
- [round trip] not asked for: Render every page responsively for phone, tablet, and desktop browser widths, with touch-sized controls on narrow layouts.

## Settled by questions, and open risks
- Spec question Q-9: Should the full 28-requirement scope be approved as one run, or should any part be cut? → Approve the full scope as one run. (answered)
- Open risk: Render every page responsively for phone, tablet, and desktop browser widths, with touch-sized controls on narrow layouts.

**This spec has 28 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261014-hackathon-problem-statement-fe-b587 <hash> --note "your risk note"
  factory reject  20261014-hackathon-problem-statement-fe-b587 <hash> --reason "why"

Card hash: d539d824