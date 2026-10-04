// Starting a run from `factory ui`: exactly what `factory start` does (loadProject, checkRoutes,
// gatherRequest, createRun), then the executor runs in the background like the MCP start.
// An uploaded file is written to a private temp folder under its own name and read by
// gatherRequest like `--file`; a Jira key goes through gatherRequest like `--jira`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join } from "node:path";
import { ensureStandaloneProject, loadProject, STANDALONE_PROJECT } from "../config/project.js";
import type { Estimate } from "../contracts/estimate.js";
import { DecisionError, decide } from "../ledger/human.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { costCapUsd, MIN_CAP_USD } from "../ledger/caps.js";
import { parseEstimateSettings } from "../estimate/settings.js";
import { checkUploadedFrames, describeSources, gatherRequest, MAX_ESTIMATE_REQUEST_BYTES } from "../sources/request.js";
import { MAX_REFERENCES, RefRole } from "../contracts/reference.js";
import { describeReferences, gatherReferences, MAX_REF_FILE_BYTES, type GatheredRef, type RefRequest } from "../sources/refs.js";
import { MAX_DOCX_BYTES } from "../sources/request.js";
import { jiraFetcherFor } from "../sources/jira.js";
import { runDetached } from "../stages/background.js";
import { createRun } from "../stages/executor.js";
import { exportSeededNow } from "../stages/design-export.js";
import { uiTargetOption, type UiTarget } from "../design/kit/index.js";
import { parseFormats, type ExportFormat } from "../design/export.js";
import { approvedDesign, approvedEstimate, designFitsProject, type Approved, type ApprovedDesign } from "../estimate/lineage.js";
import { greenfieldRefusal } from "../config/greenfield.js";
import { checkRoutes, DESIGN_ROUTES, ESTIMATE_ROUTES } from "../stages/routing.js";
import { factoryHome } from "../util/paths.js";
import { busyRun, projectNames } from "./data.js";

export class StartError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface StartInput {
  project?: unknown;
  prompt?: unknown;
  file?: unknown; // { name, text }
  jira?: unknown;
  maxCost?: unknown;
  /** "estimate" starts an estimate run (factory estimate), "design" a design-only run (factory design start); anything else is a brownfield build */
  mode?: unknown;
  /** estimate settings, read like the factory estimate flags */
  estimate?: unknown;
  /** design-only settings: { noRepo, client, projectName } */
  design?: unknown;
  /** estimate and design runs: design frames as [{ name, data: base64 }], like a folder given to --frames */
  frames?: unknown;
  /** a build from an approved estimate run (factory start --from-estimate): the request comes from the estimate */
  fromEstimate?: unknown;
  /** design references, any mode, like --ref: [{ kind: "file", name, data: base64 } | { kind: "url", url }] each with role? and note? */
  refs?: unknown;
  /** formats to export as soon as the design is approved, like --design-export: ["png", "pdf"] */
  designExport?: unknown;
  /** an approved design-only run to size (estimate) or build (brownfield), like --from-design: its request and design carry over */
  fromDesign?: unknown;
  /** estimate runs: a change request to an approved estimate, like --revises (new requirements; the card shows what changed) */
  revises?: unknown;
  /** no longer taken: estimates are solely agentic, so there is no other delivery model to size again (refused, with why) */
  fromRun?: unknown;
  /** estimate and design runs: ask the model again instead of reusing stored answers, like --fresh */
  fresh?: unknown;
  /** a build: the stack the approved design is built in when the project sets none, like --ui-target */
  uiTarget?: unknown;
}

export interface StartDeps {
  /** runs the executor in the background (tests pass a stub); `fresh` skips the stored model answers (--fresh) */
  execute?: (runId: string, opts?: { fresh?: boolean }) => void;
  gather?: typeof gatherRequest;
  /** reads the design references (tests pass a stub) */
  gatherRefs?: typeof gatherReferences;
  /** exports a run's already-approved design at once (a build from an estimate); the server runs it as an export job */
  exportNow?: (runId: string, formats: ExportFormat[]) => void;
}

/** All reference files of one start together (the page checks the same): the request body stays well under its limit. */
export const MAX_REF_UPLOAD_BYTES = 50_000_000;
const NOTE_MAX = 500;

