// AI Factory screens: one page, hash routes. Everything the server sends is data; text goes into
// the page with textContent, and card/PR Markdown goes through md.js (escaped first).
// There is no button that decides anything: cards show the terminal command to paste.
import { renderMarkdown } from "./md.js";

const view = document.getElementById("view");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let timer = 0;
let generation = 0;

// ---------- DOM helpers ----------

/** h("div", { class: "x", onclick }, "text", child): strings become text nodes, never HTML. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "vars") for (const [n, x] of Object.entries(v)) el.style.setProperty(n, String(x));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function md(text, cls = "md") {
  const el = h("div", { class: cls });
  el.innerHTML = renderMarkdown(text); // escaped by renderMarkdown; no raw HTML survives
  return el;
}

// a small icon set, drawn for this page (24×24, stroked)
const ICONS = {
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
  x: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  loop: [["path", { d: "M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" }]],
  alert: [["path", { d: "M12 3.5l9.5 16.5h-19z" }], ["path", { d: "M12 10v4M12 17.3v.2" }]],
  pause: [["path", { d: "M9 6v12M15 6v12" }]],
  terminal: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }], ["path", { d: "M7 9.5l3 2.5-3 2.5M12.5 15H17" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7.5V12l3 2" }]],
  dollar: [["path", { d: "M12 3v18M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1.2-4.5 3.2c0 4.3 9 2.3 9 6.8 0 2-2 3.5-4.5 3.5S7.5 18 7.5 16" }]],
  file: [["path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }], ["path", { d: "M14 3v5h5M9 13h6M9 17h4" }]],
  upload: [["path", { d: "M12 15.5V4M7 8.5L12 4l5 4.5M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" }]],
  ticket: [["path", { d: "M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" }], ["path", { d: "M14 6.5v2M14 11v2M14 15.5v2" }]],
  pen: [["path", { d: "M4 20h4L19 9l-4-4L4 16z" }], ["path", { d: "M13.5 6.5l4 4" }]],
  layers: [["path", { d: "M12 3l9 5-9 5-9-5z" }], ["path", { d: "M3 12.5l9 5 9-5M3 17l9 5 9-5" }]],
  sprout: [["path", { d: "M12 21v-8M12 13C12 8 8.5 5.5 4 5.5c0 4.5 3.5 7.5 8 7.5zM12 15c0-4 3-6.5 7.5-6.5 0 4-3 6.5-7.5 6.5z" }]],
  ruler: [["path", { d: "M4 17L17 4l3 3L7 20z" }], ["path", { d: "M8 13l2 2M11 10l2 2M14 7l2 2" }]],
  arrow: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  copy: [["rect", { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ["path", { d: "M15 5.5V5a1 1 0 0 0-1-1H6a2 2 0 0 0-2 2v8a1 1 0 0 0 1 1h.5" }]],
  sun: [["circle", { cx: 12, cy: 12, r: 4 }], ["path", { d: "M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }]],
  moon: [["path", { d: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" }]],
  shield: [["path", { d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" }], ["path", { d: "M8.5 12l2.5 2.5 4.5-4.5" }]],
  activity: [["path", { d: "M3 12h4l3-7.5 4 15 3-7.5h4" }]],
  image: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ["circle", { cx: 9, cy: 9.5, r: 1.8 }], ["path", { d: "M21 16l-5-5-9 9" }]],
  cursor: [["path", { d: "M5 3.5l6 16.5 2.5-7 7-2.5z" }]],
  grid: [["rect", { x: 4, y: 4, width: 7, height: 7, rx: 1.5 }], ["rect", { x: 13, y: 4, width: 7, height: 7, rx: 1.5 }], ["rect", { x: 4, y: 13, width: 7, height: 7, rx: 1.5 }], ["rect", { x: 13, y: 13, width: 7, height: 7, rx: 1.5 }]],
  browser: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ["path", { d: "M3 9h18M6.5 6.5h.01M9 6.5h.01" }]],
  bars: [["path", { d: "M5 20v-8M12 20V5M19 20v-5M3 20h18" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  search: [["circle", { cx: 11, cy: 11, r: 6.5 }], ["path", { d: "M16 16l4.5 4.5" }]],
  download: [["path", { d: "M12 4v11.5M7 11l5 4.5 5-4.5M4 19.5h16" }]],
  user: [["circle", { cx: 12, cy: 8, r: 4 }], ["path", { d: "M4 21a8 8 0 0 1 16 0" }]],
  code: [["path", { d: "M8.5 7l-5 5 5 5M15.5 7l5 5-5 5" }]],
  gauge: [["path", { d: "M3.5 16a8.5 8.5 0 1 1 17 0" }], ["path", { d: "M12 16l4-5" }]],
};

function icon(name, cls = "i") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

const money = (n) => (n === undefined || n === null ? "-" : `$${Number(n).toFixed(2)}`);
const pct = (n) => (n === undefined || n === null ? "-" : `${Math.round(n * 100)}%`);
const mins = (n) => (n === undefined || n === null ? "-" : `${n.toFixed(n < 10 ? 1 : 0)} min`);
const secs = (n) => (n >= 90 ? `${Math.round(n / 60)} min` : `${Math.round(n)}s`);

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Colour family for a run or step status. */
function tone(status) {
  const s = String(status);
  if (s === "delivered" || s === "completed" || s.startsWith("closed: merged")) return "ok";
  if (s === "running" || s === "created") return "live";
  if (s === "waiting" || s === "decided" || s === "paused" || s === "interrupted") return "wait";
  if (s === "parked" || s === "failed" || s.startsWith("closed")) return "bad";
  return "idle";
}
const WORDS = { created: "created", running: "running", waiting: "waiting for you", paused: "paused", parked: "parked", delivered: "delivered", completed: "done", failed: "failed", interrupted: "interrupted", pending: "not started", decided: "decided · continues next" };
const pill = (status, text) => h("span", { class: `pill t-${tone(status)}` }, h("span", { class: "d" }), text ?? WORDS[status] ?? status);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function api(path, init) {
  const res = await fetch(path, { credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  if (!res.ok) throw new HttpError(res.status, body.error ?? `HTTP ${res.status}`);
  return body;
}

function copyButton(text, label = "Copy") {
  const b = h("button", { class: "btn sm copy", type: "button", title: "Copy to the clipboard" }, icon("copy"), label, h("span", { class: "ok" }, icon("check"), "Copied"));
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = h("textarea", {}, text);
      document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
    }
    b.classList.add("done");
    setTimeout(() => b.classList.remove("done"), 1400);
  });
  return b;
}

/** Numbers that count up (skipped when motion is reduced). */
function countUp(el, to, fmt, from = 0) {
  if (reduced || from === to || !Number.isFinite(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = fmt(from);
  requestAnimationFrame(step);
}

/** After the next frame: lets CSS transitions start from the first state. */
const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

function mount(nodes, enter) {
  view.replaceChildren(...nodes.filter(Boolean));
  if (enter) { view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); }
}

function skeleton(kind) {
  const rows = (n) => Array.from({ length: n }, () => h("div", { class: "skel row" }));
  const blocks = kind === "grid" ? h("div", { class: "grid-2" }, h("div", { class: "skel block" }), h("div", { class: "skel block" })) : h("div", { class: "panel" }, rows(6));
  mount([h("div", { class: "skel h1" }), blocks], true);
}

function showError(e) {
  if (e instanceof HttpError && e.status === 401) {
    mount([h("div", { class: "locked panel" }, h("h1", {}, "Session key needed"), h("p", { class: "sub" }, "Open the link that factory ui printed in your terminal."))], true);
    return;
  }
  mount([h("div", { class: "error" }, icon("alert"), h("span", {}, String(e.message ?? e)))], true);
}

/** Re-render every `ms` while this route is showing. */
function poll(ms, fn) {
  const gen = generation;
  let first = true;
  const tick = async () => {
    if (gen !== generation) return;
    try { await fn(first); } catch (e) { if (gen === generation) showError(e); return; }
    first = false;
    if (gen === generation) timer = setTimeout(tick, ms);
  };
  tick();
}

// ---------- theme ----------

const themeBtn = document.getElementById("theme");
function currentTheme() {
  return document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function paintThemeButton() {
  themeBtn.replaceChildren(icon(currentTheme() === "dark" ? "sun" : "moon"));
  themeBtn.title = currentTheme() === "dark" ? "Light theme" : "Dark theme";
}
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("factory-theme", next); } catch { /* storage blocked: this visit only */ }
  paintThemeButton();
});
paintThemeButton();

// ---------- new run: mode ----------

function modeScreen() {
  const card = (i, ico, title, text, href) => href
    ? h("a", { class: "panel mode rise", href, vars: { "--i": i } }, h("div", { class: "ico" }, icon(ico)), h("h2", {}, title), h("p", {}, text),
      h("div", { class: "go" }, "Start", icon("arrow")))
    : h("div", { class: "panel mode off rise", "aria-disabled": "true", vars: { "--i": i } }, h("div", { class: "ribbon" }, "not built yet"), h("div", { class: "ico" }, icon(ico)), h("h2", {}, title), h("p", {}, text),
      h("div", { class: "go faint" }, "Not built yet"));
  mount([
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "New run"), h("h1", {}, "What kind of work is it?"),
      h("p", { class: "sub" }, "The factory turns a request into a tested branch. You approve the plan in your terminal, and answer questions there or on the run page (estimates can be approved on the web)."))),
    h("div", { class: "grid-3 grid-4" },
      card(0, "layers", "Brownfield", "Change an existing .NET repo: request → spec → plan you approve → tests first → code → reviewed branch.", "#/new/brownfield"),
      card(1, "sprout", "Greenfield", "Start a new app from a request."),
      card(2, "ruler", "Estimate", "Size and price a request before any code is written: hours, API cost, elapsed time and the screens. The lead approves it on the Estimate tab (or in the terminal), then two workbooks are written.", "#/new/estimate"),
      card(3, "image", "Design", "See the design first: requirements and any references → spec → mock, clickable demo and look, approved by a lead. Nothing is sized or built; an estimate or build can take the approved design later.", "#/new/design"),
    ),
  ], true);
}

// ---------- new run: request ----------

// design references (any mode, like --ref): files and links, each with a role and a note. The same limits are checked again
// on the server, and every reference is read before the run exists, so one that cannot be read costs nothing.
const REF_MAX = 12, REF_FILE_MAX = 25e6, REF_DOCX_MAX = 50e6, REF_TOTAL_MAX = 50e6;
const REF_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.bmp,.pdf,.docx,.json";
function refsPicker(meta, projectOf = () => "") {
  const rows = [];
  const err = h("div", { class: "small ref-err", role: "status" });
  const list = h("div", { class: "ref-list" });
  const count = h("span", { class: "faint small" });
  const fileInput = h("input", { type: "file", multiple: true, accept: REF_ACCEPT, id: "refs" });
  const link = h("input", { type: "url", id: "reflink", placeholder: "https://client.com or a figma.com/design/… link", "aria-label": "Reference link" });
  const say = (m) => { err.textContent = m || ""; };
  const total = () => rows.reduce((n, r) => n + (r.file ? r.file.size : 0), 0);
  const paint = () => {
    list.replaceChildren(...rows.map((r, i) => h("div", { class: "ref-row" },
      h("span", { class: "ref-id mono" }, `R-${i + 1}`),
      h("span", { class: "ref-src" }, icon(r.file ? (/\.(pdf|docx|json)$/i.test(r.file.name) ? "file" : "image") : "browser"), h("span", { class: "mono", title: r.file ? r.file.name : r.url }, r.file ? r.file.name : r.url),
        r.file ? h("span", { class: "faint small" }, `${Math.max(1, Math.round(r.file.size / 1000))} KB`) : null),
      r.roleEl, r.noteEl,
      h("button", { class: "btn sm ghost", type: "button", "aria-label": `Remove R-${i + 1}`, onclick: () => { rows.splice(i, 1); say(""); paint(); } }, icon("x")))));
    count.textContent = rows.length ? `${rows.length} of ${REF_MAX}${total() ? ` · ${(total() / 1e6).toFixed(1)} MB` : ""}` : "";
  };
  const row = (x) => {
    const roleEl = h("select", { "aria-label": "Role" }, h("option", { value: "auto" }, "auto"), h("option", { value: "match" }, "match: use its look exactly"), h("option", { value: "inspire" }, "inspire: its family and feel"), h("option", { value: "layout" }, "layout: how screens are arranged"));
    const noteEl = h("input", { type: "text", maxlength: "500", placeholder: "note (optional), e.g. the table like this", "aria-label": "Note" });
    return { ...x, roleEl, noteEl };
  };
  const key = (r) => (r.file ? r.file.name : r.url);
  const add = (r) => {
    if (rows.length >= REF_MAX) return say(`A run takes at most ${REF_MAX} design references.`), false;
    if (rows.some((x) => key(x) === key(r))) return say(`${key(r)} is already attached.`), false;
    if (r.file) {
      if (/\.fig$/i.test(r.file.name)) return say(`${r.file.name}: a .fig file can't be read. Share a Figma link, or export the frames as PNG.`), false;
      const cap = /\.docx$/i.test(r.file.name) ? REF_DOCX_MAX : REF_FILE_MAX;
      if (r.file.size > cap) return say(`${r.file.name} is over ${cap / 1e6} MB.`), false;
      if (total() + r.file.size > REF_TOTAL_MAX) return say(`The reference files would come to over ${REF_TOTAL_MAX / 1e6} MB together. Attach fewer, or link the site or Figma file instead.`), false;
    }
    rows.push(row(r));
    return true;
  };
  const takeFiles = (files) => { say(""); for (const f of files ?? []) if (!add({ file: f })) break; paint(); fileInput.value = ""; };
  const addLink = () => {
    const u = link.value.trim();
    if (!u) return;
    if (!/^https:\/\/\S{3,}$/i.test(u)) return say("Give an https link to a website or a Figma file.");
    say("");
    if (add({ url: u })) link.value = "";
    paint();
  };
  fileInput.addEventListener("change", () => takeFiles(fileInput.files));
  link.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } });
  const drop = h("label", { class: "drop slim", for: "refs" }, fileInput, icon("image"), h("strong", {}, "Drop or choose files"), h("span", { class: "small muted" }, "images, PDF, Word (.docx) or a Figma JSON export"));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); takeFiles(e.dataTransfer?.files); });
  const figma = meta.figma?.configured
    ? h("div", { class: "hint" }, "Figma links are read with your FIGMA_TOKEN: frames as pictures, colours and fonts exactly.")
    : h("div", { class: "jira-off" }, icon("alert"), h("span", {}, meta.figma?.why ?? "Figma links need FIGMA_TOKEN in ~/.factory/.env."));
  const node = h("div", { class: "refs" },
    drop,
    h("div", { class: "ref-add" }, link, h("button", { class: "btn sm", type: "button", onclick: addLink }, icon("plus"), "Add link")),
    figma, list, h("div", { class: "row" }, count, err),
    h("div", { class: "hint" }, "Role: match uses its colours, type and corners exactly (a brand guide or Figma file starts as match); inspire keeps its colour family and feel; layout takes only how its screens are arranged. Auto picks for you. A site behind a login can't be read: attach screenshots instead."));
  const b64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(new Error(`Could not read ${f.name}.`)); r.readAsDataURL(f); });
  const collect = () => Promise.all(rows.map(async (r) => ({ ...(r.file ? { kind: "file", name: r.file.name, data: await b64(r.file) } : { kind: "url", url: r.url }), role: r.roleEl.value, ...(r.noteEl.value.trim() ? { note: r.noteEl.value.trim() } : {}) })));
  // read them now, like factory design check-refs: no model and no cost, and nothing is kept
  const checked = h("div", { class: "ref-check", role: "status" });
  const checkBtn = h("button", { class: "btn sm", type: "button" }, icon("search"), "Check references");
  checkBtn.addEventListener("click", async () => {
    if (!rows.length) { checked.replaceChildren(h("p", { class: "small muted" }, "Add a reference to check.")); return; }
    checkBtn.disabled = true;
    checked.replaceChildren(h("p", { class: "small muted" }, h("span", { class: "spin" }), ` Reading ${rows.length} reference${rows.length === 1 ? "" : "s"}…`));
    try {
      const v = await api("/api/check-refs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectOf(), refs: await collect() }) });
      checked.replaceChildren(...v.references.map(checkedRef));
    } catch (e) { checked.replaceChildren(h("div", { class: "small ref-err" }, icon("alert"), e.message)); }
    checkBtn.disabled = false;
  });
  node.append(h("div", { class: "row" }, checkBtn, h("span", { class: "hint" }, "Reads them now and shows what each gives, like factory design check-refs. No model, no cost.")), checked);
  return {
    node,
    count: () => rows.length,
    collect,
  };
}

