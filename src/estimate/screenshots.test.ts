import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the test config turns screenshots off everywhere else; these tests are about the real browser
const offBefore = process.env.FACTORY_NO_SCREENSHOTS;
beforeAll(() => { delete process.env.FACTORY_NO_SCREENSHOTS; });
afterAll(() => { if (offBefore !== undefined) process.env.FACTORY_NO_SCREENSHOTS = offBefore; });
import { buildDemo } from "./demo.js";
import { captureDemo, findChromium, LAYOUT_CHECK } from "./screenshots.js";

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

  it.skipIf(!findChromium())("takes each screen in each state at phone and desktop width", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    const out = join(d, "shots");
    const r = await captureDemo(f, screens, out);
    expect(r.note).toBeUndefined();
    // S-1 has two states, S-2 none listed (one "default"): 3 per width
    expect(r.shots.map((s) => s.file).sort()).toEqual(["s-1-default-desktop.png", "s-1-default-phone.png", "s-1-error-desktop.png", "s-1-error-phone.png", "s-2-default-desktop.png", "s-2-default-phone.png"]);
    for (const s of r.shots) { expect(existsSync(join(out, s.file))).toBe(true); expect(statSync(join(out, s.file)).size).toBeGreaterThan(500); }
    expect(readdirSync(out)).toHaveLength(6);
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
});
