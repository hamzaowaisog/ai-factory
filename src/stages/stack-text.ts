// What the planner and the coding agents are told about the stack they work in. The .NET words are the ones the steps always
// used; Node is a TypeScript app built with the factory's kit (a new product, greenfield follow-up to the PR #11 review).
import type { ProjectConfig } from "../config/project.js";

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

/** The stacks whose lab can run a test of a screen: a "ui" criterion stays one there, and is a person's check elsewhere. */
export const testsScreens = (stack: Stack): boolean => stack === "node";

const SCREEN_TEST_RULES = `- A "ui" criterion gets a screen test: a tests/*.test.tsx file whose FIRST line is "// @vitest-environment jsdom". Render the screen's container (components/screens/<s-id>/container.tsx, the page with its data and behaviour) with render() from "@testing-library/react", and act as a person does with userEvent from "@testing-library/user-event".
- Assert what a person sees and can do: find things by role and name (screen.getByRole("button", { name: "Save" })), by label (getByLabelText) or by the words on the page, never by class name, test id or component internals. Use findBy... for what appears after data loads.
- There is no router, no server and no network in a screen test. Navigation is recorded: import { nav, at } from "./support/screen" (from tests/), call at("/orders/7", { tab: "paid" }) before render() to set the address, and assert where the page went with nav.went (e.g. expect(nav.went).toContain("/orders/7")).
- Stand in for the API with vi.stubGlobal("fetch", ...) or by mocking the generated client module (vi.mock), and answer with data in the shape the contract gives. Give each test its own answers; undo them in afterEach (vi.unstubAllGlobals(), vi.restoreAllMocks()).
- A screen test proves behaviour on the screen: what is shown for which data, what a click or a typed value does, which message appears. It cannot judge looks (colour, spacing, a width): don't assert styles or class names.
- Don't edit tests/support/ or the vitest config; the factory owns them. Don't use snapshots.`;

/** `screens`: the checkout can run screen tests (src/design/kit/screen-tests.ts); without them a ui criterion is tested on the screen's logic. */
export function authorIntro(stack: Stack, screens = false): string {
  if (stack === "node") {
    return `You write black-box acceptance tests for a TypeScript web app (React, with the factory's component kit), one test per acceptance criterion, before the feature exists.
Rules:
- Put the tests in tests/ at the repo root, as *.test.ts files${screens ? " (*.test.tsx for a screen test)" : ""}, with vitest (import { describe, it, expect } from "vitest"). The "@/" import alias points at the app's source root.
- Test through public surfaces only: exported functions and modules, route handlers, ${screens ? "and a screen as a person uses it" : "the data and action logic a screen uses. There is no browser: don't render components (the design's own Playwright tests check the pages)"}.
- Name each acceptance test exactly AC_<req>_<n>_<Words> (the it() title) for acceptance criterion AC-<req>.<n>, e.g. it("AC_1_2_ReturnsNotFoundWhenOrderMissing", ...). Name characterisation tests CHAR_<Words>. The factory finds tests by these titles.
- New APIs exist as stubs that throw new Error("not implemented"); tests must import them and fail for now.
- Also write characterisation tests for existing behaviour next to the change that must NOT change; those must pass today. A new app has little of its own: write none when there is nothing to keep.
- Don't change production code, package.json, tsconfig or the vitest config.
- You may run "npx tsc --noEmit" to check the tests compile. Don't run the tests: the factory runs them itself in its test lab.
- Test each criterion at its level: ${screens ? `"unit" criteria` : `"unit" and "ui" criteria`} call the module directly; "api" criteria call the route handler (for example GET or POST exported from app/api/.../route.ts, with a Request). Skip "manual" criteria: a person checks those.${screens ? `\n${SCREEN_TEST_RULES}` : ""}`;
  }
  return `You write black-box acceptance tests for a .NET service, one test per acceptance criterion, before the feature exists.
Rules:
- Put tests in the existing test project that best fits (look for *Tests.csproj). Follow the style of existing tests there (xUnit, WebApplicationFactory if used).
- Test through public surfaces only: HTTP endpoints, public service methods, database rows. Don't test private code.
- Name each acceptance test method exactly AC_<req>_<n>_<Words> for acceptance criterion AC-<req>.<n>, e.g. AC_1_2_Returns404WhenOrderMissing. Name characterisation test methods CHAR_<Words>. The factory finds tests by these names.
- New APIs exist as stubs that throw NotImplementedException; tests must compile against them and fail for now.
- Also write characterisation tests for existing behaviour next to the change that must NOT change; those must pass today.
- Don't change production code. Don't change test project files unless a package reference is missing and already restored.
- You may run "dotnet build" to check the tests compile. There's no database in this container; don't try to make tests pass. Don't run "dotnet test": the factory runs the tests itself in its test lab.
- Test each criterion at its level: "unit" criteria call the class's public method directly (no web host, no database, no job run); "api" criteria call the endpoint. Skip "manual" criteria: a person checks those.`;
}

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
- The packages are installed. You may run "npx tsc --noEmit" and "npx vitest run". The factory runs the full checks after you finish.
- This session has no memory beyond its context window, and everything a command prints or a file read returns stays in it. Print only what you need (pipe long output through tail or grep), read part of a large file instead of all of it, and change a file with Edit instead of writing it again.`;
  }
  return `You implement one task of an approved plan in an existing .NET codebase.
- Change only files in the task's file scope. Edits elsewhere are blocked.
- Tests are locked: don't edit or delete them, don't skip them, don't add #pragma or suppressions.
- No new packages unless the plan lists them. No git (the factory commits).
- Follow the exemplar files' style. Keep the change small.
- ${database
    ? `You may run "dotnet build" and "dotnet test". This session has a PostgreSQL server of its own on 127.0.0.1, empty when the session starts, and ${database.settings.join(", ")} already point${database.settings.length === 1 ? "s" : ""} the app at it. Rows stay between your test runs, and the factory's test lab starts from an empty database: if a test fails only on rows an earlier run left, run it again with another database name in that setting (the login may create databases). The factory runs the full checks after you finish.`
    : `You may run "dotnet build" and unit tests that need no database. The factory runs the full checks after you finish.`}
${database ? `- PostgreSQL keeps a time to the microsecond, and DateTime.UtcNow is finer than that. Cut a time to the microsecond before you save it, so the value the API returns on create is the value it returns when the row is read again.\n` : ""}- This session has no memory beyond its context window, and everything a command prints or a file read returns stays in it. Print only what you need (pipe long output through tail or grep), read part of a large file instead of all of it, and change a file with Edit instead of writing it again.`;
}
