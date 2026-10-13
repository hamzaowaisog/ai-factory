# Approval: Replace the current manual processes with a single platform covering s

Run 20261012-meridian-coldchain-platform-in-9fcb · risk **high** · feature · size L · cost so far $3.62

## Your request (word for word, from cold-chain-distribution-requirements.md)
> Meridian ColdChain Platform
> 
> Introduction
> 
> Meridian Healthcare Distribution supplies vaccines, insulin, biologics and other temperature-sensitive
> medicines to around 400 hospitals, pharmacies and clinics. Stock is held in three warehouses (Karachi,
> Lahore and Dubai) and delivered by Meridian's own vans in insulated shipper boxes.
> 
> Every one of these products has a storage temperature band, for example 2 °C to 8 °C. A product that
> spends too long outside its band may lose potency without any visible sign. Regulators require Meridian
> to prove, for every unit it hands over, that the product stayed within its permitted conditions from the
> moment Meridian received it until the customer signed for it.
> 
> Today this proof is assembled by hand. Cold rooms are checked on paper twice a day. Each shipper box
> carries a data logger that is plugged into a computer after the van returns. Stock is tracked in
> spreadsheets per warehouse. Delivery notes are signed on paper.
> 
> Meridian plans to replace this with a single platform covering stock, orders, deliveries, live temperature
> monitoring, quality decisions and recalls.
> 
> Problem Statement
> 
> The current process does not tell anyone that a product is at risk until it is too late to act.
> 
> As a result:
> 
> ● A temperature problem in a van is discovered hours after the product has been handed to the
> customer.
> ● Quality staff cannot tell how much time outside its band a product has already used up, so they
> either write off good stock or release stock on judgement alone.
> ● Stock nearest its expiry date is not reliably sent out first, and customers receive product with too
> little shelf life left.
> ● Two people working from different copies of a spreadsheet promise the same stock to two
> customers.
> ● When a manufacturer recalls a lot, finding every customer who received it takes two to three days.
> ● Records can be changed after the fact, and an inspector cannot be shown who decided what and
> when.
> ● Drivers lose mobile signal in basements, hospital loading bays and on long routes, so anything that
> depends on a live connection fails exactly where it is needed.
> 
> Solution Overview
> 
> The proposed solution will consist of:
> 
> ● A web portal for warehouse staff, dispatchers, quality staff, administrators and auditors.
> ● A customer portal for hospitals, pharmacies and clinics.
> ● A driver mobile application for iOS and Android that keeps working without a connection.
> ● A service that receives temperature readings from data loggers and cold-room sensors.
> ● A centralized backend system holding one shared record of stock, orders and temperature history.
> 
> Meridian staff will sign in with their Meridian Microsoft account. Customer users are invited by their
> own organisation and see only their own organisation's orders and deliveries.
> 
> Each product has a temperature profile: its storage band and a stability budget, which is the total time
> the product is allowed to spend outside the band over its whole life, split by how far outside it went.
> The system keeps a running account of the budget each handling unit has used, from receipt to delivery.
> 
> Stock is received in lots. Customers order by product and quantity. The system decides which lots to
> send, earliest expiry first. Picked stock is packed into shipper boxes, each with a data logger, and the
> boxes are loaded onto a route.
> 
> Loggers report a reading every 5 minutes. When a reading falls outside the band, the system opens an
> excursion, charges the time against the budget of everything in that box, and alerts the driver, the
> dispatcher and quality staff. Affected stock cannot be handed over until quality staff have decided
> what happens to it.
> 
> When a lot is recalled, the system shows where every unit of it is or went, blocks what Meridian still
> holds, and tracks each customer's response until every unit is accounted for.
> 
> The portals shall be available in English and Arabic. Arabic is shown right to left.
> 
> User Roles
> 
> Warehouse Operator
> 
> Receives stock, puts it away, picks and packs orders into shipper boxes.
> 
> Dispatcher
> 
> Plans routes, assigns drivers and vehicles, and follows deliveries during the day.
> 
> Driver
> 
> Loads shipper boxes, drives the route and hands over deliveries using the mobile application.
> 
> Quality Officer
> 
> Reviews excursions and proposes what happens to affected stock.
> 
> Quality Manager
> 
> Approves quality decisions and starts and closes recalls. Legally responsible for released stock.
> 
> Customer User
> 
> A member of staff at a hospital, pharmacy or clinic who places orders and follows deliveries.
> 
> Customer Administrator
> 
> A customer user who can also invite and remove users for their own organisation.
> 
> System Administrator
> 
> Manages staff accounts, warehouses, vehicles, shipper box types, products and system configuration.
> 
> Auditor
> 
> An internal or external inspector with read-only access to all records and the audit trail.
> 
> User Stories
> 
> US-001: Sign In and Access Control
> 
> User Story
> 
> As a user, I want to sign in securely and see only what my role and organisation allow so that
> regulated records are protected.
> 
> Description
> 
> Meridian staff shall sign in with their Meridian Microsoft account. Accounts from other organisations
> shall not be accepted for staff roles.
> 
> Customer users shall sign in with an email address and password and a second step using a one-time
> code. A customer user belongs to exactly one customer organisation.
> 
> Drivers use the same Meridian account on the mobile application. Once signed in, the application shall
> remain usable for the working day without a connection.
> 
> A staff member may hold more than one role. Each staff member belongs to one or more warehouses
> and sees only stock, orders and routes of those warehouses. Quality Managers and Auditors see all
> warehouses.
> 
> Acceptance Criteria
> 
> ● Staff can sign in only with a Meridian Microsoft account.
> ● Customer users can sign in only after completing the second step.
> ● A customer user never sees another organisation's orders, deliveries or documents.
> ● A staff member sees only the warehouses they are assigned to.
> ● A Customer Administrator can invite and remove users of their own organisation only.
> ● A removed or disabled user loses access immediately, including on a mobile device that is online.
> ● A signed-in driver can open and work today's route without a connection.
> ● An Auditor cannot create, change or delete any record.
> 
> US-002: Products and Temperature Profiles
> 
> User Story
> 
> As a System Administrator, I want to define each product's temperature profile so that the system
> can judge every reading against the right limits.
> 
> Description
> 
> A product has a name, a code, a pack size and a temperature profile.
> 
> A temperature profile consists of a storage band and a stability budget. The budget is expressed as
> tiers. For example, for a 2 °C to 8 °C product:
> 
> ● Above 8 °C up to 15 °C: 12 hours in total.
> ● Above 15 °C up to 25 °C: 2 hours in total.
> ● Above 25 °C: not permitted.
> ● Below 2 °C down to 0 °C: 4 hours in total.
> ● Below 0 °C: not permitted.
> 
> Time spent in a tier counts against that tier's allowance. A reading in a not-permitted range means the
> product cannot be released by anyone other than through the full two-person decision in US-010.
> 
> Profiles are versioned. Changing a profile requires a reason and takes effect from a stated date. Earlier
> versions remain viewable.
> 
> Acceptance Criteria
> 
> ● A product cannot be saved without a temperature profile.
> ● Tiers must not overlap and must leave no gap between the band and the not-permitted ranges.
> ● Each tier has an allowance in hours and minutes, or is marked not permitted.
> ● A profile change creates a new version with a reason, an effective date and the person who made
> it.
> ● Earlier versions of a profile can be viewed but not changed.
> ● Products can be listed, searched by name or code, and deactivated. A deactivated product cannot
> be ordered.
> 
> US-003: Receive Stock
> 
> User Story
> 
> As a Warehouse Operator, I want to receive incoming stock by lot so that every unit is traceable
> from the moment it arrives.
> 
> Description
> 
> Stock arrives from manufacturers in lots. For each receipt the operator records the product, lot number,
> expiry date, quantity, supplier and the cold room and shelf where it is stored.
> 
> The manufacturer's shipment arrives with its own logger. The operator uploads the logger's file, and
> the system charges any time outside the band during the inbound journey against the lot's budget.
> 
> All received stock starts as Quarantined. A Quality Officer reviews the receipt and releases it, after
> which it is available to be allocated to orders. Stock within 30 days of expiry on arrival cannot be
> released.
> 
> A lot can be in these statuses: Quarantined, Released, On Hold, Rejected, Recalled, Expired. Stock
> becomes Expired automatically at the end of its expiry date.
> 
> Acceptance Criteria
> 
> ● A receipt records product, lot number, expiry date, quantity, supplier and storage location.
> ● The same lot number for the same product can be received more than once, and the receipts are
> tracked separately but reported together.
> ● Received stock is Quarantined until released by a Quality Officer.
> ● The inbound logger file can be uploaded, and the budget used on the inbound journey is shown
> before the release decision.
> ● Stock with an expiry date in the past cannot be received.
> ● Stock within 30 days of expiry on arrival cannot be released.
> ● Only Released stock can be allocated to an order.
> ● Stock becomes Expired automatically and is removed from any allocation it was part of, and the
> dispatcher is told.
> ● Moving stock between shelves or cold rooms is recorded with who, when, from and to.
> 
> US-004: Place an Order
> 
> User Story
> 
> As a Customer User, I want to order products for a delivery date so that my site receives what it
> needs on time.
> 
> Description
> 
> A customer user places an order made of one or more lines. Each line is a product and a quantity in
> packs. The order has a delivery address, chosen from the organisation's saved addresses, and a
> requested delivery date.
> 
> Orders placed before the cut-off time (default 14:00, configurable per warehouse) can be delivered the
> next working day. Orders placed after the cut-off are delivered no earlier than the working day after
> that. Working days and public holidays are configured per warehouse.
> 
> Each customer organisation is served by one warehouse and has a minimum remaining shelf life (for
> example 90 days) that any delivered product must have on the delivery date. The customer chooses
> per order whether a short order may be delivered in part or must be delivered complete.
> 
> An order moves through: Submitted, Allocated, Partly Allocated, Packed, Out for Delivery, Delivered,
> Partly Delivered, Cancelled. A customer can cancel or change an order until packing begins.
> 
> Acceptance Criteria
> 
> ● An order has at least one line, and each line has a quantity of at least 1 pack.
> ● The earliest selectable delivery date follows the cut-off time, working days and holidays of the
> serving warehouse.
> ● The customer chooses between "deliver what is available" and "deliver complete only".
> ● The customer sees the order status and each line's allocated and outstanding quantity.
> ● An order can be changed or cancelled by the customer until it is Packed. After that, only a
> dispatcher can cancel it.
> ● Cancelling an order returns its allocated stock to available stock.
> ● Submitting the same order twice by mistake, for example by a double tap, creates one order.
> 
> US-005: Allocate Stock to Orders
> 
> User Story
> 
> As a Dispatcher, I want the system to choose which lots fulfil each order so that the oldest suitable
> stock goes out first and nothing is promised twice.
> 
> Description
> 
> When an order is submitted, the system allocates stock to each line from the serving warehouse.
> 
> Allocation rules:
> 
> ● Only Released stock is used.
> ● The lot with the earliest expiry date is used first.
> ● A lot is skipped for a customer if, on the requested delivery date, it would have less than that
> customer's minimum remaining shelf life.
> ● Between two lots with the same expiry date, the one with more of its stability budget used is sent
> first.
> ● A line may be fulfilled from more than one lot.
> ● Stock is never allocated beyond what is physically available.
> 
> If a line cannot be fully allocated, an order marked "deliver what is available" is Partly Allocated and the
> remainder waits as a back order, which is filled automatically, oldest order first, when suitable stock is
> released. An order marked "deliver complete only" holds no stock until every line can be fully allocated.
> 
> A dispatcher may override the system's choice of lot for a line, with a reason. An override may not
> break the Released-only rule or the customer's minimum shelf life.
> 
> Acceptance Criteria
> 
> ● Allocation follows earliest-expiry-first within the rules above.
> ● No unit of stock is ever allocated to two orders, including when many orders are submitted at the
> same moment.
> ● A line can be split across lots, and the split is visible on the order.
> ● A "deliver complete only" order holds no stock until it can be fully allocated.
> ● Back orders are filled automatically in the order they were submitted when stock becomes available.
> ● A dispatcher override requires a reason and is refused if it breaks the Released-only rule or the
> minimum shelf life.
> ● When allocated stock is put On Hold, Rejected, Recalled or Expired, it is removed from the order,
> the system tries to allocate replacement stock, and the dispatcher is told the outcome.
> ● Available, allocated and quarantined quantities per product, lot and warehouse can be viewed at
> any time and always add up to the quantity on hand.
> 
> US-006: Pack Shipper Boxes and Plan Routes
> 
> User Story
> 
> As a Dispatcher, I want to pack orders into shipper boxes and place them on routes so that every
> box can keep its contents in range for the whole journey.
> 
> Description
> 
> A Warehouse Operator picks the allocated lots and packs them into shipper boxes. Each box has a
> type, and each type has a temperature range it is built for and a qualified duration (for example 48
> hours) for which it holds that range once sealed. Each packed box is given one data logger by scanning
> the logger's barcode. A box holds stock for one delivery stop only, but may hold several products and
> lots, provided all of them share the same storage band.
> 
> A dispatcher creates a route for a date with a vehicle, a driver and an ordered list of stops. Each stop
> has a planned arrival time entered by the dispatcher. The system does not work out the best order of
> stops.
> 
> A route cannot be confirmed if any box on it would reach its stop later than its qualified duration, less
> a safety margin (default 4 hours, configurable), counted from the moment the box was sealed.
> 
> Acceptance Criteria
> 
> ● A box cannot be sealed without exactly one logger, and a logger cannot be in two open boxes at
> once.
> ● A box cannot be packed with products whose storage bands differ, or with a product whose band
> the box type is not built for.
> ● Sealing a box records the time, the operator, the contents by lot and quantity, and the logger.
> ● A route has one vehicle, one driver, a date and at least one stop.
> ● A driver or vehicle cannot be on two routes whose times overlap.
> ● A route is refused confirmation if a box would exceed its qualified duration less the safety margin
> at its planned arrival, and the screen says which box and by how much.
> ● A dispatcher can move a stop to another route or reorder stops until the driver has left for that
> stop.
> ● The driver is told of any change to a route that has already been confirmed.
> 
> US-007: Receive Temperature Readings
> 
> User Story
> 
> As a Quality Officer, I want every reading from every logger and cold-room sensor stored reliably
> so that the temperature history of any unit is complete and trustworthy.
> 
> Description
> 
> Loggers in shipper boxes and fixed sensors in cold rooms take a reading every 5 minutes. Readings
> reach the system through the logger supplier's gateway, which sends them in batches. Each reading
> carries the device identifier, the time the reading was taken and the temperature.
> 
> The mobile network is not reliable. Readings may arrive minutes or hours late, in the wrong order, more
> than once, or in one large batch when a van comes back into coverage. The system shall produce the
> same temperature history regardless of the order in which readings arrive.
> 
> A device that has sent nothing for 15 minutes is treated as silent. A silent logger in a box that is out for
> delivery raises an alert. Time with no readings is shown as a gap in the history and is not assumed to
> be in range.
> 
> The system shall be sized for 5,000 devices reporting at once.
> 
> Acceptance Criteria
> 
> ● Readings are accepted only from the supplier's gateway and only for known devices.
> ● A reading received twice is stored once.
> ● Readings that arrive late or out of order are placed at the time they were taken, and everything
> calculated from them is brought up to date.
> ● A reading with a time in the future, or from before the box was sealed, is kept but marked and not
> used in calculations.
> ● A device with no reading for 15 minutes is shown as silent, and an alert is raised if its box is out for
> delivery.
> ● Gaps are visible in the temperature history as gaps.
> ● The temperature history of any box, cold room or lot can be viewed as a chart and as a table, with
> the band and the excursions marked.
> 
> US-008: Detect Excursions and Track the Stability Budget
> 
> User Story
> 
> As a Quality Officer, I want the system to detect excursions and keep each unit's remaining budget
> up to date so that I know immediately which stock is at risk and by how much.
> 
> Description
> 
> An excursion opens when a reading from a box or cold room is outside the band of a product stored
> in it. It closes when three readings in a row are back inside the band. The duration of the excursion is
> charged, tier by tier, against the stability budget of every handling unit that was in that box or cold
> room at the time.
> 
> The budget is tracked per handling unit, not per lot: two parts of the same lot that travelled in different
> boxes have different histories. The budget used in the manufacturer's inbound journey, in the cold
> room and in every box is added together.
> 
> When an excursion opens, the driver (if the box is on a route), the dispatcher and the Quality Officers
> of the warehouse are alerted within 2 minutes of the reading being received. A further alert is sent
> when the remaining allowance in any tier falls below 25%, and again when a tier is used up or a
> not-permitted range is reached.
> 
> All stock affected by an open or undecided excursion is placed On Hold automatically.
> 
> Because readings can arrive late, an excursion may be discovered, lengthened, shortened or removed
> after the event. Budgets, holds and alerts shall follow the corrected history.
> 
> Acceptance Criteria
> 
> ● An excursion opens on the first reading outside the band and closes after three consecutive
> readings inside it.
> ● Excursion time is charged to the correct tier, and a single excursion that passes through several
> tiers is charged to each for the time spent in it.
> ● The budget used and remaining per tier is shown for every handling unit, with the excursions that
> consumed it.
> ● Parts of one lot with different histories show different budgets.
> ● Alerts reach the driver, dispatcher and Quality Officers within 2 minutes of the reading being
> received.
> ● Stock affected by an excursion is On Hold until a decision is made under US-010.
> ● Late readings that change an excursion update the budget, the holds and the excursion record,
> and the change is recorded in the audit trail.
> ● A late reading that reveals an excursion on stock already delivered opens a case for quality review
> and is shown to the customer.
> 
> US-009: Deliver with the Driver Application
> 
> User Story
> 
> As a Driver, I want to load, drive and hand over my deliveries from my phone, with or without
> signal, so that every handover is recorded properly.
> 
> Description
> 
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


