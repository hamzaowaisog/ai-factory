# Approval: Build every operation of the locked API contract in contracts/openapi.

Run 20261006-boutique-fitness-studio-class-31fe · risk **high** · feature · size L · cost so far $6.19

## Your request (word for word)
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


## Your answers
- Q-1 What should undo do to the stored booking, and what should it return on success? → **Delete the booking row (as if it was never made) and return exactly the status and body that the contract declares for undoBooking**
- Q-2 When a Booked class has ended, does the booking become Attended? This affects the past list, 'classes this month' and the streak. → **Treat it as Attended when read (derived, not stored)**
- Q-3 Should the /test simulate-other-member-cancellation hook be available in every environment? → **Always map it, as the contract lists it**
- Q-4 Only the demo member exists, so how are other members' bookings and waitlist places represented, and how does promotion work when the demo member is not first in line (on cancel or simulate)? → **Store other members as counts on the session (booked and waitlist). Promoting an anonymous first-in-line member lowers the waitlist count and moves the demo member's position up; the demo member is promoted only when they are first**
- Q-5 The build runs Program.cs to write the OpenAPI document, and the code comment says nothing touches the database at startup. When and how should the SQLite schema and sample data be created? → **Call EnsureCreated and seed at startup only when the database is empty, and skip this when the app is run to generate the OpenAPI document**
- Q-6 After the member cancels a booking or leaves a waitlist, can they book or join the same class again? If so, does that create a new booking row? → **Yes. Cancelled rows don't count for already_booked, and a new row is created**
- Q-7 How should promotion notices (listed until acknowledged) be stored? → **Fields on the booking (promoted-at and notice-acknowledged)**
- Q-8 How much sample data should be seeded, and what dates should it use? The request says 'a few rows', but §4.3 asks for 40+ sessions over the current and next week, including full, almost-full and cancelled classes and the demo member's bookings. → **Seed only a few rows (a handful of sessions plus the demo member's bookings), relative to the day the database is created**

## Confirm these assumptions (high risk)
- [ ] ASM-3 How much sample data should the seed contain? The run instruction asks for 'a few rows'; §4.3 of the request asks for at least 40 sessions over two weeks. → assumed: No; the system starts empty, with seed data for set-up.
- [ ] ASM-4 Should seed session times be fixed dates, or calculated from the date the database is created? The booking window and the 'past' rules depend on the current time. → assumed: Calculate them relative to the current week at the time of seeding, in Europe/London
- [ ] ASM-5 If the demo member is promoted from a waitlist but the promotion would overlap another Booked class or go over the 10-booking limit, what should happen? → assumed: Promote anyway, because promotion is automatic
- [ ] ASM-15 The demo member is first on a waitlist. If promoting them would break the overlap rule or the limit of 10, what should promotion do? → assumed: Promote anyway (promotion is not a new booking request)
- [ ] ASM-16 Duplicate taps on Book must not create duplicate bookings. How strong does that guarantee need to be? → assumed: Rely on the already_booked check inside the same request (there is one member, so no extra machinery)

Other assumptions: ASM-1 The contract's server URL is /api and its paths are /me, /bookings and so on. Where should the endpoints actually answer, while the generated OpenAPI document still matches the contract? → assumed: Map the paths exactly as written (/me, …), add UsePathBase("/api") so /api/me also works, and declare server /api in the generated document; ASM-2 What should happen to the existing GET / route that returns "API is up"? → assumed: Keep it as it is, excluded from the OpenAPI document; ASM-6 Should the rule numbers (7 days, 15 minutes, 2 hours, 5-second undo, limit of 10) and the demo member's identity be code constants or configuration? → assumed: Code constants; ASM-7 Which timezone and boundaries apply to 'today', week, month, streak and the timeOfDay filter? In particular, is a class starting at exactly 12:00 or 17:00 Morning, Afternoon or Evening? → assumed: Europe/London for everything; Morning < 12:00, Afternoon 12:00–16:59, Evening ≥ 17:00; ASM-8 How should duplicate Book taps be prevented from creating duplicate bookings? → assumed: Check already_booked inside the same database transaction before inserting; ASM-9 Should this run add the automated business-rule tests from §10, and how is the clock controlled in those tests? → assumed: Add rule tests in App.Tests through WebApplicationFactory, with time injected using .NET's TimeProvider; the end-to-end test belongs to the web repo; ASM-10 The contract's description says it is served in the browser over local storage, but this run uses SQLite. Should that description text change? → assumed: Leave the locked contract untouched; ASM-11 The contract's server URL is /api, and its paths are written without that prefix (/me, /bookings, …). Where should the endpoints be mapped? → assumed: Map them under an /api route group (GET /api/me), so the paths in the built document still match the contract; ASM-12 What should happen to the existing GET / route that returns "API is up"? → assumed: Keep it, still left out of the OpenAPI document; ASM-13 Should the rule numbers be constants in code or configuration? These are: the limit of 10 bookings, the 7-day and 15-minute booking window, the 2-hour late cancel, the 5-second undo and the Europe/London timezone. → assumed: Constants in code; ASM-14 How should the time rules get the current time, so that tests can check the windows (7 days, 15 minutes, 2 hours, 5-second undo)? → assumed: Inject TimeProvider (system clock by default), so tests can substitute a fake clock; ASM-17 If a database read or write fails, or another exception is not handled, what should the API return? → assumed: The contract's Error body with code storage_failure and a plain message, and no stack trace, using the status the contract declares

## Requirements
- **REQ-1** (ADDED) When the build generates the API's OpenAPI document into App.Api/openapi (file built.json), the API shall emit a document with the same 13 operationIds, paths (as written in the contract, without the /api prefix), HTTP methods, parameters, request bodies, response status codes and component schemas as contracts/openapi.yaml, with server url /api and without the existing GET / route (which keeps answering "API is up"), leaving contracts/openapi.yaml unedited.
  - AC-1.1 [job] Given A clean checkout; when dotnet build runs on App.Api; then The file App.Api/openapi/built.json exists, lists exactly the 13 operationIds of the contract under the same path and method, and its servers list has url /api
  - AC-1.2 [job] Given The solution has been built, which writes App.Api/openapi/built.json; when The factory's contract comparison job compares the built document with contracts/openapi.yaml; then The returned count of differences is 0 for paths, methods, operationIds, parameters, request bodies, response status codes, schemas (required fields, property types, nullability, enum values) and the server url /api
  - AC-1.3 [job] Given The generated file App.Api/openapi/built.json; when A test reads its paths list; then The list has no entry for "/" and contains exactly getMember, getSchedule, getSession, createBooking, undoBooking, cancelBooking, joinWaitlist, leaveWaitlist, getMyBookings, getStats, listPromotionNotices, acknowledgePromotionNotices and simulateOtherMemberCancellation
  - AC-1.4 [api] Given The API is running; when A client sends GET /; then The response status is 200 and the body is "API is up"
  - AC-1.5 [job] Given The build has run; when contracts/openapi.yaml is compared with its committed version; then The file content is unchanged
