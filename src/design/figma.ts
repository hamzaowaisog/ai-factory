// The Figma export (docs/estimates-design.md, "Figma", route A): `figma.json`, which the AI Factory Import plugin
// (figma-plugin/) turns into editable layers in any Figma file the user can edit, on any plan, with no token and no network.
// The layers are read from the approved demo in the package (never the ledger), state by state, at each width, mode and
// language the export asks for: frames with their fills, borders, corners and shadows, text with its font, icons as SVG, and
// pictures where layers would be lossy. Where children sit in a row or a column with even gaps, the frame gets auto layout,
// inferred from where the browser put them, so the Figma frame stays where the demo drew it. The Components page's grids
// become component sets with variants, and the tokens become variables (light and dark modes).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { designTokens } from "./tokens.js";
import { findChromium, VIEWPORTS, type Viewport } from "./screenshots.js";
import type { DesignTheme } from "../contracts/artifacts.js";
import { inPage } from "./fidelity-read.js";
import { fontList, readDesignJson, w3cColour, type DesignPackage } from "./package.js";

export const FIGMA_SCHEMA_VERSION = 1;
/** Layers per frame; past it, what is left is a picture, so a huge page still imports. */
export const MAX_FIGMA_NODES = 4000;

export type RGBA = [number, number, number, number];
export interface FShadow { color: RGBA; x: number; y: number; blur: number; spread: number; inset?: boolean }
export interface FFont { families: string[]; weight: number; italic?: boolean; size: number; lineHeight?: number; letterSpacing?: number; case?: "UPPER" | "LOWER" | "TITLE"; underline?: boolean; strike?: boolean }
export interface FAuto { dir: "H" | "V"; gap: number; pad: [number, number, number, number]; align: "MIN" | "CENTER" | "MAX" }
interface FBase { name: string; x: number; y: number; w: number; h: number; opacity?: number }
export interface FFrame extends FBase {
  t: "frame";
  fill?: RGBA; gradient?: { angle: number; stops: { color: RGBA; at: number }[] };
  stroke?: { color: RGBA; w: [number, number, number, number] };
  radius?: [number, number, number, number]; shadows?: FShadow[]; clip?: boolean;
  auto?: FAuto; component?: { set: string; props: Record<string, string> };
  children: FNode[];
}
export interface FText extends FBase { t: "text"; chars: string; font: FFont; color: RGBA; align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"; lines: number }
export interface FSvg extends FBase { t: "svg"; svg: string }
export interface FImage extends FBase { t: "image"; png?: string; crop?: number }
export type FNode = FFrame | FText | FSvg | FImage;

export interface FigmaFrame {
  name: string; screen: string; title: string; app: string; state: string; viewport: Viewport; mode: "light" | "dark"; lang: string; dir: "ltr" | "rtl";
  w: number; h: number; root: FFrame; nodes: number;
  /** the approved picture of the same view, as a hidden reference layer */
  picture?: string;
}
export interface FigmaVariable { name: string; type: "COLOR" | "FLOAT" | "STRING"; values: Record<string, RGBA | number | string> }
export interface FigmaDoc {
  kind: "ai-factory/figma"; schemaVersion: number; tag: string;
  line: string; version: number; designSha: string; product: string;
  apps: { id: string; name: string }[];
  tokens?: { modes: string[]; variables: FigmaVariable[] };
  fonts: string[];
  frames: FigmaFrame[];
  notes: string[];
}

// ---------- in the page ----------

/** What the walker returns before the pictures are cut: raster nodes carry a crop number, and the rects to cut. */
export interface RawLayers { root: FFrame | null; crops: { x: number; y: number; w: number; h: number }[]; nodes: number; dir: string }

/**
 * Runs inside the page (serialised; no outer names). The element at `sel` as layers, every position relative to its parent
 * frame. Elements that draw nothing and hold one thing are dropped for what they hold; inputs show their value or placeholder.
 */
export function figmaLayers(a: { sel: string; max: number; components: boolean }): RawLayers {
  const root = document.querySelector(a.sel) as HTMLElement | null;
  const crops: RawLayers["crops"] = [];
  let count = 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sx = window.scrollX, sy = window.scrollY;
  const px = (v: string) => parseFloat(v) || 0;
  // any CSS colour (rgb, color(srgb ...) from color-mix, oklch, ...) as sRGB through a canvas, which knows them all
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const seen = new Map<string, number[] | null>();
  const colour = (c: string): number[] | null => {
    if (!c || c === "transparent" || c === "none") return null;
    if (seen.has(c)) return seen.get(c)!;
    let out: number[] | null = null;
    const m = /^rgba?\(([^)]+)\)$/.exec(c.trim());
    if (m) {
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      out = [p[0]! / 255, p[1]! / 255, p[2]! / 255, p.length > 3 ? p[3]! : 1];
    } else {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = [d[0]! / 255, d[1]! / 255, d[2]! / 255, d[3]! / 255];
    }
    out = out.map((x) => Math.round(x * 10000) / 10000);
    const r = out[3]! > 0 ? out : null;
    seen.set(c, r);
    return r;
  };
  const visible = (cs: CSSStyleDeclaration) => cs.display !== "none" && cs.visibility !== "hidden" && cs.visibility !== "collapse" && parseFloat(cs.opacity) > 0;
  const nameOf = (el: Element): string => {
    const t = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.id;
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return (t ? `${el.tagName.toLowerCase()} ${t}` : `${el.tagName.toLowerCase()}${cls}`).slice(0, 60);
  };
  const shadows = (v: string) => {
    if (!v || v === "none") return undefined;
    const parts: string[] = [];
    let depth = 0, cur = "";
    for (const ch of v) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; }
    parts.push(cur);
    const out = parts.map((s) => {
      const fn = /(?:rgba?|color|oklch|oklab|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/i.exec(s)?.[0];
      const col = fn ? colour(fn) : null;
      const lens = s.replace(fn ?? "", "").replace("inset", "").trim().split(/\s+/).map(px);
      return col ? { color: col, x: lens[0] ?? 0, y: lens[1] ?? 0, blur: lens[2] ?? 0, spread: lens[3] ?? 0, ...(/inset/.test(s) ? { inset: true } : {}) } : null;
    }).filter(Boolean);
    return out.length ? out : undefined;
  };
  const gradient = (v: string) => {
    const m = /linear-gradient\((.*)\)/.exec(v);
    if (!m) return undefined;
    const stops = [...m[1]!.matchAll(/((?:rgba?|color|oklch|oklab|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]{3,8})\s*([\d.]+%)?/gi)].map((s, i, all) => ({ color: colour(s[1]!) ?? [0, 0, 0, 0], at: s[2] ? parseFloat(s[2]) / 100 : i / Math.max(1, all.length - 1) }));
    const ang = /^\s*(-?[\d.]+)deg/.exec(m[1]!);
    const to = /^\s*to (\w+)/.exec(m[1]!)?.[1];
    const angle = ang ? parseFloat(ang[1]!) : to === "right" ? 90 : to === "left" ? 270 : to === "top" ? 0 : 180;
    return stops.length >= 2 ? { angle, stops } : undefined;
  };
  const crop = (r: DOMRect) => { crops.push({ x: r.x + sx, y: r.y + sy, w: r.width, h: r.height }); return crops.length - 1; };
  const font = (cs: CSSStyleDeclaration) => {
    const lh = cs.lineHeight === "normal" ? undefined : px(cs.lineHeight);
    const ls = cs.letterSpacing === "normal" ? undefined : px(cs.letterSpacing);
    const tt = cs.textTransform, deco = cs.textDecorationLine;
    return {
      families: cs.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
      weight: parseInt(cs.fontWeight, 10) || 400, size: px(cs.fontSize),
      ...(cs.fontStyle === "italic" || cs.fontStyle === "oblique" ? { italic: true } : {}),
      ...(lh ? { lineHeight: r2(lh) } : {}), ...(ls ? { letterSpacing: r2(ls) } : {}),
      ...(tt === "uppercase" ? { case: "UPPER" } : tt === "lowercase" ? { case: "LOWER" } : tt === "capitalize" ? { case: "TITLE" } : {}),
      ...(deco.includes("underline") ? { underline: true } : {}), ...(deco.includes("line-through") ? { strike: true } : {}),
    };
  };
  const align = (cs: CSSStyleDeclaration) => {
    const v = cs.textAlign, rtl = cs.direction === "rtl";
    if (v === "center") return "CENTER";
    if (v === "justify") return "JUSTIFIED";
    if (v === "right" || (v === "end" && !rtl) || (v === "start" && rtl)) return "RIGHT";
    return "LEFT";
  };
  const textLeaf = (chars: string, r: DOMRect, cs: CSSStyleDeclaration, ox: number, oy: number, rects: number) => {
    const c = colour(cs.color);
    if (!c || !chars) return null;
    count++;
    return { t: "text", name: chars.slice(0, 40), x: r2(r.x - ox), y: r2(r.y - oy), w: r2(r.width), h: r2(r.height), chars, font: font(cs), color: c, align: align(cs), lines: rects };
  };
  const svgOf = (el: SVGElement, cs: CSSStyleDeclaration) => {
    const clone = el.cloneNode(true) as SVGElement;
    const a = [el, ...el.querySelectorAll("*")], b = [clone, ...clone.querySelectorAll("*")];
    a.forEach((src, i) => {
      const s = getComputedStyle(src), d = b[i] as Element;
      if (s.display === "none") { d.remove(); return; }
      for (const k of ["fill", "stroke"] as const) { const v = s.getPropertyValue(k); if (v && v !== "none") d.setAttribute(k, v); else if (v === "none") d.setAttribute(k, "none"); }
      const sw = s.getPropertyValue("stroke-width");
      if (sw) d.setAttribute("stroke-width", sw.replace("px", ""));
      if (parseFloat(s.opacity) < 1) d.setAttribute("opacity", s.opacity);
    });
    const r = el.getBoundingClientRect();
    clone.setAttribute("width", String(r.width));
    clone.setAttribute("height", String(r.height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    return clone.outerHTML.split("currentColor").join(cs.color);
  };
  const cells = new Map<Element, { set: string; props: Record<string, string> }>();
  if (a.components && root) {
    // the Components page: a grid is a set with a row and a column property; a row of chips or a stack of alerts is a set with one
    for (const g of root.querySelectorAll("section.kg")) {
      const set = (g.querySelector("h4")?.textContent ?? "").trim();
      if (!set || /^colou?rs$/i.test(set)) continue;
      for (const grid of g.querySelectorAll(".kgrid")) {
        const heads = [...grid.querySelectorAll(":scope > .kh")].map((x) => (x.textContent ?? "").trim());
        let row = "";
        let col = 0;
        for (const ch of grid.children) {
          if (ch.classList.contains("kh")) continue;
          if (ch.classList.contains("kl")) { row = (ch.textContent ?? "").trim(); col = 0; continue; }
          if (!row) continue;
          const cell = ch.firstElementChild ?? ch;
          cells.set(cell, { set, props: { Variant: row, State: heads[col] ?? String(col + 1) } });
          col++;
        }
      }
      for (const wrap of g.querySelectorAll(":scope > .kwrap, :scope > .kit")) {
        [...wrap.children].forEach((ch, i) => {
          if (cells.has(ch)) return;
          const label = ((ch as HTMLElement).innerText ?? "").trim().split("\n")[0]!.slice(0, 32) || String(i + 1);
          cells.set(ch, { set, props: { Name: label } });
        });
      }
    }
  }
  const walk = (el: Element, ox: number, oy: number): unknown => {
    const cs = getComputedStyle(el);
    if (!visible(cs)) return null;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const op = parseFloat(cs.opacity);
    const base = (t: string) => ({ t, name: nameOf(el), x: r2(r.x - ox), y: r2(r.y - oy), w: r2(r.width), h: r2(r.height), ...(op < 1 ? { opacity: r2(op) } : {}) });
    if (count >= a.max && r.width > 0 && r.height > 0) { count++; return { ...base("image"), crop: crop(r) }; }
    if (tag === "svg") { if (!r.width || !r.height) return null; count++; return { ...base("svg"), svg: svgOf(el as SVGElement, cs) }; }
    // a control the browser draws itself (a native tick box, radio, slider) is a picture of how it looks
    const native = (tag === "input" && ["checkbox", "radio", "range", "color", "file"].includes((el as HTMLInputElement).type) && cs.appearance !== "none") || tag === "progress" || tag === "meter";
    if (native || tag === "img" || tag === "canvas" || tag === "video" || tag === "picture" || tag === "iframe" || /url\(/.test(cs.backgroundImage)) {
      if (!r.width || !r.height) return null;
      count++;
      return { ...base("image"), crop: crop(r) };
    }
    const kids: unknown[] = [];
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const i = el as HTMLInputElement;
      const kind = (i.type || "").toLowerCase();
      if (!["checkbox", "radio", "range", "color", "file", "hidden"].includes(kind)) {
        const value = tag === "select" ? ((el as HTMLSelectElement).selectedOptions[0]?.text ?? "") : kind === "password" && i.value ? "•".repeat(i.value.length) : i.value;
        const shown = value || i.placeholder || "";
        if (shown) {
          const pcs = value ? cs : getComputedStyle(el, "::placeholder");
          const bl = px(cs.borderLeftWidth) + px(cs.paddingLeft), bt = px(cs.borderTopWidth) + px(cs.paddingTop);
          const bw = r.width - bl - px(cs.borderRightWidth) - px(cs.paddingRight), bh = r.height - bt - px(cs.borderBottomWidth) - px(cs.paddingBottom);
          const lh = cs.lineHeight === "normal" ? px(cs.fontSize) * 1.2 : px(cs.lineHeight);
          const ty = tag === "textarea" ? bt : bt + Math.max(0, (bh - lh) / 2);
          const leaf = textLeaf(shown, new DOMRect(r.x + bl, r.y + ty, Math.max(1, bw), lh), Object.assign(Object.create(null), { color: pcs.color, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontSize: cs.fontSize, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: "none", textDecorationLine: "none", textAlign: cs.textAlign, direction: cs.direction }) as CSSStyleDeclaration, r.x, r.y, 1);
          if (leaf) kids.push(leaf);
        }
      }
    } else {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const raw = n.textContent ?? "";
          const keep = /^pre/.test(cs.whiteSpace);
          const chars = keep ? raw.replace(/\n$/, "") : raw.replace(/\s+/g, " ").trim();
          if (!chars) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rr = range.getBoundingClientRect();
          if (!rr.width || !rr.height) continue;
          const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
          const leaf = textLeaf(chars, rr, cs, r.x, r.y, lines);
          if (leaf) kids.push(leaf);
        } else if (n.nodeType === 1) {
          const k = walk(n as Element, r.x, r.y);
          if (k) kids.push(k);
        }
      }
    }
    const bg = colour(cs.backgroundColor);
    const grad = gradient(cs.backgroundImage);
    const sides = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
    const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    const sideColours = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(colour);
    const w = sides.map((x, i) => (styles[i] === "none" || styles[i] === "hidden" || !sideColours[i] ? 0 : x));
    const strokeColour = sideColours[w.findIndex((x) => x > 0)];
    const sh = shadows(cs.boxShadow);
    const clip = cs.overflowX !== "visible" || cs.overflowY !== "visible";
    const comp = cells.get(el);
    const draws = !!(bg || grad || (strokeColour && w.some((x) => x > 0)) || sh);
    if (!draws && !clip && !comp && el !== root) {
      if (!kids.length) return null;
      if (kids.length === 1 && op >= 1) {
        // nothing of its own: the one thing it holds, moved into this element's parent
        const k = kids[0] as { x: number; y: number };
        k.x = r2(k.x + r.x - ox);
        k.y = r2(k.y + r.y - oy);
        return k;
      }
    }
    if (!r.width && !r.height && !draws) {
      // a zero-size wrapper of positioned things: its children, placed in the parent
      for (const k of kids as { x: number; y: number }[]) { k.x = r2(k.x + r.x - ox); k.y = r2(k.y + r.y - oy); }
      return kids.length ? { ...base("frame"), children: kids, flat: true } : null;
    }
    count++;
    const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => Math.min(px(v), Math.min(r.width, r.height) / 2));
    return {
      ...base("frame"),
      ...(bg ? { fill: bg } : {}), ...(grad ? { gradient: grad } : {}),
      ...(strokeColour && w.some((x) => x > 0) ? { stroke: { color: strokeColour, w } } : {}),
      ...(rad.some((x) => x > 0) ? { radius: rad.map(r2) } : {}), ...(sh ? { shadows: sh } : {}), ...(clip ? { clip: true } : {}),
      ...(comp ? { component: comp } : {}),
      children: kids,
    };
  };
  if (!root) return { root: null, crops, nodes: 0, dir: "ltr" };
  const rr = root.getBoundingClientRect();
  const tree = walk(root, rr.x, rr.y) as FFrame | null;
  if (tree) {
    tree.x = 0; tree.y = 0; tree.clip = true;
    // the page colour shows through a root that has none of its own: the frame takes it from the nearest ancestor that paints
    for (let e = root.parentElement; e && !tree.fill; e = e.parentElement) { const c = colour(getComputedStyle(e).backgroundColor); if (c) tree.fill = c as RGBA; }
    if (!tree.fill) tree.fill = [1, 1, 1, 1];
  }
  return { root: tree, crops, nodes: count, dir: getComputedStyle(root).direction === "rtl" ? "rtl" : "ltr" };
}

