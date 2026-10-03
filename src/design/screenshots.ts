// Screenshots of the clickable demo (docs/estimates-design.md, "Design baseline"): each screen in each state,
// at phone and desktop width, taken from the demo page in headless Chromium. They are pictures of the
// drawn screen (or of the cited Figma frame), so the card and `factory ui` show something to look at without
// opening the page. Every state is checked at tablet width too, but the tablet, the other language and dark
// mode are pictured only as each screen first shows, so the pictures stay few. Best effort: no browser, or a
// browser that fails, is reported in `note` and never fails the run, and the approval is tied to the demo page,
// not to these files.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const VIEWPORTS = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1280, height: 800 } } as const;
export type Viewport = keyof typeof VIEWPORTS;
/** `id` is the screen's id; `mode` and `lang` (the language code) say when the picture is the dark mode or another language (the screen as it first shows) */
export interface Shot { file: string; id?: string; screen: string; state: string; viewport: Viewport; mode?: "dark"; lang?: string }
/** How the walk runs: `reproducible` gives the same picture on every run (the design package); `max` caps the pictures. */
export interface WalkOptions { reproducible?: boolean; max?: number }
/** `title` is the page's name as the lead knows it; shots are labelled with it when given */
export interface ScreenShotInput { id: string; route: string; states: string[]; title?: string }
/** A fault of the drawn page a person would notice: text past the app's edge, text cut off by its box, or two texts on top of each other. */
export interface LayoutIssue { screen: string; state: string; viewport: Viewport; kind: "overflow" | "clipped" | "overlap"; text: string }
export interface ShotResult { shots: Shot[]; note?: string; issues?: LayoutIssue[] }
/** How each fault reads to a person. */
export const LAYOUT_FAULT = { overflow: "runs past the edge", clipped: "is cut off", overlap: "sits on top of other text" } as const;

const MAX_SHOTS = 64;
// phone and desktop first: they are pictured in every state, so a long product runs out of pictures on the tablet
const WALK: Viewport[] = ["phone", "desktop", "tablet"];
const DARK = "Dark mode";

// where Playwright keeps its browsers on each system, and the binary inside each browser folder
const PW_ROOTS = (): string[] => [
  process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers",
  join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright"),
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined,
].filter((x): x is string => !!x);
const PW_BINARIES = [
  "chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
  "chrome-mac/headless_shell", "chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell",
  "chrome-win/chrome.exe", "chrome-win64/chrome.exe",
];
// browsers people already have installed: a Chromium-based one is all the screenshots and the brand reading need
const INSTALLED = (): string[] => [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge",
  ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => process.env[v] ? [join(process.env[v]!, "Google", "Chrome", "Application", "chrome.exe"), join(process.env[v]!, "Microsoft", "Edge", "Application", "msedge.exe")] : []),
];

/**
 * A Chromium to launch: the one named by FACTORY_CHROMIUM, else Playwright's own (on Linux, macOS or Windows), else an installed
 * Chrome, Chromium, Edge or Brave. FACTORY_CHROMIUM set to a missing path means "none", so a test or a locked-down machine can turn it off.
 */
export function findChromium(): string | undefined {
  const env = process.env.FACTORY_CHROMIUM;
  if (env) return existsSync(env) ? env : undefined;
  for (const root of PW_ROOTS()) {
    try {
      for (const d of readdirSync(root).sort().reverse()) {
        if (!/^chromium/.test(d)) continue;
        for (const rel of PW_BINARIES) { const p = join(root, d, rel); if (existsSync(p)) return p; }
      }
    } catch { /* no browsers folder */ }
  }
  return INSTALLED().find((p) => existsSync(p));
}

/**
 * Run in the page: measures every line of text in the screen's visible state (open overlays included) and returns what is wrong
 * with it. Scrolling rows (tables, slides) may run past their box on purpose; text cut with an ellipsis or a line clamp is
 * shortened on purpose. A line is measured at its line height, so a script whose glyph boxes are taller than its lines (Urdu's
 * Nastaliq) is not read as overlapping the lines around it. Plain JS, as it is sent to the browser.
 */
