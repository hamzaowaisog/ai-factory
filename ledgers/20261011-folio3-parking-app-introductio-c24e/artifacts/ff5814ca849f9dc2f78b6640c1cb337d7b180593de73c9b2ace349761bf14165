# Approve the design

Run 20261011-folio3-parking-app-introductio-c24e, design only. Approving keeps this mock, clickable demo and look; nothing is sized or built yet. Afterwards an estimate sizes it (factory estimate --from-design 20261011-folio3-parking-app-introductio-c24e) and a build follows it (factory start --project <name> --from-design 20261011-folio3-parking-app-introductio-c24e) without drawing it again.

Flow: Sign-in with Folio3 Google Workspace (S-1). If the directory lookup fails, the user lands on the access error page (S-2). Non-dedicated employees with no plate go to vehicle registration (S-3) and then to the claim dashboard (S-4). Dedicated holders land on the holder dashboard (S-5), where they can release today's space, and can schedule future releases (S-6). Every employee can view their own profile and vehicles (S-7). Security guards use only the entry verification console (S-8). Administrators manage parking spaces (S-9), employees and vehicles (S-10, S-11), roles (S-12), the Daily Parking Release Time (S-13), report recipients (S-14), weekly utilization reports (S-15) and the claim and entry audit log (S-16).

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261011-folio3-parking-app-introductio-c24e/design-demo.html
Screenshots: 64 in /Users/mhamza/.factory/ledger/20261011-folio3-parking-app-introductio-c24e/preview/shots (each screen and state at phone and desktop width, each screen on a tablet); stopped at 64 screenshots

Accessibility, still open (Stitch could not fix these):
- S-4: label
- S-9: aria-required-children

Screens (16):
- S-1 /sign-in (src/pages/SignIn.tsx) -> REQ-1, REQ-26; new; states: loading, error; UI: simple (2 states (loading, error))
- S-2 /access-error (src/pages/AccessError.tsx) -> REQ-4; new; states: loading; UI: simple (1 state (loading))
- S-3 /onboarding/vehicle (src/pages/onboarding/RegisterVehicle.tsx) -> REQ-3, REQ-2; new; states: validation, loading; UI: simple (form of 4 fields (field validation); 2 states (validation, loading))
- S-4 /dashboard (src/pages/dashboard/ClaimDashboard.tsx) -> REQ-14, REQ-15, REQ-16, REQ-5; new; states: empty, success, error, loading; UI: simple (4 states (empty, success, error, loading); form of 1 field (multi-choice))
- S-5 /dashboard/holder (src/pages/dashboard/HolderDashboard.tsx) -> REQ-10, REQ-12, REQ-5; new; states: success, error, loading; UI: simple (3 states (success, error, loading))
- S-6 /releases/schedule (src/pages/releases/ScheduleReleases.tsx) -> REQ-11, REQ-12, REQ-10; new; states: success, validation, loading; UI: simple (3 states (success, validation, loading))
- S-7 /profile (src/pages/profile/MyProfile.tsx) -> REQ-2, REQ-3, REQ-5; new; states: validation; UI: simple (form of 4 fields (field validation); 1 table; 1 state (validation))
- S-8 /guard/verifications (src/pages/guard/VerificationConsole.tsx) -> REQ-18, REQ-19, REQ-20, REQ-21, REQ-22, REQ-5; new; states: empty, error; UI: simple (2 states (empty, error); 1 table)
- S-9 /admin/spaces (src/pages/admin/Spaces.tsx) -> REQ-6, REQ-5; new; states: empty, validation; UI: moderate (form of 5 fields (dropdown); 2 states (empty, validation); 1 table)
- S-10 /admin/employees (src/pages/admin/Employees.tsx) -> REQ-6, REQ-2, REQ-3; new; states: empty; UI: simple (form of 1 field (dropdown); 1 table; 1 state (empty))
- S-11 /admin/employees/:id (src/pages/admin/EmployeeDetail.tsx) -> REQ-6, REQ-2; new; states: success, validation; UI: moderate (form of 8 fields (multi-choice, dropdown, field validation); 2 states (success, validation); 1 table)
- S-12 /admin/roles (src/pages/admin/Roles.tsx) -> REQ-26, REQ-5, REQ-1; new; states: validation, success; UI: moderate (form of 3 fields (field validation); 2 states (validation, success); 1 table)
- S-13 /admin/settings (src/pages/admin/Settings.tsx) -> REQ-12; new; states: success, validation; UI: simple (2 states (success, validation); form of 1 field)
- S-14 /admin/reports/recipients (src/pages/admin/ReportRecipients.tsx) -> REQ-24; new; states: empty, validation, success; UI: simple (3 states (empty, validation, success); form of 1 field; 1 table)
- S-15 /admin/reports (src/pages/admin/Reports.tsx) -> REQ-23, REQ-22, REQ-5; new; states: empty; UI: simple (2 tables; 1 state (empty))
- S-16 /admin/audit (src/pages/admin/AuditLog.tsx) -> REQ-16, REQ-21, REQ-20, REQ-15; new; states: empty; UI: simple (2 tables; 1 state (empty); search and filters)

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261011-folio3-parking-app-introductio-c24e 2a45b9b5
Reject:  factory reject 20261011-folio3-parking-app-introductio-c24e 2a45b9b5 --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: 2a45b9b5