// Spec side of the brownfield slice: intake → ground → specify (+lint, critic) → plan → approval card.
import { z } from "zod";
import {
  CurrentBehaviourBody, IntentBody, maxRisk, PlanBody, type Risk, SpecDraft, type Complexity, type Failure,
} from "../contracts/index.js";
import { checkEvidence } from "../context/tools.js";
import { buildRepoMap } from "../context/repomap.js";
import { failure } from "../gates/engine.js";
import { anchorsResolve, planChecks } from "../gates/predicates.js";
import { isConfigIntegrityPath } from "../gates/protected.js";
import { runGate, type GateDef } from "../gates/engine.js";
import { hashJson } from "../util/hash.js";
import { approvedDesignFor } from "./design-inputs.js";
import { header, outputOf, planRejections, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { acOwners } from "./build.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { CriticOut } from "./specpipe.js";
import { describeSources } from "../sources/request.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";
import { snapshotFor, toolsFor } from "./workspace.js";
import { uiSizeForCard } from "../design/card.js";
import { LANE, lightSpec } from "./lane.js";
import { changeRequest, designScopeLock, designScreensPlanned, scopeLock, screenScope, screensPlanned } from "../estimate/gates.js";
import { buildWaiver, type BuildFailed } from "../estimate/build-waiver.js";
import type { WaiverRow } from "../estimate/log.js";
import { WAIVER_AFTER_ATTEMPT } from "./waiver.js";
import type { Breakdown } from "../contracts/index.js";
import { dependencyKind, planIntro, stubRule } from "./stack-text.js";
import { checkPlanScaffold, designForScopeGate, scaffoldForPlan, scaffoldOfRun } from "./scaffold-run.js";

type Intent = z.infer<typeof IntentBody>;
type CB = z.infer<typeof CurrentBehaviourBody>;
type Spec = z.infer<typeof SpecDraft>;
type PlanT = z.infer<typeof PlanBody>;

// ---------- risk rules (intake: risk = max(rules, model)) ----------
/** Build gates a lead may waive at the plan: B1 (scope lock) and B6 (screens planned). B2 goes through a change request. */
const WAIVABLE_AT_PLAN = new Set(["build.b1-scope-lock", "build.b6-screens-planned", "build.b7-screen-scope", "build.b1-design-scope", "build.b6-design-screens"]);

const RISK_RULES: { tag: string; re: RegExp; risk: Risk }[] = [
  { tag: "auth", re: /\b(auth|login|password|permission|role|token|oauth|sso|jwt)\w*/i, risk: "high" },
  { tag: "payments", re: /\b(payment|billing|invoice|charge|refund|card|stripe)\w*/i, risk: "high" },
  { tag: "pii", re: /\b(ssn|social security|date of birth|dob|address|phone|email|personal data|pii|medical record)\w*/i, risk: "high" },
  { tag: "migration", re: /\b(migration|schema change|alter table|add column|drop column|database change)\w*/i, risk: "high" },
  { tag: "public-api", re: /\b(public api|endpoint|breaking change|contract)\b/i, risk: "medium" },
];
export function ruleRisk(text: string): { risk: Risk; tags: string[] } {
  const hits = RISK_RULES.filter((r) => r.re.test(text));
  return { risk: maxRisk(...hits.map((h) => h.risk)), tags: hits.map((h) => h.tag) };
}

// ---------- UI rules (intake: touchesUi = model or rules, never the model alone) ----------
const UI_WORDS = /\b(screens?|ui|ux|user interface|front-?end|dashboards?|wireframes?|mock-?ups?|figma|landing pages?|web ?apps?|mobile apps?|modals?|buttons?)\b/i;
const FRAME_LINE = /^\s*-\s*F-\d+\s+\S/m;
/** A request that names screens, or comes with attached design frames, touches UI whatever the model said. */
export function ruleUi(text: string): boolean {
  return UI_WORDS.test(text) || FRAME_LINE.test(text);
}

const request = (ctx: Pick<StepContext, "state">) => ctx.state.info.request ?? "";
/** "request.md + Jira ABC-12" (older runs: the file name only) */
const requestFrom = (ctx: Pick<StepContext, "state">) => describeSources(ctx.state.info.sources) || ctx.state.info.requestFile || "";
const jiraSource = (ctx: Pick<StepContext, "state">) => ctx.state.info.sources?.find((s) => s.kind === "jira");

// ---------- intake ----------
export const intakeStep: StepDef = {
  key: "intake", stage: "intake", templateVersion: "1",
  inputs: (s) => ({ request: hashJson(s.info.request ?? "") }),
  async run(ctx) {
    const r = await think(ctx, {
      stage: "intake", route: "intake", cls: "read-small", budgetTokens: 8000, tools: [], schema: IntentBody,
      sections: [
        S.template("tpl", `You are the intake step of a software factory. Read the change request and classify it.
${UNTRUSTED_NOTE}
- Split the request into intent spans: short quotes of the request, each one thing it asks for. IDs I-1, I-2, ...
- changeClass: bugfix | feature | refactor | migration | config.
- risk: low | medium | high. riskTags from: auth, payments, pii, migration, public-api.
- rigor: "light" only for a small, low-risk change; else "full". touchesUi: true if a screen changes.
- source: "cli".`),
        S.untrusted("request", jiraSource(ctx) ? "jira" : "cli", request(ctx)),
        S.task("Classify this request."),
      ],
    });
    if (!r.ok) return r.outcome;
    const rules = ruleRisk(request(ctx));
    const jira = jiraSource(ctx);
    const intent = {
      ...r.output, source: jira ? ("ticket" as const) : ("cli" as const), ...(jira ? { sourceRef: jira.url } : {}),
      risk: maxRisk(r.output.risk, rules.risk), riskTags: [...new Set([...r.output.riskTags, ...rules.tags])],
      touchesUi: r.output.touchesUi || ruleUi(request(ctx)),
    };
    const sha = ctx.ledger.putJson({ header: header(ctx.runId, "intent", "intake", "", r.model), ...intent });
    return { kind: "done", outputs: { intent: sha }, data: { changeClass: intent.changeClass, risk: intent.risk, touchesUi: intent.touchesUi } };
  },
};

// ---------- ground ----------
export const groundStep: StepDef = {
  key: "ground", stage: "ground", templateVersion: "1",
  inputs: (s) => (s.steps.get("intake")?.status === "completed" ? { intent: s.steps.get("intake")!.outputs[0], base: s.info.baseCommit } : undefined),
  async run(ctx) {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const snap = snapshotFor(ctx);
    const map = buildRepoMap(snap.root, snap.files, { budgetTokens: 3000 }).map;
    const r = await think(ctx, {
      stage: "ground", route: "ground", cls: "read-large", budgetTokens: 40000, tools: ["read_file", "search", "repo_map"],
      repoTools: toolsFor(ctx), schema: CurrentBehaviourBody, maxTurns: lightSpec(intent) ? LANE.light.groundTurns : LANE.full.groundTurns,
      sections: [
        S.template("tpl", `You are the grounding step. For each intent span, find the code that implements today's behaviour and describe it.
Use search and read_file. Every claim needs at least one anchor: path, lineStart, lineEnd, an exact quote of those lines, and the symbol.
Quotes are checked against the file, so copy them exactly. Anchors that don't match fail the step.
Missing a relevant file is the one mistake no check catches: search for every noun and verb in the request.
If nothing exists yet for a span (new behaviour), list it under notFound with what you searched.`),
        S.profile("repomap", `Repository map (base commit):\n${map}`),
        S.artifact("intent", "intent", intent),
        S.task("Describe the current behaviour relevant to each span, with anchors."),
      ],
    });
    if (!r.ok) return r.outcome;
    const resolved = r.output.claims.flatMap((c) => c.anchors.map((a) => ({ claim: c.id, ...checkEvidence(snap, a) })));
    const cbSha = ctx.ledger.putJson({ header: header(ctx.runId, "current-behaviour", "ground", "", r.model), ...r.output });
    const resSha = ctx.ledger.putJson(resolved);
    const g = await runGate(anchorsResolve, ctx.ledger, ctx.writer, { cb: cbSha, resolved: resSha }, ctx.policy, { step: "ground" });
    if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [], signature: `ground:${g.details.slice(0, 80)}` };
    return { kind: "done", outputs: { cb: cbSha } };
  },
};

