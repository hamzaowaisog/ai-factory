// Estimate mode, model steps: breakdown (requirements -> features -> tasks) and estimate (anchors,
// ratios, one or three independent estimators, merged by code). The model proposes; code counts,
// computes every sum and runs gates E1-E6 (docs/estimates-design.md, "How the hours are built").
import { z } from "zod";
import { BreakdownBody, IntentBody, StackChoice, type Breakdown, type Spec as SpecArtifact } from "../contracts/index.js";
import type { Failure, ScreenMock } from "../contracts/index.js";
import { failure, runGate, type GateDef } from "../gates/engine.js";
import { designUi, uiFactors } from "../estimate/ui-complexity.js";
import { consistency, designCoverage, forgottenWork, readiness, reqToTask, taskKind, taskToReq } from "../estimate/gates.js";
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
import { waivedCache, waiverFor, type Failed } from "./waiver.js";
import { assembleEstimate, bandOf, DEFAULT_SETTINGS, estimatorsFor, gradeInputs, type EstimateSettings, type Proposal } from "../estimate/assemble.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { header, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import type { RunState } from "../ledger/state.js";
import type { Ledger } from "../ledger/ledger.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

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

const BREAKDOWN_RULES = `You are turning a finished spec into a work breakdown for an estimate: requirements -> features -> tasks.
Rules (checked by code):
- Features group requirements by module or flow; every requirement belongs to at least one feature.
- Every task cites the requirement ids it delivers in "reqs". A task that delivers no requirement (deployment, project management, environment setup, client UAT) is an overhead: leave reqs empty and say why in "overhead". Nothing else may have empty reqs.
- Every requirement must be delivered by at least one task. Cite only requirement ids that exist in the spec.
- "items" lists the concrete things in the spec the task must deliver: fields and validations, screen states, rules, endpoints, messages. Do not invent items the spec does not have.
- track: backend | mobile | web | qa | design | gd | pm | pdm. executor: factory (the AI factory builds it, humans only at gates), joint (factory plus human steps such as keys or store accounts) or human (full human hours: client UAT, design approval, PM).
- complexity: standard | rules-or-algorithm | external-dependency | compliance-sensitive | real-time | new-to-stack.
- kind: every task, overheads included, has exactly one kind from the "task-kinds" list, on a track that kind lists. Split the work so each task is one kind: one task per screen per platform (ui-list, ui-form, ui-detail, ui-complex), one task per entity's API (be-crud), one task per third-party service (be-integration), the app shell once per platform (ui-shell), the data model once (be-data). Do not merge two kinds into one task, and do not split one kind's work across tasks unless the parts are separate screens, entities or services.
- Task ids are EST-1, EST-2, ... Use dependsOn for real ordering only. Set "screen" to the approved design screen id (S-1, ...) when the task builds that screen; every approved screen should be built by some task.
- Each approved screen carries "ui": its level (simple, moderate, complex) and what drives it, counted from the approved demo. A complex screen's parts (a map, a chat, a board, a form with a card field, overlays) are items of the task that builds it; split a complex screen into more than one task when its parts are separate work. "uiFactors" (two languages, right to left, both colour modes, several apps) apply to every UI task: list them as items where they add work.
- checklist: go through auth, roles, environments, CI/CD, monitoring, error handling, migrations, notifications, reports and exports, admin tools, accessibility, feedback rounds, documentation and release. Mark each in, or out with a reason. A zero always has a reason.
- Do not write hours. Sizing is a later step.
${UNTRUSTED_NOTE}`;