## Your answers
- Q-1 What must the full two-person quality decision for stock exposed to a not-permitted temperature range require? → **A Quality Officer proposes the disposition and a different Quality Manager approves it; neither person can perform both steps.**
- Q-2 When an excursion opens, how quickly must affected stock be placed On Hold relative to the alert deadline? → **Place it On Hold as soon as the excursion is detected; the two-minute deadline applies to alerts.**
- Q-3 What customer evidence must the driver record for a delivery handover? → **Record the recipient's name and an explicit electronic acknowledgment of receipt; a drawn signature is not required.**
- Q-4 What should happen to quantities that are not handed over because a delivery is refused or only partly completed? → **Keep undelivered quantities outstanding; record the reason and return them to available stock only after warehouse receipt and any required quality checks.**
- Q-5 What constitutes a handling unit for tracking stability budgets when a received quantity is split, moved, or packed into different boxes? → **Track quantities as handling units and split the record whenever portions acquire different temperature histories.**
- Q-6 How should users authenticate to the driver, staff, and customer areas? → **Use individual email-and-password accounts with self-service password reset.**
- Q-7 Who can create, deactivate, and assign roles and access scopes to users, including a staff member’s warehouses and a customer user’s organisation? → **A System Administrator manages accounts, roles, warehouse access, and customer-organisation access.**
- Q-8 For a customer’s recall response, may reported on-hand, used/dispensed, and destroyed quantities total less than the quantity delivered, leaving a remainder unaccounted? → **Allow a smaller total; track the remainder as unaccounted until it is later accounted for or written off with a signed justification.**
- Q-9 How long must the handover signature and delivery photo remain available? → **Retain them for seven years, matching the audit-record retention period.**
- Q-10 What existing records, if any, must be brought into the new system at launch so lot tracing and recall quantities work from the start? → **Start with no imported records; enter opening lots and stock in the new app.**
- Q-1 Who may maintain a customer organisation's saved delivery addresses and minimum remaining shelf-life requirement? → **Customer Administrators maintain their organisation's addresses; System Administrators set its minimum shelf life.**
- Q-2 How should the stock quantity breakdown reconcile with quantity on hand, given that stock can also be On Hold, Rejected, Recalled or Expired? → **Treat on-hand as the total and show a mutually exclusive breakdown that includes available, allocated, quarantined and the other stock statuses.**
- Q-3 When a product profile changes with an effective date, how should the new profile affect stock already received and its temperature-budget history? → **Apply the new version to stock still held from its effective date onward and recalculate affected budgets and decisions from that date.**
- Q-4 Who is authorized to sign a write-off of unaccounted recall quantities? → **A Quality Manager.**
- Q-5 For a partial refusal, can the receiver refuse a quantity within a shipper box, or only accept/refuse whole boxes? → **Record acceptance or refusal only for whole boxes, with a reason for each refused box.**
- Q-6 What tier limits, allowance budgets, and permitted temperature ranges should drive excursion recommendations, and are they shared or product-specific? → **Use one configured set of tier limits and allowances for all products.**

## Confirm these assumptions (high risk)
- [ ] ASM-1 If a driver records actions offline and their account is disabled or removed before synchronization, should those queued actions be accepted into the shared record? → assumed: No; online only.
- [ ] ASM-2 How should a temperature-history gap affect stock status and stability-budget calculations? → assumed: Mark exposure as unknown, do not charge a specific temperature tier without a reading, and flag the affected stock for quality review without automatically placing it On Hold.
- [ ] ASM-4 Are the numeric rules not explicitly marked configurable fixed policy values, or should administrators be able to change them? → assumed: Keep the stated values fixed: 15-minute silence, two-minute alert target, 25% remaining-budget alert, three consecutive in-band readings, and 30-day expiry restriction.
- [ ] ASM-5 Who sets and maintains each customer's minimum remaining shelf-life requirement? → assumed: A System Administrator sets one value per customer organisation; dispatchers and customers cannot change it per order.
- [ ] ASM-7 What existing spreadsheet and operational data should be brought into the new platform at go-live? → assumed: No; the system starts empty, with seed data for set-up.
- [ ] ASM-11 What history must the audit trail preserve when a regulated record is changed or corrected? → assumed: Who created and last changed each record, and when; no full audit trail.
- [ ] ASM-15 What customer response and evidence are required before a recalled quantity counts as accounted for? → assumed: Record the customer's response, quantity, and stated disposition for each affected delivery; accept the response as accounted for without requiring supporting documents.
- [ ] ASM-17 When a new signed decision supersedes an earlier decision, should the new disposition automatically update the stock and its order/route state, including if it reverses the earlier disposition? → assumed: Apply the superseding decision to the stock and its order/route state, retaining the earlier decision and recording the resulting changes.
- [ ] ASM-1 If a driver records actions offline and their account is disabled before those actions synchronize, what should happen to the queued actions? → assumed: No; online only.
- [ ] ASM-2 When a logger or sensor has a gap in readings, how should the unknown interval affect stability budgets and stock disposition? → assumed: Do not charge an assumed temperature tier automatically; flag the gap for quality review and keep affected stock On Hold until resolved.
- [ ] ASM-3 What customer response is sufficient to account for recalled units at each organisation? → assumed: Require a quantity reconciliation for the lot, with each quantity recorded as located, used, returned, disposed of or otherwise accounted for.
- [ ] ASM-4 What existing information from the paper records and spreadsheets must be brought into the new platform? → assumed: No; the system starts empty, with seed data for set-up.
- [ ] ASM-5 Which logger supplier gateway and integration interface must provide the live readings, and what inbound logger-file format must the receipt workflow accept? → assumed: Use Meridian's existing supplier gateway and its documented interface; accept that supplier's documented inbound logger export format.
- [ ] ASM-8 What audit history must be retained when regulated records are corrected or recalculated, and may original values ever be overwritten? → assumed: Who created and last changed each record, and when; no full audit trail.
- [ ] ASM-13 If a route box is missing or a scanned box belongs to another route, can the driver complete loading and depart, or must the discrepancy be resolved first? → assumed: Block departure until every expected box is scanned and every wrong box is removed or corrected.
- [ ] ASM-14 When a route changes while the driver is offline, how should unsent loading or refusal work that no longer matches the route be reconciled? → assumed: Keep the unsent work and require the driver to review differences and resolve affected boxes before continuing; preserve completed handovers.
- [ ] ASM-15 If a recall is started while a driver is offline and the driver completes a handover before reconnecting, should that completed handover be retained as an exception or treated as blocked? → assumed: Retain the actual handover, flag the recall conflict, and open a quality case when it syncs.
- [ ] ASM-17 How will the existing logger and supplier gateway provide live temperatures, alert status, box association, and temperature history to the web app? → assumed: Use an existing gateway API or feed supplied by Meridian.

Other assumptions: ASM-3 How should stock in On Hold, Rejected, Recalled, and Expired states appear in the quantity view that must reconcile to on-hand stock? → assumed: Show on-hand as a total and show non-overlapping quantities for available, allocated, quarantined, On Hold, Rejected, Recalled, and Expired stock beneath it.; ASM-6 Which local-time convention should govern warehouse cut-offs, working days, delivery dates, expiry-date changes, and route schedules? → assumed: Use the serving warehouse's configured local time zone for its cut-off, working-day, and route rules; display dates and times in the user's local zone with the warehouse zone identified.; ASM-8 What integration contract is available for the logger supplier's gateway, which sends readings in batches? → assumed: Use the supplier gateway's existing documented batch API; Meridian will provide its interface documentation, credentials, and sample payloads.; ASM-9 Which file format and validation rules apply to the manufacturer's inbound logger file upload? → assumed: Images and PDFs up to 10 MB each, kept in cloud storage.; ASM-10 Which channels should deliver excursion, silence, low-budget, route-change, and stock-change alerts? → assumed: Email only, from fixed templates; no SMS or push.; ASM-12 What operational reports or exports are needed beyond the stock, order, temperature-history, and recall views already described? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-13 Which browsers and versions must the responsive portals support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-14 What accessibility conformance level is required for the portals? → assumed: WCAG 2.1 AA on the main flows.; ASM-16 What concurrent user and operational-record volumes should be used in addition to the stated 5,000 devices reporting at once and approximately 400 customer organisations? → assumed: Up to 1,000 users and 100,000 records in the first year.; ASM-18 Which period should the monthly report generated on the first day cover? → assumed: On-screen lists with filters and CSV export; no custom report builder.; ASM-19 How should the more-than-four-hour decision escalation reach the Quality Manager? → assumed: Email only, from fixed templates; no SMS or push.; ASM-20 Which email service should deliver recall notices, 24-hour reminders, daily summaries, and monthly reports? → assumed: Email only, from fixed templates; no SMS or push.; ASM-21 Which browsers and browser versions must support the responsive web app, including offline driver work and photo/signature capture? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-22 What accessibility conformance level is required for the web app and generated customer certificates? → assumed: WCAG 2.1 AA on the main flows.; ASM-23 What launch scale should the app support, particularly for the recall trace that must be available within one minute? → assumed: Up to 1,000 users and 100,000 records in the first year.; ASM-6 How should staff and drivers receive time-sensitive excursion and route alerts in the responsive web app? → assumed: Email only, from fixed templates; no SMS or push.; ASM-7 How should customer users receive the one-time code required for the second sign-in step? → assumed: Email and password, with a reset link by email; no social or single sign-on.; ASM-9 Which browsers must the responsive portals support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-10 What accessibility conformance level is required for the portals? → assumed: WCAG 2.1 AA on the main flows.; ASM-11 Which warehouse time zone determines order cut-offs, working days, delivery dates and route times? → assumed: Use the configured local time zone of the serving warehouse for each of those rules.; ASM-12 What minimum usage scale beyond the stated 5,000 reporting devices should the system be designed to support? → assumed: Up to 1,000 users and 100,000 records in the first year.; ASM-16 If browser location access is denied or unavailable at handover, can the driver still complete the handover? → assumed: Allow completion and record that location was unavailable.; ASM-18 What identity check must a user repeat when signing a quality decision? → assumed: Confirm identity using whichever sign-in method the account uses.; ASM-19 How should a decision waiting more than four hours be escalated to the Quality Manager? → assumed: Email only, from fixed templates; no SMS or push.; ASM-20 For customers who have not responded within 24 hours of a recall notice, what reminder schedule and channel should be used? → assumed: Email only, from fixed templates; no SMS or push.; ASM-21 Which time zone should the customer portal use when the user's own time zone has not been set? → assumed: Use the time zone configured on the user's account.; ASM-22 Which desktop and mobile browsers and versions must the responsive web app support? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-23 What accessibility conformance level is required for the web app? → assumed: WCAG 2.1 AA on the main flows.

## Requirements
- **REQ-1** (ADDED) The Meridian responsive web app shall provide role-oriented portal pages and navigation for stock, orders, deliveries, temperature monitoring, quality decisions, and recalls on phone, tablet, and desktop browser widths.
  - AC-1.1 [ui] Given A signed-in staff or customer user has portal access; when the user opens portal navigation; then the screen shows links to the modules permitted for that user, including applicable stock, order, delivery, temperature, quality, and recall pages
  - AC-1.2 [ui] Given A user opens an available workflow at phone, tablet, and desktop viewport widths; when the page is rendered; then the screen content has no horizontal overflow and phone controls have touch targets of at least 44 by 44 CSS pixels
- **REQ-2** (ADDED) The Meridian responsive web app shall provide staff authentication through Meridian Microsoft accounts and customer authentication using email and password followed by a one-time code, with reset links requested by email and no social sign-in or single-sign-on option for customer accounts.
  - AC-2.1 [ui] Given A staff user opens staff sign-in; when the user selects the staff sign-in flow; then the screen shows the Meridian Microsoft sign-in option and no external staff-account form
  - AC-2.2 [ui] Given The API returns a one-time-code challenge after a customer submits email and password; when the customer submits the credentials; then the screen shows a code-entry field, no customer social sign-in or single-sign-on option, and no customer account content before a successful code response
  - AC-2.3 [ui] Given A customer user requests a password reset; when the reset request is submitted; then the request contains the customer email address and the screen shows the reset-link-by-email confirmation returned by the API
  - AC-2.4 [ui] Given A disabled or removed account attempts online sign-in or access; when the API returns an access-denied response; then the screen shows an access-denied message and no protected page or record is displayed
- **REQ-3** (ADDED) When a user opens portal views, the Meridian responsive web app shall show records and actions returned for that user's role, assigned warehouses, and customer organisation, present Auditor views as read-only, and clear protected data when the API refuses access.
  - AC-3.1 [ui] Given The API returns records for a staff member's assigned warehouses or a customer's organisation; when the user opens the corresponding list; then the screen shows only the returned records
  - AC-3.2 [ui] Given A Quality Manager or Auditor opens a warehouse-scoped list and the API returns all-warehouse records; when the list is displayed; then the screen shows the returned records from all warehouses
  - AC-3.3 [ui] Given An Auditor opens a record page; when the page renders; then the screen shows record details without create, edit, or delete controls, and an API-refused write is shown as an error message
  - AC-3.4 [ui] Given A protected request is refused because the account or record is inaccessible; when the web app receives the refusal; then the screen shows an access-ended or access-denied message and clears protected record fields
- **REQ-4** (ADDED) The Meridian responsive web app shall let a Customer Administrator invite and remove users through controls scoped to that administrator's customer organisation.
  - AC-4.1 [ui] Given A Customer Administrator opens user management for their organisation; when the administrator submits an invitation or removal; then the screen shows the invitation or removal status returned by the API
  - AC-4.2 [ui] Given The API refuses a user-management action, including an action for another organisation; when the administrator submits the action; then the screen shows the returned error message and does not show the other organisation's user as changed
