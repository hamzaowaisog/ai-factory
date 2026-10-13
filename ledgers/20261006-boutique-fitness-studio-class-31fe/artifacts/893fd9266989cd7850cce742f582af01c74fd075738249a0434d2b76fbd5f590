# Questions before the spec (round 2)

Run 20261006-boutique-fitness-studio-class-31fe. Your request:
> # Boutique Fitness Studio — Class Booking App
> 
> ## 1. Product Overview
> 
> A responsive web app for **Pulse Studio**, a single-location boutique fitness studio offering yoga, pilates, HIIT, spin, and boxing classes.
> 
> Members use the app to browse the weekly class schedule, view class details, book or cancel a spot, join a waitlist when a class is full, and see their upcoming bookings.
> 
> This release is deliberately small: **3 screens**, one member role, no staff/admin UI. The emphasis is on a polished, distinctive visual design and a smooth booking experience.
> 
> There is no existing application code. The technology stack has not yet been decided.
> 
> ---
> 
> ## 2. Product Goals
> 
> - Let members find and book a class in under 30 seconds.
> - Make class availability (spots left, full, waitlist) obvious at a glance.
> - Enforce the studio's booking and cancellation rules.
> - Deliver a premium, on-brand look that feels like a boutique studio, not a generic admin template.
> - Work primarily on phones, and well on tablet and desktop.
> 
> ---
> 
> ## 3. User Roles
> 
> ### 3.1 Member
> 
> A single, already-signed-in member (demo user). No sign-in screen is required in this release.
> 
> Demo member:
> 
> - Name: Alex Rivera
> - Membership: Unlimited Monthly
> - Avatar: initials "AR"
> 
> Capabilities:
> 
> - View the weekly schedule.
> - Filter classes by type, intensity, and time of day.
> - View class details.
> - Book a spot.
> - Join / leave a waitlist.
> - Cancel a booking.
> - View upcoming and past bookings.
> 
> Authentication, payments, and membership management are out of scope (see §12).
> 
> ---
> 
> ## 4. Data
> 
> ### 4.1 Class Session
> 
> Each class session has:
> 
> - Class name (e.g. "Sunrise Vinyasa").
> - Class type: `Yoga`, `Pilates`, `HIIT`, `Spin`, `Boxing`.
> - Intensity: `Low`, `Medium`, `High`.
> - Instructor (name, short bio, photo/avatar).
> - Room: `Studio A`, `Studio B`, `Spin Room`.
> - Start date/time.
> - Duration in minutes (30, 45, 60, or 75).
> - Capacity (total spots).
> - Booked count.
> - Waitlist count.
> - Description (2–4 sentences).
> - What to bring (e.g. mat, water, towel).
> - Status: `Scheduled` or `Cancelled by studio`.
> 
> ### 4.2 Booking
> 
> Each booking has:
> 
> - Booking ID.
> - Class session.
> - Status: `Booked`, `Waitlisted`, `Cancelled`, `Attended`.
> - Created date/time.
> - Waitlist position (when waitlisted).
> 
> ### 4.3 Seed Data
> 
> The app must ship with seed data covering the **current week and next week**:
> 
> - At least 40 class sessions across all 5 types and 3 rooms.
> - 5 instructors.
> - At least 3 classes that are full (to show waitlist).
> - At least 3 classes with ≤ 3 spots left (to show "almost full").
> - At least 1 class with status `Cancelled by studio`.
> - The demo member has 2 upcoming bookings, 1 waitlisted class, and 3 past (attended) bookings.
> 
> Persistence: bookings made in the app must survive a page reload. A simple backend with a database, or local persistence, is acceptable — the implementation team should propose one.
> 
> ---
> 
> ## 5. Business Rules
> 
> 1. **Capacity** — A class cannot be booked beyond its capacity.
> 2. **Waitlist** — When a class is full, the member can join the waitlist instead. Waitlist position is shown.
> 3. **Waitlist promotion** — When a booked member cancels, the first waitlisted member is automatically promoted to `Booked`.
> 4. **Booking window** — Classes can be booked up to **7 days** in advance and no later than **15 minutes** before start.
> 5. **Cancellation window** — A member can cancel free of charge up to **2 hours** before start. Inside 2 hours, cancellation is still allowed but the UI must warn: *"Late cancellation — this counts as a missed class."*
> 6. **No double-booking** — A member cannot hold two `Booked` classes that overlap in time. Attempting it shows a clear error naming the conflicting class.
> 7. **Booking limit** — A member may hold at most **10** upcoming `Booked` classes at once.
> 8. **Past classes** — Classes that have started cannot be booked, cancelled, or waitlisted.
> 9. **Studio-cancelled classes** — Remain visible on the schedule, visually struck through, and cannot be booked.
> 
> All rules must be enforced in the business/data layer, not only by hiding buttons in the UI.
> 
> ---
> 
> ## 6. Screens
> 
> ### Screen 1 — Schedule (home)
> 
> The main screen. Shows classes for a selected day.
> 
> **Layout**
> 
> - Top bar: studio logo/wordmark, member avatar (links to Screen 3).
> - Horizontal **week day strip**: 7 day chips (e.g. "Mon 12"), today highlighted, with previous/next week arrows. Days with no classes are dimmed.
> - **Filter bar**:
>   - Class type chips (multi-select, each type has its own accent colour).
>   - Intensity (Low / Medium / High).
>   - Time of day (Morning < 12:00, Afternoon 12:00–17:00, Evening > 17:00).
>   - "Clear filters" action.
> - **Class list** for the selected day, ordered by start time. Each **class card** shows:
>   - Start time and duration.
>   - Class name.
>   - Class type tag (colour-coded).
>   - Intensity indicator (e.g. 1–3 bars or dots).
>   - Instructor avatar + name.
>   - Room.
>   - **Availability**: a capacity bar plus label — "8 spots left", "Only 2 left", "Full · 4 on waitlist", or "Cancelled".
>   - Primary action button whose label depends on state: `Book`, `Join waitlist`, `Booked ✓`, `Waitlisted #2`, or disabled.
> - Tapping a card (outside the button) opens Screen 2.
> 
> **Behaviour**
> 
> - Booking from the card happens inline with an optimistic update and a toast confirmation ("You're booked for Sunrise Vinyasa · Mon 07:00"), including an **Undo** action for 5 seconds.
> - The selected day and filters are kept when returning from Screen 2.
> 
> **States**
> 
> - Loading: skeleton cards.
> - Empty (no classes on day): friendly illustration/icon + "No classes on this day".
> - Empty (filters match nothing): "No classes match your filters" + Clear filters.
> - Error: inline message with Retry.
> 
> ---
> 
> ### Screen 2 — Class Detail
> 
> Opened from the schedule or from My Bookings. On mobile: full-screen page or bottom sheet. On desktop: side panel or modal over the schedule.
> 
> **Content**
> 
> - Hero header using the class type's accent colour (gradient or image), class name, type tag, intensity.
> - Date, start–end time, duration, room.
> - Instructor card: photo/avatar, name, 1–2 line bio.
> - Description.
> - "What to bring" list with icons.
> - Availability block: capacity bar, spots left / waitlist count.
> - Rules hint: "Free cancellation until 2 hours before class."
> 
> **Sticky action footer** (always visible on mobile):
> 
> | Member state | Button | Secondary info |
> | --- | --- | --- |
> | Not booked, spots available | `Book this class` | "X spots left" |
> | Not booked, full | `Join waitlist` | "You'd be #N" |
> | Booked | `Cancel booking` (secondary/destructive style) | "You're booked" |
> | Waitlisted | `Leave waitlist` | "You're #N on the waitlist" |
> | Started / past / studio-cancelled / outside booking window | Disabled button | Reason text |
> 
> **Cancel confirmation**
> 
> - Cancelling opens a confirmation dialog.
> - If inside the 2-hour window, the dialog shows the late-cancellation warning in a warning style.
> 
> **Errors**
> 
> - Overlap conflict: "You're already booked for *Power HIIT* at 18:00–18:45."
> - Booking limit reached: "You've reached the limit of 10 upcoming classes."
> - Class became full while viewing: refresh availability and offer `Join waitlist`.
> 
> ---
> 
> ### Screen 3 — My Bookings
> 
> **Layout**
> 
> - Header with member avatar, name, membership type.
> - Small stats row (3 tiles): **Upcoming**, **Classes this month**, **Current streak (weeks)**.
> - Tabs: `Upcoming` | `Past`.
> - **Upcoming** list: booked and waitlisted classes, ordered by start time, grouped by day ("Today", "Tomorrow", "Thu 15 Oct"). Each row shows time, class name, type tag, instructor, room, status badge (`Booked` / `Waitlisted #2`), and a quick `Cancel` / `Leave` action.
> - **Past** list: attended and cancelled classes, most recent first, with status badge.
> - Tapping a row opens Screen 2.
> 
> **States**
> 
> - Empty upcoming: "No upcoming classes" + button "Browse schedule" (goes to Screen 1).
> - Empty past: "Your class history will appear here."
> - Loading and error states as on Screen 1.
> 
> ---
> 
> ## 7. Design Requirements
> 
> Design quality is a primary acceptance criterion for this release.
> 
> ### 7.1 Brand & Mood
> 
> - Boutique, calm-but-energetic, premium. Think modern wellness brand — generous whitespace, soft rounded shapes, confident typography.
> - Not a generic dashboard / admin-template look.
> 
> ### 7.2 Colour
> 
> - Define colours as design tokens (CSS variables or equivalent).
> - Neutral base: warm off-white background, near-black text.
> - One brand primary colour used for primary actions.
> - One accent colour per class type, used consistently on tags, card edges, and the detail hero:
>   - Yoga — sage green
>   - Pilates — dusty rose
>   - HIIT — coral/orange
>   - Spin — electric blue
>   - Boxing — deep plum
> - Semantic colours: success (booked), warning (almost full / late cancel), danger (cancel/destructive), muted (past/cancelled).
> - **Dark mode** must be supported, following the system preference.
> - All text/background combinations must meet WCAG AA contrast.
> 
> ### 7.3 Typography
> 
> - One display font for headings / class names, one clean sans-serif for body (web fonts allowed).
> - Clear type scale (at least: display, h1, h2, body, small/caption).
> - Times and numbers use tabular figures so the schedule aligns.
> 
> ### 7.4 Components
> 
> A small, consistent component set:
> 
> - Day chip, filter chip, type tag, intensity indicator, capacity bar, status badge.
> - Class card, list row, instructor card, stat tile.
> - Primary / secondary / destructive / disabled buttons.
> - Toast (with Undo), confirmation dialog, bottom sheet / side panel.
> - Skeleton loader, empty state, inline error.
> 
> ### 7.5 Motion
> 
> - Subtle transitions: card press feedback, sheet/panel slide-in, capacity bar fill animation, toast slide.
> - Respect `prefers-reduced-motion`.
> 
> ### 7.6 Responsive
> 
> - Mobile-first, from 360 px wide.
> - Tablet: schedule cards in 2 columns.
> - Desktop (≥ 1024 px): schedule list with class detail as a side panel; max content width so lines don't stretch.
> - No horizontal scrolling of the page (the day strip may scroll horizontally on small screens).
> - Touch targets at least 44 × 44 px.
> 
> ### 7.7 Accessibility
> 
> - Full keyboard navigation, visible focus states.
> - Semantic structure and labels for screen readers (e.g. capacity bar announces "6 of 20 spots left").
> - Colour is never the only signal — type tags include text, status badges include text/icons.
> - Dialogs trap focus and close with Escape.
> 
> ---
> 
> ## 8. Time and Timezone
> 
> - All times are in the studio's local timezone: **Europe/London**.
> - 24-hour time format (e.g. 07:00, 18:30).
> - "Today" is based on the studio timezone.
> 
> ---
> 
> ## 9. Non-Functional Requirements
> 
> - Schedule for a selected day renders in under 1 second on a mid-range phone with seed data.
> - Booking/cancel actions give visual feedback within 100 ms (optimistic UI), with rollback and an error toast if the action fails.
> - Duplicate taps on `Book` must not create duplicate bookings.
> - Users never see raw server errors or stack traces.
> 
> ---
> 
> ## 10. Testing Requirements
> 
> The project should include automated tests for the business rules:
> 
> - Booking succeeds when spots are available.
> - Booking is rejected when the class is full; waitlist join succeeds.
> - Waitlist promotion on cancellation.
> - Booking window (7 days ahead, 15 minutes before start).
> - Late-cancellation flag inside 2 hours.
> - Overlapping booking rejected.
> - 10-booking limit enforced.
> - Past and studio-cancelled classes cannot be booked.
> 
> Plus at least one end-to-end test: open schedule → filter by Yoga → book a class → see it in My Bookings → cancel it.
> 
> ---
> 
> ## 11. Acceptance Criteria Examples
> 
> **Booking**
> 
> Given "Sunrise Vinyasa" has 20 spots and 18 booked,
> When the member taps `Book`,
> Then the card shows `Booked ✓`, the availability reads "1 spot left", and the class appears under Upcoming in My Bookings.
> 
> **Waitlist**
> 
> Given "Power HIIT" is full with 2 on the waitlist,
> When the member taps `Join waitlist`,
> Then the button shows `Waitlisted #3`.
> 
> **Waitlist promotion**
> 
> Given the member is #1 on the waitlist for a full class,
> When a booked member cancels,
> Then the member's status becomes `Booked`.
> 
> **Late cancellation**
> 
> Given a booked class starts in 90 minutes,
> When the member taps `Cancel booking`,
> Then the confirmation dialog shows the late-cancellation warning.
> 
> **Overlap**
> 
> Given the member is booked for 18:00–18:45 Power HIIT,
> When they try to book 18:30 Spin on the same day,
> Then booking is rejected with a message naming Power HIIT.
> 
> **Responsive**
> 
> Given a 375 px wide viewport,
> Then all three screens are fully usable with no horizontal page scroll, and the class detail action button stays visible.
> 
> ---
> 
> ## 12. Out of Scope
> 
> - Sign in, sign up, password reset (a single demo member is pre-signed-in).
> - Payments, credits, class packs, membership purchase.
> - Staff / instructor / admin screens and schedule editing.
> - Email, SMS, or push notifications.
> - Calendar export / sync.
> - Multiple studio locations.
> - Native mobile apps.
> - Multi-language support.
> 
> ---
> 
> ## 13. Open Questions
> 
> To be treated as assumptions if not clarified:
> 
> - Should the waitlist promotion notify the member in-app? (Assume: a badge/toast next time they open the app.)
> - Should "Classes this month" count only `Attended`? (Assume: yes.)
> - Streak definition? (Assume: consecutive weeks with at least one attended class.)
> 
> ---
> 
> ## 14. Final Scope Summary
> 
> A responsive, mobile-first class booking app with 3 screens:
> 
> 1. **Schedule** — week day strip, filters, colour-coded class cards with live availability and inline booking.
> 2. **Class Detail** — rich class info, instructor, availability, sticky book/cancel/waitlist action.
> 3. **My Bookings** — stats, upcoming and past bookings with quick actions.
> 
> Backed by seed data, persistent bookings, enforced business rules (capacity, waitlist, booking and cancellation windows, overlap, limit), a token-based design system with per-class-type accent colours, dark mode, motion, and accessibility.
> 
> This run builds the API side of the product above, in an existing .NET API project. Build every operation of the locked API contract in contracts/openapi.yaml, exactly as it is written there. Keep the data in the project's local SQLite database, with a few rows of sample data so each list has something to show. The web app is built in its own repo; do not build screens here.

