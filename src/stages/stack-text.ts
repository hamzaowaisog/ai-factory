// What the planner and the coding agents are told about the stack they work in. The .NET words are the ones the steps always
// used; Node is a TypeScript app built with the factory's kit (a new product, greenfield follow-up to the PR #11 review).
import type { ProjectConfig } from "../config/project.js";
import { outsideSystemsImplementRule, outsideSystemsTestRule } from "./outside-systems.js";

type Stack = ProjectConfig["stack"];

export function planIntro(stack: Stack): string {
  return stack === "node"
    ? "You plan the implementation of an approved spec in a TypeScript web app (React, with the factory's component kit; a new product starts from the scaffold of its approved design)."
    : "You plan the implementation of an approved spec in an existing .NET codebase.";
}

export function stubRule(stack: Stack): string {
  return stack === "node"
    ? `throw new Error("not implemented")`
    : "throw NotImplementedException";
}

export function dependencyKind(stack: Stack): string {
  return stack === "node" ? "npm" : "NuGet";
}

/** The projects that test screens: a web app with screen tests turned on (the project's `screenTests`). A "ui" criterion stays one there, and is a person's check elsewhere. */
export const testsScreens = (project: { stack: Stack; screenTests?: boolean; contract?: unknown }): boolean => project.stack === "node" && (project.screenTests ?? !!project.contract);

const SCREEN_TEST_RULES = `- A "ui" criterion gets a screen test: a tests/*.test.tsx file whose FIRST line is "// @vitest-environment jsdom". Render the screen's container (components/screens/<s-id>/container.tsx, the page with its data and behaviour) with render() from "@testing-library/react", and act as a person does with userEvent from "@testing-library/user-event".
- Assert what a person sees and can do: find things by role and name (screen.getByRole("button", { name: "Save" })), by label (getByLabelText) or by the words on the page, never by class name, test id or component internals. Use findBy... for what appears after data loads.
- A page that loads data shows its loading state first: await a findBy... for the loaded content before the first click, typed value or getBy... on it (run 4049: tests clicked buttons that were not there yet).
- A page for a signed-in person reads the session first and leaves when there is none: mock the app's session module (vi.mock) so it returns a signed-in person, as the API's sign-in gives them, in every test of such a page; a page that only shows its header has sent the test away.
- Text split over several elements is found with a function matcher; match only the innermost element whose text fits (no child of it fits too), or every parent matches as well and the query finds many.
- A record the page shows as today's, this week's or upcoming gets its date from TEST_NOW in the test, never the date a generated mock or fixture carries.
- The expect matchers of @testing-library/jest-dom (toBeVisible, toBeInTheDocument, toHaveValue...) are set up; import waitFor, within and screen from "@testing-library/react".
- There is no router, no server and no network in a screen test. Navigation is recorded: import { nav, at } from "./support/screen" (from tests/), call at("/orders/7", { tab: "paid" }) before render() to set the address, and assert where the page went with nav.went (e.g. expect(nav.went).toContain("/orders/7")).
- Stand in for the API with vi.stubGlobal("fetch", ...) or by mocking the generated client module (vi.mock), and answer with data in the shape the contract gives. Give each test its own answers; undo them in afterEach (vi.unstubAllGlobals(), vi.restoreAllMocks()).
- A screen test proves behaviour on the screen: what is shown for which data, what a click or a typed value does, which message appears. It cannot judge looks (colour, spacing, a width): don't assert styles or class names.
- Don't edit tests/support/ or the vitest config; the factory owns them. Don't use snapshots.`;

/**
 * The web side of a full-stack product has no route handlers: the API is the other repo, with a run and locked tests of its own.
 * On run 0f9d the writer tested the server's rules here (19 locked tests on creating, seeding and status order), which only a
 * backend written inside the web repo could pass.
 */
const API_SIDE_TESTS = `this web app has no API of its own: the API is a separate service with locked tests of its own, and here it is reached only through the generated client. An "api" or "job" criterion is tested as what this app does with the API's answer: answer the call with the contract's test handlers or a mocked client, then assert what the screen or the web code does. Never test a rule only the server can keep (what is stored, what survives a restart, seeded records, the order a status may change in, what bad data is answered with) by calling the generated client and expecting the rule to hold: nothing in this repo may implement it. Never test the generated client itself.`;

