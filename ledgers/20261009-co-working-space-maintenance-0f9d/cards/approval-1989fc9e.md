# Approval: Build a web app for Hive Works with two screens: a filtered requests l

Run 20261009-co-working-space-maintenance-0f9d · risk **high** · feature · size L · cost so far $0.73

## Your request (word for word, from maintenance-requests-requirements.md)
> # Co-working Space — Maintenance Requests
> 
> ## 1. Product Overview
> 
> A small web app for **Hive Works**, a single co-working space. People who work there report things that need fixing (a broken chair, a leaking tap, a dead light), and the front-desk manager moves each request from open to done.
> 
> This release is deliberately small: **2 screens**, one user, one kind of record. Sections 4 to 7 are the whole scope; nothing beyond them is wanted.
> 
> There is no existing application code. It is a web front end with a small API and a database behind it.
> 
> ---
> 
> ## 2. Product Goals
> 
> - Report a problem in under a minute.
> - See at a glance what is open, in progress and done.
> - Keep the status of a request honest: it can only move in the allowed order.
> 
> ---
> 
> ## 3. User
> 
> One already-signed-in demo user, **Sam Carter** (initials "SC"), who can do everything in this document. There is no sign-in screen and there are no roles.
> 
> ---
> 
> ## 4. Data
> 
> ### 4.1 Request
> 
> | Field | Rules |
> | --- | --- |
> | ID | Set by the system |
> | Title | Required, 3 to 80 characters |
> | Area | Required, one of `Kitchen`, `Meeting room`, `Open desk`, `Washroom`, `Reception` |
> | Priority | Required, one of `Low`, `Normal`, `Urgent` |
> | Description | Optional, up to 500 characters |
> | Status | One of `Open`, `In progress`, `Done` |
> | Created | Set by the system when the request is made |
> 
> There is no other record type.
> 
> ### 4.2 Seed Data
> 
> The app ships with exactly 8 requests:
> 
> - 4 `Open` (one of them `Urgent`)
> - 2 `In progress`
> - 2 `Done`
> 
> Between them they use every area at least once.
> 
> ### 4.3 Persistence
> 
> Requests are stored in the database and survive a reload and a restart.
> 
> ---
> 
> ## 5. Business Rules
> 
> 1. **Valid request** — A request needs a title of 3 to 80 characters, an area and a priority. A description, when given, is at most 500 characters. Anything else is rejected with a message naming the field.
> 2. **Starts open** — A new request always starts as `Open`.
> 3. **Status order** — The only allowed status changes are:
>    - `Open` → `In progress`
>    - `In progress` → `Done`
>    - `Done` → `Open` (reopen)
> 
>    Any other change is rejected.
> 4. **Fixed after creation** — Title, area, priority and description cannot be changed after the request is made. Requests cannot be deleted.
> 
> The rules are enforced by the API, not only by the screens.
> 
> ### 5.1 API operations
> 
> The API needs these four operations and no others:
> 
> 1. List requests, optionally only those with one given status. Newest first.
> 2. Create a request.
> 3. Get one request by ID.
> 4. Change the status of one request.
> 
> ---
> 
> ## 6. Screens
> 
> ### Screen 1 — Requests (home)
> 
> - Top bar: "Hive Works" wordmark and the user's initials.
> - Status filter with four choices: `All`, `Open`, `In progress`, `Done`. One is selected at a time; `All` is the default.
> - **New request** button.
> - List of requests, newest first. Each row shows: title, area, priority badge, status badge and created date (for example "8 Oct 2026").
> - Clicking a row opens Screen 2.
> 
> **New request dialog**
> 
> - Opened by the New request button.
> - Fields: Title, Area (select), Priority (select, default `Normal`), Description (multi-line).
> - Buttons: `Create` and `Cancel`.
> - A field that breaks rule 1 shows its message under the field, and the dialog stays open.
> - On success the dialog closes and the new request is at the top of the list.
> 
> **States**
> 
> - Loading: "Loading requests…"
> - Empty (no requests for the selected filter): "No requests here."
> - Error: "Could not load requests." with a `Retry` button.
> 
> ### Screen 2 — Request detail
> 
> - Back link to Screen 1.
> - Title, area, priority badge, status badge, created date and description (or "No description." when there is none).
> - One action button, depending on status:
> 
> | Status | Button |
> | --- | --- |
> | `Open` | `Start work` (moves to `In progress`) |
> | `In progress` | `Mark done` (moves to `Done`) |
> | `Done` | `Reopen` (moves to `Open`) |
> 
> - After the change, the status badge and the button show the new status.
> - If the change fails: "Could not update the request." The status shown stays as it was.
> - An ID that does not exist shows "Request not found." with a link back to Screen 1.
> 
> ---
> 
> ## 7. Design Requirements
> 
> Clean and plain; a tidy internal tool.
> 
> - One light theme. No dark mode.
> - One brand colour for primary buttons, a neutral background, near-black text.
> - Status badges: `Open` blue, `In progress` amber, `Done` green. Priority `Urgent` red; `Low` and `Normal` neutral. Every badge shows its text, so colour is never the only signal.
> - One sans-serif font.
> - Works at 375 px wide (rows stack as cards) and at 1280 px wide (rows as a table). No horizontal page scroll.
> - Every field has a label, every control can be reached by keyboard, and text meets WCAG AA contrast.
> - No animation is required.
> 
> ---
> 
> ## 8. Decisions Already Made
> 
> These are settled and need no question:
> 
> - No sign-in, no roles, no second user.
> - No editing or deleting a request.
> - No search, no sorting choices, no paging. The list shows every request for the selected filter.
> - No comments, attachments, assignees or due dates.
> - No notifications, email or live updates. The list is current when the page loads or the filter changes.
> - No optimistic updates and no undo: the screen changes after the API answers.
> - The created date is stored in UTC and shown as a date only, with no time and no timezone handling.
> - English only.
> - A double click on `Create` must not make two requests: the button is disabled while the request is being sent.
> 
> ---
> 
> ## 9. Testing Requirements
> 
> Automated tests for the business rules:
> 
> - A valid request is created and starts as `Open`.
> - A request with a missing or too-short title, a missing area or a too-long description is rejected.
> - Each of the three allowed status changes works.
> - A status change outside the allowed order is rejected.
> - The list filtered by a status returns only requests with that status, newest first.
> - An unknown ID is answered as not found.
> 
> Plus one end-to-end test: open the list → create a request → see it at the top → open it → Start work → Mark done → filter by `Done` and see it there.
> 
> ---
> 
> ## 10. Acceptance Criteria Examples
> 
> **Create**
> 
> Given the New request dialog is open,
> When the user enters the title "Kitchen tap is leaking", area `Kitchen`, priority `Urgent` and clicks `Create`,
> Then the dialog closes and the request is first in the list with status `Open`.
> 
> **Validation**
> 
> Given the New request dialog is open,
> When the user clicks `Create` with a title of 2 characters,
> Then the dialog stays open and the Title field shows "Title must be 3 to 80 characters."
> 
> **Status order**
> 
> Given a request with status `Open`,
> When a change straight to `Done` is sent to the API,
> Then it is rejected and the status stays `Open`.
> 
> **Filter**
> 
> Given the seed data,
> When the user selects the `In progress` filter,
> Then exactly 2 requests are listed.
> 
> **Not found**
> 
> Given no request has the ID in the address,
> When Screen 2 opens,
> Then it shows "Request not found."
> 
> ---
> 
> ## 11. Final Scope Summary
> 
> Two screens over one record type:
> 
> 1. **Requests** — a filtered list and a dialog to create a request.
> 2. **Request detail** — the request and one button that moves its status forward or reopens it.
> 
> Four API operations, four business rules, 8 seeded requests, one light theme.


