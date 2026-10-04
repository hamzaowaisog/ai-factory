// Every product its own look (docs/estimates-design.md, "Each product its own look"). The design step reads the product from
// its requirements first (who uses it, where, on what, the tone, the moment that matters) and every theme choice must follow
// from that reading. Approved looks are remembered under the factory home, so the next project is told what recent ones used
// and code rejects a look too close to any of them. Pure code, no model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DesignTheme } from "../contracts/artifacts.js";
import { factoryHome } from "../util/paths.js";
import { colourGap } from "./refs/fit.js";

type Problem = { check: string; message: string };

/** The parts of a look a person notices first, compared between projects. */
const AXES = ["mode", "shell", "font", "radius", "surface", "hero", "charts", "imagery", "neutral", "chrome", "mark"] as const;
type Axis = (typeof AXES)[number];

const axis = z.string().default("");
export const Look = z.object({
  key: z.string(), at: z.string(), brand: z.string(), mood: z.string().default(""),
  // the reference fields the product matched ("clinic", "hotel+payments"), so a project is also kept apart from older ones in its field
  field: z.string().default(""),
  mode: axis, shell: axis, font: axis, radius: axis, surface: axis, hero: axis, charts: axis, imagery: axis, neutral: axis, chrome: axis, mark: axis,
});
export type Look = z.infer<typeof Look>;

/** How many recent projects a new look is compared with, and by how much it must differ from each. */
export const RECENT_LOOKS = 6;
/** Older projects in the same field, compared as well: two clinic apps a year apart should still not look alike. */
export const SAME_FIELD_LOOKS = 3;
export const MIN_LOOK_GAP = 4;

const DEFAULTS: Record<Axis, string> = { mode: "light", shell: "auto", font: "sans", radius: "soft", surface: "flat", hero: "none", charts: "soft", imagery: "mixed", neutral: "cool", chrome: "plain", mark: "glyph" };

export function lookOf(key: string, t: DesignTheme, at = new Date().toISOString(), field = ""): Look {
  // the type is the pair: a body with a different heading is another type ("sans+serif")
  const v: Record<string, string | undefined> = { ...(t as unknown as Record<string, string | undefined>), font: `${t.font ?? DEFAULTS.font}${t.heading && t.heading !== "match" ? `+${t.heading}` : ""}` };
  return { key, at, brand: t.brand, mood: t.mood, field, ...Object.fromEntries(AXES.map((a) => [a, v[a] ?? DEFAULTS[a]])) } as Look;
}

/** How far apart two looks are: a different colour family counts 2 (a near one 1), every other differing axis 1. */
export function lookGap(a: Look, b: Look): { gap: number; same: string[] } {
  const hue = colourGap(a.brand, b.brand);
  const same = AXES.filter((x) => a[x] === b[x]);
  return { gap: (hue > 40 ? 2 : hue > 15 ? 1 : 0) + (AXES.length - same.length), same: [...(hue <= 15 ? ["colour family"] : []), ...same] };
}

/** One product, one entry: the estimate's project name when given (a change run then updates its own look), else the run. */
export const lookKey = (projectName: string | undefined, runId: string): string => projectName?.trim().toLowerCase() || runId;

export const looksPath = (): string => join(factoryHome(), "design-looks.json");

export function loadLooks(path = looksPath()): Look[] {
  if (!existsSync(path)) return [];
  // a look recorded before an axis existed has that axis's default
  try { return z.array(Look).parse(JSON.parse(readFileSync(path, "utf8"))).map((l) => ({ ...l, ...Object.fromEntries(AXES.filter((x) => !l[x]).map((x) => [x, DEFAULTS[x]])) })); } catch { return []; }
}

/** Remembers an approved look; a project approved again replaces its own entry. */
export function recordLook(key: string, theme: DesignTheme, path = looksPath(), at?: string, field = ""): void {
  const keep = loadLooks(path).filter((l) => l.key !== key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...keep, lookOf(key, theme, at, field)].slice(-50), null, 2));
}

const sharesField = (a: string, b: string): boolean => !!a && !!b && a.split("+").some((f) => b.split("+").includes(f));

/** The latest looks of other projects, newest first, then the latest older ones in the same field (`field` as `fieldOf` gives it). */
export function recentLooks(exceptKey: string | undefined, path = looksPath(), field = ""): Look[] {
  const others = loadLooks(path).filter((l) => l.key !== exceptKey).sort((a, b) => b.at.localeCompare(a.at));
  return [...others.slice(0, RECENT_LOOKS), ...others.slice(RECENT_LOOKS).filter((l) => sharesField(l.field, field)).slice(0, SAME_FIELD_LOOKS)];
}

const describe = (l: Look): string => `${l.field ? `[${l.field}] ` : ""}${l.brand.toUpperCase()} ${l.mode}, ${l.shell} frame, ${l.font} type, ${l.radius} corners, ${l.surface} surfaces, hero ${l.hero}, ${l.charts} charts, ${l.imagery} pictures, ${l.neutral} greys, ${l.chrome} bar, ${l.mark} mark${l.mood ? ` ("${l.mood}")` : ""}`;

/** What the design step is told about recent projects. */
export function lookBrief(recent: Look[], field = ""): string {
  if (!recent.length) return "";
  const kin = recent.filter((l) => sharesField(l.field, field)).length;
  return [
    "Looks of the most recent other projects (newest first, then older ones in this product's field). This product must not look like any of them:",
    ...recent.map((l, i) => `${i + 1}. ${describe(l)}`),
    ...(kin ? [`${kin} of them ${kin === 1 ? "is" : "are"} in this product's own field (${field}). Those took the field's obvious looks first, so this one must find what makes THIS product different from them, from its own users and requirements, rather than the field's next-most-obvious look.`] : []),
    `Differ from each in at least ${MIN_LOOK_GAP} points (a different colour family counts 2; each of mode, frame, type, corners, surfaces, hero, charts, pictures, greys, bar and mark counts 1; type is the body and heading pair). Let the product reading decide where to differ, not chance.`,
  ].join("\n");
}

/** A look too close to a recent project's. */
export function lookRepeats(theme: DesignTheme, recent: Look[]): Problem[] {
  const me = lookOf("new", theme);
  return recent.flatMap((l, i) => {
    const { gap, same } = lookGap(me, l);
    return gap >= MIN_LOOK_GAP ? [] : [{ check: "design-look-repeat", message: `The look is too close to recent project ${i + 1} (${describe(l)}): it differs by ${gap} of the ${MIN_LOOK_GAP} points needed and shares ${same.join(", ")}. Change what this product's reading calls for (frame, type, corners, surfaces, hero, charts, pictures, greys, bar, mark or colour family).` }];
  });
}

/** The theme follows from the product reading: it has one, and its frame suits the device the product is used on. */
export function readingFit(theme: DesignTheme | undefined): Problem[] {
  if (!theme) return [];
  const r = theme.reading;
  if (!r) return [{ check: "design-no-reading", message: 'The theme has no "reading". Read the product from the requirements first (users, context, device, tone, hero moment, traits) and choose every part of the look from it.' }];
  const bad: Problem[] = [];
  if (r.device === "phone" && (theme.shell === "sidebar" || theme.shell === "topbar")) bad.push({ check: "design-reading-mismatch", message: `The reading says the product is used on a phone, but the frame is a ${theme.shell} app. Phone products use a tab bar, a drawer or a minimal frame.` });
  if (r.device === "web" && theme.shell === "tabs") bad.push({ check: "design-reading-mismatch", message: `The reading says the product is used on the web, but the frame is a bottom tab bar, which only phone apps use.` });
  return bad;
}
