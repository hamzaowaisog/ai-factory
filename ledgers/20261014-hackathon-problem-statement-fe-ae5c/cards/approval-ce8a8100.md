# Approval: Import procurement and receiving data, and map PO lines to lots and pe

Run 20261014-hackathon-problem-statement-fe-ae5c · risk **high** · feature · size L · cost so far $0.09

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
- Q-1 Which user roles and access boundaries are required for operational records, cost/performance views, imports, and data entry? → **No role distinctions; all users can view and operate all product areas.**
- Q-2 Should the wastage ratio represent only forecasted/estimated losses, or should actual wastage also be recorded as a separate stock movement? → **Apply the ratio to consumption estimates and projections; record actual wastage separately only when entered as a movement.**
- Q-3 When one pen contains multiple lots, how should a feeding activity's actual quantity and cost be attributed to lot-level metrics? → **Require the operator to enter a separate activity quantity for each affected lot.**
- Q-4 Should feed-to-gain calculations use feed on an as-fed basis or adjust feed consumption to dry matter? → **Use as-fed pounds for total feed consumed and FCR, converting entered inventory units to pounds as needed.**
- Q-5 Does 'lot-level profitability/ROI' require more than the specified feed cost per unit of weight gain? → **Report feed cost per pound of gain only; do not label it full ROI or profitability.**
- Q-6 What should ration optimization treat as its objective and constraints, and should a suggested ration ever be applied automatically? → **Present feasible low-cost mixes for user-specified nutritional targets or constraints; require the user to select a suggestion before using it.**
- Q-7 Must each actual feeding activity be linked to an existing feed plan, or may operators record feedings when no plan exists? → **Allow an activity against a pen and date without a plan; link it to a plan when one exists so variance can be shown.**
- Q-8 How should lot-level total weight gain be derived when measurements record an average weight and a number of animals weighed? → **Calculate lot total gain from the average-weight change multiplied by the lot headcount applicable at the measurement dates.**

## Confirm these assumptions (high risk)
- [ ] ASM-1 How should procurement and receiving data connect to the primary procurement system for this build? → assumed: Use clearly labelled mock/source data only; no live connector is required.
- [ ] ASM-2 What should happen when an import contains duplicate source identifiers, an unmatched PO line or lot, or a lot-to-pen assignment exceeding capacity? → assumed: Report row-level problems, keep unmatched records out of downstream pen operations, reject over-capacity assignments, and prevent duplicate imports from double-counting records.
- [ ] ASM-7 How should a recorded weight or feeding event be corrected after it has affected inventory or lot metrics? → assumed: Allow authorized users to edit or delete the event, then recalculate affected balances and metrics.
- [ ] ASM-9 How should users access the sample dataset, and what should happen if sample records conflict with operational records? → assumed: Provide a clearly labelled, separate demo dataset that users can load on demand; report conflicts and avoid presenting a partial load as complete.
- [ ] ASM-11 Which procurement/receiving source and connection method should the demo support, given that no primary system is named? → assumed: Use the stated mock upstream data only; demonstrate PO and receiving synchronization with supplied sample records.
- [ ] ASM-12 How should imported PO lines or receiving records that cannot be mapped to a lot or pen be handled? → assumed: Keep them visibly pending and exclude them from pen operations until mapped.
- [ ] ASM-13 What should happen when a PO-line-to-lot assignment would exceed the fetched pen capacity? → assumed: Reject the over-capacity assignment and explain the capacity limit.
- [ ] ASM-14 How should repeated imports of the same PO or receiving records be recognized and handled? → assumed: Use upstream record identifiers when available, skip records already imported, and report that they were duplicates.
- [ ] ASM-17 How may a saved lot weight measurement be corrected if an entry is later found to be wrong or out of order? → assumed: Allow an authorized user to edit or delete the reading, validate the resulting series, and recalculate affected metrics.
- [ ] ASM-18 What should happen when an activity would consume more feed than the inventory currently shows as available? → assumed: Reject the activity and explain the shortage; let the user correct inventory or quantity before saving.