## Your answers
- Q-1 How should leading/trailing whitespace be handled for title and description validation and storage? → **Trim leading/trailing whitespace before validation and storage; treat a resulting blank title as missing.**
- Q-2 Which browsers must the web app support? → **No additional browser commitment; target a modern browser.**
- Q-3 If multiple requests have the same creation timestamp, how should their relative order be determined in the newest-first list? → **Their relative order is unspecified and may vary.**
- Q-4 If creating a request fails for a reason other than field validation (for example, a network or server error), what should the dialog do? → **Show a generic creation error, keep the dialog open with its values, and allow another submission.**
- Q-5 If loading a detail address fails for a reason other than an unknown ID, what should the detail screen show? → **Show a generic loading error with a Retry action; reserve “Request not found.” for unknown IDs.**
- Q-6 When the app starts with an already-populated database, how should the eight seed requests be handled? → **Insert the eight seed requests only when initializing an empty database; preserve all requests on restarts.**
- Q-7 After successfully creating a request while a status filter other than All is selected, what should happen to the filter and list? → **Switch the filter to All so the new Open request appears at the top.**
- Q-8 When the user follows the detail screen's Back link, should the list retain the previously selected status filter? → **Retain the filter selected before opening the detail screen.**

Other assumptions: ASM-1 What should determine the primary-button brand colour, given that no specific colour or brand asset is provided? → assumed: Choose an accessible colour that fits the light design.; ASM-2 Is a hosted deployment required, or is a locally runnable app sufficient? → assumed: One cloud region, in the client's cloud account.

