// Spec side of the brownfield slice: intake → ground → specify (+lint, critic) → plan → approval card.
import { z } from "zod";
import { parse } from "yaml";
import {
  DataModel, CurrentBehaviourBody, IntentBody, maxRisk, PlanBody, type Risk, SpecDraft, type Complexity, type Failure, type SettledProblem,
} from "../contracts/index.js";
import { checkEvidence } from "../context/tools.js";
import { buildRepoMap } from "../context/repomap.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractProblems, contractReadProblem, contractSummary, readContract } from "../gates/contract.js";
import { DATA_MODEL_FILE, dataModelBrief, dataModelProblems, dataModelSummary, erdMermaid, mergeDataModel, nearModel, withKnown } from "../gates/data-model.js";
import { failure } from "../gates/engine.js";
import { anchorsResolve, planChecks } from "../gates/predicates.js";
import { isConfigIntegrityPath } from "../gates/protected.js";
import { runGate, type GateDef } from "../gates/engine.js";
import { hashJson } from "../util/hash.js";
import { approvedDesignFor } from "./design-inputs.js";
import { header, lastFailureData, outputOf, planRejections, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { acOwners, slicesProblem } from "./build.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { gateNotes } from "./gate-questions.js";
import { settledText } from "./settle.js";
import { CriticOut } from "./specpipe.js";
import { describeSources } from "../sources/request.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";
import { applyPlanPatch, PATCH_RULES, PlanPatch } from "./plan-patch.js";
import { snapshotFor, toolsFor } from "./workspace.js";
import { uiSizeForCard } from "../design/card.js";
import { complexityOf, LANE, lightSpec } from "./lane.js";
import { changeRequest, scopeLock } from "../estimate/gates.js";
import { designScopeLock, designScreensPlanned, screenScope, screensPlanned } from "../design/gates.js";
import { buildWaiver, type BuildFailed } from "../estimate/build-waiver.js";
import type { WaiverRow } from "../estimate/log.js";
import { WAIVER_AFTER_ATTEMPT } from "./waiver.js";
import type { Breakdown } from "../contracts/index.js";
import { affectsLines, planCoverageFailures, planNote, readImpact } from "./impact.js";
import { dependencyKind, planIntro, stubRule } from "./stack-text.js";
import { checkPlanScaffold, designForScopeGate, scaffoldForPlan, scaffoldOfRun } from "./scaffold-run.js";

type Intent = z.infer<typeof IntentBody>;
type CB = z.infer<typeof CurrentBehaviourBody>;
type Spec = z.infer<typeof SpecDraft>;
type PlanT = z.infer<typeof PlanBody>;

// ---------- risk rules (intake: risk = max(rules, model)) ----------
/** Build gates a lead may waive at the plan: B1 (scope lock) and B6 (screens planned). B2 goes through a change request. */
/** patches in a row before the planner is asked for a whole plan again */
const MAX_PLAN_PATCHES = 2;
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
      // the API side of a full-stack product (a .NET project held to a contract) has no screens of its own, whatever the
      // product's request says about them: its web app is designed and built in its own repo
      touchesUi: ctx.project.stack === "dotnet" && !!ctx.project.contract?.built ? false : r.output.touchesUi || ruleUi(request(ctx)),
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

/** What the plan is asked for when it writes the product's API contract. */
/**
 * Whether the plan must give a data model: the first build of a new product's backend (its API has a contract and the repo
 * has no model yet), or a change to a backend that touches stored data. Any other backend plan may give one; a web app never does.
 */
export function needsDataModel(project: { stack?: string; contract?: unknown }, impact: { entities?: string[] } | undefined, hasModel: boolean): boolean {
  return project.stack !== "node" && ((!!project.contract && !hasModel) || !!impact?.entities?.length);
}

const dataModelRules = (required: boolean, touched: string[], existing = false): string => `DATA MODEL${required ? "" : " (only when this plan adds or changes stored data)"}. Give "dataModel": ${existing ? "only the tables this plan adds or changes" : "the tables this plan sets up or changes"}, as the database will hold them. A person approves it as a diagram with the plan, the factory keeps it in ${DATA_MODEL_FILE}, and after every build the database the code creates is compared with it: a missing table, a different key or a different relation fails the task.
- Each table: name, purpose (one line), and every column with its type (string, text, int, long, decimal, bool, date, datetime, time, uuid, json, enum), required (false when it may be empty), pk on the primary-key column(s), unique where no two rows may share the value, values for an enum.
- A relation is a foreign key: "references" on the column that holds it, naming the table and column it points at (a primary key or a unique column of the same type), and onDelete where it matters. A many-to-many relation is its own table with a foreign key to each side. A key over several columns together goes in the table's "uniques".
- Every table has a primary key. Use the names the code will use for the tables and columns.
- Model what is stored, not what the API returns: a field worked out on each request has no column.${existing ? `
- This is an existing backend and its database is shown below, read from the tables the untouched code creates. Give a table only when this plan adds it, or adds, alters or removes a column or key of it (then list all its columns, as they will be). Leave every other table out: the factory adds them from the database and works out itself which tables are new, changed or unchanged. Point a foreign key at an existing table by the table and column names shown.${touched.length ? ` The stored data this change touches: ${touched.join(", ")}.` : ""}
- When the plan changes no stored data, give no dataModel.` : touched.length ? `
- This is an existing backend. Mark each table "change": "new" (this plan adds it), "changed" (this plan adds or alters columns or keys; list all its columns, as they will be) or "unchanged" (only pointed at by a foreign key; its key columns are enough). The stored data this change touches: ${touched.join(", ")}.` : ""}
- No task writes ${DATA_MODEL_FILE}: it is the factory's file. Put the entities, the database setup and any migration in the fileScope of the first task that uses each table.`;

const contractRules = (file: string): string => `API CONTRACT. This product has a web app and an API in two repos, and both are built against one contract.
- Give one more stub: path "${file}", content the full OpenAPI 3.0.3 document (YAML) of every operation the approved screens and requirements need. It is outside every task's fileScope: nobody implements it, both sides follow it.
- Every operation has an operationId (camelCase), its request body where it takes one, and every status code it answers with.
- Schemas go under components/schemas with "required" lists. Take the field names and types from the approved screens' sample data; an id is an integer.
- Every JSON response carries an "example" with believable data (the approved screens' sample rows): the web app's tests run against these examples.
- The web app calls the API only through the client generated from this file (lib/api); do not plan a hand-written client.`;

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
    // a full-stack product's API contract (the project's `contract`): the repo's own when it has one (locked: the plan follows it),
    // otherwise this plan writes it, a person approves it on the card and it is locked with the tests
    const cfile = ctx.project.contract?.file;
    const lockedContract = cfile && snap.files.includes(cfile) ? readFileSync(join(snap.root, cfile), "utf8") : undefined;
    const approvedTasks = ref ? ctx.ledger.getJson<Breakdown>(ref.breakdownSha).tasks : [];
    const map = buildRepoMap(snap.root, snap.files, { budgetTokens: 4000, focus: cb.claims.flatMap((c) => c.anchors.map((a) => a.path)) }).map;
    const impact = readImpact(ctx.state, ctx.ledger);
    const impactNote = impact ? planNote(impact) : "";
    // a backend's data model: required where the plan sets up or changes stored data, and the repo's current one is shown
    const currentModel = snap.files.includes(DATA_MODEL_FILE) ? readFileSync(join(snap.root, DATA_MODEL_FILE), "utf8") : undefined;
    // an existing backend's database as discover read it (the tables the untouched code creates), with what the repo's approved
    // model knows better; the plan states its changes and the factory lays them over this
    const read = ctx.project.stack !== "node" ? readOutput<{ model?: DataModel }>(ctx.state, ctx.ledger, "discover", "schema")?.model : undefined;
    const known = (() => { try { const m = currentModel ? DataModel.safeParse(parse(currentModel)) : undefined; return m?.success ? m.data : undefined; } catch { return undefined; } })();
    const existingModel = read?.tables.length ? withKnown(read, known) : undefined;
    const modelRequired = needsDataModel(ctx.project, impact, !!currentModel || !!existingModel);
    const sections = [
      S.template("tpl", `${planIntro(ctx.project.stack)}
- Give at least 2 options (one marked simplest), choose one, and write a decision record of at most 5 lines (adr).
- Split into tasks TASK-1.. in dependency order. Each task: the requirements it delivers, fileScope (exact repo paths or narrow globs it may change, no overlap between tasks), 1-2 exemplar files to imitate, plannedLoc, approach (short instructions for the implementer).
- Build in working slices, not layers. A criterion checked through the API or a screen passes only once that route or screen is wired, so the first task that adds a route or screen also wires the app's entry (the startup file, the router, the layout), and each later task adds its logic together with its own endpoint or screen. Code a slice needs (an entity, a helper) goes into the first slice that uses it, not into a task of its own. File scopes may not overlap, so have that first task register routes by convention (file-based routes, or every class of one kind found at startup): later tasks then add only their own files.
- List a requirement on the task after which its criteria can pass. Do not leave the wiring to a last task that then holds every criterion checked through the app: each earlier task is then checked only there, in the longest and dearest task of the run. Only where the repo's structure forces layers, give the wiring task a dependsOn on every layer it serves.
- dependsOn: only the tasks whose code this task really needs.
- Test projects, test files and CI config are not in any file scope: tests are written separately.
- stubs: for every NEW public type/method/endpoint the tests will call, give a compilable stub file (full file content) whose bodies ${stubRule(ctx.project.stack)}, so tests compile before implementation. Existing APIs need no stubs. Stub paths must be inside a task's fileScope.
- protectedPathsDeclared: list any migration, CI, build-config or package-feed file you must change (a human will see it).
- newDependencies: any ${dependencyKind(ctx.project.stack)} package to add (name, version, registry). Prefer none.`),
      S.profile("repomap", `Repository map:\n${map}`),
      S.artifact("spec", "spec", spec),
      S.artifact("cb", "current-behaviour", cb),
      S.artifact("critic", "critic", critic),
      ...(approvedDesign ? [S.artifact("approved-design", "approved-design", approvedDesign)] : []),
      ...(impactNote ? [S.template("impact", impactNote)] : []),
      ...(lockedContract ? [S.template("contract-locked", `API CONTRACT (locked, ${cfile}). The API and the web app are both held to this OpenAPI document: plan exactly its operations, with its paths, status codes and field names. Do not change the file and do not give a stub for it; a needed change to it is a change request.\n\n${lockedContract}`)]
        : cfile ? [S.template("contract-new", contractRules(cfile))] : []),
      ...(ctx.project.stack !== "node" ? [S.template("data-model", dataModelRules(modelRequired, impact?.entities ?? [], !!existingModel))] : []),
      // a change the impact step found to touch no stored data (a fix in logic, say) gets the tables by name and key only
      ...(existingModel ? [S.template("data-model-existing", `The database as it is now (${existingModel.tables.length} table${existingModel.tables.length === 1 ? "" : "s"}; "?" may be empty, "→" is a foreign key). Column types are as the database stores them, so read an entity where the exact type matters:\n\n${dataModelBrief(existingModel, impact?.entities ?? [], impact && !impact.entities.length ? 0 : undefined).map((l) => `- ${l}`).join("\n")}`)]
        : currentModel ? [S.template("data-model-current", `The data model approved so far (${DATA_MODEL_FILE}); your dataModel replaces it, so carry over the tables you point at:\n\n${currentModel}`)] : []),
      ...(ref ? [S.artifact("estimate-tasks", "approved-estimate-tasks", approvedTasks.map((t) => ({ id: t.id, title: t.title, reqs: t.reqs, track: t.track, executor: t.executor, items: t.items }))), S.template("scope-lock", "This plan delivers an APPROVED ESTIMATE. Set estimateTaskId on every task to the approved estimate task (EST-n) it delivers; one estimate task may be delivered by several plan tasks. Do not plan work that no approved estimate task covers: anything else is a change request, not part of this plan. Tasks whose executor is human are not built by the factory and need no plan task." + (cfile && ctx.project.stack === "node" ? " This app is the web side of a product whose API is built by its own run against the API contract: the backend estimate tasks are delivered there, so put the operations they need in the contract and plan no server code for them in this app." : "") + (approvedDesign ? " The approved design lists the screens; every screen built by a factory estimate task must be delivered by a plan task that carries that estimate task, and that plan task's fileScope must include the approved screen's file." : "") + (newLook ? " The approved design is a new look: its implementers get design tokens (colours, type, corners, spacing as CSS variables). Put the app's global stylesheet or theme file in the fileScope of the first task that builds a screen, so the tokens are added once and the other screens use them." : ""))] : []),
      // a direct build whose approved design is a new look (a restyle to the client's reference) puts the tokens in once too
      ...(dref ? [S.template("design-scope-lock", "This plan builds an APPROVED DESIGN. Every task delivers requirements of the approved spec (its reqs), and nothing else: anything more is a change to the design, not part of this plan." + (approvedDesign ? " Every approved screen must be delivered by a task that serves its requirements, and that task's fileScope must include the approved screen's file." : ""))] : []),
      ...(!ref && newLook ? [S.template("new-look", "The approved design is a new look: its implementers get design tokens (colours, type, corners, spacing as CSS variables). Put the app's global stylesheet or theme file in the fileScope of the first task that builds a screen, so the tokens are added once and the other screens use them.")] : []),
      ...(scaf?.layout ? [S.artifact("scaffold", "ui-scaffold", scaffoldForPlan(scaf)), S.template("scaffold-rules", `${scaf.layout.fresh ? `The approved design is built in ${scaf.target}: before any task starts, the factory writes the component kit, the theme, the frame and navigation, and every approved page (its blocks, states, layers and text, with the approved sample data) into the repo.` : `The approved design is built in the existing ${scaf.target} app: before any task starts, the factory writes only its genuinely new pages (with the kit and theme they need, when there are any) into the repo; the app keeps its own layout and navigation, and its existing pages are changed in place.`} Those generated files are not in any task's scope.
${scaf.layout.designSystem.files.length ? "- TASK-1 is the design-system task: its fileScope is exactly the ui-scaffold's designSystemTask.fileScope (plus nothing else UI), and its approach is the designSystemTask.todo list." : "- There is no design-system task: nothing is generated, so no wiring is needed."}${scaf.layout.inPlace.length ? "\n- Each screen in ui-scaffold.changeInPlace is an existing page: one task changes its file in place to match the approved design (its fileScope includes that file), using the app's own components; no new page and no new frame." : ""}
- Then one task per screen in ui-scaffold.screens: its fileScope includes that screen's container (and the API or service files the behaviour needs). The task gives the page real data, API calls, validation and the behaviour the requirements ask for, in the container; it does not restyle or rebuild the page.${scaf.changed ? " This is a change to an approved design: only the screens listed changed, so plan only those (and the removed screens' clean-up in the design-system task)." : ""}`)] : []),
      ...(planRejections(ctx.state).length ? [{ spec: { id: "rejection", source: "feedback" as const, trust: "trusted" as const, placement: "user" as const }, content: `The human reviewer rejected the previous plan. Their reasons (latest last):\n${planRejections(ctx.state).map((x) => `- ${x}`).join("\n")}\nThe plan must address them.` }] : []),
    ];
    const call = { stage: "plan" as const, route: "plan", cls: "read-large" as const, budgetTokens: 30000, tools: ["read_file", "search", "repo_map"] as ("read_file" | "search" | "repo_map")[], repoTools: toolsFor(ctx), maxTurns: 12 };
    // a plan that failed its checks is fixed by a patch (src/stages/plan-patch.ts); a patch that cannot be read or applied, or a
    // second patch that still fails, goes back to a whole plan
    const before = lastFailureData(ctx.ledger, "plan") as { rejectedPlan?: string; patches?: number } | undefined;
    const rejected = before?.rejectedPlan && (before.patches ?? 0) < MAX_PLAN_PATCHES && ctx.priorFailures.length ? PlanBody.safeParse(ctx.ledger.getJson(before.rejectedPlan)) : undefined;
    let r: { ok: true; output: z.infer<typeof PlanBody>; model: string; forget?: () => void } | undefined;
    if (rejected?.success) {
      const pr = await think(ctx, { ...call, label: "plan (patch)", schema: PlanPatch, sections: [...sections, S.template("patch-rules", PATCH_RULES), S.artifact("previous-plan", "plan", rejected.data), S.task("Return the changes that fix the failures.")] });
      if (!pr.ok && (pr.outcome.kind !== "fail" || pr.outcome.category === "rate-limit")) return pr.outcome;
      const applied = pr.ok ? applyPlanPatch(rejected.data, pr.output) : undefined;
      if (pr.ok && applied && "plan" in applied) r = { ok: true, output: applied.plan, model: pr.model };
      else ctx.log(`plan: the patch ${applied && "problem" in applied ? `cannot be applied (${applied.problem})` : "was not returned"}, writing the whole plan again`);
    }
    const patched = !!r;
    if (!r) {
      const full = await think(ctx, { ...call, schema: PlanBody, sections: [...sections, S.task("Write the plan.")] });
      if (!full.ok) return full.outcome;
      r = full;
    }
    // an existing backend: the model kept is the whole database, the plan's tables laid over the ones read from it
    const dataModel = existingModel && r.output.dataModel ? mergeDataModel(existingModel, r.output.dataModel) : r.output.dataModel;
    const plan = { header: header(ctx.runId, "plan", "plan", "", r.model), ...r.output, ...(dataModel ? { dataModel } : {}), complexity: complexityOf(r.output) };
    const fs: Failure[] = [];
    const waivable: BuildFailed[] = [];
    for (const m of scaf ? checkPlanScaffold(plan, scaf) : []) fs.push(failure("plan-scaffold", m));
    const contractStub = cfile ? plan.stubs.find((st) => st.path === cfile) : undefined;
    if (lockedContract && contractStub) fs.push(failure("plan-contract", `${cfile} is the locked API contract: the plan may not rewrite it. Drop its stub.`));
    if (cfile && !lockedContract) {
      const doc = contractStub ? readContract(contractStub.content) : undefined;
      if (!contractStub) fs.push(failure("plan-contract", `No stub for the API contract. Give ${cfile} as a stub: the full OpenAPI 3.0 document of every operation the screens call.`));
      else if (!doc) fs.push(failure("plan-contract", `${cfile} is not an OpenAPI document: ${contractReadProblem(contractStub.content) ?? 'it needs "openapi" and "paths"'}.`));
      else fs.push(...contractProblems(doc).map((m) => failure("plan-contract", m)));
    }
    if (ctx.project.stack === "node" && plan.dataModel) fs.push(failure("plan-data-model", "A web app has no data model of its own: its data comes from the API. Drop dataModel."));
    else if (modelRequired && !plan.dataModel) fs.push(failure("plan-data-model", `No data model. Give dataModel: every table this plan sets up or changes, with its columns, primary key and foreign keys${impact?.entities?.length ? ` (the change touches ${impact.entities.join(", ")})` : ""}.`));
    else if (plan.dataModel) fs.push(...dataModelProblems(plan.dataModel).map((m) => failure("plan-data-model", m)));
    for (const t of plan.tasks) if (t.fileScope.includes(DATA_MODEL_FILE)) fs.push(failure("plan-data-model", `${t.id} has ${DATA_MODEL_FILE} in its fileScope: the factory writes that file from dataModel. Take it out.`));
    for (const st of plan.stubs) if (st.path === DATA_MODEL_FILE) fs.push(failure("plan-data-model", `${DATA_MODEL_FILE} is the factory's file: give the model as dataModel and drop the stub.`));
    for (const st of plan.stubs) if (st.path !== cfile && st.path !== DATA_MODEL_FILE && !plan.tasks.some((t) => t.fileScope.some((g) => g === st.path || st.path.startsWith(g.replace(/\*.*$/, ""))))) fs.push(failure("plan-stub", `Stub ${st.path} is outside every task's file scope`));
    if (impact) fs.push(...planCoverageFailures(plan, impact));
    // asked once: where the approved tasks or the repo force layers, the plan runs as it is
    const asked = ctx.ledger.events().some((e) => e.type === "step.failed" && String(e.key).startsWith("plan/") && String((e.data as { signature?: string } | undefined)?.signature).includes("plan-slices"));
    const slices = asked ? undefined : slicesProblem(plan, spec, ctx.project.stack);
    if (slices) fs.push(failure("plan-slices", slices));
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
      // a build's design reference always holds the design (only a resized estimate's may not)
      const approvedSha = dref.designSha!;
      const designSha = scaf?.layout ? ctx.ledger.putJson(designForScopeGate(ctx.ledger.getJson<{ screens: { id: string; file?: string }[] }>(approvedSha), scaf)) : approvedSha;
      const checks: [GateDef, Record<string, string>][] = [
        [designScopeLock, { plan: planSha, approvedSpec: dref.specSha }],
        [changeRequest, { spec: specSha, approvedSpec: dref.specSha, approvedEstimateSha: approvedSha }],
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
    if (all.length) {
      r.forget?.();
      return { kind: "fail", category: "other", failures: all, signature: `plan:${all.map((f) => f.check).sort().join(",")}`, data: { rejectedPlan: ctx.ledger.putJson(r.output), patches: patched ? (before?.patches ?? 0) + 1 : 0 } };
    }
    return { kind: "done", outputs: { plan: planSha }, data: { complexity: plan.complexity, taskCount: plan.tasks.length, tasks: plan.tasks.map((t) => t.id), ...(waivers.length ? { waivers } : {}), ...(scaf ? { uiTarget: scaf.target, ...(scaf.changed ? { changedScreens: scaf.changed } : {}) } : {}) } };
  },
};