// ---------- plan ----------
function complexityOf(plan: PlanT): Complexity {
  const loc = plan.tasks.reduce((n, t) => n + t.plannedLoc, 0);
  if (plan.tasks.length <= 2 && loc <= 150) return "S";
  if (plan.tasks.length <= 5 && loc <= 600) return "M";
  return "L";
}

export const planStep: StepDef = {
  key: "plan", stage: "plan", templateVersion: "2",
  // a design approved in this run counts; with none the key is dropped, so the hash is what it always was
  inputs: (s) => (s.steps.get("specify")?.status === "completed" ? { spec: s.steps.get("specify")!.outputs[0], rejections: planRejections(s), design: outputOf(s, "design-baseline") } : undefined),
  async run(ctx) {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const cb = requireOutput<CB>(ctx.state, ctx.ledger, "ground");
    const critic = requireOutput<{ findings: unknown[] }>(ctx.state, ctx.ledger, "specify", "critic");
    const snap = snapshotFor(ctx);
    const ref = ctx.state.info.estimateRef;
    // a build from an approved design (--from-design) is held to that design's spec and screens the same way (PR #11 review, item 10)
    const dref = ref ? undefined : ctx.state.info.designRef;
    // B2: a requirement changed after approval (recorded by steer) is a change request, not a quiet replan
    if (ref && ctx.state.pendingChanges.length) {
      return { kind: "park", reason: `A requirement change was recorded after the estimate was approved (gate B2). Estimate it as a change request: factory estimate --revises ${ref.runId}, then build the new estimate.` };
    }
    if (dref && ctx.state.pendingChanges.length) {
      return { kind: "park", reason: `A requirement change was recorded after the design was approved in ${dref.runId} (gate B2). Draw and approve the changed design first (a new design run), then build from it.` };
    }
    // the approved design: from the estimate this build was seeded from, or from this run's own design steps
    const design = approvedDesignFor<{ skipped?: boolean; flow: string; screens: { id: string; route: string }[]; theme?: unknown; themeSource?: "new" | "repo" }>(ctx.state, ctx.ledger)?.design;
    const approvedDesign = design && !design.skipped ? { flow: design.flow, screens: design.screens } : undefined;
    // a new look comes with design tokens (design/tokens.ts); one task must be free to put them in the app's global stylesheet
    const newLook = !!approvedDesign && !!design?.theme && design.themeSource !== "repo";
    // a design built with a kit: the scaffold's files are known now, so the design-system task comes first and each screen task
    // fills in its container (docs/estimates-design.md, "Kit and scaffold"); a change request plans only the changed screens
    const scaf = approvedDesign ? scaffoldOfRun(ctx, "store") : undefined;
    const approvedTasks = ref ? ctx.ledger.getJson<Breakdown>(ref.breakdownSha).tasks : [];
    const map = buildRepoMap(snap.root, snap.files, { budgetTokens: 4000, focus: cb.claims.flatMap((c) => c.anchors.map((a) => a.path)) }).map;
    const r = await think(ctx, {
      stage: "plan", route: "plan", cls: "read-large", budgetTokens: 30000, tools: ["read_file", "search", "repo_map"],
      repoTools: toolsFor(ctx), schema: PlanBody, maxTurns: 12,
      sections: [
        S.template("tpl", `${planIntro(ctx.project.stack)}
- Give at least 2 options (one marked simplest), choose one, and write a decision record of at most 5 lines (adr).
- Split into tasks TASK-1.. in dependency order. Each task: the requirements it delivers, fileScope (exact repo paths or narrow globs it may change, no overlap between tasks), 1-2 exemplar files to imitate, plannedLoc, approach (short instructions for the implementer).
- Test projects, test files and CI config are not in any file scope: tests are written separately.
- stubs: for every NEW public type/method/endpoint the tests will call, give a compilable stub file (full file content) whose bodies ${stubRule(ctx.project.stack)}, so tests compile before implementation. Existing APIs need no stubs. Stub paths must be inside a task's fileScope.
- protectedPathsDeclared: list any migration, CI, build-config or package-feed file you must change (a human will see it).
- newDependencies: any ${dependencyKind(ctx.project.stack)} package to add (name, version, registry). Prefer none.`),
        S.profile("repomap", `Repository map:\n${map}`),
        S.artifact("spec", "spec", spec),
        S.artifact("cb", "current-behaviour", cb),
        S.artifact("critic", "critic", critic),
        ...(approvedDesign ? [S.artifact("approved-design", "approved-design", approvedDesign)] : []),
        ...(ref ? [S.artifact("estimate-tasks", "approved-estimate-tasks", approvedTasks.map((t) => ({ id: t.id, title: t.title, reqs: t.reqs, track: t.track, executor: t.executor, items: t.items }))), S.template("scope-lock", "This plan delivers an APPROVED ESTIMATE. Set estimateTaskId on every task to the approved estimate task (EST-n) it delivers; one estimate task may be delivered by several plan tasks. Do not plan work that no approved estimate task covers: anything else is a change request, not part of this plan. Tasks whose executor is human are not built by the factory and need no plan task." + (approvedDesign ? " The approved design lists the screens; every screen built by a factory estimate task must be delivered by a plan task that carries that estimate task, and that plan task's fileScope must include the approved screen's file." : "") + (newLook ? " The approved design is a new look: its implementers get design tokens (colours, type, corners, spacing as CSS variables). Put the app's global stylesheet or theme file in the fileScope of the first task that builds a screen, so the tokens are added once and the other screens use them." : ""))] : []),
        // a direct build whose approved design is a new look (a restyle to the client's reference) puts the tokens in once too
        ...(dref ? [S.template("design-scope-lock", "This plan builds an APPROVED DESIGN. Every task delivers requirements of the approved spec (its reqs), and nothing else: anything more is a change to the design, not part of this plan." + (approvedDesign ? " Every approved screen must be delivered by a task that serves its requirements, and that task's fileScope must include the approved screen's file." : ""))] : []),
        ...(!ref && newLook ? [S.template("new-look", "The approved design is a new look: its implementers get design tokens (colours, type, corners, spacing as CSS variables). Put the app's global stylesheet or theme file in the fileScope of the first task that builds a screen, so the tokens are added once and the other screens use them.")] : []),
        ...(scaf?.layout ? [S.artifact("scaffold", "ui-scaffold", scaffoldForPlan(scaf)), S.template("scaffold-rules", `${scaf.layout.fresh ? `The approved design is built in ${scaf.target}: before any task starts, the factory writes the component kit, the theme, the frame and navigation, and every approved page (its blocks, states, layers and text, with the approved sample data) into the repo.` : `The approved design is built in the existing ${scaf.target} app: before any task starts, the factory writes only its genuinely new pages (with the kit and theme they need, when there are any) into the repo; the app keeps its own layout and navigation, and its existing pages are changed in place.`} Those generated files are not in any task's scope.
${scaf.layout.designSystem.files.length ? "- TASK-1 is the design-system task: its fileScope is exactly the ui-scaffold's designSystemTask.fileScope (plus nothing else UI), and its approach is the designSystemTask.todo list." : "- There is no design-system task: nothing is generated, so no wiring is needed."}${scaf.layout.inPlace.length ? "\n- Each screen in ui-scaffold.changeInPlace is an existing page: one task changes its file in place to match the approved design (its fileScope includes that file), using the app's own components; no new page and no new frame." : ""}
- Then one task per screen in ui-scaffold.screens: its fileScope includes that screen's container (and the API or service files the behaviour needs). The task gives the page real data, API calls, validation and the behaviour the requirements ask for, in the container; it does not restyle or rebuild the page.${scaf.changed ? " This is a change to an approved design: only the screens listed changed, so plan only those (and the removed screens' clean-up in the design-system task)." : ""}`)] : []),
        ...(planRejections(ctx.state).length ? [{ spec: { id: "rejection", source: "feedback" as const, trust: "trusted" as const, placement: "user" as const }, content: `The human reviewer rejected the previous plan. Their reasons (latest last):\n${planRejections(ctx.state).map((x) => `- ${x}`).join("\n")}\nThe plan must address them.` }] : []),
        S.task("Write the plan."),
      ],
    });
    if (!r.ok) return r.outcome;
    const plan = { header: header(ctx.runId, "plan", "plan", "", r.model), ...r.output, complexity: complexityOf(r.output) };
    const fs: Failure[] = [];
    const waivable: BuildFailed[] = [];
    for (const m of scaf ? checkPlanScaffold(plan, scaf) : []) fs.push(failure("plan-scaffold", m));
    for (const st of plan.stubs) if (!plan.tasks.some((t) => t.fileScope.some((g) => g === st.path || st.path.startsWith(g.replace(/\*.*$/, ""))))) fs.push(failure("plan-stub", `Stub ${st.path} is outside every task's file scope`));
    const planSha = ctx.ledger.putJson(plan);
    const specSha = ctx.state.steps.get("specify")!.outputs[0]!;
    const g = await runGate(planChecks, ctx.ledger, ctx.writer, { plan: planSha, spec: specSha }, ctx.policy, { step: "plan" });
    // B1 and B2: every plan task maps to an approved estimate task; the requirements are the approved ones
    if (ref) {
      const checks: [GateDef, Record<string, string>][] = [
        [scopeLock, { plan: planSha, breakdown: ref.breakdownSha }],
        [changeRequest, { spec: specSha, approvedSpec: ref.specSha, approvedEstimateSha: ref.estimateSha }],
        // B6: the approved screens are all planned (only when the estimate had a design)
        ...(ref.designSha ? [[screensPlanned, { plan: planSha, breakdown: ref.breakdownSha, design: ref.designSha }] as [GateDef, Record<string, string>]] : []),
        // B7: the plan task that builds an approved screen can touch that screen's file
        // (with a scaffold the page is generated: the task's file is the screen's container)
        ...(ref.designSha ? [[screenScope, { plan: planSha, breakdown: ref.breakdownSha, design: scaf?.layout ? ctx.ledger.putJson(designForScopeGate(ctx.ledger.getJson<{ screens: { id: string; file?: string }[] }>(ref.designSha), scaf)) : ref.designSha }] as [GateDef, Record<string, string>]] : []),
      ];
      for (const [def, inputs] of checks) {
        const res = await runGate(def, ctx.ledger, ctx.writer, inputs, ctx.policy, { step: "plan" });
        if (res.passed) continue;
        const list = res.failures ?? [failure(def.id, res.details)];
        if (WAIVABLE_AT_PLAN.has(def.id)) waivable.push({ def, failures: list });
        else fs.push(...list);
      }
    }
    // B1, B2, B6 and B7 for a build from an approved design: its spec, and its screens through the requirements they serve
    if (dref) {
      const designSha = scaf?.layout ? ctx.ledger.putJson(designForScopeGate(ctx.ledger.getJson<{ screens: { id: string; file?: string }[] }>(dref.designSha), scaf)) : dref.designSha;
      const checks: [GateDef, Record<string, string>][] = [
        [designScopeLock, { plan: planSha, approvedSpec: dref.specSha }],
        [changeRequest, { spec: specSha, approvedSpec: dref.specSha, approvedEstimateSha: dref.designSha }],
        [designScreensPlanned, { plan: planSha, design: designSha }],
      ];
      for (const [def, inputs] of checks) {
        const res = await runGate(def, ctx.ledger, ctx.writer, inputs, ctx.policy, { step: "plan" });
        if (res.passed) continue;
        const list = res.failures ?? [failure(def.id, res.details)];
        if (WAIVABLE_AT_PLAN.has(def.id)) waivable.push({ def, failures: list });
        else fs.push(...list);
      }
    }
    // B1 and B6 can be waived by a lead once the model has had its retry; anything else fails the plan as before
    let waivers: Omit<WaiverRow, "step">[] = [];
    if (waivable.length) {
      const w = !g.failures?.length && !fs.length && ctx.attempt >= WAIVER_AFTER_ATTEMPT && (ref || dref)
        ? buildWaiver(ctx, "plan", waivable, hashJson({ spec: specSha, ...(ref ? { breakdown: ref.breakdownSha } : { design: dref!.designSha }) }), `To stop and change the request instead: factory stop ${ctx.runId}`)
        : undefined;
      if (w?.kind === "ask") return w.outcome;
      if (w?.kind === "waived") waivers = w.waivers;
      else fs.push(...waivable.flatMap((x) => x.failures));
    }
    const all = [...(g.failures ?? []), ...fs];
    if (all.length) return { kind: "fail", category: "other", failures: all, signature: `plan:${all.map((f) => f.check).sort().join(",")}` };
    return { kind: "done", outputs: { plan: planSha }, data: { complexity: plan.complexity, taskCount: plan.tasks.length, tasks: plan.tasks.map((t) => t.id), ...(waivers.length ? { waivers } : {}), ...(scaf ? { uiTarget: scaf.target, ...(scaf.changed ? { changedScreens: scaf.changed } : {}) } : {}) } };
  },
};

