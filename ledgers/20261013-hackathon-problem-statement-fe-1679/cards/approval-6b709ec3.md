# Approval: Import procurement and receiving data, and map PO lines to lots and pe

Run 20261013-hackathon-problem-statement-fe-1679 · risk **high** · feature · size L · cost so far $0.76

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
- Q-1 Should the feed-to-gain report and its exports follow the same yard and profitability access rules as dashboards? → **Restrict report results and exports to the user's authorized yards and apply the same profitability restrictions as dashboards.**
- Q-2 How should users sign in to access operational records and role-based permissions? → **Use email and password sign-in for the web app.**
- Q-3 Who may import source records and change PO-to-lot and lot-to-pen mappings? → **Only users with operational access can import source records and change mappings; other users can view them.**
- Q-4 Who may change target weights and growth-rate assumptions used for forecasts? → **Authorized managers can change the assumptions; other users can view forecasts.**
- Q-5 Who may maintain inventory items, record receipts or adjustments, and change the wastage setting? → **Authorized inventory users may make these changes; operational users may view inventory and record feeding subject to stock controls.**
- Q-6 Who may create, revise, optimize, and approve ration definitions? → **Only users with authorized ration-management access may perform these actions; other users may view rations.**
- Q-7 How should feed-plan creation or adjustment permissions differ from updating a plan's execution status? → **Authorized planners generate or adjust plans; operators may update execution status for their assigned pens.**
- Q-8 Who may add weight measurements to a lot's history? → **Only authorized livestock or operations users may add measurements; other users may view them.**

## Confirm these assumptions (high risk)
- [ ] ASM-2 Can animals from one lot be allocated across multiple pens, and should the system retain the animal allocation for each pen? → assumed: Allow a lot to occupy multiple pens and retain allocation quantities for traceability.
- [ ] ASM-3 What target-weight and growth-rate basis should the initial market-date forecast use when incoming records do not provide those values? → assumed: Use configurable yard defaults for target weight and expected gain rate, with optional lot-specific overrides.
- [ ] ASM-4 How should actual feed wastage be represented in relation to the configured wastage ratio? → assumed: Apply the ratio to estimates and projections; record known actual wastage as a separate inventory movement, not as an extra charge on delivered feed.
- [ ] ASM-6 Who may create, revise, optimize, or approve ration definitions? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-7 What should happen to a saved feed plan if its pen count, ration, or bunk-rate inputs change after generation? → assumed: Keep the saved plan unchanged, flag it for review, and require an authorized user to confirm or regenerate it.
- [ ] ASM-8 Who may create or adjust feed plans, and who may update execution status? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-9 What should happen when a feeding event would consume more ingredient stock than is available? → assumed: Block saving the event until stock is sufficient or an authorized inventory adjustment is recorded.
- [ ] ASM-10 How should a saved feeding event be corrected or voided? → assumed: Who created and last changed each record, and when; no full audit trail.
- [ ] ASM-11 Who may record feeding activity and who may correct or void saved activity? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-12 Who may add lot weight measurements? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-14 Should dashboard visibility be limited by yard access, and should profitability values have additional access restrictions? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-15 How should sample data be loaded and reset? → assumed: Keep sample records visibly distinct, prevent duplicate loading, and require confirmation before a reset or replacement removes data.
- [ ] ASM-16 Who may view the yard-level summary, and how should missing summary data be presented? → assumed: Two roles: an administrator and a standard user.
- [ ] ASM-17 What data should the lot-level profitability analysis use to calculate financial return? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- [ ] ASM-20 What quantity basis should be used for ration, plan, and feeding calculations when ingredient data uses different units or dry-matter values? → assumed: Use as-fed quantities for plans and actual feeding, convert feed totals to pounds for feed-to-gain calculations, and use dry matter for nutrition calculations.
- [ ] ASM-24 How should repeated imports identify records already received from procurement so they do not create duplicate PO lines, lots, or receiving records? → assumed: Match records using source-system identifiers and update the corresponding imported records.
- [ ] ASM-25 How should animal quantities be represented when a PO line splits across lots and lots or pens contain animals from multiple groups? → assumed: Track allocated animal quantities for each PO-line-to-lot and lot-to-pen relationship.
- [ ] ASM-28 How should the configurable wastage ratio affect actual feeding activity and stock movements, as distinct from estimates and projections? → assumed: Apply wastage to estimates and projections only; decrement actual stock by the quantity recorded as delivered.
- [ ] ASM-30 If bunk rates, animal counts, or ration assignments change after a feed plan is generated, what should happen to the saved plan? → assumed: Keep the saved plan unchanged and require an authorized user to confirm an update or regenerate it.
- [ ] ASM-31 What should happen when a feeding event would consume more stock than is available? → assumed: Block the event until stock is sufficient or an authorized inventory adjustment is recorded.
- [ ] ASM-32 How should a saved feeding event be corrected or voided if it was entered incorrectly? → assumed: Who created and last changed each record, and when; no full audit trail.
- [ ] ASM-34 Should ration ingredient proportions and feed quantities use an as-fed or dry-matter basis for cost and consumption calculations? → assumed: Use as-fed quantities for inventory and delivery calculations, and report dry-matter values separately.
- [ ] ASM-37 How should sample data be loaded and reset without mixing it with live operational records? → assumed: Keep sample data distinct from operational records and prevent accidental duplicate loading; require confirmation before reset.

