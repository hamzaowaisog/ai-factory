// The research behind a new look, the same on every design engine (claude, openai, stitch): the field's real products with the
// colours their live sites show today, the check values taken from them, the factory's latest other looks, and the ui-ux-pro-max
// skill's design system for the field. The engines differ in who draws, not in what the look stands on.
import type { ResolvedSection } from "../context/pack.js";
import { briefFor, fieldOf, pickIndustries } from "./refs/index.js";
import { fitRefs, type FitRefs } from "./refs/fit.js";
import { ensureMeasured } from "./refs/measure.js";
import { lookKey, recentLooks, type Look } from "./looks.js";
import { uiuxSection } from "./uiux-skill.js";

export interface LookResearch {
  /** the field's products as the briefing lists them */
  brief: string;
  /** the same products as the colour check reads them */
  refs: FitRefs;
  field: string;
  /** the factory's latest other looks; empty when the look is not compared with them */
  recent: Look[];
  /** the ui-ux-pro-max design system for the field, when the look is new and the skill ran */
  uiux?: ResolvedSection;
}

export interface ResearchFor {
  projectName?: string | undefined; runId: string;
  /** the look comes from the field's products (no existing app, no client reference that sets it): their live sites are read first */
  byField: boolean;
  /** the look is compared with the factory's latest other products */
  compare: boolean;
  /** the look is new and its own (not restyled, not an approved one carried on): the skill's design system is added */
  fresh: boolean;
  log?: (line: string) => void;
}

export async function lookResearch(reqText: string, o: ResearchFor): Promise<LookResearch> {
  // read the live sites of the field's brands first (best effort), so the brief and the colour check use real colours
  if (o.byField) await ensureMeasured(pickIndustries(reqText).map((x) => x.industry.id)).catch(() => undefined);
  const field = fieldOf(reqText);
  const uiux = await uiuxSection(reqText, o.projectName ?? "", o.fresh);
  if (uiux.note) o.log?.(uiux.note);
  return {
    brief: briefFor(reqText), refs: fitRefs(reqText), field,
    recent: o.compare ? recentLooks(lookKey(o.projectName, o.runId), undefined, field) : [],
    ...(uiux.section ? { uiux: uiux.section } : {}),
  };
}
