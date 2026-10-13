# Approve the estimate (E7)

Run 20261005-parts-quick-order-requirements-4974 · solely agentic · size M · uncertainty medium
Hours from task catalogue 2026-10-06.1 (stack dotnet): reference hours, not yet measured.

## Anchors (check these first: every other task is sized against one)
- EST-1 Environments, CI/CD and hosting for API and portal: 17.47-30.58 h. Dev, staging and production with one CI/CD pipeline, no infrastructure as code named: typical, same as the approved one [ops-setup backend 8-14 h, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-2 Orders data model, migrations and seed data: 2.16-4.32 h. 2 new entities (orders, order_lines) plus a sequence and indexes; parts table already exists: small (up to 3 entities) [be-data backend 4-8 h, small x0.6, verify easy x0.9]
- EST-3 Buyer identity from existing company login session: 13.1-20.97 h. One sign-in method (the existing company session) and one buyer role: small [be-auth backend 10-16 h, small x0.6, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-4 GET /api/parts: search, filters, paging, stock state: 3.51-7.02 h. Search, 2 filters and paging on one table, with a derived stock state: typical (filters and paging) [be-endpoint backend 3-6 h, rules-or-algorithm x1.3, verify easy x0.9]
- EST-6 POST /api/orders: place order rules: 11.52-20.16 h. About 11 rules: 5 validation rules, stock re-check 409, server price, total with delivery charge, status and number, response, stock unchanged. 9-15 rules is large [be-rules backend 8-14 h, large x1.6, verify easy x0.9]
- EST-10 Portal app shell (web): 4.8-8.4 h. One layout, 3 menu items, no roles in the menu, English only, light theme: small [ui-shell web 8-14 h, small x0.6]
- EST-11 CartStore in browser local storage per buyer: 7.02-11.7 h. One capability (local storage persistence per buyer) with error handling for refresh and 409: typical, not offline sync [ui-device web 6-10 h, rules-or-algorithm x1.3, verify easy x0.9]
- EST-12 Find parts screen (web): 6-10 h. Search plus 2 filters (category, brand) and paging, no bulk actions: typical [ui-list web 6-10 h, typical]
- EST-13 Cart lines with live prices (web): 19.6-30.8 h. One interactive widget (editable lines table) with 3 actions (edit quantity, remove, try again): typical [ui-complex web 14-22 h, complex UI x1.4]
- EST-14 Checkout form and place order (web): 5.04-8.4 h. 2 form fields (address, delivery option) plus a summary and submit handling: small (up to 5 fields) [ui-form web 6-10 h, small x0.6, complex UI x1.4]
- EST-16 Order detail drawer, timeline and cancel (web): 7-11.2 h. Detail drawer with sections (lines, timeline) and 1 action (cancel with confirm): typical [ui-detail web 5-8 h, complex UI x1.4]
- EST-17 Test cases: Find parts and parts API, including load test: 3-6 h. 3 flows (API search/filter, load test, manual UI cases): typical (2-4 flows) [qa-cases qa 3-6 h, typical]
- EST-21 End-to-end test: find, add, check out, view and cancel: 6-10 h. One end-to-end journey with its error paths: typical [qa-e2e qa 6-10 h, typical]
- EST-22 Production release of API and portal: 6.55-13.1 h. One target (API and portal on one host) with a migration checklist: typical [ops-release web 3-6 h, external-dependency x1.4, verify hard x1.3, context partial x1.2]
- EST-23 Client design review and approval: 2-4 h. Walkthrough of 3 screens with two feedback rounds (settings feedbackRounds 2): typical [design-approval design 2-4 h, typical]
- EST-24 Client acceptance testing: 4-8 h. One acceptance round: typical [qa-uat qa 4-8 h, typical]
- EST-25 Project management: client liaison: 4-8 h. About 26 tasks, mostly small or typical: roughly a month of delivery, typical [pm-management pm 4-8 h, typical]
- EST-26 Handover notes: 2.88-5.76 h. Short handover notes on 2 topics (status updates, deployment): small [pdm-docs pdm 4-8 h, small x0.6, context partial x1.2]

## Sized with approved past tasks as references
- EST-1 Environments, CI/CD and hosting for API and portal: typical; like EST-1 of 20261005-parts-quick-order-requirements-a8db (typical, 17.47-30.58 h)
- EST-2 Orders data model, migrations and seed data: small; like EST-2 of 20261005-parts-quick-order-requirements-a8db (small, 2.16-4.32 h)
- EST-3 Buyer identity from existing company login session: small; like EST-3 of 20261005-parts-quick-order-requirements-a8db (small, 13.1-20.97 h)
- EST-4 GET /api/parts: search, filters, paging, stock state: typical; like EST-4 of 20261005-parts-quick-order-requirements-a8db (typical, 3.9-7.8 h)
- EST-5 GET /api/parts/brands: small; like EST-5 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h), EST-8 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h)
- EST-6 POST /api/orders: place order rules: large; like EST-6 of 20261005-parts-quick-order-requirements-a8db (large, 12.8-22.4 h), EST-9 of 20261005-parts-quick-order-requirements-a8db (typical, 7.21-12.61 h)
- EST-7 GET /api/orders: buyer's orders list with status filter: typical; like EST-7 of 20261005-parts-quick-order-requirements-a8db (typical, 2.7-5.4 h), EST-8 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h)
- EST-8 GET /api/orders/{orderNumber}: order detail: small; like EST-8 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h), EST-5 of 20261005-parts-quick-order-requirements-a8db (small, 1.62-3.24 h)
- EST-9 POST /api/orders/{orderNumber}/cancel: cancel rules: typical; like EST-9 of 20261005-parts-quick-order-requirements-a8db (typical, 7.21-12.61 h), EST-6 of 20261005-parts-quick-order-requirements-a8db (large, 12.8-22.4 h)
- EST-10 Portal app shell (web): small; like EST-10 of 20261005-parts-quick-order-requirements-a8db (small, 5.76-10.08 h)
- EST-11 CartStore in browser local storage per buyer: typical; like EST-11 of 20261005-parts-quick-order-requirements-a8db (typical, 7.02-11.7 h)
- EST-12 Find parts screen (web): typical; like EST-12 of 20261005-parts-quick-order-requirements-a8db (typical, 6-10 h), EST-15 of 20261005-parts-quick-order-requirements-a8db (typical, 8.4-14 h)
- EST-13 Cart lines with live prices (web): typical; like EST-13 of 20261005-parts-quick-order-requirements-a8db (typical, 19.6-30.8 h)
- EST-14 Checkout form and place order (web): small; like EST-14 of 20261005-parts-quick-order-requirements-a8db (small, 5.04-8.4 h)
- EST-15 My orders list (web): typical; like EST-15 of 20261005-parts-quick-order-requirements-a8db (typical, 8.4-14 h), EST-12 of 20261005-parts-quick-order-requirements-a8db (typical, 6-10 h)
- EST-16 Order detail drawer, timeline and cancel (web): typical; like EST-16 of 20261005-parts-quick-order-requirements-a8db (typical, 7-11.2 h)
- EST-17 Test cases: Find parts and parts API, including load test: typical; like EST-17 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h), EST-18 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h)
- EST-18 Test cases: Cart, checkout and place order: typical; like EST-17 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h), EST-18 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h)
- EST-19 Test cases: My orders and cancel: typical; like EST-17 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h), EST-18 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h)
- EST-20 Test cases: accessibility, responsive and browsers: typical; like EST-17 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h), EST-18 of 20261005-parts-quick-order-requirements-a8db (typical, 3-6 h)
- EST-21 End-to-end test: find, add, check out, view and cancel: typical; like EST-21 of 20261005-parts-quick-order-requirements-a8db (typical, 6-10 h)
- EST-22 Production release of API and portal: typical; like EST-22 of 20261005-parts-quick-order-requirements-a8db (typical, 6.55-13.1 h)
- EST-23 Client design review and approval: typical; like EST-23 of 20261005-parts-quick-order-requirements-a8db (typical, 2-4 h)
- EST-24 Client acceptance testing: typical; like EST-24 of 20261005-parts-quick-order-requirements-a8db (typical, 4-8 h)
- EST-25 Project management: client liaison: typical; like EST-25 of 20261005-parts-quick-order-requirements-a8db (typical, 4-8 h)
- EST-26 Handover notes: small; like EST-26 of 20261005-parts-quick-order-requirements-a8db (small, 2.88-5.76 h)

