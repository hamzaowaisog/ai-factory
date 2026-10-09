// Accessibility of Stitch's screens: axe-core on each screen's HTML in headless Chromium. Stitch's HTML is untrusted (its prompts
// carry requirement text), so three layers keep its code from running on the factory host: the sanitizer removes anything that can
// run or load (scripts, frames, objects, handlers, javascript: and data: URLs), the page is served with a Content-Security-Policy of
// default-src 'none' (no script, no fetch, no WebSocket), and Chromium keeps its sandbox (off only when the factory runs as root).
// Without its scripts the page has no Tailwind styles, so colour contrast is not judged here.
import type { DesignTheme } from "../contracts/artifacts.js";
import { loadAxe } from "./capture.js";
import { themeValues } from "./demo.js";
import type { A11yViolation } from "./fidelity.js";
import { contrastIssues } from "./palette.js";
import { findChromium } from "./screenshots.js";
import { load } from "cheerio";

/** Elements that run code, load another document or change where the page loads from. */
const DANGEROUS = "script, iframe, frame, frameset, object, embed, applet, base, meta, link, portal, noscript, template";
/** Attributes whose value is a URL, where javascript:, vbscript: or a data: document would run code. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background", "ping", "srcset"]);

/** The page with nothing that can run or load: parsed and rebuilt (cheerio), so split or odd markup cannot slip through. */
export function a11yHtml(html: string): string {
  const $ = load(html);
  $(DANGEROUS).remove();
  // odd markup such as <scr<script> parses as an element named "scr<script": unwrapped, so no tag-like name survives
  $("*").each((_, el) => { if (!/^[a-z][a-z0-9-]*$/i.test((el as { tagName?: string }).tagName ?? "")) $(el).replaceWith($(el).contents()); });
  $("*").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      const n = name.toLowerCase();
      const runs = /^\s*(javascript|vbscript|data):/i.test(value) && !(n === "src" && /^\s*data:image\/(png|jpe?g|gif|webp);/i.test(value));
      if (n.startsWith("on") || n === "srcdoc" || (URL_ATTRS.has(n) && runs)) $(el).removeAttr(name);
    }
  });
  return $.html();
}

/** The check's own origin: every page is served from it with a policy that lets nothing run or load. */
const ORIGIN = "https://stitch-a11y.invalid";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

type AxeRun = { axe: { run(ctx: Document, o: object): Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } };

/** axe's WCAG A and AA rules on each page, colour contrast off; undefined when there is no Chromium or no axe-core (a note, never a failure). */
export async function checkStitchA11y(pages: { id: string; html: string }[]): Promise<{ id: string; violations: A11yViolation[] }[] | undefined> {
  const exe = findChromium();
  const axe = loadAxe();
  if (!exe || !axe || !pages.length) return undefined;
  const { chromium } = await import("playwright-core");
  // Chromium's sandbox stays on; it cannot start as root without --no-sandbox (a container), where the CSP and sanitizer still hold
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const browser = await chromium.launch({ executablePath: exe, args: root ? ["--no-sandbox"] : [], timeout: 30_000 });
  try {
    const context = await browser.newContext();
    const served = new Map<string, string>();
    // the check's own pages come with the policy; nothing else is fetched (no fonts, no CDN, no images)
    await context.route("**/*", (r) => {
      const body = served.get(r.request().url());
      return body === undefined ? r.abort() : r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": CSP }, body });
    });
    const out: { id: string; violations: A11yViolation[] }[] = [];
    for (const [i, p] of pages.entries()) {
      const url = `${ORIGIN}/page/${i}`;
      served.set(url, a11yHtml(p.html));
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      // axe runs as the browser's own evaluation, which the page's policy does not apply to; the page itself can run nothing
      await page.evaluate(axe);
      const violations = await page.evaluate(async () => {
        const r = await (window as unknown as AxeRun).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
        return r.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.map(String).join(" ")) }));
      });
      out.push({ id: p.id, violations });
      await page.close();
    }
    return out;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** The theme's text and button-label contrast in each of its modes (the JSON track's design-a11y check, for a Stitch theme). */
export function themeContrastFaults(theme: DesignTheme): { check: string; message: string }[] {
  const v = themeValues(theme);
  const modes = theme.mode === "auto" ? [false, true] : [theme.mode === "dark"];
  return modes.flatMap((dark) => contrastIssues(v.colours(dark), dark ? "dark" : "light").map((i) => ({
    check: "design-a11y",
    message: `In ${i.mode} mode, ${i.text} on ${i.on} has a contrast of ${i.ratio}:1; it needs ${i.need}:1. Choose a brand colour (customColor) with more contrast.`,
  })));
}

/** What the approval card says about accessibility problems Stitch could not fix. */
export function stitchA11yLines(open: { screen: string; rules: string[] }[] | undefined): string[] {
  if (!open?.length) return [];
  return ["Accessibility, still open (Stitch could not fix these):", ...open.map((x) => `- ${x.screen}: ${x.rules.join(", ")}`), ""];
}
