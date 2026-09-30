// Work-size band and uncertainty grade, from counted units (docs/estimates-design.md, "Size measurement").
import type { ComplexityFlag, SizeBand, Uncertainty } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./assumptions.js";

export interface Units {
  requirements: number;
  features: number;
  screens: number;
  endpoints: number;
  integrations: number;
  platforms: number;
  /** complexity flag of each counted unit or task */
  flags: ComplexityFlag[];
}

const ORDER: SizeBand[] = ["XS", "S", "M", "L", "XL"];

/** Band from the counts alone, before the complexity bump. */
export function baseBand(u: Units, a: Assumptions = DEFAULT_ASSUMPTIONS): SizeBand {
  const b = a.bands;
  if (u.features > b.l.maxFeatures || u.platforms > b.l.maxPlatforms) return "XL";
  if (u.features > b.m.maxFeatures || u.integrations > b.m.maxIntegrations || (u.platforms > 1 && u.features > b.s.maxFeatures)) return "L";
  if (u.features > b.s.maxFeatures || (u.integrations >= 1 && u.features > 1)) return "M";
  if (u.requirements <= b.xs.maxRequirements && u.features <= b.xs.maxFeatures && u.screens <= b.xs.maxScreens && u.integrations === 0) return "XS";
  return "S";
}

/** Band including the bump for a large share of non-standard units. */
export function bandFor(u: Units, a: Assumptions = DEFAULT_ASSUMPTIONS): SizeBand {
  const base = baseBand(u, a);
  const share = u.flags.length ? u.flags.filter((f) => f !== "standard").length / u.flags.length : 0;
  if (share >= a.bands.complexityBumpShare && base !== "XL") return ORDER[ORDER.indexOf(base) + 1]!;
  return base;
}

export type Grade = "missing" | "vague" | "adequate" | "precise";
export interface InputGrades {
  scopeClarity: Grade;
  designAvailability: Grade;
  technicalContext: Grade;
  codeAccess: Grade;
  constraintsKnown: Grade;
}

const POINTS: Record<Grade, number> = { missing: 0, vague: 1, adequate: 2, precise: 3 };

/** Internal uncertainty grade from input quality; the mean grade decides (it stays off the client sheet). */
export function uncertaintyFor(g: InputGrades): Uncertainty {
  const vals = (Object.values(g) as Grade[]).map((x) => POINTS[x]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  // a missing scope is never low uncertainty, whatever the rest looks like
  if (g.scopeClarity === "missing" || mean < 1.25) return "high";
  return mean < 2.25 ? "medium" : "low";
}
