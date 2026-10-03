// Common controls (design template 20): buttons with variants and states, the richer fields, field details, alert, toolbar,
// progress, working paging, popovers and tooltips, avatar groups, the Components page, the a11y check and their UI points.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDemo, buttonHtml, COMPONENTS_ID } from "./demo.js";
import { a11yFit, DesignOut } from "../stages/design.js";
import { MockBlock, ScreenMock, btnLabels } from "../contracts/artifacts.js";
import { pageLabels } from "./locale.js";
import { contrast, contrastIssues, palette } from "./palette.js";
import { screenUi } from "../estimate/ui-complexity.js";
import { findChromium } from "./screenshots.js";

const page = (blocks: unknown[], more: Record<string, unknown> = {}) => ScreenMock.parse({ title: "Team", blocks, ...more });
const demo = (blocks: unknown[], more: Record<string, unknown> = {}, states = ["default", "validation"]) =>
  buildDemo({ title: "Acme", flow: "f", screens: [{ id: "S-1", route: "/team", file: "x.tsx", reqs: [], states, size: "new", frames: [], mock: page(blocks, more) }], requirements: {}, noScreen: [] } as never);
const product = (html: string) => html.split(`id="${COMPONENTS_ID}"`)[0]!;

describe("buttons", () => {
  it("accepts a plain label or a button with its variant, icon, state, tooltip and menu", () => {
    const b = MockBlock.parse({ type: "actions", buttons: ["Save", { label: "Export", variant: "secondary", menu: ["As PDF", "As CSV"] }, { label: "Delete", variant: "danger", iconOnly: true, hint: "Delete the team" }] });
    expect(b.type === "actions" && b.buttons.flatMap(btnLabels)).toEqual(["Save", "Export", "As PDF", "As CSV", "Delete"]);
    expect(() => MockBlock.parse({ type: "actions", buttons: [{ label: "X", variant: "huge" }] })).toThrow();
  });
  it("draws each variant, and a disabled or loading button that cannot be pressed", () => {
    expect(buttonHtml("Save", true)).toMatch(/class="btn primary" data-act="act"/);
    expect(buttonHtml("Cancel", false)).toMatch(/class="btn" data-act/);
    expect(buttonHtml({ label: "Remove", variant: "danger" }, false)).toContain('class="btn primary danger"');
    expect(buttonHtml({ label: "Learn more", variant: "link" }, true)).toContain('class="btn link"');
    const off = buttonHtml({ label: "Save", state: "disabled" }, true);
    expect(off).toContain(" disabled");
    expect(off).not.toContain("data-act");
    const busy = buttonHtml({ label: "Saving", state: "loading" }, true);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('class="spin"');
  });
  it("names an icon-only button for screen readers and gives it a tooltip", () => {
    const h = buttonHtml({ label: "Delete", iconOnly: true }, false);
    expect(h).toContain('aria-label="Delete"');
    expect(h).toMatch(/aria-describedby="tip\d+"/);
    expect(h).toContain('role="tooltip"');
  });
  it("draws a split button: the main action, an arrow and a hidden menu of the others", () => {
    const h = buttonHtml({ label: "Export", menu: ["As PDF", "As CSV"] }, false);
    expect(h).toContain('class="splitb"');
    expect(h).toContain('aria-haspopup="menu"');
    expect(h).toMatch(/class="ddm" role="menu" hidden>.*As PDF.*As CSV/);
    expect((h.match(/role="menuitem"/g) ?? []).length).toBe(2);
  });
});