Other assumptions: ASM-1 What source connection should procurement and receiving synchronization use for the demo and eventual deployment? → assumed: Use a documented import adapter with mock source data for the demo; defer a live connector until the procurement system and API are identified.; ASM-5 What should ration optimization do with the available ingredients and nutrition requirements? → assumed: Compare candidate mixes and identify the lowest-cost mix that meets user-selected nutrition requirements; let the user choose whether to save it.; ASM-13 Which date basis should the projected ship-date formula use? → assumed: Use the current date plus (target weight minus current weight) divided by positive ADG.; ASM-18 What should the predictive insights recommend based on weight-gain trends? → assumed: Show explainable rule-based suggestions for feeding adjustments or sale timing, and require a user to decide whether to act.; ASM-19 How should the system respond when actual bunk intake differs from the projected feeding plan? → assumed: Show intake and variance and let an authorized user adjust a future plan; do not automatically rewrite a saved plan.; ASM-21 What should the report's date-range filter mean for per-lot ADG, FCR, and cost of gain? → assumed: Calculate each metric from feeding and weight records within the selected date range, using the relevant starting and ending weights.; ASM-22 What should determine the dashboard's best- and worst-performing lot ranking when performance measures disagree? → assumed: Let users choose the ranking measure, such as FCR, ADG, or cost of gain, and show the chosen basis.; ASM-23 For the procurement and receiving ingestion demo, should the app connect to a live source system or demonstrate synchronization with mock source data? → assumed: Demonstrate the integration flow using mock source data; defer live connectivity until a source interface is specified.; ASM-26 What basis should the initial market-date forecast use when incoming records provide no measured growth history? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-27 Which consumption basis should inventory projections use across the requested forecast horizons? → assumed: Project from saved upcoming feed plans, applying the configured wastage ratio.; ASM-29 What does ration cost optimization need to do beyond calculating nutrition and ingredient-mix cost? → assumed: Compare user-defined candidate mixes and show their nutrition and cost.; ASM-33 How should a projected ship date be presented when a lot has no positive ADG or has not yet recorded enough weight data to calculate one? → assumed: Show the projected date as unavailable until a positive ADG can be calculated or configured.; ASM-35 The feed-to-gain report requires a sex filter, but the listed incoming animal fields do not include sex. How should the filter be supported? → assumed: Import and retain sex when the source provides it; show the filter as unavailable for records without it.; ASM-36 Should dashboard metrics open their contributing lot, pen, feeding, or weight records, or remain summary-only? → assumed: Keep dashboards summary-only; use the lot and report views for detail.; ASM-38 How should the yard summary calculate average ADG and Cost of Gain across active lots? → assumed: Calculate aggregate ADG and Cost of Gain from total gain and total feed cost across the included lots.

## Requirements
- **REQ-1** (ADDED) The feedlot web app shall provide email-and-password sign-in, send the submitted credentials to the sign-in service, display the resulting landing page or authentication error, render navigation and actions according to the signed-in user's returned permissions, and clear authenticated page data and return to sign-in when an authenticated session expires or a protected request returns HTTP 401.
  - AC-1.1 [ui] Given The sign-in screen is displayed and the authentication service accepts the submitted credentials and returns the user and permissions; when The user submits an email address and password; then The screen shows the returned operational landing page and navigation actions allowed by the returned permissions
  - AC-1.2 [ui] Given The sign-in screen is displayed and the authentication service refuses the submitted credentials; when The user submits an email address and password; then The screen shows the returned error message and remains on the sign-in page
  - AC-1.3 [ui] Given An authenticated screen displays protected data and the session expires or a protected request receives HTTP 401; when The web app handles the expired session or 401 response; then The screen returns to sign-in and no protected page data remains displayed
- **REQ-2** (ADDED) Where mock procurement and receiving import is available, the feedlot web app shall let operationally authorized users preview and submit selected records through the documented mock-data adapter and display the returned import result and source fields.
  - AC-2.1 [ui] Given An operationally authorized user opens the import screen and mock adapter records are available; when The user previews the source records; then The screen displays each available record's vendor, source identifier, cost, head count, animal weight, breed, age, source, purchase-order, and receiving fields
  - AC-2.2 [ui] Given An operationally authorized user has selected mock source records; when The user submits the import; then The import request contains the selected source records and the screen displays the response status, imported-record list, and returned created or updated counts when supplied
  - AC-2.3 [ui] Given A user without operational access opens the import screen; when The screen renders using the user's returned permissions; then The screen displays imported records and does not show an enabled import action
- **REQ-3** (ADDED) The feedlot web app shall let operationally authorized users map PO lines to one or more lots and lots to one or more pens, retain allocated animal quantities, and display the resulting traceability and pen information.
  - AC-3.1 [ui] Given An imported PO line is allocated across multiple lots and a lot is allocated across multiple pens; when The mapping screen renders the returned mappings; then The screen shows each PO-line-to-lot and lot-to-pen relationship with its allocated animal quantity
  - AC-3.2 [ui] Given A mapping response contains pen information; when The mapping screen renders the response; then The screen displays each mapped pen's ID, capacity, current animal count, and mapped allocation quantity
  - AC-3.3 [ui] Given An operationally authorized user changes mapping quantities, or a user without operational access opens the mapping screen; when The authorized user saves mappings or the other user's screen renders using returned permissions; then The screen displays the saved mapping values returned by the service, and for a user without operational access it displays existing mappings without mapping-change actions
  - AC-3.4 [ui] Given An edited allocation conflicts with a PO line's returned head count or a pen's returned capacity and the mapping service refuses the save; when The user submits the mapping changes; then The screen displays the returned error and the last saved mapping values remain displayed
- **REQ-4** (ADDED) ⚠ only one draft had this When an operational user repeats an import containing previously imported source-system identifiers, the feedlot web app shall display the import result for the matched records returned by the import service without presenting them as newly created duplicates, and flag returned allocation conflicts when an updated head count is below existing mapped quantities.
  - AC-4.1 [ui] Given The import response identifies source records as matched to existing records; when The repeated import completes; then The screen displays the matched record list and response status without displaying those records as newly created duplicates
  - AC-4.2 [ui] Given A repeated-import response updates a PO line's head count below its existing mapped allocation quantities and returns an allocation conflict; when The repeated import completes; then The screen displays the matched record, returned head count, existing mapped quantities, and an allocation-conflict flag without presenting the record as a new duplicate
