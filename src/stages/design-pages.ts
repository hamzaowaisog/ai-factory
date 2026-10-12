// The design step on the pages engine: the same plan, design system, checks, preview and export as the stitch engine
// (src/stages/design-stitch.ts), with the design step's own model writing each page's HTML in Stitch's place. It is a
// StitchClient, so nothing downstream knows the difference: a page is stored in the ledger and named by its hash, and its
// picture is taken here in headless Chromium.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { load } from "cheerio";
import { z } from "zod";
import { a11yHtml } from "../design/stitch-a11y.js";
import { findChromium, VIEWPORTS } from "../design/screenshots.js";
import type { StitchClient, StitchDevice } from "../design/stitch.js";
import type { StepContext } from "./framework.js";
import { S, think } from "./think.js";

const PageOut = z.object({ html: z.string().min(200) });

export const PAGE_RULES = `You are a senior product designer who writes production HTML and CSS by hand. You draw one page of a product as a complete HTML document, the way a design tool would hand it over: finished, polished and specific to this product.
- Return the whole document in "html": <!DOCTYPE html>, <html lang>, a <head> with a <title> and one <style> block, and the <body>.
- Follow the "design-system" exactly: its colours, fonts, type scale, spacing, corners, surfaces and motion, written as its own values. No colour or font it does not name.
- All styling is CSS in the <style> block. No JavaScript, no <script>, no Tailwind or other framework, no inline event handlers.
- Fonts come from Google Fonts through one <link rel="stylesheet" href="https://fonts.googleapis.com/css2?..."> for the design system's families. Nothing else is loaded from the network: icons are inline SVG, and a picture is an inline SVG or a CSS composition, never an <img> with a web address and never a grey box.
- Draw exactly what the prompt describes, with its real sample content, in the one state it asks for. Nothing the prompt does not ask for.
- Compose it like a shipped product, not a wireframe: a clear hierarchy with one thing the eye meets first, a consistent spacing rhythm, aligned columns, real density where there are records, and empty space left on purpose.
- Semantic, accessible markup: one <h1>, landmarks (<header>, <nav>, <main>), a <label> for every field, a text name for every button and link, <th scope> in tables, and visible focus styles.
- The page fills the width it is drawn at and never scrolls sideways. At phone width it is one column.
- Every link is an <a href="#"> and every action a <button type="button">.`;

const WIDTH: Record<StitchDevice, { width: number; height: number }> = { DESKTOP: VIEWPORTS.desktop, AGNOSTIC: VIEWPORTS.desktop, TABLET: VIEWPORTS.tablet, MOBILE: VIEWPORTS.phone };
const FONTS = "https://fonts.googleapis.com/";
const ORIGIN = "https://design-pages.invalid";
/** The picture's page may load Google's fonts and nothing else; nothing in it runs. */
const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; form-action 'none'; base-uri 'none'";

/** The page as it is kept: the model's document with every script gone (the rules ask for none), so its picture and its live page agree. */
export function cleanPage(raw: string): string {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/.exec(raw);
  const $ = load((fenced?.[1] ?? raw).trim());
  $("script").remove();
  return $.html();
}

/** The model's HTML is untrusted: sanitized as for the accessibility check, with its Google Fonts links put back, and served under CSP. */
function pictureHtml(html: string): string {
  const fonts = load(html)("link[rel=stylesheet]").toArray().map((el) => (el as { attribs?: Record<string, string> }).attribs?.href ?? "").filter((h) => h.startsWith(FONTS));
  const $ = load(a11yHtml(html));
  for (const href of fonts) $("head").append(`<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}">`);
  return $.html();
}