## Requirements
- **REQ-1** (ADDED) The Hive Works maintenance app shall provide exactly two screens, Requests and Request detail, for the demo user Sam Carter with initials SC, without sign-in or role-selection screens.
  - AC-1.1 [ui] Given The app is opened by the demo user.; when The Requests screen is rendered and the user opens a listed request.; then The screen shows the Hive Works wordmark and SC, and navigation shows only the Requests and Request detail screens, with no sign-in or role-selection screen.
  - AC-1.2 [ui] Given The Requests screen is open and a request is available.; when The user opens that request.; then The screen shows Request detail, and the screen list contains no third screen.
- **REQ-2** (ADDED) The Hive Works data model shall define only maintenance request records with a system-generated ID, a UTC creation timestamp, a required title, area, priority, and status, and an optional description.
  - AC-2.1 [api] Given A request has been created through the API.; when The client retrieves the created request by ID.; then The response and persisted row contain the system-generated ID, UTC creation timestamp, title, area, priority, and status, and contain a description only if one was supplied.
- **REQ-3** (ADDED) The Hive Works API shall trim leading and trailing whitespace from title and description values before validation and storage, and treat a title that is blank after trimming as missing.
  - AC-3.1 [api] Given A create request contains title and description values with leading or trailing whitespace and otherwise valid fields.; when The request is submitted to the API and the created request is retrieved by ID.; then The response and persisted record contain the trimmed title and description values.
  - AC-3.2 [api] Given A create request contains a title that is blank after trimming.; when The request is submitted to the API.; then The response identifies the Title field as missing or invalid, and no request row is created.
- **REQ-4** (ADDED) The Hive Works API shall accept only titles of 3 to 80 characters, areas from Kitchen, Meeting room, Open desk, Washroom, and Reception, priorities from Low, Normal, and Urgent, and descriptions of at most 500 characters when supplied, and return a validation message naming each invalid field.
  - AC-4.1 [api] Given A create request contains a missing, blank, too-short, or too-long title; a missing or unsupported area or priority; or a description longer than 500 characters.; when The request is submitted to the API.; then The response identifies each invalid field in an error message, and no request row is created.
  - AC-4.2 [api] Given A create request contains valid field values at the stated length limits.; when The request is submitted to the API.; then The response contains a created request row with those field values.
  - AC-4.3 [api] Given A create request contains a title of 2 characters.; when The request is submitted to the API.; then The response reports the Title field error, including “Title must be 3 to 80 characters.”
