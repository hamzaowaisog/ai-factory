import { describe, expect, it } from "vitest";
import { buildDemo, demoStates, toastLabel } from "./demo.js";
import { designQuality, layoutFixes } from "../stages/design.js";
import { icon, iconFor, verbIcon } from "./icons.js";
import { contrast, palette } from "./palette.js";
import { scene, sceneKind } from "./scenes.js";

describe("palette", () => {
  it("keeps every text colour readable (WCAG AA) on its surface, in both modes, for pale and dark brands", () => {
    for (const brand of ["#1a56db", "#ffe066", "#0b0b2a", "#22c55e"]) for (const mode of ["light", "dark"] as const) {
      const p = palette({ brand, mode, neutral: "cool" });
      for (const k of ["ink", "ink2", "a1", "ok", "bad", "warn", "info"]) expect(contrast(p[k]!, p.sf!), `${brand} ${mode} ${k}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.mut!, p.sf!), `${brand} ${mode} mut`).toBeGreaterThanOrEqual(3);
      expect(contrast(p.on!, p.br!), `${brand} ${mode} on`).toBeGreaterThanOrEqual(2.4);
    }
  });
  it("gives a bright brand dark text in dark mode, and a deep brand white text", () => {
    expect(palette({ brand: "#22c55e", mode: "dark", neutral: "cool" }).on).not.toBe("#ffffff");
    expect(palette({ brand: "#0e7c66", mode: "light", neutral: "cool" }).on).toBe("#ffffff");
  });
  it("tints warm neutrals warm and pure neutrals grey", () => {
    const pure = palette({ brand: "#1a56db", mode: "light", neutral: "pure" }).edge!;
    expect(pure.slice(1, 3)).toBe(pure.slice(3, 5));
    const [r, , b] = [1, 3, 5].map((i) => parseInt(palette({ brand: "#1a56db", mode: "light", neutral: "warm" }).edge!.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(b!);
  });
});

describe("icons", () => {
  it("picks icons by the words of a label and the verb of a button", () => {
    expect(iconFor("Net worth")).not.toBe("");
    expect(verbIcon("Add money")).toBe("card");
    expect(verbIcon("Add flight")).toBe("plus");
    expect(verbIcon("Export statement")).toBe("download");
    expect(verbIcon("Looks good")).toBe("");
    expect(icon("nope")).toBe("");
    expect(icon("bell")).not.toContain("xmlns");
  });
});

describe("scenes", () => {
  it("draws what the card is about, from its own words before the page's", () => {
    expect(sceneKind("Dubai · From PKR 62,000", "Explore destinations")).toBe("city");
    expect(sceneKind("Running shoes · $89", "Shop")).toBe("product");
    expect(scene("Dubai", "Explore", "x1", 0)).toContain('id="scx1');
    expect(scene("Dubai", "Explore", "x1", 0)).toBe(scene("Dubai", "Explore", "x1", 0));
  });
});

describe("demo drawing", () => {
  const screen = (id: string) => ({ id, route: `/${id}`, file: "a.tsx", reqs: [], states: ["loading"], size: "new", frames: [], mock: { title: "Weekly", copy: {}, blocks: [
    { type: "chart" as const, kind: "line" as const, title: "Passengers", points: [{ label: "W1", value: 3 }, { label: "W2", value: 5 }, { label: "W3", value: 4 }] },
    { type: "cards" as const, visual: true, items: [{ title: "Dubai", meta: "From $420" }, { title: "Doha", meta: "From $380" }] },
  ] } });
  const html = () => buildDemo({ title: "Sky", flow: "f", screens: [screen("S-1"), screen("S-2")] as never, requirements: {}, noScreen: [] });
  it("gives every gradient its own id, so one defined in a hidden state still paints in a shown one", () => {
    const ids = [...html().matchAll(/<(?:linear|radial)Gradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("takes its frame and styles from the theme, not one template", () => {
    const with_ = (theme: object) => buildDemo({ title: "Sky", flow: "f", screens: [screen("S-1")] as never, requirements: {}, noScreen: [], theme: { mood: "x", brand: "#0b5d4b", ...theme } as never });
    expect(with_({})).toContain("sh-topbar"); // auto: no tables or figures, so a site
    expect(with_({ shell: "sidebar" })).toContain('class="rail');
    const minimal = with_({ shell: "minimal" });
    expect(minimal).toContain("sh-minimal");
    expect(minimal).not.toContain('class="tnav"');
    expect(minimal).not.toContain('class="tabbar"');
    expect(with_({ hero: "band" })).toContain('class="app hero"');
    expect(with_({ charts: "mono", radius: "round" })).toMatch(/<body class="fx-modern sh-topbar ch-mono r-round">/);
    const icons = with_({ imagery: "icons" });
    expect(icons).toContain('class="pic tile"');
    expect(icons).not.toContain('<div class="pic" ');
  });
  it("is the same every build, and fetches nothing", () => {
    expect(html()).toBe(html());
    expect(html()).not.toMatch(/https?:\/\//);
  });
});

describe("devices, apps and frames", () => {
  const sc = (id: string, route: string, title: string, o: object = {}) => ({ id, route, file: "a.tsx", reqs: [], states: [], size: "new", frames: [], mock: { title, copy: {}, blocks: [{ type: "text" as const, body: "x" }, { type: "text" as const, body: "y" }] }, ...o });
  const screens = [
    sc("S-1", "/home", "Good morning, Sana", { app: "customer" }),
    sc("S-2", "/accounts/savings", "Savings ··9032", { app: "customer" }),
    sc("S-3", "/customers", "Customers", { app: "admin" }),
    sc("S-4", "/customers/4821", "Sana Malik", { app: "admin" }),
  ];
  const build = (apps?: object[], theme: object = {}, list = screens) => buildDemo({ title: "Meezan Plus", flow: "f", screens: list as never, requirements: {}, noScreen: [], theme: { mood: "x", brand: "#0B5CAD", ...theme } as never, ...(apps ? { apps: apps as never } : {}) });
  const two = [{ id: "customer", name: "Customer app", device: "phone", shell: "tabs" }, { id: "admin", name: "Back office", device: "web", shell: "sidebar" }];
  const section = (html: string, id: string) => html.slice(html.indexOf(`<section class="screen" id="${id}"`), html.indexOf("</section>", html.indexOf(`id="${id}"`)));
  it("draws a phone app in a phone and a web app in a browser, each with its own frame", () => {
    const html = build(two);
    expect(section(html, "S-1")).toContain('class="canvas sh-tabs phone"');
    expect(section(html, "S-1")).toContain('class="sbar');
    expect(section(html, "S-1")).toContain('class="tabbar"');
    expect(section(html, "S-3")).toContain('class="canvas sh-sidebar"');
    expect(section(html, "S-3")).toContain("admin.meezanplus.app/customers");
    expect(html).toContain("Customer app <span class=\"dv\">phone app</span>");
  });
  it("lists an app's sections in its navigation, names them as a product would, and keeps a detail page's section lit", () => {
    const s1 = section(build(two), "S-1");
    expect(s1).toContain("<span>Home</span>");
    expect(s1).toContain("<span>Accounts</span>");
    expect(s1).not.toContain("<span>Customers</span>");
    const s4 = section(build(two), "S-4");
    expect(s4).toMatch(/<a href="#S-3" class="on">.*?<span>Customers<\/span>/);
    expect(s4).not.toContain("<span>Sana Malik</span>");
  });
  it("opens a drawer from a menu button", () => {
    const s = section(build([{ ...two[0], shell: "drawer" }, two[1]]), "S-1");
    expect(s).toContain('data-drawer aria-label="Menu"');
    expect(s).toContain('class="dp" role="dialog"');
    expect(s).not.toContain('class="tabbar"');
  });
  it("follows the reading's device when there is one app", () => {
    const html = build(undefined, { reading: { users: "u", context: "c", device: "phone", tone: "t", hero: "h", traits: ["a", "b"] } }, screens.slice(0, 2));
    expect(html).toContain('class="canvas sh-tabs phone"');
  });
  it("shows a page's trail and its own tabs", () => {
    const html = build(two, {}, [sc("S-1", "/a/b", "Savings", { app: "customer", mock: { title: "Savings", crumbs: ["Accounts"], tabs: ["Overview", "Activity"], copy: {}, blocks: [{ type: "text", body: "x" }, { type: "text", body: "y" }] } }), screens[2]!]);
    expect(html).toContain('<nav class="crumbs" aria-label="Breadcrumb"><span class="back">');
    expect(html).toContain('<span aria-current="page">Savings</span>');
    expect(html).toContain('<button type="button" role="tab" aria-selected="true" class="on">Overview</button>');
  });
});

describe("overlays", () => {
  const blocks = [
    { type: "table" as const, columns: ["Payee", "Status"], rows: [["Ayesha", "Active"], ["Bilal", "Paused"]], statusColumn: 1 },
    { type: "actions" as const, buttons: ["Add payee", "Freeze card"] },
  ];
  const overlays = [
    { kind: "modal" as const, trigger: "Add payee", title: "Add payee", blocks: [{ type: "form" as const, fields: [{ label: "Name", kind: "text" as const }], submit: "Add" }], actions: [] },
    { kind: "confirm" as const, trigger: "Freeze card", title: "Freeze this card?", text: "Payments stop until you unfreeze it.", blocks: [], actions: ["Freeze card", "Keep active"] },
    { kind: "menu" as const, trigger: "More", title: "Payee actions", blocks: [], items: ["Edit", "Delete payee"], actions: [] },
  ];
  const sc = { id: "S-1", route: "/payees", file: "a.tsx", reqs: [], states: ["empty"], size: "new", frames: [], mock: { title: "Payees", copy: {}, blocks, overlays } };
  const html = buildDemo({ title: "Pay", flow: "f", screens: [sc] as never, requirements: {}, noScreen: [], theme: { mood: "x", brand: "#0B5CAD" } as never });
  it("gives each overlay its own tab after the screen's states", () => {
    expect(demoStates(sc)).toEqual(["default", "empty", "Dialog: Add payee", "Confirm: Freeze this card?", "Menu: Payee actions"]);
    expect(html).toMatch(/data-state="3"[^>]*>[^<]*Confirm: Freeze this card\?/);
  });
  it("draws the overlays on the normal page, closed, and open in their own tab", () => {
    expect(html.match(/class="ovl k-modal"/g)?.length).toBe(3);
    expect(html.match(/class="ovl k-modal open" data-open/g)?.length).toBe(1);
    expect(html).toContain('data-trigger="More" role="menu"');
    expect(html).toContain('class="btn primary danger"');
    expect(html).toContain('class="mitem bad"');
  });
  it("checks every overlay opens from a button on its page", () => {
    const out = (o: object[]) => ({ flow: "f", noScreen: [], screens: [{ ...sc, mock: { ...sc.mock, overlays: o } }] }) as never;
    const checks = (o: object[]) => designQuality(out(o)).filter((q) => q.check === "design-overlay-trigger").length;
    expect(checks(overlays)).toBe(0);
    expect(checks([{ ...overlays[0], trigger: "New payee" }])).toBe(1);
    expect(checks([{ ...overlays[2], items: [] }])).toBe(1);
  });
});

describe("carousel", () => {
  const car = (style: "promo" | "media") => ({ type: "carousel" as const, style, title: "Offers for you", items: [{ title: "0% instalments at Khaadi", meta: "Up to 6 months on your Visa", badge: "New", cta: "See offer" }, { title: "Profit up to 13.5%", meta: "Open a savings pot in a minute" }, { title: "Pay bills, earn points", meta: "Every bill paid in the app" }] });
  const html = (style: "promo" | "media") => buildDemo({ title: "Pay", flow: "f", screens: [{ id: "S-1", route: "/home", file: "a.tsx", reqs: [], states: ["loading"], size: "new", frames: [], mock: { title: "Home", copy: {}, blocks: [car(style), { type: "text", body: "x" }] } }] as never, requirements: {}, noScreen: [], theme: { mood: "x", brand: "#0B5CAD" } as never });
  it("draws slides with arrows and dots, one picture each", () => {
    const h = html("promo");
    expect(h).toContain('<div class="car k-promo" role="region" aria-roledescription="carousel" aria-label="Offers for you">');
    expect(h.match(/aria-roledescription="slide"/g)?.length).toBe(3);
    expect(h).toContain('data-car="1" aria-label="Next slide"');
    expect(h.match(/<div class="dots"[^>]*>(<i[^>]*><\/i>)+<\/div>/)?.[0].match(/<i/g)?.length).toBe(3);
    expect(h).toContain("See offer");
    expect(html("media")).toContain('class="car k-media"');
  });
  it("counts a slide's button as one an overlay may open from", () => {
    const sc = { id: "S-1", route: "/", file: "a", reqs: [], states: [], size: "new", frames: [], mock: { title: "Home", copy: {}, blocks: [car("promo"), { type: "text", body: "x" }], overlays: [{ kind: "sheet", trigger: "See offer", title: "Khaadi offer", blocks: [], actions: [] }] }, mockFull: { title: "Home", copy: {}, blocks: [car("promo")] } };
    expect(designQuality({ flow: "f", noScreen: [], screens: [sc] } as never).map((q) => q.check)).not.toContain("design-overlay-trigger");
  });
});

describe("linked screens", () => {
  const blocks = [{ type: "table" as const, columns: ["Customer", "KYC"], rows: [["Sana Malik", "Verified"], ["Hamid Raza", "Pending"]], statusColumn: 1 }, { type: "actions" as const, buttons: ["Add customer"] }];
  const sc = (links: object[]) => ({ id: "S-1", route: "/customers", file: "a", reqs: [], states: [], size: "new", frames: [], mock: { title: "Customers", copy: {}, blocks, links } });
  const other = { id: "S-2", route: "/customers/1", file: "b", reqs: [], states: [], size: "new", frames: [], mock: { title: "Sana Malik", copy: {}, blocks: [{ type: "text", body: "x" }, { type: "text", body: "y" }] } };
  const checks = (links: object[]) => designQuality({ flow: "f", noScreen: [], screens: [sc(links), other] } as never).filter((q) => q.check === "design-link").map((q) => q.message);
  it("carries a page's links for the demo to wire up", () => {
    const html = buildDemo({ title: "Bank", flow: "f", screens: [sc([{ from: "Sana Malik", to: "S-2" }]), other] as never, requirements: {}, noScreen: [] });
    expect(html).toContain('data-links="[{&quot;from&quot;:&quot;Sana Malik&quot;,&quot;to&quot;:&quot;S-2&quot;}]"');
  });
  it("checks a link goes from something on the page to another screen", () => {
    expect(checks([{ from: "Sana Malik", to: "S-2" }, { from: "add customer", to: "S-2" }])).toEqual([]);
    expect(checks([{ from: "Sana Malik", to: "S-9" }])[0]).toContain("not a screen of this design");
    expect(checks([{ from: "Sana Malik", to: "S-1" }])[0]).toContain("the same screen");
    expect(checks([{ from: "Usman Tariq", to: "S-2" }])[0]).toContain("nothing on the page is labelled that");
  });
});

describe("layout problems on the design card", () => {
  it("lists what the screenshots found, at most eight", async () => {
    const { designCard } = await import("../stages/estimate-approve.js");
    const design = { flow: "f", screens: [], mapping: { unmappedReqs: [], orphanScreens: [] } } as never;
    const issue = (i: number) => ({ screen: "Customers", state: "default", viewport: "phone" as const, kind: "clipped" as const, text: `Label ${i}` });
    const card = designCard("r1", design, "abcdef12", { shots: { dir: "d", count: 2, issues: Array.from({ length: 10 }, (_, i) => issue(i)) } });
    expect(card).toContain("## Layout problems in the demo (10)");
    expect(card).toContain('- Customers, default, phone: "Label 0" is cut off');
    expect(card).toContain("- and 2 more");
    expect(designCard("r1", design, "abcdef12", { shots: { dir: "d", count: 2 } })).not.toContain("Layout problems");
  });
});

describe("toasts", () => {
  const blocks = [{ type: "table" as const, columns: ["Waybill", "Status"], rows: [["KG-1", "Delayed"], ["KG-2", "Delivered"]], statusColumn: 1 }, { type: "actions" as const, buttons: ["Export manifest"] }];
  const overlays = [{ kind: "menu" as const, trigger: "More", title: "Shipment actions", blocks: [], items: ["Archive"], actions: [] }];
  const toasts = [{ after: "Export manifest", text: "Manifest for 1,284 shipments is downloading", tone: "info" as const }, { after: "Archive", text: "KG-2 archived", tone: "ok" as const, undo: true }];
  const sc = { id: "S-1", route: "/shipments", file: "a", reqs: [], states: ["empty"], size: "new", frames: [], mock: { title: "Shipments", copy: {}, blocks, overlays, toasts } };
  const html = buildDemo({ title: "Kargo", flow: "f", screens: [sc] as never, requirements: {}, noScreen: [] });
  it("gives each toast its own tab, after the overlays, and short", () => {
    expect(toastLabel(toasts[0]!)).toBe("Toast: Manifest for 1,284 shipments is d…");
    expect(demoStates(sc)).toEqual(["default", "empty", "Menu: Shipment actions", "Toast: Manifest for 1,284 shipments is d…", "Toast: KG-2 archived"]);
  });
  it("pins the toast on its tab, with undo when it has one, and tells the page what each action says", () => {
    expect(html).toContain('<div class="toast info pin" role="status">');
    expect(html).toMatch(/<div class="toast ok pin" role="status">.*<span>KG-2 archived<\/span><button type="button" class="lnk">Undo<\/button>/);
    expect(html).toContain("data-toasts=\"[{&quot;after&quot;:&quot;Export manifest&quot;");
  });
  it("checks a toast follows a button, menu item or overlay action on its page", () => {
    const checks = (t: object[]) => designQuality({ flow: "f", noScreen: [], screens: [{ ...sc, mock: { ...sc.mock, toasts: t } }] } as never).filter((q) => q.check === "design-toast-trigger").map((q) => q.message);
    expect(checks(toasts)).toEqual([]);
    expect(checks([{ after: "Download", text: "Saved" }])[0]).toContain('nothing on the page or in its overlays is labelled that (it has: "Export manifest", "Archive")');
  });
});

describe("controls, groups and switcher", () => {
  const pts = ["1 Sep", "5 Sep", "9 Sep", "13 Sep", "17 Sep", "21 Sep", "25 Sep", "29 Sep"].map((label, i) => ({ label, value: 400 + i * 10 }));
  const s = (id: string, group: string, blocks: object[]) => ({ id, route: `/${id}`, file: "a", reqs: [], states: [], size: "new", frames: [], group, mock: { title: id, copy: {}, blocks } });
  const screens = [
    s("S-1", "Operations", [{ type: "chart", kind: "line", title: "Delivered", points: pts, ranges: ["7D", "30D"] }, { type: "filters", chips: ["All", "Late"], segments: ["List", "Map"] }]),
    s("S-2", "Finance", [{ type: "accordion", title: "Common questions", items: [{ title: "When are carriers paid?", body: "Every Friday." }, { title: "Can I change a price?", body: "Yes." }] }, { type: "text", body: "x" }]),
  ];
  const switcher = { kind: "company" as const, current: "Kargo Pakistan", meta: "42 seats", others: ["Kargo UAE"] };
  const html = (theme: object = {}) => buildDemo({ title: "Kargo", flow: "f", screens: screens as never, requirements: {}, noScreen: [], switcher, theme: { mood: "x", brand: "#C2410C", shell: "sidebar", ...theme } as never });
  it("draws segmented controls for views and chart periods", () => {
    const h = html();
    expect(h).toContain('<div class="seg" role="radiogroup" aria-label="Period"><button type="button" role="radio" aria-checked="true" class="on"><span>7D</span></button>');
    expect(h).toMatch(/role="radio" aria-checked="false">.*<span>Map<\/span>/);
  });
  it("draws a line chart for wide and narrow frames, and swaps them without restarting the line", () => {
    const h = html();
    expect(h).toContain('<svg class="lc-w" viewBox="0 0 680 230"');
    expect(h).toContain('<svg class="lc-n" viewBox="0 0 340 220"');
    // the narrow chart labels fewer points, the last always
    const narrow = h.match(/<svg class="lc-n"[^]*?<\/svg>/)![0];
    expect(narrow.match(/class="xl"/g)!.length).toBeLessThan(8);
    expect(narrow).toContain(">29 Sep</text>");
    expect(h).not.toMatch(/svg\.lc-[nw]\{display:none\}/);
  });
  it("draws an accordion with the first answer open", () => {
    expect(html()).toContain('<div class="card acc"><h4>Common questions</h4><details open><summary><span>When are carriers paid?</span>');
  });
  it("groups the menu and puts the switcher under the brand", () => {
    const h = html();
    expect(h).toContain("<h5>Operations</h5>");
    expect(h).toContain("<h5>Finance</h5>");
    expect(h).toContain('aria-label="Switch company"><span class="swa">KP</span><span class="swt"><b>Kargo Pakistan</b><small>42 seats</small>');
    expect(h).toContain('role="menuitemradio" aria-checked="false"><span class="swa">KU</span><span>Kargo UAE</span>');
  });
  it("pairs a heading face with the body and draws the chosen logo mark", () => {
    expect(html({ heading: "slab" })).toMatch(/--head:Rockwell[^;]*;--hw:650;/);
    expect(html({ mark: "monogram" })).toContain('class="logo mono"><b>K</b></span>');
    expect(html({ mark: "wordmark" })).toContain('<span class="bm wm"><b>Kargo</b><i class="wd" aria-hidden="true"></i></span>');
    // an emblem is the product's own icon, found from its words; with none, the plain mark
    expect(html({ mark: "emblem" })).toContain('<span class="logo"><svg');
    expect(buildDemo({ title: "Kargo", flow: "Dispatchers track every shipment", screens: screens as never, requirements: {}, noScreen: [], theme: { mood: "x", brand: "#C2410C", mark: "emblem" } as never })).toContain('class="logo emb"><svg');
  });
});

describe("layout problems sent back to the model", () => {
  const issue = (state: string, viewport: "phone" | "desktop", text = "Reassign carrier to another lane") => ({ screen: '"Shipments" (S-2)', state, viewport, kind: "clipped" as const, text });
  it("names each problem once, with where it was seen, and asks for a fix", () => {
    const f = layoutFixes([issue("default", "phone"), issue("default", "desktop"), issue("Menu: Actions", "phone"), issue("default", "phone", "Other")]);
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({ check: "design-layout", message: expect.stringContaining('On "Shipments" (S-2), "Reassign carrier to another lane" is cut off in the drawn demo (default, phone width; default, desktop width; Menu: Actions, phone width). Shorten it') });
  });
  it("sends at most ten", () => {
    expect(layoutFixes(Array.from({ length: 14 }, (_, i) => issue("default", "phone", `Label ${i}`)))).toHaveLength(10);
  });
});

describe("charts, fields and tables that fit the data", () => {
  const demo = (blocks: unknown[], states = ["loading"]) => buildDemo({ title: "Kargo", flow: "f", requirements: {}, noScreen: [],
    screens: [{ id: "S-1", route: "/s", file: "a.tsx", reqs: [], states, size: "new", frames: [], mock: { title: "Home", copy: {}, blocks } }] as never });
  const chart = (c: Record<string, unknown>) => ({ type: "chart", title: "Spend", ...c });
  it("draws a donut of shares with its total, rings for goals, and a gauge for one reading", () => {
    const donut = demo([chart({ kind: "donut", unit: "PKR", points: [{ label: "Fuel", value: 60 }, { label: "Tolls", value: 40 }] })]);
    expect(donut).toContain("pathLength=\"100\"");
    expect(donut).toMatch(/class="dleg"/);
    expect(donut).toContain(">100<");
    expect(demo([chart({ kind: "progress", points: [{ label: "Course", value: 70 }, { label: "Quiz", value: 30 }] })])).toContain("70%");
    expect(demo([chart({ kind: "gauge", max: 850, points: [{ label: "Score", value: 720 }] })])).toContain("720");
  });
  it("splits a stacked bar into its series, with a legend", () => {
    const html = demo([chart({ kind: "stacked", series: ["Web", "App"], points: [{ label: "Jan", value: 0, parts: [3, 2] }, { label: "Feb", value: 0, parts: [4, 1] }] })]);
    expect(html).toContain("Web");
    expect(html).toContain("App");
    expect((html.match(/<s /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("draws each form field kind as the input it is", () => {
    const fields = [
      { label: "Size", kind: "radio", options: ["Small", "Large"] },
      { label: "Extras", kind: "checkbox", options: ["Gift wrap", "Insurance"], value: "Insurance" },
      { label: "Boxes", kind: "number", value: "2" },
      { label: "Amount", kind: "currency", value: "PKR 25,000" },
      { label: "Code", kind: "otp" },
      { label: "Mobile", kind: "phone", value: "+92 300 1234567" },
      { label: "City", kind: "search", options: ["Lahore", "Karachi"] },
      { label: "Radius", kind: "slider", options: ["0 km", "50 km"], value: "20 km" },
      { label: "Card", kind: "card" },
    ];
    const html = demo([{ type: "form", fields, submit: "Book" }]);
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("data-step");
    expect(html).toContain("PKR");
    expect(html).toContain('type="tel"');
    expect(html).toContain("<datalist");
    expect(html).toContain('type="range"');
    expect(html).toContain('data-suf=" km"');
    expect(html).not.toMatch(/4[0-9]{3} ?[0-9]{4} ?[0-9]{4} ?[0-9]{4}/); // no card number, only a placeholder
  });
  it("sorts a table by its column, and shows the bulk bar with rows ticked on a busy day", () => {
    const table = { type: "table", columns: ["Order", "Total"], sortBy: 1, sortDir: "desc", bulk: ["Export"], rows: [["A-1", "PKR 900"], ["A-2", "PKR 12,000"], ["A-3", "PKR 1.2k"]] };
    const html = demo([table]);
    expect(html.indexOf("A-2")).toBeLessThan(html.indexOf("A-3"));
    expect(html.indexOf("A-3")).toBeLessThan(html.indexOf("A-1"));
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('class="ck"');
  });
  it("ticks two rows and shows the bulk bar on the busy day only", () => {
    const table = { type: "table", columns: ["Order", "Total"], bulk: ["Export"], rows: [["A-1", "PKR 900"], ["A-2", "PKR 1,200"], ["A-3", "PKR 300"]] };
    const html = buildDemo({ title: "Kargo", flow: "f", requirements: {}, noScreen: [], screens: [{ id: "S-1", route: "/s", file: "a.tsx", reqs: [], states: [], size: "new", frames: [],
      mock: { title: "Orders", copy: {}, blocks: [table] }, mockFull: { title: "Orders", copy: {}, blocks: [{ ...table, rows: [...table.rows, ["A-4", "PKR 50"]] }] } }] as never });
    expect((html.match(/class="picked"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/<div class="bulk">/);
    expect(html).toMatch(/<div class="bulk" hidden>/);
  });
  it("names an even split so the timeline's styles never reach it", () => {
    const html = demo([chart({ kind: "bar", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }] }), chart({ kind: "donut", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }] })]);
    expect(html).toContain('class="split eq"');
    expect(html).not.toContain('class="split ev"');
  });
  it("checks a chart's numbers fit its kind", () => {
    const base = { title: "Kargo", flow: "f", app: undefined, mapping: { unmappedReqs: [], orphanScreens: [] } };
    const fails = (c: Record<string, unknown>) => designQuality({ ...base, screens: [{ id: "S-1", route: "/s", file: "a", reqs: ["R-1"], states: ["loading"], size: "new", frames: [], mock: { title: "Home", copy: {}, blocks: [chart(c)] } }] } as never, {} as never).map((f) => f.check);
    expect(fails({ kind: "stacked", series: ["A", "B"], points: [{ label: "Jan", value: 0, parts: [1] }, { label: "Feb", value: 0, parts: [1, 2] }] })).toContain("design-chart");
    expect(fails({ kind: "donut", points: [{ label: "Only", value: 1 }] })).toContain("design-chart");
    expect(fails({ kind: "progress", points: [{ label: "Goal", value: 140 }] })).toContain("design-chart");
    expect(fails({ kind: "gauge", max: 100, points: [{ label: "Fuel", value: 120 }] })).toContain("design-chart");
    expect(fails({ kind: "gauge", max: 850, points: [{ label: "Score", value: 720 }] })).not.toContain("design-chart");
  });
});
