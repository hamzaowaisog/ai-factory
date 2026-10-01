// The design reference library: pick the industry a requirement belongs to and give the design step a
// short brief of how real products in that field look. Only the matched industry is sent (a few
// hundred tokens), never the whole library.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { factoryHome } from "../../util/paths.js";
import { INDUSTRIES, type RefBrand, type RefIndustry } from "./data.js";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface IndustryMatch { industry: RefIndustry; score: number; hits: string[] }

/** Industries a text points at, best first. A keyword counts once, as a whole word or phrase. */
export function matchIndustries(text: string, industries: RefIndustry[] = INDUSTRIES): IndustryMatch[] {
  const out: IndustryMatch[] = [];
  for (const industry of industries) {
    const hits = industry.keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`, "i").test(text));
    if (hits.length) out.push({ industry, score: hits.length, hits });
  }
  return out.sort((a, b) => b.score - a.score || a.industry.id.localeCompare(b.industry.id));
}

/** The industries to brief: the best match, plus a second only when it is close (a hotel app with payments). A single stray word is not enough. */
export function pickIndustries(text: string, industries: RefIndustry[] = INDUSTRIES): IndustryMatch[] {
  const m = matchIndustries(text, industries);
  const top = m[0];
  if (!top || top.score < 2) return [];
  const second = m[1];
  return second && second.score >= 2 && second.score * 2 >= top.score ? [top, second] : [top];
}

// ---------- measured overlay ----------

export const Measured = z.object({
  brand: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  headerBg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  buttonBg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  pageBg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  font: z.string().optional(),
  buttonRadiusPx: z.number().optional(),
  measuredAt: z.string(),
});
export type Measured = z.infer<typeof Measured>;
export const MeasuredFile = z.record(z.string(), Measured);

export const measuredPath = (): string => join(factoryHome(), "design-refs", "measured.json");

export function loadMeasured(path = measuredPath()): Record<string, Measured> {
  try {
    if (!existsSync(path)) return {};
    const r = MeasuredFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return r.success ? r.data : {};
  } catch { return {}; }
}

export function saveMeasured(update: Record<string, Measured>, path = measuredPath()): void {
  const all = { ...loadMeasured(path), ...update };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, path);
}

/** A brand with the measured colour in place of the reported one, and whether it was measured. */
export function resolveBrand(b: RefBrand, measured: Record<string, Measured>): RefBrand & { measured: boolean } {
  const m = measured[b.id];
  const colour = m ? (m.brand ?? m.buttonBg ?? m.headerBg ?? m.themeColor) : undefined;
  return colour ? { ...b, brand: colour.toUpperCase(), measured: true } : { ...b, measured: false };
}

// ---------- the brief ----------

const hue = (hex: string): string => hex.toUpperCase();

/** What the design step reads: the field's brands, what they share and how to vary. Short on purpose. */
export function referenceBrief(industries: RefIndustry[], measured: Record<string, Measured> = loadMeasured()): string {
  return industries.map((i) => {
    const brands = i.brands.map((raw) => {
      const b = resolveBrand(raw, measured);
      return `- ${b.name}: ${hue(b.brand)}${b.accent ? ` + ${hue(b.accent)}` : ""}, ${b.mode}, ${b.chrome === "brand" ? "filled bar" : "plain bar"}, ${b.radius} corners; ${b.trait}${b.measured ? " [measured]" : ""}`;
    });
    const u = i.usual;
    return [
      `${i.label} (colours are approximate reference values; use them to see the family, not to copy):`,
      ...brands,
      `Shared: ${i.pattern}`,
      `Usual theme here: ${u.mode} mode, ${u.chrome} chrome, ${u.neutral} neutrals, ${u.font} type, ${u.radius} corners, ${u.density}, ${u.surface} surfaces.`,
    ].join("\n");
  }).join("\n\n")
    + "\nPick a brand colour in the same family as these, but do not reuse any one brand's exact value, name or logo. Make it feel like another competitor in the field.";
}

/** The brief for a requirement text, or undefined when no industry is clear. */
export function briefFor(text: string): string | undefined {
  const picked = pickIndustries(text);
  return picked.length ? referenceBrief(picked.map((p) => p.industry)) : undefined;
}