- **REQ-5** (ADDED) When a request is created, the Hive Works API shall set the status to Open and assign the ID and UTC creation timestamp itself, regardless of caller-supplied system-controlled values.
  - AC-5.1 [api] Given A valid create request is submitted, including any caller-supplied values for system-controlled fields.; when The API completes creation.; then The response and database row contain status Open and system-generated ID and UTC creation timestamp values.
- **REQ-6** (ADDED) The Hive Works app shall initialize an empty database with exactly eight seed requests, including four Open requests with one Urgent request, two In progress requests, two Done requests, and every supported area represented, and, when initialized with a nonempty database, preserve all existing requests without inserting seeds.
  - AC-6.1 [api] Given The database is empty.; when The app initializes.; then The database contains exactly 8 seed request rows: 4 Open, 2 In progress, and 2 Done, including an Urgent Open row and at least one row for each supported area.
  - AC-6.2 [api] Given The database already contains request rows and their prior values are recorded.; when The app initializes or restarts.; then The database row count and all pre-existing request values are preserved, with no seed rows added.
  - AC-6.3 [api] Given A request has been created and persisted.; when The page is reloaded and the application is restarted before retrieving that request by ID.; then The response and database row still contain the request, its system-generated ID, UTC creation timestamp, and stored values.
- **REQ-7** (ADDED) The Hive Works API shall expose exactly four operations: list requests with an optional status filter, create a request, get a request by ID, and change a request's status; prevent changes to title, area, priority, and description after creation; and expose no request deletion operation.
  - AC-7.1 [api] Given The API contract is available.; when Its operations are inspected.; then The API operation list contains only list, create, get-by-ID, and change-status operations, with no request editing or deletion operation.
  - AC-7.2 [api] Given A request has stored title, area, priority, and description values.; when An API request attempts to change those values or delete the request.; then The response rejects the operation and the database row retains the original values and remains present.
- **REQ-8** (ADDED) The Hive Works API shall return all requests or only requests matching an optional single status, ordered newest first by creation timestamp, without guaranteeing relative order for requests with equal timestamps.
  - AC-8.1 [api] Given Requests exist with different statuses and creation timestamps.; when The list operation is called without a filter and then with each supported status filter.; then The response list contains all requests without a filter or only matching-status requests with a filter, ordered by descending creation timestamp; the test does not assert relative order for equal timestamps.
- **REQ-9** (ADDED) When a client requests a request by ID, the Hive Works API shall return the matching record if it exists and report not found if it does not.
  - AC-9.1 [api] Given One requested ID belongs to an existing request and another ID does not exist.; when The client sends a get-by-ID request for each ID.; then The existing-ID response contains the matching record, and the unknown-ID response reports that the request was not found.
- **REQ-10** (ADDED) The Hive Works API shall allow only the status transitions Open to In progress, In progress to Done, and Done to Open, and reject every other status-change request, including requests for an unknown request ID or an unsupported status value, without changing the stored status of any existing request.
  - AC-10.1 [api] Given A request has status Open, In progress, or Done.; when The API receives its respective allowed transition Open to In progress, In progress to Done, or Done to Open.; then The response and database row show the requested new status for each transition.
  - AC-10.2 [api] Given A request has a status for which the submitted transition is not allowed.; when The API processes the disallowed transition.; then The response contains an error and the database row status remains unchanged.
  - AC-10.3 [api] Given No request exists for the supplied ID.; when The API receives a status-change request for that ID.; then The response reports that the request was not found, and no database row is changed.
  - AC-10.4 [api] Given A request exists with a supported status.; when The API receives a status-change request with an unsupported status value.; then The response contains an error and the database row status remains unchanged.
