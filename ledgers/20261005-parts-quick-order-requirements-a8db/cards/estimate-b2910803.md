# Approve the estimate (E7)

Run 20261005-parts-quick-order-requirements-a8db · solely agentic · size M · uncertainty medium
Hours from task catalogue 2026-10-06.1 (stack dotnet): reference hours, not yet measured.

## Anchors (check these first: every other task is sized against one)
- EST-1 Environments, CI/CD and hosting for API and portal: 17.47-30.58 h. Three environments (dev, staging, production) with one CI/CD pipeline. No infrastructure as code is asked for, so it stays at typical rather than large. [ops-setup backend 8-14 h, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-2 Orders data model, migrations and seed data: 2.16-4.32 h. 2 new entities (orders, order_lines), plus a sequence, indexes and seed data. That is within 'up to 3 entities': small. [be-data backend 4-8 h, small x0.6, verify easy x0.9]
- EST-3 Buyer identity from existing company login session: 13.1-20.97 h. One sign-in method (the existing company session) and one role (buyer): small. [be-auth backend 10-16 h, small x0.6, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-4 GET /api/parts: search, filters, paging, stock state: 3.9-7.8 h. Search, 2 filters (category, brand) and paging, with a computed stock state. Only the parts table is queried, so no joins over 3+ tables: typical. [be-endpoint backend 3-6 h, rules-or-algorithm x1.3]
- EST-6 POST /api/orders: place order rules: 12.8-22.4 h. 11 rules: 5 validation rules, stock re-check, current price, total with delivery charge, status Placed, sequential number, stock left unchanged. 9-15 rules: large. [be-rules backend 8-14 h, large x1.6]
- EST-10 Portal app shell (web): 5.76-10.08 h. One layout, 3 menu items, no roles in the menu, English only, light theme only: small. [ui-shell web 8-14 h, small x0.6, context partial x1.2]
- EST-11 CartStore in browser local storage per buyer: 7.02-11.7 h. One capability (local storage persistence) with error handling for refresh failures and 409 limits. No offline sync: typical. [ui-device web 6-10 h, rules-or-algorithm x1.3, verify easy x0.9]
- EST-12 Find parts screen (web): 6-10 h. Search plus 2 filters (category, brand) and paging. No bulk actions: typical. [ui-list web 6-10 h, typical]
- EST-13 Cart lines with live prices (web): 19.6-30.8 h. One interactive widget (the editable lines table) with 3 actions (edit quantity, remove, try again): typical. [ui-complex web 14-22 h, complex UI x1.4]
- EST-14 Checkout form and place order (web): 5.04-8.4 h. 2 form fields (address, delivery option): up to 5 fields, small. The screen's states are covered by its complex ui level. [ui-form web 6-10 h, small x0.6, complex UI x1.4]
- EST-16 Order detail drawer, timeline and cancel (web): 7-11.2 h. Detail sections (lines, address, timeline) with 1-2 actions (cancel and confirm). No tabs or widgets: typical. [ui-detail web 5-8 h, complex UI x1.4]
- EST-17 Test cases: Find parts and parts API, including load test: 3-6 h. 4 flows: search/filter, paging, add to cart, load test. 2-4 flows: typical. [qa-cases qa 3-6 h, typical]
- EST-21 End-to-end test: find, add, check out, view and cancel: 6-10 h. One chained buyer journey (find, add, check out, view, cancel) on one platform. It counts as one flow rather than 2-3 separate ones, so typical. [qa-e2e qa 6-10 h, typical]
- EST-22 Production release of API and portal: 6.55-13.1 h. One target (web hosting) with a checklist: production migrations, then deploy the API and portal. [ops-release web 3-6 h, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-23 Client design review and approval: 2-4 h. A walkthrough of 3 screens with 2 feedback rounds (from settings) and sign-off: typical. [design-approval design 2-4 h, typical]
- EST-24 Client acceptance testing: 4-8 h. One client acceptance round: typical. [qa-uat qa 4-8 h, typical]
- EST-25 Project management: client liaison: 4-8 h. 5 features over 3 screens and one API, roughly a month of agentic delivery: typical. [pm-management pm 4-8 h, typical]
- EST-26 Handover notes: 2.88-5.76 h. Short handover notes in 2 parts (DB status updates, deploy/config). About a one-page guide: small. [pdm-docs pdm 4-8 h, small x0.6, context partial x1.2]

## Split before the build (agent work this size fails and retries more)
- EST-1 Environments, CI/CD and hosting for API and portal: 17.47-30.58 h, over 16 h
- EST-3 Buyer identity from existing company login session: 13.1-20.97 h, over 16 h
- EST-6 POST /api/orders: place order rules: 12.8-22.4 h, over 16 h
- EST-13 Cart lines with live prices (web): 19.6-30.8 h, over 16 h

## Totals
- backend: 30.57-51.55 h
- design: 2-4 h
- pdm: 0-0 h
- pm: 4-8 h
- qa: 4-8 h
- web: 6.55-13.1 h
- Overall: 47.12-84.65 h (design included)

## Cost and time
- API credits: $18.63-$68.96, cold-start (14 measured records); indicative, not a quote
- API credits per task (its share of build and verification, by hours; every task's on the task sheets): EST-13 Cart lines with live prices (web) $2.09-$7.03; EST-1 Environments, CI/CD and hosting for API and portal $1.99-$6.70; EST-6 POST /api/orders: place order rules $1.46-$4.91; EST-3 Buyer identity from existing company login session $1.41-$4.75; EST-15 My orders list (web) $0.93-$3.12; and 18 more
- Planning: 2 min · build critical path: 10.57-17.95 days
- Build time basis: cold-start (0 of 6 task classes measured from earlier builds; the rest use the sized hours as an assumed duration)

## Low-confidence lines (estimators disagree; each needs your sign-off)
- EST-4 GET /api/parts: search, filters, paging, stock state: 3.9-7.8 h
- EST-5 GET /api/parts/brands: 1.62-3.24 h
- EST-6 POST /api/orders: place order rules: 12.8-22.4 h
- EST-8 GET /api/orders/{orderNumber}: order detail: 1.62-3.24 h
- EST-9 POST /api/orders/{orderNumber}/cancel: cancel rules: 7.21-12.61 h
- EST-10 Portal app shell (web): 5.76-10.08 h
- EST-12 Find parts screen (web): 6-10 h
- EST-20 Test cases: accessibility, responsive and browsers: 3.9-7.8 h
- EST-22 Production release of API and portal: 6.55-13.1 h

## Suggested, not included
none

## Assumptions
- Does the 'Place order' button also need the cart to have at least one line, or is that already covered because checkout is hidden when the cart is empty? → assumed: Covered already: checkout is hidden when the cart is empty, and the API also refuses an order with no lines
- Does placing (or cancelling) an order change the stock quantity in the existing parts database? → assumed: No: stock is read-only and orders never change it
- What happens when a cart quantity is more than the current stock (or the part is now out of stock) at the moment the buyer presses 'Place order'? → assumed: The API checks stock again, rejects the order, lowers the affected lines to the stock now available with 'Only n available', and keeps the cart
- Where is the cart kept? → assumed: In the browser's local storage for the signed-in buyer (kept across page reloads on the same device)
- How does the API find out which buyer is making a request through the existing company login? → assumed: The API checks the existing company login's session token or cookie and reads the buyer ID from it
- Nothing in this work moves an order to Packed, Dispatched or Delivered (no admin screens, no integrations). How do statuses change after Placed? → assumed: Staff update the status directly in the database, outside this work; the portal only shows it
- Which unit price is saved on an order line, and what does the order 'total' include? → assumed: The part's current price when the order is placed; total = subtotal + delivery charge
- How are 'ORD-' + 6-digit order numbers generated? → assumed: Sequential from a database sequence, zero-padded (ORD-000001)
- Should the delivery prices (£0 / £9.99), the stock thresholds (5) and the page size (20) be fixed in the code or set in configuration? → assumed: Fixed constants in the code
- What happens if the order's status changes from Placed (e.g. to Packed) after the buyer opened it but before they confirm cancelling? → assumed: The API cancels only if the status is still Placed; otherwise it refuses, shows a message and refreshes the order
- What happens if placing an order fails (network or server error)? → assumed: Show an error message, keep the cart and checkout details, and let the buyer try again
- What happens when a quantity is set to 0, left blank, set above 99, or isn't a whole number? → assumed: Set it to the nearest value in range (blank or 0 becomes 1, above 99 becomes 99)
- What do 'cart count' in the header and 'number of items' in My orders count? → assumed: The total of all quantities (2 filters + 1 pad = 3)
- How do the parts list filters and sort order work? → assumed: One category and one brand at a time (each with 'All'), brands taken from the parts data, sorted by name A–Z, back to page 1 whenever the search or a filter changes
- Is the delivery address remembered from the buyer's previous order? → assumed: No: typed fresh for each order
- Under what conditions is the 2-second load target measured, and how many buyers and orders are expected? → assumed: Up to 1,000 users and 100,000 records in the first year.
- Which browsers must be supported? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.
- Are orders written to the same PostgreSQL database that holds the existing parts? → assumed: Yes: new orders and order-lines tables in the same database, referring to parts by part number
- Spec question Q-1: If a part in the cart now has 0 stock, what should happen to that cart line? (One rule says the quantity can never go below 1. Another says it can never go above stock.) → Remove the line and show "<part name> is now out of stock" (assumed by the factory, hands-off)
- Spec question Q-2: If the buyer retries after a network error but the first order was actually saved, how should we stop the order being placed twice? → Disable "Place order" while a request is in progress, and on a network error tell the buyer to check My orders before retrying (assumed by the factory, hands-off)
- Spec question Q-3: The cart keeps a saved copy of each price, but orders are charged at the current price. How should the cart handle a price that has changed? → Fetch the current prices from the parts API when the cart opens, and show only those (assumed by the factory, hands-off)
- Spec question Q-4: Should the spec keep a separate requirement that the API rejects requests with no valid company-login session (status 401)? The request doesn't mention this. → Leave it out and rely on the existing company login as-is (assumed by the factory, hands-off)
- Spec question Q-5: When the cart opens and the request to the parts API for current prices fails (network or server error), what should the cart show and allow? The saved prices must never be shown. → Show the cart lines without prices or totals, show an error message with a "Try again" button, and hide checkout until current prices load (assumed by the factory, hands-off)
- Open risk: ASM-26 and AC-41.1 need GET /api/parts filtered to the cart's part numbers in a single call, but REQ-2/4/5 and ASM-19 only define q (at least 2 characters, substring match), category, brand and page, so no defined parameter can fetch exactly the cart's parts.
- Open risk: When the cart opens, only lines whose part now has 0 stock are handled; a line whose stock has dropped but is still above 0 (cart quantity 5, stock now 2) is left unclamped until the 409 at Place order, and REQ-14's clamp only runs when the buyer edits the quantity.
- Open risk: The order is charged at the server's current price, but the price can change between cart refresh and Place order; nothing says the buyer is told or asked to confirm, so the saved total can differ from the total on screen (payments risk).
- Gate time, cost and duration are assumed figures, labelled cold-start until the ledger has measured runs.
- Split before the build: EST-1, EST-3, EST-6, EST-13 (agent work over 16 h or very large is split into smaller tasks; the hours stay as estimated).

## Gates
- passed estimate.e1-readiness: 42 requirements, lint, critic and round trip clean (8 problems settled by questions), no open questions
- passed estimate.e2-req-to-task: all 42 requirements have a task
- passed estimate.e3-task-to-req: every task cites a requirement or a named overhead
- passed estimate.e2c-task-kind: every task has a catalogue kind that fits its track (catalogue 2026-10-06.1)
- passed estimate.e4-checklist: 14 checklist items each in, or out with a reason
- passed estimate.e1c-design-coverage: all 3 approved screens are built by a task, and every task screen is approved
- passed estimate.e5-consistency: similar tasks are within tolerance
- passed estimate.e6-lint: totals, ratios and costs recompute cleanly

## Waivers
none

Approve: factory approve 20261005-parts-quick-order-requirements-a8db b2910803 --sign-off EST-4,EST-5,EST-6,EST-8,EST-9,EST-10,EST-12,EST-20,EST-22
Edit:    factory edit-estimate 20261005-parts-quick-order-requirements-a8db b2910803 --anchor EST-1=<min>-<max> --ratio <EST-n>=<multiple> --reason "why"   (everything recomputes; you get a new card)
Reject:  factory reject 20261005-parts-quick-order-requirements-a8db b2910803 --reason "why"

Card hash: b2910803