// ---------- approval card ----------
export function plannedFiles(plan: PlanT): string[] {
  return [...new Set(plan.tasks.flatMap((t) => t.fileScope))].sort();
}

export function approvalCard(ctx: StepContext, a: { intent: Intent; spec: Spec; plan: PlanT & { complexity: Complexity }; critic: { findings: z.infer<typeof CriticOut>["findings"]; note?: string }; cb: CB; risk: Risk; clar: ReturnType<typeof clarifications>; open: string[]; /** reworks the spec step made (the light lane allows 1) */ repairs?: number; roundTrip?: { droppedSpans: string[]; inventedCapabilities: string[] }; /** design step: UI size line (absent when the plan touches no UI) */ uiSize?: string; /** spec over the size budget: the human decides */ size?: string }): string {
  const grounded = new Set(a.cb.claims.flatMap((c) => c.anchors.map((x) => x.path)));
  const files = plannedFiles(a.plan);
  const notGrounded = files.filter((f) => !grounded.has(f));
  const protectedTouched = files.filter((f) => isConfigIntegrityPath(f)).concat(a.plan.protectedPathsDeclared);
  const lines = [
    `# Approval: ${a.intent.spans[0]?.text.slice(0, 70) ?? ctx.runId}`,
    ``,
    `Run ${ctx.runId} · risk **${a.risk}** · ${a.intent.changeClass} · size ${a.plan.complexity} · cost so far $${ctx.state.costUsd.toFixed(2)}`,
    ``,
    `## Your request (word for word${requestFrom(ctx) ? `, from ${requestFrom(ctx)}` : ""})`,
    ...(ctx.state.info.sources ?? []).filter((s) => s.kind === "jira").map((s) => `Ticket: ${s.url}`),
    ...request(ctx).split("\n").map((l) => `> ${l}`),
    ``,
    ...(a.clar.answers.length ? [``, `## Your answers`, ...a.clar.answers.map((q) => `- ${q.id} ${q.question} → **${q.answer}**${q.by === "default" || q.by === "default-timeout" ? " (default)" : ""}`)] : []),
    ...(a.clar.assumptions.some((x) => x.risk === "high") ? [``, `## Confirm these assumptions (high risk)`, ...a.clar.assumptions.filter((x) => x.risk === "high").map((x) => `- [ ] ${x.id} ${x.text}`)] : []),
    ...(a.clar.assumptions.some((x) => x.risk !== "high") ? [``, `Other assumptions: ${a.clar.assumptions.filter((x) => x.risk !== "high").map((x) => `${x.id} ${x.text}`).join("; ")}`] : []),
    ``,
    `## Requirements`,
    ...a.spec.requirements.map((r) => `- **${r.id}** (${r.op})${r.stability !== undefined && r.stability < 2 / 3 ? " ⚠ only one draft had this" : ""} ${r.ears}\n${r.acceptance.map((c) => `  - ${c.id} [${c.level}] Given ${c.given}; when ${c.when}; then ${c.then}`).join("\n")}`),
    ``,
    ...(() => {
      const manual = a.spec.requirements.flatMap((r) => r.acceptance.filter((c) => c.level === "manual").map((c) => c.id));
      return manual.length ? [`Checked by a person, not by a test: ${manual.join(", ")} (screens and manual checks aren't automated yet)`, ``] : [];
    })(),
    `Not changing: ${a.spec.outOfScope.join("; ") || "(none listed)"}`,
    ``,
    `## Files the plan will touch (${files.length})`,
    ...files.map((f) => `- ${f}${notGrounded.includes(f) ? "  ← not found by grounding; check it" : ""}${protectedTouched.includes(f) ? "  ← protected file" : ""}`),
    ...(a.plan.newDependencies.length ? [``, `New packages: ${a.plan.newDependencies.map((d) => `${d.name} ${d.version}`).join(", ")}`] : []),
    ...(a.uiSize ? [``, a.uiSize] : []),
    ``,
    `## Plan`,
    `Options: ${a.plan.options.map((o) => `${o.id}${o.id === a.plan.chosen ? " (chosen)" : ""}: ${o.summary}`).join(" | ")}`,
    `Decision: ${a.plan.adr}`,
    ...(() => {
      const owners = acOwners(a.plan, a.spec);
      return a.plan.tasks.map((t) => {
        const acs = [...owners.entries()].filter(([, o]) => o === t.id).map(([ac]) => ac);
        return `- ${t.id} ${t.title} → ${t.reqs.join(", ")}${acs.length ? `; must pass ${acs.join(", ")}` : "; builds towards a later task (no criteria of its own)"}`;
      });
    })(),
    ...(a.plan.stubs.length ? [``, `Stub commit (throws NotImplemented until implemented): ${a.plan.stubs.map((s) => s.path).join(", ")}`] : []),
    ``,
    `## Critic findings (${a.critic.findings.length})`,
    ...a.critic.findings.map((f) => `- [${f.severity}] ${f.reqId ?? ""} ${f.finding}`),
    ...(a.critic.note ? [`_${a.critic.note}_`] : []),
    ...(a.open.length ? [``, `## Still open after ${a.repairs ?? 3} repair${a.repairs === 1 ? "" : "s"}`, ...a.open.map((o) => `- ${o}`)] : []),
    ...(a.roundTrip && !a.roundTrip.droppedSpans.length && !a.roundTrip.inventedCapabilities.length ? [``, `Round trip: the spec restated back matches your request (nothing dropped, nothing added).`] : []),
    ...(a.size ? [``, `**${a.size}**`] : []),
    ``,
    `## Decide`,
    `  factory approve ${ctx.runId} <hash> --note "your risk note"`,
    `  factory reject  ${ctx.runId} <hash> --reason "why"`,
  ];
  return lines.join("\n");
}

