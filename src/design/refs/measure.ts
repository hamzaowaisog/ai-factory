// Read a brand's real colours from its live page (run this where the sites are reachable). Writes an
// overlay (~/.factory/design-refs/measured.json) that the reference brief prefers over the reported values.
import { findChromium } from "../../estimate/screenshots.js";
import type { RefBrand } from "./data.js";
import { allIndustries, saveMeasured, type Measured } from "./index.js";

export type Reading = Omit<Measured, "measuredAt">;

/** Runs inside the page. Pure DOM reads; no network. */
export function readPage(): Reading {
  const hex = (css: string): string | undefined => {
    const m = css.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (!m) return undefined;
    if (m[4] !== undefined && Number(m[4]) < 0.5) return undefined;
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  };
  const isNeutral = (h: string): boolean => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    return Math.max(r, g, b) - Math.min(r, g, b) < 24;
  };
  // the first non-transparent background of an element, walking up
  const bgOf = (el: Element | null): string | undefined => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const h = hex(getComputedStyle(e).backgroundColor);
      if (h) return h;
    }
    return undefined;
  };
  const visible = (el: Element): boolean => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20; };
  const out: Reading = {};
  const tc = document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "";
  const tcHex = tc.startsWith("#") && tc.length === 7 ? tc : hex(tc);
  if (tcHex) out.themeColor = tcHex.toLowerCase();
  const header = document.querySelector("header, [role=banner], nav");
  const hb = header ? bgOf(header) : undefined;
  if (hb) out.headerBg = hb;
  const pb = bgOf(document.body) ?? bgOf(document.documentElement);
  if (pb) out.pageBg = pb;
  // the most prominent filled, non-grey button: the largest by area
  let best: { el: Element; area: number; bg: string } | undefined;
  for (const el of document.querySelectorAll("button, a[role=button], a.button, a.btn, input[type=submit], [class*=btn], [class*=Button]")) {
    if (!visible(el)) continue;
    const bg = hex(getComputedStyle(el).backgroundColor);
    if (!bg || isNeutral(bg)) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (!best || area > best.area) best = { el, area, bg };
  }
  if (best) {
    out.buttonBg = best.bg;
    const rad = parseFloat(getComputedStyle(best.el).borderTopLeftRadius);
    if (Number.isFinite(rad)) out.buttonRadiusPx = Math.round(rad);
  }
  const ff = getComputedStyle(document.body).fontFamily.split(",")[0]?.replace(/["']/g, "").trim();
  if (ff) out.font = ff;
  // brand: the theme colour when it is a real hue, else the button, else the header
  const pick = [out.themeColor, out.buttonBg, out.headerBg].find((c) => c && !isNeutral(c));
  if (pick) out.brand = pick;
  return out;
}

export interface MeasureResult { id: string; name: string; reading?: Measured; error?: string }

/** Open each brand page at a phone width and read it. Never throws; a blocked or slow site is an error row. */
export async function measureBrands(brands: RefBrand[], opts: { timeoutMs?: number; url?: (b: RefBrand) => string } = {}): Promise<{ results: MeasureResult[]; note?: string }> {
  const exe = findChromium();
  if (!exe) return { results: [], note: "no browser found (set FACTORY_CHROMIUM to a Chromium binary)" };
  const results: MeasureResult[] = [];
  let browser: { close(): Promise<void>; newContext(o: object): Promise<any> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    for (const b of brands) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.setDefaultTimeout(opts.timeoutMs ?? 20_000);
      try {
        await page.goto(opts.url?.(b) ?? b.site, { waitUntil: "load" });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const reading = (await page.evaluate(readPage)) as Reading;
        results.push({ id: b.id, name: b.name, reading: { ...reading, measuredAt: new Date().toISOString() } });
      } catch (e) {
        results.push({ id: b.id, name: b.name, error: (e instanceof Error ? e.message : String(e)).split("\n")[0]! });
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
    return { results };
  } catch (e) {
    return { results, note: `measuring stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}

/** Brands of the named industries (all when none given). */
export function brandsFor(industryIds: string[] = []): RefBrand[] {
  return allIndustries().filter((i) => !industryIds.length || industryIds.includes(i.id)).flatMap((i) => i.brands);
}

/** Measure and store every reading that found a brand colour. */
export async function measureAndSave(industryIds: string[] = [], path?: string): Promise<{ results: MeasureResult[]; saved: number; note?: string }> {
  const r = await measureBrands(brandsFor(industryIds));
  const good = r.results.filter((x) => x.reading?.brand);
  if (good.length) saveMeasured(Object.fromEntries(good.map((x) => [x.id, x.reading!])), path);
  return { ...r, saved: good.length };
}

/**
 * Before the design step briefs a field, read the live pages of its top brands, every time, so the colours the design is checked
 * against are today's. Silent and best effort: it prints nothing, a missing browser, no network or a slow site keeps the reported
 * values, and a hard cap means the pipeline never waits on it for long. Off with FACTORY_DESIGN_LIVE_REFS=0.
 */
export async function ensureMeasured(industryIds: string[], opts: { path?: string; max?: number; capMs?: number } = {}): Promise<{ measured: number; note?: string }> {
  if (process.env.FACTORY_DESIGN_LIVE_REFS === "0" || process.env.VITEST) return { measured: 0, note: "live reference reading is off" };
  const todo = brandsFor(industryIds).slice(0, opts.max ?? 4);
  if (!todo.length) return { measured: 0 };
  const cap = new Promise<{ results: MeasureResult[]; note: string }>((res) => setTimeout(() => res({ results: [], note: "live reading timed out" }), opts.capMs ?? 45_000).unref());
  const r = await Promise.race([measureBrands(todo, { timeoutMs: 10_000 }), cap]);
  const good = r.results.filter((x) => x.reading?.brand);
  if (good.length) saveMeasured(Object.fromEntries(good.map((x) => [x.id, x.reading!])), opts.path);
  return { measured: good.length, ...(r.note ? { note: r.note } : {}) };
}
