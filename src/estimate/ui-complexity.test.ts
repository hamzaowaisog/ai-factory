import { describe, expect, it } from "vitest";
import { ScreenMock } from "../contracts/artifacts.js";
import { designCard } from "../stages/estimate-approve.js";
import { designUi, screenUi, uiFactors } from "./ui-complexity.js";

const mock = (m: object) => ScreenMock.parse({ title: "Page", copy: {}, ...m });
const list = mock({ blocks: [{ type: "list", items: [{ title: "Order 12", meta: "Paid" }] }, { type: "actions", buttons: ["New order"] }] });
const tracking = mock({
  blocks: [
    { type: "map", pins: [{ label: "Depot" }, { label: "Stop 1" }, { label: "Stop 2" }], route: true },
    { type: "chat", with: "Driver", messages: [{ from: "them", text: "On my way" }, { from: "me", text: "Thanks" }] },
    { type: "form", fields: [{ label: "Card", kind: "card" }, { label: "Code", kind: "otp" }, { label: "Note" }] },
  ],
  overlays: [{ kind: "modal", trigger: "Tip", title: "Add a tip", blocks: [{ type: "form", fields: [{ label: "Amount", kind: "currency" }] }] }, { kind: "confirm", trigger: "Cancel", title: "Cancel the delivery?" }],
  toasts: [{ after: "Send", text: "Sent" }],
  links: [{ from: "Driver", to: "S-3" }],
});

describe("UI counted from the approved demo", () => {
  it("calls a plain list simple and a map, chat and payment page complex, and says why", () => {
    expect(screenUi({ mock: list })).toEqual({ level: "simple", points: 1, drivers: ["1 simple block"] });
    const t = screenUi({ mock: tracking, states: ["default", "loading", "error"] });
    expect(t.level).toBe("complex");
    // the heaviest first, in words a lead reads
    expect(t.drivers[0]).toBe("map with a route and stops");
    expect(t.drivers).toEqual(expect.arrayContaining(["live chat", "form of 3 fields (card number, one-time code)", "2 overlays (modal with a form, confirm)", "2 states (loading, error)", "1 toast", "links to 1 page"]));
  });

  it("counts a table's sorting, selection and bulk actions, and the states a page lists", () => {
    const table = (extra: object) => screenUi({ mock: mock({ blocks: [{ type: "table", columns: ["Name", "Due"], rows: [["A", "1"]], ...extra }] }) });
    expect(table({}).drivers).toEqual(["table"]);
    const full = table({ sortBy: 1, selectable: true, bulk: ["Export"] });
    expect(full.drivers).toEqual(["table with sorting, row selection and bulk actions"]);
    expect(full.points - table({}).points).toBe(3);
    expect(screenUi({ mock: list, states: ["loading", "empty", "error"] }).points).toBe(4);
  });

  it("marks a change to an existing page, and gives no level to a screen with no sample page", () => {
    expect(screenUi({ mock: list, size: "tweak" }).drivers[0]).toBe("a change to an existing page");
    expect(screenUi({ mock: list, size: "reuse" }).drivers[0]).toBe("reuses an existing page");
    const none = screenUi({ states: ["empty"] });
    expect(none.level).toBeUndefined();
    expect(none.drivers).toEqual(["1 state (empty)", "no sample page: sized from its requirements"]);
  });

  it("names what adds work to every page: several apps, two languages, right to left, native digits, both modes", () => {
    expect(uiFactors({})).toEqual([]);
    const f = uiFactors({
      apps: [{ name: "Customer", device: "phone" }, { name: "Admin", device: "web" }],
      locale: { languages: ["ar", "en"], region: "SA", currency: "SAR", dates: "dmy", digits: "native" } as never,
      theme: { mode: "auto" },
    });
    expect(f).toEqual([
      "2 apps (Customer, phone; Admin, web), each with its own frame and navigation",
      "two languages (ar and en): every page's words translated and switchable",
      "right to left: every page mirrored",
      "the script's own digits in every number",
      "both colour modes: every page in light and dark, with a switch",
    ]);
    expect(uiFactors({ locale: { languages: ["ur"] } as never })).toEqual(["right to left: every page mirrored"]);
  });

  it("is absent for a skipped design, and keyed by screen id otherwise", () => {
    expect(designUi({ skipped: true, screens: [] })).toBeUndefined();
    const d = designUi({ screens: [{ id: "S-1", mock: list }, { id: "S-2", mock: tracking }], theme: { mode: "auto" } })!;
    expect([d.screens["S-1"]!.level, d.screens["S-2"]!.level]).toEqual(["simple", "complex"]);
    expect(d.factors).toHaveLength(1);
  });

  it("shows each screen's UI and the product-wide factors on the design card", () => {
    const design = {
      flow: "track a delivery", screens: [{ id: "S-1", route: "/orders", file: "a.tsx", reqs: ["R-1"], mock: list }, { id: "S-2", route: "/track", file: "b.tsx", reqs: ["R-2"], mock: tracking }],
      mapping: { unmappedReqs: [], orphanScreens: [] }, theme: { mode: "auto" },
    };
    const card = designCard("run-1", design as never, "abcdef1234");
    expect(card).toContain("- Page: S-1 /orders (a.tsx) -> R-1; UI: simple (1 simple block)");
    expect(card).toMatch(/S-2 \/track \(b\.tsx\) -> R-2; UI: complex \(map with a route and stops; live chat; /);
    expect(card).toContain("UI across the product (the estimate sizes every UI task with these): both colour modes: every page in light and dark, with a switch");
  });
});