- **REQ-5** (ADDED) The Meridian responsive web app shall let System Administrators list, search, view, deactivate, and maintain products and create versioned temperature profiles with storage bands, contiguous non-overlapping tiers, allowance or not-permitted designations, a reason, and an effective date no earlier than today, while keeping earlier versions read-only.
  - AC-5.1 [ui] Given A System Administrator searches by product name or code or opens a deactivated product; when the API returns matching products and active states; then the screen shows matching product records and identifies deactivated products as unavailable for ordering
  - AC-5.2 [ui] Given A System Administrator submits an incomplete profile or one with overlapping or gapped tiers; when the administrator attempts to save; then the screen shows the validation error returned by the API and does not show the product as saved
  - AC-5.3 [ui] Given A System Administrator submits a valid profile with tiers, reason, and effective date; when the profile change is submitted; then the request includes the profile tiers, reason, and effective date and the screen shows the new profile version returned by the API
  - AC-5.4 [ui] Given A product has multiple profile versions; when a user opens profile history; then the screen lists earlier versions with their returned values, reason, effective date, and creator where returned, and provides no edit controls for earlier versions
  - AC-5.5 [ui] Given A System Administrator deactivates a product; when the API returns the updated product status; then the screen shows the product as deactivated
  - AC-5.6 [ui] Given A System Administrator enters a profile effective date before today; when the administrator attempts to save the profile; then the screen shows a validation error and no profile-save request is sent
- **REQ-6** (ADDED) When a temperature-profile version takes effect, the Meridian responsive web app shall show the new version and API-returned recalculated budgets, decisions, and current statuses for stock still held from its effective date onward, show earlier quality decisions as unchanged, and show resulting order, box, and route statuses for affected allocated or packed stock.
  - AC-6.1 [ui] Given The API returns a new effective profile version and recalculated values for stock still held from the effective date onward; when a user opens the profile and affected stock views; then the screen shows the new version's effective date and the returned budget and decision values
  - AC-6.2 [ui] Given A profile version has an effective date of today or later and the API returns an earlier quality decision for affected stock; when a user opens the profile and affected stock views; then the screen shows the earlier decision's returned values and status unchanged and does not show a recalculated earlier decision
  - AC-6.3 [ui] Given A System Administrator submits a profile change with a reason and effective date; when the API returns the updated profile and affected-stock results; then the screen shows the new version, reason, effective date, and returned recalculated budget and decision values
  - AC-6.4 [ui] Given A profile version takes effect and the API returns recalculation results for allocated, packed, or routed stock still held from the effective date onward; when an authorized user opens or refreshes the affected order, box, or route; then the screen shows the returned allocation, box, and route statuses and any returned action-required message or handover restriction
- **REQ-7** (ADDED) When a Warehouse Operator records a receipt, the Meridian responsive web app shall capture product, lot number, expiry date, quantity, supplier, and storage location and show returned quarantine status and inbound temperature information before a release decision.
  - AC-7.1 [ui] Given A Warehouse Operator opens the receipt form; when the form is displayed; then the screen shows fields for product, lot number, expiry date, quantity, supplier, cold room, and shelf
  - AC-7.2 [ui] Given The API accepts a receipt with an inbound logger file; when the operator submits the receipt; then the screen shows the receipt record, Quarantined status, submitted receipt details, and returned inbound readings and budget use when available
  - AC-7.3 [ui] Given The API refuses a receipt with an expired lot date or missing required field; when the operator submits the receipt; then the screen shows the returned error message beside the relevant field and no saved receipt is displayed
- **REQ-8** (ADDED) The Meridian responsive web app shall provide inbound logger-file upload and display returned temperature history and budget use, validate separate image or PDF receipt-evidence files, and accept logger exports in the supplier's documented format.
  - AC-8.1 [ui] Given A Warehouse Operator uploads an inbound logger file in the configured supplier interface format; when the receipt is submitted; then the request includes the uploaded logger file and the screen shows the returned inbound readings and budget use before release controls
  - AC-8.2 [ui] Given A Warehouse Operator uploads a logger file rejected by the API; when the upload response is displayed; then the screen shows the returned file error message and no successful-upload indicator
  - AC-8.3 [ui] Given An operator uploads a separate receipt-evidence image or PDF larger than 10 MB or a separate receipt-evidence file that is not an image or PDF; when the operator attempts to submit the receipt; then the screen shows a validation error and no saved receipt is displayed
- **REQ-9** (ADDED) When quality staff review a receipt or excursion, the Meridian responsive web app shall present available release or disposition actions and show decision states returned by the API, including separate proposal and approval steps for not-permitted-range dispositions.
  - AC-9.1 [ui] Given A quarantined receipt is opened by a Quality Officer; when the receipt review page renders; then the screen shows returned receipt data, temperature-budget use, and release decision controls
  - AC-9.2 [ui] Given A receipt is within 30 days of expiry on arrival or the API refuses release; when a Quality Officer opens or submits the release decision; then the screen shows the reason returned by the API and does not display the stock as released
  - AC-9.3 [ui] Given A Quality Officer proposes a disposition for stock exposed to a not-permitted range; when the proposal is submitted; then the request includes the proposed disposition and reason and the screen shows the proposal awaiting a different Quality Manager's approval
  - AC-9.4 [ui] Given The proposing person attempts to approve, or a user without the Quality Manager role attempts approval; when the approval is attempted; then the screen shows the returned error message or disables the approval control and shows the decision as unapproved
  - AC-9.5 [ui] Given A different Quality Manager approves or rejects a pending disposition; when the API returns the final decision; then the screen shows the returned decision, decision-maker, and decision status
- **REQ-10** (ADDED) The Meridian responsive web app shall show on-hand stock with mutually exclusive quantities for available, allocated, quarantined, On Hold, Rejected, Recalled, and Expired statuses, and show returned warehouse, lot, product, receipt, and location details.
  - AC-10.1 [ui] Given The API returns on-hand and status quantities for a product, lot, and warehouse; when a user opens the stock view; then the screen shows the on-hand total and each returned status quantity as a separate field or row, with the quantities summing to the on-hand count
  - AC-10.2 [ui] Given The API returns stock rows for multiple lots or warehouses; when a user filters the stock list; then the screen shows only rows matching the selected filter values
- **REQ-11** (ADDED) When portions of received stock have different temperature histories, the Meridian responsive web app shall show them as separate handling units with their returned quantity, history, and tier-budget use and remaining.
  - AC-11.1 [ui] Given A received lot is divided into handling units with different temperature histories; when a user opens the lot's handling-unit view; then the screen shows separate rows or records with each unit's returned quantity, history, and budget values
- **REQ-12** (ADDED) ⚠ only one draft had this The Meridian responsive web app shall provide stock-movement forms and show the returned movement record with source and destination locations, quantity, actor, and time.
  - AC-12.1 [ui] Given A Warehouse Operator moves stock between shelves or cold rooms; when the operator submits the move and opens its result; then the request includes the source and destination and the screen shows the returned movement record with actor, time, and quantity fields
- **REQ-13** (ADDED) The Meridian responsive web app shall let Customer Administrators maintain their organisation's saved delivery addresses and let System Administrators set the organisation's minimum remaining shelf-life requirement, showing that value read-only to customer users and Dispatchers.
  - AC-13.1 [ui] Given A Customer Administrator opens address management; when the administrator adds, edits, or removes an address; then the screen shows the address list or status returned by the API
  - AC-13.2 [ui] Given A System Administrator changes minimum remaining shelf life for a customer organisation; when the change is submitted; then the request includes the organisation-level value and the screen shows the saved value and response status returned by the API
  - AC-13.3 [ui] Given A customer user or Dispatcher opens an order form; when the form renders; then the screen shows the organisation's minimum remaining shelf-life value without a control to change it per order
- **REQ-14** (ADDED) The Meridian responsive web app shall let customer users create orders with one or more product lines, pack quantities, an organisation-saved delivery address, an eligible delivery date, and a choice between delivery of available quantities and complete delivery only.
  - AC-14.1 [ui] Given A customer user opens the order form; when the form is displayed; then the screen provides fields for at least one product line, a quantity of at least one pack per line, a saved address, requested delivery date, and partial-or-complete delivery preference
  - AC-14.2 [ui] Given A customer enters a quantity below one pack or submits an order without a line; when the customer submits the form; then the screen shows a field error and the request is not sent
  - AC-14.3 [ui] Given The API returns eligible delivery dates for the serving warehouse, based on its configured local time, cut-off, working days, and holidays; when the customer opens the date selector before or after the configured cut-off; then the screen shows only returned eligible dates, applies the next-working-day rule for an order before cut-off and no-earlier-than-the-working-day-after-that rule for an order after cut-off, and identifies the warehouse time zone
  - AC-14.4 [ui] Given A customer selects a deactivated product for an order; when the product status is returned; then the screen shows that the product cannot be ordered and provides no orderable quantity field
  - AC-14.5 [ui] Given A customer selects products, quantities, address, date, and fulfillment choice; when the customer reviews the order before submission; then the screen shows the complete order summary
- **REQ-15** (ADDED) When customers view, change, or cancel an order, the Meridian responsive web app shall show order status and allocated and outstanding quantities per line, expose customer change and cancellation controls only before Packed, expose dispatcher cancellation controls when returned as available, and display API outcomes.
  - AC-15.1 [ui] Given The API returns an order with line quantities and a status before Packed; when the customer opens the order; then the screen shows each line's allocated and outstanding quantities and customer change and cancel controls
  - AC-15.2 [ui] Given The API returns an order status of Packed or later; when the customer opens the order; then the screen shows the current status and no customer change or cancel controls
  - AC-15.3 [ui] Given A cancellation or change is refused or accepted by the API; when the customer submits the action or refreshes the order; then the screen shows the returned error or cancellation response, current status, updated quantities, and stock availability count when returned
  - AC-15.4 [ui] Given A customer submits an order more than once or retries after a network interruption; when the web app sends the submission or retry; then the captured request uses the same submission key for the retry and the screen shows one returned order record
  - AC-15.5 [ui] Given An order submission is pending; when the customer repeats the submission; then the screen sends only one order-submission request
  - AC-15.6 [ui] Given A Dispatcher opens an order in Packed or later status and the API returns cancellation as available; when the Dispatcher opens the order or submits cancellation; then the screen shows the dispatcher cancellation control and the returned cancellation response or error message
- **REQ-16** (ADDED) The Meridian responsive web app shall show order allocations by line and lot, including returned expiry dates and quantities, expose dispatcher lot-override controls with a required reason and API outcome, and show returned allocation and stock-status outcomes in order, box, and route views.
  - AC-16.1 [ui] Given An order line is allocated across lots; when a Dispatcher or customer opens allocation details; then the screen shows each returned lot, expiry date, allocated quantity, line split, and outstanding quantity separately
  - AC-16.2 [ui] Given A Dispatcher selects an alternative lot; when the override form renders and is submitted; then the screen shows a required reason field and the request includes the chosen lot and reason, while the screen shows the accepted allocation or returned refusal message
  - AC-16.3 [ui] Given The API reports back order, complete-only status, or no suitable stock; when the Dispatcher opens the order; then the screen shows the returned allocation status and outstanding quantity
  - AC-16.4 [ui] Given Allocated stock becomes On Hold, Rejected, Recalled, or Expired; when the order view refreshes; then the screen shows the returned removed allocation, replacement allocation outcome, outstanding quantity, and dispatcher message or notification outcome when returned
  - AC-16.5 [ui] Given Stock allocated to an order is reported by the API as On Hold, Rejected, Recalled, or Expired after it has been packed or placed on a route; when a user opens or refreshes the affected order, box, or route view; then the screen shows the returned stock status, resulting allocation and box or route status, and any returned action-required message or handover restriction
- **REQ-17** (ADDED) The Meridian responsive web app shall let Warehouse Operators pack stock into shipper boxes by type, associate one logger with each box, and show compatibility, contents, and sealing details returned by the API.
  - AC-17.1 [ui] Given A Warehouse Operator opens the packing form; when the form renders; then the screen provides fields for box type, logger identifier, delivery stop, products, lots, and quantities
  - AC-17.2 [ui] Given The operator selects stock, a box type, and logger and submits the packing action; when the API returns compatibility results or refuses an incompatible band, box type, missing logger, or already-associated logger; then the screen shows the returned compatibility result or error message and does not show an unsuccessful box as sealed
  - AC-17.3 [ui] Given A box is ready to be sealed and sealing succeeds; when the operator opens the box record; then the screen shows exactly one logger requirement and the returned seal time, operator, contents, quantities, and logger
- **REQ-18** (ADDED) The Meridian responsive web app shall let Dispatchers create and view routes with a date, vehicle, driver, ordered stops, and planned arrival times and show route-confirmation errors and confirmed-route changes returned by the API, including configured qualified-duration safety margins.
  - AC-18.1 [ui] Given A Dispatcher creates a route; when the route form is displayed; then the screen provides fields for one vehicle, one driver, route date, at least one ordered stop, and planned arrival times
  - AC-18.2 [ui] Given The API refuses confirmation because a box exceeds its qualified duration after applying the configured safety margin, which defaults to 4 hours; when the Dispatcher views the result; then the screen shows the refused status, affected box, returned overage amount, and returned configured safety-margin value
  - AC-18.3 [ui] Given A confirmed route is changed before the driver has left for an affected stop; when the Dispatcher reorders or moves the stop; then the request identifies the changed route and the screen shows returned stop order, schedule details, and driver notification status when returned
  - AC-18.4 [ui] Given A driver opens a changed confirmed route; when the route view is displayed; then the screen shows the changed stop or schedule details returned by the API
- **REQ-19** (ADDED) The Meridian responsive web app shall show temperature histories for boxes, cold rooms, and lots as charts and tables with returned readings, applicable bands, excursions, gaps, and reading flags or silence status.
  - AC-19.1 [ui] Given The API returns temperature history; when a user opens the history page; then the screen provides chart and table views with readings positioned by event or reading time, band bounds, excursion markers, and visible gaps
  - AC-19.2 [ui] Given The API returns duplicate, delayed, out-of-order, future-dated, pre-seal, or otherwise flagged readings; when the history is displayed; then the screen shows returned reading times and flags, identifies invalid-for-calculation readings, and displays returned history in time order without presenting excluded readings as calculation inputs
  - AC-19.3 [ui] Given A user switches between chart and table views; when the API returns the same history data; then the screen shows the corresponding returned history in each view
  - AC-19.4 [ui] Given The API returns gateway batch readings or inbound logger-file reading results; when a user opens the relevant device or receipt history; then the screen displays the returned readings and associated device or receipt
- **REQ-20** (ADDED) The Meridian responsive web app shall show excursions, handling-unit budget use and remaining allowances, returned alerts, and returned hold and decision statuses for affected devices and stock.
  - AC-20.1 [ui] Given The API returns an excursion and its affected handling units; when a user opens excursion or budget details; then the screen shows returned excursion start, end, readings, closure status, affected units, and used and remaining amounts by tier
  - AC-20.2 [ui] Given The API returns an open excursion, handling units, and hold statuses; when a Quality Officer opens the excursion view; then the screen shows affected handling units, tier budgets, and returned hold statuses
  - AC-20.3 [ui] Given The API returns a remaining-budget warning, exhausted tier, or not-permitted-range alert; when a user opens alerts or quality status; then the screen shows the returned alert category and affected stock or device
  - AC-20.4 [ui] Given The API returns an alert for silence, excursion, low or exhausted budget, not-permitted range, or corrected excursion; when an intended user opens alert history; then the screen shows returned alert type, affected device or stock, recipient role and delivery metadata when returned, plus corrected excursion or budget status when present
