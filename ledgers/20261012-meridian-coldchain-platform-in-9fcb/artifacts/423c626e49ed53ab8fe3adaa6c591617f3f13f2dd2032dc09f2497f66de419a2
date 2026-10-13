# Questions before the spec (round 1)

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

**Q-1** How should users authenticate to the driver, staff, and customer areas?
  A. Use individual email-and-password accounts with self-service password reset.   ← recommended: This provides the requested sign-in with the fewest external dependencies; signing decisions can still require identity confirmation at signing.
  B. Use Meridian’s existing single sign-on for staff and a separate email-and-password login for customer users.
  C. Use Meridian’s existing single sign-on for all users, including customer users.
  (why it matters: Authentication determines who can access routes, regulated decisions, and organization-scoped customer records.)

**Q-2** Who can create, deactivate, and assign roles and access scopes to users, including a staff member’s warehouses and a customer user’s organisation?
  A. A System Administrator manages accounts, roles, warehouse access, and customer-organisation access.   ← recommended: This uses the named administrator role and makes the stated data-access boundaries manageable without adding another administration model.
  B. Each organisation manages its own users, while a System Administrator manages staff accounts and roles.
  C. Users and access scopes are provisioned by an external identity system; the app only consumes them.
  (why it matters: User and scope assignment directly determines who can see customer, warehouse, and regulated records.)

**Q-3** For a customer’s recall response, may reported on-hand, used/dispensed, and destroyed quantities total less than the quantity delivered, leaving a remainder unaccounted?
  A. Allow a smaller total; track the remainder as unaccounted until it is later accounted for or written off with a signed justification.   ← recommended: This preserves the request’s unaccounted-pack and signed-write-off path without blocking a customer from reporting what they currently know.
  B. Require the customer’s categories to total exactly the quantity delivered before accepting the response.
  C. Allow a smaller total, but require the customer to explain the remainder in the response.
  (why it matters: This determines how pack quantities are recorded and whether a recall can be considered fully accounted for.)

**Q-4** How long must the handover signature and delivery photo remain available?
  A. Retain them for seven years, matching the audit-record retention period.   ← recommended: This gives the captured delivery evidence a clear retention period consistent with the stated regulated-record retention.
  B. Retain them for the same period as the associated handover record, with that period to be set separately.
  C. Delete them after a shorter, specified period while retaining the handover details.
  (why it matters: Retention determines how long delivery evidence remains available for disputes and compliance review.)

**Q-5** What existing records, if any, must be brought into the new system at launch so lot tracing and recall quantities work from the start?
  A. Start with no imported records; enter opening lots and stock in the new app.   ← recommended: The request does not require historical migration, so entering the opening records avoids expanding the build while still enabling traceability from launch.
  B. Import opening lots, received quantities, current stock and customer records needed for traceability; leave other history out.
  C. Import full historical inventory, order, delivery, and temperature records.
  (why it matters: The choice determines what lot, receipt, and customer data exists for recall tracing and quantity reconciliation.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): When a new signed decision supersedes an earlier decision, should the new disposition automatically update the stock and its order/route state, including if it reverses the earlier disposition? → assumed: Apply the superseding decision to the stock and its order/route state, retaining the earlier decision and recording the resulting changes.
- ASM-2: Which period should the monthly report generated on the first day cover? → assumed: On-screen lists with filters and CSV export; no custom report builder.
- ASM-3: How should the more-than-four-hour decision escalation reach the Quality Manager? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-4: Which email service should deliver recall notices, 24-hour reminders, daily summaries, and monthly reports? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-5: Which browsers and browser versions must support the responsive web app, including offline driver work and photo/signature capture? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- ASM-6: What accessibility conformance level is required for the web app and generated customer certificates? → assumed: WCAG 2.1 AA on the main flows.
- ASM-7: What launch scale should the app support, particularly for the recall trace that must be available within one minute? → assumed: Up to 1,000 users and 100,000 records in the first year.

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 09014b83 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: 09014b83