/**
 * The references sent by the page, checked before anything is read: at most 12, a file's name and size, an https link,
 * a role from the list, a short note. The same limits as --ref; reading them is gatherReferences, as on the command line.
 */
export function checkUploadedRefs(raw: unknown): RefRequest[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new StartError("The design references couldn't be read.");
  if (raw.length > MAX_REFERENCES) throw new StartError(`${raw.length} design references; a run takes at most ${MAX_REFERENCES}.`);
  let total = 0;
  return raw.map((x, i): RefRequest => {
    const r = (x ?? {}) as Record<string, unknown>;
    const at = `Design reference ${i + 1}`;
    const role = r.role === undefined || r.role === "" || r.role === "auto" ? undefined : RefRole.safeParse(r.role).data;
    if (r.role !== undefined && r.role !== "" && r.role !== "auto" && !role) throw new StartError(`${at}: the role must be auto, match, inspire or layout.`);
    const note = typeof r.note === "string" ? r.note.trim() : "";
    if (note.length > NOTE_MAX) throw new StartError(`${at}: the note is over ${NOTE_MAX} characters.`);
    const extra = { ...(role ? { role } : {}), ...(note ? { note } : {}) };
    if (r.kind === "url") {
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!/^https:\/\/[^\s]{3,2000}$/i.test(url)) throw new StartError(`${at}: give an https link to a website or a Figma file.`);
      return { kind: "url", url, ...extra };
    }
    if (r.kind !== "file" || typeof r.name !== "string" || typeof r.data !== "string") throw new StartError(`${at} couldn't be read.`);
    const name = basename(r.name.replace(/\\/g, "/"));
    if (!/^[^\0/]{1,120}$/.test(name) || name.startsWith(".")) throw new StartError(`${at}: the file name is not usable.`);
    const bytes = Buffer.from(r.data, "base64");
    if (!bytes.length) throw new StartError(`${name} is empty.`);
    const cap = /\.docx$/i.test(name) ? MAX_DOCX_BYTES : MAX_REF_FILE_BYTES;
    if (bytes.length > cap) throw new StartError(`${name} is over ${cap / 1e6} MB.`);
    total += bytes.length;
    if (total > MAX_REF_UPLOAD_BYTES) throw new StartError(`The reference files come to over ${MAX_REF_UPLOAD_BYTES / 1e6} MB together. Attach fewer, or link the site or Figma file instead.`);
    return { kind: "file", name, bytes, ...extra };
  });
}

/** The highest normal cost limit (a large change). --max-cost can only lower the limit, so more than this is refused. */
export const HIGHEST_NORMAL_CAP_USD = Math.max(MIN_CAP_USD, ...(["S", "M", "L"] as const).map((c) => costCapUsd(undefined, c)));

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

// a project that just started a run counts as busy until its executor holds the lock
const starting = new Map<string, { runId: string; at: number }>();

