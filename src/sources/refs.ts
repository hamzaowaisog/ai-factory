// Design references at intake (docs/estimates-design.md, "Design references"): what the user attached
// (any image, a website URL, a Word document) turned into one form by code, before a run exists, so a
// reference that cannot be read costs nothing and never falls back to the library unsaid.
//  - pictures are decoded in Chromium (no image library), stored as PNG with the long edge at most
//    1568 px, and their main colours are sampled (approximate);
//  - a site is opened at phone and desktop width with no cookies: two screenshots, and colours, fonts,
//    corners and shadows from its computed styles (exact);
//  - a Word document gives its images (as pictures) and its text;
//  - a PDF is rendered in Chromium with pdf.js: its first pages as pictures, and its text;
//  - a Figma link is read through the REST API with FIGMA_TOKEN (figma.ts): frames as pictures and the
//    look from its nodes (exact); a Figma JSON export gives the look only.
// Only the URLs the user gives are fetched: https only, private addresses refused unless the project allows them.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import { MAX_REFERENCES, RefRole, type RefColour, type Reference } from "../contracts/reference.js";
import type { Ledger } from "../ledger/ledger.js";
import { findChromium } from "../design/screenshots.js";
import { MAX_IMAGE_BYTES, MAX_PACK_IMAGES } from "../util/image.js";
import { isPrivateAddress, pinnedRequest } from "../util/safe-fetch.js";
import { readDocx } from "./docx.js";
import { FIGMA_DEFAULT_ROLE, figmaLook, readFigmaJson, readFigmaLink, type FigmaDeps } from "./figma.js";
import { MAX_DOCX_BYTES } from "./request.js";

/** What the user gave: a file (from disk or the web form) or a link, with an optional role and note. */
export type RefRequest =
  | { kind: "file"; name: string; bytes: Buffer; role?: RefRole; note?: string }
  | { kind: "url"; url: string; role?: RefRole; note?: string };

/** A reference read at intake, its pictures still in memory (stored with the run by `storeReferences`). */
export type GatheredRef = Omit<Reference, "images"> & { images: { bytes: Buffer; width: number; height: number; label: string }[] };

export class RefIntakeError extends Error {}

/** The long edge a picture is stored at: what Anthropic keeps of an image anyway. */
export const REF_LONG_EDGE = 1568;
export const MAX_REF_FILE_BYTES = 25_000_000;
/** pictures kept from one document (the largest, in document order) */
export const MAX_DOC_IMAGES = 6;
export const MAX_REF_TEXT = 4000;
/** pages of a PDF rendered as pictures (the first ones: a brand guide or a deck shows its look early) */
export const MAX_PDF_PAGES = 6;
const NOTE_MAX = 500;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".avif": "image/avif", ".svg": "image/svg+xml", ".bmp": "image/bmp",
};
const TAKES = "any image (png, jpeg, webp, gif, avif, svg, bmp), a website or Figma link (https), a PDF, a Word document (.docx), or a Figma JSON export";

// ---------- what the user typed ----------

/**
 * One `--ref` value: `[match:|inspire:|layout:]<file or https link>[|note]`.
 * `--ref match:https://client.com`, `--ref "layout:dash.jpg|table like this"`.
 */
export function parseRefArg(arg: string): RefRequest {
  const bar = arg.indexOf("|");
  const head = (bar >= 0 ? arg.slice(0, bar) : arg).trim();
  const note = bar >= 0 ? arg.slice(bar + 1).trim() : "";
  const m = head.match(/^(match|inspire|layout):(.+)$/i);
  const role = m ? RefRole.parse(m[1]!.toLowerCase()) : undefined;
  const target = (m ? m[2]! : head).trim();
  if (!target) throw new RefIntakeError(`--ref "${arg}" names no file or link.`);
  const extra = { ...(role ? { role } : {}), ...(note ? { note } : {}) };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return { kind: "url", url: target, ...extra };
  if (!existsSync(target) || !statSync(target).isFile()) throw new RefIntakeError(`No such file: ${target}`);
  const cap = extname(target).toLowerCase() === ".docx" ? MAX_DOCX_BYTES : MAX_REF_FILE_BYTES;
  if (statSync(target).size > cap) throw new RefIntakeError(`${basename(target)} is over ${cap / 1e6} MB.`);
  return { kind: "file", name: basename(target), bytes: readFileSync(target), ...extra };
}