export const LAYOUT_CHECK = String.raw`(function(id){
  var sec=document.getElementById(id),pane=sec&&sec.querySelector(".pane:not([hidden])");if(!pane)return[];
  var canvas=pane.closest(".canvas"),frame=(canvas||pane).getBoundingClientRect(),out=[],seen={},lines=[];
  function add(kind,text){if(!seen[kind+text]&&out.length<12){seen[kind+text]=1;out.push({kind:kind,text:text})}}
  var walk=document.createTreeWalker(pane,NodeFilter.SHOW_TEXT),n;
  while((n=walk.nextNode())){
    var text=(n.textContent||"").trim().replace(/\s+/g," ").slice(0,40),el=n.parentElement;
    if(!text||!el||el.closest("svg,script,style,[aria-hidden=true],.vh,select,option"))continue;
    var hidden=false,cut=false,box=null,scrolls=false;
    for(var e=el;e&&e!==pane;e=e.parentElement){var c=getComputedStyle(e);
      if(c.display==="none"||c.visibility==="hidden"||Number(c.opacity)===0){hidden=true;break}
      if(c.textOverflow==="ellipsis"||(c.webkitLineClamp&&c.webkitLineClamp!=="none"))cut=true;
      if(e!==canvas){var o=c.overflowX+" "+c.overflowY;if(/auto|scroll/.test(o))scrolls=true;else if(!box&&!scrolls&&/hidden|clip/.test(o))box=e}}
    if(hidden)continue;
    var range=document.createRange();range.selectNodeContents(n);var rs=range.getClientRects(),layer=el.closest(".ovl,.toast");
    // a script with tall glyph boxes (Nastaliq's is about 2.5 times its size) spills past its line: measure each line at its line height
    var cs=getComputedStyle(el),fs=parseFloat(cs.fontSize)||14,cap=Math.max(parseFloat(cs.lineHeight)||fs*1.2,fs*1.2);
    for(var i=0;i<rs.length;i++){var r=rs[i];if(r.width<1||r.height<1)continue;
      if(r.height>cap){var mid=(r.top+r.bottom)/2;r={left:r.left,right:r.right,top:mid-cap/2,bottom:mid+cap/2,width:r.width,height:cap}}
      lines.push({r:r,node:n,text:text,layer:layer});
      if(!scrolls&&(r.right>frame.right+1||r.left<frame.left-1))add("overflow",text);
      if(box&&!cut&&!scrolls){var b=box.getBoundingClientRect();if(b.width>2&&b.height>2&&(r.right>b.right+2||r.left<b.left-2||r.bottom>b.bottom+2||r.top<b.top-2))add("clipped",text)}}}
  lines=lines.slice(0,600);
  for(var x=0;x<lines.length;x++)for(var y=x+1;y<lines.length;y++){var a=lines[x],q=lines[y];if(a.node===q.node||a.layer!==q.layer)continue;
    var w=Math.min(a.r.right,q.r.right)-Math.max(a.r.left,q.r.left),h=Math.min(a.r.bottom,q.r.bottom)-Math.max(a.r.top,q.r.top);
    if(w>2&&h>2&&w*h>0.2*Math.min(a.r.width*a.r.height,q.r.width*q.r.height))add("overlap",a.text+" / "+q.text)}
  return out})`;

/** What a screen's page shows as it first opens, read in the browser for the reference layout check (src/design/ref-checks.ts). */
export interface RenderedLayout { frame: string; nav: string[]; blocks: string[] }

/**
 * Run in the page: the frame the screen is drawn in (its shell), the navigation a person sees (rail, top links, tab bar, menu
 * button, page tabs, breadcrumbs) and the page's blocks top to bottom. Plain JS, as it is sent to the browser.
 */
export const REGION_READ = String.raw`(function(id){
  var sec=document.getElementById(id),canvas=sec&&sec.querySelector(".canvas");if(!canvas)return null;
  var pane=canvas.querySelector(".pane:not([hidden])")||canvas;
  function vis(e){if(!e)return false;var r=e.getBoundingClientRect();if(r.width<2||r.height<2)return false;for(var x=e;x&&x!==document.body;x=x.parentElement){var c=getComputedStyle(x);if(c.display==="none"||c.visibility==="hidden")return false}return true}
  function any(sel,root){var l=(root||canvas).querySelectorAll(sel);for(var i=0;i<l.length;i++)if(vis(l[i]))return true;return false}
  var m=/\bsh-(\w+)/.exec(canvas.className),nav=[];
  if(any(".rail"))nav.push("rail");if(any(".tnav a"))nav.push("top-links");if(any(".tabbar"))nav.push("tab-bar");if(any("[data-drawer]"))nav.push("menu-button");
  if(any(".ptabs",pane))nav.push("page-tabs");if(any(".crumbs",pane))nav.push("crumbs");
  var bl=[].slice.call(pane.querySelectorAll("[data-b]")).filter(function(e){return vis(e)&&!e.closest(".ovl,.preview")});
  bl.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top});
  var blocks=[];bl.forEach(function(e){var t=e.getAttribute("data-b");if(blocks.indexOf(t)<0)blocks.push(t)});
  return {frame:m?m[1]:"",nav:nav,blocks:blocks}})`;

