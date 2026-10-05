// Estimate mode, model steps: breakdown (requirements -> features -> tasks) and estimate (anchors,
// ratios, one or three independent estimators, merged by code). The model proposes; code counts,
// computes every sum and runs gates E1-E6 (docs/estimates-design.md, "How the hours are built").
import { z } from "zod";
import { BreakdownBody, BreakdownTask, IntentBody, StackChoice, type Breakdown, type Spec as SpecArtifact } from "../contracts/index.js";
import type { Failure, ScreenMock } from "../contracts/index.js";
import { failure, runGate, type GateDef } from "../gates/engine.js";
import { designUi, uiFactors } from "../estimate/ui-complexity.js";
import { consistency, forgottenWork, readiness, reqToTask, taskKind, taskToReq } from "../estimate/gates.js";
import { designCoverage } from "../design/gates.js";
import { catalogueText, type Catalogue } from "../estimate/catalogue.js";
import { catalogueAt, currentCatalogue, generationOf, rootOf } from "../estimate/catalogue-store.js";
import { loadCatalogueEvidence, type CatalogueEvidence } from "../estimate/catalogue-status.js";
import { proposalFromSizes, SizeOut, stacksFor } from "../estimate/catalogue-size.js";
import { sizeDecisions } from "../estimate/decisions.js";
import { loadPastTasks, nearMatches, referencesText, type PastTask, type TaskReference } from "../estimate/references.js";
import { estimateWorkbookLint } from "../estimate/lint.js";
import { applyEdits, describeEdit, editsOf } from "../estimate/edits.js";
import { loadBenchmarkRecords } from "../estimate/records.js";
import { loadTaskRecords, type TaskRecord } from "../estimate/durations.js";
import type { BenchmarkRecord } from "../estimate/cost.js";
import { surveyText, type RepoSurvey } from "../context/survey.js";
import { hashJson } from "../util/hash.js";
import { waivedCache, waiverFor, WAIVER_AFTER_ATTEMPT, type Failed } from "./waiver.js";
import { carriedLines, gateNotes, GATE_ROUNDS, settledBy } from "./gate-questions.js";
import { applyPatch, breakdownGaps, carryBreakdown, fixBreakdown, flagOutliers, noGaps, type BreakdownGaps } from "../estimate/fallbacks.js";
import { humanReview } from "../estimate/settings.js";
import { assembleEstimate, bandOf, DEFAULT_SETTINGS, estimatorsFor, gradeInputs, type EstimateSettings, type Proposal } from "../estimate/assemble.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { header, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import type { RunState } from "../ledger/state.js";
import type { Ledger } from "../ledger/ledger.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";
import type { ResolvedSection } from "../context/pack.js";
import { backToSettle, settledText } from "./settle.js";
import { inPool } from "../util/pool.js";

type Intent = z.infer<typeof IntentBody>;
type BreakdownBodyT = z.infer<typeof BreakdownBody>;
type WaiverList = NonNullable<ReturnType<typeof waivedCache>>["waivers"];

export const ProposalOut = z.object({
  anchors: z.array(z.object({
    taskId: z.string(),
    hours: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }),
    reason: z.string().min(1),
  })).min(1).max(8),
  tasks: z.array(z.object({ taskId: z.string(), anchorId: z.string(), ratio: z.number().positive(), reason: z.string().min(1) })).min(1),
  stack: StackChoice,
});

/** What is already known of the stack before the estimate prices it: the repo's, and the UI target a person chose. */
export function knownStack(state: RunState, ledger: Ledger, project: { stack?: string }): Record<string, unknown> {
  const repo = !!state.info.repoPath && !state.info.estimate?.noRepo;
  const inv = repo ? readOutput<{ stack?: { framework?: string; styling?: string; componentSystem?: string } }>(state, ledger, "ground", "design") : undefined;
  return {
    repo,
    ...(repo && project.stack ? { backend: project.stack === "dotnet" ? ".NET" : project.stack } : {}),
    ...(inv?.stack?.framework && inv.stack.framework !== "unknown" ? { web: [inv.stack.framework, inv.stack.componentSystem].filter((x) => x && x !== "none" && x !== "unknown").join(" + ") } : {}),
    ...(state.info.uiTarget ? { uiTarget: state.info.uiTarget } : {}),
    stackChosenBy: settingsOf(state).stackSource,
  };
}

/** The run settings a person chose at the start, with defaults for anything missing. */
export function settingsOf(state: RunState): EstimateSettings {
  return { ...DEFAULT_SETTINGS, ...(state.info.estimate ?? {}) } as EstimateSettings;
}

const done = (ctx: StepContext, name: string): string | undefined => ctx.state.steps.get(name)?.status === "completed" ? ctx.state.steps.get(name)!.outputs[0] : undefined;

/** Run a gate over inline artifacts, recording it in the ledger. */
export async function gate(ctx: StepContext, step: string, def: GateDef, inputs: Record<string, unknown>) {
  const shas = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, ctx.ledger.putJson(v)]));
  return runGate(def, ctx.ledger, ctx.writer, shas, ctx.policy, { step });
}

/** Where benchmark records come from: the ledger home. Tests swap it for a fixed list. */
let recordsSource: (exceptRun: string) => BenchmarkRecord[] = loadBenchmarkRecords;
export function setRecordsSource(f: (exceptRun: string) => BenchmarkRecord[]): void { recordsSource = f; }
let taskRecordsSource: (exceptRun: string) => TaskRecord[] = loadTaskRecords;
let catalogueEvidenceSource: (c: Catalogue) => CatalogueEvidence = loadCatalogueEvidence;
export function setCatalogueEvidenceSource(f: (c: Catalogue) => CatalogueEvidence): void { catalogueEvidenceSource = f; }
let pastTasksSource: (exceptRun: string, catalogue: string) => PastTask[] = loadPastTasks;
export function setPastTasksSource(f: (exceptRun: string, catalogue: string) => PastTask[]): void { pastTasksSource = f; }
export function setTaskRecordsSource(f: (exceptRun: string) => TaskRecord[]): void { taskRecordsSource = f; }

/** The approved design as the UI count reads it. */
type DesignForUi = { skipped?: boolean; flow: string; screens: { id: string; route?: string; states?: string[]; size?: string; mock?: ScreenMock }[] } & Parameters<typeof uiFactors>[0];
/** Each counted screen's level, for gate E5. */
const uiLevels = (ui: NonNullable<ReturnType<typeof designUi>>) => Object.fromEntries(Object.entries(ui.screens).flatMap(([id, x]) => (x.level ? [[id, x.level]] : [])));