async function chromiumPicture(html: string, device: StitchDevice): Promise<Buffer> {
  const exe = findChromium();
  if (!exe) throw new Error("no Chromium here to take the pages' pictures (npx playwright install chromium, or set FACTORY_CHROMIUM)");
  const { chromium } = await import("playwright-core");
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const browser = await chromium.launch({ executablePath: exe, args: root ? ["--no-sandbox"] : [], timeout: 30_000 });
  try {
    const context = await browser.newContext({ viewport: WIDTH[device], reducedMotion: "reduce" });
    const url = `${ORIGIN}/page`;
    await context.route("**/*", (r) => {
      const u = r.request().url();
      if (u === url) return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "content-security-policy": CSP }, body: pictureHtml(html) });
      return u.startsWith(FONTS) || u.startsWith("https://fonts.gstatic.com/") ? r.continue() : r.abort();
    });
    const page = await context.newPage();
    // fonts that do not arrive in time leave the page in its fallback font; the picture is still taken
    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => undefined);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

let picture: typeof chromiumPicture = chromiumPicture;
/** Tests replace the browser; undefined goes back to headless Chromium. */
export function setPagePicture(f: typeof chromiumPicture | undefined): void { picture = f ?? chromiumPicture; }

const LEDGER = "ledger:";

/** The design step's model as the drawer of a Stitch-shaped design. Every page is one model call, counted by its tokens. */
export function pagesClient(ctx: StepContext): StitchClient {
  const dir = join(ctx.ledger.dir, "attachments");
  const systemFile = (projectId: string) => join(dir, `${projectId}.md`);
  const system = (projectId: string) => { try { return readFileSync(systemFile(projectId), "utf8"); } catch { return ""; } };
  // a page's call is its own: the screen list's rejections are not its to fix
  const own: StepContext = { ...ctx, priorFailures: [], gateAnswers: undefined };
  const draw = async (projectId: string, label: string, device: StitchDevice, sections: Parameters<typeof think>[1]["sections"]) => {
    const md = system(projectId);
    const r = await think(own, {
      stage: "design", label, route: "design", cls: "read-large", budgetTokens: 60000, tools: [], schema: PageOut, maxTurns: 2,
      sections: [S.template("tpl", PAGE_RULES), ...(md ? [S.reference("design-system", md)] : []), ...sections,
        S.task(`Draw the page at ${device === "MOBILE" ? "phone width (390 px)" : device === "TABLET" ? "tablet width (820 px)" : "desktop width (1280 px)"}.`)],
    });
    if (!r.ok) throw new Error(r.outcome.kind === "park" ? r.outcome.reason : r.outcome.kind === "fail" ? r.outcome.failures.map((f) => f.message).join("; ") : "the model gave no page");
    const html = cleanPage(r.output.html);
    // cheerio wraps anything in a document, so the answer itself must be one
    if (!/<(html|body)[\s>]/i.test(r.output.html) || load(html)("body").text().trim().length < 20) { r.forget?.(); throw new Error("the model's answer was not a page"); }
    const screenId = ctx.ledger.putArtifact(Buffer.from(html));
    const image = ctx.ledger.putArtifact(await picture(html, device));
    return { screenId, htmlUrl: `${LEDGER}${screenId}`, imageUrl: `${LEDGER}${image}` };
  };
  return {
    async createProject() { return `pages-${randomUUID().slice(0, 8)}`; },
    async createDesignSystem(projectId, _name, theme) { mkdirSync(dir, { recursive: true }); writeFileSync(systemFile(projectId), theme.designMd); },
    generate: (projectId, prompt, device) => draw(projectId, "design page", device, [S.reference("page", prompt)]),
    edit: (projectId, screenId, prompt, device) => draw(projectId, "design page edit", device, [
      S.reference("current-page", ctx.ledger.getArtifact(screenId).toString("utf8")),
      S.reference("change", `Return this same page with this change made and everything else kept as it is: ${prompt}`),
    ]),
    async download(url) {
      if (!url.startsWith(LEDGER) || !/^[0-9a-f]+$/.test(url.slice(LEDGER.length))) throw new Error(`not a drawn page: ${url}`);
      return ctx.ledger.getArtifact(url.slice(LEDGER.length));
    },
    async close() { /* nothing held open */ },
  };
}
