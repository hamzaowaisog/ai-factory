// Screenshots and state reports of a running app (docs/design-step.md, "Accept"): one report per page and width,
// in the shape compareReports() takes. The caller starts the app (a dev server, `next start`, a preview URL) and
// gives the page URLs; this step only reads it in headless Chromium. Accessibility results come from axe-core
// (WCAG A and AA rules) when it can be loaded; if not, a small built-in set (image alt text, names on buttons and
// links, labels on fields, page language) stands in, and the note says so.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findChromium, VIEWPORTS, type Viewport } from "./screenshots.js";
import type { A11yViolation, LayoutBox, StateReport } from "./fidelity.js";

export interface PageInput { name: string; url: string }
export interface CaptureResult { reports: StateReport[]; files: string[]; note?: string }

/** The axe-core script, or undefined when the package is not installed. */
let axeSource: string | null | undefined;
export function loadAxe(): string | undefined {
  if (axeSource === undefined) {
    try { axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8"); } catch { axeSource = null; }
  }
  return axeSource ?? undefined;
}

type AxeWindow = { axe: { run(ctx: Document, o: object): Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } };

/** Injects axe and runs it: one entry per rule with the elements' selectors, the same shape as the built-in checks. */
export async function runAxe(page: { evaluate(fn: () => Promise<A11yViolation[]>): Promise<A11yViolation[]>; addScriptTag(o: { content: string }): Promise<unknown> }, source: string): Promise<A11yViolation[]> {
  await page.addScriptTag({ content: source });
  return page.evaluate(async () => {
    const r = await (window as unknown as AxeWindow).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return r.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.map(String).join(" ")) }));
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

/** Runs inside the page. A plain function so it can be serialised and tested in any browser. */
export function inspectPage(): { layout: LayoutBox[]; axe: A11yViolation[]; horizontalScroll: boolean } {
  const SEL = "a,button,input,select,textarea,img,h1,h2,h3,nav,main,header,footer,[role=button],[data-testid]";
  const path = (el: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n!.tagName) : [n];
      parts.unshift(`${n.tagName.toLowerCase()}${same.length > 1 ? `[${same.indexOf(n)}]` : ""}`);
    }
    return parts.join(">");
  };
  const nameOf = (el: Element): string => (el.getAttribute("aria-label") || el.getAttribute("alt") || (el as HTMLElement).innerText || el.getAttribute("title") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const layout: LayoutBox[] = [];
  const axe: A11yViolation[] = [];
  const add = (id: string, el: Element) => { let v = axe.find((x) => x.id === id); if (!v) { v = { id, targets: [] }; axe.push(v); } v.targets!.push(path(el)); };
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    const key = el.getAttribute("data-testid") || el.id || path(el);
    layout.push({ key, name: nameOf(el), tag, x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
    if (tag === "img" && !el.hasAttribute("alt")) add("image-alt", el);
    if ((tag === "button" || tag === "a" || el.getAttribute("role") === "button") && !nameOf(el)) add(tag === "a" ? "link-name" : "button-name", el);
    if ((tag === "input" || tag === "select" || tag === "textarea") && (el as HTMLInputElement).type !== "hidden" && (el as HTMLInputElement).type !== "submit" && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest("label")) add("label", el);
  }
  if (!document.documentElement.getAttribute("lang")) add("html-has-lang", document.documentElement);
  return { layout, axe, horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
}

/** Screenshot each page at phone, tablet and desktop width and report what is on it. Never throws. */
export async function captureReports(pages: PageInput[], outDir: string): Promise<CaptureResult> {
  if (process.env.FACTORY_NO_SCREENSHOTS) return { reports: [], files: [], note: "screenshots are switched off (FACTORY_NO_SCREENSHOTS)" };
  if (!pages.length) return { reports: [], files: [] };
  const exe = findChromium();
  if (!exe) return { reports: [], files: [], note: "no browser found (set FACTORY_CHROMIUM to a Chromium binary)" };
  const reports: StateReport[] = [], files: string[] = [];
  const axe = loadAxe();
  const notes: string[] = axe ? [] : ["axe-core is not installed, so the built-in accessibility checks were used (npm i axe-core)"];
  let browser: { close(): Promise<void>; newPage(o: object): Promise<any> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    mkdirSync(outDir, { recursive: true });
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    for (const vp of Object.keys(VIEWPORTS) as Viewport[]) {
      const page = await browser.newPage({ viewport: VIEWPORTS[vp], reducedMotion: "reduce" });
      page.setDefaultTimeout(15_000);
      for (const p of pages) {
        await page.goto(p.url, { waitUntil: "load" });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
        const got = await page.evaluate(inspectPage);
        if (axe) {
          try { got.axe = await runAxe(page, axe); } catch (e) { notes.push(`axe-core failed on ${p.name}; built-in checks used: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`); }
        }
        const file = `${slug(p.name)}-${vp}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        files.push(file);
        reports.push({ state: `${p.name} (${vp})`, layout: got.layout, axeViolations: got.axe, horizontalScroll: got.horizontalScroll });
      }
      await page.close();
    }
    return { reports, files, ...(notes.length ? { note: [...new Set(notes)].join("; ") } : {}) };
  } catch (e) {
    return { reports, files, note: `capture stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}