/** One checked reference: what was read from it (pictures, colours, fonts, corners) and its notes. */
function checkedRef(r) {
  const swatch = (c) => h("span", { class: "sw", title: `${c.hex}${c.role ? ` ${c.role}` : ""}`, vars: { "--c": /^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : "transparent" } });
  return h("article", { class: "ref-card checked" }, h("div", { class: "ref-body" },
    h("div", { class: "row" }, h("strong", { class: "mono" }, r.id), h("span", { class: `pill t-${r.role === "match" ? "ok" : r.role === "layout" ? "idle" : "live"}` }, r.roleGiven ? r.role : `${r.role} (auto)`), h("span", { class: "faint small" }, `${r.kind} · ${r.measured === "exact" ? "measured exactly" : "approximate"}`)),
    h("div", { class: "mono small ref-source", title: r.source }, r.source),
    h("div", { class: "small" }, h("span", { class: "faint" }, "pictures: "), r.pictures.length ? r.pictures.map((p) => `${p.label} (${p.width}×${p.height})`).join(", ") : "none"),
    r.colours.length ? h("div", { class: "row small" }, h("span", { class: "faint" }, "colours: "), h("span", { class: "swatches" }, r.colours.slice(0, 10).map(swatch)), h("span", { class: "mono faint" }, r.colours.slice(0, 4).map((c) => c.hex).join(" "))) : h("div", { class: "small" }, h("span", { class: "faint" }, "colours: "), "none read"),
    h("div", { class: "small" }, h("span", { class: "faint" }, "fonts: "), r.fonts.length ? r.fonts.map((f) => f.family).join(", ") : "none read"),
    r.radiusPx !== undefined ? h("div", { class: "small" }, h("span", { class: "faint" }, "corners: "), `${r.radiusPx}px`) : null,
    r.textChars ? h("div", { class: "small" }, h("span", { class: "faint" }, "text: "), `${r.textChars.toLocaleString()} characters`) : null,
    r.notes.length ? h("ul", { class: "small muted" }, r.notes.map((n) => h("li", {}, n))) : null));
}

async function requestScreen(kind = "brownfield", preset = []) {
  const designing = kind === "design";
  // an estimate and a design-only run both start from requirements and may have no project
  const estimating = kind === "estimate" || designing;
  skeleton();
  const meta = await api("/api/projects");
  const err = h("div", { class: "error", hidden: true });
  const project = h("select", { id: "project" },
    h("option", { value: "" }, estimating ? "No project: requirements only (no repo)" : meta.projects.length ? "Choose a project…" : "No projects yet"),
    meta.projects.map((p) => h("option", { value: p.name, disabled: !!p.busy }, p.busy ? `${p.name}  (run ${p.busy.runId} is running)` : p.empty && !estimating ? `${p.name}  (empty repo: for a new product)` : p.name)));
  if (!estimating && meta.projects.length === 1 && !meta.projects[0].busy) project.value = meta.projects[0].name;

  const projectLabel = (p) => (p === "standalone-estimates" ? "no project" : p);
  // a build can start from an approved estimate (its request, spec and tasks are inherited, like --from-estimate) or
  // an approved design run (its request and design, like --from-design); values are e:<run> and d:<run>
  const estimates = meta.estimates ?? [], designs = meta.designs ?? [];
  const fromEst = h("select", { id: "fromest" }, h("option", { value: "" }, "Nothing: a plain change request"),
    estimates.length ? h("optgroup", { label: "Approved estimates" }, estimates.map((e) => h("option", { value: `e:${e.runId}` }, `${e.runId}  ·  ${projectLabel(e.project)}  ·  ${e.request}`))) : null,
    designs.length ? h("optgroup", { label: "Approved designs" }, designs.map((d) => h("option", { value: `d:${d.runId}` }, `${d.runId}  ·  ${projectLabel(d.project)}  ·  ${d.request}${d.repo ? "" : "  (a new product: pick a project with an empty repo)"}`))) : null);
  const buildFrom = () => ({ kind: fromEst.value.slice(0, 1), id: fromEst.value.slice(2) });
  // the run it starts from decides the project
  const seedProject = (p) => { if (p && p !== "standalone-estimates" && [...project.options].some((o) => o.value === p && !o.disabled)) project.value = p; };
  const syncEst = () => {
    for (const id of ["reqblock", "refblock"]) { const b = form.querySelector(`#${id}`); if (b) b.hidden = !!fromEst.value; }
    const { kind: k, id } = buildFrom();
    const from = (k === "e" ? estimates : designs).find((x) => x.runId === id);
    // a new product (a design with no repo) goes into an empty repo: the only one there is, when there is one
    const empties = meta.projects.filter((p) => p.empty && !p.busy);
    seedProject(k === "d" && from && !from.repo ? (empties.length === 1 ? empties[0].name : undefined) : from?.project);
  };
  fromEst.addEventListener("change", syncEst);

  // an estimate can start from something already approved instead of new requirements: a design run (--from-design),
  // or a change to an approved estimate (--revises, with new requirements)
  const startFrom = h("select", { id: "startfrom" },
    h("option", { value: "" }, "New requirements"),
    h("option", { value: "design", disabled: !designs.length }, `An approved design run${designs.length ? "" : " (none yet)"}`),
    h("option", { value: "revises", disabled: !estimates.length }, `A change request to an approved estimate${estimates.length ? "" : " (none yet)"}`));
  const seedRun = h("select", { id: "seedrun", "aria-label": "Run to start from" });
  const seedHint = h("div", { class: "hint" });
  const seedBox = h("div", { class: "fld", id: "seedbox" }, h("label", { for: "seedrun" }, "Run"), seedRun, seedHint);

  // the three inputs, which can be combined like factory start
  const prompt = h("textarea", { id: "prompt", placeholder: estimating ? "Paste the requirements: notes, a brief, a transcript, an email thread. e.g. A customer portal where buyers log in, see their orders and download invoices." : "e.g. Show the number of orders next to the Your orders heading, and keep the heading text." });
  const fileInput = h("input", { type: "file", accept: ".md,.markdown,.txt,text/markdown,text/plain" });
  const jira = h("input", { type: "text", id: "jira", placeholder: "ABC-123 or its link", disabled: !meta.jira.configured });
  let file;
  const fileBox = h("div");
  const dots = { prompt: h("span", { class: "has" }), file: h("span", { class: "has" }), jira: h("span", { class: "has" }) };
  const refreshDots = () => {
    dots.prompt.classList.toggle("on", !!prompt.value.trim());
    dots.file.classList.toggle("on", !!file);
    dots.jira.classList.toggle("on", !jira.disabled && !!jira.value.trim());
  };
  const showFile = () => {
    fileBox.replaceChildren(file ? h("div", { class: "file-chip" }, icon("file"), h("span", { class: "mono" }, file.name), h("span", { class: "faint small" }, `${Math.max(1, Math.round(file.size / 1000))} KB`),
      h("button", { class: "btn sm", type: "button", onclick: () => { file = undefined; fileInput.value = ""; showFile(); } }, icon("x"), "Remove")) : "");
    refreshDots();
  };
  const fail = (msg) => { err.replaceChildren(icon("alert"), h("span", {}, msg)); err.hidden = false; };
  const takeFile = async (f) => {
    err.hidden = true;
    if (!f) return;
    if (!/\.(md|markdown|txt)$/i.test(f.name)) return fail("Upload a Markdown (.md) or text (.txt) file.");
    if (f.size > 1_000_000) return fail(`${f.name} is over 1 MB.`);
    file = { name: f.name, text: await f.text(), size: f.size };
    showFile();
  };
  fileInput.addEventListener("change", () => takeFile(fileInput.files?.[0]));
  const drop = h("label", { class: "drop" }, fileInput, icon("upload"), h("strong", {}, "Drop a .md or .txt file here"), h("span", { class: "small" }, "or click to choose one · read like --file"));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); takeFile(e.dataTransfer?.files?.[0]); });
  prompt.addEventListener("input", refreshDots);
  jira.addEventListener("input", refreshDots);

  const panels = {
    prompt: h("div", { class: "tab-panel" }, prompt),
    file: h("div", { class: "tab-panel" }, drop, fileBox),
    jira: h("div", { class: "tab-panel" }, jira, meta.jira.configured
      ? h("div", { class: "hint" }, "The factory fetches the ticket itself, like --jira. Its text is treated as untrusted input.")
      : h("div", { class: "jira-off" }, icon("alert"), h("span", {}, meta.jira.why))),
  };
  const tabs = {};
  const select = (k) => {
    for (const [name, p] of Object.entries(panels)) p.hidden = name !== k;
    for (const [name, t] of Object.entries(tabs)) { t.classList.toggle("on", name === k); t.setAttribute("aria-selected", String(name === k)); }
    panels[k].classList.remove("tab-panel"); void panels[k].offsetWidth; panels[k].classList.add("tab-panel");
  };
  tabs.prompt = h("button", { class: "tab", type: "button", role: "tab", onclick: () => select("prompt") }, icon("pen"), "Prompt", dots.prompt);
  tabs.file = h("button", { class: "tab", type: "button", role: "tab", onclick: () => select("file") }, icon("upload"), "Upload .md", dots.file);
  tabs.jira = h("button", { class: "tab", type: "button", role: "tab", onclick: () => select("jira") }, icon("ticket"), "Jira key", dots.jira);
  select("prompt");

  // estimate settings, like the factory estimate flags
  const opt = (v, t) => h("option", { value: v }, t);
  const stack = h("select", { id: "stack" }, opt("undecided", "Undecided (default pack)"), opt("client", "Client's stack (fixed)"), opt("folio3", "Folio3 decides"));
  const rounds = h("input", { type: "number", id: "rounds", min: "0", max: "10", step: "1", value: "2" });
  const designIn = h("input", { type: "checkbox", id: "designin", checked: true });
  const noRepo = h("input", { type: "checkbox", id: "norepo" });
  const handsOff = h("input", { type: "checkbox", id: "handsoff" });
  const hdr = h("input", { type: "text", id: "client", placeholder: "client name (workbook header)" });
  const projName = h("input", { type: "text", id: "projname", placeholder: "project name (workbook header)" });
  const pm = h("input", { type: "text", id: "pm", placeholder: "project manager (workbook header)" });
  // design frames exported from Figma (png, jpg, webp, svg or json): read here, sent with the request like --frames
  const frameInput = h("input", { type: "file", multiple: true, accept: ".png,.jpg,.jpeg,.webp,.svg,.json,image/*,application/json", id: "frames" });
  const frameList = h("div", { class: "small muted" }, "No frames attached. Without them each screen is drawn as a wireframe.");
  let frames = [];
  frameInput.addEventListener("change", () => {
    frames = [...(frameInput.files ?? [])];
    const bytes = frames.reduce((n, f) => n + f.size, 0);
    frameList.textContent = frames.length ? `${frames.length} frame${frames.length === 1 ? "" : "s"} (${(bytes / 1e6).toFixed(1)} MB): ${frames.slice(0, 6).map((f) => f.name).join(", ")}${frames.length > 6 ? ", …" : ""}` : "No frames attached. Without them each screen is drawn as a wireframe.";
  });
  const b64 = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(new Error(`Could not read ${f.name}.`)); r.readAsDataURL(f); });
  const fld = (id, label, control, hint) => h("div", { class: "fld" }, h("label", { for: id }, label), control, hint ? h("div", { class: "hint" }, hint) : null);
  const opt2 = (id, control, title, text) => h("label", { class: "opt", for: id }, control, h("span", {}, h("strong", {}, title), h("span", { class: "hint" }, text)));
  const sect = (n, title, text, ...kids) => h("section", { class: "sect" }, h("div", { class: "sect-head" }, h("span", { class: "num" }, String(n)), h("div", {}, h("h3", {}, title), text ? h("p", { class: "muted small" }, text) : null)), ...kids);
  hdr.placeholder = "e.g. Acme Ltd"; projName.placeholder = "e.g. Order portal"; pm.placeholder = "e.g. Sam Lee";
  const standaloneNote = h("div", { class: "hint" });
  const syncProject = () => {
    const none = !project.value;
    noRepo.checked = none || noRepo.checked; noRepo.disabled = none;
    standaloneNote.textContent = designing
      ? (none ? "No project: a new product, so the design gets a look of its own." : "With a project the design follows that app's own look and building blocks.")
      : none
      ? "No project: the estimate is built from the requirements alone, with no code to read. Every task counts as new build work."
      : "With a project the factory reads its code, so changes are sized from the files they touch.";
  };
  if (estimating) { project.addEventListener("change", syncProject); syncProject(); }
  const fresh = h("input", { type: "checkbox", id: "fresh" });
  const settings = designing ? h("div", { class: "est" },
    sect(3, "Product", "Shown on the demo. All optional.",
      h("div", { class: "est-grid" }, fld("client", "Client", hdr), fld("projname", "Product name", projName)),
      h("div", { class: "opts" }, opt2("norepo", noRepo, "The requirements stand alone", "Draw a new look instead of following the project's own. Always on when no project is chosen."))),
    sect(4, "Design frames", "Exported from Figma (png, jpg, webp, svg or json). Optional.",
      h("label", { class: "drop slim", for: "frames" }, frameInput, icon("upload"), h("strong", {}, "Choose frame files"), frameList))) : estimating ? h("div", { class: "est" },
    sect(3, "How it will be delivered", "Solely agentic: the factory builds it, with no supervisor gates. The same choices as factory estimate.",
      h("div", { class: "est-grid" },
        fld("stack", "Stack", stack, "Who picks the technology. Undecided uses a default pack, stated as an assumption."),
        fld("rounds", "Client feedback rounds", rounds, "Rounds of change the client may ask for, allowed for in the hours.")),
      h("div", { class: "opts" },
        opt2("designin", designIn, "Design counts in the total", "Turn off to keep Design out of the Summary total (its row still shows)."),
        opt2("norepo", noRepo, "The requirements stand alone", "There is no existing code to read. Always on when no project is chosen."),
        opt2("handsoff", handsOff, "Hands-off (no human review)", "Nobody is asked: the clarify questions become assumptions and the factory approves the estimate once its checks pass. Off (the default): a person answers the questions and approves it, on the run page or in the terminal. A build cannot follow a hands-off estimate: to build it, estimate it again with a review."))),
    sect(4, "Workbook header", "Shown at the top of the team and client workbooks. All optional.",
      h("div", { class: "est-grid" }, fld("client", "Client", hdr), fld("projname", "Project name", projName), fld("pm", "Project manager", pm))),
    Object.assign(sect(5, "Design frames", "Exported from Figma (png, jpg, webp, svg or json). Optional.",
      h("label", { class: "drop slim", for: "frames" }, frameInput, icon("upload"), h("strong", {}, "Choose frame files"), frameList)), { id: "framesblock" })) : null;

  const refs = refsPicker(meta, () => project.value);
  const refText = designing || estimating ? "Screenshots, a client's site, a Figma file, a brand guide (PDF or Word). The design is drawn from them; without any it follows the field's products. Optional." : "The UI change follows them. Optional.";
  const refBlock = estimating ? h("section", { class: "sect", id: "refblock" }, h("div", { class: "sect-head" }, h("span", { class: "num" }, designing ? "5" : "6"), h("div", {}, h("h3", {}, "Design references"), h("p", { class: "muted small" }, refText))), refs.node)
    : h("div", { class: "field", id: "refblock" }, h("span", { class: "label" }, "Design references (optional)"), refs.node, h("div", { class: "hint" }, refText));
  // formats to export as soon as the design is approved, like --design-export (none by default: exports are on demand)
  const autoX = [["png", "PNG pictures"], ["pdf", "PDF design book"], ["html", "Clickable demo (zip)"], ["tokens", "Design tokens"], ["json", "Design JSON"], ["figma", "Figma (figma.json)"]]
    .map(([v, t]) => h("label", { class: "xopt" }, h("input", { type: "checkbox", value: v }), t));
  const autoXPicked = () => autoX.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
  const autoXHint = h("div", { class: "hint" });
  const syncAutoX = () => {
    autoXHint.textContent = (!estimating && fromEst.value) || (!designing && startFrom.value === "design")
      ? `The ${(!estimating && buildFrom().kind === "d") || startFrom.value === "design" ? "design run's" : "estimate's"} design is approved already, so it is exported as soon as the run starts. Files appear on the run's Design tab.`
      : "Exported right after the design is approved, to the run's Design tab (like --design-export). A request with no UI has no design to export. You can always export later from the Design tab.";
  };
  syncAutoX();
  fromEst.addEventListener("change", syncAutoX);
  startFrom.addEventListener("change", syncAutoX);
  const autoXBox = h("fieldset", { class: "xopts", id: "autox", "aria-label": "Export on approval" }, autoX);
  const autoXBlock = estimating ? sect(designing ? 6 : 7, "Export on approval", "Optional.", autoXBox, autoXHint)
    : h("div", { class: "field" }, h("span", { class: "label" }, "Export the design on approval (optional)"), autoXBox, autoXHint);
  // a build: the stack the approved design is built in when the project sets none, like --ui-target
  const uiTarget = h("select", { id: "uitarget" }, h("option", { value: "" }, "Detect from the repo"), Object.entries(TARGET_LABELS).map(([v, t]) => h("option", { value: v }, t)));
  const uiTargetBlock = !estimating ? h("div", { class: "field" }, h("label", { for: "uitarget" }, "UI target (optional)"), uiTarget,
    h("div", { class: "hint" }, "What the approved design is built in when the project's design.uiTarget sets nothing (like --ui-target). A kit target puts the kit, the theme and every approved page into the repo before the agents start; the agents write the behaviour. Detection picks the kit for a Next.js or Vite app and the repo's own components otherwise.")) : null;
  const maxCost = h("input", { type: "number", id: "maxcost", min: "0.5", step: "0.5", placeholder: "normal limit" });
  const startLabel = designing ? "Start design" : estimating ? "Start estimate" : "Start run";
  const start = h("button", { class: "btn primary", type: "submit" }, startLabel, icon("arrow"));
  const form = h("form", { class: "form", novalidate: true },
    err,
    estimating ? sect(1, designing ? "Project" : "Start from and project", designing ? "Pick one to follow its look, or choose none for a new product." : "New requirements, or something already approved. Pick a project to read its code, or none to estimate from the requirements alone.",
      designing ? null : h("div", { class: "est-grid" }, h("div", { class: "fld" }, h("label", { for: "startfrom" }, "Start from"), startFrom), seedBox),
      h("div", { class: "fld" }, designing ? null : h("label", { for: "project" }, "Project"), project, standaloneNote))
      : h("div", { class: "field" }, h("label", { for: "project" }, "Project"), project, h("div", { class: "hint" }, "From ~/.factory/projects. Add one with factory init <repo>.")),
    !estimating ? h("div", { class: "field" }, h("label", { for: "fromest" }, "Build from (optional)"), fromEst,
      h("div", { class: "hint" }, estimates.length || designs.length
        ? "An approved estimate: its request, spec and tasks carry over, and the build is held to its size and budget (like --from-estimate). An approved design run: its request and design carry over (like --from-design). Choose nothing for a plain change request."
        : "Nothing approved yet. Approve an estimate or a design run first (New run) to build from it; until then this is a plain change request.")) : null,
    h("div", { id: "reqblock", class: estimating ? "sect" : "field" }, estimating ? h("div", { class: "sect-head" }, h("span", { class: "num" }, "2"), h("div", {}, h("h3", {}, "Requirements"), h("p", { class: "muted small" }, "Paste them, upload a file or give a Jira key. They are combined into one request."))) : h("span", { class: "label" }, "Request"),
      h("div", { class: "tabs-in", role: "tablist" }, tabs.prompt, tabs.file, tabs.jira),
      panels.prompt, panels.file, panels.jira,
      h("div", { class: "hint" }, "Use one input or several: they are combined into one request, like factory start does.")),
    settings,
    refBlock,
    autoXBlock,
    uiTargetBlock,
    estimating ? sect(designing ? 7 : 8, "Cost", null, h("div", { class: "fld" }, h("label", { for: "maxcost" }, "Max cost (optional)"), h("div", { class: "money-in" }, h("span", {}, "$"), maxCost), h("div", { class: "hint" }, "It can only lower the normal limit, like --max-cost.")),
      h("div", { class: "opts" }, opt2("fresh", fresh, "Ask the model again", "Don't reuse answers stored from an identical earlier request (like --fresh). It costs more; use it when an answer should be redone.")))
      : h("div", { class: "field" }, h("label", { for: "maxcost" }, "Max cost (optional)"), h("div", { class: "money-in" }, h("span", {}, "$"), maxCost), h("div", { class: "hint" }, "It can only lower the normal limit, like --max-cost.")),
    h("div", { class: "row" }, start, h("span", { class: "hint" }, designing ? "Runs in the background. Questions and the design approval can be answered here on the run page or in your terminal." : "Runs in the background. Questions can be answered here on the run page or in your terminal; the plan approval stays in your terminal.")),
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    start.disabled = true;
    start.replaceChildren(h("span", { class: "spin" }), "Reading the request…");
    try {
      const sent = estimating && frames.length ? await Promise.all(frames.map(async (f) => ({ name: f.name, data: await b64(f) }))) : undefined;
      const seeded = !estimating ? !!fromEst.value : startFrom.value === "design";
      const sentRefs = refs.count() && !seeded ? await refs.collect() : undefined;
      if (sentRefs) start.replaceChildren(h("span", { class: "spin" }), `Reading the request and ${sentRefs.length} design reference${sentRefs.length === 1 ? "" : "s"}…`);
      const designExport = autoXPicked();
      const bf = buildFrom();
      const from = !estimating ? (bf.kind === "e" ? { fromEstimate: bf.id } : bf.kind === "d" ? { fromDesign: bf.id } : {})
        : startFrom.value && seedRun.value ? { [{ design: "fromDesign", revises: "revises" }[startFrom.value]]: seedRun.value } : {};
      const body = { project: project.value, ...(designExport.length ? { designExport } : {}), ...from, ...(estimating && fresh.checked ? { fresh: true } : {}), ...(!estimating && uiTarget.value ? { uiTarget: uiTarget.value } : {}), prompt: seeded ? "" : prompt.value, ...(sent && !seeded ? { frames: sent } : {}), ...(sentRefs ? { refs: sentRefs } : {}), jira: jira.disabled || seeded ? "" : jira.value, maxCost: maxCost.value, ...(file && !seeded ? { file: { name: file.name, text: file.text } } : {}),
        ...(designing ? { mode: "design", design: { noRepo: noRepo.checked, client: hdr.value, projectName: projName.value } } : estimating ? { mode: "estimate", estimate: { stackSource: stack.value, feedbackRounds: rounds.value, designInTotal: designIn.checked, noRepo: noRepo.checked, client: hdr.value, projectName: projName.value, pm: pm.value, ...(handsOff.checked ? { humanReview: false } : {}) } } : {}) };
      const r = await api("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      location.hash = `#/runs/${encodeURIComponent(r.runId)}`;
    } catch (e) {
      fail(e.message);
      start.disabled = false;
      start.replaceChildren(startLabel, icon("arrow"));
      err.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
  });
  const syncStart = () => {
    const how = startFrom.value;
    const rows = how === "design" ? designs : how ? estimates : [];
    const keep = seedRun.value;
    seedRun.replaceChildren(...rows.map((x) => h("option", { value: x.runId }, `${x.runId}  ·  ${projectLabel(x.project)}  ·  ${x.request}`)));
    if (rows.some((x) => x.runId === keep)) seedRun.value = keep;
    seedBox.hidden = !how;
    const run = rows.find((x) => x.runId === seedRun.value);
    // the run decides the project; a design brings its own requirements, references and frames
    project.disabled = !!run;
    if (run) { project.value = run.project === "standalone-estimates" ? "" : run.project; syncProject(); }
    const own = how === "design";
    for (const id of ["reqblock", "refblock", "framesblock"]) { const b = form.querySelector(`#${id}`); if (b) b.hidden = own; }
    seedHint.textContent = !run ? "" : how === "design"
      ? "Sized from that design run's requirements and its approved design; the design steps are not run again (like --from-design)."
      : "Write only what changes in Requirements. The estimate is redone against the approved one and gets the next design version (like --revises).";
    syncAutoX();
  };
  if (!designing && estimating) {
    startFrom.addEventListener("change", syncStart);
    seedRun.addEventListener("change", syncStart);
    // a link from a run page: #/new/estimate/<design|revises>/<run>
    if (["design", "revises"].includes(preset[0]) && !startFrom.querySelector(`option[value=${preset[0]}]`).disabled) startFrom.value = preset[0];
    syncStart();
    if (preset[1] && [...seedRun.options].some((o) => o.value === preset[1])) { seedRun.value = preset[1]; syncStart(); }
  }
  // #/new/brownfield/<design|estimate>/<run>
  if (!estimating && preset[1]) {
    const v = `${preset[0] === "design" ? "d" : "e"}:${preset[1]}`;
    if ([...fromEst.options].some((o) => o.value === v && !o.disabled)) { fromEst.value = v; syncEst(); syncAutoX(); }
  }
  mount([
    h("div", { class: "page-head" }, h("div", {},
      h("div", { class: "crumbs" }, h("a", { href: "#/new" }, "New run"), "/", designing ? "Design" : estimating ? "Estimate" : "Brownfield"),
      h("h1", {}, designing ? "What should be designed?" : estimating ? "What should be estimated?" : "What should change?"),
      h("p", { class: "sub" }, designing ? "Paste or upload the requirements. You get a mock, a clickable demo and a look to approve (on the run page or in the terminal); nothing is sized or built." : estimating ? "Paste or upload the refined requirements. A person answers the clarify questions and approves the estimate, on its run page or in the terminal; then the team and client workbooks are written. Tick \"Hands-off\" to let the factory approve it once its checks pass. A UI request also waits for its design to be approved." : "The request is read and checked before a run exists: a bad file or ticket costs nothing."))),
    h("div", { class: "panel" }, form),
  ], true);
}

