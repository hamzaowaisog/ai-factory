# Approval: A responsive web app for Pulse Studio, a single-location boutique fitn

Run 20261006-boutique-fitness-studio-class-b497 · risk **high** · feature · size L · cost so far $11.70

## Your request (word for word, from fitness_studio_class_booking_requirements.md)
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


## Your answers
- Q-1 Where does Back go from Class Detail? → **Back to the screen Class Detail was opened from (Schedule or My Bookings), keeping that screen's state**
- Q-2 Which rules apply when joining a waitlist? → **The same 7-day and 15-minute windows plus the past and studio-cancelled rules as booking; overlap and the 10-booking limit are only checked at promotion**
- Q-3 How does Undo work on the 5-second booking toast? → **Undo removes the booking as if it was never made: no cancellation record, no late-cancel warning, counts restored**
- Q-4 How is the 7-day booking window measured? → **Booking is allowed if the class starts within 7×24 hours from now (Europe/London)**
- Q-5 There is only one real member, so how is waitlist promotion modelled and shown? → **Other members exist only as booked and waitlist counts. When Alex cancels, the booked count stays the same and the waitlist count drops by one. Alex's own promotion is triggered by a test/demo hook that simulates another member cancelling**
- Q-6 Are the seed dates fixed calendar dates, or worked out from today's date when the app first loads? → **Worked out from today (Europe/London) on first load, then stored**
- Q-7 Is a late cancellation ('counts as a missed class') stored differently and shown in Past or the stats? → **It is stored as Cancelled with a late flag and shown in Past as 'Late cancel'; stats are unaffected**
- Q-8 Nobody on staff can mark attendance, so what happens to a Booked class once it has finished? → **It moves to Past and is shown and counted as Attended automatically**

## Confirm these assumptions (high risk)
- [ ] ASM-2 What happens if the first person on the waitlist can't be promoted, because the promotion would overlap another Booked class, take them past the 10-booking limit, or the class starts within 15 minutes? → assumed: Skip that member: they stay waitlisted and the next eligible person is promoted
- [ ] ASM-3 How is a late cancellation (inside 2 hours) recorded? → assumed: Status becomes Cancelled and a late-cancellation flag is set; Past shows a 'Late cancel' badge
- [ ] ASM-4 There is no staff UI, so how do Booked bookings become Attended? → assumed: They are marked Attended automatically once the class has ended
- [ ] ASM-5 How are seed dates tied to 'current week and next week'? → assumed: Seed dates are generated relative to the date of first load in Europe/London and then persisted
- [ ] ASM-6 Which persistence approach should be used? → assumed: Browser local storage behind a business-rules/data module that every action goes through
- [ ] ASM-14 When the demo hook promotes Alex from the waitlist but the promotion would break the overlap rule or the 10-booking limit, what happens? → assumed: Alex stays waitlisted at #1 and the next member is promoted instead; Alex sees why

Other assumptions: ASM-1 When must the Class Detail action footer stay visible? → assumed: Pinned to the bottom on mobile at every scroll position; normal placement in the tablet and desktop side panel; ASM-7 Do back-to-back classes overlap (one ends 18:45, the next starts 18:45)? → assumed: No: only a real overlap in time is a conflict; ASM-8 What happens to Alex's booking or waitlist entry on a class the studio has cancelled? → assumed: Never seed Alex onto a studio-cancelled class, so the case can't happen; ASM-9 How far can the week arrows on the Schedule move? → assumed: Only the current week and next week (arrows disabled beyond them); ASM-10 Which time-of-day filter does a class starting at exactly 17:00 fall into? → assumed: Afternoon is 12:00–16:59 and Evening is 17:00 onward; ASM-11 Does the 'Upcoming' stat tile count waitlisted classes? → assumed: Only upcoming Booked classes; ASM-12 Which browsers must be supported? → assumed: The latest two versions of Chrome, Edge, Safari and Firefox.; ASM-13 Where should the app run or be hosted for this release? → assumed: One cloud region, in the client's cloud account.; ASM-15 Which persistence should be used? → assumed: Browser local storage, with no backend; ASM-16 Can people see the waitlist promotion demo hook in the app? → assumed: Tests only, with no UI; ASM-17 Do joining a waitlist, cancelling and leaving a waitlist also show a toast with Undo, or only booking? → assumed: Only inline booking shows a toast with Undo; the others show a plain confirmation toast; ASM-18 Do two classes that touch end to start (one ends at 18:45, the next starts at 18:45) count as overlapping? → assumed: No. Only real time overlap is rejected; ASM-19 If the studio cancels a class that Alex has booked or is waitlisted for, how does My Bookings show it? → assumed: It moves to Past with the status 'Cancelled by studio'; ASM-20 How far can the day strip go back and forward with the week arrows, and which day does a week start on? → assumed: Monday to Sunday weeks, limited to the current and next week

## Requirements
- **REQ-1** (ADDED) The booking app shall be a responsive web app for the single-location boutique studio Pulse Studio offering Yoga, Pilates, HIIT, Spin and Boxing classes, presenting exactly three screens, Schedule (the home screen at the root URL), Class Detail and My Bookings, for the single pre-signed-in member Alex Rivera with no sign-in screen, under a top bar that shows the "Pulse Studio" wordmark and the member avatar with initials "AR" linking to My Bookings.
  - AC-1.1 [manual] Given A fresh browser with no stored app data; when The app root URL is opened; then The Schedule screen is shown, the top bar displays the text "Pulse Studio" and an avatar with the text "AR", and no sign-in page is shown
  - AC-1.2 [manual] Given The Schedule screen is shown; when The "AR" avatar is activated; then The My Bookings screen is shown with the name "Alex Rivera" and the membership "Unlimited Monthly"
  - AC-1.3 [manual] Given The Schedule screen is shown at a 360 px wide viewport; when A person looks at the class type filter chips; then Exactly five type chips are displayed, labelled "Yoga", "Pilates", "HIIT", "Spin" and "Boxing", and no other studio location is shown anywhere on the page
- **REQ-2** (ADDED) The booking app shall work out "today", day boundaries and every time-based rule in the Europe/London timezone and show all times in 24-hour HH:mm format.
  - AC-2.1 [unit] Given A clock of 2026-10-06T23:30Z (00:30 on 7 October in Europe/London); when The booking service's today value is read; then The returned date is 2026-10-07
  - AC-2.2 [unit] Given A session starting at 2026-10-07T17:30Z; when The time formatter is called for it; then The returned text is "18:30"
  - AC-2.3 [manual] Given A class starting at 18:30 London time; when A person views its card on a device set to a US timezone and 12-hour clock; then The card displays "18:30"
- **REQ-3** (ADDED) When the seed generator runs, the booking service shall return seed data containing at least 40 class sessions across the types Yoga, Pilates, HIIT, Spin and Boxing and the rooms Studio A, Studio B and Spin Room, 5 instructors with name, bio and avatar, at least 3 full sessions, at least 3 sessions with 1–3 spots left, at least 1 session with status "Cancelled by studio", and for demo member Alex Rivera 2 upcoming Booked bookings, 1 Waitlisted booking and 3 past Attended bookings, none of them on a studio-cancelled session.
  - AC-3.1 [unit] Given A fixed clock of Wednesday 2026-10-07 10:00 Europe/London; when The seed generator is called; then The returned session list has a count of at least 40, includes every one of the 5 class types and 3 rooms, and the returned instructor list has a count of 5, each with a name, a bio and an avatar
  - AC-3.2 [unit] Given The same returned seed data; when Sessions are counted by availability; then The count of sessions with booked count equal to capacity is at least 3, the count with 1–3 free spots is at least 3, and the count with status "Cancelled by studio" is at least 1
  - AC-3.3 [unit] Given The same returned seed data; when Alex Rivera's booking records are read; then Exactly 2 records are Booked on sessions starting after now, 1 record is Waitlisted with a waitlist position value, 3 records are Attended on sessions that ended before now, and no record refers to a session with status "Cancelled by studio"
  - AC-3.4 [unit] Given The same returned seed data; when Each session's fields are read; then Every session record has a name, type, intensity of Low/Medium/High, instructor, room, start date-time, a duration value of 30, 45, 60 or 75, capacity, booked count, waitlist count, a 2–4 sentence description, a non-empty what-to-bring list and a status