- **REQ-21** (ADDED) When the API returns an unresolved temperature-history gap affecting stock, the Meridian responsive web app shall show the gap, review status, and stock status returned by the API without inferring an On Hold status from the gap or displaying an estimated temperature tier.
  - AC-21.1 [ui] Given The API returns an unresolved temperature-history gap for affected stock, its review status, and its stock status; when a Quality Officer opens the quality status; then the screen shows the gap, review status, and returned stock status without estimating a temperature tier
  - AC-21.2 [ui] Given The API returns an unresolved gap flagged for review and a stock status of Available, with no other hold reason returned; when a user opens the affected stock detail; then the screen shows the Available status and review flag and does not show the stock as On Hold because of the gap
- **REQ-22** (ADDED) ⚠ only one draft had this When the API returns an unresolved temperature-history gap affecting stock, the Meridian responsive web app shall show the returned stock status and budget values without presenting an estimated charge to an unobserved temperature tier.
  - AC-22.1 [ui] Given The API returns an unresolved temperature-history gap affecting stock, along with stock status and budget values; when a user opens the affected stock detail; then the screen shows the returned stock status and budget values without presenting an estimated charge to an unobserved tier
- **REQ-23** (ADDED) When corrected temperature history identifies an excursion affecting stock already delivered, the Meridian responsive web app shall show the returned quality-review case to the relevant customer and staff users.
  - AC-23.1 [ui] Given The API returns a quality-review case linked to a delivered customer order; when the customer or authorized staff user opens the related order or case; then the screen shows the returned case status and affected delivered line or stock details
- **REQ-24** (ADDED) The Meridian responsive web app shall provide an installable, responsive driver experience that caches the current workday's assigned route, queues supported loading and delivery actions for synchronization when connectivity returns, retains unsynchronized actions tied to the originating driver across sign-out and workday end until synchronization succeeds or the API rejects or refuses them, synchronizes those actions only after that same driver signs in again, clears cached route and delivery data when the driver signs out, the workday ends, or access is refused, erases or marks queued actions rejected when the API refuses access or reports the account disabled, and shows stale-route and queued-action outcomes returned by the API.
  - AC-24.1 [ui] Given A driver has opened today's assigned route while connected and then loses connectivity; when the driver opens the cached route; then the screen shows the route, stops, and delivery details while offline
  - AC-24.2 [ui] Given A driver records a supported action while offline; when the action is saved without a connection; then the screen shows the action as queued and retains its entered values until synchronization succeeds or the API rejects or refuses the action
  - AC-24.3 [ui] Given The originating driver signs in again with an enabled account and reconnects; when queued actions synchronize; then the screen shows the returned synchronization result for each queued action
  - AC-24.4 [ui] Given A queued action is submitted and the API reports that the originating driver's account is disabled or access is refused; when the synchronization response is displayed; then the screen shows the returned rejection message or error, marks the action as not accepted or synchronized, and shows it as rejected or no longer queued, with no later synchronization request for that action
  - AC-24.5 [ui] Given A Dispatcher changes a cached route or cancels an order while the driver is offline and the API returns the updated route or order on reconnection; when the driver refreshes or synchronizes the cached work; then the screen identifies the cached route or stop as stale, shows the returned changed route or cancellation status, and does not present a removed stop or cancelled order as actionable
  - AC-24.6 [ui] Given A queued loading or handover action refers to a moved or removed stop or a cancelled order; when the action synchronizes and the API returns an acceptance or refusal; then the screen shows the returned result for that action and does not mark a refused handover as completed or accepted
  - AC-24.7 [ui] Given The browser has cached route or delivery data, including recipient details; when the driver signs out, the cached workday ends, or an API response reports refused access or a disabled account, and the driver next opens the driver experience; then the screen shows the sign-in or access-denied page and no cached route, stop, delivery, or recipient details
  - AC-24.8 [ui] Given One or more actions remain queued after the originating driver signs out or the cached workday ends, and a different user signs in on the same browser; when that different user opens the driver experience or reconnects; then the screen shows no originating driver's route, recipient details, or queued-action details, and the browser sends no synchronization request for the originating driver's actions
  - AC-24.9 [ui] Given One or more actions remain queued after the originating driver signs out or the cached workday ends, with no successful synchronization or API rejection or refusal; when that same driver signs in again with an enabled account and reconnects; then the synchronization request uses that driver's authenticated identity and the screen shows the returned result for each queued action
- **REQ-25** (ADDED) When a driver records a delivery handover, the Meridian responsive web app shall capture the recipient's name, explicit electronic acknowledgment, quantities handed over, and any refusal or partial-delivery reason, and show outstanding quantities and returned delivery status, including restrictions returned when an offline handover synchronizes.
  - AC-25.1 [ui] Given A driver opens a delivery handover form; when the form is displayed; then the screen shows a recipient-name field and explicit electronic acknowledgment control and does not require a drawn signature
  - AC-25.2 [ui] Given A driver submits a handover; when the web app sends the handover; then the captured request contains recipient name, acknowledgment value, and handed-over quantities
  - AC-25.3 [ui] Given A delivery is refused or only partly completed; when the driver records the handover; then the request includes delivered and undelivered quantities and the reason, and the screen shows the returned outstanding quantity
  - AC-25.4 [ui] Given Undelivered stock is returned to a warehouse; when the API returns the warehouse receipt and any required quality-check result; then the screen shows the returned receipt and quality status and shows stock as available only when the API reports it available
  - AC-25.5 [ui] Given An offline handover is queued and the API returns a restriction because the affected stock is On Hold or recalled; when the queued handover synchronizes and the restriction response is displayed; then the screen shows the returned restriction, does not mark the delivery as completed, and shows the affected quantity as outstanding for follow-up
- **REQ-26** (ADDED) The Meridian responsive web app shall let Quality Managers start recalls by selecting affected lots and providing a reason, view and manage recall records, and close recalls, and let customer users submit a quantity and stated disposition for each affected delivery, showing returned reconciliation and stock-block information.
  - AC-26.1 [ui] Given A Quality Manager opens a recall record; when the recall detail is displayed; then the screen lists returned lot locations, affected deliveries, quantities, and remaining stock reported as blocked
  - AC-26.2 [ui] Given A customer user opens an affected delivery recall response form; when the form is displayed; then the screen provides fields for response, quantity, and stated disposition for each delivery and returned quantity categories for locating, using, returning, disposing of, or otherwise accounting for units
  - AC-26.3 [ui] Given A customer submits a recall quantity reconciliation; when the API returns the response status; then the screen shows submitted quantities, stated dispositions, and returned accounted-for status without requiring supporting-document upload
  - AC-26.4 [ui] Given A recall has unreconciled quantities; when a Quality Manager opens its progress page; then the screen shows the outstanding quantity count and affected customer responses returned by the API
  - AC-26.5 [ui] Given A Quality Manager starts a recall for one or more lots; when the Quality Manager selects the lots, enters a reason, and submits the recall; then the request includes the selected lots and reason, and the screen shows the recall record and status returned by the API
  - AC-26.6 [ui] Given A Quality Manager closes a recall; when the Quality Manager submits the close action; then the screen shows the recall status returned by the API
  - AC-26.7 [ui] Given The API refuses a recall start or close action; when the Quality Manager submits that action; then the screen shows the returned error message and does not show the recall as successfully started or closed
- **REQ-27** (ADDED) The Meridian responsive web app shall provide filtered on-screen operational lists and CSV export, and show creator and last-changer identity and timestamps as read-only metadata where returned.
  - AC-27.1 [ui] Given A user opens a supported operational list and applies filters; when the user requests CSV export; then the screen shows the filtered record list and the downloaded CSV file contains the displayed or filtered records
  - AC-27.2 [ui] Given The API returns creator and last-change metadata for a record; when an authorized user or Auditor opens the record; then the screen shows returned actor and timestamp fields as read-only values
- **REQ-28** (ADDED) The Meridian responsive web app shall provide English and Arabic portal content and render Arabic pages right to left.
  - AC-28.1 [ui] Given A user selects Arabic; when the user opens a staff, customer, or driver page; then the screen shows Arabic text with right-to-left page direction
  - AC-28.2 [ui] Given A user selects English; when the user opens a portal page; then the screen shows English text with left-to-right page direction
- **REQ-29** (ADDED) The Meridian responsive web app shall provide individual email-and-password sign-in and self-service password reset for driver, staff, and customer areas, including a form to set a new password from a reset link and a way to request another reset email when the link is invalid or expired.
  - AC-29.1 [ui] Given A user is on the sign-in page; when the user submits an email address and password; then the screen displays the returned sign-in result or error message
  - AC-29.2 [ui] Given A user is on the password-reset page; when the user submits an account email address; then the screen displays the returned password-reset confirmation or error message
  - AC-29.3 [ui] Given A user opens a valid, unexpired password-reset link; when the link opens; then the screen displays a form to enter a new password
  - AC-29.4 [ui] Given A user is on the new-password form opened from a valid, unexpired reset link; when the user submits a new password; then the request contains the new password and the screen displays the returned reset result or error message
  - AC-29.5 [ui] Given A user opens an invalid or expired password-reset link; when the link opens; then the screen explains that the link cannot be used and displays a control to request another reset email
  - AC-29.6 [ui] Given A user is shown that a password-reset link cannot be used; when the user requests another reset email; then the screen displays the returned password-reset confirmation or error message
- **REQ-30** (ADDED) The Meridian web app shall provide System Administrator screens to create and deactivate accounts and assign roles, staff warehouse access, and customer-organisation access.
  - AC-30.1 [ui] Given A System Administrator is viewing account management; when the administrator opens an account or submits account or access changes; then the screen displays account fields and the returned status or error message
  - AC-30.2 [ui] Given A user without the System Administrator role opens account management; when the page loads; then the screen displays an access-denied message or the account-management page is not displayed
- **REQ-31** (ADDED) When a driver opens today's routes, the Meridian web app shall show only that driver's assigned routes and each route's stops in route order.
  - AC-31.1 [ui] Given Route data contains routes assigned to multiple drivers; when a driver opens today's route list; then the screen lists only routes returned or assigned to that driver and displays each route's stops in order
- **REQ-32** (ADDED) The Meridian web app shall compare scanned shipper boxes with expected boxes before route departure, report missing or wrong-route boxes, and keep departure blocked until all expected boxes are scanned and wrong boxes are removed or corrected.
  - AC-32.1 [ui] Given A route has an expected box that has not been scanned; when the driver attempts to complete loading or depart; then the screen shows the missing-box status and keeps the departure control unavailable
  - AC-32.2 [ui] Given The driver scans a box assigned to another route; when the scan is processed; then the screen shows a wrong-route warning naming the box and keeps departure blocked
  - AC-32.3 [ui] Given Every expected box is scanned and no wrong-route box remains; when the driver completes loading; then the screen shows loading complete and displays an enabled departure control
- **REQ-33** (ADDED) The Meridian web app shall show dispatchers each route stop's status and last-updated time.
  - AC-33.1 [ui] Given The route service returns stop statuses and update-time fields; when a dispatcher opens route monitoring; then the screen displays each stop's returned status and last-updated time
- **REQ-34** (ADDED) The Meridian web app shall show each route box's latest available temperature, status, and alerts from the supplied gateway data and identify cached temperature data as stale while disconnected.
  - AC-34.1 [ui] Given The gateway feed returns temperature, status, and alert data for route boxes; when the driver opens route monitoring; then the screen displays each box's current temperature, status, and returned alerts
  - AC-34.2 [ui] Given The browser is disconnected and cached temperature data is available; when the driver opens box monitoring; then the screen displays the cached temperature value and marks it stale
- **REQ-35** (ADDED) When scanned stock is On Hold, the Meridian web app shall display “Do not deliver” and the returned hold reason and prevent handover of that box.
  - AC-35.1 [ui] Given A stop includes a scanned box whose returned stock status is On Hold; when the driver opens that box's handover controls; then the screen displays “Do not deliver” and the hold reason and offers no enabled handover control for that box
  - AC-35.2 [ui] Given A stop includes both On Hold and deliverable boxes; when the driver opens the handover screen; then the screen permits handover only for deliverable boxes
- **REQ-36** (ADDED) When the driver is online and the service reports a scanned box as Recalled, the Meridian web app shall display “Do not deliver” and prevent handover of that box.
  - AC-36.1 [ui] Given The driver is online and the service returns a scanned box status of Recalled; when the driver opens that box's handover controls; then the screen displays “Do not deliver” and no enabled handover control for that box
- **REQ-37** (ADDED) The Meridian web app shall let drivers record an eligible handover with receiver name, signature, delivery photo, actual handover time, and available browser location.
  - AC-37.1 [ui] Given A box is eligible for handover; when the driver enters the receiver name, captures a signature and photo, and completes handover; then the handover request contains the receiver, signature, photo, actual completion time, and available location fields
- **REQ-38** (ADDED) If browser location is denied or unavailable, then the Meridian web app shall allow an otherwise eligible handover and record location as unavailable.
  - AC-38.1 [ui] Given Browser location access is denied or unavailable; when the driver completes an otherwise eligible handover; then the screen displays the completed handover and a location-unavailable value, and the request records location as unavailable
- **REQ-39** (ADDED) The Meridian web app shall let drivers record full or partial refusal only by whole box and require a reason for each refused box.
  - AC-39.1 [ui] Given A driver is recording a refusal; when the driver selects refused boxes and submits a reason for each; then the screen displays each refused whole box with its reason and offers no partial-box quantity control
  - AC-39.2 [ui] Given The service returns a refusal and quarantine result; when the driver opens the completed refusal; then the screen displays the returned refusal status and quarantine status for each refused box
- **REQ-40** (ADDED) While the browser is offline, the Meridian web app shall retain loading, handover, and refusal work locally across session expiry or sign-out, allow a driver to record that work after session expiry, require the driver to re-authenticate before queued work syncs, automatically send queued work when connectivity returns, preserve handover occurrence time and identifier on retries, clear queued payload only after successful service acknowledgement, and show an error without reporting work as queued when local storage cannot retain the complete payload.
  - AC-40.1 [ui] Given The browser is offline; when the driver records loading, handover, or refusal work; then the screen shows each action in the pending queue and retains its entered values
  - AC-40.2 [ui] Given Queued work exists and connectivity returns; when the web app reconnects; then the screen shows queued work being sent without requiring resubmission and displays the returned sync status
  - AC-40.3 [ui] Given A handover was recorded offline; when the web app sends it or retries an interrupted send; then the request contains the original handover time and the same handover identifier as the original request
  - AC-40.4 [ui] Given Loading, handover, or refusal work, including handover signature and photo values, is queued while offline and the driver session expires or the driver signs out; when the driver re-authenticates and the connection returns; then the screen lists the retained queued work and its entered values, and the request sends the work without requiring re-entry
  - AC-40.6 [ui] Given The service has acknowledged successful synchronization of queued work; when the driver reloads the web app and connectivity returns again; then the screen shows no pending payload for that work and the request count for resending that work is zero
  - AC-40.7 [ui] Given The browser is offline and local storage cannot retain the complete payload for a loading, handover, or refusal action; when the driver attempts to save the action; then the screen displays a storage error, does not show the action as queued or completed, and the request count for sending that action is zero
  - AC-40.10 [ui] Given The driver's session has expired while the browser is offline; when the driver records loading, handover, or refusal work; then the screen displays the action and its entered values as pending locally, and the request count for sending that action is zero until the driver re-authenticates
- **REQ-41** (ADDED) When an assigned route changes while a driver is offline, the Meridian web app shall show route differences, require review and resolution of affected unsent work before continuing, and preserve completed offline handovers.
  - AC-41.1 [ui] Given The route returned after reconnection differs and unsent work exists; when the driver reconnects and the app reconciles the route; then the screen lists route differences and affected boxes requiring review
  - AC-41.2 [ui] Given Route differences have unresolved affected boxes; when the driver attempts to continue route work; then the screen blocks continuing and shows the unresolved boxes
  - AC-41.3 [ui] Given A handover was completed offline before the route changed; when the new route is synchronized; then the screen still displays the completed handover and its original time