- **REQ-5** (ADDED) The feedlot web app shall display market-date and target-weight forecasts from incoming animal data and configured yard defaults, use lot-specific overrides when present, show a forecast as unavailable without a positive gain rate, and expose forecast-assumption editing only to authorized managers.
  - AC-5.1 [ui] Given The forecast response contains incoming animal data, yard defaults, and a lot-specific override; when A user opens the lot forecast; then The screen displays the returned incoming data, target weight, expected gain rate, projected market date, and forecast basis using the lot-specific override
  - AC-5.2 [ui] Given A lot forecast has no positive gain rate available; when The user opens the forecast; then The projected date field displays an unavailable value on the screen
  - AC-5.3 [ui] Given An authorized manager changes a yard default or lot-specific override, or a user without manager authorization opens forecast settings; when The manager saves the assumption or the other user's screen renders; then The screen displays the returned forecast values for saved changes, and does not show assumption-edit actions to a user without manager authorization
- **REQ-6** (ADDED) The feedlot web app shall display feed inventory items and stock movements and let authorized inventory users maintain items, record receipts or adjustments, and change wastage settings, while displaying inventory details to users with viewing access.
  - AC-6.1 [ui] Given The inventory response contains feed items and stock movements; when A user opens the inventory screen; then The screen displays each item's name, category, available quantity, unit, unit cost, dry-matter percentage, energy value, storage location, wastage setting when returned, and opening, received, consumed, and closing stock values
  - AC-6.2 [ui] Given An authorized inventory user records a receipt or adjustment, edits an item, or changes wastage settings; when The user submits the change; then The screen displays the saved inventory record and stock-movement values returned by the service
  - AC-6.3 [ui] Given A user has inventory viewing access but lacks inventory-edit access; when The user opens inventory; then The screen displays inventory values and does not show enabled item, receipt, adjustment, or wastage-edit actions
- **REQ-7** (ADDED) The feedlot web app shall display inventory projections for daily, weekly, monthly, quarterly, semi-annual, and annual horizons using saved upcoming feed plans and configured wastage, while presenting known actual wastage separately from delivered-feed consumption.
  - AC-7.1 [ui] Given The projection response contains available stock, upcoming saved feed plans, and wastage-adjusted estimates; when A user selects each supported projection horizon; then The screen displays the returned projected consumption and closing or remaining inventory for daily, weekly, monthly, quarterly, semi-annual, and annual horizons, along with the configured wastage ratio
  - AC-7.2 [ui] Given The projection response has no saved upcoming feed plans for an item; when A user opens inventory projections; then The screen displays the response's empty-data state for that item's projected inventory
  - AC-7.3 [ui] Given The inventory service returns a known actual-wastage movement and delivered-feed consumption; when A user views the stock movement list; then The screen lists actual wastage as a separate movement from delivered-feed consumption
- **REQ-8** (ADDED) The feedlot web app shall let authorized ration managers create, revise, and optimize ration definitions, display ingredient proportions, nutrition and cost values, and present the lowest-cost candidate mix meeting user-selected nutritional requirements without saving it until the user chooses to do so.
  - AC-8.1 [ui] Given An authorized ration manager creates or revises a ration; when The manager enters ration details and ingredient proportions; then The screen displays fields for ration name and type, ingredients, proportions, intended animal type or weight range, dry matter, energy, and cost per unit
  - AC-8.2 [ui] Given The ration service returns nutrition values and calculated ingredient-mix cost; when The ration screen renders the response; then The screen displays the returned nutrition values and calculated cost per pound
  - AC-8.3 [ui] Given An authorized ration manager has selected nutrition requirements and candidate mixes; when The manager runs optimization; then The screen identifies the returned lowest-cost mix that meets the selected requirements and displays its nutrition and cost values with a separate save action
  - AC-8.4 [ui] Given An optimized candidate is displayed and the user has not selected a save action, or a user without ration-management access opens the ration screen; when The screen renders; then The candidate is displayed without being shown as a saved ration, and the unauthorized user's screen displays existing rations without create, revise, or optimize actions
  - AC-8.5 [ui] Given The optimization response indicates that no candidate mix meets the selected nutrition requirements; when The manager views the optimization result; then The screen displays that no mix qualifies and does not show an enabled save action for a qualifying mix
- **REQ-9** (ADDED) The feedlot web app shall let authorized planners generate or adjust dated pen-level feed plans from bunk rates, ration assignments, and animal counts, and display the returned plan details and execution status.
  - AC-9.1 [ui] Given An authorized planner selects a date, pen, bunk rate, ration, and animal count; when The planner submits the plan; then The plan request contains those selected values and the screen displays the returned plan's date, pen, assigned lot or lots, animal count, ration, planned quantity, planned time, quantity per animal, total feed cost, expected energy intake, and status
  - AC-9.2 [ui] Given A user lacks planning access and opens feed planning; when The screen renders using the user's returned permissions; then The screen displays existing plans without plan-generation or plan-adjustment actions
