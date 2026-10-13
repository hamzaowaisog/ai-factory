# Questions before the spec (round 2)

Run 20261012-meridian-coldchain-platform-in-9fcb. Your request:
> The driver sees today's route with its stops in order. Before leaving, the driver scans each shipper box
> onto the vehicle. The application warns about a box that belongs to another route or a box that is
> missing.
> 
> During the route the application shows the current temperature and status of each box and any alerts.
> 
> At a stop the driver scans the boxes for that stop. If a box holds stock that is On Hold, the application
> shows "Do not deliver" for that box and does not allow it to be handed over. For the remaining boxes,
> the driver records the receiver's name, captures their signature and a photo of the delivered boxes,
> and completes the handover. The time and location are recorded automatically.
> 
> A receiver may refuse all or part of a delivery. The driver records what was refused and a reason, and
> refused boxes return to the warehouse, where they are Quarantined.
> 
> Everything above shall work without a connection. Work done offline is sent when the connection
> returns. If the route was changed while the driver was offline, the driver is shown the difference before
> continuing, and a handover already completed offline is never lost or undone.
> 
> Acceptance Criteria
> 
> ● The driver sees only their own routes.
> ● Loading requires every box on the route to be scanned, and a wrong or missing box is reported.
> ● A box with stock On Hold cannot be handed over, and the driver sees the reason.
> ● A handover records receiver name, signature, photo, time and location.
> ● A partial or full refusal can be recorded with a reason per box.
> ● Loading, handover and refusal work without a connection and are sent automatically later.
> ● A handover recorded offline keeps the time it actually happened, not the time it was sent.
> ● If a hold was placed on a box while the driver was offline and the box was handed over, the
> handover is kept, the conflict is flagged and a quality case is opened.
> ● The same handover sent twice is recorded once.
> ● The dispatcher sees each stop's status and the time it was last updated.
> 
> US-010: Decide What Happens to Affected Stock
> 
> User Story
> 
> As a Quality Manager, I want every excursion to end in a recorded, signed decision so that no
> affected product reaches a patient without a responsible person approving it.
> 
> Description
> 
> Every excursion requires a decision for each affected handling unit: Release or Reject.
> 
> The system shows the reviewer the full temperature history, the budget used and remaining per tier,
> and a recommendation: Release when every tier still has allowance left, Reject when any tier is used
> up or a not-permitted range was reached.
> 
> ● If the excursion stayed within the first tier above or below the band and allowance remains, a
> Quality Officer may decide alone.
> ● In every other case, a Quality Officer proposes and a Quality Manager approves. The two shall be
> different people.
> ● A decision that goes against the system's recommendation always needs both, and a written
> justification.
> 
> Each decision is signed electronically: the person confirms their identity again at the moment of
> signing and gives a reason. A signed decision cannot be edited. It can only be superseded by a new
> signed decision, and both remain on record.
> 
> Rejected stock is removed from available stock and listed for destruction. Destruction is recorded
> with a date, a quantity and a witness.
> 
> Acceptance Criteria
> 
> ● Stock that is On Hold cannot be allocated, packed, loaded or handed over.
> ● The reviewer sees the history, the budget per tier and the system's recommendation.
> ● A single-person decision is allowed only in the case described above.
> ● The person who proposes a decision cannot approve it, even if they hold both roles.
> ● Signing requires the person to confirm their identity again and enter a reason.
> ● A signed decision cannot be changed or deleted by anyone, including a System Administrator.
> ● Releasing stock returns it to where it was: available, or back on its order and route.
> ● Rejecting stock removes it from its order, and the order is reallocated under US-005.
> ● Decisions waiting longer than 4 hours are escalated to the Quality Manager.
> ● Destroyed quantities can never exceed rejected quantities.
> 
> US-011: Recall a Lot
> 
> User Story
> 
> As a Quality Manager, I want to recall a lot and see every unit accounted for so that no recalled
> product stays in use.
> 
> Description
> 
> A Quality Manager starts a recall for a product and one or more lot numbers, with a reason and a
> severity.
> 
> Starting a recall immediately:
> 
> ● Sets all stock of those lots that Meridian holds, in any warehouse, to Recalled.
> ● Removes it from every order and stops it being handed over, including boxes already on a van.
> ● Lists every customer who received any of those lots, with quantities, delivery dates and receivers.
> ● Notifies those customers by email and in the customer portal.
> 
> The trace from lot to every location and customer shall be available within one minute of the request.
> 
> Each affected customer responds in the portal with, for each delivery, how many packs are still on
> hand, how many were used or dispensed, and how many were destroyed on site. Packs on hand are
> collected on a return route and Quarantined on arrival.
> 
> A recall can be closed only when every pack of the lot is accounted for: held by Meridian, returned,
> reported used, reported destroyed, or written off as unaccounted with a signed justification.
> 
> Acceptance Criteria
> 
> ● Only a Quality Manager can start or close a recall, and both actions are signed.
> ● Recalled stock is blocked across all warehouses at once, including stock that is packed or on a
> route.
> ● A driver on a route sees "Do not deliver" for a recalled box as soon as the device is online.
> ● The trace lists every warehouse location, box, route and customer delivery for the lot, with
> quantities.
> ● The quantities in the trace add up exactly to the total quantity received for the lot.
> ● Customers are notified and can respond per delivery.
> ● A customer's reported quantities cannot exceed what was delivered to them.
> ● Customers who have not responded within 24 hours are reminded, and the Quality Manager sees
> who is outstanding.
> ● Recall progress shows the percentage of packs accounted for.
> ● A recall cannot be closed while any pack is unaccounted for without a signed write-off.
> 
> US-012: Follow Orders in the Customer Portal
> 
> User Story
> 
> As a Customer User, I want to follow my deliveries and download proof of their condition so that
> I can accept stock with confidence.
> 
> Description
> 
> The customer portal shows the organisation's orders, their status, the lots and expiry dates allocated,
> and for deliveries on the road the planned arrival time and whether the temperature is in range.
> 
> After delivery, the customer can download a delivery certificate as a PDF for each delivery. The
> certificate shows the products, lots, expiry dates and quantities, the receiver and time of handover,
> the temperature chart for each box from sealing to handover, any excursions and the signed decisions
> on them.
> 
> The portal and the certificate are available in English and Arabic according to the user's preference.
> 
> Acceptance Criteria
> 
> ● A customer sees current and past orders of their own organisation only.
> ● A delivery on the road shows its planned arrival time and an in-range or out-of-range status,
> without revealing other customers on the route.
> ● A delivery certificate can be downloaded for every completed delivery.
> ● The certificate contains the contents by lot, the handover details, the temperature chart, and any
> excursions with their decisions.
> ● A certificate issued once does not change. If late readings alter the history, a new version is
> issued and both remain available.
> ● All dates and times are shown in the customer's own time zone.
> ● Switching to Arabic turns the whole portal right to left, including tables, charts and the certificate.
> 
> US-013: Audit Trail
> 
> User Story
> 
> As an Auditor, I want a complete, unalterable record of who did what and when so that Meridian
> can demonstrate compliance during an inspection.
> 
> Description
> 
> The system shall record every creation, change and deletion of regulated data: products and profiles,
> stock, orders and allocations, boxes and routes, handovers, excursions, decisions, recalls, users and
> roles, and configuration.
> 
> Each entry records who, when, what was changed, the old and new values, and the reason where one
> was given. Actions taken by the system itself, such as automatic holds and allocations, are recorded
> as such.
> 
> Audit entries cannot be edited or deleted by anyone. It shall be possible to demonstrate that the trail
> has not been altered.
> 
> All times are stored in a single reference time and shown in the viewer's time zone. Karachi and
> Lahore share one time zone and Dubai is in another.
> 
> Records shall be kept for 7 years.
> 
> Acceptance Criteria
> 
> ● Every change to regulated data produces an audit entry with who, when, old value, new value and
> reason.
> ● Automatic actions are recorded and attributed to the system.
> ● No user, including a System Administrator, can edit or delete an audit entry.
> ● An alteration made to the audit trail outside the application can be detected.
> ● The audit trail can be filtered by record, user, date range and type of action.
> ● An Auditor can export any filtered view.
> ● The full history of one lot, from receipt to delivery or destruction, can be viewed in one place in
> time order.
> 
> US-014: Reports and Scheduled Summaries
> 
> User Story
> 
> As a Quality Manager, I want regular reports on excursions, wastage and delivery performance so
> that I can find and fix weak points in the cold chain.
> 
> Description
> 
> A daily summary shall be emailed at 07:00 warehouse time to the Quality Officers of each warehouse,
> listing excursions in the last 24 hours, decisions still waiting, silent devices and stock On Hold.
> 
> A monthly report shall be generated on the first day of each month and emailed to configured
> stakeholders. It should include, at a minimum:
> 
> ● Number and rate of excursions by route, driver, vehicle and shipper box type.
> ● Packs rejected and destroyed, by product and by cause.
> ● Deliveries on time and in full, as a percentage.
> ● Average time from excursion to decision.
> ● Stock within 60 days of expiry, by product and warehouse.
> ● Open recalls and their progress.
> 
> The same figures shall be available on screen for any date range, filterable by warehouse.
> 
> Acceptance Criteria
> 
> ● The daily summary is sent at 07:00 in each warehouse's own time zone.
> ● The monthly report is generated automatically on the first day of the month and emailed to the
> configured stakeholders.
> ● Report figures match the underlying records for the same period.
> ● A delivery counts as on time when handed over within 60 minutes of its planned arrival, and as in
> full when every ordered pack was handed over.
> ● Reports can be viewed on screen for any date range and exported.
> ● A staff member sees report figures only for their own warehouses.
> 
> Out of Scope for Phase 1
> 
> ● Pricing, invoicing and payments. These remain in Meridian's accounting system.
> ● Working out the best order of stops on a route.
> ● Purchasing from manufacturers and forecasting demand.
> ● Automatic penalties for drivers or customers.
> ● Transfers of stock between warehouses.
> ● The logger hardware and the supplier's gateway, which already exist.

