# Approve the design baseline (E1b)

Run 20261005-parts-quick-order-requirements-d7a6. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.

Flow: Buyers start on Find parts. They search by name or part number, narrow by category and brand, and press "Add to cart" on parts in stock. The cart count in the header updates each time and links to Cart and checkout. There the cart reloads live prices and stock, the buyer adjusts quantities, enters an address and delivery option, and places the order. Success shows the new order number and a link to My orders, which lists orders newest first with a status filter. Choosing an order opens its detail panel on the same page, with a timeline and, while the order is still Placed, a "Cancel order" button. The empty cart and empty orders states both link back to Find parts.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261005-parts-quick-order-requirements-d7a6/design-demo.html
Screenshots: 64 in /Users/mhamza/.factory/ledger/20261005-parts-quick-order-requirements-d7a6/preview/shots (each screen and state at phone and desktop width, each screen on a tablet); stopped at 64 screenshots

## Layout problems in the demo (24)
- Find parts, out of stock: row with disabled Add to cart, phone: "Go to cart (3)" is cut off
- Find parts, low stock: "Low stock (3 left)" badge, phone: "Go to cart (3)" is cut off
- Find parts, added: header cart count bumps after Add to cart, phone: "Go to cart (3)" is cut off
- Find parts, loading: skeleton result rows while first page loads, phone: "Go to cart (3)" is cut off
- Find parts, error: parts failed to load with Try again, phone: "Go to cart (3)" is cut off
- Find parts, empty: "No parts match" with Clear search and filters button, phone: "Go to cart (3)" is cut off
- Find parts, Full data, phone: "Go to cart (3)" is cut off
- My orders, detail: order panel open with Placed → Packed → Dispatched → Delivered timeline, phone: "Find parts" is cut off
- and 16 more

Screens (3):
- Find parts: S-1 /parts (src/pages/FindParts.tsx) -> REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7, REQ-8, REQ-9, REQ-10, REQ-36, REQ-37, REQ-38; new; states: loading: skeleton result rows while first page loads, empty: "No parts match" with Clear search and filters button, error: parts failed to load with Try again, out of stock: row with disabled Add to cart, low stock: "Low stock (3 left)" badge, added: header cart count bumps after Add to cart; UI: moderate (6 states (loading: skeleton result rows while first page loads, empty: "No parts match" with Clear search and filters button, error: parts failed to load with Try again, out of stock: row with disabled Add to cart, low stock: "Low stock (3 left)" badge, added: header cart count bumps after Add to cart); search results with filters; links to 1 page)
- Cart and checkout: S-2 /cart (src/pages/Cart.tsx) -> REQ-1, REQ-9, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-18, REQ-19, REQ-20, REQ-21, REQ-22, REQ-23, REQ-24, REQ-36, REQ-37, REQ-39, REQ-40, REQ-41, REQ-42, REQ-43; new; states: loading: fetching current prices for lines, empty: "Your cart is empty" with link to Find parts, checkout hidden, validation: quantity corrected with "Only n available", validation: Place order disabled until address 5–200 chars and delivery picked, notice: "<part name> is now out of stock" line removed, error: prices failed, lines without prices, Try again, checkout hidden, submitting: Place order disabled while request runs, error: network failure telling buyer to check My orders before retrying, error: server error, cart, address and delivery kept, conflict: 409 lines lowered or removed with messages, success: order ORD-000123 placed, cart emptied; UI: complex (11 states (loading: fetching current prices for lines, empty: "Your cart is empty" with link to Find parts, checkout hidden, validation: quantity corrected with "Only n available", validation: Place order disabled until address 5–200 chars and delivery picked, notice: "<part name> is now out of stock" line removed, error: prices failed, lines without prices, Try again, checkout hidden, submitting: Place order disabled while request runs, error: network failure telling buyer to check My orders before retrying, error: server error, cart, address and delivery kept, conflict: 409 lines lowered or removed with messages, success: order ORD-000123 placed, cart emptied); form of 2 fields (field validation); table)
- My orders: S-3 /orders (src/pages/MyOrders.tsx) -> REQ-1, REQ-27, REQ-28, REQ-29, REQ-30, REQ-31, REQ-32, REQ-33, REQ-34, REQ-35, REQ-36, REQ-37; new; states: loading: skeleton order rows, empty: "No orders yet" with link to Find parts, filtered empty: no orders with the chosen status, detail: order panel open with Placed → Packed → Dispatched → Delivered timeline, confirm: Cancel order confirmation dialog, success: order cancelled, status Cancelled, error: cancel refused because the order has moved past Placed, error: orders failed to load with Try again; UI: complex (8 states (loading: skeleton order rows, empty: "No orders yet" with link to Find parts, filtered empty: no orders with the chosen status, detail: order panel open with Placed → Packed → Dispatched → Delivered timeline, confirm: Cancel order confirmation dialog, success: order cancelled, status Cancelled, error: cancel refused because the order has moved past Placed, error: orders failed to load with Try again); 2 overlays (drawer, confirm); table with sorting)

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261005-parts-quick-order-requirements-d7a6 78327a7c
Reject:  factory reject 20261005-parts-quick-order-requirements-d7a6 78327a7c --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: 78327a7c