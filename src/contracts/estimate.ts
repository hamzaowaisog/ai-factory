// Estimate-mode artifacts (docs/estimates-design.md, "Fit with the code"). The model proposes the
// breakdown and the sizing reasons; code computes every sum, so totals here are stored, never trusted (gate E6).
import { z } from "zod";
import { Id, Sha, Complexity } from "./common.js";
import { ArtifactHeader } from "./artifacts.js";

const withHeader = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ header: ArtifactHeader, ...shape });

/** Estimate task ids look like EST-12. */
export const EstimateTaskId = z.string().regex(/^EST-\d+$/, "EST-<number>");

export const DeliveryModel = z.enum(["hitl", "agentic"]);
export type DeliveryModel = z.infer<typeof DeliveryModel>;

/** Sheets of the general estimation template a task can land in. */
export const Track = z.enum(["backend", "mobile", "web", "qa", "design", "gd", "pm", "pdm"]);
export type Track = z.infer<typeof Track>;

/** factory: the factory does it, humans only at gates; joint: mixed; human: full human hours. */
export const Executor = z.enum(["factory", "joint", "human"]);
export type Executor = z.infer<typeof Executor>;

export const SizeBand = z.enum(["XS", "S", "M", "L", "XL"]);
export type SizeBand = z.infer<typeof SizeBand>;

export const Uncertainty = z.enum(["low", "medium", "high"]);
export type Uncertainty = z.infer<typeof Uncertainty>;

/** How much measured data backs a duration or cost figure. */
export const Confidence = z.enum(["cold-start", "partial", "calibrated"]);
export type Confidence = z.infer<typeof Confidence>;

export const ComplexityFlag = z.enum([
  "standard", "rules-or-algorithm", "external-dependency", "compliance-sensitive", "real-time", "new-to-stack",
]);
export type ComplexityFlag = z.infer<typeof ComplexityFlag>;

/** A task's size against its catalogue kind's written scale (src/estimate/assets/catalogue.json). */
export const SizeStep = z.enum(["small", "typical", "large", "very-large"]);
export type SizeStep = z.infer<typeof SizeStep>;

// ---------- breakdown ----------
export const BreakdownTask = z.object({
  id: EstimateTaskId,
  title: z.string().min(1),
  featureId: Id,
  /** requirement ids this task delivers; empty only for a named overhead (checked by gate E3) */
  reqs: z.array(Id),
  /** the concrete spec items it must deliver (fields, states, rules, endpoints, messages) */
  items: z.array(z.string()).default([]),
  track: Track,
  executor: Executor,
  dependsOn: z.array(EstimateTaskId).default([]),
  /** approved design screen this task builds, when there is one */
  screen: z.string().optional(),
  complexity: ComplexityFlag.default("standard"),
  /** the catalogue kind (src/estimate/assets/catalogue.json) that sizes it; absent on breakdowns made before kinds (gate E2c) */
  kind: z.string().optional(),
  /** set for an overhead task (deployment, PM, ...): the reason it has no requirement */
  overhead: z.string().optional(),
});
export type BreakdownTask = z.infer<typeof BreakdownTask>;

const BreakdownShape = {
  features: z.array(z.object({ id: Id, title: z.string().min(1), reqs: z.array(Id) })).min(1),
  tasks: z.array(BreakdownTask).min(1),
  /** forgotten-work checklist (gate E4): each generic item in, or out with a reason */
  checklist: z.array(z.object({ item: z.string(), included: z.boolean(), reason: z.string().optional() })).default([]),
};

function checkBreakdown(b: { features: { id: string }[]; tasks: BreakdownTask[] }, ctx: z.core.$RefinementCtx): void {
  const ids = new Set<string>();
  for (const [i, t] of b.tasks.entries()) {
    if (ids.has(t.id)) ctx.addIssue({ code: "custom", path: ["tasks", i, "id"], message: `duplicate task id ${t.id}` });
    ids.add(t.id);
  }
  for (const [i, t] of b.tasks.entries()) {
    for (const d of t.dependsOn) {
      if (!ids.has(d)) ctx.addIssue({ code: "custom", path: ["tasks", i, "dependsOn"], message: `${t.id} depends on unknown ${d}` });
      if (d === t.id) ctx.addIssue({ code: "custom", path: ["tasks", i, "dependsOn"], message: `${t.id} depends on itself` });
    }
  }
  for (const loop of dependencyLoops(b.tasks)) {
    const i = b.tasks.findIndex((t) => t.id === loop[0]);
    ctx.addIssue({ code: "custom", path: ["tasks", i, "dependsOn"], message: `dependency loop: ${[...loop, loop[0]].join(" -> ")}` });
  }
  const features = new Set(b.features.map((f) => f.id));
  for (const [i, t] of b.tasks.entries()) {
    if (!features.has(t.featureId)) ctx.addIssue({ code: "custom", path: ["tasks", i, "featureId"], message: `unknown feature ${t.featureId}` });
  }
}