- **REQ-10** (ADDED) The feedlot web app shall flag a saved plan for review when relevant inputs change, retain its saved values until an authorized planner confirms an update or regenerates it, allow assigned-pen operators to update execution status while withholding enabled status-update actions from other operators and displaying returned refusals for rejected updates, and show intake variance without automatically rewriting the saved plan.
  - AC-10.1 [ui] Given A saved plan's pen count, bunk rate, animal count, or ration assignment changes after generation; when The user opens the plan; then The screen displays the saved plan unchanged and a review flag
  - AC-10.2 [ui] Given An authorized planner opens a plan flagged for review; when The plan screen renders; then The screen shows authorized confirm-update and regenerate actions
  - AC-10.3 [ui] Given An authorized planner confirms an update or regenerates a flagged plan; when The planner submits the selected action; then The plan request contains the selected action and the screen displays the response status and returned plan
  - AC-10.4 [ui] Given An operator is assigned to the plan's pen; when The operator updates the execution status; then The screen displays the returned status value for that pen's plan
  - AC-10.5 [ui] Given Actual bunk intake differs from the saved plan; when The user views the feeding plan and activity; then The screen displays actual intake and variance while the saved plan values remain unchanged
  - AC-10.6 [ui] Given An operator is not assigned to the plan's pen and the screen renders using the operator's returned permissions; when The operator opens the plan; then The screen displays the current status and does not show an enabled status-update action
  - AC-10.7 [ui] Given The service refuses a status update submitted by an operator who is not assigned to the plan's pen; when The operator submits the status update; then The screen displays the returned refusal error and the current plan status remains displayed
- **REQ-11** (ADDED) The feedlot web app shall let operational users record feeding activity by pen and lot, require delivered quantities entered for each lot in a multi-lot pen to add up to the pen's delivered quantity, display the returned variance, cost, energy, inventory consumption, feeding status, and lot-level consumption and cost totals, display a returned stock error when insufficient stock prevents saving, provide permission-controlled correction and void actions for saved feeding events, and display a timed-out save outcome as unknown while leaving retry resolution to the existing service/user workflow.
  - AC-11.1 [ui] Given An operational user enters feeding date, pen, ration, planned quantity, actual delivered quantity for the pen, and status for a pen containing one or more lots, and enters a delivered quantity for each lot such that the lot quantities sum to the pen's actual delivered quantity; when The user submits the feeding event; then The feeding request contains the entered fields and a delivered-quantity allocation for each affected lot whose total equals the pen's actual delivered quantity, and the screen displays the response status and returned event fields including the lot allocations
  - AC-11.2 [ui] Given A successful feeding response contains calculated values; when The event screen renders the response; then The screen displays actual-minus-planned variance, feed cost, energy value, inventory consumed by ingredient, and cumulative lot feed consumption and cost
  - AC-11.3 [ui] Given A successful feeding response contains planned quantity of 100 pounds, actual delivered quantity of 115 pounds, and a returned variance value of 15 pounds; when The event screen renders the response; then The screen displays the returned variance value of 15 pounds
  - AC-11.4 [ui] Given A feeding response includes actual delivered quantity and an inventory movement; when The event screen renders the response; then The screen displays stock consumption for the delivered quantity and known wastage as a separate movement rather than added delivered feed
  - AC-11.5 [ui] Given The service refuses a feeding event because available stock is insufficient; when The user submits the event; then The screen displays the returned stock error and does not display the event as saved
  - AC-11.6 [ui] Given A user without operational access opens feeding activity; when The screen renders; then The screen displays existing activity without an action to record a feeding event
  - AC-11.7 [ui] Given A feeding-event save request times out without a definitive response; when The web app handles the timeout; then The screen displays that the save outcome is unknown and retains the submitted event fields
  - AC-11.10 [ui] Given A user has returned permission to correct or void saved feeding events; when The user opens a saved feeding event; then The screen shows correction and void actions
  - AC-11.11 [ui] Given A user lacks returned permission to correct or void saved feeding events; when The user opens a saved feeding event; then The screen displays the event without enabled correction or void actions
  - AC-11.12 [ui] Given An authorized user submits a correction and the service returns the corrected event with updated inventory movement and lot totals; when The correction response is displayed; then The screen displays the returned corrected event, inventory movement, and lot consumption and cost totals
  - AC-11.13 [ui] Given An authorized user submits a void and the service returns the voided event with updated inventory movement and lot totals; when The void response is displayed; then The screen displays the returned void status, inventory movement, and lot consumption and cost totals
  - AC-11.14 [ui] Given A pen contains multiple lots and the sum of the entered delivered quantities for those lots differs from the pen's actual delivered quantity; when The user submits the feeding event; then The screen displays a validation error and no feeding request is sent
- **REQ-12** (ADDED) The feedlot web app shall let authorized livestock or operations users add lot weight measurements and display each lot's measurement history as a time-ordered series with returned measurement and gain information.
  - AC-12.1 [ui] Given An authorized user enters a lot weight measurement; when The user submits the measurement; then The measurement request contains lot, date, animals weighed, average animal weight, total lot weight when entered, and notes, and the screen displays the response status and saved measurement
  - AC-12.2 [ui] Given The weight response contains multiple measurements; when A user views the lot's weight history; then The screen displays returned measurements in date order with weight gain since the previous measurement where returned
  - AC-12.3 [ui] Given A user without measurement-entry access opens a lot's weight history; when The screen renders; then The screen displays the measurement time series without an enabled add-measurement action
- **REQ-13** (ADDED) The feedlot web app shall display returned lot feed-to-gain metrics for days on feed, total weight gain, average daily gain, total feed consumed in pounds, feed conversion ratio, cost of gain, and projected ship date, and refresh displayed metrics after feeding or weight records change.
  - AC-13.1 [ui] Given The lot metrics response contains receiving date, entry and current average weight, feed totals, feed cost, target weight, ADG, and projected ship date; when A user opens lot performance; then The screen displays the returned days on feed, total weight gain, average daily gain, total feed consumed in pounds, feed conversion ratio, cost of gain, and projected ship date
  - AC-13.2 [ui] Given A lot has no positive ADG available; when The user opens the lot performance screen; then The screen displays the projected ship date as unavailable
  - AC-13.3 [ui] Given A feeding or weight record is saved and the service returns updated lot metrics; when The user opens or refreshes lot performance after the save; then The screen displays the recalculated metric values returned for the updated records
  - AC-13.4 [ui] Given The lot metrics response contains days on feed, total weight gain, average daily gain, total feed consumed, feed conversion ratio, cost of gain, and projected ship date for a lot with multiple animals; when A user opens lot performance; then The screen displays each metric value returned by the service without substituting a web-calculated value