// ---------- runs ----------

function runsScreen() {
  skeleton();
  poll(3000, async (first) => {
    const runs = await api("/api/runs");
    const body = runs.length ? h("div", { class: "table-wrap" }, h("table", { class: "runs" },
      h("thead", {}, h("tr", {}, ["Request", "Project", "Status", "Step", "Cost", "Started", "Card"].map((t, i) => h("th", { class: i === 4 ? "num" : undefined }, t)))),
      h("tbody", {}, runs.map((r) => h("tr", { class: `k-${tone(r.status)}`, onclick: () => { location.hash = `#/runs/${encodeURIComponent(r.runId)}`; } },
        h("td", {}, h("div", { class: "req" }, r.request || r.runId), h("div", { class: "id" }, r.runId),
          r.parkedReason ? h("div", { class: "why-line", title: r.parkedReason }, r.parkedReason.length > 110 ? `${r.parkedReason.slice(0, 109)}…` : r.parkedReason) : null),
        h("td", {}, r.project),
        h("td", {}, pill(r.status)),
        h("td", { class: "mono small nowrap" }, r.step),
        h("td", { class: "num" }, money(r.costUsd)),
        h("td", { class: "nowrap muted small" }, ago(r.createdAt)),
        h("td", {}, r.openCard ? pill("waiting", `${r.openCard} card · terminal`) : null),
      ))),
    )) : h("div", { class: "empty" }, "No runs yet. ", h("a", { href: "#/new" }, "Start one"), ".");
    mount([
      h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Runs"), h("h1", {}, "Recent runs"), h("p", { class: "sub" }, "Newest first. Updates every few seconds.")),
        h("a", { class: "btn primary", href: "#/new" }, icon("plus"), "New run")),
      h("div", { class: "panel" }, body),
    ], first);
  });
}

// ---------- one run ----------

const SPEC = new Set(["discover", "intake", "ground", "clarify", "clarify-2", "drafts", "merge", "specify", "plan", "approve"]);
const BUILD = new Set(["stub-commit", "author-tests", "integrate"]);
const phaseOf = (step) => (SPEC.has(step) ? 0 : BUILD.has(step) || step.startsWith("implement/") ? 1 : 2);
const PHASES = ["Spec", "Build", "Ship"];
const NODE_ICON = { completed: "check", waiting: "terminal", decided: "clock", parked: "alert", failed: "x", interrupted: "pause" };
const retriesOf = (row) => row.tries.filter((t) => t.outcome === "failed" && row.tries.some((u) => u.attempt > t.attempt)).length;

const runState = { id: "", seenGates: new Set(), cost: 0, share: 0, drawer: "", last: undefined };

/** The four live views of one run: [route, icon, label]. */
const RUN_TABS = [["run", "activity", "Interactive"], ["charts", "bars", "Graphical"], ["stats", "grid", "Statistical"], ["log", "terminal", "Text"]];

function runHeader(r, tab) {
  const id = encodeURIComponent(r.runId);
  const from = (r.sources ?? []).map((s) => (s.kind === "prompt" ? "typed prompt" : s.kind === "file" ? s.name : `Jira ${s.key}`)).join(" + ");
  const kind = r.sources?.[0]?.kind;
  return [
    h("div", { class: "page-head" }, h("div", {},
      h("div", { class: "crumbs" }, h("a", { href: "#/runs" }, "Runs"), "/", h("span", { class: "mono" }, r.runId)),
      h("h1", {}, (r.request ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? r.runId),
      h("div", { class: "meta" }, pill(r.status), h("span", {}, icon("layers"), r.project),
        from ? h("span", {}, icon(kind === "jira" ? "ticket" : kind === "file" ? "file" : "pen"), from) : null,
        h("span", {}, icon("clock"), `started ${ago(r.createdAt)}`)))),
    h("nav", { class: "subnav", "aria-label": "Run views" },
      h("div", { class: "seg", role: "tablist" }, RUN_TABS.map(([key, ico, label]) => h("a", { href: `#/runs/${id}${key === "run" ? "" : `/${key}`}`, role: "tab", "aria-selected": String(tab === key), class: tab === key ? "on" : undefined }, icon(ico), label))),
      h("span", { class: "sep" }),
      r.mode === "estimate" ? h("a", { href: `#/runs/${id}/estimate`, class: tab === "estimate" ? "on" : undefined }, icon("ruler"), "Estimate") : null,
      h("a", { href: `#/runs/${id}/design`, class: tab === "design" ? "on" : undefined }, icon("browser"), "Design"),
      h("a", { href: `#/runs/${id}/preview`, class: tab === "preview" ? "on" : undefined }, icon("image"), "Preview")),
  ];
}

/** "stub-commit" → "stub-" <wbr> "commit": labels wrap at hyphens, never mid-word. */
const breakable = (text) => text.split(/(?<=-)/).flatMap((part, i) => (i ? [h("wbr"), part] : [part]));

function pipeline(r) {
  const groups = [[], [], []];
  for (const row of r.timeline) groups[phaseOf(row.step)].push(row);
  const node = (row) => {
    const task = row.step.startsWith("implement/");
    const retries = retriesOf(row);
    const ic = NODE_ICON[row.status];
    return h("button", { class: `node s-${row.status}${runState.drawer === row.step ? " sel" : ""}`, type: "button", "data-step": row.step, title: `${row.step}: ${WORDS[row.status] ?? row.status}`, onclick: () => openDrawer(row.step) },
      row.status === "running" ? h("span", { class: "flow" }) : null,
      h("span", { class: "dot" }, ic ? icon(ic) : null),
      retries ? h("span", { class: "loop", title: `${retries} retr${retries === 1 ? "y" : "ies"}` }, icon("loop"), String(retries)) : null,
      h("span", { class: "lbl" }, breakable(task ? row.step.slice("implement/".length) : row.step), task ? h("small", {}, "implement") : null));
  };
  const note = (() => {
    const parked = r.timeline.find((t) => t.status === "parked");
    if (r.status === "parked") return h("div", { class: "pipe-note bad" }, icon("alert"), h("div", {}, h("strong", {}, parked ? `Parked at ${parked.step}` : "Parked"), h("p", {}, r.parkedReason ?? "")));
    if (r.card?.questions) return h("div", { class: "pipe-note wait" }, icon("alert"), h("div", {}, h("strong", {}, "Questions need your answers"), h("p", {}, "Pick an option for each in the panel below (or answer in the terminal); the run carries on right after.")));
    if (r.card) return h("div", { class: "pipe-note wait" }, icon("terminal"), h("div", {}, h("strong", {}, `Waiting for you in the terminal: ${r.card.kind} card`), h("p", {}, "The run continues after you decide there. The card and the command to paste are below.")));
    if (r.delivered) return h("div", { class: "pipe-note ok" }, icon("check"), h("div", {}, h("strong", {}, "Delivered"), h("p", {}, r.delivered.branch ? `Branch ${r.delivered.branch}` : "")));
    if (r.status === "running" && r.lastActivity) return h("div", { class: "pipe-note live" }, icon("activity"), h("div", {}, h("strong", {}, `Working on ${r.step}`), h("p", {}, r.lastActivity.msg, h("span", { class: "muted" }, ` · ${ago(r.lastActivity.ts)}`))));
    return null;
  })();
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, icon("activity"), "Pipeline"), h("span", { class: "pipe-hint" }, "Click a step for its attempts, gates, cost and time")),
    h("div", { class: "pipe-wrap" }, h("div", { class: "phases" }, groups.map((g, i) => g.length ? h("div", { class: "phase", vars: { "flex-grow": g.length } }, h("div", { class: "phase-name" }, PHASES[i]), h("div", { class: "chain" }, g.map(node))) : null))),
    note);
}