const failed = (signature: string, failures: Failure[]): StepOutcome => ({ kind: "fail", category: "other", failures, signature });

// ---------- breakdown ----------

const TASK_RULES = `- Every task cites the requirement ids it delivers in "reqs". A task that delivers no requirement (deployment, project management, environment setup, client UAT) is an overhead: leave reqs empty and say why in "overhead". Nothing else may have empty reqs.
- "items" lists the concrete things in the spec the task must deliver: fields and validations, screen states, rules, endpoints, messages. Do not invent items the spec does not have.
- track: backend | mobile | web | qa | design | gd | pm | pdm. executor: factory (the AI factory builds it, humans only at gates), joint (factory plus human steps such as keys or store accounts) or human (full human hours: client UAT, design approval, PM).
- Human tasks the delivery always has: client UAT (kind qa-uat); project management as client liaison only (kind pm-management, track pm: the factory plans and coordinates its own work); and, when the design section holds an approved design (not skipped), one task for the client's design review and approval (kind design-approval, track design). Each is an overhead with empty reqs.
- complexity: standard | rules-or-algorithm | external-dependency | compliance-sensitive | real-time | new-to-stack.
- kind: every task, overheads included, has exactly one kind from the "task-kinds" list, on a track that kind lists. Split the work so each task is one kind: one task per screen per platform (ui-list, ui-form, ui-detail, ui-complex), one task per entity's API (be-crud), one task per third-party service (be-integration), the app shell once per platform (ui-shell), the data model once (be-data). Do not merge two kinds into one task, and do not split one kind's work across tasks unless the parts are separate screens, entities or services.`;
const SCREEN_RULES = `- Each approved screen carries "ui": its level (simple, moderate, complex) and what drives it, counted from the approved demo. A complex screen's parts (a map, a chat, a board, a form with a card field, overlays) are items of the task that builds it; split a complex screen into more than one task when its parts are separate work. "uiFactors" (two languages, right to left, both colour modes, several apps) apply to every UI task: list them as items where they add work.`;
const CHECKLIST_RULE = `- checklist: go through auth, roles, environments, CI/CD, monitoring, error handling, migrations, notifications, reports and exports, admin tools, accessibility, feedback rounds, documentation and release. Mark each in, or out with a reason. A zero always has a reason.`;

const BREAKDOWN_RULES = `You are turning a finished spec into a work breakdown for an estimate: requirements -> features -> tasks.
Rules (checked by code):
- Features group requirements by module or flow; every requirement belongs to at least one feature.
${TASK_RULES}
- Every requirement must be delivered by at least one task. Cite only requirement ids that exist in the spec.
- Task ids are EST-1, EST-2, ... Use dependsOn for real ordering only. Set "screen" to the approved design screen id (S-1, ...) when the task builds that screen; every approved screen should be built by some task.
${SCREEN_RULES}
${CHECKLIST_RULE}
- Do not write hours. Sizing is a later step.
${UNTRUSTED_NOTE}`;

/**
 * A large spec's breakdown is written in parts, as its design is drawn (src/stages/design.ts, drawInParts): one answer for 136
 * requirements and ~40 screens is a hundred-odd tasks with their items, near the model's 64K output limit, and its briefing carried
 * every page's demo data. One call plans the features, the shared tasks and the checklist (checked before any part is paid for);
 * each group of features' tasks is then written on its own, a few at a time, with one more try for a part that fails its checks.
 */
export const BREAKDOWN_IN_PARTS_AT = 48;
/** requirements per part, at most (a larger feature is a part of its own) */
const PART_REQS = 24;
/** parts written at once */
const PARTS_SIDE_BY_SIDE = 4;

export const BreakdownPlan = z.object({
  features: BreakdownBody.shape.features,
  /** the tasks no single feature owns: the app shell, the data model, services used across features, the overheads */
  shared: z.array(BreakdownTask),
  checklist: BreakdownBody.shape.checklist,
});
export const BreakdownPart = z.object({ tasks: z.array(BreakdownTask).min(1) });

const PLAN_RULES = `You are planning the work breakdown of a LARGE spec for an estimate: requirements -> features -> tasks. It is too large for one answer, so it is written in parts: here you give the features, the shared tasks and the checklist; each group of features' tasks is written next, from your plan.
Rules (checked by code):
- Features group requirements by module or flow; every requirement belongs to at least one feature. Keep a feature to one module or flow (about 5 to 15 requirements), so its tasks can be written on their own.
- "shared" holds only the tasks no single feature owns: the app shell once per platform (ui-shell), the data model once (be-data), a third-party service several features use (be-integration), and the overheads (deployment, project management, environment setup, client UAT). A feature's own screens and APIs are not shared: they are written with the feature. A shared task builds no screen: leave "screen" out.
${TASK_RULES}
- Shared task ids are EST-1, EST-2, ... and their dependsOn names only other shared tasks.
${CHECKLIST_RULE}
- Do not write hours. Sizing is a later step.
${UNTRUSTED_NOTE}`;

const PART_RULES = (from: number) => `You are writing the tasks of SOME features of a large work breakdown for an estimate. The features, the shared tasks and the checklist were planned first and are fixed: "plan" holds them, "these-features" are the features whose tasks you write.
Rules (checked by code):
- Write tasks only for the features in "these-features" ("featureId" is one of them), and every requirement in "requirements" is delivered by one of your tasks or by a shared task that cites it.
${TASK_RULES}
- Do not repeat a shared task (the app shell, the data model, the overheads): depend on it instead.
- Number your tasks EST-${from}, EST-${from + 1}, ... dependsOn names only your own tasks or shared tasks, for real ordering only.
- Set "screen" when a task builds a screen of "these-screens"; build every screen there, and no other screen.
${SCREEN_RULES}
- Do not write hours. Sizing is a later step.
${UNTRUSTED_NOTE}`;

type DesignScreen = DesignForUi["screens"][number];
/** What the breakdown reads of a screen: its links, its level and its page; the denser demo data and translations add no work. */
const screenBrief = (ui: ReturnType<typeof designUi> | undefined) => (s: DesignScreen) => {
  const { mockFull: _full, mock, ...x } = s as DesignScreen & { mockFull?: unknown };
  const { tr: _tr, ...page } = (mock ?? {}) as ScreenMock;
  return { ...x, ...(mock ? { mock: page } : {}), ...(ui?.screens[s.id] ? { ui: ui.screens[s.id] } : {}) };
};

