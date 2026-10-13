# Approve the design baseline (E1b)

Run 20261005-parts-quick-order-requirements-d7a6. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.

Flow: The buyer lands on Find parts and uses search, category and brand filters to find parts. "Add to cart" updates the cart count in the header, which links to Cart and checkout. There they adjust quantities, enter an address and delivery option, and place the order. After a successful order they see the new order number, with a link to My orders. On My orders they filter by status, open an order in the detail panel on the same page to see its timeline, and can cancel it while it is still Placed. The header links all three screens at every point.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261005-parts-quick-order-requirements-d7a6/design-demo.html
Screenshots: 52 in /Users/mhamza/.factory/ledger/20261005-parts-quick-order-requirements-d7a6/preview/shots (each screen and state at phone and desktop width, each screen on a tablet)

## Layout problems in the demo (3)
- My orders, empty, phone: "Orders you place will show here. Go to F" runs past the edge
- My orders, empty, phone: "1" runs past the edge
- My orders, empty, phone: "2" runs past the edge

Screens (3):
- Find parts: S-1 /parts (src/pages/FindPartsPage.tsx) -> REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7, REQ-8, REQ-9, REQ-10, REQ-36, REQ-37, REQ-38; new; states: loading, empty, error, success; UI: moderate (4 states (loading, empty, error, success); search results with filters; search and filters)
- Cart and checkout: S-2 /cart (src/pages/CartCheckoutPage.tsx) -> REQ-1, REQ-9, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-18, REQ-19, REQ-20, REQ-22, REQ-23, REQ-24, REQ-36, REQ-37, REQ-39; new; states: empty, validation, loading, success, error; UI: moderate (5 states (empty, validation, loading, success, error); form of 2 fields (field validation); table)
- My orders: S-3 /orders (src/pages/MyOrdersPage.tsx) -> REQ-1, REQ-27, REQ-28, REQ-29, REQ-30, REQ-31, REQ-32, REQ-33, REQ-34, REQ-35, REQ-36, REQ-37; new; states: empty, loading, error, success, validation; UI: complex (5 states (empty, loading, error, success, validation); table with sorting and paging; receipt or invoice)

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261005-parts-quick-order-requirements-d7a6 a7ae2d8f
Reject:  factory reject 20261005-parts-quick-order-requirements-d7a6 a7ae2d8f --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: a7ae2d8f