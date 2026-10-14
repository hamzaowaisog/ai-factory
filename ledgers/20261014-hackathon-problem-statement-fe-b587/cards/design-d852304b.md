# Approve the design

Run 20261014-hackathon-problem-statement-fe-b587. The build follows the approved mock and clickable demo: its screens, states, sample content and look are what gets built.

Flow: Operators open the shared workspace link directly to the yard overview, then move into yard records to sync procurement, review exceptions, map lots and pens, and record weights. Feed management handles inventory, rations, plans, and actual deliveries; the Insights hub brings together operational reports, the filtered Feed-to-Gain comparison, exports, and the project presentation.

Clickable demo (open in a browser, walk every screen and state before approving): /home/ahsanraza/.factory/ledger/20261014-hackathon-problem-statement-fe-b587/design-demo.html
Screenshots: 64 in /home/ahsanraza/.factory/ledger/20261014-hackathon-problem-statement-fe-b587/preview/shots (each screen and state at phone and desktop width, each screen on a tablet); stopped at 64 screenshots

## Layout problems in the demo (23)
- Yard overview, default, phone: "4.0% over $1,771 plan" is cut off
- Yard overview, error, phone: "4.0% over $1,771 plan" is cut off
- Yard overview, Full data, phone: "2.4% over $2,754 plan" is cut off
- Feed management, default, phone: "Reports & project brief" runs past the edge
- Feed management, success, phone: "Reports & project brief" runs past the edge
- Feed management, validation, phone: "Reports & project brief" runs past the edge
- Feed management, loading, phone: "Reports & project brief" runs past the edge
- Feed management, empty, phone: "Reports & project brief" runs past the edge
- and 15 more

Screens (4):
- Yard overview: S-1 /overview (app/(workspace)/overview/page.tsx) -> REQ-1, REQ-24, REQ-28, REQ-29; new; states: loading, empty, error; UI: moderate (table with sorting and paging; 3 states (loading, empty, error); table with sorting)
- Procurement & lot records: S-2 /yard (app/(workspace)/yard/page.tsx) -> REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7, REQ-18, REQ-19, REQ-20, REQ-22, REQ-23; new; states: loading, empty, error, success, validation; UI: complex (3 overlays (modal with a form, drawer, sheet with a form); form of 5 fields (date picker, field validation); table with sorting, row selection, bulk actions and paging)
- Feed management: S-3 /feed (app/(workspace)/feed/page.tsx) -> REQ-8, REQ-9, REQ-10, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-20, REQ-23; new; states: loading, empty, error, success, validation; UI: complex (3 overlays (modal with a form, sheet with a form, menu); table with sorting, row selection, bulk actions and paging; 5 states (loading, empty, error, success, validation))
- Reports & project brief: S-4 /insights (app/(workspace)/insights/page.tsx) -> REQ-25, REQ-26, REQ-27, REQ-29; new; states: loading, empty, error, success; UI: complex (form of 5 fields (date range picker, searchable dropdown, field validation); 4 states (loading, empty, error, success); table with sorting)

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261014-hackathon-problem-statement-fe-b587 d852304b
Reject:  factory reject 20261014-hackathon-problem-statement-fe-b587 d852304b --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: d852304b