/**
 * Dependency loops longer than one task (A -> B -> A), each once, starting at its first task in the list.
 * Self-dependencies and unknown ids are reported on their own and skipped here. A build orders tasks by
 * `dependsOn`, so a loop cannot be built.
 */
export function dependencyLoops(tasks: Pick<BreakdownTask, "id" | "dependsOn">[]): string[][] {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn.filter((d) => d !== t.id)]));
  const order = new Map(tasks.map((t, i) => [t.id, i]));
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const loops: string[][] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, "open");
    path.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === "open") {
        const loop = path.slice(path.indexOf(d));
        const first = loop.reduce((m, x, i) => (order.get(x)! < order.get(loop[m]!)! ? i : m), 0);
        const turned = [...loop.slice(first), ...loop.slice(0, first)];
        if (!seen.has(turned.join(" "))) { seen.add(turned.join(" ")); loops.push(turned); }
      } else if (!state.has(d)) visit(d);
    }
    path.pop();
    state.set(id, "done");
  };
  for (const t of tasks) if (!state.has(t.id)) visit(t.id);
  return loops;
}

/** What the model returns (its structured-output schema). */
export const BreakdownBody = z.object(BreakdownShape).superRefine(checkBreakdown);
export const Breakdown = withHeader({ ...BreakdownShape, specSha: Sha }).superRefine(checkBreakdown);
export type Breakdown = z.infer<typeof Breakdown>;

// ---------- estimate ----------
/**
 * The stack and architecture the estimate priced, as fields, so a build makes what was priced instead of choosing
 * again. `basis` says where it came from: the repo (an existing app), the request (the client named it) or an
 * assumption the estimate made. A part the work does not need is left out.
 */
export const StackChoice = z.object({
  backend: z.string().min(1).optional(),
  web: z.string().min(1).optional(),
  mobile: z.string().min(1).optional(),
  database: z.string().min(1).optional(),
  hosting: z.string().min(1).optional(),
  architecture: z.string().min(1).optional(),
  basis: z.enum(["repo", "request", "assumed"]),
  notes: z.string().optional(),
});
export type StackChoice = z.infer<typeof StackChoice>;

const Hours = z.number().nonnegative();
const Range = z.object({ min: Hours, max: Hours }).refine((r) => r.min <= r.max, "min must not exceed max");

export const Anchor = z.object({
  taskId: EstimateTaskId,
  hours: Range,
  /** why this task is a fair reference for this project's stack, design and constraints */
  reason: z.string().min(1),
});

export type Anchor = z.infer<typeof Anchor>;

export const TaskSizing = z.object({
  taskId: EstimateTaskId,
  /** the anchor this task is sized against; an anchor sizes itself */
  anchorId: EstimateTaskId,
  ratio: z.number().positive(),
  reason: z.string().min(1),
  /** code computed: anchor hours x ratio, before the estimators' spread is applied */
  hours: Range,
  executor: Executor,
  /** the lead estimator's size step, when the task was sized against the catalogue */
  size: SizeStep.optional(),
  /** a factory or joint task too big to build as one piece (very large, or over the catalogue's split threshold): split it before the build */
  splitAdvised: z.boolean().optional(),
  /** the closest tasks of earlier approved estimates the estimators were shown (Phase 2); the hours still come from the catalogue */
  references: z.array(z.object({ runId: z.string(), taskId: EstimateTaskId, size: SizeStep, hours: Range })).max(2).optional(),
  /** independent estimators' readings for M and up (spread sets the range and flags the item) */
  estimators: z.array(Range).max(3).default([]),
  flagged: z.boolean().default(false),
});

export type TaskSizing = z.infer<typeof TaskSizing>;

/** Money in API credits, as a range. */
const Usd = z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.min <= r.max, "min must not exceed max");

export const CostPhase = z.enum(["planning", "design", "breakdown-estimate", "build", "verification"]);

export const ApiCost = z.object({
  phases: z.array(z.object({ phase: CostPhase, usd: Usd })),
  total: Usd,
  confidence: Confidence,
  /** benchmark records behind the figures */
  records: z.number().int().nonnegative(),
});