- **REQ-42** (ADDED) When an offline handover conflicts with an On Hold status upon synchronization, the Meridian web app shall retain and flag the handover and display the returned quality-case result.
  - AC-42.1 [ui] Given An offline handover is synchronized and the service returns a hold conflict and quality-case result; when the driver or quality user opens the synchronized record; then the screen displays the retained handover, conflict flag, and returned quality-case status
- **REQ-43** (ADDED) The Meridian web app shall show Quality reviewers the full excursion temperature history, allowance used and remaining for each tier, and the returned recommendation, using the configured tier rules.
  - AC-43.1 [ui] Given An excursion review receives temperature history, tier budgets, and a recommendation; when a Quality reviewer opens the affected handling unit; then the screen displays the full history, used and remaining allowance for each tier, and the recommendation
  - AC-43.2 [ui] Given Configured tier limits and allowances are returned for different products; when a user views settings or excursion reviews for those products; then the screen displays the same configured tier-limit and allowance values for each product
  - AC-43.3 [ui] Given A signed-in user without excursion-review permission opens an excursion review and the service refuses access; when the review page loads; then the screen displays an access-denied message and no excursion history, allowance values, or recommendation
- **REQ-44** (ADDED) The Meridian web app shall present a single-person quality-decision flow only when an excursion is within the first tier above or below the permitted band, allowance remains, and the proposed decision matches the recommendation, and otherwise present a Quality Officer proposal and separate approval by a different Quality Manager; a written justification is required when a decision opposes the recommendation.
  - AC-44.1 [ui] Given An excursion is within the first tier above or below the band, has allowance remaining, and the proposed decision matches the recommendation; when an eligible Quality Officer opens the decision form; then the screen displays the single-person decision controls
  - AC-44.2 [ui] Given An excursion is outside the single-person case or has no allowance remaining; when a Quality Officer opens the decision form; then the screen requires a proposal and separate Quality Manager approval
  - AC-44.3 [ui] Given The proposing Quality Officer also has the Quality Manager role; when that person attempts to approve the proposal; then the screen does not offer an approval action to that same person
  - AC-44.4 [ui] Given A proposed decision opposes the displayed recommendation, including for an excursion otherwise eligible for a single-person decision; when a user prepares the decision; then the screen requires a written-justification field, a Quality Officer proposal, and approval by a different Quality Manager
  - AC-44.5 [ui] Given An excursion is within the first tier and has allowance remaining but the proposed decision opposes the recommendation; when an eligible Quality Officer opens the decision form; then the screen displays the separate proposal and approval flow and does not display the single-person decision controls
- **REQ-45** (ADDED) The Meridian web app shall require identity confirmation using the account's sign-in method and a reason when a user signs a quality decision, and present signed decisions as read-only with a separate superseding-decision action.
  - AC-45.1 [ui] Given A user is ready to sign a quality decision; when the user submits the signing form; then the screen requires identity confirmation and a reason before showing the signed-decision status
  - AC-45.2 [ui] Given A decision is returned as signed; when a user opens that decision; then the screen shows signed values as read-only, provides a separate superseding-decision action, and offers no edit or delete control
  - AC-45.3 [ui] Given The service returns an earlier signed decision and a superseding decision; when a reviewer opens decision history; then the screen displays both signed decision records and identifies the superseding decision
- **REQ-46** (ADDED) When the service returns a quality disposition, the Meridian web app shall show resulting stock, order, and route status and the earlier and current disposition when superseded.
  - AC-46.1 [ui] Given The service returns a release, rejection, or superseding disposition; when a Quality user views the affected stock or handling unit; then the screen displays the returned stock, order, and route status and disposition history
  - AC-46.2 [ui] Given The service rejects a superseding disposition because its reversal cannot be applied after stock was delivered or destroyed; when a Quality user views the affected stock or handling unit; then the screen displays the returned error and unchanged returned stock, order, and route status, and does not present the superseding disposition as applied
- **REQ-47** (ADDED) The Meridian web app shall collect destruction date, quantity, and witness for rejected stock and prevent entry of quantity greater than the displayed rejected quantity.
  - AC-47.1 [ui] Given A user opens destruction entry for rejected stock; when the user records destruction; then the request contains destruction date, quantity, and witness fields
  - AC-47.2 [ui] Given The entered destruction quantity exceeds the displayed rejected quantity; when the user submits the entry; then the screen shows a validation error and sends no destruction request
- **REQ-48** (ADDED) ⚠ only one draft had this The Meridian web app shall identify quality decisions waiting more than four hours as escalated in the Quality Manager's waiting-decisions view.
  - AC-48.1 [ui] Given The service returns a decision waiting more than four hours as escalated; when a Quality Manager opens waiting decisions; then the screen lists the decision and displays its escalated status
- **REQ-49** (ADDED) The Meridian web app shall provide a Quality Manager flow to start and close recalls with signed actions, collecting product, one or more lots, reason, and severity for recall start, and display each returned action result.
  - AC-49.1 [ui] Given A Quality Manager opens recall start; when the manager enters product, lot numbers, reason, severity, and signature; then the recall request contains those values and the screen displays the returned recall result
  - AC-49.2 [ui] Given A Quality Manager closes a recall; when the manager submits the signed close action; then the close request contains the signature and the screen displays the returned close status or error message
  - AC-49.3 [ui] Given A user who is not identified as eligible to manage recalls opens recall management; when recall actions load; then the screen does not display recall start or close actions
- **REQ-50** (ADDED) The Meridian web app shall display the returned recall trace, including warehouse locations, boxes, routes, customer deliveries, quantities, delivery dates, receivers, and the trace total alongside received quantity when supplied.
  - AC-50.1 [ui] Given A recall trace response contains affected locations and delivery records; when a Quality Manager opens the trace; then the screen displays each returned warehouse, box, route, customer delivery, quantity, delivery date, and receiver
  - AC-50.2 [ui] Given The service returns trace quantities and the lot's total received quantity; when the user views the trace summary; then the screen displays the returned trace total alongside the received quantity
- **REQ-51** (ADDED) The Meridian web app shall show customer recall notices in the portal, link notices to affected deliveries, and provide a response entry point.
  - AC-51.1 [ui] Given The service returns an active recall notice for the signed-in customer's organisation; when the customer opens the portal; then the screen displays the recall notice, its returned status, affected deliveries, and a response entry point
- **REQ-52** (ADDED) The Meridian web app shall let customers submit or update per-delivery on-hand, used or dispensed, and destroyed quantities, allow a total below the delivered amount as unaccounted, and reject a total above it.
  - AC-52.1 [ui] Given A customer opens a recall response for a delivery; when the customer enters on-hand, used or dispensed, and destroyed quantities; then the response request contains the entered quantity fields for that delivery
  - AC-52.2 [ui] Given The reported quantities total less than the delivered quantity; when the customer submits the response; then the screen accepts the values and displays the difference as unaccounted quantity
  - AC-52.3 [ui] Given The reported quantities exceed the delivered quantity; when the customer submits the response; then the screen displays a validation error or returned error message and sends no invalid response request
  - AC-52.4 [ui] Given A previously submitted response has an unaccounted remainder; when the customer adds or revises the quantities for that delivery and submits the update; then the request identifies that delivery and contains the updated quantity fields, and the screen displays the returned response and remaining unaccounted quantity
- **REQ-53** (ADDED) The Meridian web app shall show recall progress as the returned percentage accounted for, identify outstanding customers and reminder status when supplied, and let a Quality Manager submit a signed write-off justification for unaccounted quantity.
  - AC-53.1 [ui] Given The service returns recall progress and outstanding customers; when a Quality Manager opens recall progress; then the screen displays the accounted percentage and outstanding-customer list
  - AC-53.2 [ui] Given The service returns customer response and reminder statuses; when a user opens recall progress; then the screen displays the returned reminder status
  - AC-53.3 [ui] Given A Quality Manager selects unaccounted quantity for write-off; when the manager submits the write-off; then the request contains a signed justification and the screen displays the returned write-off status or refusal message
  - AC-53.4 [ui] Given A recall has unaccounted quantity without a signed write-off; when a Quality Manager attempts to close the recall; then the screen blocks submission and displays the outstanding quantity or returned close error
- **REQ-54** (ADDED) The Meridian web app shall show customers only their organisation's current and past orders, allocated lots and expiry dates, order status, and in-transit delivery arrival and temperature status, without exposing other route customers.
  - AC-54.1 [ui] Given A signed-in customer belongs to one organisation and the service provides an authenticated, organisation-scoped response despite having records for other organisations; when the customer opens the orders page; then the request contains no caller-supplied identifier for another organisation and the screen lists only the signed-in organisation's returned orders, status, lots, and expiry dates
  - AC-54.2 [ui] Given The service returns an in-transit delivery with arrival and temperature status; when the customer views the delivery; then the screen displays planned arrival and in-range or out-of-range status and no other customer's identity or delivery details
- **REQ-55** (ADDED) The Meridian web app shall provide a PDF certificate for each completed delivery in the signed-in customer's organisation with products, lots, expiry dates, quantities, receiver, handover time, each box's temperature chart from sealing to handover, excursions, and signed excursion decisions.
  - AC-55.1 [ui] Given A completed delivery in the signed-in customer's organisation has a certificate available; when the customer selects certificate download; then the downloaded file is a PDF containing the listed delivery, handover, temperature, excursion, and decision fields
  - AC-55.2 [ui] Given A customer belongs to Organisation A and a delivery belongs to Organisation B; when the customer changes the delivery identifier in a certificate URL to Organisation B's delivery; then the service response status is 403 or 404, the screen displays an access-denied or not-found message, and no certificate file or download link is displayed
- **REQ-56** (ADDED) When late readings produce a new certificate version, the Meridian web app shall list the new and earlier versions for the signed-in customer's completed delivery and keep each available for download.
  - AC-56.1 [ui] Given The service returns a new certificate version and retains the earlier version; when the customer opens certificate history; then the screen lists both versions and provides a file download link for each
  - AC-56.2 [ui] Given A customer belongs to Organisation A and a certificate history belongs to Organisation B; when the customer opens Organisation B's certificate-history URL; then the service response status is 403 or 404, the screen lists no certificate versions, and no download links are displayed
- **REQ-57** (ADDED) The Meridian web app shall present the customer portal and certificates in the user's selected English or Arabic, render Arabic right to left including tables and charts, and show dates and times in the account's configured time zone.
  - AC-57.1 [ui] Given The user selects Arabic; when the portal and a delivery certificate are displayed; then the screen and certificate display Arabic content with right-to-left direction for tables and charts
  - AC-57.2 [ui] Given The user's account has a configured time zone; when the portal displays order or delivery dates and times; then the screen displays the values in that configured time zone
- **REQ-58** (ADDED) The Meridian web app shall provide an audit-trail screen showing returned entries with actor, time, changed fields, old and new values, and supplied reason, with filters by record, user, date range, and action type and export of the filtered view.
  - AC-58.1 [ui] Given Audit entries are returned for multiple records, users, dates, and action types; when an Auditor opens the audit trail; then the screen displays each entry's actor, time, changed fields, old and new values, and supplied reason
  - AC-58.2 [ui] Given An Auditor selects audit filters; when the filters are applied and the Auditor exports the view; then the screen displays the matching returned list and provides a file containing the filtered view
  - AC-58.3 [ui] Given A signed-in user without audit-trail permission opens the audit trail and the service refuses access; when the audit-trail page loads; then the screen displays an access-denied message and no audit entries, filters, or export action
- **REQ-59** (ADDED) The Meridian web app shall show the returned history of a lot from receipt through delivery or destruction in time order.
  - AC-59.1 [ui] Given A lot-history response contains receipt, movement, delivery, or destruction events; when an Auditor opens lot history; then the screen displays the returned events in time order
  - AC-59.2 [ui] Given A signed-in user without lot-history permission opens a lot history and the service refuses access; when the lot-history page loads; then the screen displays an access-denied message and no lot-history events
- **REQ-60** (ADDED) The Meridian web app shall provide on-screen reports for selected date ranges and warehouses, with CSV export of displayed figures, including excursion counts and rates by route, driver, vehicle, and shipper box type; packs rejected and destroyed by product and cause; deliveries on time within 60 minutes of planned arrival and in full when every ordered pack is handed over, each as a percentage; average time from excursion to decision; stock within 60 days of expiry by product and warehouse; and open recalls and their progress.
  - AC-60.1 [ui] Given The service returns report figures for a selected date range and warehouse; when staff open the reports screen; then the screen displays returned excursion counts and rates by route, driver, vehicle, and shipper box type; packs rejected and destroyed by product and cause; on-time delivery and in-full percentages; average time from excursion to decision; stock within 60 days of expiry by product and warehouse; and open recalls and their progress
  - AC-60.2 [ui] Given A staff user has warehouse access scope; when the user filters reports and exports them; then the screen offers only in-scope warehouses and the downloaded CSV file contains the displayed filtered figures
  - AC-60.3 [ui] Given A signed-in user without report access opens the reports page and the service refuses access; when the page loads; then the screen displays an access-denied message and no report figures or export action
- **REQ-61** (ADDED) The Meridian web app shall provide forms to enter opening lots and stock records and submit them to the service.
  - AC-61.1 [ui] Given An authorized staff user opens opening-inventory entry; when the user enters lot and stock details; then the request contains the entered opening lot and stock fields and the screen displays the returned result or error
  - AC-61.2 [ui] Given A signed-in user without opening-inventory permission opens opening-inventory entry and the service refuses access; when the page loads; then the screen displays an access-denied message and no opening-inventory form or records
- **REQ-62** (ADDED) The Meridian web app shall make recorded handover signatures and delivery photos available from a delivery record within its seven-year evidence-retention period.
  - AC-62.1 [ui] Given A delivery record within its retention period includes signature and photo evidence; when an authorized user opens the delivery record; then the screen displays the signature and photo fields or their available file links
  - AC-62.2 [ui] Given A signed-in user without delivery-evidence permission opens a delivery record and the service refuses access; when the evidence view loads; then the screen displays an access-denied message and no signature, photo, or evidence file links

Not changing: API-side enforcement of credentials, password-reset token validity/delivery, role and access-scope authorization, and account state; web requirements cover forms, requests, screens, and API response handling.; API-side persistence and enforcement of stock/order/route transitions, hold and recall blocking across warehouses, quarantine, quantity validation/conservation, recall trace completeness and arithmetic, recall closure eligibility, write-off authorization, and duplicate-handover idempotency.; API-side audit creation, tamper detection, immutability, seven-year retention of audit records and handover evidence, and certificate-version persistence.; API-side scheduled and outbound emails, including recall notices and 24-hour reminders, four-hour decision escalation, daily summaries, monthly reports, and monthly report generation; web screens display supplied results/status where specified.; API-side production of recall traces within a time limit; the client timing requirements measure rendering after the response or from the user's request, as specified in separate requirements.; Supplying live temperature readings, alerts, box associations, and history through the existing logger or supplier gateway feed.; Importing or guaranteeing initial database contents; the web app provides opening-lot and stock entry.; Pricing, invoicing and payments; route stop-order optimization; manufacturer purchasing and demand forecasting; automatic driver or customer penalties; stock transfers between warehouses; logger hardware and supplier gateway implementation.; Native iOS or Android applications, app-store distribution, push notifications, and background location. The product is a responsive web app; applicable notices use in-app notices or email, location uses the browser prompt, and the web app may be installable.; Offline-cache recall blocking and a separate quality-case flow for offline handovers that conflict with recall status (Q-11).; Account isolation for browser-local queued work and a user-review workflow for permanently rejected queued payloads (Q-13).

