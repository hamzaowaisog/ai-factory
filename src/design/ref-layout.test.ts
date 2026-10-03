// The rendered layout check (docs/estimates-design.md, "Design references", step 7): a screen that cites a layout reference
// shows that reference's navigation and the blocks for its regions, read from the drawn demo in a browser.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScreenMock } from "../contracts/artifacts.js";
import { buildDemo } from "./demo.js";
import { findChromium, readDemoLayout } from "./screenshots.js";
import type { DesignRefsArt } from "../stages/design-refs.js";
import { refLayoutFixes, refLayoutGaps, refScreenFor, regionBlocks, type Rendered } from "./ref-checks.js";

const brief = (screens: { id: string; regions: string[] }[]) => ({ source: "screenshot" as const, palette: [], fonts: [], spacingPx: [], radiusPx: null, untrustedNotes: [], screens: screens.map((s) => ({ id: s.id, regions: s.regions.map((name) => ({ name })) })) });
const reading = (role = "layout", navigation = "sidebar", screens = [{ id: "Orders", regions: ["filters", "data table", "pager"] }]): DesignRefsArt =>
  ({ dropped: [], refs: [{ id: "R-2", role, source: "dash.png", kind: "screen", measured: "approximate", brief: brief(screens), type: {}, navigation, reqs: [] }] }) as unknown as DesignRefsArt;
const seen = (blocks: string[], nav = ["rail"]): Record<string, Rendered> => ({ "S-1": { frame: "sidebar", nav, blocks } });
const orders = [{ id: "S-1", refs: ["R-2"], title: "Orders /orders" }];

describe("the rendered layout against layout references", () => {
  it("reads region names as the blocks that draw them, and leaves the rest unchecked", () => {
    expect(regionBlocks("data table")).toEqual(["table"]);
    expect(regionBlocks("KPI tiles")).toEqual(["stats"]);
    expect(regionBlocks("revenue chart")).toEqual(["chart"]);
    expect(regionBlocks("app bar")).toBeUndefined();
    expect(regionBlocks("pager")).toBeUndefined();
  });

  it("passes a screen that shows the reference's navigation and regions", () => {
    expect(refLayoutGaps(orders, reading(), seen(["filters", "table"]), undefined)).toEqual([]);
  });

  it("names the navigation and the regions the drawn screen lacks", () => {
    const gaps = refLayoutGaps(orders, reading(), seen(["stats"], ["top-links"]), undefined);
    expect(gaps).toEqual([{ screen: "S-1", ref: "R-2", nav: "sidebar", missing: ["filters", "data table"] }]);
    const [fix] = refLayoutFixes(gaps, reading());
    expect(fix!.check).toBe("design-ref-layout");
    expect(fix!.message).toContain('"sidebar"');
    expect(fix!.message).toContain('"filters", "data table" are not on the drawn page');
  });

  it("checks only layout references cited on the screen, not set aside, with a navigation that was read", () => {
    expect(refLayoutGaps(orders, reading("inspire"), seen([]), undefined)).toEqual([]);
    expect(refLayoutGaps([{ ...orders[0]!, refs: [] }], reading(), seen([]), undefined)).toEqual([]);
    expect(refLayoutGaps(orders, reading(), seen([]), [{ id: "R-2", use: "set-aside", how: "another product" }])).toEqual([]);
    expect(refLayoutGaps(orders, reading("layout", "unclear", []), seen([], []), undefined)).toEqual([]);
    expect(refLayoutGaps(orders, reading(), {}, undefined)).toEqual([]); // not drawn: not checked
  });

  it("follows the pictured screen whose name the page shares, or the only one", () => {
    const two = reading("layout", "none", [{ id: "Dashboard", regions: ["KPI tiles", "chart"] }, { id: "Order list", regions: ["data table"] }]);
    expect(refScreenFor(two.refs[0]!, "Orders /orders")?.id).toBe("Order list");
    expect(refScreenFor(two.refs[0]!, "Settings /settings")).toBeUndefined();
    expect(refLayoutGaps([{ id: "S-1", refs: ["R-2"], title: "Dashboard /" }], two, seen(["stats"], []), undefined)).toEqual([{ screen: "S-1", ref: "R-2", missing: ["chart"] }]);
    expect(refLayoutGaps([{ id: "S-1", refs: ["R-2"], title: "Settings /settings" }], two, seen([], []), undefined)).toEqual([]);
  });

  it("checks breadcrumbs and tabs named as regions against the page's own", () => {
    const r = reading("layout", "none", [{ id: "Order", regions: ["breadcrumbs", "tabs", "details"] }]);
    expect(refLayoutGaps(orders, r, seen(["detail"], ["page-tabs"]), undefined)[0]!.missing).toEqual(["breadcrumbs"]);
  });
});

