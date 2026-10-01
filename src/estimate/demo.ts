// The clickable demo of an approved design (docs/estimates-design.md, "Design baseline"). Pure code, no model:
// one self-contained HTML page that lets a person walk the screen inventory before approving it. The left
// panel is the walkthrough (flow, screens, the requirements each screen serves); the right is the screen
// drawn as a real product inside a browser window, from the design's sample content, one button per state (loading, empty,
// error, success, validation). A screen without sample content, or with an attached Figma frame, shows the
// wireframe or the frame instead. Nothing in the page is fetched, and every value from the model or the
// request is escaped, so opening it runs only the page's own script.
import { wireframeSvg } from "./wireframe.js";
import { palette } from "./palette.js";
import { icon, iconFor, verbIcon } from "./icons.js";
import { hash, scene } from "./scenes.js";
import type { DesignApp, DesignTheme, FormField, MockBlock, MockOverlay, MockToast, ScreenMock, Switcher } from "../contracts/artifacts.js";
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
  /** the look the design step chose; absent, a clean blue light theme */
  theme?: DesignTheme;
  /** the product's apps when it has more than one (a customer phone app, an admin portal); screens name theirs */
  apps?: DesignApp[];
  /** who or what a one-app product acts for, switched from its frame */
  switcher?: Switcher;
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

type StateKind = "normal" | "loading" | "empty" | "error" | "success" | "validation";
/** A state's name by its words: anything unrecognised draws the normal page. */
export function stateKind(state: string): StateKind {
  return /empty|no data|none|no results/i.test(state) ? "empty"
    : /load|wait|pending|progress|skeleton/i.test(state) ? "loading"
    : /valid|invalid|required/i.test(state) ? "validation"
    : /error|fail|denied|offline|unauthori[sz]ed|forbidden/i.test(state) ? "error"
    : /success|done|saved|complete|confirm|sent/i.test(state) ? "success"
    : "normal";
}

/** The states a screen's demo lists: its own, in order, then each overlay shown open, each toast shown, and a "Full data" page when the design gave dense sample data. */
export function demoStates(s: { states?: string[]; frames?: string[]; mockFull?: unknown; mock?: { overlays?: { kind: string; title: string }[]; toasts?: { text: string }[] } }): string[] {
  // the normal page always comes first: a screen whose listed states are all special (loading, empty, error) still opens on its real content
  const listed = s.states ?? [];
  const own = orderStates(listed.some((st) => stateKind(st) === "normal") ? listed : ["default", ...listed]);
  if (s.frames?.length) return own;
  return [...own, ...(s.mock?.overlays ?? []).map(overlayLabel), ...(s.mock?.toasts ?? []).map(toastLabel), ...(s.mockFull ? [FULL_DATA] : [])];
}
/** A toast's tab in the demo: "Toast: Payment sent". Like an overlay's, a demo tab, not a counted state. */
export const toastLabel = (t: { text: string }): string => `Toast: ${t.text.length > 34 ? `${t.text.slice(0, 33).trimEnd()}…` : t.text}`;
const KIND_NAME: Record<string, string> = { modal: "Dialog", drawer: "Panel", sheet: "Sheet", confirm: "Confirm", menu: "Menu" };
/** An overlay's tab in the demo: "Dialog: Add payee". It is a demo tab, not a state the estimate counts. */
export const overlayLabel = (o: { kind: string; title: string }): string => `${KIND_NAME[o.kind] ?? "Dialog"}: ${o.title}`;
export const FULL_DATA = "Full data";

/** The order the demo lists a screen's states: the normal page first, then success, validation, loading, empty, error. Screenshots use the same order. */
export function orderStates(states: string[]): string[] {
  const rank: Record<StateKind, number> = { normal: 0, success: 1, validation: 2, loading: 3, empty: 4, error: 5 };
  return states.map((st, i) => ({ st, i })).sort((a, b) => rank[stateKind(a.st)] - rank[stateKind(b.st)] || a.i - b.i).map((x) => x.st);
}

const num = (n: number): number => (Number.isFinite(n) ? n : 0);
// a status word's colour, across fields (travel, retail, health, logistics, finance, people): wrong first, then needs attention,
// then happening now, then fine; anything else is neutral. Whole words, so "inactive" is not "active".
const TONES: [RegExp, string][] = [
  [/\b(unpaid|overdue|fail(ed|ure|ing)?|errors?|reject(ed)?|block(ed)?|late|critical|declined|cancell?ed|bounced|expired|out of stock|sold out|missed|lost|suspended|offline|denied|no.?show|disputed|breach(ed)?|returned|refused|terminated|churned|urgent|severe|outage)\b/i, "bad"],
  [/\b(delayed|pending|due|wait(ing|list(ed)?)?|awaiting|draft|(in |under )?review|partial(ly)?|on hold|hold|low stock|few left|at risk|queued|processing|expiring|unverified|limited|needs (action|attention|review)|not \w+|incomplete|requested|follow.?up|warning|moderate|paused)\b/i, "warn"],
  [/\b(boarding|in progress|live|now|in transit|on the way|out for delivery|preparing|checking in|ongoing|running|new|started|en route|departing|arriving|admitted|in surgery|deal|offer|sale|popular|featured|best (value|seller)|top rated|trending|limited time)\b/i, "live"],
  [/\b(paid|active|done|approved|completed?|success(ful)?|delivered|ok|resolved|sent|on track|on time|open|confirmed|booked|available|in stock|verified|online|healthy|passed|shipped|arrived|landed|published|accepted|enrolled|checked.?in|ready|signed|settled|won|valid|insured|current|stable|discharged|normal|good|excellent|hired|closed won)\b/i, "ok"],
];
export const tone = (s: string): string => TONES.find(([re]) => re.test(s.trim()))?.[1] ?? "info";

// a column of amounts, counts or percentages reads right-aligned; a name column gets initials; an id column reads as a code
const NUMERIC = /^(?:[$€£¥₹₨]|[A-Z]{3} )?[-+]?\d[\d,.]*(?:\s?(?:%|k|m|bn|kg|km|mi|h|hrs?|pts|x))?$/i;
const PERSON = /^(?:Dr\.? )?[A-Z][a-z'’-]+(?: [A-Z][a-z'’.-]+){1,2}$/;
const CODE = /^#?[A-Z]{1,5}[- ]?\d{2,}[A-Z0-9-]*$/;
const MONEY = /(?:^|\s)([+−-]?\s?(?:[$€£¥₹₨]|(?:PKR|USD|AED|SAR|GBP|EUR|INR|Rs\.?)\s?)\d[\d,.]*(?:\s?[kKmM])?|[+−-]\s?\d[\d,.]*)\s*$/;
const share = (cells: string[], re: RegExp): number => (cells.length ? cells.filter((c) => re.test(c.trim())).length / cells.length : 0);
const initials = (name: string): string => name.replace(/^Dr\.?\s+/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
// a person's chip gets one of a few calm colours, the same one every time for the same name
const AV = ["#E8EEF9:#2F4F86", "#E9F3EC:#2E6A45", "#F7ECE4:#8A4B2A", "#EFE9F7:#5A3E8A", "#E6F2F4:#1F6470", "#F6E9EE:#8A2F55"];
const avatar = (name: string): string => { const [bg, fg] = AV[Math.abs(hash(name)) % AV.length]!.split(":"); return `<span class="av" style="--avb:${bg};--avf:${fg}">${esc(initials(name))}</span>`; };

/** Rounds a chart's top value up to a readable number for its gridlines. */
const niceMax = (v: number): number => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const short = (v: number): string => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(1)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ","));

/** A smooth line through the points that never overshoots them (monotone cubic), as charting libraries draw it. */
function smooth(p: (readonly [number, number])[]): string {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const d = p.slice(1).map(([x, y], i) => (y - p[i]![1]) / (x - p[i]![0]));
  const m = p.map((_, i) => (i === 0 ? d[0]! : i === p.length - 1 ? d[i - 1]! : d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2));
  let out = `M${p[0]![0]} ${p[0]![1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i]!, [x1, y1] = p[i + 1]!, h = (x1 - x0) / 3;
    out += ` C${(x0 + h).toFixed(1)} ${(y0 + m[i]! * h).toFixed(1)} ${(x1 - h).toFixed(1)} ${(y1 - m[i + 1]! * h).toFixed(1)} ${x1} ${y1}`;
  }
  return out;
}

// the theme of the page being built: set by buildDemo, read by the blocks (pictures, charts)
let look: DesignTheme;
// drawing the full-data page: a busy real day, so a table with bulk actions shows two rows ticked and its bulk bar
let busy = false;

// unique ids for gradients: ids are page-wide, and a gradient first defined in a hidden state would not paint in a visible one
let uidN = 0;
const uid = (): string => (++uidN).toString(36);

/** A small trend line under a figure, rising or falling with its change, drawn from the label so it is the same every build. */
function spark(label: string, down: boolean): string {
  let s = Math.abs(hash(label)) || 7;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = 12, ys = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return 0.5 + (down ? 0.32 : -0.32) * t + (r() - 0.5) * 0.34; });
  const pts = ys.map((y, i) => [Math.round((i / (n - 1)) * 96), Math.round(Math.max(0.06, Math.min(0.94, y)) * 28)] as const);
  const id = uid();
  return `<svg class="spark ${down ? "dn" : "up"}" viewBox="0 0 96 28" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="k${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${smooth(pts)} L96 28 L0 28Z" fill="url(#k${id})" stroke="none"/><path d="${smooth(pts)}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/** A barcode for a pass or ticket, from its own text so it is the same each build. */
function barcode(seed: string): string {
  let x = 0, out = "", s = Math.abs(hash(seed)) || 3;
  while (x < 230) { s = (s * 1103515245 + 12345) % 2147483648; const w = 1 + (s % 3); if ((s >> 4) % 3) out += `<rect x="${x}" width="${w}" height="40"/>`; x += w + 1 + ((s >> 8) % 2); }
  return `<svg class="code128" viewBox="0 0 230 40" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
}

/**
 * A line chart drawn for one width: the wide one for a desktop frame, a narrow one (fewer labels, larger in the frame) for a phone,
 * so its text stays readable in both. The frame's width picks which shows.
 */
function lineSvg(title: string, pts: { label: string; value: number }[], top: number, W: number, H: number, cls: string): string {
  const L = W < 500 ? 34 : 40, R = 12, step = (W - L - R) / Math.max(1, pts.length - 1);
  // a label needs about 44 units, so a narrow chart labels every second or third point (the last always)
  const every = Math.max(1, Math.ceil(pts.length / Math.floor((W - L - R) / 44)));
  const yOf = (v: number) => Math.round(H - 14 - (v / top) * (H - 34));
  const xy = pts.map((p, i) => [Math.round(L + i * step), yOf(p.value)] as const);
  const id = uid(), line = smooth(xy);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="gl${f === 0 ? " base" : ""}" x1="${L}" x2="${W - R}" y1="${yOf(top * f)}" y2="${yOf(top * f)}"/><text class="yl" x="${L - 8}" y="${yOf(top * f) + 3.5}" text-anchor="end">${short(top * f)}</text>`).join("");
  const hover = xy.map(([x, y], i) => {
    const tx = Math.max(L, Math.min(W - R - 92, x - 46)), ty = Math.max(2, y - 54);
    return `<g class="hv${i === xy.length - 1 ? " last" : ""}"><rect class="hit" x="${Math.round(x - step / 2)}" y="0" width="${Math.ceil(step)}" height="${H}"/><line class="cx" x1="${x}" x2="${x}" y1="10" y2="${H - 14}"/><circle class="hd" cx="${x}" cy="${y}" r="5"/><g class="tt"><rect x="${tx}" y="${ty}" width="92" height="40" rx="8"/><text class="tl" x="${tx + 12}" y="${ty + 16}">${esc(pts[i]!.label)}</text><text class="tv" x="${tx + 12}" y="${ty + 32}">${short(pts[i]!.value)}</text></g></g>`;
  }).join("");
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="${esc(title)}"><defs><linearGradient id="ar${id}" x1="0" x2="0" y1="0" y2="1"><stop class="s0" offset="0" stop-color="var(--a1)" stop-opacity=".2"/><stop offset="1" stop-color="var(--a1)" stop-opacity="0"/></linearGradient></defs>${grid}<path class="area" d="${line} L${xy[xy.length - 1]![0]} ${H - 14} L${L} ${H - 14}Z" fill="url(#ar${id})"/><path class="ln" d="${line}" fill="none" pathLength="1"/>${pts.map((p, i) => (i !== pts.length - 1 && (i % every || pts.length - 1 - i < every) ? "" : `<text class="xl" x="${xy[i]![0]}" y="${H + 12}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${esc(p.label)}</text>`)).join("")}${hover}</svg>`;
}

type ChartBlock = Extract<MockBlock, { type: "chart" }>;
// what a chart's series, slices and rings are told apart by: the brand at three strengths, then two status hues and a grey
const swatch = (i: number): string => `var(--c${i % 6})`;
const legendOf = (names: string[]): string => `<span class="legend multi">${names.map((n, i) => `<span><i style="background:${swatch(i)}"></i>${esc(n)}</span>`).join("")}</span>`;
const pctOf = (v: number, whole: number): string => `${whole ? Math.round((v / whole) * 1000) / 10 : 0}%`;

/** Shares of a whole: a ring of slices with the total in its middle, and each slice's value and share beside it. */
function donutChart(b: ChartBlock): string {
  const pts = b.points.slice(0, 6).map((p) => ({ label: p.label, value: Math.max(0, num(p.value)) }));
  const total = pts.reduce((n, p) => n + p.value, 0);
  let at = 0;
  const arcs = pts.map((p, i) => {
    const len = total ? (p.value / total) * 100 : 0, gap = pts.length > 1 && len > 1.2 ? 0.8 : 0;
    const out = `<circle class="sl" r="48" cx="60" cy="60" pathLength="100" stroke="${swatch(i)}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} 100" stroke-dashoffset="${(-at).toFixed(2)}" style="--d:${i}"><title>${esc(p.label)}: ${short(p.value)}</title></circle>`;
    at += len;
    return out;
  }).join("");
  const head = `<div class="ch"><div><h4>${esc(b.title)}</h4></div>${b.ranges?.length ? segs(b.ranges, "Period") : ""}</div>`;
  const legend = `<ul class="dleg">${pts.map((p, i) => `<li><i style="background:${swatch(i)}"></i><span>${esc(p.label)}</span><b>${short(p.value)}${b.unit ? ` ${esc(b.unit)}` : ""}</b><em>${pctOf(p.value, total)}</em></li>`).join("")}</ul>`;
  return `<div class="card chart pie">${head}<div class="dn"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${esc(b.title)}"><circle class="trk" r="48" cx="60" cy="60"/><g transform="rotate(-90 60 60)">${arcs}</g><text class="dt" x="60" y="62" text-anchor="middle">${short(total)}</text><text class="dl" x="60" y="78" text-anchor="middle">${esc(b.unit ?? "Total")}</text></svg>${legend}</div></div>`;
}

/** Progress toward goals: one ring per goal, its share in the middle and its name under it. */
function ringsChart(b: ChartBlock): string {
  const rings = b.points.slice(0, 4).map((p, i) => {
    const raw = num(p.value), pct = Math.max(0, Math.min(100, b.max ? (raw / b.max) * 100 : raw));
    const shown = b.max ? `${short(raw)}${b.unit ? ` ${esc(b.unit)}` : ""}` : `${Math.round(pct)}%`;
    return `<div class="ring${pct >= 100 ? " full" : ""}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="trk" r="26" cx="32" cy="32"/><circle class="val" r="26" cx="32" cy="32" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100" transform="rotate(-90 32 32)" style="--d:${i}"/></svg><b>${shown}</b><span>${esc(p.label)}</span></div>`;
  }).join("");
  return `<div class="card chart rings-c"><div class="ch"><div><h4>${esc(b.title)}</h4></div>${b.ranges?.length ? segs(b.ranges, "Period") : ""}</div><div class="rings" role="list" aria-label="${esc(b.title)}">${rings}</div></div>`;
}

/** One reading against its scale: a half ring filled to the reading, the reading in the middle, the scale's ends under it. */
function gaugeChart(b: ChartBlock): string {
  const p = b.points[0]!, v = num(p.value), top = b.max ?? niceMax(Math.max(1, v));
  const pct = Math.max(0, Math.min(100, (v / top) * 100));
  const unit = b.unit ? `${/^[%°‰]/.test(b.unit) ? "" : " "}${esc(b.unit)}` : "";
  const band = pct >= 85 ? "bad" : pct >= 65 ? "warn" : "";
  return `<div class="card chart gauge-c"><div class="ch"><div><h4>${esc(b.title)}</h4></div>${b.ranges?.length ? segs(b.ranges, "Period") : ""}</div><svg class="gauge${band ? ` ${band}` : ""}" viewBox="0 0 200 128" role="img" aria-label="${esc(`${b.title}: ${short(v)}${b.unit ? ` ${b.unit}` : ""} of ${short(top)}`)}"><path class="trk" d="M20 104 A80 80 0 0 1 180 104"/><path class="val" d="M20 104 A80 80 0 0 1 180 104" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100"/><text class="gv" x="100" y="90" text-anchor="middle">${short(v)}${unit}</text><text class="gl2" x="100" y="110" text-anchor="middle">${esc(p.label)}</text><text class="ge" x="20" y="127" text-anchor="middle">0</text><text class="ge" x="180" y="127" text-anchor="middle">${short(top)}</text></svg></div>`;
}

/** The key a table cell sorts by: a number when it reads as one (an amount, count, percent or duration), a time for a date, else its words. */
export function sortKey(v: string): number | string {
  const t = v.trim();
  const m = /^(?:[A-Z]{3} ?|[$€£¥₹₨] ?|Rs\.? ?)?([+−-]?\d[\d,]*(?:\.\d+)?) ?(%|k|m|bn|kg|km|mins?|h|hrs?|days?|pts)?$/i.exec(t);
  if (m) return Number(m[1]!.replace(/,/g, "").replace("−", "-")) * ({ k: 1e3, m: 1e6, bn: 1e9 }[m[2]?.toLowerCase() as "k"] ?? 1);
  const when = Date.parse(t);
  if (!Number.isNaN(when) && /\d/.test(t) && /[a-z]{3}|\d{4}/i.test(t)) return when;
  return t.toLowerCase();
}
const cmpKey = (a: number | string, b: number | string): number => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

