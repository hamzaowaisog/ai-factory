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
import { demoWords, englishName, isRtl, nativeDigits, nativeName, translationTable, weekStart, weekend } from "./locale.js";
import type { Button, DesignApp, DesignLocale, DesignTheme, FormField, MockBlock, MockOverlay, MockToast, ScreenMock, Switcher } from "../contracts/artifacts.js";
import type { DesignBody } from "../contracts/artifacts.js";
import type { z } from "zod";

type ContractScreen = z.infer<typeof DesignBody>["screens"][number];
/** a screen as the design step gives it (its states, size and frames always filled in) */
type Screen = ContractScreen & { states: string[]; size: NonNullable<ContractScreen["size"]>; frames: string[] };
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
  /** the product's languages and market: the demo opens in the first language, switches to the other, and draws dates for the region */
  locale?: DesignLocale;
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
// the market the calendar is drawn for: its first weekday and weekend (Monday = 0)
let market: { start: number; weekend: number[] } = { start: 0, weekend: [5, 6] };
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
    case "table": return `<div class="card tbl"><div class="scroll"><table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${[0, 1, 2, 3, 4].map((r) => `<tr>${b.columns.map((_, i) => `<td>${bar(i === 0 ? 70 : 40 + ((r * 13 + i * 29) % 45), 12)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
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
    case "actions": case "toolbar": case "alert": return renderBlock(b, "normal");
    case "progress": return `<div class="card prgs">${b.title ? `<h4>${esc(b.title)}</h4>` : ""}${b.items.map((it) => `<div class="pi"><span class="pl">${esc(it.label)}</span>${bar(100, 6)}</div>`).join("")}</div>`;
    case "calendar": return `<div class="card cal"><div><div class="calh"><b>${esc(b.month)}</b></div><div class="cgrid">${WEEK.map((w) => `<span class="cwd">${w}</span>`).join("")}${Array.from({ length: 35 }, () => '<i class="sk cd"></i>').join("")}</div></div></div>`;
    case "map": return `<div class="card mapc"><i class="sk mapv"></i><div class="mpl">${b.pins.slice(0, 4).map(() => `<div class="li">${bar(55, 13)}${bar(35, 10)}</div>`).join("")}</div></div>`;
    case "gallery": return `<div class="gal grid">${b.items.slice(0, 6).map(() => '<i class="sk pic-sk"></i>').join("")}</div>`;
    case "kanban": return `<div class="kb" style="--cols:${b.columns.length}">${b.columns.map((c, i) => `<section class="kcol"><header><b>${esc(c.title)}</b></header><div class="kl">${Array.from({ length: 1 + ((i + 2) % 3) }, () => `<div class="kc">${bar(70, 13)}${bar(40, 10)}</div>`).join("")}</div></section>`).join("")}</div>`;
    case "plans": return `<div class="plans"><div class="pgrid" style="--n:${b.items.length}">${b.items.map((p) => `<div class="card plan"><b class="pn">${esc(p.name)}</b>${bar(45, 30)}${bar(100, 38)}${p.features.slice(0, 4).map(() => bar(75)).join("")}</div>`).join("")}</div></div>`;
    case "compare": return `<div class="card cmpb"><div class="scroll"><table><thead><tr><th></th>${b.items.map((it) => `<th><b>${esc(it.name)}</b></th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${b.items.map(() => `<td>${bar(50)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    case "receipt": return `<div class="card rcpt"><div class="rch"><b>${esc(b.title)}</b></div>${b.lines.map(() => `<div class="row sp">${bar(50)}${bar(18)}</div>`).join("")}${bar(30, 22)}</div>`;
    case "chat": return `<div class="card chat"><div class="chh">${avatar(b.with)}<div class="lt"><b>${esc(b.with)}</b></div></div><div class="msgs">${b.messages.slice(0, 5).map((m) => `<div class="msg ${m.from}"><i class="sk" style="width:${m.from === "me" ? 140 : 190}px;height:34px;border-radius:14px"></i></div>`).join("")}</div></div>`;
    case "notifications": case "results": case "reviews": return `<div class="card list">${[0, 1, 2, 3].map(() => `<div class="li"><i class="sk" style="width:36px;height:36px;border-radius:10px;margin:0"></i><div style="flex:1">${bar(55, 13)}${bar(35, 10)}</div></div>`).join("")}</div>`;
    default: return `<div class="card">${bar(90)}${bar(70)}</div>`;
  }
}

// a segmented control: one of a few views or periods, the first one chosen
const VIEW_ICON: [RegExp, string][] = [[/^list$/i, "menu"], [/^(grid|cards|tiles)$/i, "grid"], [/^map$/i, "map"], [/^(calendar|month|week|day|schedule)$/i, "calendar"], [/^(board|kanban)$/i, "layers"], [/^(chart|graph)$/i, "chart"]];
const segs = (items: string[], label: string): string => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${items.map((t, i) => { const ic = items.length <= 3 ? VIEW_ICON.find(([re]) => re.test(t.trim()))?.[1] : undefined; return `<button type="button" role="radio" aria-checked="${i === 0}"${i === 0 ? ' class="on"' : ""}>${ic ? icon(ic) : ""}<span>${esc(t)}</span></button>`; }).join("")}</div>`;

const btnLabel = (t: string): string => { const v = verbIcon(t); return `${v ? icon(v) : ""}<span>${esc(t)}</span>`; };

let tipN = 0;
/** A tooltip on what it wraps: shown on hover and keyboard focus, and named to screen readers through aria-describedby. */
const withTip = (html: string, tip: string | undefined): string => {
  if (!tip) return html;
  const id = `tip${++tipN}`;
  return `<span class="tipw">${html.replace(/^<(\w+)/, `<$1 aria-describedby="${id}"`)}<span class="tip" role="tooltip" id="${id}">${esc(tip)}</span></span>`;
};
/** A button's picture: the word it was given when it names one, else one for that word's meaning, else its verb's. */
const btnIcon = (b: { label: string; icon?: string }): string => (b.icon ? icon(b.icon) || icon(iconFor(b.icon)) || icon(verbIcon(b.icon)) : "") || icon(verbIcon(b.label));
/**
 * One button as the design gave it: a plain label (the first of its group is the main one, the rest secondary) or its variant,
 * icon, state, tooltip and split menu. `act` is what pressing it does in the demo (busy, then the page's toast).
 */
export function buttonHtml(given: Button, first: boolean, act = "act", plain = "secondary"): string {
  const b = typeof given === "string" ? { label: given } : given;
  const variant = "variant" in b && b.variant ? b.variant : first ? "primary" : plain;
  const cls = ["btn", { primary: "primary", secondary: "", ghost: "ghost", danger: "primary danger", link: "link" }[variant]];
  const sp = typeof given === "string" ? undefined : given;
  if (sp?.iconOnly) cls.push("icon");
  if (sp?.state === "loading") cls.push("loading");
  const off = sp?.state === "disabled" || sp?.state === "loading";
  const attrs = `${off ? " disabled" : ` data-act="${act}"`}${sp?.state === "loading" ? ' aria-busy="true"' : ""}`;
  const pic = btnIcon(b);
  const inner = sp?.iconOnly ? `${pic || icon("more")}<span class="vh">${esc(b.label)}</span>` : `${sp?.state === "loading" ? '<i class="spin" aria-hidden="true"></i>' : pic}<span>${esc(b.label)}</span>`;
  const main = `<button type="button" class="${cls.filter(Boolean).join(" ")}"${sp?.iconOnly ? ` aria-label="${esc(b.label)}"` : ""}${attrs}>${inner}</button>`;
  const tipped = withTip(main, sp?.hint ?? (sp?.iconOnly ? b.label : undefined));
  if (!sp?.menu?.length) return tipped;
  // a split button: the main action, and an arrow opening the other choices
  const caret = `<button type="button" class="${cls.filter((c) => c !== "icon" && c !== "loading").join(" ")} caret" data-dd aria-haspopup="menu" aria-expanded="false" aria-label="More ${esc(b.label)} options"${off ? " disabled" : ""}>${icon("chevd")}</button>`;
  const menu = `<span class="ddm" role="menu" hidden>${sp.menu.map((m) => `<button type="button" role="menuitem" data-act="${act}">${btnLabel(m)}</button>`).join("")}</span>`;
  return `<span class="splitb">${tipped}${caret}${menu}</span>`;
}

/** Who is on something: up to five overlapping avatars, then how many more. */
const people = (names: string[] | undefined): string => {
  if (!names?.length) return "";
  const more = names.length - 5;
  return `<span class="ppl" role="img" aria-label="${esc(names.join(", "))}">${names.slice(0, 5).map((n) => avatar(n)).join("")}${more > 0 ? `<i class="pmore">+${more}</i>` : ""}</span>`;
};

// fields the person picks rather than types: the validation state never flags them
const CHOSEN = new Set(["select", "toggle", "radio", "checkbox", "slider"]);
const CURRENCY = /^\s*([A-Z]{3}|[$€£¥₹₨]|Rs\.?)\s?/;
const DIAL = ["+1", "+44", "+92", "+91", "+971", "+966", "+974", "+20"];

/** The richer form fields (choices shown at once, amounts, codes, phone numbers, sliders, cards); undefined for the basic kinds. */
function fieldHtml(f: FormField, id: string, bad: boolean, label: string, err: string, cls: string, lab = esc(f.label)): string | undefined {
  const v = f.value ?? "", ph = f.placeholder ?? "";
  const inv = bad ? ' aria-invalid="true"' : "";
  const opts = f.options?.length ? f.options : v ? [v] : [];
  switch (f.kind) {
    case "radio": case "checkbox": {
      const on = f.kind === "radio" ? [opts.includes(v) ? v : opts[0]] : v.split(/\s*,\s*/).filter(Boolean);
      return `<fieldset class="${cls} wide opts-f"${f.disabled ? " disabled" : ""}><legend>${lab}</legend><div class="opts${opts.length <= 3 ? " tiles" : ""}">${opts.map((o) => `<label class="opt"><input type="${f.kind}" name="${id}"${on.includes(o) ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div>${err}</fieldset>`;
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
    case "password":
      return `<div class="${cls}">${label}<span class="aff pw"><input id="${id}" type="password" autocomplete="off" placeholder="${esc(ph)}" value="${esc(bad ? "" : v)}"${inv}><button type="button" class="ib" data-pw aria-label="Show password" aria-pressed="false">${icon("eye", "on")}${icon("eyeoff", "off")}</button></span>${err}</div>`;
    case "email":
      return `<div class="${cls}">${label}<input id="${id}" type="email" inputmode="email" autocomplete="off" placeholder="${esc(ph)}" value="${esc(bad ? "" : v)}"${inv}>${err}</div>`;
    case "time": {
      // a time field holds 24-hour "HH:MM"; "9:30 AM" is read into it
      const m = /(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i.exec(v);
      const h = m ? (+m[1]! % 12) + (m[3] && /^p/i.test(m[3]) ? 12 : m[3] ? 0 : Math.floor(+m[1]! / 12) * 12) : 0;
      return `<div class="${cls}">${label}<input id="${id}" type="time" value="${m && !bad ? `${String(h).padStart(2, "0")}:${m[2]}` : ""}"${inv}>${err}</div>`;
    }
    case "daterange": {
      const [a = "", b = ""] = v.split(/\s+(?:-|–|—|to)\s+/);
      const [pa = "Start date", pb = "End date"] = ph.split(/\s+(?:-|–|—|to)\s+/);
      return `<div class="${cls} wide">${label}<span class="aff dr">${icon("calendar")}<input id="${id}" type="text" aria-label="Start date" placeholder="${esc(pa)}" value="${esc(bad ? "" : a)}"${inv}><i aria-hidden="true">→</i><input type="text" aria-label="End date" placeholder="${esc(pb)}" value="${esc(bad ? "" : b)}"${inv}></span>${err}</div>`;
    }
    case "multiselect": case "combobox": {
      // type to filter the options; a multiselect keeps each pick as a chip, a combobox takes one
      const multi = f.kind === "multiselect", picked = multi ? v.split(/\s*,\s*/).filter(Boolean) : [];
      const chips = multi ? picked.map((o) => `<span class="mc">${esc(o)}<button type="button" data-unchip aria-label="Remove ${esc(o)}">${icon("close")}</button></span>`).join("") : "";
      const list = opts.map((o) => `<li role="option" aria-selected="${multi ? picked.includes(o) : o === v}">${esc(o)}${icon("check")}</li>`).join("");
      return `<div class="${cls} wide">${label}<span class="aff cbx${multi ? " multi" : ""}" data-cbx>${chips}<input id="${id}" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}l" autocomplete="off" placeholder="${esc(ph || (multi ? "Add…" : "Type to search"))}" value="${esc(multi || bad ? "" : v)}"${inv}>${icon("chevd")}<ul class="lb" id="${id}l" role="listbox"${multi ? ' aria-multiselectable="true"' : ""} hidden>${list}</ul></span>${err}</div>`;
    }
    case "consent":
      return `<div class="${cls} wide consent"><label class="opt"><input id="${id}" type="checkbox"${!bad && /^(yes|true|on|checked|agreed?)$/i.test(v) ? " checked" : ""}${inv}><span>${lab}</span></label>${err}</div>`;
    default:
      return undefined;
  }
}

type Block<T extends MockBlock["type"]> = Extract<MockBlock, { type: T }>;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TONE_ICON: Record<string, string> = { ok: "checkc", warn: "clock", bad: "alert", info: "bell" };

/** A month to pick a day in, bookings or events on its days, and the picked day's times beside it. */
function calendarBlock(b: Block<"calendar">): string {
  const marks = new Map<number, Block<"calendar">["marks"]>();
  for (const m of b.marks) if (m.day <= b.days) marks.set(m.day, [...(marks.get(m.day) ?? []), m]);
  const off = new Set(b.off), picked = b.picked && b.picked <= b.days && !off.has(b.picked) ? b.picked : undefined;
  // labelled events read as chips on a wide screen and as dots on a phone; unlabelled marks are dots on both
  const labelled = b.marks.some((m) => m.label);
  const cells = Array.from({ length: b.days }, (_, i) => {
    const d = i + 1, ms = marks.get(d) ?? [], wd = (b.startsOn + i) % 7;
    const cls = ["cd", off.has(d) ? "off" : "", d === picked ? "on" : "", market.weekend.includes(wd) ? "we" : ""].filter(Boolean).join(" ");
    const ev = ms.length ? `${labelled ? `<span class="evs">${ms.slice(0, 2).map((m) => `<em class="${m.tone}">${esc(m.label ?? "")}</em>`).join("")}${ms.length > 2 ? `<em class="more">+${ms.length - 2}</em>` : ""}</span>` : ""}<span class="cdots">${ms.slice(0, 3).map((m) => `<i class="${m.tone}"></i>`).join("")}</span>` : "";
    return `<button type="button" class="${cls}" data-day="${d}" data-wd="${wd}"${off.has(d) ? " disabled" : ""} aria-pressed="${d === picked}" aria-label="${esc(`${WEEK[wd]} ${d}${ms.length ? `, ${ms.length} booked` : ""}`)}"><b>${d}</b>${ev}</button>`;
  });
  const grid = `<div class="cgrid${labelled ? " lab" : ""}">${[...WEEK.slice(market.start), ...WEEK.slice(0, market.start)].map((w) => `<span class="cwd">${w}</span>`).join("")}${'<span class="cd pad"></span>'.repeat((b.startsOn - market.start + 7) % 7)}${cells.join("")}</div>`;
  const head = `<div class="calh"><b>${esc(b.month)}</b><span class="row"><button type="button" class="ib" data-mon aria-label="Previous month">${icon("chevl")}</button><button type="button" class="ib" data-mon aria-label="Next month">${icon("chevr")}</button></span></div>`;
  const taken = new Set(b.taken);
  const day = picked ? `${WEEK[(b.startsOn + picked - 1) % 7]} ${picked}` : "";
  const slots = b.times?.length ? `<div class="slots"><h5>Times on <span class="sday">${esc(day || b.month)}</span></h5><div class="sl">${b.times.map((t) => `<button type="button" class="slot${t === b.time ? " on" : ""}"${taken.has(t) ? " disabled" : ""} aria-pressed="${t === b.time}">${esc(t)}</button>`).join("")}</div></div>` : "";
  return `<div class="card cal${slots ? " wt" : ""}"><div>${head}${grid}</div>${slots}</div>`;
}

/** Places on a drawn street map, with the list of them beside it; a route joins them in order. Drawn from the place names, the same each build. */
function mapBlock(b: Block<"map">): string {
  let s = Math.abs(hash(b.area ?? b.pins.map((p) => p.label).join("|"))) || 5;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const W = 600, H = 360;
  const minor = [...Array.from({ length: 11 }, (_, i) => `M${Math.round(i * 58 + r() * 20)} 0 L${Math.round(i * 58 + r() * 40 - 10)} ${H}`), ...Array.from({ length: 7 }, (_, i) => `M0 ${Math.round(i * 56 + r() * 20)} L${W} ${Math.round(i * 56 + r() * 30 - 5)}`)].join(" ");
  const ry = 90 + r() * 180, rx = 140 + r() * 320;
  const major = `M-10 ${Math.round(ry)} C ${W * 0.3} ${Math.round(ry - 60 + r() * 120)} ${W * 0.6} ${Math.round(ry - 60 + r() * 120)} ${W + 10} ${Math.round(ry + r() * 60 - 30)} M${Math.round(rx)} -10 C ${Math.round(rx + r() * 80 - 40)} ${H * 0.4} ${Math.round(rx + r() * 80 - 40)} ${H * 0.6} ${Math.round(rx + r() * 120 - 60)} ${H + 10}`;
  const river = `M-10 ${Math.round(H * (0.6 + r() * 0.3))} C ${W * 0.25} ${Math.round(H * (0.5 + r() * 0.4))} ${W * 0.55} ${Math.round(H * (0.75 + r() * 0.2))} ${W + 10} ${Math.round(H * (0.62 + r() * 0.3))}`;
  const parks = Array.from({ length: 3 }, () => `<rect class="pk" x="${Math.round(r() * (W - 120))}" y="${Math.round(r() * (H - 90))}" width="${Math.round(60 + r() * 70)}" height="${Math.round(40 + r() * 50)}" rx="10"/>`).join("");
  // the pins spread over the map (a low-discrepancy sequence), clear of the edges and the zoom buttons
  const ox = r(), oy = r();
  const at = b.pins.map((_, i) => [Math.round((10 + 74 * ((ox + i * 0.7548776662) % 1)) * 10) / 10, Math.round((14 + 70 * ((oy + i * 0.5698402910) % 1)) * 10) / 10] as const);
  const route = b.route && at.length > 1 ? `<path class="rt" d="${at.map(([x, y], i) => `${i ? "L" : "M"}${(x * W) / 100} ${(y * H) / 100}`).join(" ")}" vector-effect="non-scaling-stroke"/>` : "";
  const mark = (i: number) => (b.route ? `${i + 1}` : icon("pin"));
  const pins = b.pins.map((p, i) => `<button type="button" class="mp ${p.tone}${i === 0 ? " on" : ""}" data-pin="${i}" style="left:${at[i]![0]}%;top:${at[i]![1]}%" aria-label="${esc(p.label)}"><span>${mark(i)}</span></button>`).join("");
  const list = `<ol class="mpl">${b.pins.map((p, i) => `<li class="mpi${i === 0 ? " on" : ""}" data-pin="${i}"><span class="mpn ${p.tone}">${mark(i)}</span><div class="lt"><b>${esc(p.label)}</b>${p.meta ? `<span class="meta">${esc(p.meta)}</span>` : ""}</div></li>`).join("")}</ol>`;
  const svg = `<svg class="mbg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><rect class="ld" width="${W}" height="${H}"/>${parks}<path class="rv" d="${river}" vector-effect="non-scaling-stroke"/><path class="mn" d="${minor}" vector-effect="non-scaling-stroke"/><path class="mj" d="${major}" vector-effect="non-scaling-stroke"/>${route}</svg>`;
  return `<div class="card mapc"><div class="mapv" role="img" aria-label="${esc(`Map${b.area ? ` of ${b.area}` : ""}: ${b.pins.map((p) => p.label).join(", ")}`)}">${svg}${pins}<span class="mz"><button type="button" class="ib" aria-label="Zoom in">${icon("plus")}</button><button type="button" class="ib" aria-label="Zoom out">−</button></span>${b.area ? `<span class="marea">${icon("pin")}${esc(b.area)}</span>` : ""}</div>${list}</div>`;
}

/** Pictures: one large with thumbnails that swap into it, or a wall of equal tiles. */
function galleryBlock(b: Block<"gallery">, page: string): string {
  const pic = (i: number) => scene(b.items[i]!.caption, page, uid(), i, look.imagery);
  if (b.layout === "grid") return `<div class="gal grid">${b.items.map((it, i) => `<figure class="gi">${pic(i)}<figcaption>${esc(it.caption)}</figcaption></figure>`).join("")}</div>`;
  const thumbs = b.items.slice(0, 5), more = b.items.length - thumbs.length;
  return `<div class="gal hero"><figure class="gm">${pic(0)}<figcaption>${esc(b.items[0]!.caption)}</figcaption><span class="gc"><b>1</b> / ${b.items.length}</span></figure><div class="gt">${thumbs.map((it, i) => `<button type="button" class="gth${i === 0 ? " on" : ""}" data-g="${i + 1}" aria-label="${esc(it.caption)}">${pic(i)}${i === thumbs.length - 1 && more > 0 ? `<span class="gmore">+${more}</span>` : ""}</button>`).join("")}</div></div>`;
}

/** A drop zone and the files added to it: done, still uploading, or failed with a retry. */
function uploadBlock(b: Block<"upload">): string {
  const row = (f: Block<"upload">["files"][number]) => {
    const ext = (/\.([a-z0-9]{2,4})$/i.exec(f.name)?.[1] ?? "file").toUpperCase();
    const p = f.status === "done" ? 100 : Math.max(4, Math.min(96, f.progress ?? (f.status === "failed" ? 40 : 62)));
    const st = f.status === "done" ? `${icon("checkc")}Uploaded` : f.status === "failed" ? `${icon("alert")}Failed` : `${Math.round(p)}%`;
    return `<li class="uf ${f.status}"><span class="fx">${esc(ext)}</span><div class="ut"><div class="row sp"><b>${esc(f.name)}</b><span class="us">${st}</span></div><span class="meta">${esc(f.size)}</span>${f.status === "done" ? "" : `<span class="ubar"><i style="width:${p}%"></i></span>`}</div>${f.status === "failed" ? `<button type="button" class="ib" data-retry aria-label="Try again">${icon("refresh")}</button>` : ""}<button type="button" class="ib" data-rm aria-label="Remove ${esc(f.name)}">${icon("close")}</button></li>`;
  };
  return `<div class="card upl"><b class="fl">${esc(b.label)}</b><div class="drop" tabindex="0" role="button" aria-label="${esc(`${b.label}: drag files here or browse`)}"><span class="up">${icon("upload")}</span><span><b>Drag files here or <span class="lnk">browse</span></b>${b.hint ? `<span class="meta">${esc(b.hint)}</span>` : ""}</span></div>${b.files.length ? `<ul class="ufl">${b.files.map(row).join("")}</ul>` : ""}</div>`;
}

/** A conversation: the other side on the left, the user's messages on the brand colour, suggested replies, and a box to write in. */
function chatBlock(b: Block<"chat">): string {
  const live = /\b(online|active now|available)\b/i.test(b.meta ?? "");
  const msgs = b.messages.map((m) => `<div class="msg ${m.from === "me" ? "mine" : "theirs"}"><p>${esc(m.text)}</p>${m.time ? `<time>${esc(m.time)}</time>` : ""}</div>`).join("");
  return `<div class="card chat"><div class="chh">${avatar(b.with)}<div class="lt"><b>${esc(b.with)}</b>${b.meta ? `<span class="meta${live ? " live" : ""}">${esc(b.meta)}</span>` : ""}</div><button type="button" class="ib" aria-label="Call ${esc(b.with)}">${icon("phone")}</button></div><div class="msgs" role="log" aria-label="${esc(`Conversation with ${b.with}`)}">${msgs}</div>${b.quick?.length ? `<div class="qr">${b.quick.map((q) => `<button type="button" class="qrc" data-say>${esc(q)}</button>`).join("")}</div>` : ""}<form class="cmp" onsubmit="return false"><button type="button" class="ib" aria-label="Attach a file">${icon("link")}</button><input type="text" placeholder="${esc(b.placeholder ?? "Write a message")}" aria-label="Message"><button type="submit" class="ib send" aria-label="Send">${icon("send")}</button></form></div>`;
}

/** Work moving through stages: a column per stage with its count, cards dragged between them. */
function kanbanBlock(b: Block<"kanban">): string {
  const card = (k: Block<"kanban">["columns"][number]["cards"][number]) => {
    const [who, ...rest] = (k.meta ?? "").split(/\s+·\s+/);
    const person = !!who && PERSON.test(who.trim());
    const meta = k.meta ? `<span class="kmeta">${person ? `${avatar(who!)}<span>${esc(rest.join(" · ") || who!)}</span>` : `<span>${esc(k.meta)}</span>`}</span>` : "";
    return `<article class="kc" draggable="true" tabindex="0"><b>${esc(k.title)}</b>${meta || k.badge ? `<div class="row sp">${meta}${k.badge ? `<span class="badge ${tone(k.badge)}">${esc(k.badge)}</span>` : ""}</div>` : ""}</article>`;
  };
  return `<div class="kb" style="--cols:${b.columns.length}">${b.columns.map((c) => `<section class="kcol" aria-label="${esc(c.title)}"><header><b>${esc(c.title)}</b><span class="kn">${c.cards.length}</span></header><div class="kl">${c.cards.map(card).join("")}</div></section>`).join("")}</div>`;
}

/** Plans side by side, the featured one raised; the period switch swaps every price. */
function plansBlock(b: Block<"plans">): string {
  const per = b.periods?.length === 2;
  return `<div class="plans">${per ? `<div class="pper">${segs(b.periods!, "Billing period")}${b.note ? `<span class="badge ok">${esc(b.note)}</span>` : ""}</div>` : ""}<div class="pgrid" style="--n:${b.items.length}">${b.items.map((p) => `<div class="card plan${p.featured ? " ft" : ""}">${p.badge ? `<span class="pbadge">${esc(p.badge)}</span>` : ""}<b class="pn">${esc(p.name)}</b>${p.blurb ? `<span class="meta">${esc(p.blurb)}</span>` : ""}<div class="pp"><strong data-p0="${esc(p.price)}" data-p1="${esc(p.alt ?? p.price)}">${esc(p.price)}</strong>${p.per ? `<span>${esc(p.per)}</span>` : ""}</div><button type="button" class="btn${p.featured ? " primary" : ""}" data-act="act">${btnLabel(p.cta)}</button><ul class="pf">${p.features.map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("")}</ul></div>`).join("")}</div></div>`;
}

const stars = (v: number, cls = ""): string => `<span class="stars${cls}" style="--p:${Math.round((Math.max(0, Math.min(5, v)) / 5) * 1000) / 10}%" role="img" aria-label="${v} out of 5">★★★★★</span>`;
/** A rating: the average, its stars and count, the share at each star, and the reviews themselves. */
function reviewsBlock(b: Block<"reviews">): string {
  const bars = b.bars ? `<ul class="rbars">${b.bars.map((p, i) => `<li><span>${5 - i}</span><i><s style="width:${Math.max(0, Math.min(100, p))}%"></s></i><em>${Math.round(p)}%</em></li>`).join("")}</ul>` : "";
  const list = b.items.map((r) => `<article class="rv"><div class="rvh">${avatar(r.name)}<div class="lt"><b>${esc(r.name)}</b>${r.time || r.tag ? `<span class="meta">${esc([r.time, r.tag].filter(Boolean).join(" · "))}</span>` : ""}</div>${stars(r.rating, " sm")}</div><p>${esc(r.text)}</p></article>`).join("");
  return `<div class="card revs"><div class="rsum"><strong>${b.score.toFixed(1)}</strong>${stars(b.score)}<span class="meta">${esc(b.count)}</span>${bars}</div><div class="rvl">${list}</div></div>`;
}

/** What happened for the user, in groups, unread first to the eye; read all, or show only the unread. */
function notificationsBlock(b: Block<"notifications">): string {
  const groups = [...new Set(b.items.map((n) => n.group?.trim() ?? ""))];
  const unread = b.items.filter((n) => n.unread).length;
  const row = (n: Block<"notifications">["items"][number]) => `<div class="nt${n.unread ? " un" : ""}"><span class="nti ${n.tone}">${icon(n.tone === "info" ? iconFor(`${n.title} ${n.meta ?? ""}`) || "bell" : TONE_ICON[n.tone]!)}</span><div class="lt"><b>${esc(n.title)}</b>${n.meta ? `<span class="meta">${esc(n.meta)}</span>` : ""}</div><time>${esc(n.time)}</time></div>`;
  return `<div class="card ntf"><div class="nth"><b>Notifications</b>${unread ? `<span class="kn">${unread} new</span>` : ""}<span class="sp"></span>${segs(["All", "Unread"], "Show")}${unread ? '<button type="button" class="lnk" data-readall>Mark all as read</button>' : ""}</div>${groups.map((g) => `${g ? `<h5>${esc(g)}</h5>` : ""}${b.items.filter((n) => (n.group?.trim() ?? "") === g).map(row).join("")}`).join("")}</div>`;
}

/** Search results with their filters beside them (behind a Filters button on a phone), the picked ones as chips, and a sort. */
function resultsBlock(b: Block<"results">, page: string): string {
  const picked = b.facets.flatMap((f) => (f.kind === "range" ? [] : f.picked.filter((p) => f.options.includes(p))));
  const facet = (f: Block<"results">["facets"][number], i: number) => {
    if (f.kind === "range") return fieldHtml({ label: f.title, kind: "slider", options: [f.options[0]!, f.options[f.options.length - 1]!], value: f.picked[0] }, `rg${Math.abs(hash(f.title + i))}`, false, `<label>${esc(f.title)}</label>`, "", "field fct") ?? "";
    return `<fieldset class="fct"><legend>${esc(f.title)}</legend>${f.options.map((o) => `<label class="fo"><input type="checkbox" value="${esc(o)}"${f.picked.includes(o) ? " checked" : ""}><span>${esc(o)}</span></label>`).join("")}</fieldset>`;
  };
  const side = `<div class="rside"><div class="row sp"><b>Filters</b><button type="button" class="lnk" data-clearf${picked.length ? "" : " hidden"}>Clear all</button></div>${b.facets.map(facet).join("")}</div>`;
  const head = `<div class="rhead"><div class="rq"><b>${esc(b.count)}</b>${b.query ? `<span class="meta">for “${esc(b.query)}”</span>` : ""}</div><button type="button" class="btn fbtn" data-ftoggle aria-expanded="false">${icon("filter")}<span>Filters</span><em${picked.length ? "" : " hidden"}>${picked.length}</em></button>${b.sort?.length ? `<span class="sel srt"><select aria-label="Sort by">${b.sort.map((o) => `<option>${esc(o)}</option>`).join("")}</select>${icon("chevd")}</span>` : ""}</div>`;
  const chips = `<div class="pkd">${picked.map((p) => `<button type="button" class="pkc" data-unpick="${esc(p)}">${esc(p)}${icon("close")}</button>`).join("")}</div>`;
  const items = b.items.map((it, i) => `<article class="ri${b.visual ? " vis" : ""}">${b.visual ? scene(`${it.title} ${it.meta}`, page, uid(), i, look.imagery) : `<span class="chipi">${icon(iconFor(`${it.title} ${it.meta}`) || iconFor(page) || "layers")}</span>`}<div class="lt"><b>${esc(it.title)}</b><span class="meta">${esc(it.meta)}</span>${it.badge ? `<span class="badge ${tone(it.badge)}">${esc(it.badge)}</span>` : ""}</div>${it.price ? `<strong class="rp">${esc(it.price)}</strong>` : icon("chevr", "chev")}</article>`).join("");
  return `<div class="res">${side}<div class="rmain">${head}${chips}<div class="card rlist">${items}</div></div></div>`;
}

const YES = /^(yes|y|✓|✔|included|true)$/i, NO = /^(no|n|—|–|-|✗|×|none|not included|false)$/i;
/** Things compared feature by feature, a tick or a dash where the answer is yes or no, the featured one tinted. */
function compareBlock(b: Block<"compare">): string {
  const ft = (i: number) => (b.items[i]?.featured ? ' class="ft"' : "");
  const cell = (v: string) => (YES.test(v.trim()) ? `<span class="yes" role="img" aria-label="Yes">${icon("check")}</span>` : NO.test(v.trim()) ? '<span class="no" role="img" aria-label="No">—</span>' : esc(v));
  const head = `<tr><th><span class="vh">Feature</span></th>${b.items.map((it, i) => `<th${ft(i)}><b>${esc(it.name)}</b>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}</th>`).join("")}</tr>`;
  const rows = b.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${b.items.map((_, i) => `<td${ft(i)}>${cell(r.values[i] ?? "")}</td>`).join("")}</tr>`).join("");
  const foot = b.cta ? `<tfoot><tr><td></td>${b.items.map((it, i) => `<td${ft(i)}><button type="button" class="btn${it.featured ? " primary" : ""}" data-act="act">${btnLabel(b.cta!)}</button></td>`).join("")}</tr></tfoot>` : "";
  return `<div class="card cmpb"><div class="scroll"><table><thead>${head}</thead><tbody>${rows}</tbody>${foot}</table></div></div>`;
}

/** A receipt or invoice as a document: its number and status, who from and to, the facts, the lines, and the totals with the amount due last. */
function receiptBlock(b: Block<"receipt">): string {
  const qty = b.lines.some((l) => l.qty);
  const parties = b.from || b.to ? `<div class="rpty">${b.from ? `<div><span class="k">From</span><span>${esc(b.from)}</span></div>` : ""}${b.to ? `<div><span class="k">To</span><span>${esc(b.to)}</span></div>` : ""}</div>` : "";
  const facts = b.facts.length ? `<dl class="rfx">${b.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("")}</dl>` : "";
  const lines = `<table><thead><tr><th>Item</th>${qty ? '<th class="n">Qty</th>' : ""}<th class="n">Amount</th></tr></thead><tbody>${b.lines.map((l) => `<tr><td>${esc(l.item)}</td>${qty ? `<td class="n">${esc(l.qty ?? "")}</td>` : ""}<td class="n">${esc(l.amount)}</td></tr>`).join("")}</tbody></table>`;
  const totals = `<dl class="rtot">${b.totals.map((t, i) => `<div${i === b.totals.length - 1 ? ' class="due"' : ""}><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join("")}</dl>`;
  return `<div class="card rcpt"><div class="rch"><span class="chipi">${icon("receipt")}</span><b>${esc(b.title)}</b>${b.status ? `<span class="badge ${tone(b.status)}">${esc(b.status)}</span>` : ""}</div>${parties}${facts}${lines}${totals}${b.note ? `<p class="rnote">${esc(b.note)}</p>` : ""}</div>`;
}

/** One block drawn from its sample content; `page` is the page's own words, which pick the pictures on cards. */
/** A drawn block marked with its type (`data-b`), so the rendered page can be read back for the reference layout check. */
const marked = (html: string, type: string): string => html.replace(/^<(\w+)/, `<$1 data-b="${type}"`);

/**
 * A table's footer: how many rows, and a pager. One page of many has working Previous and Next buttons and the page numbers
 * around the one shown (the first and last always, gaps as "…").
 */
function pager(rows: number, pages = 1, at = 1): string {
  const n = Math.max(1, pages), p = Math.min(Math.max(1, at), n);
  if (n < 2) return `<div class="tfoot"><span>${rows} ${rows === 1 ? "result" : "results"}</span><span class="pager"><button type="button" class="ib" aria-label="Previous page" disabled>${icon("chevl")}</button><b>1</b><button type="button" class="ib" aria-label="Next page" disabled>${icon("chevr")}</button></span></div>`;
  const nums = [...new Set([1, p - 1, p, p + 1, n].filter((x) => x >= 1 && x <= n))].sort((a, b) => a - b);
  const list = nums.map((x, i) => `${i && x - nums[i - 1]! > 1 ? '<i class="gap">…</i>' : ""}<button type="button" class="pg${x === p ? " on" : ""}" data-page="${x}"${x === p ? ' aria-current="page"' : ""} aria-label="Page ${x}">${x}</button>`).join("");
  return `<div class="tfoot"><span class="pgof">Page <b class="pn">${p}</b> of ${n}</span><nav class="pager" aria-label="Pages" data-pages="${n}"><button type="button" class="ib" data-page="prev" aria-label="Previous page"${p === 1 ? " disabled" : ""}>${icon("chevl")}</button>${list}<button type="button" class="ib" data-page="next" aria-label="Next page"${p === n ? " disabled" : ""}>${icon("chevr")}</button></nav></div>`;
}

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
      const bulk = b.bulk?.length ? `<div class="bulk"${ticked ? "" : " hidden"}><b><span class="bn">${ticked}</span> selected</b><span class="bb">${b.bulk.map((t, i) => buttonHtml(t, i === 0)).join("")}</span><button type="button" class="lnk" data-clear>Clear</button></div>` : "";
      return `<div class="card tbl">${bulk}<div class="scroll"><table><thead><tr>${pick ? `<th class="ck"><input type="checkbox" aria-label="Select all"${ticked && ticked >= rows.length ? " checked" : ""}></th>` : ""}${b.columns.map(th).join("")}<th class="act"><span class="vh">Actions</span></th></tr></thead><tbody>${rows.map((r, ri) => `<tr${ri < ticked ? ' class="picked"' : ""}>${pick ? `<td class="ck"><input type="checkbox" aria-label="Select ${esc(r[0] ?? "row")}"${ri < ticked ? " checked" : ""}></td>` : ""}${b.columns.map((_, i) => {
        const v = r[i] ?? "";
        const cell = sc === i ? `<span class="badge ${tone(v)}">${esc(v)}</span>` : i === 0 && person && v ? `<span class="who">${avatar(v)}${esc(v)}</span>` : i === 0 && code ? `<span class="code">${esc(v)}</span>` : esc(v);
        const key = sortBy === undefined ? "" : ` data-v="${esc(String(sortKey(v)))}"`;
        return `<td${isNum[i] ? ' class="n"' : i === 0 ? ' class="first"' : ""}${key}>${cell}</td>`;
      }).join("")}<td class="act"><button type="button" class="ib" aria-label="More">${icon("more")}</button></td></tr>`).join("")}</tbody></table></div>${pager(b.rows.length, b.pages, b.page)}</div>`;
    }
    case "form": {
      // the validation state flags the fields the design gave an error for and the required ones left empty (at most two); with
      // neither, the typed-in fields left empty, or the first one when all are filled. A disabled or read-only field is never flagged.
      const open = (f: FormField) => !f.disabled && !f.readOnly;
      const typed = b.fields.map((f, i) => (CHOSEN.has(f.kind) || f.kind === "consent" || !open(f) ? -1 : i)).filter((i) => i >= 0);
      const told = b.fields.map((f, i) => (open(f) && (f.error || (f.required && !f.value)) ? i : -1)).filter((i) => i >= 0);
      const blank = typed.filter((i) => !b.fields[i]!.value);
      const flagged = new Set(told.length ? told.slice(0, 2) : (blank.length ? blank : typed).slice(0, blank.length ? 2 : 1));
      return `<form class="card form" onsubmit="return false" novalidate>${b.fields.map((f, i) => {
        const bad = k === "validation" && flagged.has(i);
        const id = `f${Math.abs(hash(f.label + i))}`;
        // the label carries the required mark and a tooltip; help sits under the field, the error under that
        const tip = f.hint ? withTip(`<button type="button" class="ib tipb" aria-label="About ${esc(f.label)}">${icon("info")}</button>`, f.hint) : "";
        const lab = `${esc(f.label)}${f.required ? '<span class="req" aria-hidden="true">*</span>' : ""}`;
        const label = `<span class="lr"><label for="${id}">${lab}</label>${tip}</span>`;
        const help = f.help ? `<span class="help" id="${id}h">${esc(f.help)}</span>` : "";
        const err = (help) + (bad ? `<span class="err" role="alert" id="${id}e">${icon("alert")}${esc(f.error ?? (f.kind === "consent" ? "Tick this to continue" : `Enter ${f.label.toLowerCase()}`))}</span>` : "");
        const cls = `field${bad ? " bad" : ""}${f.kind === "textarea" ? " wide" : ""}${f.disabled ? " off" : ""}${f.readOnly ? " ro" : ""}`;
        const html = (() => {
          if (f.kind === "select") return `<div class="${cls}">${label}<span class="sel"><select id="${id}">${(f.options?.length ? f.options : [f.value ?? f.placeholder ?? "Select"]).map((o) => `<option${o === f.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>${icon("chevd")}</span>${err}</div>`;
          if (f.kind === "textarea") return `<div class="${cls}">${label}<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder ?? "")}">${esc(f.value ?? "")}</textarea>${err}</div>`;
          if (f.kind === "toggle") return `<div class="field tog wide${f.disabled ? " off" : ""}">${label}<input id="${id}" type="checkbox" role="switch"${f.value && !/^(no|off|false)$/i.test(f.value) ? " checked" : ""}>${help}</div>`;
          return fieldHtml(f, id, bad, label, err, cls, lab)
            ?? `<div class="${cls}">${label}<input id="${id}" type="${f.kind === "date" ? "date" : "text"}" placeholder="${esc(f.placeholder ?? "")}" value="${esc(bad ? "" : f.value ?? "")}"${bad ? ' aria-invalid="true"' : ""}>${err}</div>`;
        })();
        // the field's own control takes its state: required, not editable, and what describes it
        const desc = [f.help ? `${id}h` : "", bad ? `${id}e` : ""].filter(Boolean).join(" ");
        const more = `${f.required ? " required" : ""}${f.disabled ? " disabled" : ""}${f.readOnly ? " readonly" : ""}${desc ? ` aria-describedby="${desc}"` : ""}`;
        return more ? html.replace(` id="${id}"`, ` id="${id}"${more}`) : html;
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
      return `<div class="card detail ${b.style}">${b.title || b.lead ? `<div class="dh">${b.title ? `<b>${esc(b.title)}</b>` : ""}${b.lead ? `<div><span class="k">${esc(b.lead.label)}</span><strong>${esc(b.lead.value)}</strong></div>` : ""}</div>` : ""}<dl>${b.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${r.badge ? `<span class="badge ${tone(r.value)}">${esc(r.value)}</span>` : esc(r.value)}</dd></div>`).join("")}</dl>${b.people?.length ? `<div class="dppl">${people(b.people)}<span class="meta">${esc(b.people.length === 1 ? b.people[0]! : `${b.people[0]} and ${b.people.length - 1} more`)}</span></div>` : ""}${b.style === "pass" ? `<div class="tear" aria-hidden="true"></div>${barcode(seed)}` : ""}</div>`;
    }
    case "cards": {
      const n = b.items.length, cols = n % 4 === 0 ? 4 : n % 3 === 0 || n > 4 ? 3 : n;
      // the price or headline figure in a card's line reads first, as it does on a real listing
      const meta = (m: string) => m.split(/\s+·\s+/).map((part) => (/(?:[$€£¥₹₨]|PKR|USD|AED|SAR|Rs\.?)\s?\d|\d\s?(?:\/night|per night|\/mo)/i.test(part) ? `<b class="price">${esc(part)}</b>` : esc(part))).join('<span class="sep">·</span>');
      return `<div class="cards${b.visual ? " vis" : ""}" style="--cols:${cols}">${b.items.map((it, i) => {
        const badge = it.badge ? `<span class="badge ${tone(it.badge)}">${esc(it.badge)}</span>` : "";
        if (!b.visual) { const ic = iconFor(`${it.title} ${it.meta}`) || iconFor(page) || "layers"; return `<div class="card item"><div class="row sp"><span class="chipi">${icon(ic)}</span>${badge}</div><b>${esc(it.title)}</b><span class="meta">${meta(it.meta)}</span>${people(it.people)}</div>`; }
        return `<div class="card item">${scene(`${it.title} ${it.meta} ${it.badge ?? ""}`, page, uid(), i, look.imagery)}${it.badge ? `<span class="ontop">${badge}</span>` : ""}<button type="button" class="fav" aria-label="Save">${icon("heart")}</button><div class="ib-body"><div class="row sp"><b>${esc(it.title)}</b>${icon("arrowr", "go")}</div><span class="meta">${meta(it.meta)}</span>${people(it.people)}</div></div>`;
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
        return `<div class="li">${lead}<div class="lt"><b>${esc(it.title)}</b><span class="meta">${esc(rest)}</span>${people(it.people)}</div>${it.badge ? `<span class="badge ${tone(it.badge)}">${esc(it.badge)}</span>` : ""}${amt ? `<span class="amt ${/^[+]/.test(amt) ? "in" : /^[-−]/.test(amt) ? "out" : ""}">${esc(amt)}</span>` : icon("chevr", "chev")}</div>`;
      }).join("")}</div>`;
    case "actions":
      return `<div class="row">${b.buttons.map((t, i) => buttonHtml(t, i === 0)).join("")}</div>`;
    case "alert": {
      const ic = { info: "info", ok: "checkc", warn: "alert", bad: "alert" }[b.tone];
      return `<div class="banner ${b.tone} alert" role="${b.tone === "bad" || b.tone === "warn" ? "alert" : "status"}"><span class="bi">${icon(ic)}</span><span class="at">${b.title ? `<b>${esc(b.title)}</b>` : ""}<span>${esc(b.text)}</span></span>${b.action ? `<button type="button" class="btn" data-act="act">${btnLabel(b.action)}</button>` : ""}</div>`;
    }
    case "toolbar": {
      const sel = b.selects.map((x) => `<label class="tsel"><span>${esc(x.label)}</span><span class="sel"><select aria-label="${esc(x.label)}">${x.options.map((o) => `<option${o === x.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>${icon("chevd")}</span></label>`).join("");
      return `<div class="tbar">${b.search ? `<label class="search">${icon("search")}<input type="search" placeholder="${esc(b.search)}" aria-label="${esc(b.search)}"></label>` : ""}${sel}${b.buttons.length ? `<span class="tbb">${b.buttons.map((x) => buttonHtml(x, false)).join("")}</span>` : ""}</div>`;
    }
    case "progress":
      return `<div class="card prgs">${b.title ? `<h4>${esc(b.title)}</h4>` : ""}${b.items.map((it) => {
        const v = Math.round(Math.max(0, Math.min(100, it.value)));
        return `<div class="pi"><div class="row sp"><span class="pl">${esc(it.label)}</span><b>${v}%</b></div><span class="meter${v >= 100 ? " full" : ""}" role="progressbar" aria-label="${esc(it.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><i style="width:${v}%"></i></span>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}</div>`;
      }).join("")}</div>`;
    case "calendar": return calendarBlock(b);
    case "map": return mapBlock(b);
    case "gallery": return galleryBlock(b, page);
    case "upload": return uploadBlock(b);
    case "chat": return chatBlock(b);
    case "kanban": return kanbanBlock(b);
    case "plans": return plansBlock(b);
    case "reviews": return reviewsBlock(b);
    case "notifications": return notificationsBlock(b);
    case "results": return resultsBlock(b, page);
    case "compare": return compareBlock(b);
    case "receipt": return receiptBlock(b);
    default:
      return `<p class="lead">${esc(b.body)}</p>`;
  }
}

const DANGER = /\b(delete|remove|cancel|freeze|block|revoke|deactivate|close account|discard|reject|refund|sign out|log out)\b/i;
/** A layer over the page, open or ready to open from the button it names. */
function renderOverlay(o: MockOverlay, open: boolean, page: string): string {
  const form = o.blocks.find((b) => b.type === "form");
  const acts: Button[] = o.kind === "menu" ? [] : o.actions.length ? o.actions : form?.type === "form" ? [form.submit] : o.kind === "popover" ? [] : ["Done"];
  const primary = acts[0], second: Button | undefined = acts[1] ?? (o.kind === "confirm" || form ? "Cancel" : undefined);
  const plainDanger = typeof primary === "string" && DANGER.test(primary);
  const danger = primary !== undefined && (plainDanger || (typeof primary !== "string" && primary.variant === "danger"));
  const main = primary === undefined ? "" : typeof primary === "string" ? `<button type="button" class="btn primary${danger ? " danger" : ""}">${btnLabel(primary)}</button>` : buttonHtml(primary, true, "ov");
  const foot = primary !== undefined ? `<div class="ova">${second !== undefined ? (typeof second === "string" ? `<button type="button" class="btn">${esc(second)}</button>` : buttonHtml(second, false, "ov")) : ""}${main}</div>` : "";
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
  // a booking calendar beside its form or summary, a conversation beside the record it is about, a receipt beside its timeline
  if ((a.type === "calendar" && (b.type === "form" || SIDE.has(b.type))) || (a.type === "chat" && b.type === "detail") || (a.type === "receipt" && (b.type === "timeline" || b.type === "detail"))) return "wl";
  if (((a.type === "form" || SIDE.has(a.type)) && b.type === "calendar") || (a.type === "detail" && b.type === "chat") || ((a.type === "timeline" || a.type === "detail") && b.type === "receipt")) return "wr";
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
    if ((b.type === "filters" || b.type === "toolbar") && nx?.type === "table") { out.push(draw(nx).replace(/^(<div[^>]* class="card tbl"[^>]*>)/, (m) => `${m}<div class="toolbar">${draw(b)}</div>`)); i++; continue; }
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
  const keep = (b: MockBlock) => b.type === "filters" || b.type === "toolbar" || b.type === "actions" || b.type === "alert" || b.type === "stats" || b.type === "text";
  const normal = compose(m.blocks, (b) => marked(renderBlock(b, k, words), b.type));
  // a trail of the pages above this one (a narrow screen shows only a back link to the nearest), and the page's own tabs under its title
  const crumbs = m.crumbs?.length ? `<nav class="crumbs" aria-label="Breadcrumb"><span class="back">${icon("chevl")}${esc(m.crumbs[m.crumbs.length - 1]!)}</span>${m.crumbs.map((c) => `<span class="c">${esc(c)}</span>${icon("chevr")}`).join("")}<span aria-current="page">${esc(m.title)}</span></nav>` : "";
  const tabs = m.tabs?.length ? `<div class="ptabs" role="tablist">${m.tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}"${i === 0 ? ' class="on"' : ""}>${esc(t)}</button>`).join("")}</div>` : "";
  const head = (actions: string) => `<div class="ph"><div>${crumbs}${m.badge ? `<div class="tt"><h3>${esc(m.title)}</h3><span class="badge ${tone(m.badge)}">${esc(m.badge)}</span></div>` : `<h3>${esc(m.title)}</h3>`}${m.subtitle ? `<p class="sub">${esc(m.subtitle)}</p>` : ""}</div>${actions ? `<div class="pa">${actions}</div>` : ""}${tabs}</div>`;
  let body: string;
  // loading keeps everything static (title, labels, headers, filters, buttons) and turns only the data into shimmering shapes, under a progress bar;
  // empty previews what the page fills with; error keeps the last good data dimmed behind the message; "Full data" is a state of its own
  if (k === "loading") body = `<div class="prog" role="progressbar" aria-label="Loading"><i></i></div>${compose(m.blocks, skeleton).body}`;
  else if (k === "empty") {
    const lead = m.blocks.filter((b) => b.type === "filters" || b.type === "toolbar").map((b) => renderBlock(b, k, words)).join("");
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

/** A family name for the front of a font stack; only plain names (code measured them, but they end up in CSS). */
const fam = (f?: string): string => (f && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/.test(f) ? `"${f}",` : "");

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
    // a match reference's own faces go first (they show where installed); the style's faces stand behind them
    font: fam(t.families?.body) + FONTS[t.font],
    head: { family: t.families?.heading ? fam(t.families.heading) + (head[0] === "inherit" ? FONTS[t.font] : head[0]) : head[0], weight: head[1], tracking: head[2] },
    ease: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.34,1.4,.64,1)", rise: t.motion === "calm" ? 6 : 10,
  };
}