- **REQ-14** (ADDED) The feedlot web app shall present explainable rule-based suggestions for feeding adjustments or sale timing based on lot weight-gain trends and leave any resulting plan or sale change to an authorized planner's explicit action.
  - AC-14.1 [ui] Given The insights service returns a feeding-adjustment or sale-timing suggestion and its supporting trend data or rule; when The user opens lot insights; then The screen displays the suggestion and its returned explanation or cited basis
  - AC-14.2 [ui] Given A suggestion is displayed and the user has not chosen an action; when The user views the suggestion; then The screen displays the saved feed plan unchanged and does not change the sale date
  - AC-14.3 [ui] Given An authorized planner chooses to act on a displayed suggestion; when The planner submits the corresponding change; then The change request contains the planner's selected action and the screen displays the response status
  - AC-14.4 [ui] Given A user without planning access views a suggestion or the service refuses that user's attempted plan change; when The user opens lot insights or submits the change request; then The screen does not show an enabled plan-change action, or displays the returned refusal error, and the saved feed plan remains unchanged
- **REQ-15** (ADDED) The feedlot web app shall display a dashboard of yard and lot performance, inventory, feeding, weight, cost, and energy values and let users select the measure used to rank best- and worst-performing lots.
  - AC-15.1 [ui] Given The dashboard service returns yard, lot, pen, inventory, ration, feeding, weight, and performance values; when A user opens the dashboard; then The screen displays active lot and pen counts, animals per lot and pen, inventory status, ration usage, daily bunk rate per pen, planned versus actual feed, total feed consumed and cost, starting and current weight, total gain, ADG, feed-to-gain ratio, cost per unit of gain, energy consumed, and best- and worst-performing lots
  - AC-15.2 [ui] Given The dashboard displays best- and worst-performing lot rankings; when The user selects FCR, ADG, or cost of gain as the ranking measure; then The screen shows the lot ranking and selected measure as its basis
  - AC-15.3 [ui] Given The dashboard response contains no value for a summary field; when A user opens the dashboard; then The screen displays the returned empty-data state for that field
- **REQ-16** (ADDED) ⚠ only one draft had this The feedlot web app shall provide filterable operational reports for inventory, feeding, lot performance, and profitability that answer the requested pen, lot, ration, plan-variance, inventory, and cost-of-gain questions and export the filtered results as CSV.
  - AC-16.1 [ui] Given The operational report service returns records for multiple pens, lots, rations, feed plans, inventory items, and feed costs; when A user opens the reports screen and applies its available filters; then The screen shows which pen consumed the most feed, which lot has the best FCR and highest ADG, which ration is used most, planned-versus-actual feed and over- or under-feeding pens, remaining inventory, and feed cost per unit of weight gain
  - AC-16.2 [ui] Given A filtered operational report is displayed; when The user exports the report as CSV; then The downloaded file contains the filtered report rows shown on the screen
- **REQ-17** (ADDED) The feedlot web app shall display dashboards, reports, and exports using only records and profitability fields returned for the signed-in user's authorized yards and permissions, and remove previously displayed data from view and subsequent exports when returned permissions change.
  - AC-17.1 [ui] Given The service response contains only records for the user's authorized yards and profitability fields allowed by the user's returned permissions; when The user opens a dashboard or report; then The screen shows only the returned authorized-yard records and permitted profitability fields
  - AC-17.2 [ui] Given A user exports a filtered dashboard or report view; when The export is generated; then The downloaded file contains only the authorized-yard records and profitability fields shown to that user
  - AC-17.3 [ui] Given A dashboard or report displays records or profitability fields and an updated permissions response removes access to some of that data; when The web app processes the updated permissions; then The screen no longer displays the records or fields no longer permitted, and a subsequent downloaded file contains only currently permitted records and fields
- **REQ-18** (ADDED) The feedlot web app shall provide a feed-to-gain report comparing lot ADG, FCR, and cost of gain, with date-range, breed, sex, and pen filters, and CSV or PDF exports of filtered results subject to the user's returned permissions.
  - AC-18.1 [ui] Given The report service returns lot records with weight and feeding data for a selected date range; when The user selects date-range, breed, sex, or pen filters; then The report request contains the selected filters and the screen displays matching lots with ADG, FCR, and cost-of-gain values calculated from records in the selected date range
  - AC-18.2 [ui] Given Records without sex data are included in the report result set; when The user views the sex filter; then The screen displays the sex filter as unavailable for records without sex data
  - AC-18.3 [ui] Given The user has applied report filters and has export access; when The user exports the report as CSV or PDF; then The downloaded file contains the filtered report rows shown on the screen and omits any yard or profitability fields not permitted by returned permissions
