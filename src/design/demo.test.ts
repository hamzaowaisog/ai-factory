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
  it("a Stitch screen with a live page is shown live in a sandboxed frame, its picture one click away", () => {
    const st = { ...screen, mock: undefined, states: ["default"], frames: ["ST-1"] };
    const pic = { name: "Overdue", dataUri: "data:image/png;base64,AAAA", state: "normal" };
    const html = buildDemo({ ...base, screens: [st], frames: { "ST-1": { ...pic, live: "stitch/ST-1.html" } } });
    expect(html).toMatch(/<iframe class="live" sandbox="allow-scripts" src="stitch\/ST-1\.html"/);
    expect(html).toContain('data-view="pic"');
    expect(html).toMatch(/Content-Security-Policy[^>]*frame-src 'self'/);
    // without a live page the demo frames nothing: the approved file stays pictures only
    const still = buildDemo({ ...base, screens: [st], frames: { "ST-1": pic } });
    expect(still).not.toContain("<iframe");
    expect(still).not.toContain("frame-src");
  });
  it("gives a Stitch screen drawn at phone width a Phone tab with that drawing, at phone width", () => {
    const st = { ...screen, mock: undefined, states: ["default"], frames: ["ST-1", "ST-2"] };
    const html = buildDemo({ ...base, screens: [st], frames: { "ST-1": { name: "wide.png", dataUri: "data:image/png;base64,AAAA", state: "normal" }, "ST-2": { name: "narrow.png", dataUri: "data:image/png;base64,BBBB", state: "phone" } } });
    expect(html).toMatch(/class="pane ph" data-wf="1" hidden><img src="data:image\/png;base64,BBBB" alt="narrow\.png">/);
    expect(html).toMatch(/data-state="1"[^>]*>Phone</);
    // a screen with no phone drawing has no such tab
    expect(buildDemo({ ...base, screens: [{ ...st, frames: ["ST-1"] }], frames: { "ST-1": { name: "wide.png", dataUri: "data:image/png;base64,AAAA", state: "normal" } } })).not.toMatch(/>Phone</);
  });
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

describe("a Stitch screen's overlays on the demo", () => {
  it("gives each overlay its own tab with its own picture, and leaves a screen with none as it was", async () => {
    const { demoStates, frameDataUri, frameStateOf } = await import("./demo.js");
    const pic = (n: number) => frameDataUri("x.png", Buffer.from(`89504e470d0a1a0a0000000d494844${n}${n}`, "hex"), 0)!;
    const s = { id: "S-1", route: "/payees", file: "app/payees/page.tsx", reqs: ["REQ-1"], states: [], size: "new" as const, frames: ["ST-1", "ST-2"], overlays: [{ kind: "modal", title: "Add payee", trigger: "Add payee" }] };
    expect(demoStates(s)).toEqual(["default", "Dialog: Add payee"]);
    expect(frameStateOf(s, "Dialog: Add payee", 1)).toBe("overlay-1");
    expect(frameStateOf(s, "Phone", 2)).toBe("phone");
    expect(frameStateOf(s, "empty", 1)).toBe("empty");
    expect(frameStateOf(s, "default", 0)).toBe("normal");
    const html = buildDemo({
      title: "Payees", flow: "Payees", requirements: { "REQ-1": "The system shall list payees." }, noScreen: [], screens: [s],
      frames: { "ST-1": { name: "a.png", state: "normal", dataUri: pic(5) }, "ST-2": { name: "b.png", state: "overlay-1", dataUri: pic(6) } },
    });
    expect(html).toContain("Dialog: Add payee");
    expect(html).toContain(pic(6));
    // a Stitch screen stored before overlays: its states as before
    expect(demoStates({ ...s, overlays: undefined })).toEqual(["default"]);
  });
});
