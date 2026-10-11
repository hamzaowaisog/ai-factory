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

/** A link the screen list gave a page: the words on the control and the screen it opens. */
export interface LiveLink { label: string; to: string }
export interface LiveScreen { id: string; route: string; title?: string; headings?: string[]; links?: LiveLink[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The names a link or button may call a screen by: its title, its first heading, and its route's words ("/" is home). */
export function liveNames(s: LiveScreen): string[] {
  const parts = s.route.split(/[/?#]/).filter((p) => p && !/^[:{[]/.test(p));
  const route = parts.length ? [parts[parts.length - 1]!, parts.join(" ")] : ["home", "dashboard", "overview"];
  return [...new Set([s.title ?? "", s.headings?.[0] ?? "", ...route].map(norm).filter((n) => n.length >= 3))];
}

/** Words that say nothing about which screen is meant. */
const COMMON = new Set(["the", "and", "for", "with", "your", "our", "all", "new", "view", "open", "see", "show", "manage", "admin", "app", "page", "list", "details", "detail", "back", "this", "that", "from", "into", "error", "state", "success", "empty", "loading", "default", "normal", "validation"]);
/** A control that starts with one of these acts on the page it is on; it is never guessed to be a way to another screen. */
const ACTS = ["claim", "remove", "delete", "cancel", "save", "flag", "copy", "edit", "update", "toggle", "export", "download", "retry", "try", "close", "confirm", "submit", "apply", "reset", "clear", "search", "filter", "sort"];
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const keys = (s: string) => [...new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !COMMON.has(w)).map(stem))];

/** The words a screen is guessed by when no name fits: its route's (a title carries the product's name and sample content). */
export function liveWords(s: LiveScreen): string[] {
  return keys(s.route.split(/[/?#]/).filter((p) => p && !/^[:{[]/.test(p)).join(" "));
}

/**
 * The script a live page gets: a click on a link, button or tab asks the demo to open the screen it leads to. A link never
 * leaves the page and a form is never sent. The screen is found, in order: by the links the screen list gave this page, then
 * by what any page calls a screen; by a screen's name (exact, else the click's words inside the name or the name inside the
 * click's words, the closest in length first); and last by the words the click shares with one screen's route, when one screen
 * alone shares the most and the control is not an action on its own page.
 */
function clickScript(self: string, screens: LiveScreen[], site = false): string {
  const others = screens.filter((s) => s.id !== self);
  const known = new Set(others.map((s) => s.id));
  const own: Record<string, string> = {};
  for (const l of screens.find((s) => s.id === self)?.links ?? []) { const k = norm(l.label); if (k && known.has(l.to) && !(k in own)) own[k] = l.to; }
  // what the other pages call a screen: a label that means two screens means neither here
  const said = new Map<string, string | null>();
  const ids = new Set(screens.map((s) => s.id));
  for (const s of screens) for (const l of s.links ?? []) { const k = norm(l.label); if (!k || !ids.has(l.to)) continue; said.set(k, said.has(k) && said.get(k) !== l.to ? null : l.to); }
  const any = Object.fromEntries([...said].filter((e): e is [string, string] => e[1] !== null && known.has(e[1]) && !(e[0] in own)));
  const table = others.map((s) => ({ id: s.id, names: liveNames(s), words: liveWords(s) }));
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `(function(){var T=${json(table)},L=${json(own)},A=${json(any)},C=${json([...COMMON])},V=${json(ACTS)};
function norm(s){return (s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function words(el){var c=el.cloneNode(true);[].forEach.call(c.querySelectorAll("[class*=material-],svg,script,style"),function(x){x.remove()});return norm(c.textContent)||norm(el.getAttribute("aria-label")||el.getAttribute("title"))}
function has(a,b){return (" "+a+" ").indexOf(" "+b+" ")>=0}
function stem(w){return w.length>3&&/[^s]s$/.test(w)?w.slice(0,-1):w}
function guess(t){var w=t.split(" ");if(w.length>4||V.indexOf(w[0])>=0)return;var k=[];w.forEach(function(x){if(x.length>=3&&C.indexOf(x)<0&&k.indexOf(stem(x))<0)k.push(stem(x))});if(!k.length)return;
var best,top=0,tie=false;T.forEach(function(s){var n=0;k.forEach(function(x){if(s.words.indexOf(x)>=0)n++});
if(n*2<k.length)return;if(n>top){top=n;best=s.id;tie=false}else if(n===top&&n>0)tie=true});return tie?undefined:best}
function find(t){if(t.length<3)return;if(L[t])return L[t];if(A[t])return A[t];var best,gap=1e9;T.forEach(function(s){s.names.forEach(function(n){
var d=n===t?-1:(t.length>=4&&(has(n,t)||has(t,n)))?Math.abs(n.length-t.length):1e9;if(d<gap){gap=d;best=s.id}})});return best||guess(t)}
document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("a,button,[role=button],[role=link],[role=tab],[role=menuitem]");if(!el)return;
if(el.tagName==="A")e.preventDefault();var id=find(words(el));if(id){e.preventDefault();${site ? 'location.href=id+".html"' : 'parent.postMessage({factoryGo:id},"*")'}}},true);
document.addEventListener("submit",function(e){e.preventDefault()},true);})();`;
}

/**
 * A Stitch screen's HTML as its live page. Parsed and rebuilt (cheerio), so split or odd markup cannot slip through: every script
 * goes but Tailwind's browser build and the settings Stitch wrote for it, with every handler attribute, frame and javascript:
 * link; then the policy and the script that makes the page's links open the demo's other screens are added. With `site`, a link
 * opens the other screen's own file beside this one (S-2.html): the page is one of a folder of pages, not a frame in the demo.
 */
export function stitchLiveHtml(html: string, self: string, screens: LiveScreen[], site = false): string {
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
  $("body").append(`<script>${clickScript(self, screens, site)}</script>`);
  return $.html();
}

/**
 * The live page of each frame of a Stitch design, for the run's preview folder (stitch/ST-1.html); none for a JSON design.
 * A frame whose HTML cannot be read is left out: its screen shows its picture.
 */
export function stitchLiveFiles(
  design: { engine?: string; screens: { id: string; route: string; facts?: { title?: string; headings?: string[] } }[]; stitch?: { frames: Record<string, { screen?: string; html: string }>; links?: Record<string, LiveLink[]> } },
  getArtifact: (sha: string) => Buffer,
): { frame: string; path: string; content: string }[] {
  if (design.engine !== "stitch" || !design.stitch) return [];
  const screens: LiveScreen[] = design.screens.map((s) => ({ id: s.id, route: s.route, ...(s.facts?.title ? { title: s.facts.title } : {}), ...(s.facts?.headings ? { headings: s.facts.headings } : {}), ...(design.stitch?.links?.[s.id] ? { links: design.stitch.links[s.id]! } : {}) }));
  return Object.entries(design.stitch.frames).flatMap(([frame, f]) => {
    if (!f.screen || !/^[A-Za-z0-9-]+$/.test(frame)) return [];
    try { return [{ frame, path: `${LIVE_DIR}/${frame}.html`, content: stitchLiveHtml(getArtifact(f.html).toString("utf8"), f.screen, screens) }]; } catch { return []; }
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * A Stitch design as a folder of web pages, for the HTML export: each screen Stitch drew as its own page (pages/S-1.html, and
 * pages/S-1-error.html for a state), whose links open the other screens' pages, and a contents page that lists them. `read`
 * gives a frame's HTML as the package holds it (screens/S-1.html), or undefined. None for a JSON design.
 */
export function stitchSiteFiles(
  design: { engine?: string; screens: { id: string; route: string; facts?: { title?: string; headings?: string[] } }[]; stitch?: { frames: Record<string, { screen?: string; state?: string }>; links?: Record<string, LiveLink[]> } },
  read: (path: string) => string | undefined, title: string,
): { path: string; content: string }[] {
  if (design.engine !== "stitch" || !design.stitch) return [];
  const screens: LiveScreen[] = design.screens.map((s) => ({ id: s.id, route: s.route, ...(s.facts?.title ? { title: s.facts.title } : {}), ...(s.facts?.headings ? { headings: s.facts.headings } : {}), ...(design.stitch?.links?.[s.id] ? { links: design.stitch.links[s.id] } : {}) }));
  const pages: { path: string; content: string }[] = [], rows: string[] = [];
  for (const s of design.screens) {
    const mine = Object.values(design.stitch.frames).filter((f) => f.screen === s.id && /^[A-Za-z0-9-]+$/.test(s.id)).sort((a, b) => Number(b.state === "normal" || !b.state) - Number(a.state === "normal" || !a.state));
    const made: string[] = [];
    for (const f of mine) {
      const state = !f.state || f.state === "normal" ? "" : f.state;
      if (!/^[a-z0-9-]*$/i.test(state)) continue;
      const name = `${s.id}${state ? `-${state}` : ""}.html`, html = read(`screens/${name}`);
      if (html === undefined) continue;
      try { pages.push({ path: `pages/${name}`, content: stitchLiveHtml(html, s.id, screens, true) }); } catch { continue; }
      made.push(`<a href="pages/${name}">${esc(state || "page")}</a>`);
    }
    if (made.length) rows.push(`<li><b>${esc(s.id)}</b> <code>${esc(s.route)}</code>${s.facts?.title ? ` ${esc(s.facts.title)}` : ""} <span>${made.join(" ")}</span></li>`);
  }
  if (!pages.length) return [];
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c2430;max-width:760px;margin:40px auto;padding:0 16px}h1{font-size:22px}ul{list-style:none;padding:0}li{padding:10px 0;border-bottom:1px solid #e3e7ee}code{color:#5b6676}span{float:right}a{color:#1f6feb;margin-left:10px}p{color:#5b6676}</style></head>
<body><h1>${esc(title)}</h1><p>Each screen as its own web page. Open one, then use its own links and buttons to move to the others.</p><ul>${rows.join("")}</ul></body></html>
`;
  return [{ path: "index.html", content: index }, ...pages];
}
