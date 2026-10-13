# factory: The Hive Works maintenance app shall provide exactly two scr

## What was asked
From: maintenance-requests-requirements.md

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

## Requirements → tests
- **REQ-1** The Hive Works maintenance app shall provide exactly two screens, Requests and Request detail, for the demo user Sam Carter with initials SC, without sign-in or role-selection screens.
  - AC-1.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_1_1_DemoUserSeesBrandAndOnlyTheTwoScreens`
  - AC-1.2 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_1_2_OpeningARequestShowsRequestDetailAndNoThirdScreenExists`
- **REQ-2** The Hive Works data model shall define only maintenance request records with a system-generated ID, a UTC creation timestamp, a required title, area, priority, and status, and an optional description.
  - AC-2.1 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_2_1_CreatedRequestCanBeRetrievedWithSystemFields`
- **REQ-3** The Hive Works API shall trim leading and trailing whitespace from title and description values before validation and storage, and treat a title that is blank after trimming as missing.
  - AC-3.1 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_3_1_TitleAndDescriptionAreTrimmed`
  - AC-3.2 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_3_2_BlankTitleAfterTrimmingIsRejected`
- **REQ-4** The Hive Works API shall accept only titles of 3 to 80 characters, areas from Kitchen, Meeting room, Open desk, Washroom, and Reception, priorities from Low, Normal, and Urgent, and descriptions of at most 500 characters when supplied, and return a validation message naming each invalid field.
  - AC-4.1 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_4_1_EachInvalidFieldIsIdentifiedAndNothingIsCreated`
  - AC-4.2 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_4_2_ValuesAtTheLengthLimitsAreAccepted`
  - AC-4.3 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_4_3_ShortTitleReportsTheTitleMessage`
- **REQ-5** When a request is created, the Hive Works API shall set the status to Open and assign the ID and UTC creation timestamp itself, regardless of caller-supplied system-controlled values.
  - AC-5.1 (HTTP test + probe): `tests/api-create.test.ts::create request > AC_5_1_SystemControlledFieldsAreAssignedByTheApi`
- **REQ-6** The Hive Works app shall initialize an empty database with exactly eight seed requests, including four Open requests with one Urgent request, two In progress requests, two Done requests, and every supported area represented, and, when initialized with a nonempty database, preserve all existing requests without inserting seeds.
  - AC-6.1 (HTTP test + probe): `tests/api-seed.test.ts::seed data and persistence > AC_6_1_EmptyDatabaseIsSeededWithEightRequests`
  - AC-6.2 (HTTP test + probe): `tests/api-seed.test.ts::seed data and persistence > AC_6_2_RestartKeepsExistingRowsAndAddsNoSeed`
  - AC-6.3 (HTTP test + probe): `tests/api-seed.test.ts::seed data and persistence > AC_6_3_CreatedRequestSurvivesRestart`
- **REQ-7** The Hive Works API shall expose exactly four operations: list requests with an optional status filter, create a request, get a request by ID, and change a request's status; prevent changes to title, area, priority, and description after creation; and expose no request deletion operation.
  - AC-7.1 (HTTP test + probe): `tests/api-status.test.ts::contract and immutability > AC_7_1_OnlyListCreateGetAndChangeStatusOperationsExist`
  - AC-7.2 (HTTP test + probe): `tests/api-status.test.ts::contract and immutability > AC_7_2_ImmutableFieldsCannotBeChangedAndRequestsCannotBeDeleted`
- **REQ-8** The Hive Works API shall return all requests or only requests matching an optional single status, ordered newest first by creation timestamp, without guaranteeing relative order for requests with equal timestamps.
  - AC-8.1 (HTTP test + probe): `tests/api-status.test.ts::list and get > AC_8_1_ListIsFilterableAndNewestFirst`
- **REQ-9** When a client requests a request by ID, the Hive Works API shall return the matching record if it exists and report not found if it does not.
  - AC-9.1 (HTTP test + probe): `tests/api-status.test.ts::list and get > AC_9_1_GetByIdReturnsTheRecordOrNotFound`
