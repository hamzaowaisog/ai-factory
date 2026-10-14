// Screen tests: how a "ui" acceptance criterion gets a locked test. The test renders the page in vitest (jsdom, Testing
// Library), with no browser and no network, so it runs in the same lab container as every other test of a Node app. The
// scaffold gives an app the packages and two support files; the test writer is told the rules only when they are there.
// A real browser is not involved: how a page looks (colour, spacing, a width) is the design's own checks, or a person.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNED_MARK } from "./scaffold.js";

/** exact, like the kit's packages: every scaffold installs the same versions */
export const SCREEN_TEST_PACKAGES: Record<string, string> = {
  "@testing-library/dom": "10.4.2",
  "@testing-library/react": "16.3.3",
  "@testing-library/user-event": "14.6.7",
  jsdom: "28.1.0",
};

export const SCREEN_SUPPORT_DIR = "tests/support";
export const SCREEN_SETUP = `${SCREEN_SUPPORT_DIR}/setup.ts`;
export const SCREEN_HELPER = `${SCREEN_SUPPORT_DIR}/screen.ts`;

/**
 * The instant every test runs at (UTC, midday, so a run never crosses a day). A value worked out from "today" (an age, days
 * since, a due date) is the same on every run and machine; run ae5c parked on a test that read the real date.
 */
export const TEST_NOW = "2026-01-15T12:00:00.000Z";

/** What a screen test reads and sets about the address. */
export const screenHelperFile = (tag: string): string => `// ${OWNED_MARK} from ${tag}.
// Every test runs at TEST_NOW in UTC (set up in ./setup): work out expected dates and durations from it, never from the real clock.
// (the factory's environment check runs the tests once more at another instant, through FACTORY_TEST_NOW)
export const TEST_NOW = new Date(process.env.FACTORY_TEST_NOW ?? "${TEST_NOW}");

// What a screen test reads and sets about the address. In tests the app's navigation (lib/nav) is replaced by this:
// nothing really navigates, and every place the page went to is kept in nav.went.
export const nav = { path: "/", params: {} as Record<string, string>, went: [] as string[] };

/** Put the test at an address before rendering, e.g. at("/orders/7", { tab: "paid" }). */
export function at(path: string, params: Record<string, string> = {}): void {
  nav.path = path;
  nav.params = params;
}

export function resetNav(): void {
  nav.path = "/";
  nav.params = {};
  nav.went = [];
}
`;

/** Runs before every test file: the navigation stand-in, the browser parts jsdom lacks, and the clean-up after each test. */
/** The router's own package, for a page that reaches it directly and not through lib/nav: the same stand-in, so it renders and its navigation is recorded. */
const ROUTER_MOCK = {
  next: `vi.mock("next/navigation", async (original) => {
  const real = await original<typeof import("next/navigation")>();
  const { nav } = await import("./screen");
  const go = (to: string) => { nav.went.push(to); };
  return {
    ...real,
    useRouter: () => ({ push: go, replace: go, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} }),
    usePathname: () => nav.path,
    useSearchParams: () => new URLSearchParams(nav.params),
    useParams: () => nav.params,
  };
});

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  const { nav } = await import("./screen");
  return {
    default: ({ href, onClick, prefetch: _p, replace: _r, scroll: _s, ...props }: { href: unknown; onClick?: (e: unknown) => void } & Record<string, unknown>) =>
      createElement("a", { ...props, href: String(href), onClick: (e: { preventDefault(): void }) => { onClick?.(e); e.preventDefault(); nav.went.push(String(href)); } }),
  };
});`,
  vite: `vi.mock("react-router", async (original) => {
  const real = await original<typeof import("react-router")>();
  const { nav } = await import("./screen");
  const { Link } = await import("@/lib/nav");
  return {
    ...real,
    useNavigate: () => (to: unknown) => { nav.went.push(String(to)); },
    useLocation: () => ({ pathname: nav.path, search: "", hash: "", state: null, key: "test" }),
    useSearchParams: () => [new URLSearchParams(nav.params), () => {}],
    useParams: () => nav.params,
    Link, NavLink: Link,
  };
});`,
};

export const screenSetupFile = (tag: string, next = true): string => `// ${OWNED_MARK} from ${tag}.
// Runs before every test file. A screen test (a *.test.tsx file whose first line is "// @vitest-environment jsdom") renders
// a page with no router and no browser: navigation is recorded in ./screen, and the few browser parts jsdom lacks are
// filled in. A plain *.test.ts file is not affected.
import { afterEach, beforeEach, vi } from "vitest";
import { resetNav, TEST_NOW } from "./screen";

// The same instant and time zone on every run and machine. Only Date is faked, and it moves on with real time from TEST_NOW,
// so waits, timers and debounces work as usual.
process.env.TZ = "UTC";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: TEST_NOW, shouldAdvanceTime: true }); });

vi.mock("@/lib/nav", async () => {
  const { createElement } = await import("react");
  const { nav } = await import("./screen");
  return {
    useNav: () => ({ path: nav.path, go: (to: string) => { nav.went.push(to); }, param: (name: string) => nav.params[name] ?? null }),
    Link: ({ to, onClick, ...props }: { to: string; onClick?: (e: unknown) => void } & Record<string, unknown>) =>
      createElement("a", { ...props, href: to, onClick: (e: { preventDefault(): void }) => { onClick?.(e); e.preventDefault(); nav.went.push(to); } }),
  };
});

// A page that uses the router's package itself, not lib/nav, gets the same stand-in: outside the app it has no router.
${next ? ROUTER_MOCK.next : ROUTER_MOCK.vite}

// A page is tested without the app's frame, so render() puts around it what the frame gives every page: the tooltip
// provider (a page with a tooltip cannot render without it) and the place toasts appear in.
vi.mock("@testing-library/react", async (original) => {
  const real = await original<typeof import("@testing-library/react")>();
  const { createElement, Fragment } = await import("react");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const { Toaster } = await import("@/components/ui/sonner");
  const wrapper = ({ children }: { children: unknown }) => createElement(TooltipProvider, null, createElement(Fragment, null, children as never, createElement(Toaster)));
  return { ...real, render: (ui: never, options?: object) => real.render(ui, { wrapper: wrapper as never, ...options }) };
});

if (typeof window !== "undefined") {
  const noop = () => undefined;
  class Observer { observe = noop; unobserve = noop; disconnect = noop; takeRecords = () => []; }
  const w = window as unknown as Record<string, unknown>;
  w.ResizeObserver ??= Observer;
  w.IntersectionObserver ??= Observer;
  w.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: () => false });
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.scrollIntoView ??= noop;
  el.hasPointerCapture ??= () => false;
  el.setPointerCapture ??= noop;
  el.releasePointerCapture ??= noop;
}

afterEach(async () => {
  vi.useRealTimers();
  resetNav();
  if (typeof document !== "undefined") (await import("@testing-library/react")).cleanup();
});
`;

/**
 * Can this checkout run a screen test? The packages are in package.json and the setup file is there. An app scaffolded
 * before screen tests existed has neither, and its ui criteria are tested on the screen's logic as before.
 */
export function screenTestsReady(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const have = { ...pkg.dependencies, ...pkg.devDependencies };
    return "jsdom" in have && "@testing-library/react" in have && existsSync(join(dir, SCREEN_SETUP));
  } catch { return false; }
}

/** The environment check's second run (integrate): another instant, a year and a half later, on the other side of the day. */
export const SHIFTED_TEST_ENV: Record<string, string> = { FACTORY_TEST_NOW: "2027-07-04T03:30:00.000Z" };
