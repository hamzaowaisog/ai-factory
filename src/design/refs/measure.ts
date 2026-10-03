// Read a brand's real colours from its live page (run this where the sites are reachable). Writes an
// overlay (~/.factory/design-refs/measured.json) that the reference brief prefers over the reported values.
import { findChromium } from "../screenshots.js";
import type { RefBrand } from "./data.js";
import { allIndustries, loadMeasured, saveMeasured, type Measured } from "./index.js";
import { colourGap } from "./fit.js";

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

/**
 * A reading worth trusting over the reported colour: close in hue (60 degrees) to the reported brand or accent, or, for a brand
 * that really changed colour, backed by two of its own signals (theme colour, main button, header) that agree with each other.
 * A cookie banner or a promotion button that happens to be the largest coloured thing on the page fails both.
 */
export function plausible(reading: Reading, b: RefBrand): boolean {
  if (!reading.brand) return false;
  if ([b.brand, b.accent].some((c) => c && colourGap(reading.brand!, c) <= 60)) return true;
  const signals = [reading.themeColor, reading.buttonBg, reading.headerBg].filter((c): c is string => !!c && colourGap(c, reading.brand!) <= 20);
  return signals.length >= 2;
}

/** Open each brand page at a phone width and read it. Never throws; a blocked or slow site is an error row. `stop()` ends it early, closing the browser. */
export async function measureBrands(brands: RefBrand[], opts: { timeoutMs?: number; url?: (b: RefBrand) => string; onResult?: (r: MeasureResult) => void; stopped?: () => boolean } = {}): Promise<{ results: MeasureResult[]; note?: string }> {
  const exe = findChromium();
  if (!exe) return { results: [], note: "no browser found (set FACTORY_CHROMIUM to a Chromium binary)" };
  const results: MeasureResult[] = [];
  let browser: { close(): Promise<void>; newContext(o: object): Promise<any> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    for (const b of brands) {
      if (opts.stopped?.()) return { results, note: "stopped at the time limit" };
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.setDefaultTimeout(opts.timeoutMs ?? 20_000);
      let row: MeasureResult;
      try {
        await page.goto(opts.url?.(b) ?? b.site, { waitUntil: "load" });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const reading = (await page.evaluate(readPage)) as Reading;
        row = { id: b.id, name: b.name, reading: { ...reading, measuredAt: new Date().toISOString() } };
      } catch (e) {
        row = { id: b.id, name: b.name, error: (e instanceof Error ? e.message : String(e)).split("\n")[0]! };
      } finally {
        await ctx.close().catch(() => undefined);
      }
      results.push(row);
      opts.onResult?.(row);
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

/** Keep the readings worth trusting; one that disagrees with the brand is turned into an error row and the reported colour stays. */
function keepGood(rows: MeasureResult[], brands: RefBrand[]): { good: MeasureResult[]; rows: MeasureResult[] } {
  const byId = new Map(brands.map((b) => [b.id, b]));
  const out = rows.map((r) => (r.reading && byId.get(r.id) && !plausible(r.reading, byId.get(r.id)!) ? { id: r.id, name: r.name, error: `the reading (${r.reading.brand ?? "no colour"}) disagrees with the brand's known colours, so it was not used (a banner or a promotion is the likely cause)` } : r));
  return { good: out.filter((x) => x.reading?.brand), rows: out };
}

/** Measure and store every reading that found a believable brand colour. */
export async function measureAndSave(industryIds: string[] = [], path?: string): Promise<{ results: MeasureResult[]; saved: number; note?: string }> {
  const brands = brandsFor(industryIds);
  const r = await measureBrands(brands);
  const { good, rows } = keepGood(r.results, brands);
  if (good.length) saveMeasured(Object.fromEntries(good.map((x) => [x.id, x.reading!])), path);
  return { results: rows, saved: good.length, ...(r.note ? { note: r.note } : {}) };
}

/** A reading older than this is read again when its field is designed. */
export const MEASURE_FRESH_DAYS = 7;

/**
 * Before the design step briefs a field, read the live pages of its brands so the colours the design is checked against are current.
 * Each run reads the brands never read, then the ones read longest ago (older than a week), up to `max`; when all are fresh no browser
 * starts. Silent and best effort: a missing browser, no network or a slow site keeps the reported values, every reading is saved as it
 * arrives, and at the time cap the browser is stopped. A field that matched nothing reads nothing. Off with FACTORY_DESIGN_LIVE_REFS=0.
 */
export async function ensureMeasured(industryIds: string[], opts: { path?: string; max?: number; capMs?: number; now?: number } = {}): Promise<{ measured: number; note?: string }> {
  if (process.env.FACTORY_DESIGN_LIVE_REFS === "0" || process.env.VITEST) return { measured: 0, note: "live reference reading is off" };
  if (!industryIds.length) return { measured: 0, note: "no listed field matched, so there are no brands to read" };
  const known = loadMeasured(opts.path), now = opts.now ?? Date.now();
  const age = (b: RefBrand) => { const t = Date.parse(known[b.id]?.measuredAt ?? ""); return Number.isFinite(t) ? now - t : Infinity; };
  const todo = brandsFor(industryIds).filter((b) => age(b) > MEASURE_FRESH_DAYS * 86_400_000).sort((a, b) => age(b) - age(a)).slice(0, opts.max ?? 4);
  if (!todo.length) return { measured: 0, note: "every brand of this field was read in the last week" };
  let stop = false, saved = 0;
  const onResult = (row: MeasureResult) => {
    const { good } = keepGood([row], todo);
    if (good.length) { saveMeasured({ [row.id]: good[0]!.reading! }, opts.path); saved++; }
  };
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<{ note: string }>((res) => { timer = setTimeout(() => { stop = true; res({ note: "live reading timed out" }); }, opts.capMs ?? 45_000); timer.unref(); });
  const r = await Promise.race([measureBrands(todo, { timeoutMs: 10_000, onResult, stopped: () => stop }), cap]);
  clearTimeout(timer);
  return { measured: saved, ...(r.note ? { note: r.note } : {}) };
}