- **REQ-11** (ADDED) The Hive Works Requests screen shall show the Hive Works wordmark, initials SC, mutually exclusive All, Open, In progress, and Done filters with All selected by default, and a New request button.
  - AC-11.1 [ui] Given The Requests screen is opened without a previously selected filter.; when The screen finishes rendering.; then The screen shows the Hive Works wordmark, SC, all four filter choices with All selected, and the New request button.
  - AC-11.2 [ui] Given The Requests screen is open.; when The user selects each status filter in turn.; then The screen shows only the selected filter as active and shows requests matching that filter; All shows requests of every status.
- **REQ-12** (ADDED) The Hive Works Requests screen shall show each matching request's title, area, priority badge, status badge, and UTC creation date in date-only form, in newest-first order, and open the detail screen when a request row is selected.
  - AC-12.1 [ui] Given The list contains requests with different creation timestamps.; when The Requests screen is rendered and a row is selected.; then The screen shows each matching row's title, area, priority badge, status badge, and UTC creation date in date-only form, ordered newest first, and the detail screen shows the selected request's record.
- **REQ-13** (ADDED) When the user selects New request, the Hive Works app shall open a dialog with labeled Title, Area, Priority, and Description fields, Area and Priority selects containing the supported values, Priority defaulted to Normal, and Create and Cancel buttons.
  - AC-13.1 [ui] Given The Requests screen is displayed.; when The user selects New request.; then The screen shows a creation dialog with labeled Title, Area, Priority, and Description fields, the supported select values, Normal selected by default, and Create and Cancel buttons.
- **REQ-14** (ADDED) When creation field validation fails, the Hive Works app shall keep the creation dialog open and show each field's validation message beneath that field.
  - AC-14.1 [ui] Given The creation dialog is open.; when The user submits a title of 2 characters.; then The screen shows the dialog still open and the Title field message “Title must be 3 to 80 characters.” beneath the field.
  - AC-14.2 [ui] Given The creation dialog is open with a missing area or a description longer than 500 characters.; when The user selects Create.; then The screen shows a validation message naming each invalid field beneath that field and keeps the dialog open.
- **REQ-15** (ADDED) When request creation succeeds, the Hive Works app shall close the dialog and show the new Open request at the top of the list, switching the selected filter to All if another filter was selected.
  - AC-15.1 [ui] Given The creation dialog is open while a filter other than All is selected.; when The user submits valid values and the API creates the request.; then The screen shows the dialog closed, All selected, and the new Open request at the top of the list.
- **REQ-16** (ADDED) The Hive Works app shall disable the Create button and prevent duplicate create calls while a create request is being sent, and, after a non-validation creation failure, show a generic creation error while keeping the dialog and entered values open and allowing another submission.
  - AC-16.1 [ui] Given The creation dialog contains valid values and the create request is pending.; when The user attempts to submit again before the request completes.; then The screen shows the Create button disabled and the API receives only 1 create call for that submission.
  - AC-16.2 [ui] Given The API returns a non-validation creation failure.; when The user submits the creation dialog.; then The screen shows a generic creation error, retains the dialog and entered field values, and allows another submission.
- **REQ-17** (ADDED) While the request list is loading, empty for the selected filter, or unavailable, the Hive Works app shall show the corresponding loading, empty, or error state and provide Retry for the error state.
  - AC-17.1 [ui] Given The list request is pending, returns no matching requests, or fails to load.; when The Requests screen renders each respective state.; then The screen shows “Loading requests…” while pending, “No requests here.” when empty, or “Could not load requests.” with a Retry button on failure.
  - AC-17.2 [ui] Given The Requests screen shows the load error and Retry button.; when The user selects Retry and loading succeeds.; then The screen shows the returned request list.
