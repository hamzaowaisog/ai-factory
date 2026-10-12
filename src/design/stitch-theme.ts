// A Stitch design system's theme in our format (DesignTheme), so a Stitch design gets tokens, a theme for the kit and the
// coding brief, and the "new look" label, the same as a design drawn from the design JSON.
import { DesignTheme } from "../contracts/artifacts.js";
import type { StitchPalette, StitchTheme } from "./stitch-taste.js";

type Font = StitchTheme["bodyFont"];
const SERIFS = new Set<Font>(["NEWSREADER", "NOTO_SERIF", "DOMINE", "LIBRE_CASLON_TEXT", "EB_GARAMOND", "LITERATA", "SOURCE_SERIF_FOUR"]);
const GROTESK = new Set<Font>(["SPACE_GROTESK", "HANKEN_GROTESK"]);
const ROUNDED = new Set<Font>(["NUNITO_SANS", "RUBIK"]);
const NAMES: Partial<Record<Font, string>> = { DM_SANS: "DM Sans", IBM_PLEX_SANS: "IBM Plex Sans", SOURCE_SERIF_FOUR: "Source Serif 4", SOURCE_SANS_THREE: "Source Sans 3", EB_GARAMOND: "EB Garamond" };
const RADIUS = { ROUND_FOUR: "sharp", ROUND_EIGHT: "soft", ROUND_TWELVE: "soft", ROUND_FULL: "round" } as const;

export const familyName = (f: Font): string => NAMES[f] ?? f.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

export function stitchThemeToDesign(t: StitchTheme, mood: string): DesignTheme {
  const font = SERIFS.has(t.bodyFont) ? "book" : GROTESK.has(t.bodyFont) ? "grotesk" : ROUNDED.has(t.bodyFont) ? "rounded" : "sans";
  const heading = SERIFS.has(t.headlineFont) && !SERIFS.has(t.bodyFont) ? "serif" : "match";
  return DesignTheme.parse({
    mood: mood.trim().slice(0, 40) || "Stitch design system",
    brand: t.customColor, mode: t.colorMode.toLowerCase(), radius: RADIUS[t.roundness], font, heading,
    families: { heading: familyName(t.headlineFont), body: familyName(t.bodyFont) },
  });
}

/** The look every page is checked against and told in words: Stitch's own tokens tint the neutrals towards the accent and darken it. */
export interface StitchLook { canvas: string; surface: string; ink: string; accent: string; heading: string; body: string; mono?: string; muted?: string; rule?: string; good?: string; waiting?: string; bad?: string }
export function stitchLook(t: StitchTheme, p: StitchPalette | undefined): StitchLook | undefined {
  return p ? { ...p, accent: t.customColor, heading: familyName(t.headlineFont), body: familyName(t.bodyFont) } : undefined;
}
/** What each screen's prompt says of the look: the values themselves, since a page told only to follow the system takes Stitch's tokens. */
export function lookLine(l: StitchLook | undefined): string {
  if (!l) return "";
  const status = [l.good && `good ${l.good}`, l.waiting && `waiting ${l.waiting}`, l.bad && `refused or failed ${l.bad}`].filter(Boolean).join(", ");
  return `\nThe look, the same on every page, written into the page as these exact values (never a generated or tinted token in their place): page background ${l.canvas} on the body; panels, tables and fields ${l.surface}; text ${l.ink}${l.muted ? `, quieter text ${l.muted}` : ""}${l.rule ? `; borders and rules ${l.rule}` : ""}; primary buttons, the selected menu item and the focus ring ${l.accent}, and nothing else in that colour.${status ? ` A status has one colour wherever it shows (${status}), always with its word.` : ""} Headings in ${l.heading}, everything else in ${l.body}${l.mono ? `, numbers, codes and times in ${l.mono}` : ""}; load no other font.`;
}

/** The most of a design system's digest a screen's prompt takes: a longer one crowds out the page's own content. */
export const MAX_DIGEST = 1100;
/** What each screen's prompt says of the design system's rules: Stitch's drawing call takes a prompt alone, and a page told only to follow the system keeps little of it. */
export function digestLine(digest: string | undefined): string {
  const d = (digest ?? "").replace(/\s+/g, " ").trim();
  if (!d) return "";
  // cut at the end of a sentence, never inside one
  const cut = d.length <= MAX_DIGEST ? d : d.slice(0, MAX_DIGEST).replace(/[^.]*$/, "").trim() || d.slice(0, MAX_DIGEST);
  return `\nThe design system's rules for every page; follow them, and show none of these words on the page: ${cut}`;
}
