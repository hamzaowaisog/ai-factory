// `factory estimate` flags -> the run settings recorded on run.created (docs/estimates-design.md, "Inputs":
// stack source, Design in total, feedback rounds, optional rates). Every new estimate is solely agentic; HITL
// estimates made before stay readable. Everything is checked
// before a run exists, so a typo costs nothing.
import type { RunInfo } from "../ledger/state.js";

export interface EstimateOptions {
  stackSource: string;
  designInTotal: boolean;
  feedbackRounds: string;
  rate?: string[];
  repo: boolean;
  client?: string;
  projectName?: string;
  pm?: string;
  /** a person answers the clarify questions and approves the estimate; on by default, false only for an explicit hands-off run */
  review?: boolean;
}

export const RATE_KEYS = ["backend", "mobile", "web", "qa", "design", "gd", "pm", "pdm", "default"] as const;

export function parseRates(specs: string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of specs) {
    const m = /^([a-z]+)=(\d+(?:\.\d+)?)$/.exec(spec.trim());
    if (!m || !(RATE_KEYS as readonly string[]).includes(m[1]!)) throw new Error(`Can't read --rate "${spec}". Use track=dollars, with the track one of ${RATE_KEYS.join(", ")} (for example backend=55).`);
    const v = Number(m[2]);
    if (!(v > 0)) throw new Error(`--rate ${m[1]} must be more than 0.`);
    out[m[1]!] = v;
  }
  return out;
}

export function parseEstimateSettings(o: EstimateOptions): NonNullable<RunInfo["estimate"]> {
  if (o.stackSource !== "client" && o.stackSource !== "folio3" && o.stackSource !== "undecided") throw new Error(`--stack-source must be client, folio3 or undecided, not "${o.stackSource}".`);
  const rounds = Number(o.feedbackRounds);
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 10) throw new Error("--feedback-rounds must be a whole number from 0 to 10.");
  const rates = parseRates(o.rate);
  return {
    deliveryModel: "agentic", stackSource: o.stackSource, designInTotal: o.designInTotal, feedbackRounds: rounds,
    ...(Object.keys(rates).length ? { rates } : {}),
    ...(o.repo ? {} : { noRepo: true }),
    ...(o.client ? { client: o.client } : {}), ...(o.projectName ? { projectName: o.projectName } : {}), ...(o.pm ? { pm: o.pm } : {}),
    humanReview: o.review !== false,
  };
}

/**
 * Whether a person reviews this run: answers the clarify questions and approves the estimate (E7). Only an estimate
 * run can go hands-off; one started before the switch (no `humanReview` recorded) keeps its reviews.
 */
export function humanReview(info: Pick<RunInfo, "mode" | "estimate">): boolean {
  return info.mode !== "estimate" || info.estimate?.humanReview !== false;
}
