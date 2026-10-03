import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the test config turns screenshots off everywhere else; these tests are about the real browser
const offBefore = process.env.FACTORY_NO_SCREENSHOTS;
beforeAll(() => { delete process.env.FACTORY_NO_SCREENSHOTS; });
afterAll(() => { if (offBefore !== undefined) process.env.FACTORY_NO_SCREENSHOTS = offBefore; });
import { findChromium } from "./screenshots.js";
import { pixelDiff } from "./pixeldiff.js";

const browser = findChromium();

async function shoot(dir: string, name: string, html: string, size = { width: 200, height: 100 }): Promise<string> {
  const { chromium } = await import("playwright-core");
  const b = await chromium.launch({ executablePath: browser!, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage({ viewport: size });
    await page.setContent(html);
    const file = join(dir, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  } finally { await b.close(); }
}

describe.skipIf(!browser)("pixel diff", () => {
  it("counts changed pixels, draws the diff, and flags a size change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pixel-"));
    const box = (c: string, w = 100) => `<body style="margin:0;background:#fff"><div style="width:${w}px;height:50px;background:${c}"></div></body>`;
    const a = await shoot(dir, "a", box("#2255cc"));
    const same = await shoot(dir, "same", box("#2255cc"));
    const moved = await shoot(dir, "moved", box("#cc5522"));
    const wide = await shoot(dir, "wide", box("#2255cc"), { width: 300, height: 100 });
    const r = await pixelDiff([
      { name: "same", base: a, final: same, out: join(dir, "d1.png") },
      { name: "moved", base: a, final: moved, out: join(dir, "d2.png") },
      { name: "wide", base: a, final: wide, out: join(dir, "d3.png") },
      { name: "missing", base: a, final: join(dir, "nope.png"), out: join(dir, "d4.png") },
    ]);
    expect(r.note).toBeUndefined();
    const by = Object.fromEntries(r.results.map((x) => [x.name, x]));
    expect(by.same!.differing).toBe(0);
    expect(by.moved!.ratio).toBeCloseTo(0.25, 2); // a 100x50 box on a 200x100 page
    expect(by.moved!.sizeChanged).toBe(false);
    expect(by.wide!.sizeChanged).toBe(true);
    expect(by.wide!.differing).toBeGreaterThan(0);
    expect(by.missing).toBeUndefined();
    expect(existsSync(join(dir, "d2.png"))).toBe(true);
  }, 60_000);

  it("reports a picture that is not a PNG instead of throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pixel-"));
    const bad = join(dir, "bad.png");
    writeFileSync(bad, "not an image");
    const r = await pixelDiff([{ name: "bad", base: bad, final: bad, out: join(dir, "d.png") }]);
    expect(r.results).toEqual([]);
    expect(r.note).toMatch(/comparison stopped at bad/);
  }, 60_000);
});
