// The Stitch design system (DESIGN.md), written by following the installed stitch-design-taste skill
// (.agents/skills/stitch-design-taste/SKILL.md). The skill sets the taste; the client's brand and existing look come first.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** From src/design or dist/design, two levels up is the factory's root. */
export const TASTE_SKILL_PATH = fileURLToPath(new URL("../../.agents/skills/stitch-design-taste/SKILL.md", import.meta.url));

/** A start-up problem when the skill is not installed, so a stitch run fails before it pays for any model call. */
export function tasteSkillProblem(path = TASTE_SKILL_PATH): string | undefined {
  return existsSync(path) ? undefined : `design.engine is stitch, but the stitch-design-taste skill is missing at ${path}; install it (skills-lock.json) before using the stitch engine`;
}

export function loadTasteSkill(path = TASTE_SKILL_PATH): string {
  if (!existsSync(path)) throw new Error(`The stitch-design-taste skill is missing at ${path}; install it (skills-lock.json) before using the stitch engine`);
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** The fonts Stitch's design system accepts (create_design_system, SDK 0.3.5). */
export const STITCH_FONTS = ["BE_VIETNAM_PRO", "EPILOGUE", "INTER", "LEXEND", "MANROPE", "NEWSREADER", "NOTO_SERIF", "PLUS_JAKARTA_SANS", "PUBLIC_SANS", "SPACE_GROTESK", "SPLINE_SANS", "WORK_SANS", "DOMINE", "LIBRE_CASLON_TEXT", "EB_GARAMOND", "LITERATA", "SOURCE_SERIF_FOUR", "MONTSERRAT", "METROPOLIS", "SOURCE_SANS_THREE", "NUNITO_SANS", "ARIMO", "HANKEN_GROTESK", "RUBIK", "GEIST", "DM_SANS", "IBM_PLEX_SANS", "SORA"] as const;
/** Stitch's required theme fields; the DESIGN.md travels beside them as theme.designMd. */
export const StitchTheme = z.object({
  colorMode: z.enum(["LIGHT", "DARK"]),
  headlineFont: z.enum(STITCH_FONTS),
  bodyFont: z.enum(STITCH_FONTS),
  roundness: z.enum(["ROUND_FOUR", "ROUND_EIGHT", "ROUND_TWELVE", "ROUND_FULL"]),
  customColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type StitchTheme = z.infer<typeof StitchTheme>;

const STITCH_FONTS_TEXT = STITCH_FONTS.join(", ");

export const TASTE_OVERRIDES = `You write the DESIGN.md for this product by following the skill above, with these rules first:
- The client's brand colours and fonts, and an existing app's look, win over the skill's taste rules and bans. Keep every brand hex and font named in "brand" exactly.
- Use the skill's output structure (sections 1 to 7). Every colour has a descriptive name, its hex code and its role.
- Choose the dials from the product: software screens and dashboards are Density 5 to 7 and Variance 3 to 5; a marketing site may go higher.
- Describe the screens' shared look only. Never list screens, invent features, or describe content the requirements do not ask for.
Return the whole file as "designMd", and "theme" for Stitch: colorMode (LIGHT or DARK), headlineFont and bodyFont from Stitch's list (${STITCH_FONTS_TEXT}; the closest to the DESIGN.md's fonts), roundness (ROUND_FOUR, ROUND_EIGHT, ROUND_TWELVE or ROUND_FULL) and customColor, the one accent as a 6-digit hex (the client's brand colour when there is one).`;

export const DesignMdOut = z.object({ designMd: z.string().min(200), theme: StitchTheme });

const SECTIONS = [/^##\s*1\.\s/m, /^##\s*2\.\s/m, /^##\s*3\.\s/m, /^##\s*4\.\s/m, /^##\s*5\.\s/m, /anti-patterns/i];

export function designMdFaults(md: string, brand: { colours: string[]; fonts: string[] }): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  if (SECTIONS.some((re) => !re.test(md))) bad.push({ check: "stitch-designmd-section", message: "DESIGN.md must have the skill's sections: 1 atmosphere, 2 colour palette, 3 typography, 4 components, 5 layout, and the anti-patterns." });
  // the brand wins over the skill's ban: a client whose brand is black keeps it
  const blackBrand = brand.colours.some((c) => /^#0{3}(0{3})?$/i.test(c.trim()));
  if (!blackBrand && /#000000\b|#000\b/i.test(md)) bad.push({ check: "stitch-designmd-black", message: "DESIGN.md uses pure black (#000000); use an off-black such as #18181B." });
  const lost = [...brand.colours.filter((c) => !md.toLowerCase().includes(c.toLowerCase())), ...brand.fonts.filter((f) => !md.includes(f))];
  if (lost.length) bad.push({ check: "stitch-designmd-brand", message: `DESIGN.md drops the client's brand: ${lost.join(", ")}. The brand wins over the skill's taste rules; keep each one with its role.` });
  return bad;
}