/**
 * Each listed screen as it first opens, read at desktop width (a phone app is drawn in its phone frame there). Fast: motion
 * reduced, nothing saved. Undefined when it could not run (no browser, switched off, a failure).
 */
export async function readDemoLayout(demoFile: string, ids: string[]): Promise<Record<string, RenderedLayout> | undefined> {
  if (process.env.FACTORY_NO_SCREENSHOTS || process.env.FACTORY_DESIGN_LAYOUT_CHECK === "0" || !ids.length) return undefined;
  const exe = findChromium();
  if (!exe) return undefined;
  let browser: { close(): Promise<void>; newPage(o: object): Promise<any> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 });
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop, reducedMotion: "reduce" });
    page.setDefaultTimeout(10_000);
    const url = pathToFileURL(demoFile).href, out: Record<string, RenderedLayout> = {};
    for (const id of ids) {
      await page.goto(`${url}#${encodeURIComponent(id)}`);
      await page.waitForTimeout(150);
      const r = (await page.evaluate(`${REGION_READ}(${JSON.stringify(id)})`)) as RenderedLayout | null;
      if (r) out[id] = r;
    }
    return out;
  } catch { return undefined; } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "state";

/** Screenshot the demo page. `outDir` gets `<screen>-<state>-<viewport>.png`. Never throws. */
export async function captureDemo(demoFile: string, screens: ScreenShotInput[], outDir: string, o: WalkOptions = {}): Promise<ShotResult> {
  if (process.env.FACTORY_NO_SCREENSHOTS) return { shots: [], note: "screenshots are switched off (FACTORY_NO_SCREENSHOTS)" };
  return walkDemo(demoFile, screens, outDir, o);
}

/**
 * Only the layout check, fast: motion is reduced so each state settles at once, and nothing is saved. The design step runs it
 * before the card exists, so the model can fix what it wrote. Undefined when it could not run (no browser, switched off, a failure).
 */
export async function checkDemoLayout(demoFile: string, screens: ScreenShotInput[]): Promise<LayoutIssue[] | undefined> {
  if (process.env.FACTORY_NO_SCREENSHOTS || process.env.FACTORY_DESIGN_LAYOUT_CHECK === "0" || !screens.length) return undefined;
  const r = await walkDemo(demoFile, screens);
  return r.note ? undefined : r.issues ?? [];
}

/**
 * Each screen in each state at each width: the layout checked, and a screenshot saved when `outDir` is given. The tablet is
 * pictured as each screen first shows; a product in two languages is also pictured in the other one, and a product in both
 * colour modes in dark mode (at phone and desktop width).
 */
// a fixed moment for reproducible pictures: a demo that shows "today" shows the same day on every run
const FIXED_TIME = new Date("2026-01-15T10:00:00Z");
// nothing moves and no caret blinks, so the same page gives the same pixels
const STILL_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

// the same pixels on a loaded machine too (PR #11 review, item 21): edges were drawn a shade apart now and then by the GPU
// and the parallel raster threads, so reproducible pictures are drawn in software, on one thread, in plain sRGB
const STILL_RASTER = ["--disable-gpu", "--disable-gpu-rasterization", "--disable-partial-raster", "--num-raster-threads=1", "--disable-skia-runtime-opts", "--disable-lcd-text", "--force-color-profile=srgb", "--font-render-hinting=none"];

// settled, not timed (PR #11 review, item 21: a fixed wait gave different bytes on a loaded machine): the fonts loaded,
// every picture decoded, and two frames drawn after that
const SETTLE = `(async function(){await document.fonts.ready;await Promise.all([].slice.call(document.images).map(function(i){return i.decode().catch(function(){})}));await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})});return 1})()`;

/** A full-page picture taken until two in a row are the same (at most five), so a page still drawing is not saved half done. */
async function stablePicture(page: { screenshot(o: object): Promise<Buffer>; evaluate(s: string): Promise<unknown> }): Promise<Buffer> {
  let last = await page.screenshot({ fullPage: true });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(SETTLE);
    const next = await page.screenshot({ fullPage: true });
    if (next.equals(last)) return next;
    last = next;
  }
  return last;
}