- **REQ-19** (ADDED) ⚠ only one draft had this The feedlot web app shall provide a filterable on-screen lot profitability list for authorized yards, display service-returned ROI percentages (net return divided by investment) or an unavailable value when ROI is not returned, and display a CSV file containing the filtered authorized results when the user exports the list.
  - AC-19.1 [ui] Given The service returns profitability rows for yards authorized to the user, including ROI percentages; when The user opens and filters the lot profitability view; then The screen displays only the returned authorized-yard rows and labels each returned ROI percentage as ROI (net return divided by investment)
  - AC-19.2 [ui] Given The user has applied filters to the authorized lot profitability list; when The user selects CSV export; then The downloaded file contains the filtered authorized rows displayed by the screen
  - AC-19.3 [ui] Given The service indicates that the user cannot view profitability values; when The user opens the lot profitability view; then The screen hides profitability values
  - AC-19.4 [ui] Given The service returns an authorized-yard profitability row without an ROI percentage; when The user opens the lot profitability view; then The screen displays ROI as unavailable for that row
- **REQ-20** (ADDED) The feedlot web app shall let an authorized user load visibly distinct sample data, prevent duplicate sample loading while displaying the returned result, require confirmation before sample-data reset or replacement, distinguish sample records from operational records, exclude sample records from operational report and inventory-total views and their exports, and display dashboard and yard-summary aggregate values as returned by the service.
  - AC-20.1 [ui] Given Sample data is available and has not been loaded; when An authorized user loads the sample data; then The screen shows the returned sample records with a visible sample-data designation distinguishing them from operational records
  - AC-20.2 [ui] Given Sample data is already loaded or a duplicate load is refused; when A user attempts to load sample data; then The screen displays the returned duplicate-load result and the returned record list contains no duplicate sample records
  - AC-20.3 [ui] Given A user starts a sample-data reset or replacement but has not confirmed; when The confirmation dialog is displayed and the user cancels; then The screen shows the existing sample records unchanged and the reset or replacement request is not sent
  - AC-20.4 [ui] Given A user confirms a sample-data reset or replacement; when The service returns the operation result; then The screen displays the returned operation status and resulting sample-data list or record count when supplied
  - AC-20.5 [ui] Given A user lacks sample-data management permission and opens the sample-data controls; when The screen renders using the user's returned permissions; then The screen displays sample records and does not show enabled load, reset, or replacement actions
  - AC-20.6 [ui] Given The service refuses a sample-data load, reset, or replacement because the user lacks permission; when The user submits the operation; then The screen displays the returned error and the existing sample-data list remains displayed
  - AC-20.7 [ui] Given The service response contains sample and operational records for operational reports or inventory totals; when A user opens one of those operational views; then The screen displays report or inventory values based only on operational records and labels any sample records shown as sample data
  - AC-20.8 [ui] Given A user exports an operational report or inventory view when the service response contains sample and operational records; when The user generates the export; then The downloaded file contains operational records only and excludes sample records
  - AC-20.9 [ui] Given The dashboard or yard-summary response contains aggregate values, including values that may reflect sample and operational records; when A user opens the dashboard or yard summary; then The screen displays the returned aggregate values as provided without excluding or recalculating values that may include sample records
- **REQ-21** (ADDED) The feedlot web app shall display a yard-level summary of active-lot total head, average ADG, average cost of gain, and total feed cost using returned aggregate values, and show unavailable values when required source data is missing.
  - AC-21.1 [ui] Given The summary service returns active-lot aggregate values; when A user with yard-summary access opens the yard summary; then The screen displays total head, average ADG, average cost of gain, and total feed cost for the returned active lots
  - AC-21.2 [ui] Given The summary service returns no data for one or more summary metrics; when A user opens the yard summary; then The screen displays returned available values and an explicit unavailable value for each missing field
- **REQ-22** (ADDED) The feedlot web app shall provide a delivery overview or presentation page containing the proposed solution, architecture diagrams, app demo entry point, prompts used, testing and validation overview, challenges, production-readiness assessment, and go-to-market analysis.
  - AC-22.1 [ui] Given The delivery overview or presentation page is available; when A user opens the page; then The screen displays sections or links for the proposed solution, architecture diagrams, app demo entry point, prompts used, testing and validation, challenges, production readiness, and go-to-market analysis

Not changing: A live procurement-system connector is deferred; the demo uses a documented mock-data import adapter.; Durable persistence and database migration behavior for imported records, mappings, inventory, rations, plans, feeding events, and weight measurements are API-side and not specified by these web requirements.; Authoritative server-side calculation and update rules for inventory movements, ration nutrition and cost, feed-plan quantities, lot rollups, forecast values, and feed-to-gain metrics are not specified by these web requirements.; Authorization enforcement, import identifier matching and deduplication, stock sufficiency decisions, and authoritative yard/profitability data filtering are API-side; these web requirements cover controls, displayed responses, and export contents.

