// A Stitch screen as a live page in the approval demo: Stitch's own HTML, shown in a sandboxed frame beside the demo's other
// screens, so a lead walks a Stitch design as they walk a Claude or OpenAI one (the picture stays one click away).
// Stitch's HTML is untrusted (its prompts carry requirement text) and needs Tailwind's browser build and Google's fonts to look
// like its picture, so it runs only in the lead's browser, never on the factory host, behind three layers: the page is rebuilt
// with nothing that runs but Tailwind and its settings, a Content-Security-Policy names the four hosts it may load from and lets
// it connect to none, and the frame is sandboxed (an opaque origin: it cannot read the factory's page, its cookie or its API).
import { load } from "cheerio";

/** Where the live pages sit in a run's preview folder (src/ui/server.ts serves them with LIVE_CSP). */
export const LIVE_DIR = "stitch";
const TAILWIND = "https://cdn.tailwindcss.com";
/** What a live Stitch page may load: Tailwind's browser build, Google's fonts, and the pictures Stitch made for it. */
export const LIVE_CSP = `default-src 'none'; script-src 'unsafe-inline' ${TAILWIND}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https://lh3.googleusercontent.com; connect-src 'none'; form-action 'none'; base-uri 'none'`;

/** Elements that load another document or change where the page loads from. */
const DANGEROUS = "iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], portal";
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background", "ping"]);

export interface LiveScreen { id: string; route: string; title?: string; headings?: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The names a link or button may call a screen by: its title, its first heading, and its route's words ("/" is home). */
export function liveNames(s: LiveScreen): string[] {
  const parts = s.route.split(/[/?#]/).filter((p) => p && !/^[:{[]/.test(p));
  const route = parts.length ? [parts[parts.length - 1]!, parts.join(" ")] : ["home", "dashboard", "overview"];
  return [...new Set([s.title ?? "", s.headings?.[0] ?? "", ...route].map(norm).filter((n) => n.length >= 3))];
}

/**
 * The script a live page gets: a click on a link, button or tab named like another screen asks the demo to open that screen.
 * A link never leaves the page and a form is never sent. An exact name wins; otherwise the click's words inside a screen's name
 * (or the name inside the click's words), the closest in length first.
 */
function clickScript(self: string, screens: LiveScreen[]): string {
  const table = screens.filter((s) => s.id !== self).map((s) => ({ id: s.id, names: liveNames(s) }));
  return `(function(){var T=${JSON.stringify(table).replace(/</g, "\\u003c")};
function norm(s){return (s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function words(el){var c=el.cloneNode(true);[].forEach.call(c.querySelectorAll("[class*=material-],svg,script,style"),function(x){x.remove()});return norm(c.textContent)||norm(el.getAttribute("aria-label")||el.getAttribute("title"))}
function has(a,b){return (" "+a+" ").indexOf(" "+b+" ")>=0}
function find(t){if(t.length<3)return;var best,gap=1e9;T.forEach(function(s){s.names.forEach(function(n){
var d=n===t?-1:(t.length>=4&&(has(n,t)||has(t,n)))?Math.abs(n.length-t.length):1e9;if(d<gap){gap=d;best=s.id}})});return best}
document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("a,button,[role=button],[role=link],[role=tab],[role=menuitem]");if(!el)return;
if(el.tagName==="A")e.preventDefault();var id=find(words(el));if(id){e.preventDefault();parent.postMessage({factoryGo:id},"*")}},true);
document.addEventListener("submit",function(e){e.preventDefault()},true);})();`;
}

/**
 * A Stitch screen's HTML as its live page. Parsed and rebuilt (cheerio), so split or odd markup cannot slip through: every script
 * goes but Tailwind's browser build and the settings Stitch wrote for it, with every handler attribute, frame and javascript:
 * link; then the policy and the script that makes the page's links open the demo's other screens are added.
 */
export function stitchLiveHtml(html: string, self: string, screens: LiveScreen[]): string {
  const $ = load(html);
  $(DANGEROUS).remove();
  $("*").each((_, el) => { if (!/^[a-z][a-z0-9-]*$/i.test((el as { tagName?: string }).tagName ?? "")) $(el).replaceWith($(el).contents()); });
  $("script").each((_, el) => {
    const src = $(el).attr("src");
    const tailwind = src !== undefined && (src === TAILWIND || src.startsWith(`${TAILWIND}/`) || src.startsWith(`${TAILWIND}?`));
    const settings = src === undefined && /^\s*tailwind\.config\s*=\s*\{[\s\S]*\}\s*;?\s*$/.test($(el).text());
    if (!tailwind && !settings) $(el).remove();
  });
  $("*").each((_, el) => {
    for (const [name, value] of Object.entries((el as { attribs?: Record<string, string> }).attribs ?? {})) {
      const n = name.toLowerCase();
      const runs = /^\s*(javascript|vbscript|data):/i.test(value) && !(n === "src" && /^\s*data:image\/(png|jpe?g|gif|webp);/i.test(value));
      if (n.startsWith("on") || n === "srcdoc" || (URL_ATTRS.has(n) && runs)) $(el).removeAttr(name);
    }
  });
  if (!$("head").length) $("html").prepend("<head></head>");
  $("head").prepend(`<meta http-equiv="Content-Security-Policy" content="${LIVE_CSP}"><meta name="referrer" content="no-referrer">`);
  $("body").append(`<script>${clickScript(self, screens)}</script>`);
  return $.html();
}

/**
 * The live page of each frame of a Stitch design, for the run's preview folder (stitch/ST-1.html); none for a JSON design.
 * A frame whose HTML cannot be read is left out: its screen shows its picture.
 */
export function stitchLiveFiles(
  design: { engine?: string; screens: { id: string; route: string; facts?: { title?: string; headings?: string[] } }[]; stitch?: { frames: Record<string, { screen?: string; html: string }> } },
  getArtifact: (sha: string) => Buffer,
): { frame: string; path: string; content: string }[] {
  if (design.engine !== "stitch" || !design.stitch) return [];
  const screens: LiveScreen[] = design.screens.map((s) => ({ id: s.id, route: s.route, ...(s.facts?.title ? { title: s.facts.title } : {}), ...(s.facts?.headings ? { headings: s.facts.headings } : {}) }));
  return Object.entries(design.stitch.frames).flatMap(([frame, f]) => {
    if (!f.screen || !/^[A-Za-z0-9-]+$/.test(frame)) return [];
    try { return [{ frame, path: `${LIVE_DIR}/${frame}.html`, content: stitchLiveHtml(getArtifact(f.html).toString("utf8"), f.screen, screens) }]; } catch { return []; }
  });
}