// ---------- links: only what the user gave, only https, no private addresses ----------

export { isPrivateAddress };

const isFigma = (u: URL) => /(^|\.)figma\.com$/i.test(u.hostname);
const isFigmaLink = (raw: string) => { try { return isFigma(new URL(raw)); } catch { return false; } };

export interface RefDeps {
  /** DNS lookup (tests replace it) */
  resolve?: (host: string) => Promise<string[]>;
  /** answers requests instead of the network (tests) */
  fulfil?: (url: string) => { status: number; body: string; contentType?: string } | undefined;
  /** the browser executable; default: the one the screenshots use */
  chromium?: () => string | undefined;
  /** the Figma API (tests replace its fetch and token) */
  figma?: FigmaDeps;
}

/** The link as a URL the factory may open, or why not. */
export async function checkRefUrl(raw: string, allowPrivate: boolean, deps: RefDeps = {}): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new RefIntakeError(`"${raw.slice(0, 80)}" is not a link.`); }
  if (u.protocol !== "https:") throw new RefIntakeError(`${raw}: only https links are read.`);
  if (u.username || u.password) throw new RefIntakeError(`${u.hostname}: a link with a user name or password in it is not read; attach a screenshot instead.`);
  // a Figma link is read through Figma's API (a fixed public host), never opened in the browser
  if (isFigma(u)) return u;
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new RefIntakeError(`${raw} is a private address; set design.allowPrivateRefs in the project config to allow it, or attach a screenshot.`);
  const addrs = isIP(host) ? [host] : await (deps.resolve ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host).catch(() => {
    throw new RefIntakeError(`${raw}: ${host} could not be found. Check the link, or attach a screenshot.`);
  });
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new RefIntakeError(`${raw} is a private address; set design.allowPrivateRefs in the project config to allow it, or attach a screenshot.`);
  return u;
}

// ---------- in the browser (plain JS, as it is sent to the page) ----------

/** Decode a picture, scale it to the long edge, export PNG under the size cap, and sample its main colours. */
const DECODE = String.raw`(async function(src, maxEdge, maxBytes){
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch (e) { return { error: "not decodable" }; }
  let w = img.naturalWidth || 1200, h = img.naturalHeight || 800;
  const k = Math.min(1, maxEdge / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  let png = "", cw = w, ch = h;
  for (let i = 0; i < 8; i++) {
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, cw, ch); g.drawImage(img, 0, 0, cw, ch);
    png = c.toDataURL("image/png");
    if ((png.length - 22) * 0.75 <= maxBytes) break;
    cw = Math.max(1, Math.round(cw * 0.8)); ch = Math.max(1, Math.round(ch * 0.8));
  }
  const s = Math.min(1, 160 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
  const c2 = document.createElement("canvas"); c2.width = sw; c2.height = sh;
  const g2 = c2.getContext("2d", { willReadFrequently: true }); g2.drawImage(img, 0, 0, sw, sh);
  const d = g2.getImageData(0, 0, sw, sh).data;
  const buckets = new Map(); let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    n++;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = buckets.get(key) || { r: 0, g: 0, b: 0, c: 0 };
    b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; b.c++;
    buckets.set(key, b);
  }
  const list = Array.from(buckets.values()).map(function(b){ return { r: b.r / b.c, g: b.g / b.c, b: b.b / b.c, c: b.c }; }).sort(function(a, b){ return b.c - a.c; });
  const merged = [];
  for (const x of list) {
    const m = merged.find(function(y){ return Math.hypot(y.r - x.r, y.g - x.g, y.b - x.b) < 40; });
    if (m) { const t = m.c + x.c; m.r = (m.r * m.c + x.r * x.c) / t; m.g = (m.g * m.c + x.g * x.c) / t; m.b = (m.b * m.c + x.b * x.c) / t; m.c = t; }
    else merged.push({ r: x.r, g: x.g, b: x.b, c: x.c });
  }
  merged.sort(function(a, b){ return b.c - a.c; });
  const hex = function(v){ return Math.round(v).toString(16).padStart(2, "0"); };
  const colours = n ? merged.filter(function(x){ return x.c / n >= 0.02; }).slice(0, 8).map(function(x){ return { hex: "#" + hex(x.r) + hex(x.g) + hex(x.b), share: Math.round(x.c / n * 1000) / 1000 }; }) : [];
  return { png: png.slice(png.indexOf(",") + 1), width: cw, height: ch, colours: colours };
})`;

