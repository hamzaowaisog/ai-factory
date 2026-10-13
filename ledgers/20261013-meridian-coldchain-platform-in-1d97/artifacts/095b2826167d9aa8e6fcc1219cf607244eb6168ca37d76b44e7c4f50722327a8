# Questions before the spec (round 1)

Run 20261013-meridian-coldchain-platform-in-1d97. Your request:
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

**Q-1** Should the backend persist and execute the broader product workflows only when an operation in the locked OpenAPI contract exposes them, or should it also build data/workflows for capabilities that the contract does not expose?
  A. Implement the data and business rules needed by contracted operations only; do not add uncontracted API operations.   ← recommended: This preserves the locked API surface and limits data work to what the request explicitly asks the API to back.
  B. Also model and execute narrative workflows even when no contracted operation exposes them, without adding API operations.
  C. Add API operations for narrative workflows that are not in the locked contract.
  (why it matters: Determines which records and domain workflows exist in the backend.)

**Q-2** For contracted operations, should access enforcement include the detailed warehouse, organisation, and role restrictions described in the user stories, beyond whatever security is declared in the OpenAPI contract?
  A. Enforce only the security rules declared in the OpenAPI contract.
  B. Enforce the user stories' explicit restrictions on contracted data: customer-organisation isolation, warehouse assignments, staff roles, and Auditor read-only access, without changing the API surface.   ← recommended: These access limits are stated acceptance criteria and can be applied to contracted operations without adding API behavior.
  C. Apply additional role-specific permissions beyond those described in the contract and user stories.
  (why it matters: Changes which users can see or mutate customer, warehouse, and regulated records.)

**Q-3** Where the contracted receipt operations expose stock receipt behavior, which of the narrative receipt and quality rules must the API enforce and persist?
  A. Persist and return only the fields and behavior specified by the contract.
  B. Apply the explicit receipt rules where exposed: separate traceable receipt records even for repeated product/lot pairs, quarantine on receipt, Quality Officer release, and the stated expiry restrictions.   ← recommended: This honors the receipt acceptance criteria while limiting implementation to behavior reachable through the locked contract.
  C. Implement the full receipt, inbound-logger, stability-budget, storage-location, and stock-movement workflow regardless of whether contracted operations expose it.
  (why it matters: Determines stock records, release state, and whether stock may be allocated.)

**Q-4** For contracted customer-order and allocation operations, how much of the described order lifecycle should be implemented beyond basic persistence of contract fields?
  A. Persist contract-defined order changes only; do not add narrative validation, allocation, cancellation, or back-order rules.
  B. Apply the explicit order rules where exposed: customer changes/cancellation only before packing, duplicate-submission protection, suitable-stock allocation, and the stated allocation and back-order behavior.   ← recommended: This applies stated order acceptance criteria to existing operations without inventing API operations.
  C. Implement the entire narrative order and allocation lifecycle, including all stock replacement, dispatcher override, and concurrent-submission behavior, even where no contracted operation exposes it.
  (why it matters: Changes order state, stock allocation, and which customers receive available stock.)

**Q-5** How broad should the audit history be for contracted data changes? The request requires an audit trail and says records can be changed after the fact, but does not define the complete event set or immutability behavior.
  A. Store actor and time for consequential changes and decisions exposed by contracted operations.   ← recommended: This meets the stated audit intent for consequential API changes without imposing a broader audit system.
  B. Keep a complete append-only history of every record change, including before/after values and the actor and time.
  C. Persist current record values only; provide audit details only if directly required by the contract.
  (why it matters: Determines whether regulated decisions and record changes can be traced to a person and time.)

Assumed unless you say otherwise:
- ASM-1 (high risk, confirm on the approval card): What authentication integration is expected behind the contract's staff authorization-URL operation and the described customer sign-in? → assumed: Email and password, with a reset link by email; no social or single sign-on.
- ASM-2 (high risk, confirm on the approval card): Should the API bring existing spreadsheet or paper-process data into the new persisted records, or start with no imported business data? → assumed: No; the system starts empty, with seed data for set-up.
- ASM-3 (high risk, confirm on the approval card): The request says readings arrive through a logger supplier's gateway and that alerts reach drivers, dispatchers, and Quality Officers, but does not identify the supplier, gateway authentication, or alert delivery channel. What should the API integrate with? → assumed: Email only, from fixed templates; no SMS or push.
- ASM-4 (high risk, confirm on the approval card): What is the persisted unit meant by “handling unit” for temperature-budget history when part of a lot is split into different boxes or storage histories? → assumed: A separately tracked quantity or lot portion becomes a handling unit when its history diverges, such as when it is split into a different box.
- ASM-5 (high risk, confirm on the approval card): How should the API ensure stock becomes Expired at the end of its expiry date and is removed from allocations, given that the API-side request does not specify a scheduler or other trigger? → assumed: Run an application-side scheduled check that updates expired stock, removes allocations, and records the resulting dispatcher alert.
- ASM-6: The request makes order cut-off times and route safety margins configurable, with warehouse-specific working days and holidays, but does not say where those values are maintained. How should contracted operations obtain them? → assumed: Administrators work in the same app on admin-only screens; no separate back office.

Answer with letters or your own words:
  factory answer 20261013-meridian-coldchain-platform-in-1d97 d33d51f4 Q-1=A Q-2=A Q-3=A Q-4=A Q-5=A
  (use quotes for words: Q-1="only for guest checkouts")

Card hash: d33d51f4