# Approve the design

Run 20261012-folio3-parking-app-introductio-dd8b, design only. Approving keeps this mock, clickable demo and look; nothing is sized or built yet. Afterwards an estimate sizes it (factory estimate --from-design 20261012-folio3-parking-app-introductio-dd8b) and a build follows it (factory start --project <name> --from-design 20261012-folio3-parking-app-introductio-dd8b) without drawing it again.

Flow: Employees authenticate with Folio3 Google Workspace, then land on their own parking view to release a dedicated space, manage vehicles, schedule future releases, or claim an available temporary space. Administrators use the same responsive web app to inspect the roster, entrance verification activity, utilization reports and audit history, and to configure office-local release time and report recipients.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261012-folio3-parking-app-introductio-dd8b/design-demo.html
Screenshots: 64 in /Users/mhamza/.factory/ledger/20261012-folio3-parking-app-introductio-dd8b/preview/shots (each screen and state at phone and desktop width, each screen on a tablet); stopped at 64 screenshots

## Layout problems in the demo (2)
- Office parking settings, Full data, phone: "people@folio3.com" is cut off
- Office parking settings, Full data, phone: "people@folio3.com / Only signed-in parking admins can edit." sits on top of other text

Screens (11):
- Sign in to Folio3 Parking: S-1 /sign-in (src/pages/auth/sign-in.tsx) -> REQ-1, REQ-2; new; states: loading, error, success; UI: simple (3 states (loading, error, success))
- Your parking today: S-2 /parking (src/pages/parking/home.tsx) -> REQ-2, REQ-4, REQ-5, REQ-8, REQ-10, REQ-11; new; states: empty, loading, error, success; UI: moderate (4 states (empty, loading, error, success); inline alert; 1 toast)
- Registered vehicles: S-3 /vehicles (src/pages/parking/vehicles.tsx) -> REQ-2, REQ-3, REQ-12; new; states: empty, loading, error, success, validation; UI: moderate (5 states (empty, loading, error, success, validation); form of 4 fields (field validation); 1 simple block)
- Schedule parking releases: S-4 /parking/releases (src/pages/parking/releases.tsx) -> REQ-4, REQ-6, REQ-7, REQ-8, REQ-9; new; states: empty, loading, error, success, validation; UI: moderate (5 states (empty, loading, error, success, validation); calendar with bookable times; 1 overlay (confirm))
- Claim a temporary space: S-5 /parking/claim (src/pages/parking/claim.tsx) -> REQ-3, REQ-10, REQ-11, REQ-12; new; states: empty, loading, error, success, validation; UI: moderate (5 states (empty, loading, error, success, validation); form of 1 field (field validation); links to 1 page)
- Temporary parking pass: S-6 /parking/claims/today (src/pages/parking/claim-pass.tsx) -> REQ-12, REQ-14, REQ-16; new; states: loading, error, success; UI: simple (3 states (loading, error, success); inline alert; 1 simple block)
- Employee parking roster: S-7 /admin/roster (src/pages/admin/roster.tsx) -> REQ-2; new; states: empty, loading, error; UI: moderate (table with sorting and paging; 3 states (empty, loading, error); toolbar with 1 dropdown)
- Entrance verification activity: S-8 /admin/entry-checks (src/pages/admin/entry-checks.tsx) -> REQ-15, REQ-16, REQ-17; new; states: empty, loading, error; UI: moderate (table with sorting and paging; 3 states (empty, loading, error); toolbar with 1 dropdown)
- Weekly utilization report: S-9 /admin/utilization (src/pages/admin/utilization.tsx) -> REQ-4, REQ-18, REQ-19, REQ-21; new; states: empty, loading, error; UI: moderate (3 states (empty, loading, error); table with sorting; bar chart)
- Office parking settings: S-10 /admin/settings/office (src/pages/admin/office-settings.tsx) -> REQ-8, REQ-9, REQ-20; new; states: loading, error, success, validation; UI: moderate (form of 4 fields (time picker, multi-select with chips, field validation); 4 states (loading, error, success, validation); 1 toast)
- Parking activity history: S-11 /admin/activity (src/pages/admin/activity.tsx) -> REQ-5, REQ-7, REQ-18, REQ-22; new; states: empty, loading, error; UI: moderate (table with sorting and paging; 3 states (empty, loading, error); toolbar with 1 dropdown)

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261012-folio3-parking-app-introductio-dd8b 8b00fe0f
Reject:  factory reject 20261012-folio3-parking-app-introductio-dd8b 8b00fe0f --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: 8b00fe0f