Other assumptions: ASM-3 Which gain-rate assumption should drive projected market dates when current lot performance is unavailable or differs from the configured assumption? → assumed: Use the lot's current measured ADG whenever available, falling back to a configured default only when it is unavailable.; ASM-4 Should inventory projections also flag items expected to run low or out of stock within the selected horizon? → assumed: Show projected balances only; do not add low-stock alerts.; ASM-5 What objective and constraints should ration optimization use to identify economical mixes? → assumed: Compare ingredient mixes by cost and recorded nutrition values; users specify nutritional targets or constraints for a lowest-cost feasible comparison.; ASM-6 Must each actual feeding activity be linked to an existing dated plan, or may operators record an activity without one? → assumed: Make the plan link optional, while showing whether each activity was planned or unplanned.; ASM-8 What should the report's date-range filter refer to when comparing lot ADG, FCR, and cost of gain? → assumed: Use the date range to select the latest weight reading in that period and feeding events up to that reading.; ASM-10 Should the demo/project area include an overview of the prompts used to build the solution, in addition to the requested testing, challenges, readiness, and go-to-market material? → assumed: Omit prompt history; include the requested demo, testing/validation, challenges, production-readiness, and go-to-market material.; ASM-15 Which target weight and gain-rate assumptions should drive market-date forecasts when incoming data alone does not provide them? → assumed: Use a configurable target weight and gain-rate assumption for each lot, editable by users and retained with its forecast.; ASM-16 Should inventory forecasts also generate low-stock or stockout alerts, or only show projected levels across the requested horizons? → assumed: Email only, from fixed templates; no SMS or push.; ASM-19 How should the feed-to-gain report respond to an invalid date range or an unsupported filter value? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-20 What should users see if loading the sample dataset encounters duplicates or only some records can be loaded? → assumed: Report added, already-present, and failed records separately, and do not label a partial load as complete.; ASM-21 Should the yard-level aggregate dashboard be included in the core deliverable or treated as the stated stretch goal? → assumed: Treat it as a stretch goal; prioritize lot- and pen-level dashboards and reports.

## Requirements
- **REQ-1** (ADDED) The responsive feedlot web app shall let users preview and synchronize supplied mock purchase-order and receiving records, and review the returned source, vendor, cost, head-count, weight, breed, age, and row-outcome information.
  - AC-1.1 [ui] Given The mock procurement and receiving source contains purchase-order and receiving records with available field values.; when A user opens the import preview or synchronization results.; then The screen displays each returned record's source identifier, vendor, cost, head count, weight, breed, age, source, and row status, as available.
  - AC-1.2 [ui] Given A synchronization response contains added, duplicate or already-present, and failed row outcomes.; when A user opens the synchronization results.; then The screen displays separate added, duplicate or already-present, and failed row counts, and displays the source row and reported failure reason for each failed row.
- **REQ-2** (ADDED) The responsive feedlot web app shall let users trace a purchase-order line to one or more lots and lots to pens, and display returned duplicate, pending-mapping, and capacity outcomes while keeping unresolved records unavailable for pen operations.
  - AC-2.1 [ui] Given A purchase-order line is mapped to multiple lots and the lots are assigned to pens.; when A user reviews the mapping details and pen view.; then The screen displays the source purchase-order line, each linked lot, each assigned pen, and the returned pen capacity and current animal count where available.
  - AC-2.2 [ui] Given An import response identifies a duplicate, unmatched record, or row-level problem, or a mapping response refuses an over-capacity assignment.; when A user reviews import or mapping results, or attempts the assignment.; then The screen displays the affected source row, its returned status and problem detail, and the capacity refusal and limit where applicable; pending records are absent from pen-operation selectors and a refused assignment is not shown as completed.
  - AC-2.3 [ui] Given A purchase-order or receiving record has already been imported using its upstream identifier.; when A user synchronizes the same records again.; then The screen displays the duplicate outcome and does not display a second imported record for that identifier.