export type ApiCost = z.infer<typeof ApiCost>;

export const Estimate = withHeader({
  deliveryModel: DeliveryModel,
  band: SizeBand,
  uncertainty: Uncertainty,
  complexity: Complexity.optional(),
  breakdownSha: Sha,
  specSha: Sha,
  /** the approved estimate this one revises (change request) or the sibling model's estimate */
  parentEstimate: Sha.optional(),
  anchors: z.array(Anchor).min(1),
  tasks: z.array(TaskSizing).min(1),
  /** the task catalogue the hours came from; status is computed from evidence (no person signs it off) and shown on internal views only */
  catalogue: z.object({
    version: z.string(), status: z.enum(["draft", "calibrated-factors", "calibrated-hours"]), stack: z.string(), splitAboveHours: z.number().positive().optional(),
    evidence: z.object({ builds: z.number().int().nonnegative(), checks: z.number().int().nonnegative(), held: z.number().int().nonnegative(), projects: z.number().int().nonnegative(), projectsWithin: z.number().int().nonnegative() }).optional(),
    /** a version the factory tuned itself (Phase 3): how many times, and the evidence of the last tuning */
    tuned: z.object({ generation: z.number().int().positive(), builds: z.number().int().nonnegative(), projects: z.number().int().nonnegative() }).optional(),
  }).optional(),
  /** how estimators' readings were merged: by median (2026-10-03 on); absent on older estimates, whose readings widened the range */
  merge: z.literal("median").optional(),
  overheads: z.array(z.object({ name: z.string(), track: Track.optional(), hours: Range, reason: z.string() })).default([]),
  /** human gate hours (HITL only); every figure is a labelled, editable assumption */
  gateHours: z.array(z.object({ source: z.string(), track: Track.optional(), hours: Range, assumed: z.literal(true) })).default([]),
  totals: z.object({ byTrack: z.partialRecord(Track, Range), overall: Range }),
  apiCost: ApiCost,
  elapsed: z.object({
    planningMinutes: z.number().nonnegative(),
    criticalPathDays: Range,
    /** where factory task durations came from: measured by class in the ledger, or the cold-start fallback */
    basis: z.object({
      confidence: Confidence, records: z.number().int().nonnegative(),
      byClass: z.array(z.object({ taskClass: z.string(), records: z.number().int().nonnegative(), confidence: Confidence, minutes: Range.optional(), turnsMedian: z.number().optional(), priorFlag: z.enum(["below p10", "above p90"]).optional() })),
      /** the pinned external prior these were read against (a prior to compare with, never used in the numbers) */
      prior: z.object({ source: z.string(), revision: z.string(), roundsP10: z.number(), roundsP50: z.number(), roundsP90: z.number() }).optional(),
    }).optional(),
  }),
  /** the stack and architecture priced (absent on estimates made before it was recorded) */
  stack: StackChoice.optional(),
  settings: z.object({
    stackSource: z.enum(["client", "folio3", "undecided"]),
    designInTotal: z.boolean(),
    feedbackRounds: z.number().int().nonnegative(),
  }),
  /** at most two, for one big unknown (scenario name -> what it changes) */
  scenarios: z.array(z.object({ name: z.string(), changes: z.string(), totals: Range })).max(2).default([]),
  /** extras outside the totals until the lead adds them (gate E3) */
  suggested: z.array(z.object({ title: z.string(), reason: z.string() })).default([]),
  assumptions: z.array(z.string()).default([]),
}).superRefine((e, ctx) => {
  const taskIds = new Set(e.tasks.map((t) => t.taskId));
  for (const [i, a] of e.anchors.entries()) {
    if (!taskIds.has(a.taskId)) ctx.addIssue({ code: "custom", path: ["anchors", i, "taskId"], message: `anchor ${a.taskId} is not a sized task` });
  }
  const anchors = new Set(e.anchors.map((a) => a.taskId));
  for (const [i, t] of e.tasks.entries()) {
    if (!anchors.has(t.anchorId)) ctx.addIssue({ code: "custom", path: ["tasks", i, "anchorId"], message: `${t.taskId} sized against ${t.anchorId}, which is not an anchor` });
  }
  // the solely agentic model has no supervisor gates
  if (e.deliveryModel === "agentic" && e.gateHours.length) {
    ctx.addIssue({ code: "custom", path: ["gateHours"], message: "the solely agentic model carries no supervisor gate hours" });
  }
});
export type Estimate = z.infer<typeof Estimate>;