export async function startRun(input: StartInput, deps: StartDeps = {}): Promise<{ runId: string; from: string }> {
  const designing = input.mode === "design";
  // an estimate and a design-only run both start from requirements: no project needed, frames allowed
  const estimating = input.mode === "estimate" || designing;

  // what the run starts from besides requirements: the same choices, and the same refusals, as the command line
  const fromDesignId = str(input.fromDesign)?.trim(), revisesId = str(input.revises)?.trim();
  if (str(input.fromRun)?.trim()) throw new StartError("Estimates are solely agentic now, so there is no other delivery model to size an approved estimate under. Start a change request or a new estimate instead.");
  if (designing && (fromDesignId || revisesId)) throw new StartError("A design run starts from requirements. To size or build an approved design, start an estimate or a build from it.");
  if (!estimating && revisesId) throw new StartError("A change request is an estimate: start it under New run, Estimate.");
  if ([fromDesignId, revisesId, str(input.fromEstimate)?.trim()].filter(Boolean).length > 1) throw new StartError("Start from one thing at a time: an approved design or an estimate to change.");
  const asked = !!(str(input.prompt)?.trim() || input.file || str(input.jira)?.trim() || (Array.isArray(input.frames) && input.frames.length));
  const refsGiven = Array.isArray(input.refs) && input.refs.length > 0;
  let fromDesign: ApprovedDesign | undefined;
  if (fromDesignId) {
    if (asked) throw new StartError("An approved design brings its own requirements. Clear the request, file, Jira key and frames.");
    if (refsGiven) throw new StartError("This follows the design approved in that run; remove the design references. To change the design, start a new design run with them.");
    try { fromDesign = approvedDesign(fromDesignId); } catch (err) { throw new StartError((err as Error).message); }
  }
  let change: Approved | undefined;
  if (revisesId) try { change = approvedEstimate(revisesId); } catch (err) { throw new StartError((err as Error).message); }
  // a run made from another one belongs to that one's project, unless a different one was picked
  const seededFrom = fromDesign?.project ?? (change ? replay(Ledger.open(change.runId).events()).info.project : undefined);
  const picked = str(input.project);
  if (estimating && seededFrom && picked && picked !== STANDALONE_PROJECT && picked !== seededFrom) {
    throw new StartError(`That run is for project ${seededFrom === STANDALONE_PROJECT ? "none (requirements only)" : seededFrom}, not ${picked}.`);
  }
  if (!estimating && fromDesign && !designFitsProject(fromDesign, picked)) throw new StartError(`${fromDesign.runId} was designed for project ${fromDesign.project}, not ${picked ?? "none"}.`);
  const wanted = estimating && seededFrom ? seededFrom : picked;
  // an estimate may have no project: the requirements stand alone and there is no repo to read
  const standalone = estimating && (!wanted || wanted === STANDALONE_PROJECT);
  const project = standalone ? STANDALONE_PROJECT : wanted;
  const fresh = input.fresh === true;
  if (fresh && !estimating) throw new StartError("Asking the model again (fresh) is for estimate and design runs.");
  if (!project) throw new StartError("Pick a project.");
  if (!standalone && !projectNames().includes(project)) throw new StartError(`No project "${project}". Add one with: factory init <repo>`);

  let maxCostUsd: number | undefined;
  if (input.maxCost !== undefined && input.maxCost !== null && input.maxCost !== "") {
    maxCostUsd = Number(input.maxCost);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new StartError("Max cost must be a positive number of dollars.");
    if (maxCostUsd > HIGHEST_NORMAL_CAP_USD) {
      throw new StartError(`Max cost can only lower the normal limit, and the highest normal limit is $${HIGHEST_NORMAL_CAP_USD}. Enter $${HIGHEST_NORMAL_CAP_USD} or less, or leave it empty.`);
    }
  }

  let designExport: ExportFormat[] | undefined;
  if (input.designExport !== undefined && input.designExport !== null) {
    if (!Array.isArray(input.designExport) || input.designExport.some((f) => typeof f !== "string")) throw new StartError("Export on approval is a list of formats.");
    // none ticked is no export on approval
    if (input.designExport.length) try { designExport = parseFormats((input.designExport as string[]).join(",")); } catch (err) { throw new StartError((err as Error).message); }
  }

  const uiTargetIn = str(input.uiTarget)?.trim();
  if (uiTargetIn && estimating) throw new StartError("The UI target is chosen for a build; an estimate or design run builds nothing.");
  let uiTarget: UiTarget | undefined;
  try { uiTarget = uiTargetOption(uiTargetIn || undefined); } catch (err) { throw new StartError((err as Error).message.replace("--ui-target", "The UI target")); }

  const fromEstimate = str(input.fromEstimate)?.trim();
  if (fromEstimate && estimating) throw new StartError(designing ? "A design run starts from requirements, not from an estimate." : "A build starts from an estimate; an estimate cannot.");
  if (fromEstimate && (str(input.prompt)?.trim() || input.file || str(input.jira)?.trim())) {
    throw new StartError("A build from an estimate takes its request from the estimate. Clear the request, or choose no estimate.");
  }
  const refReqs = checkUploadedRefs(input.refs);
  if (fromEstimate && refReqs.length) throw new StartError("A build from an estimate follows the design approved there. Remove the design references, or start a new design or estimate run with them.");
  let approved: Approved | undefined;
  if (fromEstimate) {
    try { approved = approvedEstimate(fromEstimate, { build: true }); } catch (err) { throw new StartError((err as Error).message); }
    const from = replay(Ledger.open(fromEstimate).events()).info.project;
    if (from !== STANDALONE_PROJECT && from !== project) throw new StartError(`That estimate is for project ${from}, not ${project}.`);
  }

  let file: { name: string; text: string } | undefined;
  if (input.file !== undefined && input.file !== null) {
    const f = input.file as { name?: unknown; text?: unknown };
    if (typeof f.name !== "string" || typeof f.text !== "string") throw new StartError("The uploaded file couldn't be read.");
    const name = basename(f.name.replace(/\\/g, "/"));
    if (!/^[\w .()-]{1,100}\.(md|markdown|txt)$/i.test(name)) throw new StartError("Upload a Markdown (.md) or text (.txt) file.");
    file = { name, text: f.text };
  }

  // estimate mode: the same settings checks as `factory estimate`, before anything is read
  let settings: ReturnType<typeof parseEstimateSettings> | undefined;
  let frameFiles: { name: string; bytes: Buffer }[] | undefined;
  if (input.frames !== undefined && !estimating) throw new StartError("Design frames belong to estimate and design runs.");
  if (estimating) {
    if (input.frames !== undefined) {
      try { frameFiles = checkUploadedFrames(input.frames); } catch (err) { throw new StartError((err as Error).message); }
    }
    const e = (input.estimate ?? {}) as Record<string, unknown>;
    const g = (input.design ?? {}) as Record<string, unknown>;
    if (designing) settings = {
      ...(standalone || g.noRepo === true ? { noRepo: true } : {}),
      ...(str(g.client) ? { client: str(g.client)!.trim().slice(0, 120) } : {}), ...(str(g.projectName) ? { projectName: str(g.projectName)!.trim().slice(0, 120) } : {}),
    };
    else try {
      settings = parseEstimateSettings({
        stackSource: String(e.stackSource ?? "undecided"),
        designInTotal: e.designInTotal !== false, feedbackRounds: String(e.feedbackRounds ?? "2"),
        repo: standalone || fromDesign?.settings.noRepo ? false : e.noRepo !== true, ...(str(e.client) ? { client: str(e.client)!.trim() } : {}),
        ...(str(e.projectName) ? { projectName: str(e.projectName)!.trim() } : {}), ...(str(e.pm) ? { pm: str(e.pm)!.trim() } : {}),
        ...(typeof e.humanReview === "boolean" ? { review: e.humanReview } : {}),
      });
    } catch (err) { throw new StartError((err as Error).message); }
    // the design run's product details stand unless given again
    if (fromDesign && settings) settings = { ...settings, ...Object.fromEntries(Object.entries({ client: fromDesign.settings.client, projectName: fromDesign.settings.projectName }).filter(([k, v]) => v && !(settings as Record<string, unknown>)[k])) };
  }

  // the same checks, in the same order, as `factory start`
  if (standalone) ensureStandaloneProject();
  const cfg = loadProject(project);
  // a design for a new product (no repo) is built into a project whose repo is still empty (greenfield)
  const greenfield = !estimating && !!fromDesign && !fromDesign.repo;
  if (greenfield) { const why = greenfieldRefusal(fromDesign!.runId, cfg); if (why) throw new StartError(why); }
  // the form left the review unset: the project's choice (a person reviews unless it opts out)
  if (estimating && !designing && settings && typeof ((input.estimate ?? {}) as Record<string, unknown>).humanReview !== "boolean") settings = { ...settings, humanReview: cfg.estimate?.humanReview !== false };
  const problems = checkRoutes(cfg, designing ? DESIGN_ROUTES : estimating ? ESTIMATE_ROUTES : undefined);
  if (problems.length) throw new StartError(`Setup problems:\n- ${problems.join("\n- ")}`);

  const busy = standalone ? undefined : (await busyRun(project)) ?? (() => {
    const s = starting.get(project);
    return s && Date.now() - s.at < 30_000 ? { runId: s.runId } : undefined;
  })();
  if (busy) throw new StartError(`Run ${busy.runId} is already running on ${project}. Wait for it to stop at a card, park or finish.`, 409);

  // everything is read before a run exists: a bad file, ticket or reference costs nothing
  let dir: string | undefined;
  let req;
  let references: GatheredRef[] = [];
  try {
    let path: string | undefined;
    if (file) {
      mkdirSync(join(factoryHome(), "tmp"), { recursive: true, mode: 0o700 });
      dir = mkdtempSync(join(factoryHome(), "tmp", "ui-upload-"));
      path = join(dir, file.name);
      writeFileSync(path, file.text, { mode: 0o600 });
    }
    const seed = approved ?? fromDesign;
    req = seed ? { text: seed.request, sources: [{ kind: "prompt" as const }], attachments: [] } : await (deps.gather ?? gatherRequest)({ prompt: str(input.prompt), file: path, jira: str(input.jira)?.trim(), ...(frameFiles ? { frameFiles } : {}) }, { fetchJira: jiraFetcherFor(cfg.jira?.allowedReporters) }, estimating ? { maxBytes: MAX_ESTIMATE_REQUEST_BYTES } : undefined);
    // a reference that cannot be read stops here, named with what to attach instead (R-2 (https://...): ...)
    references = await (deps.gatherRefs ?? gatherReferences)(refReqs, { allowPrivate: !!cfg.design?.allowPrivateRefs });
  } catch (e) {
    throw new StartError((e as Error).message);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  const runId = await createRun(req.text, project, `${userInfo().username} (via web)`, {
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    sources: req.sources, ...(references.length ? { references } : {}),
    ...(approved ? { lineage: { kind: "build" as const, approved } } : change ? { lineage: { kind: "change" as const, approved: change } } : {}),
    ...(fromDesign ? { fromDesign, ...(greenfield ? { mode: "greenfield" as const } : {}) } : {}),
    ...(settings ? { mode: designing ? "design" as const : "estimate" as const, estimate: settings, attachments: req.attachments } : {}),
    ...(designExport ? { designExport } : {}),
    ...(uiTarget ? { uiTarget } : {}),
  });
  if (!standalone) starting.set(project, { runId, at: Date.now() });
  (deps.execute ?? runDetached)(runId, fresh ? { fresh } : undefined);
  // a run seeded with an approved design never runs the design steps, so it exports now (as the command line does)
  if ((approved || fromDesign) && designExport) (deps.exportNow ?? ((id, f) => void exportSeededNow(id, f, () => undefined)))(runId, designExport);
  const origin = fromDesign ? `design run ${fromDesign.runId}` : undefined;
  return { runId, from: (origin ?? describeSources(req.sources)) + (change ? `; changes estimate ${change.runId}` : "") + (references.length ? `; design references ${describeReferences(references)}` : "") };
}

/**
 * Read design references without starting a run, like `factory design check-refs`: no model and no cost. What each
 * gives (pictures, colours, fonts, corners) or, for one that cannot be read, why and what to attach instead.
 */
export async function checkRefs(input: { refs?: unknown; project?: unknown }, deps: StartDeps = {}) {
  const reqs = checkUploadedRefs(input.refs);
  if (!reqs.length) throw new StartError("Add a reference to check.");
  const project = str(input.project);
  const allowPrivate = project && projectNames().includes(project) ? !!loadProject(project).design?.allowPrivateRefs : false;
  let refs: GatheredRef[];
  try { refs = await (deps.gatherRefs ?? gatherReferences)(reqs, { allowPrivate }); } catch (err) { throw new StartError((err as Error).message); }
  return {
    references: refs.map((r) => ({
      id: r.id, kind: r.kind, source: r.source, role: r.role, roleGiven: r.roleGiven, measured: r.measured,
      pictures: r.images.map((im) => ({ label: im.label, width: im.width, height: im.height })),
      colours: r.colours, fonts: r.fonts, ...(r.radiusPx !== undefined ? { radiusPx: r.radiusPx } : {}), textChars: r.text?.length ?? 0, notes: r.notes,
    })),
  };
}

export function _resetStarting(): void {
  starting.clear();
}

export interface EstimateDecisionInput { hash?: unknown; decision?: unknown; by?: unknown; note?: unknown; reason?: unknown; signOff?: unknown }

/**
 * The lead's decision on an estimate card, from the Estimate tab. Only estimate cards: the plan approval, answers,
 * waivers and everything else stay terminal-only. The person types their name, names the card by its hash (checked
 * under the ledger lock like factory approve), and low-confidence tasks need an explicit sign-off (the E7 gate).
 */
export async function decideEstimate(ledger: Ledger, input: EstimateDecisionInput, deps: StartDeps = {}): Promise<{ recorded: boolean }> {
  const open = replay(ledger.events()).openCard;
  if (open?.kind !== "estimate-approval") throw new StartError("This run has no estimate waiting for approval.", 409);
  const hash = str(input.hash)?.trim() ?? "";
  if (hash.length < 8) throw new StartError("Send the estimate card's hash from this page.");
  const name = str(input.by)?.trim() ?? "";
  if (name.length < 2 || name.length > 60 || /[\r\n]/.test(name)) throw new StartError("Type your name to approve; it is recorded with the decision.");
  const decision = input.decision === "reject" ? "reject" : input.decision === "approve" ? "approve" : undefined;
  if (!decision) throw new StartError("The decision must be approve or reject.");
  const by = `${name} (via web)`;
  let data: Record<string, unknown>;
  if (decision === "reject") {
    const reason = str(input.reason)?.trim();
    if (!reason) throw new StartError("A rejection needs a reason.");
    data = { reason };
  } else {
    const signOff = Array.isArray(input.signOff) ? input.signOff.map(String) : [];
    const est = ledger.getJson<Estimate>(replay(ledger.events()).steps.get("estimate")!.outputs[0]!);
    const missing = est.tasks.filter((t) => t.flagged && !signOff.includes(t.taskId)).map((t) => t.taskId);
    if (missing.length) throw new StartError(`Sign off the low-confidence tasks first: ${missing.join(", ")}.`);
    data = { note: str(input.note) ?? "", ...(signOff.length ? { signOff } : {}) };
  }
  try {
    const r = await decide(ledger, { decision, hashPrefix: hash, by, data });
    if (r.kind === "recorded") (deps.execute ?? runDetached)(ledger.runId);
    return { recorded: r.kind === "recorded" };
  } catch (e) {
    if (e instanceof DecisionError) throw new StartError(e.message, 409);
    throw e;
  }
}

export interface EstimateAnswersInput { hash?: unknown; by?: unknown; answers?: unknown }

/**
 * The answers to an estimate run's clarification questions, from the run page (every other run answers in the terminal). Only question cards: the person types their name, names the card by its hash (checked under the ledger lock), and every answer must
 * be for a question on the card. A question left out takes its recommended option, as in the terminal.
 */
export async function answerEstimateQuestions(ledger: Ledger, input: EstimateAnswersInput, deps: StartDeps = {}): Promise<{ recorded: boolean }> {
  const state = replay(ledger.events());
  const open = state.openCard;
  if (state.info.mode !== "estimate") throw new StartError("Only an estimate run's questions are answered on this page; answer this run's in your terminal (factory show-card).", 403);
  if (open?.kind !== "question") throw new StartError("This run has no questions waiting for answers.", 409);
  const hash = str(input.hash)?.trim() ?? "";
  if (hash.length < 8) throw new StartError("Send the question card's hash from this page.");
  const name = str(input.by)?.trim() ?? "";
  if (name.length < 2 || name.length > 60 || /[\r\n]/.test(name)) throw new StartError("Type your name to answer; it is recorded with the answers.");
  const body = ledger.getJson<{ asked: { id: string }[] }>(open.artifactSha);
  const known = new Set((body?.asked ?? []).map((q) => q.id));
  const raw = input.answers && typeof input.answers === "object" && !Array.isArray(input.answers) ? input.answers as Record<string, unknown> : {};
  const answers: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!known.has(id)) throw new StartError(`${id} is not a question on this card.`);
    const t = str(v)?.trim();
    if (t) {
      if (t.length > 2000) throw new StartError(`The answer to ${id} is too long (2000 characters at most).`);
      answers[id] = t;
    }
  }
  try {
    const r = await decide(ledger, { decision: "answer", hashPrefix: hash, by: `${name} (via web)`, data: { answers } });
    if (r.kind === "recorded") (deps.execute ?? runDetached)(ledger.runId);
    return { recorded: r.kind === "recorded" };
  } catch (e) {
    if (e instanceof DecisionError) throw new StartError(e.message, 409);
    throw e;
  }
}