- **REQ-18** (ADDED) The Hive Works Request detail screen shall show a Back link, the request title, area, priority badge, status badge, UTC creation date in date-only form, and the description or “No description.” when absent, and return to the Requests list with its previously selected filter retained when Back is followed.
  - AC-18.1 [ui] Given A request with a description is opened from the list.; when The detail screen renders.; then The screen shows the request fields, badges, date-only creation date, description, and Back link.
  - AC-18.2 [ui] Given A request without a description is opened from the list.; when The detail screen renders.; then The screen shows “No description.” and a Back link.
  - AC-18.3 [ui] Given A status filter was selected before a request was opened.; when The user follows the detail screen's Back link.; then The screen shows the Requests list with the previously selected filter still selected.
- **REQ-19** (ADDED) The Hive Works Request detail screen shall show Start work for Open requests, Mark done for In progress requests, and Reopen for Done requests, and update the status badge and action button only after a successful status-change response.
  - AC-19.1 [ui] Given A request is displayed with each of the statuses Open, In progress, or Done.; when The detail screen renders and the user selects its status action, with the API confirming the change.; then The screen shows Start work, Mark done, or Reopen respectively, and after a successful response the status badge and action button show the new status and next action.
- **REQ-20** (ADDED) If a status update fails, then the Hive Works app shall show “Could not update the request.” and keep the previously displayed status and action unchanged.
  - AC-20.1 [ui] Given The detail screen shows a request with a known status.; when The API returns a failure for the status update.; then The screen shows “Could not update the request.” and the status badge and action button retain their previous values.
- **REQ-21** (ADDED) The Hive Works app shall show “Request not found.” with a link back to the Requests screen for an unknown ID, and show a generic loading error with Retry but not “Request not found.” when loading a known ID fails for another reason.
  - AC-21.1 [ui] Given The detail screen is opened with an unknown ID.; when The ID lookup completes.; then The screen shows “Request not found.” and a link back to the Requests screen.
  - AC-21.2 [ui] Given The detail screen is opened with a known ID and loading fails for a non-not-found reason.; when The load failure is returned.; then The screen shows a generic loading error and a Retry action, not “Request not found.”.
  - AC-21.3 [ui] Given The detail screen shows a generic loading error.; when The user selects Retry.; then The screen sends another request to load the detail address.
- **REQ-22** (ADDED) The Hive Works app shall use one light theme with a neutral background, near-black text, one primary-button brand color, one sans-serif font, Open blue badges, In progress amber badges, Done green badges, Urgent red badges, and neutral Low and Normal badges, with text on every badge.
  - AC-22.1 [ui] Given The Requests and request detail screens are rendered with all badge types and primary buttons.; when Their theme and badges are inspected.; then The screen shows the light theme, neutral background, near-black text, sans-serif font, one primary-button brand color, and the specified status and priority badge colors, with each badge showing its status or priority value.
- **REQ-23** (ADDED) The Hive Works app shall present labeled fields and keyboard-reachable controls on both screens and provide stacked request cards at 375 px and a request table at 1280 px viewport widths without horizontal page scrolling.
  - AC-23.1 [ui] Given The Requests, creation dialog, and detail screens are rendered at 375 px and 1280 px viewport widths.; when The screens and controls are inspected and navigated by keyboard.; then The screen shows stacked request cards at 375 px, a request table at 1280 px, no horizontal page scroll, labels for every field, and keyboard-reachable controls.
- **REQ-24** (ADDED) The Hive Works project shall include automated tests for request creation and validation, all allowed and disallowed status transitions, filtered newest-first listing, and unknown-ID handling.
  - AC-24.1 [job] Given The automated business-rule test suite is available.; when The suite is run against the application API.; then The test report lists passing cases for a valid request starting Open, missing or too-short title, missing area, too-long description, each allowed status transition, a disallowed transition, a status-filtered newest-first list, and an unknown ID.
