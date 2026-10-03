import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the test config turns screenshots off everywhere else; these tests are about the real browser
const offBefore = process.env.FACTORY_NO_SCREENSHOTS;
beforeAll(() => { delete process.env.FACTORY_NO_SCREENSHOTS; });
afterAll(() => { if (offBefore !== undefined) process.env.FACTORY_NO_SCREENSHOTS = offBefore; });
import { ScreenMock } from "../contracts/artifacts.js";
import { buildDemo } from "./demo.js";
import { captureDemo, checkDemoLayout, findChromium, LAYOUT_CHECK } from "./screenshots.js";

const screens = [
  { id: "S-1", route: "/pay", file: "app/pay/page.tsx", reqs: ["REQ-1"], states: ["default", "error"], size: "new", frames: [] },
  { id: "S-2", route: "/done", file: "app/done/page.tsx", reqs: ["REQ-1"], states: [], size: "tweak", frames: [] },
];
const html = buildDemo({ title: "Pay", flow: "pay then done", screens, requirements: { "REQ-1": "When paying, the system shall confirm." }, noScreen: [] });
const dir = () => mkdtempSync(join(tmpdir(), "shots-"));

describe("demo screenshots", () => {
  it("say so, and do not throw, when there is no browser or they are switched off", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    process.env.FACTORY_NO_SCREENSHOTS = "1";
    try { expect((await captureDemo(f, screens, join(d, "s"))).note).toMatch(/switched off/); } finally { delete process.env.FACTORY_NO_SCREENSHOTS; }
    const saved = process.env.FACTORY_CHROMIUM;
    process.env.FACTORY_CHROMIUM = join(d, "missing");
    try { const r = await captureDemo(f, screens, join(d, "s")); expect(r.shots).toEqual([]); expect(r.note).toMatch(/no browser/); } finally { if (saved === undefined) delete process.env.FACTORY_CHROMIUM; else process.env.FACTORY_CHROMIUM = saved; }
    expect((await captureDemo(f, [], join(d, "s"))).shots).toEqual([]);
  });

  it.skipIf(!findChromium())("takes each screen in each state at phone and desktop width, and as it first shows on a tablet", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    const out = join(d, "shots");
    const r = await captureDemo(f, screens, out);
    expect(r.note).toBeUndefined();
    // S-1 has two states, S-2 none listed (one "default"): 3 at phone and desktop width, one per screen on the tablet
    expect(r.shots.map((s) => s.file).sort()).toEqual([
      "s-1-default-desktop.png", "s-1-default-phone.png", "s-1-default-tablet.png", "s-1-error-desktop.png", "s-1-error-phone.png",
      "s-2-default-desktop.png", "s-2-default-phone.png", "s-2-default-tablet.png",
    ]);
    for (const s of r.shots) { expect(existsSync(join(out, s.file))).toBe(true); expect(statSync(join(out, s.file)).size).toBeGreaterThan(500); }
    expect(readdirSync(out)).toHaveLength(8);
    // a light-only product has no colour switch and no dark pictures
    expect(r.shots.some((s) => s.state === "Dark mode")).toBe(false);
  }, 60_000);

  it.skipIf(!findChromium())("switches a product in both colour modes to dark and back, and pictures each screen in dark mode", async () => {
    const d = dir(); const f = join(d, "demo.html");
    writeFileSync(f, buildDemo({ title: "Pay", flow: "pay then done", screens, requirements: {}, noScreen: [], theme: { mode: "auto" } as never }));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    // the background eases to its new colour, so wait for it to settle
    const bg = async (p: { evaluate(s: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void> }) => { await p.waitForTimeout(500); return p.evaluate('getComputedStyle(document.querySelector("#S-1 .canvas")).backgroundColor'); };
    const dark = (c: unknown) => { const [r, g, b] = String(c).match(/\d+/g)!.map(Number); return r! + g! + b! < 200; };
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`file://${f}#S-1`);
      expect(dark(await bg(page))).toBe(false);
      const sw = page.locator("#S-1 button[data-mode]");
      expect(await sw.getAttribute("aria-label")).toBe("Dark mode");
      await sw.click();
      expect(dark(await bg(page))).toBe(true);
      expect(await sw.getAttribute("aria-label")).toBe("Light mode");
      await sw.click();
      expect(dark(await bg(page))).toBe(false);
      expect(errors).toEqual([]);
      // a system set to dark opens the page dark
      const night = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
      await night.goto(`file://${f}#S-1`);
      expect(dark(await bg(night))).toBe(true);
    } finally { await browser.close(); }
    const r = await captureDemo(f, screens.map((x) => ({ id: x.id, route: x.route, states: x.states })), join(d, "shots"));
    expect(r.shots.filter((x) => x.state === "Dark mode").map((x) => x.file).sort()).toEqual(["s-1-dark-mode-desktop.png", "s-1-dark-mode-phone.png", "s-2-dark-mode-desktop.png", "s-2-dark-mode-phone.png"]);
  }, 60_000);

  it.skipIf(!findChromium())("checks the layout without taking pictures, and says nothing when it cannot", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    expect(await checkDemoLayout(f, screens)).toEqual([]);
    expect(readdirSync(d)).toEqual(["demo.html"]);
    expect(await checkDemoLayout(f, [])).toBeUndefined();
    process.env.FACTORY_DESIGN_LAYOUT_CHECK = "0";
    try { expect(await checkDemoLayout(f, screens)).toBeUndefined(); } finally { delete process.env.FACTORY_DESIGN_LAYOUT_CHECK; }
  }, 60_000);

  it.skipIf(!findChromium())("finds text past the frame, cut off by its box, or on top of other text", async () => {
    const page = `<!doctype html><body style="margin:0;font:14px sans-serif"><section id="S-1"><div class="canvas" style="width:320px;position:relative;overflow:clip"><div class="pane">
      <div style="width:80px;overflow:hidden;white-space:nowrap">A label far too long for its box</div>
      <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Shortened on purpose with dots</div>
      <div style="overflow-x:auto;width:120px"><div style="width:600px">A row that scrolls sideways on purpose</div></div>
      <div style="position:relative;height:40px"><span>Balance</span><span style="position:absolute;left:4px;top:2px">PKR 182,450</span></div>
      <div style="margin-left:300px;white-space:nowrap">Runs off the edge</div>
    </div></div></section></body>`;
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage({ viewport: { width: 400, height: 400 } });
      await p.setContent(page);
      const found = (await p.evaluate(`${LAYOUT_CHECK}("S-1")`)) as { kind: string; text: string }[];
      expect(found).toEqual(expect.arrayContaining([
        { kind: "clipped", text: "A label far too long for its box" },
        { kind: "overlap", text: "Balance / PKR 182,450" },
        { kind: "overflow", text: "Runs off the edge" },
      ]));
      expect(found.map((f) => f.text).join(" ")).not.toMatch(/Shortened|scrolls sideways/);
    } finally { await browser.close(); }
  }, 30_000);

  it.skipIf(!findChromium())("does not read Urdu's tall Nastaliq letters as text on top of the lines around them", async () => {
    // Nastaliq glyph boxes are about 2.5 times the font size, taller than the line (where the font is installed)
    const page = `<!doctype html><body style="margin:0"><section id="S-1"><div class="canvas" dir="rtl" lang="ur" style="width:360px;font:14px 'Noto Nastaliq Urdu',serif;line-height:1.2"><div class="pane">
      <h3 style="font-size:21px;margin:0">اکاؤنٹس</h3><p style="margin:0">آپ کی رقم ایک نظر میں</p>
      <ul style="margin:0;padding:0;list-style:none"><li>بیلنس</li><li>واجب الادا بل</li><li>اخراجات</li></ul>
      <div style="position:relative"><span>رقم</span><span style="position:absolute;right:2px;top:1px">حیثیت</span></div>
    </div></div></section></body>`;
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage({ viewport: { width: 400, height: 400 } });
      await p.setContent(page);
      // only the two words really drawn on top of each other
      expect(await p.evaluate(`${LAYOUT_CHECK}("S-1")`)).toEqual([{ kind: "overlap", text: "رقم / حیثیت" }]);
    } finally { await browser.close(); }
  }, 30_000);

  it.skipIf(!findChromium())("puts a calendar's times under the month when it sits in a narrow column, beside them when there is room", async () => {
    const cal = { type: "calendar", month: "March 2026", startsOn: 6, days: 31, picked: 12, times: ["10:00", "11:30", "14:00", "15:30"], taken: ["11:30"], time: "14:00" };
    const form = { type: "form", fields: [{ label: "Branch", kind: "select", options: ["Gulberg", "DHA"] }, { label: "Reason", kind: "textarea" }], submit: "Book" };
    const sc = [
      { id: "S-1", route: "/book", file: "a.tsx", reqs: [], states: [], size: "new", frames: [], mock: ScreenMock.parse({ title: "Book a visit", copy: {}, blocks: [cal, form] }) },
      { id: "S-2", route: "/plan", file: "b.tsx", reqs: [], states: [], size: "new", frames: [], mock: ScreenMock.parse({ title: "Plan", copy: {}, blocks: [cal] }) },
    ];
    const d = dir(); const f = join(d, "demo.html");
    writeFileSync(f, buildDemo({ title: "Book", flow: "f", screens: sc as never, requirements: {}, noScreen: [] }));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const below = async (id: string) => { await page.goto(`file://${f}#${id}`); return page.locator(`#${id} .pane:not([hidden]) .cal`).evaluate((c) => c.querySelector(".slots")!.getBoundingClientRect().top >= c.querySelector(".cgrid")!.getBoundingClientRect().bottom); };
      expect(await below("S-1")).toBe(true);
      expect(await below("S-2")).toBe(false);
    } finally { await browser.close(); }
    expect(await checkDemoLayout(f, sc.map((x) => ({ id: x.id, route: x.route, states: [] })))).toEqual([]);
  }, 60_000);
  it.skipIf(!findChromium())("shows a page in the product's other language: translated, mirrored, in native digits, its links and toasts still working", async () => {
    const tr = (o: Record<string, string>) => Object.entries(o).map(([from, to]) => ({ from, to }));
    const mock = {
      title: "Pay", copy: {}, blocks: [{ type: "stats", items: [{ label: "Balance", value: "SAR 1,250.50" }] }, { type: "actions", buttons: ["Pay now", "Details"] }],
      links: [{ from: "Details", to: "S-2" }], toasts: [{ after: "Pay now", text: "Payment sent", tone: "ok" }],
      tr: tr({ Pay: "ادفع", Balance: "الرصيد", "Pay now": "ادفع الآن", Details: "التفاصيل", "Payment sent": "تم الدفع" }),
    };
    const sc = [{ ...screens[0]!, states: [], mock }, { ...screens[1]!, mock: { title: "Done", copy: {}, blocks: [{ type: "text", body: "All paid" }], tr: tr({ Done: "تم" }) } }];
    const d = dir(); const f = join(d, "demo.html");
    writeFileSync(f, buildDemo({ title: "Pay", flow: "f", screens: sc as never, requirements: {}, noScreen: [], locale: { languages: ["en", "ar"], region: "SA", currency: "SAR", dates: "dmy", digits: "native" } as never }));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`file://${f}#S-1`);
      const canvas = page.locator("#S-1 .canvas");
      expect(await canvas.getAttribute("dir")).toBe("ltr");
      expect(await canvas.innerText()).not.toContain("الرصيد");
      await page.locator("#S-1 [data-lang]").click();
      expect([await canvas.getAttribute("dir"), await canvas.getAttribute("lang")]).toEqual(["rtl", "ar"]);
      const text = await canvas.innerText();
      expect(text).toContain("الرصيد");
      expect(text).toContain("ادفع الآن");
      // Arabic digits with Arabic separators; the address bar stays as written
      expect(text).toContain("١٬٢٥٠٫٥٠");
      expect(await page.locator("#S-1 .win").innerText()).toContain("/pay");
      expect(await page.locator("#S-1 [data-lang] span").textContent()).toBe("English");
      // the toast an action shows comes in the language too, mirrored with the page
      await page.locator("#S-1 .pane:not([hidden]) button", { hasText: "ادفع الآن" }).click();
      const toast = page.locator("#S-1 .toast:not(.pin)");
      await toast.waitFor();
      expect([await toast.innerText(), await toast.getAttribute("dir")]).toEqual(["تم الدفع", "rtl"]);
      // a button found by its English label still leads where it did
      await page.locator("#S-1 .pane:not([hidden]) button", { hasText: "التفاصيل" }).click();
      await page.waitForFunction(() => location.hash === "#S-2");
      expect(await page.locator("#S-2 .canvas").innerText()).toContain("تم");
      // and back to English, word for word
      await page.locator("#S-2 [data-lang]").click();
      expect(await page.locator("#S-2 .canvas").innerText()).toContain("Done");
      expect(errors).toEqual([]);
      await page.close();
    } finally { await browser.close(); }
    // the screenshots add each page as it shows in the other language
    const r = await captureDemo(f, sc.map((x) => ({ id: x.id, route: x.route, states: [] })), join(d, "shots"));
    expect(r.shots.filter((x) => x.state === "In Arabic").map((x) => x.file).sort()).toEqual(["s-1-in-arabic-desktop.png", "s-1-in-arabic-phone.png", "s-2-in-arabic-desktop.png", "s-2-in-arabic-phone.png"]);
  }, 60_000);
});
