// The demo's colours, built the way a design system builds them: in OKLCH (even steps of lightness the eye agrees with), with
// neutrals tinted a hair toward the brand so the page reads as one product, every text colour checked for contrast (WCAG AA),
// and status colours matched in lightness to the mode. The brand is used as given for fills; a darker or lighter step of it is
// used where it is text or a line, so a pale yellow brand never becomes unreadable text.

type RGB = [number, number, number];
export type Lch = [number, number, number];

const lin = (v: number): number => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const gam = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const hexOf = (c: RGB): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

export function toLch(hex: string): Lch {
  const [r, g, b] = rgbOf(hex).map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

const raw = ([L, C, h]: Lch): RGB => {
  const A = C * Math.cos((h * Math.PI) / 180), B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};

/** An OKLCH colour as hex, its chroma lowered until it fits the screen's gamut (so the hue holds instead of clipping). */
export function fromLch([L, C, h]: Lch): string {
  let c = C;
  for (let i = 0; i < 40; i++) {
    const v = raw([L, c, h]);
    if (v.every((x) => x >= -0.0005 && x <= 1.0005)) return hexOf(v.map(gam) as RGB);
    c *= 0.9;
  }
  return hexOf(raw([L, 0, h]).map(gam) as RGB);
}

const luminance = (hex: string): number => { const [r, g, b] = rgbOf(hex).map(lin) as RGB; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };

/** The colour moved in lightness (darker on a light page, lighter on a dark one) until it reads on `on` at the given ratio. */
export function readable(hex: string, on: string, ratio = 4.5): string {
  const [L, C, h] = toLch(hex);
  const up = luminance(on) < 0.2;
  let out = hex;
  for (let l = L, i = 0; contrast(out, on) < ratio && i < 40; i++) { l += up ? 0.02 : -0.02; out = fromLch([Math.max(0, Math.min(1, l)), C, h]); }
  return out;
}

export interface Palette { [name: string]: string }

/**
 * Every colour the page uses. `neutral` picks the tint of the greys: cool (toward the brand's hue when the brand is cool, else a
 * blue-grey), warm (a paper tone) or pure (no tint).
 */
export function palette(o: { brand: string; accent?: string; mode: "light" | "dark"; neutral: "cool" | "warm" | "pure" }): Palette {
  const dark = o.mode === "dark";
  const [, bC, bH] = toLch(o.brand);
  const nh = o.neutral === "warm" ? 75 : bC > 0.03 && bH >= 190 && bH <= 300 ? bH : 255;
  const nc = o.neutral === "pure" ? 0 : dark ? 0.014 : 0.01;
  const n = (L: number, c = nc) => fromLch([L, c, nh]);
  const g = dark
    ? { bg: n(0.16), sf: n(0.2), sf2: n(0.235), edge: n(0.29), edge2: n(0.36), mut: n(0.68), ink2: n(0.82), ink: n(0.96, nc / 2) }
    : { bg: n(0.982, nc * 0.6), sf: "#ffffff", sf2: n(0.966), edge: n(0.925), edge2: n(0.87), mut: n(0.55), ink2: n(0.4), ink: n(0.2) };
  // a dark brand on a dark page cannot be a button; it is lifted to a readable step of itself
  const br = dark && contrast(o.brand, g.bg) < 2.4 ? fromLch([0.66, Math.max(bC, 0.12), bH]) : o.brand;
  // text on the brand: white, or the darkest ink when that reads better (a bright green or yellow brand takes dark text)
  const deep = dark ? n(0.16) : g.ink;
  const on = contrast(br, "#ffffff") >= 4.5 || contrast(br, "#ffffff") >= contrast(br, deep) ? "#ffffff" : deep;
  // text sits on the page, on cards and on the raised grey: each colour must read on the hardest of them (the raised grey is
  // the darkest surface of a light page and the lightest of a dark one)
  const hard = (hex: string) => readable(readable(readable(hex, g.sf2), g.sf), g.bg);
  const a1 = hard(o.brand), a2 = hard(o.accent ?? o.brand);
  const st = (L: number, C: number, h: number) => hard(fromLch([L, C, h]));
  return {
    ...g, mut: hard(g.mut), ink2: hard(g.ink2), br, on, a1, a2,
    ok: st(dark ? 0.8 : 0.52, 0.15, 152), bad: st(dark ? 0.74 : 0.55, 0.19, 25), warn: st(dark ? 0.82 : 0.6, 0.15, 70), info: st(dark ? 0.78 : 0.55, 0.12, 245),
  };
}

/** One colour pair that does not read well enough: which text on which surface, in which mode, and by how much. */
export interface ContrastIssue { mode: "light" | "dark"; text: string; on: string; ratio: number; need: number }

/**
 * The palette's text and controls checked against the surfaces they sit on (WCAG 2.2): body, secondary and muted text, links and
 * status colours at 4.5 on the page, cards and raised grey; the focus ring at 3 (a non-text indicator); a button's label on the
 * brand at 4.5, or 3 when no choice of white or dark ink reaches 4.5 (the label is bold, but the brand should still be darkened).
 * `colours` is one mode's palette; a translucent (glass) surface is checked as the page beneath it.
 */
export function contrastIssues(colours: Palette, mode: "light" | "dark"): ContrastIssue[] {
  const out: ContrastIssue[] = [];
  const solid = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);
  const bg = solid(colours.bg)!, surfaces = { bg, sf: solid(colours.sf) ?? bg, sf2: solid(colours.sf2) ?? bg };
  const test = (text: string, on: string, need: number) => {
    const a = solid(colours[text]), b = (surfaces as Record<string, string>)[on] ?? solid(colours[on]);
    if (!a || !b) return;
    const r = contrast(a, b);
    if (r + 1e-9 < need) out.push({ mode, text, on, ratio: Math.round(r * 100) / 100, need });
  };
  for (const on of ["bg", "sf", "sf2"]) {
    for (const t of ["ink", "ink2", "mut", "a1", "a2", "ok", "bad", "warn", "info"]) test(t, on, 4.5);
    if (on !== "sf2") test("a1", on, 3);
  }
  const brand = solid(colours.br), label = solid(colours.on);
  if (brand && label) {
    const best = Math.max(contrast(brand, "#ffffff"), contrast(brand, solid(colours.ink) ?? "#000000"));
    const r = contrast(label, brand), need = best >= 4.5 ? 4.5 : 3;
    if (r + 1e-9 < need) out.push({ mode, text: "on", on: "br", ratio: Math.round(r * 100) / 100, need });
  }
  // the same pair failing on several surfaces is one finding, at its worst
  const seen = new Map<string, ContrastIssue>();
  for (const i of out) { const k = `${i.mode}/${i.text}/${i.need}`, was = seen.get(k); if (!was || i.ratio < was.ratio) seen.set(k, i); }
  return [...seen.values()];
}
