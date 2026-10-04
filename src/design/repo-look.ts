// The existing app's look, read from its stylesheets (PR #11 review, item 6): an app of its own is drawn in its own brand
// colour, corners, type and light or dark, not in a look the factory makes up. No model, no network: CSS custom properties
// (--primary, --color-brand, ...), SCSS variables ($primary) and the body's font, in the shape the demo draws with. Since the
// PR #11 re-review (item 6) also a Tailwind config's colours, corners and fonts, and MUI, antd and Chakra theme objects in
// JS/TS, read as text (the code is never run). Stylesheets win where both name the same thing.
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

/** Where a JS theme lives: a Tailwind config, or a file whose name says theme, or an app entry that often holds it. */
const THEME_FILE = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$|(^|\/)[^/]*theme[^/]*\.(js|jsx|ts|tsx|mjs)$|(^|\/)(App|main|index|_app|layout|providers?)\.(jsx|tsx|js|ts)$/i;
const MAX_THEME_BYTES = 200_000;
const str = `["'\`]([^"'\`]+)["'\`]`;

/** Named values a JS theme sets, under the names the stylesheet reading uses; each with a label for the card. */
export function jsThemeVars(code: string): { name: string; value: string; label: string; dark?: boolean }[] {
  const out: { name: string; value: string; label: string; dark?: boolean }[] = [];
  const add = (name: string, value: string | undefined, label: string, dark?: boolean) => { if (value) out.push({ name, value, label, ...(dark ? { dark } : {}) }); };
  const first = (re: RegExp) => re.exec(code)?.[1];
  // a colour key: a string, or an object's DEFAULT / main / 500 / 600 (Tailwind scales, MUI palettes, Chakra scales)
  for (const key of ["primary", "brand", "accent", "secondary"]) {
    const v = first(new RegExp(`\\b${key}\\s*:\\s*${str}`)) ?? first(new RegExp(`\\b${key}\\s*:\\s*\\{[^}]*?\\b(?:DEFAULT|main|500|600)\\s*:\\s*${str}`));
    add(key === "secondary" ? "color-accent" : key, v, `${key} in a JS theme`);
  }
  add("primary", first(new RegExp(`\\bcolorPrimary\\s*:\\s*${str}`)), "colorPrimary (antd)");
  add("background", first(new RegExp(`\\bbackground\\s*:\\s*\\{[^}]*?\\bdefault\\s*:\\s*${str}`)) ?? first(new RegExp(`\\bcolorBg(?:Layout|Base)\\s*:\\s*${str}`)) ?? first(new RegExp(`\\bbackground\\s*:\\s*${str}`)), "background in a JS theme");
  const radius = first(/\bborderRadius\s*:\s*(\d+(?:\.\d+)?)\b(?!\s*[%a-z])/) ?? first(new RegExp(`\\bborderRadius\\s*:\\s*\\{[^}]*?\\b(?:DEFAULT|md|lg)\\s*:\\s*${str}`)) ?? first(new RegExp(`\\bborderRadius\\s*:\\s*${str}`));
  add("radius", radius && /^\d+(\.\d+)?$/.test(radius) ? `${radius}px` : radius, "borderRadius in a JS theme");
  add("font-sans", first(new RegExp(`\\bfontFamily\\s*:\\s*\\{[^}]*?\\bsans\\s*:\\s*\\[?\\s*${str}`)) ?? first(new RegExp(`\\bfontFamily\\s*:\\s*\\[?\\s*${str}`)), "fontFamily in a JS theme");
  if (/\bmode\s*:\s*["'`]dark["'`]|\bdarkAlgorithm\b|initialColorMode\s*:\s*["'`]dark["'`]/.test(code)) add("color-scheme", "dark", "dark mode in a JS theme", true);
  return out;
}