/** The page's colour variables from the chosen theme (a bad or absent theme gives the default). */
export function themeCss(theme?: DesignTheme): string {
  const v = themeValues(theme), t = v.theme;
  const set = (dark: boolean): string => `${Object.entries(v.colours(dark)).map(([k, c]) => `--${k}:${c}`).join(";")};--shadow:${v.shadow(dark)};--lift:${v.lift(dark)};--blur:${v.blur}`;
  const shared = `--r:${v.radius}px;--pad:${v.pad}px;--row:${v.row}px;--font:${v.font};--head:${v.head.family === "inherit" ? v.font : v.head.family};--hw:${v.head.weight};--hls:${v.head.tracking};--e:${v.ease};--spring:${v.spring};--rise:${v.rise}px;--drift:${t.motion === "calm" ? "paused" : "running"}`;
  // both modes: the system's choice first, then the one picked with the frame's switch
  return t.mode === "auto" ? `:root{${shared};${set(false)}}@media(prefers-color-scheme:dark){:root{${set(true)}}}:root[data-mode=light]{color-scheme:light;${set(false)}}:root[data-mode=dark]{color-scheme:dark;${set(true)}}` : `:root{${shared};${set(t.mode === "dark")}}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;color:var(--ink);background:var(--bg);overflow-x:hidden}
h1,h2,h3,h4{font-family:var(--head)}
button{font:inherit;color:inherit}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* the walkthrough around the product */
aside{width:260px;flex:none;padding:22px 16px;border-inline-end:1px solid var(--edge);background:var(--sf2);}
aside h1{font-size:15px;margin:0 0 6px;letter-spacing:-.01em}
aside p{color:var(--mut);font-size:12.5px;margin:.2rem 0 1rem}aside h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:1.4rem 0 .5rem;font-family:var(--font)}
aside ul{list-style:none;padding:0;margin:0;display:grid;gap:2px}
aside a{display:block;padding:7px 10px;border-radius:8px;color:var(--ink2);text-decoration:none;transition:background .15s,color .15s}
aside a:hover{background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink)}
aside a.on{background:var(--sf);color:var(--ink);font-weight:600;box-shadow:0 0 0 1px var(--edge)}
aside code,.file{color:var(--mut);font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace}
aside li li{font-size:12px;color:var(--mut)}aside h3 .dv{font-weight:500;text-transform:none;letter-spacing:0;margin-inline-start:4px;opacity:.8}
main{flex:1;min-width:0;padding:22px clamp(14px,3vw,36px) 60px}
.screen:not([hidden]){animation:enter .4s var(--e) both}
@keyframes enter{from{opacity:0;transform:translateY(6px)}}
.top{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin-bottom:6px}
.top h2{margin:0;font-size:15px;font-weight:650;color:var(--ink);font-family:var(--font);display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.top h2 code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut)}.top .sid{font-size:11px;color:var(--mut);font-weight:500}.top .tag{margin-inline-start:auto}
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
.rail{width:232px;flex:none;display:flex;flex-direction:column;gap:18px;padding:16px 12px;border-inline-end:1px solid var(--edge);background:var(--sf)}
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
.tnav{display:flex;gap:2px;margin-inline-start:18px;align-self:stretch}.tnav a{border-radius:0;padding:0 12px}.tnav a:hover{color:var(--ink)}.tnav a.on{color:var(--ink);font-weight:600}
.tnav a.on:after{content:"";position:absolute;inset-inline-start:12px;inset-inline-end:12px;bottom:-1px;height:2px;border-radius:2px;background:var(--br);animation:grow-x .35s var(--e) both}@keyframes grow-x{from{transform:scaleX(.3);opacity:0}}
.bm{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:-.015em;white-space:nowrap}.bm>b{color:var(--ink)}
.logo{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--br);color:var(--on);box-shadow:inset 0 -2px 0 rgba(0,0,0,.12)}.logo svg{width:17px;height:17px;stroke-width:2.2}
.rail.brand .logo,.topbar.brand .logo{background:var(--on);color:var(--br)}
.q{display:flex;align-items:center;gap:8px;height:36px;width:min(340px,40%);padding:0 10px;border-radius:9px;background:var(--sf2);border:1px solid var(--edge);color:var(--mut);font-size:13px}.q svg{width:16px;height:16px}.q span{flex:1}
kbd{font:500 11px var(--font);border:1px solid var(--edge2);border-bottom-width:2px;border-radius:5px;padding:0 5px;color:var(--mut);background:var(--sf)}
.ib{width:34px;height:34px;display:inline-grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--ink2);cursor:pointer;position:relative;transition:background .15s,color .15s}.ib:hover:not(:disabled){background:var(--sf2);color:var(--ink)}.ib:disabled{opacity:.4;cursor:default}
.ib .dot{position:absolute;top:7px;inset-inline-end:8px;width:7px;height:7px;border-radius:50%;background:var(--bad);box-shadow:0 0 0 2px var(--sf)}
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
.dp{position:absolute;top:0;bottom:0;inset-inline-start:0;width:min(300px,84%);display:flex;flex-direction:column;gap:18px;padding:18px 12px;background:var(--sf);border-inline-end:1px solid var(--edge);box-shadow:0 20px 50px -20px rgba(0,0,0,.4);transform:translateX(-102%);transition:transform .32s var(--e)}
.dp .row{justify-content:space-between}.dp nav,.dp .rf{display:grid;gap:2px}.dp .rf{margin-top:auto}
.canvas.dopen .drawer{visibility:visible;transition:none}.canvas.dopen .scrim{opacity:1}.canvas.dopen .dp{transform:none}
.canvas .drawer{top:39px}.canvas.phone .drawer{top:46px}
.go{cursor:pointer}tr.go:hover td{background:color-mix(in srgb,var(--br) 5%,var(--sf))}.li.go:hover,.slide.go:hover b,.card.item.go:hover b{color:var(--br)}
/* slides: offers and announcements on the brand colour, or a row of pictures */
.car{display:grid;gap:12px;min-width:0}.car-h{display:flex;justify-content:space-between;align-items:center;gap:12px}.car-h h4{margin:0;font-size:16px;font-weight:650;letter-spacing:-.01em}.car-nav{display:flex;gap:6px}.car-nav .ib{border:1px solid var(--edge);background:var(--sf)}
.track{display:grid;grid-auto-flow:column;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;overscroll-behavior-x:contain;padding:2px;margin:-2px}.track::-webkit-scrollbar{display:none}.track:focus-visible{outline:2px solid var(--br);outline-offset:4px;border-radius:var(--r)}
.slide{scroll-snap-align:start;position:relative;min-width:0}
.k-media .track{grid-auto-columns:minmax(220px,calc((100% - 32px) / 3))}@container app (max-width:640px){.k-media .track{grid-auto-columns:72%}}
.k-media .slide .ib-body{display:grid;gap:3px;padding:10px 2px 0}.k-media .slide b{font-size:14.5px}.k-media .ontop{position:absolute;top:10px;inset-inline-start:10px}
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
.ovl{position:absolute;inset-inline-start:0;inset-inline-end:0;bottom:0;top:39px;z-index:5;display:none}.canvas.phone .ovl{top:46px}.ovl.open{display:block}
.ovs{position:absolute;inset:0;background:rgba(10,14,20,.42);backdrop-filter:blur(1.5px);animation:fadein .25s both}
.ovp{position:absolute;display:grid;gap:14px;padding:22px;background:var(--sf);color:var(--ink);border:1px solid var(--edge);box-shadow:0 28px 70px -24px rgba(0,0,0,.5);text-align:start}
.ovp>p{margin:0;color:var(--ink2)}.ovp .card{border:0;padding:0;box-shadow:none;background:none;backdrop-filter:none}.ovp .form .row.end{display:none}.ovp .list .li:first-child{padding-top:0}
.ovh{display:flex;justify-content:space-between;align-items:center;gap:12px}.ovh h4,.k-confirm h4{margin:0;font-size:18px;letter-spacing:-.015em;font-weight:650}.ovh .ib{margin:-6px -8px -6px 0}
.ova{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding-top:4px}
.k-modal .ovp,.k-confirm .ovp{left:50%;top:clamp(24px,10%,110px);width:min(540px,calc(100% - 32px));border-radius:calc(var(--r) + 6px);transform:translateX(-50%);animation:ovpop .32s var(--spring) both}
.k-confirm .ovp{width:min(400px,calc(100% - 32px));justify-items:center;text-align:center}.k-confirm .ova{width:100%}.k-confirm .ova .btn{flex:1}
.ci{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sf))}.ci.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 11%,var(--sf))}.ci svg{width:24px;height:24px}
@keyframes ovpop{from{opacity:0;transform:translateX(-50%) translateY(10px) scale(.97)}}
.k-drawer .ovp{top:0;inset-inline-end:0;bottom:0;width:min(440px,92%);align-content:start;border-width:0 0 0 1px;animation:from-r .34s var(--e) both}.k-drawer .ova{margin-top:8px}@keyframes from-r{from{transform:translateX(100%)}}
.k-sheet .ovp{left:50%;bottom:0;width:min(640px,100%);padding-top:10px;border-radius:24px 24px 0 0;border-bottom:0;transform:translateX(-50%);animation:from-b .34s var(--e) both}@keyframes from-b{from{transform:translate(-50%,100%)}}
.canvas.phone .k-sheet .ovp{padding-bottom:34px}.grab{width:40px;height:5px;border-radius:3px;background:var(--edge);justify-self:center;margin-bottom:2px}
.k-menu .ovs{background:transparent;backdrop-filter:none}.k-menu .ovp{top:70px;inset-inline-end:24px;width:230px;padding:6px;gap:0;border-radius:calc(var(--r) + 2px);transform-origin:top right;animation:menu .18s var(--e) both}@keyframes menu{from{opacity:0;transform:scale(.96) translateY(-4px)}}
.mlist{display:grid}.mitem{display:flex;align-items:center;gap:10px;border:0;background:none;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13.5px;font-weight:500;color:var(--ink2);text-align:start}.mitem:hover{background:var(--sf2);color:var(--ink)}.mitem svg{width:16px;height:16px;color:var(--mut)}.mitem.bad,.mitem.bad svg{color:var(--bad)}.mitem.bad{border-top:1px solid var(--edge);border-radius:0 0 8px 8px;margin-top:4px}
.btn.primary.danger{background:var(--bad);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 0 0 1px color-mix(in srgb,var(--bad) 80%,#000)}
/* where the page sits, and its own tabs */
.crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:0 0 8px;font-size:13px;color:var(--mut)}.crumbs svg{width:14px;height:14px;opacity:.55}.crumbs .c{color:var(--ink2)}.crumbs [aria-current]{color:var(--ink);font-weight:550}
.crumbs .back{display:none;align-items:center;gap:2px;color:var(--a1);font-weight:600;margin-inline-start:-4px}.crumbs .back svg{opacity:1;width:18px;height:18px}
.ptabs{flex-basis:100%;display:flex;gap:2px;margin-top:4px;border-bottom:1px solid var(--edge);overflow-x:auto;scrollbar-width:none}
.ptabs button{border:0;background:none;padding:10px 12px;color:var(--mut);font-weight:550;font-size:13.5px;cursor:pointer;position:relative;white-space:nowrap;transition:color .15s}.ptabs button:hover{color:var(--ink)}.ptabs button.on{color:var(--ink)}
.ptabs button.on:after{content:"";position:absolute;inset-inline-start:10px;inset-inline-end:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--br);animation:grow-x .35s var(--e) both}
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
th{text-align:start;font-size:12px;color:var(--mut);padding:10px 16px;font-weight:600;letter-spacing:.01em;border-bottom:1px solid var(--edge);background:var(--sf2);white-space:nowrap}
td{height:var(--row);padding:0 16px;border-bottom:1px solid var(--edge);font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink2)}tr:last-child td{border-bottom:0}
th.n,td.n{text-align:end}td.n{color:var(--ink);font-weight:500}td.first{font-weight:600;color:var(--ink)}th.act,td.act{width:44px;padding:0 8px;text-align:end}td.act .ib{opacity:0;transition:opacity .15s}tr:hover td.act .ib,tr.sel td.act .ib{opacity:1}.pane:has(.ovl.k-menu.open) tbody tr:first-child td.act .ib{opacity:1;background:var(--sf2)}
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
.sel{position:relative;display:block}.sel select{appearance:none;-webkit-appearance:none;padding-inline-end:34px}.sel svg{position:absolute;inset-inline-end:11px;top:11px;width:16px;height:16px;color:var(--mut);pointer-events:none}
.field.bad input,.field.bad select,.field.bad textarea{border-color:var(--bad);box-shadow:0 0 0 4px color-mix(in srgb,var(--bad) 12%,transparent);animation:shake .4s var(--e)}.err{display:flex;align-items:center;gap:5px;color:var(--bad);font-size:12.5px;font-weight:500}.err svg{width:14px;height:14px}
@keyframes shake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
.tog{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--edge);border-radius:9px;background:var(--sf2)}.tog input{appearance:none;width:40px;height:23px;padding:0;border-radius:99px;position:relative;cursor:pointer;background:var(--edge2);border:0;box-shadow:none;transition:background .25s}
.tog input:before{content:"";position:absolute;top:2px;inset-inline-start:2px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .3s var(--spring)}.tog input:checked{background:var(--br)}.tog input:checked:before{transform:translateX(17px)}
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
.bars .g{position:absolute;inset-inline-start:38px;inset-inline-end:0;border-top:1px solid var(--edge);pointer-events:none}.bars .g.base{border-color:var(--edge2)}.bars .g em{position:absolute;top:-8px;inset-inline-start:-38px;width:30px;text-align:end;font:500 11px var(--font);color:var(--mut);font-style:normal}
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
.ontop{position:absolute;top:12px;inset-inline-start:12px;z-index:2}.ontop .badge{background:rgba(255,255,255,.94);box-shadow:0 1px 3px rgba(0,0,0,.18);backdrop-filter:blur(6px)}
.fav{position:absolute;top:10px;inset-inline-end:10px;z-index:2;width:34px;height:34px;border-radius:50%;border:0;display:grid;place-items:center;background:rgba(255,255,255,.9);color:#1f2328;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.18);transition:transform .2s var(--spring),color .2s}.fav:hover{transform:scale(1.1)}.fav.on{color:#e11d48}.fav.on svg{fill:currentColor;animation:pop .35s var(--spring)}@keyframes pop{50%{transform:scale(1.35)}}
/* lists, steps, timeline, detail */
.list{padding:6px var(--pad)}.list .li{display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--edge)}.list .li:last-child{border:0}
.lt{flex:1;min-width:0}.lt b{display:block;font-weight:600;font-size:13.5px;line-height:1.35}.lt .meta{font-size:12.5px}
.amt{font-weight:650;font-variant-numeric:tabular-nums;font-size:13.5px;white-space:nowrap}.amt.in{color:var(--ok)}.li .chev{width:16px;height:16px;color:var(--mut)}
.steps{display:flex;gap:0;list-style:none;margin:0;padding:0;overflow:auto}.steps li{flex:1;display:flex;align-items:center;gap:10px;color:var(--mut);white-space:nowrap;min-width:max-content;padding-inline-end:14px;font-weight:500}
.steps li span{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--edge2);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none;background:var(--sf);transition:all .3s}.steps li span svg{width:14px;height:14px;stroke-width:2.6}
.steps li:not(:last-child):after{content:"";flex:1;height:2px;min-width:18px;background:var(--edge);margin-inline-start:6px;border-radius:2px}
.steps .done span{background:var(--br);border-color:var(--br);color:var(--on)}.steps .done:not(:last-child):after{background:var(--br)}.steps .done{color:var(--ink2)}.steps .now{color:var(--ink);font-weight:650}.steps .now span{border-color:var(--br);color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--br) 14%,transparent)}
.tl{display:grid;gap:0}.ev{display:grid;grid-template-columns:76px 22px 1fr;gap:12px;padding:10px 0;align-items:start;position:relative}.ev .t{color:var(--mut);font-size:12.5px;text-align:end;font-variant-numeric:tabular-nums;padding-top:2px}
.ev i{width:22px;height:22px;border-radius:50%;border:2px solid var(--edge2);background:var(--sf);position:relative;z-index:1;display:grid;place-items:center}.ev i svg{width:12px;height:12px;stroke-width:3}.ev:not(:last-child) i:after{content:"";position:absolute;inset-inline-start:8px;top:22px;width:2px;height:calc(100% + 18px);background:var(--edge)}
.ev.done i{background:var(--br);border-color:var(--br);color:var(--on)}.ev.done:not(:last-child) i:after{background:var(--br)}.ev.now i{border-color:var(--br);box-shadow:0 0 0 5px color-mix(in srgb,var(--br) 16%,transparent);animation:ring 2s ease-out infinite}.ev.now i:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--br)}.ev.next{opacity:.6}.ev b{font-weight:600}
@keyframes ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--br) 35%,transparent)}70%,100%{box-shadow:0 0 0 9px transparent}}
.detail dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px 18px}.detail dt{font-size:12px;color:var(--mut);font-weight:500}.detail dd{margin:3px 0 0;font-weight:600}
.dh{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--edge)}.dh>b{font-size:15px}.dh .k{display:block;font-size:12px;color:var(--mut);text-align:end}.dh strong{font-size:24px;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.detail.pass{padding:0;overflow:hidden}.detail.pass .dh{padding:var(--pad);margin:0;background:var(--br);color:var(--on);border:0}.detail.pass .dh .k{color:color-mix(in srgb,var(--on) 75%,transparent)}.detail.pass dl{padding:var(--pad)}
.tear{position:relative;height:0;border-top:2px dashed var(--edge2);margin:0 14px}.tear:before,.tear:after{content:"";position:absolute;top:-11px;width:20px;height:20px;border-radius:50%;background:var(--bg);box-shadow:inset 0 0 0 1px var(--edge)}.tear:before{inset-inline-start:-25px}.tear:after{inset-inline-end:-25px}
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
.toast{position:fixed;inset-inline-end:20px;bottom:20px;z-index:9;display:flex;gap:10px;align-items:center;padding:11px 16px;border-radius:10px;background:var(--ink);color:var(--bg);font-weight:500;box-shadow:0 16px 40px -12px rgba(0,0,0,.45);animation:toast 3s var(--e) forwards}.toast svg{color:var(--ok)}
@keyframes toast{0%{opacity:0;transform:translateY(16px) scale(.96)}10%,85%{opacity:1;transform:none}100%{opacity:0;transform:translateY(8px)}}
.serves{margin-top:16px;border:1px solid var(--edge);border-radius:10px;background:var(--sf);padding:12px 16px}.serves summary{cursor:pointer;color:var(--mut);font-size:12.5px}
.serves ul{margin:.6rem 0 0;padding-inline-start:18px;color:var(--mut);font-size:12.5px}.serves b{color:var(--ink)}
.nav{margin:14px 0 0;display:flex;flex-wrap:wrap;gap:8px}.nav a{color:var(--a1);text-decoration:none;font-size:12.5px;border-bottom:1px solid transparent}.nav a:hover{border-color:currentColor}
/* the frame the theme chose: a contained column for sites, a narrow one for a single task */
.wrap{width:100%;max-width:1160px;margin:0 auto}.canvas.sh-minimal .wrap{max-width:860px}
.topbar>.wrap{display:flex;align-items:center;gap:10px;align-self:stretch}
.help{display:inline-flex;align-items:center;gap:6px;color:var(--ink2);text-decoration:none;font-weight:500;font-size:13.5px;margin-inline-end:6px}.help svg{width:16px;height:16px}.topbar.brand .help{color:var(--on)}
.sh-minimal .ph{text-align:start}.sh-minimal .shell,.sh-minimal .stage{min-height:520px}
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
.swb{display:flex;align-items:center;gap:9px;border:1px solid var(--edge);background:var(--sf);color:var(--ink);border-radius:calc(var(--r) - 2px);padding:5px 9px 5px 5px;cursor:pointer;min-width:0;max-width:220px;text-align:start;transition:background .15s,border-color .15s}
.swb:hover{background:var(--sf2);border-color:var(--edge2)}.swb>svg{width:15px;height:15px;color:var(--mut);flex:none}
.swa{width:26px;height:26px;border-radius:calc(var(--r) - 4px);display:grid;place-items:center;flex:none;font-size:11px;font-weight:700;letter-spacing:.02em;background:color-mix(in srgb,var(--a1) 12%,var(--sf));color:var(--a1)}
.r-round .swa{border-radius:50%}
.swt{display:grid;min-width:0;line-height:1.2}.swt b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.swt small{font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rail .sw{margin:-6px 0 0}.rail .swb{width:100%;max-width:none}
.rail.brand .swb,.topbar.brand .swb{background:color-mix(in srgb,var(--on) 12%,transparent);border-color:color-mix(in srgb,var(--on) 20%,transparent);color:var(--on)}.rail.brand .swb>svg,.topbar.brand .swb>svg,.rail.brand .swt small,.topbar.brand .swt small{color:color-mix(in srgb,var(--on) 70%,transparent)}
.swm{position:absolute;top:calc(100% + 6px);inset-inline-start:0;z-index:6;min-width:220px;display:grid;gap:2px;padding:6px;border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);color:var(--ink);box-shadow:0 18px 40px -16px rgba(16,24,40,.32);animation:ovpop .18s var(--e)}
.swm[hidden]{display:none}.topbar .swm{inset-inline-start:auto;inset-inline-end:0}.topbar .nb{align-items:center;gap:10px}.topbar .nb .swm{inset-inline-start:0;inset-inline-end:auto}
.swm small{padding:4px 8px 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.swm button{display:flex;align-items:center;gap:10px;border:0;background:none;padding:7px 8px;border-radius:calc(var(--r) - 3px);cursor:pointer;text-align:start;font-size:13px;color:var(--ink)}
.swm button:hover{background:var(--sf2)}.swm button span:not(.swa){flex:1}.swm button>svg{width:15px;height:15px;color:var(--a1)}.swm button.on{font-weight:600}
/* a segmented control: one of a few views or periods */
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:calc(var(--r) - 1px);background:var(--sf2);border:1px solid var(--edge);flex:none;margin-inline-start:auto}
.seg button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:5px 11px;border-radius:calc(var(--r) - 4px);font-size:12.5px;font-weight:550;color:var(--mut);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}
.seg button svg{width:14px;height:14px}.seg button:hover{color:var(--ink)}
.seg button.on{background:var(--sf);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.1),0 0 0 1px var(--edge)}
.r-round .seg,.r-round .seg button{border-radius:99px}.r-sharp .seg,.r-sharp .seg button{border-radius:3px}
.ch .seg{margin-inline-start:0}
/* an accordion: sections opened one at a time */
.acc{padding:4px var(--pad)}.acc h4{margin:12px 0 4px;font-size:15px}
.acc details{border-bottom:1px solid var(--edge)}.acc details:last-child{border-bottom:0}
.acc summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;cursor:pointer;list-style:none;font-weight:600;font-size:14px}
.acc summary::-webkit-details-marker{display:none}.acc summary svg{width:17px;height:17px;color:var(--mut);flex:none;transition:transform .25s var(--e)}
.acc details[open] summary svg{transform:rotate(180deg);color:var(--a1)}
.acc details p{margin:-4px 0 14px;color:var(--ink2);font-size:13.5px;line-height:1.6;max-width:68ch;animation:fadein .3s ease}
/* a toast in its own tab stays in view, over the page and above a phone's tab bar */
.toast.pin{position:absolute;left:50%;inset-inline-end:auto;bottom:24px;width:max-content;max-width:calc(100% - 32px);transform:translateX(-50%);animation:toastin .45s var(--spring) both;z-index:6}
.canvas.phone .toast.pin{bottom:96px}
.toast span{min-width:0}.toast .lnk{padding:0 0 0 6px;color:color-mix(in srgb,var(--a1) 55%,var(--bg));font-size:13px}
.toast.bad svg{color:var(--bad)}.toast.info svg{color:color-mix(in srgb,var(--a1) 60%,var(--bg))}
@keyframes toastin{from{opacity:0;transform:translate(-50%,16px) scale(.96)}to{opacity:1;transform:translateX(-50%)}}
/* a line chart is drawn twice, wide and narrow; the frame's width shows one */
/* the unused line chart is hidden without display:none, which would restart its draw-in whenever the frame is resized (a full-page screenshot does) */
.chart svg.lc-n{position:absolute;visibility:hidden;width:0;height:0;overflow:hidden}
@container app (max-width:900px){.rail .swt,.rail .swb>svg{display:none}.rail .swb{padding:5px;justify-content:center}.rail h5:not(:first-of-type){display:block;height:1px;margin:8px 10px;background:var(--edge);font-size:0}.split.wl,.split.wr,.split.eq{grid-template-columns:1fr}.rail{width:64px;padding:16px 10px}.rail a span,.rail h5,.rail .bm>b{display:none}.rail a{justify-content:center}.q{display:none}}
@media(max-width:760px){body{display:block}aside{width:auto;border-inline-end:0;border-bottom:1px solid var(--edge)}}
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
.dleg li{display:grid;grid-template-columns:10px minmax(0,1fr) auto 48px;align-items:center;gap:10px;font-size:13px}.dleg i{width:10px;height:10px;border-radius:3px}.dleg span{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dleg b{font-variant-numeric:tabular-nums;font-weight:650}.dleg em{font-style:normal;color:var(--mut);text-align:end;font-variant-numeric:tabular-nums}
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
.num input{text-align:center;font-variant-numeric:tabular-nums}.num .ib{flex:none;width:40px;height:38px;border-radius:0;font-size:17px;color:var(--ink2)}.num .ib:first-child{border-inline-end:1px solid var(--edge)}.num .ib:last-child{border-inline-start:1px solid var(--edge)}
.aff>b{flex:none;padding:0 2px 0 12px;font-weight:600;color:var(--mut);font-size:13px}.aff.srch>svg{flex:none;margin-inline-start:11px;width:16px;height:16px;color:var(--mut)}.aff.srch>svg:last-of-type{margin:0 11px 0 0}
.aff.phone .cc{flex:none;height:100%;border-inline-end:1px solid var(--edge);background:var(--sf2)}.field .aff.phone .cc select{width:auto;padding:0 28px 0 12px;font-variant-numeric:tabular-nums}.aff.phone .cc svg{inset-inline-end:8px}
.field.bad .num,.field.bad .aff,.cardin.bad,.field.bad .otp input{border-color:var(--bad);box-shadow:0 0 0 4px color-mix(in srgb,var(--bad) 12%,transparent)}
.otp{display:flex;gap:8px}.field .otp input{flex:1;max-width:50px;min-width:0;height:52px;padding:0;text-align:center;font:650 20px var(--font);font-variant-numeric:tabular-nums}
.rng{display:flex;align-items:center;gap:14px;height:40px}.field .rng input{flex:1;height:6px;padding:0;border:0;border-radius:99px;appearance:none;-webkit-appearance:none;background:linear-gradient(90deg,var(--a1) var(--p),var(--sf2) var(--p));box-shadow:none}
.rng input::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--sf);border:2px solid var(--a1);box-shadow:0 1px 3px rgba(16,24,40,.2);cursor:pointer}.rng input::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--sf);border:2px solid var(--a1)}
.rng output{min-width:72px;text-align:end;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.rngl{display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-top:-6px}
.cardin>svg{flex:none;margin-inline-start:12px;color:var(--mut)}.field .cardin input:first-of-type{flex:1}.field .cardin input:not(:first-of-type){flex:none;width:80px;border-inline-start:1px solid var(--edge);text-align:center}
/* a table that sorts, and rows ticked for a bulk action */
th[aria-sort]{padding-top:0;padding-bottom:0;height:38px}.sh{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;font:inherit;color:inherit;letter-spacing:inherit;cursor:pointer}th.n .sh{flex-direction:row-reverse}
.sh svg{width:13px;height:13px;opacity:0;transition:opacity .15s,transform .15s}.sh:hover svg{opacity:.5}th[aria-sort=ascending],th[aria-sort=descending]{color:var(--ink)}th[aria-sort=ascending] .sh svg,th[aria-sort=descending] .sh svg{opacity:1;color:var(--a1)}.sh svg.flip{transform:rotate(180deg)}
th.ck,td.ck{width:44px;padding-inline-end:0}tr.picked td{background:color-mix(in srgb,var(--a1) 6%,var(--sf))}
.bulk{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;background:color-mix(in srgb,var(--a1) 8%,var(--sf));border-bottom:1px solid color-mix(in srgb,var(--a1) 22%,var(--edge));font-size:13px;animation:enter .25s var(--e)}.bulk[hidden]{display:none}
.bulk .bb{display:flex;gap:8px;margin-inline-start:auto}.bulk .btn{height:32px;padding:0 12px;font-size:12.5px}
@container app (max-width:640px){.bulk{flex-wrap:wrap}.bulk .bb{margin-inline-start:0;width:100%}.bulk .bb .btn{flex:1;justify-content:center}.dn{justify-content:center}.field .cardin input:not(:first-of-type){width:72px;padding:0 6px}.cardin input:last-of-type{width:56px}.chart svg.lc-w{position:absolute;visibility:hidden;width:0;height:0;overflow:hidden}.chart svg.lc-n{position:static;visibility:visible;width:100%;height:auto;overflow:visible}.topbar .swt{display:none}.topbar .swb{padding:4px 6px 4px 4px}.seg{margin-inline-start:0}.ch{flex-wrap:wrap}
.rail,.tnav{display:none}.shell{flex-direction:column;min-height:0}.topbar{height:54px}.tabbar{display:flex}
.crumbs>:not(.back){display:none}.crumbs .back{display:inline-flex}.topbar .nb{display:flex}.stage:has(>.tabbar) .toast.pin{bottom:92px}
.pane{--px:14px;padding:18px 14px 24px}.ph .pa{width:100%}.ph .pa .btn{flex:1;justify-content:center}.form{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stats>.stat:last-child:nth-child(odd){grid-column:1/-1}.stat .v{font-size:22px}.spark{display:none}.search{min-width:0;flex:1}.toolbar .filters{flex-direction:column;align-items:stretch}.chips{overflow:auto;flex-wrap:nowrap}.bars{padding-inline-start:30px}.bars .g{inset-inline-start:30px}.bars .g em{inset-inline-start:-30px;width:24px}}
/* the parts of products a field is known for: calendar, map, gallery, upload, chat, kanban, plans, reviews, notifications, results, compare, receipt */
/* the times sit beside the month while both fit, and under it in a narrow column (beside a form, or on a phone) */
.cal{display:grid;gap:22px}.cal.wt{display:flex;flex-wrap:wrap;align-items:flex-start}.cal.wt>*{flex:1 1 190px;min-width:0}.cal.wt>:first-child{flex:1.7 1 300px}
.calh{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.calh b{font:var(--hw) 16px var(--head);letter-spacing:var(--hls)}.calh .row{gap:2px}
.cgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.cgrid .cwd{font-size:11.5px;font-weight:600;color:var(--mut);text-align:center;padding:2px 0 6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cd{position:relative;display:grid;justify-items:center;align-content:start;gap:3px;min-height:48px;min-width:0;padding:6px 2px 4px;border:0;border-radius:calc(var(--r) - 2px);background:none;cursor:pointer;font-variant-numeric:tabular-nums}
.cd b{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;font-weight:550;font-size:13.5px;transition:background .15s,color .15s}
.cd:hover:not(:disabled) b{background:var(--sf2)}.cd.we{color:var(--ink2)}.cd.off{color:var(--mut);opacity:.45;cursor:default}.cd.off b{text-decoration:line-through}.cd.pad{min-height:0;cursor:default}
.cd.on b,.cd.on:hover b{background:var(--br);color:var(--on);box-shadow:0 0 0 4px color-mix(in srgb,var(--br) 16%,transparent)}
.cgrid.lab .cd{min-height:86px;justify-items:stretch;padding:4px;border:1px solid var(--edge)}.cgrid.lab .cd.pad{border-color:transparent}.cgrid.lab .cd b{justify-self:start;width:26px;height:26px;font-size:12.5px}
.evs{display:grid;gap:2px;min-width:0}.evs em{font-style:normal;font-size:11px;font-weight:600;line-height:1.3;padding:2px 5px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start;color:var(--a1);background:color-mix(in srgb,var(--a1) 10%,var(--sf))}
.evs em.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 11%,var(--sf))}.evs em.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--sf))}.evs em.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,var(--sf))}.evs em.more{color:var(--mut);background:none}
.cdots{display:flex;gap:3px;justify-content:center;height:5px}.cdots i{width:5px;height:5px;border-radius:50%;background:var(--a1)}.cdots i.ok{background:var(--ok)}.cdots i.warn{background:var(--warn)}.cdots i.bad{background:var(--bad)}.cgrid.lab .cdots{display:none}
.cal .sk.cd{height:42px;margin:0}
.slots h5{margin:4px 0 12px;font-size:13px;font-weight:600;color:var(--ink2)}.slots h5 span{color:var(--ink)}
.sl{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.slot{height:38px;border:1px solid var(--edge2);border-radius:calc(var(--r) - 2px);background:var(--sf);color:var(--ink);font-weight:600;font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer;transition:background .15s,border-color .15s,color .15s}.slot:hover:not(:disabled){border-color:var(--a1);color:var(--a1)}
.slot.on,.slot.on:hover{background:var(--br);border-color:var(--br);color:var(--on)}.slot:disabled{color:var(--mut);background:var(--sf2);text-decoration:line-through;cursor:default;opacity:.7}
.mapc{padding:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.8fr) minmax(220px,1fr)}
.mapv{position:relative;min-height:340px;background:var(--sf2);overflow:hidden}.mapc>.sk.mapv{display:block;margin:0;border-radius:0}
.mbg{position:absolute;inset:0;width:100%;height:100%;stroke:none}.mbg .ld{fill:color-mix(in srgb,var(--sf2),var(--ink) 5%)}.mbg .pk{fill:color-mix(in srgb,#5bbf7a 28%,var(--sf2))}
.mbg path{fill:none}.mbg .rv{stroke:color-mix(in srgb,#5aa9e6 42%,var(--sf2));stroke-width:20}.mbg .mn{stroke:var(--sf);stroke-width:3}.mbg .mj{stroke:var(--sf);stroke-width:7}
.mbg .rt{stroke:var(--a1);stroke-width:4;stroke-linejoin:round;opacity:.85}
.mp{position:absolute;width:30px;height:30px;padding:0;border:2px solid #fff;border-radius:50% 50% 50% 0;background:var(--a1);color:#fff;display:grid;place-items:center;cursor:pointer;translate:-50% -118%;rotate:-45deg;box-shadow:0 4px 10px -2px rgba(0,0,0,.35);transition:scale .2s var(--spring);z-index:1}
.mp span{rotate:45deg;display:grid;place-items:center;font:700 12px var(--font)}.mp .pd{width:8px;height:8px;border-radius:50%;background:#fff}
.mp.ok,.mpn.ok{background:var(--ok)}.mp.warn,.mpn.warn{background:var(--warn)}.mp.bad,.mpn.bad{background:var(--bad)}.mp.on{scale:1.22;z-index:2}
.mz{position:absolute;top:12px;inset-inline-end:12px;display:grid;border-radius:10px;background:var(--sf);box-shadow:0 2px 8px rgba(0,0,0,.18);overflow:hidden;z-index:3}.mz .ib{border-radius:0;font-size:18px}.mz .ib+.ib{border-top:1px solid var(--edge)}
.marea{position:absolute;inset-inline-start:12px;bottom:12px;display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:99px;background:var(--sf);box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:12.5px;font-weight:600;z-index:3}.marea svg{width:14px;height:14px;color:var(--a1)}
.mpl{list-style:none;margin:0;padding:6px 0;border-inline-start:1px solid var(--edge);max-height:420px;overflow:auto}.mpl .li{padding:10px var(--pad)}
.mpi{display:flex;gap:12px;align-items:center;padding:10px var(--pad);cursor:pointer;box-shadow:inset 3px 0 0 transparent;transition:background .15s,box-shadow .15s}.mpi:hover{background:var(--sf2)}.mpi.on{background:color-mix(in srgb,var(--a1) 6%,var(--sf));box-shadow:inset 3px 0 0 var(--a1)}
.mpn{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;font-weight:700;font-size:12px;color:#fff;background:var(--a1)}.mpn svg{width:14px;height:14px;stroke-width:2.2}
.gal figure{margin:0;position:relative}.gal.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.gal.grid .sk{margin:0}.gi figcaption{font-size:12.5px;color:var(--ink2);padding:7px 2px 0}
.gal.hero{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,1fr);gap:12px;min-width:0}.gm{min-width:0}.gm .pic{aspect-ratio:16/10;width:100%}
.gm figcaption,.gc{position:absolute;bottom:12px;padding:5px 10px;border-radius:8px;background:rgba(10,14,20,.6);color:#fff;font-size:12.5px;font-weight:550;backdrop-filter:blur(6px);z-index:1}.gm figcaption{inset-inline-start:12px;max-width:calc(100% - 100px)}.gc{inset-inline-end:12px;border-radius:99px;font-variant-numeric:tabular-nums}.gc b{font-weight:700}
.gt{display:grid;grid-auto-rows:minmax(0,1fr);gap:10px;contain:size;min-width:0}.gth{display:block;position:relative;min-width:0;padding:0;border:0;background:none;cursor:pointer;border-radius:calc(var(--r) + 2px);opacity:.72;transition:opacity .2s,box-shadow .2s}
.gth .pic{aspect-ratio:auto;height:100%;width:100%;border-radius:inherit}.gth:hover{opacity:1}.gth.on{opacity:1;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--a1)}
.gmore{position:absolute;inset:0;display:grid;place-items:center;border-radius:inherit;background:rgba(10,14,20,.66);color:#fff;font-weight:700;font-size:18px;z-index:1}
.upl{display:grid;gap:12px}.upl .fl{font-size:13px;font-weight:600}
.drop{display:flex;align-items:center;gap:14px;padding:20px;border:1.5px dashed var(--edge2);border-radius:var(--r);background:var(--sf2);cursor:pointer;transition:border-color .15s,background .15s}.drop:hover,.drop.over{border-color:var(--a1);background:color-mix(in srgb,var(--a1) 5%,var(--sf))}
.drop>span:last-child{display:grid;gap:2px;min-width:0}.drop b{font-weight:600}.drop .lnk{padding:0;display:inline}
.up{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;flex:none;background:var(--sf);color:var(--a1);box-shadow:var(--shadow);border:1px solid var(--edge)}
.ufl{list-style:none;margin:0;padding:0;display:grid;gap:8px}.uf{display:flex;align-items:center;gap:12px;padding:10px 8px 10px 12px;border:1px solid var(--edge);border-radius:calc(var(--r) - 2px);background:var(--sf)}
.fx{width:36px;height:44px;flex:none;display:grid;place-items:end center;padding-bottom:6px;border-radius:6px;font:700 9.5px var(--font);letter-spacing:.04em;color:var(--a1);background:color-mix(in srgb,var(--a1) 9%,var(--sf));border:1px solid color-mix(in srgb,var(--a1) 20%,var(--edge))}
.ut{flex:1;min-width:0;display:grid;gap:2px}.ut .row b{min-width:0;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ut .meta{font-size:12px}
.us{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--mut);white-space:nowrap;font-variant-numeric:tabular-nums}.us svg{width:14px;height:14px}.uf.done .us{color:var(--ok)}.uf.failed .us{color:var(--bad)}.uf.failed{border-color:color-mix(in srgb,var(--bad) 35%,var(--edge))}
.ubar{display:block;height:4px;border-radius:4px;background:var(--sf2);overflow:hidden;margin-top:4px}.ubar i{display:block;height:100%;border-radius:4px;background:var(--a1);transition:width .3s var(--e)}.uf.failed .ubar i{background:var(--bad)}.uf .ib{width:30px;height:30px}
.chat{padding:0;display:flex;flex-direction:column;overflow:hidden}
.chh{display:flex;align-items:center;gap:12px;padding:12px var(--pad);border-bottom:1px solid var(--edge)}.chh .av{width:38px;height:38px;font-size:13px}.chh .lt b{font-size:14.5px}
.chh .meta.live{color:var(--ok);display:inline-flex;align-items:center;gap:6px}.chh .meta.live:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.msgs{display:flex;flex-direction:column;gap:10px;padding:16px var(--pad);max-height:420px;overflow:auto;background:color-mix(in srgb,var(--sf2) 55%,var(--sf))}
.msg{display:grid;gap:3px;max-width:min(80%,460px);justify-items:start}.msg.mine{align-self:flex-end;justify-items:end}
.msg p{margin:0;padding:9px 13px;border-radius:16px 16px 16px 5px;background:var(--sf);border:1px solid var(--edge);color:var(--ink);line-height:1.45;font-size:13.5px;box-shadow:var(--shadow)}
.msg.mine p{background:var(--br);color:var(--on);border-color:transparent;border-radius:16px 16px 5px 16px}.msg time{font-size:11px;color:var(--mut);padding:0 4px}.msg.new{animation:rise .3s var(--e) both}
.qr{display:flex;gap:8px;padding:10px var(--pad) 0;overflow-x:auto;scrollbar-width:none}.qrc{flex:none;border:1px solid color-mix(in srgb,var(--a1) 35%,var(--edge));background:var(--sf);color:var(--a1);border-radius:99px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer}.qrc:hover{background:color-mix(in srgb,var(--a1) 7%,var(--sf))}
.cmp{display:flex;align-items:center;gap:6px;padding:10px}.cmp input{flex:1;min-width:0;height:40px;border:1px solid var(--edge2);border-radius:99px;padding:0 14px;background:var(--sf2);color:var(--ink);font:inherit;outline:0}.cmp input:focus{border-color:var(--a1);background:var(--sf)}
.cmp .send,.cmp .send:hover:not(:disabled){background:var(--br);color:var(--on);border-radius:50%;width:40px;height:40px}
.kb{display:grid;grid-template-columns:repeat(var(--cols),minmax(220px,1fr));gap:14px;overflow-x:auto;padding-bottom:4px;align-items:start}
.kcol{background:var(--sf2);border:1px solid var(--edge);border-radius:calc(var(--r) + 2px);padding:10px;display:grid;gap:10px;align-content:start;min-height:180px;transition:background .15s,border-color .15s}
.kcol header{display:flex;align-items:center;gap:8px;padding:2px 4px}.kcol header b{font-size:13px;font-weight:650}.kn{font-size:11.5px;font-weight:700;color:var(--mut);background:var(--sf);border:1px solid var(--edge);border-radius:99px;padding:0 8px;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap}
.kl{display:grid;gap:8px;min-height:40px}.kc{display:grid;gap:8px;padding:12px;border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);box-shadow:var(--shadow);cursor:grab;transition:box-shadow .2s,opacity .2s}.kc:hover{box-shadow:var(--lift)}.kc>b{font-size:13.5px;font-weight:600;line-height:1.35}.kc .sk{margin:2px 0}
.kc.drag{opacity:.4}.kcol.over{background:color-mix(in srgb,var(--a1) 7%,var(--sf2));border-color:color-mix(in srgb,var(--a1) 40%,var(--edge))}.kc .row.sp{gap:8px}
.kmeta{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--mut);min-width:0}.kmeta .av{width:22px;height:22px;font-size:9px}.kmeta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plans{display:grid;gap:22px}.pper{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}.pper .seg{margin:0}
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;align-items:stretch}
.plan{display:flex;flex-direction:column;gap:10px;position:relative;padding:calc(var(--pad) + 4px)}.plan.ft{border:2px solid var(--br);box-shadow:var(--lift)}
.pbadge{position:absolute;top:-11px;left:50%;transform:translateX(-50%);padding:2px 12px;border-radius:99px;background:var(--br);color:var(--on);font-size:11.5px;font-weight:700;white-space:nowrap}.plan:not(.ft) .pbadge{background:var(--sf2);color:var(--ink2);border:1px solid var(--edge)}
.pn{font:var(--hw) 17px var(--head);letter-spacing:var(--hls)}.pp{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px;margin:4px 0 2px}.pp strong{font:700 30px var(--head);letter-spacing:-.03em;font-variant-numeric:tabular-nums}.pp span{color:var(--mut);font-size:13px}
.plan .btn{width:100%}.pf{list-style:none;margin:6px 0 0;padding:14px 0 0;border-top:1px solid var(--edge);display:grid;gap:9px}.pf li{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;color:var(--ink2)}.pf svg{width:16px;height:16px;color:var(--ok);stroke-width:2.4;margin-top:2px}
.revs{--star:#f5a524;display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);gap:28px;align-items:start}
.rsum{display:grid;gap:6px;justify-items:start}.rsum strong{font:700 44px/1 var(--head);letter-spacing:-.03em}
.stars{font-size:18px;letter-spacing:2px;line-height:1;background:linear-gradient(90deg,var(--star,#f5a524) var(--p),var(--edge2) var(--p));-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}.stars.sm{font-size:13px;letter-spacing:1px;margin-inline-start:auto}
.rbars{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px;width:100%}.rbars li{display:grid;grid-template-columns:12px minmax(0,1fr) 36px;gap:8px;align-items:center;font-size:12px;color:var(--mut);font-variant-numeric:tabular-nums}
.rbars i{height:7px;border-radius:7px;background:var(--sf2);overflow:hidden}.rbars s{display:block;height:100%;background:var(--star);border-radius:7px}.rbars em{font-style:normal;text-align:end}
.rvl{display:grid}.rv{padding:14px 0;border-bottom:1px solid var(--edge)}.rv:first-child{padding-top:0}.rv:last-child{border:0;padding-bottom:0}
.rvh{display:flex;align-items:center;gap:10px}.rvh .lt b{font-size:13.5px}.rv p{margin:8px 0 0;color:var(--ink2);font-size:13.5px;line-height:1.55}
.ntf{padding:6px 0}.nth{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px var(--pad) 12px;border-bottom:1px solid var(--edge)}.nth>b{font:var(--hw) 15px var(--head);letter-spacing:var(--hls)}.nth .sp{flex:1}.nth .seg{margin:0}.nth .lnk{padding:0}
.ntf h5{margin:0;padding:12px var(--pad) 4px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);font-weight:600}
.nt{display:flex;gap:12px;align-items:flex-start;padding:12px var(--pad);position:relative;cursor:pointer;transition:background .15s}.nt:hover{background:var(--sf2)}
.nt.un{background:color-mix(in srgb,var(--a1) 4%,var(--sf))}.nt.un .lt b{font-weight:700}.nt.un:after{content:"";position:absolute;inset-inline-end:calc(var(--pad) - 4px);top:50%;width:8px;height:8px;border-radius:50%;background:var(--a1);transform:translateY(-50%)}
.nt .lt b{font-weight:550;font-size:13.5px}.nt time{font-size:12px;color:var(--mut);white-space:nowrap;padding-inline-end:14px}.ntf.only .nt:not(.un){display:none}
.nti{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none;color:var(--a1);background:color-mix(in srgb,var(--a1) 10%,var(--sf))}.nti svg{width:17px;height:17px}
.nti.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 11%,var(--sf))}.nti.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--sf))}.nti.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,var(--sf))}
.res{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:start}
.rside{display:grid;gap:18px;padding:var(--pad);border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);box-shadow:var(--shadow)}.rside>.row b{font-size:14px}.rside .lnk{padding:0}.rside .lnk[hidden]{display:none}
.fct{border:0;margin:0;padding:0;display:grid;gap:9px;min-width:0}.fct legend,.field.fct label{font-size:11.5px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);padding:0}.fct legend{margin-bottom:9px}
.fo{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink2);cursor:pointer}.fo input{width:16px;height:16px;margin:0;accent-color:var(--a1)}.field.fct .rng output{min-width:0}
.rmain{display:grid;gap:12px;min-width:0}.rhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.rq{flex:1;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}.rq b{font-size:15px}.rq .meta{display:inline}
.fbtn{display:none}.fbtn em{font-style:normal;min-width:20px;height:20px;border-radius:99px;background:var(--br);color:var(--on);font-size:11px;display:grid;place-items:center;padding:0 5px}.fbtn em[hidden]{display:none}
.srt select{height:36px;border:1px solid var(--edge2);border-radius:9px;background:var(--sf);color:var(--ink);font:inherit;font-size:13px;padding:0 32px 0 12px;appearance:none;-webkit-appearance:none}.srt svg{top:10px}
.pkd{display:flex;gap:6px;flex-wrap:wrap}.pkd:empty{display:none}.pkc{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 12px;border:1px solid color-mix(in srgb,var(--a1) 30%,var(--edge));border-radius:99px;background:color-mix(in srgb,var(--a1) 7%,var(--sf));color:var(--ink);font-size:12.5px;font-weight:550;cursor:pointer}.pkc svg{width:13px;height:13px;color:var(--mut)}
.rlist{padding:0 var(--pad);transition:opacity .2s}.rmain.dim .rlist{opacity:.35}.ri{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--edge)}.ri:last-child{border:0}
.ri .lt{display:grid;gap:3px;justify-items:start}.ri .lt b{font-size:14px}.ri.vis .pic{width:120px;flex:none;aspect-ratio:4/3}.rp{font:700 16px var(--head);white-space:nowrap;font-variant-numeric:tabular-nums}.ri .chev{width:16px;height:16px;color:var(--mut)}
.cmpb{padding:0;overflow:hidden}.cmpb .scroll{overflow:auto}.cmpb table{min-width:460px}.cmpb thead th{background:var(--sf);vertical-align:bottom;padding:16px;white-space:normal;text-align:center}.cmpb thead th b{display:block;font:var(--hw) 15px var(--head);letter-spacing:var(--hls);color:var(--ink)}.cmpb thead .meta{font-weight:500}
.cmpb tbody th{background:var(--sf);font-size:13px;color:var(--ink2);font-weight:550;white-space:normal;padding:10px 16px;text-align:start;letter-spacing:0}.cmpb th:first-child{position:sticky;inset-inline-start:0;z-index:1;text-align:start;min-width:140px}
.cmpb td{text-align:center;color:var(--ink);white-space:normal}.cmpb .ft{background:color-mix(in srgb,var(--a1) 6%,var(--sf))}.cmpb thead th.ft{box-shadow:inset 0 3px 0 var(--br)}.cmpb tbody tr{animation:none}.cmpb tbody tr:hover{background:none}
.yes{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--sf))}.yes svg{width:14px;height:14px;stroke-width:2.6}.no{color:var(--mut)}
.cmpb tfoot td,.cmpb tfoot tr td:first-child{border:0;height:auto;padding:14px 12px}.cmpb tfoot .btn{width:100%}
.rcpt{display:grid;gap:16px;width:100%;max-width:680px;justify-self:center;padding:calc(var(--pad) + 6px)}
.rch{display:flex;align-items:center;gap:12px}.rch b{font:var(--hw) 17px var(--head);letter-spacing:var(--hls);flex:1;min-width:0}
.rpty{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.rpty div{display:grid;gap:2px}.rpty .k{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-weight:600}.rpty span:last-child{font-size:13.5px}
.rfx{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;padding:12px 14px;border-radius:calc(var(--r) - 2px);background:var(--sf2)}.rfx dt{font-size:11.5px;color:var(--mut)}.rfx dd{margin:0;font-weight:600;font-size:13.5px}
.rcpt table{min-width:0}.rcpt th{background:none;padding:8px 0;text-transform:uppercase;font-size:11px;letter-spacing:.06em}.rcpt th.n,.rcpt td.n{padding-inline-start:16px}.rcpt td{padding:8px 0;height:auto;white-space:normal;color:var(--ink)}.rcpt td.n{white-space:nowrap}
.rcpt tbody tr{animation:none}.rcpt tbody tr:hover{background:none}.rcpt tbody tr:last-child td{border-bottom:1px solid var(--edge)}.rcpt .sk{margin:4px 0}
.rtot{margin:0;display:grid;gap:8px;justify-self:end;width:min(300px,100%)}.rtot div{display:flex;justify-content:space-between;gap:16px;font-size:13.5px;color:var(--ink2)}.rtot dd{margin:0;font-variant-numeric:tabular-nums;font-weight:550;color:var(--ink)}
.rtot .due{padding-top:10px;border-top:1px solid var(--edge2);font-weight:700;color:var(--ink)}.rtot .due dd{font:700 20px var(--head);letter-spacing:-.02em}
.rnote{margin:0;font-size:12.5px;color:var(--mut);padding-top:12px;border-top:1px dashed var(--edge2)}
@container app (max-width:760px){.res{grid-template-columns:1fr}.rside{display:none}.res.fopen .rside{display:grid}.fbtn{display:inline-flex}.revs{grid-template-columns:1fr;gap:20px}}
@container app (max-width:640px){.mapc,.gal.hero{grid-template-columns:1fr}.cgrid.lab .cd{min-height:48px;justify-items:center;padding:6px 2px 4px;border-color:transparent}.cgrid.lab .cd b{justify-self:center;width:30px;height:30px;font-size:13.5px}.cgrid.lab .evs{display:none}.cgrid.lab .cdots{display:flex}
.cd b{width:28px;height:28px}.mapv{min-height:240px}.mpl{border-inline-start:0;border-top:1px solid var(--edge);max-height:none}.gt{contain:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);grid-auto-rows:auto}.gth .pic{aspect-ratio:1}
.cmpb table{min-width:0}.cmpb th:first-child{min-width:92px}.cmpb thead th,.cmpb tbody th,.cmpb td{padding:10px 8px}.cmpb thead th b{font-size:13.5px}.cmpb tfoot .btn{padding:0 8px;font-size:12.5px}
.kb{grid-template-columns:repeat(var(--cols),80%);scroll-snap-type:x mandatory}.kcol{scroll-snap-align:start}.ri.vis .pic{width:88px}.rp{font-size:14px}.msg{max-width:86%}.drop{padding:16px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}.chart .ln{stroke-dashoffset:0}}/* right to left (Arabic, Urdu): the page mirrors through its logical properties; what they cannot say is said here. Plots, the
   address bar and the map keep reading left to right; Arabic script is set in its own faces, without letter spacing, which breaks its joins */
:is(.canvas,.toast)[dir=rtl]{--font:"SF Arabic","Geeza Pro","Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif;--head:var(--font);--hls:0;font-family:var(--font)}
:is(.canvas,.toast)[dir=rtl]:lang(ur){--font:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq","SF Arabic","Geeza Pro",Tahoma,sans-serif;line-height:1.75}
:is(.canvas,.toast)[dir=rtl] *{letter-spacing:0!important}
[dir=rtl] svg.fl{scale:-1 1}
.canvas[dir=rtl] :is(.bars,.win,.mbg){direction:ltr}
.canvas[dir=rtl] .dp{transform:translateX(102%)}.canvas[dir=rtl].dopen .dp{transform:none}
.canvas[dir=rtl] .k-drawer .ovp{border-width:0 1px 0 0;animation-name:from-l}@keyframes from-l{from{transform:translateX(-100%)}}
.canvas[dir=rtl] .k-menu .ovp{transform-origin:top left}.canvas[dir=rtl] .meter i{transform-origin:right}
.canvas[dir=rtl] .tog input:checked:before{transform:translateX(-17px)}
.canvas[dir=rtl] .lnk:hover svg{transform:translateX(-3px)}.canvas[dir=rtl] .btn.primary:hover svg:last-child:not(:first-child){transform:translateX(-3px)}
.canvas[dir=rtl] .prog i{inset:0 0 0 auto;animation-name:slide-r}@keyframes slide-r{from{transform:translateX(100%)}to{transform:translateX(-280%)}}
.canvas[dir=rtl] tbody tr.sel{box-shadow:inset -3px 0 0 var(--a1)}.canvas[dir=rtl] .mpi{box-shadow:inset -3px 0 0 transparent}.canvas[dir=rtl] .mpi.on{box-shadow:inset -3px 0 0 var(--a1)}
.canvas[dir=rtl] .field .rng input{background:linear-gradient(270deg,var(--a1) var(--p),var(--sf2) var(--p))}
.canvas[dir=rtl] .stars{background-image:linear-gradient(270deg,var(--star,#f5a524) var(--p),var(--edge2) var(--p))}
.canvas[dir=rtl] .k-promo .slide .pic{inset:0 38% 0 0;-webkit-mask-image:linear-gradient(270deg,transparent,#000 45%);mask-image:linear-gradient(270deg,transparent,#000 45%)}
.canvas.phone[dir=rtl] .sbar{padding:4px 34px 0 26px}.canvas[dir=rtl] .ovh .ib{margin:-6px 0 -6px -8px}.canvas[dir=rtl] .delta{padding:1px 4px 1px 7px}.canvas[dir=rtl] .tfoot{padding:8px 16px 8px 10px}
.canvas[dir=rtl] .badge{padding:0 8px 0 9px}.canvas[dir=rtl] .swb{padding:5px 5px 5px 9px}.canvas[dir=rtl] .topbar .swb{padding:4px 4px 4px 6px}.toast[dir=rtl] .lnk{padding:0 6px 0 0}.canvas[dir=rtl] .opt{padding:9px 11px 9px 14px}
.canvas[dir=rtl] .aff>b{padding:0 12px 0 2px}.canvas[dir=rtl] .aff.srch>svg:last-of-type{margin:0 0 0 11px}.canvas[dir=rtl] .field .aff.phone .cc select{padding:0 12px 0 28px}.canvas[dir=rtl] .bulk{padding:8px 16px 8px 12px}
.canvas[dir=rtl] .uf{padding:10px 12px 10px 8px}.canvas[dir=rtl] .srt select{padding:0 12px 0 32px}.canvas[dir=rtl] .pkc{padding:0 12px 0 8px}
.md .su,:root[data-mode=dark] .md .mo{display:none}:root[data-mode=dark] .md .su{display:block}
.ib.lg{display:inline-flex;align-items:center;width:auto;padding:0 8px;gap:6px}.lg span{font-size:12.5px;font-weight:600;white-space:nowrap}
.canvas[dir=rtl] kbd{direction:ltr;unicode-bidi:isolate}
/* common controls: button variants and states, split buttons, tooltips */
.btn.ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--ink2)}.btn.ghost:hover{background:var(--sf2);color:var(--ink)}
.btn.link{background:none;border-color:transparent;box-shadow:none;color:var(--a1);padding:0 4px;text-decoration:underline;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--a1) 40%,transparent)}.btn.link:hover{background:none;text-decoration-color:currentColor}
.btn.icon{width:38px;padding:0}.btn.icon svg{width:18px;height:18px}
.btn:disabled{opacity:.48;cursor:not-allowed;box-shadow:none}.btn:disabled:active{transform:none}.btn.primary:disabled{background:color-mix(in srgb,var(--br) 55%,var(--sf2))}
.btn.loading{opacity:.85;cursor:progress}.spin{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-inline-end-color:transparent;animation:spin .7s linear infinite;flex:none}@keyframes spin{to{transform:rotate(360deg)}}
.splitb{position:relative;display:inline-flex}.splitb>.btn:first-child,.splitb>.tipw:first-child .btn{border-start-end-radius:0;border-end-end-radius:0}.splitb .caret{width:34px;padding:0;border-start-start-radius:0;border-end-start-radius:0;margin-inline-start:-1px}.splitb .btn.primary.caret{box-shadow:inset 1px 0 0 color-mix(in srgb,var(--on) 28%,transparent)}
.ddm{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:6;min-width:170px;display:grid;padding:6px;background:var(--sf);border:1px solid var(--edge);border-radius:calc(var(--r) + 2px);box-shadow:0 12px 32px -8px rgba(16,24,40,.22);animation:menu .16s var(--e) both}.ddm[hidden]{display:none}
.ddm button{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border:0;background:none;border-radius:7px;cursor:pointer;text-align:start;font-size:13.5px;color:var(--ink)}.ddm button:hover,.ddm button:focus-visible{background:var(--sf2);outline:0}.ddm svg{width:16px;height:16px;color:var(--ink2)}
.tipw{position:relative;display:inline-flex}.tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translate(-50%,4px);z-index:8;width:max-content;max-width:240px;padding:6px 9px;border-radius:7px;background:var(--ink);color:var(--bg);font-size:12px;font-weight:500;line-height:1.4;white-space:normal;text-align:center;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s,transform .15s,visibility .15s}
.tipw:hover>.tip,.tipw:focus-within>.tip,.tip.show{opacity:1;visibility:visible;transform:translate(-50%,0)}
.ib.tipb{width:24px;height:24px;margin-block:-4px;color:var(--mut)}.ib.tipb svg{width:15px;height:15px}
/* fields: the label row, required, help, not editable */
.field .lr{display:flex;align-items:center;gap:4px;min-width:0}.req{color:var(--bad);margin-inline-start:3px;font-weight:700}
.help{font-size:12.5px;color:var(--mut);line-height:1.45}
.field.off{opacity:.6}.field.off input,.field.off select,.field.off textarea{cursor:not-allowed;background:var(--sf2)}.field input:disabled,.field select:disabled,.field textarea:disabled{cursor:not-allowed;background:var(--sf2);color:var(--mut)}
.field.ro input,.field input[readonly]{background:var(--sf2);border-style:dashed;box-shadow:none}
.tog .lr label{font-size:14px;font-weight:500}.tog .help{flex-basis:100%}.tog{flex-wrap:wrap;row-gap:4px}
.aff.pw .ib{width:40px;height:38px;border-radius:0;color:var(--mut)}.aff.pw .ib .off,.aff.pw .ib[aria-pressed=true] .on{display:none}.aff.pw .ib[aria-pressed=true] .off{display:block}
.aff.dr{gap:0}.aff.dr>svg{margin:0 2px 0 11px;color:var(--mut);width:16px;height:16px}.aff.dr i{font-style:normal;color:var(--mut);padding:0 2px}.field .aff.dr input{flex:1;padding:0 8px}
.cbx{position:relative;flex-wrap:wrap;min-height:40px;padding:4px 30px 4px 4px;gap:4px}.cbx>svg{position:absolute;inset-inline-end:11px;top:12px;width:16px;height:16px;color:var(--mut);pointer-events:none}.field .cbx input{flex:1;min-width:90px;height:30px;padding:0 8px}
.mc{display:inline-flex;align-items:center;gap:2px;height:28px;padding:0 4px 0 10px;border-radius:7px;background:color-mix(in srgb,var(--a1) 10%,var(--sf));color:var(--ink);font-size:12.5px;font-weight:600;max-width:100%}.mc button{display:grid;place-items:center;width:24px;height:24px;border:0;background:none;border-radius:5px;color:var(--ink2);cursor:pointer}.mc button:hover{background:color-mix(in srgb,var(--a1) 16%,transparent)}.mc svg{width:12px;height:12px}
.lb{position:absolute;top:calc(100% + 4px);inset-inline-start:-1px;inset-inline-end:-1px;z-index:6;margin:0;padding:5px;list-style:none;max-height:220px;overflow:auto;background:var(--sf);border:1px solid var(--edge);border-radius:10px;box-shadow:0 12px 32px -8px rgba(16,24,40,.22)}.lb[hidden]{display:none}
.lb li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13.5px}.lb li:hover,.lb li.act{background:var(--sf2)}.lb li svg{width:15px;height:15px;color:var(--a1);visibility:hidden}.lb li[aria-selected=true]{font-weight:600}.lb li[aria-selected=true] svg{visibility:visible}.lb li.no{display:none}
.consent .opt{display:flex;align-items:flex-start;gap:10px;font-size:13.5px;font-weight:400;color:var(--ink2);line-height:1.45;cursor:pointer}.consent .opt input{margin-top:2px}.field.consent.bad .opt input{outline:2px solid var(--bad);outline-offset:2px}
/* the new blocks: an inline alert, a toolbar, progress bars; paging; a page's status; who is on something */
.banner.info{color:var(--info);background:color-mix(in srgb,var(--info) 6%,var(--sf))}.banner.alert{align-items:flex-start}.banner.alert .bi{margin-top:1px}.banner .at{display:grid;gap:2px;flex:1;min-width:0;color:var(--ink2)}.banner .at b{color:var(--ink);font-weight:650}.banner.alert .btn{align-self:center}
.tbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;min-width:0}.tbar .search{flex:1 1 220px;max-width:340px;height:36px}.tsel{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--mut);white-space:nowrap}.tsel .sel select{height:36px;min-width:120px;border:1px solid var(--edge2);border-radius:9px;background:var(--sf);color:var(--ink);font:inherit;font-size:13px;font-weight:500;padding-inline-start:11px;cursor:pointer}.tsel .sel svg{top:10px}.tbb{display:flex;gap:8px;margin-inline-start:auto}.tbar .btn{height:36px}
.toolbar .tbar{width:100%}
.prgs{display:grid;gap:14px}.prgs h4{margin:0;font-size:15px;font-weight:650}.pi{display:grid;gap:4px}.pi .pl{font-size:13.5px;font-weight:500;color:var(--ink)}.pi b{font-size:13px;font-variant-numeric:tabular-nums}.pi .meter{margin-top:2px;height:8px}.pi .meter.full i{background:var(--ok)}.pi .meta{font-size:12px;color:var(--mut)}
.pager .pg{min-width:28px;height:28px;padding:0 6px;border:1px solid transparent;border-radius:7px;background:none;font-size:12px;font-weight:600;color:var(--ink2);cursor:pointer}.pager .pg:hover{background:var(--sf2)}.pager .pg.on{background:var(--sf2);border-color:var(--edge);color:var(--ink)}.pager .gap{font-style:normal;color:var(--mut);padding:0 2px}.pgof b{color:var(--ink)}
.tt{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tt .badge{position:relative;top:1px}
.ppl{display:inline-flex;align-items:center;flex:none}.ppl .av{width:26px;height:26px;font-size:10px;box-shadow:0 0 0 2px var(--sf)}.ppl .av{font-size:9.5px;letter-spacing:-.02em}.ppl .av+.av{margin-inline-start:-6px}.pmore{display:grid;place-items:center;min-width:26px;height:26px;padding:0 5px;margin-inline-start:-6px;border-radius:99px;background:var(--sf2);color:var(--ink2);font-style:normal;font-size:10.5px;font-weight:700;box-shadow:0 0 0 2px var(--sf)}
.card.item .ppl{margin-top:4px}.li .lt .ppl{display:flex;width:max-content;margin-top:5px}.li .badge{flex:none}.dppl{display:flex;align-items:center;gap:10px;padding:12px var(--pad) 4px}
.k-popover .ovs{background:transparent;backdrop-filter:none}.k-popover .ovp{top:70px;inset-inline-end:24px;width:min(320px,calc(100% - 32px));padding:16px;gap:12px;border-radius:calc(var(--r) + 2px);transform-origin:top right;animation:menu .18s var(--e) both}.k-popover .ovh h4{font-size:15px}
/* a phone's controls are big enough for a thumb (44 px); the web's for a pointer (24 px) */
.canvas.phone .btn,.canvas.phone .field input,.canvas.phone .field select,.canvas.phone .tsel .sel select,.canvas.phone .tbar .search,.canvas.phone .field .aff{min-height:44px}.canvas.phone .btn.icon,.canvas.phone .splitb .caret{min-width:44px}.canvas.phone .pager .ib,.canvas.phone .pager .pg{min-width:44px;min-height:44px}
.canvas.phone :is(.ib,.mc button,.lb li){position:relative}.canvas.phone :is(.ib,.mc button)::after{content:"";position:absolute;left:50%;top:50%;width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%)}.canvas.phone .lb li{min-height:44px;display:flex;align-items:center}
/* the Components page: each control in each of its states, the states forced so they can be seen at once */
.kit{display:grid;gap:18px}.kit .kg{display:grid;gap:12px;padding:var(--pad);border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);box-shadow:var(--shadow)}.kit h4{margin:0;font-size:15px;font-weight:650}.kit .knote{margin:-6px 0 0;font-size:12.5px;color:var(--mut)}
.kgrid{display:grid;grid-template-columns:90px repeat(var(--n),minmax(96px,1fr));gap:12px 14px;align-items:start;overflow-x:auto;padding:2px}.kgrid>.kh{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}.kgrid>.kl{font-size:13px;font-weight:600;color:var(--ink2);padding-top:8px}.kgrid .field input,.kgrid .field select{min-width:0;width:100%}.kgrid .field{gap:4px}
.kwrap{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.btn.primary.danger:hover,.btn.primary.danger.is-hover{background:color-mix(in srgb,var(--bad) 88%,#000)}.btn.primary.danger.is-active,.btn.primary.danger:active{background:color-mix(in srgb,var(--bad) 80%,#000)}.btn.primary.danger:disabled{background:color-mix(in srgb,var(--bad) 55%,var(--sf2))}.canvas.phone .tfoot .pgof{display:none}.tipw.show .tip{opacity:1;visibility:visible;transform:translate(-50%,0)}.kwrap.ktip{padding-top:40px;gap:24px}
.btn.is-hover{background:var(--sf2)}.btn.primary.is-hover{background:color-mix(in srgb,var(--br) 90%,#000)}.btn.ghost.is-hover{background:var(--sf2)}.btn.is-focus,.chip.is-focus{outline:2px solid var(--a1);outline-offset:2px}.btn.is-active{transform:scale(.97);background:color-mix(in srgb,var(--ink) 8%,var(--sf))}.btn.primary.is-active{background:color-mix(in srgb,var(--br) 82%,#000)}
.field input.is-focus,.field select.is-focus{border-color:var(--a1);box-shadow:0 0 0 4px color-mix(in srgb,var(--a1) 14%,transparent)}.field input.is-hover,.field select.is-hover{border-color:color-mix(in srgb,var(--ink) 30%,var(--edge2))}
.kswatch{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}.kswatch div{display:grid;gap:2px;font-size:12px;color:var(--ink2)}.kswatch i{display:block;height:40px;border-radius:8px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 10%,transparent)}.kswatch b{color:var(--ink);font-size:12.5px}.kswatch code{font-size:11px;color:var(--mut)}
@container app (max-width:640px){.tbar .search{max-width:none;flex-basis:100%}.tbb{margin-inline-start:0}.tsel{flex:1}.tsel .sel{flex:1}.tsel .sel select{width:100%;min-width:0}}
.canvas[dir=rtl] .tip{transform:translate(50%,4px);left:auto;right:50%}.canvas[dir=rtl] .tipw:hover>.tip,.canvas[dir=rtl] .tipw:focus-within>.tip{transform:translate(50%,0)}.canvas[dir=rtl] .k-popover .ovp{transform-origin:top left}
`;

const JS = `
(function(){
  var $=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
  var secs=$(".screen"),links=$("aside a");
  // the product's languages: the page's words and the demo's own show in the language picked in the frame, kept as written underneath
  // (links, layers and toasts find buttons by those); numbers take the script's digits when the design asks; the canvas mirrors right to left
  var I=document.getElementById("i18n");I=I?JSON.parse(I.textContent):null;var LANG=0,own=Object.prototype.hasOwnProperty;
  var PATS=I?Object.keys(I.words).filter(function(k){return k.indexOf("{x}")>-1}).map(function(k){var parts=k.split(/\\{([xy])\\}/),v=[],re="^";
    parts.forEach(function(x,i){if(i%2){v.push(x);re+="(.+?)"}else re+=x.replace(/[.*+?^$()|[\\]\\\\{}]/g,"\\\\$&")});return {re:new RegExp(re+"$"),v:v,to:I.words[k]}}):[];
  function word(k,d){return d&&own.call(d,k)?d[k]:own.call(I.words,k)?I.words[k]:null}
  function tr(k,d){var t=word(k,d);if(t!==null)return t;
    for(var i=0;i<PATS.length;i++){var m=k.match(PATS[i].re);if(m){var o=PATS[i].to;PATS[i].v.forEach(function(c,j){var x=m[j+1],w=word(x,d);o=o.replace("{"+c+"}",w!==null?w:x)});return o}}
    var n=k.match(/^(\\S+) (\\d+)$/);return n&&word(n[1],d)!==null?word(n[1],d)+" "+n[2]:null}
  function other(){return !!I&&I.langs[LANG].slice(0,2)!=="en"}
  function dg(s){return other()&&I.digits?s.replace(/(\\d),(?=\\d)/g,"$1\u066c").replace(/(\\d)\\.(?=\\d)/g,"$1\u066b").replace(/[0-9]/g,function(c){return I.digits.charAt(+c)}):s}
  // the words as written, whatever language shows
  function ot(el){var w=document.createTreeWalker(el,4),s="",n;while((n=w.nextNode()))s+=n.__o!=null?n.__o:n.nodeValue;return s}
  function oa(el,a){return el.__a&&own.call(el.__a,a)?el.__a[a]:el.getAttribute(a)}
  function apply(root){if(!I)return;var sec=root.parentNode&&(root.nodeType===1?root:root.parentNode).closest(".screen"),d=sec&&I.pages[sec.id]||{},on=other(),list=[],n;
    if(root.nodeType===3)list=[root];else{var w=document.createTreeWalker(root,4);while((n=w.nextNode()))list.push(n)}
    list.forEach(function(n){var p=n.parentNode;if(!p||p.closest("script,style,[data-lang],.win"))return;if(n.__o==null)n.__o=n.nodeValue;
      var o=n.__o,k=o.trim(),v=o;if(on&&k){var t=tr(k,d);v=dg(t!==null?o.replace(k,function(){return t}):o)}if(n.nodeValue!==v)n.nodeValue=v});
    if(root.nodeType!==1)return;[root].concat($("[placeholder],[aria-label],[title]",root)).forEach(function(el){if(el.closest("[data-lang],.win"))return;
      ["placeholder","aria-label","title"].forEach(function(a){if(!el.hasAttribute(a))return;el.__a=el.__a||{};if(!own.call(el.__a,a))el.__a[a]=el.getAttribute(a);
        var o=el.__a[a],t=on?tr(o.trim(),d):null;el.setAttribute(a,on?dg(t!==null?t:o):o)})})}
  function setLang(i){if(!I)return;LANG=i;$(".canvas,.toast").forEach(function(c){c.dir=I.dirs[i];c.lang=I.langs[i];apply(c)});$("[data-lang] span").forEach(function(x){x.textContent=I.names[1-i]})}
  window.__lang=setLang;
  // the colour mode: the system's at first, the other one from the frame's switch
  function setMode(m){if(!document.querySelector("button[data-mode]"))return;document.documentElement.setAttribute("data-mode",m);$("button[data-mode]").forEach(function(b){b.setAttribute("aria-label",m==="dark"?"Light mode":"Dark mode")})}
  window.__mode=setMode;setMode(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");
  if(I)new MutationObserver(function(ms){ms.forEach(function(m){[].forEach.call(m.addedNodes,function(n){var el=n.nodeType===1?n:n.parentNode;if(el&&el.closest&&el.closest(".canvas,.toast"))apply(n)})})}).observe(document.querySelector("main"),{childList:true,subtree:true});

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
    var name=function(el){if(el.tagName==="BUTTON")return label(el);if(el.tagName==="TR"){var c=el.querySelector("td:not(.ck)");while(c&&c.lastChild)c=c.lastChild;return c?ot(c).trim().toLowerCase():""}var b=el.querySelector("b");return b?ot(b).trim().toLowerCase():""};
    $(".app button,.app tbody tr,.app .card.item,.app .li,.app .slide,.app .kc,.app .ri,.app .nt,.app .mpi",p).forEach(function(el){if(el.closest(".ovl"))return;var to=L[name(el)];if(to){el.setAttribute("data-go",to);el.classList.add("go")}})});
  function label(b){return (ot(b).trim()||oa(b,"aria-label")||"").toLowerCase()}
  // a menu opens under the button that opened it
  function place(ov){if(!ov.classList.contains("k-menu")&&!ov.classList.contains("k-popover"))return;var lab=ov.getAttribute("data-trigger").toLowerCase();
    var b=$("button",ov.closest(".pane")).filter(function(x){return !x.closest(".ovl")&&label(x)===lab})[0];if(!b)return;
    var r=b.getBoundingClientRect(),o=ov.getBoundingClientRect(),p=ov.querySelector(".ovp");p.style.top=Math.round(r.bottom-o.top+6)+"px";
    if(getComputedStyle(ov).direction==="rtl"){p.style.right="auto";p.style.left=Math.round(Math.max(8,r.left-o.left))+"px"}else{p.style.left="";p.style.right=Math.round(Math.max(8,o.right-r.right))+"px"}}
  var MARK={ok:'<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',bad:'<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16v.01"/>',info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'};
  function toast(s,t,tone,undo){$(".toast:not(.pin)",s).forEach(function(x){x.remove()});var d=document.createElement("div");tone=tone||"ok";d.className="toast "+tone;d.setAttribute("role","status");if(I){d.dir=I.dirs[LANG];d.lang=I.langs[LANG]}d.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(MARK[tone]||MARK.ok)+'</svg>';var sp=document.createElement("span");sp.textContent=t;d.appendChild(sp);
    if(undo){var u=document.createElement("button");u.type="button";u.className="lnk";u.textContent="Undo";d.appendChild(u)}s.appendChild(d);setTimeout(function(){d.remove()},3100)}
  // the page's own words for what an action did, when the design gave them; else "<action> done"
  function said(s,el,dflt){var p=el.closest(".pane"),raw=p&&p.getAttribute("data-toasts"),lab=label(el);if(raw){var t=JSON.parse(raw).filter(function(x){return x.after.trim().toLowerCase()===lab})[0];if(t)return toast(s,t.text,t.tone,t.undo)}toast(s,dflt)}
  var WEEK=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],SVG=function(d){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>'};
  function fade(x,ms){if(!x)return;x.style.transition="opacity .2s";x.style.opacity=.3;setTimeout(function(){x.style.opacity=""},ms||380)}
  // search results: the ticked filters show as chips above the list, counted on the Filters button
  function refine(r){var on=$(".fo input:checked",r).map(function(x){return x.value}),pk=r.querySelector(".pkd");pk.innerHTML="";
    on.forEach(function(v){var b=document.createElement("button");b.type="button";b.className="pkc";b.setAttribute("data-unpick",v);b.textContent=v;b.insertAdjacentHTML("beforeend",SVG('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>'));pk.appendChild(b)});
    var em=r.querySelector(".fbtn em");if(em){em.textContent=on.length;em.hidden=!on.length}var cl=r.querySelector("[data-clearf]");if(cl)cl.hidden=!on.length;
    var mn=r.querySelector(".rmain");mn.classList.add("dim");setTimeout(function(){mn.classList.remove("dim")},380)}
  function unread(nf){var n=$(".nt.un",nf).length,kn=nf.querySelector(".nth .kn"),ra=nf.querySelector("[data-readall]");if(kn){if(n)kn.textContent=n+" new";else kn.remove()}if(!n&&ra)ra.remove()}
  secs.forEach(function(s){
    $("[data-state]",s).forEach(function(b){b.addEventListener("click",function(){
      $("[data-state]",s).forEach(function(x){x.className=""});b.className="on";
      var k=b.getAttribute("data-state");$("[data-wf]",s).forEach(function(w){var on=w.getAttribute("data-wf")===k;w.hidden=!on;if(on){count(w);$(".ovl[data-open]",w).forEach(function(o){o.classList.add("open");place(o)})}})})});
    // a slider shows its value as it moves; a one-time code moves to the next box as each digit is typed
    s.addEventListener("input",function(e){var t=e.target;
      if(t.type==="range"){var o=t.parentNode.querySelector("output");t.style.setProperty("--p",((t.value-t.min)/(t.max-t.min||1)*100)+"%");if(o)o.textContent=(t.getAttribute("data-pre")||"")+Number(t.value).toLocaleString("en")+(t.getAttribute("data-suf")||"");return}
      if(t.closest&&t.closest(".otp")&&t.value&&t.nextElementSibling)t.nextElementSibling.focus()});
    s.addEventListener("change",function(e){var t=e.target;if(!t.closest)return;if(t.closest(".tsel")){var tp=t.closest(".pane");$(".tbl tbody,.cards,.list",tp).forEach(function(x){fade(x)});return}if(t.closest(".rside .fo"))refine(t.closest(".res"));else if(t.closest(".srt"))fade(t.closest(".rmain").querySelector(".rlist"))});
    // a board's cards are dragged between its columns; the counts follow
    var dragged=null;
    s.addEventListener("dragstart",function(e){var k=e.target.closest&&e.target.closest(".kc");if(!k)return;dragged=k;k.classList.add("drag");e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",k.textContent)}catch(x){}});
    s.addEventListener("dragend",function(){if(dragged)dragged.classList.remove("drag");dragged=null;$(".kcol.over",s).forEach(function(c){c.classList.remove("over")})});
    s.addEventListener("dragover",function(e){var c=dragged&&e.target.closest&&e.target.closest(".kcol");if(!c||c.closest(".kb")!==dragged.closest(".kb"))return;e.preventDefault();
      $(".kcol.over",s).forEach(function(x){if(x!==c)x.classList.remove("over")});c.classList.add("over");
      var l=c.querySelector(".kl"),after=$(".kc:not(.drag)",l).filter(function(x){var r=x.getBoundingClientRect();return e.clientY<r.top+r.height/2})[0];if(after){if(after!==dragged.nextSibling)l.insertBefore(dragged,after)}else if(l.lastElementChild!==dragged)l.appendChild(dragged)});
    s.addEventListener("drop",function(e){if(!dragged)return;e.preventDefault();var kb=dragged.closest(".kb");$(".kcol",kb).forEach(function(c){c.querySelector(".kn").textContent=c.querySelectorAll(".kc").length;c.classList.remove("over")});
      toast(s,"Moved to "+dragged.closest(".kcol").querySelector("header b").textContent,"info")});
    // a combobox: its list opens as it is typed in, showing the options that match
    function lbOpen(c,on){var l=c.querySelector(".lb"),i=c.querySelector("input");l.hidden=!on;i.setAttribute("aria-expanded",String(on))}
    function lbClose(keep){$("[data-cbx]",s).forEach(function(c){if(c!==keep)lbOpen(c,false)})}
    s.addEventListener("focusin",function(e){var c=e.target.closest&&e.target.closest("[data-cbx]");if(c&&e.target.tagName==="INPUT"&&!e.target.disabled&&!e.target.readOnly){lbClose(c);lbOpen(c,true)}});
    s.addEventListener("input",function(e){var c=e.target.closest&&e.target.closest("[data-cbx]");if(!c)return;var q=e.target.value.trim().toLowerCase();lbOpen(c,true);$(".lb li",c).forEach(function(li){li.classList.toggle("no",!!q&&ot(li).toLowerCase().indexOf(q)<0)})});
    s.addEventListener("input",function(e){var t=e.target;if(!t.matches||!t.matches('input[type=search]'))return;
      var q=t.value.toLowerCase(),pane=t.closest(".pane");$("tbody tr,.cards .item,.list .li",pane).forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>-1?"":"none"})});
    s.addEventListener("click",function(e){
      // the frame's language button: every page shows in the other language
      if(e.target.closest&&e.target.closest("[data-lang]")){setLang(1-LANG);return}
      if(e.target.closest&&e.target.closest("button[data-mode]")){setMode(document.documentElement.getAttribute("data-mode")==="dark"?"light":"dark");return}
      // a split button's arrow opens its other choices; a click anywhere else closes them
      var dd=e.target.closest?e.target.closest("[data-dd]"):null;$(".ddm",s).forEach(function(m){if(!dd||m.parentNode!==dd.parentNode){m.hidden=true;var c=m.parentNode.querySelector("[data-dd]");if(c)c.setAttribute("aria-expanded","false")}});
      if(dd){var dm=dd.parentNode.querySelector(".ddm");dm.hidden=!dm.hidden;dd.setAttribute("aria-expanded",String(!dm.hidden));return}
      // a password's eye shows and hides it
      var pw=e.target.closest?e.target.closest("[data-pw]"):null;
      if(pw){var pin2=pw.parentNode.querySelector("input"),shown=pin2.type==="password";pin2.type=shown?"text":"password";pw.setAttribute("aria-pressed",String(shown));pw.setAttribute("aria-label",shown?"Hide password":"Show password");return}
      // a combobox: pick an option (a multiselect adds it as a chip, or takes it off again), or drop a chip
      var cbx=e.target.closest?e.target.closest("[data-cbx]"):null;lbClose(cbx);
      var unc=e.target.closest?e.target.closest("[data-unchip]"):null;
      if(unc){var mc=unc.closest(".mc"),cv2=ot(mc).trim(),cb2=unc.closest("[data-cbx]");$(".lb li",cb2).forEach(function(li){if(ot(li).trim()===cv2)li.setAttribute("aria-selected","false")});mc.remove();return}
      var opt=e.target.closest?e.target.closest(".lb li"):null;
      if(opt){var cb3=opt.closest("[data-cbx]"),inp3=cb3.querySelector("input"),v3=ot(opt).trim();
        if(cb3.classList.contains("multi")){var had=opt.getAttribute("aria-selected")==="true";opt.setAttribute("aria-selected",String(!had));
          if(had)$(".mc",cb3).forEach(function(x){if(ot(x).trim()===v3)x.remove()});else{var chip=document.createElement("span");chip.className="mc";chip.textContent=v3;chip.insertAdjacentHTML("beforeend",'<button type="button" data-unchip aria-label="Remove">'+SVG('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>')+'</button>');cb3.insertBefore(chip,inp3)}
          inp3.value="";$(".lb li",cb3).forEach(function(li){li.classList.remove("no")});inp3.focus();return}
        $(".lb li",cb3).forEach(function(li){li.setAttribute("aria-selected",String(li===opt))});inp3.value=v3;lbOpen(cb3,false);return}
      // a table's pager: step to another page (the rows are the sample, so they only refresh)
      var pg=e.target.closest?e.target.closest(".pager [data-page]"):null;
      if(pg){var nav=pg.closest(".pager"),tot=+nav.getAttribute("data-pages"),cur2=+(nav.querySelector(".pg.on")||{textContent:"1"}).textContent,to2=pg.getAttribute("data-page");
        to2=to2==="prev"?cur2-1:to2==="next"?cur2+1:+to2;to2=Math.max(1,Math.min(tot,to2));
        var nums=[1,to2-1,to2,to2+1,tot].filter(function(x,i,a){return x>=1&&x<=tot&&a.indexOf(x)===i}).sort(function(a,b){return a-b}),h="";
        nums.forEach(function(x,i){if(i&&x-nums[i-1]>1)h+='<i class="gap">…</i>';h+='<button type="button" class="pg'+(x===to2?' on" aria-current="page"':'"')+' data-page="'+x+'" aria-label="Page '+x+'">'+x+'</button>'});
        $(".pg,.gap",nav).forEach(function(x){x.remove()});nav.querySelector("[data-page=next]").insertAdjacentHTML("beforebegin",h);
        nav.querySelector("[data-page=prev]").disabled=to2===1;nav.querySelector("[data-page=next]").disabled=to2===tot;var pn=nav.closest(".tfoot").querySelector(".pn");if(pn)pn.textContent=to2;
        fade(nav.closest(".tbl").querySelector("tbody"));return}
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
      // a calendar: pick a day (its times follow), pick a time, step to another month
      var cdy=e.target.closest?e.target.closest(".cal .cd[data-day],.cal .slot,.cal [data-mon]"):null;
      if(cdy){var cal=cdy.closest(".cal");if(cdy.hasAttribute("data-mon")){fade(cal.querySelector(".cgrid"));return}if(cdy.disabled)return;
        var slot=cdy.classList.contains("slot");$(slot?".slot":".cd[data-day]",cal).forEach(function(x){var on=x===cdy;x.classList.toggle("on",on);x.setAttribute("aria-pressed",String(on))});
        if(!slot){var sd=cal.querySelector(".sday");if(sd)sd.textContent=WEEK[+cdy.getAttribute("data-wd")]+" "+cdy.getAttribute("data-day");$(".slot.on",cal).forEach(function(x){x.classList.remove("on");x.setAttribute("aria-pressed","false")});fade(cal.querySelector(".sl"),300)}return}
      // a map: a pin and its row in the list light together (a row that leads somewhere still goes there)
      var pin=e.target.closest?e.target.closest(".mapc [data-pin]"):null;
      if(pin&&!pin.hasAttribute("data-go")){var pi=pin.getAttribute("data-pin");$("[data-pin]",pin.closest(".mapc")).forEach(function(x){x.classList.toggle("on",x.getAttribute("data-pin")===pi)});return}
      // a gallery: a thumbnail takes the large frame
      var gth=e.target.closest?e.target.closest(".gth"):null;
      if(gth){var gm=gth.closest(".gal").querySelector(".gm"),src=gth.querySelector(".pic"),old=gm.querySelector(".pic");if(src&&old)old.replaceWith(src.cloneNode(true));
        gm.querySelector("figcaption").textContent=gth.getAttribute("aria-label");gm.querySelector(".gc b").textContent=gth.getAttribute("data-g");$(".gth",gth.parentNode).forEach(function(x){x.classList.toggle("on",x===gth)});return}
      // an upload: remove a file, or try a failed one again until it is in
      var urm=e.target.closest?e.target.closest(".uf [data-rm],.uf [data-retry]"):null;
      if(urm){var uf=urm.closest(".uf");if(urm.hasAttribute("data-rm")){uf.remove();return}
        uf.className="uf uploading";urm.remove();var us=uf.querySelector(".us"),bar=uf.querySelector(".ubar i"),pc=8;
        var tm=setInterval(function(){pc=Math.min(100,pc+(still?100:18));if(bar)bar.style.width=pc+"%";us.textContent=pc+"%";if(pc>=100){clearInterval(tm);uf.className="uf done";us.innerHTML=SVG(MARK.ok)+"Uploaded";var ub=uf.querySelector(".ubar");if(ub)ub.remove()}},260);return}
      // a chat: what is written, or a suggested reply, is sent
      var say=e.target.closest?e.target.closest(".chat .qrc,.chat .send"):null;
      if(say){e.preventDefault();var ch=say.closest(".chat"),inp=ch.querySelector(".cmp input"),txt=say.classList.contains("qrc")?ot(say).trim():inp.value.trim();if(!txt)return;
        var ms=ch.querySelector(".msgs"),m=document.createElement("div"),mp=document.createElement("p"),mt=document.createElement("time");m.className="msg mine new";mp.textContent=txt;mt.textContent="Now";m.appendChild(mp);m.appendChild(mt);ms.appendChild(m);ms.scrollTop=ms.scrollHeight;inp.value="";return}
      // notifications: read them all, or one by opening it
      var nr=e.target.closest?e.target.closest(".ntf [data-readall],.ntf .nt"):null;
      if(nr){var nf=nr.closest(".ntf");if(nr.hasAttribute("data-readall"))$(".nt.un",nf).forEach(function(x){x.classList.remove("un")});else nr.classList.remove("un");unread(nf);if(!nr.hasAttribute("data-go"))return}
      // search results: drop one filter or all of them, or open the filters on a phone
      var rf=e.target.closest?e.target.closest(".res [data-unpick],.res [data-clearf],.res [data-ftoggle]"):null;
      if(rf){var rs=rf.closest(".res");if(rf.hasAttribute("data-ftoggle")){rf.setAttribute("aria-expanded",String(rs.classList.toggle("fopen")));return}
        var uv=rf.getAttribute("data-unpick");$(".fo input",rs).forEach(function(x){if(uv===null||x.value===uv)x.checked=false});refine(rs);return}
      var ob=e.target.closest?e.target.closest("button"):null,inOv=e.target.closest?e.target.closest(".ovl"):null;
      if(inOv){if(e.target.classList.contains("ovs")||(ob&&(ob.hasAttribute("data-close")||ob.closest(".ova")||ob.classList.contains("mitem")))){inOv.classList.remove("open");if(ob&&(ob.classList.contains("primary")||ob.classList.contains("mitem")))said(s,ob,ot(ob).trim()+" done")}return}
      if(ob&&ob.closest(".ddm")){var ddm=ob.closest(".ddm");ddm.hidden=true;ddm.parentNode.querySelector("[data-dd]").setAttribute("aria-expanded","false")}
      if(ob&&ob.closest(".pane")){var lab=label(ob),ov=$(".ovl",ob.closest(".pane")).filter(function(o){return o.getAttribute("data-trigger").toLowerCase()===lab})[0];if(ov){ov.classList.add("open");place(ov);return}}
      var cb=e.target.closest?e.target.closest("[data-car]"):null;if(cb){var tr=cb.closest(".car").querySelector(".track"),sl=tr.querySelector(".slide");tr.scrollBy({left:(+cb.getAttribute("data-car"))*(sl?sl.getBoundingClientRect().width+16:tr.clientWidth),behavior:"smooth"});return}
      // a link leads to another screen of the demo, unless a button of its own inside it was pressed (save, a slide's offer)
      var g=e.target.closest?e.target.closest("[data-go]"):null;if(g&&(!ob||ob===g)){go(g.getAttribute("data-go"));return}
      var t=e.target.closest?e.target.closest("button,tr"):null;if(!t)return;var pane=t.closest(".pane");
      if(t.parentNode.classList&&t.parentNode.classList.contains("ptabs")){$("button",t.parentNode).forEach(function(c){c.classList.remove("on");c.setAttribute("aria-selected","false")});t.classList.add("on");t.setAttribute("aria-selected","true");
        var bd=t.closest(".app").querySelector(".body");bd.style.transition="opacity .2s";bd.style.opacity=.35;setTimeout(function(){bd.style.opacity=""},360);return}
      if(t.tagName==="TR"&&t.parentNode.tagName==="TBODY"&&t.closest(".tbl")){$("tr.sel",pane).forEach(function(r){r.classList.remove("sel")});t.classList.add("sel");return}
      if(t.classList.contains("fav")){t.classList.toggle("on");return}
      if(t.parentNode.classList&&t.parentNode.classList.contains("seg")){$("button",t.parentNode).forEach(function(c){c.classList.remove("on");c.setAttribute("aria-checked","false")});t.classList.add("on");t.setAttribute("aria-checked","true");
        // plans show the other period's prices; notifications show only the unread
        var nth=$("button",t.parentNode).indexOf(t),pl=t.closest(".plans"),nfs=t.closest(".ntf");
        if(pl){$(".pp strong",pl).forEach(function(x){x.textContent=x.getAttribute("data-p"+(nth?1:0))});fade(pl.querySelector(".pgrid"),250);return}
        if(nfs){nfs.classList.toggle("only",nth===1);return}
        var area=t.closest(".chart")||pane;$(".tbl tbody,.cards,.list,.bars,svg.lc-w,svg.lc-n",area).forEach(function(x){x.style.transition="opacity .2s";x.style.opacity=.3;setTimeout(function(){x.style.opacity=""},380)});return}
      if(t.classList.contains("chip")){$(".chip",t.parentNode).forEach(function(c){c.classList.remove("on")});t.classList.add("on");
        $(".tbl tbody,.cards,.list",pane).forEach(function(x){x.style.transition="opacity .2s";x.style.opacity=.3;setTimeout(function(){x.style.opacity=""},380)});return}
      var act=t.getAttribute("data-act");if(!act)return;t.classList.add("busy");
      setTimeout(function(){t.classList.remove("busy");if(act==="submit")said(s,t,"Saved");else if(act==="act")said(s,t,ot(t).trim()+" done")},800)});
  });
  // the dots follow the slide in view
  document.addEventListener("scroll",function(e){var tr=e.target;if(!tr.classList||!tr.classList.contains("track"))return;var c=tr.closest(".car"),sl=tr.querySelectorAll(".slide");if(!sl.length)return;
    var w=sl[0].getBoundingClientRect().width+16,i=Math.round(tr.scrollLeft/w);if(tr.scrollLeft+tr.clientWidth>=tr.scrollWidth-4)i=sl.length-1;$(".dots i",c).forEach(function(d,k){d.classList.toggle("on",k===i)})},true);
  document.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
    if(!t.closest(".splitb"))$(".ddm").forEach(function(m){if(m.hidden)return;m.hidden=true;var c=m.parentNode.querySelector("[data-dd]");if(c)c.setAttribute("aria-expanded","false")});
    if(!t.closest("[data-cbx]"))$("[data-cbx] .lb").forEach(function(l){l.hidden=true;var i=l.parentNode.querySelector("input");if(i)i.setAttribute("aria-expanded","false")})});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"){$(".swm,.ddm,.lb").forEach(function(m){m.hidden=true});$(".canvas.dopen").forEach(function(c){c.classList.remove("dopen")});$(".ovl.open").forEach(function(o){o.classList.remove("open")})}});
  if(I)setLang(0);
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

/** The id of the demo's Components page (the design system sheet): a screen's own id never takes it. */
export const COMPONENTS_ID = "components";
const BTN_ROWS: [string, NonNullable<Exclude<Button, string>["variant"]>][] = [["Primary", "primary"], ["Secondary", "secondary"], ["Ghost", "ghost"], ["Danger", "danger"], ["Link", "link"]];
const BTN_STATES = ["Default", "Hover", "Focus", "Pressed", "Disabled", "Loading"];
const FIELD_STATES = ["Default", "Hover", "Focus", "Error", "Disabled"];

/**
 * The Components page: every control the design uses, in each of its states, drawn with the product's own look, for the
 * people who build it (and the review). The core controls are always shown; the richer ones only when a page uses them.
 */
function componentsKit(screens: Screen[], colours: Record<string, string>): string {
  const blocks = screens.flatMap((s) => [...(s.mock?.blocks ?? []), ...(s.mockFull?.blocks ?? [])]);
  const uses = new Set(blocks.map((b) => b.type));
  const kinds = new Set(blocks.flatMap((b) => (b.type === "form" ? b.fields.map((f) => f.kind) : [])));
  const group = (title: string, note: string, body: string) => `<section class="kg"><h4>${esc(title)}</h4><p class="knote">${esc(note)}</p>${body}</section>`;
  const grid = (cols: string[], rows: [string, string[]][]) => `<div class="kgrid" style="--n:${cols.length}"><span></span>${cols.map((c) => `<span class="kh">${esc(c)}</span>`).join("")}${rows.map(([l, cells]) => `<span class="kl">${esc(l)}</span>${cells.map((c) => `<div>${c}</div>`).join("")}`).join("")}</div>`;
  const forced = (html: string, st: string) => {
    const c = { Hover: "is-hover", Focus: "is-focus", Pressed: "is-active" }[st];
    return c ? html.replace(/class="btn/, `class="btn ${c}`) : html;
  };
  const buttons = grid(BTN_STATES, BTN_ROWS.map(([name, variant]) => [name, BTN_STATES.map((st) => forced(buttonHtml({ label: "Save", variant, ...(st === "Disabled" ? { state: "disabled" as const } : st === "Loading" ? { state: "loading" as const } : {}) }, false, "act"), st))]));
  const extra = `<div class="kwrap">${buttonHtml({ label: "Export", variant: "secondary", icon: "download", menu: ["Export as PDF", "Export as CSV"] }, false)}${buttonHtml({ label: "More options", iconOnly: true, icon: "more", variant: "ghost" }, false)}${buttonHtml({ label: "Delete", iconOnly: true, icon: "trash", variant: "ghost", hint: "Delete this item" }, false)}</div>`;
  const input = (st: string, k: number) => {
    const id = `kf${k}`, bad = st === "Error", off = st === "Disabled", c = { Hover: " is-hover", Focus: " is-focus" }[st] ?? "";
    return `<div class="field${bad ? " bad" : ""}${off ? " off" : ""}"><label for="${id}">Email</label><input id="${id}" class="${c.trim()}" type="email" value="${bad ? "" : "ana@example.com"}"${bad ? ` aria-invalid="true" aria-describedby="${id}e"` : ""}${off ? " disabled" : ""}>${bad ? `<span class="err" id="${id}e">${icon("alert")}Enter an email</span>` : ""}</div>`;
  };
  const select = (st: string, k: number) => {
    const id = `ks${k}`, bad = st === "Error", off = st === "Disabled", c = { Hover: " is-hover", Focus: " is-focus" }[st] ?? "";
    return `<div class="field${bad ? " bad" : ""}${off ? " off" : ""}"><label for="${id}">Role</label><span class="sel"><select id="${id}" class="${c.trim()}"${bad ? ` aria-invalid="true"` : ""}${off ? " disabled" : ""}><option>${bad ? "Select a role" : "Editor"}</option></select>${icon("chevd")}</span>${bad ? `<span class="err">${icon("alert")}Choose a role</span>` : ""}</div>`;
  };
  const fields = grid(FIELD_STATES, [["Text input", FIELD_STATES.map((st, k) => input(st, k))], ["Select", FIELD_STATES.map((st, k) => select(st, k))]]);
  // every kind of field a page uses, plus the core choices, as one form
  const core: FormField[] = [
    { label: "Plan", kind: "radio", options: ["Monthly", "Yearly"], value: "Monthly" },
    { label: "Notify me", kind: "checkbox", options: ["Email", "SMS"], value: "Email" },
    { label: "Dark mode", kind: "toggle", value: "on" },
  ] as FormField[];
  const SAMPLE: Record<string, Partial<FormField>> = {
    password: { label: "Password", value: "secret123" }, email: { label: "Work email", placeholder: "you@company.com" }, time: { label: "Start time", value: "09:30" },
    daterange: { label: "Dates", value: "Mar 3 - Mar 9" }, multiselect: { label: "Tags", options: ["Design", "Build", "Review", "Ship"], value: "Design, Review" },
    combobox: { label: "Country", options: ["Pakistan", "Portugal", "Peru"], placeholder: "Search a country" }, consent: { label: "I agree to the terms" },
    date: { label: "Due date" }, number: { label: "Quantity", value: "2" }, textarea: { label: "Notes" }, money: { label: "Amount", value: "$120.00" }, phone: { label: "Phone" }, slider: { label: "Budget", value: "40" }, otp: { label: "Code" },
  };
  const rich = [...kinds].filter((k) => !["text", "select", "radio", "checkbox", "toggle"].includes(k)).map((k) => ({ kind: k, label: k[0]!.toUpperCase() + k.slice(1), ...SAMPLE[k] }) as FormField);
  const form = renderBlock({ type: "form", fields: [...core, ...rich, { label: "Full name", kind: "text", required: true, help: "As on your ID", hint: "We use it on invoices" } as FormField], submit: "Save" } as MockBlock, "normal");
  const badges = `<div class="kwrap">${["Active", "Pending", "Failed", "Draft"].map((t) => `<span class="badge ${tone(t)}">${t}</span>`).join("")}</div>`;
  const alerts = `<div class="kit">${(["info", "ok", "warn", "bad"] as const).map((t) => renderBlock({ type: "alert", tone: t, title: { info: "Heads up", ok: "Saved", warn: "Check this", bad: "Something failed" }[t], text: { info: "New reports are ready to view.", ok: "Your changes are live.", warn: "Two invoices are past due.", bad: "We could not reach the bank. Try again." }[t], ...(t === "bad" ? { action: "Retry" } : {}) } as MockBlock, "normal")).join("")}</div>`;
  const prog = renderBlock({ type: "progress", title: "Upload", items: [{ label: "Report.pdf", value: 72, meta: "1.4 of 2 MB" }, { label: "Photos", value: 30, meta: "3 of 10" }] } as MockBlock, "normal");
  const tip = `<div class="kwrap ktip">${withTip(`<button type="button" class="btn">${icon("info")}<span>Hover me</span></button>`, "A short tip").replace('class="tipw"', 'class="tipw show"')}${people(["Ana Lima", "Bo Chen", "Cy Diaz", "Di Eze", "Ed Fox", "Fay Gil", "Gus Ho"])}</div>`;
  const NAMES: [string, string][] = [["br", "Brand"], ["on", "On brand"], ["a1", "Accent"], ["ink", "Text"], ["ink2", "Text 2"], ["mut", "Muted"], ["bg", "Page"], ["sf", "Card"], ["sf2", "Raised"], ["edge", "Border"], ["ok", "Success"], ["warn", "Warning"], ["bad", "Error"], ["info", "Info"]];
  const swatches = `<div class="kswatch">${NAMES.map(([k, n]) => `<div><i style="background:var(--${k})"></i><b>${n}</b><code>${esc(colours[k] ?? "")}</code></div>`).join("")}</div>`;
  return `<div class="kit">${[
    group("Colours", "The product's palette; text colours read at 4.5:1 or more on every surface.", swatches),
    group("Buttons", "Each variant in each state. Hover, focus and pressed are shown as they look when they happen.", buttons + extra),
    group("Fields", "Text and select fields in each state; errors say what to do, and disabled fields cannot be changed.", fields),
    group("Form controls", "Choices, switches and every kind of field the pages use, with required marks, help and a tooltip.", form),
    group("Badges and people", "Status badges and avatar groups.", badges + tip),
    group("Alerts", "Inline messages in each tone.", alerts),
    ...(uses.has("progress") || uses.has("table") ? [group("Progress and paging", "Linear progress and a table's pager.", prog + `<div class="tbl">${pager(48, 6, 2)}</div>`)] : []),
  ].join("")}</div>`;
}

