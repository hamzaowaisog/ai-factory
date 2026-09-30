// Estimate mode, model steps: breakdown (requirements -> features -> tasks) and estimate (anchors,
// ratios, one or three independent estimators, merged by code). The model proposes; code counts,
// computes every sum and runs gates E1-E6 (docs/estimates-design.md, "How the hours are built").
import { z } from "zod";
import { BreakdownBody, IntentBody, type Breakdown, type Spec as SpecArtifact } from "../contracts/index.js";
import type { Failure } from "../contracts/index.js";
import { failure, runGate, type GateDef } from "../gates/engine.js";
import { consistency, forgottenWork, readiness, reqToTask, taskToReq } from "../estimate/gates.js";
import { estimateWorkbookLint } from "../estimate/lint.js";
import { loadBenchmarkRecords } from "../estimate/records.js";
import type { BenchmarkRecord } from "../estimate/cost.js";
import { surveyText, type RepoSurvey } from "../context/survey.js";
import { hashJson } from "../util/hash.js";
import { waivedCache, waiverFor, type Failed } from "./waiver.js";
import { assembleEstimate, bandOf, DEFAULT_SETTINGS, estimatorsFor, gradeInputs, type EstimateSettings, type Proposal } from "../estimate/assemble.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { header, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import type { RunState } from "../ledger/state.js";
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
});

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
- Task ids are EST-1, EST-2, ... Use dependsOn for real ordering only. Set "screen" when the task builds a named screen.
- checklist: go through auth, roles, environments, CI/CD, monitoring, error handling, migrations, notifications, reports and exports, admin tools, accessibility, feedback rounds, documentation and release. Mark each in, or out with a reason. A zero always has a reason.
- Do not write hours. Sizing is a later step.
${UNTRUSTED_NOTE}`;

export const breakdownStep: StepDef = {
  key: "breakdown", stage: "breakdown", templateVersion: "1",
  inputs: (s) => (s.steps.get("specify")?.status === "completed" && s.steps.get("design-baseline")?.status === "completed"
    ? { spec: s.steps.get("specify")!.outputs[0], c1: s.steps.get("clarify")?.outputs[0], c2: s.steps.get("clarify-2")?.outputs[0], baseline: s.steps.get("design-baseline")!.outputs[0], survey: s.steps.get("ground")?.data?.named }
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
    const cacheKey = hashJson({ step: "breakdown", spec: specSha, answers: c.answers, survey: !!survey });
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
          S.artifact("spec", "spec", { requirements: spec.requirements, nfrs: spec.nfrs, outOfScope: spec.outOfScope }),
          S.artifact("answers", "answers", c.answers),
          S.artifact("assumptions", "assumptions", c.assumptions),
          ...(survey ? [S.profile("repo", `The existing system (a read of the repository, not the requirements):\n${surveyText(survey)}\nTasks that change existing code are sized by what they touch; new build work is sized by counted units.`)] : []),
          ...(intent ? [S.artifact("intent", "intent", { touchesUi: intent.touchesUi, riskTags: intent.riskTags })] : []),
          S.task("Write the work breakdown."),
        ],
      });
      if (!r.ok) return r.outcome;
      body = r.output;
      model = r.model;
      const bad: Failed[] = [];
      for (const def of [reqToTask, taskToReq, forgottenWork]) {
        const res = await gate(ctx, "breakdown", def, { spec, breakdown: body });
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
    return { kind: "done", outputs: { breakdown: ctx.ledger.putJson(artifact) }, data: { tasks: body.tasks.length, features: body.features.length, ...(waivers.length ? { waivers } : {}) } };
  },
};

// ---------- estimate ----------

const ESTIMATE_RULES = `You are sizing the tasks of a work breakdown, in hours, by anchors and ratios.
1. Pick a few ANCHOR tasks (1 to 8): typical tasks you can size in detail for THIS project's stack, design and constraints. Give each a min and max in hours and the reason it is a fair reference.
2. Every task, anchors included, gets "anchorId" and a "ratio" against that anchor, with a reason that names what differs ("about twice the anchor: 12 fields instead of 6, plus a state machine"). An anchor is sized against itself at ratio 1.
3. Size every task in the breakdown exactly once. For a factory task the hours are a relative size (used for cost and duration); its human time is added separately.
Do not add anything up. Code computes every sum. Hours are for a competent engineer including unit tests, review fixes and handover of the task.
${UNTRUSTED_NOTE}`;

export const estimateStep: StepDef = {
  key: "estimate", stage: "estimate", templateVersion: "1",
  inputs: (s) => (s.steps.get("breakdown")?.status === "completed" ? { breakdown: s.steps.get("breakdown")!.outputs[0], specify: s.steps.get("specify")!.outputs[0], settings: settingsOf(s) } : undefined),
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
    const view = breakdown.tasks.map((t) => ({ id: t.id, title: t.title, feature: t.featureId, track: t.track, executor: t.executor, complexity: t.complexity, screen: t.screen, items: t.items, dependsOn: t.dependsOn, overhead: t.overhead }));
    const cacheKey = hashJson({ step: "estimate", breakdown: breakdownSha, spec: specSha, settings });
    const cached = waivedCache<Proposal[]>(ctx, "estimate", cacheKey);
    let proposals: Proposal[];
    let waivers: WaiverList = [];
    if (cached) {
      ({ payload: proposals, waivers } = cached);
    } else {
      const rs = await Promise.all(Array.from({ length: n }, (_, k) => think(ctx, {
        stage: "estimate", route: "estimate", cls: "read-large", budgetTokens: 40000, tools: [], schema: ProposalOut, maxTurns: 4,
        sections: [
          S.template("tpl", ESTIMATE_RULES),
          S.artifact("breakdown", "work-breakdown", { features: breakdown.features, tasks: view }),
          S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
          S.artifact("settings", "settings", settings),
          S.task(n === 1 ? "Size the tasks." : `Size the tasks (independent estimator ${k + 1} of ${n}).`),
        ],
      })));
      const bad = rs.find((r) => !r.ok);
      if (bad && !bad.ok) return bad.outcome;
      proposals = (rs as { ok: true; output: Proposal }[]).map((r) => r.output);
    }
    const records = recordsSource(ctx.runId);

    const uiTasks = breakdown.tasks.filter((t) => (t.track === "mobile" || t.track === "web") && !t.overhead);
    let estimate;
    try {
      estimate = assembleEstimate({
        header: header(ctx.runId, "estimate", "estimate", ctx.ledger.putJson({ breakdownSha, specSha, settings, proposals })) as never,
        breakdown, breakdownSha, spec, specSha, proposals, settings, records,
        grades: gradeInputs({ assumptions: c.assumptions.length, requirements: spec.requirements.length, uiTasks: uiTasks.length, uiTasksWithScreen: uiTasks.filter((t) => t.screen).length, hasRepo: !!ctx.state.info.repoPath, stackSource: settings.stackSource }),
        counts: { questions: c.answers.length, criticFindings: spec.critic.length, planningMinutes: ctx.state.activeMs / 60000 },
        assumptions: [...c.assumptions.map((a) => a.text), "Gate time, cost and duration are assumed figures, labelled cold-start until the ledger has measured runs."],
      });
    } catch (e) {
      return failed(`estimate:${(e as Error).message.slice(0, 80)}`, [failure("estimate-proposal", (e as Error).message)]);
    }

    // E5 is waivable (once per exact outcome); E6 never is
    const bad2: Failed[] = [];
    for (const def of cached ? [estimateWorkbookLint] : [consistency, estimateWorkbookLint]) {
      const res = await gate(ctx, "estimate", def, { estimate, breakdown });
      if (!res.passed) bad2.push({ def, failures: res.failures ?? [failure(def.id, res.details)] });
    }
    if (bad2.length) {
      const w = waiverFor(ctx, "estimate", bad2, { cacheKey, payload: proposals });
      if (w.kind === "ask") return w.outcome;
      const all = bad2.flatMap((b) => b.failures);
      return failed(`estimate:${all.map((f) => f.check).sort().join(",")}`, all);
    }

    return { kind: "done", outputs: { estimate: ctx.ledger.putJson(estimate), proposals: ctx.ledger.putJson(proposals), records: ctx.ledger.putJson(records) }, data: { band, estimators: n, hours: estimate.totals.overall, records: records.length, ...(waivers.length ? { waivers } : {}) } };
  },
};
