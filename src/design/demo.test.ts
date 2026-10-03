import { describe, expect, it } from "vitest";
import { buildDemo, orderStates, stateKind, themeCss } from "./demo.js";

const mock = {
  title: "Overdue invoices", subtitle: "Oldest first",
  copy: { emptyTitle: "No overdue invoices", error: "We couldn't load invoices." },
  blocks: [
    { type: "stats" as const, items: [{ label: "Overdue total", value: "$48,320", delta: "+6%" }] },
    { type: "table" as const, columns: ["Invoice", "Customer", "Status"], statusColumn: 2, rows: [["INV-20418", "Northwind Traders", "Overdue"]] },
    { type: "chart" as const, kind: "bar" as const, title: "By week", points: [{ label: "W1", value: 3 }, { label: "W2", value: 5 }] },
    { type: "form" as const, submit: "Send", fields: [{ label: "Customer", kind: "text" as const }] },
  ],
};
const screen = { id: "S-1", route: "/invoices/overdue", file: "x.tsx", reqs: ["REQ-1"], states: ["loading", "default", "empty", "error"], size: "new" as const, frames: [], mock };
const base = { title: "Invoices", flow: "A user opens the list.", screens: [screen], requirements: { "REQ-1": "List overdue invoices." }, noScreen: [] };

describe("clickable demo", () => {
  it("draws a screen from its sample content, one pane per state", () => {
    const html = buildDemo(base);
    expect(html).toContain("Northwind Traders");
    expect(html).toContain("INV-20418");
    expect(html).toContain("No overdue invoices");
    expect(html).toContain("We couldn&#39;t load invoices.");
    expect(html.split('id="components"')[0]!.match(/class="pane"/g)?.length).toBe(4);
    expect(html).toContain('class="badge bad"');
  });
  it("lists the normal page first and keeps screenshots in the same order", () => {
    expect(orderStates(["loading", "default", "empty", "error", "success"])).toEqual(["default", "success", "loading", "empty", "error"]);
    expect(stateKind("Validation errors")).toBe("validation");
    expect(stateKind("no results")).toBe("empty");
    expect(buildDemo(base).match(/data-state="0"[^>]*>([^<]+)</)?.[1]).toBe("default");
  });
  it("falls back to the wireframe without sample content", () => {
    const html = buildDemo({ ...base, screens: [{ ...screen, mock: undefined }] });
    expect(html).toContain('class="wire"');
    expect(html).not.toContain("Northwind Traders");
  });
  it("escapes everything from the model and carries no network access", () => {
    const evil = '<img src=x onerror=alert(1)>"\'';
    const html = buildDemo({ ...base, title: evil, screens: [{ ...screen, mock: { ...mock, title: evil, blocks: [{ type: "table", columns: [evil], rows: [[evil]] }, { type: "cards", items: [{ title: evil, meta: evil, badge: evil }] }] } }] });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("prefers-reduced-motion");
  });
  it("ignores non-finite chart values instead of drawing NaN", () => {
    const html = buildDemo({ ...base, screens: [{ ...screen, mock: { ...mock, blocks: [{ type: "chart", kind: "line", title: "t", points: [{ label: "a", value: Number.NaN }, { label: "b", value: 2 }] }] } }] });
    expect(html).not.toContain("NaN");
  });
  it("takes its colours, mode, corners and motion from the design's theme", () => {
    const theme = { mood: "calm clinical", mode: "light" as const, brand: "#0f766e", accent: "#0369a1", radius: "round" as const, motion: "calm" as const };
    const html = buildDemo({ ...base, theme });
    expect(html).toContain("--r:18px");
    expect(html).toContain("--rise:6px");
    expect(html).toContain("--drift:paused");
    expect(html).toContain("--br:#0f766e");
    expect(html).toContain('content="light"');
    expect(html).not.toContain("prefers-color-scheme:dark){:root"); // a fixed mode does not follow the system
    expect(themeCss({ ...theme, mode: "auto" })).toContain("prefers-color-scheme:dark");
    expect(themeCss()).toContain("--br:#1a56db");
  });
  it("keeps a too-dark accent readable on a dark page and a too-light one on a light page", () => {
    const dark = themeCss({ mood: "x", mode: "dark", accent: "#101030", accent2: "#202040", radius: "soft", motion: "lively" });
    expect(dark).not.toContain("--a1:#101030");
    const light = themeCss({ mood: "x", mode: "light", accent: "#ffff99", accent2: "#eeeeaa", radius: "soft", motion: "lively" });
    expect(light).not.toContain("--a1:#ffff99");
  });
});

describe("laying a page out and colouring its statuses", () => {
  const draw = (b: { type: string }) => b.type === "table" ? `<div class="card tbl">T</div>` : `[${b.type}]`;
  it("puts the page's buttons in its header, search above its table, and a chart beside its list", async () => {
    const { compose } = await import("./demo.js");
    const r = compose([{ type: "actions" }, { type: "filters" }, { type: "table" }, { type: "chart" }, { type: "list" }] as never, draw as never);
    expect(r.actions).toBe("[actions]");
    expect(r.body).toBe(`<div class="card tbl"><div class="toolbar">[filters]</div>T</div><div class="split wl">[chart][list]</div>`);
  });
  it("leaves a form's button at the end of the form", async () => {
    const { compose } = await import("./demo.js");
    const r = compose([{ type: "form" }, { type: "actions" }] as never, draw as never);
    expect(r.actions).toBe("");
    expect(r.body).toContain("[actions]");
  });
  it("colours the field's own status words, not just generic ones", async () => {
    const { tone } = await import("./demo.js");
    expect(tone("Delayed")).toBe("warn");
    expect(tone("Cancelled")).toBe("bad");
    expect(tone("Boarding")).toBe("live");
    expect(tone("Delivered")).toBe("ok");
    expect(tone("Economy")).toBe("info");
  });
});