export const approveStep: StepDef = {
  key: "approve", stage: "approve", templateVersion: "1",
  inputs: (s) => (s.steps.get("plan")?.status === "completed" ? { spec: s.steps.get("specify")!.outputs[0], plan: s.steps.get("plan")!.outputs[0], rejections: planRejections(s) } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const planSha = ctx.state.steps.get("plan")!.outputs[0]!;
    const specSha = ctx.state.steps.get("specify")!.outputs[0]!;
    // the rejection round is part of the card's identity: a rejected card never comes back unchanged
    const round = planRejections(ctx.state).length;
    const bundleSha = ctx.ledger.putJson({ spec: specSha, plan: planSha, round });
    const decision = [...ctx.state.decisions].reverse().find((d) => d.artifactSha === bundleSha);
    if (decision?.decision === "approve") {
      const sha = ctx.ledger.putJson({ header: header(ctx.runId, "approval", "approve", ""), auto: false, reason: "human", decision: "approved", by: decision.by, riskNote: String((decision as unknown as { note?: string }).note ?? ""), bundle: bundleSha });
      return { kind: "done", outputs: { approval: sha } };
    }
    // (a rejection changes the spec and plan inputs, so the spec and plan re-run before we get here again;
    //  the second rejection parks the run through the caps check)
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const md = approvalCard(ctx, {
      intent, spec: requireOutput<Spec>(ctx.state, ctx.ledger, "specify"),
      plan: requireOutput(ctx.state, ctx.ledger, "plan"), critic: requireOutput(ctx.state, ctx.ledger, "specify", "critic"),
      cb: requireOutput<CB>(ctx.state, ctx.ledger, "ground"), risk: intent.risk,
      clar: clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2")),
      open: (ctx.state.steps.get("specify")!.data?.openFindings as string[] | undefined) ?? [],
      repairs: ctx.state.steps.get("specify")!.data?.repairs as number | undefined,
      size: ctx.state.steps.get("specify")!.data?.sizeNote as string | undefined,
      roundTrip: requireOutput<{ roundTrip?: { droppedSpans: string[]; inventedCapabilities: string[] } }>(ctx.state, ctx.ledger, "specify").roundTrip,
      uiSize: uiSizeForCard(snapshotFor(ctx), plannedFiles(requireOutput<PlanT>(ctx.state, ctx.ledger, "plan"))),
    });
    const card = `${md}\n\nCard hash: ${bundleSha.slice(0, 8)}`;
    return { kind: "wait", card: { cardId: `approval-${bundleSha.slice(0, 8)}`, kind: "approval", artifactSha: bundleSha, markdown: card } };
  },
};

export { readOutput };