## Files the plan will touch (20)
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
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- components/screens/s-5/container.tsx  ← not found by grounding; check it
- components/screens/s-6/container.tsx  ← not found by grounding; check it
- components/screens/s-7/container.tsx  ← not found by grounding; check it
- components/screens/s-8/container.tsx  ← not found by grounding; check it
- components/screens/s-9/container.tsx  ← not found by grounding; check it
- lib/auth/session.ts  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: OPTION-1 (chosen): Implement each scaffolded screen container as a working slice using the generated OpenAPI client, with the sign-in slice providing shared session helpers. | OPTION-2: Add a shared cross-screen data/store and service orchestration layer before wiring screen containers.
Decision: Choose screen-by-screen working slices on the generated file routes and generated typed API client.
The first screen slice establishes session helpers; each later container owns its API calls, validation, permission-aware state, and errors.
Keep calculations, persistence, authorization, and mock-adapter integration API-side; the web app displays returned values.
Do not add a second client, native app, or cross-screen store.
- TASK-1 Design system and scaffold build → NFR-1; builds towards a later task (no criteria of its own)
- TASK-2 Sign-in and session foundation → REQ-1; builds towards a later task (no criteria of its own)
- TASK-3 Procurement imports → REQ-1, REQ-2, REQ-4; must pass AC-2.1, AC-2.2, AC-2.3
- TASK-4 PO, lot, and pen allocations → REQ-1, REQ-3, REQ-4; must pass AC-4.1, AC-4.2
- TASK-5 Lot list and forecast overview → REQ-1, REQ-3, REQ-5, REQ-13, REQ-14, REQ-15; builds towards a later task (no criteria of its own)
- TASK-6 Lot detail, weights, and insights → REQ-1, REQ-3, REQ-5, REQ-12, REQ-13, REQ-14; must pass AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-5.1, AC-5.2, AC-5.3, AC-12.1, AC-12.2, AC-12.3, AC-13.1, AC-13.2, AC-13.3, AC-13.4, AC-14.1, AC-14.2, AC-14.3, AC-14.4
- TASK-7 Inventory and stock movements → REQ-1, REQ-6, REQ-17, REQ-20; must pass AC-6.1, AC-6.2, AC-6.3
- TASK-8 Feed outlook and projections → REQ-1, REQ-7, REQ-17, REQ-20; must pass AC-7.1, AC-7.2, AC-7.3
- TASK-9 Ration editor and optimizer → REQ-1, REQ-8; must pass AC-8.1, AC-8.2, AC-8.3, AC-8.4, AC-8.5
- TASK-10 Feed plans and review workflow → REQ-1, REQ-9, REQ-10; must pass AC-9.1, AC-9.2, AC-10.1, AC-10.2, AC-10.3, AC-10.4, AC-10.5, AC-10.6, AC-10.7
- TASK-11 Feeding activity and corrections → REQ-1, REQ-11; must pass AC-11.1, AC-11.2, AC-11.3, AC-11.4, AC-11.5, AC-11.6, AC-11.7, AC-11.10, AC-11.11, AC-11.12, AC-11.13, AC-11.14
- TASK-12 Operational reports → REQ-1, REQ-16, REQ-17, REQ-20; must pass AC-16.1, AC-16.2
- TASK-13 Feed-to-gain report → REQ-1, REQ-17, REQ-18; must pass AC-18.1, AC-18.2, AC-18.3
- TASK-14 Lot profitability list → REQ-1, REQ-17, REQ-19; must pass AC-19.1, AC-19.2, AC-19.3, AC-19.4
- TASK-15 Sample-data controls → REQ-1, REQ-20; builds towards a later task (no criteria of its own)
- TASK-16 Delivery brief → REQ-1, REQ-22; must pass AC-22.1
- TASK-17 Yard dashboard and aggregate summary → REQ-1, REQ-15, REQ-17, REQ-20, REQ-21; must pass AC-1.1, AC-1.2, AC-1.3, AC-15.1, AC-15.2, AC-15.3, AC-17.1, AC-17.2, AC-17.3, AC-20.1, AC-20.2, AC-20.3, AC-20.4, AC-20.5, AC-20.6, AC-20.7, AC-20.8, AC-20.9, AC-21.1, AC-21.2

Stub commit (throws NotImplemented until implemented): lib/auth/session.ts

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- POST /api/auth/sign-in -> 200, 400, 401, 422, 500
- GET /api/session -> 200, 401, 500
- GET /api/dashboard -> 200, 401, 403, 500
- GET /api/imports/source-records -> 200, 401, 403, 500, 503
- POST /api/imports -> 200, 401, 403, 409, 422, 500, 503
- GET /api/allocations -> 200, 401, 403, 500
- PUT /api/allocations -> 200, 401, 403, 409, 422, 500
- GET /api/lots -> 200, 401, 403, 500
- GET /api/lots/{lotId}/forecast -> 200, 401, 403, 404, 500
- PATCH /api/forecast-settings -> 200, 401, 403, 422, 500
- PATCH /api/lots/{lotId}/forecast-settings -> 200, 401, 403, 404, 422, 500
- GET /api/lots/{lotId}/metrics -> 200, 401, 403, 404, 500
- GET /api/lots/{lotId}/insights -> 200, 401, 403, 404, 500
- POST /api/lots/{lotId}/insights/actions -> 200, 401, 403, 404, 409, 422, 500
- GET /api/lots/{lotId}/weights -> 200, 401, 403, 404, 500
- POST /api/lots/{lotId}/weights -> 201, 401, 403, 404, 422, 500
- GET /api/inventory -> 200, 401, 403, 500
- POST /api/inventory/items -> 201, 401, 403, 409, 422, 500
- PATCH /api/inventory/items/{itemId} -> 200, 401, 403, 404, 409, 422, 500
- POST /api/inventory/movements -> 201, 401, 403, 409, 422, 500
- GET /api/inventory/projections -> 200, 401, 403, 422, 500
- GET /api/inventory/export -> 200, 401, 403, 500
- GET /api/rations -> 200, 401, 403, 500
- POST /api/rations -> 201, 401, 403, 409, 422, 500
- PATCH /api/rations/{rationId} -> 200, 401, 403, 404, 409, 422, 500
- POST /api/rations/optimization -> 200, 401, 403, 422, 500
- POST /api/rations/{rationId}/approval -> 200, 401, 403, 404, 409, 500
- GET /api/feed-plans -> 200, 401, 403, 500
- POST /api/feed-plans -> 201, 401, 403, 409, 422, 500
- POST /api/feed-plans/{planId}/review -> 200, 401, 403, 404, 409, 422, 500
- PATCH /api/feed-plans/{planId}/status -> 200, 401, 403, 404, 409, 422, 500
- GET /api/feeding-events -> 200, 401, 403, 500
- POST /api/feeding-events -> 201, 401, 403, 409, 422, 500
- PATCH /api/feeding-events/{eventId} -> 200, 401, 403, 404, 409, 422, 500
- POST /api/feeding-events/{eventId}/void -> 200, 401, 403, 404, 409, 500
- GET /api/reports/operational -> 200, 401, 403, 500
- GET /api/reports/operational/export -> 200, 401, 403, 500
- GET /api/reports/feed-to-gain -> 200, 401, 403, 422, 500
- GET /api/reports/feed-to-gain/export -> 200, 401, 403, 422, 500
- GET /api/reports/profitability -> 200, 401, 403, 500
- GET /api/reports/profitability/export -> 200, 401, 403, 500
- GET /api/sample-data -> 200, 401, 403, 500
- POST /api/sample-data/load -> 200, 401, 403, 409, 500
- POST /api/sample-data/reset -> 200, 401, 403, 409, 422, 500
- POST /api/sample-data/replace -> 200, 401, 403, 409, 422, 500

