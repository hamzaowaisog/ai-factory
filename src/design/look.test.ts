import { describe, expect, it } from "vitest";
import { buildDemo, demoStates, themeCss, toastLabel } from "./demo.js";
import { amountOf, designQuality, domainFit, layoutFixes, modeFit } from "../stages/design.js";
import { MockBlock, ScreenMock } from "../contracts/artifacts.js";
import { englishName, isRtl, localeBrief, localeFit, nativeDigits, nativeName, pageLabels, weekend, weekStart } from "./locale.js";
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
    expect(h).toContain('<div data-b="carousel" class="car k-promo" role="region" aria-roledescription="carousel" aria-label="Offers for you">');
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
    expect(html()).toContain('<div data-b="accordion" class="card acc"><h4>Common questions</h4><details open><summary><span>When are carriers paid?</span>');
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
  const issue = (state: string, viewport: "phone" | "tablet" | "desktop", text = "Reassign carrier to another lane") => ({ screen: '"Shipments" (S-2)', state, viewport, kind: "clipped" as const, text });
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

describe("domain components", () => {
  const blk = (b: Record<string, unknown>) => MockBlock.parse(b);
  const demo = (blocks: unknown[]) => buildDemo({ title: "Kargo", flow: "f", requirements: {}, noScreen: [],
    screens: [{ id: "S-1", route: "/s", file: "a.tsx", reqs: [], states: ["loading"], size: "new", frames: [], mock: { title: "Home", copy: {}, blocks: blocks.map((b) => blk(b as never)) } }] as never });
  const fit = (b: Record<string, unknown>) => domainFit("S-1", blk(b) as never).map((f) => f.message);
  const cal = { type: "calendar", month: "March 2027", startsOn: 0, days: 31 };

  it("draws a month from its first weekday, with marks, closed days and the picked day's free times", () => {
    const html = demo([{ ...cal, picked: 9, off: [7], marks: [{ day: 9, label: "Dentist", tone: "ok" }], times: ["09:00", "09:30", "10:00"], taken: ["09:30"], time: "10:00" }]);
    expect((html.match(/class="cd pad"/g) ?? []).length).toBe(0);
    expect(html).toMatch(/class="cd on" data-day="9"/);
    expect(html).toMatch(/class="cd off[^"]*" data-day="7"[^>]*disabled/);
    expect(html).toContain('<em class="ok">Dentist</em>');
    expect(html).toContain('<span class="sday">Tue 9</span>');
    expect(html).toMatch(/class="slot"[^>]* disabled[^>]*>09:30/);
    expect(html).toMatch(/class="slot on"[^>]*>10:00/);
    expect(demo([{ ...cal, month: "May 2027", startsOn: 5 }]).match(/class="cd pad"/g)?.length).toBe(5);
  });
  it("draws a map with numbered stops and a route, a list beside it in the same order", () => {
    const html = demo([{ type: "map", area: "Gulberg", route: true, pins: [{ label: "Warehouse" }, { label: "Stop 2: Liberty", tone: "warn" }] }]);
    expect(html).toContain('class="rt"');
    expect(html).toMatch(/class="mp info on" data-pin="0"[^>]*><span>1</);
    expect(html).toMatch(/class="mpi" data-pin="1"><span class="mpn warn">2</);
    expect(html).toContain("Gulberg");
  });
  it("draws a gallery as one large picture with thumbnails, or as a grid", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ caption: `Room ${i + 1}` }));
    const hero = demo([{ type: "gallery", items }]);
    expect(hero).toContain("<b>1</b> / 7");
    expect((hero.match(/class="gth/g) ?? []).length).toBe(5);
    expect(hero).toContain('class="gmore">+2<');
    expect(demo([{ type: "gallery", layout: "grid", items }])).toMatch(/class="gal grid"/);
  });
  it("draws uploads by status, a retry only on the failed one", () => {
    const html = demo([{ type: "upload", label: "Lab reports", hint: "PDF or JPG, up to 10 MB", files: [{ name: "cbc.pdf", size: "1.2 MB", status: "done" }, { name: "xray.jpg", size: "4 MB", status: "uploading", progress: 40 }, { name: "scan.png", size: "9 MB", status: "failed" }] }]);
    expect(html).toContain('class="uf done"');
    expect(html).toContain("40%");
    expect((html.match(/data-retry aria/g) ?? []).length).toBe(1);
    expect(html).toContain(">PDF<");
  });
  it("draws a chat on two sides, a live status, quick replies and a box to write in", () => {
    const html = demo([{ type: "chat", with: "Ali Raza", meta: "Online", messages: [{ from: "them", text: "I'm at the gate" }, { from: "me", text: "Coming down" }], quick: ["On my way"] }]);
    expect(html).toContain('class="meta live"');
    expect(html).toContain('class="msg theirs"');
    expect(html).toContain('class="msg mine"');
    expect(html).toContain('class="qrc" data-say>On my way');
    expect(html).toContain('role="log"');
  });
  it("draws a board with counts, people's avatars on cards", () => {
    const html = demo([{ type: "kanban", columns: [{ title: "To do", cards: [{ title: "Fix login", meta: "Sara Khan · Due Fri", badge: "High" }] }, { title: "Done", cards: [] }] }]);
    expect(html).toContain("--cols:2");
    expect(html).toMatch(/<b>To do<\/b><span class="kn">1</);
    expect(html).toContain('draggable="true"');
    expect(html).toContain("Due Fri");
  });
  it("draws plans with both periods' prices and one raised", () => {
    const html = demo([{ type: "plans", periods: ["Monthly", "Yearly"], note: "Save 20%", items: [{ name: "Basic", price: "$9", alt: "$7", per: "/ month", features: ["1 user"], cta: "Choose Basic" }, { name: "Team", price: "$29", alt: "$23", per: "/ month", features: ["10 users"], cta: "Choose Team", featured: true, badge: "Most popular" }] }]);
    expect(html).toContain('data-p0="$29" data-p1="$23"');
    expect(html).toContain('class="card plan ft"');
    expect(html).toContain("Save 20%");
  });
  it("draws ratings with stars filled to the score and the share at each star", () => {
    const html = demo([{ type: "reviews", score: 4.6, count: "1,284 reviews", bars: [70, 18, 7, 3, 2], items: [{ name: "Hina Malik", rating: 5, text: "Quick and kind." }] }]);
    expect(html).toContain("<strong>4.6</strong>");
    expect(html).toContain("--p:92%");
    expect(html).toContain("width:70%");
  });
  it("draws notifications in groups with the unread counted", () => {
    const html = demo([{ type: "notifications", items: [{ title: "Payment received", time: "2m", unread: true, tone: "ok", group: "Today" }, { title: "Policy renewed", time: "Mon", group: "Earlier" }] }]);
    expect(html).toContain('class="kn">1 new');
    expect(html).toContain("<h5>Today</h5>");
    expect(html).toContain('class="nt un"');
    expect(html).toContain("data-readall");
  });
  it("draws results with their filters, the ticked ones as chips", () => {
    const html = demo([{ type: "results", query: "Lahore", count: "214 stays", sort: ["Recommended", "Price"], facets: [{ title: "Type", options: ["Hotel", "Apartment"], picked: ["Hotel"] }, { title: "Price", kind: "range", options: ["PKR 5,000", "PKR 50,000"] }], items: [{ title: "Pearl Continental", meta: "Mall Road · 4.5", price: "PKR 32,000" }] }]);
    expect(html).toContain('data-unpick="Hotel"');
    expect(html).toMatch(/value="Hotel" checked/);
    expect(html).toContain('type="range"');
    expect(html).toContain("data-ftoggle");
    expect(html).toContain('class="rp">PKR 32,000');
  });
  it("draws a comparison with ticks and dashes, the featured one tinted", () => {
    const html = demo([{ type: "compare", cta: "Select", items: [{ name: "Silver" }, { name: "Gold", featured: true }], rows: [{ label: "Dental", values: ["No", "Yes"] }, { label: "Cover", values: ["PKR 1M", "PKR 3M"] }] }]);
    expect(html).toContain('aria-label="Yes"');
    expect(html).toContain('class="no"');
    expect(html).toContain('<th class="ft"><b>Gold</b>');
    expect((html.split('id="components"')[0]!.match(/>Select</g) ?? []).length).toBe(2);
  });
  it("draws a receipt with its lines and the amount due last", () => {
    const html = demo([{ type: "receipt", title: "Invoice INV-2041", status: "Paid", lines: [{ item: "Consultation", qty: "1", amount: "PKR 3,000" }], totals: [{ label: "Subtotal", value: "PKR 3,000" }, { label: "Total", value: "PKR 3,000" }] }]);
    expect(html).toContain('class="due"><dt>Total</dt>');
    expect(html).toContain("<th class=\"n\">Qty</th>");
  });

  it("reads amounts as people write them", () => {
    expect(amountOf("PKR 1,250.50")).toBe(1250.5);
    expect(amountOf("-$5.00")).toBe(-5);
    expect(amountOf("− Rs 300")).toBe(-300);
    expect(amountOf("1.250,00 €")).toBe(1250);
    expect(amountOf("Free")).toBe(0);
    expect(amountOf("n/a")).toBeNaN();
  });
  it("sends back a calendar that is not the real month, or picks a closed day or a taken time", () => {
    expect(fit(cal)).toEqual([]);
    expect(fit({ ...cal, startsOn: 2 }).join()).toMatch(/starts on Monday/);
    expect(fit({ ...cal, month: "Feb 2027", days: 30, startsOn: 0 }).join()).toMatch(/has 28 days/);
    expect(fit({ ...cal, picked: 4, off: [4] }).join()).toMatch(/marked off/);
    expect(fit({ ...cal, picked: 4, times: ["9:00", "9:30"], taken: ["9:00"], time: "9:00" }).join()).toMatch(/is taken/);
    expect(fit({ ...cal, times: ["9:00", "9:30"] }).join()).toMatch(/no "picked"/);
  });
  it("sends back a one-sided chat, a lone route stop, an empty board and plans or comparisons that do not line up", () => {
    expect(fit({ type: "chat", with: "Ali", messages: [{ from: "me", text: "Hi" }, { from: "me", text: "Hello?" }] })).toHaveLength(1);
    expect(fit({ type: "map", route: true, pins: [{ label: "Depot" }] })).toHaveLength(1);
    expect(fit({ type: "kanban", columns: [{ title: "A", cards: [] }, { title: "B", cards: [] }] })).toHaveLength(1);
    const plan = (p: Record<string, unknown>) => ({ name: "A", price: "$9", features: ["x"], cta: "Go", ...p });
    expect(fit({ type: "plans", periods: ["Monthly", "Yearly"], items: [plan({ alt: "$7" }), plan({ name: "B" })] }).join()).toMatch(/"B" has no "alt"/);
    expect(fit({ type: "plans", items: [plan({ featured: true }), plan({ featured: true })] })).toHaveLength(1);
    expect(fit({ type: "compare", items: [{ name: "A" }, { name: "B" }], rows: [{ label: "x", values: ["1", "2"] }, { label: "y", values: ["1", "2", "3"] }] }).join()).toMatch(/"y"/);
    expect(fit({ type: "reviews", score: 4, count: "10", bars: [50, 20, 10, 5, 5], items: [{ name: "A", rating: 4, text: "ok" }] }).join()).toMatch(/add to 90%/);
    expect(fit({ type: "results", count: "3", facets: [{ title: "Type", options: ["A", "B"], picked: ["C"] }], items: [{ title: "x", meta: "y" }] }).join()).toMatch(/"C"/);
  });
  it("sends back a receipt that does not add up", () => {
    const rc = (totals: { label: string; value: string }[]) => fit({ type: "receipt", title: "Receipt", lines: [{ item: "A", amount: "$10.00" }, { item: "B", amount: "$5.00" }], totals });
    expect(rc([{ label: "Subtotal", value: "$15.00" }, { label: "Discount", value: "$2.00" }, { label: "Tax", value: "$1.30" }, { label: "Total", value: "$14.30" }])).toEqual([]);
    expect(rc([{ label: "Subtotal", value: "$15.00" }, { label: "Discount", value: "-$2.00" }, { label: "Total", value: "$13.00" }])).toEqual([]);
    expect(rc([{ label: "Total", value: "$15.00" }])).toEqual([]);
    expect(rc([{ label: "Subtotal", value: "$16.00" }, { label: "Total", value: "$16.00" }]).join()).toMatch(/add to 15/);
    expect(rc([{ label: "Subtotal", value: "$15.00" }, { label: "Tax", value: "$1.50" }, { label: "Total", value: "$15.00" }]).join()).toMatch(/make 16.5/);
    expect(rc([{ label: "Subtotal", value: "$15.00" }, { label: "Total", value: "$15.00" }, { label: "Paid", value: "$15.00" }, { label: "Balance due", value: "$0.00" }])).toEqual([]);
    expect(rc([{ label: "Amount", value: "$12.00" }])).toHaveLength(1);
  });
  it("lets links, overlays and toasts start from the components", () => {
    const base = { title: "Kargo", flow: "f", app: undefined, mapping: { unmappedReqs: [], orphanScreens: [] } };
    const plans = blk({ type: "plans", items: [{ name: "A", price: "$9", features: ["x"], cta: "Choose A" }, { name: "B", price: "$19", features: ["y"], cta: "Choose B" }] });
    const board = blk({ type: "kanban", columns: [{ title: "To do", cards: [{ title: "Fix login" }] }, { title: "Done", cards: [] }] });
    const checks = designQuality({ ...base, screens: [
      { id: "S-1", route: "/s", file: "a", reqs: ["R-1"], states: [], size: "new", frames: [], mock: { title: "Pricing", copy: {}, blocks: [plans, board], links: [{ from: "Fix login", to: "S-2" }], overlays: [{ kind: "confirm", trigger: "Choose B", title: "Upgrade?", blocks: [], actions: ["Upgrade"] }], toasts: [{ after: "Choose A", text: "Plan changed", tone: "ok" }] },
        mockFull: { title: "Pricing", copy: {}, blocks: [plans, blk({ ...board, columns: [{ title: "To do", cards: [{ title: "Fix login" }, { title: "Ship" }] }, { title: "Done", cards: [] }] })] } },
      { id: "S-2", route: "/t", file: "b", reqs: ["R-1"], states: [], size: "new", frames: [], mock: { title: "Task", copy: {}, blocks: [blk({ type: "text", body: "x" }), blk({ type: "actions", buttons: ["Save"] })] } },
    ] } as never, {} as never).map((f) => f.check);
    expect(checks).not.toContain("design-link");
    expect(checks).not.toContain("design-overlay-trigger");
    expect(checks).not.toContain("design-toast-trigger");
    expect(checks).not.toContain("design-thin-full-mock");
  });
  it("asks for a busier board on the full-data page", () => {
    const base = { title: "Kargo", flow: "f", app: undefined, mapping: { unmappedReqs: [], orphanScreens: [] } };
    const board = blk({ type: "kanban", columns: [{ title: "To do", cards: [{ title: "Fix login" }] }, { title: "Done", cards: [] }] });
    const checks = designQuality({ ...base, screens: [{ id: "S-1", route: "/s", file: "a", reqs: ["R-1"], states: [], size: "new", frames: [], mock: { title: "Board", copy: {}, blocks: [board, blk({ type: "actions", buttons: ["Add"] })] }, mockFull: { title: "Board", copy: {}, blocks: [board] } }] } as never, {} as never);
    expect(checks.find((c) => c.check === "design-thin-full-mock")?.message).toMatch(/more cards/);
  });
});