- **REQ-3** (ADDED) The responsive feedlot web app shall let users view and edit lot target-weight and gain-rate assumptions and display forecasts from incoming animal data, using measured ADG when available and the configured default when it is unavailable.
  - AC-3.1 [ui] Given A lot has incoming animal data, a target weight, and a current measured ADG.; when A user opens the lot forecast.; then The screen displays the returned target weight, projected market date, and measured gain-rate basis.
  - AC-3.2 [ui] Given A lot has no current measured ADG and has a configured default gain rate and target weight.; when A user opens the forecast and edits either assumption before requesting a refreshed forecast.; then The screen displays the retained submitted assumption values and the forecast response associated with those values, using the configured default gain rate.
  - AC-3.3 [ui] Given The forecast response contains a feeding adjustment or sale-timing recommendation.; when A user views the lot forecast or insights.; then The screen displays the returned recommendation and any associated ADG, projected market date, or plan-variance values supplied with it.
- **REQ-4** (ADDED) The responsive feedlot web app shall provide inventory screens to view feed-item details and enter and review stock movements, including separately entered actual wastage.
  - AC-4.1 [ui] Given Inventory responses contain feed items and stock movements.; when A user opens inventory details and movement history.; then The screen displays each item's name, category, available quantity, unit, unit cost, dry matter percentage, energy value, storage location, and opening, received, consumed, wastage-entered, and closing stock values as available.
  - AC-4.2 [ui] Given A user enters actual wastage as a stock movement.; when The movement is saved and the user opens the movement history.; then The screen displays the returned actual-wastage movement separately from consumption estimates and the configured wastage ratio.
- **REQ-5** (ADDED) The responsive feedlot web app shall let users configure a wastage ratio for consumption estimates and projections and review projected inventory balances for daily, weekly, monthly, quarterly, bi-annual, and annual horizons without low-stock alerts.
  - AC-5.1 [ui] Given A user has configured a wastage ratio and the inventory response contains projected balances.; when The user selects each supported forecast horizon.; then The screen displays the returned daily, weekly, monthly, quarterly, bi-annual, and annual projected balances reflecting the selected ratio in consumption estimates, with each horizon labeled and no low-stock alert shown.
- **REQ-6** (ADDED) The responsive feedlot web app shall let users create and view rations with ingredient proportions, nutrition values, intended animal type or weight range, and calculated cost per pound.
  - AC-6.1 [ui] Given A user creates or opens a ration with ingredient and animal-range data.; when The ration screen is displayed.; then The screen displays the ration name and type, ingredient names and proportions, dry matter percentage, energy value, intended animal type or weight range, and calculated cost per pound.
- **REQ-7** (ADDED) The responsive feedlot web app shall compare feasible ration mixes against user-specified nutritional targets or constraints using recorded ingredient costs and nutrition values, and require an explicit user selection before an optimized suggestion is used.
  - AC-7.1 [ui] Given Ingredients have recorded costs and nutrition values and a user submits nutritional targets or constraints.; when The user requests ration optimization.; then The screen displays returned feasible mixes with ingredient proportions, recorded nutrition values, and costs in lowest-cost order.
  - AC-7.2 [ui] Given An optimization suggestion is displayed and the user has not selected it.; when The user views the ration workflow.; then The screen shows the suggestion as unapplied; after selection, the screen displays the selected ration for use.