- **REQ-25** (ADDED) The Hive Works project shall include an end-to-end test for the create, detail, status-change, and filter workflow.
  - AC-25.1 [ui] Given The app is available to the end-to-end test.; when The test opens the list, creates a request, opens it, selects Start work and Mark done, then filters by Done.; then The test report shows the workflow passed and the screen shows the created request in the Done list.

Not changing: Sign-in screen, roles, role management, and additional users.; Request editing capability; the API only changes status after creation.; Request deletion capability; no deletion API operation is exposed.; Search, alternative or user-selectable sorting, and paging or pagination.; Comments, attachments, assignees, or due dates.; Notifications, email, or live updates.; Dark mode, animation, or non-English localization/additional languages.; Additional record types or additional API operations.; Support commitments for specific browser versions beyond a modern browser.

## Files the plan will touch (6)
- app/globals.css  ← not found by grounding; check it
- app/layout.tsx  ← not found by grounding; check it
- components/screens/s-1/container.tsx  ← not found by grounding; check it
- components/screens/s-2/container.tsx  ← not found by grounding; check it
- lib/api/**  ← not found by grounding; check it
- package.json  ← not found by grounding; check it  ← protected file

New packages: openapi-typescript-codegen 0.29.0

UI size: **screen tweak** (app/globals.css: stylesheet planned to change (becomes a design-system change if it edits theme tokens; the size-cap check after the build will tell); app/layout.tsx added). Design work: a short screen note (regions, components, states); no mock; checks: lint, accessibility, before/after screenshot.

## Plan
Options: single-generated-client (chosen): Generate the full contract SDK into lib/api in the Requests slice; both screen containers consume that SDK. | per-screen-generated-clients: Generate list/create operations in TASK-2 and detail/status operations in TASK-3 into separate generated SDK outputs.
Decision: Generate one SDK from the shared OpenAPI contract in the first screen slice; use it from both containers.
Build the Requests slice first so the app entry and its list/create behavior work before detail behavior is added.
The API server owns persistence, seeding, and API business rules; this repository owns the web client and shared contract stub.
Do not add sign-in or other capabilities beyond the approved scope.
- TASK-1 Design system and scaffold build → Design-system prerequisite for REQ-22; its screen-level acceptance is completed only after TASK-3.; builds towards a later task (no criteria of its own)
- TASK-2 Requests screen: live list and create flow → REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-8, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17; must pass AC-2.1, AC-3.1, AC-3.2, AC-4.1, AC-4.2, AC-4.3, AC-5.1, AC-6.1, AC-6.2, AC-6.3, AC-8.1, AC-11.1, AC-11.2, AC-12.1, AC-13.1, AC-14.1, AC-14.2, AC-15.1, AC-16.1, AC-16.2, AC-17.1, AC-17.2
- TASK-3 Request detail screen: lookup and status transitions → REQ-1, REQ-7, REQ-9, REQ-10, REQ-18, REQ-19, REQ-20, REQ-21, REQ-22, REQ-23, REQ-24, REQ-25; must pass AC-1.1, AC-1.2, AC-7.1, AC-7.2, AC-9.1, AC-10.1, AC-10.2, AC-10.3, AC-10.4, AC-18.1, AC-18.2, AC-18.3, AC-19.1, AC-20.1, AC-21.1, AC-21.2, AC-21.3, AC-22.1, AC-23.1, AC-24.1, AC-25.1

Stub commit (throws NotImplemented until implemented): lib/api/index.ts

## API contract (contracts/openapi.yaml; locked with the tests once you approve)
- GET /requests -> 200, 400, 500
- POST /requests -> 201, 400, 500
- GET /requests/{id} -> 200, 404, 500
- PATCH /requests/{id}/status -> 200, 400, 404, 409, 500

## Critic findings (16)
- [medium] REQ-3 The spec never says what happens to a description that is only whitespace: after trimming it is an empty string, but REQ-2 includes a description "only if one was supplied" and REQ-18 shows “No description.” only "when absent", so it is unclear whether "" is stored or shown.
- [medium] REQ-2 Several ACs check the "persisted row" or "database row" (AC-2.1, AC-5.1, AC-6.1–6.3, AC-7.2, AC-10.1–10.4) instead of a public API or UI surface, so they can only be checked by inspecting the database directly.
- [medium] REQ-7 AC-7.2 says only that an attempt to change title, area, priority or description is "rejected", without saying whether a change-status call that also carries those fields is rejected or ignored, or what response is returned.
- [medium] REQ-8 The list operation accepts an "optional single status" filter, but no AC covers an unsupported or malformed filter value (an error response, or ignore and return all).
- [medium] REQ-19 Status actions have no pending or disabled state, unlike Create in REQ-16, so a double-click on Start work can send two transitions where the second fails and shows “Could not update the request.” after a successful change.
- [medium] REQ-20 If the stored status was changed elsewhere (a stale detail screen), the transition is rejected and REQ-20 keeps showing the stale status and action with no refresh, so the user can never move forward without reloading.
- [high] REQ-7 ASM-2 accepts a cloud-hosted deployment and the intent is tagged auth/pii, but no requirement covers who may call the unauthenticated create and change-status API once it is publicly reachable, so there is no permission path at all.
- [medium]  ASM-2 (one cloud region in the client's account) does not appear in the spec's assumptions or any requirement, and both assumptions cite the wrong questions (ASM-1 cites Q-6, which is about seeding, and ASM-2 cites Q-7, which is about filters), so their traceability is broken.
- [medium] REQ-24 The EARS requires tests for "all allowed and disallowed status transitions", while AC-24.1 requires only "a disallowed transition", so the AC can pass while most disallowed transitions are untested.
- [low] REQ-15 AC-15.1 requires the new request "at the top of the list", but REQ-8/Q-3 make the order of equal timestamps unspecified, so the new request may legitimately not be first.
- [low] REQ-6 The EARS says "four Open requests with one Urgent request", while AC-6.1 says "including an Urgent Open row", which leaves open whether there must be exactly one Urgent seed row or at least one.
- [low] REQ-6 Seeding only when the database is empty has no guard against two instances initializing the same empty database at once, which would leave more than eight seed rows and break the "exactly 8" rule.
- [low] REQ-1 AC-1.2's "the screen list contains no third screen" points to no public surface that can be observed, and AC-1.1 combines rendering the list with opening a request in a single When.
- [low] REQ-21 No AC says whether a malformed (non-existent-format) ID in the detail address is treated as “Request not found.” or as a generic loading error.
- [low] REQ-4 Validation covers length and allowed values but not wrong-type or malformed request bodies (for example a non-string title or invalid JSON), so the error response for these cases is undefined.
- [low] REQ-1 The demo user identity (Sam Carter, initials SC) is hardcoded in REQ-1 and REQ-11 rather than stored as a single configured user value from which the initials are derived.

## Still open after 0 repairs
- [critic high] REQ-7 ASM-2 accepts a cloud-hosted deployment and the intent is tagged auth/pii, but no requirement covers who may call the unauthenticated create and change-status API once it is publicly reachable, so there is no permission path at all.

## Settled by questions, and open risks
- Spec question Q-9: How should the 25-requirement scope be handled for this run? → Approve all 25 requirements as one run. (answered)
- Spec question Q-10: Should the 1280 px wide-layout viewport be a fixed requirement or configurable? → Keep 1280 px as a fixed required viewport width. (answered)
- Open risk: ASM-2 accepts a cloud-hosted deployment and the intent is tagged auth/pii, but no requirement covers who may call the unauthenticated create and change-status API once it is publicly reachable, so there is no permission path at all.

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

**This spec has 25 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.**

## Decide
  factory approve 20261009-co-working-space-maintenance-0f9d <hash> --note "your risk note"
  factory reject  20261009-co-working-space-maintenance-0f9d <hash> --reason "why"

Card hash: 1989fc9e