// ---------- after the page: flatten, auto layout ----------

/** Wrappers the walker kept only to carry positioned children are spread into their parent. */
function unflat(n: FNode): FNode[] {
  if (n.t !== "frame") return [n];
  n.children = n.children.flatMap((c) => {
    const kids = unflat(c);
    const f = c as FFrame & { flat?: boolean };
    // the walker already placed them in this frame
    if (f.t === "frame" && f.flat) return f.children;
    return kids;
  });
  return [n];
}

/**
 * Auto layout for a frame whose children the browser put in one row or one column with the same gap between each, all lined up
 * on the same side (or centred) across: the padding is where the first one starts, the spacing that gap. Inferred from the
 * positions, never from the CSS, so applying it in Figma puts every child where the demo drew it; anything else stays free.
 */
export function inferAuto(f: Pick<FFrame, "w" | "h" | "children">, tol = 1): FAuto | undefined {
  const k = f.children;
  if (k.length < 2) return undefined;
  if (k.some((c) => c.x < -tol || c.y < -tol || c.x + c.w > f.w + tol || c.y + c.h > f.h + tol)) return undefined;
  for (const dir of ["H", "V"] as const) {
    const main = (c: FNode) => (dir === "H" ? c.x : c.y), mainLen = (c: FNode) => (dir === "H" ? c.w : c.h);
    const cross = (c: FNode) => (dir === "H" ? c.y : c.x), crossLen = (c: FNode) => (dir === "H" ? c.h : c.w);
    const size = dir === "H" ? f.w : f.h, csize = dir === "H" ? f.h : f.w;
    // in document order, each one after the last, never overlapping
    const gaps: number[] = [];
    let ok = true;
    for (let i = 1; i < k.length; i++) {
      const g = main(k[i]!) - (main(k[i - 1]!) + mainLen(k[i - 1]!));
      if (g < -tol) { ok = false; break; }
      gaps.push(g);
    }
    if (!ok) continue;
    const gap = gaps[0]!;
    if (gaps.some((g) => Math.abs(g - gap) > tol)) continue;
    const start = main(k[0]!), end = size - (main(k.at(-1)!) + mainLen(k.at(-1)!));
    if (start < -tol || end < -tol) continue;
    const offs = k.map(cross), mids = k.map((c) => cross(c) + crossLen(c) / 2), ends = k.map((c) => csize - (cross(c) + crossLen(c)));
    const same = (xs: number[]) => xs.every((x) => Math.abs(x - xs[0]!) <= tol);
    let align: FAuto["align"];
    let a = 0, b = 0;
    if (same(offs)) { align = "MIN"; a = offs[0]!; b = Math.max(0, Math.min(...ends)); }
    else if (same(ends)) { align = "MAX"; b = ends[0]!; a = Math.max(0, Math.min(...offs)); }
    else if (same(mids) && Math.abs(mids[0]! - csize / 2) <= tol) align = "CENTER";
    else continue;
    const r = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
    const pad: FAuto["pad"] = dir === "H" ? [r(a), r(end), r(b), r(start)] : [r(start), r(b), r(end), r(a)];
    return { dir, gap: r(gap), pad, align };
  }
  return undefined;
}

