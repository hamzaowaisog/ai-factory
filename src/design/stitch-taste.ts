// The Stitch design system (DESIGN.md), written by following the installed stitch-design-taste skill
// (.agents/skills/stitch-design-taste/SKILL.md). The skill sets the taste; the client's brand and existing look come first.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** From src/design or dist/design, two levels up is the factory's root. */
export const TASTE_SKILL_PATH = fileURLToPath(new URL("../../.agents/skills/stitch-design-taste/SKILL.md", import.meta.url));

/**
 * The SHA-256 of the reviewed SKILL.md (line endings as LF): Leonxlnx/taste-skill, skills/stitch-skill, MIT (LICENSE beside it),
 * with this repository's EXTENDED RULES added (NOTICE.md).
 * The skill is a third party's text that goes into every DESIGN.md briefing, so a copy that differs is refused until someone
 * reviews the change and updates this pin.
 */
export const TASTE_SKILL_SHA256 = "103758ea353c3c64995a01e149ace7815f36207612b6c026642bb31d56423ae5";

const digest = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** What is wrong with the installed skill, if anything: missing, or not the reviewed copy. The pin applies to the installed path. */
function skillFault(path: string, pinned: string | undefined): string | undefined {
  if (!existsSync(path)) return `the stitch-design-taste skill is missing at ${path}; install it (skills-lock.json) before using the stitch engine`;
  const sha = pinned ? digest(readFileSync(path, "utf8")) : undefined;
  return sha && sha !== pinned ? `the stitch-design-taste skill at ${path} is not the reviewed copy (sha256 ${sha.slice(0, 12)}, pinned ${pinned!.slice(0, 12)}); review the change and update TASTE_SKILL_SHA256 in src/design/stitch-taste.ts` : undefined;
}

/** A start-up problem when the skill is missing or changed, so a stitch run fails before it pays for any model call. */
export function tasteSkillProblem(path = TASTE_SKILL_PATH, pinned = path === TASTE_SKILL_PATH ? TASTE_SKILL_SHA256 : undefined): string | undefined {
  const fault = skillFault(path, pinned);
  return fault ? `design.engine is stitch, but ${fault}` : undefined;
}