async function walkDemo(demoFile: string, screens: ScreenShotInput[], outDir?: string, o: WalkOptions = {}): Promise<ShotResult> {
  if (!screens.length) return { shots: [] };
  const exe = findChromium();
  if (!exe) return { shots: [], note: "no browser found, so no screenshots were taken (set FACTORY_CHROMIUM to a Chromium binary)" };
  let browser: { close(): Promise<void>; newPage(o: object): Promise<any> } | undefined;
  const shots: Shot[] = [], issues: LayoutIssue[] = [];
  const max = o.max ?? MAX_SHOTS, repro = !!o.reproducible;
  const full = () => !!outDir && shots.length >= max;
  try {
    const { chromium } = await import("playwright-core");
    if (outDir) mkdirSync(outDir, { recursive: true });
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", ...(repro ? STILL_RASTER : [])], timeout: 30_000 });
    const url = pathToFileURL(demoFile).href;
    for (const vp of WALK) {
      const page = await browser.newPage({ viewport: VIEWPORTS[vp], ...(outDir && !repro ? {} : { reducedMotion: "reduce" }), ...(repro ? { deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", bypassCSP: true } : {}) });
      // a loaded machine (a full test run, a busy CI box) is slow, and a timed-out picture would leave the package short
      page.setDefaultTimeout(repro ? 30_000 : 10_000);
      if (repro) await page.clock.setFixedTime(FIXED_TIME);
      for (const sc of screens) {
        const screen = sc.title ?? `${sc.id} ${sc.route}`, sel = `#${sc.id.replace(/[^\w-]/g, "\\$&")}`;
        /** show state `k` (after `before`, run in the page), check it, and picture it when `shoot` */
        const step = async (k: number, st: string, shoot: boolean, before?: string, extra: Pick<Shot, "mode" | "lang"> = {}) => {
          await page.locator(`${sel} [data-state="${k}"]`).click();
          if (before) await page.evaluate(before);
          // move the pointer off the tab (a hovered tab is drawn differently) and show the page from its top
          await page.mouse.move(0, 0);
          await page.evaluate(() => window.scrollTo(0, 0));
          if (repro) {
            // the same pixels every run: no motion, the fonts loaded, the page settled
            await page.addStyleTag({ content: STILL_CSS });
            await page.evaluate(SETTLE);
          } else await page.waitForTimeout(outDir && shoot ? 1600 : 150); // the page animates in (at once with reduced motion)
          // what a person would see is wrong with the page (best effort: a failed check is no fault of the page)
          try { for (const f of (await page.evaluate(`${LAYOUT_CHECK}(${JSON.stringify(sc.id)})`)) as Omit<LayoutIssue, "screen" | "state" | "viewport">[]) issues.push({ ...f, screen, state: st, viewport: vp }); } catch { /* not checked */ }
          if (!outDir || !shoot) return;
          const file = `${slug(sc.id)}-${slug(st)}-${vp}.png`;
          if (repro) writeFileSync(join(outDir, file), await stablePicture(page));
          else await page.screenshot({ path: join(outDir, file), fullPage: true });
          shots.push({ file, id: sc.id, screen, state: st, viewport: vp, ...extra });
        };
        await page.goto(`${url}#${encodeURIComponent(sc.id)}`);
        const states = sc.states.length ? sc.states : ["default"];
        for (const [k, st] of states.entries()) {
          if (full()) return { shots, issues, note: `stopped at ${max} screenshots` };
          await step(k, st, vp !== "tablet" || k === 0);
        }
        // a product in two languages: the page as it first shows, in the other one (mirrored when it reads right to left)
        const other = (await page.evaluate(`(function(){var e=document.getElementById("i18n");var i=e&&JSON.parse(e.textContent);return i&&i.langs.length>1?{code:i.langs[1],label:i.labels[1]}:null})()`)) as { code: string; label: string } | null;
        if (other) {
          if (full()) return { shots, issues, note: `stopped at ${max} screenshots` };
          await step(0, `In ${other.label}`, vp !== "tablet", "window.__lang(1)", { lang: other.code });
          await page.evaluate("window.__lang(0)");
        }
        // a product in both colour modes: the page as it first shows, in dark mode
        if (await page.locator("button[data-mode]").count()) {
          if (full()) return { shots, issues, note: `stopped at ${max} screenshots` };
          await step(0, DARK, vp !== "tablet", 'window.__mode("dark")', { mode: "dark" });
          await page.evaluate('window.__mode("light")');
        }
      }
      await page.close();
    }
    return { shots, issues };
  } catch (e) {
    return { shots, issues, note: `screenshots stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
}