interface BreakdownBrief {
  spec: SpecArtifact; catalogue: Catalogue; c: ReturnType<typeof clarifications>;
  survey?: RepoSurvey | undefined; design?: DesignForUi | undefined; ui?: ReturnType<typeof designUi> | undefined; intent?: Intent | undefined;
}
/** The briefing every breakdown call shares: the task kinds, the answers, the existing system and the intent. */
const breakdownContext = (b: BreakdownBrief): ResolvedSection[] => [
  S.reference("task-kinds", `Task kinds (catalogue ${b.catalogue.version}), with the tracks each can sit on:\n${catalogueText(b.catalogue)}`),
  S.artifact("answers", "answers", b.c.answers),
  S.artifact("assumptions", "assumptions", b.c.assumptions),
  ...(b.survey ? [S.profile("repo", `The existing system (a read of the repository, not the requirements):\n${surveyText(b.survey)}\nTasks that change existing code are sized by what they touch; new build work is sized by counted units.`)] : []),
  ...(b.intent ? [S.artifact("intent", "intent", { touchesUi: b.intent.touchesUi, riskTags: b.intent.riskTags })] : []),
];

/** Which earlier failures a part of the breakdown gets: a part those it raised, the plan the rest; a runner failure was the one big answer's. */
export function breakdownFailuresFor(failures: Failure[], part?: string): Failure[] {
  const own = failures.filter((f) => !f.check.startsWith("runner-"));
  return part ? own.filter((f) => f.location === `breakdown:${part}`) : own.filter((f) => !f.location?.startsWith("breakdown:"));
}

/** Features in plan order, grouped into parts of at most PART_REQS requirements. */
export function partsOf(features: BreakdownBodyT["features"]): { key: string; features: BreakdownBodyT["features"]; reqs: Set<string> }[] {
  const parts: { key: string; features: BreakdownBodyT["features"]; reqs: Set<string> }[] = [];
  for (const f of features) {
    const last = parts.at(-1);
    if (last && new Set([...last.reqs, ...f.reqs]).size <= PART_REQS) { last.features.push(f); f.reqs.forEach((r) => last.reqs.add(r)); }
    else parts.push({ key: `P${parts.length + 1}`, features: [f], reqs: new Set(f.reqs) });
  }
  return parts;
}

const verdictFailures = (v: { passed: boolean; details: string; failures?: Failure[] }, id: string): Failure[] => (v.passed ? [] : v.failures ?? [failure(id, v.details)]);

