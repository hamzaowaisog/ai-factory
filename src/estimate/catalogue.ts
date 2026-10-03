// The pinned task catalogue (docs/estimate-consistency.md, section 10, steps A and C). Every breakdown task has a
// kind from it; the estimator picks a size step against the kind's written definition, and code reads the hours.
// The model never invents the reference hours, so reworded requirements land on the same numbers.
// The file is versioned. No person signs it off: the status an estimate shows is computed from evidence
// (catalogue-status.ts): draft until enough builds and finished projects have measured it. The repo file is the
// root; the factory writes tuned versions of it to the ledger home (catalogue-store.ts, tune.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ComplexityFlag, SizeStep, Track } from "../contracts/estimate.js";

export { SizeStep };
/** factory tasks only: how hard the agent's work is to check (more retries), and how complete its context is */
export const VerifyGrade = z.enum(["easy", "moderate", "hard"]);
export const ContextGrade = z.enum(["complete", "partial"]);
export type VerifyGrade = z.infer<typeof VerifyGrade>;
export type ContextGrade = z.infer<typeof ContextGrade>;

const Hours = z.object({ min: z.number().positive(), max: z.number().positive() }).refine((r) => r.min <= r.max, "min must not exceed max");

export const Catalogue = z.object({
  version: z.string().min(1),
  note: z.string(),
  /** when the factory may call the catalogue measured (catalogue-status.ts); assumed placeholders until real data exists */
  calibration: z.object({
    note: z.string(),
    /** builds of this version that followed an estimate, before any factor is judged */
    minBuilds: z.number().int().positive(),
    /** finished tasks on each side of one factor comparison */
    minPerCell: z.number().int().positive(),
    /** factor comparisons needed */
    minChecks: z.number().int().positive(),
    /** a measured factor holds when it is within the catalogue's factor x or / this */
    tolerance: z.number().min(1),
    /** share of comparisons (or of projects) that must hold */
    holdShare: z.number().min(0).max(1),
    /** finished projects with real hours (the actual-hours file) before the hours are judged */
    minProjects: z.number().int().positive(),
  }),
  /** how the factory tunes itself from evidence (tune.ts): it stops inside the band, moves part way, and never far */
  tuning: z.object({
    note: z.string(),
    /** a measured value within this share of the catalogue counts as fitted: no change */
    band: z.number().min(0).max(1),
    /** the share of the way (on a ratio scale) a change moves toward the measured value */
    step: z.number().gt(0).max(1),
    /** the largest change of one value in one version, as a share */
    cap: z.number().gt(0).max(1),
    /** a value never goes below floor x or above ceiling x the repo catalogue's value */
    floor: z.number().gt(0).max(1),
    ceiling: z.number().min(1),
  }),
  /** a tuned version's multiplier on every kind's hours, measured from finished projects; 1 in the repo file */
  hoursScale: z.number().positive().optional(),
  /** a tuned version: the version it was made from, and why (tune.ts). The repo file has none. */
  tuned: z.object({
    parent: z.string(),
    at: z.string(),
    builds: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    changes: z.array(z.object({ path: z.string(), from: z.number(), to: z.number(), measured: z.number(), evidence: z.number().int(), limited: z.enum(["cap", "bound"]).optional() })),
    /** values that kept hitting a limit: likely a wording problem in the kind's scale, not a numbers problem */
    flagged: z.array(z.string()),
  }).optional(),
  sizes: z.record(SizeStep, z.number().positive()),
  /** multipliers code applies on top of the size: the task's complexity flag, its screen's UI level, and the factory grades */
  factors: z.object({
    complexity: z.record(ComplexityFlag, z.number().positive()),
    ui: z.record(z.enum(["simple", "moderate", "complex"]), z.number().positive()),
    verify: z.record(VerifyGrade, z.number().positive()),
    context: z.record(ContextGrade, z.number().positive()),
  }),
  /** a factory task sized above this many hours (max) is advised to be split before the build */
  splitAboveHours: z.number().positive(),
  kinds: z.array(z.object({
    id: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
    title: z.string().min(1),
    /** hours at the typical size, per track the kind can sit on */
    hours: z.partialRecord(Track, Hours),
    /** complexity flags this kind's hours already include, so the flag's factor is not applied again */
    covers: z.array(ComplexityFlag).optional(),
    /** what each size step means for this kind, so the estimator counts against a written definition */
    scale: z.record(SizeStep, z.string().min(1)),
  })).min(1),
  /** per-stack factors on a kind's hours; a stack is picked when one of its patterns matches the stack priced */
  stacks: z.record(z.string(), z.object({ match: z.array(z.string()).optional(), note: z.string(), factors: z.record(z.string(), z.number().positive()).optional() })),
}).superRefine((c, ctx) => {
  const ids = c.kinds.map((k) => k.id);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) ctx.addIssue({ code: "custom", path: ["kinds"], message: `kind ${id} is listed twice` });
  for (const [name, s] of Object.entries(c.stacks)) {
    for (const k of Object.keys(s.factors ?? {})) if (!ids.includes(k)) ctx.addIssue({ code: "custom", path: ["stacks", name, "factors"], message: `unknown kind ${k}` });
  }
});
export type Catalogue = z.infer<typeof Catalogue>;
/** what an estimate says about the catalogue it was sized from, computed from evidence (catalogue-status.ts) */
export const CatalogueStatus = z.enum(["draft", "calibrated-factors", "calibrated-hours"]);
export type CatalogueStatus = z.infer<typeof CatalogueStatus>;
export type Kind = Catalogue["kinds"][number];

const FILE = join(dirname(fileURLToPath(import.meta.url)), "assets", "catalogue.json");
let cached: Catalogue | undefined;

/** The catalogue in the repo. Read once; a broken file throws, because no estimate can be sized without it. */
export function loadCatalogue(file = FILE): Catalogue {
  if (file === FILE && cached) return cached;
  const c = Catalogue.parse(JSON.parse(readFileSync(file, "utf8")));
  if (file === FILE) cached = c;
  return c;
}

export const kindById = (c: Pick<Catalogue, "kinds">, id: string | undefined): Kind | undefined => (id ? c.kinds.find((k) => k.id === id) : undefined);

/** Why a task's kind does not fit; undefined when it does. */
export function kindProblem(c: Pick<Catalogue, "kinds">, t: { id: string; track: Track; kind?: string | undefined }): string | undefined {
  if (!t.kind) return `${t.id} has no kind`;
  const k = kindById(c, t.kind);
  if (!k) return `${t.id} has kind "${t.kind}", which is not in the catalogue`;
  if (!k.hours[t.track]) return `${t.id} is kind ${k.id} on track ${t.track}, but ${k.id} is for ${Object.keys(k.hours).join(", ")}`;
  return undefined;
}

/** The catalogue as the breakdown and the estimator read it: one line per kind, its tracks and what each size means. */
export function catalogueText(c: Pick<Catalogue, "kinds">, withScale = false): string {
  return c.kinds.map((k) => {
    const head = `- ${k.id} (${Object.keys(k.hours).join(", ")}): ${k.title}`;
    return withScale ? `${head}\n    ${SizeStep.options.map((s) => `${s}: ${k.scale[s]}`).join("; ")}` : head;
  }).join("\n");
}