/** A site's look from its computed styles: colours by role, fonts, corners, shadows; and whether it asks for a password. */
const STYLES = String.raw`(function(){
  const hex = function(css){
    const m = String(css || "").match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (!m) { const h = String(css || "").trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(h) ? h : undefined; }
    if (m[4] !== undefined && Number(m[4]) < 0.5) return undefined;
    return "#" + [m[1], m[2], m[3]].map(function(n){ return Number(n).toString(16).padStart(2, "0"); }).join("");
  };
  const neutral = function(h){ const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); return Math.max(r, g, b) - Math.min(r, g, b) < 24; };
  const bgOf = function(el){ for (let e = el; e; e = e.parentElement) { const h = hex(getComputedStyle(e).backgroundColor); if (h) return h; } return undefined; };
  const shown = function(el){ const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const colours = [];
  const add = function(role, h){ if (h && !colours.some(function(c){ return c.role === role; })) colours.push({ hex: h, role: role }); };
  add("theme", hex(document.querySelector('meta[name="theme-color"]') && document.querySelector('meta[name="theme-color"]').getAttribute("content")));
  const header = document.querySelector("header, [role=banner], nav");
  if (header) add("header", bgOf(header));
  // nothing painted means the browser's own white
  add("page", bgOf(document.body) || bgOf(document.documentElement) || "#ffffff");
  add("text", hex(getComputedStyle(document.body).color));
  let best, radius;
  for (const el of document.querySelectorAll("button, a[role=button], input[type=submit], [class*=btn i], [class*=button i], [class*=cta i], a")) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20 || !shown(el)) continue;
    const bg = hex(getComputedStyle(el).backgroundColor);
    if (!bg || neutral(bg)) continue;
    if (!best || r.width * r.height > best.area) best = { el: el, area: r.width * r.height, bg: bg };
  }
  if (best) { add("button", best.bg); const rad = parseFloat(getComputedStyle(best.el).borderTopLeftRadius); if (isFinite(rad)) radius = Math.round(rad); }
  for (const a of document.querySelectorAll("main a, article a, p a, a")) {
    if (!shown(a)) continue;
    const c = hex(getComputedStyle(a).color);
    if (c && !neutral(c)) { add("link", c); break; }
  }
  // the brand: the theme colour when it is a real hue, else the main button, the header, then the links
  const pick = ["theme", "button", "header", "link"].map(function(r){ return colours.find(function(c){ return c.role === r && !neutral(c.hex); }); }).find(Boolean);
  if (pick) colours.unshift({ hex: pick.hex, role: "brand" });
  const family = function(el){ return el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() : ""; };
  const fonts = [];
  const body = family(document.body); if (body) fonts.push({ family: body, use: "body" });
  const head = family(document.querySelector("h1, h2")); if (head && head !== body) fonts.push({ family: head, use: "heading" });
  let shadows = false, seen = 0;
  for (const el of document.querySelectorAll("button, [class*=card], [class*=Card], article, section > div, li > div")) {
    if (++seen > 400) break;
    if (getComputedStyle(el).boxShadow !== "none" && shown(el)) { shadows = true; break; }
  }
  const password = Array.from(document.querySelectorAll("input[type=password]")).some(shown);
  return { colours: colours, fonts: fonts, radiusPx: radius, shadows: shadows, password: password };
})()`;

/** pdf.js is served to the page from node_modules under this made-up origin; nothing else is fetched. */
const PDF_ORIGIN = "https://pdfjs.factory.invalid";
const PDF_DIRS = ["build", "cmaps", "standard_fonts", "wasm", "iccs"];
let pdfjsRoot: string | undefined;
function pdfjsDir(): string {
  if (!pdfjsRoot) pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  return pdfjsRoot;
}
const SERVED_TYPES: Record<string, string> = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".icc": "application/octet-stream" };

