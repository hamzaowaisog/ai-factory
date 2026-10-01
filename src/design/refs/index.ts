// The design reference library: pick the industry a requirement belongs to and give the design step a
// short brief of how real products in that field look. Only the matched industry is sent (a few
// hundred tokens), never the whole library.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { factoryHome } from "../../util/paths.js";
import { ARCHETYPES, INDUSTRIES, RefIndustry, type RefBrand } from "./data.js";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface IndustryMatch { industry: RefIndustry; score: number; hits: string[] }

/** Industries a text points at, best first. A keyword counts once, as a whole word or phrase. */
export function matchIndustries(text: string, industries: RefIndustry[] = allIndustries()): IndustryMatch[] {
  const out: IndustryMatch[] = [];
  for (const industry of industries) {
    const hits = industry.keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`, "i").test(text));
    if (hits.length) out.push({ industry, score: hits.length, hits });
  }
  return out.sort((a, b) => b.score - a.score || a.industry.id.localeCompare(b.industry.id));
}

/** The industries to brief: the best match, plus a second only when it is close (a hotel app with payments). A single stray word is not enough. */
export function pickIndustries(text: string, industries: RefIndustry[] = allIndustries()): IndustryMatch[] {
  const m = matchIndustries(text, industries);
  const top = m[0];
  if (!top || top.score < 2) return [];
  const second = m[1];
  return second && second.score >= 2 && second.score * 2 >= top.score ? [top, second] : [top];
}

// ---------- your own industries ----------

export const userIndustriesDir = (): string => join(factoryHome(), "design-refs", "industries");

/** Fields you added as JSON files in ~/.factory/design-refs/industries (one industry or an array per file). Bad files are reported, not fatal. */
export function loadUserIndustries(dir = userIndustriesDir()): { industries: RefIndustry[]; problems: string[] } {
  const industries: RefIndustry[] = [], problems: string[] = [];
  if (!existsSync(dir)) return { industries, problems };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const r = RefIndustry.safeParse(item);
        if (r.success) industries.push(r.data);
        else problems.push(`${f}: ${r.error.issues.slice(0, 2).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      }
    } catch (e) { problems.push(`${f}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`); }
  }
  return { industries, problems };
}

/** Built-in fields plus yours; one of yours with the same id replaces the built-in. */
export function allIndustries(dir?: string): RefIndustry[] {
  const mine = loadUserIndustries(dir).industries;
  const ids = new Set(mine.map((i) => i.id));
  return [...INDUSTRIES.filter((i) => !ids.has(i.id)), ...mine];
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
export function referenceBrief(industries: RefIndustry[], measured: Record<string, Measured> = loadMeasured(), seed = ""): string {
  return industries.map((i) => {
    // with a seed (the requirement text) the brands start at a different place per requirement, so two projects in one field are not
    // handed the same lead example; the same text always gives the same brief
    const start = seed ? parseInt(createHash("sha256").update(`${seed}|${i.id}`).digest("hex").slice(0, 8), 16) % i.brands.length : 0;
    const order = [...i.brands.slice(start), ...i.brands.slice(0, start)];
    const brands = order.map((raw, n) => {
      const b = resolveBrand(raw, measured);
      return `- ${n === 0 && seed ? "(lead) " : ""}${b.name}: ${hue(b.brand)}${b.accent ? ` + ${hue(b.accent)}` : ""}, ${b.mode}, ${b.chrome === "brand" ? "filled bar" : "plain bar"}, ${b.radius} corners; ${b.trait}${b.measured ? " [measured]" : ""}`;
    });
    const u = i.usual;
    return [
      `${i.label} (colours are approximate reference values; use them to see the family, not to copy):`,
      ...brands,
      `Shared: ${i.pattern}`,
      `Field defaults: ${u.mode} mode, ${u.chrome} chrome, ${u.neutral} neutrals, ${u.font} type, ${u.radius} corners, ${u.density}, ${u.surface} surfaces. Defaults are where products in a field start, not where they end: change at least two of them (bar, corners, type, density, surface, neutrals, mode) because of who uses THIS product and what it must do, and say why in "mood".`,
    ].join("\n");
  }).join("\n\n")
    + "\nPick a brand colour in the same family as these, but do not reuse any one brand's exact value, name or logo. Make it feel like another competitor in the field.";
}

/** Used when no field is clear: the general look families, so the model can place a field nobody listed. */
export function archetypeBrief(hint?: RefIndustry): string {
  return [
    "No listed field matched clearly. First decide what kind of product this is, then use the nearest look family below (blend two when it is mixed, for example a hospital portal is care plus professional tool). Real products of that kind are coloured like this:",
    ...ARCHETYPES.map((a) => `- ${a.label} (${a.when}): ${a.look}`),
    ...(hint ? [`Weak hint from one keyword: ${hint.label} (${hint.archetype}).`] : []),
    "Think of two or three well-known products of that kind and note what they share. Choose your own brand colour in that family; do not copy any brand.",
  ].join("\n");
}

/** The brief for a requirement text. A matched field gets its brands plus its look family; anything else gets the families. */
export function briefFor(text: string, industries: RefIndustry[] = allIndustries()): string {
  const picked = pickIndustries(text, industries);
  if (!picked.length) return archetypeBrief(matchIndustries(text, industries)[0]?.industry);
  const looks = [...new Set(picked.map((p) => p.industry.archetype))].map((id) => ARCHETYPES.find((a) => a.id === id)).filter((a) => !!a);
  return `${referenceBrief(picked.map((p) => p.industry), loadMeasured(), text)}\nWider family (shared by many fields, so differ from it deliberately): ${looks.map((a) => `${a!.label}: ${a!.look}`).join(" | ")}`;
}
