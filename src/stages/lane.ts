// The light lane: a small, low-risk change gets a smaller, cheaper pipeline (one spec draft, one
// rework, a lighter critic, a Sonnet test writer with tight limits). Everything else keeps the
// full lane. Decided from intake (before the plan) and the plan's size (after it).
import type { z } from "zod";
import { readsRequirements, type IntentBody } from "../contracts/index.js";

type Intent = Pick<z.infer<typeof IntentBody>, "risk" | "rigor" | "changeClass">;

/**
 * Spec side: a bug fix that isn't high risk, or low risk with light rigor. A medium-risk bug fix ("double booking")
 * took the full lane on a real run: three drafts and three critic repairs, $3.40 of a $6 cap before any code.
 */
export function lightSpec(intent: Intent): boolean {
  return (intent.changeClass === "bugfix" && intent.risk !== "high") || (intent.risk === "low" && intent.rigor === "light");
}

/** Build side: the spec side is light and the plan is small. */
export function lightBuild(intent: Intent, complexity: string | undefined): boolean {
  return lightSpec(intent) && complexity === "S";
}

/**
 * A small UI fix in an app of its own (PR #11 review, item 9): the light spec lane, an app whose look is already there, no
 * attached frames or design references, no earlier design to change, and at most a few requirements. It gets a text design
 * note approved with the estimate, not a drawn demo, screenshots and a card of its own.
 */
export function lightUi(intent: Intent, o: { existingLook: boolean; frames: number; references: number; earlierDesign: boolean; reqs: number; off?: boolean }): boolean {
  return !o.off && lightSpec(intent) && o.existingLook && !o.frames && !o.references && !o.earlierDesign && o.reqs <= LIGHT_UI_REQS;
}
export const LIGHT_UI_REQS = 3;

/** Limits per lane. The full lane is what every run used before the light lane existed. */
export const LANE = {
  light: { drafts: 1, maxRepairs: 1, criticEffort: "medium" as const, groundTurns: 8, testWriterTurns: 25, testWriterTurnsApi: 40, maxCharacterisation: 2 },
  full: { drafts: 3, maxRepairs: 3, criticEffort: undefined, groundTurns: 12, testWriterTurns: 60, testWriterTurnsApi: 60, maxCharacterisation: undefined },
  /** an estimate or design run: no tests are written from its criteria, so one draft and one repair */
  requirements: { drafts: 1, maxRepairs: 1, criticEffort: "medium" as const },
};

/**
 * The spec side's limits for a run. An estimate or design run takes the requirements lane: three drafts, a merge and three
 * repairs on one module of three cost $7 and 22 min on the 2026-10-05 run (86 requirements written four times over).
 * A small, low-risk change keeps the light lane (a Sonnet drafter) in any mode.
 */
export function specLane(intent: Intent, mode: string | undefined): { drafts: number; maxRepairs: number; criticEffort: "medium" | undefined; name: "light" | "full" | "requirements" } {
  if (lightSpec(intent)) return { ...LANE.light, name: "light" };
  return readsRequirements(mode) ? { ...LANE.requirements, name: "requirements" } : { ...LANE.full, name: "full" };
}

/**
 * The test writer's turn limit. Unit tests call a class directly; api and job tests also need the
 * test host and fixtures found and wired up, which took more than 25 turns on a real repo.
 */
export function testWriterTurns(light: boolean, levels: string[]): number {
  const lane = light ? LANE.light : LANE.full;
  return levels.some((l) => l === "api" || l === "job") ? lane.testWriterTurnsApi : lane.testWriterTurns;
}

/**
 * Size by the change, not by how the planner split it: a 14-line fix split into 3 tasks was "M" and took the full
 * build lane (60 test-writer turns, no characterisation limit; the 2026-10-04 run). Files are the union of the tasks'
 * scopes; a glob counts as 3 files.
 */
// ponytail: a glob's real file count is unknown here; counting it as 3 keeps one narrow glob "S", widen if plans scope wider
export function complexityOf(plan: { tasks: { fileScope: string[]; plannedLoc: number }[] }): "S" | "M" | "L" {
  const loc = plan.tasks.reduce((n, t) => n + t.plannedLoc, 0);
  const scopes = [...new Set(plan.tasks.flatMap((t) => t.fileScope))];
  const files = scopes.reduce((n, g) => n + (/[*?[{]/.test(g) ? 3 : 1), 0);
  if (loc <= 150 && files <= 6) return "S";
  if (loc <= 600 && files <= 20) return "M";
  return "L";
}
