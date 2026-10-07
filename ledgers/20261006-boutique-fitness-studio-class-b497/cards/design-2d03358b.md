# Approve the design

Run 20261006-boutique-fitness-studio-class-b497. The build follows the approved mock and clickable demo: its screens, states, sample content and look are what gets built.

Flow: Alex lands on Schedule at the root URL, picks a day on the week strip, narrows by type, intensity or time of day, and books or joins a waitlist straight from a class card. Tapping a card anywhere except its button opens Class Detail. On phones this is a full page with a pinned action footer. From 1024 px it opens as a side panel next to the schedule, and Back returns to the same day, week and filters. The AR avatar in the top bar opens My Bookings, which shows stats and Upcoming and Past tabs. Each row opens Class Detail, and its quick Cancel or Leave action uses the same confirmation dialog.

Clickable demo (open in a browser, walk every screen and state before approving): /Users/mhamza/.factory/ledger/20261006-boutique-fitness-studio-class-b497/design-demo.html
Screenshots: 64 in /Users/mhamza/.factory/ledger/20261006-boutique-fitness-studio-class-b497/preview/shots (each screen and state at phone and desktop width, each screen on a tablet and in dark mode); stopped at 64 screenshots

## Layout problems in the demo (15)
- My bookings, past-tab, phone: "Browse schedule" is cut off
- My bookings, cancel-dialog, phone: "Browse schedule" is cut off
- My bookings, late-cancel-dialog, phone: "Browse schedule" is cut off
- My bookings, success-toast, phone: "Browse schedule" is cut off
- My bookings, loading, phone: "Browse schedule" is cut off
- My bookings, empty-upcoming, phone: "Browse schedule" is cut off
- My bookings, empty-past, phone: "Browse schedule" is cut off
- My bookings, error, phone: "Browse schedule" is cut off
- and 7 more

Screens (3):
- Schedule: S-1 / (app/page.tsx) -> REQ-1, REQ-2, REQ-3, REQ-6, REQ-7, REQ-8, REQ-9, REQ-10, REQ-11, REQ-13, REQ-14, REQ-15, REQ-16, REQ-24, REQ-25, REQ-31, REQ-32, REQ-33, REQ-34, REQ-35, REQ-36, REQ-37, REQ-38, REQ-39, REQ-40, REQ-41, REQ-42, REQ-43, REQ-51, REQ-52, REQ-53, REQ-54, REQ-55, REQ-56, REQ-58, REQ-59; new; states: loading, empty, empty-filtered, error, success-booked-toast-undo, promoted-toast, error-toast; UI: complex (7 states (loading, empty, empty-filtered, error, success-booked-toast-undo, promoted-toast, error-toast); links to 2 pages; toolbar with 2 dropdowns)
- Class detail: S-2 /classes/[sessionId] (app/classes/[sessionId]/page.tsx) -> REQ-1, REQ-2, REQ-3, REQ-6, REQ-7, REQ-8, REQ-9, REQ-10, REQ-11, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-18, REQ-19, REQ-22, REQ-23, REQ-31, REQ-32, REQ-41, REQ-42, REQ-44, REQ-45, REQ-46, REQ-47, REQ-48, REQ-51, REQ-52, REQ-53, REQ-54, REQ-55, REQ-56, REQ-57, REQ-58, REQ-59, REQ-63; new; states: loading, error, booked, waitlisted, waitlisted-skip-reason, full-join-waitlist, disabled-started, disabled-cancelled-by-studio, disabled-outside-window, cancel-dialog, late-cancel-dialog, rejected-overlap, rejected-became-full, success-toast; UI: complex (14 states (loading, error, booked, waitlisted, waitlisted-skip-reason, full-join-waitlist, disabled-started, disabled-cancelled-by-studio, disabled-outside-window, cancel-dialog, late-cancel-dialog, rejected-overlap, rejected-became-full, success-toast); avatar groups; progress bars)
- My bookings: S-3 /bookings (app/bookings/page.tsx) -> REQ-1, REQ-2, REQ-3, REQ-17, REQ-18, REQ-19, REQ-26, REQ-27, REQ-28, REQ-30, REQ-39, REQ-41, REQ-42, REQ-47, REQ-49, REQ-50, REQ-51, REQ-52, REQ-53, REQ-54, REQ-55, REQ-56, REQ-57, REQ-58, REQ-59, REQ-63; new; states: loading, error, empty-upcoming, empty-past, past-tab, cancel-dialog, late-cancel-dialog, success-toast, error-toast; UI: complex (9 states (loading, error, empty-upcoming, empty-past, past-tab, cancel-dialog, late-cancel-dialog, success-toast, error-toast); 2 overlays (confirm, confirm); 2 toasts)

UI across the product (the estimate sizes every UI task with these): both colour modes: every page in light and dark, with a switch

Every requirement has a screen.
Every screen links to a requirement.

Approve: factory approve 20261006-boutique-fitness-studio-class-b497 2d03358b
Reject:  factory reject 20261006-boutique-fitness-studio-class-b497 2d03358b --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)

Card hash: 2d03358b