function costPanel(r) {
  const share = r.cost.capUsd ? Math.min(1, r.cost.usd / r.cost.capUsd) : 0;
  const num = h("span", { class: "big" });
  const fill = h("div", { class: "fill" });
  fill.style.transform = `scaleX(${runState.share})`;
  nextFrame(() => { fill.style.transform = `scaleX(${share})`; });
  countUp(num, r.cost.usd, money, runState.cost);
  runState.cost = r.cost.usd; runState.share = share;
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, icon("gauge"), "Cost so far"), h("span", { class: "small muted" }, `${Math.round(share * 100)}% of the limit`)),
    h("div", { class: "meter-num" }, num, h("span", { class: "of" }, `of ${money(r.cost.capUsd)}`)),
    h("div", { class: `gauge ${share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : ""}` }, fill, h("div", { class: "ticks" })),
    h("div", { class: "meter-foot" }, h("span", {}, `${r.activeMin.toFixed(1)} min of machine time`), h("span", {}, r.cost.maxCostUsd !== undefined ? `max cost set to ${money(r.cost.maxCostUsd)}` : "the limit grows with the plan's size")));
}

function gatesPanel(r) {
  let i = 0;
  const chips = r.gates.map((g) => {
    const fresh = !runState.seenGates.has(g.seq);
    return h("span", { class: `chip ${g.passed ? "pass" : "fail"}${fresh ? " new" : ""}`, title: `${g.gateId}${g.step ? ` (${g.step})` : ""}: ${g.passed ? "passed" : "failed"}`, vars: fresh ? { "--i": i++ } : undefined },
      icon(g.passed ? "check" : "x"), g.gateId);
  });
  for (const g of r.gates) runState.seenGates.add(g.seq);
  const passed = r.gates.filter((g) => g.passed).length;
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, icon("shield"), "Gates"), h("span", { class: "small muted" }, r.gates.length ? `${passed} passed · ${r.gates.length - passed} failed` : "")),
    r.gates.length ? h("div", { class: "chips" }, chips) : h("p", { class: "muted small" }, "No gate results yet. Gates check each step's output (scope, locked tests, secrets, review) as the run goes."));
}

/** The name typed once is remembered in this browser (a convenience only; it is still sent and recorded with every decision). */
function nameInput() {
  let saved = "";
  try { saved = localStorage.getItem("factory-lead-name") || ""; } catch { /* storage can be blocked */ }
  const el = h("input", { type: "text", placeholder: "Your name (recorded with the decision)", maxlength: "60", "aria-label": "Your name", value: saved });
  el.addEventListener("change", () => { try { localStorage.setItem("factory-lead-name", el.value.trim()); } catch { /* ignore */ } });
  return el;
}

/** Clarification questions, one at a time: pick an option and it moves on; the chosen options are the answers. */
function questionPanel(r) {
  const c = r.card;
  const qs = c.questions;
  const picks = Object.fromEntries(qs.map((q) => [q.id, q.recommended]));
  const who = nameInput();
  const msg = h("p", { class: "small muted", role: "status" }, "");
  const body = h("div", { class: "body stack" });
  let at = 0, sent = false;
  const letter = (i) => String.fromCharCode(65 + i);
  const draw = () => {
    body.replaceChildren();
    if (at < qs.length) {
      const q = qs[at];
      body.append(
        h("div", { class: "q-progress small muted" }, `Question ${at + 1} of ${qs.length}`, h("span", { class: "q-dots" }, qs.map((x, i) => h("i", { class: i === at ? "on" : i < at ? "done" : "" })))),
        h("h3", { class: "q-text" }, q.text),
        h("div", { class: "q-opts", role: "radiogroup", "aria-label": q.text }, q.options.map((o, i) => {
          const b = h("button", { type: "button", class: `q-opt${picks[q.id] === o ? " picked" : ""}`, role: "radio", "aria-checked": String(picks[q.id] === o) },
            h("span", { class: "q-key" }, letter(i)),
            h("span", { class: "q-label" }, o, o === q.recommended ? h("span", { class: "q-rec" }, "Recommended") : null),
            o === q.recommended && q.reason ? h("span", { class: "q-why small muted" }, q.reason) : null);
          b.addEventListener("click", () => { picks[q.id] = o; draw(); setTimeout(() => { if (at === qs.indexOf(q)) { at++; draw(); } }, 220); });
          return b;
        })),
        h("p", { class: "small muted" }, `Why it matters: ${q.why}`),
        h("div", { class: "row" },
          at > 0 ? (() => { const bk = h("button", { class: "btn ghost", type: "button" }, "Back"); bk.addEventListener("click", () => { at--; draw(); }); return bk; })() : null,
          (() => { const nx = h("button", { class: "btn ghost", type: "button" }, at === qs.length - 1 ? "Review" : "Next"); nx.addEventListener("click", () => { at++; draw(); }); return nx; })()));
      return;
    }
    const send = h("button", { class: "btn", type: "button" }, icon("check"), "Send answers and continue");
    send.disabled = sent;
    send.addEventListener("click", async () => {
      msg.textContent = "";
      try {
        await api(`/api/runs/${encodeURIComponent(r.runId)}/estimate-answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: c.hash, by: who.value, answers: picks }) });
        sent = true; send.disabled = true;
        msg.textContent = "Answers recorded. The run is continuing…";
      } catch (err) { msg.textContent = err.message; }
    });
    body.append(
      h("h3", { class: "q-text" }, "Your answers"),
      h("ul", { class: "q-review" }, qs.map((q, i) => {
        const ch = h("button", { type: "button", class: "linkish small" }, "Change");
        ch.addEventListener("click", () => { at = i; draw(); });
        return h("li", {}, h("span", { class: "small muted" }, q.text), h("strong", {}, picks[q.id]), ch);
      })),
      c.assumptions?.length ? h("p", { class: "small muted" }, `Assumed unless you say otherwise on the approval card: ${c.assumptions.map((a) => a.id).join(", ")}`) : null,
      who, h("div", { class: "row" }, send), msg);
  };
  draw();
  return h("section", { class: "card-box" },
    h("header", {}, h("strong", {}, h("span", { class: "pulse" }), "Questions before the run can go on"), h("span", { class: "mono small" }, `${c.kind} card · ${c.hash}`)),
    body);
}

/** The design card (E1b): the card, the demo link and the references. The decision is made in the terminal (only estimate cards are decided on this page). */
// the design card's words for each kind of run (the terminal card has the same three, by its purpose)
const DESIGN_CARD_TEXT = {
  estimate: "The estimate stands on this design. Walk the clickable demo, then approve it or send it back with what to change, in your terminal.",
  design: "This is a design-only run: approving keeps this mock, clickable demo and look, and nothing is sized or built. Walk the clickable demo, then approve it or send it back with what to change, in your terminal.",
  build: "The build follows this design: its screens, states, sample content and look are what gets built. Walk the clickable demo, then approve it or send it back with what to change, in your terminal.",
};

function designPanel(r) {
  const c = r.card;
  const intro = DESIGN_CARD_TEXT[r.mode === "estimate" ? "estimate" : r.mode === "design" ? "design" : "build"];
  // the references the design was drawn from, each with the screens it shaped (filled in when they arrive)
  const refsBox = h("div");
  api(`/api/runs/${encodeURIComponent(r.runId)}/references`).then((v) => { if (v.references.length) refsBox.replaceChildren(h("h3", { class: "small" }, "Drawn from these references"), refsPanel(v, true)); }).catch(() => undefined);
  return h("section", { class: "card-box" },
    h("header", {}, h("strong", {}, h("span", { class: "pulse" }), "Approve the design in your terminal"), h("span", { class: "mono small" }, `${c.kind} card · ${c.hash}`)),
    h("div", { class: "body stack" },
      h("p", { class: "small muted" }, intro),
      h("div", { class: "row" }, h("a", { class: "btn", href: `#/runs/${r.runId}/preview` }, icon("cursor"), "Open the clickable demo"),
        h("span", { class: "btn ghost", "aria-disabled": "true", title: "A design is exported once it is approved: PNG, PDF, the demo, tokens or JSON, from the Design tab." }, icon("download"), "Export after approval")),
      h("div", { class: "cmds" }, c.commands.map((cmd) => h("div", { class: "cmd" }, h("span", { class: "prompt" }, "$"), h("code", {}, cmd), copyButton(cmd)))),
      refsBox,
      md(c.markdown)));
}

function cardPanel(r) {
  const c = r.card;
  // only an estimate run's questions are answered on this page; every other card is decided in the terminal
  if (c.questions && r.mode === "estimate") return questionPanel(r);
  if (c.kind === "design-approval") return designPanel(r);
  return h("section", { class: "card-box" },
    h("header", {}, h("strong", {}, h("span", { class: "pulse" }), "Waiting for you in the terminal"), h("span", { class: "mono small" }, `${c.kind} card · ${c.hash}`)),
    h("div", { class: "body" },
      h("p", { class: "small muted" }, "Decisions are made in your terminal, so no AI or script can approve its own plan. Read the card, then paste one of these:"),
      h("div", { class: "cmds" }, c.commands.map((cmd) => h("div", { class: "cmd" }, h("span", { class: "prompt" }, "$"), h("code", {}, cmd), copyButton(cmd)))),
      md(c.markdown)));
}

function deliveredPanel(r) {
  const d = r.delivered;
  const ev = d.evidence;
  return h("section", { class: "panel" },
    h("div", { class: "big-ok" }, h("span", { class: "ring" }, icon("check")), h("div", {}, h("h2", {}, "Delivered"), h("div", { class: "small muted" }, d.local ? "Ready locally: no forge is set up for this project" : "Pushed and opened as a pull request"))),
    h("dl", { class: "facts" },
      h("dt", {}, "Branch"), h("dd", {}, h("code", {}, d.branch ?? "-"), d.branch ? copyButton(d.branch) : null),
      d.head ? [h("dt", {}, "Head"), h("dd", {}, h("code", {}, d.head.slice(0, 12)))] : null,
      h("dt", {}, "Pull request"), h("dd", {}, d.prUrl && /^https:\/\/github\.com\//.test(d.prUrl) ? h("a", { href: d.prUrl, target: "_blank", rel: "noopener noreferrer" }, d.prUrl) : d.local ? "PR text below (factory show-card --pr)" : "-"),
      h("dt", {}, "Evidence"), h("dd", {}, ev.total === 0 ? h("span", { class: "muted" }, "no gate decisions recorded")
        : ev.ok ? pill("delivered", `all ${ev.total} gate decisions re-check`) : pill("failed", `${ev.failed.length} of ${ev.total} don't re-check`)),
    ),
    ev.failed.length ? h("ul", { class: "small" }, ev.failed.map((f) => h("li", {}, `#${f.seq} ${f.gateId}: ${f.reason ?? ""}`))) : null,
    d.prText ? h("details", {}, h("summary", {}, "PR text"), h("div", { class: "row" }, copyButton(d.prText, "Copy PR text")), md(d.prText, "md tall")) : null);
}

function parkedPanel(r) {
  return h("section", { class: "callout bad" }, icon("alert"), h("div", {},
    h("strong", {}, "Parked: a person needs to look"),
    h("p", {}, "The reason is shown on the pipeline above. Nothing runs until someone resumes it."),
    h("p", { class: "small" }, "In your terminal: ", h("code", {}, `factory report ${r.runId}`), " · ", h("code", {}, `factory logs ${r.runId}`))));
}

function tracePanel(r) {
  const box = h("div", { class: "trace" }, r.trace.length ? r.trace.map((e) => h("div", { class: `k-${e.kind}` },
    h("span", { class: "t" }, new Date(e.ts).toTimeString().slice(0, 8)), h("span", { class: "w", title: e.where }, e.where), h("span", {}, e.msg))) : h("span", { class: "muted" }, "No trace lines yet."));
  return h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, icon("terminal"), "Latest activity"), h("code", { class: "small muted" }, `factory logs ${r.runId} --follow`)), box);
}

// the side drawer for one step
const scrim = h("div", { class: "scrim", onclick: () => closeDrawer() });
const drawer = h("aside", { class: "drawer", "aria-hidden": "true" });
// the layer clips the closed drawer, so it never widens the page on a narrow screen
document.body.append(scrim, h("div", { class: "drawer-layer" }, drawer));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

function markSelected() {
  view.querySelectorAll(".node").forEach((n) => n.classList.toggle("sel", n.dataset.step === runState.drawer));
}
function openDrawer(step) {
  runState.drawer = step;
  paintDrawer();
  scrim.classList.add("open"); drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
  markSelected();
}
function closeDrawer() {
  runState.drawer = "";
  scrim.classList.remove("open"); drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
  markSelected();
}
function paintDrawer() {
  const row = runState.last?.timeline.find((t) => t.step === runState.drawer);
  if (!row) return;
  const retries = retriesOf(row);
  drawer.replaceChildren(...[
    h("button", { class: "icon-btn x", type: "button", "aria-label": "Close", onclick: closeDrawer }, icon("x")),
    h("div", { class: "eyebrow" }, `${PHASES[phaseOf(row.step)]} · ${row.stage}`),
    h("h2", {}, row.step),
    pill(row.status),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "Attempts"), h("div", { class: "v" }, String(row.attempts))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Retries"), h("div", { class: "v" }, String(retries))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Cost"), h("div", { class: "v" }, money(row.costUsd))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Machine time"), h("div", { class: "v" }, secs(row.activeSec)))),
    row.models.length ? h("p", { class: "small muted" }, "Models: ", h("code", {}, row.models.join(", "))) : null,
    row.note ? h("div", { class: "pipe-note bad" }, icon("alert"), h("div", {}, h("strong", {}, "Parked here"), h("p", {}, row.note))) : null,
    h("h3", {}, "Gates"),
    row.gates.length ? h("div", { class: "chips" }, row.gates.map((g) => h("span", { class: `chip ${g.passed ? "pass" : "fail"}` }, icon(g.passed ? "check" : "x"), g.gateId))) : h("p", { class: "small muted" }, "No gates for this step."),
    h("h3", {}, "Attempts"),
    row.tries.length ? h("ul", { class: "attempts" }, row.tries.map((t) => h("li", { class: t.outcome },
      h("div", { class: "hd" }, h("span", {}, `Attempt ${t.attempt}`, t.rung ? h("span", { class: "faint" }, ` · rung ${t.rung}`) : null), pill(t.outcome, t.outcome === "decided" ? "card decided" : undefined)),
      t.why ? h("div", { class: "why" }, t.why) : null,
      t.next ? h("div", { class: "next" }, icon(t.next.startsWith("retry") ? "loop" : "arrow"), t.next) : null))) : h("p", { class: "small muted" }, "Not started yet."),
  ].filter(Boolean));
}

function runScreen(id) {
  if (runState.id !== id) Object.assign(runState, { id, seenGates: new Set(), cost: 0, share: 0, drawer: "", last: undefined });
  skeleton("grid");
  let lastJson = "";
  poll(2000, async (first) => {
    const r = await api(`/api/runs/${encodeURIComponent(id)}`);
    const json = JSON.stringify(r);
    if (json === lastJson) return; // nothing new: keep scroll positions and open sections
    lastJson = json;
    runState.last = r;
    const open = [...view.querySelectorAll("details")].map((d) => d.open);
    const oldTrace = view.querySelector(".trace");
    const atBottom = !oldTrace || oldTrace.scrollTop + oldTrace.clientHeight >= oldTrace.scrollHeight - 8;
    const right = [];
    if (r.card) right.push(cardPanel(r));
    if (r.status === "parked") right.push(parkedPanel(r));
    if (r.delivered) right.push(deliveredPanel(r));
    right.push(tracePanel(r));
    mount([...runHeader(r, "run"), h("div", { class: "stack" }, pipeline(r), h("div", { class: "grid-2" },
      h("div", { class: "stack" }, costPanel(r), gatesPanel(r)),
      h("div", { class: "stack" }, right)))], first);
    view.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true; });
    const t = view.querySelector(".trace");
    if (t && atBottom) t.scrollTop = t.scrollHeight;
    if (runState.drawer) paintDrawer();
  });
}


// ---------- one run: graphical ----------

const SVGNS = "http://www.w3.org/2000/svg";
/** Like h(), for SVG. Text goes in as text nodes. */
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null) continue;
    // CSS variables through the CSSOM: the page's policy blocks style="" attributes
    if (k === "vars") for (const [n, x] of Object.entries(v)) el.style.setProperty(n, String(x));
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const shortStep = (step) => (step.startsWith("implement/") ? step.slice("implement/".length) : step);

