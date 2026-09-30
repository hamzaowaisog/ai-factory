// Human gate time in the HITL model, computed from counts (never per-task confirmation).
// The solely agentic model has no supervisor gates, so it returns nothing; client UAT, design
// approval and PM are ordinary human tasks in the breakdown, in both models.
import type { DeliveryModel, Track } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";

export interface GateCounts {
  /** clarify questions expected across the run */
  questions: number;
  /** sections on the approval card (requirements, files listed, critic findings) */
  approvalSections: number;
  /** PRs by risk class: auth, payments, personal data and migrations weigh more */
  prs: { low: number; medium: number; high: number };
  /** tasks that go through the factory */
  factoryTasks: number;
  /** waivers expected (zero by default) */
  waivers: number;
}

export interface GateLine { source: string; track?: Track; hours: Range; assumed: true }

const h = (minutes: Range, n: number): Range => ({ min: round(minutes.min * n / 60), max: round(minutes.max * n / 60) });
const round = (n: number): number => Math.round(n * 100) / 100;

/** PRs from grouping tasks: fewer, larger PRs shorten the queue and lengthen each review. */
export function prCount(factoryTasks: number, a: Assumptions = DEFAULT_ASSUMPTIONS): number {
  return factoryTasks <= 0 ? 0 : Math.ceil(factoryTasks / Math.max(1, a.tasksPerPr));
}

export function gateHours(model: DeliveryModel, c: GateCounts, a: Assumptions = DEFAULT_ASSUMPTIONS): GateLine[] {
  if (model === "agentic") return [];
  const g = a.gates;
  const lines: GateLine[] = [
    { source: "Clarify answers", hours: h(g.clarifyMinutesPerQuestion, c.questions), assumed: true },
    { source: "Approval card reading", hours: h(g.approvalMinutesPerSection, c.approvalSections), assumed: true },
    { source: "Lead PR review", track: "backend",
      hours: minutesToHours({
        min: g.prReviewMinutes.low.min * c.prs.low + g.prReviewMinutes.medium.min * c.prs.medium + g.prReviewMinutes.high.min * c.prs.high,
        max: g.prReviewMinutes.low.max * c.prs.low + g.prReviewMinutes.medium.max * c.prs.medium + g.prReviewMinutes.high.max * c.prs.high,
      }),
      assumed: true },
    { source: "Parked runs", hours: h(
        { min: g.parkedInterventionMinutes.min * g.parkedRunRate.min, max: g.parkedInterventionMinutes.max * g.parkedRunRate.max }, c.factoryTasks),
      assumed: true },
  ];
  if (c.waivers > 0) lines.push({ source: "Waivers", hours: h(g.waiverMinutes, c.waivers), assumed: true });
  return lines;
}

function minutesToHours(m: Range): Range {
  return { min: round(m.min / 60), max: round(m.max / 60) };
}
