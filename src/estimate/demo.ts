// The clickable demo of an approved design (docs/estimates-design.md, "Design baseline"). Pure code, no model:
// one self-contained HTML page that lets a person walk the screen inventory before approving it. The left
// panel is the walkthrough (flow, screens, the requirements each screen serves); the right is the screen
// drawn as a small app from the design's sample content, one button per state (loading, empty, error,
// success, validation). A screen without sample content, or with an attached Figma frame, shows the
// wireframe or the frame instead. Nothing in the page is fetched, and every value from the model or the
// request is escaped, so opening it runs only the page's own script.
import { wireframeSvg } from "./wireframe.js";
import type { DesignTheme, MockBlock, ScreenMock } from "../contracts/artifacts.js";
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
  /** the look the design step chose; absent, a teal and indigo dark theme */
  theme?: DesignTheme;
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

/** The order the demo lists a screen's states: the normal page first, then success, validation, loading, empty, error. Screenshots use the same order. */
/** The states a screen's demo lists: its own, in order, and a "Full data" page when the design gave dense sample data. */
export function demoStates(s: { states?: string[]; frames?: string[]; mockFull?: unknown }): string[] {
  const own = s.states?.length ? orderStates(s.states) : ["default"];
  return s.mockFull && !s.frames?.length ? [...own, FULL_DATA] : own;
}
export const FULL_DATA = "Full data";

export function orderStates(states: string[]): string[] {
  const rank: Record<StateKind, number> = { normal: 0, success: 1, validation: 2, loading: 3, empty: 4, error: 5 };
  return states.map((st, i) => ({ st, i })).sort((a, b) => rank[stateKind(a.st)] - rank[stateKind(b.st)] || a.i - b.i).map((x) => x.st);
}

const num = (n: number): number => (Number.isFinite(n) ? n : 0);
const TONES: [RegExp, string][] = [
  [/^(paid|active|done|approved|complete[d]?|success|delivered|ok|resolved|sent|on track|open)$/i, "ok"],
  [/(overdue|fail|error|reject|block|late|critical|declined|cancel|bounced|expired)/i, "bad"],
  [/(pending|due|wait|draft|review|partial|hold|scheduled|soon|queued)/i, "warn"],
];
const tone = (s: string): string => TONES.find(([re]) => re.test(s.trim()))?.[1] ?? "info";

const ICONS = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.5 6 5.5h12l2.5 8M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5M3.5 13.5H9a3 3 0 0 0 6 0h5.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.7v.1"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/></svg>',
};