async function breakdownInParts(ctx: StepContext, b: BreakdownBrief): Promise<{ ok: true; output: BreakdownBodyT; model: string } | { ok: false; outcome: StepOutcome }> {
  const { spec, catalogue, design, ui } = b;
  const p = await think({ ...ctx, priorFailures: breakdownFailuresFor(ctx.priorFailures) }, {
    stage: "breakdown", label: "breakdown plan", route: "breakdown", cls: "read-large", budgetTokens: 40000, tools: [], schema: BreakdownPlan, maxTurns: 4,
    sections: [
      S.template("tpl", PLAN_RULES),
      ...breakdownContext(b),
      S.artifact("spec", "spec", { requirements: spec.requirements.map((q) => ({ id: q.id, ears: q.ears })), nfrs: spec.nfrs, outOfScope: spec.outOfScope }),
      ...(design ? [S.artifact("design", "approved-design", { flow: design.flow, screens: design.screens.map((x) => ({ id: x.id, route: x.route, reqs: (x as { reqs?: string[] }).reqs ?? [], ...(ui?.screens[x.id] ? { ui: ui.screens[x.id] } : {}) })), ...(ui?.factors.length ? { uiFactors: ui.factors } : {}) })] : []),
      S.task("Plan the work breakdown: the features, the shared tasks and the checklist. Each group of features' tasks is written next."),
    ],
  });
  if (!p.ok) return p;
  const plan = p.output;
  const known = new Set(spec.requirements.map((q) => q.id));
  const featured = new Set(plan.features.flatMap((f) => f.reqs));
  const planned = [
    ...spec.requirements.filter((q) => q.op !== "REMOVED" && !featured.has(q.id)).map((q) => failure("breakdown-plan-unfeatured", `${q.id} is in no feature`)),
    ...plan.features.flatMap((f) => f.reqs.filter((r) => !known.has(r)).map((r) => failure("breakdown-plan-unknown", `feature ${f.id} lists ${r}, which is not in the spec`))),
    ...[...new Set(plan.features.map((f) => f.id).filter((x, i, xs) => xs.indexOf(x) !== i))].map((x) => failure("breakdown-plan-duplicate", `two features share the id ${x}`)),
    ...plan.shared.filter((t) => t.screen).map((t) => failure("breakdown-plan-screen", `shared task ${t.id} builds screen ${t.screen}; a screen is built with its feature`)),
    ...(plan.shared.length ? (BreakdownBody.safeParse({ ...plan, tasks: plan.shared }).error?.issues ?? []).map((i) => failure("breakdown-plan-shape", i.message)) : []),
    ...verdictFailures(taskToReq.predicate({ spec, breakdown: { tasks: plan.shared } }, ctx.policy), taskToReq.id),
    ...verdictFailures(taskKind.predicate({ breakdown: { tasks: plan.shared }, catalogue }, ctx.policy), taskKind.id),
    ...verdictFailures(forgottenWork.predicate({ breakdown: plan }, ctx.policy), forgottenWork.id),
  ];
  if (planned.length) {
    p.forget?.();
    return { ok: false, outcome: failed(`breakdown-plan:${[...new Set(planned.map((f) => f.check))].sort().join(",")}`, planned) };
  }

  const parts = partsOf(plan.features);
  // every screen is built in one part: the one holding most of its requirements
  const screensOf = new Map(parts.map((x) => [x.key, [] as DesignScreen[]]));
  for (const s of design?.screens ?? []) {
    const reqs = (s as { reqs?: string[] }).reqs ?? [];
    const best = parts.reduce((a, x) => (reqs.filter((r) => x.reqs.has(r)).length > reqs.filter((r) => a.reqs.has(r)).length ? x : a), parts[0]!);
    screensOf.get(best.key)!.push(s);
  }
  const sharedIds = new Set(plan.shared.map((t) => t.id));
  const planView = { features: plan.features.map((f) => ({ id: f.id, title: f.title })), shared: plan.shared.map((t) => ({ id: t.id, title: t.title, kind: t.kind, track: t.track, reqs: t.reqs })) };
  ctx.log(`breakdown: ${plan.features.length} features, ${plan.shared.length} shared tasks; writing the tasks in ${parts.length} parts, ${PARTS_SIDE_BY_SIDE} at a time`);
  let finished = 0;
  const progress = (key: string, what: string) => ctx.log(`breakdown: part ${++finished} of ${parts.length} ${what}: ${key}`);
  const written = await inPool(parts.map((x, k) => ({ ...x, from: (k + 1) * 1000 + 1 })), PARTS_SIDE_BY_SIDE, async (part): Promise<{ tasks: BreakdownTask[] } | { failures: Failure[] } | { outcome: StepOutcome }> => {
    const mine = new Set(part.features.map((f) => f.id));
    const reqs = spec.requirements.filter((q) => part.reqs.has(q.id));
    const screens = screensOf.get(part.key)!;
    let failures = breakdownFailuresFor(ctx.priorFailures, part.key);
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await think({ ...ctx, priorFailures: failures }, {
        stage: "breakdown", label: `breakdown ${part.key} (${part.features.map((f) => f.id).join(", ")})`, route: "breakdown", cls: "read-large", budgetTokens: 40000, tools: [], schema: BreakdownPart, maxTurns: 4,
        sections: [
          S.template("tpl", PART_RULES(part.from)),
          ...breakdownContext(b),
          S.artifact("plan", "breakdown-plan", planView),
          S.artifact("these-features", "breakdown-plan", part.features),
          S.artifact("requirements", "spec", reqs),
          ...(design ? [S.artifact("these-screens", "approved-design", { flow: design.flow, screens: screens.map(screenBrief(ui)), ...(ui?.factors.length ? { uiFactors: ui.factors } : {}) })] : []),
          S.task(`Write the tasks of ${part.features.map((f) => f.id).join(", ")}.`),
        ],
      });
      if (!r.ok) return { outcome: r.outcome };
      const tasks = r.output.tasks;
      const bad = [
        ...tasks.filter((t) => !mine.has(t.featureId)).map((t) => failure("breakdown-part-feature", `${t.id} is in feature ${t.featureId}, which is not one of ${[...mine].join(", ")}`)),
        ...tasks.filter((t) => sharedIds.has(t.id)).map((t) => failure("breakdown-part-id", `${t.id} is a shared task's id; number this part's tasks from EST-${part.from}`)),
        ...(BreakdownBody.safeParse({ ...plan, tasks: [...plan.shared, ...tasks] }).error?.issues ?? []).map((i) => failure("breakdown-part-shape", i.message)),
        ...verdictFailures(reqToTask.predicate({ spec: { requirements: reqs }, breakdown: { tasks: [...plan.shared, ...tasks] } }, ctx.policy), reqToTask.id),
        ...verdictFailures(taskToReq.predicate({ spec, breakdown: { tasks } }, ctx.policy), taskToReq.id),
        ...verdictFailures(taskKind.predicate({ breakdown: { tasks }, catalogue }, ctx.policy), taskKind.id),
        ...verdictFailures(designCoverage.predicate({ ...(design ? { design: { screens } } : {}), breakdown: { tasks } }, ctx.policy), designCoverage.id),
      ];
      if (!bad.length) { progress(part.key, `written, ${tasks.length} tasks`); return { tasks }; }
      r.forget?.();
      failures = bad.map((f) => ({ ...f, location: `breakdown:${part.key}` }));
    }
    progress(part.key, "failed its checks twice");
    return { failures };
  });
  const stopped = written.find((w): w is { outcome: StepOutcome } => "outcome" in w);
  if (stopped) return { ok: false, outcome: stopped.outcome };
  const bad = written.flatMap((w) => ("failures" in w ? w.failures : []));
  if (bad.length) return { ok: false, outcome: failed(`breakdown-parts:${[...new Set(bad.map((f) => f.check))].sort().join(",")}`, bad) };

  // one numbering, EST-1 onwards: the shared tasks, then each part's in plan order
  let n = 0;
  const number = (tasks: BreakdownTask[]) => new Map(tasks.map((t) => [t.id, `EST-${++n}`]));
  const shared = number(plan.shared);
  const renumber = (tasks: BreakdownTask[], own: Map<string, string>) => tasks.map((t) => ({ ...t, id: own.get(t.id)!, dependsOn: t.dependsOn.map((d) => own.get(d) ?? shared.get(d)!) }));
  const tasks = [renumber(plan.shared, shared), ...written.map((w) => { const ts = (w as { tasks: BreakdownTask[] }).tasks; return renumber(ts, number(ts)); })].flat();
  ctx.log(`breakdown: ${tasks.length} tasks written`);
  return { ok: true, output: { features: plan.features, tasks, checklist: plan.checklist }, model: p.model };
}

/** Gates E2, E3, E2c, E4 and E1c over a breakdown, recorded in the ledger; the ones that failed. */
async function breakdownGates(ctx: StepContext, b: BreakdownBrief, body: BreakdownBodyT): Promise<Failed[]> {
  const bad: Failed[] = [];
  for (const def of [reqToTask, taskToReq, taskKind, forgottenWork, designCoverage]) {
    const res = await gate(ctx, "breakdown", def, def === designCoverage ? { design: b.design ?? null, breakdown: body } : def === taskKind ? { breakdown: body, catalogue: { version: b.catalogue.version, kinds: b.catalogue.kinds } } : { spec: b.spec, breakdown: body });
    if (!res.passed) bad.push({ def, failures: res.failures ?? [failure(def.id, res.details)] });
  }
  return bad;
}

/** A lead may waive a waivable gate in review mode, until the step's failures were asked about (then the questions settle them). */
const mayWaive = (ctx: StepContext): boolean => humanReview(ctx.state.info) && !ctx.gateAnswers?.length;
/** "estimate.e2c-task-kind" -> "gate E2c" */
const gateName = (id: string): string => { const m = /\.e(\d+)([a-z]?)-/.exec(id); return m ? `gate E${m[1]}${m[2]}` : id; };

/** A hands-off estimate run, after the retry with the failures fed back: the factory settles what still fails instead of a waiver card. */
const handsOffFallback = (ctx: StepContext): boolean => !humanReview(ctx.state.info) && ctx.attempt >= WAIVER_AFTER_ATTEMPT;

export const BreakdownPatch = z.object({
  tasks: z.array(BreakdownTask).default([]),
  kinds: z.array(z.object({ taskId: z.string(), kind: z.string() })).default([]),
});