/** Horizontal bars, one per row; the widest value fills the chart. */
function barChart(rows, fmt, cls = "") {
  const W = 560, rowH = 24, left = 118, right = 64;
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  const H = Math.max(rowH, rows.length * rowH) + 6;
  return sv("svg", { class: `chart bars ${cls}`, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": rows.map((r) => `${r.label} ${fmt(r.value)}`).join(", ") },
    rows.map((r, i) => {
      const y = i * rowH + 4;
      const w = Math.max(r.value > 0 ? 2 : 0, ((W - left - right) * r.value) / max);
      return sv("g", { class: `row s-${r.tone ?? "ok"}`, vars: { "--i": i } },
        sv("title", {}, `${r.label}: ${fmt(r.value)}`),
        sv("text", { x: left - 8, y: y + 13, class: "lab", "text-anchor": "end" }, r.label.length > 17 ? `${r.label.slice(0, 16)}…` : r.label),
        sv("rect", { x: left, y, width: W - left - right, height: rowH - 8, rx: 4, class: "trk" }),
        sv("rect", { x: left, y, width: w, height: rowH - 8, rx: 4, class: "bar" }),
        sv("text", { x: left + w + 6, y: y + 13, class: "val" }, fmt(r.value)));
    }));
}

/** Cumulative cost over time, with the cost limit as a dashed line. */
function costLine(points, cap) {
  const W = 560, H = 220, L = 46, R = 12, T = 12, B = 26;
  if (!points.length) return h("p", { class: "muted small" }, "No model calls yet.");
  const t0 = Date.parse(points[0].ts), t1 = Math.max(t0 + 1000, Date.parse(points[points.length - 1].ts));
  const top = Math.max(cap || 0, points[points.length - 1].usd) * 1.08 || 1;
  const x = (ts) => L + ((Date.parse(ts) - t0) / (t1 - t0)) * (W - L - R);
  const y = (usd) => T + (1 - usd / top) * (H - T - B);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.usd).toFixed(1)}`).join(" ");
  const area = `${d} L${x(points[points.length - 1].ts).toFixed(1)},${H - B} L${L},${H - B} Z`;
  const ticks = [0, 0.5, 1].map((k) => top * k);
  const minutes = (t1 - t0) / 60_000;
  return sv("svg", { class: "chart line", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Cost over time: ${money(points[points.length - 1].usd)} of ${money(cap)}` },
    ticks.map((v) => [sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }), sv("text", { x: L - 6, y: y(v) + 4, class: "lab", "text-anchor": "end" }, `$${v.toFixed(v < 10 ? 1 : 0)}`)]),
    cap ? [sv("line", { x1: L, x2: W - R, y1: y(cap), y2: y(cap), class: "cap" }), sv("text", { x: W - R, y: y(cap) - 5, class: "lab cap-lab", "text-anchor": "end" }, `limit ${money(cap)}`)] : null,
    sv("path", { d: area, class: "area" }), sv("path", { d, class: "stroke" }),
    points.length < 60 ? points.map((p) => sv("circle", { cx: x(p.ts), cy: y(p.usd), r: 2.4, class: "pt" }, sv("title", {}, `${new Date(p.ts).toTimeString().slice(0, 8)}  ${money(p.usd)}`))) : null,
    sv("text", { x: L, y: H - 6, class: "lab" }, new Date(t0).toTimeString().slice(0, 5)),
    sv("text", { x: W - R, y: H - 6, class: "lab", "text-anchor": "end" }, `+${minutes < 90 ? `${Math.round(minutes)} min` : `${(minutes / 60).toFixed(1)} h`}`));
}

const toneOfStep = (x) => (x.outcome === "completed" ? (x.retries ? "wait" : "ok") : x.outcome === "failed" || x.outcome === "parked" ? "bad" : "live");

function chartsScreen(id) {
  skeleton("grid");
  let lastJson = "";
  poll(3000, async (first) => {
    const [r, st] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/stats`)]);
    const json = JSON.stringify(st);
    if (json === lastJson && !first) return;
    lastJson = json;
    const rows = (key) => st.steps.map((x) => ({ label: shortStep(x.step), value: x[key], tone: toneOfStep(x) }));
    const panel = (i, ico, title, note, body) => h("section", { class: "panel rise", vars: { "--i": i } }, h("div", { class: "panel-head" }, h("h2", {}, icon(ico), title), note ? h("span", { class: "small muted" }, note) : null), body);
    const empty = h("p", { class: "muted small" }, "No steps yet.");
    mount([...runHeader(r, "charts"),
      h("div", { class: "grid-2 even" },
        panel(0, "dollar", "Cost per step", money(st.totalUsd), st.steps.length ? barChart(rows("costUsd"), money) : empty),
        panel(1, "clock", "Machine time per step", `${st.activeMin.toFixed(1)} min`, st.steps.length ? barChart(rows("activeSec"), secs, "time") : empty),
        panel(2, "activity", "Cost over time", `limit ${money(st.capUsd)}`, costLine(st.costOverTime, st.capUsd)),
        panel(3, "loop", "Retries per step", `${st.retries} in all`, st.steps.length ? barChart(rows("retries"), (n) => String(Math.round(n)), "retries") : empty)),
      h("p", { class: "legend small muted" }, h("span", { class: "sw ok" }), "first try", h("span", { class: "sw wait" }), "needed a retry", h("span", { class: "sw live" }), "running", h("span", { class: "sw bad" }), "failed or parked"),
    ], first);
  });
}

// ---------- one run: statistical ----------

const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));

function statsScreen(id) {
  skeleton("grid");
  let lastJson = "";
  const prev = {};
  poll(3000, async (first) => {
    const [r, st] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/stats`)]);
    const json = JSON.stringify(st);
    if (json === lastJson && !first) return;
    lastJson = json;
    const tile = (i, key, ico, label, value, fmt, unit, small, cls) => {
      const big = h("span");
      countUp(big, value, fmt, prev[key] ?? 0);
      prev[key] = value;
      return h("div", { class: `panel tile rise ${cls ?? ""}`, vars: { "--i": i } }, h("div", { class: "k" }, icon(ico), label), h("div", { class: "big" }, big, unit ? h("span", { class: "u" }, unit) : null), h("div", { class: "sm" }, small));
    };
    const left = Math.max(0, st.capUsd - st.totalUsd);
    const ftp = st.firstTimePass.finished ? (st.firstTimePass.passed / st.firstTimePass.finished) * 100 : 0;
    mount([...runHeader(r, "stats"), h("div", { class: "tiles" },
      tile(0, "cost", "dollar", "Total cost", st.totalUsd, money, "", `${st.costOverTime.length} model or agent calls`),
      tile(1, "left", "gauge", "Limit left", left, money, "", `of ${money(st.capUsd)} · ${Math.round((st.totalUsd / (st.capUsd || 1)) * 100)}% used`, left < st.capUsd * 0.1 ? "warn" : ""),
      tile(2, "active", "clock", "Machine time", st.activeMin, (n) => n.toFixed(1), "min", `wall clock ${st.wallMin.toFixed(0)} min, including waiting for people`),
      tile(3, "attempts", "loop", "Attempts", st.attempts, (n) => String(Math.round(n)), "", `${st.retries} retr${st.retries === 1 ? "y" : "ies"} across ${st.steps.length} steps`),
      tile(4, "ftp", "check", "First-time pass", ftp, (n) => String(Math.round(n)), st.firstTimePass.finished ? "%" : "", `${st.firstTimePass.passed} of ${st.firstTimePass.finished} finished steps`),
      tile(5, "gates", "shield", "Gates passed", st.gates.passed, (n) => String(Math.round(n)), `/ ${st.gates.passed + st.gates.failed}`, st.gates.failed ? `${st.gates.failed} failed (a failed gate makes the step retry)` : "none failed", st.gates.failed ? "warn" : ""),
      tile(6, "human", "user", "Human stops", st.humanStops, (n) => String(Math.round(n)), "", "cards answered in the terminal"),
      tile(7, "tokens", "activity", "Tokens in / out", st.tokens.input, kTokens, `/ ${kTokens(st.tokens.output)}`, `${kTokens(st.tokens.cached)} read from the prompt cache`),
    )], first);
  });
}

// ---------- one run: text ----------

function logScreen(id) {
  skeleton();
  const ui = { step: "", type: "", q: "", follow: true, source: "events", open: new Set(), built: false };
  let data = { events: [], trace: [], total: 0 };
  let list, count, stepSel, typeSel;
  const options = (sel, values, all) => {
    const cur = sel.value;
    sel.replaceChildren(h("option", { value: "" }, all), ...values.map((v) => h("option", { value: v }, v)));
    sel.value = values.includes(cur) ? cur : "";
  };
  const paint = () => {
    const q = ui.q.trim().toLowerCase();
    let rows;
    if (ui.source === "events") {
      rows = data.events.filter((e) => (!ui.step || e.step === ui.step) && (!ui.type || e.type === ui.type) && (!q || `${e.type} ${e.step ?? ""} ${JSON.stringify(e.detail)}`.toLowerCase().includes(q)));
      list.replaceChildren(...rows.map((e) => {
        const d = h("details", { class: `ev k-${e.type.split(".")[0]}`, "data-seq": e.seq, open: ui.open.has(e.seq) },
          h("summary", {}, h("span", { class: "seq" }, `#${e.seq}`), h("span", { class: "t" }, new Date(e.ts).toTimeString().slice(0, 8)), h("span", { class: "ty" }, e.type),
            h("span", { class: "st" }, e.step ? `${e.step}${e.attempt ? `#${e.attempt}` : ""}` : "")),
          h("pre", {}, JSON.stringify(e.detail, null, 2)));
        d.addEventListener("toggle", () => { if (d.open) ui.open.add(e.seq); else ui.open.delete(e.seq); });
        return d;
      }));
    } else {
      rows = data.trace.filter((t) => (!ui.step || t.step === ui.step) && (!q || `${t.kind} ${t.msg}`.toLowerCase().includes(q)));
      list.replaceChildren(...rows.map((t) => h("div", { class: `tl k-${t.kind}` }, h("span", { class: "t" }, new Date(t.ts).toTimeString().slice(0, 8)), h("span", { class: "st" }, t.step ?? "run"), h("span", {}, t.msg))));
    }
    count.textContent = `${rows.length} of ${ui.source === "events" ? data.events.length : data.trace.length} ${ui.source === "events" ? "events" : "trace lines"}`;
    if (ui.follow) list.scrollTop = list.scrollHeight;
  };
  poll(2000, async () => {
    const [r, ev] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/events`)]);
    const changed = ev.total !== data.total || ev.trace.length !== data.trace.length;
    data = ev;
    if (!ui.built) {
      ui.built = true;
      stepSel = h("select", { "aria-label": "Step", onchange: () => { ui.step = stepSel.value; paint(); } });
      typeSel = h("select", { "aria-label": "Event type", onchange: () => { ui.type = typeSel.value; paint(); } });
      const search = h("input", { type: "text", placeholder: "Search", "aria-label": "Search", oninput: () => { ui.q = search.value; paint(); } });
      const follow = h("input", { type: "checkbox", checked: true, onchange: () => { ui.follow = follow.checked; if (ui.follow) paint(); } });
      const src = (key, label) => h("button", { type: "button", class: `tab${ui.source === key ? " on" : ""}`, "data-src": key, onclick: (e) => {
        ui.source = key;
        e.currentTarget.parentElement.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.src === key));
        typeSel.disabled = key !== "events";
        paint();
      } }, label);
      list = h("div", { class: "log", role: "log", "aria-live": "off" });
      list.addEventListener("scroll", () => {
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
        if (ui.follow !== atBottom) { ui.follow = atBottom; follow.checked = atBottom; }
      });
      count = h("span", { class: "small muted" });
      mount([...runHeader(r, "log"), h("section", { class: "panel" },
        h("div", { class: "log-bar" }, h("div", { class: "tabs-in" }, src("events", "Ledger events"), src("trace", "Trace lines")), stepSel, typeSel, search,
          h("label", { class: "follow" }, follow, h("span", { class: "live" }), "Follow")),
        list,
        h("div", { class: "log-foot" }, count, h("code", { class: "small muted" }, `factory logs ${r.runId} --follow`)))], true);
    }
    if (changed || !list.childElementCount) {
      options(stepSel, [...new Set([...data.events.map((e) => e.step), ...data.trace.map((t) => t.step)].filter(Boolean))], "All steps");
      options(typeSel, [...new Set(data.events.map((e) => e.type))].sort(), "All event types");
      paint();
    }
  });
}

// ---------- one run: preview ----------

const VIEWPORTS = [["phone", 390], ["tablet", 768], ["desktop", 1280]];
/** One resize listener for the whole page; the preview screen sets what it does. */
let onResize = () => {};
window.addEventListener("resize", () => onResize());

function lightbox(img) {
  const close = () => { box.classList.remove("open"); setTimeout(() => box.remove(), reduced ? 0 : 220); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  let body;
  if (img.beforeUrl) {
    const after = h("img", { src: img.url, alt: `${img.screen} after`, class: "after" });
    const range = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Before and after", class: "ba-range" });
    const set = () => { after.style.clipPath = `inset(0 0 0 ${range.value}%)`; handle.style.transform = `translateX(${range.value}%)`; };
    const handle = h("div", { class: "ba-handle" }, h("span", {}));
    body = h("div", { class: "ba" }, h("img", { src: img.beforeUrl, alt: `${img.screen} before` }), after, h("div", { class: "ba-line" }, handle), range,
      h("span", { class: "ba-lab l" }, "before"), h("span", { class: "ba-lab r" }, "after"));
    range.addEventListener("input", set);
    set();
  } else body = h("img", { src: img.url, alt: img.screen });
  const box = h("div", { class: "lightbox", role: "dialog", "aria-label": img.screen, onclick: (e) => { if (e.target === box) close(); } },
    h("figure", {}, h("button", { class: "icon-btn x", type: "button", "aria-label": "Close", onclick: close }, icon("x")), body,
      h("figcaption", {}, h("strong", {}, img.screen), img.req ? h("span", { class: "tag" }, img.req) : null, h("span", { class: "tag" }, img.viewport))));
  document.body.append(box);
  document.addEventListener("keydown", esc);
  nextFrame(() => box.classList.add("open"));
}

async function previewScreen(id) {
  skeleton("grid");
  const [r, p] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/preview`)]);
  if (p.none) {
    mount([...runHeader(r, "preview"), h("div", { class: "slot big-empty rise" }, icon("cursor"), h("strong", {}, "No preview for this run"), h("span", {}, p.none))], true);
    return;
  }
  const pv = p.preview;
  // keep a "#screen" or "?query" tail out of the encoding: "index.html#S-1" must not become a file named "index.html%23S-1"
  const url = (path) => { const [file, ...tail] = path.split(/(?=[?#])/); return p.base + file.split("/").map(encodeURIComponent).join("/") + tail.join(""); };
  const parts = [];
  if (pv.site) {
    const screens = pv.site.screens.length ? pv.site.screens : [{ path: pv.site.entry, title: "Start" }];
    let width = 1280;
    const frame = h("iframe", { sandbox: "allow-scripts", title: "Clickable preview", src: url(screens[0].path), referrerpolicy: "no-referrer", loading: "lazy" });
    const stage = h("div", { class: "device" }, frame);
    const fit = () => {
      const avail = stage.parentElement ? stage.parentElement.clientWidth : width;
      const k = Math.min(1, avail / width);
      frame.style.width = `${width}px`;
      frame.style.transform = `scale(${k})`;
      stage.style.height = `${Math.round(720 * k)}px`;
      stage.style.width = `${Math.round(width * k)}px`;
    };
    const vpBtns = VIEWPORTS.map(([name, w]) => h("button", { type: "button", class: `tab${w === width ? " on" : ""}`, "data-w": w, onclick: (e) => {
      width = w; e.currentTarget.parentElement.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", Number(b.dataset.w) === w)); fit();
    } }, icon(name === "desktop" ? "browser" : "grid"), `${name} ${w}`));
    const list = h("ul", { class: "screens" }, screens.map((sc, i) => h("li", {}, h("button", { type: "button", class: i === 0 ? "on" : undefined, onclick: (e) => {
      frame.src = url(sc.path);
      list.querySelectorAll("button").forEach((b) => b.classList.remove("on")); e.currentTarget.classList.add("on");
    } }, h("span", {}, sc.title), sc.req ? h("span", { class: "tag" }, sc.req) : null))));
    parts.push(h("section", { class: "panel rise", vars: { "--i": 0 } },
      h("div", { class: "panel-head" }, h("h2", {}, icon("cursor"), "Clickable preview"), h("div", { class: "tabs-in vp" }, vpBtns)),
      h("div", { class: "pv" }, h("div", {}, h("div", { class: "eyebrow" }, "Screens"), list, h("p", { class: "small muted" }, "Runs in a locked frame: it can't reach this app, the network or your files.")),
        h("div", { class: "device-wrap" }, stage))));
    nextFrame(fit);
    onResize = fit;
  }
  if (pv.images.length) {
    const imgs = pv.images.map((i) => ({ ...i, url: url(i.file), beforeUrl: i.before ? url(i.before) : undefined }));
    parts.push(h("section", { class: "panel rise", vars: { "--i": 1 } },
      h("div", { class: "panel-head" }, h("h2", {}, icon("image"), "Designs"), h("span", { class: "small muted" }, `${imgs.length} image${imgs.length === 1 ? "" : "s"} · click to enlarge`)),
      h("div", { class: "gallery" }, imgs.map((img, i) => h("button", { type: "button", class: "shot rise", vars: { "--i": i }, onclick: () => lightbox(img) },
        h("img", { src: img.url, alt: img.screen, loading: "lazy" }),
        h("span", { class: "cap" }, h("strong", {}, img.screen), img.req ? h("span", { class: "tag" }, img.req) : null, h("span", { class: "tag" }, img.viewport), img.beforeUrl ? h("span", { class: "tag ba-tag" }, "before / after") : null))))));
  }
  mount([...runHeader(r, "preview"), h("div", { class: "stack" }, parts)], true);
}

// ---------- estimate ----------

const hrs = (r) => (r.min === r.max ? `${r.min} h` : `${r.min}–${r.max} h`);
const usd = (r) => (r.min === r.max ? money(r.min) : `${money(r.min)}–${money(r.max)}`);
const table = (head, rows, numCols = []) => h("div", { class: "table-wrap" }, h("table", {},
  h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: numCols.includes(i) ? "num" : undefined }, t)))),
  h("tbody", {}, rows.map((cells) => h("tr", {}, cells.map((c, i) => h("td", { class: numCols.includes(i) ? "num" : undefined }, c)))))));

