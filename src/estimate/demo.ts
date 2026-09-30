// The clickable demo of an approved design (docs/estimates-design.md, "Design baseline"). Pure code, no model:
// one self-contained HTML page that lets a person walk the screen inventory before approving it. Each screen
// is a panel with its route, the requirements it serves (with their text), and a button per state; an attached
// Figma frame shows in place of the wireframe when the design cites it. Nothing in the page is fetched, and
// every value from the model or the request is escaped, so opening it runs only the page's own script.
import { wireframeSvg } from "./wireframe.js";
import type { DesignOut } from "../stages/design.js";
import type { z } from "zod";

type Screen = z.infer<typeof DesignOut>["screens"][number];
export interface DemoInput {
  title: string;
  flow: string;
  screens: Screen[];
  /** requirement id -> its EARS text */
  requirements: Record<string, string>;
  noScreen: { req: string; reason: string }[];
  /** frame id (F-1) -> the image as a data: URI; frames without one are listed by name only */
  frames?: Record<string, { name: string; dataUri?: string }>;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };
const MAX_FRAME_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 8_000_000;

/** A frame file as a data: URI, or undefined when it is not an image or too large to embed. Shown through <img>, so an svg cannot run script. */
export function frameDataUri(name: string, bytes: Uint8Array, used = 0): string | undefined {
  const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type || bytes.length > MAX_FRAME_BYTES || used + bytes.length > MAX_TOTAL_BYTES) return undefined;
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function buildDemo(d: DemoInput): string {
  const screens = d.screens;
  const frame = (id: string) => d.frames?.[id];
  const panel = (s: Screen, i: number): string => {
    const states = s.states.length ? s.states : ["default"];
    const shown = s.frames.map(frame).filter((f) => f?.dataUri);
    const reqs = s.reqs.map((r) => `<li><b>${esc(r)}</b> ${esc(d.requirements[r] ?? "")}</li>`).join("");
    return `<section class="screen" id="${esc(s.id)}" data-i="${i}" hidden>
<header><h2>${esc(s.id)} <code>${esc(s.route)}</code></h2><span class="tag">${esc(s.size)}</span></header>
<p class="file">${esc(s.file)}</p>
<div class="states" role="tablist">${states.map((st, k) => `<button role="tab" data-state="${k}"${k === 0 ? ' class="on"' : ""}>${esc(st)}</button>`).join("")}</div>
<div class="canvas">${shown.length
    ? shown.map((f) => `<img src="${f!.dataUri}" alt="${esc(f!.name)}">`).join("")
    : states.map((st, k) => `<div class="wire" data-wf="${k}"${k === 0 ? "" : " hidden"}>${wireframeSvg(s, st, s.reqs.map((r) => ({ id: r, text: d.requirements[r] ?? "" })))}</div>`).join("")}</div>
<h3>Serves</h3><ul>${reqs || "<li>no requirement</li>"}</ul>
<p class="nav">${screens.filter((o) => o.id !== s.id).map((o) => `<a href="#${esc(o.id)}">${esc(o.id)} ${esc(o.route)}</a>`).join(" ")}</p>
</section>`;
  };
  const side = screens.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.id)} <code>${esc(s.route)}</code></a></li>`).join("");
  const none = d.noScreen.map((n) => `<li><b>${esc(n.req)}</b> ${esc(d.requirements[n.req] ?? "")} <i>(no screen: ${esc(n.reason)})</i></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${esc(d.title)} - design demo</title>
<style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;color:#1a1a1a;background:#fafafa}
aside{width:250px;padding:16px;background:#fff;border-right:1px solid #ddd;flex:none}main{flex:1;padding:24px;max-width:860px}
ul{padding-left:18px}aside ul{list-style:none;padding:0}aside a{display:block;padding:6px 8px;border-radius:6px;text-decoration:none;color:inherit}aside a.on{background:#e8eefc}
code,.file{color:#555;font-size:13px}header{display:flex;gap:12px;align-items:center}.tag{background:#eee;border-radius:10px;padding:1px 10px;font-size:12px}
.states button{margin:0 6px 6px 0;padding:4px 12px;border:1px solid #bbb;background:#fff;border-radius:14px;cursor:pointer}.states .on{background:#1a1a1a;color:#fff}
.canvas{border:1px solid #ccc;background:#fff;border-radius:8px;padding:16px;min-height:200px}.canvas img{max-width:100%;display:block;margin:0 auto 12px}
.wire svg{display:block;max-width:640px;margin:0 auto}
.nav a{margin-right:10px}@media(max-width:700px){body{display:block}aside{width:auto;border-right:0;border-bottom:1px solid #ddd}}
</style></head><body>
<aside><h1 style="font-size:16px">${esc(d.title)}</h1><p>${esc(d.flow)}</p><ul>${side}</ul>${none ? `<h3>No screen</h3><ul>${none}</ul>` : ""}</aside>
<main>${screens.map(panel).join("\n")}</main>
<script>
(function(){
  var secs=[].slice.call(document.querySelectorAll(".screen")),links=[].slice.call(document.querySelectorAll("aside a"));
  function show(){var id=decodeURIComponent((location.hash||"").slice(1))||(secs[0]&&secs[0].id);
    secs.forEach(function(s){s.hidden=s.id!==id});links.forEach(function(a){a.className=a.getAttribute("href")==="#"+id?"on":""})}
  secs.forEach(function(s){[].slice.call(s.querySelectorAll("[data-state]")).forEach(function(b){b.addEventListener("click",function(){
    [].slice.call(s.querySelectorAll("[data-state]")).forEach(function(x){x.className=""});b.className="on";
    var k=b.getAttribute("data-state");[].slice.call(s.querySelectorAll("[data-wf]")).forEach(function(w){w.hidden=w.getAttribute("data-wf")!==k})})})});
  window.addEventListener("hashchange",show);show();
})();
</script></body></html>
`;
}