const PATCH_RULES = (from: number) => `A work breakdown for an estimate was written and checked. Most of it is fine and stays as it is; you fix only what "problems" lists.
- "uncovered" requirements are delivered by no task: write the task or tasks that deliver each, citing it in "reqs".
- "unbuilt" screens of the approved design are built by no task: write the task that builds each, with "screen" set to it.
- "kinds" lists tasks whose kind does not fit: give each a kind from the "task-kinds" list that its track allows, in "kinds" ({ taskId, kind }).
Rules (checked by code):
${TASK_RULES}
- Number new tasks EST-${from}, EST-${from + 1}, ... "featureId" is one of the existing features; dependsOn names existing or new tasks, for real ordering only.
${SCREEN_RULES}
- Write nothing the problems do not ask for. Do not write hours.
${UNTRUSTED_NOTE}`;

/**
 * Hands-off fallbacks for the breakdown's gates (src/estimate/fallbacks.ts): the rule-based fixes for E3, E4 and a screen the
 * design does not have, then one small call for requirements no task delivers, screens no task builds and kinds that do not fit
 * (E2, E1c, E2c). Every gate runs again on the result; what still fails is returned, and the step asks about it (src/stages/gate-questions.ts).
 * A patch that does not merge is left out. Each decision goes on the estimate.
 */
async function settleBreakdown(ctx: StepContext, b: BreakdownBrief, body0: BreakdownBodyT, bad0: Failed[]): Promise<{ ok: true; body: BreakdownBodyT; fix: { suggested: Breakdown["suggested"]; notes: string[] }; bad: Failed[] } | { ok: false; outcome: StepOutcome }> {
  const screens = b.design?.screens.map((x) => x.id) ?? [];
  const fx = fixBreakdown(body0, b.spec.requirements.map((r) => r.id), screens);
  let body = fx.body;
  const notes = [...fx.notes];
  const gaps = breakdownGaps(body, b.spec, screens, b.catalogue);
  if (!noGaps(gaps)) {
    const next = Math.max(0, ...body.tasks.map((t) => Number(/^EST-(\d+)$/.exec(t.id)?.[1] ?? 0))) + 1;
    ctx.log(`breakdown: hands-off, asking for the missing work only (${gapText(gaps)})`);
    const p = await think({ ...ctx, priorFailures: [] }, {
      stage: "breakdown", label: "breakdown patch", route: "breakdown", cls: "read-large", budgetTokens: 20000, tools: [], schema: BreakdownPatch, maxTurns: 3,
      sections: [
        S.template("tpl", PATCH_RULES(next)),
        ...breakdownContext(b),
        S.artifact("problems", "problems", gaps),
        S.artifact("requirements", "spec", b.spec.requirements.filter((r) => gaps.uncovered.includes(r.id))),
        S.artifact("breakdown", "work-breakdown", { features: body.features, tasks: body.tasks.map((t) => ({ id: t.id, title: t.title, featureId: t.featureId, track: t.track, kind: t.kind, executor: t.executor, screen: t.screen, reqs: t.reqs })) }),
        ...(gaps.unbuilt.length && b.design ? [S.artifact("design", "approved-design", { screens: b.design.screens.filter((x) => gaps.unbuilt.includes(x.id)).map(screenBrief(b.ui)) })] : []),
        S.task("Fix only the listed problems."),
      ],
    });
    if (!p.ok) return { ok: false, outcome: p.outcome };
    const merged = applyPatch(body, p.output, gaps);
    const shape = "error" in merged ? undefined : BreakdownBody.safeParse(merged.body);
    if ("error" in merged || !shape?.success) ctx.log(`breakdown: hands-off, the patch was left out: ${"error" in merged ? merged.error : shape!.error!.issues.map((i) => i.message).join("; ")}`);
    else { body = shape.data; notes.push(...merged.notes); }
  }
  const bad = await breakdownGates(ctx, b, body);
  if (bad.length) ctx.log(`breakdown: hands-off, the factory's fixes left ${bad.map((x) => x.def.id.replace("estimate.", "")).join(", ")} failing; questions next`);
  else ctx.log(`breakdown: hands-off, the factory settled ${bad0.map((x) => x.def.id.replace("estimate.", "")).join(", ")} (${notes.length} decision${notes.length === 1 ? "" : "s"}, on the estimate's assumptions)`);
  return { ok: true, body, fix: { suggested: fx.suggested, notes }, bad };
}

const gapText = (g: BreakdownGaps): string => [
  g.uncovered.length ? `${g.uncovered.length} requirement${g.uncovered.length > 1 ? "s" : ""} with no task` : "",
  g.unbuilt.length ? `${g.unbuilt.length} screen${g.unbuilt.length > 1 ? "s" : ""} with no task` : "",
  g.kinds.length ? `${g.kinds.length} kind${g.kinds.length > 1 ? "s" : ""} to fix` : "",
].filter(Boolean).join(", ");