- **REQ-8** (ADDED) The responsive feedlot web app shall let users generate and review dated feeding plans for specific pens using a selected ration, daily bunk rate, and pen animal count, and display plan status and feeding details.
  - AC-8.1 [ui] Given A pen has an animal count and a user selects a date, ration, and daily bunk rate.; when The user generates and opens a feeding plan.; then The screen displays the returned plan's date, pen, assigned lot where applicable, animal count, ration, planned quantity, planned feeding time, quantity per animal, total feed cost, expected energy intake, and status.
  - AC-8.2 [ui] Given A feeding plan exists for a pen and date.; when A user opens that plan.; then The screen displays the returned status as Planned, In progress, Completed, or Skipped.
  - AC-8.3 [ui] Given A saved plan has actual intake data available.; when A user reviews the plan and adjusts it using the displayed intake.; then The screen displays planned and actual feed quantities, the variance, and the updated plan value returned after adjustment.
- **REQ-9** (ADDED) The responsive feedlot web app shall let users record feeding activities for a pen and date with an optional plan link, and require a separate actual quantity for each affected lot in a multi-lot pen.
  - AC-9.1 [ui] Given A user records a feeding activity for a pen and date where a plan exists.; when The activity is saved.; then The screen displays the returned plan link, planned and actual quantities, actual-minus-planned variance, feeding status, feed cost, energy value, and inventory consumed.
  - AC-9.2 [ui] Given A user records a feeding activity for a pen and date with no plan.; when The activity is saved.; then The screen displays the returned activity as unplanned and does not require a plan link.
  - AC-9.3 [ui] Given A pen contains multiple lots.; when The user enters actual quantities for an activity affecting those lots.; then The screen requires a separate quantity for each affected lot and displays the returned lot-level quantities.
- **REQ-10** (ADDED) The responsive feedlot web app shall display returned feeding-activity costs, energy, inventory consumption, lot consumption, plan variance, and save or shortage outcomes.
  - AC-10.1 [ui] Given A feeding activity is saved successfully and its response contains planned and actual quantities, cost, energy, and inventory consumption.; when A user opens the activity details and affected inventory or lot views.; then The screen displays the returned feed cost, energy, ingredient consumption, affected lot consumption, and actual-minus-planned variance where a plan exists.
  - AC-10.2 [ui] Given The API refuses an activity because available inventory is insufficient.; when A user submits the activity.; then The screen displays the returned shortage error and does not show the activity as saved.
- **REQ-11** (ADDED) The responsive feedlot web app shall let users record, view, edit, and delete lot weight measurements and display the dated measurement series and returned validation or metric updates.
  - AC-11.1 [ui] Given A user records a weight measurement for a lot.; when The measurement is saved.; then The screen displays the returned measurement date, number of animals weighed, average animal weight, total lot weight, weight gain since the prior measurement, and notes.
  - AC-11.2 [ui] Given A lot has multiple saved weight measurements.; when A user opens its weight history.; then The screen displays the returned readings in date order as a time series, with controls to add, edit, and delete readings.
  - AC-11.3 [ui] Given A user edits or deletes a saved weight measurement.; when The API returns the updated measurement series, metrics, or a validation error.; then The screen displays the returned series and recalculated metric values, or displays the returned error and returned reading-list state without showing an invalid series as saved.
- **REQ-12** (ADDED) The responsive feedlot web app shall display returned lot feed-to-gain metrics using applicable headcounts at measurement dates and as-fed pounds for feed conversion, and refresh displayed metrics after feeding or weight events are saved, edited, or deleted.
  - AC-12.1 [ui] Given A lot has a receiving date, feeding events, and weight readings.; when A user opens the lot performance view.; then The screen displays returned days on feed, total weight gain, average daily gain, total feed consumed, feed conversion ratio, feed cost per pound of gain, and projected ship date.
  - AC-12.2 [ui] Given A lot's inventory units require conversion to pounds for feed-to-gain reporting.; when A user views performance metrics.; then The screen displays total feed consumed in as-fed pounds as the feed conversion ratio basis.
  - AC-12.3 [ui] Given The API returns total lot weight gain based on average-weight change and headcount applicable at the measurement dates.; when A user views lot performance.; then The screen displays the returned total gain and average daily gain values.
  - AC-12.4 [ui] Given A feeding or weight event is saved, edited, or deleted and the API returns updated metrics.; when A user returns to the affected lot's performance view.; then The screen displays the latest returned feed-to-gain metric values without a separate manual recalculation action.
  - AC-12.5 [ui] Given A lot's feed cost per pound of gain is displayed.; when A user views the metric label.; then The screen labels the value as feed cost per pound of gain and does not label it ROI or profitability.