**Q-6** Who is authorized to sign a write-off of unaccounted recall quantities?
  A. A Quality Manager.   ← recommended: This assigns the consequential recall write-off to the role already given authority to start and close recalls.
  B. A Quality Officer.
  C. A Quality Officer proposes it and a different Quality Manager approves it.
  (why it matters: Write-off authorization changes who can close the accounting gap for recalled stock.)

**Q-7** For a partial refusal, can the receiver refuse a quantity within a shipper box, or only accept/refuse whole boxes?
  A. Record acceptance or refusal only for whole boxes, with a reason for each refused box.   ← recommended: Whole-box outcomes satisfy the stated per-box refusal requirement without adding partial-box stock handling.
  B. Record accepted and refused pack quantities within a box, with a reason for each refused quantity.
  C. Allow either whole-box or pack-quantity refusal.
  (why it matters: This changes how stock quantities, returned boxes, and order fulfillment are recorded.)

**Q-8** What tier limits, allowance budgets, and permitted temperature ranges should drive excursion recommendations, and are they shared or product-specific?
  A. Use one configured set of tier limits and allowances for all products.   ← recommended: A shared configured rule set is the smallest way to provide the decision calculation the request requires.
  B. Use configured limits and allowances on each product profile.
  C. Use fixed values specified separately for each excursion decision.
  (why it matters: These values determine release or rejection decisions and therefore whether stock is available.)