export const breakdownStep: StepDef = {
  key: "breakdown", stage: "breakdown", templateVersion: "4",
  inputs: (s) => (s.steps.get("specify")?.status === "completed" && s.steps.get("design-baseline")?.status === "completed"
    ? { spec: s.steps.get("specify")!.outputs[0], c1: s.steps.get("clarify")?.outputs[0], c2: s.steps.get("clarify-2")?.outputs[0], baseline: s.steps.get("design-baseline")!.outputs[0], design: s.steps.get("design")?.outputs[0], survey: s.steps.get("ground")?.data?.named }
    : undefined),
  async run(ctx) {
    const spec = requireOutput<SpecArtifact>(ctx.state, ctx.ledger, "specify");
    const specSha = done(ctx, "specify")!;
    const c = clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));
    // E1: no soft estimate. A spec from before problems were settled by questions goes back to the specify step to settle them;
    // what questions cannot settle (a dropped span, an open clarify question) a retry of this step cannot fix either
    const back = await backToSettle(ctx, "breakdown");
    if (back) return back;
    const e1 = await gate(ctx, "breakdown", readiness, { spec, questions: { questions: c.answers.map((a) => ({ id: a.id, answer: a.answer })) } });
    // what the spec's own questions cannot settle (a dropped span, an open clarify question) is asked about here; an answer settles it,
    // and after the rounds of questions what is still open is carried as an open risk (src/stages/gate-questions.ts)
    const openRisks: string[] = [];
    if (!e1.passed) {
      const open = (e1.failures ?? [failure(readiness.id, e1.details)]).filter((f) => !settledBy(ctx.gateAnswers, f.message));
      if (open.length && ctx.carryOn) openRisks.push(...carriedLines("gate E1", open));
      else if (open.length) return { kind: "ask", reason: `The spec is not ready to estimate (gate E1): ${open.map((f) => f.message).join("; ")}`, failures: open };
    }

    const intent = readOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const survey = readOutput<RepoSurvey>(ctx.state, ctx.ledger, "ground", "survey");
    const design = readOutput<DesignForUi>(ctx.state, ctx.ledger, "design");
    const ui = design ? designUi(design) : undefined;
    // the newest tuned version; tuning changes numbers, never the kinds, so a stored breakdown is keyed on the root
    const catalogue = currentCatalogue();
    const cacheKey = hashJson({ step: "breakdown", catalogue: rootOf(catalogue.version), spec: specSha, answers: c.answers, survey: !!survey, design: done(ctx, "design") });
    const cached = waivedCache<BreakdownBodyT>(ctx, "breakdown", cacheKey);
    const brief: BreakdownBrief = { spec, catalogue, c, survey, design: design && !design.skipped ? design : undefined, ui, intent };
    let body: BreakdownBodyT;
    let model: string | undefined;
    let waivers: WaiverList = [];
    let fixes: { suggested: Breakdown["suggested"]; notes: string[] } | undefined;
    if (cached) {
      ({ payload: body, waivers } = cached);
    } else {
      const r = spec.requirements.length > BREAKDOWN_IN_PARTS_AT ? await breakdownInParts(ctx, brief) : await think(ctx, {
        stage: "breakdown", route: "breakdown", cls: "read-large", budgetTokens: 40000, tools: [], schema: BreakdownBody, maxTurns: 4,
        sections: [
          S.template("tpl", BREAKDOWN_RULES),
          ...breakdownContext(brief),
          S.artifact("spec", "spec", { requirements: spec.requirements, nfrs: spec.nfrs, outOfScope: spec.outOfScope }),
          ...(brief.design ? [S.artifact("design", "approved-design", { flow: brief.design.flow, screens: brief.design.screens.map(screenBrief(ui)), ...(ui?.factors.length ? { uiFactors: ui.factors } : {}) })] : []),
          S.task("Write the work breakdown."),
        ],
      });
      if (!r.ok) return r.outcome;
      body = r.output;
      model = r.model;
      let bad = await breakdownGates(ctx, brief, body);
      if (bad.length && handsOffFallback(ctx)) {
        // hands-off, after the retry: no waiver card; the factory decides by rule, adds what only a model can in one small call, and checks again
        const fx = await settleBreakdown(ctx, brief, body, bad);
        if (!fx.ok) { (r as { forget?: () => void }).forget?.(); return fx.outcome; }
        ({ body, bad } = fx);
        fixes = fx.fix;
      }
      if (bad.length && ctx.carryOn) {
        // the rounds of questions are used up: the breakdown goes on, and what still fails is an open risk on the estimate
        const carry = carryBreakdown(body, catalogue);
        body = carry.body;
        openRisks.push(...carry.notes, ...bad.filter((x) => x.def !== taskKind || !carry.notes.length).flatMap((x) => carriedLines(gateName(x.def.id), x.failures)));
        ctx.log(`breakdown: ${bad.map((x) => x.def.id.replace("estimate.", "")).join(", ")} still failing after the rounds of questions; carried as open risks`);
      } else if (bad.length) {
        // a rejected answer is not read back from the store on the next try
        (r as { forget?: () => void }).forget?.();
        // review, before any question: a lead may waive gates that allow it; otherwise the executor asks about the failures after the retry
        const w = !mayWaive(ctx) ? { kind: "none" as const } : waiverFor(ctx, "breakdown", bad, { cacheKey, payload: body });
        if (w.kind === "ask") return w.outcome;
        const all = bad.flatMap((b) => b.failures);
        return { ...failed(`breakdown:${all.map((f) => f.check).sort().join(",")}`, all), gate: true } as StepOutcome;
      }
    }

    const artifact = {
      header: header(ctx.runId, "work-breakdown", "breakdown", ctx.ledger.putJson({ specSha, body }), model), ...body, specSha,
      ...(fixes?.suggested?.length ? { suggested: fixes.suggested } : {}), ...(fixes?.notes.length ? { factoryFixes: fixes.notes } : {}),
    } as Breakdown;
    return { kind: "done", outputs: { breakdown: ctx.ledger.putJson(artifact) }, data: { tasks: body.tasks.length, features: body.features.length, catalogue: catalogue.version, ...(waivers.length ? { waivers } : {}), ...(fixes?.notes.length ? { factoryFixes: fixes.notes.length } : {}), ...(openRisks.length ? { openRisks } : {}) } };
  },
};

// ---------- estimate ----------

const ESTIMATE_RULES = `You are sizing the tasks of a work breakdown, in hours, by anchors and ratios.
1. Pick a few ANCHOR tasks (1 to 8): typical tasks you can size in detail for THIS project's stack, design and constraints. Give each a min and max in hours and the reason it is a fair reference.
2. Every task, anchors included, gets "anchorId" and a "ratio" against that anchor, with a reason that names what differs ("about twice the anchor: 12 fields instead of 6, plus a state machine"). An anchor is sized against itself at ratio 1.
3. A web or mobile task that builds an approved screen carries "ui": the screen's level (simple, moderate, complex) and what drives it, counted from the approved demo. Size it from those drivers and name the ones that differ from its anchor in the reason ("a map with a route and two overlays where the anchor is a plain list"). A complex screen is never smaller than a simple one on the same track. "uiFactors" apply to every UI task (two languages, right to left, both colour modes, several apps); say in the reason when one adds work.
4. Say in "stack" the stack and architecture you priced: backend, web, mobile, database, hosting and architecture (for example "ASP.NET Core Web API", "Next.js + shadcn/ui", "PostgreSQL", "Azure App Service", "modular monolith"), leaving out a part the work does not need. Keep everything the "known-stack" section gives; basis "repo" when the repo decides it, "request" when the requirements name it, otherwise "assumed", with what you assumed in "notes".
5. Size every task in the breakdown exactly once. For a factory task the hours are a relative size (used for cost and duration); its human time is added separately.
Do not add anything up. Code computes every sum. Hours are for a competent engineer including unit tests, review fixes and handover of the task.
${UNTRUSTED_NOTE}`;