/** `screens`: the checkout can run screen tests (src/design/kit/screen-tests.ts); without them a ui criterion is tested on the screen's logic. */
export function authorIntro(stack: Stack, screens = false, apiSide = false): string {
  if (stack === "node") {
    return `You write black-box acceptance tests for a TypeScript web app (React, with the factory's component kit), one test per acceptance criterion, before the feature exists.
Rules:
- Put the tests in tests/ at the repo root, as *.test.ts files${screens ? " (*.test.tsx for a screen test)" : ""}, with vitest (import { describe, it, expect } from "vitest"). The "@/" import alias points at the app's source root.
- Test through public surfaces only: exported functions and modules, route handlers, ${screens ? "and a screen as a person uses it" : "the data and action logic a screen uses. There is no browser: don't render components (the design's own Playwright tests check the pages)"}.
- Name each acceptance test exactly AC_<req>_<n>_<Words> (the it() title) for acceptance criterion AC-<req>.<n>, e.g. it("AC_1_2_ReturnsNotFoundWhenOrderMissing", ...). Name characterisation tests CHAR_<Words>. The factory finds tests by these titles.
- New APIs exist as stubs that throw new Error("not implemented"); tests must import them and fail for now.
- Also write characterisation tests for existing behaviour next to the change that must NOT change; those must pass today. A new app has little of its own: write none when there is nothing to keep.
- Don't change production code, package.json, tsconfig or the vitest config.
- Every test runs at a fixed instant in UTC, TEST_NOW (exported by tests/support/screen.ts): work out expected dates, ages and durations from TEST_NOW, never from the real clock, and never hard-code a value that only holds on one day.
- You may run "npx tsc --noEmit" to check the tests compile. When every test is written, run your own new test files once (npx vitest run <your files>) and read how each test fails: on an assertion or "not implemented", never on a crash in the set-up or while rendering. Fix a test that crashes, or that passes, before you return. Run nothing else, and at most twice: the factory runs and judges every test itself in its test lab.
- Test each criterion at its level: ${screens ? `"unit" criteria` : `"unit" and "ui" criteria`} call the module directly; ${apiSide ? API_SIDE_TESTS : `"api" criteria call the route handler (for example GET or POST exported from app/api/.../route.ts, with a Request).`} Skip "manual" criteria: a person checks those.
${outsideSystemsTestRule(stack)}${screens ? `\n${SCREEN_TEST_RULES}` : ""}`;
  }
  return `You write black-box acceptance tests for a .NET service, one test per acceptance criterion, before the feature exists.
Rules:
- Put tests in the existing test project that best fits (look for *Tests.csproj). Follow the style of existing tests there (xUnit, WebApplicationFactory if used).
- Test through public surfaces only: HTTP endpoints, public service methods, database rows. Don't test private code.
- Every test that starts the app or touches the database gets a database of its own: if the test project has AppFactory (App.Tests/AppFactory.cs), use it as the class fixture (IClassFixture<AppFactory>) and restart with factory.Restarted(). Never assume a table is empty unless your own class's database is the only one it could have been written to, and never depend on what another test left behind.
- Don't compare against the current time exactly: assert on the values your test sent, or allow a margin. When a criterion depends on today's date or the current time, fix the clock: register a TimeProvider of your own (a fixed instant) in the test host. The app reads the time only from TimeProvider.
- Name each acceptance test method exactly AC_<req>_<n>_<Words> for acceptance criterion AC-<req>.<n>, e.g. AC_1_2_Returns404WhenOrderMissing. Name characterisation test methods CHAR_<Words>. The factory finds tests by these names.
- New APIs exist as stubs that throw NotImplementedException; tests must compile against them and fail for now.
- Also write characterisation tests for existing behaviour next to the change that must NOT change; those must pass today.
- Don't change production code. Don't change test project files unless a package reference is missing and already restored.
- You may run "dotnet build <the test project's .csproj>" to check the tests compile. Run it plainly: never with --no-restore (nothing is restored in this checkout yet, so that build fails on every file) and never with --no-build. The packages are already on this machine, so the restore needs no network. If the errors are in files outside the test project (a stub that does not compile), do not try to work around them: say so in "notes" and return. There's no database in this container; don't try to make tests pass. Don't run "dotnet test": the factory runs the tests itself in its test lab.
- Test each criterion at its level: "unit" criteria call the class's public method directly (no web host, no database, no job run); "api" criteria call the endpoint. Skip "manual" criteria: a person checks those.
${ROUTE_RULE}
${outsideSystemsTestRule(stack)}`;
}

/**
 * One rule for the writers and the implementer on where a contract's routes live (run 7850: the contract's server URL ended in /v1,
 * the tests called /deliveries and the implementer mapped /v1/deliveries, then added hidden aliases without the prefix).
 */
export const ROUTE_RULE = `- Routes are the contract's paths exactly as written (/deliveries, /deliveries/{id}): the base path in the contract's server URL (such as /v1) is not part of any route. Don't add it, and don't map a route twice under two prefixes.`;