export function loadTasteSkill(path = TASTE_SKILL_PATH, pinned = path === TASTE_SKILL_PATH ? TASTE_SKILL_SHA256 : undefined): string {
  const fault = skillFault(path, pinned);
  if (fault) throw new Error(fault.charAt(0).toUpperCase() + fault.slice(1));
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
- Choose the dials from the product: software screens and dashboards are Density 5 to 7, Variance 3 to 5 and Motion 4 to 6; a marketing site may go higher. A "mood" below, when there is one, sets them instead.
- Motion is part of the look, never left out: the motion system gives every token as a CSS value, and names one signature motion moment and one ambient animation that belong to this product.
- Describe the screens' shared look only. Never list screens, invent features, or describe content the requirements do not ask for.
Return the whole file as "designMd", "motion" (the signature motion moment as "signature" and the one ambient animation as "ambient": one sentence each that says which element moves and how, with its CSS values, as the DESIGN.md has them), and "theme" for Stitch: colorMode (LIGHT or DARK), headlineFont and bodyFont from Stitch's list (${STITCH_FONTS_TEXT}; the closest to the DESIGN.md's fonts), roundness (ROUND_FOUR, ROUND_EIGHT, ROUND_TWELVE or ROUND_FULL) and customColor, the one accent as a 6-digit hex (the client's brand colour when there is one).`;

/** The two motions every screen's prompt names, so Stitch draws them (it follows a concrete instruction better than a mood). */
export const StitchMotion = z.object({ signature: z.string().min(8), ambient: z.string().min(8) });
export type StitchMotion = z.infer<typeof StitchMotion>;
export const DesignMdOut = z.object({
  designMd: z.string().min(200), theme: StitchTheme, motion: StitchMotion.optional(),
  /** with the field's reference products: the ones the look stands on and what was taken from each, and why it leaves their colour family when it does */
  basis: z.array(z.object({ ref: z.string().min(1).max(40), took: z.string().min(1).max(120) })).max(5).optional(),
  departure: z.string().max(200).optional(),
});

/** The DESIGN.md rules when no client brand or reference sets the look: it stands on the real products of the product's field. */
export const FIELD_RULES = `No client brand or reference sets this product's look, so it is proof-driven, not invented: "design-references" lists the leading real products of this field with their colours (measured from their live sites where it says so) and how they use them.
- Take the accent from their colour family, in a shade of your own as another competitor in the field would choose it, never one product's exact shade. "theme.customColor" is that accent.
- Take the way they use colour, type and density too (where the accent appears, how heavy the headings are, how dense the tables are), and say it in section 1 by product name.
- Return "basis": two to four of those products by the name the list gives, each with what you took from it in under 120 characters ("Delta: navy headings, red only on the primary action").
- When this product's users or purpose call for a colour outside that family, return "departure" with the reason in one sentence; otherwise leave it out.
- "recent-looks", when there is one, lists the factory's latest other products: do not repeat any one's colour family together with its light or dark mode and its type.`;

/** The looks a project may ask of a Stitch design (design.stitch.mood). */
export const STITCH_MOODS = ["calm", "bold", "futuristic"] as const;
export type StitchMood = (typeof STITCH_MOODS)[number];
const MOODS: Record<StitchMood, string> = {
  calm: `The project asks for a calm look: Density 5 to 7, Variance 3 to 4, Motion 3 to 4. Light, quiet surfaces; motion only confirms that something changed.`,
  bold: `The project asks for a bold look: Variance 5 to 7, Motion 5 to 7. Large, confident type with strong contrast of size, one saturated accent used in big areas, layouts that are not symmetric, and every change of state animated.`,
  futuristic: `The project asks for a futuristic look: colorMode DARK unless the brand is light, Density 6 to 8, Variance 4 to 6, Motion 6 to 8.
It reads as a precise instrument, never as science fiction: near-black surfaces tinted towards the accent in three steps (never pure black), 1px hairlines of low-alpha light in place of shadows, mono type with tabular figures for every number, code and time, tight uppercase labels, and one sharp accent used as thin lines, small fills and the focus ring. Depth comes from layered surfaces and inset rules.
Motion is fast and exact: numbers roll to their value, lines and progress bars draw in, a shared element carries from a list to its detail, rows insert with a short shift, and one live element breathes.
The skill's bans stand: no glow, neon, gradient blob, aurora, glass blur or purple-to-blue gradient. Those read as generated, not as futuristic.`,
};
/** The briefing section a project's mood adds for the DESIGN.md; the client's brand still wins over it. */
export const moodRules = (mood: StitchMood | undefined): string | undefined => (mood ? `${MOODS[mood]}\nThe client's brand colours and fonts still win over this.` : undefined);

const SECTIONS = [/^##\s*1\.\s/m, /^##\s*2\.\s/m, /^##\s*3\.\s/m, /^##\s*4\.\s/m, /^##\s*5\.\s/m, /anti-patterns/i];

const BANS = /\b(no|never|not|avoid|banned?|instead of|rather than)\b/i;
const blackBrand = (brand: { colours: string[] }) => brand.colours.some((c) => /^#0{3}(0{3})?$/i.test(c.trim()));

/**
 * DESIGN.md with pure black swapped for the off-black, on the lines that use it. Asking the model again for one hex cost a whole
 * design-system call each time (12 Oct 2026), so it is put right here. A black brand, and a line that only bans it, are left alone.
 */
export function offBlack(md: string, brand: { colours: string[] }): { md: string; swapped: number } {
  if (blackBrand(brand)) return { md, swapped: 0 };
  let swapped = 0;
  const out = md.split("\n").map((l) => BANS.test(l) ? l : l.replace(/#000000\b|#000\b/gi, () => { swapped++; return "#18181B"; })).join("\n");
  return { md: out, swapped };
}

export function designMdFaults(md: string, brand: { colours: string[]; fonts: string[] }): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  if (SECTIONS.some((re) => !re.test(md))) bad.push({ check: "stitch-designmd-section", message: "DESIGN.md must have the skill's sections: 1 atmosphere, 2 colour palette, 3 typography, 4 components, 5 layout, and the anti-patterns." });
  // the brand wins over the skill's ban: a client whose brand is black keeps it
  // a line that bans it ("No pure black (#000000)", as the skill's own anti-patterns word it) does not use it
  const uses = md.split("\n").filter((l) => !BANS.test(l)).join("\n");
  if (!blackBrand(brand) && /#000000\b|#000\b/i.test(uses)) bad.push({ check: "stitch-designmd-black", message: "DESIGN.md uses pure black (#000000); use an off-black such as #18181B." });
  const lost = [...brand.colours.filter((c) => !md.toLowerCase().includes(c.toLowerCase())), ...brand.fonts.filter((f) => !md.includes(f))];
  if (lost.length) bad.push({ check: "stitch-designmd-brand", message: `DESIGN.md drops the client's brand: ${lost.join(", ")}. The brand wins over the skill's taste rules; keep each one with its role.` });
  return bad;
}