const SIZE_RULES = `You are sizing the tasks of a work breakdown against the task catalogue. You do not write hours: code reads them from the catalogue.
1. Every task has a "kind". For each task pick "size": small, typical, large or very-large, by its kind's written scale in the "task-kinds" section. Count what the task covers (fields, rules, states, filters, flows, entities) against that scale; when a count sits on a boundary, pick the smaller step.
2. "reason" names what you counted ("9 fields and 2 relations: typical"), so another estimator counting the same task lands on the same step.
3. A web or mobile task that builds an approved screen carries "ui" (simple, moderate, complex), counted from the approved demo; code applies it, so do not size the screen up for it again. "uiFactors" apply to every UI task; size the shell (ui-shell) for them.
4. For a factory or joint task also give "verify" and "context". verify: easy (a test or the compiler proves it), moderate (tests plus review), hard (needs a person, a device, a third party or judgement to check). context: complete (the spec, design and stack say everything the agent needs), partial (it has to assume or discover something).
5. Say in "stack" the stack and architecture you priced: backend, web, mobile, database, hosting and architecture (for example "ASP.NET Core Web API", "Next.js + shadcn/ui", "PostgreSQL", "Azure App Service", "modular monolith"), leaving out a part the work does not need. Keep everything the "known-stack" section gives; basis "repo" when the repo decides it, "request" when the requirements name it, otherwise "assumed", with what you assumed in "notes".
6. The "past-tasks" section, when present, lists for some tasks the closest tasks of earlier approved estimates (same kind, track, complexity and executor) and the size each was given. Count this task against the scale as usual; when it counts the same as a past task, give the same size. When you pick a different size, say in "reason" what differs ("14 fields where the approved one had 8").
7. Size every task in the breakdown exactly once.
${UNTRUSTED_NOTE}`;