/** What can start from an approved run: links to the New run forms, set to start from it (like the command line's flags). */
function nextPanel(text, links) {
  return h("section", { class: "panel rise next-panel", vars: { "--i": 0 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("arrow"), "Next")),
    h("p", { class: "small muted" }, text),
    h("div", { class: "row" }, links.map(([href, ico, label, why]) => href
      ? h("a", { class: "btn", href }, icon(ico), label)
      : h("span", { class: "btn disabled", "aria-disabled": "true", title: why }, icon(ico), label))),
    links.filter(([href, , , why]) => !href && why).map(([, , , why]) => h("p", { class: "small faint" }, why)));
}

async function estimateScreen(id) {
  skeleton("grid");
  const [r, e] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/estimate`)]);
  const head = runHeader(r, "estimate");
  if (e.none) {
    mount([...head, h("div", { class: "slot big-empty rise" }, icon("ruler"), h("strong", {}, "No estimate yet"), h("span", {}, e.none))], true);
    return;
  }
  const rid = encodeURIComponent(r.runId);
  const panel = (i, title, ico, ...body) => h("section", { class: "panel rise", vars: { "--i": i } }, h("div", { class: "panel-head" }, h("h2", {}, icon(ico), title)), ...body);
  const fact = (k, v) => [h("dt", {}, k), h("dd", {}, v)];
  const s = e.settings ?? {};
  const summary = h("dl", { class: "facts" },
    fact("Effort (all tracks)", h("strong", {}, hrs(e.totals.overall))),
    ...Object.entries(e.totals.byTrack).map(([t, v]) => fact(`  ${t}`, hrs(v))),
    fact("API cost", h("span", {}, h("strong", {}, usd(e.apiCost.total)), h("span", { class: "tag" }, e.apiCost.confidence), h("span", { class: "small faint" }, `${e.apiCost.records} benchmark record${e.apiCost.records === 1 ? "" : "s"}`))),
    fact("Elapsed", `${e.elapsed.criticalPathDays.min}–${e.elapsed.criticalPathDays.max} days on the critical path, plus ${e.elapsed.planningMinutes} min planning`),
    fact("Size and certainty", h("span", { class: "tags" }, h("span", { class: "tag" }, e.band), h("span", { class: "tag" }, `${e.uncertainty} uncertainty`), e.complexity ? h("span", { class: "tag" }, e.complexity) : null)),
    e.catalogue ? fact("Task catalogue", h("span", { class: "tags" }, h("span", { class: "tag" }, e.catalogue.version), h("span", { class: "tag" }, `stack ${e.catalogue.stack}`),
      h("span", { class: `pill ${e.catalogue.status === "draft" ? "t-wait" : "t-ok"}` }, h("span", { class: "d" }), e.catalogue.statusText))) : [],
    fact("Delivery model", e.deliveryModel === "hitl" ? "HITL: a supervisor plus agents" : "Solely agentic"),
    fact("Settings", [s.stackSource ? `stack ${s.stackSource}` : "", s.feedbackRounds !== undefined ? `${s.feedbackRounds} feedback rounds` : "", s.designInTotal === false ? "Design kept out of the total" : "Design in the total", s.noRepo ? "no repo" : "", e.handsOff ? "hands-off (no human review)" : ""].filter(Boolean).join(" · ")),
    fact("Approval", e.approved ? h("span", { class: "pill t-ok" }, h("span", { class: "d" }), `${e.approved.auto ? "approved by the factory (no human review)" : `approved by ${e.approved.by || "?"}`}${e.approved.hash ? ` (${e.approved.hash})` : ""}`)
      : h("span", { class: "pill t-wait" }, h("span", { class: "d" }), e.handsOff ? "approves itself once its checks pass" : "waiting for approval in your terminal")),
  );
  const dl = (audience, label, draft) => h("a", { class: "btn", href: `/export/${rid}/${draft ? "draft-" : ""}${audience}`, download: "" }, icon("file"), label);
  const files = e.files ? h("div", { class: "row" },
    e.files.team ? dl("team", "Team workbook (.xlsx)") : null,
    e.files.client ? dl("client", "Client workbook (.xlsx)") : null,
    e.files.design ? dl("design", "Design book (.pdf)") : null,
    e.files.designNote ? h("span", { class: "small muted" }, `No design book: ${e.files.designNote}`) : null)
    : h("div", {}, h("div", { class: "row" }, dl("team", "Draft team workbook (.xlsx)", true), dl("client", "Draft client workbook (.xlsx)", true)),
      h("p", { class: "muted small" }, e.handsOff ? "Drafts come from this estimate before approval and are named DRAFT. The final workbooks are written once the estimate passes its checks." : "Drafts come from this estimate before approval and are named DRAFT. The final workbooks are written after you approve in your terminal."));
  const tasks = table(["", "Task", "Track", "Who", "Hours", "Sized against", ""],
    e.tasks.map((t) => [h("span", { class: "mono small" }, t.id), h("div", {}, h("div", {}, t.title, t.kind ? h("span", { class: "tag faint" }, t.size ? `${t.kind} · ${t.size}` : t.kind) : null), h("div", { class: "small muted" }, t.reason), t.references?.length ? h("div", { class: "small muted" }, `Like ${t.references.map((r) => `${r.taskId} of ${r.runId} (${r.size}, ${hrs(r.hours)})`).join(", ")}`) : null), t.track ?? "-", t.executor, hrs(t.hours),
      t.anchor === t.id ? h("span", { class: "tag" }, "anchor") : `${t.anchor} × ${t.ratio}`, [t.flagged ? h("span", { class: "pill t-wait" }, h("span", { class: "d" }), "estimators disagree") : "", t.splitAdvised ? h("span", { class: "pill t-wait" }, h("span", { class: "d" }), "split before build") : ""]]), [4]);
  const costTable = table(["Phase", "API cost"], e.apiCost.phases.map((p) => [p.phase, usd(p.usd)]), [1]);
  const extra = [];
  if (e.overheads.length) extra.push(h("h3", {}, "Overheads"), table(["Name", "Track", "Hours", "Why"], e.overheads.map((o) => [o.name, o.track ?? "-", hrs(o.hours), o.reason]), [2]));
  if (e.gateHours.length) extra.push(h("h3", {}, "Human gate hours (assumed)"), table(["Gate", "Track", "Hours"], e.gateHours.map((g) => [g.source, g.track ?? "-", hrs(g.hours)]), [2]));
  if (e.scenarios.length) extra.push(h("h3", {}, "Scenarios"), table(["Scenario", "What changes", "Total"], e.scenarios.map((x) => [x.name, x.changes, hrs(x.totals)]), [2]));
  if (e.suggested.length) extra.push(h("h3", {}, "Suggested extras, outside the total"), h("ul", { class: "reasons small" }, e.suggested.map((x) => h("li", {}, h("strong", {}, x.title), ` ${x.reason}`))));
  const d = e.design;
  const design = d.pending ? h("p", { class: "muted small" }, "The design step hasn't finished.")
    : !d.ui ? h("p", { class: "muted small" }, "No UI in this request, so no screens were drawn.")
    : [h("p", { class: "small" }, d.flow),
      table(["Screen", "Route", "Size", "States", "Requirements"], d.screens.map((x) => [h("span", { class: "mono" }, x.id), h("span", { class: "mono small" }, x.route), x.size, x.states.join(", ") || "-", x.reqs.join(", ")])),
      d.unmapped.length ? h("p", { class: "small" }, h("strong", {}, "Requirements with no screen: "), d.unmapped.join(", ")) : null,
      d.noScreen.length ? h("p", { class: "small muted" }, `Not screens: ${d.noScreen.map((n) => `${n.req} (${n.reason})`).join("; ")}`) : null,
      h("a", { class: "btn", href: `#/runs/${rid}/preview` }, icon("cursor"), "Open the clickable demo")];
  let decide = null;
  if (e.pending) {
    const who = h("input", { type: "text", placeholder: "Your name", maxlength: "60", "aria-label": "Your name" });
    const note = h("input", { type: "text", placeholder: "Risk note (optional)", "aria-label": "Risk note" });
    const why = h("input", { type: "text", placeholder: "Reason, to send it back", "aria-label": "Rejection reason" });
    const boxes = e.pending.flagged.map((id) => { const c = h("input", { type: "checkbox", value: id }); return [c, h("label", { class: "small" }, c, ` I have reviewed ${id} (estimators disagree) and accept it`)]; });
    const msg = h("p", { class: "small muted", role: "status" }, "");
    const send = async (decision) => {
      msg.textContent = "";
      try {
        await api(`/api/runs/${encodeURIComponent(rid)}/estimate-decision`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hash: e.pending.hash, decision, by: who.value, note: note.value, reason: why.value, signOff: boxes.filter(([c]) => c.checked).map(([c]) => c.value) }) });
        msg.textContent = decision === "approve" ? "Approved. Writing the final workbooks…" : "Sent back.";
        setTimeout(() => estimateScreen(rid), 4000);
      } catch (err) { msg.textContent = err.message; }
    };
    const ok = h("button", { class: "btn", type: "button" }, icon("check"), "Approve this estimate");
    const no = h("button", { class: "btn", type: "button" }, "Reject");
    ok.addEventListener("click", () => send("approve"));
    no.addEventListener("click", () => send("reject"));
    decide = panel(0, "Lead approval", "shield", h("div", { class: "stack" },
      h("p", { class: "small muted" }, `Card ${e.pending.hash}. You are approving exactly the figures on this page. Your name is recorded with the decision.`),
      who, note, ...boxes.map((b) => b[1]), why, h("div", { class: "row" }, ok, no), msg));
  }
  mount([...head,
    h("div", { class: "grid-2" },
      h("div", { class: "stack" }, decide,
        e.approved && e.files ? nextPanel("This estimate is approved. Build it or size a change to it.", [
          [`#/new/brownfield/estimate/${rid}`, "layers", "Build this estimate"],
          [`#/new/estimate/revises/${rid}`, "pen", "Change request"],
        ]) : null,
        panel(0, "Estimate", "ruler", summary, files), panel(2, "API cost by phase", "grid", costTable),
        e.stack ? panel(3, "Stack priced", "layers", h("dl", { class: "facts" }, [["Backend", e.stack.backend], ["Web", e.stack.web], ["Mobile", e.stack.mobile], ["Database", e.stack.database], ["Hosting", e.stack.hosting], ["Architecture", e.stack.architecture]].filter((r) => r[1]).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
          h("p", { class: "small muted" }, e.stack.basis === "repo" ? "From the repo." : e.stack.basis === "request" ? "Named in the requirements." : `Assumed by the estimate${e.stack.notes ? `: ${e.stack.notes}` : "."}`)) : null,
        e.factoryAssumptions?.length ? panel(3, "Assumed by the factory", "alert", h("p", { class: "small muted" }, "Nobody was asked: the requirements came refined, so each open question took its recommended answer. Confirm these with the client."),
          h("ul", { class: "reasons small" }, e.factoryAssumptions.map((a) => h("li", {}, h("span", { class: "mono" }, a.id), " ", a.text, a.fromDefault ? h("span", { class: "tag faint" }, `standard answer: ${a.fromDefault}`) : null, a.risk === "high" ? h("span", { class: "tag" }, "high risk") : null)))) : null,
        e.assumptions.length ? panel(3, "Assumptions", "alert", h("ul", { class: "reasons small" }, e.assumptions.map((x) => h("li", {}, x)))) : null),
      h("div", { class: "stack" }, panel(1, "Screens", "browser", design), panel(2, "Tasks", "layers", tasks, ...extra))),
  ], true);
}

// ---------- design ----------

/** The build's before and after pictures of each page, with what moved. Evidence, not a verdict. */
const LEVEL_TITLE = { tokens: "Tokens", structure: "Structure", a11y: "Accessibility", layout: "Layout", pixels: "Pixels" };
const pageLabel = (p) => `${p.id} ${p.state} · ${p.viewport}${p.mode ? " · dark" : ""}${p.lang ? ` · ${p.lang}` : ""}`;

/** The Fidelity panel: the built app against the approved design, level by level, a page's pictures side by side, and the terminal command that accepts them as the baseline. */
function fidelityPanel(rid, v) {
  const head = h("div", { class: "panel-head" }, h("h2", {}, icon("shield"), "Fidelity to the approved design"));
  const wrap = (...body) => h("section", { class: "panel rise", id: "fidelity-panel", vars: { "--i": 2 } }, head, ...body);
  if (v.none) return wrap(h("p", { class: "muted small" }, v.none));
  if (v.skipped && !v.pages.length) return wrap(h("p", { class: "muted small" }, `Not run: ${v.skipped}.`), h("p", { class: "small muted" }, "It runs after acceptance whenever the factory generated the screens (switch it off with design.fidelity: false; docs/estimates-design.md, \"Fidelity and tests\"). By hand, on an app you started: ", h("code", {}, `factory design fidelity ${rid} --url http://localhost:3000`), "."));
  const tone = (st) => (st === "PASS" ? "pass" : st === "FAIL" ? "fail" : "");
  const levels = h("div", { class: "fid-levels" }, v.levels.map((l) => h("div", { class: `fid-level ${tone(l.status)}` },
    h("div", { class: "row" }, icon(l.status === "PASS" ? "check" : l.status === "FAIL" ? "x" : "alert"), h("strong", {}, LEVEL_TITLE[l.level] ?? l.level), h("span", { class: "faint small" }, l.blocking ? "blocking" : "advice")),
    h("div", { class: "small" }, `${l.status} · ${l.detail}`))));
  const waived = v.waivers.length ? h("p", { class: "small" }, icon("alert"), ` Waived: ${v.waivers.map((w) => `${w.gateIds.join(", ")} by ${w.human} (${w.reason})`).join("; ")}`) : null;
  const findings = v.findings.length ? h("details", { class: "export-opts", open: v.findings.some((f) => f.level !== "layout" && f.level !== "pixels") ? "" : undefined },
    h("summary", { class: "small" }, `${v.findings.length} finding${v.findings.length === 1 ? "" : "s"}`),
    h("ul", { class: "reasons small" }, v.findings.slice(0, 40).map((f) => h("li", {}, h("strong", {}, `${LEVEL_TITLE[f.level] ?? f.level}: `), f.message, h("span", { class: "faint" }, ` (${f.pages.length} page${f.pages.length === 1 ? "" : "s"})`))))) : h("p", { class: "small" }, icon("check"), " No findings.");
  // one page at a time: the approved picture, the built one, the accepted one and the difference
  const pages = v.pages.filter((p) => p.built);
  const onlyFound = h("input", { type: "checkbox", id: "fid-only" });
  const pick = h("select", { "aria-label": "Page" });
  const fill = () => {
    const list = onlyFound.checked ? pages.filter((p) => p.findings.length || p.noticeable) : pages;
    const keep = pick.value;
    pick.replaceChildren(...list.map((p) => h("option", { value: p.key }, `${pageLabel(p)}${p.findings.length ? ` · ${p.findings.length} finding${p.findings.length === 1 ? "" : "s"}` : ""}`)));
    if (list.some((p) => p.key === keep)) pick.value = keep;
    show();
  };
  const fig = (url, label) => h("figure", { class: "vshot" }, url ? h("button", { type: "button", class: "ref-pic", "aria-label": `Open ${label}`, onclick: () => lightbox({ url, screen: label, viewport: "" }) }, h("img", { src: url, alt: label, loading: "lazy" })) : h("div", { class: "slot small muted" }, "none"), h("figcaption", { class: "small muted" }, label));
  const view = h("div", { class: "stack" });
  const show = () => {
    const p = pages.find((x) => x.key === pick.value);
    if (!p) return view.replaceChildren(h("p", { class: "small muted" }, "No page to show."));
    view.replaceChildren(...[
      h("div", { class: "fid-shots" }, fig(p.approved, "Approved design"), fig(p.built, "Built app"), p.baseline ? fig(p.baseline, "Accepted baseline") : null, p.diff ? fig(p.diff, "Differences in red") : null),
      p.ratio !== undefined ? h("p", { class: "small" }, h("span", { class: `tag${p.noticeable ? "" : " faint"}` }, `${(p.ratio * 100).toFixed(p.ratio < 0.1 ? 1 : 0)}% differs from the baseline`)) : null,
      p.accepted ? h("p", { class: "small muted" }, `Baseline accepted by ${p.accepted.by} on ${p.accepted.at.slice(0, 10)}: ${p.accepted.reason}`) : null,
      p.findings.length ? h("ul", { class: "reasons small" }, p.findings.map((f) => h("li", {}, h("strong", {}, `${LEVEL_TITLE[f.level] ?? f.level}: `), f.message))) : null].filter(Boolean));
  };
  pick.addEventListener("change", show);
  onlyFound.addEventListener("change", fill);
  // accepting built pictures as the baseline is a terminal decision (factory design baseline), recorded with a reason
  const msg = h("div", { class: "small", role: "status" });
  const panel = wrap(
    h("p", { class: "small" }, h("span", { class: `chip ${v.overall === "pass" ? "pass" : v.overall === "fail" ? "fail" : ""}` }, `overall: ${v.overall}`), h("span", { class: "faint" }, ` ${v.pages.length} pages · ${v.ran.join(", ")}`)),
    levels, waived, findings,
    v.notes.length ? h("ul", { class: "small muted" }, v.notes.map((n) => h("li", {}, n))) : null,
    pages.length ? h("div", { class: "row" }, pick, h("label", { class: "small", for: "fid-only" }, onlyFound, " only pages with findings")) : null,
    view,
    v.canAccept ? h("div", { class: "stack" }, h("h3", { class: "small" }, "Accept as the baseline"),
      h("p", { class: "small muted" }, "In your terminal, with a reason:"),
      h("div", { class: "cmds" }, h("div", { class: "cmd" }, h("span", { class: "prompt" }, "$"), h("code", {}, `factory design baseline ${rid} --all --reason "..."`), copyButton(`factory design baseline ${rid} --all --reason ""`))), msg) : msg);
  fill();
  return panel;
}