/** Why a named test may not have run. */
export function notFoundHint(stack: Stack): string {
  return stack === "node" ? "Is it an it()/test() with exactly that title, in a *.test.ts or *.test.tsx file under tests/?" : "Is it public, in a test project, and marked [Fact]/[Theory]?";
}

/** `database`: the session has a PostgreSQL of its own, and these are the settings that point the app at it. */
export function implementIntro(stack: Stack, database?: { settings: string[] }): string {
  if (stack === "node") {
    return `You implement one task of an approved plan in a TypeScript web app (React, with the factory's component kit).
- Change only files in the task's file scope. Edits elsewhere are blocked.
- Tests are locked: don't edit or delete them, don't skip them (.skip, .only), don't add @ts-ignore, @ts-expect-error or eslint-disable.
- No new packages unless the plan lists them. No git (the factory commits).
- Follow the exemplar files' style. Keep the change small.
${outsideSystemsImplementRule(stack)}
- The packages are installed. You may run "npx tsc --noEmit" and "npx vitest run". The factory runs the full checks after you finish.
- This session has no memory beyond its context window, and everything a command prints or a file read returns stays in it. Print only what you need (pipe long output through tail or grep), read part of a large file instead of all of it, and change a file with Edit instead of writing it again.`;
  }
  return `You implement one task of an approved plan in an existing .NET codebase.
- Change only files in the task's file scope. Edits elsewhere are blocked.
- Tests are locked: don't edit or delete them, don't skip them, don't add #pragma or suppressions.
- No new packages unless the plan lists them. No git (the factory commits).
- Follow the exemplar files' style. Keep the change small.
${ROUTE_RULE}
- Read the current date and time only from an injected TimeProvider (register TimeProvider.System once in Program.cs if it isn't there), never DateTime.UtcNow, DateTime.Now, DateTimeOffset.UtcNow or DateTime.Today: the tests replace TimeProvider with a fixed clock, and code that reads the real clock fails them (run 7850).
${outsideSystemsImplementRule(stack)}
- ${database
    ? `You may run "dotnet build" and "dotnet test". This session has a PostgreSQL server of its own on 127.0.0.1, empty when the session starts, and ${database.settings.join(", ")} already point${database.settings.length === 1 ? "s" : ""} the app at it. Rows stay between your test runs, and the factory's test lab starts from an empty database: if a test fails only on rows an earlier run left, run it again with another database name in that setting (the login may create databases). The factory runs the full checks after you finish.`
    : `You may run "dotnet build" and unit tests that need no database. The factory runs the full checks after you finish.`}
${database ? `- PostgreSQL keeps a time to the microsecond, and a .NET time is finer than that. Cut a time to the microsecond before you save it, so the value the API returns on create is the value it returns when the row is read again.
- A C# enum stored as a PostgreSQL enum type is mapped once, in the DbContext's OnConfiguring (optionsBuilder.UseNpgsql(o => o.MapEnum<T>("type_name"))), with no HasConversion on its property: tests build the DbContext themselves, and a mapping only in Program.cs leaves theirs writing text into an enum column (run 9071: a 500 on every save).\n` : ""}- This session has no memory beyond its context window, and everything a command prints or a file read returns stays in it. Print only what you need (pipe long output through tail or grep), read part of a large file instead of all of it, and change a file with Edit instead of writing it again.`;
}

/**
 * What makes a locked test fail for a reason other than the code under test, said once for the test writer and the check that
 * reads its tests. Runs ae5c and 768d each parked on one of these; any requirement can hit them.
 */
export const SELF_CONTAINED_RULES = `A TEST MUST PASS OR FAIL ON THE CODE ALONE, on every run and every machine:
- Time: no value that depends on today's date or the current time (use the fixed test instant, or values the test itself set).
- Stored data: no reliance on rows, files or state another test or an earlier run left behind; create what you assert on.
- Order: assert an order only where the criterion names one; otherwise compare as sets.
- Numbers: compare computed decimals (ratios, averages, money after division) with a tolerance or at the precision shown.
- Randomness: no assertion on a generated id, code or random value; assert that it exists, or use the value the response returned.
- Actions: after a click, save or delete, wait for its result (findBy, waitFor or the awaited response) before asserting on it.
- Lookups: find a value inside its row, card or region, never page-wide when the same text can appear twice.
- Data: when a criterion says each, all, every, a list or an order, give it at least three rows of your own that differ.
- Consistency: every expected value follows from the test's own steps. After the test changes a value (an update, a move, a delete), assert the changed value, not the one it set up first.`;