describe("fields", () => {
  const fields = [
    { label: "Password", kind: "password", required: true },
    { label: "Email", kind: "email", value: "ana@x.com", help: "We never share it" },
    { label: "Start", kind: "time", value: "9:30 AM" },
    { label: "Dates", kind: "daterange", value: "Mar 3 - Mar 9" },
    { label: "Tags", kind: "multiselect", options: ["Design", "Build"], value: "Design" },
    { label: "Country", kind: "combobox", options: ["Peru", "Portugal"] },
    { label: "Plan", kind: "text", value: "Gold", disabled: true },
    { label: "Id", kind: "text", value: "A-1", readOnly: true, hint: "Set by the system" },
    { label: "I agree to the terms", kind: "consent", required: true },
  ];
  const html = product(demo([{ type: "form", submit: "Save", fields: fields.slice(0, 5) }, { type: "form", submit: "Send", fields: fields.slice(5) }]));
  it("draws each new kind as its own control", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain("data-pw");
    expect(html).toContain('type="email"');
    expect(html).toContain('value="09:30"');
    expect(html).toContain('class="aff dr"');
    expect(html).toMatch(/data-cbx[^>]*>.*class="mc">Design/);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("wide consent");
  });
  it("marks required fields, links help to the control, and locks disabled and read-only ones", () => {
    expect(html).toContain('class="req"');
    expect(html).toMatch(/aria-describedby="f\d+h"/);
    expect(html).toContain("We never share it");
    expect(html).toMatch(/class="field off"[^]*? disabled/);
    expect(html).toContain(" readonly");
    expect(html).toContain("Set by the system");
    expect(html).toContain(" novalidate");
  });
  it("flags the required empty fields in the validation state, never a disabled one", () => {
    const val = html.split('data-wf="1"')[1]!;
    expect(val).toContain("Enter password");
    expect(val).toContain("Tick this to continue");
    expect(val).not.toMatch(/class="field bad off"/);
    const told = product(demo([{ type: "form", submit: "Save", fields: [{ label: "Name", kind: "text", value: "x" }, { label: "IBAN", kind: "text", value: "PK00", error: "That IBAN is not valid" }] }]));
    expect(told.split('data-wf="1"')[1]).toContain("That IBAN is not valid");
  });
});

describe("blocks", () => {
  it("draws an alert, a toolbar with dropdowns, and progress bars", () => {
    const html = product(demo([
      { type: "alert", tone: "warn", title: "Two invoices are late", text: "Send a reminder today.", action: "Remind" },
      { type: "toolbar", search: "Search people", selects: [{ label: "Role", options: ["All", "Admin"] }], buttons: [{ label: "Columns", iconOnly: true }] },
      { type: "table", columns: ["Name", "Role"], rows: [["Ana", "Admin"], ["Bo", "Editor"], ["Cy", "Viewer"]], pages: 8, page: 3 },
      { type: "progress", title: "Setup", items: [{ label: "Profile", value: 80 }] },
    ]));
    expect(html).toContain('class="banner warn alert" role="alert"');
    expect(html).toContain("Send a reminder today.");
    expect(html).toContain('class="tbar"');
    expect(html).toContain('class="tsel"');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="80"/);
    // the toolbar sits on the table it filters
    expect(html).toMatch(/class="card tbl"><div class="toolbar"><div data-b="toolbar" class="tbar"/);
    expect(html).toContain('data-pages="8"');
    expect(html).toContain('aria-current="page" aria-label="Page 3"');
    expect(html).toContain('<b class="pn">3</b> of 8');
  });
  it("keeps one-page tables as they were", () => {
    const html = product(demo([{ type: "table", columns: ["Name"], rows: [["Ana"], ["Bo"], ["Cy"]] }]));
    expect(html).not.toContain("data-pages");
    expect(html).toContain("3 results");
  });
  it("draws avatar groups, a page badge and badge rows in details", () => {
    const html = product(demo([
      { type: "list", items: [{ title: "Launch", meta: "Due Fri", badge: "Active", people: ["Ana Lima", "Bo Chen", "Cy Diaz", "Di Eze", "Ed Fox", "Fay Gil", "Gus Ho"] }] },
      { type: "detail", rows: [{ label: "Status", value: "Paid", badge: true }], people: ["Ana Lima"] },
    ], { badge: "Draft" }));
    expect(html).toContain('class="ppl" role="img" aria-label="Ana Lima, Bo Chen');
    expect(html).toContain('class="pmore">+2');
    expect(html).toMatch(/class="tt"><h3>Team<\/h3><span class="badge[^"]*">Draft/);
    expect(html).toMatch(/<dd><span class="badge[^"]*">Paid/);
  });
  it("opens a popover from its button, with no default Done", () => {
    const html = product(demo([{ type: "actions", buttons: ["Filters"] }], { overlays: [{ kind: "popover", trigger: "Filters", title: "Filter", blocks: [{ type: "text", body: "Pick a range" }] }] }, ["default"]));
    expect(html).toContain("k-popover");
    expect(html).not.toMatch(/k-popover[^]*?>Done</);
  });
  it("puts the new words on the page's label list (for translation and the button checks)", () => {
    const words = pageLabels(page([
      { type: "alert", text: "Saved", action: "Undo" },
      { type: "toolbar", selects: [{ label: "Role", options: ["All", "Admin"] }], buttons: [{ label: "Export", menu: ["As PDF", "As CSV"], hint: "Download" }] },
      { type: "progress", items: [{ label: "Profile", value: 10 }] },
    ], { badge: "Beta" }));
    for (const w of ["Saved", "Undo", "Role", "Admin", "Export", "As PDF", "Download", "Profile", "Beta"]) expect(words).toContain(w);
  });
});