export const breakdownStep: StepDef = {
  key: "breakdown", stage: "breakdown", templateVersion: "3",
  inputs: (s) => (s.steps.get("specify")?.status === "completed" && s.steps.get("design-baseline")?.status === "completed"
    ? { spec: s.steps.get("specify")!.outputs[0], c1: s.steps.get("clarify")?.outputs[0], c2: s.steps.get("clarify-2")?.outputs[0], baseline: s.steps.get("design-baseline")!.outputs[0], design: s.steps.get("design")?.outputs[0], survey: s.steps.get("ground")?.data?.named }
    : undefined),
  async run(ctx) {
    const spec = requireOutput<SpecArtifact>(ctx.state, ctx.ledger, "specify");
    const specSha = done(ctx, "specify")!;
    const c = clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));
    // E1: no soft estimate. A spec that is not ready goes back to clarify, which a retry of this step cannot fix.
    const e1 = await gate(ctx, "breakdown", readiness, { spec, questions: { questions: c.answers.map((a) => ({ id: a.id, answer: a.answer })) } });
    if (!e1.passed) return { kind: "park", reason: `The spec is not ready to estimate (gate E1): ${e1.details}. Go back to clarify.` };

    const intent = readOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const survey = readOutput<RepoSurvey>(ctx.state, ctx.ledger, "ground", "survey");
    const design = readOutput<DesignForUi>(ctx.state, ctx.ledger, "design");
    const ui = design ? designUi(design) : undefined;
    // the newest tuned version; tuning changes numbers, never the kinds, so a stored breakdown is keyed on the root
    const catalogue = currentCatalogue();
    const cacheKey = hashJson({ step: "breakdown", catalogue: rootOf(catalogue.version), spec: specSha, answers: c.answers, survey: !!survey, design: done(ctx, "design") });
    const cached = waivedCache<BreakdownBodyT>(ctx, "breakdown", cacheKey);
    let body: BreakdownBodyT;
    let model: string | undefined;
    let waivers: WaiverList = [];
    if (cached) {
      ({ payload: body, waivers } = cached);
    } else {
      const r = await think(ctx, {
        stage: "breakdown", route: "breakdown", cls: "read-large", budgetTokens: 40000, tools: [], schema: BreakdownBody, maxTurns: 4,
        sections: [
          S.template("tpl", BREAKDOWN_RULES),
          S.reference("task-kinds", `Task kinds (catalogue ${catalogue.version}), with the tracks each can sit on:\n${catalogueText(catalogue)}`),
          S.artifact("spec", "spec", { requirements: spec.requirements, nfrs: spec.nfrs, outOfScope: spec.outOfScope }),
          S.artifact("answers", "answers", c.answers),
          S.artifact("assumptions", "assumptions", c.assumptions),
          ...(survey ? [S.profile("repo", `The existing system (a read of the repository, not the requirements):\n${surveyText(survey)}\nTasks that change existing code are sized by what they touch; new build work is sized by counted units.`)] : []),
          ...(design && !design.skipped ? [S.artifact("design", "approved-design", { flow: design.flow, screens: design.screens.map((x) => ({ ...x, ...(ui?.screens[x.id] ? { ui: ui.screens[x.id] } : {}) })), ...(ui?.factors.length ? { uiFactors: ui.factors } : {}) })] : []),
          ...(intent ? [S.artifact("intent", "intent", { touchesUi: intent.touchesUi, riskTags: intent.riskTags })] : []),
          S.task("Write the work breakdown."),
        ],
      });
      if (!r.ok) return r.outcome;
      body = r.output;
      model = r.model;
      const bad: Failed[] = [];
      for (const def of [reqToTask, taskToReq, taskKind, forgottenWork, designCoverage]) {
        const res = await gate(ctx, "breakdown", def, def === designCoverage ? { design: design ?? null, breakdown: body } : def === taskKind ? { breakdown: body, catalogue: { version: catalogue.version, kinds: catalogue.kinds } } : { spec, breakdown: body });
        if (!res.passed) bad.push({ def, failures: res.failures ?? [failure(def.id, res.details)] });
      }
      if (bad.length) {
        const w = waiverFor(ctx, "breakdown", bad, { cacheKey, payload: body });
        if (w.kind === "ask") return w.outcome;
        const all = bad.flatMap((b) => b.failures);
        return failed(`breakdown:${all.map((f) => f.check).sort().join(",")}`, all);
      }
    }

    const artifact = { header: header(ctx.runId, "work-breakdown", "breakdown", ctx.ledger.putJson({ specSha, body }), model), ...body, specSha } as Breakdown;
    return { kind: "done", outputs: { breakdown: ctx.ledger.putJson(artifact) }, data: { tasks: body.tasks.length, features: body.features.length, catalogue: catalogue.version, ...(waivers.length ? { waivers } : {}) } };
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
        assumptions: [...c.assumptions.map((a) => a.text), ...edits.map((e) => `Lead edit: ${describeEdit(e)}`), "Gate time, cost and duration are assumed figures, labelled cold-start until the ledger has measured runs."],
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
    if (bad2.length) {
      const w = waiverFor(ctx, "estimate", bad2, { cacheKey, payload: proposals });
      if (w.kind === "ask") return w.outcome;
      const all = bad2.flatMap((b) => b.failures);
      return failed(`estimate:${all.map((f) => f.check).sort().join(",")}`, all);
    }

    // Phase 2: every size pick, logged as a decision record with derived features, so another backend can be compared later
    const decisions = estimate.catalogue ? sizeDecisions(proposals, breakdown.tasks, (t) => uiOf(t)?.level, { catalogue: estimate.catalogue.version, stack: estimate.catalogue.stack, band, edits: edits.length }, (id) => refs.get(id) ?? []) : undefined;
    return { kind: "done", outputs: { estimate: ctx.ledger.putJson(estimate), proposals: ctx.ledger.putJson(proposals), records: ctx.ledger.putJson(records), taskRecords: ctx.ledger.putJson(taskRecords), ...(decisions ? { decisions: ctx.ledger.putJson(decisions) } : {}) }, data: { band, estimators: n, hours: estimate.totals.overall, records: records.length, taskRecords: taskRecords.length, ...(decisions ? { decisions: decisions.decisions.length } : {}), ...(waivers.length ? { waivers } : {}) } };
  },
};