/** Render a PDF's first pages to PNG data URLs and read its text (pdf.js, in the page). */
const PDF_READ = String.raw`(async function(origin, maxPages, maxEdge, maxText){
  const pdfjs = await import(origin + "/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = origin + "/build/pdf.worker.min.mjs";
  let doc;
  try {
    doc = await pdfjs.getDocument({ url: origin + "/doc.pdf", cMapUrl: origin + "/cmaps/", cMapPacked: true, standardFontDataUrl: origin + "/standard_fonts/", wasmUrl: origin + "/wasm/", isEvalSupported: false, enableXfa: false }).promise;
  } catch (e) {
    const name = (e && e.name) || "";
    return { error: name === "PasswordException" ? "password" : name === "InvalidPDFException" ? "invalid" : "unreadable: " + String((e && e.message) || e).slice(0, 160) };
  }
  const pages = [], failed = [];
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    if (i > maxPages && text.length >= maxText) break;
    const page = await doc.getPage(i);
    if (text.length < maxText) {
      try {
        const tc = await page.getTextContent();
        const t = tc.items.map(function (it) { return (it.str || "") + (it.hasEOL ? "\n" : ""); }).join(" ").replace(/[ \t]+/g, " ").trim();
        if (t) text += (text ? "\n\n" : "") + t;
      } catch (e) { /* a page with no readable text */ }
    }
    if (i <= maxPages) {
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, maxEdge / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale: scale });
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
        const g = c.getContext("2d");
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
        pages.push({ n: i, src: c.toDataURL("image/png") });
      } catch (e) { failed.push(i); }
    }
    page.cleanup();
  }
  const count = doc.numPages;
  await doc.destroy();
  return { count: count, pages: pages, failed: failed, text: text };
})`;

interface Decoded { png: Buffer; width: number; height: number; colours: { hex: string; share: number }[] }

/** Nothing listens here (the discard port): the browser's own connections fail. */
const DEAD_PROXY = "http://127.0.0.1:9";
/** One resource a reference page loads, and all of one page's resources together. */
export const MAX_RESOURCE_BYTES = 15_000_000;
const MAX_PAGE_BYTES = 80_000_000;

class Browsing {
  private browser?: Browser;
  constructor(private readonly deps: RefDeps) {}
  async get(): Promise<Browser> {
    if (this.browser) return this.browser;
    const exe = (this.deps.chromium ?? findChromium)();
    if (!exe) throw new RefIntakeError("Reading design references needs a browser (Chrome, Chromium, Edge or Brave); install one or set FACTORY_CHROMIUM to its path.");
    const { chromium } = await import("playwright-core");
    // every request a page makes is answered by the route handlers (from Node, see site()); anything that slips past them
    // (a WebSocket, a prefetch) goes to a proxy that is not there, so the browser itself never reaches the network
    this.browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", `--proxy-server=${DEAD_PROXY}`, "--proxy-bypass-list=<-loopback>"], timeout: 30_000 });
    return this.browser;
  }
  async close() { try { await this.browser?.close(); } catch { /* already gone */ } }

