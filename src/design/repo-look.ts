// The existing app's look, read from its stylesheets (PR #11 review, item 6): an app of its own is drawn in its own brand
// colour, corners, type and light or dark, not in a look the factory makes up. No model, no network: CSS custom properties
// (--primary, --color-brand, ...), SCSS variables ($primary) and the body's font, in the shape the demo draws with.
import type { DesignTheme } from "../contracts/artifacts.js";
import { cssTokens } from "./inventory.js";
import type { FileSource } from "./source.js";

/** What was read and where from, for the card. Undefined when no brand colour is found (then the demo keeps its default). */
export interface RepoLook { theme: DesignTheme; from: string[] }

const STYLE = /\.(css|scss|sass|less|pcss)$/;
const NOT_STYLE = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor)\//;
const BRAND = ["primary", "color-primary", "brand", "color-brand", "brand-primary", "primary-color", "theme-primary", "accent", "color-accent"];
const BACKGROUND = ["background", "color-background", "bg", "body-bg", "page-bg"];
const RADIUS = ["radius", "border-radius", "radius-md", "rounded"];
const FONT = ["font-sans", "font-family", "font-body", "body-font", "font-family-base", "font"];

/** A CSS colour to #rrggbb: hex, rgb(), hsl(), oklch() and the bare channel forms shadcn/ui uses ("222 47% 11%", "0.21 0.006 285"). */
export function toHex(value: string): string | undefined {
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (hex) return `#${hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]}`;
  const fn = /^(rgba?|hsla?|oklch)\(\s*([^)]+)\)$/.exec(v);
  const kind = fn ? fn[1]!.replace(/a$/, "") : /^[\d.]+\s+[\d.]+%\s+[\d.]+%/.test(v) ? "hsl" : /^0?\.\d+\s+[\d.]+\s+[\d.]+/.test(v) ? "oklch" : undefined;
  const parts = (fn ? fn[2]! : v).split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((p) => ({ n: parseFloat(p), pct: p.endsWith("%") }));
  if (!kind || parts.length < 3 || parts.some((p) => Number.isNaN(p.n))) return undefined;
  let rgb: number[];
  if (kind === "rgb") rgb = parts.map((p) => (p.pct ? p.n * 2.55 : p.n));
  else if (kind === "hsl") rgb = hslToRgb(parts[0]!.n, parts[1]!.n / 100, parts[2]!.n / 100);
  else rgb = oklchToRgb(parts[0]!.pct ? parts[0]!.n / 100 : parts[0]!.n, parts[1]!.n, parts[2]!.n);
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function hslToRgb(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

function oklchToRgb(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055));
}

/** Relative lightness 0..1 of a #rrggbb colour. */
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** A near-grey brand (shadcn's default "primary" is near black) says nothing about the brand: a coloured accent wins over it. */
const grey = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 24;
};

function radiusOf(value: string): DesignTheme["radius"] | undefined {
  const m = /^([\d.]+)(rem|px|em)?$/.exec(value.trim());
  if (!m) return undefined;
  const px = parseFloat(m[1]!) * (m[2] === "px" ? 1 : 16);
  return px <= 3 ? "sharp" : px >= 12 ? "round" : "soft";
}

function fontOf(value: string): DesignTheme["font"] {
  const first = value.split(",")[0]!.replace(/["']/g, "").trim().toLowerCase();
  if (/nunito|quicksand|varela round|comfortaa|baloo|fredoka/.test(first)) return "rounded";
  if (/open sans|source sans|lato|fira sans|noto sans|pt sans|segoe|frutiger|myriad/.test(first)) return "humanist";
  if (/grotesk|helvetica|arial|neue haas|suisse/.test(first)) return "grotesk";
  if (/serif/.test(value) && !/sans-serif/.test(value) || /georgia|merriweather|garamond|times|lora|playfair/.test(first)) return "book";
  return "sans";
}

/** The app's look, or undefined when its stylesheets name no brand colour. */
export function repoLook(src: FileSource): RepoLook | undefined {
  const vars = new Map<string, { value: string; file: string; dark: boolean }>();
  let bodyFont: { value: string; file: string } | undefined;
  for (const f of src.list().filter((f) => STYLE.test(f) && !NOT_STYLE.test(f)).sort()) {
    const css = src.read(f) ?? "";
    for (const t of cssTokens(css)) {
      const had = vars.get(t.name);
      if (!had || (had.dark && t.bucket !== "dark")) vars.set(t.name, { value: t.value, file: f, dark: t.bucket === "dark" });
    }
    // SCSS and Less variables: $primary: #123456; @primary: #123456;
    for (const m of css.matchAll(/^\s*[$@]([\w-]+)\s*:\s*([^;]+?)\s*(?:!default)?\s*;/gm)) if (!vars.has(m[1]!)) vars.set(m[1]!, { value: m[2]!, file: f, dark: false });
    bodyFont ??= (() => { const m = /(?:^|[}\s])(?:body|html|:root)\s*\{[^}]*font-family\s*:\s*([^;}]+)/.exec(css); return m ? { value: m[1]!, file: f } : undefined; })();
  }
  const pick = (names: string[]) => names.map((n) => vars.get(n)).find((x) => x !== undefined);
  const colour = (names: string[]) => names.map((n) => ({ n, v: vars.get(n) })).map((x) => ({ ...x, hex: x.v ? toHex(x.v.value) : undefined })).filter((x) => x.hex);
  const brands = colour(BRAND);
  const brand = brands.find((x) => !grey(x.hex!)) ?? brands[0];
  if (!brand) return undefined;
  const from = [`brand ${brand.hex} (--${brand.n}, ${brand.v!.file})`];
  const bg = colour(BACKGROUND)[0];
  const mode: DesignTheme["mode"] = bg && lightness(bg.hex!) < 0.35 ? "dark" : "light";
  if (bg) from.push(`${mode} (background ${bg.hex})`);
  const r = pick(RADIUS);
  const radius = r ? radiusOf(r.value) : undefined;
  if (radius) from.push(`${radius} corners (${r!.value})`);
  const fontVar = pick(FONT);
  const fontValue = fontVar && !/^var\(/.test(fontVar.value) ? fontVar.value : bodyFont?.value;
  const font = fontValue ? fontOf(fontValue) : "sans";
  if (fontValue) from.push(`${font} type (${fontValue.split(",")[0]!.trim()})`);
  const accent = brands.find((x) => x.hex !== brand.hex && !grey(x.hex!));
  return {
    theme: {
      mood: "the existing app's own look", mode, brand: brand.hex!, ...(accent ? { accent: accent.hex! } : {}), neutral: "cool", chrome: "plain", font, heading: "match", mark: "wordmark",
      radius: radius ?? "soft", density: "comfortable", surface: "flat", motion: "calm", fx: "quiet", shell: "auto", hero: "none", charts: "soft", imagery: "icons",
    } as DesignTheme,
    from,
  };
}