function visualPanel(id, v) {
  const head = h("div", { class: "panel-head" }, h("h2", {}, icon("image"), "Before and after"));
  const wrap = (...body) => h("section", { class: "panel rise", vars: { "--i": 2 } }, head, ...body);
  if (v.none) return wrap(h("p", { class: "muted small" }, v.none));
  if (v.skipped) return wrap(h("p", { class: "muted small" }, `Skipped: ${v.skipped}. `), h("p", { class: "small muted" }, "Turn it on with design.capture in the project config (see docs/design-step.md). By hand: ", h("code", {}, "factory design capture"), " and ", h("code", {}, "factory design pixel"), "."));
  const shot = (rel, label) => rel ? h("figure", { class: "vshot" }, h("a", { href: `/shots/${encodeURIComponent(id)}/${rel}`, target: "_blank", rel: "noopener" }, h("img", { src: `/shots/${encodeURIComponent(id)}/${rel}`, alt: `${label}`, loading: "lazy" })), h("figcaption", { class: "small muted" }, label)) : null;
  const results = v.results.filter((r) => r.status !== "PASS");
  return wrap(
    h("div", { class: "chips" }, h("span", { class: `chip ${v.overall === "pass" ? "pass" : v.overall === "fail" ? "fail" : ""}` }, icon(v.overall === "pass" ? "check" : "alert"), `layout and accessibility: ${v.overall}`)),
    results.length ? h("ul", { class: "reasons small" }, results.slice(0, 12).map((r) => h("li", {}, h("strong", {}, `${r.status} ${r.check}`), ` ${r.detail}`))) : null,
    v.note ? h("p", { class: "small muted" }, v.note) : null,
    ...v.pages.map((p) => h("div", { class: "stack" },
      h("h3", {}, p.name, p.ratio !== undefined ? h("span", { class: `tag${p.noticeable ? "" : " faint"}` }, `${(p.ratio * 100).toFixed(p.ratio < 0.1 ? 1 : 0)}% of pixels differ${p.sizeChanged ? ", page size changed" : ""}`) : null),
      h("div", { class: "grid-2" }, shot(p.base, "Before"), shot(p.final, "After")), p.diff ? shot(p.diff, "Differences in red") : null)),
    h("p", { class: "small muted" }, "A change request is meant to change how a page looks, so the pixel figures are facts to look at, not a pass or fail."));
}


/** A run's design references: pictures, what was measured, how they were read and used, the screens they shaped. */
function refsPanel(v, compact = false) {
  if (!v.references.length) return compact ? null : h("p", { class: "muted small" }, v.none);
  const swatch = (c) => h("span", { class: "sw", title: `${c.hex}${c.role ? ` ${c.role}` : ""}`, vars: { "--c": /^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : "transparent" } });
  return h("div", { class: "ref-cards" }, v.references.map((r) => h("article", { class: "ref-card" },
    r.images.length ? h("div", { class: "ref-pics" }, r.images.slice(0, compact ? 1 : 4).map((im) => h("button", { type: "button", class: "ref-pic", "aria-label": `${r.id} ${im.label}`, onclick: () => lightbox({ url: im.url, screen: `${r.id} · ${im.label}`, viewport: r.role }) }, h("img", { src: im.url, alt: `${r.id} ${im.label}`, loading: "lazy" }))))
      : h("div", { class: "ref-pics none small muted" }, icon(r.kind === "url" ? "browser" : "file"), "no picture"),
    h("div", { class: "ref-body" },
      h("div", { class: "row" }, h("strong", { class: "mono" }, r.id), h("span", { class: `pill t-${r.role === "match" ? "ok" : r.role === "layout" ? "idle" : "live"}` }, r.role), h("span", { class: "faint small" }, r.kind)),
      h("div", { class: "mono small ref-source", title: r.source }, r.source),
      r.note ? h("div", { class: "small" }, h("span", { class: "faint" }, "note: "), r.note) : null,
      compact ? null : [
        r.colours.length ? h("div", { class: "row small" }, h("span", { class: "swatches" }, r.colours.slice(0, 8).map(swatch)), h("span", { class: "faint" }, r.measured === "exact" ? "exact" : "approximate")) : null,
        r.fonts.length ? h("div", { class: "small" }, h("span", { class: "faint" }, "fonts: "), r.fonts.map((f) => f.family).join(", ")) : null,
        r.read ? h("div", { class: "small" }, h("span", { class: "faint" }, "read as: "), [r.read.kind, r.read.navigation !== "unclear" ? r.read.navigation : null, r.read.reqs.length ? `for ${r.read.reqs.join(", ")}` : null].filter(Boolean).join(" · ")) : null,
      ],
      r.use ? h("div", { class: "small" }, h("span", { class: "faint" }, r.use.use === "used" ? "used: " : "set aside: "), r.use.how) : null,
      r.screens.length ? h("div", { class: "tags" }, r.screens.map((x) => h("span", { class: "tag" }, h("span", { class: "n" }, x.id), x.title))) : null,
      r.gaps.map((g) => h("div", { class: "small ref-gap" }, icon("alert"), `${g.screen} still differs:${g.nav ? ` not reached by ${g.nav}` : ""}${g.nav && g.missing.length ? ";" : ""}${g.missing.length ? ` no ${g.missing.join(", ")}` : ""}`)),
    ))));
}

/** What the export menu offers: each choice is a set of formats (and PDF per screen or not). */
const EXPORT_CHOICES = [
  { id: "png", label: "Pictures (PNG, zip)", formats: ["png"] },
  { id: "pdf", label: "PDF design book", formats: ["pdf"] },
  { id: "pdf-screens", label: "PDF, one per screen", formats: ["pdf"], pdfPerScreen: true },
  { id: "html", label: "Clickable demo (zip)", formats: ["html"] },
  { id: "tokens", label: "Design tokens (JSON, CSS, Tailwind)", formats: ["tokens"] },
  { id: "json", label: "Design and manifest (JSON)", formats: ["json"] },
  { id: "figma", label: "Figma (figma.json for the AI Factory Import plugin)", formats: ["figma"] },
  { id: "all", label: "Everything", formats: ["png", "pdf", "html", "tokens", "json", "figma"] },
];

/** Earlier exports of the run, newest first: the whole export as a zip, and its book or demo on their own. */
function exportList(rid, exports) {
  if (!exports.length) return h("p", { class: "small muted" }, "No exports yet.");
  const base = `/design-exports/${encodeURIComponent(rid)}/`;
  const file = (e, path, label) => h("a", { href: `${base}${e.id}/${path.split("/").map(encodeURIComponent).join("/")}`, download: "" }, label);
  return h("ul", { class: "export-list" }, exports.map((e) => {
    const has = (p) => e.files.some((f) => f.path === p);
    return h("li", {},
      h("div", { class: "row" },
        h("a", { class: "btn small", href: `${base}${e.id}.zip`, download: "" }, icon("download"), `v${e.version} · export ${e.id.split("/")[1]}`),
        h("span", { class: "tags" }, e.formats.map((f) => h("span", { class: "tag" }, f))),
        h("span", { class: "small faint" }, `${e.files.length} file${e.files.length === 1 ? "" : "s"} · ${ago(e.at)}`)),
      h("div", { class: "row small" },
        has("design-book.pdf") ? file(e, "design-book.pdf", "design book (.pdf)") : null,
        e.files.filter((f) => f.path.startsWith("pdf/")).map((f) => file(e, f.path, f.path.slice(4))),
        has("demo.zip") ? file(e, "demo.zip", "clickable demo (.zip)") : null,
        has("tokens/tokens.json") ? file(e, "tokens/tokens.json", "tokens.json") : null,
        has("tokens/tailwind.css") ? file(e, "tokens/tailwind.css", "tailwind.css") : null,
        has("figma.json") ? file(e, "figma.json", "figma.json") : null),
      e.checks?.length ? h("div", { class: "chips" }, e.checks.map((c) => h("span", { class: `chip ${c.status === "PASS" ? "pass" : c.status === "FAIL" ? "fail" : ""}`, title: [c.detail, ...(c.items ?? [])].join("\n") }, icon(c.status === "PASS" ? "check" : c.status === "FAIL" ? "x" : "alert"), c.check))) : null,
      e.notes.length ? h("ul", { class: "small muted" }, e.notes.map((n) => h("li", {}, n))) : null);
  }));
}