  /** A picture as stored PNG and its main colours, or undefined when the browser cannot decode it. */
  async decode(bytes: Buffer, mime: string): Promise<Decoded | undefined> {
    const ctx = await (await this.get()).newContext({ javaScriptEnabled: true, offline: true });
    try {
      const page = await ctx.newPage();
      const src = `data:${mime};base64,${bytes.toString("base64")}`;
      const r = (await page.evaluate(`${DECODE}(${JSON.stringify(src)}, ${REF_LONG_EDGE}, ${MAX_IMAGE_BYTES - 200_000})`)) as { error?: string; png: string; width: number; height: number; colours: { hex: string; share: number }[] };
      if (r.error) return undefined;
      return { png: Buffer.from(r.png, "base64"), width: r.width, height: r.height, colours: r.colours };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  /** A PDF's first pages as pictures (with their colours) and its text. */
  async pdf(bytes: Buffer): Promise<{ count: number; pages: (Decoded & { label: string })[]; failed: number[]; text: string }> {
    const ctx = await (await this.get()).newContext({ javaScriptEnabled: true, serviceWorkers: "block", acceptDownloads: false });
    try {
      const root = pdfjsDir();
      await ctx.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== PDF_ORIGIN) return url.protocol === "data:" || url.protocol === "blob:" ? route.continue() : route.abort();
        if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>pdf</title>" });
        if (url.pathname === "/doc.pdf") return route.fulfill({ status: 200, contentType: "application/pdf", body: bytes });
        const rel = normalize(decodeURIComponent(url.pathname).slice(1));
        if (!PDF_DIRS.includes(rel.split(sep)[0] ?? "") || rel.includes("..")) return route.fulfill({ status: 404, body: "" });
        const file = join(root, rel);
        if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: SERVED_TYPES[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(60_000);
      await page.goto(`${PDF_ORIGIN}/`);
      const r = (await page.evaluate(`${PDF_READ}(${JSON.stringify(PDF_ORIGIN)}, ${MAX_PDF_PAGES}, ${REF_LONG_EDGE}, ${MAX_REF_TEXT})`)) as { error?: string; count: number; pages: { n: number; src: string }[]; failed: number[]; text: string };
      if (r.error === "password") throw new RefIntakeError("the PDF is protected by a password; save a copy without one, or attach its pages as images.");
      if (r.error === "invalid") throw new RefIntakeError("the file is not a readable PDF; it may be damaged. Export it again, or attach its pages as images.");
      if (r.error) throw new RefIntakeError(`the PDF could not be read (${r.error}). Attach its pages as images instead.`);
      const pages: (Decoded & { label: string })[] = [];
      const failed = [...r.failed];
      for (const p of r.pages) {
        const d = (await page.evaluate(`${DECODE}(${JSON.stringify(p.src)}, ${REF_LONG_EDGE}, ${MAX_IMAGE_BYTES - 200_000})`)) as { error?: string; png: string; width: number; height: number; colours: { hex: string; share: number }[] };
        if (d.error) { failed.push(p.n); continue; }
        pages.push({ png: Buffer.from(d.png, "base64"), width: d.width, height: d.height, colours: d.colours, label: `page ${p.n}` });
      }
      return { count: r.count, pages, failed: failed.sort((a, b) => a - b), text: r.text };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  /** A site at phone and desktop width: two screenshots and its computed look. */
  async site(u: URL, allowPrivate: boolean): Promise<{ shots: { png: Buffer; label: string; width: number; height: number }[]; styles: { colours: { hex: string; role: string }[]; fonts: { family: string; use: "body" | "heading" }[]; radiusPx?: number; shadows: boolean } }> {
    const browser = await this.get();
    const shots: { png: Buffer; label: string; width: number; height: number }[] = [];
    let styles: Awaited<ReturnType<Browsing["site"]>>["styles"] | undefined;
    for (const vp of [{ width: 390, height: 844, label: "phone 390 px" }, { width: 1280, height: 800, label: "desktop 1280 px" }]) {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: false });
      try {
        let pageBytes = 0;
        await ctx.route("**/*", async (route) => {
          const req = route.request();
          const url = req.url();
          let r: URL;
          try { r = new URL(url); } catch { return route.abort(); }
          if (r.protocol === "data:" || r.protocol === "blob:") return route.continue();
          if (!/^https?:$/.test(r.protocol)) return route.abort();
          if (!allowPrivate && (isPrivateAddress(r.hostname) || /^localhost$/i.test(r.hostname))) return route.abort();
          const canned = this.deps.fulfil?.(url);
          if (this.deps.fulfil) return canned ? route.fulfill({ status: canned.status, body: canned.body, contentType: canned.contentType ?? "text/html" }) : route.abort();
          // fetched from Node, connected only to the address its own lookup checked (no second lookup to rebind)
          try {
            const res = await pinnedRequest(r, { method: req.method(), headers: await req.allHeaders(), ...(req.postDataBuffer() ? { body: req.postDataBuffer()! } : {}), allowPrivate, ...(this.deps.resolve ? { resolve: this.deps.resolve } : {}), maxBytes: MAX_RESOURCE_BYTES, timeoutMs: 20_000 });
            pageBytes += res.body.length;
            if (pageBytes > MAX_PAGE_BYTES) return route.abort();
            return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
          } catch {
            return route.abort();
          }
        });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20_000);
        let res;
        try { res = await page.goto(u.href, { waitUntil: "load" }); } catch (e) { throw new RefIntakeError(`${u.href} did not load (${(e as Error).message.split("\n")[0]}). Check the link, or attach a screenshot.`); }
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
        const status = res?.status() ?? 0;
        if (status === 401 || status === 403) throw new RefIntakeError(`${u.href} asks for a login (${status}); pages behind a login are not read. Attach screenshots of it instead.`);
        if (status >= 400) throw new RefIntakeError(`${u.href} answered ${status}. Check the link, or attach a screenshot.`);
        const end = new URL(page.url());
        if (!allowPrivate && (isPrivateAddress(end.hostname) || /^localhost$/i.test(end.hostname))) throw new RefIntakeError(`${u.href} sent the browser to a private address; attach a screenshot instead.`);
        const read = (await page.evaluate(STYLES)) as NonNullable<typeof styles> & { password: boolean };
        const loginPath = (p: string) => /\/(log-?in|sign-?in|sso|auth|account\/login)\b/i.test(p);
        if (read.password || (loginPath(end.pathname) && !loginPath(u.pathname))) throw new RefIntakeError(`${u.href} shows a login page; pages behind a login are not read. Attach screenshots of it instead.`);
        const png = await page.screenshot({ type: "png" });
        shots.push({ png, label: vp.label, width: vp.width, height: vp.height });
        if (vp.width === 1280 || !styles) styles = { colours: read.colours, fonts: read.fonts, ...(read.radiusPx !== undefined ? { radiusPx: read.radiusPx } : {}), shadows: read.shadows };
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
    return { shots, styles: styles! };
  }
}

// ---------- intake ----------

const brandGuide = (s: string) => /brand|style[\s_-]?guide|guidelines/i.test(s);

/** The role a reference gets when the user names none: a Figma file or a brand guide is matched, anything else inspires. */
export function defaultRole(kind: Reference["kind"], name: string, text = ""): RefRole {
  if (kind === "figma") return "match";
  return brandGuide(name) || brandGuide(text.slice(0, 2000)) ? "match" : "inspire";
}

const fail = (id: string, source: string, msg: string): never => { throw new RefIntakeError(`${id} (${source.slice(0, 80)}): ${msg}`); };

/** Read every reference, in order, into R-1, R-2, ...; the first one that cannot be read stops intake with a plain message. */
export async function gatherReferences(reqs: RefRequest[], opts: { allowPrivate?: boolean } = {}, deps: RefDeps = {}): Promise<GatheredRef[]> {
  if (!reqs.length) return [];
  if (reqs.length > MAX_REFERENCES) throw new RefIntakeError(`${reqs.length} design references; a run takes at most ${MAX_REFERENCES}.`);
  const keyOf = (r: RefRequest) => (r.kind === "url" ? r.url.trim() : r.name);
  const seen = new Set<string>();
  for (const r of reqs) {
    if (seen.has(keyOf(r))) throw new RefIntakeError(`${keyOf(r)} was given twice as a design reference.`);
    seen.add(keyOf(r));
    if ((r.note ?? "").length > NOTE_MAX) throw new RefIntakeError(`The note on ${keyOf(r)} is over ${NOTE_MAX} characters.`);
  }
  const b = new Browsing(deps);
  const out: GatheredRef[] = [];
  try {
    for (const [i, r] of reqs.entries()) {
      const id = `R-${i + 1}`;
      const base = { id, roleGiven: !!r.role, ...(r.note?.trim() ? { note: r.note.trim() } : {}), fonts: [], notes: [] as string[] };
      if (r.kind === "url" && isFigmaLink(r.url.trim())) {
        await checkRefUrl(r.url.trim(), !!opts.allowPrivate, deps).catch((e: Error) => fail(id, r.url, e.message));
        const f = await readFigmaLink(r.url.trim(), deps.figma).catch((e: Error) => fail(id, r.url, e.message));
        const notes = [...f.look.notes, ...f.notes];
        const images: GatheredRef["images"] = [];
        for (const fr of f.frames) {
          if (!fr.png) continue;
          const d = await b.decode(fr.png, "image/png");
          if (!d) { notes.push(`frame "${fr.name}" could not be decoded and was left out`); continue; }
          images.push({ bytes: d.png, width: d.width, height: d.height, label: fr.name.slice(0, 60) });
        }
        if (!images.length && !f.look.colours.length) fail(id, r.url, "no frame could be exported and no colours were found. Export the frames as PNG and attach them.");
        out.push({
          ...base, kind: "figma", source: r.url.trim(), role: r.role ?? FIGMA_DEFAULT_ROLE, images,
          colours: f.look.colours, fonts: f.look.fonts, ...(f.look.radiusPx !== undefined ? { radiusPx: f.look.radiusPx } : {}), shadows: f.look.shadows,
          measured: "exact", notes,
        });
        continue;
      }
      if (r.kind === "url") {
        const u = await checkRefUrl(r.url.trim(), !!opts.allowPrivate, deps).catch((e: Error) => fail(id, r.url, e.message));
        const site = await b.site(u, !!opts.allowPrivate).catch((e: Error) => fail(id, r.url, e.message));
        out.push({
          ...base, kind: "url", source: u.href, role: r.role ?? defaultRole("url", u.href),
          images: site.shots.map((s) => ({ bytes: s.png, width: s.width, height: s.height, label: s.label })),
          colours: site.styles.colours.map((c) => ({ hex: c.hex, role: c.role as RefColour["role"], exact: true })),
          fonts: site.styles.fonts, ...(site.styles.radiusPx !== undefined ? { radiusPx: site.styles.radiusPx } : {}), shadows: site.styles.shadows,
          measured: "exact",
        });
        continue;
      }
      const ext = extname(r.name).toLowerCase();
      if (!r.bytes.length) fail(id, r.name, "the file is empty.");
      if (ext !== ".docx" && r.bytes.length > MAX_REF_FILE_BYTES) fail(id, r.name, `the file is over ${MAX_REF_FILE_BYTES / 1e6} MB.`);
      if (ext === ".fig") fail(id, r.name, "a .fig file cannot be read; give the file's Figma link (with FIGMA_TOKEN set), or export the frames as PNG.");
      if (ext === ".json") {
        // a Figma JSON export: the look from its nodes, exact; it holds no pictures
        let fj: ReturnType<typeof readFigmaJson>;
        try { fj = readFigmaJson(r.bytes.toString("utf8")); } catch (e) { fail(id, r.name, (e as Error).message); }
        const look = figmaLook(fj!.roots, fj!.styles);
        if (!look.colours.length && !look.fonts.length) fail(id, r.name, "the Figma export has no colours or fonts in it.");
        out.push({
          ...base, kind: "figma", source: r.name, role: r.role ?? FIGMA_DEFAULT_ROLE, images: [],
          colours: look.colours, fonts: look.fonts, ...(look.radiusPx !== undefined ? { radiusPx: look.radiusPx } : {}), shadows: look.shadows,
          measured: "exact", notes: [...look.notes, "a JSON export has no pictures; export the frames as PNG too to show the screens"],
        });
        continue;
      }
      if (ext === ".pdf") {
        if (r.bytes.subarray(0, 1024).indexOf("%PDF-") < 0) fail(id, r.name, "the file is not a PDF (it has no PDF header).");
        const pdf = await b.pdf(r.bytes).catch((e: Error) => fail(id, r.name, e.message));
        const text = pdf.text.trim();
        if (!pdf.pages.length && !text) fail(id, r.name, "no page could be drawn and the PDF has no text.");
        const notes: string[] = [];
        if (pdf.count > MAX_PDF_PAGES) notes.push(`the first ${MAX_PDF_PAGES} of ${pdf.count} pages kept as pictures`);
        if (pdf.failed.length) notes.push(`page(s) ${pdf.failed.join(", ")} could not be drawn and were left out`);
        if (text.length > MAX_REF_TEXT) notes.push(`text cut to the first ${MAX_REF_TEXT} characters`);
        out.push({
          ...base, kind: "pdf", source: r.name, role: r.role ?? defaultRole("pdf", r.name, text),
          images: pdf.pages.map((p) => ({ bytes: p.png, width: p.width, height: p.height, label: p.label })),
          // the first page (a cover or the palette page) stands for the document's colours
          colours: (pdf.pages[0]?.colours ?? []).map((c) => ({ ...c, exact: false })),
          ...(text ? { text: text.slice(0, MAX_REF_TEXT) } : {}), measured: "approximate", notes,
        });
        continue;
      }
      if (ext === ".docx") {
        if (r.bytes.length > MAX_DOCX_BYTES) fail(id, r.name, `the document is over ${MAX_DOCX_BYTES / 1e6} MB.`);
        const doc = await readDocx(r.bytes).catch((e: Error) => fail(id, r.name, e.message));
        const notes: string[] = [];
        const usable = doc.images.filter((x) => IMAGE_MIME[extname(x.name).toLowerCase()]);
        if (usable.length < doc.images.length) notes.push(`${doc.images.length - usable.length} image(s) in a format a browser cannot show (emf, wmf, tiff) left out`);
        // the largest pictures carry the look; kept in document order
        const keep = new Set([...usable].sort((x, y) => y.bytes.length - x.bytes.length).slice(0, MAX_DOC_IMAGES));
        if (usable.length > keep.size) notes.push(`${keep.size} of ${usable.length} images kept (the largest)`);
        const images: GatheredRef["images"] = [];
        const colours: RefColour[] = [];
        for (const im of usable.filter((x) => keep.has(x))) {
          const d = await b.decode(im.bytes, IMAGE_MIME[extname(im.name).toLowerCase()]!);
          if (!d) { notes.push(`${im.name} could not be decoded and was left out`); continue; }
          images.push({ bytes: d.png, width: d.width, height: d.height, label: basename(im.name) });
          // the first picture's colours stand for the document (usually its cover or main palette)
          if (images.length === 1) colours.push(...d.colours.map((c) => ({ ...c, exact: false })));
        }
        const text = doc.text.trim();
        if (!images.length && !text) fail(id, r.name, "the document has no text and no pictures a browser can show.");
        if (text.length > MAX_REF_TEXT) notes.push(`text cut to the first ${MAX_REF_TEXT} characters`);
        out.push({
          ...base, kind: "docx", source: r.name, role: r.role ?? defaultRole("docx", r.name, text), images, colours,
          ...(text ? { text: text.slice(0, MAX_REF_TEXT) } : {}), measured: "approximate", notes,
        });
        continue;
      }
      const mime = IMAGE_MIME[ext];
      if (!mime) fail(id, r.name, `not a format design references take: ${TAKES}.`);
      if (r.bytes.length > MAX_REF_FILE_BYTES) fail(id, r.name, `the file is over ${MAX_REF_FILE_BYTES / 1e6} MB.`);
      const d = await b.decode(r.bytes, mime!);
      if (!d) fail(id, r.name, `the picture could not be decoded; it may be damaged or not really a ${ext.slice(1)} file. Export it again as png or jpeg.`);
      out.push({
        ...base, kind: "image", source: r.name, role: r.role ?? defaultRole("image", r.name),
        images: [{ bytes: d!.png, width: d!.width, height: d!.height, label: "image" }],
        colours: d!.colours.map((c) => ({ ...c, exact: false })), measured: "approximate",
      });
    }
  } finally {
    await b.close();
  }
  const pictures = out.reduce((n, r) => n + r.images.length, 0);
  if (pictures > MAX_PACK_IMAGES) throw new RefIntakeError(`The design references come to ${pictures} pictures; a design takes at most ${MAX_PACK_IMAGES}. Attach fewer, or fewer pages of a document.`);
  return out;
}

/** Store each reference's pictures with the run: as ledger artifacts (what a model is sent) and as refs/R-n-k.png (what the UI shows). */
export function storeReferences(ledger: Ledger, refs: GatheredRef[]): Reference[] {
  return refs.map((r) => ({
    ...r,
    images: r.images.map((im, k) => {
      const file = `refs/${r.id}-${k + 1}.png`;
      const dest = join(ledger.dir, file);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, im.bytes);
      return { sha: ledger.putArtifact(im.bytes), file, width: im.width, height: im.height, label: im.label };
    }),
  }));
}

/** "R-1 home.png (inspire), R-2 https://client.com (match)" for the terminal. */
export function describeReferences(refs: Pick<Reference, "id" | "source" | "role">[]): string {
  return refs.map((r) => `${r.id} ${r.source} (${r.role})`).join(", ");
}
