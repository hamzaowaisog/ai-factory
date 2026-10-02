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
import { runDetached } from "../stages/background.js";
import { createRun } from "../stages/executor.js";
import { approvedEstimate, type Approved } from "../estimate/lineage.js";
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
}

export interface StartDeps {
  /** runs the executor in the background (tests pass a stub) */
  execute?: (runId: string) => void;
  gather?: typeof gatherRequest;
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
  // an estimate may have no project: the requirements stand alone and there is no repo to read
  const standalone = estimating && (!str(input.project) || str(input.project) === STANDALONE_PROJECT);
  const project = standalone ? STANDALONE_PROJECT : str(input.project);
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

  const fromEstimate = str(input.fromEstimate)?.trim();
  if (fromEstimate && estimating) throw new StartError(designing ? "A design run starts from requirements, not from an estimate." : "A build starts from an estimate; an estimate cannot.");
  if (fromEstimate && (str(input.prompt)?.trim() || input.file || str(input.jira)?.trim())) {
    throw new StartError("A build from an estimate takes its request from the estimate. Clear the request, or choose no estimate.");
  }
  let approved: Approved | undefined;
  if (fromEstimate) {
    try { approved = approvedEstimate(fromEstimate); } catch (err) { throw new StartError((err as Error).message); }
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
        deliveryModel: String(e.deliveryModel ?? "hitl"), stackSource: String(e.stackSource ?? "undecided"),
        designInTotal: e.designInTotal !== false, feedbackRounds: String(e.feedbackRounds ?? "2"),
        repo: standalone ? false : e.noRepo !== true, ...(str(e.client) ? { client: str(e.client)!.trim() } : {}),
        ...(str(e.projectName) ? { projectName: str(e.projectName)!.trim() } : {}), ...(str(e.pm) ? { pm: str(e.pm)!.trim() } : {}),
      });
    } catch (err) { throw new StartError((err as Error).message); }
  }

  // the same checks, in the same order, as `factory start`
  if (standalone) ensureStandaloneProject();
  const cfg = loadProject(project);
  const problems = checkRoutes(cfg, designing ? DESIGN_ROUTES : estimating ? ESTIMATE_ROUTES : undefined);
  if (problems.length) throw new StartError(`Setup problems:\n- ${problems.join("\n- ")}`);

  const busy = standalone ? undefined : (await busyRun(project)) ?? (() => {
    const s = starting.get(project);
    return s && Date.now() - s.at < 30_000 ? { runId: s.runId } : undefined;
  })();
  if (busy) throw new StartError(`Run ${busy.runId} is already running on ${project}. Wait for it to stop at a card, park or finish.`, 409);

  // everything is read before a run exists: a bad file or ticket costs nothing
  let dir: string | undefined;
  let req;
  try {
    let path: string | undefined;
    if (file) {
      mkdirSync(join(factoryHome(), "tmp"), { recursive: true, mode: 0o700 });
      dir = mkdtempSync(join(factoryHome(), "tmp", "ui-upload-"));
      path = join(dir, file.name);
      writeFileSync(path, file.text, { mode: 0o600 });
    }
    req = approved ? { text: approved.request, sources: [{ kind: "prompt" as const }], attachments: [] } : await (deps.gather ?? gatherRequest)({ prompt: str(input.prompt), file: path, jira: str(input.jira)?.trim(), ...(frameFiles ? { frameFiles } : {}) }, {}, estimating ? { maxBytes: MAX_ESTIMATE_REQUEST_BYTES } : undefined);
  } catch (e) {
    throw new StartError((e as Error).message);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  const runId = await createRun(req.text, project, `${userInfo().username} (via web)`, {
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    sources: req.sources,
    ...(approved ? { lineage: { kind: "build" as const, approved } } : {}),
    ...(settings ? { mode: designing ? "design" as const : "estimate" as const, estimate: settings, attachments: req.attachments } : {}),
  });
  if (!standalone) starting.set(project, { runId, at: Date.now() });
  (deps.execute ?? runDetached)(runId);
  return { runId, from: describeSources(req.sources) };
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
 * The answers to a run's clarification questions (estimate or build), from the run page. Only question cards: the person types their name, names the card by its hash (checked under the ledger lock), and every answer must
 * be for a question on the card. A question left out takes its recommended option, as in the terminal.
 */
export async function answerEstimateQuestions(ledger: Ledger, input: EstimateAnswersInput, deps: StartDeps = {}): Promise<{ recorded: boolean }> {
  const state = replay(ledger.events());
  const open = state.openCard;
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

export interface DesignDecisionInput { hash?: unknown; decision?: unknown; by?: unknown; note?: unknown; reason?: unknown }

/**
 * The lead's decision on the design card (E1b), from the run page. Like the estimate card: a typed name, the card's hash
 * checked under the ledger lock, and a reason when sending it back. A rejection does not stop the run: the parts the reason
 * points at are fixed (or the whole design is redrawn when it needs that) and a new card follows.
 */
export async function decideDesign(ledger: Ledger, input: DesignDecisionInput, deps: StartDeps = {}): Promise<{ recorded: boolean }> {
  const open = replay(ledger.events()).openCard;
  if (open?.kind !== "design-approval") throw new StartError("This run has no design waiting for approval.", 409);
  const hash = str(input.hash)?.trim() ?? "";
  if (hash.length < 8) throw new StartError("Send the design card's hash from this page.");
  const name = str(input.by)?.trim() ?? "";
  if (name.length < 2 || name.length > 60 || /[\r\n]/.test(name)) throw new StartError("Type your name to decide; it is recorded with the decision.");
  const decision = input.decision === "reject" ? "reject" : input.decision === "approve" ? "approve" : undefined;
  if (!decision) throw new StartError("The decision must be approve or reject.");
  let data: Record<string, unknown>;
  if (decision === "reject") {
    const reason = str(input.reason)?.trim();
    if (!reason) throw new StartError("Say what to change, in your own words: the parts you point at are fixed and you get a new card.");
    if (reason.length > 2000) throw new StartError("The reason is too long (2000 characters at most).");
    data = { reason };
  } else data = { note: str(input.note) ?? "" };
  try {
    const r = await decide(ledger, { decision, hashPrefix: hash, by: `${name} (via web)`, data });
    if (r.kind === "recorded") (deps.execute ?? runDetached)(ledger.runId);
    return { recorded: r.kind === "recorded" };
  } catch (e) {
    if (e instanceof DecisionError) throw new StartError(e.message, 409);
    throw e;
  }
}
