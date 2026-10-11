// A Stitch design system's theme in our format (DesignTheme), so a Stitch design gets tokens, a theme for the kit and the
// coding brief, and the "new look" label, the same as a design drawn from the design JSON.
import { DesignTheme } from "../contracts/artifacts.js";
import type { StitchTheme } from "./stitch-taste.js";

type Font = StitchTheme["bodyFont"];
const SERIFS = new Set<Font>(["NEWSREADER", "NOTO_SERIF", "DOMINE", "LIBRE_CASLON_TEXT", "EB_GARAMOND", "LITERATA", "SOURCE_SERIF_FOUR"]);
const GROTESK = new Set<Font>(["SPACE_GROTESK", "HANKEN_GROTESK"]);
const ROUNDED = new Set<Font>(["NUNITO_SANS", "RUBIK"]);
const NAMES: Partial<Record<Font, string>> = { DM_SANS: "DM Sans", IBM_PLEX_SANS: "IBM Plex Sans", SOURCE_SERIF_FOUR: "Source Serif 4", SOURCE_SANS_THREE: "Source Sans 3", EB_GARAMOND: "EB Garamond" };
const RADIUS = { ROUND_FOUR: "sharp", ROUND_EIGHT: "soft", ROUND_TWELVE: "soft", ROUND_FULL: "round" } as const;

const familyName = (f: Font): string => NAMES[f] ?? f.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

export function stitchThemeToDesign(t: StitchTheme, mood: string): DesignTheme {
  const font = SERIFS.has(t.bodyFont) ? "book" : GROTESK.has(t.bodyFont) ? "grotesk" : ROUNDED.has(t.bodyFont) ? "rounded" : "sans";
  const heading = SERIFS.has(t.headlineFont) && !SERIFS.has(t.bodyFont) ? "serif" : "match";
  return DesignTheme.parse({
    mood: mood.trim().slice(0, 40) || "Stitch design system",
    brand: t.customColor, mode: t.colorMode.toLowerCase(), radius: RADIUS[t.roundness], font, heading,
    families: { heading: familyName(t.headlineFont), body: familyName(t.bodyFont) },
  });
}
