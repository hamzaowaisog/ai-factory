// Accessibility of Stitch's screens: axe-core on each screen's HTML in headless Chromium, with the page's scripts and links
// removed and every network request refused, so untrusted code never runs on the factory host. Without its scripts the page
// has no Tailwind styles, so colour contrast is not judged here: it is checked on the theme, as for a design drawn from JSON.
import type { DesignTheme } from "../contracts/artifacts.js";
import { loadAxe } from "./capture.js";
import { themeValues } from "./demo.js";
import type { A11yViolation } from "./fidelity.js";
import { contrastIssues } from "./palette.js";
import { findChromium } from "./screenshots.js";

/** The page with no scripts, no links and no inline handlers: what the check opens. */
export function a11yHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

type AxeRun = { axe: { run(ctx: Document, o: object): Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } };

/** axe's WCAG A and AA rules on each page, colour contrast off; undefined when there is no Chromium or no axe-core (a note, never a failure). */
export async function checkStitchA11y(pages: { id: string; html: string }[]): Promise<{ id: string; violations: A11yViolation[] }[] | undefined> {
  const exe = findChromium();
  const axe = loadAxe();
  if (!exe || !axe || !pages.length) return undefined;
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
  try {
    const context = await browser.newContext();
    // nothing leaves the machine: no fonts, no CDN, no images
    await context.route("**/*", (r) => r.abort());
    const out: { id: string; violations: A11yViolation[] }[] = [];
    for (const p of pages) {
      const page = await context.newPage();
      await page.setContent(a11yHtml(p.html), { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.addScriptTag({ content: axe });
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
