# Approve the design baseline (E1b)

Run 20261001-invoice-reminders-a-small-06fa. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.

Flow: Staff sign in through the existing system and open Overdue invoices, a single list showing open invoices that are past the overdue threshold. They narrow the list by customer or by a days-overdue bucket (7–30, 31–60, 61–90, 90+) without leaving the page. If the session is not valid, the existing sign-in takes over before any invoice data loads.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261001-invoice-reminders-a-small-06fa/design-demo.html
Screenshots: none (no browser found, so no screenshots were taken (set FACTORY_CHROMIUM to a Chromium binary))

Screens (1):
- S-1 /invoices/overdue (src/pages/invoices/OverdueInvoicesPage.tsx) -> REQ-1, REQ-2, REQ-4, REQ-5, REQ-6; new; states: loading, empty, error

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261001-invoice-reminders-a-small-06fa 1521dac9
Reject:  factory reject 20261001-invoice-reminders-a-small-06fa 1521dac9 --reason "why"

Card hash: 1521dac9