describe("languages and markets (right to left, bilingual, local formats)", () => {
  const P = (m: object) => ScreenMock.parse(m);
  const tr = (o: Record<string, string>) => Object.entries(o).map(([from, to]) => ({ from, to }));
  const mock = (extra: object = {}) => P({
    title: "Accounts", copy: {}, crumbs: ["Home"],
    blocks: [
      { type: "stats", items: [{ label: "Balance", value: "Rs 245,300" }, { label: "Bills due", value: "3" }] },
      { type: "table", columns: ["Date", "Payee", "Amount", "Status"], statusColumn: 3, rows: [["12/03/2026", "K-Electric", "Rs 8,450", "Paid"], ["28/02/2026", "PTCL", "Rs 2,999", "Failed"]] },
      { type: "calendar", month: "March 2026", startsOn: 6, days: 31, picked: 12 },
      { type: "actions", buttons: ["Send money"] },
    ],
    tr: tr({ Accounts: "اکاؤنٹس", Home: "ہوم", Balance: "بیلنس", "Bills due": "واجب الادا بل", Date: "تاریخ", Payee: "وصول کنندہ", Amount: "رقم", Status: "حیثیت", Paid: "ادا شدہ", Failed: "ناکام", "March 2026": "مارچ 2026", "Send money": "رقم بھیجیں" }),
    ...extra,
  });
  const screen = (m = mock(), id = "S-1") => ({ id, route: `/${id}`, file: "a.tsx", reqs: [], states: [], size: "new", frames: [], mock: m });
  const urdu = { languages: ["ur", "en"], region: "PK", currency: "PKR", dates: "dmy", digits: "latin" } as const;
  const fit = (loc: object | undefined, screens = [screen()], req = "The app shall be offered in Urdu and English.") => localeFit({ ...(loc ? { locale: loc as never } : {}), screens: screens as never }, req);

  it("knows which languages read right to left, their names, digits and the market's week", () => {
    expect(["ar", "ur", "fa", "he", "ar-SA"].every(isRtl)).toBe(true);
    expect(["en", "fr", "hi", "tr"].some(isRtl)).toBe(false);
    expect([nativeName("ur"), nativeName("ar"), englishName("ur")]).toEqual(["اردو", "العربية", "Urdu"]);
    expect([nativeDigits("ar")[3], nativeDigits("ur")[3], nativeDigits("en")]).toEqual(["٣", "۳", ""]);
    // Monday = 0: Pakistan and the Emirates start on Monday, the US and Saudi Arabia on Sunday, Egypt on Saturday
    expect(["PK", "AE", "GB", "US", "SA", "EG"].map(weekStart)).toEqual([0, 0, 0, 6, 6, 5]);
    expect([weekend("PK"), weekend("SA"), weekend("IR")]).toEqual([[5, 6], [4, 5], [4]]);
  });

  it("accepts a bilingual design whose pages are all translated, in the language's own letters", () => {
    expect(fit(urdu)).toEqual([]);
    // a product in English only needs no locale
    expect(fit(undefined, [screen()], "The user shall pay a bill.")).toEqual([]);
  });

  it("asks for a locale when the requirements name a language, right to left or two languages", () => {
    for (const req of ["The app shall be in Urdu.", "Screens shall support RTL layout.", "The portal shall be bilingual."]) {
      const bad = fit(undefined, [screen()], req);
      expect(bad).toHaveLength(1);
      expect(bad[0]!.message).toMatch(/no "locale"/);
    }
  });

  it("lists the words a page shows with no translation, and catches transliteration", () => {
    const partial = fit(urdu, [screen(mock({ tr: tr({ Accounts: "اکاؤنٹس", Home: "ہوم" }) }))]);
    expect(partial.map((b) => b.message).join(" ")).toMatch(/S-1 has no Urdu for "Balance", "Bills due", "Date"/);
    const latin = fit(urdu, [screen(mock({ tr: mock().tr!.map((t) => ({ from: t.from, to: `${t.from}-o` })) }))]);
    expect(latin.map((b) => b.message).join(" ")).toMatch(/not written in its own letters/);
  });

  it("checks the market's formats: two languages include English, digits 0-9, dates in order, amounts in the currency", () => {
    expect(fit({ ...urdu, languages: ["ur", "ar"] }).map((b) => b.message).join(" ")).toMatch(/English as one of them/);
    const eastern = mock(); (eastern.blocks[0] as { items: { value: string }[] }).items[1]!.value = "۳";
    expect(fit(urdu, [screen(eastern)]).map((b) => b.message).join(" ")).toMatch(/Arabic or Persian digits/);
    expect(fit({ ...urdu, dates: "mdy" }).map((b) => b.message).join(" ")).toMatch(/"28\/02\/2026" are not written month\/day\/year/);
    expect(fit({ ...urdu, currency: "AED" }).map((b) => b.message).join(" ")).toMatch(/Most amounts .* are in PKR, but the product's money .* is AED/);
  });

  it("names every word of a page that needs a translation, and not its data", () => {
    const words = pageLabels(mock());
    expect(words).toEqual(expect.arrayContaining(["Accounts", "Home", "Balance", "Date", "Status", "Paid", "Failed", "Send money"]));
    expect(words).not.toEqual(expect.arrayContaining(["K-Electric", "Rs 8,450", "12/03/2026"]));
  });

  const build = (locale?: object, region = "PK") => buildDemo({
    title: "Sahulat", flow: "f", screens: [screen(), screen(mock({ title: "Book a visit", tr: tr({ "Book a visit": "ملاقات بک کریں" }) }), "S-2")] as never, requirements: {}, noScreen: [],
    ...(locale ? { locale: { ...urdu, region, ...locale } as never } : {}),
  });

  it("draws the canvas in the language it opens in, with the words of every page and the frame's language button", () => {
    const html = build({});
    expect(html).toMatch(/<div class="canvas [^"]*" dir="rtl" lang="ur">/);
    expect(html).toContain('data-lang aria-label="Language"');
    expect(html).toMatch(/data-lang[^>]*>.*?<span>English<\/span><\/button>/);
    const data = JSON.parse(html.match(/<script type="application\/json" id="i18n">(.*?)<\/script>/)![1]!);
    expect(data.langs).toEqual(["ur", "en"]);
    expect(data.dirs).toEqual(["rtl", "ltr"]);
    expect(data.labels).toEqual(["Urdu", "English"]);
    expect(data.pages["S-1"].Balance).toBe("بیلنس");
    // the demo's own words come built in, and every page's title is known to the frame (its navigation names other pages)
    expect(data.words.Search).toBe("تلاش");
    expect(data.words["Book a visit"]).toBe("ملاقات بک کریں");
    // opening in English shows the canvas left to right
    expect(build({ languages: ["en", "ur"] })).toMatch(/<div class="canvas [^"]*" dir="ltr" lang="en">/);
  });

  it("keeps a page in English only free of the language layer", () => {
    const html = build();
    expect(html).not.toContain('id="i18n"');
    expect(html).not.toContain("data-lang aria-label");
    expect(html).not.toMatch(/<div class="canvas [^"]*" dir=/);
  });

  it("cannot break out of the language data with a translation", () => {
    const evil = "</script><script>alert(1)</script>";
    const html = buildDemo({ title: "X", flow: "f", screens: [screen(mock({ tr: tr({ Accounts: evil }) }))] as never, requirements: {}, noScreen: [], locale: urdu as never });
    expect(html).not.toContain(evil);
    expect(html).toContain("\\u003c/script>");
  });

  it("starts the calendar's week on the market's first day and shades its weekend", () => {
    const head = (html: string) => [...html.matchAll(/<span class="cwd">(\w+)<\/span>/g)].slice(0, 7).map((m) => m[1]);
    const pads = (html: string) => (html.match(/<div class="cgrid[^"]*">(?:<span class="cwd">\w+<\/span>)+((?:<span class="cd pad"><\/span>)*)/)![1]!.match(/pad/g) ?? []).length;
    const weekendDays = (html: string) => [...html.matchAll(/class="cd[^"]*\bwe\b[^"]*" data-day="(\d+)"/g)].map((m) => +m[1]!).slice(0, 2);
    // March 2026 starts on a Sunday (startsOn 6)
    const pk = build({});
    expect(head(pk)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(pads(pk)).toBe(6);
    expect(weekendDays(pk)).toEqual([1, 7]);
    const sa = build({ languages: ["ar", "en"] }, "SA");
    expect(head(sa)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(pads(sa)).toBe(0);
    expect(weekendDays(sa)).toEqual([6, 7]);
  });

  it("mirrors through logical properties and flips the icons that point along the reading", () => {
    const css = build({}).match(/<style>([\s\S]*?)<\/style>/)![1]!;
    expect(css).not.toMatch(/[{;\s](?:margin|padding|border)-(?:left|right)\b/);
    expect(css).not.toMatch(/text-align:(?:left|right)/);
    expect(css).toContain("[dir=rtl] svg.fl{scale:-1 1}");
    expect(icon("chevr")).toContain('class="fl"');
    expect(icon("send", "x")).toContain('class="x fl"');
    expect(icon("bell")).not.toContain("class=");
  });

  it("tells the build the languages, direction and market formats", () => {
    const b = localeBrief(urdu as never);
    expect(b).toMatchObject({ opensIn: "ur", region: "PK", currency: "PKR", weekStartsOn: "Monday", weekend: ["Saturday", "Sunday"] });
    expect(b.languages).toEqual([{ code: "ur", name: "Urdu", direction: "rtl" }, { code: "en", name: "English", direction: "ltr" }]);
    expect(String(b.note)).toMatch(/dir="rtl".*logical properties.*Intl\.NumberFormat\("ur-PK", \{ style: "currency", currency: "PKR" \}\)/);
  });
});

describe("tablet width and both colour modes", () => {
  const screens = [{ id: "S-1", route: "/home", file: "a.tsx", reqs: [], states: [], size: "new", frames: [] }];
  const demo = (mode?: "light" | "dark" | "auto") => buildDemo({ title: "Sky", flow: "f", screens: screens as never, requirements: {}, noScreen: [], ...(mode ? { theme: { mode } as never } : {}) });
  it("gives a product in both modes a light/dark switch, and a one-mode product none", () => {
    const both = demo("auto");
    expect(both).toContain('<button type="button" class="ib md" data-mode aria-label="Dark mode">');
    expect(both).toContain('<meta name="color-scheme" content="light dark">');
    expect(both).toContain("window.__mode=setMode");
    for (const one of [demo(), demo("light"), demo("dark")]) expect(one).not.toContain("ib md");
  });
  it("lets the switch override the viewer's setting either way", () => {
    const css = themeCss({ mode: "auto" } as never);
    const at = (sel: string) => css.indexOf(sel);
    expect(at("@media(prefers-color-scheme:dark)")).toBeGreaterThan(0);
    // the picked mode comes after the system's, so it wins
    expect(at(":root[data-mode=light]{color-scheme:light;")).toBeGreaterThan(at("@media(prefers-color-scheme:dark)"));
    expect(at(":root[data-mode=dark]{color-scheme:dark;")).toBeGreaterThan(at("@media(prefers-color-scheme:dark)"));
    expect(themeCss({ mode: "light" } as never)).not.toContain("data-mode");
  });
  it("asks for both modes when the requirements do", () => {
    const req = (ears: string) => modeFit({ theme: { mode: "light" } }, ears);
    for (const ears of ["The app shall offer a dark mode.", "Where the user chooses light or dark, the app shall use it.", "The app shall follow the system appearance.", "The settings page shall have a theme toggle."]) {
      expect(req(ears)).toEqual([{ check: "design-mode", message: expect.stringContaining('Set it to "auto"') }]);
    }
    expect(modeFit({ theme: { mode: "auto" } }, "The app shall offer a dark mode.")).toEqual([]);
    expect(modeFit({}, "The app shall offer a dark mode.")[0]!.message).toContain('"theme.mode" is "light"');
    // a dark look alone is not a second mode
    expect(req("The trading screen shall use a dark theme.")).toEqual([]);
    expect(req("When the order is placed, the system shall confirm it.")).toEqual([]);
  });
  it("names the tablet width in a layout fix", () => {
    const f = layoutFixes([{ screen: "Home", state: "default", viewport: "tablet", kind: "overflow", text: "Revenue" }]);
    expect(f[0]!.message).toContain("default, tablet width");
  });
});