## Files the plan will touch (71)
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
- components/screens/s-19/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-20/container.tsx  ← not found by grounding; check it
- components/screens/s-21/container.tsx  ← not found by grounding; check it
- components/screens/s-22/container.tsx  ← not found by grounding; check it
- components/screens/s-23/container.tsx  ← not found by grounding; check it
- components/screens/s-24/container.tsx  ← not found by grounding; check it
- components/screens/s-25/container.tsx  ← not found by grounding; check it
- components/screens/s-25/route-cache.ts  ← not found by grounding; check it
- components/screens/s-26/container.tsx  ← not found by grounding; check it
- components/screens/s-27/container.tsx  ← not found by grounding; check it
- components/screens/s-27/driver-work-store.ts  ← not found by grounding; check it
- components/screens/s-28/container.tsx  ← not found by grounding; check it
- components/screens/s-29/container.tsx  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-30/container.tsx  ← not found by grounding; check it
- components/screens/s-31/container.tsx  ← not found by grounding; check it
- components/screens/s-32/container.tsx  ← not found by grounding; check it
- components/screens/s-33/container.tsx  ← not found by grounding; check it
- components/screens/s-34/container.tsx  ← not found by grounding; check it
- components/screens/s-35/container.tsx  ← not found by grounding; check it
- components/screens/s-36/container.tsx  ← not found by grounding; check it
- components/screens/s-37/container.tsx  ← not found by grounding; check it
- components/screens/s-38/container.tsx  ← not found by grounding; check it
- components/screens/s-39/container.tsx  ← not found by grounding; check it
- components/screens/s-4/container.tsx  ← not found by grounding; check it
- components/screens/s-40/container.tsx  ← not found by grounding; check it
- components/screens/s-41/container.tsx  ← not found by grounding; check it
- components/screens/s-42/container.tsx  ← not found by grounding; check it
- components/screens/s-43/container.tsx  ← not found by grounding; check it
- components/screens/s-44/container.tsx  ← not found by grounding; check it
- components/screens/s-45/container.tsx  ← not found by grounding; check it
- components/screens/s-46/container.tsx  ← not found by grounding; check it
- components/screens/s-47/container.tsx  ← not found by grounding; check it
- components/screens/s-48/container.tsx  ← not found by grounding; check it
- components/screens/s-49/container.tsx  ← not found by grounding; check it
- components/screens/s-5/container.tsx  ← not found by grounding; check it
- components/screens/s-50/container.tsx  ← not found by grounding; check it
- components/screens/s-51/container.tsx  ← not found by grounding; check it
- components/screens/s-52/container.tsx  ← not found by grounding; check it
- components/screens/s-53/container.tsx  ← not found by grounding; check it
- components/screens/s-54/container.tsx  ← not found by grounding; check it
- components/screens/s-55/container.tsx  ← not found by grounding; check it
- components/screens/s-56/container.tsx  ← not found by grounding; check it
- components/screens/s-57/container.tsx  ← not found by grounding; check it
- components/screens/s-58/container.tsx  ← not found by grounding; check it
- components/screens/s-59/container.tsx  ← not found by grounding; check it
- components/screens/s-6/container.tsx  ← not found by grounding; check it
- components/screens/s-60/container.tsx  ← not found by grounding; check it
- components/screens/s-61/container.tsx  ← not found by grounding; check it
- components/screens/s-62/container.tsx  ← not found by grounding; check it
- components/screens/s-63/container.tsx  ← not found by grounding; check it
- components/screens/s-64/container.tsx  ← not found by grounding; check it
- components/screens/s-65/container.tsx  ← not found by grounding; check it
- components/screens/s-66/container.tsx  ← not found by grounding; check it
- components/screens/s-7/container.tsx  ← not found by grounding; check it
- components/screens/s-8/container.tsx  ← not found by grounding; check it
- components/screens/s-9/container.tsx  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: A (chosen): One vertical slice per generated screen, using the generated API client and a shared OpenAPI contract; keep cross-screen helpers inside their first consuming screen slice. | B: Build role-based feature bundles around shared service/facade modules, then connect the generated screens to those modules.
Decision: Decision: use screen-sized vertical slices against the shared OpenAPI contract and factory-generated client.
The first consuming driver slice owns its offline helper; later driver slices depend on it.
Keep generated pages, frame and navigation intact; bind behavior in each supplied container.
API-side persistence, authorization, scheduled email and gateway production remain outside this web implementation.
- TASK-1 Design-system scaffold setup → ; builds towards a later task (no criteria of its own)
- TASK-2 S-1 Sign in → REQ-2, REQ-29; builds towards a later task (no criteria of its own)
- TASK-3 S-2 One-time code → REQ-2; builds towards a later task (no criteria of its own)
- TASK-4 S-3 Request password reset → REQ-2, REQ-29; must pass AC-2.1, AC-2.2, AC-2.3, AC-2.4
- TASK-5 S-4 Set new password → REQ-29; builds towards a later task (no criteria of its own)
- TASK-6 S-5 Access refused → REQ-3, REQ-24, REQ-40; builds towards a later task (no criteria of its own)
- TASK-7 S-6 Receipts → REQ-1, REQ-3, REQ-7, REQ-27, REQ-28; builds towards a later task (no criteria of its own)
- TASK-8 S-7 Record receipt → REQ-7; builds towards a later task (no criteria of its own)
- TASK-9 S-8 Receipt detail → REQ-7, REQ-8, REQ-11, REQ-27; must pass AC-7.1, AC-7.2, AC-7.3, AC-8.1, AC-8.2, AC-8.3
- TASK-10 S-9 Stock → REQ-1, REQ-3, REQ-10, REQ-27; builds towards a later task (no criteria of its own)
- TASK-11 S-10 Handling unit → REQ-10, REQ-11, REQ-19, REQ-20, REQ-21, REQ-22, REQ-59; must pass AC-10.1, AC-10.2, AC-11.1
- TASK-12 S-11 Move stock → REQ-12; builds towards a later task (no criteria of its own)
- TASK-13 S-12 Moves → REQ-12, REQ-27; must pass AC-12.1
- TASK-14 S-13 Boxes → REQ-17, REQ-27; builds towards a later task (no criteria of its own)
- TASK-15 S-14 Pack box → REQ-16, REQ-17; must pass AC-17.1, AC-17.2, AC-17.3
- TASK-16 S-15 Opening stock → REQ-61; must pass AC-61.1, AC-61.2
- TASK-17 S-16 Cold rooms → REQ-19, REQ-20; builds towards a later task (no criteria of its own)
- TASK-18 S-17 Cold room detail → REQ-19, REQ-20, REQ-21; builds towards a later task (no criteria of its own)
- TASK-19 S-18 Dispatch orders → REQ-1, REQ-3, REQ-15, REQ-27; builds towards a later task (no criteria of its own)
- TASK-20 S-19 Dispatch order detail → REQ-6, REQ-13, REQ-15, REQ-16; builds towards a later task (no criteria of its own)
- TASK-21 S-20 Dispatch routes → REQ-1, REQ-18, REQ-27, REQ-33; builds towards a later task (no criteria of its own)
- TASK-22 S-21 Route plan → REQ-18; builds towards a later task (no criteria of its own)
- TASK-23 S-22 Route detail → REQ-6, REQ-16, REQ-18, REQ-33, REQ-34; must pass AC-18.1, AC-18.2, AC-18.3, AC-18.4, AC-33.1
- TASK-24 S-23 Box temperature → REQ-19, REQ-20, REQ-34; builds towards a later task (no criteria of its own)
- TASK-25 S-24 Delivery evidence → REQ-25, REQ-37, REQ-62; builds towards a later task (no criteria of its own)
- TASK-26 S-25 Today's routes → REQ-1, REQ-3, REQ-24, REQ-31, REQ-40; builds towards a later task (no criteria of its own)
- TASK-27 S-26 Driver route stops → REQ-24, REQ-31, REQ-34, REQ-41; builds towards a later task (no criteria of its own)
- TASK-28 S-27 Load boxes → REQ-24, REQ-32, REQ-35, REQ-36, REQ-40; must pass AC-32.1, AC-32.2, AC-32.3
- TASK-29 S-28 Stop detail → REQ-25, REQ-31, REQ-34, REQ-35, REQ-36, REQ-39; must pass AC-31.1, AC-34.1, AC-34.2
- TASK-30 S-29 Record handover → REQ-24, REQ-25, REQ-35, REQ-36, REQ-37, REQ-38, REQ-39, REQ-40, REQ-42; must pass AC-25.1, AC-25.2, AC-25.3, AC-25.4, AC-25.5, AC-35.1, AC-35.2, AC-36.1, AC-37.1, AC-38.1, AC-39.1, AC-39.2
- TASK-31 S-30 Pending work → REQ-24, REQ-40, REQ-41, REQ-42; must pass AC-40.1, AC-40.2, AC-40.3, AC-40.4, AC-40.6, AC-40.7, AC-40.10, AC-42.1
- TASK-32 S-31 Route changes → REQ-24, REQ-41; must pass AC-24.1, AC-24.2, AC-24.3, AC-24.4, AC-24.5, AC-24.6, AC-24.7, AC-24.8, AC-24.9, AC-41.1, AC-41.2, AC-41.3
- TASK-33 S-32 Quality cases → REQ-1, REQ-3, REQ-9, REQ-20, REQ-23, REQ-27; builds towards a later task (no criteria of its own)
- TASK-34 S-33 Quality review → REQ-6, REQ-9, REQ-19, REQ-20, REQ-21, REQ-22, REQ-23, REQ-43, REQ-44, REQ-45, REQ-46; must pass AC-19.1, AC-19.2, AC-19.3, AC-19.4, AC-20.1, AC-20.2, AC-20.3, AC-20.4, AC-21.1, AC-21.2, AC-22.1
- TASK-35 S-34 Signed decision → REQ-45, REQ-46; builds towards a later task (no criteria of its own)
- TASK-36 S-35 Record destruction → REQ-47; must pass AC-47.1, AC-47.2
- TASK-37 S-36 Waiting decisions → REQ-1, REQ-3, REQ-9, REQ-44, REQ-48; must pass AC-48.1
- TASK-38 S-37 Decision approval → REQ-9, REQ-43, REQ-44, REQ-45, REQ-46; must pass AC-9.1, AC-9.2, AC-9.3, AC-9.4, AC-9.5, AC-43.1, AC-43.2, AC-43.3, AC-44.1, AC-44.2, AC-44.3, AC-44.4, AC-44.5, AC-45.1, AC-45.2, AC-45.3, AC-46.1, AC-46.2
- TASK-39 S-38 Recalls → REQ-26, REQ-27, REQ-49, REQ-53; builds towards a later task (no criteria of its own)
- TASK-40 S-39 Start recall → REQ-26, REQ-49; builds towards a later task (no criteria of its own)
- TASK-41 S-40 Recall detail → REQ-26, REQ-49, REQ-50, REQ-53; must pass AC-49.1, AC-49.2, AC-49.3, AC-50.1, AC-50.2, AC-53.1, AC-53.2, AC-53.3, AC-53.4
- TASK-42 S-41 Customer orders → REQ-1, REQ-3, REQ-14, REQ-15, REQ-54; builds towards a later task (no criteria of its own)
- TASK-43 S-42 Place order → REQ-13, REQ-14; builds towards a later task (no criteria of its own)
- TASK-44 S-43 Customer order detail → REQ-6, REQ-15, REQ-16, REQ-54; must pass AC-16.1, AC-16.2, AC-16.3, AC-16.4, AC-16.5
- TASK-45 S-44 Change order → REQ-14, REQ-15; must pass AC-14.1, AC-14.2, AC-14.3, AC-14.4, AC-14.5, AC-15.1, AC-15.2, AC-15.3, AC-15.4, AC-15.5, AC-15.6
- TASK-46 S-45 Deliveries → REQ-27, REQ-54, REQ-55; builds towards a later task (no criteria of its own)
- TASK-47 S-46 Delivery detail → REQ-23, REQ-54, REQ-55, REQ-62; must pass AC-23.1, AC-62.1, AC-62.2
- TASK-48 S-47 Certificates → REQ-55, REQ-56, REQ-57; must pass AC-55.1, AC-55.2, AC-56.1, AC-56.2
- TASK-49 S-48 Recall notices → REQ-26, REQ-51, REQ-54; must pass AC-54.1, AC-54.2
- TASK-50 S-49 Recall response → REQ-26, REQ-51, REQ-52; must pass AC-26.1, AC-26.2, AC-26.3, AC-26.4, AC-26.5, AC-26.6, AC-26.7, AC-51.1, AC-52.1, AC-52.2, AC-52.3, AC-52.4
- TASK-51 S-50 Customer account → REQ-13, REQ-28, REQ-57; must pass AC-28.1, AC-28.2, AC-57.1, AC-57.2
- TASK-52 S-51 Customer addresses → REQ-1, REQ-3, REQ-13; builds towards a later task (no criteria of its own)
- TASK-53 S-52 Customer team → REQ-3, REQ-4; must pass AC-4.1, AC-4.2
- TASK-54 S-53 Products → REQ-1, REQ-3, REQ-5, REQ-27; must pass AC-1.1, AC-1.2
- TASK-55 S-54 Product detail → REQ-5, REQ-27; builds towards a later task (no criteria of its own)
- TASK-56 S-55 Temperature profiles → REQ-5, REQ-6; must pass AC-6.1, AC-6.2, AC-6.3, AC-6.4
- TASK-57 S-56 New profile version → REQ-5; must pass AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5, AC-5.6
- TASK-58 S-57 Organisations → REQ-13, REQ-27; builds towards a later task (no criteria of its own)
- TASK-59 S-58 Organisation detail → REQ-13, REQ-30; must pass AC-13.1, AC-13.2, AC-13.3
- TASK-60 S-59 Accounts → REQ-27, REQ-30; builds towards a later task (no criteria of its own)
- TASK-61 S-60 Account detail → REQ-27, REQ-29, REQ-30; must pass AC-29.1, AC-29.2, AC-29.3, AC-29.4, AC-29.5, AC-29.6, AC-30.1, AC-30.2
- TASK-62 S-61 Audit trail → REQ-27, REQ-58; builds towards a later task (no criteria of its own)
- TASK-63 S-62 Reports → REQ-27, REQ-60; builds towards a later task (no criteria of its own)
- TASK-64 S-63 Lot history → REQ-27, REQ-59; builds towards a later task (no criteria of its own)
- TASK-65 S-64 Auditor audit trail → REQ-3, REQ-27, REQ-58; must pass AC-58.1, AC-58.2, AC-58.3
- TASK-66 S-65 Auditor lot history → REQ-3, REQ-59; must pass AC-59.1, AC-59.2
- TASK-67 S-66 Auditor reports → REQ-3, REQ-27, REQ-60; must pass AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-27.1, AC-27.2, AC-60.1, AC-60.2, AC-60.3