function addAuto(n: FNode): void {
  if (n.t !== "frame") return;
  n.children.forEach(addAuto);
  const auto = inferAuto(n);
  if (auto) n.auto = auto;
}

function countNodes(n: FNode): number {
  return 1 + (n.t === "frame" ? n.children.reduce((s, c) => s + countNodes(c), 0) : 0);
}

/** The walker's tree made final: positioned wrappers spread, auto layout added, crops replaced by pictures. */
export function finishLayers(raw: RawLayers, pictures: (string | undefined)[]): FFrame | undefined {
  if (!raw.root) return undefined;
  const root = unflat(raw.root)[0] as FFrame;
  const fill = (n: FNode) => {
    if (n.t === "image" && n.crop !== undefined) { const p = pictures[n.crop]; if (p) n.png = p; delete n.crop; }
    if (n.t === "frame") n.children.forEach(fill);
  };
  fill(root);
  addAuto(root);
  return root;
}

// ---------- tokens as variables ----------

const rgba = (css: string): RGBA | undefined => {
  try { const c = w3cColour(css); return [...c.components, c.alpha ?? 1] as RGBA; } catch { return undefined; }
};

/** The approved look as Figma variables: colours per mode, corners and spacing as numbers, the fonts as strings. */
export function figmaVariables(theme: DesignTheme): { modes: string[]; variables: FigmaVariable[] } {
  const t = designTokens(theme);
  const modes = Object.keys(t.colour) as ("light" | "dark")[];
  const variables: FigmaVariable[] = [];
  const names = new Set(modes.flatMap((m) => Object.keys(t.colour[m] ?? {})));
  for (const k of names) {
    const values: Record<string, RGBA> = {};
    for (const m of modes) { const v = t.colour[m]?.[k]; const c = v ? rgba(v) : undefined; if (c) values[m] = c; }
    if (Object.keys(values).length) variables.push({ name: `color/${k}`, type: "COLOR", values });
  }
  const all = (v: number | string) => Object.fromEntries(modes.map((m) => [m, v]));
  variables.push(
    { name: "radius/base", type: "FLOAT", values: all(t.radiusPx) },
    { name: "space/pad", type: "FLOAT", values: all(t.space.padPx) },
    { name: "space/row", type: "FLOAT", values: all(t.space.rowPx) },
    { name: "font/body", type: "STRING", values: all(fontList(t.type.body)[0] ?? t.type.body) },
    { name: "font/heading", type: "STRING", values: all(fontList(t.type.heading)[0] ?? t.type.heading) },
    { name: "font/heading-weight", type: "FLOAT", values: all(Number(t.type.headingWeight) || 600) },
  );
  return { modes, variables };
}

