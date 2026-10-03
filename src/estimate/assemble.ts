// Turns the estimators' proposals (anchors, ratios, reasons) into a full Estimate. The model proposed
// every number it is allowed to propose; everything here is arithmetic, so the same proposals always
// give the same estimate (docs/estimates-design.md, "How the hours are built").
import { Estimate, type ArtifactHeader, type Breakdown, type DeliveryModel, type Executor, type SizeBand, type SizeStep, type SpecDraft, type StackChoice, type Track } from "../contracts/index.js";
import type { z } from "zod";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";
import { estimateApiCost, type BenchmarkRecord } from "./cost.js";
import { taskDurations, type TaskRecord } from "./durations.js";
import { gateHours, prCount } from "./gate-hours.js";
import { loadRoundsPrior, withPrior } from "./priors.js";
import { sizeTasks, type AnchorIn, type RatioIn } from "./hours.js";
import { bandFor, uncertaintyFor, type InputGrades, type Units } from "./size.js";
import type { ContextGrade, VerifyGrade } from "./catalogue.js";
import { computeTotals, criticalPath, elapsedDays } from "./totals.js";

type Body = Pick<Breakdown, "features" | "tasks">;

/** What one estimator returns: reference tasks estimated in detail, and a ratio to an anchor for every task. */
export interface Proposal {
  anchors: { taskId: string; hours: Range; reason: string }[];
  tasks: { taskId: string; anchorId: string; ratio: number; reason: string; size?: SizeStep; verify?: VerifyGrade; context?: ContextGrade }[];
  /** the stack the estimator priced (proposals made before it was asked for have none) */
  stack?: StackChoice;
}

export interface EstimateSettings {
  deliveryModel: DeliveryModel;
  stackSource: "client" | "folio3" | "undecided";
  designInTotal: boolean;
  feedbackRounds: number;
  /** optional hourly rates (USD) per track, plus "default" for cross-cutting time; turns on the team file's cost overlay */
  rates?: Partial<Record<Track | "default", number>>;
}
export const DEFAULT_SETTINGS: EstimateSettings = { deliveryModel: "hitl", stackSource: "undecided", designInTotal: true, feedbackRounds: 2 };

const CLIENT_TRACKS = new Set(["mobile", "web"]);

/** Counted units, from the breakdown and the spec (no model judgement). */
export function unitsFrom(spec: Pick<SpecDraft, "requirements">, b: Body): Units {
  const live = b.tasks.filter((t) => !t.overhead);
  return {
    requirements: spec.requirements.filter((r) => r.op !== "REMOVED").length,
    features: b.features.length,
    screens: new Set(b.tasks.map((t) => t.screen).filter(Boolean)).size,
    endpoints: live.filter((t) => t.track === "backend").length,
    integrations: live.filter((t) => t.complexity === "external-dependency").length,
    platforms: Math.max(1, new Set(live.map((t) => t.track).filter((t) => CLIENT_TRACKS.has(t))).size),
    flags: live.map((t) => t.complexity),
  };
}

export const bandOf = (spec: Pick<SpecDraft, "requirements">, b: Body, a: Assumptions = DEFAULT_ASSUMPTIONS): SizeBand => bandFor(unitsFrom(spec, b), a);

/** Three independent estimators for every band, merged by median (docs/estimate-consistency.md, section 10, step D). */
export const estimatorsFor = (_band: SizeBand): 3 => 3;

export function gradeInputs(i: { assumptions: number; requirements: number; uiTasks: number; uiTasksWithScreen: number; hasRepo: boolean; stackSource: EstimateSettings["stackSource"] }): InputGrades {
  const share = i.requirements ? i.assumptions / i.requirements : 0;
  return {
    scopeClarity: share === 0 ? "precise" : share <= 0.25 ? "adequate" : share <= 0.5 ? "vague" : "missing",
    designAvailability: i.uiTasks === 0 ? "adequate" : i.uiTasksWithScreen === i.uiTasks ? "precise" : i.uiTasksWithScreen > 0 ? "vague" : "missing",
    technicalContext: i.stackSource === "client" ? "precise" : i.stackSource === "folio3" ? "adequate" : "vague",
    codeAccess: i.hasRepo ? "precise" : "missing",
    constraintsKnown: "adequate",
  };
}

export interface AssembleInput {
  header: ArtifactHeader;
  breakdown: Body;
  breakdownSha: string;
  spec: Pick<SpecDraft, "requirements">;
  specSha: string;
  proposals: Proposal[];
  settings: EstimateSettings;
  grades: InputGrades;
  /** clarify questions answered, critic findings on the card, minutes the planning phase took */
  counts: { questions: number; criticFindings: number; planningMinutes: number };
  assumptions: string[];
  records?: BenchmarkRecord[];
  /** per-task-class records of earlier builds (durations.ts); without them factory tasks keep their sized hours as duration */
  taskRecords?: TaskRecord[];
  /** the approved estimate this one revises, or the sibling delivery model's */
  parentEstimate?: string;
  /** the task catalogue the proposals were built from (catalogue sizing); absent for anchor sizing */
  catalogue?: NonNullable<Estimate["catalogue"]>;
  a?: Assumptions;
}

