// Screenshots of the clickable demo (docs/estimates-design.md, "Design baseline"): each screen in each state,
// at phone and desktop width, taken from the demo page in headless Chromium. They are pictures of the
// wireframe (or of the cited Figma frame), so the card and `factory ui` show something to look at without
// opening the page. Best effort: no browser, or a browser that fails, is reported in `note` and never
// fails the run, and the approval is tied to the demo page, not to these files.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
export type Viewport = keyof typeof VIEWPORTS;
export interface Shot { file: string; screen: string; state: string; viewport: Viewport }
export interface ScreenShotInput { id: string; route: string; states: string[] }
export interface ShotResult { shots: Shot[]; note?: string }

const MAX_SHOTS = 48;

/** A Chromium to launch: the one named by FACTORY_CHROMIUM, Playwright's own, or one under PLAYWRIGHT_BROWSERS_PATH. */
export function findChromium(): string | undefined {
  const env = process.env.FACTORY_CHROMIUM;
  if (env) return existsSync(env) ? env : undefined;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  try {
    for (const d of readdirSync(root).sort().reverse()) {
      for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
        const p = join(root, d, rel);
        if (/^chromium/.test(d) && existsSync(p)) return p;
      }
    }
  } catch { /* no browsers folder */ }
  return undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "state";

/** Screenshot the demo page. `outDir` gets `<screen>-<state>-<viewport>.png`. Never throws. */
export async function captureDemo(demoFile: string, screens: ScreenShotInput[], outDir: string): Promise<ShotResult> {
  if (process.env.FACTORY_NO_SCREENSHOTS) return { shots: [], note: "screenshots are switched off (FACTORY_NO_SCREENSHOTS)" };
  if (!screens.length) return { shots: [] };
  const exe = findChromium();
  if (!exe) return { shots: [], note: "no browser found, so no screenshots were taken (set FACTORY_CHROMIUM to a Chromium binary)" };
  let browser: { close(): Promise<void>; newPage(o: object): Promise<any> } | undefined;
  const shots: Shot[] = [];
  try {
    const { chromium } = await import("playwright-core");
    mkdirSync(outDir, { recursive: true });
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    const url = pathToFileURL(demoFile).href;
    for (const vp of Object.keys(VIEWPORTS) as Viewport[]) {
      const page = await browser.newPage({ viewport: VIEWPORTS[vp] });
      page.setDefaultTimeout(10_000);
      for (const sc of screens) {
        await page.goto(`${url}#${encodeURIComponent(sc.id)}`);
        const states = sc.states.length ? sc.states : ["default"];
        for (const [k, st] of states.entries()) {
          if (shots.length >= MAX_SHOTS) return { shots, note: `stopped at ${MAX_SHOTS} screenshots` };
          await page.locator(`#${sc.id.replace(/[^\w-]/g, "\\$&")} [data-state="${k}"]`).click();
          const file = `${slug(sc.id)}-${slug(st)}-${vp}.png`;
          await page.screenshot({ path: join(outDir, file) });
          shots.push({ file, screen: `${sc.id} ${sc.route}`, state: st, viewport: vp });
        }
      }
      await page.close();
    }
    return { shots };
  } catch (e) {
    return { shots, note: `screenshots stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}