**Q-6** After the member cancels a booking or leaves a waitlist, can they book or join the same class again? If so, does that create a new booking row?
  A. Yes. Cancelled rows don't count for already_booked, and a new row is created   ← recommended: The past list keeps the cancelled record, and the member is not blocked for no reason.
  B. No. Any earlier booking for the session returns already_booked
  (why it matters: It changes which bookings are written and which are rejected.)

**Q-7** How should promotion notices (listed until acknowledged) be stored?
  A. Fields on the booking (promoted-at and notice-acknowledged)   ← recommended: Each notice belongs to exactly one promoted booking, so a separate table isn't needed.
  B. A separate notices table
  (why it matters: It decides what the API writes and what the member is shown.)

**Q-8** How much sample data should be seeded, and what dates should it use? The request says 'a few rows', but §4.3 asks for 40+ sessions over the current and next week, including full, almost-full and cancelled classes and the demo member's bookings.
  A. Seed the §4.3 set, with dates relative to the day the database is first created (current and next week in Europe/London)
  B. Seed only a few rows (a handful of sessions plus the demo member's bookings), relative to the day the database is created   ← recommended: This run's request asks for 'a few rows'. Relative dates keep the booking window rules testable.
  C. Seed fixed calendar dates
  (why it matters: It decides what data exists and what every list shows.)

Assumed unless you say otherwise:
- ASM-11: The contract's server URL is /api, and its paths are written without that prefix (/me, /bookings, …). Where should the endpoints be mapped? → assumed: Map them under an /api route group (GET /api/me), so the paths in the built document still match the contract
- ASM-12: What should happen to the existing GET / route that returns "API is up"? → assumed: Keep it, still left out of the OpenAPI document
- ASM-13: Should the rule numbers be constants in code or configuration? These are: the limit of 10 bookings, the 7-day and 15-minute booking window, the 2-hour late cancel, the 5-second undo and the Europe/London timezone. → assumed: Constants in code
- ASM-14: How should the time rules get the current time, so that tests can check the windows (7 days, 15 minutes, 2 hours, 5-second undo)? → assumed: Inject TimeProvider (system clock by default), so tests can substitute a fake clock
- ASM-15 (high risk, confirm on the approval card): The demo member is first on a waitlist. If promoting them would break the overlap rule or the limit of 10, what should promotion do? → assumed: Promote anyway (promotion is not a new booking request)
- ASM-16 (high risk, confirm on the approval card): Duplicate taps on Book must not create duplicate bookings. How strong does that guarantee need to be? → assumed: Rely on the already_booked check inside the same request (there is one member, so no extra machinery)
- ASM-17: If a database read or write fails, or another exception is not handled, what should the API return? → assumed: The contract's Error body with code storage_failure and a plain message, and no stack trace, using the status the contract declares

Answer with letters or your own words:
  factory answer 20261006-boutique-fitness-studio-class-31fe 45020f4b Q-6=A Q-7=A Q-8=A
  (use quotes for words: Q-6="only for guest checkouts")

Card hash: 45020f4b