// ---------- approval card ----------
export function plannedFiles(plan: PlanT): string[] {
  return [...new Set(plan.tasks.flatMap((t) => t.fileScope))].sort();
}

export function approvalCard(ctx: StepContext, a: { intent: Intent; spec: Spec; plan: PlanT & { complexity: Complexity }; critic: { findings: z.infer<typeof CriticOut>["findings"]; note?: string }; cb: CB; risk: Risk; clar: ReturnType<typeof clarifications>; open: string[]; /** reworks the spec step made (the light lane allows 1) */ repairs?: number; roundTrip?: { droppedSpans: string[]; inventedCapabilities: string[] }; /** design step: UI size line (absent when the plan touches no UI) */ uiSize?: string; /** spec over the size budget: the human decides */ size?: string; /** ripple effects outside the plan (impact step) */ affects?: string[]; /** spec problems and failing design checks settled by questions, and what was carried as an open risk */ settled?: string[] }): string {
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
      return manual.length ? [`Checked by a person, not by a test: ${manual.join(", ")} (each needs a person's sign-off before delivery)`, ``] : [];
    })(),
    `Not changing: ${a.spec.outOfScope.join("; ") || "(none listed)"}`,
    ``,
    `## Files the plan will touch (${files.length})`,
    ...files.map((f) => `- ${f}${notGrounded.includes(f) ? "  ← not found by grounding; check it" : ""}${protectedTouched.includes(f) ? "  ← protected file" : ""}`),
    ...(a.plan.newDependencies.length ? [``, `New packages: ${a.plan.newDependencies.map((d) => `${d.name} ${d.version}`).join(", ")}`] : []),
    ...(a.uiSize ? [``, a.uiSize] : []),
    ...(a.affects?.length ? [``, `## Will also affect (found by code search, not in the plan)`, ...a.affects] : []),
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
    ...(() => {
      const cfile = ctx.project?.contract?.file;
      const stubs = a.plan.stubs.filter((s) => s.path !== cfile);
      const doc = cfile ? readContract(a.plan.stubs.find((s) => s.path === cfile)?.content ?? "") : undefined;
      return [
        ...(stubs.length ? [``, `Stub commit (throws NotImplemented until implemented): ${stubs.map((s) => s.path).join(", ")}`] : []),
        // approving the plan approves the contract: from then on it is locked with the tests, for the API and the web app alike
        ...(doc ? [``, `## API contract (${cfile}; locked with the tests once you approve)`, ...contractSummary(doc).map((l) => `- ${l}`)] : []),
        // approving the plan approves the data model too: the built database is compared with it after every build
        ...(a.plan.dataModel ? (() => {
          // an existing backend: the tables this plan adds or changes and the ones joined to them; the whole database is on the Data model page
          const near = nearModel(a.plan.dataModel);
          return [``, `## Data model (${DATA_MODEL_FILE}; ${a.plan.dataModel.tables.length} table${a.plan.dataModel.tables.length === 1 ? "" : "s"}, locked with the tests once you approve)`,
            ...(near.others ? [`Shown: the tables this plan adds or changes and the tables joined to them. ${near.others} other table${near.others === 1 ? " stays" : "s stay"} as ${near.others === 1 ? "it is" : "they are"}; the whole database is on the run's Data model page.`, ``] : []),
            ...dataModelSummary(near.model).map((l) => `- ${l}`), ``, "```mermaid", erdMermaid(near.model), "```"];
        })() : []),
      ];
    })(),
    ``,
    `## Critic findings (${a.critic.findings.length})`,
    ...a.critic.findings.map((f) => `- [${f.severity}] ${f.reqId ?? ""} ${f.finding}`),
    ...(a.critic.note ? [`_${a.critic.note}_`] : []),
    ...(a.open.length ? [``, `## Still open after ${a.repairs ?? 3} repair${a.repairs === 1 ? "" : "s"}`, ...a.open.map((o) => `- ${o}`)] : []),
    ...(a.settled?.length ? [``, `## Settled by questions, and open risks`, ...a.settled.map((x) => `- ${x}`)] : []),
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
    const impact = readImpact(ctx.state, ctx.ledger);
    const md = approvalCard(ctx, {
      intent, spec: requireOutput<Spec>(ctx.state, ctx.ledger, "specify"),
      plan: requireOutput(ctx.state, ctx.ledger, "plan"), critic: requireOutput(ctx.state, ctx.ledger, "specify", "critic"),
      cb: requireOutput<CB>(ctx.state, ctx.ledger, "ground"), risk: impact?.risk ?? intent.risk,
      clar: clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2")),
      open: (ctx.state.steps.get("specify")!.data?.openFindings as string[] | undefined) ?? [],
      repairs: ctx.state.steps.get("specify")!.data?.repairs as number | undefined,
      size: ctx.state.steps.get("specify")!.data?.sizeNote as string | undefined,
      roundTrip: requireOutput<{ roundTrip?: { droppedSpans: string[]; inventedCapabilities: string[] } }>(ctx.state, ctx.ledger, "specify").roundTrip,
      uiSize: uiSizeForCard(snapshotFor(ctx), plannedFiles(requireOutput<PlanT>(ctx.state, ctx.ledger, "plan"))),
      ...(impact ? { affects: affectsLines(impact, plannedFiles(requireOutput<PlanT>(ctx.state, ctx.ledger, "plan"))) } : {}),
      settled: [...(requireOutput<{ settled?: SettledProblem[] }>(ctx.state, ctx.ledger, "specify").settled ?? []).map(settledText), ...gateNotes(ctx.ledger, ctx.state, "approve")],
    });
    const card = `${md}\n\nCard hash: ${bundleSha.slice(0, 8)}`;
    return { kind: "wait", card: { cardId: `approval-${bundleSha.slice(0, 8)}`, kind: "approval", artifactSha: bundleSha, markdown: card } };
  },
};

export { readOutput };
