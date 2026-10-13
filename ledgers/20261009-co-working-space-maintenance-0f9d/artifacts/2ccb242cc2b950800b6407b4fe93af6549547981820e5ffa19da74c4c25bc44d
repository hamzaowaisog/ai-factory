# Waive build gate? (review)

Run 20261009-co-working-space-maintenance-0f9d these gates fail:

- review.tests-prove-criteria: AC-1.1: its locked test tests/screen-list.test.tsx::Requests screen > AC_1_1_DemoUserSeesBrandAndOnlyTheTwoScreens passes but does not prove the criterion (It checks branding and rejects unexpected navigation labels, but after opening a row it only checks the navigation path rather than that the detail screen is shown.)
- review.tests-prove-criteria: AC-8.1: its locked test tests/api-status.test.ts::list and get > AC_8_1_ListIsFilterableAndNewestFirst passes but does not prove the criterion (It checks ordering and filters against the unfiltered result, but membership checks only the three newly created rows, so omissions from both result sets could pass.)
- review.tests-prove-criteria: AC-10.2: its locked test tests/api-status.test.ts::change status > AC_10_2_DisallowedTransitionIsRejectedAndStatusKept passes but does not prove the criterion (It verifies several rejected transitions, but omits the valid-enum no-op transitions In progress to In progress and Done to Done despite requiring every other transition to be rejected.)
- review.tests-prove-criteria: AC-11.2: its locked test tests/screen-list.test.tsx::Requests screen > AC_11_2_SelectingAFilterShowsOnlyMatchingRequests passes but does not prove the criterion (It selects each filter and checks representative visible and hidden requests, but does not assert the complete matching set for each status.)
- review.tests-prove-criteria: AC-14.1: its locked test tests/screen-create.test.tsx::creation dialog > AC_14_1_ShortTitleShowsTheTitleMessageAndKeepsTheDialogOpen passes but does not prove the criterion (It checks the message and that the dialog remains open, but does not assert the message is beneath or associated with the Title field.)

A waiver is recorded with your name and reason. It covers these gates for this commit only; a different one needs a new decision.
To accept it as it stands:
  factory waive 20261009-co-working-space-maintenance-0f9d 643881ee --reason "why this is fine"
The tests are locked, so another attempt cannot change them. The run's Tests tab shows each criterion, its test and the reviewer's reason. To stop instead: factory stop 20261009-co-working-space-maintenance-0f9d

Card hash: 643881ee