describe("Components page", () => {
  const html = demo([{ type: "table", columns: ["Name"], rows: [["Ana"], ["Bo"], ["Cy"]], pages: 3 }, { type: "form", submit: "Go", fields: [{ label: "Tags", kind: "multiselect", options: ["A", "B"] }] }]);
  it("lists the design system apart and draws every button variant in every state", () => {
    expect(html).toContain(`<section class="screen" id="${COMPONENTS_ID}"`);
    expect(html).toContain("<h3>Design system</h3>");
    const kit = html.split(`id="${COMPONENTS_ID}"`)[1]!;
    for (const st of ["Default", "Hover", "Focus", "Pressed", "Disabled", "Loading"]) expect(kit).toContain(`class="kh">${st}<`);
    for (const v of ["Primary", "Secondary", "Ghost", "Danger", "Link"]) expect(kit).toContain(`class="kl">${v}<`);
    expect(kit).toContain("btn is-hover");
    expect(kit).toContain('aria-busy="true"');
    expect(kit).toContain('class="splitb"');
    // the fields a page uses are shown too, with the colours
    expect(kit).toContain("data-cbx");
    expect(kit).toContain('class="kswatch"');
    expect(kit).toContain('data-pages="6"');
  });
  it("is left out when no page is drawn", () => {
    const none = buildDemo({ title: "A", flow: "f", screens: [{ id: "S-1", route: "/", file: "x", reqs: [], states: [], size: "new", frames: [] }], requirements: {}, noScreen: [] } as never);
    expect(none).not.toContain(`id="${COMPONENTS_ID}"`);
  });
});