## Split before the build (agent work this size fails and retries more)
- EST-1 Environments, CI/CD and hosting for API and portal: 17.47-30.58 h, over 16 h
- EST-3 Buyer identity from existing company login session: 13.1-20.97 h, over 16 h
- EST-6 POST /api/orders: place order rules: 12.8-22.4 h, over 16 h
- EST-13 Cart lines with live prices (web): 19.6-30.8 h, over 16 h

## Totals (hours to deliver, as the workbooks show them; human hours in brackets)
- backend: 62.58-110.56 h (human 30.57-51.55 h)
- web: 64.41-107.6 h (human 6.55-13.1 h)
- qa: 22.9-43.8 h (human 4-8 h)
- design: 2-4 h (human 2-4 h)
- pm: 4-8 h (human 4-8 h)
- pdm: 2.88-5.76 h (human 0-0 h)
- Overall: 158.77-279.72 h (human 47.12-84.65 h; design included)

## Cost and time
- API credits: $18.65-$69.13, cold-start (15 measured records); indicative, not a quote
- API credits per task (its share of build and verification, by hours; every task's on the task sheets): EST-13 Cart lines with live prices (web) $2.10-$7.07; EST-1 Environments, CI/CD and hosting for API and portal $2.00-$6.74; EST-6 POST /api/orders: place order rules $1.47-$4.94; EST-3 Buyer identity from existing company login session $1.42-$4.78; EST-15 My orders list (web) $0.93-$3.14; and 18 more
- Planning: 0 min · build critical path: 10.45-17.74 days
- Build time basis: cold-start (0 of 6 task classes measured from earlier builds; the rest use the sized hours as an assumed duration)

## Low-confidence lines (estimators disagree; each needs your sign-off)
- EST-4 GET /api/parts: search, filters, paging, stock state: 3.9-7.8 h
- EST-6 POST /api/orders: place order rules: 12.8-22.4 h
- EST-9 POST /api/orders/{orderNumber}/cancel: cancel rules: 7.21-12.61 h
- EST-26 Handover notes: 2.88-5.76 h

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

Approve: factory approve 20261005-parts-quick-order-requirements-4974 b1584195 --sign-off EST-4,EST-6,EST-9,EST-26
Edit:    factory edit-estimate 20261005-parts-quick-order-requirements-4974 b1584195 --anchor EST-1=<min>-<max> --ratio <EST-n>=<multiple> --reason "why"   (everything recomputes; you get a new card)
Reject:  factory reject 20261005-parts-quick-order-requirements-4974 b1584195 --reason "why"

Card hash: b1584195