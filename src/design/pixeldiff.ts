// Pixel comparison of two screenshots (docs/design-step.md, "Pixel diff"). No image library: Chromium is already
// here for the screenshots, so the two PNGs are drawn onto canvases in a blank page and compared there. A pixel
// counts as different when any colour channel moves by more than `tolerance`, which absorbs anti-aliasing noise.
// The result is a ratio plus a diff image (the new picture faded, changed pixels in red). Differences are facts
// for a person to look at, not a pass or fail: a change request is meant to change pixels.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findChromium } from "./screenshots.js";

export interface PixelPair { name: string; base: string; final: string; out: string }
export interface PixelResult { name: string; differing: number; total: number; ratio: number; sizeChanged: boolean; base: { w: number; h: number }; final: { w: number; h: number }; diff?: string }
export interface PixelRun { results: PixelResult[]; note?: string }

export const DEFAULT_TOLERANCE = 16;
/** Above this share of changed pixels the report calls it out. Only a label: nothing fails on it. */
export const NOTICEABLE_RATIO = 0.02;

/** Runs inside the page: decode both images, compare, draw the diff. Serialised by Playwright, so it stands alone. */
async function comparePage([a, b, tolerance]: [string, string, number]): Promise<{ differing: number; total: number; base: { w: number; h: number }; final: { w: number; h: number }; diff: string }> {
  const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("image did not decode")); i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const draw = (img: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true })!; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
  const da = draw(ia), db = draw(ib);
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const ox = out.getContext("2d")!;
  const od = ox.createImageData(w, h);
  let differing = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const moved = Math.abs(da.data[i]! - db.data[i]!) > tolerance || Math.abs(da.data[i + 1]! - db.data[i + 1]!) > tolerance || Math.abs(da.data[i + 2]! - db.data[i + 2]!) > tolerance;
    // a pixel outside one of the images (the pages differ in size) counts as different too
    const px = i / 4, x = px % w, y = (px - x) / w;
    const outside = x >= ia.width || y >= ia.height || x >= ib.width || y >= ib.height;
    if (moved || outside) { differing++; od.data[i] = 220; od.data[i + 1] = 38; od.data[i + 2] = 38; od.data[i + 3] = 255; }
    else { od.data[i] = 255 - (255 - db.data[i]!) * 0.25; od.data[i + 1] = 255 - (255 - db.data[i + 1]!) * 0.25; od.data[i + 2] = 255 - (255 - db.data[i + 2]!) * 0.25; od.data[i + 3] = 255; }
  }
  ox.putImageData(od, 0, 0);
  return { differing, total: w * h, base: { w: ia.width, h: ia.height }, final: { w: ib.width, h: ib.height }, diff: out.toDataURL("image/png") };
}

const png = (file: string): string => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

/** Compare pairs of PNGs. Never throws: a missing browser or a picture that won't decode is reported in `note`. */
export async function pixelDiff(pairs: PixelPair[], tolerance = DEFAULT_TOLERANCE): Promise<PixelRun> {
  if (!pairs.length) return { results: [] };
  if (process.env.FACTORY_NO_SCREENSHOTS) return { results: [], note: "screenshots are switched off (FACTORY_NO_SCREENSHOTS)" };
  const exe = findChromium();
  if (!exe) return { results: [], note: "no browser found, so pictures were not compared (set FACTORY_CHROMIUM to a Chromium binary)" };
  const results: PixelResult[] = [];
  let browser: { close(): Promise<void>; newPage(o?: object): Promise<any> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    for (const p of pairs) {
      if (!existsSync(p.base) || !existsSync(p.final)) continue;
      try {
        const r = await page.evaluate(comparePage, [png(p.base), png(p.final), tolerance]);
        mkdirSync(dirname(p.out), { recursive: true });
        writeFileSync(p.out, Buffer.from(r.diff.split(",")[1]!, "base64"));
        results.push({ name: p.name, differing: r.differing, total: r.total, ratio: r.total ? r.differing / r.total : 0, sizeChanged: r.base.w !== r.final.w || r.base.h !== r.final.h, base: r.base, final: r.final, diff: p.out });
      } catch (e) {
        return { results, note: `comparison stopped at ${p.name}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
      }
    }
    return { results };
  } catch (e) {
    return { results, note: `comparison stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}