/** The loading look of a block: what is static stays real (labels, column headers, titles, filters, buttons, step names), and only the data becomes shimmering shapes. */
function skeleton(b: MockBlock): string {
  const bar = (w: number, h = 12) => `<i class="sk" style="width:${w}%;height:${h}px"></i>`;
  switch (b.type) {
    case "stats": return `<div class="stats">${b.items.map((it) => `<div class="stat"><span class="k">${esc(it.label)}</span>${bar(60, 26)}${it.delta ? bar(32, 10) : ""}</div>`).join("")}</div>`;
    case "table": return `<div class="card tbl"><table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${[0, 1, 2, 3, 4].map((r) => `<tr>${b.columns.map((_, i) => `<td>${bar(i === 0 ? 70 : 40 + ((r * 13 + i * 29) % 45), 12)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "form": return `<div class="card form">${b.fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${f.kind === "toggle" ? bar(12, 22) : bar(100, 38)}</div>`).join("")}<div class="row"><button type="button" class="btn primary" disabled>${esc(b.submit)}</button></div></div>`;
    case "chart": return `<div class="card chart"><h4>${esc(b.title)}</h4><div class="skbars">${b.points.map((p, i) => `<i class="sk" style="height:${30 + ((i * 37) % 60)}%"></i>`).join("")}</div></div>`;
    case "steps": return `<ol class="steps">${b.items.map((t, i) => `<li class="${i === b.current ? "now" : ""}"><span>${i + 1}</span>${esc(t)}</li>`).join("")}</ol>`;
    case "cards": return `<div class="cards">${b.items.slice(0, 3).map(() => `<div class="card item">${b.visual ? '<i class="sk" style="height:86px;margin:calc(var(--pad)*-1) calc(var(--pad)*-1) 4px;width:calc(100% + var(--pad)*2);border-radius:0"></i>' : ""}${bar(60, 14)}${bar(90)}${bar(40)}</div>`).join("")}</div>`;
    case "list": return `<div class="card list">${b.items.slice(0, 4).map(() => `<div class="li"><span class="pip"></span><div>${bar(55, 13)}${bar(35, 10)}</div></div>`).join("")}</div>`;
    case "timeline": return `<div class="card tl">${b.items.map((it, i) => `<div class="ev ${it.status}"><span class="t">${esc(it.time)}</span><i></i><div>${bar(40 + ((i * 17) % 30), 13)}${bar(28, 10)}</div></div>`).join("")}</div>`;
    case "detail": return `<div class="card detail ${b.style}">${b.title ? `<div class="dh"><b>${esc(b.title)}</b></div>` : ""}<dl>${b.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${bar(70, 14)}</dd></div>`).join("")}</dl></div>`;
    case "filters": return renderBlock(b, "normal");
    case "actions": return renderBlock(b, "normal");
    default: return `<div class="card">${bar(90)}${bar(70)}</div>`;
  }
}

function renderBlock(b: MockBlock, k: StateKind): string {
  switch (b.type) {
    case "stats":
      return `<div class="stats">${b.items.map((it) => {
        const d = it.delta ?? "";
        return `<div class="stat"><span class="k">${esc(it.label)}</span><b class="v" data-count="${esc(it.value)}">${esc(it.value)}</b>${d ? `<span class="delta ${/^\s*-|↓|down/i.test(d) ? "dn" : "up"}">${esc(d)}</span>` : ""}</div>`;
      }).join("")}</div>`;
    case "filters":
      return `<div class="filters">${b.search ? `<label class="search">${ICONS.search}<input type="search" placeholder="${esc(b.search)}" aria-label="${esc(b.search)}"></label>` : ""}${b.chips.length ? `<div class="chips">${b.chips.map((c, i) => `<button type="button" class="chip${i === 0 ? " on" : ""}">${esc(c)}</button>`).join("")}</div>` : ""}</div>`;
    case "table": {
      const sc = b.statusColumn;
      return `<div class="card tbl"><table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${b.columns.map((_, i) => {
        const v = r[i] ?? "";
        return `<td>${sc === i ? `<span class="badge ${tone(v)}">${esc(v)}</span>` : esc(v)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    case "form":
      // the validation state flags the first two typed-in fields, filled or not
      const flagged = new Set(b.fields.map((f, i) => (f.kind === "select" || f.kind === "toggle" ? -1 : i)).filter((i) => i >= 0).slice(0, 2));
      return `<form class="card form" onsubmit="return false">${b.fields.map((f, i) => {
        const bad = k === "validation" && flagged.has(i);
        const id = `f${Math.abs(hash(f.label + i))}`;
        const label = `<label for="${id}">${esc(f.label)}</label>`;
        const err = bad ? `<span class="err" role="alert">${esc(`Enter ${f.label.toLowerCase()}`)}</span>` : "";
        const cls = `field${bad ? " bad" : ""}`;
        if (f.kind === "select") return `<div class="${cls}">${label}<select id="${id}">${(f.options?.length ? f.options : [f.value ?? f.placeholder ?? "Select"]).map((o) => `<option${o === f.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>${err}</div>`;
        if (f.kind === "textarea") return `<div class="${cls}">${label}<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder ?? "")}">${esc(f.value ?? "")}</textarea>${err}</div>`;
        if (f.kind === "toggle") return `<div class="field tog"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="checkbox" role="switch"${f.value && !/^(no|off|false)$/i.test(f.value) ? " checked" : ""}></div>`;
        return `<div class="${cls}">${label}<input id="${id}" type="${f.kind === "date" ? "date" : "text"}" placeholder="${esc(f.placeholder ?? "")}" value="${esc(bad ? "" : f.value ?? "")}">${err}</div>`;
      }).join("")}<div class="row"><button type="submit" class="btn primary" data-act="submit">${esc(b.submit)}</button></div></form>`;
    case "chart": {
      const pts = b.points.map((p) => ({ label: p.label, value: num(p.value) }));
      const max = Math.max(1, ...pts.map((p) => p.value));
      if (b.kind === "line") {
        const W = 420, H = 150, step = W / Math.max(1, pts.length - 1);
        const xy = pts.map((p, i) => [Math.round(i * step), Math.round(H - 14 - (p.value / max) * (H - 34))] as const);
        const line = xy.map(([x, y]) => `${x},${y}`).join(" ");
        return `<div class="card chart"><h4>${esc(b.title)}</h4><svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${esc(b.title)}"><defs><linearGradient id="ar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--a1)" stop-opacity=".35"/><stop offset="1" stop-color="var(--a1)" stop-opacity="0"/></linearGradient></defs><polygon class="area" points="0,${H} ${line} ${W},${H}" fill="url(#ar)"/><polyline class="ln" points="${line}" fill="none" stroke="var(--a1)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>${xy.map(([x, y], i) => `<circle class="dot" cx="${x}" cy="${y}" r="3.5" style="--d:${i}"><title>${esc(pts[i]!.label)}: ${pts[i]!.value}</title></circle>`).join("")}${pts.map((p, i) => `<text x="${Math.round(i * step)}" y="${H + 14}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${esc(p.label)}</text>`).join("")}</svg></div>`;
      }
      return `<div class="card chart"><h4>${esc(b.title)}</h4><div class="bars">${pts.map((p, i) => `<div class="bar" style="--h:${Math.round((p.value / max) * 100)}%;--d:${i}" title="${esc(p.label)}: ${p.value}"><span class="n">${p.value}</span><i></i><span class="l">${esc(p.label)}</span></div>`).join("")}</div></div>`;
    }
    case "steps":
      return `<ol class="steps">${b.items.map((t, i) => `<li class="${i < b.current ? "done" : i === b.current ? "now" : ""}"><span>${i < b.current ? "✓" : i + 1}</span>${esc(t)}</li>`).join("")}</ol>`;
    case "timeline":
      return `<div class="card tl">${b.items.map((it) => `<div class="ev ${it.status}"><span class="t">${esc(it.time)}</span><i></i><div><b>${esc(it.title)}</b>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}</div></div>`).join("")}</div>`;
    case "detail":
      return `<div class="card detail ${b.style}">${b.title || b.lead ? `<div class="dh">${b.title ? `<b>${esc(b.title)}</b>` : ""}${b.lead ? `<div><span class="k">${esc(b.lead.label)}</span><strong>${esc(b.lead.value)}</strong></div>` : ""}</div>` : ""}<dl>${b.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("")}</dl></div>`;
    case "cards":
      return `<div class="cards">${b.items.map((it) => `<div class="card item">${b.visual ? `<div class="pic" aria-hidden="true">${esc(it.title.slice(0, 1))}</div>` : ""}<div class="row sp"><b>${esc(it.title)}</b>${it.badge ? `<span class="badge ${tone(it.badge)}">${esc(it.badge)}</span>` : ""}</div><span class="meta">${esc(it.meta)}</span></div>`).join("")}</div>`;
    case "list":
      return `<div class="card list">${b.items.map((it) => `<div class="li"><span class="pip"></span><div><b>${esc(it.title)}</b><span class="meta">${esc(it.meta)}</span></div></div>`).join("")}</div>`;
    case "actions":
      return `<div class="row">${b.buttons.map((t, i) => `<button type="button" class="btn${i === 0 ? " primary" : ""}" data-act="act">${esc(t)}</button>`).join("")}</div>`;
    default:
      return `<p class="lead">${esc(b.body)}</p>`;
  }
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

const banner = (kind: "bad" | "ok" | "warn", text: string, retry = false): string =>
  `<div class="banner ${kind}" role="${kind === "bad" ? "alert" : "status"}">${kind === "bad" ? ICONS.alert : kind === "ok" ? ICONS.check : ICONS.alert}<span>${esc(text)}</span>${retry ? '<button type="button" class="btn ghost" data-act="retry">Try again</button>' : ""}</div>`;

/** One state of one screen drawn from its sample content. */
function renderMock(m: ScreenMock, k: StateKind, state: string): string {
  const c = m.copy;
  const head = `<div class="ph"><div><h3>${esc(m.title)}</h3>${m.subtitle ? `<p class="sub">${esc(m.subtitle)}</p>` : ""}</div></div>`;
  const keep = (b: MockBlock) => b.type === "filters" || b.type === "actions" || b.type === "stats" || b.type === "text";
  let body: string;
  // loading keeps everything static (title, labels, headers, filters, buttons) and turns only the data into shimmering shapes, under a progress bar;
  // empty previews what the page fills with; error keeps the last good data dimmed behind the message; "Full data" is a state of its own
  if (k === "loading") body = `<div class="prog" role="progressbar" aria-label="Loading"><i></i></div>${m.blocks.map(skeleton).join("")}`;
  else if (k === "empty") {
    const lead = m.blocks.filter((b) => b.type === "filters" || b.type === "actions").map((b) => renderBlock(b, k)).join("");
    const sample = m.blocks.find((b) => !keep(b));
    body = `${lead}<div class="card empty">${ICONS.inbox}<h4>${esc(c.emptyTitle ?? "Nothing here yet")}</h4><p>${esc(c.emptyHint ?? "When there is something to show, it appears here.")}</p></div>${sample ? `<div class="preview"><span class="pv">What this fills with</span>${renderBlock(sample, k)}</div>` : ""}`;
  } else if (k === "error") {
    body = `${banner("bad", c.error ?? "Something went wrong. Try again in a moment.", true)}<div class="stale">${m.blocks.map((b) => renderBlock(b, k)).join("")}</div>`;
  } else {
    const hasForm = m.blocks.some((b) => b.type === "form");
    const lead = k === "success" ? banner("ok", c.success ?? "Done.") : k === "validation" && !hasForm ? banner("warn", c.validation ?? "Check the highlighted details and try again.") : k === "validation" && c.validation ? banner("warn", c.validation) : "";
    body = `${lead}${m.blocks.map((b) => renderBlock(b, k)).join("")}`;
  }
  return `<div class="app" data-kind="${k}" aria-label="${esc(state)}">${head}<div class="body">${body}</div></div>`;
}


const DEFAULT_THEME: DesignTheme = { mood: "clean product", mode: "light", brand: "#1a56db", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", fx: "modern" };

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as RGB;
const lum = (c: RGB): number => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
/** A colour kept readable as text and lines on its background: lifted on dark, deepened on light. */
const fit = (hex: string, dark: boolean): string => {
  let c = rgb(hex);
  for (let i = 0; i < 6 && (dark ? lum(c) < 0.22 : lum(c) > 0.3); i++) c = mix(c, dark ? [255, 255, 255] : [0, 0, 0], 0.18);
  return toHex(c);
};

// Neutrals tinted a hair toward cool, warm or none: the page is mostly these, with one brand colour and meaning-only status colours.
const NEUTRALS = {
  light: { cool: ["#f5f6f8", "#ffffff", "#12151c", "#596273", "#e1e4ea"], warm: ["#f7f5f1", "#ffffff", "#1d1a16", "#6a645b", "#e7e2d9"], pure: ["#f4f4f4", "#ffffff", "#111111", "#666666", "#e2e2e2"] },
  dark: { cool: ["#0e1117", "#171b23", "#eceef3", "#99a1b0", "#2a303b"], warm: ["#12100e", "#1c1a17", "#f1ede6", "#a39b8f", "#322e29"], pure: ["#0b0b0b", "#171717", "#f0f0f0", "#9a9a9a", "#2b2b2b"] },
} as const;
const FONTS = {
  sans: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  humanist: '"Segoe UI","Gill Sans","Trebuchet MS",Optima,Candara,ui-sans-serif,sans-serif',
  serif: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Nunito,"Varela Round",ui-sans-serif,system-ui,sans-serif',
};

/** The page's colour variables from the chosen theme (a bad or absent theme gives the default). */
export function themeCss(theme?: DesignTheme): string {
  const t = { ...DEFAULT_THEME, ...theme };
  const set = (dark: boolean): string => {
    const [bg, sf, ink, mut, edge] = NEUTRALS[dark ? "dark" : "light"][t.neutral];
    const a1 = fit(t.brand, dark), a2 = fit(t.accent ?? t.brand, dark);
    const on = lum(rgb(t.brand)) > 0.34 ? "#10131a" : "#ffffff";
    const glass = t.surface === "glass";
    return `--bg:${bg};--sf:${glass ? (dark ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.7)") : sf};--ink:${ink};--mut:${mut};--edge:${edge};--br:${t.brand};--a1:${a1};--a2:${a2};--on:${on};--ok:${dark ? "#3ddc97" : "#0f7b4f"};--bad:${dark ? "#ff7a85" : "#c8243a"};--warn:${dark ? "#f5b73b" : "#a35a00"};--shadow:${t.surface === "soft" ? (dark ? "0 6px 20px rgba(0,0,0,.35)" : "0 4px 16px rgba(20,25,40,.07)") : "none"};--blur:${glass ? "blur(14px)" : "none"}`;
  };
  const shared = `--r:${{ sharp: 4, soft: 10, round: 18 }[t.radius]}px;--pad:${t.density === "compact" ? 10 : 16}px;--font:${FONTS[t.font]};--head:${t.font === "serif" ? 'Georgia,"Iowan Old Style","Palatino Linotype",serif' : "inherit"};--e:cubic-bezier(.2,.8,.2,1);--rise:${t.motion === "calm" ? 6 : 12}px;--drift:${t.motion === "calm" ? "paused" : "running"}`;
  return t.mode === "auto" ? `:root{${shared};${set(false)}}@media(prefers-color-scheme:dark){:root{${set(true)}}}` : `:root{${shared};${set(t.mode === "dark")}}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;font:14px/1.5 var(--font);color:var(--ink);background:var(--bg);overflow-x:hidden}
h1,h2,h3,h4{font-family:var(--head)}
aside{width:260px;flex:none;padding:22px 16px;border-right:1px solid var(--edge);background:var(--sf);backdrop-filter:var(--blur);overflow:auto;max-height:100vh;position:sticky;top:0}
aside h1{font-size:15px;margin:0 0 6px}
aside p{color:var(--mut);font-size:12.5px;margin:.2rem 0 1rem}aside h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin:1.4rem 0 .5rem;font-family:var(--font)}
aside ul{list-style:none;padding:0;margin:0;display:grid;gap:2px}
aside a{display:block;padding:7px 10px;border-radius:calc(var(--r) - 2px);color:inherit;text-decoration:none;transition:background .2s}
aside a:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
aside a.on{background:color-mix(in srgb,var(--a1) 12%,transparent);color:var(--a1);font-weight:600}
aside code,.file{color:var(--mut);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
aside li li{font-size:12px;color:var(--mut)}
main{flex:1;min-width:0;padding:24px clamp(14px,3vw,36px) 60px}
.screen:not([hidden]){animation:enter .4s var(--e) both}
@keyframes enter{from{opacity:0;transform:translateY(calc(var(--rise)*.6))}}
.top{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin-bottom:10px}
.top h2{margin:0;font-size:13px;font-weight:600;color:var(--mut);font-family:var(--font)}.top .tag{margin-left:auto}
.tag{border:1px solid var(--edge);background:var(--sf);border-radius:99px;padding:2px 11px;font-size:11.5px;color:var(--mut)}
.states{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;border:1px solid var(--edge);border-radius:calc(var(--r) + 2px);background:var(--sf);margin:0 0 14px}
.states button{border:0;background:transparent;color:var(--mut);padding:5px 14px;border-radius:var(--r);cursor:pointer;font:inherit;text-transform:capitalize;transition:color .2s,background .2s}
.states button:hover{color:var(--ink)}
.states .on{color:var(--on);background:var(--br)}
.canvas{border:1px solid var(--edge);border-radius:calc(var(--r) + 4px);background:var(--bg);box-shadow:var(--shadow);overflow:hidden}
.chrome{display:flex;align-items:center;gap:18px;padding:0 var(--pad);height:52px;background:var(--sf);backdrop-filter:var(--blur);border-bottom:1px solid var(--edge)}
.chrome .lg{font-size:15px;font-family:var(--head);letter-spacing:-.01em;white-space:nowrap}
.chrome nav{display:flex;gap:4px;overflow:auto;flex:1;min-width:0}
.chrome nav a{color:var(--mut);text-decoration:none;padding:6px 11px;border-radius:calc(var(--r) - 2px);white-space:nowrap;font-weight:500;transition:color .2s,background .2s}
.chrome nav a:hover{color:var(--ink)}.chrome nav a.on{color:var(--a1);background:color-mix(in srgb,var(--a1) 11%,transparent)}
.chrome .me{width:28px;height:28px;border-radius:50%;background:color-mix(in srgb,var(--a1) 18%,var(--sf));color:var(--a1);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none}
.chrome.brand{background:var(--br);color:var(--on);border-color:transparent}
.chrome.brand nav a{color:color-mix(in srgb,var(--on) 78%,transparent)}.chrome.brand nav a:hover{color:var(--on)}.chrome.brand nav a.on{color:var(--on);background:color-mix(in srgb,var(--on) 18%,transparent)}
.chrome.brand .me{background:color-mix(in srgb,var(--on) 20%,transparent);color:var(--on)}
.pane{padding:22px clamp(14px,2.4vw,30px) 30px;min-height:260px}.pane[hidden]{display:none}.pane:not([hidden]){animation:enter .35s var(--e) both}
.canvas img{max-width:100%;display:block;margin:18px auto}.wire{background:#fff;border-radius:var(--r);padding:10px;margin:14px}.wire svg{display:block;max-width:640px;margin:0 auto}
.ph h3{margin:0;font-size:clamp(20px,2.4vw,26px);letter-spacing:-.015em}
.sub{margin:.25rem 0 0;color:var(--mut)}.body{display:grid;gap:16px;margin-top:18px}
.body>*{animation:rise .45s var(--e) both}.body>:nth-child(2){animation-delay:.05s}.body>:nth-child(3){animation-delay:.1s}.body>:nth-child(4){animation-delay:.15s}.body>:nth-child(5){animation-delay:.2s}.body>:nth-child(6){animation-delay:.25s}
@keyframes rise{from{opacity:0;transform:translateY(var(--rise))}}
.card{border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);backdrop-filter:var(--blur);box-shadow:var(--shadow);padding:var(--pad);transition:border-color .2s,box-shadow .2s}
.card.item:hover,.stat:hover{border-color:color-mix(in srgb,var(--a1) 45%,var(--edge))}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{border:1px solid var(--edge);border-radius:var(--r);padding:calc(var(--pad) - 2px) var(--pad);background:var(--sf);backdrop-filter:var(--blur);box-shadow:var(--shadow);display:grid;gap:2px;transition:border-color .2s}
.stat .k{color:var(--mut);font-size:12px}.stat .v{font-size:clamp(22px,2.6vw,28px);letter-spacing:-.02em;font-variant-numeric:tabular-nums;font-weight:650}
.delta{font-size:12px;font-weight:600}.delta.up{color:var(--ok)}.delta.dn{color:var(--bad)}
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.row.sp{justify-content:space-between}
.search{display:flex;align-items:center;gap:8px;padding:0 12px;height:38px;border-radius:var(--r);border:1px solid var(--edge);background:var(--sf);min-width:220px;transition:border-color .2s,box-shadow .2s}
.search:focus-within{border-color:var(--a1);box-shadow:0 0 0 3px color-mix(in srgb,var(--a1) 18%,transparent)}
.search input{background:none;border:0;outline:0;color:inherit;font:inherit;flex:1;min-width:0}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.chart svg{width:100%;height:auto;stroke-width:inherit}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--edge);background:var(--sf);color:var(--mut);padding:5px 13px;border-radius:99px;cursor:pointer;font:inherit;transition:all .2s}
.chip:hover{color:var(--ink)}.chip.on{color:var(--on);border-color:transparent;background:var(--br)}
.tbl{padding:0;overflow:auto}table{width:100%;border-collapse:collapse;min-width:480px}
th{text-align:left;font-size:12px;color:var(--mut);padding:11px 16px;font-weight:600;border-bottom:1px solid var(--edge);background:color-mix(in srgb,var(--ink) 3%,transparent)}
td{padding:calc(var(--pad) - 3px) 16px;border-bottom:1px solid var(--edge);font-variant-numeric:tabular-nums;white-space:nowrap}tr:last-child td{border-bottom:0}
tbody tr{animation:rise .4s var(--e) both;transition:background .15s;cursor:default}tbody tr:hover,tbody tr.sel{background:color-mix(in srgb,var(--a1) 7%,transparent)}
${[1, 2, 3, 4, 5, 6].map((i) => `tbody tr:nth-child(${i}){animation-delay:${0.08 + i * 0.04}s}`).join("")}
.badge{display:inline-flex;align-items:center;gap:6px;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:600}
.badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}.badge.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.badge.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent)}.badge.info{color:var(--mut);background:color-mix(in srgb,var(--ink) 7%,transparent)}
.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px 16px;align-items:start}.form .row{grid-column:1/-1}
.field{display:grid;gap:5px}.field label{font-size:12.5px;font-weight:600}
.field input,.field select,.field textarea{background:var(--bg);border:1px solid var(--edge);color:inherit;border-radius:var(--r);padding:9px 12px;font:inherit;outline:0;transition:border-color .2s,box-shadow .2s}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--a1);box-shadow:0 0 0 3px color-mix(in srgb,var(--a1) 18%,transparent)}
.field.bad input,.field.bad select,.field.bad textarea{border-color:var(--bad);animation:shake .35s}.err{color:var(--bad);font-size:12px}
@keyframes shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.tog{display:flex;align-items:center;justify-content:space-between}.tog input{appearance:none;width:40px;height:22px;padding:0;border-radius:99px;position:relative;cursor:pointer;transition:background .25s}
.tog input:before{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .25s var(--e)}.tog input:checked{background:var(--br);border-color:transparent}.tog input:checked:before{transform:translateX(18px)}
.btn{border:1px solid var(--edge);background:var(--sf);color:var(--ink);padding:9px 20px;border-radius:var(--r);cursor:pointer;font:inherit;font-weight:600;position:relative;overflow:hidden;transition:background .2s,border-color .2s,transform .15s}
.btn:hover{border-color:var(--a1)}.btn:active{transform:scale(.98)}
.btn.primary{border-color:transparent;color:var(--on);background:var(--br)}.btn.primary:hover{background:color-mix(in srgb,var(--br) 88%,var(--ink))}
.btn.busy{pointer-events:none;opacity:.85}.btn.busy:after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent);animation:sweep .9s linear infinite}
@keyframes sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.chart h4{margin:0 0 12px;font-size:13px;color:var(--mut);font-weight:600;font-family:var(--font)}
.bars{display:flex;align-items:flex-end;gap:clamp(6px,2vw,16px);height:170px;padding-top:18px}.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%;position:relative}
.bar i{display:block;width:100%;max-width:44px;height:var(--h);border-radius:calc(var(--r) - 4px) calc(var(--r) - 4px) 2px 2px;background:var(--a1);transform-origin:bottom;animation:grow .8s var(--e) both;animation-delay:calc(var(--d)*60ms + .15s)}
@keyframes grow{from{transform:scaleY(0)}}
.bar .n{font-size:11px;color:var(--mut);opacity:0;transition:opacity .2s}.bar:hover .n{opacity:1}.bar .l{font-size:11px;color:var(--mut)}
.chart text{fill:var(--mut);font-size:10px;stroke:none}.chart .ln{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.2s var(--e) .15s forwards}.chart .area{opacity:0;animation:fade .8s ease .9s forwards}
.chart .dot{fill:var(--sf);stroke:var(--a1);stroke-width:2;opacity:0;animation:fade .4s ease forwards;animation-delay:calc(var(--d)*80ms + .7s)}
@keyframes draw{to{stroke-dashoffset:0}}@keyframes fade{to{opacity:1}}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.item{display:grid;gap:6px;align-content:start}.meta{color:var(--mut);font-size:12.5px;display:block}
.pic{height:86px;margin:calc(var(--pad)*-1) calc(var(--pad)*-1) 4px;border-radius:calc(var(--r) - 1px) calc(var(--r) - 1px) 0 0;background:linear-gradient(135deg,color-mix(in srgb,var(--br) 22%,var(--sf)),color-mix(in srgb,var(--a2) 10%,var(--sf)));display:grid;place-items:center;font:700 30px var(--head);color:color-mix(in srgb,var(--a1) 70%,transparent)}
.list .li{display:flex;gap:12px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--edge)}.list .li:last-child{border:0}.pip{width:8px;height:8px;border-radius:50%;margin-top:7px;background:var(--a1);flex:none}
.steps{display:flex;gap:0;list-style:none;margin:0;padding:0;overflow:auto}.steps li{flex:1;display:flex;align-items:center;gap:9px;color:var(--mut);white-space:nowrap;min-width:max-content;padding-right:14px;position:relative}
.steps li span{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--edge);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none;background:var(--sf)}
.steps li:not(:last-child):after{content:"";flex:1;height:2px;min-width:18px;background:var(--edge);margin-left:6px}
.steps .done span{background:var(--br);border-color:var(--br);color:var(--on)}.steps .done:not(:last-child):after{background:var(--br)}.steps .now{color:var(--ink);font-weight:600}.steps .now span{border-color:var(--br);color:var(--a1)}
.tl{display:grid;gap:0}.ev{display:grid;grid-template-columns:78px 14px 1fr;gap:12px;padding:9px 0;align-items:start;position:relative}.ev .t{color:var(--mut);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;padding-top:1px}
.ev i{width:10px;height:10px;border-radius:50%;border:2px solid var(--edge);background:var(--sf);margin-top:5px;position:relative;z-index:1}.ev:not(:last-child) i:after{content:"";position:absolute;left:2px;top:12px;width:2px;height:calc(100% + 24px);background:var(--edge)}
.ev.done i{background:var(--br);border-color:var(--br)}.ev.now i{border-color:var(--br);box-shadow:0 0 0 4px color-mix(in srgb,var(--br) 20%,transparent)}.ev.next{opacity:.7}
.detail dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px 18px}.detail dt{font-size:11.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}.detail dd{margin:2px 0 0;font-weight:600}
.dh{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.dh .k{display:block;font-size:11.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}.dh strong{font-size:22px;letter-spacing:-.01em}
.detail.pass{border-top:4px solid var(--br)}.detail.pass dl{border-top:2px dashed var(--edge);padding-top:14px}
.lead{color:var(--mut);margin:0;max-width:62ch}
.banner{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:var(--r);border:1px solid;animation:rise .4s var(--e) both}.banner span{flex:1}
.banner.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 9%,var(--bg))}.banner.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 9%,var(--bg))}.banner.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,var(--bg))}
.banner .btn{padding:4px 12px;color:inherit}
.stale{display:grid;gap:16px;opacity:.5;pointer-events:none}
.empty{display:grid;justify-items:center;text-align:center;gap:6px;padding:46px 20px;border-style:dashed}.empty svg{width:42px;height:42px;color:var(--mut)}
.empty h4{margin:.4rem 0 0;font-size:17px}.empty p{margin:0;color:var(--mut);max-width:42ch}
.sk{display:block;border-radius:6px;margin:8px 0;background:linear-gradient(100deg,color-mix(in srgb,var(--ink) 7%,transparent) 30%,color-mix(in srgb,var(--ink) 13%,transparent) 50%,color-mix(in srgb,var(--ink) 7%,transparent) 70%);background-size:220% 100%;animation:shim 1.4s linear infinite}
@keyframes shim{to{background-position:-220% 0}}.skrow{display:flex;gap:16px;align-items:center}.skrow .sk{flex:none}.skfield{margin-bottom:6px}
.toast{position:fixed;right:20px;bottom:20px;z-index:9;display:flex;gap:10px;align-items:center;padding:11px 16px;border-radius:var(--r);background:var(--ink);color:var(--bg);box-shadow:0 12px 32px -10px rgba(0,0,0,.4);animation:toast 3s var(--e) forwards}
@keyframes toast{0%{opacity:0;transform:translateY(16px)}12%,85%{opacity:1;transform:none}100%{opacity:0;transform:translateY(8px)}}
.serves{margin-top:18px;border:1px solid var(--edge);border-radius:var(--r);background:var(--sf);padding:12px 16px}.serves summary{cursor:pointer;color:var(--mut);font-size:12.5px}
.serves ul{margin:.6rem 0 0;padding-left:18px;color:var(--mut);font-size:12.5px}.serves b{color:var(--ink)}
.nav{margin:14px 0 0;display:flex;flex-wrap:wrap;gap:8px}.nav a{color:var(--a1);text-decoration:none;font-size:12.5px;border-bottom:1px solid transparent}.nav a:hover{border-color:currentColor}
body.fx-modern main:before,body.fx-futuristic main:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(60vw 40vh at 85% -8%,color-mix(in srgb,var(--br) 16%,transparent),transparent 70%),radial-gradient(50vw 40vh at 0% 105%,color-mix(in srgb,var(--a2) 11%,transparent),transparent 70%)}
body.fx-modern .card.item,body.fx-modern .stat,body.fx-futuristic .card.item,body.fx-futuristic .stat{transition:transform .25s var(--e),border-color .2s,box-shadow .25s}
body.fx-modern .card.item:hover,body.fx-modern .stat:hover,body.fx-futuristic .card.item:hover,body.fx-futuristic .stat:hover{transform:translateY(-3px);box-shadow:0 14px 32px -16px color-mix(in srgb,var(--br) 45%,transparent)}
body.fx-modern .btn.primary,body.fx-futuristic .btn.primary{box-shadow:0 8px 22px -10px var(--br)}
body.fx-futuristic main:before{background:radial-gradient(46vw 36vh at 82% -6%,color-mix(in srgb,var(--br) 26%,transparent),transparent 70%),radial-gradient(42vw 36vh at 4% 100%,color-mix(in srgb,var(--a2) 20%,transparent),transparent 70%),radial-gradient(30vw 30vh at 50% 45%,color-mix(in srgb,var(--a1) 8%,transparent),transparent 70%);animation:aurora 18s ease-in-out infinite alternate;animation-play-state:var(--drift)}
@keyframes aurora{to{transform:translate3d(-2.5%,2%,0) scale(1.06)}}
body.fx-futuristic .ph h3,body.fx-futuristic aside h1,body.fx-futuristic .chrome .lg{background:linear-gradient(100deg,var(--ink),color-mix(in srgb,var(--a1) 80%,var(--ink)));-webkit-background-clip:text;background-clip:text;color:transparent}
body.fx-futuristic .card,body.fx-futuristic .stat{position:relative;background-image:radial-gradient(240px circle at var(--mx,50%) var(--my,0%),color-mix(in srgb,var(--br) 14%,transparent),transparent 70%)}
body.fx-futuristic .canvas{border-color:color-mix(in srgb,var(--br) 28%,var(--edge));box-shadow:0 30px 70px -40px color-mix(in srgb,var(--br) 55%,transparent)}
body.fx-futuristic .badge:before{box-shadow:0 0 8px currentColor}
body.fx-futuristic .ev.now i{animation:ping 1.8s ease-out infinite}
@keyframes ping{70%{box-shadow:0 0 0 10px transparent}}
.prog{height:3px;border-radius:3px;background:color-mix(in srgb,var(--br) 14%,transparent);overflow:hidden;position:relative}.prog i{position:absolute;inset:0 auto 0 0;width:38%;background:var(--br);border-radius:3px;animation:slide 1.2s var(--e) infinite}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(280%)}}
.skbars{display:flex;align-items:flex-end;gap:clamp(6px,2vw,16px);height:170px;padding-top:18px}.skbars .sk{flex:1;margin:0;border-radius:calc(var(--r) - 4px) calc(var(--r) - 4px) 2px 2px}
.tbl .sk{margin:2px 0}
.preview{position:relative;display:grid;gap:10px;opacity:.55;pointer-events:none}.pv{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
@media(max-width:760px){body{display:block}aside{width:auto;position:static;max-height:none;border-right:0;border-bottom:1px solid var(--edge)}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}}
`;

const JS = `
(function(){
  var $=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
  var secs=$(".screen"),links=$("aside a");
  function count(root){$("[data-count]",root).forEach(function(el){
    var raw=el.getAttribute("data-count"),m=raw.match(/^(\\D*?)(-?\\d[\\d,]*\\.?\\d*)(.*)$/);if(!m)return;
    var to=parseFloat(m[2].replace(/,/g,"")),dec=(m[2].split(".")[1]||"").length,t0=null,comma=m[2].indexOf(",")>-1;
    if(!isFinite(to)||matchMedia("(prefers-reduced-motion:reduce)").matches)return;
    function fmt(v){var s=v.toFixed(dec);return comma?Number(s).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}):s}
    function step(t){if(t0===null)t0=t;var p=Math.min(1,(t-t0)/900),e=1-Math.pow(1-p,3);el.textContent=m[1]+fmt(to*e)+m[3];if(p<1)requestAnimationFrame(step)}
    el.textContent=m[1]+fmt(0)+m[3];requestAnimationFrame(step);setTimeout(function(){el.textContent=raw},1300)})}
  function show(){var id=decodeURIComponent((location.hash||"").slice(1))||(secs[0]&&secs[0].id);
    secs.forEach(function(s){var on=s.id===id;s.hidden=!on;if(on)count(s)});
    links.forEach(function(a){a.className=a.getAttribute("href")==="#"+id?"on":""})}
  function toast(s,t){var d=document.createElement("div");d.className="toast";d.setAttribute("role","status");d.textContent=t;s.appendChild(d);setTimeout(function(){d.remove()},3100)}
  secs.forEach(function(s){
    $("[data-state]",s).forEach(function(b){b.addEventListener("click",function(){
      $("[data-state]",s).forEach(function(x){x.className=""});b.className="on";
      var k=b.getAttribute("data-state");$("[data-wf]",s).forEach(function(w){var on=w.getAttribute("data-wf")===k;w.hidden=!on;if(on)count(w)})})});
    s.addEventListener("input",function(e){var t=e.target;if(!t.matches||!t.matches('input[type=search]'))return;
      var q=t.value.toLowerCase(),pane=t.closest(".pane");$("tbody tr",pane).forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>-1?"":"none"})});
    s.addEventListener("click",function(e){var t=e.target.closest?e.target.closest("button,tr"):null;if(!t)return;var pane=t.closest(".pane");
      if(t.tagName==="TR"&&t.parentNode.tagName==="TBODY"){$("tr.sel",pane).forEach(function(r){r.classList.remove("sel")});t.classList.add("sel");return}
      if(t.classList.contains("chip")){$(".chip",t.parentNode).forEach(function(c){c.classList.remove("on")});t.classList.add("on");
        $(".tbl,.cards,.list",pane).forEach(function(x){x.style.opacity=.35;setTimeout(function(){x.style.opacity=""},450)});return}
      var act=t.getAttribute("data-act");if(!act)return;t.classList.add("busy");
      setTimeout(function(){t.classList.remove("busy");if(act==="submit")toast(s,"Saved");else if(act==="act")toast(s,t.textContent+" done")},800)});
  });
  if(document.body.className.indexOf("fx-futuristic")>-1&&!matchMedia("(prefers-reduced-motion:reduce)").matches)document.addEventListener("pointermove",function(e){var c=e.target.closest&&e.target.closest(".card,.stat");if(!c)return;var r=c.getBoundingClientRect();c.style.setProperty("--mx",(e.clientX-r.left)+"px");c.style.setProperty("--my",(e.clientY-r.top)+"px")});
  window.addEventListener("hashchange",show);show();
})();
`;

export function buildDemo(d: DemoInput): string {
  const screens = d.screens;
  const frame = (id: string) => d.frames?.[id];
  const panel = (s: Screen, i: number): string => {
    const states = demoStates(s);
    const shown = s.frames.map(frame).filter((f) => f?.dataUri);
    const reqs = s.reqs.map((r) => `<li><b>${esc(r)}</b> ${esc(d.requirements[r] ?? "")}</li>`).join("");
    const pane = (st: string, k: number): string => {
      const hidden = k === 0 ? "" : " hidden";
      const inner = st === FULL_DATA && s.mockFull
        ? renderMock(s.mockFull, "normal", st)
        : s.mock
        ? renderMock(s.mock, stateKind(st), st)
        : `<div class="wire">${wireframeSvg(s, st, s.reqs.map((r) => ({ id: r, text: d.requirements[r] ?? "" })))}</div>`;
      return `<div class="pane" data-wf="${k}"${hidden}>${inner}</div>`;
    };
    return `<section class="screen" id="${esc(s.id)}" data-i="${i}" hidden>
<div class="top"><h2>${esc(s.id)} <code>${esc(s.route)}</code></h2><span class="tag">${esc(s.size)}</span></div>
<p class="file">${esc(s.file)}</p>
<div class="states" role="tablist">${states.map((st, k) => `<button role="tab" data-state="${k}"${k === 0 ? ' class="on"' : ""}>${esc(st)}</button>`).join("")}</div>
<div class="canvas"><div class="chrome${d.theme?.chrome === "brand" ? " brand" : ""}"><b class="lg">${esc(d.title)}</b><nav>${screens.map((o) => `<a href="#${esc(o.id)}"${o.id === s.id ? ' class="on"' : ""}>${esc(o.mock?.title ?? o.id)}</a>`).join("")}</nav><span class="me" aria-hidden="true">${esc(d.title.trim().slice(0, 1).toUpperCase())}</span></div>${shown.length
    ? shown.map((f) => `<img src="${f!.dataUri}" alt="${esc(f!.name)}">`).join("")
    : states.map(pane).join("")}</div>
<details class="serves"><summary>Serves ${s.reqs.length} requirement${s.reqs.length === 1 ? "" : "s"}</summary><ul>${reqs || "<li>no requirement</li>"}</ul></details>
<p class="nav">${screens.filter((o) => o.id !== s.id).map((o) => `<a href="#${esc(o.id)}">${esc(o.id)} ${esc(o.route)}</a>`).join(" ")}</p>
</section>`;
  };
  const side = screens.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.mock?.title ?? s.id)} <code>${esc(s.route)}</code></a></li>`).join("");
  const none = d.noScreen.map((n) => `<li><b>${esc(n.req)}</b> ${esc(d.requirements[n.req] ?? "")} <i>(no screen: ${esc(n.reason)})</i></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${esc(d.title)} - design demo</title>
<meta name="color-scheme" content="${d.theme?.mode === "dark" ? "dark" : d.theme?.mode === "auto" ? "light dark" : "light"}">
<style>${themeCss(d.theme)}${CSS}</style></head><body class="fx-${esc(d.theme?.fx ?? "modern")}">
<aside><h1>${esc(d.title)}</h1><p>${esc(d.flow)}</p><h3>Screens</h3><ul>${side}</ul>${none ? `<h3>No screen</h3><ul>${none}</ul>` : ""}</aside>
<main>${screens.map(panel).join("\n")}</main>
<script>${JS}</script></body></html>
`;
}