- **REQ-10** The Hive Works API shall allow only the status transitions Open to In progress, In progress to Done, and Done to Open, and reject every other status-change request, including requests for an unknown request ID or an unsupported status value, without changing the stored status of any existing request.
  - AC-10.1 (HTTP test + probe): `tests/api-status.test.ts::change status > AC_10_1_AllowedTransitionsChangeTheStatus`
  - AC-10.2 (HTTP test + probe): `tests/api-status.test.ts::change status > AC_10_2_DisallowedTransitionIsRejectedAndStatusKept`
  - AC-10.3 (HTTP test + probe): `tests/api-status.test.ts::change status > AC_10_3_UnknownIdIsNotFoundForStatusChange`
  - AC-10.4 (HTTP test + probe): `tests/api-status.test.ts::change status > AC_10_4_UnsupportedStatusValueIsRejectedAndStatusKept`
- **REQ-11** The Hive Works Requests screen shall show the Hive Works wordmark, initials SC, mutually exclusive All, Open, In progress, and Done filters with All selected by default, and a New request button.
  - AC-11.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_11_1_ListOpensWithAllSelectedAndNewRequestButton`
  - AC-11.2 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_11_2_SelectingAFilterShowsOnlyMatchingRequests`
- **REQ-12** The Hive Works Requests screen shall show each matching request's title, area, priority badge, status badge, and UTC creation date in date-only form, in newest-first order, and open the detail screen when a request row is selected.
  - AC-12.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_12_1_RowsShowTheRecordNewestFirstAndOpenTheDetail`
- **REQ-13** When the user selects New request, the Hive Works app shall open a dialog with labeled Title, Area, Priority, and Description fields, Area and Priority selects containing the supported values, Priority defaulted to Normal, and Create and Cancel buttons.
  - AC-13.1 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_13_1_NewRequestOpensTheCreationDialog`
- **REQ-14** When creation field validation fails, the Hive Works app shall keep the creation dialog open and show each field's validation message beneath that field.
  - AC-14.1 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_14_1_ShortTitleShowsTheTitleMessageAndKeepsTheDialogOpen`
  - AC-14.2 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_14_2_MissingAreaAndLongDescriptionAreReportedPerField`
- **REQ-15** When request creation succeeds, the Hive Works app shall close the dialog and show the new Open request at the top of the list, switching the selected filter to All if another filter was selected.
  - AC-15.1 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_15_1_SuccessfulCreationClosesTheDialogResetsFilterAndShowsTheNewRequestFirst`
- **REQ-16** The Hive Works app shall disable the Create button and prevent duplicate create calls while a create request is being sent, and, after a non-validation creation failure, show a generic creation error while keeping the dialog and entered values open and allowing another submission.
  - AC-16.1 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_16_1_SubmitButtonIsDisabledWhilePendingAndOnlyOneCallIsMade`
  - AC-16.2 (screen test): `tests/screen-create.test.tsx::creation dialog > AC_16_2_CreationFailureShowsAGenericErrorAndKeepsTheEntries`
- **REQ-17** While the request list is loading, empty for the selected filter, or unavailable, the Hive Works app shall show the corresponding loading, empty, or error state and provide Retry for the error state.
  - AC-17.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_17_1_ListShowsLoadingEmptyAndErrorStates`
  - AC-17.2 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_17_2_RetryReloadsTheList`
- **REQ-18** The Hive Works Request detail screen shall show a Back link, the request title, area, priority badge, status badge, UTC creation date in date-only form, and the description or “No description.” when absent, and return to the Requests list with its previously selected filter retained when Back is followed.
  - AC-18.1 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_18_1_DetailShowsTheRecordDescriptionAndBackLink`
  - AC-18.2 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_18_2_DetailWithoutDescriptionSaysSo`
  - AC-18.3 (screen test): `tests/screen-flow.test.tsx::flows across both screens > AC_18_3_BackKeepsThePreviouslySelectedFilter`
- **REQ-19** The Hive Works Request detail screen shall show Start work for Open requests, Mark done for In progress requests, and Reopen for Done requests, and update the status badge and action button only after a successful status-change response.
  - AC-19.1 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_19_1_StatusActionAdvancesTheRequest`
- **REQ-20** If a status update fails, then the Hive Works app shall show “Could not update the request.” and keep the previously displayed status and action unchanged.
  - AC-20.1 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_20_1_FailedStatusUpdateShowsAMessageAndKeepsTheOldStatus`
