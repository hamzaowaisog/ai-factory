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

export function authorIntro(stack: Stack): string {
  if (stack === "node") {
    return `You write black-box acceptance tests for a TypeScript web app (React, with the factory's component kit), one test per acceptance criterion, before the feature exists.
Rules:
- Put the tests in tests/ at the repo root, as *.test.ts files, with vitest (import { describe, it, expect } from "vitest"). The "@/" import alias points at the app's source root.
- Test through public surfaces only: exported functions and modules, route handlers, the data and action logic a screen uses. There is no browser: don't render components (the design's own Playwright tests check the pages).
- Name each acceptance test exactly AC_<req>_<n>_<Words> (the it() title) for acceptance criterion AC-<req>.<n>, e.g. it("AC_1_2_ReturnsNotFoundWhenOrderMissing", ...). Name characterisation tests CHAR_<Words>. The factory finds tests by these titles.
- New APIs exist as stubs that throw new Error("not implemented"); tests must import them and fail for now.
- Also write characterisation tests for existing behaviour next to the change that must NOT change; those must pass today. A new app has little of its own: write none when there is nothing to keep.
- Don't change production code, package.json, tsconfig or the vitest config.
- You may run "npx tsc --noEmit" to check the tests compile. Don't run the tests: the factory runs them itself in its test lab.
- Test each criterion at its level: "unit" and "ui" criteria call the module directly; "api" criteria call the route handler (for example GET or POST exported from app/api/.../route.ts, with a Request). Skip "manual" criteria: a person checks those.`;
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
  return stack === "node" ? "Is it an it()/test() with exactly that title, in a *.test.ts file under tests/?" : "Is it public, in a test project, and marked [Fact]/[Theory]?";
}

export function implementIntro(stack: Stack): string {
  if (stack === "node") {
    return `You implement one task of an approved plan in a TypeScript web app (React, with the factory's component kit).
- Change only files in the task's file scope. Edits elsewhere are blocked.
- Tests are locked: don't edit or delete them, don't skip them (.skip, .only), don't add @ts-ignore, @ts-expect-error or eslint-disable.
- No new packages unless the plan lists them. No git (the factory commits).
- Follow the exemplar files' style. Keep the change small.
- The packages are installed. You may run "npx tsc --noEmit" and "npx vitest run". The factory runs the full checks after you finish.`;
  }
  return `You implement one task of an approved plan in an existing .NET codebase.
- Change only files in the task's file scope. Edits elsewhere are blocked.
- Tests are locked: don't edit or delete them, don't skip them, don't add #pragma or suppressions.
- No new packages unless the plan lists them. No git (the factory commits).
- Follow the exemplar files' style. Keep the change small.
- You may run "dotnet build" and unit tests that need no database. The factory runs the full checks after you finish.`;
}