- **REQ-13** (ADDED) ⚠ only one draft had this The responsive web app shall provide the public FeedToGainCalculator.calculate method to calculate days on feed, total lot gain, ADG, as-fed feed pounds, FCR, feed cost per pound of gain, and projected market date from supplied receiving, feeding, weight, headcount, and target-weight data.
  - AC-13.1 [unit] Given Calculator input contains receiving and as-of dates, entry and current average weights and applicable headcounts, feeding events with convertible units and costs, and a target weight.; when The public FeedToGainCalculator.calculate method is called.; then The returned fields contain days on feed as the date difference, total gain as current total lot weight minus entry total lot weight, ADG as total gain divided by days on feed, total feed as feeding quantities converted to as-fed pounds, FCR as feed pounds divided by total gain, cost of gain as feed cost divided by total gain, and projected market date using ADG or the configured default when ADG is unavailable.
- **REQ-14** (ADDED) The responsive feedlot web app shall provide lot- and pen-level dashboards showing returned operational and performance metrics, including best- and worst-performing lots.
  - AC-14.1 [ui] Given Dashboard data contains lot, pen, inventory, ration, feeding, weight, and performance data.; when A user opens the lot and pen dashboards.; then The screen displays active lot and pen counts, animals per lot and pen, inventory status, ration usage, daily bunk rate per pen, planned and actual feed, total feed consumed and cost, starting and current weight, total gain, ADG, FCR, feed cost per unit of gain, energy consumed, and best- and worst-performing lot values with the lots identified.
- **REQ-15** (ADDED) The responsive feedlot web app shall provide operational report screens comparing pen consumption, lot performance, ration usage, plan alignment, remaining inventory, and feed cost per unit of weight gain.
  - AC-15.1 [ui] Given The reports response contains pen and lot comparisons.; when A user opens an operational report.; then The screen displays returned rankings or values for pen feed consumption, lot feed conversion and average daily gain, ration usage, plan alignment, over- or underfeeding, remaining inventory, and feed cost per unit of weight gain.
- **REQ-16** (ADDED) The responsive feedlot web app shall provide a feed-to-gain report comparing lot ADG, FCR, and feed cost per pound of gain, with date-range, breed, sex, and pen filters, and use the date range to select the latest weight reading in range and feeding events up to that reading.
  - AC-16.1 [ui] Given The report response contains performance data for multiple lots.; when A user opens the feed-to-gain report and applies date-range, breed, sex, or pen filters.; then The screen displays the returned filtered lot list and ADG, FCR, and feed-cost-per-pound-of-gain values with the selected date range and filters.
  - AC-16.2 [ui] Given A user selects a valid date range, breed, sex, or pen filter.; when The user applies the filters.; then The screen displays the returned filtered lot list and metric values, with the report date range selecting the latest weight reading in range and feeding events up to that reading.
  - AC-16.3 [ui] Given The API refuses an invalid date range or unsupported filter value.; when A user applies the filter.; then The screen displays the returned error message.
- **REQ-17** (ADDED) The responsive feedlot web app shall let users export the filtered feed-to-gain report as a CSV file containing its displayed rows and metrics.
  - AC-17.1 [ui] Given The feed-to-gain report contains filtered lot results.; when A user selects CSV export.; then The browser downloads a CSV file containing the displayed filtered report rows and ADG, FCR, and feed-cost-per-pound-of-gain fields.
- **REQ-18** (ADDED) ⚠ only one draft had this The responsive feedlot web app shall provide a PDF export action for filtered feed-to-gain report results.
  - AC-18.1 [ui] Given The filtered feed-to-gain report is displayed.; when A user selects PDF export.; then A downloadable PDF file is produced containing the filtered report rows.
