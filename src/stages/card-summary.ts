// The plain-language top of a guided run's cards (src/stages/review-cards.ts, and the plan card): built by code from what the
// steps already wrote, with no model call. The technical part follows under DETAIL, which `factory show-card` leaves out
// unless --full and the run page keeps folded.
import type { Spec } from "../contracts/index.js";
import { currentCostCap } from "../ledger/caps.js";
import type { RunState } from "../ledger/state.js";
import type { clarifications } from "./clarify.js";

export const DETAIL = "## Technical detail";
const DECIDE = "## Decide";

/** How a criterion of each level is checked, in a reader's words. */
const CHECKED: Record<string, string> = { ui: "a screen test", api: "an API test", job: "a background-job test", unit: "an automated code test", manual: "a person checks it" };

type Clar = ReturnType<typeof clarifications>;

/** The request point by point, the answers given and the assumptions made. */
export function understoodLines(spans: { text: string }[], clar: Clar): string[] {
  return [
    `## What you asked for`,
    ...spans.map((s) => `- ${s.text}`),
    ...(clar.answers.length ? [``, `## Your answers`, ...clar.answers.map((q) => `- ${q.question} → **${q.answer}**${q.by === "default" || q.by === "default-timeout" ? " (the default: nobody answered)" : ""}`)] : []),
    ...(clar.assumptions.length ? [``, `## What I assumed`, ...clar.assumptions.map((x) => `- ${x.text}${x.risk === "high" ? "  ← check this one: getting it wrong is costly" : ""}`)] : []),
  ];
}

/** One line per requirement: what it says and how it will be checked; then what is left out. */
export function requirementSummary(spec: Pick<Spec, "requirements" | "outOfScope">, apiSide: string[] = []): string[] {
  return [
    `## What will be built (${spec.requirements.length} requirement${spec.requirements.length === 1 ? "" : "s"})`,
    ...spec.requirements.map((r) => `- ${r.ears} Checked by: ${[...new Set(r.acceptance.map((c) => CHECKED[c.level] ?? c.level))].join(", ") || "nothing yet"}. (${r.id})`),
    ``,
    `## Left out`,
    ...(spec.outOfScope.length ? spec.outOfScope.map((o) => `- ${o}`) : [`- (nothing listed)`]),
    ...(apiSide.length ? [`- Checked on the API side of this product, not in this run: ${apiSide.join(", ")}`] : []),
  ];
}

/** Each plan task with the requirements it delivers, in their own words. */
export function taskSummary(tasks: { id: string; title: string; reqs: string[] }[], spec: Pick<Spec, "requirements">, screens: string[] = []): string[] {
  const ears = new Map(spec.requirements.map((r) => [r.id, r.ears]));
  return [
    `## How it will be built (${tasks.length} task${tasks.length === 1 ? "" : "s"})`,
    ...tasks.flatMap((t) => [`- **${t.title}** (${t.id})`, ...t.reqs.filter((id) => ears.has(id)).map((id) => `  - ${ears.get(id)}`)]),
    ...(screens.length ? [``, `Screens (${screens.length}): ${screens.join(", ")}`] : []),
  ];
}

/** What the run has spent and its limit. There is no forecast of what a build will cost to finish. */
export const spendLine = (state: RunState): string => `Spent so far: $${state.costUsd.toFixed(2)} of a $${currentCostCap(state).toFixed(2)} limit.`;

/** What a person should know before deciding; empty when there is nothing. */
export function riskLines(open: string[], settled: string[], clar: Clar): string[] {
  const high = clar.assumptions.filter((x) => x.risk === "high").map((x) => `Assumed, and costly if wrong: ${x.text}`);
  const all = [...open.map((o) => `Still open: ${o}`), ...settled, ...high];
  return all.length ? [`## Open risks and decisions`, ...all.map((x) => `- ${x}`)] : [];
}

/** A card with its plain top first: the summary, then the technical part under DETAIL. */
export const withSummary = (summary: string[], technical: string): string => [...summary, ``, DETAIL, ``, technical].join("\n");

/** A card as `factory show-card` prints it: without the technical part unless `full`. A card with no such part prints whole. */
export function cardView(markdown: string, full: boolean): string {
  const from = markdown.indexOf(`\n${DETAIL}\n`);
  if (full || from < 0) return markdown;
  const to = markdown.indexOf(`\n${DECIDE}\n`, from);
  return `${markdown.slice(0, from)}\n\n(The technical detail is left out: factory show-card <run> --full)\n${to < 0 ? "" : markdown.slice(to)}`;
}