/** The Export panel on the Design tab: pick what to export and for which screens, widths, modes and languages; it runs as a job on this machine. */
function exportPanel(rid, v) {
  const head = h("div", { class: "panel-head" }, h("h2", {}, icon("download"), "Export the design"));
  const listBox = h("div", {}, exportList(rid, v.exports));
  if (!v.available) return h("section", { class: "panel rise", vars: { "--i": 0 } }, head, h("p", { class: "small muted" }, v.why), v.exports.length ? listBox : null);
  const d = v.design;
  const checks = (name, items, all = true) => {
    const boxes = items.map((it) => h("label", { class: "xopt" }, h("input", { type: "checkbox", name, value: it.value, checked: all ? "" : undefined }), it.label));
    return { el: h("fieldset", { class: "xopts" }, h("legend", { class: "small faint" }, name), boxes), picked: () => boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value), total: boxes.length };
  };
  const choice = h("select", { "aria-label": "What to export" }, EXPORT_CHOICES.map((c) => h("option", { value: c.id }, c.label)));
  choice.value = "all";
  const screens = checks("screens", v.options.screens.map((x) => ({ value: x.id, label: x.id === "components" ? "Components" : `${x.id} ${x.title}` })));
  // every state on the demo's tabs, once (like --states); a picture of a dark or other-language page counts as its first state
  const stateNames = [...new Map(v.options.screens.filter((x) => x.id !== "components").flatMap((x) => x.states).map((st) => [st.toLowerCase(), st])).values()];
  const states = checks("states", stateNames.map((x) => ({ value: x, label: x })));
  const widths = checks("widths", v.options.widths.map((x) => ({ value: x, label: x })));
  const modes = checks("modes", v.options.modes.map((x) => ({ value: x, label: x })));
  const langs = checks("languages", v.options.langs.map((x) => ({ value: x, label: x })));
  const version = v.versions.length > 1 ? h("select", { "aria-label": "Design version" }, v.versions.map((n) => h("option", { value: String(n) }, `v${n}`))) : null;
  if (version && d.version) version.value = String(d.version);
  const msg = h("div", { class: "small", role: "status" });
  const go = h("button", { class: "btn", type: "button" }, icon("download"), "Export");
  const only = (c) => (c.picked().length === c.total ? undefined : c.picked());
  const watch = (job) => {
    const tick = async () => {
      if (!go.isConnected) return; // the page moved on
      const nv = await api(`/api/runs/${encodeURIComponent(rid)}/exports`).catch(() => undefined);
      const j = nv?.jobs.find((x) => x.id === job.id);
      if (!nv || !j) return;
      if (j.status === "running") { msg.replaceChildren(h("span", { class: "pulse" }), ` Exporting… ${j.lines.at(-1) ?? ""}`); setTimeout(tick, 1200); return; }
      // drawn again from the fresh view (the package and its version exist after the first export), keeping the outcome
      const next = exportPanel(rid, nv);
      next.classList.remove("rise");
      next.querySelector("[role=status]").replaceChildren(...(j.status === "failed" ? [icon("alert"), ` The export failed: ${j.error}`]
        : [icon("check"), ` Exported as ${j.exportId}. `, h("a", { href: `/design-exports/${encodeURIComponent(rid)}/${j.exportId}.zip`, download: "" }, "Download it all (.zip)")]));
      panel.replaceWith(next);
    };
    setTimeout(tick, 400); // after the panel is on the page
  };
  go.addEventListener("click", async () => {
    const c = EXPORT_CHOICES.find((x) => x.id === choice.value);
    if (!screens.picked().length || !states.picked().length || !widths.picked().length || !modes.picked().length || !langs.picked().length) { msg.textContent = "Pick at least one of each: screen, state, width, mode and language."; return; }
    const body = { formats: c.formats, pdfPerScreen: !!c.pdfPerScreen, screens: only(screens), states: only(states), widths: only(widths), modes: only(modes), langs: only(langs), version: version ? Number(version.value) : undefined };
    go.disabled = true;
    msg.textContent = "Starting…";
    try {
      const { job } = await api(`/api/runs/${encodeURIComponent(rid)}/exports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      watch(job);
    } catch (err) { go.disabled = false; msg.textContent = err.message; }
  });
  const panel = h("section", { class: "panel rise", vars: { "--i": 0 } }, head,
    h("p", { class: "small muted" }, d.version ? `Design ${d.line} v${d.version}, approved by ${d.approvedBy} ${ago(d.approvedAt)}. Files are tagged with the version and land in this run's exports folder.` : d.pending),
    d.picturesNote ? h("p", { class: "small muted" }, d.picturesNote) : null,
    h("div", { class: "row" }, choice, version, go),
    h("details", { class: "export-opts" }, h("summary", { class: "small" }, "Screens, states, widths, modes and languages"), h("div", { class: "stack" }, screens.el, states.el, widths.el, modes.el, langs.el)),
    h("p", { class: "small faint" }, v.figma.note, " ", h("a", { href: v.figma.plugin, download: "" }, "Download the plugin (.zip)")),
    msg,
    h("h3", { class: "small" }, "Earlier exports"),
    listBox);
  const running = v.jobs.find((j) => j.status === "running");
  if (running) { go.disabled = true; watch(running); }
  return panel;
}

const TARGET_LABELS = { "next-shadcn": "Next.js + shadcn/ui", "vite-shadcn": "Vite + React + shadcn/ui", repo: "The repo's own components (no kit)" };
const TARGET_SOURCE = { config: "the project's setting", run: "chosen when the run started", detected: "detected from the repo", default: "the default", phone: "a phone app", none: "nothing to go on" };

/** The Code panel on the Design tab: the UI target, the files the scaffold writes before any agent starts, and a copy to download and run. */
function codePanel(rid, v, tried) {
  const head = h("div", { class: "panel-head" }, h("h2", {}, icon("code"), "Code: kit and scaffold"));
  if (!v.available) return h("section", { class: "panel rise", id: "code-panel", vars: { "--i": 0 } }, head, h("p", { class: "small muted" }, v.why));
  const x = v.view;
  const pick = h("select", { "aria-label": "UI target" }, v.targets.map((t) => h("option", { value: t }, TARGET_LABELS[t] ?? t)));
  pick.value = x.target;
  const msg = h("div", { class: "small", role: "status" });
  const redraw = async (target) => {
    msg.replaceChildren(h("span", { class: "pulse" }), " Working out the files…");
    try {
      const nv = await api(`/api/runs/${encodeURIComponent(rid)}/scaffold${target ? `/${encodeURIComponent(target)}` : ""}`);
      const next = codePanel(rid, nv, target);
      next.classList.remove("rise");
      panel.replaceWith(next);
    } catch (err) { msg.textContent = err.message; }
  };
  pick.addEventListener("change", () => redraw(pick.value));
  const zip = (t) => h("a", { href: `/scaffolds/${encodeURIComponent(rid)}/${t}.zip`, download: "" }, `${t}.zip`);
  const gen = h("button", { class: "btn", type: "button", disabled: x.kit ? undefined : "" }, icon("download"), "Generate");
  gen.addEventListener("click", async () => {
    gen.disabled = true;
    msg.replaceChildren(h("span", { class: "pulse" }), " Generating…");
    try {
      const r = await api(`/api/runs/${encodeURIComponent(rid)}/scaffold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: x.target }) });
      msg.replaceChildren(icon("check"), ` ${r.files} files in ${r.dir}. `, zip(r.target), h("span", { class: "faint" }, " · npm install && npm run dev, then add ?fixture=S-1:empty to a page to see any state."));
    } catch (err) { msg.textContent = err.message; }
    gen.disabled = false;
  });
  const by = (o) => x.files.filter((f) => f.owner === o).length;
  const body = !x.kit
    ? [h("p", { class: "small muted" }, "No scaffold: the screens are built with the repo's own components, each from its approved brief (the build's implement tasks write them).")]
    : [
      h("div", { class: "tags" },
        h("span", { class: "tag" }, h("span", { class: "n" }, "kit"), `${x.kit.id} ${x.kit.version}`),
        h("span", { class: "tag" }, h("span", { class: "n" }, "root"), x.root || "."),
        x.fresh ? h("span", { class: "tag" }, "a fresh app") : null,
        ...[["kit", "kit"], ["theme", "theme"], ["screen", "page"], ["glue", "frame and routes"], ["app", "app"]].map(([o, l]) => by(o) ? h("span", { class: "tag" }, h("span", { class: "n" }, l), String(by(o))) : null),
        x.kept.length ? h("span", { class: "tag", title: x.kept.join("\n") }, h("span", { class: "n" }, "kept"), String(x.kept.length)) : null),
      x.built ? h("p", { class: "small" }, icon("check"), ` The build wrote it${x.built.commit ? ` in ${x.built.commit.slice(0, 10)}` : ""} (${x.built.written} files) before any agent started.`) : h("p", { class: "small muted" }, "The build writes these files into the repo in its first commit after the design, before any agent starts. The agents fill in each screen's container with real data and behaviour; the pages as approved stay as they are."),
      x.changed ? h("p", { class: "small" }, h("strong", {}, "Change request: "), x.changed.length ? `pages written again for ${x.changed.join(", ")}; the rest stay as built.` : "no page changed.") : null,
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Screen"), h("th", {}, "Route"), h("th", {}, "Container (the task's file)"), h("th", {}, "States"))),
        h("tbody", {}, x.screens.map((sc) => h("tr", {}, h("td", {}, `${sc.id} ${sc.title}`), h("td", { class: "mono" }, sc.route), h("td", { class: "mono small" }, sc.container), h("td", { class: "small", title: Object.keys(sc.states).map((k) => `?fixture=${sc.id}:${k}`).join("\n") }, String(Object.keys(sc.states).length))))))),
      x.designSystem.todo.length ? h("div", {}, h("h3", { class: "small" }, "The design-system task (first in the plan)"), h("ul", { class: "reasons small" }, x.designSystem.todo.map((t) => h("li", {}, t)))) : null,
      x.notes.length ? h("ul", { class: "reasons small muted" }, x.notes.map((n) => h("li", {}, n))) : null,
      h("details", { class: "export-opts" }, h("summary", { class: "small" }, `All ${x.files.length} files`),
        h("ul", { class: "small mono file-list" }, x.files.map((f) => h("li", {}, h("span", { class: "faint" }, `${f.owner} · ${f.regenerate ? "factory" : "repo's"} · `), f.path)))),
    ];
  const panel = h("section", { class: "panel rise", id: "code-panel", vars: { "--i": 0 } }, head,
    h("p", { class: "small" }, h("strong", {}, TARGET_LABELS[x.target] ?? x.target), ` · ${tried ? "a preview of another target (the run keeps its own)" : TARGET_SOURCE[x.source] ?? x.source} · the repo: ${x.why}`),
    x.repoApps.length ? h("p", { class: "small muted" }, `Built with the repo's own components: ${x.repoApps.join(", ")} (a phone app, or set so).`) : null,
    h("div", { class: "row" }, pick, gen),
    ...body,
    msg,
    v.generated.length ? h("p", { class: "small faint" }, "Generated copies: ", ...v.generated.flatMap((t, i) => [i ? ", " : "", zip(t)])) : null);
  return panel;
}

async function designScreen(id) {
  skeleton("grid");
  const [r, d, refv, xv, sv] = await Promise.all([api(`/api/runs/${encodeURIComponent(id)}`), api(`/api/runs/${encodeURIComponent(id)}/design`), api(`/api/runs/${encodeURIComponent(id)}/references`), api(`/api/runs/${encodeURIComponent(id)}/exports`), api(`/api/runs/${encodeURIComponent(id)}/scaffold`)]);
  const fv = await api(`/api/runs/${encodeURIComponent(id)}/fidelity`).catch(() => ({ none: "The fidelity check could not be read." }));
  let size;
  if ("none" in d.uiSize) size = h("p", { class: "muted" }, d.uiSize.none);
  else {
    const s = d.uiSize.size;
    size = [
      h("div", { class: "level-name" }, s.name),
      h("div", { class: "levels" }, d.levels.map((l) => h("div", { class: l.level === s.level ? "on" : undefined }, l.name))),
      h("p", { class: "small" }, h("strong", {}, "Design work: "), s.work),
      s.reasons.length ? h("ul", { class: "reasons small" }, s.reasons.map((x) => h("li", {}, x))) : null,
      d.uiSize.approvalCardLine ? h("div", { class: "quote" }, h("div", { class: "k" }, "On the approval card"), md(d.uiSize.approvalCardLine))
        : d.uiSize.cardLine ? null : h("div", { class: "quote small muted" }, "The plan touches no UI, so the approval card has no UI size line."),
    ];
  }
  let inv;
  if ("none" in d.inventory) inv = h("div", { class: "slot" }, icon("browser"), h("strong", {}, "No web UI found"), h("span", { class: "small" }, d.inventory.none));
  else {
    const i = d.inventory;
    inv = [
      h("div", { class: "tags" }, [i.stack.framework, i.stack.styling, i.stack.componentSystem].filter((x) => x && x !== "none-detected").map((x) => h("span", { class: "tag" }, x)),
        h("span", { class: "tag" }, h("span", { class: "n" }, "at"), i.commit.slice(0, 8)), h("span", { class: "tag" }, h("span", { class: "n" }, "verdict"), i.verdict)),
      h("h3", {}, `Pages (${i.pages.length})`),
      i.pages.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Route"), h("th", {}, "Heading"), h("th", {}, "File"))),
        h("tbody", {}, i.pages.map((p) => h("tr", {}, h("td", { class: "mono" }, p.route), h("td", {}, p.heading ?? h("span", { class: "faint" }, "-")), h("td", { class: "mono small muted" }, p.path)))))) : h("p", { class: "muted" }, "No pages found."),
      h("h3", {}, `Building blocks (${i.buildingBlocks.length})`),
      h("div", { class: "tags" }, i.buildingBlocks.map((c) => h("span", { class: "tag", title: c.path }, c.name, h("span", { class: "n" }, `${c.uses}×`)))),
      h("h3", {}, `Shared components (${i.sharedComponents.length})`),
      i.sharedComponents.length ? h("div", { class: "tags" }, i.sharedComponents.map((c) => h("span", { class: "tag", title: c.path }, c.name, h("span", { class: "n" }, `${c.uses}×`)))) : h("p", { class: "small muted" }, "None."),
      h("p", { class: "small muted" }, `Theme tokens: ${i.tokens.light} light, ${i.tokens.dark} dark, ${i.tokens.theme} in @theme · off-system styling: ${i.offSystem.hexColors} hex colours, ${i.offSystem.arbitraryValues} arbitrary values, ${i.offSystem.inlineStyle} inline styles`),
    ];
  }
  const style = d.styleChecks.length
    ? h("div", { class: "chips" }, d.styleChecks.map((g) => h("span", { class: `chip ${g.passed ? "pass" : "fail"}` }, icon(g.passed ? "check" : "x"), g.gateId)))
    : h("p", { class: "muted small" }, "No style check results for this run. The build runs the style check on each task that changes UI files, so a run that changed none has no results. By hand: ", h("code", {}, "factory design lint --git <base> <head> --repo <repo>"), ".");
  mount([...runHeader(r, "design"),
    h("div", { class: "grid-2" },
      h("div", { class: "stack" },
        // a design-only run, once approved, is sized or built from here (like --from-design)
        // a design with no repo (a new product) is built into a project whose repo is still empty (greenfield)
        r.mode === "design" && xv.available ? nextPanel(r.repo ? "This design is approved. Size it, or build it in its project." : "This design is approved. Size it, or build it as a new product into an empty repo (git init a folder, then factory init it).", [
          [`#/new/estimate/design/${encodeURIComponent(id)}`, "ruler", "Estimate this design"],
          [`#/new/brownfield/design/${encodeURIComponent(id)}`, "layers", "Build this design"],
        ]) : null,
        exportPanel(id, xv),
        codePanel(id, sv),
        h("section", { class: "panel rise", vars: { "--i": 0 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("ruler"), "UI change size")), size),
        h("section", { class: "panel rise", vars: { "--i": 1 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("shield"), "Style check")), style),
        fidelityPanel(id, fv),
        visualPanel(id, d.visual),
        // a brownfield build draws a design too when it touches UI (its timeline then has the design step)
        r.mode === "estimate" || r.mode === "design" || (r.timeline ?? []).some((t) => t.step === "design") ? h("a", { class: "slot rise", href: `#/runs/${encodeURIComponent(id)}/preview`, vars: { "--i": 3 } }, icon("cursor"), h("strong", {}, "Clickable prototype"), h("span", {}, "The demo and its screenshots are under Preview.")) : null,
        h("section", { class: "panel rise", vars: { "--i": 4 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("image"), `References${refv.references.length ? ` (${refv.references.length})` : ""}`)), refsPanel(refv)),
      ),
      h("section", { class: "panel rise", vars: { "--i": 1 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("grid"), "The app's pages and building blocks")), inv),
    )], true);
}

// ---------- dashboard ----------

async function dashboardScreen() {
  skeleton();
  const { outcomes: o, stages, recent = [] } = await api("/api/dashboard");
  const tile = (i, ico, label, value, fmt, unit, small) => {
    const big = h("span");
    countUp(big, value ?? NaN, (n) => (value === undefined || value === null ? "-" : fmt(n)));
    return h("div", { class: "panel tile rise", vars: { "--i": i } }, h("div", { class: "k" }, icon(ico), label), h("div", { class: "big" }, big, unit ? h("span", { class: "u" }, unit) : null), h("div", { class: "sm" }, small));
  };
  const maxCost = Math.max(0.01, ...stages.map((s) => s.avgCostUsd));
  const fills = [];
  const hbar = (value, share, cls, i) => {
    const fill = h("div", { class: "fill" });
    fill.style.transitionDelay = `${i * 40}ms`;
    fills.push([fill, Math.max(0, Math.min(1, share))]);
    return h("div", { class: `hbar ${cls}` }, h("div", { class: "track" }, fill), h("span", { class: "v" }, value));
  };
  mount([
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Dashboard"), h("h1", {}, "How the factory is doing"),
      h("p", { class: "sub" }, `Across all ${o.runs} runs on this computer: the same numbers as factory report --all.`))),
    o.runs ? h("div", { class: "tiles" },
      tile(0, "check", "Delivered", o.delivered, (n) => String(Math.round(n)), `of ${o.runs}`, `${o.parked} parked, ${o.waiting} waiting, ${o.running} running`),
      tile(1, "dollar", "Cost per delivered change", o.costPerDeliveredUsd, money, "", `all spend ${money(o.totalCostUsd)}, parked runs included · a delivered run alone ${money(o.avgDeliveredRunCostUsd)}`),
      tile(2, "clock", "Request → branch", o.wallMin.median, (n) => n.toFixed(n < 10 ? 1 : 0), o.wallMin.median === undefined ? "" : "min", `wall-clock median, includes waiting for people · worst ${mins(o.wallMin.worst)} · machine time median ${mins(o.activeMinMedian)}`),
      tile(3, "user", "Human stops", o.humanStopsPerDelivered, (n) => n.toFixed(1), "", `cards per delivered run · only the plan approval: ${pct(o.approvalOnlyShare)}`),
      tile(4, "shield", "First-time pass", o.firstTimePass.rate === undefined ? undefined : o.firstTimePass.rate * 100, (n) => String(Math.round(n)), o.firstTimePass.rate === undefined ? "" : "%", `of ${o.firstTimePass.finished} finished steps`),
    ) : h("div", { class: "panel empty" }, "No runs yet."),
    stages.length ? h("section", { class: "panel rise", vars: { "--i": 5 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("bars"), "Per stage"), h("span", { class: "small muted" }, "most expensive first")),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Stage"), h("th", { class: "num" }, "Runs"), h("th", {}, "First-time pass"), h("th", {}, "Avg cost"), h("th", { class: "num" }, "Avg time"), h("th", {}, "Most common problem"))),
        h("tbody", {}, stages.map((s, i) => h("tr", {},
          h("td", { class: "mono" }, s.stage), h("td", { class: "num" }, s.count),
          h("td", {}, hbar(pct(s.firstTimePassRate), s.firstTimePassRate, "ok", i)),
          h("td", {}, hbar(money(s.avgCostUsd), s.avgCostUsd / maxCost, "", i)),
          h("td", { class: "num" }, secs(s.avgActiveSec)),
          h("td", { class: "small" }, s.topProblem ? `${s.topProblem.reason} (${s.topProblem.count}×)` : h("span", { class: "faint" }, "-")),
        )))))) : null,
    recent.length ? h("section", { class: "panel rise", vars: { "--i": 6 } }, h("div", { class: "panel-head" }, h("h2", {}, icon("activity"), "Recent runs"), h("a", { href: "#/runs", class: "small" }, "All runs")),
      h("ul", { class: "recent" }, recent.map((r, i) => h("li", { class: `k-${tone(r.status)} rise`, vars: { "--i": i } },
        h("a", { href: `#/runs/${encodeURIComponent(r.runId)}` }, h("span", { class: "bar" }), h("span", { class: "req" }, r.request || r.runId),
          pill(r.status), h("span", { class: "mono small muted" }, money(r.costUsd)), h("span", { class: "small faint nowrap" }, ago(r.createdAt))))))) : null,
  ], true);
  nextFrame(() => { for (const [f, share] of fills) f.style.transform = `scaleX(${share})`; });
}

// ---------- router ----------

async function route() {
  generation++;
  clearTimeout(timer);
  onResize = () => {};
  document.querySelectorAll(".lightbox").forEach((b) => b.remove());
  closeDrawer();
  const hash = location.hash.replace(/^#/, "") || "/new";
  const parts = hash.split("/").filter(Boolean).map(decodeURIComponent);
  const top = parts[0] ?? "new";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === top));
  document.title = `AI Factory · ${{ new: "New run", runs: parts[1] ? parts[1] : "Runs", dashboard: "Dashboard" }[top] ?? ""}`;
  try {
    // #/new/estimate/<design|revises>/<run> and #/new/brownfield/<design|estimate>/<run> start from that run
    if (top === "new" && parts[1] === "brownfield") await requestScreen("brownfield", parts.slice(2));
    else if (top === "new" && parts[1] === "estimate") await requestScreen("estimate", parts.slice(2));
    else if (top === "new" && parts[1] === "design") await requestScreen("design");
    else if (top === "runs" && parts[1] && parts[2] === "estimate") await estimateScreen(parts[1]);
    else if (top === "new") modeScreen();
    else if (top === "runs" && parts[1] && parts[2] === "design") await designScreen(parts[1]);
    else if (top === "runs" && parts[1] && parts[2] === "preview") await previewScreen(parts[1]);
    else if (top === "runs" && parts[1] && parts[2] === "charts") chartsScreen(parts[1]);
    else if (top === "runs" && parts[1] && parts[2] === "stats") statsScreen(parts[1]);
    else if (top === "runs" && parts[1] && parts[2] === "log") logScreen(parts[1]);
    else if (top === "runs" && parts[1]) runScreen(parts[1]);
    else if (top === "runs") runsScreen();
    else if (top === "dashboard") await dashboardScreen();
    else modeScreen();
  } catch (e) {
    showError(e);
  }
}

window.addEventListener("hashchange", route);
route();