- **REQ-19** (ADDED) The responsive feedlot web app shall let users load a clearly labeled, separate demo dataset on demand and display added, already-present, and failed record outcomes without labeling a partial load complete.
  - AC-19.1 [ui] Given A sample dataset is available.; when A user opens the sample-data screen.; then The screen identifies the dataset as separate demo data and displays an on-demand load control.
  - AC-19.2 [ui] Given A sample-data load response reports added, already-present, and failed records, or reports that only some records loaded.; when A user reviews the load result.; then The screen displays separate counts and record details for added, already-present, and failed data, displays partial-load status where applicable, and does not label a partial load as complete.
- **REQ-20** (ADDED) The responsive feedlot web app shall provide a project and demo area presenting the proposed solution, architecture diagrams, an app demonstration, testing and validation overview, challenges, production-readiness assessment, and go-to-market analysis.
  - AC-20.1 [ui] Given Project-area content is available.; when A user opens the project and demo area.; then The page displays the proposed solution, architecture diagrams, app demonstration, testing and validation overview, challenges, production-readiness assessment, and go-to-market analysis.
- **REQ-21** (ADDED) The responsive feedlot web app shall expose the same product areas, operational records, cost and performance views, import screens, and data-entry controls to all users without role-dependent restrictions.
  - AC-21.1 [ui] Given Two users or user contexts open the product areas.; when They view operational records, cost and performance views, import screens, and data-entry screens.; then The screens display the same available views and operational controls for both users.

Not changing: Live procurement-system connector; procurement and receiving use supplied mock/source records only.; Yard-level aggregate dashboard stretch goal.; Low-stock or stockout alerts in inventory projections.; Prompt-history display in the project, demo, or solution overview area.; Authoritative server-side persistence, upstream connector implementation, duplicate-import and capacity enforcement, stock-decrement transactions, and authoritative metric recalculation; the web specification tests returned responses, user inputs, and responsive web-app displays.; Full lot ROI or profitability claims beyond feed cost per pound of gain.; Custom report builder.

## Files the plan will touch (16)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-10/container.tsx  ← not found by grounding; check it
- components/screens/s-11/container.tsx  ← not found by grounding; check it
- components/screens/s-12/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- components/screens/s-5/container.tsx  ← not found by grounding; check it
- components/screens/s-6/container.tsx  ← not found by grounding; check it
- components/screens/s-7/container.tsx  ← not found by grounding; check it
- components/screens/s-8/container.tsx  ← not found by grounding; check it
- components/screens/s-9/container.tsx  ← not found by grounding; check it
- lib/feed-to-gain-calculator.ts  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: OPTION-1 (chosen): Wire each generated screen container directly to the generated OpenAPI client, keeping local form state and browser-native export behavior in the screen slice. | OPTION-2: Add shared feature service/hooks and common data adapters before connecting each screen.
Decision: Decision: Use generated screen containers with direct calls to the generated OpenAPI client.
Rationale: The scaffold already supplies the responsive pages and shared frame; containers can wire each screen as a working slice.
Keep API-authoritative calculations and validation in returned responses, except the explicitly required public calculator utility.
Use browser-generated CSV/PDF exports and add no runtime dependencies.
- TASK-1 Design system and responsive app foundation → ; builds towards a later task (no criteria of its own)
- TASK-2 Wire the overview dashboard to live operational data → REQ-14; must pass AC-14.1
- TASK-3 Preview and synchronize supplied import records → REQ-1; must pass AC-1.1, AC-1.2
- TASK-4 Connect lot and pen records, mapping outcomes, and forecasts → REQ-2, REQ-3; must pass AC-2.1, AC-2.2, AC-2.3, AC-3.1, AC-3.2, AC-3.3
- TASK-5 Record feed inventory movements and actual wastage → REQ-4; must pass AC-4.1, AC-4.2
- TASK-6 Configure wastage ratio and show inventory projections → REQ-5; must pass AC-5.1
- TASK-7 Create, optimize, and select rations → REQ-6, REQ-7; must pass AC-6.1, AC-7.1, AC-7.2
- TASK-8 Generate and review dated feeding plans → REQ-8; must pass AC-8.1, AC-8.2, AC-8.3
- TASK-9 Record feeding activities and show returned use and outcomes → REQ-9, REQ-10; must pass AC-9.1, AC-9.2, AC-9.3, AC-10.1, AC-10.2
- TASK-10 Manage weight measurements and returned lot performance → REQ-11, REQ-12, REQ-13; must pass AC-11.1, AC-11.2, AC-11.3, AC-12.1, AC-12.2, AC-12.3, AC-12.4, AC-12.5, AC-13.1
- TASK-11 Load operational comparisons and summaries → REQ-15; must pass AC-15.1
- TASK-12 Filter and export feed-to-gain report results → REQ-16, REQ-17, REQ-18; must pass AC-16.1, AC-16.2, AC-16.3, AC-17.1, AC-18.1
- TASK-13 Present project information and load separate demo data → REQ-19, REQ-20, REQ-21; must pass AC-19.1, AC-19.2, AC-20.1, AC-21.1