/** The loading look of a block: what is static stays real (labels, column headers, titles, filters, buttons, step names), and only the data becomes shimmering shapes. */
function skeleton(b: MockBlock): string {
  const bar = (w: number, h = 12) => `<i class="sk" style="width:${w}%;height:${h}px"></i>`;
  switch (b.type) {
    case "stats": return `<div class="stats">${b.items.map((it) => `<div class="stat"><div class="sh"><span class="k">${esc(it.label)}</span></div>${bar(55, 26)}${it.delta ? bar(30, 10) : ""}</div>`).join("")}</div>`;
    case "table": return `<div class="card tbl"><table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${[0, 1, 2, 3, 4].map((r) => `<tr>${b.columns.map((_, i) => `<td>${bar(i === 0 ? 70 : 40 + ((r * 13 + i * 29) % 45), 12)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "form": return `<div class="card form">${b.fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${f.kind === "toggle" ? bar(12, 22) : f.kind === "otp" ? bar(60, 46) : f.kind === "slider" ? bar(100, 8) : bar(100, f.kind === "radio" || f.kind === "checkbox" ? 64 : 38)}</div>`).join("")}<div class="row"><button type="button" class="btn primary" disabled>${esc(b.submit)}</button></div></div>`;
    case "chart":
      if (b.kind === "donut" || b.kind === "progress" || b.kind === "gauge") return `<div class="card chart"><div class="ch"><h4>${esc(b.title)}</h4></div><div class="skround">${(b.kind === "progress" ? b.points.slice(0, 4) : [0]).map(() => '<i class="sk"></i>').join("")}</div></div>`;
      return `<div class="card chart"><div class="ch"><h4>${esc(b.title)}</h4></div><div class="skbars">${b.points.map((p, i) => `<i class="sk" style="height:${30 + ((i * 37) % 60)}%"></i>`).join("")}</div></div>`;
    case "steps": return `<ol class="steps">${b.items.map((t, i) => `<li class="${i === b.current ? "now" : ""}"><span>${i + 1}</span>${esc(t)}</li>`).join("")}</ol>`;
    case "cards": return `<div class="cards${b.visual ? " vis" : ""}">${b.items.slice(0, 3).map(() => `<div class="card item">${b.visual ? '<i class="sk pic-sk"></i>' : ""}<div class="ib-body">${bar(60, 14)}${bar(90)}${bar(40)}</div></div>`).join("")}</div>`;
    case "carousel": return `<div class="car sk-car k-${b.style}">${b.title ? `<div class="car-h"><h4>${esc(b.title)}</h4></div>` : ""}<div class="track">${b.items.slice(0, 3).map(() => (b.style === "promo" ? '<div class="slide"><i class="sk"></i></div>' : `<div class="slide"><i class="sk pic-sk"></i>${bar(60, 14)}${bar(40)}</div>`)).join("")}</div></div>`;
    case "list": return `<div class="card list">${b.items.slice(0, 4).map(() => `<div class="li"><i class="sk" style="width:36px;height:36px;border-radius:10px;margin:0"></i><div style="flex:1">${bar(55, 13)}${bar(35, 10)}</div></div>`).join("")}</div>`;
    case "timeline": return `<div class="card tl">${b.items.map((it, i) => `<div class="ev ${it.status}"><span class="t">${esc(it.time)}</span><i></i><div>${bar(40 + ((i * 17) % 30), 13)}${bar(28, 10)}</div></div>`).join("")}</div>`;
    case "detail": return `<div class="card detail ${b.style}">${b.title ? `<div class="dh"><b>${esc(b.title)}</b></div>` : ""}<dl>${b.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${bar(70, 14)}</dd></div>`).join("")}</dl></div>`;
    case "accordion": return `<div class="card acc">${b.title ? `<h4>${esc(b.title)}</h4>` : ""}${b.items.map((it) => `<details><summary><span>${esc(it.title)}</span>${icon("chevd")}</summary></details>`).join("")}</div>`;
    case "filters": return renderBlock(b, "normal");
    case "actions": return renderBlock(b, "normal");
    default: return `<div class="card">${bar(90)}${bar(70)}</div>`;
  }
}

// a segmented control: one of a few views or periods, the first one chosen
const VIEW_ICON: [RegExp, string][] = [[/^list$/i, "menu"], [/^(grid|cards|tiles)$/i, "grid"], [/^map$/i, "map"], [/^(calendar|month|week|day|schedule)$/i, "calendar"], [/^(board|kanban)$/i, "layers"], [/^(chart|graph)$/i, "chart"]];
const segs = (items: string[], label: string): string => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${items.map((t, i) => { const ic = items.length <= 3 ? VIEW_ICON.find(([re]) => re.test(t.trim()))?.[1] : undefined; return `<button type="button" role="radio" aria-checked="${i === 0}"${i === 0 ? ' class="on"' : ""}>${ic ? icon(ic) : ""}<span>${esc(t)}</span></button>`; }).join("")}</div>`;

const btnLabel = (t: string): string => { const v = verbIcon(t); return `${v ? icon(v) : ""}<span>${esc(t)}</span>`; };

// fields the person picks rather than types: the validation state never flags them
const CHOSEN = new Set(["select", "toggle", "radio", "checkbox", "slider"]);
const CURRENCY = /^\s*([A-Z]{3}|[$€£¥₹₨]|Rs\.?)\s?/;
const DIAL = ["+1", "+44", "+92", "+91", "+971", "+966", "+974", "+20"];

/** The richer form fields (choices shown at once, amounts, codes, phone numbers, sliders, cards); undefined for the basic kinds. */
function fieldHtml(f: FormField, id: string, bad: boolean, label: string, err: string, cls: string): string | undefined {
  const v = f.value ?? "", ph = f.placeholder ?? "";
  const inv = bad ? ' aria-invalid="true"' : "";
  const opts = f.options?.length ? f.options : v ? [v] : [];
  switch (f.kind) {
    case "radio": case "checkbox": {
      const on = f.kind === "radio" ? [opts.includes(v) ? v : opts[0]] : v.split(/\s*,\s*/).filter(Boolean);
      return `<fieldset class="${cls} wide opts-f"><legend>${esc(f.label)}</legend><div class="opts${opts.length <= 3 ? " tiles" : ""}">${opts.map((o) => `<label class="opt"><input type="${f.kind}" name="${id}"${on.includes(o) ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div>${err}</fieldset>`;
    }
    case "number":
      return `<div class="${cls}">${label}<span class="num"><button type="button" class="ib" data-step="-1" aria-label="Less">−</button><input id="${id}" type="text" inputmode="numeric" placeholder="${esc(ph)}" value="${esc(bad ? "" : v)}"${inv}><button type="button" class="ib" data-step="1" aria-label="More">+</button></span>${err}</div>`;
    case "currency": {
      const code = CURRENCY.exec(v)?.[1] ?? CURRENCY.exec(ph)?.[1] ?? "$";
      return `<div class="${cls}">${label}<span class="aff"><b>${esc(code)}</b><input id="${id}" type="text" inputmode="decimal" placeholder="${esc(ph.replace(CURRENCY, ""))}" value="${esc(bad ? "" : v.replace(CURRENCY, ""))}"${inv}></span>${err}</div>`;
    }
    case "otp": {
      const digits = v.replace(/\D/g, ""), n = Math.max(4, Math.min(8, digits.length || 6));
      return `<div class="${cls} wide">${label}<span class="otp" role="group" aria-label="${esc(f.label)}">${Array.from({ length: n }, (_, i) => `<input${i === 0 ? ` id="${id}"` : ""} type="text" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" value="${bad ? "" : esc(digits[i] ?? "")}"${inv}>`).join("")}</span>${err}</div>`;
    }
    case "phone": {
      const m = /^\s*(\+\d{1,3})\s*(.*)$/.exec(v) ?? /^\s*(\+\d{1,3})\s*(.*)$/.exec(ph);
      const cc = m?.[1] ?? "+1", rest = /^\s*\+\d/.test(v) ? m?.[2] ?? "" : v;
      return `<div class="${cls} wide">${label}<span class="aff phone"><span class="sel cc"><select aria-label="Country code">${[...new Set([cc, ...DIAL])].map((c) => `<option${c === cc ? " selected" : ""}>${c}</option>`).join("")}</select>${icon("chevd")}</span><input id="${id}" type="tel" placeholder="${esc(ph.replace(/^\s*\+\d{1,3}\s*/, ""))}" value="${esc(bad ? "" : rest)}"${inv}></span>${err}</div>`;
    }
    // a search and a phone number carry an icon or a code beside the text: they take the whole row so the text is not cut
    case "search":
      return `<div class="${cls} wide">${label}<span class="aff srch">${icon("search")}<input id="${id}" type="text" list="${id}l" placeholder="${esc(ph || "Search")}" value="${esc(bad ? "" : v)}"${inv}>${icon("chevd")}</span><datalist id="${id}l">${opts.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>${err}</div>`;
    case "slider": {
      const ends = (f.options ?? []).map((o) => ({ o, n: Number(/-?\d+(?:\.\d+)?/.exec(o.replace(/,/g, ""))?.[0]) })).filter((x) => Number.isFinite(x.n));
      const lo = ends[0]?.n ?? 0, hi = ends.length > 1 ? ends[ends.length - 1]!.n : 100;
      const at = Number(/-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""))?.[0] ?? (lo + hi) / 2);
      // the words around the number ("PKR 50,000", "25 km") stay with it as the slider moves
      const around = /^(.*?)-?\d[\d,.]*(.*)$/.exec(ends[ends.length - 1]?.o ?? v) ?? ["", "", ""];
      const pos = Math.max(lo, Math.min(hi, at));
      return `<div class="${cls} wide">${label}<div class="rng"><input id="${id}" type="range" min="${lo}" max="${hi}" step="${hi - lo > 20 ? 1 : (hi - lo) / 100}" value="${pos}" data-pre="${esc(around[1]!)}" data-suf="${esc(around[2]!)}" style="--p:${hi > lo ? ((pos - lo) / (hi - lo)) * 100 : 0}%"><output for="${id}">${esc(v || `${around[1]}${pos.toLocaleString("en")}${around[2]}`)}</output></div><div class="rngl"><span>${esc(ends[0]?.o ?? String(lo))}</span><span>${esc(ends[ends.length - 1]?.o ?? String(hi))}</span></div></div>`;
    }
    case "card":
      // placeholders only: the demo never shows a card number someone could take for a real one
      return `<div class="${cls} wide">${label}<span class="cardin${bad ? " bad" : ""}">${icon("card")}<input id="${id}" type="text" inputmode="numeric" autocomplete="off" placeholder="${esc(ph && !/\d{5,}/.test(ph.replace(/\s/g, "")) ? ph : "Card number")}"${inv}><input type="text" inputmode="numeric" placeholder="MM / YY" aria-label="Expiry"><input type="text" inputmode="numeric" placeholder="CVC" aria-label="Security code"></span>${err}</div>`;
    default:
      return undefined;
  }
}

/** One block drawn from its sample content; `page` is the page's own words, which pick the pictures on cards. */
function renderBlock(b: MockBlock, k: StateKind, page = ""): string {
  switch (b.type) {
    case "stats":
      return `<div class="stats">${b.items.map((it) => {
        const d = it.delta ?? "", down = /^\s*[-−]|↓|down/i.test(d);
        const pct = /^\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/.exec(it.value);
        const meter = pct && Number(pct[1]) <= 100 ? `<span class="meter"><i style="width:${Number(pct[1])}%"></i></span>` : "";
        const ic = iconFor(it.label);
        return `<div class="stat"><div class="sh"><span class="k">${esc(it.label)}</span>${ic ? `<span class="ic">${icon(ic)}</span>` : ""}</div><b class="v" data-count="${esc(it.value)}">${esc(it.value)}</b><div class="sf">${d ? `<span class="delta ${down ? "dn" : "up"}">${icon("chevd", down ? "" : "flip")}${esc(d.replace(/^\s*[+−-]/, ""))}</span>` : ""}${d && !meter ? spark(it.label, down) : ""}</div>${meter}</div>`;
      }).join("")}</div>`;
    case "filters":
      return `<div class="filters">${b.search ? `<label class="search">${icon("search")}<input type="search" placeholder="${esc(b.search)}" aria-label="${esc(b.search)}"></label>` : ""}${b.chips.length ? `<div class="chips" role="tablist">${b.chips.map((c, i) => `<button type="button" role="tab" class="chip${i === 0 ? " on" : ""}">${esc(c)}</button>`).join("")}</div>` : ""}${b.segments?.length ? segs(b.segments, "View") : ""}</div>`;
    case "table": {
      const sc = b.statusColumn;
      const col = (i: number) => b.rows.map((r) => r[i] ?? "");
      const isNum = b.columns.map((_, i) => i !== sc && share(col(i), NUMERIC) >= 0.6);
      const person = share(col(0), PERSON) >= 0.6, code = !person && share(col(0), CODE) >= 0.6;
      // a sorted table is drawn in its order, so the arrow on its header tells the truth; every header sorts on click
      const sortBy = b.sortBy !== undefined && b.sortBy < b.columns.length ? b.sortBy : undefined;
      const rows = sortBy === undefined ? b.rows : [...b.rows].sort((x, y) => cmpKey(sortKey(x[sortBy] ?? ""), sortKey(y[sortBy] ?? "")) * (b.sortDir === "asc" ? 1 : -1));
      const pick = !!b.selectable || !!b.bulk?.length, ticked = busy && !!b.bulk?.length ? 2 : 0;
      const th = (c: string, i: number) => {
        const cls = isNum[i] ? ' class="n"' : "";
        if (sortBy === undefined) return `<th${cls}>${esc(c)}</th>`;
        const dir = i === sortBy ? (b.sortDir === "asc" ? "ascending" : "descending") : "none";
        return `<th${cls} aria-sort="${dir}"><button type="button" class="sh" data-sort="${i}">${esc(c)}${icon("chevd", dir === "ascending" ? "flip" : "")}</button></th>`;
      };
      const bulk = b.bulk?.length ? `<div class="bulk"${ticked ? "" : " hidden"}><b><span class="bn">${ticked}</span> selected</b><span class="bb">${b.bulk.map((t, i) => `<button type="button" class="btn${i === 0 ? " primary" : ""}" data-act="act">${btnLabel(t)}</button>`).join("")}</span><button type="button" class="lnk" data-clear>Clear</button></div>` : "";
      return `<div class="card tbl">${bulk}<div class="scroll"><table><thead><tr>${pick ? `<th class="ck"><input type="checkbox" aria-label="Select all"${ticked && ticked >= rows.length ? " checked" : ""}></th>` : ""}${b.columns.map(th).join("")}<th class="act"><span class="vh">Actions</span></th></tr></thead><tbody>${rows.map((r, ri) => `<tr${ri < ticked ? ' class="picked"' : ""}>${pick ? `<td class="ck"><input type="checkbox" aria-label="Select ${esc(r[0] ?? "row")}"${ri < ticked ? " checked" : ""}></td>` : ""}${b.columns.map((_, i) => {
        const v = r[i] ?? "";
        const cell = sc === i ? `<span class="badge ${tone(v)}">${esc(v)}</span>` : i === 0 && person && v ? `<span class="who">${avatar(v)}${esc(v)}</span>` : i === 0 && code ? `<span class="code">${esc(v)}</span>` : esc(v);
        const key = sortBy === undefined ? "" : ` data-v="${esc(String(sortKey(v)))}"`;
        return `<td${isNum[i] ? ' class="n"' : i === 0 ? ' class="first"' : ""}${key}>${cell}</td>`;
      }).join("")}<td class="act"><button type="button" class="ib" aria-label="More">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div><div class="tfoot"><span>${b.rows.length} ${b.rows.length === 1 ? "result" : "results"}</span><span class="pager"><button type="button" class="ib" aria-label="Previous page" disabled>${icon("chevl")}</button><b>1</b><button type="button" class="ib" aria-label="Next page" disabled>${icon("chevr")}</button></span></div></div>`;
    }
    case "form": {
      // the validation state flags the typed-in fields the person left empty (at most two), or the first one when all are filled
      const typed = b.fields.map((f, i) => (CHOSEN.has(f.kind) ? -1 : i)).filter((i) => i >= 0);
      const blank = typed.filter((i) => !b.fields[i]!.value);
      const flagged = new Set((blank.length ? blank : typed).slice(0, blank.length ? 2 : 1));
      return `<form class="card form" onsubmit="return false">${b.fields.map((f, i) => {
        const bad = k === "validation" && flagged.has(i);
        const id = `f${Math.abs(hash(f.label + i))}`;
        const label = `<label for="${id}">${esc(f.label)}</label>`;
        const err = bad ? `<span class="err" role="alert">${icon("alert")}${esc(`Enter ${f.label.toLowerCase()}`)}</span>` : "";
        const cls = `field${bad ? " bad" : ""}${f.kind === "textarea" ? " wide" : ""}`;
        if (f.kind === "select") return `<div class="${cls}">${label}<span class="sel"><select id="${id}">${(f.options?.length ? f.options : [f.value ?? f.placeholder ?? "Select"]).map((o) => `<option${o === f.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>${icon("chevd")}</span>${err}</div>`;
        if (f.kind === "textarea") return `<div class="${cls}">${label}<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder ?? "")}">${esc(f.value ?? "")}</textarea>${err}</div>`;
        if (f.kind === "toggle") return `<div class="field tog wide"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="checkbox" role="switch"${f.value && !/^(no|off|false)$/i.test(f.value) ? " checked" : ""}></div>`;
        const more = fieldHtml(f, id, bad, label, err, cls);
        if (more) return more;
        return `<div class="${cls}">${label}<input id="${id}" type="${f.kind === "date" ? "date" : "text"}" placeholder="${esc(f.placeholder ?? "")}" value="${esc(bad ? "" : f.value ?? "")}"${bad ? ' aria-invalid="true"' : ""}>${err}</div>`;
      }).join("")}<div class="row end"><button type="submit" class="btn primary" data-act="submit">${esc(b.submit)}${icon("arrowr")}</button></div></form>`;
    }
    case "chart": {
      if (b.kind === "donut") return donutChart(b);
      if (b.kind === "progress") return ringsChart(b);
      if (b.kind === "gauge") return gaugeChart(b);
      // a stacked bar's height is the sum of its parts
      const stacked = b.kind === "stacked" && !!b.series?.length;
      const pts = b.points.map((p) => ({ label: p.label, value: stacked && p.parts ? p.parts.reduce((n, x) => n + Math.max(0, num(x)), 0) : num(p.value), parts: p.parts }));
      const top = niceMax(Math.max(0, ...pts.map((p) => p.value)));
      const peak = pts.reduce((m, p, i) => (p.value > pts[m]!.value ? i : m), 0);
      const total = pts.reduce((n, p) => n + p.value, 0);
      const last = pts[pts.length - 1]!, prev = pts[pts.length - 2];
      const change = prev && prev.value ? ((last.value - prev.value) / Math.abs(prev.value)) * 100 : 0;
      // a line is a level over time (a balance, a rate): it reads as its latest value; bars are amounts per period and read as their total
      const head = `<div class="ch"><div><h4>${esc(b.title)}</h4><span class="tot">${short(b.kind === "line" ? last.value : total)}${prev ? `<span class="delta ${change < 0 ? "dn" : "up"}">${icon("chevd", change < 0 ? "" : "flip")}${Math.abs(change).toFixed(1)}%</span>` : ""}</span></div>${b.ranges?.length ? segs(b.ranges, "Period") : stacked ? legendOf(b.series!) : `<span class="legend"><i></i>${esc(b.kind === "line" ? "Trend" : `Peak: ${pts[peak]?.label ?? ""}`)}</span>`}</div>${stacked && b.ranges?.length ? `<div class="lgrow">${legendOf(b.series!)}</div>` : ""}`;
      if (b.kind === "line") return `<div class="card chart">${head}${lineSvg(b.title, pts, top, 680, 210, "lc-w")}${lineSvg(b.title, pts, top, 340, 200, "lc-n")}</div>`;
      const grid = [1, 0.5, 0].map((f) => `<span class="g${f === 0 ? " base" : ""}" style="bottom:${f * 100}%"><em>${short(top * f)}</em></span>`).join("");
      const fill = (p: (typeof pts)[number]) => (stacked ? `<i>${(p.parts ?? []).slice(0, b.series!.length).map((x, j) => `<s style="flex:${Math.max(0, num(x))};background:${swatch(j)}" title="${esc(`${b.series![j]}: ${short(num(x))}`)}"></s>`).join("")}</i>` : "<i></i>");
      return `<div class="card chart">${head}<div class="bars${stacked ? " stk" : ""}">${grid}${pts.map((p, i) => `<div class="bar${i === peak ? " pk" : ""}" style="--h:${Math.round((p.value / top) * 100)}%;--d:${i}"><span class="n">${short(p.value)}</span>${fill(p)}<span class="l">${esc(p.label)}</span></div>`).join("")}</div></div>`;
    }
    case "steps":
      return `<ol class="steps">${b.items.map((t, i) => `<li class="${i < b.current ? "done" : i === b.current ? "now" : ""}"><span>${i < b.current ? icon("check") : i + 1}</span>${esc(t)}</li>`).join("")}</ol>`;
    case "timeline":
      return `<div class="card tl">${b.items.map((it) => `<div class="ev ${it.status}"><span class="t">${esc(it.time)}</span><i>${it.status === "done" ? icon("check") : ""}</i><div><b>${esc(it.title)}</b>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}</div></div>`).join("")}</div>`;
    case "detail": {
      const seed = b.rows.map((r) => r.value).join("|");
      return `<div class="card detail ${b.style}">${b.title || b.lead ? `<div class="dh">${b.title ? `<b>${esc(b.title)}</b>` : ""}${b.lead ? `<div><span class="k">${esc(b.lead.label)}</span><strong>${esc(b.lead.value)}</strong></div>` : ""}</div>` : ""}<dl>${b.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("")}</dl>${b.style === "pass" ? `<div class="tear" aria-hidden="true"></div>${barcode(seed)}` : ""}</div>`;
    }
    case "cards": {
      const n = b.items.length, cols = n % 4 === 0 ? 4 : n % 3 === 0 || n > 4 ? 3 : n;
      // the price or headline figure in a card's line reads first, as it does on a real listing
      const meta = (m: string) => m.split(/\s+·\s+/).map((part) => (/(?:[$€£¥₹₨]|PKR|USD|AED|SAR|Rs\.?)\s?\d|\d\s?(?:\/night|per night|\/mo)/i.test(part) ? `<b class="price">${esc(part)}</b>` : esc(part))).join('<span class="sep">·</span>');
      return `<div class="cards${b.visual ? " vis" : ""}" style="--cols:${cols}">${b.items.map((it, i) => {
        const badge = it.badge ? `<span class="badge ${tone(it.badge)}">${esc(it.badge)}</span>` : "";
        if (!b.visual) { const ic = iconFor(`${it.title} ${it.meta}`) || iconFor(page) || "layers"; return `<div class="card item"><div class="row sp"><span class="chipi">${icon(ic)}</span>${badge}</div><b>${esc(it.title)}</b><span class="meta">${meta(it.meta)}</span></div>`; }
        return `<div class="card item">${scene(`${it.title} ${it.meta} ${it.badge ?? ""}`, page, uid(), i, look.imagery)}${it.badge ? `<span class="ontop">${badge}</span>` : ""}<button type="button" class="fav" aria-label="Save">${icon("heart")}</button><div class="ib-body"><div class="row sp"><b>${esc(it.title)}</b>${icon("arrowr", "go")}</div><span class="meta">${meta(it.meta)}</span></div></div>`;
      }).join("")}</div>`;
    }
    case "carousel": {
      const nav = `<span class="car-nav"><button type="button" class="ib" data-car="-1" aria-label="Previous slide">${icon("chevl")}</button><button type="button" class="ib" data-car="1" aria-label="Next slide">${icon("chevr")}</button></span>`;
      const slides = b.items.map((it, i) => {
        const badge = it.badge ? `<span class="badge ${b.style === "promo" ? "on" : tone(it.badge)}">${esc(it.badge)}</span>` : "";
        const pic = scene(`${it.title} ${it.meta} ${it.badge ?? ""}`, page, uid(), i, look.imagery);
        if (b.style === "promo") return `<div class="slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${b.items.length}">${pic}<div class="sc">${badge}<b>${esc(it.title)}</b><span>${esc(it.meta)}</span>${it.cta ? `<button type="button" class="btn" data-act="act">${btnLabel(it.cta)}</button>` : ""}</div></div>`;
        return `<div class="slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${b.items.length}">${pic}${it.badge ? `<span class="ontop">${badge}</span>` : ""}<div class="ib-body"><b>${esc(it.title)}</b><span class="meta">${esc(it.meta)}</span>${it.cta ? `<button type="button" class="lnk" data-act="act">${esc(it.cta)}${icon("arrowr")}</button>` : ""}</div></div>`;
      }).join("");
      const dots = `<div class="dots" aria-hidden="true">${b.items.map((_, i) => `<i${i === 0 ? ' class="on"' : ""}></i>`).join("")}</div>`;
      return `<div class="car k-${b.style}" role="region" aria-roledescription="carousel"${b.title ? ` aria-label="${esc(b.title)}"` : ""}><div class="car-h">${b.title ? `<h4>${esc(b.title)}</h4>` : "<span></span>"}${nav}</div><div class="track" tabindex="0">${slides}</div>${dots}</div>`;
    }
    case "accordion":
      return `<div class="card acc">${b.title ? `<h4>${esc(b.title)}</h4>` : ""}${b.items.map((it, i) => `<details${i === 0 ? " open" : ""}><summary><span>${esc(it.title)}</span>${icon("chevd")}</summary><p>${esc(it.body)}</p></details>`).join("")}</div>`;
    case "list":
      return `<div class="card list">${b.items.map((it) => {
        const m = MONEY.exec(it.meta), rest = m ? it.meta.slice(0, m.index).replace(/\s*·\s*$/, "") : it.meta;
        const amt = m ? m[1]!.trim() : "";
        const lead = PERSON.test(it.title) ? avatar(it.title) : `<span class="chipi">${icon(iconFor(`${it.title} ${it.meta}`) || iconFor(page) || "layers")}</span>`;
        return `<div class="li">${lead}<div class="lt"><b>${esc(it.title)}</b><span class="meta">${esc(rest)}</span></div>${amt ? `<span class="amt ${/^[+]/.test(amt) ? "in" : /^[-−]/.test(amt) ? "out" : ""}">${esc(amt)}</span>` : icon("chevr", "chev")}</div>`;
      }).join("")}</div>`;
    case "actions":
      return `<div class="row">${b.buttons.map((t, i) => `<button type="button" class="btn${i === 0 ? " primary" : ""}" data-act="act">${btnLabel(t)}</button>`).join("")}</div>`;
    default:
      return `<p class="lead">${esc(b.body)}</p>`;
  }
}

const DANGER = /\b(delete|remove|cancel|freeze|block|revoke|deactivate|close account|discard|reject|refund|sign out|log out)\b/i;
/** A layer over the page, open or ready to open from the button it names. */
function renderOverlay(o: MockOverlay, open: boolean, page: string): string {
  const form = o.blocks.find((b) => b.type === "form");
  const acts = o.kind === "menu" ? [] : o.actions.length ? o.actions : form?.type === "form" ? [form.submit] : ["Done"];
  const primary = acts[0], second = acts[1] ?? (o.kind === "confirm" || form ? "Cancel" : "");
  const danger = !!primary && DANGER.test(primary);
  const foot = primary ? `<div class="ova">${second ? `<button type="button" class="btn">${esc(second)}</button>` : ""}<button type="button" class="btn primary${danger ? " danger" : ""}">${btnLabel(primary)}</button></div>` : "";
  const head = o.kind === "confirm"
    ? `<span class="ci${danger ? " bad" : ""}">${icon(danger ? "alert" : "checkc")}</span><h4>${esc(o.title)}</h4>`
    : `<div class="ovh"><h4>${esc(o.title)}</h4><button type="button" class="ib" data-close aria-label="Close">${icon("close")}</button></div>`;
  const body = o.kind === "menu"
    ? `<div class="mlist">${(o.items ?? []).map((it) => { const v = verbIcon(it); return `<button type="button" role="menuitem" class="mitem${DANGER.test(it) ? " bad" : ""}">${v ? icon(v) : ""}<span>${esc(it)}</span></button>`; }).join("")}</div>`
    : `${head}${o.text ? `<p>${esc(o.text)}</p>` : ""}${o.blocks.map((b) => renderBlock(b, "normal", page)).join("")}${foot}`;
  const role = o.kind === "menu" ? "menu" : o.kind === "confirm" ? "alertdialog" : "dialog";
  return `<div class="ovl k-${o.kind}${open ? " open" : ""}"${open ? " data-open" : ""} data-trigger="${esc(o.trigger)}" role="${role}" aria-label="${esc(o.title)}"><span class="ovs"></span><div class="ovp">${o.kind === "sheet" ? '<i class="grab"></i>' : ""}${body}</div></div>`;
}

const banner = (kind: "bad" | "ok" | "warn", text: string, retry = false): string =>
  `<div class="banner ${kind}" role="${kind === "bad" ? "alert" : "status"}"><span class="bi">${icon(kind === "ok" ? "checkc" : "alert")}</span><span>${esc(text)}</span>${retry ? `<button type="button" class="btn" data-act="retry">${icon("refresh")}<span>Try again</span></button>` : ""}</div>`;

const SIDE = new Set(["list", "timeline", "detail"]);
/** Two neighbouring blocks that read better side by side on a wide screen, and how to share the width. */
function pairOf(a: MockBlock, b: MockBlock): string {
  if (a.type === "chart" && SIDE.has(b.type)) return "wl";
  if (SIDE.has(a.type) && b.type === "chart") return "wr";
  if (a.type === "form" && (b.type === "detail" || b.type === "list")) return "wl";
  if ((a.type === "detail" || a.type === "list") && b.type === "form") return "wr";
  if ((SIDE.has(a.type) && SIDE.has(b.type)) || (a.type === "chart" && b.type === "chart")) return "eq";
  return "";
}

/**
 * The page laid out from its blocks, the way a product designer would arrange them rather than one stacked column: the page's
 * buttons sit in its header (unless it is a form, whose button ends the form), search and filters become the table's toolbar,
 * and a chart beside its list, a form beside its summary, share a row on a wide screen.
 */
export function compose(blocks: MockBlock[], draw: (b: MockBlock) => string): { actions: string; body: string } {
  const list = [...blocks];
  let actions = "";
  const at = list.some((b) => b.type === "form") ? -1 : list.findIndex((b) => b.type === "actions");
  if (at >= 0) { actions = draw(list[at]!); list.splice(at, 1); }
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!, nx = list[i + 1];
    if (b.type === "filters" && nx?.type === "table") { out.push(draw(nx).replace('<div class="card tbl">', `<div class="card tbl"><div class="toolbar">${draw(b)}</div>`)); i++; continue; }
    const pair = nx ? pairOf(b, nx) : "";
    if (pair) { out.push(`<div class="split ${pair}">${draw(b)}${draw(nx!)}</div>`); i++; continue; }
    out.push(draw(b));
  }
  return { actions, body: out.join("") };
}

/** The words a page is about (title, subtitle, filter chips), which decide what the pictures on its cards show. */
const pageWords = (m: ScreenMock): string => [m.title, m.subtitle ?? "", ...m.blocks.flatMap((b) => (b.type === "filters" ? [b.search ?? "", ...b.chips] : []))].join(" ");

/** A toast as the product shows it after an action: what happened, and Undo for a step that can be taken back. `shown` pins it in view for its tab. */
const renderToast = (t: MockToast, shown: boolean): string =>
  `<div class="toast ${t.tone}${shown ? " pin" : ""}" role="status"><svg viewBox="0 0 24 24" aria-hidden="true">${t.tone === "bad" ? '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16v.01"/>' : t.tone === "info" ? '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>' : '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>'}</svg><span>${esc(t.text)}</span>${t.undo ? '<button type="button" class="lnk">Undo</button>' : ""}</div>`;

/** One state of one screen drawn from its sample content; `open` is the overlay drawn open over it, `toast` the toast shown on it. */
function renderMock(m: ScreenMock, k: StateKind, state: string, open = -1, toast = -1): string {
  const c = m.copy;
  const words = pageWords(m);
  const keep = (b: MockBlock) => b.type === "filters" || b.type === "actions" || b.type === "stats" || b.type === "text";
  const normal = compose(m.blocks, (b) => renderBlock(b, k, words));
  // a trail of the pages above this one (a narrow screen shows only a back link to the nearest), and the page's own tabs under its title
  const crumbs = m.crumbs?.length ? `<nav class="crumbs" aria-label="Breadcrumb"><span class="back">${icon("chevl")}${esc(m.crumbs[m.crumbs.length - 1]!)}</span>${m.crumbs.map((c) => `<span class="c">${esc(c)}</span>${icon("chevr")}`).join("")}<span aria-current="page">${esc(m.title)}</span></nav>` : "";
  const tabs = m.tabs?.length ? `<div class="ptabs" role="tablist">${m.tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}"${i === 0 ? ' class="on"' : ""}>${esc(t)}</button>`).join("")}</div>` : "";
  const head = (actions: string) => `<div class="ph"><div>${crumbs}<h3>${esc(m.title)}</h3>${m.subtitle ? `<p class="sub">${esc(m.subtitle)}</p>` : ""}</div>${actions ? `<div class="pa">${actions}</div>` : ""}${tabs}</div>`;
  let body: string;
  // loading keeps everything static (title, labels, headers, filters, buttons) and turns only the data into shimmering shapes, under a progress bar;
  // empty previews what the page fills with; error keeps the last good data dimmed behind the message; "Full data" is a state of its own
  if (k === "loading") body = `<div class="prog" role="progressbar" aria-label="Loading"><i></i></div>${compose(m.blocks, skeleton).body}`;
  else if (k === "empty") {
    const lead = m.blocks.filter((b) => b.type === "filters").map((b) => renderBlock(b, k, words)).join("");
    const sample = m.blocks.find((b) => !keep(b));
    const ic = iconFor(words) || "inbox";
    body = `${lead}<div class="card empty"><span class="halo">${icon(ic)}</span><h4>${esc(c.emptyTitle ?? "Nothing here yet")}</h4><p>${esc(c.emptyHint ?? "When there is something to show, it appears here.")}</p></div>${sample ? `<div class="preview"><span class="pv">What this fills with</span>${renderBlock(sample, k, words)}</div>` : ""}`;
  } else if (k === "error") {
    body = `${banner("bad", c.error ?? "Something went wrong. Try again in a moment.", true)}<div class="stale">${normal.body}</div>`;
  } else {
    const hasForm = m.blocks.some((b) => b.type === "form");
    const lead = k === "success" ? banner("ok", c.success ?? "Done.") : k === "validation" && !hasForm ? banner("warn", c.validation ?? "Check the highlighted details and try again.") : k === "validation" && c.validation ? banner("warn", c.validation) : "";
    body = `${lead}${normal.body}`;
  }
  // the normal page carries its overlays, ready to open from their buttons; an overlay's own tab shows it open
  const layers = k === "normal" ? (m.overlays ?? []).map((o, i) => renderOverlay(o, i === open, words)).join("") + (m.toasts?.[toast] ? renderToast(m.toasts[toast]!, true) : "") : "";
  return `<div class="app${look.hero === "band" ? " hero" : ""}" data-kind="${k}" aria-label="${esc(state)}">${head(normal.actions)}<div class="body">${body}</div></div>${layers}`;
}

export const DEFAULT_THEME: DesignTheme = { mood: "clean product", mode: "light", brand: "#1a56db", neutral: "cool", chrome: "plain", font: "sans", heading: "match", mark: "glyph", radius: "soft", density: "comfortable", surface: "soft", motion: "lively", fx: "modern", shell: "auto", hero: "none", charts: "soft", imagery: "mixed" };

export const FONTS = {
  sans: '"Inter var",Inter,"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",Roboto,"Helvetica Neue",sans-serif',
  humanist: '"Avenir Next",Avenir,"Segoe UI Variable","Segoe UI","Gill Sans",Optima,Candara,ui-sans-serif,sans-serif',
  serif: '"Inter var",Inter,"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Nunito,"Varela Round",ui-sans-serif,system-ui,sans-serif',
  grotesk: '"Helvetica Neue",Helvetica,"Nimbus Sans","Liberation Sans",Arial,sans-serif',
  book: '"Iowan Old Style",Charter,"Bitstream Charter","Palatino Linotype","Book Antiqua",Georgia,serif',
};
// the heading type paired with the body, with the weight and tracking that face reads well at (system faces only: the page fetches nothing)
export const HEADS: Record<DesignTheme["heading"], [string, number, string]> = {
  match: ["inherit", 680, "-.025em"],
  serif: ['"Iowan Old Style",Charter,"Palatino Linotype","Book Antiqua",Georgia,serif', 640, "-.015em"],
  display: ['Didot,"Bodoni 72","Bodoni MT","Playfair Display","Libre Bodoni",Georgia,serif', 600, "-.01em"],
  geometric: ['Futura,"Futura PT","Century Gothic","Avenir Next",Avenir,"URW Gothic",sans-serif', 600, "-.01em"],
  condensed: ['"Avenir Next Condensed","DIN Condensed","Bahnschrift SemiCondensed","Roboto Condensed","Arial Narrow",sans-serif', 650, "0em"],
  slab: ['Rockwell,"Roboto Slab","Zilla Slab","Rockwell Nova",Georgia,serif', 650, "-.01em"],
  mono: ['ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace', 600, "-.03em"],
};

/** Every value the look draws with, from the chosen theme: the demo's variables and the build's design tokens both come from here. */
export function themeValues(theme?: DesignTheme) {
  const t = { ...DEFAULT_THEME, ...theme };
  const glass = t.surface === "glass";
  const colours = (dark: boolean): Record<string, string> => {
    const p = palette({ brand: t.brand, accent: t.accent, mode: dark ? "dark" : "light", neutral: t.neutral });
    return glass ? { ...p, sf: dark ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.72)" } : p;
  };
  const shadow = (dark: boolean): string => t.surface === "flat" ? "none"
    : dark ? "inset 0 1px 0 rgba(255,255,255,.045),0 1px 2px rgba(0,0,0,.4)"
    : "0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.04)";
  const lift = (dark: boolean): string => dark ? "inset 0 1px 0 rgba(255,255,255,.06),0 12px 28px -12px rgba(0,0,0,.7)" : "0 2px 4px rgba(16,24,40,.04),0 12px 28px -10px rgba(16,24,40,.14)";
  const head = t.heading === "match" && t.font === "serif" ? HEADS.serif : HEADS[t.heading] ?? HEADS.match;
  return {
    theme: t, colours, shadow, lift, blur: glass ? "blur(16px) saturate(1.2)" : "none",
    radius: { sharp: 4, soft: 10, round: 18 }[t.radius], pad: t.density === "compact" ? 12 : 18, row: t.density === "compact" ? 40 : 52,
    font: FONTS[t.font], head: { family: head[0], weight: head[1], tracking: head[2] },
    ease: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.34,1.4,.64,1)", rise: t.motion === "calm" ? 6 : 10,
  };
}

/** The page's colour variables from the chosen theme (a bad or absent theme gives the default). */
export function themeCss(theme?: DesignTheme): string {
  const v = themeValues(theme), t = v.theme;
  const set = (dark: boolean): string => `${Object.entries(v.colours(dark)).map(([k, c]) => `--${k}:${c}`).join(";")};--shadow:${v.shadow(dark)};--lift:${v.lift(dark)};--blur:${v.blur}`;
  const shared = `--r:${v.radius}px;--pad:${v.pad}px;--row:${v.row}px;--font:${v.font};--head:${v.head.family};--hw:${v.head.weight};--hls:${v.head.tracking};--e:${v.ease};--spring:${v.spring};--rise:${v.rise}px;--drift:${t.motion === "calm" ? "paused" : "running"}`;
  return t.mode === "auto" ? `:root{${shared};${set(false)}}@media(prefers-color-scheme:dark){:root{${set(true)}}}` : `:root{${shared};${set(t.mode === "dark")}}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;color:var(--ink);background:var(--bg);overflow-x:hidden}
h1,h2,h3,h4{font-family:var(--head)}
button{font:inherit;color:inherit}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* the walkthrough around the product */
aside{width:260px;flex:none;padding:22px 16px;border-right:1px solid var(--edge);background:var(--sf2);}
aside h1{font-size:15px;margin:0 0 6px;letter-spacing:-.01em}
aside p{color:var(--mut);font-size:12.5px;margin:.2rem 0 1rem}aside h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:1.4rem 0 .5rem;font-family:var(--font)}
aside ul{list-style:none;padding:0;margin:0;display:grid;gap:2px}
aside a{display:block;padding:7px 10px;border-radius:8px;color:var(--ink2);text-decoration:none;transition:background .15s,color .15s}
aside a:hover{background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink)}
aside a.on{background:var(--sf);color:var(--ink);font-weight:600;box-shadow:0 0 0 1px var(--edge)}
aside code,.file{color:var(--mut);font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace}
aside li li{font-size:12px;color:var(--mut)}aside h3 .dv{font-weight:500;text-transform:none;letter-spacing:0;margin-left:4px;opacity:.8}
main{flex:1;min-width:0;padding:22px clamp(14px,3vw,36px) 60px}
.screen:not([hidden]){animation:enter .4s var(--e) both}
@keyframes enter{from{opacity:0;transform:translateY(6px)}}
.top{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin-bottom:6px}
.top h2{margin:0;font-size:15px;font-weight:650;color:var(--ink);font-family:var(--font);display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.top h2 code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut)}.top .sid{font-size:11px;color:var(--mut);font-weight:500}.top .tag{margin-left:auto}
.file{margin:0 0 12px}
.tag{border:1px solid var(--edge);background:var(--sf);border-radius:99px;padding:2px 10px;font-size:11.5px;color:var(--mut)}
.states{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;border:1px solid var(--edge);border-radius:10px;background:var(--sf2);margin:0 0 14px}
.states button{border:0;background:transparent;color:var(--mut);padding:5px 13px;border-radius:7px;cursor:pointer;text-transform:capitalize;transition:color .15s,background .15s,box-shadow .15s}
.states button:hover{color:var(--ink)}
.states button.on,.states button.on:hover{color:var(--ink);background:var(--sf);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--edge)}
/* the browser window the product sits in */
.canvas{border:1px solid var(--edge2);border-radius:12px;background:var(--bg);box-shadow:0 1px 2px rgba(0,0,0,.04),0 24px 48px -24px rgba(16,24,40,.28);overflow:clip;position:relative;container:app/inline-size}
.win{display:flex;align-items:center;gap:12px;height:38px;padding:0 14px;background:var(--sf2);border-bottom:1px solid var(--edge)}
.win .tl{display:flex;gap:7px}.win .tl i{width:11px;height:11px;border-radius:50%;background:var(--edge2)}.win .tl i:nth-child(1){background:#ff5f57}.win .tl i:nth-child(2){background:#febc2e}.win .tl i:nth-child(3){background:#28c840}
.win .url{flex:0 1 420px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:6px;height:24px;border-radius:7px;background:var(--bg);border:1px solid var(--edge);color:var(--mut);font-size:12px;white-space:nowrap;overflow:hidden}.win .url svg{width:12px;height:12px}
/* the product's own frame: a sidebar app for tools, a top bar for consumer products, a tab bar on a phone */
.shell{display:flex;min-height:560px}
.rail{width:232px;flex:none;display:flex;flex-direction:column;gap:18px;padding:16px 12px;border-right:1px solid var(--edge);background:var(--sf)}
.rail .rl,.rail .rf{display:grid;gap:2px}.rail .rf{margin-top:auto}
.rail a,.tnav a,.dp a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:var(--ink2);text-decoration:none;font-weight:500;font-size:13.5px;white-space:nowrap;position:relative;transition:background .15s,color .15s}
.rail a svg,.dp a svg{color:var(--mut);transition:color .15s}.rail a:hover,.dp a:hover{background:var(--sf2);color:var(--ink)}
.rail a.on,.dp a.on{background:color-mix(in srgb,var(--a1) 9%,transparent);color:var(--a1);font-weight:600}.rail a.on svg,.dp a.on svg{color:var(--a1)}
.rail h5,.dp h5{margin:0 10px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}.rail h5:not(:first-of-type),.dp h5:not(:first-of-type){margin-top:14px}
.rail.brand{background:var(--br);border-color:transparent;color:var(--on)}.rail.brand a,.rail.brand a svg,.rail.brand h5{color:color-mix(in srgb,var(--on) 72%,transparent)}.rail.brand a:hover{background:color-mix(in srgb,var(--on) 10%,transparent);color:var(--on)}.rail.brand a.on{background:color-mix(in srgb,var(--on) 16%,transparent);color:var(--on)}.rail.brand a.on svg{color:var(--on)}.rail.brand .bm>b{color:var(--on)}
.stage{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:10px;height:58px;padding:0 clamp(14px,2.4vw,28px);border-bottom:1px solid var(--edge);background:var(--sf);position:relative;z-index:1}
.topbar .sp{flex:1}
.topbar.brand{background:var(--br);color:var(--on);border-color:transparent}.topbar.brand .tnav a{color:color-mix(in srgb,var(--on) 75%,transparent)}.topbar.brand .tnav a:hover,.topbar.brand .tnav a.on{color:var(--on)}.topbar.brand .tnav a.on:after{background:var(--on)}.topbar.brand .ib{color:var(--on)}.topbar.brand .ib:hover{background:color-mix(in srgb,var(--on) 12%,transparent)}.topbar.brand .bm>b{color:var(--on)}
.tnav{display:flex;gap:2px;margin-left:18px;align-self:stretch}.tnav a{border-radius:0;padding:0 12px}.tnav a:hover{color:var(--ink)}.tnav a.on{color:var(--ink);font-weight:600}
.tnav a.on:after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:2px;background:var(--br);animation:grow-x .35s var(--e) both}@keyframes grow-x{from{transform:scaleX(.3);opacity:0}}
.bm{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:-.015em;white-space:nowrap}.bm>b{color:var(--ink)}
.logo{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--br);color:var(--on);box-shadow:inset 0 -2px 0 rgba(0,0,0,.12)}.logo svg{width:17px;height:17px;stroke-width:2.2}
.rail.brand .logo,.topbar.brand .logo{background:var(--on);color:var(--br)}
.q{display:flex;align-items:center;gap:8px;height:36px;width:min(340px,40%);padding:0 10px;border-radius:9px;background:var(--sf2);border:1px solid var(--edge);color:var(--mut);font-size:13px}.q svg{width:16px;height:16px}.q span{flex:1}
kbd{font:500 11px var(--font);border:1px solid var(--edge2);border-bottom-width:2px;border-radius:5px;padding:0 5px;color:var(--mut);background:var(--sf)}
.ib{width:34px;height:34px;display:inline-grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--ink2);cursor:pointer;position:relative;transition:background .15s,color .15s}.ib:hover:not(:disabled){background:var(--sf2);color:var(--ink)}.ib:disabled{opacity:.4;cursor:default}
.ib .dot{position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:var(--bad);box-shadow:0 0 0 2px var(--sf)}
.me{width:32px;height:32px;border-radius:50%;overflow:hidden;flex:none;background:#E8DCCB;box-shadow:0 0 0 2px var(--sf),0 0 0 3px var(--edge)}.me svg{width:100%;height:100%;stroke:none}
.tabbar{display:none;justify-content:space-around;z-index:3;padding:6px 6px 10px;border-top:1px solid var(--edge);background:color-mix(in srgb,var(--sf) 92%,transparent);backdrop-filter:blur(12px)}
.tabbar a{display:grid;justify-items:center;gap:2px;font-size:10.5px;font-weight:500;color:var(--mut);text-decoration:none;padding:4px 6px;max-width:25%;text-align:center}.tabbar a span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:78px}.tabbar a svg{width:22px;height:22px}.tabbar a.on{color:var(--a1)}.topbar .nb{display:none}
/* a phone app: the device around it, its status bar and home indicator */
.canvas.phone{width:min(100%,400px);margin:0 auto;border:10px solid #0b0d10;border-radius:52px;box-shadow:0 0 0 1px #2a2e35,0 30px 60px -28px rgba(16,24,40,.45)}
.canvas.phone .win{display:none}.canvas.phone .stage{min-height:760px}.canvas.phone .topbar{height:52px}.canvas.phone .tabbar{padding-bottom:24px}
.sbar{display:none}
.canvas.phone .sbar{display:flex;align-items:center;justify-content:space-between;height:46px;padding:4px 26px 0 34px;font:600 15px/1 var(--font);letter-spacing:-.01em;color:var(--ink);background:var(--sf);position:relative}
.canvas.phone .sbar.brand{background:var(--br);color:var(--on)}.sbar .island{position:absolute;left:50%;top:11px;width:100px;height:28px;border-radius:20px;background:#0b0d10;transform:translateX(-50%)}
.sbar .sys{display:flex;gap:5px;align-items:center}.sbar .sys svg{width:auto;height:11px;fill:currentColor;stroke:none}
.canvas.phone:after{content:"";position:absolute;bottom:8px;left:50%;width:128px;height:5px;border-radius:3px;background:var(--ink);opacity:.8;transform:translateX(-50%);z-index:7}
/* a menu button opening a drawer */
.drawer{position:absolute;inset:0;z-index:6;visibility:hidden;transition:visibility 0s .3s}
.drawer .scrim{position:absolute;inset:0;background:rgba(10,14,20,.4);opacity:0;transition:opacity .3s}
.dp{position:absolute;top:0;bottom:0;left:0;width:min(300px,84%);display:flex;flex-direction:column;gap:18px;padding:18px 12px;background:var(--sf);border-right:1px solid var(--edge);box-shadow:0 20px 50px -20px rgba(0,0,0,.4);transform:translateX(-102%);transition:transform .32s var(--e)}
.dp .row{justify-content:space-between}.dp nav,.dp .rf{display:grid;gap:2px}.dp .rf{margin-top:auto}
.canvas.dopen .drawer{visibility:visible;transition:none}.canvas.dopen .scrim{opacity:1}.canvas.dopen .dp{transform:none}
.canvas .drawer{top:39px}.canvas.phone .drawer{top:46px}
.go{cursor:pointer}tr.go:hover td{background:color-mix(in srgb,var(--br) 5%,var(--sf))}.li.go:hover,.slide.go:hover b,.card.item.go:hover b{color:var(--br)}
/* slides: offers and announcements on the brand colour, or a row of pictures */
.car{display:grid;gap:12px;min-width:0}.car-h{display:flex;justify-content:space-between;align-items:center;gap:12px}.car-h h4{margin:0;font-size:16px;font-weight:650;letter-spacing:-.01em}.car-nav{display:flex;gap:6px}.car-nav .ib{border:1px solid var(--edge);background:var(--sf)}
.track{display:grid;grid-auto-flow:column;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;overscroll-behavior-x:contain;padding:2px;margin:-2px}.track::-webkit-scrollbar{display:none}.track:focus-visible{outline:2px solid var(--br);outline-offset:4px;border-radius:var(--r)}
.slide{scroll-snap-align:start;position:relative;min-width:0}
.k-media .track{grid-auto-columns:minmax(220px,calc((100% - 32px) / 3))}@container app (max-width:640px){.k-media .track{grid-auto-columns:72%}}
.k-media .slide .ib-body{display:grid;gap:3px;padding:10px 2px 0}.k-media .slide b{font-size:14.5px}.k-media .ontop{position:absolute;top:10px;left:10px}
.lnk{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:4px 0 0;color:var(--br);font-weight:600;font-size:13px;cursor:pointer}.lnk svg{width:14px;height:14px;transition:transform .2s var(--e)}.lnk:hover svg{transform:translateX(3px)}
.k-promo .track{grid-auto-columns:88%}@container app (max-width:640px){.k-promo .track{grid-auto-columns:90%}}
.k-promo .slide{min-height:190px;border-radius:calc(var(--r) + 8px);overflow:hidden;display:flex;align-items:flex-end;background:linear-gradient(135deg,var(--br),color-mix(in srgb,var(--br) 55%,#000));color:var(--on);isolation:isolate}
.k-promo .slide .pic{position:absolute;inset:0 0 0 38%;aspect-ratio:auto;border-radius:0;z-index:-1;-webkit-mask-image:linear-gradient(90deg,transparent,#000 45%);mask-image:linear-gradient(90deg,transparent,#000 45%)}.k-promo .slide .pic:after{display:none}
.k-promo .sc{display:grid;gap:6px;justify-items:start;padding:22px;max-width:min(380px,70%)}.k-promo .sc b{font-size:21px;line-height:1.15;letter-spacing:-.02em;font-family:var(--head)}.k-promo .sc>span:not(.badge){color:color-mix(in srgb,var(--on) 82%,transparent);font-size:13.5px}
.k-promo .sc .btn{margin-top:8px;background:var(--on);color:var(--br);border-color:transparent}.k-promo .badge.on{background:color-mix(in srgb,var(--on) 18%,transparent);color:var(--on);border:0}
@container app (max-width:640px){.k-promo .slide .pic{inset:0 0 auto 0;height:130px;-webkit-mask-image:linear-gradient(0deg,transparent,#000 55%);mask-image:linear-gradient(0deg,transparent,#000 55%)}.k-promo .sc{max-width:none;padding:18px}.k-promo .slide{min-height:280px}}
.sk-car.k-promo .slide{background:none;min-height:0}.sk-car.k-promo .slide .sk{display:block;width:100%;height:190px;margin:0;border-radius:calc(var(--r) + 8px);background-image:linear-gradient(100deg,color-mix(in srgb,var(--br) 9%,var(--sf2)) 30%,color-mix(in srgb,var(--br) 17%,var(--sf2)) 50%,color-mix(in srgb,var(--br) 9%,var(--sf2)) 70%)}
.dots{display:flex;justify-content:center;gap:6px}.dots i{width:6px;height:6px;border-radius:3px;background:var(--edge);transition:width .3s var(--e),background .3s}.dots i.on{width:18px;background:var(--br)}
/* layers over the page: dialog, side panel, sheet, confirmation, menu */
.ovl{position:absolute;left:0;right:0;bottom:0;top:39px;z-index:5;display:none}.canvas.phone .ovl{top:46px}.ovl.open{display:block}
.ovs{position:absolute;inset:0;background:rgba(10,14,20,.42);backdrop-filter:blur(1.5px);animation:fadein .25s both}
.ovp{position:absolute;display:grid;gap:14px;padding:22px;background:var(--sf);color:var(--ink);border:1px solid var(--edge);box-shadow:0 28px 70px -24px rgba(0,0,0,.5);text-align:left}
.ovp>p{margin:0;color:var(--ink2)}.ovp .card{border:0;padding:0;box-shadow:none;background:none;backdrop-filter:none}.ovp .form .row.end{display:none}.ovp .list .li:first-child{padding-top:0}
.ovh{display:flex;justify-content:space-between;align-items:center;gap:12px}.ovh h4,.k-confirm h4{margin:0;font-size:18px;letter-spacing:-.015em;font-weight:650}.ovh .ib{margin:-6px -8px -6px 0}
.ova{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding-top:4px}
.k-modal .ovp,.k-confirm .ovp{left:50%;top:clamp(24px,10%,110px);width:min(540px,calc(100% - 32px));border-radius:calc(var(--r) + 6px);transform:translateX(-50%);animation:ovpop .32s var(--spring) both}
.k-confirm .ovp{width:min(400px,calc(100% - 32px));justify-items:center;text-align:center}.k-confirm .ova{width:100%}.k-confirm .ova .btn{flex:1}
.ci{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sf))}.ci.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 11%,var(--sf))}.ci svg{width:24px;height:24px}
@keyframes ovpop{from{opacity:0;transform:translateX(-50%) translateY(10px) scale(.97)}}
.k-drawer .ovp{top:0;right:0;bottom:0;width:min(440px,92%);align-content:start;border-width:0 0 0 1px;animation:from-r .34s var(--e) both}.k-drawer .ova{margin-top:8px}@keyframes from-r{from{transform:translateX(100%)}}
.k-sheet .ovp{left:50%;bottom:0;width:min(640px,100%);padding-top:10px;border-radius:24px 24px 0 0;border-bottom:0;transform:translateX(-50%);animation:from-b .34s var(--e) both}@keyframes from-b{from{transform:translate(-50%,100%)}}
.canvas.phone .k-sheet .ovp{padding-bottom:34px}.grab{width:40px;height:5px;border-radius:3px;background:var(--edge);justify-self:center;margin-bottom:2px}
.k-menu .ovs{background:transparent;backdrop-filter:none}.k-menu .ovp{top:70px;right:24px;width:230px;padding:6px;gap:0;border-radius:calc(var(--r) + 2px);transform-origin:top right;animation:menu .18s var(--e) both}@keyframes menu{from{opacity:0;transform:scale(.96) translateY(-4px)}}
.mlist{display:grid}.mitem{display:flex;align-items:center;gap:10px;border:0;background:none;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13.5px;font-weight:500;color:var(--ink2);text-align:left}.mitem:hover{background:var(--sf2);color:var(--ink)}.mitem svg{width:16px;height:16px;color:var(--mut)}.mitem.bad,.mitem.bad svg{color:var(--bad)}.mitem.bad{border-top:1px solid var(--edge);border-radius:0 0 8px 8px;margin-top:4px}
.btn.primary.danger{background:var(--bad);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 0 0 1px color-mix(in srgb,var(--bad) 80%,#000)}
/* where the page sits, and its own tabs */
.crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:0 0 8px;font-size:13px;color:var(--mut)}.crumbs svg{width:14px;height:14px;opacity:.55}.crumbs .c{color:var(--ink2)}.crumbs [aria-current]{color:var(--ink);font-weight:550}
.crumbs .back{display:none;align-items:center;gap:2px;color:var(--a1);font-weight:600;margin-left:-4px}.crumbs .back svg{opacity:1;width:18px;height:18px}
.ptabs{flex-basis:100%;display:flex;gap:2px;margin-top:4px;border-bottom:1px solid var(--edge);overflow-x:auto;scrollbar-width:none}
.ptabs button{border:0;background:none;padding:10px 12px;color:var(--mut);font-weight:550;font-size:13.5px;cursor:pointer;position:relative;white-space:nowrap;transition:color .15s}.ptabs button:hover{color:var(--ink)}.ptabs button.on{color:var(--ink)}
.ptabs button.on:after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--br);animation:grow-x .35s var(--e) both}
.hero .crumbs,.hero .crumbs .c,.hero .crumbs [aria-current],.hero .crumbs .back{color:color-mix(in srgb,var(--on) 82%,transparent)}.hero .ptabs{border-color:color-mix(in srgb,var(--on) 22%,transparent)}.hero .ptabs button{color:color-mix(in srgb,var(--on) 70%,transparent)}.hero .ptabs button.on{color:var(--on)}.hero .ptabs button.on:after{background:var(--on)}
.pane{--px:clamp(14px,2.4vw,32px);padding:26px var(--px) 32px;flex:1}.pane[hidden]{display:none}.pane:not([hidden]){animation:fadein .3s ease backwards}@keyframes fadein{from{opacity:0}}
.canvas img{max-width:100%;display:block;margin:18px auto}.wire{background:#fff;border-radius:var(--r);padding:10px;margin:14px}.wire svg{display:block;width:auto;height:auto;max-width:640px;margin:0 auto;stroke-width:inherit}
/* the page */
.ph{display:flex;justify-content:space-between;align-items:flex-end;gap:12px 20px;flex-wrap:wrap}.ph h3{margin:0;font-size:clamp(21px,2.3vw,26px);letter-spacing:var(--hls);font-weight:var(--hw);line-height:1.2}.pa .row{gap:8px}
.sub{margin:.3rem 0 0;color:var(--mut);font-size:14px}.body{display:grid;gap:16px;margin-top:22px}
.body>*{animation:rise .5s var(--e) both}${[2, 3, 4, 5, 6].map((i) => `.body>:nth-child(${i}){animation-delay:${(i - 1) * 0.06}s}`).join("")}
@keyframes rise{from{opacity:0;transform:translateY(var(--rise))}}
.split{display:grid;gap:16px;align-items:start}.split.wl{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)}.split.wr{grid-template-columns:minmax(0,1fr) minmax(0,1.7fr)}.split.eq{grid-template-columns:repeat(2,minmax(0,1fr))}
.card{border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);backdrop-filter:var(--blur);box-shadow:var(--shadow);padding:var(--pad);transition:border-color .2s,box-shadow .25s,transform .25s var(--e)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.row.sp{justify-content:space-between;flex-wrap:nowrap}.row.end{justify-content:flex-end}
.meta{color:var(--mut);font-size:13px;display:block}.meta .sep{margin:0 6px;opacity:.6}.meta .price{color:var(--ink);font-weight:650;white-space:nowrap}
/* figures */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.stat{border:1px solid var(--edge);border-radius:var(--r);padding:calc(var(--pad) - 2px) var(--pad);background:var(--sf);backdrop-filter:var(--blur);box-shadow:var(--shadow);display:grid;gap:4px;transition:border-color .2s,box-shadow .25s,transform .25s var(--e);overflow:hidden}
.sh{display:flex;justify-content:space-between;align-items:center;gap:8px}.stat .k{color:var(--ink2);font-size:13px;font-weight:500}
.stat .ic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:var(--sf2);color:var(--ink2);border:1px solid var(--edge)}.stat .ic svg{width:16px;height:16px}
.stat .v{font-size:clamp(24px,2.5vw,30px);letter-spacing:-.03em;font-variant-numeric:tabular-nums;font-weight:680;line-height:1.15}
.sf{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;min-height:22px}
.delta{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:600;padding:1px 7px 1px 4px;border-radius:99px;font-variant-numeric:tabular-nums}.delta svg{width:13px;height:13px;stroke-width:2.4}.delta .flip{transform:rotate(180deg)}
.delta.up{color:var(--ok);background:color-mix(in srgb,var(--ok) 11%,transparent)}.delta.dn{color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent)}
.spark{width:96px;height:28px}.spark.up{color:var(--ok)}.spark.dn{color:var(--bad)}.spark path:last-child{stroke-dasharray:200;stroke-dashoffset:200;animation:dash 1.1s var(--e) .25s forwards}@keyframes dash{to{stroke-dashoffset:0}}
.meter{display:block;height:6px;border-radius:6px;margin-top:6px;background:var(--sf2);box-shadow:inset 0 0 0 1px var(--edge);overflow:hidden}.meter i{display:block;height:100%;border-radius:6px;background:var(--a1);transform-origin:left;animation:meter 1s var(--e) .2s both}@keyframes meter{from{transform:scaleX(0)}}
/* search, filters, buttons */
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.search{display:flex;align-items:center;gap:8px;padding:0 12px;height:38px;border-radius:9px;border:1px solid var(--edge);background:var(--sf);color:var(--mut);min-width:240px;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:border-color .15s,box-shadow .15s}.search svg{width:16px;height:16px}
.search:focus-within{border-color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--a1) 14%,transparent)}
.search input{background:none;border:0;outline:0;color:var(--ink);font:inherit;flex:1;min-width:0}.search input::placeholder{color:var(--mut)}
.chips{display:flex;flex-wrap:wrap;gap:4px;padding:3px;border-radius:10px;background:var(--sf2);border:1px solid var(--edge)}
.chip{border:0;background:transparent;color:var(--ink2);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500;transition:background .15s,color .15s,box-shadow .15s}
.chip:hover{color:var(--ink)}.chip.on{color:var(--ink);background:var(--sf);box-shadow:0 1px 2px rgba(16,24,40,.08),0 0 0 1px var(--edge);font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;height:38px;border:1px solid var(--edge2);background:var(--sf);color:var(--ink);padding:0 15px;border-radius:9px;cursor:pointer;font-weight:600;font-size:13.5px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.05);transition:background .15s,border-color .15s,transform .12s,box-shadow .15s}.btn svg{width:16px;height:16px}
.btn:hover{background:var(--sf2)}.btn:active{transform:scale(.97)}.btn:focus-visible,.chip:focus-visible,.ib:focus-visible{outline:2px solid var(--a1);outline-offset:2px}
.btn.primary{border-color:transparent;color:var(--on);background:var(--br);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(16,24,40,.12),0 0 0 1px color-mix(in srgb,var(--br) 80%,#000)}.btn.primary:hover{background:color-mix(in srgb,var(--br) 90%,#000)}
.btn.primary svg:last-child:not(:first-child){transition:transform .2s var(--e)}.btn.primary:hover svg:last-child:not(:first-child){transform:translateX(3px)}
.btn.busy{pointer-events:none;opacity:.85}.btn.busy:after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);animation:sweep .9s linear infinite}
@keyframes sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
/* tables */
.tbl{padding:0;overflow:hidden}.tbl .scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:520px}
.toolbar{padding:12px 14px;border-bottom:1px solid var(--edge);display:flex}.toolbar .filters{width:100%;justify-content:space-between}.toolbar .search{min-width:min(280px,100%);height:36px;box-shadow:none}
th{text-align:left;font-size:12px;color:var(--mut);padding:10px 16px;font-weight:600;letter-spacing:.01em;border-bottom:1px solid var(--edge);background:var(--sf2);white-space:nowrap}
td{height:var(--row);padding:0 16px;border-bottom:1px solid var(--edge);font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink2)}tr:last-child td{border-bottom:0}
th.n,td.n{text-align:right}td.n{color:var(--ink);font-weight:500}td.first{font-weight:600;color:var(--ink)}th.act,td.act{width:44px;padding:0 8px;text-align:right}td.act .ib{opacity:0;transition:opacity .15s}tr:hover td.act .ib,tr.sel td.act .ib{opacity:1}.pane:has(.ovl.k-menu.open) tbody tr:first-child td.act .ib{opacity:1;background:var(--sf2)}
tbody tr{animation:rise .4s var(--e) both;transition:background .12s}tbody tr:hover{background:color-mix(in srgb,var(--ink) 2.5%,transparent)}tbody tr.sel{background:color-mix(in srgb,var(--a1) 6%,transparent);box-shadow:inset 3px 0 0 var(--a1)}
${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `tbody tr:nth-child(${i}){animation-delay:${0.08 + i * 0.035}s}`).join("")}
.code{font:600 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
.who{display:inline-flex;align-items:center;gap:10px}.av{width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;flex:none;color:var(--avf);background:var(--avb)}
.tfoot{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 8px 16px;font-size:12.5px;color:var(--mut);border-top:1px solid var(--edge)}.pager{display:flex;align-items:center;gap:4px}.pager b{min-width:28px;height:28px;display:grid;place-items:center;border-radius:7px;background:var(--sf2);color:var(--ink);font-size:12px;border:1px solid var(--edge)}.pager .ib{width:28px;height:28px}
.badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px 0 8px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 18%,transparent)}
.badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 9%,var(--sf))}.badge.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,var(--sf))}
.badge.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,var(--sf))}.badge.live{color:var(--info);background:color-mix(in srgb,var(--info) 9%,var(--sf))}.badge.live:before{animation:pulse 1.6s ease-in-out infinite}@keyframes pulse{50%{box-shadow:0 0 0 4px color-mix(in srgb,currentColor 20%,transparent)}}.badge.info{color:var(--ink2);background:var(--sf2)}
/* forms */
.form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 18px;align-items:start}.form .row,.form .wide{grid-column:1/-1}.form .row{padding-top:16px;margin-top:2px;border-top:1px solid var(--edge)}
.field{display:grid;gap:6px}.field label{font-size:13px;font-weight:600;color:var(--ink)}
.field input,.field select,.field textarea{width:100%;background:var(--sf);border:1px solid var(--edge2);color:var(--ink);border-radius:9px;height:40px;padding:0 12px;font:inherit;outline:0;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:border-color .15s,box-shadow .15s}
.field textarea{height:auto;padding:10px 12px;resize:vertical}.field input::placeholder,.field textarea::placeholder{color:var(--mut)}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--a1) 14%,transparent)}
.sel{position:relative;display:block}.sel select{appearance:none;-webkit-appearance:none;padding-right:34px}.sel svg{position:absolute;right:11px;top:11px;width:16px;height:16px;color:var(--mut);pointer-events:none}
.field.bad input,.field.bad select,.field.bad textarea{border-color:var(--bad);box-shadow:0 0 0 4px color-mix(in srgb,var(--bad) 12%,transparent);animation:shake .4s var(--e)}.err{display:flex;align-items:center;gap:5px;color:var(--bad);font-size:12.5px;font-weight:500}.err svg{width:14px;height:14px}
@keyframes shake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
.tog{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--edge);border-radius:9px;background:var(--sf2)}.tog input{appearance:none;width:40px;height:23px;padding:0;border-radius:99px;position:relative;cursor:pointer;background:var(--edge2);border:0;box-shadow:none;transition:background .25s}
.tog input:before{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .3s var(--spring)}.tog input:checked{background:var(--br)}.tog input:checked:before{transform:translateX(17px)}
/* charts */
.chart{padding-bottom:calc(var(--pad) - 6px)}
.ch{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.ch h4{margin:0 0 4px;font-size:13px;color:var(--ink2);font-weight:600;font-family:var(--font)}
.tot{display:flex;align-items:center;gap:10px;font-weight:680;font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:-.025em}
.legend{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mut)}.legend i{width:10px;height:10px;border-radius:3px;background:var(--a1)}
.chart>svg{width:100%;height:auto;stroke-width:inherit;overflow:visible}
.chart .gl{stroke:var(--edge);stroke-width:1}.chart .gl.base{stroke:var(--edge2)}.chart text{fill:var(--mut);font-size:11px;stroke:none;font-variant-numeric:tabular-nums}
.chart .ln{stroke:var(--a1);stroke-width:2.25;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.1s var(--e) .1s forwards}.chart .area{stroke:none;opacity:0;animation:fade .6s ease .5s forwards}
.hv .hit{fill:transparent;stroke:none}.hv .cx{stroke:var(--edge2);stroke-dasharray:3 3;opacity:0}.hv .hd{fill:var(--sf);stroke:var(--a1);stroke-width:2.25;opacity:0}.hv .tt{opacity:0;pointer-events:none}
.hv .tt rect{fill:var(--ink);stroke:none}.hv .tt .tl{fill:color-mix(in srgb,var(--bg) 70%,transparent);font-size:10.5px}.hv .tt .tv{fill:var(--bg);font-size:13px;font-weight:700}
.hv>*{transition:opacity .15s}.hv:hover .cx,.hv:hover .hd,.hv:hover .tt{opacity:1}
.chart>svg:not(:hover) .hv.last .hd{animation:fade .3s ease 1.1s forwards}.chart>svg:not(:hover) .hv.last .tt{animation:fade .3s ease 1.15s forwards}
@keyframes draw{to{stroke-dashoffset:0}}@keyframes fade{to{opacity:1}}
.bars{display:flex;align-items:flex-end;gap:clamp(8px,2.2vw,18px);height:200px;margin-top:6px;padding:12px 0 0 38px;position:relative}.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;position:relative;cursor:default}
.bars .g{position:absolute;left:38px;right:0;border-top:1px solid var(--edge);pointer-events:none}.bars .g.base{border-color:var(--edge2)}.bars .g em{position:absolute;top:-8px;left:-38px;width:30px;text-align:right;font:500 11px var(--font);color:var(--mut);font-style:normal}
.bar i{display:block;width:100%;max-width:40px;height:var(--h);border-radius:6px 6px 2px 2px;background:color-mix(in srgb,var(--a1) 24%,var(--sf));transform-origin:bottom;animation:grow .7s var(--e) both;animation-delay:calc(var(--d)*55ms + .1s);transition:background .2s;position:relative;z-index:1}
.bar:hover i{background:color-mix(in srgb,var(--a1) 60%,var(--sf))}.bar.pk i{background:var(--a1)}
@keyframes grow{from{transform:scaleY(0)}}
.bar .n{position:absolute;bottom:calc(var(--h) + 6px);font-size:11.5px;font-weight:700;color:var(--bg);background:var(--ink);padding:2px 7px;border-radius:6px;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;z-index:2;white-space:nowrap}.bar:hover .n,.bar.pk .n{opacity:1;transform:none}.bar.pk .n{transition-delay:.9s}
.bar .l{position:absolute;top:100%;margin-top:7px;font-size:11.5px;color:var(--mut)}.bars{margin-bottom:24px}
/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.item{display:grid;gap:6px;align-content:start}.item>b,.ib-body b{font-size:14.5px;font-weight:650;letter-spacing:-.01em}
.chipi{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--a1) 9%,var(--sf));color:var(--a1);flex:none}.chipi svg{width:18px;height:18px}
.cards.vis{grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));gap:18px}@container app (max-width:1000px){.cards.vis{grid-template-columns:repeat(2,minmax(0,1fr))}}@container app (max-width:560px){.cards.vis{grid-template-columns:1fr}}
.cards.vis .item{padding:0;overflow:hidden;position:relative;border:0;background:transparent;box-shadow:none;backdrop-filter:none;gap:0}
.pic{aspect-ratio:4/3;border-radius:calc(var(--r) + 2px);overflow:hidden;background:var(--sf2);position:relative;isolation:isolate}
.pic svg{width:100%;height:100%;display:block;stroke:none;transition:transform .7s var(--e)}.card.item:hover .pic svg{transform:scale(1.05)}
.pic:after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);pointer-events:none}
.pic.tile{display:grid;place-items:center;background:linear-gradient(135deg,color-mix(in srgb,var(--a1) 10%,var(--sf2)),var(--sf2))}.pic.tile span{width:64px;height:64px;border-radius:16px;display:grid;place-items:center;background:var(--sf);color:var(--a1);box-shadow:var(--lift)}.pic.tile svg{width:28px;height:28px;stroke:currentColor}
.pic-sk{display:block;aspect-ratio:4/3;margin:0 0 4px;border-radius:calc(var(--r) + 2px)}
.ib-body{padding:12px 2px 2px;display:grid;gap:3px}.ib-body .go{width:16px;height:16px;color:var(--a1);opacity:0;transform:translateX(-6px);transition:opacity .2s,transform .25s var(--e)}.card.item:hover .go{opacity:1;transform:none}
.ontop{position:absolute;top:12px;left:12px;z-index:2}.ontop .badge{background:rgba(255,255,255,.94);box-shadow:0 1px 3px rgba(0,0,0,.18);backdrop-filter:blur(6px)}
.fav{position:absolute;top:10px;right:10px;z-index:2;width:34px;height:34px;border-radius:50%;border:0;display:grid;place-items:center;background:rgba(255,255,255,.9);color:#1f2328;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.18);transition:transform .2s var(--spring),color .2s}.fav:hover{transform:scale(1.1)}.fav.on{color:#e11d48}.fav.on svg{fill:currentColor;animation:pop .35s var(--spring)}@keyframes pop{50%{transform:scale(1.35)}}
/* lists, steps, timeline, detail */
.list{padding:6px var(--pad)}.list .li{display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--edge)}.list .li:last-child{border:0}
.lt{flex:1;min-width:0}.lt b{display:block;font-weight:600;font-size:13.5px;line-height:1.35}.lt .meta{font-size:12.5px}
.amt{font-weight:650;font-variant-numeric:tabular-nums;font-size:13.5px;white-space:nowrap}.amt.in{color:var(--ok)}.li .chev{width:16px;height:16px;color:var(--mut)}
.steps{display:flex;gap:0;list-style:none;margin:0;padding:0;overflow:auto}.steps li{flex:1;display:flex;align-items:center;gap:10px;color:var(--mut);white-space:nowrap;min-width:max-content;padding-right:14px;font-weight:500}
.steps li span{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--edge2);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none;background:var(--sf);transition:all .3s}.steps li span svg{width:14px;height:14px;stroke-width:2.6}
.steps li:not(:last-child):after{content:"";flex:1;height:2px;min-width:18px;background:var(--edge);margin-left:6px;border-radius:2px}
.steps .done span{background:var(--br);border-color:var(--br);color:var(--on)}.steps .done:not(:last-child):after{background:var(--br)}.steps .done{color:var(--ink2)}.steps .now{color:var(--ink);font-weight:650}.steps .now span{border-color:var(--br);color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--br) 14%,transparent)}
.tl{display:grid;gap:0}.ev{display:grid;grid-template-columns:76px 22px 1fr;gap:12px;padding:10px 0;align-items:start;position:relative}.ev .t{color:var(--mut);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;padding-top:2px}
.ev i{width:22px;height:22px;border-radius:50%;border:2px solid var(--edge2);background:var(--sf);position:relative;z-index:1;display:grid;place-items:center}.ev i svg{width:12px;height:12px;stroke-width:3}.ev:not(:last-child) i:after{content:"";position:absolute;left:8px;top:22px;width:2px;height:calc(100% + 18px);background:var(--edge)}
.ev.done i{background:var(--br);border-color:var(--br);color:var(--on)}.ev.done:not(:last-child) i:after{background:var(--br)}.ev.now i{border-color:var(--br);box-shadow:0 0 0 5px color-mix(in srgb,var(--br) 16%,transparent);animation:ring 2s ease-out infinite}.ev.now i:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--br)}.ev.next{opacity:.6}.ev b{font-weight:600}
@keyframes ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--br) 35%,transparent)}70%,100%{box-shadow:0 0 0 9px transparent}}
.detail dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px 18px}.detail dt{font-size:12px;color:var(--mut);font-weight:500}.detail dd{margin:3px 0 0;font-weight:600}
.dh{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--edge)}.dh>b{font-size:15px}.dh .k{display:block;font-size:12px;color:var(--mut);text-align:right}.dh strong{font-size:24px;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.detail.pass{padding:0;overflow:hidden}.detail.pass .dh{padding:var(--pad);margin:0;background:var(--br);color:var(--on);border:0}.detail.pass .dh .k{color:color-mix(in srgb,var(--on) 75%,transparent)}.detail.pass dl{padding:var(--pad)}
.tear{position:relative;height:0;border-top:2px dashed var(--edge2);margin:0 14px}.tear:before,.tear:after{content:"";position:absolute;top:-11px;width:20px;height:20px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 1px var(--edge)}.tear:before{left:-25px}.tear:after{right:-25px}
.code128{display:block;width:calc(100% - var(--pad)*2);height:44px;margin:var(--pad);fill:var(--ink);stroke:none}
.lead{color:var(--ink2);margin:0;max-width:66ch;font-size:15px}
/* states */
.banner{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--r);border:1px solid color-mix(in srgb,currentColor 22%,transparent);animation:rise .4s var(--e) both}.banner>span:nth-child(2){flex:1;color:var(--ink);font-weight:500}
.bi{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,currentColor 14%,transparent);flex:none}
.banner.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 6%,var(--sf))}.banner.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 6%,var(--sf))}.banner.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 7%,var(--sf))}
.banner .btn{height:32px;padding:0 12px}
.stale{display:grid;gap:16px;opacity:.45;filter:grayscale(.4);pointer-events:none}
.empty{display:grid;justify-items:center;text-align:center;gap:6px;padding:52px 20px;border-style:dashed;box-shadow:none}
.halo{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;color:var(--a1);background:color-mix(in srgb,var(--a1) 8%,var(--sf));box-shadow:0 0 0 10px color-mix(in srgb,var(--a1) 4%,transparent),0 0 0 20px color-mix(in srgb,var(--a1) 2%,transparent);margin-bottom:12px}.halo svg{width:26px;height:26px}
.empty h4{margin:.4rem 0 0;font-size:16px;font-weight:650}.empty p{margin:0;color:var(--mut);max-width:42ch}
.sk{display:block;border-radius:6px;margin:8px 0;background:linear-gradient(100deg,var(--sf2) 30%,color-mix(in srgb,var(--ink) 8%,var(--sf2)) 50%,var(--sf2) 70%);background-size:220% 100%;animation:shim 1.3s linear infinite}
@keyframes shim{to{background-position:-220% 0}}
.prog{height:3px;border-radius:3px;background:color-mix(in srgb,var(--br) 14%,transparent);overflow:hidden;position:relative}.prog i{position:absolute;inset:0 auto 0 0;width:38%;background:var(--br);border-radius:3px;animation:slide 1.2s var(--e) infinite}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(280%)}}
.skbars{display:flex;align-items:flex-end;gap:clamp(6px,2vw,16px);height:170px;padding-top:18px}.skbars .sk{flex:1;margin:0;border-radius:6px 6px 2px 2px}
.tbl .sk{margin:2px 0}
.preview{position:relative;display:grid;gap:10px;opacity:.5;pointer-events:none}.pv{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}
.toast{position:fixed;right:20px;bottom:20px;z-index:9;display:flex;gap:10px;align-items:center;padding:11px 16px;border-radius:10px;background:var(--ink);color:var(--bg);font-weight:500;box-shadow:0 16px 40px -12px rgba(0,0,0,.45);animation:toast 3s var(--e) forwards}.toast svg{color:var(--ok)}
@keyframes toast{0%{opacity:0;transform:translateY(16px) scale(.96)}10%,85%{opacity:1;transform:none}100%{opacity:0;transform:translateY(8px)}}
.serves{margin-top:16px;border:1px solid var(--edge);border-radius:10px;background:var(--sf);padding:12px 16px}.serves summary{cursor:pointer;color:var(--mut);font-size:12.5px}
.serves ul{margin:.6rem 0 0;padding-left:18px;color:var(--mut);font-size:12.5px}.serves b{color:var(--ink)}
.nav{margin:14px 0 0;display:flex;flex-wrap:wrap;gap:8px}.nav a{color:var(--a1);text-decoration:none;font-size:12.5px;border-bottom:1px solid transparent}.nav a:hover{border-color:currentColor}
/* the frame the theme chose: a contained column for sites, a narrow one for a single task */
.wrap{width:100%;max-width:1160px;margin:0 auto}.canvas.sh-minimal .wrap{max-width:860px}
.topbar>.wrap{display:flex;align-items:center;gap:10px;align-self:stretch}
.help{display:inline-flex;align-items:center;gap:6px;color:var(--ink2);text-decoration:none;font-weight:500;font-size:13.5px;margin-right:6px}.help svg{width:16px;height:16px}.topbar.brand .help{color:var(--on)}
.sh-minimal .ph{text-align:left}.sh-minimal .shell,.sh-minimal .stage{min-height:520px}
/* the title on a brand band the first block overlaps */
.stage{overflow-x:clip}
.hero>.ph{position:relative;margin-top:-26px;padding:30px 0 66px;background:var(--br);color:var(--on);box-shadow:0 0 0 100vmax var(--br);clip-path:inset(0 -100vmax)}
.hero>.ph h3{color:var(--on)}.hero>.ph .sub{color:color-mix(in srgb,var(--on) 78%,transparent)}
.hero>.body{margin-top:-44px;position:relative}
.hero>.body>.banner{background:var(--sf)}
.hero .pa .btn{background:color-mix(in srgb,var(--on) 12%,transparent);color:var(--on);border-color:color-mix(in srgb,var(--on) 30%,transparent);box-shadow:none}.hero .pa .btn:hover{background:color-mix(in srgb,var(--on) 20%,transparent)}
.hero .pa .btn.primary{background:var(--on);color:var(--br);border-color:transparent}
.hero>.body>.steps{background:var(--sf);padding:14px var(--pad);border-radius:var(--r);border:1px solid var(--edge);box-shadow:var(--shadow)}
/* chart styles */
.ch-bold .bar i{background:color-mix(in srgb,var(--a1) 78%,var(--sf))}.ch-bold .bar.pk i{background:var(--a1)}.ch-bold .chart .ln{stroke-width:3}.ch-bold .s0{stop-opacity:.42}
.ch-mono .bar i{background:color-mix(in srgb,var(--ink) 13%,var(--sf))}.ch-mono .bar:hover i{background:color-mix(in srgb,var(--ink) 30%,var(--sf))}.ch-mono .bar.pk i{background:var(--a1)}
.ch-mono .chart .ln{stroke:var(--ink);stroke-width:1.75}.ch-mono .chart .area{display:none}.ch-mono .chart .gl:not(.base){stroke-dasharray:2 4}.ch-mono .bars .g:not(.base){border-top-style:dashed}.ch-mono .hv .hd{stroke:var(--ink)}.ch-mono .legend i{background:var(--ink)}.ch-mono .chart{--c1:color-mix(in srgb,var(--ink) 62%,var(--sf));--c2:color-mix(in srgb,var(--ink) 36%,var(--sf));--c3:color-mix(in srgb,var(--ink) 20%,var(--sf));--c4:color-mix(in srgb,var(--a1) 45%,var(--sf));--c5:color-mix(in srgb,var(--ink) 10%,var(--sf))}
/* rounded themes use pill controls, as friendly consumer products do; sharp themes square them off */
.r-round .btn,.r-round .chip,.r-round .chips,.r-round .search,.r-round .q,.r-round .states,.r-round .states button{border-radius:99px}
.r-round .tnav{align-self:center;gap:4px}.r-round .tnav a{height:36px;border-radius:99px;padding:0 14px}.r-round .tnav a.on{background:var(--sf2)}.r-round .tnav a.on:after{display:none}
.r-round .topbar.brand .tnav a.on{background:color-mix(in srgb,var(--on) 16%,transparent)}
.r-sharp .btn,.r-sharp .chip,.r-sharp .chips,.r-sharp .search,.r-sharp .field input,.r-sharp .field select,.r-sharp .field textarea,.r-sharp .ib,.r-sharp .rail a{border-radius:3px}.r-sharp .badge{border-radius:4px}
/* how much the page moves: quiet (no lift), modern (cards lift on hover), futuristic (a fine grid under the page, lit edges, live dots) */
body.fx-modern .card:not(.tbl):not(.form):not(.empty):hover,body.fx-modern .stat:hover,body.fx-futuristic .card:not(.tbl):not(.form):not(.empty):hover,body.fx-futuristic .stat:hover{transform:translateY(-2px);box-shadow:var(--lift);border-color:var(--edge2)}
body.fx-modern .cards.vis .item:hover,body.fx-futuristic .cards.vis .item:hover{box-shadow:none;transform:none}
body.fx-quiet .body>*,body.fx-quiet tbody tr{animation-name:fadein}
body.fx-futuristic .pane{background-image:radial-gradient(color-mix(in srgb,var(--ink) 7%,transparent) 1px,transparent 1px);background-size:22px 22px;background-position:-11px -11px}
body.fx-futuristic .card,body.fx-futuristic .stat{box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 7%,transparent),var(--shadow)}
body.fx-futuristic .stat .v,body.fx-futuristic .tot{font-feature-settings:"tnum","ss01";letter-spacing:-.035em}
body.fx-futuristic .stat .ic{color:var(--a1);background:color-mix(in srgb,var(--a1) 10%,var(--sf));border-color:color-mix(in srgb,var(--a1) 22%,var(--edge))}
body.fx-futuristic .badge.ok:before,body.fx-futuristic .badge.live:before{animation:pulse 1.8s ease-in-out infinite}
/* the heading type: titles, figures and the product's name speak in it */
.stat .v,.tot,.bm>b,.sc b,.detail .dh strong,.ovp h4,.acc h4,.car-h h4,.ch h4{font-family:var(--head)}.tot .delta{font-family:var(--font);letter-spacing:0}
.bm>b{letter-spacing:var(--hls)}
/* the mark: a glyph, the initial or a symbol on a tile shaped like the theme's corners, or the name alone */
.r-round .logo{border-radius:50%}.r-sharp .logo{border-radius:3px}
.logo.mono b{font:700 15px/1 var(--head);letter-spacing:0;color:inherit}
.logo.emb{background:linear-gradient(140deg,color-mix(in srgb,var(--br) 78%,#fff),var(--br))}.logo.emb svg{width:16px;height:16px;stroke-width:2}
.bm.wm{gap:3px;align-items:baseline}.bm.wm b{font:var(--hw) 19px/1 var(--head);letter-spacing:var(--hls);color:var(--br)}.bm.wm .wd{width:6px;height:6px;border-radius:50%;background:var(--a2,var(--br));flex:none}
.topbar.brand .bm.wm b,.rail.brand .bm.wm b{color:var(--on)}.topbar.brand .bm.wm .wd,.rail.brand .bm.wm .wd{background:var(--on)}
/* the switcher: who the app is acting for */
.sw{position:relative;display:flex;flex:none}
.swb{display:flex;align-items:center;gap:9px;border:1px solid var(--edge);background:var(--sf);color:var(--ink);border-radius:calc(var(--r) - 2px);padding:5px 9px 5px 5px;cursor:pointer;min-width:0;max-width:220px;text-align:left;transition:background .15s,border-color .15s}
.swb:hover{background:var(--sf2);border-color:var(--edge2)}.swb>svg{width:15px;height:15px;color:var(--mut);flex:none}
.swa{width:26px;height:26px;border-radius:calc(var(--r) - 4px);display:grid;place-items:center;flex:none;font-size:11px;font-weight:700;letter-spacing:.02em;background:color-mix(in srgb,var(--a1) 12%,var(--sf));color:var(--a1)}
.r-round .swa{border-radius:50%}
.swt{display:grid;min-width:0;line-height:1.2}.swt b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.swt small{font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rail .sw{margin:-6px 0 0}.rail .swb{width:100%;max-width:none}
.rail.brand .swb,.topbar.brand .swb{background:color-mix(in srgb,var(--on) 12%,transparent);border-color:color-mix(in srgb,var(--on) 20%,transparent);color:var(--on)}.rail.brand .swb>svg,.topbar.brand .swb>svg,.rail.brand .swt small,.topbar.brand .swt small{color:color-mix(in srgb,var(--on) 70%,transparent)}
.swm{position:absolute;top:calc(100% + 6px);left:0;z-index:6;min-width:220px;display:grid;gap:2px;padding:6px;border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);color:var(--ink);box-shadow:0 18px 40px -16px rgba(16,24,40,.32);animation:ovpop .18s var(--e)}
.swm[hidden]{display:none}.topbar .swm{left:auto;right:0}.topbar .nb{align-items:center;gap:10px}.topbar .nb .swm{left:0;right:auto}
.swm small{padding:4px 8px 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.swm button{display:flex;align-items:center;gap:10px;border:0;background:none;padding:7px 8px;border-radius:calc(var(--r) - 3px);cursor:pointer;text-align:left;font-size:13px;color:var(--ink)}
.swm button:hover{background:var(--sf2)}.swm button span:not(.swa){flex:1}.swm button>svg{width:15px;height:15px;color:var(--a1)}.swm button.on{font-weight:600}
/* a segmented control: one of a few views or periods */
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:calc(var(--r) - 1px);background:var(--sf2);border:1px solid var(--edge);flex:none;margin-left:auto}
.seg button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:5px 11px;border-radius:calc(var(--r) - 4px);font-size:12.5px;font-weight:550;color:var(--mut);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}
.seg button svg{width:14px;height:14px}.seg button:hover{color:var(--ink)}
.seg button.on{background:var(--sf);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.1),0 0 0 1px var(--edge)}
.r-round .seg,.r-round .seg button{border-radius:99px}.r-sharp .seg,.r-sharp .seg button{border-radius:3px}
.ch .seg{margin-left:0}
/* an accordion: sections opened one at a time */
.acc{padding:4px var(--pad)}.acc h4{margin:12px 0 4px;font-size:15px}
.acc details{border-bottom:1px solid var(--edge)}.acc details:last-child{border-bottom:0}
.acc summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;cursor:pointer;list-style:none;font-weight:600;font-size:14px}
.acc summary::-webkit-details-marker{display:none}.acc summary svg{width:17px;height:17px;color:var(--mut);flex:none;transition:transform .25s var(--e)}
.acc details[open] summary svg{transform:rotate(180deg);color:var(--a1)}
.acc details p{margin:-4px 0 14px;color:var(--ink2);font-size:13.5px;line-height:1.6;max-width:68ch;animation:fadein .3s ease}
/* a toast in its own tab stays in view, over the page and above a phone's tab bar */
.toast.pin{position:absolute;left:50%;right:auto;bottom:24px;width:max-content;max-width:calc(100% - 32px);transform:translateX(-50%);animation:toastin .45s var(--spring) both;z-index:6}
.canvas.phone .toast.pin{bottom:96px}
.toast span{min-width:0}.toast .lnk{padding:0 0 0 6px;color:color-mix(in srgb,var(--a1) 55%,var(--bg));font-size:13px}
.toast.bad svg{color:var(--bad)}.toast.info svg{color:color-mix(in srgb,var(--a1) 60%,var(--bg))}
@keyframes toastin{from{opacity:0;transform:translate(-50%,16px) scale(.96)}to{opacity:1;transform:translateX(-50%)}}
/* a line chart is drawn twice, wide and narrow; the frame's width shows one */
/* the unused line chart is hidden without display:none, which would restart its draw-in whenever the frame is resized (a full-page screenshot does) */
.chart svg.lc-n{position:absolute;visibility:hidden;width:0;height:0;overflow:hidden}
@container app (max-width:900px){.rail .swt,.rail .swb>svg{display:none}.rail .swb{padding:5px;justify-content:center}.rail h5:not(:first-of-type){display:block;height:1px;margin:8px 10px;background:var(--edge);font-size:0}.split.wl,.split.wr,.split.eq{grid-template-columns:1fr}.rail{width:64px;padding:16px 10px}.rail a span,.rail h5,.rail .bm>b{display:none}.rail a{justify-content:center}.q{display:none}}
@media(max-width:760px){body{display:block}aside{width:auto;border-right:0;border-bottom:1px solid var(--edge)}}
@media(max-width:640px){main{padding:14px 10px 40px}.win{display:none}.canvas{border-radius:22px}.canvas.phone{width:auto;border:0;border-radius:22px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 24px 48px -24px rgba(16,24,40,.28)}.canvas.phone .sbar,.canvas.phone:after{display:none}.canvas .drawer,.canvas.phone .drawer,.ovl,.canvas.phone .ovl{top:0}}
/* a narrow frame (a phone, or a small window) whatever the viewport: a phone app's frame is narrow on a desktop too */
/* more chart kinds: series and slices told apart by the brand at three strengths, then two status hues and a grey */
.chart{--c0:var(--a1);--c1:color-mix(in srgb,var(--a1) 58%,var(--sf));--c2:color-mix(in srgb,var(--a1) 30%,var(--sf));--c3:var(--info);--c4:var(--warn);--c5:color-mix(in srgb,var(--ink2) 28%,var(--sf))}
.legend.multi{gap:12px;flex-wrap:wrap}.legend.multi span{display:inline-flex;align-items:center;gap:6px}.legend.multi i{width:10px;height:10px;border-radius:3px}.lgrow{margin:-2px 0 6px}
.bars.stk .bar i{display:flex;flex-direction:column-reverse;gap:2px;background:none!important;overflow:hidden}.bars.stk .bar s{display:block;min-height:0}.bars.stk .bar:hover i{filter:brightness(1.07)}
.dn{display:flex;align-items:center;gap:clamp(16px,4vw,36px);flex-wrap:wrap;padding:4px 0 6px}
.chart .donut{width:min(180px,100%);height:auto;flex:none;overflow:visible}.donut circle{fill:none;stroke-width:16}.donut .trk{stroke:var(--sf2)}
.donut .sl{transition:stroke-width .15s;animation:fade .5s var(--e) both;animation-delay:calc(var(--d)*80ms)}.donut .sl:hover{stroke-width:19}
.chart .donut .dt{font:700 22px var(--head);fill:var(--ink);letter-spacing:-.02em}.chart .donut .dl{font-size:10.5px}
.dleg{list-style:none;margin:0;padding:0;display:grid;gap:10px;flex:1;min-width:190px}
.dleg li{display:grid;grid-template-columns:10px minmax(0,1fr) auto 48px;align-items:center;gap:10px;font-size:13px}.dleg i{width:10px;height:10px;border-radius:3px}.dleg span{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dleg b{font-variant-numeric:tabular-nums;font-weight:650}.dleg em{font-style:normal;color:var(--mut);text-align:right;font-variant-numeric:tabular-nums}
.rings{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:14px;padding:4px 0 2px}
.ring{position:relative;display:grid;justify-items:center;gap:6px;text-align:center}.chart .ring svg{width:92px;height:92px}.ring circle{fill:none;stroke-width:7}.ring .trk{stroke:var(--sf2)}
.ring .val{stroke:var(--a1);stroke-linecap:round;animation:fade .6s var(--e) both;animation-delay:calc(var(--d)*90ms)}.ring.full .val{stroke:var(--ok)}
.ring b{position:absolute;top:46px;transform:translateY(-50%);font:700 17px var(--head);font-variant-numeric:tabular-nums;letter-spacing:-.02em}.ring span{font-size:12.5px;color:var(--ink2);font-weight:550}
.chart .gauge{display:block;width:min(300px,100%);height:auto;margin:0 auto;overflow:visible}.gauge path{fill:none;stroke-width:14;stroke-linecap:round}.gauge .trk{stroke:var(--sf2)}
.gauge .val{stroke:var(--a1);animation:fade .6s var(--e) both}.gauge.warn .val{stroke:var(--warn)}.gauge.bad .val{stroke:var(--bad)}
.chart .gauge .gv{font:700 28px var(--head);fill:var(--ink);letter-spacing:-.02em}.chart .gauge .gl2{font-size:12px;fill:var(--ink2)}.chart .gauge .ge{font-size:10.5px}
.skround{display:flex;gap:18px;justify-content:center;padding:12px 0}.skround .sk{width:120px;height:120px;border-radius:50%;margin:0}
/* more field kinds */
.opts-f{border:0;margin:0;padding:0;min-width:0}.opts-f legend{font-size:13px;font-weight:600;color:var(--ink);padding:0;margin-bottom:6px}
.opts{display:flex;flex-wrap:wrap;gap:8px}.opts.tiles .opt{flex:1;min-width:120px}
.opt{display:inline-flex;align-items:center;gap:9px;padding:9px 14px 9px 11px;border:1px solid var(--edge2);border-radius:9px;background:var(--sf);cursor:pointer;font-size:13.5px;color:var(--ink2);transition:border-color .15s,background .15s}
.opt:has(input:checked){border-color:var(--a1);background:color-mix(in srgb,var(--a1) 7%,var(--sf));color:var(--ink)}
.field .opt input,.ck input{width:16px;height:16px;margin:0;padding:0;border:0;box-shadow:none;accent-color:var(--a1);flex:none;cursor:pointer}
.num,.aff,.cardin{display:flex;align-items:center;height:40px;border:1px solid var(--edge2);border-radius:9px;background:var(--sf);box-shadow:0 1px 2px rgba(16,24,40,.04);transition:border-color .15s,box-shadow .15s;overflow:hidden}
.num:focus-within,.aff:focus-within,.cardin:focus-within{border-color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--a1) 14%,transparent)}
.field .num input,.field .aff input,.field .cardin input,.field .aff select{height:38px;border:0;box-shadow:none;border-radius:0;background:transparent;min-width:0;animation:none}
.num input{text-align:center;font-variant-numeric:tabular-nums}.num .ib{flex:none;width:40px;height:38px;border-radius:0;font-size:17px;color:var(--ink2)}.num .ib:first-child{border-right:1px solid var(--edge)}.num .ib:last-child{border-left:1px solid var(--edge)}
.aff>b{flex:none;padding:0 2px 0 12px;font-weight:600;color:var(--mut);font-size:13px}.aff.srch>svg{flex:none;margin-left:11px;width:16px;height:16px;color:var(--mut)}.aff.srch>svg:last-of-type{margin:0 11px 0 0}
.aff.phone .cc{flex:none;height:100%;border-right:1px solid var(--edge);background:var(--sf2)}.field .aff.phone .cc select{width:auto;padding:0 28px 0 12px;font-variant-numeric:tabular-nums}.aff.phone .cc svg{right:8px}
.field.bad .num,.field.bad .aff,.cardin.bad,.field.bad .otp input{border-color:var(--bad);box-shadow:0 0 0 4px color-mix(in srgb,var(--bad) 12%,transparent)}
.otp{display:flex;gap:8px}.field .otp input{flex:1;max-width:50px;min-width:0;height:52px;padding:0;text-align:center;font:650 20px var(--font);font-variant-numeric:tabular-nums}
.rng{display:flex;align-items:center;gap:14px;height:40px}.field .rng input{flex:1;height:6px;padding:0;border:0;border-radius:99px;appearance:none;-webkit-appearance:none;background:linear-gradient(90deg,var(--a1) var(--p),var(--sf2) var(--p));box-shadow:none}
.rng input::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--sf);border:2px solid var(--a1);box-shadow:0 1px 3px rgba(16,24,40,.2);cursor:pointer}.rng input::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--sf);border:2px solid var(--a1)}
.rng output{min-width:72px;text-align:right;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.rngl{display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-top:-6px}
.cardin>svg{flex:none;margin-left:12px;color:var(--mut)}.field .cardin input:first-of-type{flex:1}.field .cardin input:not(:first-of-type){flex:none;width:80px;border-left:1px solid var(--edge);text-align:center}
/* a table that sorts, and rows ticked for a bulk action */
th[aria-sort]{padding-top:0;padding-bottom:0;height:38px}.sh{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;font:inherit;color:inherit;letter-spacing:inherit;cursor:pointer}th.n .sh{flex-direction:row-reverse}
.sh svg{width:13px;height:13px;opacity:0;transition:opacity .15s,transform .15s}.sh:hover svg{opacity:.5}th[aria-sort=ascending],th[aria-sort=descending]{color:var(--ink)}th[aria-sort=ascending] .sh svg,th[aria-sort=descending] .sh svg{opacity:1;color:var(--a1)}.sh svg.flip{transform:rotate(180deg)}
th.ck,td.ck{width:44px;padding-right:0}tr.picked td{background:color-mix(in srgb,var(--a1) 6%,var(--sf))}
.bulk{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;background:color-mix(in srgb,var(--a1) 8%,var(--sf));border-bottom:1px solid color-mix(in srgb,var(--a1) 22%,var(--edge));font-size:13px;animation:enter .25s var(--e)}.bulk[hidden]{display:none}
.bulk .bb{display:flex;gap:8px;margin-left:auto}.bulk .btn{height:32px;padding:0 12px;font-size:12.5px}
@container app (max-width:640px){.bulk{flex-wrap:wrap}.bulk .bb{margin-left:0;width:100%}.bulk .bb .btn{flex:1;justify-content:center}.dn{justify-content:center}.field .cardin input:not(:first-of-type){width:72px;padding:0 6px}.cardin input:last-of-type{width:56px}.chart svg.lc-w{position:absolute;visibility:hidden;width:0;height:0;overflow:hidden}.chart svg.lc-n{position:static;visibility:visible;width:100%;height:auto;overflow:visible}.topbar .swt{display:none}.topbar .swb{padding:4px 6px 4px 4px}.seg{margin-left:0}.ch{flex-wrap:wrap}
.rail,.tnav{display:none}.shell{flex-direction:column;min-height:0}.topbar{height:54px}.tabbar{display:flex}
.crumbs>:not(.back){display:none}.crumbs .back{display:inline-flex}.topbar .nb{display:flex}.stage:has(>.tabbar) .toast.pin{bottom:92px}
.pane{--px:14px;padding:18px 14px 24px}.ph .pa{width:100%}.ph .pa .btn{flex:1;justify-content:center}.form{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stats>.stat:last-child:nth-child(odd){grid-column:1/-1}.stat .v{font-size:22px}.spark{display:none}.search{min-width:0;flex:1}.toolbar .filters{flex-direction:column;align-items:stretch}.chips{overflow:auto;flex-wrap:nowrap}.bars{padding-left:30px}.bars .g{left:30px}.bars .g em{left:-30px;width:24px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}.chart .ln{stroke-dashoffset:0}}
`;

const JS = `
(function(){
  var $=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
  var secs=$(".screen"),links=$("aside a");
  var still=matchMedia("(prefers-reduced-motion:reduce)").matches;
  function count(root){$("[data-count]",root).forEach(function(el){
    var raw=el.getAttribute("data-count"),m=raw.match(/^(\\D*?)(-?\\d[\\d,]*\\.?\\d*)(.*)$/);if(!m)return;
    var to=parseFloat(m[2].replace(/,/g,"")),dec=(m[2].split(".")[1]||"").length,t0=null,comma=m[2].indexOf(",")>-1;
    if(!isFinite(to)||still)return;
    function fmt(v){var s=v.toFixed(dec);return comma?Number(s).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}):s}
    function step(t){if(t0===null)t0=t;var p=Math.min(1,(t-t0)/900),e=1-Math.pow(1-p,3);el.textContent=m[1]+fmt(to*e)+m[3];if(p<1)requestAnimationFrame(step)}
    el.textContent=m[1]+fmt(0)+m[3];requestAnimationFrame(step);setTimeout(function(){el.textContent=raw},1300)})}
  function show(){var id=decodeURIComponent((location.hash||"").slice(1))||(secs[0]&&secs[0].id);
    secs.forEach(function(s){var on=s.id===id;s.hidden=!on;if(on)count(s)});
    links.forEach(function(a){a.className=a.getAttribute("href")==="#"+id?"on":""})}
  function go(id){var sec=document.getElementById(id);if(!sec)return;location.hash=id;setTimeout(function(){sec.scrollIntoView({block:"start"})},0)}
  // what each page leads to: buttons by label, rows by their first cell, cards, list items and slides by their title
  $(".pane[data-links]").forEach(function(p){var L={};JSON.parse(p.getAttribute("data-links")).forEach(function(l){L[l.from.trim().toLowerCase()]=l.to});
    var name=function(el){if(el.tagName==="BUTTON")return label(el);if(el.tagName==="TR"){var c=el.querySelector("td:not(.ck)");while(c&&c.lastChild)c=c.lastChild;return c?c.textContent.trim().toLowerCase():""}var b=el.querySelector("b");return b?b.textContent.trim().toLowerCase():""};
    $(".app button,.app tbody tr,.app .card.item,.app .li,.app .slide",p).forEach(function(el){if(el.closest(".ovl"))return;var to=L[name(el)];if(to){el.setAttribute("data-go",to);el.classList.add("go")}})});
  function label(b){return (b.textContent.trim()||b.getAttribute("aria-label")||"").toLowerCase()}
  // a menu opens under the button that opened it
  function place(ov){if(!ov.classList.contains("k-menu"))return;var lab=ov.getAttribute("data-trigger").toLowerCase();
    var b=$("button",ov.closest(".pane")).filter(function(x){return !x.closest(".ovl")&&label(x)===lab})[0];if(!b)return;
    var r=b.getBoundingClientRect(),o=ov.getBoundingClientRect(),p=ov.querySelector(".ovp");p.style.top=Math.round(r.bottom-o.top+6)+"px";p.style.right=Math.round(Math.max(8,o.right-r.right))+"px"}
  var MARK={ok:'<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',bad:'<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16v.01"/>',info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'};
  function toast(s,t,tone,undo){$(".toast:not(.pin)",s).forEach(function(x){x.remove()});var d=document.createElement("div");tone=tone||"ok";d.className="toast "+tone;d.setAttribute("role","status");d.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(MARK[tone]||MARK.ok)+'</svg>';var sp=document.createElement("span");sp.textContent=t;d.appendChild(sp);
    if(undo){var u=document.createElement("button");u.type="button";u.className="lnk";u.textContent="Undo";d.appendChild(u)}s.appendChild(d);setTimeout(function(){d.remove()},3100)}
  // the page's own words for what an action did, when the design gave them; else "<action> done"
  function said(s,el,dflt){var p=el.closest(".pane"),raw=p&&p.getAttribute("data-toasts"),lab=label(el);if(raw){var t=JSON.parse(raw).filter(function(x){return x.after.trim().toLowerCase()===lab})[0];if(t)return toast(s,t.text,t.tone,t.undo)}toast(s,dflt)}
  secs.forEach(function(s){
    $("[data-state]",s).forEach(function(b){b.addEventListener("click",function(){
      $("[data-state]",s).forEach(function(x){x.className=""});b.className="on";
      var k=b.getAttribute("data-state");$("[data-wf]",s).forEach(function(w){var on=w.getAttribute("data-wf")===k;w.hidden=!on;if(on){count(w);$(".ovl[data-open]",w).forEach(function(o){o.classList.add("open");place(o)})}})})});
    // a slider shows its value as it moves; a one-time code moves to the next box as each digit is typed
    s.addEventListener("input",function(e){var t=e.target;
      if(t.type==="range"){var o=t.parentNode.querySelector("output");t.style.setProperty("--p",((t.value-t.min)/(t.max-t.min||1)*100)+"%");if(o)o.textContent=(t.getAttribute("data-pre")||"")+Number(t.value).toLocaleString("en")+(t.getAttribute("data-suf")||"");return}
      if(t.closest&&t.closest(".otp")&&t.value&&t.nextElementSibling)t.nextElementSibling.focus()});
    s.addEventListener("input",function(e){var t=e.target;if(!t.matches||!t.matches('input[type=search]'))return;
      var q=t.value.toLowerCase(),pane=t.closest(".pane");$("tbody tr,.cards .item,.list .li",pane).forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>-1?"":"none"})});
    s.addEventListener("click",function(e){
      // the switcher: open its menu, or switch to another account, workspace or company
      var sb=e.target.closest?e.target.closest("[data-sw],.swm button"):null;$(".swm",s).forEach(function(m){if(!sb||!m.parentNode.contains(sb)){m.hidden=true;m.parentNode.querySelector("[data-sw]").setAttribute("aria-expanded","false")}});
      if(sb){var w=sb.closest(".sw"),m=w.querySelector(".swm"),btn=w.querySelector("[data-sw]");
        if(sb.hasAttribute("data-sw")){m.hidden=!m.hidden;btn.setAttribute("aria-expanded",String(!m.hidden));return}
        var to=sb.querySelector("span:not(.swa)").textContent;$("button",m).forEach(function(x){var on=x===sb;x.classList.toggle("on",on);x.setAttribute("aria-checked",String(on))});
        btn.querySelector(".swt b").textContent=to;btn.querySelector(".swa").textContent=sb.querySelector(".swa").textContent;var sm=btn.querySelector(".swt small");if(sm)sm.remove();m.hidden=true;btn.setAttribute("aria-expanded","false");toast(s,"Switched to "+to,"info");return}
      var dr=e.target.closest?e.target.closest("[data-drawer],.scrim,.dp a"):null;
      if(dr){var cv=dr.closest(".canvas");if(dr.hasAttribute("data-drawer"))cv.classList.toggle("dopen");else cv.classList.remove("dopen");return}
      // a table's tick boxes (one row, or all of them): the bulk bar shows while any row is ticked
      var ck=e.target.closest?e.target.closest(".tbl .ck input"):null;
      if(ck){var tb=ck.closest(".tbl"),boxes=$("tbody .ck input",tb);if(ck.closest("thead"))boxes.forEach(function(x){x.checked=ck.checked});boxes.forEach(function(x){x.closest("tr").classList.toggle("picked",x.checked)});
        var n=boxes.filter(function(x){return x.checked}).length,h=tb.querySelector("thead .ck input");if(h){h.checked=n>0&&n===boxes.length;h.indeterminate=n>0&&n<boxes.length}var bk=tb.querySelector(".bulk");if(bk){bk.hidden=!n;bk.querySelector(".bn").textContent=n}return}
      var clr=e.target.closest?e.target.closest("[data-clear]"):null;
      if(clr){$(".ck input",clr.closest(".tbl")).forEach(function(x){x.checked=false;x.indeterminate=false;var r=x.closest("tbody tr");if(r)r.classList.remove("picked")});clr.closest(".bulk").hidden=true;return}
      // a sortable header sorts the rows by its column, the other way round when it already does
      var sh=e.target.closest?e.target.closest(".sh"):null;
      if(sh){var th=sh.closest("th"),tbl=th.closest("table"),ci=+sh.getAttribute("data-sort"),cur=th.getAttribute("aria-sort"),asc=cur==="none"?!th.classList.contains("n"):cur==="descending";
        $("th[aria-sort]",tbl).forEach(function(x){x.setAttribute("aria-sort","none");x.querySelector("svg").classList.remove("flip")});th.setAttribute("aria-sort",asc?"ascending":"descending");sh.querySelector("svg").classList.toggle("flip",asc);
        var body=tbl.tBodies[0],key=function(r){var c=r.querySelectorAll("td[data-v]")[ci];return c?c.getAttribute("data-v"):""};
        [].slice.call(body.rows).sort(function(a,b){var x=key(a),y=key(b),d=x!==""&&y!==""&&isFinite(x)&&isFinite(y)?x-y:x.localeCompare(y);return asc?d:-d}).forEach(function(r){body.appendChild(r)});return}
      // a number field's − and + buttons
      var stp=e.target.closest?e.target.closest("[data-step]"):null;
      if(stp){var ni=stp.parentNode.querySelector("input"),nv=parseFloat((ni.value||"0").replace(/,/g,""))||0;ni.value=String(Math.max(0,nv+(+stp.getAttribute("data-step"))));return}
      var ob=e.target.closest?e.target.closest("button"):null,inOv=e.target.closest?e.target.closest(".ovl"):null;
      if(inOv){if(e.target.classList.contains("ovs")||(ob&&(ob.hasAttribute("data-close")||ob.closest(".ova")||ob.classList.contains("mitem")))){inOv.classList.remove("open");if(ob&&(ob.classList.contains("primary")||ob.classList.contains("mitem")))said(s,ob,ob.textContent.trim()+" done")}return}
      if(ob&&ob.closest(".pane")){var lab=label(ob),ov=$(".ovl",ob.closest(".pane")).filter(function(o){return o.getAttribute("data-trigger").toLowerCase()===lab})[0];if(ov){ov.classList.add("open");place(ov);return}}
      var cb=e.target.closest?e.target.closest("[data-car]"):null;if(cb){var tr=cb.closest(".car").querySelector(".track"),sl=tr.querySelector(".slide");tr.scrollBy({left:(+cb.getAttribute("data-car"))*(sl?sl.getBoundingClientRect().width+16:tr.clientWidth),behavior:"smooth"});return}
      // a link leads to another screen of the demo, unless a button of its own inside it was pressed (save, a slide's offer)
      var g=e.target.closest?e.target.closest("[data-go]"):null;if(g&&(!ob||ob===g)){go(g.getAttribute("data-go"));return}
      var t=e.target.closest?e.target.closest("button,tr"):null;if(!t)return;var pane=t.closest(".pane");
      if(t.parentNode.classList&&t.parentNode.classList.contains("ptabs")){$("button",t.parentNode).forEach(function(c){c.classList.remove("on");c.setAttribute("aria-selected","false")});t.classList.add("on");t.setAttribute("aria-selected","true");
        var bd=t.closest(".app").querySelector(".body");bd.style.transition="opacity .2s";bd.style.opacity=.35;setTimeout(function(){bd.style.opacity=""},360);return}
      if(t.tagName==="TR"&&t.parentNode.tagName==="TBODY"){$("tr.sel",pane).forEach(function(r){r.classList.remove("sel")});t.classList.add("sel");return}
      if(t.classList.contains("fav")){t.classList.toggle("on");return}
      if(t.parentNode.classList&&t.parentNode.classList.contains("seg")){$("button",t.parentNode).forEach(function(c){c.classList.remove("on");c.setAttribute("aria-checked","false")});t.classList.add("on");t.setAttribute("aria-checked","true");
        var area=t.closest(".chart")||pane;$(".tbl tbody,.cards,.list,.bars,svg.lc-w,svg.lc-n",area).forEach(function(x){x.style.transition="opacity .2s";x.style.opacity=.3;setTimeout(function(){x.style.opacity=""},380)});return}
      if(t.classList.contains("chip")){$(".chip",t.parentNode).forEach(function(c){c.classList.remove("on")});t.classList.add("on");
        $(".tbl tbody,.cards,.list",pane).forEach(function(x){x.style.transition="opacity .2s";x.style.opacity=.3;setTimeout(function(){x.style.opacity=""},380)});return}
      var act=t.getAttribute("data-act");if(!act)return;t.classList.add("busy");
      setTimeout(function(){t.classList.remove("busy");if(act==="submit")said(s,t,"Saved");else if(act==="act")said(s,t,t.textContent.trim()+" done")},800)});
  });
  // the dots follow the slide in view
  document.addEventListener("scroll",function(e){var tr=e.target;if(!tr.classList||!tr.classList.contains("track"))return;var c=tr.closest(".car"),sl=tr.querySelectorAll(".slide");if(!sl.length)return;
    var w=sl[0].getBoundingClientRect().width+16,i=Math.round(tr.scrollLeft/w);if(tr.scrollLeft+tr.clientWidth>=tr.scrollWidth-4)i=sl.length-1;$(".dots i",c).forEach(function(d,k){d.classList.toggle("on",k===i)})},true);
  document.addEventListener("keydown",function(e){if(e.key==="Escape"){$(".swm").forEach(function(m){m.hidden=true});$(".canvas.dopen").forEach(function(c){c.classList.remove("dopen")});$(".ovl.open").forEach(function(o){o.classList.remove("open")})}});
  window.addEventListener("hashchange",show);show();
})();
`;

// the product's mark, as the theme chose it: an abstract glyph (picked from the name), the initial, the name alone, or a symbol of what it does
const MARKS = [
  '<circle cx="9.5" cy="12" r="5"/><circle cx="14.5" cy="12" r="5"/>',
  '<path d="M5 16.5 12 7l7 9.5"/><path d="M9 16.5h6"/>',
  '<path d="M6 18A12 12 0 0 1 18 6"/><path d="M10.5 18A7.5 7.5 0 0 1 18 10.5"/><circle cx="17.5" cy="17.5" r="1.2"/>',
  '<path d="M12 4.5 19.5 12 12 19.5 4.5 12z"/><path d="M12 9v6"/>',
  '<path d="M5 7h14M5 12h9M5 17h5"/>',
  '<rect x="5.5" y="5.5" width="13" height="13" rx="4"/><circle cx="12" cy="12" r="2.2"/>',
  '<path d="M6 12a6 6 0 0 1 12 0"/><path d="M9 12a3 3 0 0 1 6 0"/><path d="M5 16h14"/>',
  '<path d="M7 5v14"/><path d="M7 12c4 0 6-3 10-7"/><path d="M7 12c4 0 6 3 10 7"/>',
  '<circle cx="12" cy="12" r="6.5"/><path d="M12 5.5v13"/><path d="M12 12h6.5"/>',
  '<path d="M4.5 15.5c2.5-5 5-5 7.5 0s5 5 7.5 0"/><path d="M4.5 9.5c2.5-5 5-5 7.5 0s5 5 7.5 0"/>',
  '<path d="M6 18V9l6-4 6 4v9"/><path d="M10 18v-5h4v5"/>',
  '<circle cx="8.5" cy="8.5" r="3"/><circle cx="15.5" cy="15.5" r="3"/><path d="M15.5 5.5v6M18.5 8.5h-6"/>',
];
/** The product's logo; `words` (the product's own) choose an emblem's symbol. */
function logo(name: string, words = ""): string {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim() || "A";
  const glyph = () => `<span class="logo"><svg viewBox="0 0 24 24" aria-hidden="true">${MARKS[Math.abs(hash(name)) % MARKS.length]}</svg></span>`;
  if (look.mark === "monogram") return `<span class="logo mono"><b>${esc(clean[0]!.toUpperCase())}</b></span>`;
  if (look.mark === "emblem") { const ic = iconFor(`${name} ${words}`); return ic ? `<span class="logo emb">${icon(ic)}</span>` : glyph(); }
  if (look.mark === "wordmark") return "";
  return glyph();
}
const ME = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" fill="#E8DCCB"/><path d="M5 33c1-6.5 5.4-9.5 11-9.5s10 3 11 9.5z" fill="#3D5A80"/><circle cx="16" cy="13.5" r="6" fill="#D9A47E"/><path d="M9.8 13c0-4.6 2.8-7 6.4-7 3.4 0 6.1 2.2 6 6.6-1.7-2-4.5-3.1-7.4-2.6-1.7.3-3.4 1.4-5 3z" fill="#2B1E16"/></svg>';

type Frame = Exclude<DesignTheme["shell"], "auto">;
interface AppFrame { id: string; name: string; device: "web" | "phone"; shell: Frame; switcher?: Switcher }
// a phone's status bar: the time, then signal, wifi and battery, drawn as the system draws them
const SYS = '<svg viewBox="0 0 18 11" aria-hidden="true"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="6" rx="1"/><rect x="10" y="2.5" width="3" height="8.5" rx="1"/><rect x="15" y="0" width="3" height="11" rx="1"/></svg><svg viewBox="0 0 16 11" aria-hidden="true"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.4A10.4 10.4 0 0 0 8 .3 10.4 10.4 0 0 0 .7 3.2L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.8 6.8 0 0 0 8 3.9a6.8 6.8 0 0 0-4.7 1.8l1.3 1.4c.9-.8 2.1-1.3 3.4-1.3Zm0 3.5L9.9 7.4a2.8 2.8 0 0 0-3.8 0Z"/></svg><svg viewBox="0 0 27 12" aria-hidden="true"><rect x=".5" y=".5" width="23" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="8" rx="2"/><path d="M25 4v4c.8-.3 1.3-1.1 1.3-2S25.8 4.3 25 4Z" opacity=".45"/></svg>';

export function buildDemo(d: DemoInput): string {
  uidN = 0;
  look = { ...DEFAULT_THEME, ...d.theme };
  const screens = d.screens;
  const frame = (id: string) => d.frames?.[id];
  const label = (o: Screen) => o.mock?.title ?? o.route;
  const iconOf = (o: Screen) => iconFor(`${label(o)} ${o.route.replace(/[/:-]/g, " ")}`) || "grid";
  // one app unless the design names several; a screen with no app (or an unknown one) is in the first
  const given = d.apps?.length ? d.apps : [{ id: "", name: d.title, device: look.reading?.device === "phone" || look.shell === "tabs" ? "phone" as const : "web" as const, shell: look.shell }];
  const inApp = (s: Screen, a: { id: string }) => given.length < 2 || s.app === a.id || ((!s.app || !given.some((x) => x.id === s.app)) && a.id === given[0]!.id);
  // a tool (most pages carry a table or figures) gets a sidebar app; a consumer product gets a top bar; a phone app gets a tab bar
  const frameOf = (a: (typeof given)[number]): Frame => {
    if (a.shell !== "auto") return a.shell;
    const own = screens.filter((s) => inApp(s, a) && s.mock);
    if (a.device === "phone") return own.length >= 2 ? "tabs" : "minimal";
    const tool = own.filter((s) => s.mock!.blocks.some((b) => b.type === "table" || b.type === "stats")).length;
    return own.length > 0 && tool * 2 >= own.length ? "sidebar" : "topbar";
  };
  const apps: AppFrame[] = given.map((a, i) => { const sw = "switcher" in a && a.switcher ? a.switcher : i === 0 && given.length < 2 ? d.switcher : undefined; return { id: a.id, name: a.name, device: a.device, shell: frameOf(a), ...(sw ? { switcher: sw } : {}) }; });
  const appOf = (s: Screen): AppFrame => apps.find((a) => inApp(s, a)) ?? apps[0]!;
  const brandBar = d.theme?.chrome === "brand" ? " brand" : "";
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "app";
  const section = (o: Screen) => o.route.split(/[/?#]/).filter(Boolean)[0]?.toLowerCase() ?? "";
  const navName = (o: Screen) => { const t = label(o); return t.length <= 16 && !/[,#\d·]/.test(t) ? t : section(o) ? section(o).replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Home"; };
  // one entry per section, its shallowest page first
  const sections = (list: Screen[]) => [...new Set(list.map(section))].map((x) => list.filter((o) => section(o) === x).sort((a, b) => a.route.split("/").length - b.route.split("/").length)[0]!);
  const panel = (s: Screen, i: number): string => {
    const app = appOf(s), shell = app.shell, phone = app.device === "phone";
    const sibs = screens.filter((o) => appOf(o) === app);
    const states = demoStates(s);
    const shown = s.frames.map(frame).filter((f) => f?.dataUri);
    const reqs = s.reqs.map((r) => `<li><b>${esc(r)}</b> ${esc(d.requirements[r] ?? "")}</li>`).join("");
    const wrap = (x: string) => (shell === "sidebar" || phone ? x : `<div class="wrap">${x}</div>`);
    const pane = (st: string, k: number): string => {
      const hidden = k === 0 ? "" : " hidden";
      const ov = s.mock?.overlays?.findIndex((o) => overlayLabel(o) === st) ?? -1;
      const tst = s.mock?.toasts?.findIndex((t) => toastLabel(t) === st) ?? -1;
      const inner = st === FULL_DATA && s.mockFull
        ? (() => { busy = true; try { return renderMock(s.mockFull!, "normal", st); } finally { busy = false; } })()
        : s.mock && ov >= 0
        ? renderMock(s.mock, "normal", st, ov)
        : s.mock && tst >= 0
        ? renderMock(s.mock, "normal", st, -1, tst)
        : s.mock
        ? renderMock(s.mock, stateKind(st), st)
        : `<div class="wire">${wireframeSvg(s, st, s.reqs.map((r) => ({ id: r, text: d.requirements[r] ?? "" })))}</div>`;
      const go = (s.mock?.links?.length ? ` data-links="${esc(JSON.stringify(s.mock.links))}"` : "") + (s.mock?.toasts?.length ? ` data-toasts="${esc(JSON.stringify(s.mock.toasts))}"` : "");
      return `<div class="pane" data-wf="${k}"${go}${hidden}>${wrap(inner)}</div>`;
    };
    // the navigation lists the app's sections (a detail page sits under its section, which stays lit), named as a product names them
    const nav = sections(sibs);
    const links = (max = nav.length, list = nav) => list.slice(0, max).map((o) => `<a href="#${esc(o.id)}"${section(o) === section(s) ? ' class="on"' : ""}>${icon(iconOf(o))}<span>${esc(navName(o))}</span></a>`).join("");
    // a long menu reads in groups (Money, Cards, Settings), in the order they first appear; pages without one lead
    const groups = [...new Set(nav.map((o) => o.group?.trim() ?? ""))];
    const menu = groups.some(Boolean) ? groups.map((g) => `${g ? `<h5>${esc(g)}</h5>` : ""}${links(nav.length, nav.filter((o) => (o.group?.trim() ?? "") === g))}`).join("") : `<h5>Menu</h5>${links()}`;
    const name = apps.length > 1 ? `${d.title} ${app.name}` : d.title;
    const wm = look.mark === "wordmark";
    const bm = `<span class="bm${wm ? " wm" : ""}">${logo(d.title, `${look.reading?.hero ?? ""} ${look.reading?.context ?? ""} ${d.flow}`)}<b>${esc(apps.length > 1 && phone ? d.title : name)}</b>${wm ? '<i class="wd" aria-hidden="true"></i>' : ""}</span>`;
    // who the app is acting for: the current one and the others, switched from the frame
    const sw = app.switcher;
    const switcher = sw ? `<span class="sw"><button type="button" class="swb" data-sw aria-haspopup="menu" aria-expanded="false" aria-label="Switch ${esc(sw.kind)}"><span class="swa">${esc(initials(sw.current) || "•")}</span><span class="swt"><b>${esc(sw.current)}</b>${sw.meta ? `<small>${esc(sw.meta)}</small>` : ""}</span>${icon("chevd")}</button><span class="swm" role="menu" hidden><small>Switch ${esc(sw.kind)}</small>${[sw.current, ...sw.others].map((o, k) => `<button type="button" role="menuitemradio" aria-checked="${k === 0}"${k === 0 ? ' class="on"' : ""}><span class="swa">${esc(initials(o) || "•")}</span><span>${esc(o)}</span>${k === 0 ? icon("check") : ""}</button>`).join("")}</span></span>` : "";
    const tools = `<button type="button" class="ib" aria-label="Notifications">${icon("bell")}<i class="dot"></i></button><span class="me">${ME}</span>`;
    const search = phone ? "" : `<button type="button" class="ib" aria-label="Search">${icon("search")}</button>`;
    const content = shown.length ? shown.map((f) => `<img src="${f!.dataUri}" alt="${esc(f!.name)}">`).join("") : states.map(pane).join("");
    const tabbar = shell === "minimal" || shell === "drawer" || nav.length < 2 ? "" : `<nav class="tabbar" aria-label="Tabs">${links(5)}</nav>`;
    const foot = `<div class="rf"><a href="#${esc(s.id)}">${icon("settings")}<span>Settings</span></a><a href="#${esc(s.id)}">${icon("help")}<span>Help</span></a></div>`;
    const drawer = shell === "drawer" ? `<div class="drawer"><span class="scrim"></span><div class="dp" role="dialog" aria-label="Menu"><div class="row">${bm}<button type="button" class="ib" data-drawer aria-label="Close menu">${icon("close")}</button></div><nav aria-label="Main">${groups.some(Boolean) ? menu : links()}</nav>${foot}</div></div>` : "";
    const head = (x: string) => `<header class="topbar${brandBar}">${wrap(x)}</header>`;
    const app$ = shell === "sidebar"
      ? `<div class="shell"><nav class="rail${brandBar}" aria-label="Main">${bm}${switcher}<div class="rl">${menu}</div>${foot}</nav><div class="stage"><header class="topbar"><span class="nb">${bm}${switcher}</span><span class="q">${icon("search")}<span>Search</span><kbd>⌘K</kbd></span><span class="sp"></span>${tools}</header>${content}${tabbar}</div></div>`
      : shell === "minimal"
      ? `<div class="stage">${head(`${bm}${switcher}<span class="sp"></span><a class="help" href="#${esc(s.id)}">${icon("help")}<span>Help</span></a><span class="me">${ME}</span>`)}${content}</div>`
      : shell === "drawer"
      ? `<div class="stage">${head(`<button type="button" class="ib" data-drawer aria-label="Menu">${icon("menu")}</button>${bm}<span class="sp"></span>${switcher}${search}${tools}`)}${content}</div>${drawer}`
      : shell === "tabs"
      ? `<div class="stage">${head(`${bm}<span class="sp"></span>${switcher}${search}${tools}`)}${content}${tabbar}</div>`
      : `<div class="stage">${head(`${bm}<nav class="tnav" aria-label="Main">${links()}</nav><span class="sp"></span>${switcher}${search}${tools}`)}${content}${tabbar}</div>`;
    const host = `${apps.length > 1 && app.id ? `${app.id}.` : ""}${slug}.app`;
    const device = phone ? `<div class="sbar${brandBar && shell !== "sidebar" ? brandBar : ""}" aria-hidden="true"><b>9:41</b><span class="island"></span><span class="sys">${SYS}</span></div>` : `<div class="win" aria-hidden="true"><span class="tl"><i></i><i></i><i></i></span><span class="url">${icon("lock")}${esc(host)}${esc(s.route)}</span></div>`;
    return `<section class="screen" id="${esc(s.id)}" data-i="${i}" hidden>
<div class="top"><h2>${esc(s.mock?.title ?? s.route)} <code>${esc(s.route)}</code> <span class="sid">${esc(s.id)}</span></h2><span class="tag">${esc(s.size)}</span></div>
<p class="file">${esc(s.file)}</p>
<div class="states" role="tablist">${states.map((st, k) => `<button role="tab" data-state="${k}"${k === 0 ? ' class="on"' : ""}>${esc(st)}</button>`).join("")}</div>
<div class="canvas sh-${shell}${phone ? " phone" : ""}">${device}${app$}</div>
<details class="serves"><summary>Serves ${s.reqs.length} requirement${s.reqs.length === 1 ? "" : "s"}</summary><ul>${reqs || "<li>no requirement</li>"}</ul></details>
<p class="nav">${sibs.filter((o) => o.id !== s.id).map((o) => `<a href="#${esc(o.id)}">${esc(label(o))} →</a>`).join(" ")}</p>
</section>`;
  };
  const item = (s: Screen) => `<li><a href="#${esc(s.id)}">${esc(s.mock?.title ?? s.id)} <code>${esc(s.route)}</code></a></li>`;
  // more than one app: the walkthrough lists each app's screens under its name and device
  const side = apps.length > 1
    ? apps.map((a) => `<h3>${esc(a.name)} <span class="dv">${a.device === "phone" ? "phone app" : "web"}</span></h3><ul>${screens.filter((s) => appOf(s) === a).map(item).join("")}</ul>`).join("")
    : `<h3>Screens</h3><ul>${screens.map(item).join("")}</ul>`;
  const none = d.noScreen.map((n) => `<li><b>${esc(n.req)}</b> ${esc(d.requirements[n.req] ?? "")} <i>(no screen: ${esc(n.reason)})</i></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${esc(d.title)} - design demo</title>
<meta name="color-scheme" content="${d.theme?.mode === "dark" ? "dark" : d.theme?.mode === "auto" ? "light dark" : "light"}">
<style>${themeCss(d.theme)}${CSS}</style></head><body class="fx-${esc(look.fx)} sh-${apps[0]!.shell} ch-${look.charts} r-${look.radius}">
<aside><h1>${esc(d.title)}</h1><p>${esc(d.flow)}</p>${side}${none ? `<h3>No screen</h3><ul>${none}</ul>` : ""}</aside>
<main>${screens.map(panel).join("\n")}</main>
<script>${JS}</script></body></html>
`;
}
