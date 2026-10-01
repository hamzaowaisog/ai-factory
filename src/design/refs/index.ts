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

/** The fields a requirement belongs to, as one key ("clinic", "hotel+payments"); "" when none is clear. Kept with each approved look. */
export const fieldOf = (text: string, industries?: RefIndustry[]): string => pickIndustries(text, industries).map((p) => p.industry.id).join("+");

// ---------- the product's own signals ----------

/**
 * What the requirements say about who uses the product, where and in what mood, as plain words found in them. Two products in one
 * field share the brands above; these differ with the product, so the brief does too (a clinic's patient app and its back office
 * get different starting points). Evidence for the reading, not a rule: the model weighs them.
 */
const CUES: { id: string; when: RegExp; means: string }[] = [
  { id: "children", when: /\b(kids?|children|child|toddlers?|parents?|school ?kids|pupils?)\b/i, means: "children or families: friendly and rounded, bright but readable, pictures over words" },
  { id: "older", when: /\b(elderly|seniors?|older (?:adults|people|users)|pensioners?|retirees?|caregivers?)\b/i, means: "older users: large text, strong contrast, few choices per screen" },
  { id: "on-the-move", when: /\b(drivers?|riders?|couriers?|technicians?|on (?:the )?site|in the field|field (?:staff|agents?|workers?)|warehouse|delivery agents?|on the go|outdoors?)\b/i, means: "used on the move or on site: phone first, big touch targets, high contrast, read at a glance" },
  { id: "desk-all-day", when: /\b(back ?office|admin(?:istrator)?s?|operations team|ops team|dispatchers?|agents? console|analysts?|accountants?|clerks?|reports?|analytics)\b/i, means: "staff at a desk all day: dense, calm, quiet colour, fast to scan" },
  { id: "premium", when: /\b(premium|luxury|vip|private (?:banking|clients?)|concierge|exclusive|bespoke|high[- ]net[- ]worth)\b/i, means: "premium: restraint, more space, a refined or serif heading" },
  { id: "urgent", when: /\b(emergency|urgent|sos|incidents?|alerts?|outages?|critical|panic)\b/i, means: "urgent moments: one clear action, strong status colours, nothing decorative in the way" },
  { id: "anxious", when: /\b(symptoms?|diagnos\w*|therapy|mental health|insurance claims?|debt|loans? arrears)\b/i, means: "people who may be worried: calm, reassuring, plain words, no alarm colours for normal states" },
  { id: "learners", when: /\b(students?|learners?|courses?|lessons?|quiz(?:zes)?|exams?|tutors?)\b/i, means: "learners: encouraging, progress always visible" },
  { id: "money", when: /\b(wallet|balances?|transfers?|payments?|payouts?|invoices?|remittances?)\b/i, means: "money moments: trust first, amounts large and exact, every status explicit" },
  { id: "social", when: /\b(feed|followers?|friends|community|posts?|likes?|comments?|share|stories)\b/i, means: "social: expressive, picture-led, content before chrome" },
  { id: "enterprise", when: /\b(b2b|enterprise|compliance|audit(?: trail)?|sso|tenants?|procurement|approvals? workflow)\b/i, means: "business buyers: sober, credible, data first" },
  { id: "night", when: /\b(night|late[- ]night|after hours|overnight|shift workers?|in the dark)\b/i, means: "used at night: a dark mode or dim surfaces, no glare" },
  { id: "patchy-network", when: /\b(offline|low (?:connectivity|bandwidth)|poor (?:signal|network)|rural|no internet)\b/i, means: "patchy networks: light pages, clear saved and waiting states" },
  { id: "playful", when: /\b(game|gamif\w*|rewards?|points|badges?|streaks?|fun|leaderboards?)\b/i, means: "playful: rewards and motion are part of the product, bolder colour is earned" },
];

/** The signals a requirement text gives, in table order; at most six, so a long spec does not drown the brief. */
export function requirementCues(text: string): { id: string; means: string; word: string }[] {
  return CUES.flatMap((c) => { const m = c.when.exec(text); return m ? [{ id: c.id, means: c.means, word: m[0].toLowerCase() }] : []; }).slice(0, 6);
}

/** The cues as brief lines; "" when the requirements give none. */
export function cueBrief(text: string): string {
  const cues = requirementCues(text);
  if (!cues.length) return "";
  return [
    "Signals in THIS product's requirements (the word found, then what it usually means for the look). Two products in one field share the brands above; these are what set this one apart, so weigh them in the reading and let them decide which field defaults to change:",
    ...cues.map((c) => `- "${c.word}": ${c.means}`),
  ].join("\n");
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
  const cues = cueBrief(text);
  if (!picked.length) return [archetypeBrief(matchIndustries(text, industries)[0]?.industry), cues].filter(Boolean).join("\n\n");
  const looks = [...new Set(picked.map((p) => p.industry.archetype))].map((id) => ARCHETYPES.find((a) => a.id === id)).filter((a) => !!a);
  return [`${referenceBrief(picked.map((p) => p.industry), loadMeasured(), text)}\nWider family (shared by many fields, so differ from it deliberately): ${looks.map((a) => `${a!.label}: ${a!.look}`).join(" | ")}`, cues].filter(Boolean).join("\n\n");
}