- **REQ-2** (ADDED) The API shall answer each of the 13 operations of contracts/openapi.yaml with the HTTP method the contract declares, both at the /api-prefixed path (for example GET /api/me) and at the path as written (for example GET /me).
  - AC-2.1 [api] Given The API is running on seeded data; when GET /me and GET /api/me are called; then Both responses have status 200 and identical JSON bodies
  - AC-2.2 [api] Given The API is running on seeded data; when Each of the 13 contract operations is called once under /api with a valid request; then Every response status is one the contract declares for that operation, and no call returns 404 for an unmapped route or 405
  - AC-2.3 [api] Given The API is running with the seeded database; when A client sends GET /api/me, GET /api/schedule, GET /api/me/bookings, GET /api/me/stats and GET /api/me/promotion-notices; then Every response status is 200 and every response body is JSON that matches the contract schema for that operation
- **REQ-3** (ADDED) When GET /me is called, the API shall return status 200 with the demo member id 1, name "Alex Rivera", initials "AR" and membership "Unlimited Monthly".
  - AC-3.1 [api] Given The API is running; when A client sends GET /api/me; then The response status is 200 and the body fields are id=1, name="Alex Rivera", initials="AR", membership="Unlimited Monthly"
- **REQ-4** (ADDED) When GET /schedule is called with a valid or absent date, the API shall return status 200 with today (the Europe/London date), date (the parameter, or today when absent), weekStart (the Monday of that date's week), canGoPreviousWeek true only when date is in next week, canGoNextWeek true only when date is in the current week, 7 days Monday to Sunday each labelled "ddd d" with isToday and hasSessions (true when at least one session starts that day, ignoring filters), and the selected day's sessions, including studio-cancelled ones, ordered by startsAt ascending.
  - AC-4.1 [api] Given The clock is 2026-10-14T08:00:00Z and sessions exist on Mon 12 and Wed 14 Oct only; when GET /schedule is called with no date; then The response has today "2026-10-14", date "2026-10-14", weekStart "2026-10-12", canGoPreviousWeek false, canGoNextWeek true, 7 days whose third entry is {date "2026-10-14", label "Wed 14", isToday true, hasSessions true} and whose Tue 13 entry has hasSessions false
  - AC-4.2 [api] Given The clock is 2026-10-14 10:00 Europe/London, sessions exist on 2026-10-14 at 18:00, 07:00 and 12:30 London (one of them Cancelled by studio) and no session exists on 2026-10-18; when A client sends GET /api/schedule with no query; then The response status is 200; the days list has 7 entries from "Mon 12" to "Sun 18" with isToday true only for 2026-10-14 and hasSessions false for 2026-10-18; the sessions list has 3 entries in the order 07:00, 12:30, 18:00 including the studio-cancelled one
  - AC-4.3 [api] Given The clock is 2026-10-14T08:00:00Z; when GET /schedule?date=2026-10-21 is called; then The response status is 200 with weekStart "2026-10-19", canGoPreviousWeek true, canGoNextWeek false and no day with isToday true
  - AC-4.4 [api] Given The clock is 2026-10-14T23:30:00Z (00:30 on 15 Oct in Europe/London); when GET /schedule is called with no date; then The response field today is "2026-10-15"
- **REQ-5** (ADDED) If GET /schedule is called with a date that is malformed or outside the current and next Europe/London week, or with a type, intensity or timeOfDay value not in the contract enums, then the API shall return status 400 with Error code invalid_request.
  - AC-5.1 [api] Given The clock is 2026-10-14T08:00:00Z; when GET /api/schedule is called with date=2026-10-11, then date=2026-10-26, then date=2026-10-05, then date=not-a-date, then type=Zumba; then Each response status is 400 and each body field code is "invalid_request" with a non-empty message
- **REQ-6** (ADDED) When GET /schedule includes type, intensity or timeOfDay values, the API shall return in sessions only the selected day's sessions (including studio-cancelled ones) that match at least one listed value of every supplied filter, ignoring filters that are not supplied, where Morning is a Europe/London start before 12:00, Afternoon is 12:00 to 16:59 and Evening is 17:00 or later.
  - AC-6.1 [api] Given On 2026-10-15 there are sessions Yoga/Low at 11:59, Yoga/Medium at 12:00, Spin/High at 16:59, HIIT/High at 17:00 (Europe/London) and a studio-cancelled Yoga/Low at 18:00; when GET /schedule?date=2026-10-15&type=Yoga&type=HIIT&timeOfDay=Afternoon&timeOfDay=Evening is called; then The returned sessions list is exactly [Yoga 12:00, HIIT 17:00, cancelled Yoga 18:00] in that order
  - AC-6.2 [api] Given The same sessions; when GET /schedule?date=2026-10-15&intensity=Low&timeOfDay=Morning is called; then The returned sessions list contains only the Yoga/Low 11:59 session
  - AC-6.3 [api] Given On 2026-10-14 there are a Yoga Low session at 07:00 London, a Pilates Medium session at 12:00 London, and a Boxing Medium session at 17:00 London; when A client sends GET /api/schedule?date=2026-10-14&type=Yoga&type=Boxing, then ?date=2026-10-14&timeOfDay=Afternoon, then ?date=2026-10-14&timeOfDay=Evening&intensity=Medium; then The returned sessions lists are [Yoga, Boxing], [Pilates 12:00] and [Boxing 17:00] respectively
  - AC-6.4 [api] Given On the selected day there are a Yoga Low session at 07:00, a Yoga High session at 12:00, a Spin Low session at 17:00 and a Boxing Medium session at 16:59 (London); when A client sends GET /api/schedule?type=Yoga&type=Spin&intensity=Low, then ?timeOfDay=Afternoon; then The first response sessions list contains exactly the 07:00 Yoga and 17:00 Spin sessions, and the second exactly the 12:00 and 16:59 sessions
- **REQ-7** (ADDED) The API shall return in every Session bookedCount and waitlistCount that include both the demo member and the other members, capacityLabel "{spotsLeft} of {capacity} spots left", and availabilityLabel "Cancelled" for a studio-cancelled session, otherwise "Full · N on waitlist" when full with N > 0 waiting, "1 spot left" for 1 spot, "Only N left" for 2 or 3 spots, and "N spots left" for 4 or more spots.
  - AC-7.1 [api] Given Scheduled sessions with capacity/booked/waitlist of 20/14/0, 12/10/0, 12/11/0, 16/16/3 and a studio-cancelled session 20/0/0; when GET /sessions/{id} is called for each; then The availabilityLabel values are "6 spots left", "Only 2 left", "1 spot left", "Full · 3 on waitlist" and "Cancelled", and the capacityLabel values are "6 of 20 spots left", "2 of 12 spots left", "1 of 12 spots left", "0 of 16 spots left" and "20 of 20 spots left"
  - AC-7.2 [api] Given A Scheduled session has capacity 16, 16 booked by other members and 3 others on the waitlist; when A client sends GET /api/sessions/{id}; then The response fields are bookedCount=16 and waitlistCount=3
  - AC-7.3 [api] Given A session has status Cancelled by studio; when A client sends GET /api/sessions/{id}; then The response fields are status="Cancelled by studio" and availabilityLabel="Cancelled"
- **REQ-9** (ADDED) While a Scheduled session is full, the API shall return its availabilityLabel as "Full · {waitlistCount} on waitlist", which gives "Full · 0 on waitlist" when nobody is waiting.
  - AC-9.1 [api] Given A Scheduled session has capacity 16, bookedCount 16 and waitlistCount 0; when GET /sessions/{id} is called; then The response field availabilityLabel is "Full · 0 on waitlist"
- **REQ-10** (ADDED) The API shall derive each Session's actionState and myBookingId for the demo member: disabled with canChange false and reason "Cancelled by studio" when the session is studio-cancelled, whether or not the demo member holds a record; otherwise booked (with bookingId and lateCancellation true when under 2 hours to start) or waitlisted (with bookingId and position) when the demo member holds that record, with canChange false once the class has started; otherwise disabled with canChange false and reason "Class has started", "Booking opens 7 days before class" or "Booking closes 15 minutes before class"; otherwise join_waitlist with position waitlistCount + 1 when full; otherwise book with spotsLeft.
  - AC-10.1 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member holds no record for sessions starting at T+1d (8 of 12 booked), T+1d (12 of 12 booked, 2 waiting), T+8d, T+10min and T-5min; when GET /sessions/{id} is called for each; then The actionState values returned are {kind book, canChange true, spotsLeft 4}, {kind join_waitlist, position 3}, {kind disabled, canChange false, reason "Booking opens 7 days before class"}, {kind disabled, reason "Booking closes 15 minutes before class"} and {kind disabled, reason "Class has started"}, each with myBookingId null
  - AC-10.2 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member has Booked record 501 for a session starting at 09:30Z and Waitlisted record 502 at position 2 for another session starting at 10:00Z; when GET /sessions/{id} is called for both; then The first response has actionState {kind booked, canChange true, bookingId 501, lateCancellation true} with myBookingId 501, and the second has {kind waitlisted, canChange true, bookingId 502, position 2} with myBookingId 502
  - AC-10.3 [api] Given The clock is 2026-10-14T09:00:00Z, a full session starting tomorrow has 3 others on the waitlist, and a session starting tomorrow has capacity 12 and 10 booked, neither with a demo record; when A client sends GET /api/sessions/{id} for each; then The first response actionState is kind=join_waitlist with position=4 and the second kind=book with spotsLeft=2, both with myBookingId null
  - AC-10.4 [api] Given The demo member holds a Booked record for a session that started 10 minutes ago and has not ended; when A client reads that session; then The response actionState has kind "booked" and canChange false
  - AC-10.5 [api] Given The demo member holds no record for a Cancelled by studio session starting tomorrow; when A client sends GET /api/sessions/{id}; then The response actionState has kind "disabled", canChange false and reason "Cancelled by studio"
- **REQ-11** (ADDED) When the demo member holds a Booked or Waitlisted record for a studio-cancelled session, the API shall return that Session's actionState as disabled with canChange false and reason "Cancelled by studio", checked before the demo member's record.
  - AC-11.1 [api] Given The demo member holds a Booked record for a session that is Cancelled by studio; when GET /sessions/{id} is called; then The response field actionState is {kind disabled, canChange false, reason "Cancelled by studio"}
- **REQ-13** (ADDED) When GET /sessions/{sessionId} is called, the API shall return status 200 with the full Session including its instructor, whatToBring list, counts, labels, actionState and myBookingId, or status 404 with Error code not_found when no session has that id.
  - AC-13.1 [api] Given A session with id 210 exists with an instructor and two whatToBring items; when A client sends GET /api/sessions/210; then The response status is 200 and the body has id 210, every field the contract's Session schema requires, the instructor object with id, name, bio and avatarUrl, and a whatToBring list with 2 items
  - AC-13.2 [api] Given No session has id 999999; when GET /sessions/999999 is called; then The response status is 404 and the body field code is "not_found"
- **REQ-14** (ADDED) If a request names a sessionId or bookingId that does not exist, then the API shall return status 404 with Error code not_found.
  - AC-14.1 [api] Given No session with id 99999 exists; when A client sends POST /api/bookings {"sessionId":99999}, POST /api/waitlist {"sessionId":99999} or POST /api/test/sessions/99999/simulate-other-member-cancellation; then Each response status is 404 and the error code field is not_found
  - AC-14.2 [api] Given No booking with id 99999 exists; when A client sends POST /api/bookings/99999/undo, /cancel or /leave-waitlist; then Each response status is 404 and the error code field is not_found
- **REQ-15** (ADDED) If the request body of POST /bookings or POST /waitlist is missing, malformed or has no integer sessionId, then the API shall return status 400 with Error code invalid_request.
  - AC-15.1 [api] Given The API is running; when POST /api/bookings is called with body {}, POST /api/waitlist with body {"sessionId":"abc"} and POST /api/waitlist with body "not json"; then Each response status is 400 with body field code "invalid_request"
- **REQ-16** (ADDED) When POST /bookings is called for a session that passes every booking rule, the API shall store a Booked record for the demo member and return status 201 with a BookingChange whose booking has status Booked and lateCancel false, whose session shows bookedCount increased by 1 and actionState booked, and whose message is "You're booked for {name} · {ddd HH:mm}" in Europe/London time.
  - AC-16.1 [api] Given The clock is 2026-10-14T08:00:00Z and "Sunrise Vinyasa" starts 2026-10-15T06:00:00Z with capacity 20 and bookedCount 18; when POST /bookings {sessionId} is called; then The response status is 201, booking.status is "Booked", session.bookedCount is 19, session.actionState.kind is "booked", message is "You're booked for Sunrise Vinyasa · Thu 07:00", and a booking row with status Booked exists in the database
  - AC-16.2 [api] Given The booking from AC-16.1 has been made; when GET /me/bookings is called; then The returned upcoming list contains a row for Sunrise Vinyasa with status "Booked" and badge "Booked"
  - AC-16.3 [api] Given The clock is 2026-10-14 07:42 London and session 102 "Reformer Core" starts Wed 2026-10-14 09:30 London with capacity 12 and bookedCount 10; when A client sends POST /api/bookings with body {"sessionId":102}; then The response status is 201; booking.lateCancel is false, booking.cancelledAt is null; session.bookedCount is 11, session.availabilityLabel is "1 spot left"; message is "You're booked for Reformer Core · Wed 09:30"
  - AC-16.4 [api] Given The booking from AC-16.3 was created; when The test reads the bookings table in SQLite; then Exactly one row for that session has status Booked with the returned booking id
- **REQ-17** (ADDED) If POST /bookings targets a session that is Cancelled by studio, has started, starts more than 7 days from now or starts less than 15 minutes from now, then the API shall return status 409 with Error code cancelled_by_studio, class_has_started or outside_booking_window respectively, checking in that order, and store no record.
  - AC-17.1 [api] Given The clock is 2026-10-14T08:00:00Z and sessions with spots start at T+7d+1min, T+14min, T-1min, plus a studio-cancelled session at T+1d; when POST /bookings is called for each; then The response statuses are all 409 with codes "outside_booking_window", "outside_booking_window", "class_has_started" and "cancelled_by_studio", and the count of booking rows is unchanged
  - AC-17.2 [api] Given The clock is 2026-10-14T08:00:00Z and sessions with spots start at exactly T+7d and exactly T+15min; when POST /bookings is called for each; then Both response statuses are 201
  - AC-17.3 [api] Given The clock is 2026-10-14T09:00:00Z; when A client books sessions starting at 2026-10-21T09:00:00Z, 2026-10-21T09:01:00Z, 2026-10-14T09:15:00Z and 2026-10-14T09:14:00Z; then The response statuses are 201, 409 outside_booking_window, 201 and 409 outside_booking_window respectively
- **REQ-18** (ADDED) If POST /bookings or POST /waitlist targets a session for which the demo member already holds a Booked or Waitlisted record (Cancelled records do not count, so a new record can be created after cancelling or leaving), then the API shall return status 409 with Error code already_booked, checked in the same request or transaction as the insert, without storing a record.
  - AC-18.1 [api] Given A session starting tomorrow with spots left and no demo record; when A client sends POST /api/bookings for it twice in a row; then The first response status is 201, the second response status is 409 with code "already_booked", and the count of non-cancelled booking rows for that session is 1
  - AC-18.2 [api] Given The demo member holds a Waitlisted record for a full session; when A client sends POST /api/waitlist for that session; then The response status is 409 with code "already_booked"
  - AC-18.3 [api] Given The demo member booked session S and then cancelled that booking; when POST /bookings {sessionId: S} is called; then The response status is 201 with a booking id different from the cancelled one, and the database has 2 booking rows for S (one Cancelled, one Booked)
- **REQ-19** (ADDED) If POST /bookings targets a session whose bookedCount has reached capacity, then the API shall return status 409 with Error code class_full and the refreshed Session in the error's session field, whose actionState is join_waitlist, without storing a record.
  - AC-19.1 [api] Given "Power HIIT" is bookable by time, has capacity 16, bookedCount 16 and waitlistCount 2; when POST /bookings is called for it; then The response status is 409, code is "class_full", session.waitlistCount is 2, session.actionState is {kind join_waitlist, position 3}, and the count of the demo member's booking rows for that session is 0
- **REQ-20** (ADDED) If POST /bookings targets a session whose time range overlaps a session for which the demo member holds a Booked record (half-open ranges, so back-to-back classes do not overlap, and Waitlisted records do not count), then the API shall return status 409 with Error code overlap and the message "You're already booked for {name} at {HH:mm}–{HH:mm}." naming the conflicting class in Europe/London time.
  - AC-20.1 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member is Booked for "Power HIIT" 2026-10-15T17:00Z–17:45Z; when POST /bookings is called for a Spin session 2026-10-15T17:30Z–18:15Z; then The response status is 409, code is "overlap" and message is "You're already booked for Power HIIT at 18:00–18:45."
  - AC-20.2 [api] Given The same Power HIIT booking; when POST /bookings is called for a session starting exactly 2026-10-15T17:45Z; then The response status is 201
  - AC-20.3 [api] Given The demo member is only Waitlisted on a session from 17:00Z to 17:45Z; when A client books a session starting 17:30Z the same day; then The response status is 201
- **REQ-21** (ADDED) If POST /bookings is called while the demo member holds 10 Booked records for sessions that have not started, then the API shall return status 409 with Error code limit_reached and the message "You've reached the limit of 10 upcoming classes."
  - AC-21.1 [api] Given The demo member holds 10 Booked records for future, non-overlapping sessions; when POST /bookings is called for an 11th bookable, non-overlapping session; then The response status is 409, code is "limit_reached", message is "You've reached the limit of 10 upcoming classes." and the count of Booked rows stays 10
  - AC-21.2 [api] Given The demo member holds 9 Booked records for future sessions and 1 Booked record for a session that has ended; when POST /bookings is called for another bookable session; then The response status is 201
  - AC-21.3 [api] Given The demo member holds 9 upcoming Booked records, 2 Waitlisted records and 3 past Attended bookings; when A client books another non-overlapping bookable session; then The response status is 201
- **REQ-22** (ADDED) When POST /bookings/{bookingId}/undo is called for a Booked record no more than 5 seconds after its createdAt, the API shall delete the booking row and return status 200 with an UndoResult whose session shows the counts as if the booking was never made and whose message is "Booking undone — {name}", returning 409 undo_expired after 5 seconds, 409 invalid_booking_state when the record is not Booked, and 404 not_found for an unknown id.
  - AC-22.1 [api] Given Booking B for "Reformer Core" (bookedCount 10 → 11) was created at T and the clock is T+5s; when POST /bookings/B/undo is called; then The response status is 200, message is "Booking undone — Reformer Core", session.bookedCount is 10, session.myBookingId is null, and no booking row with id B exists
  - AC-22.2 [api] Given Booking 503 on "Reformer Core" was created at T and the clock is T+4s; when A client sends POST /api/bookings/503/undo; then The response status is 200 and no row with id 503 remains in the bookings table
  - AC-22.3 [api] Given Booking B was created at T and the clock is T+6s; when POST /bookings/B/undo is called; then The response status is 409 with code "undo_expired" and row B still has status Booked
  - AC-22.4 [api] Given Booking B was cancelled within 5 seconds of creation, and Waitlisted record W was created 1 second ago; when POST /bookings/B/undo and POST /bookings/W/undo are called; then Both response statuses are 409 with code "invalid_booking_state"
  - AC-22.5 [api] Given No record 99999 exists; when POST /api/bookings/99999/undo is called; then The response status is 404 with code "not_found"
- **REQ-23** (ADDED) When POST /bookings/{bookingId}/cancel is called for a Booked record whose class has not started, the API shall store it as Cancelled with cancelledAt set to now and lateCancel true only when the class starts less than 2 hours from now, and return status 200 with a BookingChange whose message begins "Booking cancelled — {name}", returning 409 class_has_started if the class has started, 409 invalid_booking_state if the record is not Booked, and 404 not_found for an unknown id.
  - AC-23.1 [api] Given The clock is 2026-10-14T16:30:00Z and the demo member's Booked record 506 is on "Power Spin" starting 2026-10-14T18:00:00Z (90 minutes away); when A client sends POST /api/bookings/506/cancel; then The response status is 200, booking.status="Cancelled", booking.lateCancel=true, booking.cancelledAt="2026-10-14T16:30:00Z", and message="Booking cancelled — Power Spin, today 19:00"
  - AC-23.2 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member has Booked records for sessions starting at T+2h and at T+1h59m; when POST /bookings/{id}/cancel is called for each; then Both response statuses are 200 with booking.status "Cancelled" and booking.cancelledAt "2026-10-14T08:00:00Z"; booking.lateCancel is false for T+2h and true for T+1h59m
  - AC-23.3 [api] Given The demo member has a Booked record for a session that started 1 minute ago; when POST /bookings/{id}/cancel is called; then The response status is 409 with code "class_has_started" and the row status is still Booked
  - AC-23.4 [api] Given A Waitlisted record W, a Cancelled record C, and no record 99999; when A client cancels W, C and 99999; then The responses are status 409 code "invalid_booking_state", status 409 code "invalid_booking_state", and status 404 code "not_found" respectively
- **REQ-24** (ADDED) When the demo member cancels a Booked record, the API shall update the session counts by lowering waitlistCount by 1 and leaving bookedCount unchanged when waitlistCount is greater than 0 (promoting the first anonymous waitlisted member), or by lowering bookedCount by 1 when waitlistCount is 0.
  - AC-24.1 [api] Given A session has capacity 10, bookedCount 10 including the demo member's Booked record, and waitlistCount 3; when POST /bookings/{id}/cancel is called for the demo member's record; then The returned session has bookedCount 10, waitlistCount 2 and availabilityLabel "Full · 2 on waitlist"
  - AC-24.2 [api] Given A session has capacity 20, bookedCount 18 including the demo member, and waitlistCount 0; when The demo member's booking is cancelled; then The returned session has bookedCount 17 and waitlistCount 0
- **REQ-25** (ADDED) When POST /waitlist is called for a full session that passes the booking rules, the API shall store a Waitlisted record with waitlistPosition equal to the previous waitlistCount + 1 and return status 201 with a BookingChange whose session shows waitlistCount increased by 1 and actionState waitlisted, and whose message is "You're on the waitlist for {name} · {ddd HH:mm} — you're #{position}" in Europe/London time.
  - AC-25.1 [api] Given The clock is 2026-10-14T08:00:00Z and "Power HIIT" starts 2026-10-15T17:00:00Z, full with waitlistCount 2; when POST /waitlist {sessionId} is called; then The response status is 201, booking.status is "Waitlisted", booking.waitlistPosition is 3, session.waitlistCount is 3, session.actionState is {kind waitlisted, position 3}, and message is "You're on the waitlist for Power HIIT · Thu 18:00 — you're #3"
  - AC-25.2 [api] Given Session 103 "HIIT Blast" starts Wed 2026-10-14 12:15 London with capacity 16, bookedCount 16 and waitlistCount 3; the clock reads 2026-10-14 08:50 London; when A client sends POST /api/waitlist with body {"sessionId":103}; then The response status is 201; booking.waitlistPosition is 4; session.waitlistCount is 4, session.availabilityLabel is "Full · 4 on waitlist"; message is "You're on the waitlist for HIIT Blast · Wed 12:15 — you're #4"
- **REQ-26** (ADDED) If POST /waitlist targets a session that is Cancelled by studio, has started, is outside the 7-day / 15-minute booking window, or still has spots, then the API shall return status 409 with Error code cancelled_by_studio, class_has_started, outside_booking_window or not_full respectively, checked in that order after not_found and already_booked rules as listed in the assumptions, without storing a record.
  - AC-26.1 [api] Given A bookable session has 2 spots left; when POST /waitlist is called for it; then The response status is 409 with code "not_full" and no booking row is created
  - AC-26.2 [api] Given The clock is 2026-10-14T08:00:00Z and a full session started at T-1min; when POST /waitlist is called for it; then The response status is 409 with code "class_has_started"
  - AC-26.3 [api] Given The clock reads 2026-10-14 10:00 London; full sessions that are Cancelled by studio, started at 09:30 today, start at 2026-10-21 10:01, and start at 10:10 today; when A client sends POST /api/waitlist for each; then The responses all have status 409 with codes "cancelled_by_studio", "class_has_started", "outside_booking_window" and "outside_booking_window" respectively, and the count of Waitlisted rows for the demo member does not change
- **REQ-27** (ADDED) When POST /bookings/{bookingId}/leave-waitlist is called for a Waitlisted record whose class has not started, the API shall store it as Cancelled with lateCancel false, waitlistPosition null and cancelledAt now, lower the session's waitlistCount by 1, and return status 200 with a BookingChange whose message is "You've left the waitlist for {name}", returning 409 class_has_started if the class has started, 409 invalid_booking_state if the record is not Waitlisted, and 404 not_found for an unknown id.
  - AC-27.1 [api] Given The demo member holds Waitlisted record 504 at position 2 for "Vinyasa Flow" starting in 30 minutes, with waitlistCount 3; when A client sends POST /api/bookings/504/leave-waitlist; then The response status is 200; booking.status is "Cancelled", booking.lateCancel is false, booking.cancelledAt is not null, booking.waitlistPosition is null; session.waitlistCount is 2, session.actionState.kind is "join_waitlist" with position 3; message is "You've left the waitlist for Vinyasa Flow"
  - AC-27.2 [api] Given A Booked record K, a Waitlisted record P whose class started 5 minutes ago, and no record 99999; when A client sends leave-waitlist for K, P and 99999; then The responses are status 409 code "invalid_booking_state", status 409 code "class_has_started", and status 404 code "not_found" respectively
- **REQ-28** (ADDED) When POST /test/sessions/{sessionId}/simulate-other-member-cancellation is called in any environment, the API shall promote the demo member to Booked (clearing waitlistPosition and recording promoted-at so a promotion notice is listed) when they are first on the waitlist, otherwise lower waitlistCount by 1 and move the demo member's waitlist position up by 1 when the waitlist is not empty, otherwise lower bookedCount by 1, and return status 200 with a SimulationResult holding the refreshed session (booking null when the demo member holds no Waitlisted record), or 404 not_found for an unknown session.
  - AC-28.1 [api] Given Session 105 is full with capacity 14, bookedCount 14, waitlistCount 2, and the demo member holds Waitlisted record 502 at position 1; when A client sends POST /api/test/sessions/105/simulate-other-member-cancellation; then The response status is 200; booking.id is 502, booking.status is "Booked", booking.waitlistPosition is null; session.bookedCount is 14, session.waitlistCount is 1, session.actionState.kind is "booked"; the database row 502 has a non-null promoted-at value
  - AC-28.2 [api] Given A session has capacity 14, bookedCount 14 (all other members), and waitlistCount 1 which is the demo member's Waitlisted record 502 at position 1; when A client calls the simulate hook and then GET /api/me/promotion-notices; then The simulate response has session.waitlistCount=0 and the returned notices list includes booking 502
  - AC-28.3 [api] Given A session has bookedCount 10 and waitlistCount 0, none held by the demo member; when The simulate hook is called; then The response status is 200, the returned session has bookedCount 9 and booking is null
  - AC-28.4 [api] Given The API runs with ASPNETCORE_ENVIRONMENT=Production; when The simulate hook is called for an existing session, and then for session id 999999; then The first response status is 200 and the second is 404 with code "not_found"
- **REQ-30** (ADDED) When the simulate hook runs and the demo member holds a Waitlisted record on that session but is not first in line, the API shall return that Waitlisted booking with its new waitlistPosition in the SimulationResult and list no promotion notice.
  - AC-30.1 [api] Given A full session has waitlistCount 2: one other member first and the demo member at position 2; when A client calls the simulate endpoint for it; then The response booking.status is "Waitlisted" with waitlistPosition=1, session.waitlistCount=1, session.bookedCount unchanged, and no promotion notice is listed
  - AC-30.2 [api] Given A full session with waitlistCount 4 where the demo member holds a Waitlisted record at position 3; when A client calls the simulate hook for it; then The response status is 200; booking.status is "Waitlisted" and booking.waitlistPosition is 2; session.waitlistCount is 3
- **REQ-31** (ADDED) When the demo member is promoted from a waitlist, the API shall set the booking to Booked even if it overlaps another Booked class or takes the demo member over 10 upcoming Booked classes, with skipReason null.
  - AC-31.1 [api] Given The demo member is Booked for session S1 and Waitlisted #1 on full session S2, which overlaps S1 in time; when The simulate hook is called for S2; then The returned booking.status is "Booked" with skipReason null, and GET /me/bookings lists both S1 and S2 rows with badge "Booked"
  - AC-31.2 [api] Given The demo member holds 10 upcoming Booked records, one of which overlaps a full session where they are Waitlisted at position 1; when A client calls the simulate endpoint for the full session; then The response booking.status is "Booked" and booking.skipReason is null, and GET /api/me/stats then returns upcoming=11
- **REQ-32** (ADDED) When GET /me/promotion-notices is called, the API shall return status 200 with one notice per promoted booking that has not been acknowledged, each with bookingId, sessionId, sessionName, startsAt and message "Good news! You're off the waitlist and booked for {name} · {ddd HH:mm}" in Europe/London time, without acknowledging them.
  - AC-32.1 [api] Given The demo member's Waitlisted booking 509 for "Power Ride" starting 2026-10-15T06:15:00Z was promoted by the simulate hook; when GET /me/promotion-notices is called twice; then Both responses have status 200 and a notices list with one entry {bookingId 509, sessionName "Power Ride", startsAt "2026-10-15T06:15:00Z", message "Good news! You're off the waitlist and booked for Power Ride · Thu 07:15"}
- **REQ-33** (ADDED) When POST /me/promotion-notices/acknowledge is called, the API shall mark every current promotion notice as acknowledged and return status 204 with no body.
  - AC-33.1 [api] Given One unacknowledged promotion notice exists; when A client sends POST /api/me/promotion-notices/acknowledge and then GET /api/me/promotion-notices; then The first response status is 204 with an empty body, the second response notices list is empty, and the booking row has a non-null notice-acknowledged value
- **REQ-34** (ADDED) When GET /me/bookings is called, the API shall return status 200 with upcoming holding the demo member's Booked and Waitlisted records whose class has not ended, grouped by Europe/London day labelled "Today", "Tomorrow" or "ddd d MMM" in date order with rows by start time, and past holding Attended, Cancelled and Cancelled-by-studio records most recent start first, each row with the contract badge (Booked, Waitlisted #N, Attended, Cancelled, Late cancel, Cancelled by studio), canChange and isLateIfCancelledNow.
  - AC-34.1 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member has Booked at 2026-10-14T18:00Z, Waitlisted #2 at 2026-10-15T06:00Z, Booked at 2026-10-16T17:15Z, a late-cancelled record at 2026-10-08T17:00Z and a Booked record that ended 2026-10-10T08:45Z; when GET /me/bookings is called; then The response upcoming list has groups labelled "Today", "Tomorrow", "Fri 16 Oct" with badges "Booked", "Waitlisted #2", "Booked"; the Today row has isLateIfCancelledNow false and canChange true; past lists the 10 Oct row (badge "Attended") before the 8 Oct row (badge "Late cancel"), both with canChange false
  - AC-34.2 [api] Given The clock is 2026-10-14T08:00:00Z and the demo member has a Booked record starting 2026-10-14T09:30Z; when GET /me/bookings is called; then That row's field isLateIfCancelledNow is true
  - AC-34.3 [api] Given The clock is 2026-10-14T09:00:00Z and the demo member holds Waitlisted at position 2 on a session tomorrow; when A client sends GET /api/me/bookings; then The Waitlisted row has badge "Waitlisted #2" and waitlistPosition=2
  - AC-34.4 [api] Given The demo member holds a Booked record for a Cancelled by studio session tomorrow; when A client sends GET /api/me/bookings; then The row for the studio-cancelled session is in the past list with status and badge "Cancelled by studio"
  - AC-34.5 [api] Given The clock reads 2026-10-14 17:30 London and the demo member holds Booked for 19:00 that day and Booked for 2026-10-16 18:15; when A client sends GET /api/me/bookings; then The 19:00 row has isLateIfCancelledNow true and canChange true; the 2026-10-16 row has isLateIfCancelledNow false
- **REQ-35** (ADDED) While a Booked record's class has ended, the API shall report that record with status Attended, badge "Attended" and canChange false in every response, while the stored row keeps status Booked.
  - AC-35.1 [api] Given The demo member's Booked record R is for a session that ended 1 minute before the clock; when GET /me/bookings is called and the bookings table is read; then The response past list has row R with status "Attended", badge "Attended" and canChange false, and database row R still has status Booked
- **REQ-36** (ADDED) When GET /me/stats is called, the API shall return status 200 with upcoming as the count of Booked records whose class has not started, classesThisMonth as the count of Attended records in the current Europe/London calendar month, and currentStreakWeeks as the number of consecutive Monday-to-Sunday London weeks with at least one Attended record, counted back from the current week, or from the previous week when the current week has none yet.
  - AC-36.1 [api] Given The clock is 2026-10-14T08:00:00Z; the demo member has Attended classes on 2026-10-13, 2026-10-06 and 2026-09-30, 2 Booked future records and 1 Waitlisted record; when GET /me/stats is called; then The response is {upcoming: 2, classesThisMonth: 2, currentStreakWeeks: 3}
  - AC-36.2 [api] Given The clock is 2026-10-14T08:00:00Z and the only Attended classes are on 2026-10-07 and 2026-09-23; when GET /me/stats is called; then The response field currentStreakWeeks is 1
  - AC-36.3 [api] Given The clock is 2026-10-14 10:00 London; the demo member's only ended Booked records are on 2026-10-06 and 2026-09-29; when A client sends GET /api/me/stats; then The response currentStreakWeeks value is 2 and classesThisMonth is 1
  - AC-36.4 [api] Given The clock is 2026-10-22T12:00:00Z; the demo member has 2 upcoming Booked records, 1 Waitlisted record, ended Booked records on 2026-10-06, 2026-10-13 and 2026-10-20, and one late-cancelled record on 2026-10-15; when A client sends GET /api/me/stats; then The response fields are upcoming=2, classesThisMonth=3, currentStreakWeeks=3
  - AC-36.5 [api] Given The demo member has no Attended bookings; when A client sends GET /api/me/stats; then The response fields classesThisMonth and currentStreakWeeks are both 0
- **REQ-37** (ADDED) If reading or writing the database fails or any other exception is unhandled, then the API shall return status 500 with an Error body whose code is storage_failure and whose message is plain text without exception type names or stack trace lines.
  - AC-37.1 [api] Given The API is started through WebApplicationFactory with connection string App pointing to a path that cannot be opened; when GET /api/me/bookings and POST /api/bookings are called; then Both response statuses are 500, code is "storage_failure", and the response body contains neither "Exception" nor a line starting with "   at "
  - AC-37.2 [api] Given The API is configured with a SQLite file whose tables have been dropped; when A client sends GET /api/me/bookings; then The response status is 500, the body field code is "storage_failure", and the response body contains neither "Exception" nor "   at "
- **REQ-38** (ADDED) ⚠ only one draft had this The API shall store sessions, instructors and the demo member's bookings in the project's local SQLite database (connection string App, default app.db), so that changes survive an application restart.
  - AC-38.1 [api] Given The API runs against SQLite file test.db and the demo member books session S; when The application is stopped and started again on the same file and GET /me/bookings is called; then The returned upcoming list still contains the booking for S with badge "Booked"
- **REQ-39** (MODIFIED) When the application starts normally, the API shall create the schema with EnsureCreated and insert the sample data only if the SQLite database has no tables or no data, leaving existing data unchanged.
  - AC-39.1 [api] Given No database file exists at the configured connection string; when The application starts and GET /schedule is called; then The response status is 200, the sessions list is not empty, and the database file now exists with session rows
  - AC-39.2 [api] Given The application has started once, seeded the database, and a booking was made through the API; when The application is restarted on the same file and GET /api/me/bookings is called; then The count of session rows is the same as before the restart and the response still returns the booking made before the restart
- **REQ-40** (ADDED) While the application is run by the build to generate the OpenAPI document, the API shall not create, open, migrate or seed the database.
  - AC-40.1 [job] Given A clean checkout with no app.db file; when dotnet build runs and writes App.Api/openapi/built.json; then No app.db file exists afterwards in the App.Api folder or its build output, and no database file is created at the configured path
  - AC-40.2 [manual] Given No app.db file exists in App.Api; when A person runs dotnet build for App.Api; then App.Api/openapi/built.json is written and no app.db file has been created
- **REQ-41** (ADDED) When the sample data is inserted, the API shall seed sessions with instructors timed relative to the Europe/London day of seeding, including at least one session that day, at least one bookable or joinable session, one full session with a waitlist and one Cancelled by studio session, plus demo member bookings with at least one upcoming Booked record, one Waitlisted record and one Booked record for a class that has already ended, so that today's schedule, the Upcoming list and the Past list each return at least one entry.
  - AC-41.1 [api] Given The clock is 2026-11-03T10:00:00Z and no database file exists; when The application starts and GET /schedule and GET /me/bookings are called; then The schedule sessions list for 2026-11-03 has at least 1 entry, the upcoming list has at least 1 row, and the past list has at least 1 row
  - AC-41.2 [api] Given The clock is 2026-11-03T10:00:00Z and the database was just seeded; when GET /schedule is called for each day of the current and next week; then At least 1 returned session has actionState.kind "book" or "join_waitlist"
  - AC-41.3 [api] Given A freshly seeded database; when The test reads the sessions table; then At least 1 row has status Cancelled by studio and at least 1 row has booked count equal to capacity
  - AC-41.4 [api] Given A freshly seeded database with the clock at the seeding time; when A client sends GET /api/schedule for each day of the current and next week, GET /api/me/bookings and GET /api/me/stats; then The returned sessions include one with availabilityLabel starting "Full · " and waitlistCount at least 1 and one with status "Cancelled by studio"; the upcoming list has at least one "Booked" and one "Waitlisted #" badge, the past list has at least one "Attended" row, and stats upcoming is at least 1
- **REQ-42** (ADDED) ⚠ only one draft had this When the sample data is inserted, the API shall seed between 3 and 12 sessions.
  - AC-42.1 [api] Given No database file exists; when The application starts and a test counts session rows; then The session row count is between 3 and 12
- **REQ-43** (ADDED) When the sample data is inserted, the API shall seed at most 15 sessions.
  - AC-43.1 [api] Given No database file exists; when The application starts and a test counts session rows; then The session row count is between 1 and 15
- **REQ-44** (ADDED) The API shall read the current time for every time rule, label, "today" and seed date from the TimeProvider registered in dependency injection, defaulting to the system clock.
  - AC-44.1 [api] Given WebApplicationFactory replaces TimeProvider with a fake clock set to 2026-10-14T08:00:00Z; when GET /schedule is called, the clock is advanced to 2026-10-20T08:00:00Z, and GET /schedule is called again; then The first response field today is "2026-10-14" and the second is "2026-10-20"
  - AC-44.2 [api] Given A WebApplicationFactory replaces TimeProvider with a fake clock set to 2026-10-14T23:30:00Z (00:30 on 15 Oct in London); when A client sends GET /api/schedule; then The response field today is "2026-10-15"

Checked by a person, not by a test: AC-40.2 (screens and manual checks aren't automated yet)

Not changing: Web screens, design system, dark mode, motion, responsive layout and accessibility work; the web app is built in its own repo (request); The end-to-end UI test (schedule → filter → book → My Bookings → cancel), which belongs to the web repo (ASM-9); Seeding 40+ sessions over two weeks with 5 instructors as described in §4.3; only a few rows are seeded (Q-8); Editing contracts/openapi.yaml, including its description that mentions local storage (ASM-10); Sign-in, sign-up, authentication and multiple members; Payments, credits, class packs, membership purchase and membership management; Email, SMS and push notifications; promotion is announced only through the promotion-notices endpoints; Staff, instructor or admin screens/endpoints and schedule editing; Calendar export, multiple locations, native apps and multi-language support (§12); Making rule numbers (7 days, 15 minutes, 2 hours, 5 seconds, limit 10) or the demo member configurable; they stay code constants (ASM-6, ASM-13); Changing the existing GET / "API is up" route, which stays as it is and stays out of the OpenAPI document (ASM-2, ASM-12); Storing other members as individual records; they exist only as counts on the session (Q-4)

## Files the plan will touch (16)
- App.Api/AppDb.cs
- App.Api/Contracts/ApiException.cs  ← not found by grounding; check it
- App.Api/Contracts/Dtos.cs  ← not found by grounding; check it
- App.Api/Data/DatabaseStartup.cs  ← not found by grounding; check it
- App.Api/Data/Entities.cs  ← not found by grounding; check it
- App.Api/Data/Enums.cs  ← not found by grounding; check it
- App.Api/Data/SampleData.cs  ← not found by grounding; check it
- App.Api/Endpoints/StudioEndpoints.cs  ← not found by grounding; check it
- App.Api/Infrastructure/ErrorHandling.cs  ← not found by grounding; check it
- App.Api/OpenApi/ContractOpenApi.cs  ← not found by grounding; check it
- App.Api/Program.cs
- App.Api/Services/BookingCommands.cs  ← not found by grounding; check it
- App.Api/Services/LondonTime.cs  ← not found by grounding; check it
- App.Api/Services/SessionProjection.cs  ← not found by grounding; check it
- App.Api/Services/StudioQueries.cs  ← not found by grounding; check it
- App.Api/openapi/built.json  ← not found by grounding; check it

## Plan
Options: OPT-A (chosen): Layered minimal API. EF Core entities in App.Api/Data. Contract DTO records named exactly like the contract schemas. Scoped services: a projection (labels/actionState), queries and booking commands. Endpoints declare the contract's statuses with Produces. A small set of OpenAPI transformers aligns the generated document with contracts/openapi.yaml. One exception handler maps errors to the contract Error. | OPT-B: Everything inline: the 13 endpoint lambdas in Program.cs query AppDb directly and build anonymous/DTO objects in place, with no service layer. | OPT-C: Like OPT-A, but a document transformer loads contracts/openapi.yaml and returns it as the generated document.
Decision: Minimal APIs mapped at contract paths with UsePathBase("/api"), EF Core SQLite entities (EnsureCreated, no migrations), DTO records named after the contract schemas, and OpenAPI transformers to reach exact conformance (servers /api, inline enums, nullable allOf, required lists).
Stored session counts are totals that include the demo member. Rule failures throw ApiException, and one handler maps it, BadHttpRequest and any other exception to the contract Error (500 = storage_failure). Empty 404/405 responses go through status-code pages.
Open spec points are resolved like this. joinWaitlist order follows the assumptions (already_booked after outside_booking_window). Studio-cancelled Booked records go to Past and don't count toward the limit of 10 or stats.upcoming. Simulate never lowers a count below zero (bookedCount not below the demo member's own Booked row). Undo is refused for promoted records.
Startup: TimeProvider is registered with TryAdd. Schema creation and seeding are skipped under GetDocument.Insider, and when they fail the error is caught and logged so requests return 500 storage_failure. Seeding runs only when the Sessions table is empty, with 4–12 sessions placed relative to the London day.
No new packages and no changes to the csproj, contract or CI.
- TASK-1 Data model: enums, entities, AppDb → REQ-38, REQ-7; must pass AC-38.1
- TASK-2 Contract DTOs and ApiException → REQ-1, NFR-1; builds towards a later task (no criteria of its own)
- TASK-3 London time helpers and Session/booking projection → REQ-7, REQ-9, REQ-10, REQ-11, REQ-35, REQ-44; must pass AC-7.1, AC-7.2, AC-7.3, AC-9.1, AC-10.1, AC-10.2, AC-10.3, AC-10.4, AC-10.5, AC-11.1, AC-35.1
- TASK-4 Read-side queries: member, schedule, session, my bookings, stats, notices → REQ-3, REQ-4, REQ-5, REQ-6, REQ-13, REQ-32, REQ-34, REQ-36; must pass AC-3.1, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-5.1, AC-6.1, AC-6.2, AC-6.3, AC-6.4, AC-13.1, AC-13.2, AC-32.1, AC-34.1, AC-34.2, AC-34.3, AC-34.4, AC-34.5, AC-36.1, AC-36.2, AC-36.3, AC-36.4, AC-36.5
- TASK-5 Write-side commands: book, waitlist, cancel, leave, undo, simulate, acknowledge → REQ-14, REQ-16, REQ-17, REQ-18, REQ-19, REQ-20, REQ-21, REQ-22, REQ-23, REQ-24, REQ-25, REQ-26, REQ-27, REQ-28, REQ-30, REQ-31, REQ-33, NFR-5; must pass AC-16.1, AC-16.2, AC-16.3, AC-16.4, AC-17.1, AC-17.2, AC-17.3, AC-18.1, AC-18.2, AC-18.3, AC-19.1, AC-20.1, AC-20.2, AC-20.3, AC-21.1, AC-21.2, AC-21.3, AC-22.1, AC-22.2, AC-22.3, AC-22.4, AC-22.5, AC-23.1, AC-23.2, AC-23.3, AC-23.4, AC-24.1, AC-24.2, AC-25.1, AC-25.2, AC-26.1, AC-26.2, AC-26.3, AC-27.1, AC-27.2, AC-28.1, AC-28.2, AC-28.3, AC-28.4, AC-30.1, AC-30.2, AC-31.1, AC-31.2, AC-33.1
- TASK-6 Database startup and sample data seed → REQ-39, REQ-40, REQ-41, REQ-42, REQ-43; must pass AC-41.1, AC-41.2, AC-41.3, AC-41.4, AC-42.1, AC-43.1
- TASK-7 OpenAPI conformance transformers → REQ-1, NFR-6; must pass AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5
- TASK-8 Endpoints, error handling and Program wiring → REQ-2, REQ-14, REQ-15, REQ-37, REQ-39, REQ-40, REQ-44, NFR-1; must pass AC-2.1, AC-2.2, AC-2.3, AC-14.1, AC-14.2, AC-15.1, AC-37.1, AC-37.2, AC-39.1, AC-39.2, AC-40.1, AC-40.2, AC-44.1, AC-44.2

Stub commit (throws NotImplemented until implemented): App.Api/Data/Enums.cs, App.Api/Data/Entities.cs, App.Api/AppDb.cs, App.Api/Contracts/Dtos.cs

## Critic findings (18)
- [medium] REQ-26 REQ-26 says the waitlist checks run "after not_found and already_booked rules as listed in the assumptions", but the assumptions' joinWaitlist order puts already_booked after outside_booking_window, so the two give different codes for an already-waitlisted record on a closed-window session.
- [medium] REQ-34 REQ-34's EARS puts every Booked/Waitlisted record whose class has not ended into upcoming, but AC-34.4 expects a Booked record on a studio-cancelled session tomorrow to appear in past, and the stored row has no 'Cancelled by studio' status to tell them apart.
- [medium] REQ-36 Stats upcoming (REQ-36) and the limit of 10 (REQ-21 and the assumptions) count Booked records for any session not yet started, so bookings on studio-cancelled sessions still count and use up limit slots, while My Bookings shows them as past and canChange false means the member can't free the slot by cancelling.
- [medium] REQ-28 The simulate hook doesn't say what happens for studio-cancelled or already-started sessions, or when bookedCount is 0 (the count would go negative). It also lowers bookedCount even when the only booked member is the demo member's own Booked row, which leaves the counts and the rows out of step.
- [medium] REQ-24 The spec never says whether the stored session counts are other-members-only (as Q-4 suggests) or totals that include the demo member, yet REQ-24, REQ-27 and REQ-28 describe changes to the returned totals and AC-41.3 reads 'booked count equal to capacity' straight from the table, so how the counts are stored and updated is ambiguous.
- [medium] REQ-37 AC-37.1 starts the app with an App connection string that can't be opened, but REQ-39 runs EnsureCreated and the seed at startup, which would fail before any request is served; the spec doesn't define what happens when startup schema creation or seeding fails.
- [medium] REQ-37 REQ-37 (500 storage_failure), REQ-15 (400) and REQ-14 (404 on undo, cancel, leave-waitlist and simulate) assume the contract declares those statuses for every operation, with no contract anchor, while AC-1.2 and AC-2.2 require only declared status codes.
- [low] REQ-42 REQ-42 (3–12 sessions, AC-42.1) and REQ-43 (at most 15 / 1–15, AC-43.1) set different seed-size bounds for the same behaviour, and REQ-41's required mix of sessions needs at least 4 sessions, so REQ-42's lower bound of 3 isn't enough.
- [low] NFR-2 NFR-2 (p95 ≤ 200 ms, with a leftover '(d2: 50)' draft note) and NFR-3 (p95 ≤ 300 ms) set conflicting latency targets for the same GET /api/schedule measurement.
- [low] REQ-7 REQ-7 gives the 'Full · N on waitlist' label only when N > 0 and has no branch for 0 spots with nobody waiting, while REQ-9 separately requires 'Full · 0 on waitlist'; the two label rules overlap and don't match.
- [low] REQ-10 REQ-10 doesn't define actionState for a session whose class has ended when the demo member holds a Booked record (reported as Attended) or a Waitlisted record (which, per the assumptions, appears in neither list).
- [low] REQ-22 Undo checks only that the record is Booked and within 5 seconds of createdAt, so a waitlist record that was promoted within 5 seconds could be deleted by undo with no change to the waitlist counts, which breaks 'as if never made'.
- [low] NFR-1 NFR-1 requires every non-2xx body to be a contract Error, but no requirement covers non-integer path ids (e.g. /bookings/abc/undo) or framework-level 404/405 responses, which return empty bodies by default.
- [low] REQ-39 'No tables or no data' is not defined against specific tables, so a database with tables but partial data (e.g. bookings but no sessions) gets no defined seed decision, and EnsureCreated does nothing on a database that already has a different schema.
- [low] REQ-40 REQ-40 relies on detecting the GetDocument.Insider tool to skip database work during the build, but this is stated only in an assumption, with no anchor in the csproj or Program.cs.
- [low] REQ-3 The demo member's identity values (id 1, 'Alex Rivera', 'AR', 'Unlimited Monthly') and the exact message strings across REQ-16 to REQ-32 have no anchor to the contract or the request.
- [low] AC-41.3 AC-41.3, AC-16.4, AC-28.1 (promoted-at) and AC-33.1 (notice-acknowledged) check internal table columns rather than a public API surface.
- [low] NFR-4 NFR-4 adds a write-latency budget (p95 < 300 ms) that the intent never asked for.
_No OpenAI key: critic ran on claude-opus-5-5 (same family as the implementer)_

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

**This spec has 41 requirements, about 4 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261006-boutique-fitness-studio-class-31fe <hash> --note "your risk note"
  factory reject  20261006-boutique-fitness-studio-class-31fe <hash> --reason "why"

Card hash: 70d2068d