## Critic findings (10)
- [medium] REQ-2 REQ-2 covers previewing available mock records and displaying a completed import, but specifies no visible state when the adapter returns no records, fails to load, or rejects the import.
- [high] REQ-6 REQ-6 promises inventory-item maintenance but its mutation criterion covers only editing an existing item, leaving no specified way to create the first feed item needed for rations, receipts, and stock-controlled feeding.
- [medium] REQ-6 AC-6.2 specifies only successful inventory changes, with no error or retained-state behavior if an item edit, receipt, adjustment, or wastage change is rejected or times out.
- [medium] REQ-8 REQ-8 omits any ration-approval action or permission path even though Q-6 authorizes ration managers to approve definitions and Q-13 removes only the requirement to approve before assignment.
- [high] REQ-8 AC-8.1 checks ration-entry fields and AC-8.3 checks an unsaved optimization result, but no criterion covers submitting a new or revised ration and displaying it as a saved ration available for planning.
- [medium] REQ-11 AC-11.14 rejects only lot allocations whose sum differs from the pen total, so negative per-lot quantities such as −10 and 110 pounds for a 100-pound delivery pass its stated validation.
- [medium] REQ-13 REQ-13 defines an unavailable projected date for nonpositive ADG but no displayed unavailable state for FCR or cost of gain when a new lot has no gain or feeding data.
- [high] REQ-14 REQ-14 permits an authorized planner to act on a sale-timing suggestion and refers to changing a sale date, but no requirement defines an editable sale-date field, its save result, or how it relates to the derived projected ship date.
- [medium] REQ-18 AC-18.2 says the global sex filter is unavailable 'for records without sex data' without specifying how it behaves when a report contains both known-sex and unknown-sex lots or how those lots appear in filtered exports.
- [medium] REQ-20 REQ-6 requires displaying returned inventory stock values while AC-20.7 requires operational-only inventory totals from a response containing sample and operational records, without specifying an operational-only returned total or reconciling that requirement with the API-authoritative calculation rule.

## Still open after 0 repairs
- [critic high] REQ-6 REQ-6 promises inventory-item maintenance but its mutation criterion covers only editing an existing item, leaving no specified way to create the first feed item needed for rations, receipts, and stock-controlled feeding.
- [critic high] REQ-8 AC-8.1 checks ration-entry fields and AC-8.3 checks an unsaved optimization result, but no criterion covers submitting a new or revised ration and displaying it as a saved ration available for planning.
- [critic high] REQ-14 REQ-14 permits an authorized planner to act on a sale-timing suggestion and refers to changing a sale date, but no requirement defines an editable sale-date field, its save result, or how it relates to the derived projected ship date.

## Settled by questions, and open risks
- Spec question Q-9: Should all 22 requirements be approved as one run, or should some requirements be cut? → Approve all 22 requirements as one run. (answered)
- Spec question Q-10: How should the app handle a feeding save that times out when it cannot reliably tell whether the event was saved? → Remove the uncertain-save reconciliation requirement; show a timed-out save as unknown and leave retry resolution to the existing service/user workflow. (answered)
- Spec question Q-11: Should dashboard and yard-summary aggregates be guaranteed to exclude sample records, even when the service returns aggregates mixed with operational data? → Display the returned aggregate values as provided, without a sample-free guarantee. (answered)
- Spec question Q-12: When one pen contains multiple lots, how should the delivered feed quantity be allocated among them? → Have the user enter a delivered quantity for each lot, with the lot quantities adding up to the pen total. (answered)
- Spec question Q-13: Should ration approval be required before a planner can assign a ration? → Remove the approval requirement; planners may assign any saved ration. (answered)
- Spec question Q-14: Which financial return metric should the lot profitability view identify? → Show service-returned ROI percentage (net return divided by investment), or show it as unavailable when not returned. (answered)
- Spec question Q-15: Should the explicit no-horizontal-overflow and 44-by-44-pixel minimum target criteria be retained in addition to the responsive, touch-sized baseline? → Omit these additional explicit criteria and rely on the responsive, touch-sized baseline. (answered)
- Open risk: REQ-6 promises inventory-item maintenance but its mutation criterion covers only editing an existing item, leaving no specified way to create the first feed item needed for rations, receipts, and stock-controlled feeding.
- Open risk: AC-8.1 checks ration-entry fields and AC-8.3 checks an unsaved optimization result, but no criterion covers submitting a new or revised ration and displaying it as a saved ration available for planning.
- Open risk: REQ-14 permits an authorized planner to act on a sale-timing suggestion and refers to changing a sale date, but no requirement defines an editable sale-date field, its save result, or how it relates to the derived projected ship date.

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

**This spec has 22 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261013-hackathon-problem-statement-fe-1679 <hash> --note "your risk note"
  factory reject  20261013-hackathon-problem-statement-fe-1679 <hash> --reason "why"

Card hash: 6b709ec3