function fontsOf(frames: FigmaFrame[]): string[] {
  const out = new Set<string>();
  const walk = (n: FNode) => {
    if (n.t === "text") out.add(`${n.font.families.find((f) => !/^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-\w+|inherit)$/i.test(f)) ?? "Inter"} ${n.font.weight}${n.font.italic ? " italic" : ""}`);
    if (n.t === "frame") n.children.forEach(walk);
  };
  frames.forEach((f) => walk(f.root));
  return [...out].sort();
}

// ---------- reading the demo ----------

export interface FigmaShot { id?: string; screen: string; stateBase: string; viewport: Viewport; modeName: "light" | "dark"; langCode: string; file: string }

const STILL_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
const FIXED_TIME = new Date("2026-01-15T10:00:00Z");

interface DesignBits { theme?: DesignTheme; apps?: { id: string; name: string }[]; screens?: { id: string; app?: string }[]; locale?: { languages: string[] } }

/**
 * `figma.json` for a package: each picked picture's view read from the approved demo as layers. Undefined, with the reason, when
 * there is no browser. Pictures are taken from the package as the frames' hidden reference layers.
 */
export async function figmaDoc(pkg: DesignPackage, shots: FigmaShot[], tag: string, log?: (m: string) => void): Promise<{ doc?: FigmaDoc; why?: string }> {
  if (process.env.FACTORY_NO_SCREENSHOTS) return { why: "the Figma file needs a browser to read the demo, and screenshots are switched off (FACTORY_NO_SCREENSHOTS)" };
  const exe = findChromium();
  if (!exe) return { why: "the Figma file needs Chromium to read the demo, and there is no browser here (npx playwright install chromium, or set FACTORY_CHROMIUM)" };
  const m = pkg.manifest;
  const d = readDesignJson(readFileSync(join(pkg.dir, "design.json"), "utf8")) as DesignBits;
  const appOf = new Map((d.screens ?? []).map((s) => [s.id, s.app ?? ""]));
  const appName = new Map((d.apps ?? []).map((x) => [x.id, x.name]));
  const langs = d.locale?.languages ?? ["en"];
  const statesOf = new Map(m.screens.map((s) => [s.id, s.states]));
  const notes: string[] = [];
  const frames: FigmaFrame[] = [];
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const url = pathToFileURL(join(pkg.dir, "demo", "index.html")).href;
  try {
    for (const vp of ["phone", "tablet", "desktop"] as Viewport[]) {
      const mine = shots.filter((s) => s.viewport === vp && s.id);
      if (!mine.length) continue;
      const page = await browser.newPage({ viewport: VIEWPORTS[vp], reducedMotion: "reduce", deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", bypassCSP: true });
      page.setDefaultTimeout(10_000);
      await page.clock.setFixedTime(FIXED_TIME);
      for (const s of mine) {
        const id = s.id!, sel = `#${id.replace(/[^\w-]/g, "\\$&")}`;
        try {
          await page.goto("about:blank");
          await page.goto(`${url}#${encodeURIComponent(id)}`);
          const states = statesOf.get(id) ?? [];
          const k = Math.max(0, states.findIndex((x) => x === s.stateBase));
          const tab = page.locator(`${sel} [data-state="${k}"]`);
          if (await tab.count()) await tab.first().click();
          const li = langs.indexOf(s.langCode);
          if (li > 0) await page.evaluate(`window.__lang && window.__lang(${li})`);
          if (s.modeName === "dark") await page.evaluate('window.__mode && window.__mode("dark")');
          await page.mouse.move(0, 0);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.addStyleTag({ content: STILL_CSS });
          await page.evaluate("document.fonts.ready.then(function(){return 1})");
          await page.waitForTimeout(200);
          const rootSel = (await page.locator(`${sel} .canvas .stage`).count()) ? `${sel} .canvas .stage` : `${sel} .canvas`;
          const raw = (await page.evaluate(inPage(figmaLayers, { sel: rootSel, max: MAX_FIGMA_NODES, components: id === "components" }))) as RawLayers;
          if (!raw.root) { notes.push(`${id} ${s.stateBase} ${vp}: the demo has no such screen`); continue; }
          const pictures: (string | undefined)[] = [];
          for (const c of raw.crops) {
            try {
              const b = await page.screenshot({ clip: { x: c.x, y: c.y, width: Math.max(1, c.w), height: Math.max(1, c.h) }, fullPage: true });
              pictures.push(b.toString("base64"));
            } catch { pictures.push(undefined); }
          }
          let picture: string | undefined;
          try {
            const box = await page.locator(rootSel).first().boundingBox();
            if (box) picture = (await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height }, fullPage: true })).toString("base64");
          } catch { /* the frame goes without its reference picture */ }
          const root = finishLayers(raw, pictures)!;
          const app = id === "components" ? "components" : appOf.get(id) ?? "";
          const title = m.screens.find((x) => x.id === id)?.title ?? s.screen;
          const name = [`${id} ${title}`, s.stateBase, vp, ...(s.modeName === "dark" ? ["dark"] : []), ...(s.langCode !== langs[0] ? [s.langCode] : [])].join(" · ");
          frames.push({ name, screen: id, title, app, state: s.stateBase, viewport: vp, mode: s.modeName, lang: s.langCode, dir: raw.dir === "rtl" ? "rtl" : "ltr", w: root.w, h: root.h, root, nodes: countNodes(root), ...(picture ? { picture } : {}) });
          if (raw.nodes > MAX_FIGMA_NODES) notes.push(`${name}: more than ${MAX_FIGMA_NODES} layers, so the rest are pictures`);
        } catch (e) {
          notes.push(`${id} ${s.stateBase} ${vp}: not read (${(e instanceof Error ? e.message : String(e)).split("\n")[0]})`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  log?.(`design export: figma, ${frames.length} frame(s), ${frames.reduce((n, f) => n + f.nodes, 0)} layer(s)`);
  const usedApps = new Set(frames.map((f) => f.app));
  const apps = [
    ...(d.apps ?? []).filter((x) => usedApps.has(x.id)).map((x) => ({ id: x.id, name: x.name })),
    ...(usedApps.has("") ? [{ id: "", name: m.product.name ?? m.run.project }] : []),
    ...(usedApps.has("components") ? [{ id: "components", name: "Components" }] : []),
  ];
  for (const f of frames) if (f.app && f.app !== "components" && !appName.has(f.app)) f.app = "";
  return {
    doc: {
      kind: "ai-factory/figma", schemaVersion: FIGMA_SCHEMA_VERSION, tag, line: m.line, version: m.version, designSha: m.designSha,
      product: m.product.name ?? m.run.project, apps,
      // a design that keeps the app's own look has no tokens of its own (as the tokens export)
      ...(d.theme && existsSync(join(pkg.dir, "tokens.json")) ? { tokens: figmaVariables(d.theme) } : {}),
      fonts: fontsOf(frames), frames, notes,
    },
  };
}

// ---------- the plugin ----------

/** The AI Factory Import plugin's folder (figma-plugin/ at the repo root, the same from the source and the build). */
export const figmaPluginDir = (): string => fileURLToPath(new URL("../../figma-plugin/", import.meta.url));

/** How to bring a figma.json into Figma, for the terminal and the UI. */
export const figmaHowTo = (json: string): string[] => [
  `In the Figma desktop app (any plan, the free one too): Plugins > Development > Import plugin from manifest..., pick ${join(figmaPluginDir(), "manifest.json")} (once).`,
  `Then open the file to import into, run Plugins > Development > AI Factory Import and pick ${json}.`,
];

/** The plugin as a zip, for someone without the repo: unzip it and import its manifest.json in Figma. */
export async function figmaPluginZip(): Promise<Buffer> {
  const zip = new JSZip(), dir = figmaPluginDir();
  for (const f of readdirSync(dir)) if (/\.(json|js|html|md)$/.test(f)) zip.file(`ai-factory-figma-plugin/${f}`, readFileSync(join(dir, f)));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