export function buildDemo(d: DemoInput): string {
  uidN = 0;
  tipN = 0;
  look = { ...DEFAULT_THEME, ...d.theme };
  market = { start: weekStart(d.locale?.region), weekend: weekend(d.locale?.region) };
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
  // the product's languages: the page carries each page's words and the demo's own in the other language, and opens in the first
  const loc = d.locale, langs = loc?.languages ?? ["en"], other = langs.find((l) => !l.startsWith("en"));
  const i18n = loc && other ? {
    langs, names: langs.map(nativeName), labels: langs.map(englishName), dirs: langs.map((l) => (isRtl(l) ? "rtl" : "ltr")), digits: loc.digits === "native" ? nativeDigits(other) : "",
    // the frame names other pages by their titles, so each page's title in the other language is everyone's
    words: { ...demoWords(other), ...translationTable(screens.flatMap((s) => (s.mock?.tr ?? []).filter((t) => t.from.trim() === s.mock!.title.trim()))), ...translationTable(loc.strings) },
    pages: Object.fromEntries(screens.map((s) => [s.id, translationTable(s.mock?.tr, s.mockFull?.tr)])),
  } : undefined;
  const canvasLang = i18n ? ` dir="${i18n.dirs[0]}" lang="${esc(langs[0]!)}"` : "";
  const lang = i18n && langs.length > 1 ? `<button type="button" class="ib lg" data-lang aria-label="Language">${icon("globe")}<span>${esc(i18n.names[1]!)}</span></button>` : "";
  // a product in both colour modes: the frame switches between them
  const mode = d.theme?.mode === "auto" ? `<button type="button" class="ib md" data-mode aria-label="Dark mode">${icon("moon", "mo")}${icon("sun", "su")}</button>` : "";
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
    const tools = `${lang}${mode}<button type="button" class="ib" aria-label="Notifications">${icon("bell")}<i class="dot"></i></button><span class="me">${ME}</span>`;
    const search = phone ? "" : `<button type="button" class="ib" aria-label="Search">${icon("search")}</button>`;
    const content = shown.length ? shown.map((f) => `<img src="${f!.dataUri}" alt="${esc(f!.name)}">`).join("") : states.map(pane).join("");
    const tabbar = shell === "minimal" || shell === "drawer" || nav.length < 2 ? "" : `<nav class="tabbar" aria-label="Tabs">${links(5)}</nav>`;
    const foot = `<div class="rf"><a href="#${esc(s.id)}">${icon("settings")}<span>Settings</span></a><a href="#${esc(s.id)}">${icon("help")}<span>Help</span></a></div>`;
    const drawer = shell === "drawer" ? `<div class="drawer"><span class="scrim"></span><div class="dp" role="dialog" aria-label="Menu"><div class="row">${bm}<button type="button" class="ib" data-drawer aria-label="Close menu">${icon("close")}</button></div><nav aria-label="Main">${groups.some(Boolean) ? menu : links()}</nav>${foot}</div></div>` : "";
    const head = (x: string) => `<header class="topbar${brandBar}">${wrap(x)}</header>`;
    const app$ = shell === "sidebar"
      ? `<div class="shell"><nav class="rail${brandBar}" aria-label="Main">${bm}${switcher}<div class="rl">${menu}</div>${foot}</nav><div class="stage"><header class="topbar"><span class="nb">${bm}${switcher}</span><span class="q">${icon("search")}<span>Search</span><kbd>⌘K</kbd></span><span class="sp"></span>${tools}</header>${content}${tabbar}</div></div>`
      : shell === "minimal"
      ? `<div class="stage">${head(`${bm}${switcher}<span class="sp"></span>${lang}${mode}<a class="help" href="#${esc(s.id)}">${icon("help")}<span>Help</span></a><span class="me">${ME}</span>`)}${content}</div>`
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
<div class="canvas sh-${shell}${phone ? " phone" : ""}"${canvasLang}>${device}${app$}</div>
<details class="serves"><summary>Serves ${s.reqs.length} requirement${s.reqs.length === 1 ? "" : "s"}</summary><ul>${reqs || "<li>no requirement</li>"}</ul></details>
<p class="nav">${sibs.filter((o) => o.id !== s.id).map((o) => `<a href="#${esc(o.id)}">${esc(label(o))} →</a>`).join(" ")}</p>
</section>`;
  };
  const item = (s: Screen) => `<li><a href="#${esc(s.id)}">${esc(s.mock?.title ?? s.id)} <code>${esc(s.route)}</code></a></li>`;
  // more than one app: the walkthrough lists each app's screens under its name and device
  const side = apps.length > 1
    ? apps.map((a) => `<h3>${esc(a.name)} <span class="dv">${a.device === "phone" ? "phone app" : "web"}</span></h3><ul>${screens.filter((s) => appOf(s) === a).map(item).join("")}</ul>`).join("")
    : `<h3>Screens</h3><ul>${screens.map(item).join("")}</ul>`;
  // the design system sheet: a web window of its own, listed apart from the product's screens (only when a page is drawn)
  const kitOn = screens.some((s) => s.mock) && !screens.some((s) => s.id === COMPONENTS_ID);
  const kit = kitOn ? `<section class="screen" id="${COMPONENTS_ID}" data-i="${screens.length}" hidden>
<div class="top"><h2>Components <code>/components</code></h2><span class="tag">design system</span></div>
<p class="file">Every control the pages use, in each state, in the product's look.</p>
<div class="states" role="tablist"><button role="tab" data-state="0" class="on">All states</button></div>
<div class="canvas sh-topbar"${canvasLang}><div class="win" aria-hidden="true"><span class="tl"><i></i><i></i><i></i></span><span class="url">${icon("lock")}${esc(slug)}.app/components</span></div><div class="stage"><div class="pane" data-wf="0"><div class="wrap"><div class="app" data-kind="normal" aria-label="All states"><div class="ph"><div><h3>Components</h3><p class="sub">The design system the pages are built from</p></div></div><div class="body">${componentsKit(screens, themeValues(d.theme).colours(d.theme?.mode === "dark"))}</div></div></div></div></div></div>
</section>` : "";
  const none = d.noScreen.map((n) => `<li><b>${esc(n.req)}</b> ${esc(d.requirements[n.req] ?? "")} <i>(no screen: ${esc(n.reason)})</i></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${esc(d.title)} - design demo</title>
<meta name="color-scheme" content="${d.theme?.mode === "dark" ? "dark" : d.theme?.mode === "auto" ? "light dark" : "light"}">
<style>${themeCss(d.theme)}${CSS}</style></head><body class="fx-${esc(look.fx)} sh-${apps[0]!.shell} ch-${look.charts} r-${look.radius}">
<aside><h1>${esc(d.title)}</h1><p>${esc(d.flow)}</p>${side}${none ? `<h3>No screen</h3><ul>${none}</ul>` : ""}${kit ? `<h3>Design system</h3><ul><li><a href="#${COMPONENTS_ID}">Components <code>/components</code></a></li></ul>` : ""}</aside>
<main>${screens.map(panel).join("\n")}${kit}</main>
${i18n ? `<script type="application/json" id="i18n">${JSON.stringify(i18n).replace(/</g, "\\u003c")}</script>` : ""}
<script>${JS}</script></body></html>
`;
}