Stub commit (throws NotImplemented until implemented): components/screens/s-25/route-cache.ts, components/screens/s-27/driver-work-store.ts

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /api/auth/staff/authorization-url -> 200, 401, 500
- POST /api/auth/customer/sign-in -> 200, 400, 401, 403, 500
- POST /api/auth/customer/code/verify -> 200, 400, 401, 403, 500
- POST /api/auth/customer/code/resend -> 200, 400, 401, 403, 500
- POST /api/auth/password-reset -> 200, 400, 500
- GET /api/auth/password-reset/{token} -> 200, 400, 404, 500
- POST /api/auth/password-reset/{token}/complete -> 200, 400, 404, 500
- GET /api/warehouse/receipts -> 200, 401, 403, 500
- POST /api/warehouse/receipts -> 200, 400, 401, 403, 409, 500
- GET /api/warehouse/receipts/{receiptId} -> 200, 401, 403, 404, 500
- POST /api/warehouse/receipts/{receiptId}/logger -> 200, 400, 401, 403, 404, 500
- POST /api/warehouse/receipts/{receiptId}/evidence -> 200, 400, 401, 403, 404, 500
- GET /api/warehouse/stock -> 200, 401, 403, 500
- GET /api/warehouse/stock/{unitId} -> 200, 401, 403, 404, 500
- POST /api/warehouse/stock/{unitId}/moves -> 200, 400, 401, 403, 404, 409, 500
- GET /api/warehouse/moves -> 200, 401, 403, 500
- POST /api/warehouse/opening-stock -> 200, 400, 401, 403, 409, 500
- GET /api/warehouse/boxes -> 200, 401, 403, 500
- POST /api/warehouse/boxes/{boxId}/pack -> 200, 400, 401, 403, 404, 409, 500
- GET /api/warehouse/cold-rooms -> 200, 401, 403, 500
- GET /api/warehouse/cold-rooms/{roomId} -> 200, 401, 403, 404, 500
- GET /api/temperature-history -> 200, 401, 403, 404, 500
- GET /api/dispatch/orders -> 200, 401, 403, 500
- GET /api/dispatch/orders/{orderId} -> 200, 401, 403, 404, 500
- POST /api/dispatch/orders/{orderId}/allocation-override -> 200, 400, 401, 403, 404, 409, 500
- POST /api/dispatch/orders/{orderId}/cancel -> 200, 401, 403, 404, 409, 500
- GET /api/dispatch/routes -> 200, 401, 403, 500
- POST /api/dispatch/routes -> 200, 400, 401, 403, 409, 500
- GET /api/dispatch/routes/{routeId} -> 200, 401, 403, 404, 500
- PATCH /api/dispatch/routes/{routeId} -> 200, 400, 401, 403, 404, 409, 500
- POST /api/dispatch/routes/{routeId}/confirm -> 200, 401, 403, 404, 409, 500
- GET /api/driver/routes -> 200, 401, 403, 500
- GET /api/driver/routes/{routeId} -> 200, 401, 403, 404, 500
- POST /api/driver/routes/{routeId}/scans -> 200, 400, 401, 403, 404, 409, 500
- POST /api/driver/routes/{routeId}/departure -> 200, 401, 403, 404, 409, 500
- POST /api/driver/actions/sync -> 200, 400, 401, 403, 409, 500
- POST /api/driver/handovers -> 200, 400, 401, 403, 404, 409, 500
- GET /api/dispatch/deliveries/{deliveryId}/evidence -> 200, 401, 403, 404, 500
- GET /api/quality/cases -> 200, 401, 403, 500
- GET /api/quality/cases/{caseId} -> 200, 401, 403, 404, 500
- POST /api/quality/cases/{caseId}/dispositions -> 200, 400, 401, 403, 404, 409, 500
- POST /api/quality/decisions/{decisionId}/supersede -> 200, 400, 401, 403, 404, 409, 500
- GET /api/quality/decisions/waiting -> 200, 401, 403, 500
- POST /api/quality/proposals/{proposalId}/decision -> 200, 400, 401, 403, 404, 409, 500
- POST /api/quality/stock/{unitId}/destruction -> 200, 400, 401, 403, 404, 409, 500
- GET /api/quality/recalls -> 200, 401, 403, 500
- POST /api/quality/recalls -> 200, 400, 401, 403, 409, 500
- GET /api/quality/recalls/{recallId} -> 200, 401, 403, 404, 500
- GET /api/quality/recalls/{recallId}/trace -> 200, 401, 403, 404, 500
- POST /api/quality/recalls/{recallId}/close -> 200, 400, 401, 403, 404, 409, 500
- POST /api/quality/recalls/{recallId}/write-offs -> 200, 400, 401, 403, 404, 409, 500
- GET /api/customer/orders -> 200, 401, 403, 500
- POST /api/customer/orders -> 200, 400, 401, 403, 409, 500
- GET /api/customer/orders/{orderId} -> 200, 401, 403, 404, 500
- PATCH /api/customer/orders/{orderId} -> 200, 400, 401, 403, 404, 409, 500
- POST /api/customer/orders/{orderId}/cancel -> 200, 401, 403, 404, 409, 500
- GET /api/customer/deliveries -> 200, 401, 403, 500
- GET /api/customer/deliveries/{deliveryId} -> 200, 401, 403, 404, 500
- GET /api/customer/deliveries/{deliveryId}/certificates -> 200, 401, 403, 404, 500
- GET /api/customer/deliveries/{deliveryId}/certificates/{certificateId}/file -> 200, 401, 403, 404, 500
- GET /api/customer/recalls -> 200, 401, 403, 500
- POST /api/customer/recalls/{recallId}/deliveries/{deliveryId}/response -> 200, 400, 401, 403, 404, 409, 500
- GET /api/customer/account -> 200, 401, 403, 500
- PATCH /api/customer/account -> 200, 400, 401, 403, 500
- GET /api/customer-admin/addresses -> 200, 401, 403, 500
- POST /api/customer-admin/addresses -> 200, 400, 401, 403, 409, 500
- DELETE /api/customer-admin/addresses/{addressId} -> 200, 401, 403, 404, 409, 500
- PATCH /api/customer-admin/addresses/{addressId} -> 200, 400, 401, 403, 404, 500
- GET /api/customer-admin/team -> 200, 401, 403, 500
- POST /api/customer-admin/team -> 200, 400, 401, 403, 409, 500
- DELETE /api/customer-admin/team/{accountId} -> 200, 401, 403, 404, 500
- GET /api/admin/products -> 200, 401, 403, 500
- POST /api/admin/products -> 200, 400, 401, 403, 409, 500
- GET /api/admin/products/{productId} -> 200, 401, 403, 404, 500
- PATCH /api/admin/products/{productId} -> 200, 400, 401, 403, 404, 409, 500
- POST /api/admin/products/{productId}/deactivate -> 200, 401, 403, 404, 409, 500
- GET /api/admin/products/{productId}/profiles -> 200, 401, 403, 404, 500
- POST /api/admin/products/{productId}/profiles -> 200, 400, 401, 403, 404, 409, 500
- GET /api/admin/organizations -> 200, 401, 403, 500
- GET /api/admin/organizations/{organizationId} -> 200, 401, 403, 404, 500
- PATCH /api/admin/organizations/{organizationId} -> 200, 400, 401, 403, 404, 500
- GET /api/admin/accounts -> 200, 401, 403, 500
- POST /api/admin/accounts -> 200, 400, 401, 403, 409, 500
- GET /api/admin/accounts/{accountId} -> 200, 401, 403, 404, 500
- PATCH /api/admin/accounts/{accountId} -> 200, 400, 401, 403, 404, 409, 500
- POST /api/admin/accounts/{accountId}/deactivate -> 200, 401, 403, 404, 409, 500
- GET /api/audit/events -> 200, 401, 403, 500
- GET /api/reports -> 200, 400, 401, 403, 500
- GET /api/lots/{lotId}/history -> 200, 401, 403, 404, 500