- **REQ-4** (ADDED) When the app loads, the booking service shall generate the seed sessions dated within the current Monday–Sunday week and the next week, both measured from the load date in Europe/London, and store them in browser local storage if no stored data exists, or reuse the stored sessions with their IDs and start times unchanged if stored seed data already exists.
  - AC-4.1 [unit] Given Empty local storage and a fixed clock of Wednesday 2026-10-07 10:00 Europe/London; when The booking service is initialised; then Every returned schedule session start date falls between Monday 2026-10-05 00:00 and Sunday 2026-10-18 23:59 Europe/London (sessions referenced only by Alex's past Attended bookings may be earlier), and local storage holds a stored record of the sessions
  - AC-4.2 [unit] Given Local storage already holds data seeded on 2026-10-07; when The booking service is initialised with a clock of 2026-10-09; then The returned sessions have the same IDs and start times as the stored data
- **REQ-5** (ADDED) When any booking action changes data, the booking service shall write bookings, statuses, late flags, session counts and waitlist positions to browser local storage before reporting success, so a new instance over the same storage, or a page reload, returns the same data.
  - AC-5.1 [unit] Given One booking service instance has booked one class, cancelled another late and joined a waitlist at position 3 over a given local storage; when A new instance is created over the same storage and the bookings are read; then The returned lists contain the same 3 records with the same status, late flag and waitlist position values, and the returned session count values match
  - AC-5.2 [manual] Given Alex has booked a class through the Schedule screen; when The page is reloaded; then The class card button is shown as "Booked ✓" and the class is listed under Upcoming in My Bookings with a "Booked" badge
- **REQ-6** (ADDED) When Alex books a Scheduled session that has free spots, starts within the booking window, does not overlap another Booked session of Alex's and keeps Alex at or under 10 upcoming Booked sessions, the booking service shall create one Booked record with an ID and created date-time and increase the session's booked count by 1.
  - AC-6.1 [unit] Given Session "Sunrise Vinyasa" with capacity 20, booked count 18, starting in 2 days, with no conflicts; when book(session) is called; then The returned record has status Booked, a booking ID and a created date-time, and the session's returned booked count value is 19
  - AC-6.2 [unit] Given The booking from AC-6.1 has been made; when The bookings are read; then The returned Upcoming list contains the Sunrise Vinyasa record with status Booked
- **REQ-7** (ADDED) If Alex already holds a Booked or Waitlisted record for a session, then the booking service shall reject a further book or join-waitlist request for that session with an "already booked" error without creating a record or changing counts.
  - AC-7.1 [unit] Given A session with capacity 20 and booked count 10; when book(S) is called twice in a row with no wait between them; then The second call returns an "already booked" error, the returned booking list has exactly 1 record for the session, and the booked count value is 11
  - AC-7.2 [unit] Given Alex is Waitlisted on a full session; when joinWaitlist is called again for that session; then The returned error is "already booked" and the waitlist count value is unchanged
  - AC-7.3 [manual] Given The Schedule screen shows a bookable class; when A person taps its Book button twice within 300 ms; then My Bookings shows exactly one row for that class
- **REQ-8** (ADDED) If a session's booked count equals its capacity, then the booking service shall reject a book request with a "class full" error and leave the booked and waitlist counts unchanged.
  - AC-8.1 [unit] Given Session "Power HIIT" with capacity 16 and booked count 16; when book(session) is called; then The returned error is "class full", no Booked record is created, and the booked count value stays 16
- **REQ-9** (ADDED) When Alex requests to join the waitlist of a Scheduled session that starts within the booking window, the booking service shall either create a Waitlisted record whose position equals the previous waitlist count plus 1 and increase the waitlist count by 1, without checking the overlap rule or the 10-booking limit, when the session is full, or reject the request with a not-full error when the session has free spots.
  - AC-9.1 [unit] Given Session "Power HIIT" is full with waitlist count 2 and starts tomorrow; when joinWaitlist(session) is called; then The returned record has status Waitlisted with position value 3, and the session's waitlist count value is 3
  - AC-9.2 [unit] Given A full session that overlaps a session Alex has Booked, and Alex holds 10 upcoming Booked sessions; when joinWaitlist(session) is called; then The returned record has status Waitlisted with a position value and no error is returned
  - AC-9.3 [unit] Given A session with free spots; when joinWaitlist(session) is called; then A not-full (spots available) error is returned, no record is created and the waitlist count value is unchanged
- **REQ-10** (ADDED) If a session starts more than 7×24 hours after now, then the booking service shall reject book and join-waitlist requests with an "outside booking window" error, while a session starting exactly 168 hours after now is bookable.
  - AC-10.1 [unit] Given Sessions with free spots starting exactly 168 hours, 167 hours 59 minutes, and 168 hours plus 1 minute after now; when book is called for each; then The first two calls return a Booked record and the third returns the "outside booking window" error with the booked count value unchanged
  - AC-10.2 [unit] Given A full session starting 168 hours and 1 minute after now; when joinWaitlist is called; then The returned error is "outside booking window", no record is created and the waitlist count value is unchanged
- **REQ-11** (ADDED) If a session that has not started starts less than 15 minutes after now, then the booking service shall reject book and join-waitlist requests with the "outside booking window" error, while a session starting exactly 15 minutes after now is bookable.
  - AC-11.1 [unit] Given Sessions starting exactly 15 minutes and 14 minutes after now, each with free spots; when book is called for each; then The first call returns a Booked record and the second returns the "outside booking window" error with no record created
  - AC-11.2 [unit] Given A full session starting in 10 minutes; when joinWaitlist is called; then The returned error is "outside booking window" and the waitlist count value is unchanged
- **REQ-13** (ADDED) If a session's start time is at or before now, then the booking service shall reject book, join-waitlist, cancel and leave-waitlist requests for it with a "class has started" error and leave all bookings and counts unchanged.
  - AC-13.1 [unit] Given A session that started 1 minute ago with free spots; when book(session) is called; then The returned error is "class has started" and no record is created
  - AC-13.2 [unit] Given Alex holds a Booked record on a session that started 10 minutes ago and has not ended; when cancel(booking) is called; then The returned error is "class has started" and the record status value stays Booked
  - AC-13.3 [unit] Given A full session that started 5 minutes ago; when joinWaitlist(session) is called; then The returned error is "class has started" and the waitlist count value is unchanged
  - AC-13.4 [unit] Given Alex is Waitlisted on a session that started 5 minutes ago; when leaveWaitlist(booking) is called; then The returned error is "class has started" and the record status value stays Waitlisted
- **REQ-14** (ADDED) If a session has status "Cancelled by studio", then the booking service shall reject book and join-waitlist requests for it with a "cancelled by studio" error.
  - AC-14.1 [unit] Given A session with status "Cancelled by studio", capacity 20, booked count 0, starting tomorrow; when book(session) is called; then The returned error is "cancelled by studio" and no record is created
  - AC-14.2 [unit] Given A full session with status "Cancelled by studio"; when joinWaitlist(session) is called; then The returned error is "cancelled by studio" and the waitlist count value is unchanged
- **REQ-15** (ADDED) If a book request would give Alex two Booked sessions whose time ranges overlap, then the booking service shall reject it with the error message "You're already booked for <class name> at <start>–<end>.", while sessions that only touch end-to-start are not treated as overlapping.
  - AC-15.1 [unit] Given Alex is Booked for "Power HIIT" 18:00–18:45 on a day; when book is called for an 18:30 Spin session the same day; then The returned error message is "You're already booked for Power HIIT at 18:00–18:45." and no record is created
  - AC-15.2 [unit] Given Alex is Booked for "Power HIIT" 18:00–18:45 on a day; when book is called for a session starting at 18:45 the same day; then The returned record has status Booked
- **REQ-16** (ADDED) If Alex already holds 10 Booked records on sessions that have not started, then the booking service shall reject a further book request with the error "You've reached the limit of 10 upcoming classes.", where Waitlisted records do not count toward the limit.
  - AC-16.1 [unit] Given Alex holds 10 upcoming Booked sessions; when book is called for an 11th bookable session; then The returned error message is "You've reached the limit of 10 upcoming classes." and the count of Alex's Booked records stays 10
  - AC-16.2 [unit] Given Alex holds 9 upcoming Booked sessions and 3 Waitlisted sessions; when book is called for a bookable session; then The returned record has status Booked
- **REQ-17** (ADDED) When Alex cancels a Booked record for a session that has not started, the booking service shall set the record status to Cancelled with a late flag that is true only when the session starts less than 2 hours later.
  - AC-17.1 [unit] Given A Booked record on a session starting in 90 minutes; when cancel(booking) is called; then The returned record has status Cancelled and late flag value true
  - AC-17.2 [unit] Given A Booked record on a session starting in exactly 120 minutes; when cancel(booking) is called; then The returned record has status Cancelled and late flag value false
  - AC-17.3 [unit] Given A Booked record on a session starting in 1 hour 59 minutes; when isLateCancellation(booking) is called; then The returned value is true, and for a session starting in exactly 2 hours the returned value is false
- **REQ-18** (ADDED) When Alex cancels a Booked record (free or late), the booking service shall reduce the session's waitlist count by 1 and keep the booked count unchanged if the waitlist count is above 0, and otherwise reduce the booked count by 1.
  - AC-18.1 [unit] Given A Booked record on a session with capacity 16, booked count 16 and waitlist count 2; when cancel(booking) is called; then The booked count value stays 16 and the waitlist count value is 1
  - AC-18.2 [unit] Given A Booked record on a session with booked count 10 and waitlist count 0; when cancel(booking) is called; then The returned booked count value is 9 and the waitlist count value is 0
- **REQ-19** (ADDED) When Alex leaves a waitlist for a session that has not started, the booking service shall set the Waitlisted record status to Cancelled with the late flag false, remove it from the Upcoming list, and reduce the session's waitlist count by 1.
  - AC-19.1 [unit] Given Alex is Waitlisted at position 3 on a session with waitlist count 3 starting tomorrow; when leaveWaitlist(booking) is called; then The returned record has status Cancelled and late flag false, the session's waitlist count value is 2, and the returned Upcoming list no longer contains the session
- **REQ-21** (ADDED) When the test-only hook simulateOtherMemberCancellation(session) runs, the booking service shall promote the first waitlisted member: if Alex is at position 1 and eligible, change Alex's record to Booked with no waitlist position; if Alex is at a position above 1, reduce Alex's position by 1; and reduce the waitlist count by 1 with the booked count unchanged, or reduce the booked count by 1 when the waitlist is empty.
  - AC-21.1 [unit] Given A full session with capacity 16, booked count 16, waitlist count 3, and Alex Waitlisted at position 1 with no overlap and fewer than 10 Booked sessions; when simulateOtherMemberCancellation(session) is called; then Alex's returned record has status Booked with no waitlist position value, the booked count value stays 16 and the waitlist count value is 2
  - AC-21.2 [unit] Given A full session with waitlist count 4 and Alex Waitlisted at position 3; when simulateOtherMemberCancellation(session) is called; then Alex's returned record is Waitlisted with position value 2, the waitlist count value is 3 and the booked count value is unchanged
  - AC-21.3 [unit] Given A full session with booked count 16 and waitlist count 0; when simulateOtherMemberCancellation(session) is called; then The returned booked count value is 15
- **REQ-22** (ADDED) If promoting Alex from waitlist position 1 would overlap another Booked session of Alex's, take Alex above 10 upcoming Booked sessions, or the session starts less than 15 minutes after now, then the booking service shall keep Alex Waitlisted at position 1, store and return the reason Alex was skipped, and either promote the next member by reducing the waitlist count by 1 or, when Alex is the only member waiting, reduce the booked count by 1 and re-check Alex's eligibility on the next promotion hook run.
  - AC-22.1 [unit] Given Alex is Waitlisted at position 1 on a full Spin session 18:30–19:15 with waitlist count 3 and is Booked on "Power HIIT" 18:00–18:45 the same day; when simulateOtherMemberCancellation(session) is called; then Alex's returned record has status Waitlisted, position value 1 and a reason field naming "Power HIIT", the waitlist count value is 2 and the booked count value is unchanged
  - AC-22.2 [unit] Given Alex is Waitlisted at position 1 on a full session with waitlist count 2 and holds 10 upcoming Booked sessions; when simulateOtherMemberCancellation(session) is called; then Alex's returned record stays Waitlisted at position 1 with a reason field value stating the 10-class limit
  - AC-22.3 [unit] Given Alex is Waitlisted at position 1 on a full session starting in 10 minutes; when simulateOtherMemberCancellation(session) is called; then Alex's returned record stays Waitlisted at position 1 and the returned reason value is outside-booking-window
  - AC-22.4 [unit] Given Alex is Waitlisted at position 1 on a full session with capacity 16, waitlist count 1, and holds an overlapping Booked class; when simulateOtherMemberCancellation(session) is called and then getActionState(session) is called; then Alex's returned record stays Waitlisted at position 1, the waitlist count value is 1, the booked count value is 15, and the returned action state is Waitlisted with position value 1 and the overlap reason
  - AC-22.5 [unit] Given The state after AC-22.4, and Alex has then cancelled the overlapping Booked class; when simulateOtherMemberCancellation(session) is called again; then Alex's returned record has status Booked with no waitlist position value, the waitlist count value is 0 and the booked count value stays 15
- **REQ-23** (ADDED) If the promotion hook kept Alex waitlisted because of overlap, the 10-booking limit or the 15-minute window, then the Class Detail screen shall show the stored reason next to Alex's waitlist position.
  - AC-23.1 [manual] Given The promotion hook kept Alex Waitlisted #1 on a Spin session because of an overlap with "Power HIIT"; when The Class Detail screen for that session is opened; then The footer displays "You're #1 on the waitlist" and next to it a reason message naming Power HIIT
- **REQ-24** (ADDED) When the app opens after Alex was promoted from a waitlist to Booked since the last visit, the booking app shall show a toast naming the class Alex is now booked for, once.
  - AC-24.1 [manual] Given simulateOtherMemberCancellation promoted Alex on "Power HIIT" while the app was closed; when The app is opened; then A toast message containing "Power HIIT" is displayed once and is not shown again on the next reload
- **REQ-25** (ADDED) When Alex undoes a booking from the booking toast within 5 seconds, the booking service shall delete the Booked record as if it was never made, without creating a Cancelled record or late flag, and restore the session's booked count to its value before the booking.
  - AC-25.1 [unit] Given Alex has just booked a session starting in 30 minutes (inside the 2-hour window), raising its booked count from 18 to 19; when undoBooking(booking) is called; then The returned booking list has no record for the session (no Booked and no Cancelled record) and the booked count value is 18
  - AC-25.2 [manual] Given Alex booked a class from a Schedule card; when 6 seconds pass; then The toast and its Undo button are no longer shown
- **REQ-26** (ADDED) When the end time (start plus duration) of a session with a Booked record of Alex's has passed, the booking service shall return that record with status Attended in the Past list.
  - AC-26.1 [unit] Given A Booked record on a 45-minute session that started 46 minutes ago; when The bookings are read; then The returned record status value is Attended and it is in the returned Past list, not the Upcoming list
  - AC-26.2 [unit] Given A Booked record on a 45-minute session that started 44 minutes ago; when The bookings are read; then The returned record status value is Booked
- **REQ-27** (ADDED) ⚠ only one draft had this If a session for which Alex holds a Booked or Waitlisted record has status "Cancelled by studio", then the booking service shall return that record in the Past list with status "Cancelled by studio".
  - AC-27.1 [unit] Given Stored data where Alex is Booked on a future session whose status is "Cancelled by studio"; when The bookings are read; then The returned Past list contains that record with status value "Cancelled by studio" and the Upcoming list does not
- **REQ-28** (ADDED) The booking service shall return Alex's Upcoming list as Booked and Waitlisted records for sessions that have not ended, ordered by start time ascending and grouped under "Today", "Tomorrow" or a "Thu 15 Oct" style label, and the Past list as Attended and Cancelled records ordered most recent first.
  - AC-28.1 [unit] Given The clock is Tue 13 Oct 2026 09:00 and Alex is Booked today 18:00, Waitlisted tomorrow 07:00 and Booked Thu 15 Oct 12:00; when The Upcoming list is read; then The returned groups are "Today", "Tomorrow", "Thu 15 Oct" in that order, each holding the matching record
  - AC-28.2 [unit] Given Alex has Attended records from 3, 5 and 10 days ago and a late Cancelled record from 1 day ago; when The Past list is read; then The returned list order is 1, 3, 5, 10 days ago and the cancelled record has late flag value true
  - AC-28.3 [unit] Given Alex is Booked for a 45-minute class starting at 18:00 today; when The bookings are read with the clock at 18:30; then The returned Upcoming list still contains the record with status Booked
- **REQ-30** (ADDED) When My Bookings stats are requested, the booking service shall return Upcoming as the count of upcoming Booked records, Classes this month as the count of Attended records in the current Europe/London calendar month, and Current streak as the number of consecutive Monday–Sunday weeks with at least one Attended record counting back from the current week (or from the previous week if the current week has none yet), with late cancellations changing no stat.
  - AC-30.1 [unit] Given Alex has 2 upcoming Booked and 1 Waitlisted records; when getStats() is called; then The returned Upcoming value is 2
  - AC-30.2 [unit] Given The clock is 20 Oct 2026, Alex has 3 Attended records in October, 1 in September and 2 late-cancelled records in October; when getStats() is called; then The returned Classes this month value is 3
  - AC-30.3 [unit] Given The clock is Wednesday in week W and Alex has Attended records in weeks W, W-1 and W-2 and none in W-3; when getStats() is called; then The returned Current streak value is 3
  - AC-30.4 [unit] Given Attended records in the previous week and the week before, none in the week before that and none yet this week; when getStats() is called; then The returned Current streak value is 2
- **REQ-31** (ADDED) ⚠ only one draft had this When the action state for a session is requested, the booking service shall return one of Book (with spots left), Join waitlist (with the position Alex would get), Booked, Waitlisted (with position and any stored skip reason, whenever Alex holds a Waitlisted record, even if the session has free spots), or Disabled with a reason text for started, past, studio-cancelled or outside-booking-window sessions.
  - AC-31.1 [unit] Given A bookable session with 5 spots left; when getActionState(session) is called; then The returned value is Book with spots-left value 5
  - AC-31.2 [unit] Given A full session with waitlist count 4 and no record for Alex; when getActionState(session) is called; then The returned value is Join waitlist with position value 5
  - AC-31.3 [unit] Given Sessions that have started, have status "Cancelled by studio", and start in 8 days; when getActionState is called for each; then Each returned value is Disabled with a non-empty reason text that differs per case
  - AC-31.4 [unit] Given A session with capacity 16, booked count 15 and waitlist count 1, where Alex is Waitlisted at position 1 with a stored overlap reason; when getActionState(session) is called; then The returned value is Waitlisted with position value 1 and the stored reason, not Book
- **REQ-32** (ADDED) When a session's availability label is requested, the booking app shall return "Cancelled" for a studio-cancelled session, "Full · N on waitlist" for a full session, "1 spot left" for one free spot, "Only N left" for 2–3 free spots, and "N spots left" for 4 or more free spots.
  - AC-32.1 [unit] Given Sessions with capacity 20 and booked counts 12, 18, 19 and 20 (waitlist 4); when availabilityLabel is called for each; then The returned values are "8 spots left", "Only 2 left", "1 spot left" and "Full · 4 on waitlist"
  - AC-32.2 [unit] Given A session with status "Cancelled by studio"; when availabilityLabel is called; then The returned value is "Cancelled"
- **REQ-33** (ADDED) ⚠ only one draft had this The Schedule screen shall display on each class card the availability label defined by REQ-32, so one free spot reads "1 spot left" and 2–3 free spots read "Only N left".
  - AC-33.1 [manual] Given Sessions with 8 free spots, 2 free spots, 1 free spot, full with 4 waitlisted, and Cancelled by studio; when A person views their cards; then The labels shown are "8 spots left", "Only 2 left", "1 spot left", "Full · 4 on waitlist" and "Cancelled"
  - AC-33.2 [manual] Given "Sunrise Vinyasa" has 20 spots and 18 booked; when Book is activated on its card; then The card shows "Booked ✓" and the availability label displayed is "1 spot left"
- **REQ-34** (ADDED) When schedule filters are applied, the booking service shall return the selected day's sessions, including sessions Cancelled by studio, ordered by start time, that match any selected class type, any selected intensity and any selected time of day (Morning before 12:00, Afternoon 12:00–16:59, Evening 17:00 onward), where an empty filter group matches everything.
  - AC-34.1 [unit] Given A day with sessions at 07:00 Yoga Low, 11:59 HIIT High, 12:00 Yoga Medium, 17:00 Yoga High and 18:30 Spin High; when filterSessions is called with types [Yoga] and time [Evening]; then The returned list contains only the 17:00 Yoga session
  - AC-34.2 [unit] Given The same day; when filterSessions is called with types [Yoga, Spin] and intensity [High]; then The returned list is the 17:00 Yoga and 18:30 Spin sessions in that order
  - AC-34.3 [unit] Given A day with Yoga at 07:00, HIIT at 12:00, Yoga at 16:59 and Spin at 17:00; when The schedule is requested with time-of-day filter [Afternoon] and type filter [HIIT, Yoga]; then The returned list is the 12:00 HIIT and 16:59 Yoga sessions
  - AC-34.4 [unit] Given A day with Yoga 07:00, HIIT 12:00, Spin 17:00 and a Cancelled by studio Boxing 19:00; when The schedule is requested for that day with no filters; then The returned list is Yoga 07:00, HIIT 12:00, Spin 17:00, Boxing 19:00 with the Boxing status value Cancelled by studio
- **REQ-35** (ADDED) The Schedule screen shall show a Monday–Sunday day strip of 7 chips labelled like "Mon 12", with today highlighted, days without sessions dimmed, and previous/next week arrows limited to the current and next week.
  - AC-35.1 [manual] Given Today is Wednesday 7 October; when The Schedule screen opens; then The day strip shows chips "Mon 5" to "Sun 11" with "Wed 7" highlighted and selected, and the previous-week arrow is shown disabled
  - AC-35.2 [manual] Given The current week is shown; when The next-week arrow is activated; then Chips "Mon 12" to "Sun 18" are shown and the next-week arrow is shown disabled
- **REQ-36** (ADDED) The Schedule screen shall show a filter bar with multi-select class type chips in each type's accent colour, Low/Medium/High intensity chips, Morning/Afternoon/Evening chips and a "Clear filters" action that resets all filters.
  - AC-36.1 [manual] Given A selected day with sessions of several types; when The Yoga chip is selected; then Only Yoga cards are shown, ordered by start time
  - AC-36.2 [manual] Given Yoga and Evening filters are selected on the Schedule screen; when "Clear filters" is activated; then No filter chip is shown as selected and the list shows every session for the day
- **REQ-37** (ADDED) The Schedule screen shall show each session of the selected day as a card displaying start time and duration, class name, colour-coded type tag with text, intensity indicator, instructor avatar and name, room, capacity bar with availability label, and an action button, with studio-cancelled sessions shown struck through.
  - AC-37.1 [manual] Given A selected day with a Yoga session and a studio-cancelled session; when The Schedule screen is shown; then The Yoga card displays time, duration, name, "Yoga" tag, intensity, instructor avatar and name, room and a capacity bar, and the studio-cancelled card's name is shown struck through with the label "Cancelled" and a disabled button
- **REQ-38** (ADDED) The Schedule screen shall label each card's action button "Book", "Join waitlist", "Booked ✓" or "Waitlisted #N" according to Alex's state, or show it disabled when the session has started, is cancelled by the studio, or is outside the booking window.
  - AC-38.1 [manual] Given A selected day with a bookable, a full, a Booked and a Waitlisted (#2) session; when The Schedule screen is shown; then The card buttons are displayed as "Book", "Join waitlist", "Booked ✓" and "Waitlisted #2"
  - AC-38.2 [manual] Given A session that started 5 minutes ago and a session starting in 8 days; when The Schedule screen is displayed for their days; then Both cards show a disabled action button
  - AC-38.3 [manual] Given "Power HIIT" is full with 2 on the waitlist; when Join waitlist is activated on its card; then The button is shown as "Waitlisted #3"
- **REQ-39** (ADDED) When Alex activates a Schedule class card outside its action button or a My Bookings row, the booking app shall open the Class Detail screen for that session.
  - AC-39.1 [manual] Given A Schedule card; when The card is activated outside its button; then The Class Detail screen for that session is shown and no booking record is created
  - AC-39.2 [manual] Given A My Bookings row; when The row is activated; then The Class Detail screen for that session is shown
- **REQ-40** (ADDED) When Alex books from a Schedule card, the booking app shall update the card at once and show the toast "You're booked for <class name> · <Ddd> <HH:mm>" with an Undo action available for 5 seconds.
  - AC-40.1 [manual] Given "Sunrise Vinyasa" on Monday 07:00 has 20 spots and 18 booked; when Book is activated on its card; then The card shows "Booked ✓", the toast message "You're booked for Sunrise Vinyasa · Mon 07:00" is displayed with an Undo button, and the class is listed under Upcoming in My Bookings
  - AC-40.2 [manual] Given The booking toast is shown; when Undo is activated within 5 seconds; then The card shows "Book" with its previous availability label again and no row for that class is shown in My Bookings Upcoming or Past
- **REQ-41** (ADDED) When Alex joins a waitlist, leaves a waitlist or cancels a booking, the booking app shall show a confirmation toast without an Undo action.
  - AC-41.1 [manual] Given A full class on the Schedule; when Join waitlist is activated; then The button shows "Waitlisted #N" and a toast is displayed with no Undo button
  - AC-41.2 [manual] Given A full class open on Class Detail; when Join waitlist is activated; then A confirmation toast is shown with no Undo action
- **REQ-42** (ADDED) If a book, cancel, join-waitlist or leave-waitlist call started from an optimistic screen update is rejected or fails, then the booking app shall restore the screen to its previous state and show an error toast with a plain-language message and no raw error text or stack trace.
  - AC-42.1 [manual] Given A card for a session that overlaps a Booked session; when Book is activated; then The card returns to "Book" and an error toast naming the conflicting class is shown, with no stack trace or raw error text on the page
  - AC-42.2 [manual] Given A Schedule card where the book call will be rejected with the limit error; when Book is activated; then The card returns to "Book" with its previous availability label and an error toast shows "You've reached the limit of 10 upcoming classes."
  - AC-42.3 [manual] Given Local storage writes are made to fail (e.g. storage quota filled); when Book is activated on a card; then The card returns to "Book" with its previous availability and a plain-language error toast is shown with no exception text
- **REQ-43** (ADDED) While schedule data is loading, empty, filtered to nothing, or failed to load, the Schedule screen shall show skeleton cards, "No classes on this day" with an icon, "No classes match your filters" with Clear filters, or an inline error message with Retry, respectively.
  - AC-43.1 [manual] Given A selected day with no sessions; when The Schedule screen shows that day; then The message "No classes on this day" is displayed with an icon
  - AC-43.2 [manual] Given A day with only Yoga sessions; when Only the Boxing chip is selected; then The message "No classes match your filters" and a Clear filters button are displayed
  - AC-43.3 [manual] Given Reading stored data fails; when The Schedule screen loads; then An inline error message with a Retry button is displayed and no raw error text or stack trace is shown
- **REQ-44** (ADDED) When Back is used on Class Detail, the booking app shall return to the screen it was opened from (Schedule or My Bookings) with that screen's selected day, week, filters and tab kept.
  - AC-44.1 [manual] Given Schedule shows next week's Thursday with the Yoga filter selected; when A card is opened and Back is activated on Class Detail; then The Schedule screen is shown with next week's Thursday selected and the Yoga chip shown as selected
  - AC-44.2 [manual] Given My Bookings shows the Past tab; when A row is opened and Back is activated on Class Detail; then The My Bookings screen is shown with the Past tab selected
- **REQ-45** (ADDED) The Class Detail screen shall show a hero header in the class type's accent colour with class name, type tag and intensity, plus date, start–end time, duration, room, an instructor card with avatar, name and bio, the description, a "What to bring" list with icons, an availability block with capacity bar and spots-left or waitlist count, and the text "Free cancellation until 2 hours before class."
  - AC-45.1 [manual] Given A Yoga session 07:00, 60 minutes, Studio A; when Its Class Detail screen is opened; then The page displays a sage-green hero with the class name, "Yoga" tag and intensity, the date, "07:00–08:00", "60 min", "Studio A", the instructor name and bio, the description, the what-to-bring items, the availability block and the text "Free cancellation until 2 hours before class."
  - AC-45.2 [manual] Given A Pilates class; when Its Class Detail screen is opened; then The hero is displayed in the Pilates dusty rose accent
- **REQ-46** (ADDED) The Class Detail action footer shall show "Book this class" with "X spots left", "Join waitlist" with "You'd be #N", "Cancel booking" in destructive style with "You're booked", "Leave waitlist" with "You're #N on the waitlist", or a disabled button with the reason text for started, past, studio-cancelled or outside-booking-window sessions, and stay pinned to the bottom of the viewport at every scroll position on viewports under 768 px.
  - AC-46.1 [manual] Given A session with 5 spots left where Alex is not booked; when Class Detail is opened; then The footer displays a "Book this class" button and the text "5 spots left"
  - AC-46.2 [manual] Given A full session with waitlist count 2 where Alex is not booked; when Class Detail is opened; then The footer displays "Join waitlist" and "You'd be #3"
  - AC-46.3 [manual] Given Sessions where Alex is Booked and where Alex is Waitlisted #2; when Each Class Detail is opened; then The footers display "Cancel booking" with "You're booked" and "Leave waitlist" with "You're #2 on the waitlist" respectively
  - AC-46.4 [manual] Given A session with status "Cancelled by studio" and a session starting 8 days from now; when Each Class Detail is opened; then The footer button is shown disabled with reason text "Cancelled by studio" and with reason text about the 7-day booking window respectively
  - AC-46.5 [manual] Given A 375 px wide viewport on a Class Detail screen; when The page is scrolled to the top, middle and bottom; then The footer action button is shown inside the viewport at each position
- **REQ-47** (ADDED) When Alex chooses to cancel a booking from Class Detail or the My Bookings quick Cancel action, the booking app shall open a confirmation dialog before cancelling that, for a session starting in less than 2 hours, shows the warning "Late cancellation — this counts as a missed class." in warning style.
  - AC-47.1 [manual] Given A Booked session starting in 90 minutes; when Cancel booking is activated; then A dialog is shown containing the text "Late cancellation — this counts as a missed class." in warning style
  - AC-47.2 [manual] Given A Booked session starting in 3 hours; when Cancel booking is activated and the dialog is dismissed; then The dialog was shown without the late-cancellation text, the footer still shows "Cancel booking" and My Bookings still shows the record as Booked
  - AC-47.3 [manual] Given An upcoming Booked row in My Bookings for a session starting in 90 minutes; when Its quick Cancel action is activated; then The same confirmation dialog is shown with the late-cancellation text
- **REQ-48** (ADDED) If a booking from Class Detail is rejected, then the booking app shall show the rule's message (such as the overlap message naming the conflicting class or the 10-class limit message), and also refresh the availability block and change the footer to "Join waitlist" when the rejection reason is that the session became full.
  - AC-48.1 [manual] Given Class Detail shows "Book this class" and the session becomes full in stored data; when "Book this class" is activated; then The availability block shows the full state and the footer button shows "Join waitlist" with "You'd be #N"
  - AC-48.2 [manual] Given A session that overlaps Alex's Booked "Power HIIT" 18:00–18:45; when "Book this class" is activated; then The error message "You're already booked for Power HIIT at 18:00–18:45." is displayed
- **REQ-49** (ADDED) The My Bookings screen shall show a header with the AR avatar, "Alex Rivera" and "Unlimited Monthly", three stat tiles (Upcoming, Classes this month, Current streak (weeks)), and Upcoming and Past tabs, where Upcoming rows are grouped by day and show time, class name, type tag, instructor, room, a "Booked" or "Waitlisted #N" badge and a Cancel or Leave action, and Past rows show a status badge reading "Attended", "Cancelled", "Late cancel" or "Cancelled by studio".
  - AC-49.1 [manual] Given Fresh seed data with today Wednesday 7 October; when The My Bookings Upcoming tab is shown; then 2 rows with "Booked" badges and 1 row with a "Waitlisted #N" badge are displayed in start-time order under day headings such as "Today", "Tomorrow" and "Fri 9 Oct", each with a Cancel or Leave button, and the Upcoming stat tile shows 2
  - AC-49.2 [manual] Given Alex late-cancelled a class; when The Past tab is shown; then That row is displayed with the badge "Late cancel" and the stat tile values match the values returned by getStats
  - AC-49.3 [manual] Given An upcoming Booked row starting in more than 2 hours; when Its Cancel action is activated and confirmed; then The row is shown in the Past tab with a "Cancelled" badge
- **REQ-50** (ADDED) While Alex has no upcoming records, no past records, or My Bookings is loading or failed to load, the My Bookings screen shall show "No upcoming classes" with a "Browse schedule" button that opens Schedule, "Your class history will appear here.", skeleton rows, or an inline error with Retry, respectively.
  - AC-50.1 [manual] Given Alex has no Booked or Waitlisted upcoming records; when "Browse schedule" on the Upcoming tab is activated; then The text "No upcoming classes" was displayed and the Schedule screen is now shown
  - AC-50.2 [manual] Given Alex has no past records; when The Past tab is shown; then The text "Your class history will appear here." is displayed
- **REQ-51** (ADDED) The booking app shall define its colours as design tokens with a warm off-white background, near-black text, one brand primary for primary actions, semantic success, warning, danger and muted colours, and accents Yoga sage green, Pilates dusty rose, HIIT coral/orange, Spin electric blue and Boxing deep plum used on tags, card edges and the detail hero.
  - AC-51.1 [manual] Given The built app with the OS in light mode; when A reviewer inspects the stylesheet and the three screens at 375 px and 1280 px; then The reviewer records that all colour values come from named tokens, the page background is shown warm off-white, each class type uses its listed accent on its tag, card edge and detail hero, and the look is boutique rather than an admin template
- **REQ-52** (ADDED) Where the system colour preference is dark, the booking app shall render all three screens in a dark theme.
  - AC-52.1 [manual] Given The OS set to dark mode; when Each of the three screens is opened; then Each screen is shown with a dark background and no light-background panels, and every text/background pair measured by an automated contrast checker reports a ratio value of at least 4.5:1 for body text
- **REQ-53** (ADDED) The booking app shall use one display font for headings and class names, one sans-serif body font, a type scale with display, h1, h2, body and caption sizes, and tabular figures for times and numbers.
  - AC-53.1 [manual] Given The Schedule list; when A reviewer compares start times of consecutive cards; then Digits are displayed aligned vertically and the computed font-variant-numeric value is tabular-nums
- **REQ-54** (ADDED) While the system prefers reduced motion, the booking app shall replace card press, panel slide, capacity bar fill and toast slide animations with instant changes.
  - AC-54.1 [manual] Given The OS reduced-motion setting is on; when A reviewer opens Class Detail and books a class; then The panel and toast are displayed with no slide animation and the capacity bar is displayed without a fill animation
- **REQ-55** (ADDED) The booking app shall make every interactive element reachable and operable by keyboard alone with a visible focus indicator.
  - AC-55.1 [manual] Given A keyboard-only user; when They open Schedule, filter by Yoga, book a class, open My Bookings and cancel it; then Every step is completed without a pointer and a focus outline is shown on each focused control
- **REQ-56** (ADDED) The booking app shall use semantic headings, landmarks and labels, announce the capacity bar as "N of M spots left", and pair every colour signal (type tags, status badges) with text or an icon.
  - AC-56.1 [manual] Given A session with capacity 20 and 14 booked; when Its capacity bar's accessible name is read by an accessibility tree inspector; then The value read is "6 of 20 spots left"
  - AC-56.2 [manual] Given A screen reader (VoiceOver or NVDA) is running; when A person navigates to a card for that session; then The announced value for the capacity bar is "6 of 20 spots left" and the type tag is announced by name
- **REQ-57** (ADDED) While a dialog is open, the booking app shall keep keyboard focus inside the dialog and close it when Escape is pressed, returning focus to the control that opened it.
  - AC-57.1 [manual] Given The cancel confirmation dialog is open; when Tab is pressed repeatedly and then Escape; then Focus stays on dialog controls during tabbing, and after Escape the dialog is no longer shown, focus is on the Cancel booking button and the booking is still shown as Booked
- **REQ-58** (ADDED) The booking app shall render all three screens without horizontal page scrolling from 360 px wide (only the day strip may scroll), show schedule cards in 2 columns from 768 px to 1023 px, and from 1024 px show Class Detail as a side panel beside the schedule within a maximum content width.
  - AC-58.1 [manual] Given Viewports of 360 px and 375 px wide; when Each of the three screens is opened; then The page's scroll width value equals the viewport width (only the day strip scrolls horizontally)
  - AC-58.2 [manual] Given Viewports of 768 px and 800 px wide; when The Schedule screen is displayed; then Class cards are shown in 2 columns
  - AC-58.3 [manual] Given A 1280 px wide viewport; when A class card is activated; then Class Detail is shown as a side panel while the schedule list stays displayed
- **REQ-59** (ADDED) The booking app shall make every interactive target at least 44 × 44 px.
  - AC-59.1 [manual] Given A 360 px wide viewport; when The bounding box of every button, chip and link is measured; then Each measured width and height value is at least 44 px
- **REQ-60** (ADDED) When the project's automated test job runs, the test suite shall run passing tests that call the booking service directly for booking success, full-class rejection with waitlist join, waitlist promotion, the 7-day and 15-minute windows, the late-cancellation flag, overlap rejection, the 10-booking limit, and past and studio-cancelled rejection.
  - AC-60.1 [job] Given The repository with dependencies installed; when The unit test job is run in CI; then The exit status is 0 and the test report lists at least one passing test for each of the 8 named business rules with a failed count of 0
- **REQ-61** (ADDED) The project shall include an automated end-to-end test that opens the Schedule, filters by Yoga, books a class, finds it in My Bookings and cancels it.
  - AC-61.1 [job] Given The built app; when The end-to-end test command runs in CI; then The exit status is 0 and the report shows the schedule → Yoga filter → book → My Bookings → cancel test passed
- **REQ-62** (ADDED) ⚠ only one draft had this When the app loads with stored data whose sessions do not cover the current or the next Monday–Sunday week in Europe/London, the booking service shall generate seed sessions for each missing week, covering all 5 class types, without adding any booking record for Alex, add them to local storage, and keep every stored session, booking record and session count unchanged.
  - AC-62.1 [unit] Given Local storage holds data seeded on Wednesday 2026-10-07 (weeks starting 5 Oct and 12 Oct); when The booking service is initialised with a clock of Wednesday 2026-10-14 10:00 Europe/London; then The returned session list contains at least 20 sessions starting between Monday 2026-10-19 and Sunday 2026-10-25 covering all 5 types, the sessions of 12–18 Oct keep their stored IDs, start times and count values, and Alex's returned booking records are identical to the stored records
  - AC-62.2 [unit] Given Local storage holds data seeded on 2026-10-07; when The booking service is initialised with a clock of Wednesday 2026-11-04 10:00 Europe/London; then The returned session list contains at least 40 sessions starting between Monday 2026-11-02 and Sunday 2026-11-15, and a book call on one of them that starts within 7 days and has free spots returns a Booked record
  - AC-62.3 [unit] Given The booking service was initialised over that storage with a clock of 2026-10-14; when A new instance is initialised over the same storage with the same clock; then The returned session count value is the same as after the first initialisation (no duplicate sessions)
- **REQ-63** (ADDED) ⚠ only one draft had this If Alex requests to cancel a record whose status is not Booked, or to leave a waitlist with a record whose status is not Waitlisted, then the booking service shall reject the request with an "invalid booking state" error and leave every booking record and session count unchanged.
  - AC-63.1 [unit] Given A Booked record on a session starting in 3 hours with booked count 10 and waitlist count 2; when cancel(booking) is called twice in a row with no wait between them; then The second call returns an "invalid booking state" error, the record status value is Cancelled, the waitlist count value is 1 and the booked count value is 10 (reduced only once)
  - AC-63.2 [unit] Given Alex is Waitlisted at position 2 on a full session with waitlist count 3 starting tomorrow; when cancel(booking) is called with that Waitlisted record; then The returned error is "invalid booking state", the record status value stays Waitlisted with position value 2, and the waitlist count value stays 3
  - AC-63.3 [unit] Given Alex holds an Attended record and a Cancelled record on past sessions; when cancel is called for each record; then Each call returns an "invalid booking state" error and each record's status value is unchanged
  - AC-63.4 [unit] Given Alex holds a Booked record on a session starting tomorrow with booked count 12; when leaveWaitlist(booking) is called with that Booked record; then The returned error is "invalid booking state", the record status value stays Booked and the booked count value stays 12
  - AC-63.5 [unit] Given Alex is Waitlisted at position 3 on a session with waitlist count 3 starting tomorrow; when leaveWaitlist(booking) is called twice in a row; then The second call returns an "invalid booking state" error and the waitlist count value is 2

Checked by a person, not by a test: AC-1.1, AC-1.2, AC-1.3, AC-2.3, AC-5.2, AC-7.3, AC-23.1, AC-24.1, AC-25.2, AC-33.1, AC-33.2, AC-35.1, AC-35.2, AC-36.1, AC-36.2, AC-37.1, AC-38.1, AC-38.2, AC-38.3, AC-39.1, AC-39.2, AC-40.1, AC-40.2, AC-41.1, AC-41.2, AC-42.1, AC-42.2, AC-42.3, AC-43.1, AC-43.2, AC-43.3, AC-44.1, AC-44.2, AC-45.1, AC-45.2, AC-46.1, AC-46.2, AC-46.3, AC-46.4, AC-46.5, AC-47.1, AC-47.2, AC-47.3, AC-48.1, AC-48.2, AC-49.1, AC-49.2, AC-49.3, AC-50.1, AC-50.2, AC-51.1, AC-52.1, AC-53.1, AC-54.1, AC-55.1, AC-56.1, AC-56.2, AC-57.1, AC-58.1, AC-58.2, AC-58.3, AC-59.1 (screens and manual checks aren't automated yet)

Not changing: Sign in, sign up and password reset; a single pre-signed-in demo member (request §12); Payments, credits, class packs and membership purchase (request §12); Staff, instructor or admin screens, schedule editing, and any operation for the studio to cancel a class, including one Alex holds (request §12, ASM-8); Email, SMS and push notifications (request §12); Calendar export or sync (request §12); Multiple studio locations (request §12); Native mobile apps (request §12); Multi-language support (request §12); A backend server or database: persistence is browser local storage only (ASM-15, ASM-6); Any visible UI for the waitlist promotion demo hook; it is test-only (ASM-16); Modelling other members as individual records; they exist only as booked and waitlist counts (Q-5); Schedule navigation beyond the current and next week (ASM-9, ASM-20)

## Files the plan will touch (25)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-1/use-schedule.ts  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- components/screens/s-2/use-class-detail.ts  ← not found by grounding; check it
- components/screens/s-3/container.tsx  ← not found by grounding; check it
- components/screens/s-3/use-my-bookings.ts  ← not found by grounding; check it
- components/screens/shared/error-copy.ts  ← not found by grounding; check it
- components/screens/shared/url-state.ts  ← not found by grounding; check it
- components/screens/shared/use-api-query.ts  ← not found by grounding; check it
- components/screens/shared/use-optimistic-action.ts  ← not found by grounding; check it
- components/screens/shared/use-promotion-toast.ts  ← not found by grounding; check it
- lib/booking/api-client.ts  ← not found by grounding; check it
- lib/booking/errors.ts  ← not found by grounding; check it
- lib/booking/filters.ts  ← not found by grounding; check it
- lib/booking/index.ts  ← not found by grounding; check it
- lib/booking/labels.ts  ← not found by grounding; check it
- lib/booking/local-api.ts  ← not found by grounding; check it
- lib/booking/seed.ts  ← not found by grounding; check it
- lib/booking/service.ts  ← not found by grounding; check it
- lib/booking/storage.ts  ← not found by grounding; check it
- lib/booking/time.ts  ← not found by grounding; check it
- lib/booking/types.ts  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: OPT-A: Screen containers call an in-browser BookingService module directly through React hooks. No contract client. | OPT-B (chosen): All rules live in an in-browser BookingService (lib/booking) over localStorage with an injectable clock. The contract (contracts/openapi.yaml) is served inside the browser by a local fetch adapter (lib/booking/local-api.ts). Containers call only the generated lib/api client, wired to that adapter, so nothing goes over the network. | OPT-C: Build a real backend API repo with server-side persistence. The web app uses the generated client over HTTP.
Decision: Decision: one in-browser BookingService (lib/booking) holds every rule over localStorage, with an injectable clock and storage. contracts/openapi.yaml is served in the browser by a local fetch adapter, and screens use only the generated lib/api client over it, so there are no network calls.
Precedence (fixes critic gaps): book checks not_found > cancelled_by_studio > class_has_started > outside_booking_window > already_booked > class_full > overlap > limit_reached. Cancel and leave check record state (invalid_booking_state) before class_has_started.
A Booked or Waitlisted record wins over Disabled in the action state, with canChange=false and a reason once the class has started. Undo only works on a Booked record less than 5 s old (otherwise undo_expired or invalid_booking_state) and subtracts 1 from the booked count.
Seed sessions use London wall-clock times (DST-safe). Weeks roll forward without touching stored data. Corrupt or old-version storage is re-seeded; storage that can't be read gives storage_failure and Retry.
Promotion toasts come from stored PromotionNotices that are acknowledged once. Schedule and My Bookings state (day, week, filters, tab, from) lives in the URL so Back restores it.
- TASK-1 Design system: install and build the generated scaffold → REQ-51, REQ-52, REQ-53, REQ-54, REQ-59; must pass AC-51.1, AC-52.1, AC-53.1, AC-54.1, AC-59.1
- TASK-2 Booking domain foundation: types, London time, storage, seed generator and roll-forward, labels, errors → REQ-2, REQ-3, REQ-4, REQ-5, REQ-32, REQ-62; must pass AC-2.1, AC-2.2, AC-2.3, AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-4.1, AC-4.2, AC-5.1, AC-5.2, AC-32.1, AC-32.2, AC-62.1, AC-62.2, AC-62.3
- TASK-3 BookingService: rules, filters, lists, stats, action state, promotion hook → REQ-6, REQ-7, REQ-8, REQ-9, REQ-10, REQ-11, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-18, REQ-19, REQ-21, REQ-22, REQ-25, REQ-26, REQ-27, REQ-28, REQ-30, REQ-31, REQ-34, REQ-60, REQ-63; must pass AC-6.1, AC-6.2, AC-7.1, AC-7.2, AC-7.3, AC-8.1, AC-9.1, AC-9.2, AC-9.3, AC-10.1, AC-10.2, AC-11.1, AC-11.2, AC-13.1, AC-13.2, AC-13.3, AC-13.4, AC-14.1, AC-14.2, AC-15.1, AC-15.2, AC-16.1, AC-16.2, AC-17.1, AC-17.2, AC-17.3, AC-18.1, AC-18.2, AC-19.1, AC-21.1, AC-21.2, AC-21.3, AC-22.1, AC-22.2, AC-22.3, AC-22.4, AC-22.5, AC-25.1, AC-25.2, AC-26.1, AC-26.2, AC-27.1, AC-31.1, AC-31.2, AC-31.3, AC-31.4, AC-34.1, AC-34.2, AC-34.3, AC-34.4, AC-60.1, AC-63.1, AC-63.2, AC-63.3, AC-63.4, AC-63.5
- TASK-4 Contract adapter: local fetch serving openapi.yaml, generated-client wiring, shared screen hooks → REQ-1, REQ-24, REQ-42, REQ-43; builds towards a later task (no criteria of its own)
- TASK-5 S-2 Class detail container: real data, footer actions, dialogs, rejections → REQ-23, REQ-41, REQ-42, REQ-44, REQ-45, REQ-46, REQ-47, REQ-48, REQ-55, REQ-56, REQ-57, REQ-58; must pass AC-23.1, AC-45.1, AC-45.2, AC-46.1, AC-46.2, AC-46.3, AC-46.4, AC-46.5, AC-48.1, AC-48.2
- TASK-6 S-1 Schedule container: week strip, filters, cards, optimistic book/join, side panel → REQ-1, REQ-24, REQ-33, REQ-35, REQ-36, REQ-37, REQ-38, REQ-39, REQ-40, REQ-41, REQ-42, REQ-43, REQ-44, REQ-55, REQ-56, REQ-58; must pass AC-1.1, AC-1.2, AC-1.3, AC-24.1, AC-33.1, AC-33.2, AC-35.1, AC-35.2, AC-36.1, AC-36.2, AC-37.1, AC-38.1, AC-38.2, AC-38.3, AC-40.1, AC-40.2, AC-43.1, AC-43.2, AC-43.3, AC-44.1, AC-44.2, AC-56.1, AC-56.2, AC-58.1, AC-58.2, AC-58.3
- TASK-7 S-3 My bookings container: stats, Upcoming/Past tabs, quick cancel/leave, end-to-end flow → REQ-28, REQ-30, REQ-39, REQ-41, REQ-42, REQ-47, REQ-49, REQ-50, REQ-55, REQ-57, REQ-61; must pass AC-28.1, AC-28.2, AC-28.3, AC-30.1, AC-30.2, AC-30.3, AC-30.4, AC-39.1, AC-39.2, AC-41.1, AC-41.2, AC-42.1, AC-42.2, AC-42.3, AC-47.1, AC-47.2, AC-47.3, AC-49.1, AC-49.2, AC-49.3, AC-50.1, AC-50.2, AC-55.1, AC-57.1, AC-61.1

Stub commit (throws NotImplemented until implemented): lib/booking/types.ts, lib/booking/errors.ts, lib/booking/time.ts, lib/booking/labels.ts, lib/booking/storage.ts, lib/booking/seed.ts, lib/booking/filters.ts, lib/booking/service.ts, lib/booking/index.ts, lib/booking/local-api.ts

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /me -> 200, 500
- GET /schedule -> 200, 400, 500
- GET /sessions/{sessionId} -> 200, 404, 500
- POST /bookings -> 201, 400, 404, 409, 500
- POST /bookings/{bookingId}/undo -> 200, 404, 409, 500
- POST /bookings/{bookingId}/cancel -> 200, 404, 409, 500
- POST /waitlist -> 201, 400, 404, 409, 500
- POST /bookings/{bookingId}/leave-waitlist -> 200, 404, 409, 500
- GET /me/bookings -> 200, 500
- GET /me/stats -> 200, 500
- GET /me/promotion-notices -> 200, 500
- POST /me/promotion-notices/acknowledge -> 204, 500
- POST /test/sessions/{sessionId}/simulate-other-member-cancellation -> 200, 404, 500

## Critic findings (24)
- [medium] REQ-28 REQ-28 defines the Past list as only "Attended and Cancelled records", but REQ-27 and REQ-49 also put "Cancelled by studio" records in Past, so the list definitions contradict each other.
- [medium] REQ-16 "Upcoming" means different things: REQ-16 counts the 10-booking limit on sessions that "have not started", while REQ-28 and the REQ-30 Upcoming stat use sessions that "have not ended", so an in-progress class counts toward the stat but not the limit.
- [medium] REQ-49 Every Upcoming row must show a Cancel or Leave action, and REQ-28 keeps in-progress classes in Upcoming, but REQ-13 rejects cancel and leave once a class has started; no disabled state is defined for these rows.
- [medium] REQ-31 The order of action states is undefined when Alex is Booked or Waitlisted on a session that has started (or is studio-cancelled): REQ-31 and REQ-46 allow both Booked/"Cancel booking" and Disabled "started".
- [medium] REQ-6 No order of precedence is set between book errors (already booked, class full, outside booking window, class has started, cancelled by studio, overlap, limit), so a session that breaks several rules (e.g. full and studio-cancelled) has no single defined error, even though each AC asserts an exact error.
- [medium] REQ-25 undoBooking has no error paths: undo after 5 seconds, undo on a non-Booked or already-undone record, or a second undo call are all unspecified, and REQ-63's "invalid booking state" guard covers only cancel and leave.
- [low] REQ-25 Undo "restore[s] the session's booked count to its value before the booking" (an absolute value), which overwrites any count change made in between (e.g. by the promotion hook) instead of subtracting 1.
- [medium] REQ-24 AC-24.1 and AC-23.1 are manual checks that need simulateOtherMemberCancellation to have run, but ASM-16 makes that hook test-only with no UI, so a manual tester cannot reach this state from any public surface.
- [medium] REQ-24 The "promoted since the last visit, shown once" toast needs stored state (a last-visit or notification-seen marker), but REQ-5 lists the persisted fields without it and no requirement defines when it is set or cleared.
- [low] REQ-22 The stored skip reason is only re-checked when the hook runs again, so after Alex cancels the overlapping class, Class Detail (REQ-23) and getActionState keep showing an out-of-date "overlaps Power HIIT" reason.
- [low] REQ-22 The skip path leaves a session that has free spots but a non-zero waitlist count (AC-22.4: booked 15 of 16, waitlist 1), which contradicts REQ-9's premise that a waitlist only exists while the session is full, and REQ-32 then labels it "1 spot left".
- [low] REQ-18 A cancellation inside 15 minutes of start always promotes another waitlisted member (waitlist count -1), but ASM-2 and REQ-22 say nobody can be promoted within the 15-minute window.
- [low] REQ-48 AC-48.1 needs the session to "become full in stored data" while Class Detail is open, which is impossible to reach with one member and no backend; multi-tab local storage concurrency, the only realistic cause, is never specified.
- [medium] REQ-43 The only recovery from failing to read stored data is Retry, so corrupt or schema-incompatible local storage, or storage that is unavailable on first load, leaves the app permanently on an error with no reset or re-seed path.
- [medium] REQ-38 Nothing says what activating the "Booked ✓" or "Waitlisted #N" card button does (cancel, open detail, or nothing), yet AC-7.3 relies on a second tap landing on that button.
- [low] REQ-3 AC-3.3 does not check that seeded records match the session counts: that the Waitlisted session is full with position ≤ its waitlist count, and that the two Booked sessions don't overlap and are included in booked counts.
- [low] REQ-4 REQ-4 says stored sessions are reused unchanged whenever stored seed data exists, while REQ-62 adds newly generated weeks to the same store on load, so the two load-time behaviours are stated inconsistently.
- [low] REQ-62 Rolling seed data forward week by week goes beyond Q-6 ("worked out from today on first load, then stored") and I-5 (current and next week).
- [low] REQ-62 Generated weeks such as 19–25 Oct 2026 include the Europe/London DST change, but nothing says whether session start times are produced as London wall-clock times or as fixed offsets.
- [low] REQ-16 The studio's rule thresholds (10-booking limit, 7-day, 15-minute and 2-hour windows) are written directly into user-facing strings and logic ("You've reached the limit of 10 upcoming classes.", "Booking opens 7 days before class") rather than set as studio configuration; Q-10 covered only REQ-33 and 1023 px.
- [low] REQ-24 Assumptions and out-of-scope items cite "request §12" and "request §13" (e.g. the promotion toast, the streak definition), but no such sections appear among the intent spans, so these claims have no source.
- [low] REQ-60 AC-60.1 requires a passing test for each of "the 8 named business rules", but the requirement lists 8 to 10 rules depending on whether 7-day/15-minute and past/studio-cancelled count as one each, so the check is ambiguous.
- [low] REQ-39 Class Detail has no not-found or invalid-session path (e.g. a stale or unknown session ID from navigation or reload), and reloading or using the browser Back button on Class Detail is not specified.
- [low] NFR-10 A 5-participant usability study with a median 30-second time-to-book is not in the intent and adds a human-research activity beyond the requested automated tests.
_No OpenAI key: critic ran on claude-opus-5-5 (same family as the implementer)_

## Still open after 0 repairs
- [round trip] not asked for: There is a single pre-signed-in member, Alex Rivera, with no sign-in screen.
- [round trip] not asked for: A top bar must show the Pulse Studio wordmark and an avatar with initials AR linking to My Bookings.

## Settled by questions, and open risks
- Spec question Q-9: The spec has 60 requirements, which is about 5 runs of work. Should it be built in one run, or should part of it be cut or moved to a later run? → Approve as one run: the request asks for all 3 screens, the rules, the design system and the tests together (answered)
- Spec question Q-10: REQ-33 points to REQ-32 by number, and REQ-58 uses 1023 px as the top of the tablet range. Should either of these be configuration? → Keep both as fixed values: the REQ-32 reference is a link between requirements, and 1023 px is just the step below the 1024 px desktop breakpoint (answered)
- Spec check: "There is a single pre-signed-in member, Alex Rivera, with no sign-in screen." is in scope. The request asks for it: "A single, already-signed-in member (demo user). No sign-in screen is required in this release."
- Spec check: "A top bar must show the Pulse Studio wordmark and an avatar with initials AR linking to My Bookings." is in scope. The request asks for it: "Top bar: studio logo/wordmark, member avatar (links to Screen 3)."

**This spec has 60 requirements, about 5 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261006-boutique-fitness-studio-class-b497 <hash> --note "your risk note"
  factory reject  20261006-boutique-fitness-studio-class-b497 <hash> --reason "why"

Card hash: eeb3297e