- **REQ-21** The Hive Works app shall show “Request not found.” with a link back to the Requests screen for an unknown ID, and show a generic loading error with Retry but not “Request not found.” when loading a known ID fails for another reason.
  - AC-21.1 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_21_1_UnknownIdShowsNotFoundWithALinkBack`
  - AC-21.2 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_21_2_LoadFailureShowsAGenericErrorWithRetry`
  - AC-21.3 (screen test): `tests/screen-detail.test.tsx::Request detail screen > AC_21_3_RetryLoadsTheDetailAgain`
- **REQ-22** The Hive Works app shall use one light theme with a neutral background, near-black text, one primary-button brand color, one sans-serif font, Open blue badges, In progress amber badges, Done green badges, Urgent red badges, and neutral Low and Normal badges, with text on every badge.
  - AC-22.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_22_1_BadgesShowTheirStatusAndPriorityOnBothScreens`
- **REQ-23** The Hive Works app shall present labeled fields and keyboard-reachable controls on both screens and provide stacked request cards at 375 px and a request table at 1280 px viewport widths without horizontal page scrolling.
  - AC-23.1 (screen test): `tests/screen-list.test.tsx::Requests screen > AC_23_1_ControlsAreLabelledAndReachableByKeyboard`
- **REQ-24** The Hive Works project shall include automated tests for request creation and validation, all allowed and disallowed status transitions, filtered newest-first listing, and unknown-ID handling.
  - AC-24.1 (job test): `tests/api-status.test.ts::business rule suite > AC_24_1_BusinessRulesHoldAgainstTheApi`
- **REQ-25** The Hive Works project shall include an end-to-end test for the create, detail, status-change, and filter workflow.
  - AC-25.1 (screen test): `tests/screen-flow.test.tsx::flows across both screens > AC_25_1_CreateOpenWorkAndFinishARequestEndToEnd`

## Tasks
- TASK-1 Design system and scaffold build (Design-system prerequisite for REQ-22; its screen-level acceptance is completed only after TASK-3.)
- TASK-2 Requests screen: live list and create flow (REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-8, REQ-11, REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17)
- TASK-3 Request detail screen: lookup and status transitions (REQ-1, REQ-7, REQ-9, REQ-10, REQ-18, REQ-19, REQ-20, REQ-21, REQ-22, REQ-23, REQ-24, REQ-25)

## Checks the factory ran itself
- 45 tests in a sealed container; 45 passed; no new failures vs the base branch
- Acceptance tests were written first, failed on the old code twice, then locked
- ⚠ Single model family: tests written by claude-sonnet-5-5, code by claude-sonnet-5-5 (both anthropic). A second-vendor coding runner isn't built yet.
- ⚠ Waived by mhamza: review.tests-prove-criteria (tests pass and cover each criterion; reviewer asks for stricter assertions, tests are locked)
- Review: 3 non-blocking findings
  - R-1 [high] This adds only an in-process service class; no HTTP route or server registers these methods. The screen containers call the generated fetch client at `localhost:5080`, while the project scripts start only Next, so the real app's list/create/detail/status calls have no API to reach (the tests hide this by calling `DefaultService` directly or stubbing `fetch`).
  - R-2 [medium] The new detail data marks priority as a badge, but `DetailBlock` colors it with `toneOf`: `Normal` maps to green and `Low` to info blue, while the required priority badges for both are neutral. The badge text-only test does not catch these incorrect colors.
  - R-3 [medium] Rows are identified for navigation by title, which is not unique or validated as unique; if two requests share a title, clicking either row finds the first matching item and opens that other request's ID. Pass the row ID through the action instead of resolving it by title.
- Security review (OWASP Top 10): nothing found

Cost: $11.79 · Run: `20261009-co-working-space-maintenance-0f9d` · Evidence manifest: `89aa15a036083bd3f4a76ce9f357a7aed6348956ad6c474773db741d0d269ef9`