## Critic findings (55)
- [high] REQ-21 REQ-21 lists ASM-18 as a source, which keeps gap-affected stock On Hold until resolved, but the same requirement (per Q-11/ASM-2) says the screen must not infer On Hold from a gap; the sources contradict each other and nothing settles which wins.
- [high] REQ-24 REQ-24 and REQ-3 cite ASM-1 and ASM-17 ('No; online only'), yet REQ-24 queues offline driver actions and later syncs them under Q-10, so the sources state opposite rules for queued actions.
- [high] REQ-6 AC-6.1 and AC-6.3 show API-recalculated 'decision values' after a profile change, but no criterion requires that a changed not-permitted-range disposition goes back through the Quality Officer proposal and different-Quality-Manager approval required by Q-1/REQ-9.
- [medium] REQ-2 Staff sign-in through 'Meridian Microsoft accounts' and a customer one-time-code step are not in any intent span or human answer (ASM-23's answer only states email, password and a reset link), so the identity provider and the second factor are unanchored.
- [low] REQ-2 AC-2.1 names the 'Meridian Microsoft' sign-in option directly instead of treating the staff identity provider or tenant as configuration.
- [medium] REQ-2 AC-2.2 covers only the code-entry screen and has no criterion for a wrong, expired or repeatedly failed one-time code, or for a resend.
- [medium] REQ-14 AC-14.3 says the screen 'shows only returned eligible dates' and also that it 'applies the next-working-day rule' for before and after cut-off, so it is unclear whether the browser computes eligibility or only displays what the API returns.
- [medium] REQ-24 'The workday ends' triggers clearing of cached route and recipient data in REQ-24, AC-24.7 and AC-24.8, but nothing defines when a workday ends or in which time zone (driver device or serving warehouse per ASM-6).
- [low] REQ-24 In AC-24.4 the action is shown 'as rejected or no longer queued', and the EARS says queued actions are 'erased or marked rejected', so the expected end state has two acceptable outcomes and cannot be checked deterministically.
- [low] REQ-9 AC-9.4 accepts either 'shows the returned error message or disables the approval control', so a test cannot tell which behaviour is required when the proposer tries to approve their own disposition.
- [medium] REQ-19 No criterion covers empty states (no temperature readings, no stock rows, a filter with no matches, no alerts), even though lists and histories appear throughout REQ-3, REQ-10, REQ-19, REQ-20 and REQ-27.
- [medium] REQ-12 Several write flows have only a success criterion, with no API-refusal or network-failure path: stock movement (AC-12.1), address changes (AC-13.1), box sealing (AC-17.3) and route creation (AC-18.1).
- [low] REQ-10 AC-10.1 asserts that the returned status quantities sum to on-hand but does not say what the screen shows if the API returns figures that do not reconcile.
- [medium] REQ-15 AC-15.6 lets a Dispatcher cancel a Packed-or-later order, but no criterion says what the screen shows for the already packed box, its logger, or its place on a route after the cancellation.
- [medium] REQ-26 AC-26.6 allows a recall to be closed without saying whether closing is allowed, blocked or warned while AC-26.4's unreconciled quantities are still outstanding.
- [medium] REQ-5 AC-5.5 deactivates a product without covering what open orders, allocations or profile versions referencing it show afterwards, and the 'today' in AC-5.6 has no defined time zone.
- [medium] REQ-3 I-7 asks for role and warehouse access controls, but no requirement gives System Administrators a screen to assign staff roles or warehouses, or to disable accounts; only Customer Administrator invite and remove exists (REQ-4).
- [low] REQ-3 AC-3.2 grants Quality Managers and Auditors all-warehouse views, but this scope is not anchored in any intent span or human answer.
- [low] REQ-3 AC-3.3 requires an 'API-refused write' to be shown as an error on Auditor pages that, by the same criterion, have no create, edit or delete controls, so that error path cannot be reached through the UI.
- [low] REQ-8 To reconcile ASM-9 with ASM-21, REQ-8 adds a separate 'receipt-evidence' image/PDF upload that no intent span or answer asks for.
- [low] REQ-8 AC-8.1 relies on a 'configured supplier interface format' whose documentation, per ASM-8, Meridian has not yet provided, so no client-side validation of the logger file can be specified or tested.
- [low] REQ-22 REQ-22 repeats REQ-21's gap behaviour (status and budget shown without an estimated tier charge), and its stability is 0.33, so the two requirements overlap and could drift apart.
- [medium] NFR-4 NFR-4 states volumes (1,000 users, 100,000 records, 5,000 devices) but sets no observable web-side target such as list or chart load time or pagination behaviour at that volume.
- [low] REQ-27 AC-27.1 says the CSV contains 'the displayed or filtered records', which leaves open whether it holds the current page or the full filtered set, and no criterion covers which roles may export records containing recipient names.
- [low] REQ-15 REQ-15 cites Q-6 (addresses and shelf life) as a source for the order change and cancellation rules, and REQ-26 cites Q-1 for recalls; neither source supports the requirement it is attached to.
- [low] REQ-28 No criterion covers the default language, whether the language choice persists across sessions, or how left-to-right identifiers such as lot codes and numbers render inside right-to-left Arabic pages.
- [medium] NFR-4 NFR-4 starts the 60-second trace budget when the response arrives, while NFR-5 starts it when the user makes the request, so the two give different pass conditions for the same lot-trace display.
- [low] NFR-4 NFR-4 comes from Q-40's 'assumed launch scale', and REQ-22 cites ASM-7 (1,000 users / 100,000 records), but Q-16 rejected adding any scale target.
- [high] REQ-44 AC-16.1 picks the single-person controls when an eligible Quality Officer 'opens the decision form' based on whether 'the proposed decision matches the recommendation', but the decision is not proposed until the officer is inside that form, which clashes with AC-16.4 ('when a user prepares the decision').
- [medium] REQ-44 AC-16.4 also requires a two-person proposal and a different Quality Manager's approval when a decision opposes the recommendation, but the request (Q-26) lets a Quality Officer decide alone inside tier 1 with allowance left and only asks for a written justification on an opposing decision.
- [high] REQ-44 There is no path for a Quality Manager declining or returning a Quality Officer's proposal, and no state for a declined proposal, so a two-person decision can only end in approval.
- [high] REQ-45 AC-17.1 requires identity confirmation at signing but has no criterion for a failed confirmation (wrong password) or an expired session, for example that nothing is shown as signed and the reason entered is kept.
- [medium] REQ-46 AC-18.2 adds a rule that a superseding disposition is rejected after the stock was delivered or destroyed; no answer contains this rule, and ASM-1 says the superseding decision is applied to the stock and its order/route state.
- [medium] REQ-47 The destruction quantity is checked only against 'the displayed rejected quantity', so several destruction entries for the same rejected stock can each pass and together exceed it; the requirement does not say the check uses the quantity still undestroyed.
- [medium] REQ-47 Destruction entry has no role or access-denied criterion and does not say who may record destruction or witness it, unlike the other staff screens.
- [medium] REQ-52 AC-24.3 expects 'a validation error or returned error message' and also 'sends no invalid response request', which cannot both hold: a returned error requires the request to have been sent.
- [medium] REQ-52 AC-24.4 lets a customer revise quantities but does not say what happens after the unaccounted remainder has been written off or the recall has been closed.
- [medium] REQ-53 The write-off has no criterion for a non-Quality-Manager user (Q-6 limits it to a Quality Manager), and does not say whether the 'signed justification' requires the identity re-confirmation used in REQ-17.
- [medium] REQ-49 AC-21.1 and AC-21.2 require a 'signature' on recall start and close without saying what that signature is (identity re-confirmation as in REQ-17, or something else), and AC-21.3's 'not identified as eligible' names no role.
- [high] REQ-37 Handover has no validation path for a missing receiver name, signature or photo, and none for camera permission being denied or the photo capture failing.
- [medium] REQ-39 No criterion stops a refusal from being submitted when a refused box has no reason, although the requirement makes a reason mandatory for each refused box.
- [medium] REQ-32 Departure is blocked until wrong boxes are 'removed or corrected', but no criterion defines how the driver un-scans, removes or corrects a wrong-route box to clear the block.
- [medium] REQ-31 There is no empty state for a driver with no routes today, and no criterion that today's route and expected boxes stay available offline, which REQ-12's offline loading and handover depend on.
- [medium] REQ-41 The spec requires 'resolution' of affected unsent work but never lists the ways it can be resolved (discard, reassign, keep), and only covers route differences when unsent work exists, although the requirement says differences are always shown.
- [medium] REQ-34 There is no criterion for the gateway feed being unavailable or returning no data while the browser is online, and no rule for how old data must be before it counts as stale beyond 'disconnected'.
- [medium] REQ-30 Account management does not say how a newly created account gets its first password (invite or set-password link), and has no validation criteria such as a duplicate email.
- [medium] REQ-30 Deactivating an account does not say what happens to that user's active sessions, routes assigned to a deactivated driver, or that driver's offline queued work.
- [low] REQ-30 The spec relies on roles (Driver, Dispatcher, Quality Officer, Quality Manager, Auditor, System Administrator, customer) that REQ-2 assigns but never lists or defines, so the permission checks in REQ-30 and REQ-31 rest on undefined role names.
- [low] REQ-33 Dispatcher route monitoring, recall trace (REQ-22) and waiting decisions (REQ-20) have no access-denied criterion, while the other staff screens do.
- [medium] REQ-43 AC-15.2 refers to users viewing tier-limit 'settings', but no requirement provides a screen to view or configure the single set of tier limits and allowances from Q-8, or says who may change it.
- [low] REQ-57 There is no criterion for an account with no configured time zone, for where the user chooses English or Arabic, or for which time zone staff and driver screens use.
- [medium] REQ-61 Opening-inventory entry is not limited to launch and has no rule against duplicate lots, so after go-live it stays a way to create stock outside receiving, which affects lot history and recall totals.
- [low] REQ-54 Customer order views have no empty state for an organisation with no orders, and AC-26.1 assumes one organisation per customer although Q-2 lets an administrator assign customer-organisation access without limiting it to one.
- [low] REQ-60 The 60-minute on-time window and the 60-day expiry horizon are fixed in the report definitions rather than set as configuration, as is the four-hour escalation threshold in REQ-20.
- [low] REQ-31 REQ-3, REQ-5 and REQ-12 cite ASM-5 (fixed browser versions), and REQ-29 cites ASM-6 and ASM-18 (WCAG 2.1 AA), but the human rejected those assumptions in Q-14 and Q-15, so these sources are wrong.

## Still open after 0 repairs
- [critic high] REQ-21 REQ-21 lists ASM-18 as a source, which keeps gap-affected stock On Hold until resolved, but the same requirement (per Q-11/ASM-2) says the screen must not infer On Hold from a gap; the sources contradict each other and nothing settles which wins.
- [critic high] REQ-24 REQ-24 and REQ-3 cite ASM-1 and ASM-17 ('No; online only'), yet REQ-24 queues offline driver actions and later syncs them under Q-10, so the sources state opposite rules for queued actions.
- [critic high] REQ-6 AC-6.1 and AC-6.3 show API-recalculated 'decision values' after a profile change, but no criterion requires that a changed not-permitted-range disposition goes back through the Quality Officer proposal and different-Quality-Manager approval required by Q-1/REQ-9.
- [critic high] REQ-16 AC-16.1 picks the single-person controls when an eligible Quality Officer 'opens the decision form' based on whether 'the proposed decision matches the recommendation', but the decision is not proposed until the officer is inside that form, which clashes with AC-16.4 ('when a user prepares the decision').
- [critic high] REQ-16 There is no path for a Quality Manager declining or returning a Quality Officer's proposal, and no state for a declined proposal, so a two-person decision can only end in approval.
- [critic high] REQ-17 AC-17.1 requires identity confirmation at signing but has no criterion for a failed confirmation (wrong password) or an expired session, for example that nothing is shown as signed and the reason entered is kept.
- [critic high] REQ-9 Handover has no validation path for a missing receiver name, signature or photo, and none for camera permission being denied or the photo capture failing.

## Settled by questions, and open risks
- Spec check: "Support the latest two versions of Chrome, Edge, Safari, and Firefox, and support the stated first-year user and record volume and simultaneous device volume." is in scope. The request asks for it: "The system shall be sized for 5,000 devices reporting at once."
- Spec question m1 Q-9: The 28 requirements are estimated at about four runs of work. How would you like the scope handled? → Split the full scope across about four runs; keep all requirements. (answered)
- Spec question m1 Q-10: What should happen to unsynchronized driver actions when a driver signs out or the API reports the account disabled, especially if another user later signs in on the same browser? → Retain unsynchronized actions in a queue tied to the originating driver; sync only after that same driver signs in again, and erase or reject the queue if access is refused or the account is disabled. (answered)
- Spec question m1 Q-10: What should happen to unsynchronized driver actions when a driver signs out or the API reports the account disabled, especially if another user later signs in on the same browser? → Retain unsynchronized actions in a queue tied to the originating driver; sync only after that same driver signs in again, and erase or reject the queue if access is refused or the account is disabled. (answered)
- Spec question m1 Q-11: When a temperature-history gap affects stock, should the stock be automatically placed On Hold while the gap is unresolved, or should the gap be flagged for review without automatically changing stock status? → Flag the gap for review and show the API-returned stock status; do not automatically place the stock On Hold. (answered)
- Spec question m1 Q-12: May a temperature-profile version have an effective date in the past, and if so, how should recalculated results affect stock that was already released or had a quality decision? → Require effective dates to be today or later; do not recalculate earlier decisions. (answered)
- Spec question m1 Q-14: If an offline handover is queued and the API returns a restriction because the stock went On Hold or was recalled, how should the app handle that recorded handover? → Do not mark the delivery as completed; show the returned restriction and leave the affected quantity outstanding for follow-up. (answered)
- Spec question m1 Q-15: Q-10 settles that queued actions stay tied to the originating driver across sign-out and workday end, and are erased or rejected if access is refused or the account is disabled. Should any additional local protection or expiry rule apply to queued actions containing recipient names on a shared browser? → Keep the existing same-driver access rule and retain queued actions until sync or API rejection/refusal; add no local encryption or expiry. (answered)
- Open risk: L6 scope: out-of-scope list is empty; say explicitly what isn't changing
- Open risk: REQ-21 lists ASM-18 as a source, which keeps gap-affected stock On Hold until resolved, but the same requirement (per Q-11/ASM-2) says the screen must not infer On Hold from a gap; the sources contradict each other and nothing settles which wins.
- Open risk: REQ-24 and REQ-3 cite ASM-1 and ASM-17 ('No; online only'), yet REQ-24 queues offline driver actions and later syncs them under Q-10, so the sources state opposite rules for queued actions.
- Open risk: AC-6.1 and AC-6.3 show API-recalculated 'decision values' after a profile change, but no criterion requires that a changed not-permitted-range disposition goes back through the Quality Officer proposal and different-Quality-Manager approval required by Q-1/REQ-9.
- Spec check: "Show drivers only their assigned routes for today, with each route’s stops in route order." is in scope. The request asks for it: "The driver sees today's route with its stops in order."
- Spec check: "Compare scanned shipper boxes with expected boxes before departure, report missing or wrong-route boxes, and block departure until every expected box is scanned and wrong boxes are removed or corrected." is in scope. The request asks for it: "Loading requires every box on the route to be scanned, and a wrong or missing box is reported."
- Spec check: "Show dispatchers each route stop’s status and last-updated time." is in scope. The request asks for it: "The dispatcher sees each stop's status and the time it was last updated."
- Spec check: "Show each route box’s latest available temperature, status, and gateway alerts, and mark cached temperature data as stale while disconnected." is in scope. The request asks for it: "During the route the application shows the current temperature and status of each box and any alerts."
- Spec check: "For scanned boxes on hold, display “Do not deliver” and the returned hold reason, and prevent handover of those boxes." is in scope. The request asks for it: "If a box holds stock that is On Hold, the application shows "Do not deliver" for that box and does not allow it to be handed over."
- Spec check: "Let drivers record eligible handovers with receiver name, signature, delivery photo, actual handover time, and available browser location." is in scope. The request asks for it: "For the remaining boxes, the driver records the receiver's name, captures their signature and a photo of the delivered boxes, and completes the handover. The time and location are recorded automatically."
- Spec check: "When an assigned route changes while a driver is offline, show route differences, require review and resolution of affected unsent work before continuing, and preserve completed offline handovers." is in scope. The request asks for it: "If the route was changed while the driver was offline, the driver is shown the difference before continuing, and a handover already completed offline is never lost or undone."
- Spec check: "Present a single-person quality-decision flow only when an excursion is within the first tier above or below the permitted band, allowance remains, and the proposed decision matches the recommendation. Otherwise require a Quality Officer proposal and separate approval by a different Quality Manager. Require written justification when a decision opposes the recommendation." is in scope. The request asks for it: "The system shows the reviewer the full temperature history, the budget used and remaining per tier, and a recommendation: Release when every tier still has allowance left, Reject when any tier is used up or a not-permitted range was reached."
- Spec check: "Require identity confirmation using the account’s sign-in method and a reason when a user signs a quality decision; present signed decisions as read-only with a separate superseding-decision action." is in scope. The request asks for it: "Each decision is signed electronically: the person confirms their identity again at the moment of signing and gives a reason. A signed decision cannot be edited. It can only be superseded by a new signed decision, and both remain on record."
- Spec check: "When the service returns a quality disposition, show resulting stock, order, and route status and, when superseded, the earlier and current disposition." is in scope. The request asks for it: "If the excursion stayed within the first tier above or below the band and allowance remains, a Quality Officer may decide alone."
- Spec check: "Collect destruction date, quantity, and witness for rejected stock, and prevent entry of a quantity greater than the displayed rejected quantity." is in scope. The request asks for it: "Destruction is recorded with a date, a quantity and a witness."
- Spec check: "Identify decisions waiting more than four hours as escalated in the Quality Manager’s waiting-decisions view." is in scope. The request asks for it: "Decisions waiting longer than 4 hours are escalated to the Quality Manager."
- Spec check: "Provide a Quality Manager flow to start and close recalls with signed actions; recall start collects product, one or more lots, reason, and severity, and the app displays each returned action result." is in scope. The request asks for it: "A Quality Manager starts a recall for a product and one or more lot numbers, with a reason and a severity."
- Spec check: "Display the returned recall trace, including warehouse locations, boxes, routes, customer deliveries, quantities, delivery dates, receivers, and the trace total alongside received quantity when supplied." is in scope. The request asks for it: "The trace from lot to every location and customer shall be available within one minute of the request."
- Spec check: "Show customer recall notices in the portal, link notices to affected deliveries, and provide a response entry point." is in scope. The request asks for it: "Notifies those customers by email and in the customer portal."
- Spec check: "Show customers only their organisation’s current and past orders, allocated lots and expiry dates, order status, and in-transit delivery arrival and temperature status, without exposing other route customers." is in scope. The request asks for it: "The customer portal shows the organisation's orders, their status, the lots and expiry dates allocated, and for deliveries on the road the planned arrival time and whether the temperature is in range."
- Spec check: "Provide a PDF certificate for each completed delivery in the signed-in customer’s organisation, containing products, lots, expiry dates, quantities, receiver, handover time, each box’s temperature chart from sealing to handover, excursions, and signed excursion decisions." is in scope. The request asks for it: "After delivery, the customer can download a delivery certificate as a PDF for each delivery."
- Spec check: "When late readings produce a new certificate version, list the new and earlier versions for the signed-in customer’s completed delivery and keep each available for download." is in scope. The request asks for it: "Each affected customer responds in the portal with, for each delivery, how many packs are still on hand, how many were used or dispensed, and how many were destroyed on site."
- Spec check: "Present the customer portal and certificates in the user’s selected English or Arabic, render Arabic right to left including tables and charts, and show dates and times in the account’s configured time zone." is in scope. The request asks for it: "Recall progress shows the percentage of packs accounted for."
- Spec check: "Provide an audit-trail screen showing returned entries with actor, time, changed fields, old and new values, and supplied reason; support filters by record, user, date range, and action type, and export the filtered view." is in scope. The request asks for it: "A customer sees current and past orders of their own organisation only."
- Spec check: "Show the returned history of a lot from receipt through delivery or destruction in time order." is in scope. The request asks for it: "The certificate contains the contents by lot, the handover details, the temperature chart, and any excursions with their decisions."
- Spec check: "Provide on-screen reports for selected date ranges and warehouses, with CSV export of displayed figures, covering excursion counts and rates by route, driver, vehicle, and shipper box type; packs rejected and destroyed by product and cause; on-time deliveries within 60 minutes of planned arrival and in-full deliveries when every ordered pack is handed over, each as a percentage; average time from excursion to decision; stock within 60 days of expiry by product and warehouse; and open recalls and their progress." is in scope. The request asks for it: "The same figures shall be available on screen for any date range, filterable by warehouse."
- Spec check: "Make the web app responsive on phone, tablet, and desktop browsers, with touch-sized controls on narrow screens." is in scope. The request asks for it: "The portal and the certificate are available in English and Arabic according to the user's preference."
- Spec check: "Render the full recall trace returned by the service for the assumed launch scale." is in scope. The request asks for it: "The trace lists every warehouse location, box, route and customer delivery for the lot, with quantities."
- Spec question m2 Q-9: Should this 34-requirement scope be approved as one run, split into multiple runs, or reduced? → Split the work into about three runs without cutting requirements. (answered)
- Spec question m2 Q-10: If a driver's session expires while the browser is offline, may the driver continue recording loading, handover, and refusal work? → Allow local recording after expiry, but require the driver to re-authenticate before queued work can sync. (answered)
- Spec question m2 Q-11: Should recall blocking and conflict handling extend to offline cached recall information, or apply only once the service is reachable? The request separately requires retaining and flagging an offline handover that conflicts with a hold. → Apply recall blocks from the service while online; do not add offline-cache recall blocking or a separate recall-conflict quality-case flow. (answered)
- Spec question m2 Q-11: Should recall blocking and conflict handling extend to offline cached recall information, or apply only once the service is reachable? The request separately requires retaining and flagging an offline handover that conflicts with a hold. → Apply recall blocks from the service while online; do not add offline-cache recall blocking or a separate recall-conflict quality-case flow. (answered)
- Spec question m2 Q-12: If the browser denies or cannot provide location, should an otherwise eligible handover still be allowed? → Allow the handover and record the location as unavailable. (answered)
- Spec question m2 Q-13: Should the offline queue include safeguards beyond the requested local work retention and automatic sending, such as account isolation, re-authentication, retry identifiers, and review of permanently rejected payloads? → Keep the requested offline queue and automatic sending, without adding the extra account-isolation and rejected-payload review rules. (answered)
- Spec question m2 Q-14: Should the web app have a formal browser support requirement for the latest two versions of Chrome, Edge, Safari, and Firefox? → Do not add a fixed browser-version support requirement. (answered)
- Spec question m2 Q-15: Should WCAG 2.1 AA conformance be added as an acceptance requirement for the main flows? → Do not add a formal WCAG 2.1 AA requirement. (answered)
- Spec question m2 Q-16: Should a first-year product scale target be defined in this scope, in addition to the requested one-minute lot-trace availability? → Do not add a first-year product scale target; retain the explicitly requested lot-trace timing. (answered)
- Spec question m2 Q-41: How should the web app complete password reset after a user opens the reset link, including when the link is invalid or expired? → Open a form to set a new password; for an invalid or expired link, explain that it cannot be used and let the user request another reset email. (answered)
- Open risk: AC-16.1 picks the single-person controls when an eligible Quality Officer 'opens the decision form' based on whether 'the proposed decision matches the recommendation', but the decision is not proposed until the officer is inside that form, which clashes with AC-16.4 ('when a user prepares the decision').
- Open risk: There is no path for a Quality Manager declining or returning a Quality Officer's proposal, and no state for a declined proposal, so a two-person decision can only end in approval.
- Open risk: AC-17.1 requires identity confirmation at signing but has no criterion for a failed confirmation (wrong password) or an expired session, for example that nothing is shown as signed and the reason entered is kept.
- Open risk: Handover has no validation path for a missing receiver name, signature or photo, and none for camera permission being denied or the photo capture failing.

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

## Decide
  factory approve 20261012-meridian-coldchain-platform-in-9fcb <hash> --note "your risk note"
  factory reject  20261012-meridian-coldchain-platform-in-9fcb <hash> --reason "why"

Card hash: 3a43a510