Assumed unless you say otherwise:
- ASM-8 (high risk, confirm on the approval card): If a route box is missing or a scanned box belongs to another route, can the driver complete loading and depart, or must the discrepancy be resolved first? → assumed: Block departure until every expected box is scanned and every wrong box is removed or corrected.
- ASM-9 (high risk, confirm on the approval card): When a route changes while the driver is offline, how should unsent loading or refusal work that no longer matches the route be reconciled? → assumed: Keep the unsent work and require the driver to review differences and resolve affected boxes before continuing; preserve completed handovers.
- ASM-10 (high risk, confirm on the approval card): If a recall is started while a driver is offline and the driver completes a handover before reconnecting, should that completed handover be retained as an exception or treated as blocked? → assumed: Retain the actual handover, flag the recall conflict, and open a quality case when it syncs.
- ASM-11: If browser location access is denied or unavailable at handover, can the driver still complete the handover? → assumed: Allow completion and record that location was unavailable.
- ASM-12 (high risk, confirm on the approval card): How will the existing logger and supplier gateway provide live temperatures, alert status, box association, and temperature history to the web app? → assumed: Use an existing gateway API or feed supplied by Meridian.
- ASM-13: What identity check must a user repeat when signing a quality decision? → assumed: Confirm identity using whichever sign-in method the account uses.
- ASM-14: How should a decision waiting more than four hours be escalated to the Quality Manager? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-15: For customers who have not responded within 24 hours of a recall notice, what reminder schedule and channel should be used? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-16: Which time zone should the customer portal use when the user's own time zone has not been set? → assumed: Use the time zone configured on the user's account.
- ASM-17: Which desktop and mobile browsers and versions must the responsive web app support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-18: What accessibility conformance level is required for the web app? → assumed: WCAG 2.1 AA on the main flows.

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 2dc843c0 Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 2dc843c0