/** The app's look, or undefined when its stylesheets and theme files name no brand colour. */
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
  // JS themes: only where the stylesheets did not already name it (a Tailwind config's "hsl(var(--primary))" reads as nothing)
  const labels = new Map<string, string>();
  let jsDark = false;
  // a Tailwind config or a theme file first; an app entry (inline styles too) only fills what they left out
  const rank = (f: string) => (/tailwind\.config\./.test(f) ? 0 : /theme/i.test(f.split("/").pop()!) ? 1 : 2);
  for (const f of src.list().filter((f) => THEME_FILE.test(f) && !NOT_STYLE.test(f)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const code = src.read(f) ?? "";
    if (code.length > MAX_THEME_BYTES) continue;
    for (const v of jsThemeVars(code)) {
      if (v.name === "color-scheme") { jsDark = true; continue; }
      if (vars.has(v.name) || (BRAND.includes(v.name) || BACKGROUND.includes(v.name)) && !toHex(v.value)) continue;
      vars.set(v.name, { value: v.value, file: f, dark: false });
      labels.set(v.name, v.label);
    }
  }
  const pick = (names: string[]) => names.map((n) => vars.get(n)).find((x) => x !== undefined);
  const colour = (names: string[]) => names.map((n) => ({ n, v: vars.get(n) })).map((x) => ({ ...x, hex: x.v ? toHex(x.v.value) : undefined })).filter((x) => x.hex);
  const brands = colour(BRAND);
  const brand = brands.find((x) => !grey(x.hex!)) ?? brands[0];
  if (!brand) return undefined;
  const from = [`brand ${brand.hex} (${labels.get(brand.n) ?? `--${brand.n}`}, ${brand.v!.file})`];
  const bg = colour(BACKGROUND)[0];
  const mode: DesignTheme["mode"] = bg ? (lightness(bg.hex!) < 0.35 ? "dark" : "light") : jsDark ? "dark" : "light";
  if (bg) from.push(`${mode} (background ${bg.hex})`);
  else if (jsDark) from.push("dark (the JS theme's dark mode)");
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

/**
 * The values an existing app draws with, read from its source (the PR #11 re-review, item 8): every colour, first font, corner
 * and shadow its stylesheets and theme files name, to compare a page changed in place with the app's own look instead of an
 * approved theme. Read as text, never run. Empty fonts or shadows mean none were named (then they are not compared).
 */
export interface OwnTokens { colours: string[]; fonts: string[]; radii: number[]; shadows: string[]; from: string[]; tailwind: boolean }

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\([^)]*\)/gi;
const lengthPx = (v: string): number | undefined => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  return m ? parseFloat(m[1]!) * (!m[2] || m[2] === "px" ? 1 : 16) : undefined;
};
const firstFont = (v: string): string | undefined => {
  const f = v.split(",")[0]!.trim().replace(/^["'`]|["'`]$/g, "");
  return f && !/^var\(|^inherit$|^initial$/.test(f) ? f : undefined;
};

export function ownTokens(src: FileSource): OwnTokens | undefined {
  const colours = new Set<string>(["#ffffff", "#000000"]), fonts = new Set<string>(), radii = new Set<number>([0]), shadows = new Set<string>();
  const from: string[] = [];
  const files = src.list().filter((f) => !NOT_STYLE.test(f) && (STYLE.test(f) || THEME_FILE.test(f)));
  for (const f of files.sort()) {
    const text = src.read(f) ?? "";
    if (text.length > MAX_THEME_BYTES) continue;
    const before = colours.size + fonts.size + radii.size + shadows.size;
    for (const m of text.matchAll(COLOUR_LITERAL)) { const h = toHex(m[0]); if (h) colours.add(h); }
    if (STYLE.test(f)) {
      // custom properties hold the shadcn-style bare channels ("222 47% 11%") too
      for (const t of cssTokens(text)) {
        const h = toHex(t.value);
        if (h) colours.add(h);
        if (/radius/.test(t.name)) { const px = lengthPx(t.value); if (px !== undefined) radii.add(px); }
        if (/font/.test(t.name)) { const ff = firstFont(t.value); if (ff) fonts.add(ff); }
        if (/shadow/.test(t.name) && /\d/.test(t.value)) shadows.add(t.value);
      }
      for (const m of text.matchAll(/font-family\s*:\s*([^;}]+)/g)) { const ff = firstFont(m[1]!); if (ff) fonts.add(ff); }
      for (const m of text.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) for (const part of m[1]!.split(/\s+/)) { const px = lengthPx(part); if (px !== undefined) radii.add(px); }
      for (const m of text.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) if (/\d/.test(m[1]!) && !/^var\(/.test(m[1]!.trim())) shadows.add(m[1]!.trim());
    } else {
      for (const m of text.matchAll(new RegExp(`\\bfontFamily\\s*:\\s*\\{?[^}\\]]*?\\[?\\s*${str}`, "g"))) { const ff = firstFont(m[1]!); if (ff) fonts.add(ff); }
      for (const m of text.matchAll(/\bborderRadius\s*:\s*(\d+(?:\.\d+)?)\b(?!\s*[%a-z])/g)) radii.add(Number(m[1]));
      for (const m of text.matchAll(new RegExp(`\\b(?:borderRadius|DEFAULT|sm|md|lg|xl)\\s*:\\s*${str}`, "g"))) { const px = lengthPx(m[1]!); if (px !== undefined) radii.add(px); }
      for (const m of text.matchAll(new RegExp(`\\b(?:boxShadow|shadow)\\s*:\\s*${str}`, "g"))) if (/\d/.test(m[1]!)) shadows.add(m[1]!);
    }
    if (colours.size + fonts.size + radii.size + shadows.size > before) from.push(f);
  }
  if (!from.length) return undefined;
  const tailwind = src.list().some((f) => /(^|\/)tailwind\.config\./.test(f)) || files.some((f) => STYLE.test(f) && /@tailwind\b|@import\s+["']tailwindcss/.test(src.read(f) ?? ""));
  // Tailwind's own corner steps (rounded-sm .. rounded-3xl) are the app's too; its colour palette is not listed here
  if (tailwind) for (const px of [2, 4, 6, 8, 12, 16, 24]) radii.add(px);
  return { colours: [...colours], fonts: [...fonts], radii: [...radii].sort((a, b) => a - b), shadows: [...shadows], from, tailwind };
}