describe("accessibility", () => {
  it("keeps every text colour readable on the page, cards and raised grey, in both modes", () => {
    for (const brand of ["#1a56db", "#ffe066", "#0b0b2a", "#22c55e", "#f97316", "#a855f7"]) for (const mode of ["light", "dark"] as const) for (const neutral of ["cool", "warm", "pure"] as const) {
      const p = palette({ brand, mode, neutral });
      for (const on of ["bg", "sf", "sf2"]) for (const k of ["ink", "ink2", "mut", "a1", "ok", "bad", "warn", "info"]) expect(contrast(p[k]!, p[on]!), `${brand} ${mode} ${neutral} ${k} on ${on}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastIssues(p, mode).filter((i) => i.text !== "on"), `${brand} ${mode}`).toEqual([]);
    }
  });
  it("reports a pair too faint to read, once at its worst", () => {
    const p = { ...palette({ brand: "#1a56db", mode: "light", neutral: "cool" }), mut: "#bbbbbb" };
    const got = contrastIssues(p, "light");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ text: "mut", need: 4.5 });
  });
  it("asks for a label on every field and button", () => {
    const out = DesignOut.parse({ flow: "f", noScreen: [], screens: [{ id: "S-1", route: "/", file: "x", reqs: [], states: [], size: "new", mock: { title: "Team", blocks: [{ type: "form", submit: "Go", fields: [{ label: " ", kind: "text" }] }, { type: "actions", buttons: [{ label: "", iconOnly: true }] }] } }] });
    const got = a11yFit(out).map((x) => x.message);
    expect(got.some((m) => m.includes("has no label") && m.includes("field"))).toBe(true);
    expect(got.some((m) => m.includes("A button in the actions"))).toBe(true);
  });
});

describe("UI points", () => {
  it("counts the richer fields, validation, paging, toolbars, split buttons and avatar groups", () => {
    const ui = screenUi({ mock: page([
      { type: "form", submit: "Go", fields: [{ label: "Pw", kind: "password", required: true }, { label: "Tags", kind: "multiselect", options: ["A", "B"] }] },
      { type: "table", columns: ["A"], rows: [["1"], ["2"], ["3"]], pages: 4 },
      { type: "toolbar", selects: [{ label: "Role", options: ["A", "B"] }], buttons: [{ label: "Export", menu: ["PDF", "CSV"] }] },
      { type: "list", items: [{ title: "x", meta: "y", people: ["Ana", "Bo"] }] },
      { type: "alert", text: "Hi" },
    ]) });
    const all = ui.drivers.join(" | ");
    for (const w of ["password with show/hide", "multi-select with chips", "field validation", "table with paging", "toolbar with 1 dropdown and a split button", "avatar groups", "inline alert"]) expect(all).toContain(w);
  });
});

describe("in a browser", () => {
  const app = (phone: boolean) => buildDemo({
    title: "Acme", flow: "f", requirements: {}, noScreen: [], theme: phone ? { shell: "tabs", reading: { device: "phone" } } : undefined,
    screens: [{ id: "S-1", route: "/team", file: "x", reqs: [], states: ["default"], size: "new", frames: [], mock: page([
      { type: "actions", buttons: ["Invite", { label: "Export", variant: "secondary", menu: ["As CSV", "As PDF"] }, { label: "Settings", iconOnly: true }] },
      { type: "table", columns: ["Name", "Role"], rows: [["Ana", "Admin"], ["Bo", "Editor"], ["Cy", "Viewer"]], pages: 12, page: 2 },
      { type: "form", submit: "Save", fields: [{ label: "Password", kind: "password", value: "x" }, { label: "Teams", kind: "multiselect", options: ["Design", "Build", "Ship"], value: "Design" }, { label: "Country", kind: "combobox", options: ["Peru", "Portugal", "Poland"] }, { label: "Email", kind: "email", hint: "Work address" }] },
    ]) }],
  } as never);
  const dir = mkdtempSync(join(tmpdir(), "ctl-"));
  const open = async (phone: boolean) => {
    const { chromium } = await import("playwright-core");
    const f = join(dir, `${phone}.html`);
    writeFileSync(f, app(phone));
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    const p = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${pathToFileURL(f).href}#S-1`);
    return { browser, p, errors, pane: p.locator("#S-1 .pane:not([hidden])") };
  };

  it.skipIf(!findChromium())("opens split menus, pages tables, shows passwords and picks from comboboxes", async () => {
    const { browser, p, errors, pane } = await open(false);
    try {
      await pane.locator("[data-dd]").click();
      expect(await pane.locator(".ddm").isVisible()).toBe(true);
      await p.locator("aside h1").click();
      expect(await pane.locator(".ddm").isVisible()).toBe(false);
      await pane.locator('[data-page="next"]').click();
      expect(await pane.locator(".pg.on").textContent()).toBe("3");
      expect(await pane.locator(".pn").textContent()).toBe("3");
      await pane.locator('[data-page="12"]').click();
      expect(await pane.locator('[data-page="next"]').isDisabled()).toBe(true);
      await pane.locator("[data-pw]").click();
      expect(await pane.locator(".pw input").getAttribute("type")).toBe("text");
      const multi = pane.locator("[data-cbx].multi");
      await multi.locator("input").click();
      await multi.locator(".lb li", { hasText: "Ship" }).click();
      expect(await multi.locator(".mc").allTextContents()).toEqual(["Design", "Ship"]);
      await multi.locator(".mc", { hasText: "Design" }).locator("[data-unchip]").click();
      expect(await multi.locator(".mc").allTextContents()).toEqual(["Ship"]);
      const combo = pane.locator("[data-cbx]:not(.multi)");
      await combo.locator("input").fill("po");
      expect(await combo.locator(".lb li:not(.no)").allTextContents()).toEqual(["Portugal", "Poland"]);
      await combo.locator(".lb li", { hasText: "Poland" }).click();
      expect(await combo.locator("input").inputValue()).toBe("Poland");
      await combo.locator("input").click();
      await p.keyboard.press("Escape");
      expect(await combo.locator(".lb").isVisible()).toBe(false);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);

  it.skipIf(!findChromium())("gives every control on a phone a 44px touch target", async () => {
    const { browser, p, errors } = await open(true);
    try {
      const small = await p.evaluate(() => [...document.querySelectorAll("#S-1 .pane:not([hidden]) :is(button,input:not([type=checkbox]):not([type=radio]),select)")]
        .map((e) => (e.matches("input") && e.parentElement!.matches(".search,.aff,.cbx") ? e.parentElement! : e))
        .filter((e) => {
          const r = e.getBoundingClientRect(), a = getComputedStyle(e, "::after"), grown = a.content !== "none" && a.position === "absolute";
          const w = Math.max(r.width, grown ? parseFloat(a.width) || 0 : 0), h = Math.max(r.height, grown ? parseFloat(a.height) || 0 : 0);
          return r.width > 0 && r.height > 0 && (w < 44 || h < 44);
        }).map((e) => `${e.tagName}.${e.className} ${e.textContent?.trim() || e.getAttribute("aria-label")}`));
      expect(small).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);
});