Stub commit (throws NotImplemented until implemented): lib/feed-to-gain-calculator.ts

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /overview -> 200, 400, 500
- GET /imports/batches -> 200, 400, 500
- POST /imports/preview -> 200, 400, 404, 422
- POST /imports/synchronize -> 200, 400, 404, 409, 422
- GET /lots -> 200, 400, 500
- POST /lots/mappings -> 200, 400, 404, 409, 422
- PATCH /lots/{lotId}/assumptions -> 200, 400, 404, 422
- GET /lots/{lotId}/forecast -> 200, 400, 404, 500
- GET /inventory/items -> 200, 400, 500
- POST /inventory/movements -> 201, 400, 404, 409, 422
- POST /inventory/wastage -> 201, 400, 404, 409, 422
- PATCH /inventory/settings -> 200, 400, 422
- GET /inventory/outlook -> 200, 400, 422, 500
- GET /rations -> 200, 400, 500
- POST /rations -> 201, 400, 409, 422
- POST /rations/optimize -> 200, 400, 422
- POST /rations/selection -> 200, 400, 404, 422
- GET /feeding/plans -> 200, 400, 500
- POST /feeding/plans -> 201, 400, 404, 409, 422
- GET /feeding/activities -> 200, 400, 500
- POST /feeding/activities -> 201, 400, 404, 409, 422
- GET /lots/{lotId}/weight-readings -> 200, 400, 404, 500
- POST /lots/{lotId}/weight-readings -> 201, 400, 404, 422
- PUT /lots/{lotId}/weight-readings/{readingId} -> 200, 400, 404, 422
- DELETE /lots/{lotId}/weight-readings/{readingId} -> 200, 400, 404, 409
- GET /lots/{lotId}/performance -> 200, 400, 404, 500
- GET /reports/operations -> 200, 400, 422, 500
- GET /reports/feed-to-gain -> 200, 400, 422, 500
- GET /project-demo -> 200, 400, 500
- POST /demo-data/load -> 200, 400, 409, 422

## Critic findings (0)
_The critic was off for this run: pick a model for the critic step at the start to turn it on._

## Settled by questions, and open risks
- Spec question Q-9: Should all 21 requirements be approved for delivery in one run, or should the scope be rejected with requirements identified for removal? → Approve all 21 requirements as one run. (answered)

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

**This spec has 21 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261014-hackathon-problem-statement-fe-ae5c <hash> --note "your risk note"
  factory reject  20261014-hackathon-problem-statement-fe-ae5c <hash> --reason "why"

Card hash: ce8a8100