function check(p: Proposal, b: Body, who: string): void {
  const ids = new Set(b.tasks.map((t) => t.id));
  const seen = new Set<string>();
  for (const t of p.tasks) {
    if (!ids.has(t.taskId)) throw new Error(`${who}: ${t.taskId} is not in the breakdown`);
    if (seen.has(t.taskId)) throw new Error(`${who}: ${t.taskId} is sized twice`);
    seen.add(t.taskId);
  }
  for (const id of ids) if (!seen.has(id)) throw new Error(`${who}: ${id} has no size`);
  if (p.anchors.length === 0) throw new Error(`${who}: no anchors`);
  for (const a of p.anchors) {
    if (!ids.has(a.taskId)) throw new Error(`${who}: anchor ${a.taskId} is not in the breakdown`);
    if (!(a.hours.min >= 0) || a.hours.min > a.hours.max) throw new Error(`${who}: anchor ${a.taskId} has a bad range`);
    const own = p.tasks.find((t) => t.taskId === a.taskId);
    if (own?.anchorId !== a.taskId || own.ratio !== 1) throw new Error(`${who}: anchor ${a.taskId} must be sized against itself at ratio 1`);
  }
}

const ratios = (p: Proposal, exec: Map<string, Executor>): RatioIn[] => p.tasks.map((t) => ({ ...t, executor: exec.get(t.taskId)! }));
const anchorsIn = (p: Proposal): AnchorIn[] => p.anchors.map((x) => ({ taskId: x.taskId, hours: x.hours }));

/** Build the estimate. Throws a readable Error when a proposal is not usable (the step turns it into a retry). */
export function assembleEstimate(i: AssembleInput): z.infer<typeof Estimate> {
  const a = i.a ?? DEFAULT_ASSUMPTIONS;
  const b = i.breakdown;
  if (i.proposals.length === 0) throw new Error("no estimator proposals");
  i.proposals.forEach((p, n) => check(p, b, `estimator ${n + 1}`));
  const exec = new Map(b.tasks.map((t) => [t.id, t.executor]));

  // the first estimator is the lead: its anchors, ratios and reasons stand; the others are readings merged with it by median
  const [lead, ...others] = i.proposals as [Proposal, ...Proposal[]];
  const readings = others.map((p) => new Map(sizeTasks(anchorsIn(p), ratios(p, exec), a).map((s) => [s.taskId, s.hours])));
  const tasks = sizeTasks(anchorsIn(lead), ratios(lead, exec).map((r) => ({ ...r, estimators: readings.map((m) => m.get(r.taskId)!) })), a);

  // split rule (docs/estimate-consistency.md, section 10): agent work this big fails and retries more, so it is split before the build
  const split = i.catalogue?.splitAboveHours;
  if (split) for (const t of tasks) if (t.executor !== "human" && (t.size === "very-large" || t.hours.max > split)) t.splitAdvised = true;

  const units = unitsFrom(i.spec, b);
  const factory = tasks.filter((t) => t.executor === "factory").length;
  const highRisk = b.tasks.filter((t) => t.executor === "factory" && t.complexity === "compliance-sensitive").length;
  const prs = prCount(factory, a);
  const high = Math.min(prs, Math.ceil(highRisk / Math.max(1, a.tasksPerPr)));
  const gates = gateHours(i.settings.deliveryModel, {
    questions: i.counts.questions, approvalSections: units.requirements + i.counts.criticFindings,
    prs: { low: prs - high, medium: 0, high }, factoryTasks: factory, waivers: 0,
  }, a);

  const totals = computeTotals(b.tasks, tasks, [], gates, i.settings.designInTotal);
  const { duration: dur, basis } = taskDurations(b.tasks, tasks, i.taskRecords ?? [], a);
  const queue = gates.filter((g) => g.source === "Lead PR review").reduce((s, g) => s + g.hours.max, 0);
  const apiCost = estimateApiCost({
    planning: 1, design: units.screens > 0 ? 1 : 0, "breakdown-estimate": 1, build: factory, verification: factory,
  }, i.records ?? [], i.settings.deliveryModel, a);

  return Estimate.parse({
    header: i.header,
    deliveryModel: i.settings.deliveryModel,
    band: bandFor(units, a),
    uncertainty: uncertaintyFor(i.grades),
    breakdownSha: i.breakdownSha,
    specSha: i.specSha,
    ...(i.parentEstimate ? { parentEstimate: i.parentEstimate } : {}),
    anchors: lead.anchors,
    tasks,
    merge: "median",
    ...(i.catalogue ? { catalogue: i.catalogue } : {}),
    overheads: [],
    gateHours: gates,
    totals,
    apiCost,
    elapsed: { planningMinutes: Math.round(i.counts.planningMinutes), criticalPathDays: elapsedDays(criticalPath(b.tasks, (id) => dur.get(id)!), queue, a), ...(basis ? { basis: withPrior(basis, loadRoundsPrior()) } : {}) },
    ...(lead.stack ? { stack: lead.stack } : {}),
    settings: { stackSource: i.settings.stackSource, designInTotal: i.settings.designInTotal, feedbackRounds: i.settings.feedbackRounds },
    scenarios: [],
    suggested: [],
    assumptions: [...i.assumptions, ...(tasks.some((t) => t.splitAdvised) ? [`Split before the build: ${tasks.filter((t) => t.splitAdvised).map((t) => t.taskId).join(", ")} (agent work over ${split} h or very large is split into smaller tasks; the hours stay as estimated).`] : [])],
  });
}