it("keeps a table's filters in its toolbar, both marked", () => {
  const m = ScreenMock.parse({ title: "Orders", copy: {}, blocks: [{ type: "filters", search: "Search", chips: ["All"] }, { type: "table", columns: ["Order"], rows: [["#1"]] }] });
  const html = buildDemo({ title: "Shop", flow: "f", requirements: {}, noScreen: [], screens: [{ id: "S-1", route: "/orders", file: "a", reqs: [], states: [], size: "new", frames: [], mock: m }] as never });
  expect(html).toContain('<div data-b="table" class="card tbl"><div class="toolbar"><div data-b="filters" class="filters">');
});

const chromium = !!findChromium();
describe.skipIf(!chromium)("reading the drawn demo in a browser", () => {
  it("reads each screen's frame, navigation and blocks top to bottom", async () => {
    const mock = (blocks: unknown[], extra = {}) => ScreenMock.parse({ title: "Orders", blocks, copy: {}, ...extra });
    const html = buildDemo({
      title: "Shop", flow: "f", requirements: {}, noScreen: [],
      screens: [
        { id: "S-1", route: "/orders", file: "a", reqs: [], states: [], size: "new", frames: [], mock: mock([{ type: "stats", items: [{ label: "Open", value: "4" }] }, { type: "filters", search: "Search orders", chips: ["All"] }, { type: "table", columns: ["Order", "Total"], rows: [["#1", "$4"]] }]) },
        { id: "S-2", route: "/orders/1", file: "b", reqs: [], states: [], size: "new", frames: [], mock: mock([{ type: "detail", rows: [{ label: "Total", value: "$4" }] }], { title: "Order 1", crumbs: ["Orders"], tabs: ["Overview", "Activity"] }) },
      ] as never,
    });
    const dir = mkdtempSync(join(tmpdir(), "factory-reflayout-"));
    const before = process.env.FACTORY_NO_SCREENSHOTS;
    delete process.env.FACTORY_NO_SCREENSHOTS;
    try {
      writeFileSync(join(dir, "demo.html"), html);
      const r = await readDemoLayout(join(dir, "demo.html"), ["S-1", "S-2"]);
      expect(r?.["S-1"]).toEqual({ frame: "sidebar", nav: ["rail"], blocks: ["stats", "table", "filters"] });
      expect(r?.["S-2"]?.nav).toEqual(["rail", "page-tabs", "crumbs"]);
      expect(r?.["S-2"]?.blocks).toEqual(["detail"]);
    } finally {
      if (before !== undefined) process.env.FACTORY_NO_SCREENSHOTS = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("prints how each reference was used and what a screen still lacks", async () => {
  const { formatDesignRun } = await import("./runs.js");
  const lines = formatDesignRun({
    runId: "r1", mode: "design", project: "demo", status: "waiting", stage: "design card", request: "orders", costUsd: 0.5, files: {},
    screens: [{ id: "S-1", title: "Orders", route: "/orders", reqs: ["REQ-1"], states: [], refs: ["R-2"] }],
    references: [{ id: "R-2", kind: "image", source: "dash.png", role: "layout", measured: "approximate", colours: [], fonts: [], notes: [], use: { use: "used", how: "the sidebar and table" } }],
    refLayout: [{ screen: "S-1", ref: "R-2", nav: "sidebar", missing: ["data table"] }],
  } as never).join("\n");
  expect(lines).toContain("used: the sidebar and table");
  expect(lines).toContain("/orders -> REQ-1; from R-2");
  expect(lines).toContain("S-1 differs from R-2: not reached by sidebar; no data table");
});

describe("the design card's references section", () => {
  it("lists each reference with its use and the screens it shaped, then the leftover gaps; nothing without references", async () => {
    const { refCardLines } = await import("../stages/estimate-approve.js");
    const design = {
      screens: [{ id: "S-1", refs: ["R-2"] }, { id: "S-2" }],
      refUse: [{ id: "R-1", use: "set-aside", how: "a competitor's site, kept for its colours only" }, { id: "R-2", use: "used", how: "sidebar and table" }],
      refLayout: [{ screen: "S-1", ref: "R-2", nav: "sidebar", missing: ["data table"] }],
    };
    expect(refCardLines(design as never, [{ id: "R-1", role: "inspire", source: "https://other.example" }, { id: "R-2", role: "layout", source: "orders.png" }])).toEqual([
      "## Design references",
      "- R-1 (inspire) https://other.example: set aside, a competitor's site, kept for its colours only",
      "- R-2 (layout) orders.png: used, sidebar and table; shaped S-1",
      "- S-1 still differs from R-2: not reached by sidebar; no data table",
      "",
    ]);
    expect(refCardLines({ screens: [] } as never)).toEqual([]);
    expect(refCardLines({ screens: [], restyle: true, refUse: [{ id: "R-1", use: "used", how: "brand and type" }] } as never, [{ id: "R-1", role: "match", source: "guide.pdf" }])).toEqual([
      "## Design references",
      "- R-1 (match) guide.pdf: used, brand and type",
      "- The app is restyled to the match reference's look (chosen on the questions card): a design-system change, every existing page's look changes.",
      "",
    ]);
  });
});
