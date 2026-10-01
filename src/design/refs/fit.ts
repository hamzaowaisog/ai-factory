// Proof that a theme comes from real products: the chosen brand colour must sit in the colour family of the
// reference brands briefed for the field, and the theme must say which references it drew on and what it took.
// Pure code, no model. A field with no references (no field matched) is checked on its basis only.
import type { DesignTheme } from "../../contracts/artifacts.js";
import type { RefBrand, RefIndustry } from "./data.js";
import { loadMeasured, pickIndustries, resolveBrand, type Measured } from "./index.js";

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

/** Hue in degrees (0-360), saturation and lightness (0-1). */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as RGB;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const hueGap = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** How far (degrees of hue) two colours are apart; colours with almost no saturation count as neutral and always agree with each other. */
export function colourGap(a: string, b: string): number {
  const x = hsl(a), y = hsl(b);
  if (x.s < 0.12 && y.s < 0.12) return 0;
  if (x.s < 0.12 || y.s < 0.12) return 180;
  return hueGap(x.h, y.h);
}

export const MAX_HUE_GAP = 40;

/** The same colour to the eye: hue within 4 degrees and saturation and lightness within 0.05. */
export function closeShade(a: string, b: string): boolean {
  const x = hsl(a), y = hsl(b);
  return hueGap(x.h, y.h) <= 4 && Math.abs(x.s - y.s) <= 0.05 && Math.abs(x.l - y.l) <= 0.05;
}

export interface FitRefs { brands: (RefBrand & { measured: boolean })[]; labels: string[] }

/** The reference brands a requirement text is briefed with (the same pick the design prompt uses), measured values preferred. */
export function fitRefs(text: string, industries?: RefIndustry[], measured: Record<string, Measured> = loadMeasured()): FitRefs {
  const picked = pickIndustries(text, industries);
  const brands = picked.flatMap((p) => p.industry.brands).map((b) => resolveBrand(b, measured));
  return { brands, labels: picked.map((p) => p.industry.label) };
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Checks the theme against the references. `measured` brands count double: a colour read from the live site outranks a reported one,
 * so when any brand was measured the colour must match one of those first.
 */
export function themeFit(theme: DesignTheme | undefined, refs: FitRefs): { check: string; message: string }[] {
  if (!theme) return [];
  const bad: { check: string; message: string }[] = [];
  if (refs.brands.length) {
    const colours = refs.brands.flatMap((b) => [b.brand, ...(b.accent ? [b.accent] : [])]);
    const near = colours.filter((c) => colourGap(theme.brand, c) <= MAX_HUE_GAP || (theme.accent && colourGap(theme.accent, c) <= MAX_HUE_GAP));
    if (!near.length) {
      const list = refs.brands.slice(0, 6).map((b) => `${b.name} ${b.brand.toUpperCase()}${b.accent ? ` + ${b.accent.toUpperCase()}` : ""}${b.measured ? " (measured)" : ""}`).join(", ");
      bad.push({ check: "design-off-reference", message: `Brand ${theme.brand} is more than ${MAX_HUE_GAP} degrees of hue from every reference colour for ${refs.labels.join(" / ")} (${list}). Products in this field are coloured in that family: move the brand colour into it, or cite in "basis" why this product must differ.` });
    }
    // a look that is one brand's colour, to the shade, is a copy; real competitors differ
    const copied = refs.brands.find((b) => [b.brand, b.accent].some((c) => c && closeShade(theme.brand, c)));
    if (copied) bad.push({ check: "design-copied", message: `Brand ${theme.brand} is the same shade as ${copied.name}'s. Stay in the family but choose your own shade, as another competitor in the field would.` });
    const names = new Set(refs.brands.map((b) => norm(b.name)));
    const cited = (theme.basis ?? []).filter((x) => names.has(norm(x.ref)));
    if (cited.length < 2) bad.push({ check: "design-no-basis", message: `"theme.basis" must cite at least two of the briefed reference brands (${[...names].slice(0, 6).join(", ")}) with what was taken from each (for example "Delta: navy headings, red only on the primary action"). It cites ${cited.length}.` });
  } else if ((theme.basis ?? []).length < 2) {
    bad.push({ check: "design-no-basis", message: `"theme.basis" must name two or three well-known real products of this kind and what was taken from each (colour use, bar, density). It has ${(theme.basis ?? []).length}.` });
  }
  return bad;
}
