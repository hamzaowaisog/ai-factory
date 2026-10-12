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

/**
 * A start-up problem for a design drawn by Claude or OpenAI, which takes the skill's page rules when the skill is installed:
 * only the reviewed copy. A missing skill is not a problem there: the design is drawn without it.
 */
export function tastePageProblem(path = TASTE_SKILL_PATH, pinned = path === TASTE_SKILL_PATH ? TASTE_SKILL_SHA256 : undefined): string | undefined {
  return existsSync(path) ? skillFault(path, pinned) : undefined;
}

export function loadTasteSkill(path = TASTE_SKILL_PATH, pinned = path === TASTE_SKILL_PATH ? TASTE_SKILL_SHA256 : undefined): string {
  const fault = skillFault(path, pinned);
  if (fault) throw new Error(fault.charAt(0).toUpperCase() + fault.slice(1));
  return readFileSync(path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** The skill's parts that say how a page is composed (its layout rules, its anti-patterns and its component replacements), by their headings. */
const PAGE_PARTS = ["### 6. Define Layout Principles", "### 9. List Anti-Patterns (AI Tells)", "## 12. Anti-Vibe-Coded Components"];
/**
 * Those parts of the skill, for the step that lists the screens and writes each Stitch prompt: it runs before the DESIGN.md
 * exists, and Stitch's drawing call takes a prompt alone, so a layout rule reaches a page only through its prompt.
 */
export function tastePageRules(skill = loadTasteSkill()): string {
  const lines = skill.split("\n");
  return PAGE_PARTS.map((h) => {
    const at = lines.findIndex((l) => l.startsWith(h));
    if (at < 0) throw new Error(`The stitch-design-taste skill has no "${h}" part; review the skill and update PAGE_PARTS in src/design/stitch-taste.ts`);
    const end = lines.findIndex((l, i) => i > at && /^#{1,3} /.test(l));
    return lines.slice(at, end < 0 ? undefined : end).join("\n").trim();
  }).join("\n\n");
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
- Motion is part of the look, never left out: the motion system gives every token as a CSS value, and names one signature motion moment and one ambient animation that belong to this product. It is said once: section 6 is at most four sentences that point to the motion system section, which holds the tokens, the layers and the CSS; neither repeats the other, and a product at Motion 4 or less keeps that section under 1500 characters besides its CSS.
- Mono type, when the look has one, is for numbers, codes and times only, never for labels, statuses or sentences: say so in section 3. The voice is the plain words of the product's users, never a console's ("protocol", "telemetry", "governance").
- Section 2 names exactly one page background, one surface for panels and fields, one text colour, one muted text colour and one rule colour, and one colour each for a status that is good, one that waits and one that is refused or failed. The accent is for actions and the selected menu item, never a status; a neutral never carries a tint of the accent unless the brand asks for it. Every page uses these and no other.
- Labels, headings and buttons are in sentence case; uppercase is for a table's column heads only. Do not name uppercase metadata as the look's contrast.
- Pictures: a person, a place, a product or a vehicle the product shows is a real photograph, the same person the same photograph on every page; say how it is cropped. Only decoration is banned (stock scenes, illustrations, logo strips). Never write that avatars or record pictures are left out.
- The human fingerprint's unexpected decision is a property of the look (a type treatment, a spacing rhythm, how rules and edges are drawn), never a mark, glyph or line drawn beside a value or an identifier: Stitch draws such a mark as stray characters in the data.
- Nothing in this file is ever text on a page. Write the grid, the numerals and the tokens as what the CSS does ("columns align to a shared grid", "figures line up in columns"), without a term a page could show as a label or chip ("12-col", "tabular numerals", a token's name).
- Name no real product or company in the file: say what is taken ("orderly white work surfaces", "plain-language actions") and give the products' names in "basis" alone.
- Describe the screens' shared look only: no sentence about sample data, roles, navigation or how the pages are produced. Never list screens, invent features, or describe content the requirements do not ask for.
Return the whole file as "designMd", "digest" (what the one who draws a page must keep of this file, as six to ten short plain sentences of instructions: the corner radius in px and where it applies, how a panel is edged (a rule or a shadow, and which), the spacing rhythm in px, each heading level's size and weight, the body size, a table's row height and how its rows are divided, how a primary and a secondary button and a field look and their height, how a status is shown, how a picture is cropped, and the human fingerprint's decision; no colour and no font name, which the page is told apart, nothing about motion, and no word a page could show as a label), "palette" (the hex codes of section 2, exactly as the file has them: "canvas" the page background, "surface", "ink" the text, "muted", "rule", the statuses "good", "waiting" and "bad", and "mono", the mono font's name when the look has one), "motion" (the signature motion moment as "signature" and the one ambient animation as "ambient": one sentence each that says which element moves and how, with its CSS values, as the DESIGN.md has them), and "theme" for Stitch: colorMode (LIGHT or DARK), headlineFont and bodyFont from Stitch's list (${STITCH_FONTS_TEXT}; the closest to the DESIGN.md's fonts), roundness (ROUND_FOUR, ROUND_EIGHT, ROUND_TWELVE or ROUND_FULL) and customColor, the one accent as a 6-digit hex (the client's brand colour when there is one).`;

/** The two motions every screen's prompt names, so Stitch draws them (it follows a concrete instruction better than a mood). */
export const StitchMotion = z.object({ signature: z.string().min(8), ambient: z.string().min(8) });
export type StitchMotion = z.infer<typeof StitchMotion>;
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** The design system's colours as section 2 of its DESIGN.md has them, so every screen's prompt and the page check can name them. */
export const StitchPalette = z.object({ canvas: Hex, surface: Hex, ink: Hex, muted: Hex.optional(), rule: Hex.optional(), good: Hex.optional(), waiting: Hex.optional(), bad: Hex.optional(), mono: z.string().max(40).optional() });
export type StitchPalette = z.infer<typeof StitchPalette>;
export const DesignMdOut = z.object({
  designMd: z.string().min(200), /** the file's rules a page is drawn by, written into every screen's prompt */ digest: z.string().max(3000).optional(), theme: StitchTheme, motion: StitchMotion.optional(), palette: StitchPalette.optional(),
  /** with the field's reference products: the ones the look stands on and what was taken from each, and why it leaves their colour family when it does */
  basis: z.array(z.object({ ref: z.string().min(1).max(40), took: z.string().min(1).max(120) })).max(5).optional(),
  departure: z.string().max(200).optional(),
});

/** The DESIGN.md rules when no client brand or reference sets the look: it stands on the real products of the product's field. */
export const FIELD_RULES = `No client brand or reference sets this product's look, so it is proof-driven, not invented: "design-references" lists the leading real products of this field with their colours (measured from their live sites where it says so) and how they use them.
- Take the accent from their colour family, in a shade of your own as another competitor in the field would choose it, never one product's exact shade. "theme.customColor" is that accent.
- Take the way they use colour, type and density too (where the accent appears, how heavy the headings are, how dense the tables are), and say in section 1 what was taken, without a product's name (the names go in "basis").
- Return "basis": two to four of those products by the name the list gives, each with what you took from it in under 120 characters ("Delta: navy headings, red only on the primary action").
- When this product's users or purpose call for a colour outside that family, return "departure" with the reason in one sentence; otherwise leave it out.
- "recent-looks", when there is one, lists the factory's latest other products: do not repeat any one's colour family together with its light or dark mode and its type.`;

/** The looks a project may ask of a Stitch design (design.stitch.mood). */
export const STITCH_MOODS = ["calm", "bold", "futuristic"] as const;
export type StitchMood = (typeof STITCH_MOODS)[number];
const MOODS: Record<StitchMood, string> = {
  calm: `The project asks for a calm look: colorMode LIGHT unless the brand is dark, Density 5 to 7, Variance 3 to 4, Motion 3 to 4. Light, quiet surfaces with dark text that reads in daylight on a phone; motion only confirms that something changed.`,
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
