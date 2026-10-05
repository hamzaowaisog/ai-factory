# Approve the design baseline (E1b)

Run 20260930-invoice-reminders-a-small-4006. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.

Flow: A signed-in staff user opens the Overdue Invoices screen and sees every overdue invoice with its invoice number, customer name, amount, due date and days overdue. On the same screen they can narrow the list with a customer filter and a fixed days-overdue bucket filter (7–30, 31–60, 61+), and the list reloads in place. The requirements describe only an API, so this single list screen is the smallest UI that covers the overdue-list requirements.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20260930-invoice-reminders-a-small-4006/design-demo.html
Screenshots: none (no browser found, so no screenshots were taken (set FACTORY_CHROMIUM to a Chromium binary))

Screens (1):
- S-1 /invoices/overdue (src/pages/invoices/OverdueInvoicesPage.tsx) -> REQ-2, REQ-3, REQ-4; new; states: loading, empty, error, success, validation

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20260930-invoice-reminders-a-small-4006 c27d75a8
Reject:  factory reject 20260930-invoice-reminders-a-small-4006 c27d75a8 --reason "why"

Card hash: c27d75a8