export const estimateStep: StepDef = {
  key: "estimate", stage: "estimate", templateVersion: "5",
  inputs: (s) => (s.steps.get("breakdown")?.status === "completed" ? { breakdown: s.steps.get("breakdown")!.outputs[0], specify: s.steps.get("specify")!.outputs[0], design: s.steps.get("design")?.outputs[0], settings: settingsOf(s), edits: editsOf(s) } : undefined),
  async run(ctx) {
    const settings = settingsOf(ctx.state);
    const breakdown = requireOutput<Breakdown>(ctx.state, ctx.ledger, "breakdown");
    const breakdownSha = done(ctx, "breakdown")!;
    const spec = requireOutput<SpecArtifact>(ctx.state, ctx.ledger, "specify");
    const specSha = done(ctx, "specify")!;
    const c = clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));

    const band = bandOf(spec, breakdown);
    const n = estimatorsFor(band);
    ctx.log(`estimate: band ${band}, ${n} estimator${n > 1 ? "s" : ""}`);
    // each screen's UI, counted from the approved demo, travels with the tasks that build it
    const design = readOutput<DesignForUi>(ctx.state, ctx.ledger, "design");
    const ui = design ? designUi(design) : undefined;
    const uiOf = (t: { track: string; screen?: string | undefined }) => (t.track === "web" || t.track === "mobile") && t.screen ? ui?.screens[t.screen] : undefined;
    const view = breakdown.tasks.map((t) => ({ id: t.id, title: t.title, feature: t.featureId, track: t.track, ...(t.kind ? { kind: t.kind } : {}), executor: t.executor, complexity: t.complexity, screen: t.screen, ...(uiOf(t) ? { ui: { level: uiOf(t)!.level ?? "unknown", drivers: uiOf(t)!.drivers } } : {}), items: t.items, dependsOn: t.dependsOn, overhead: t.overhead }));
    const known = knownStack(ctx.state, ctx.ledger, ctx.project);
    // a breakdown whose every task has a kind is sized against the catalogue; an older one by anchors and ratios
    // the run is pinned to the catalogue version its breakdown was made with, so a re-run sizes from the same numbers
    const pinned = ctx.state.steps.get("breakdown")?.data?.catalogue;
    const catalogue = breakdown.tasks.every((t) => t.kind) ? (typeof pinned === "string" ? catalogueAt(pinned) : currentCatalogue()) : undefined;
    // Phase 2: the closest tasks of earlier approved estimates on the same catalogue version, shown as references
    const past = catalogue ? pastTasksSource(ctx.runId, catalogue.version) : [];
    const refs = new Map<string, TaskReference[]>(breakdown.tasks.map((t) => [t.id, nearMatches(t, uiOf(t)?.level, past)]));
    const refText = referencesText(refs);
    const cacheKey = hashJson({ step: "estimate", breakdown: breakdownSha, spec: specSha, settings, ui: ui ?? null, known, ...(catalogue ? { catalogue: catalogue.version } : {}), ...(refText ? { refs: refText } : {}) });
    const cached = waivedCache<Proposal[]>(ctx, "estimate", cacheKey);
    const edits = editsOf(ctx.state);
    // a lead's edits re-assemble the estimate from the proposals already made: no new model call
    const earlier = edits.length ? readOutput<Proposal[]>(ctx.state, ctx.ledger, "estimate", "proposals") : undefined;
    let proposals: Proposal[];
    let waivers: WaiverList = [];
    if (earlier) {
      try { proposals = applyEdits(earlier, edits); } catch (e) { return failed("estimate:edit", [failure("estimate-edit", (e as Error).message)]); }
    } else if (cached) {
      ({ payload: proposals, waivers } = cached);
    } else {
      const rs = await Promise.all(Array.from({ length: n }, (_, k) => think(ctx, {
        stage: "estimate", route: "estimate", cls: "read-large", budgetTokens: 40000, tools: [], schema: (catalogue ? SizeOut : ProposalOut) as z.ZodType<SizeOut | Proposal>, maxTurns: 4,
        sections: [
          S.template("tpl", catalogue ? SIZE_RULES : ESTIMATE_RULES),
          ...(catalogue ? [S.reference("task-kinds", `Task kinds and what each size step means (catalogue ${catalogue.version}):\n${catalogueText(catalogue, true)}`)] : []),
          S.artifact("breakdown", "work-breakdown", { features: breakdown.features, tasks: view }),
          S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
          S.artifact("settings", "settings", settings),
          S.artifact("known-stack", "known-stack", known),
          ...(ui?.factors.length ? [S.artifact("ui-factors", "uiFactors", ui.factors)] : []),
          ...(catalogue && refText ? [S.reference("past-tasks", `Closest tasks of earlier approved estimates (catalogue ${catalogue.version}), with the size each was given:\n${refText}`)] : []),
          S.task(`Size the tasks (independent estimator ${k + 1} of ${n}).`),
        ],
      })));
      const bad = rs.find((r) => !r.ok);
      if (bad && !bad.ok) return bad.outcome;
      if (catalogue) {
        const sizeTasks = breakdown.tasks.map((t) => ({ ...t, ui: uiOf(t)?.level }));
        try {
          proposals = (rs as unknown as { ok: true; output: SizeOut }[]).map((r, k) => {
            try { return proposalFromSizes(catalogue, r.output, sizeTasks); } catch (e) { throw new Error(`estimator ${k + 1}: ${(e as Error).message}`); }
          });
        } catch (e) {
          return failed(`estimate:${(e as Error).message.slice(0, 80)}`, [failure("estimate-proposal", (e as Error).message)]);
        }
      } else {
        proposals = (rs as unknown as { ok: true; output: Proposal }[]).map((r) => r.output);
      }
    }
    const records = recordsSource(ctx.runId);
    // the catalogue's status comes from evidence, never a person's sign-off; it stays off the client's copy
    const evidence = catalogue ? catalogueEvidenceSource(catalogue) : undefined;
    const taskRecords = taskRecordsSource(ctx.runId);

    const uiTasks = breakdown.tasks.filter((t) => (t.track === "mobile" || t.track === "web") && !t.overhead);
    let estimate;
    try {
      estimate = assembleEstimate({
        header: header(ctx.runId, "estimate", "estimate", ctx.ledger.putJson({ breakdownSha, specSha, settings, proposals })) as never,
        breakdown, breakdownSha, spec, specSha, proposals, settings, records, taskRecords,
        ...(catalogue && evidence ? { catalogue: { version: catalogue.version, status: evidence.status, evidence: { builds: evidence.builds, checks: evidence.checks.length, held: evidence.checks.filter((x) => x.held).length, projects: evidence.projects, projectsWithin: evidence.projectsWithin }, ...(catalogue.tuned ? { tuned: { generation: generationOf(catalogue.version), builds: catalogue.tuned.builds, projects: catalogue.tuned.projects } } : {}), stack: stacksFor(catalogue, proposals[0]!.stack ?? { basis: "assumed" }).join(" + "), splitAboveHours: catalogue.splitAboveHours } } : {}), ...(ctx.state.info.parent ? { parentEstimate: ctx.state.info.parent.estimateSha } : {}),
        grades: gradeInputs({ assumptions: c.assumptions.length, requirements: spec.requirements.length, uiTasks: uiTasks.length, uiTasksWithScreen: uiTasks.filter((t) => t.screen).length, hasRepo: !!ctx.state.info.repoPath, stackSource: settings.stackSource }),
        counts: { questions: c.answers.length, criticFindings: spec.critic.length, planningMinutes: ctx.state.activeMs / 60000 },
        suggested: breakdown.suggested ?? [],
        assumptions: [...c.assumptions.map((a) => a.text), ...(spec.settled ?? []).map(settledText), ...(breakdown.factoryFixes ?? []), ...gateNotes(ctx.ledger, ctx.state, "estimate"), ...edits.map((e) => `Lead edit: ${describeEdit(e)}`), "Gate time, cost and duration are assumed figures, labelled cold-start until the ledger has measured runs."],
      });
      for (const t of estimate.tasks) { const r = refs.get(t.taskId); if (r?.length) t.references = r.map(({ runId, taskId, size, hours }) => ({ runId, taskId, size, hours })); }
    } catch (e) {
      return failed(`estimate:${(e as Error).message.slice(0, 80)}`, [failure("estimate-proposal", (e as Error).message)]);
    }

    // E5 is waivable (once per exact outcome); E6 never is
    const bad2: Failed[] = [];
    for (const def of cached ? [estimateWorkbookLint] : [consistency, estimateWorkbookLint]) {
      const res = await gate(ctx, "estimate", def, { estimate, breakdown, ...(ui ? { ui: uiLevels(ui) } : {}) });
      if (!res.passed) bad2.push({ def, failures: res.failures ?? [failure(def.id, res.details)] });
    }
    // hands-off after the retry, or once the rounds of questions are used up: an outlier E5 still finds is flagged with the gate's reason
    // (E6 stays a hard stop: it is never asked about or carried)
    const carry = ctx.carryOn;
    if (bad2.length && (handsOffFallback(ctx) || carry) && bad2.every((x) => x.def === consistency)) {
      const fx = flagOutliers(estimate, bad2.flatMap((x) => x.failures), carry ? `after ${GATE_ROUNDS} rounds of questions` : "hands-off");
      const again = await gate(ctx, "estimate", consistency, { estimate: fx.estimate, breakdown, ...(ui ? { ui: uiLevels(ui) } : {}) });
      const still = again.passed ? [] : again.failures ?? [failure(consistency.id, again.details)];
      if (!still.length || carry) {
        const flagged = carry && still.length ? { ...fx.estimate, assumptions: [...fx.estimate.assumptions, ...carriedLines("gate E5", still)] } : fx.estimate;
        const lint = await gate(ctx, "estimate", estimateWorkbookLint, { estimate: flagged, breakdown });
        if (!lint.passed) return failed(`estimate:${(lint.failures ?? []).map((f) => f.check).sort().join(",")}`, lint.failures ?? [failure(estimateWorkbookLint.id, lint.details)]);
        ctx.log(`estimate: the factory flagged ${fx.notes.length} task${fx.notes.length === 1 ? "" : "s"} gate E5 found out of line (on the estimate's open risks)${still.length ? "; what E5 still finds is carried as an open risk" : ""}`);
        estimate = flagged;
        bad2.length = 0;
      } else {
        bad2.splice(0, bad2.length, { def: consistency, failures: still });
      }
    }
    if (bad2.length) {
      const e5Only = bad2.every((x) => x.def === consistency);
      // review, before any question: a lead may waive E5; otherwise the executor asks about it after the retry (never about E6)
      const w = !mayWaive(ctx) ? { kind: "none" as const } : waiverFor(ctx, "estimate", bad2, { cacheKey, payload: proposals });
      if (w.kind === "ask") return w.outcome;
      const all = bad2.flatMap((b) => b.failures);
      return { ...failed(`estimate:${all.map((f) => f.check).sort().join(",")}`, all), ...(e5Only ? { gate: true } : {}) } as StepOutcome;
    }

    // Phase 2: every size pick, logged as a decision record with derived features, so another backend can be compared later
    const decisions = estimate.catalogue ? sizeDecisions(proposals, breakdown.tasks, (t) => uiOf(t)?.level, { catalogue: estimate.catalogue.version, stack: estimate.catalogue.stack, band, edits: edits.length }, (id) => refs.get(id) ?? []) : undefined;
    return { kind: "done", outputs: { estimate: ctx.ledger.putJson(estimate), proposals: ctx.ledger.putJson(proposals), records: ctx.ledger.putJson(records), taskRecords: ctx.ledger.putJson(taskRecords), ...(decisions ? { decisions: ctx.ledger.putJson(decisions) } : {}) }, data: { band, estimators: n, hours: estimate.totals.overall, records: records.length, taskRecords: taskRecords.length, ...(decisions ? { decisions: decisions.decisions.length } : {}), ...(waivers.length ? { waivers } : {}) } };
  },
};
