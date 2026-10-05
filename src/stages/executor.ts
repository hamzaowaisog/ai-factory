// The executor (run-manager §2.3, §2.5, §2.9): replay → next step → run → record → repeat,
// until a human card, a park, delivery, or a stop/pause request. One executor per repo.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Failure, LedgerEvent } from "../contracts/index.js";
import { loadProject, type ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY, mergePolicy, withPolicy, type Policy } from "../gates/policy.js";
import { DEFAULT_LADDER, failureSignature, nextOnFailure, type AttemptRecord, type LadderAction } from "../gates/ladder.js";
import { checkCaps } from "../ledger/caps.js";
import { ExecutionLock, LockBusyError } from "../ledger/exec-lock.js";
import { resolveRef } from "../ledger/git.js";
import { applyExpiredDeadline } from "../ledger/human.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { canSkip, eventKey, inputsHash, replay, splitKey, type RunInfo, type RunState } from "../ledger/state.js";
import { assertSupportedPath, factoryHome } from "../util/paths.js";
import { Tracer } from "../util/trace.js";
import { saveReport } from "../report.js";
import { hashJson, sha256 } from "../util/hash.js";
import { REPO_ROOT } from "../runners/netinfra.js";
import { setPrice } from "../runners/pricing.js";
import type { StepContext, StepDef, StepOutcome } from "./framework.js";
import { stepsFor } from "./modes.js";
import { answersOf, asksGates, asksPerson, gateCard, gateRounds, GATE_ROUNDS, nextQuestionId, ROUND_ATTEMPTS, writeGateQuestions, type FiledRound, type GateRound } from "./gate-questions.js";
import { greenfieldRefusal, repoIsEmpty } from "../config/greenfield.js";
import { availableRungs, routeFor } from "./routing.js";
import { runtime } from "./workspace.js";
import type { RequestSource } from "../sources/request.js";
import { storeReferences, type GatheredRef } from "../sources/refs.js";
import { budgetStop } from "../estimate/budget.js";
import { copyArtifacts, type Approved, type ApprovedDesign } from "../estimate/lineage.js";
import { triggerTune } from "../estimate/tune.js";
import { readsRequirements } from "../contracts/index.js";

export type Log = (msg: string) => void;

export function policyFor(project: ProjectConfig): Policy {
  return mergePolicy(DEFAULT_POLICY, project.policy as Partial<Policy>);
}

/** The factory's own commit, so every run says exactly what code ran it (eval rows, run records); "-dirty" with local edits. */
export function factoryCommit(): { commit?: string } {
  try { return { commit: execFileSync("git", ["-C", REPO_ROOT, "describe", "--always", "--dirty", "--abbrev=7"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() }; } catch { return {}; }
}

/** A warning before a paid run from a factory checkout with local edits: its record can't name the exact code. */
export function dirtyWarning(commit = factoryCommit().commit): string | undefined {
  return commit?.endsWith("-dirty") ? `Warning: the factory has uncommitted changes (${commit}). This run will be recorded as ${commit}, which names no exact code; commit them first for a clean record.` : undefined;
}

function versions(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
  return { factory: pkg.version, ...factoryCommit(), node: process.version, "mode:brownfield": "1", "mode:estimate": "1", "mode:design": "1", ...Object.fromEntries(Object.entries(pkg.dependencies).filter(([k]) => /anthropic|openai|zod/.test(k))) };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-").slice(0, 30) || "run";
}

export function newRunId(request: string, now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${d}-${slug(request)}-${randomBytes(2).toString("hex")}`;
}

/** Deliver can only push to GitHub today; refuse other forges before any work is done. */
export function assertDeliverable(project: ProjectConfig): void {
  if (project.forge && project.forge.kind !== "github") {
    throw new Error(`Delivering to ${project.forge.kind} isn't supported yet (GitHub only). Remove "forge:" from the project config to get a ready branch locally instead.`);
  }
}

export const MAX_REQUEST_FILE_BYTES = 100_000;

/** `factory start --file`: read a request file (Markdown or text), refusing ones intake can't take. */
export function readRequestFile(path: string, maxBytes = MAX_REQUEST_FILE_BYTES): { text: string; name: string } {
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);
  const size = statSync(path).size;
  if (size > maxBytes) {
    throw new Error(`${basename(path)} is ${Math.round(size / 1000)} KB. The intake step reads about 25 KB; split the request or summarise it.`);
  }
  const text = readFileSync(path, "utf8").trim();
  if (text.length < 10) throw new Error(`${basename(path)} is empty or too short to be a request.`);
  return { text, name: basename(path) };
}

/** `factory start`: create the ledger. Execution happens in `execute`. */
export async function createRun(request: string, projectName: string, operator: string, opts: { maxCostUsd?: number; requestFile?: string; sources?: RequestSource[]; mode?: "brownfield" | "greenfield" | "estimate" | "design"; estimate?: RunInfo["estimate"]; attachments?: { name: string; bytes: Buffer }[]; references?: GatheredRef[]; lineage?: { kind: "change" | "sibling" | "build"; approved: Approved }; fromDesign?: ApprovedDesign; designExport?: string[]; uiTarget?: RunInfo["uiTarget"] } = {}): Promise<string> {
  if (opts.maxCostUsd !== undefined && !(opts.maxCostUsd > 0)) throw new Error("--max-cost must be a positive number of dollars");
  const project = loadProject(projectName);
  // an estimate or design from requirements alone has no repo to check or read
  const noRepo = readsRequirements(opts.mode) && opts.estimate?.noRepo === true;
  if (!noRepo) {
    assertSupportedPath(project.repo);
    assertDeliverable(project);
  }
  // greenfield: an approved design with no repo, built into this project's empty repo (the callers check first; this is the guard)
  // a plain start on a Node project whose repo is still empty is a new product too: the run draws its own design
  if (!opts.mode && !opts.fromDesign && !opts.lineage && project.stack === "node" && repoIsEmpty(project.repo, project.baseBranch)) opts = { ...opts, mode: "greenfield" };
  if (opts.mode === "greenfield") {
    if (opts.fromDesign?.repo) throw new Error("A greenfield run builds an approved design for a new product (one designed with no repo).");
    const why = greenfieldRefusal(opts.fromDesign?.runId ?? "This request", project);
    if (why) throw new Error(why);
  } else if (opts.fromDesign && !opts.fromDesign.repo && !readsRequirements(opts.mode)) throw new Error(`${opts.fromDesign.runId} is a new product (designed with no repo): build it as a greenfield run.`);
  // the Node lab builds only a new product for now; changing an existing Node app is not decided yet (PR #17 review, item 5)
  if (project.stack === "node" && (opts.mode ?? "brownfield") === "brownfield") throw new Error(`Project ${project.project} is stack: node. The factory builds Node only for a new product, into an empty repo; changes to an existing Node app are not supported yet.`);
  const baseCommit = noRepo ? undefined : await resolveRef(project.repo, project.baseBranch);
  const runId = newRunId(request);
  const ledger = Ledger.create(runId);
  const lin = opts.lineage;
  if (lin) copyArtifacts(ledger, lin.approved);
  if (opts.fromDesign) {
    copyArtifacts(ledger, opts.fromDesign);
    // a spec with no critic record of its own: an empty one, stated as inherited
    if (!opts.fromDesign.ref.criticSha) opts.fromDesign.ref.criticSha = ledger.putJson({ findings: [], note: `inherited from approved design ${opts.fromDesign.runId}` });
  }
  // an estimate has no critic record of its own to hand a build run: an empty one, stated as inherited
  if (lin?.kind === "build" && !lin.approved.criticSha) lin.approved.criticSha = ledger.putJson({ findings: [], note: `inherited from approved estimate ${lin.approved.runId}` });
  const requestSha = ledger.putArtifact(request);
  // design references were read before the run existed; their pictures are stored now, under the run
  const references = storeReferences(ledger, opts.references ?? []);
  await ledger.append({
    type: "run.created",
    data: {
      mode: opts.mode ?? "brownfield", project: project.project, ...(noRepo ? {} : { repoPath: project.repo, baseRef: project.baseBranch, baseCommit }), ...(noRepo ? {} : { repoId: project.project }),
      request, requestSha, operator, versions: versions(),
      ...(opts.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}),
      ...(opts.requestFile ? { requestFile: opts.requestFile } : {}),
      ...(opts.sources?.length ? { sources: opts.sources } : {}),
      ...(references.length ? { references } : {}),
      ...(opts.estimate ? { estimate: opts.estimate } : {}),
      ...(lin && lin.kind !== "build" ? { parent: { runId: lin.approved.runId, kind: lin.kind, estimateSha: lin.approved.estimateSha, breakdownSha: lin.approved.breakdownSha, specSha: lin.approved.specSha, ...(lin.approved.criticSha ? { criticSha: lin.approved.criticSha } : {}), ...(lin.approved.clarifySha ? { clarifySha: lin.approved.clarifySha } : {}), ...(lin.approved.clarify2Sha ? { clarify2Sha: lin.approved.clarify2Sha } : {}), ...(lin.approved.designSha ? { designSha: lin.approved.designSha } : {}), ...(lin.approved.baselineSha ? { baselineSha: lin.approved.baselineSha } : {}) } } : {}),
      ...(opts.fromDesign ? { designRef: opts.fromDesign.ref } : {}),
      ...(opts.designExport?.length ? { designExport: opts.designExport } : {}),
      ...(opts.uiTarget ? { uiTarget: opts.uiTarget } : {}),
      ...(lin?.kind === "build" ? { estimateRef: { runId: lin.approved.runId, estimateSha: lin.approved.estimateSha, breakdownSha: lin.approved.breakdownSha, specSha: lin.approved.specSha, ...(lin.approved.criticSha ? { criticSha: lin.approved.criticSha } : {}), ...(lin.approved.designSha ? { designSha: lin.approved.designSha } : {}) } } : {}),
    },
  }, HUMAN_WRITER);
  for (const a of opts.attachments ?? []) {
    const dest = join(ledger.dir, "attachments", a.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, a.bytes);
  }
  return runId;
}

export type NextStep = { kind: "run"; step: StepDef; hash: string } | { kind: "done" } | { kind: "blocked"; step: string };

/**
 * The template versions a completed step may have been run with: the current one and, for a numbered version, every earlier
 * number. A newer prompt template is for new runs; a step a paused run already completed keeps the version it ran with.
 */
export function earlierVersions(v: string): string[] {
  const n = /^\d+$/.test(v) ? Number(v) : 0;
  return [v, ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => String(n - 1 - i))];
}

/**
 * A step's hash for its inputs now, and whether it is already done: completed with the same inputs and model, under the current
 * template or an earlier one (only a change of inputs or model runs a completed step again).
 */
export function stepDone(state: RunState, step: Pick<StepDef, "key" | "templateVersion" | "coding">, inp: unknown, model: string | undefined): { hash: string; done: boolean } {
  const hashAt = (templateVersion: string) => inputsHash({ inputs: [JSON.stringify(inp)], stageDef: step.key, templateVersion, model, taskStartSha: step.coding ? String((inp as { taskStartSha?: string }).taskStartSha ?? "") : undefined });
  const hash = hashAt(step.templateVersion);
  return { hash, done: earlierVersions(step.templateVersion).some((v) => canSkip(state, step.key, v === step.templateVersion ? hash : hashAt(v))) };
}

/** A step's state now: undefined inputs when it isn't ready. */
function pending(state: RunState, ledger: Ledger, project: ProjectConfig, step: StepDef): { inp?: Record<string, unknown>; hash: string; done: boolean } {
  const inp = step.inputs(state, ledger);
  if (!inp) return { hash: "", done: false };
  let model: string | undefined;
  try { model = routeFor(project, step.stage).model; } catch { model = undefined; }
  return { inp, ...stepDone(state, step, inp, model) };
}

/** Pure: the first step whose recorded inputsHash doesn't match its current inputs. */
export function next(state: RunState, ledger: Ledger, project: ProjectConfig): NextStep {
  for (const step of stepsFor(state)) {
    const p = pending(state, ledger, project, step);
    if (!p.inp) return { kind: "blocked", step: step.key };
    if (p.done) continue;
    return { kind: "run", step, hash: p.hash };
  }
  return { kind: "done" };
}

/** At most this many steps run side by side (a request splits into at most a few modules). */
export const MAX_SIDE_BY_SIDE = 4;

/**
 * Pure: the next step and the parallel steps after it that are ready now, up to the first step that isn't parallel. A run's
 * modules write their specs side by side: one module's chain took 22 min on the 2026-10-05 run, and three ran one after another.
 */
export function nextBatch(state: RunState, ledger: Ledger, project: ProjectConfig, max = MAX_SIDE_BY_SIDE): { step: StepDef; hash: string }[] {
  const out: { step: StepDef; hash: string }[] = [];
  for (const step of stepsFor(state)) {
    if (out.length && !step.parallel) break;
    const p = pending(state, ledger, project, step);
    if (!p.inp) { if (out.length) continue; break; }
    if (p.done) continue;
    out.push({ step, hash: p.hash });
    if (!step.parallel || out.length >= max) break;
  }
  return out;
}

/** Failed attempts of a step since it last completed (a changed input starts a fresh ladder). */
function attemptHistory(ledger: Ledger, step: string): AttemptRecord[] {
  const all = ledger.events();
  const evs = all.filter((e) => e.key && splitKey(e.key).step === step);
  const lastDone = Math.max(-1, ...evs.filter((e) => e.type === "step.completed").map((e) => e.seq));
  // a human raising the attempt limit starts the ladder fresh
  const lastRaise = Math.max(-1, ...all.filter((e) => e.type === "human.decided" && (e.data as { decision?: string; extraAttempts?: number })?.decision === "waive-cap" && typeof (e.data as { extraAttempts?: number }).extraAttempts === "number").map((e) => e.seq));
  // a round of questions about the step's failing checks starts it fresh too (src/stages/gate-questions.ts)
  const lastRound = Math.max(-1, ...evs.filter((e) => e.type === "step.failed" && (e.data as { action?: string } | undefined)?.action === "questions").map((e) => e.seq));
  const since = Math.max(lastDone, lastRaise, lastRound);
  return evs.filter((e) => e.type === "step.failed" && e.seq > since && !(e.data as { parked?: boolean })?.parked)
    .map((e) => e.data as unknown as AttemptRecord);
}

/** A run that has ended never reuses a build again: free the disk its kept builds use. */
function dropBuildCache(runId: string): void {
  rmSync(join(factoryHome(), "tmp", runId, "builds"), { recursive: true, force: true });
}

export interface ExecuteResult { status: string; message: string }

/** until: stop, without running it, at the first step after this one (the spec eval stops after specify). */
export async function execute(runId: string, echo: Log = () => undefined, opts: { until?: string } = {}): Promise<ExecuteResult> {
  const ledger = Ledger.open(runId);
  // the run trace: every console line, model turn, tool call, container phase and gate, with timestamps
  const trace = new Tracer(ledger.dir, { echo, putBlob: (c) => ledger.putArtifact(c) });
  const log = (msg: string) => trace.event("log", msg);
  ledger.onAppend = (ev) => traceLedgerEvent(trace, ev);
  let state = replay(ledger.events());
  const project = loadProject(state.info.project);
  const policy = policyFor(project);
  for (const [model, price] of Object.entries(project.prices)) setPrice(model, price);
  await applyExpiredDeadline(ledger);

  let lock: ExecutionLock;
  try {
    lock = await ExecutionLock.acquire(state.info.repoId ?? `run:${runId}`, runId, { onCompromised: () => log("execution lock lost; stopping") });
  } catch (e) {
    if (e instanceof LockBusyError) return { status: "queued", message: e.message };
    throw e;
  }
  const writer = lock;
  const warned = new Set<string>();
  let completed = 0;
  /** steps that went back to an earlier one since a step last completed */
  const wentBack = new Set<string>();
  /**
   * A round of questions about a step's failing checks (src/stages/gate-questions.ts), recorded as the attempt's failure: a hands-off run
   * takes the recommended answers and goes on, a reviewed one waits on the card. Once the rounds are used up the step was already run
   * with carryOn and could not carry what fails, so the run parks with the reason.
   */
  async function askRound(ctx: StepContext, step: StepDef, key: string, rounds: FiledRound[], failures: Failure[], rec2: AttemptRecord, nextRung: number, reason: string, data?: Record<string, unknown>): Promise<ExecuteResult | undefined> {
    const failuresSha = ledger.putJson(failures.slice(0, 20));
    const park = async (why: string): Promise<ExecuteResult> => {
      await ledger.append({ type: "step.failed", key, outputs: [failuresSha], data: { ...(data ?? {}), ...rec2, action: "park", reason: why } }, writer);
      await ledger.append({ type: "run.parked", data: { reason: `${step.key}: ${why}`, step: step.key } }, writer);
      return { status: "parked", message: `${step.key}: ${why}. Last failure: ${failures[0]?.message ?? ""}` };
    };
    if (rounds.length >= GATE_ROUNDS) return park(`${reason}; still failing after ${GATE_ROUNDS} rounds of questions, and this check cannot be carried as an open risk`);
    const round = rounds.length + 1;
    const earlier = answersOf(rounds);
    const q = await writeGateQuestions(ctx, { step: step.key, failures: failures.slice(0, 20), earlier, firstId: nextQuestionId(ledger, state) });
    if (!q.ok) return park(`${reason}; the questions could not be written (${q.outcome.kind === "park" ? q.outcome.reason : q.outcome.kind === "fail" ? q.outcome.failures[0]?.message ?? "" : q.outcome.kind})`);
    const handsOff = !asksPerson(state);
    const filed: GateRound = { step: step.key, round, asked: q.asked, failures: failures.slice(0, 20), failureOf: q.failureOf, ...(handsOff || !q.asked.length ? { answers: Object.fromEntries(q.asked.map((x) => [x.id, x.recommended])) } : {}) };
    const roundSha = ledger.putJson(filed);
    const cardSha = handsOff || !q.asked.length ? undefined : ledger.putJson({ key: "gate", step: step.key, round, asked: q.asked, assumptions: [] });
    await ledger.append({ type: "step.failed", key, outputs: [failuresSha], data: { ...(data ?? {}), ...rec2, action: "questions", nextRung, reason, round, roundSha, ...(cardSha ? { cardSha } : {}) } }, writer);
    ctx.log(`? ${step.key}: ${reason}; round ${round} of ${GATE_ROUNDS}: ${q.asked.length} question${q.asked.length === 1 ? "" : "s"} about the failing checks${cardSha ? "" : q.asked.length ? " (hands-off: the recommended answers are assumed)" : ""}`);
    if (!cardSha) return undefined;
    const cardId = `check-questions-${round}-${cardSha.slice(0, 8)}`;
    ledger.writeCard(cardId, gateCard(runId, step.key, round, q.asked, filed.failures, q.failureOf, cardSha));
    await ledger.append({ type: "human.requested", data: { cardId, kind: "question", artifactSha: cardSha, step: step.key, gateStep: step.key, roundSha } }, writer);
    return { status: "waiting", message: `The ${step.key} step's checks raised questions: factory show-card ${runId}` };
  }

  /** Run one step and record its outcome; an ExecuteResult when the run stops here, undefined to go on. */
  async function runStep(state: RunState, step: StepDef, hash: string, share: number): Promise<ExecuteResult | undefined> {
    const rec = state.steps.get(step.key);
    const attempt = (rec?.lastAttempt ?? 0) + 1;
    const history = attemptHistory(ledger, step.key);
    const lastFail = [...ledger.events()].reverse().find((e) => e.type === "step.failed" && e.key && splitKey(e.key).step === step.key);
    const asked = (lastFail?.data as { action?: string } | undefined)?.action === "questions" && lastFail!.seq > Math.max(-1, ...ledger.events().filter((e) => e.type === "step.completed" && e.key && splitKey(e.key).step === step.key).map((e) => e.seq));
    const rung = history.length || asked ? Number((lastFail?.data as { nextRung?: number } | undefined)?.nextRung ?? 0) : 0;
    // the questions this step's failing checks raised, and whether their rounds are used up (an estimate or a design run)
    const rounds = asksGates(state) ? gateRounds(ledger, state, step.key) : [];
    const gateAnswers = answersOf(rounds);
    const priorFailures: Failure[] = history.length && lastFail?.outputs?.[0] ? ledger.getJson<Failure[]>(lastFail.outputs[0]) : [];
    const key = eventKey(step.key, attempt);
    const t = share > 1 ? trace.forStep(step.key, attempt) : trace;
    if (share === 1) trace.setStep(step.key, attempt);
    const slog = (msg: string) => t.event("log", msg);
    let spent = 0;
    await ledger.append({ type: "step.started", key, inputsHash: hash, data: { rung } }, writer);
    slog(`▶ ${step.key} (attempt ${attempt}${rung ? `, rung ${rung}` : ""})`);

    const ctx: StepContext = {
      runId, ledger, writer, state, project, policy, attempt, rung, priorFailures, log: slog, trace: t, share,
      ...(gateAnswers.length ? { gateAnswers } : {}), ...(rounds.length >= GATE_ROUNDS && rounds[rounds.length - 1]!.answered ? { carryOn: true } : {}),
      usage: async (u) => {
        spent += u.estUsd;
        await ledger.append({ type: "usage", key, data: {
          "gen_ai.request.model": u.model, "gen_ai.usage.input_tokens": u.inputTokens, "gen_ai.usage.output_tokens": u.outputTokens,
          "gen_ai.usage.cache_read_tokens": u.cacheRead, "gen_ai.usage.cache_write_tokens": u.cacheWrite, "gen_ai.usage.cost_usd": u.estUsd,
        } }, writer);
      },
    };
    let outcome: StepOutcome;
    try {
      outcome = await withPolicy(policy, () => step.run(ctx));
    } catch (e) {
      const msg = (e as Error).message;
      slog(`  error: ${msg}`);
      outcome = { kind: "fail", category: /rate limit|overloaded|529|429/i.test(msg) ? "rate-limit" : "other", failures: [{ check: "exception", message: msg.slice(0, 1000), frames: [] }], signature: `exception:${msg.slice(0, 120)}` };
    }

    switch (outcome.kind) {
      case "done": {
        const named = outcome.outputs;
        const treeSha = outcome.treeSha && /^[0-9a-f]{40}$/.test(outcome.treeSha) ? outcome.treeSha : undefined;
        await ledger.append({ type: "step.completed", key, inputsHash: hash, treeSha, outputs: Object.values(named), data: { ...(outcome.data ?? {}), named } }, writer);
        completed++;
        wentBack.clear();
        const after = replay(ledger.events()).costUsd;
        // beside other steps, the run's total grew by theirs too
        slog(`✓ ${step.key} ($${(share > 1 ? spent : after - state.costUsd).toFixed(2)}, total $${after.toFixed(2)})`);
        if (step.key === "deliver") {
          await ledger.append({ type: "run.delivered", data: outcome.data ?? {} }, writer);
          dropBuildCache(runId);
          const d = outcome.data as { local?: boolean; branch?: string; prUrl?: string };
          return { status: "delivered", message: d.local ? `Ready locally on branch ${d.branch}. PR text: factory show-card ${runId} --pr` : `PR opened: ${d.prUrl}` };
        }
        break;
      }
      case "wait": {
        const c = outcome.card;
        ledger.writeCard(c.cardId, c.markdown);
        await ledger.append({ type: "step.interrupted", key, data: { reason: "waiting" } }, writer);
        await ledger.append({ type: "human.requested", data: { ...(c.extra ?? {}), cardId: c.cardId, kind: c.kind, artifactSha: c.artifactSha, step: step.key, deadline: c.deadline, defaultDecision: c.defaultDecision } }, writer);
        return { status: "waiting", message: `A card needs you: factory show-card ${runId}` };
      }
      case "back": {
        // once: a step that goes back again before anything else completed would loop, so it parks instead
        if (wentBack.has(step.key)) {
          const reason = `${outcome.reason}, but the step it goes back to did not run again`;
          await ledger.append({ type: "step.failed", key, data: { category: "other", signature: "park", rung, parked: true } }, writer);
          await ledger.append({ type: "run.parked", data: { reason, step: step.key } }, writer);
          return { status: "parked", message: reason };
        }
        wentBack.add(step.key);
        await ledger.append({ type: "step.interrupted", key, data: { reason: "back" } }, writer);
        slog(`↩ ${step.key}: ${outcome.reason}`);
        break;
      }
      case "park":
        await ledger.append({ type: "step.failed", key, data: { category: "other", signature: "park", rung, parked: true } }, writer);
        await ledger.append({ type: "run.parked", data: { reason: outcome.reason, step: step.key } }, writer);
        return { status: "parked", message: outcome.reason };
      case "ask":
        if (!asksGates(state)) {
          await ledger.append({ type: "step.failed", key, data: { category: "other", signature: "park", rung, parked: true } }, writer);
          await ledger.append({ type: "run.parked", data: { reason: outcome.reason, step: step.key } }, writer);
          return { status: "parked", message: outcome.reason };
        }
        return askRound(ctx, step, key, rounds, outcome.failures, { category: "other", signature: failureSignature(outcome.failures.map((f) => `${f.check}:${f.message}`)), rung }, rung, outcome.reason);
      case "close":
        await ledger.append({ type: "step.failed", key, data: { category: "other", signature: outcome.reason, rung } }, writer);
        await ledger.append({ type: "run.closed", data: { reason: outcome.reason } }, writer);
        dropBuildCache(runId);
        return { status: `closed: ${outcome.reason}`, message: outcome.reason };
      case "fail": {
        const rec2: AttemptRecord = { category: outcome.category, signature: outcome.signature ?? sha256(JSON.stringify(outcome.failures)).slice(0, 16), diffSha: outcome.diffSha, rung, lockedFailedIds: outcome.lockedFailedIds };
        const backoffSpent = history.reduce((n2, h) => n2 + Number((h as { waitMs?: number }).waitMs ?? 0), 0);
        const action: LadderAction = nextOnFailure([...history, rec2], {
          // policy.retryBudget (default 6; a trial project can say 2)
          ...DEFAULT_LADDER, maxAttempts: policy.retryBudget + state.capOverrides.extraAttempts, availableRungs: availableRungs(project, step.stage, policy.localOnly), backoffSpentMs: backoffSpent, a5Done: new Set(),
        });
        // an estimate or a design run: a failing check, after the retry with the failures fed back, becomes questions instead of more attempts or a park
        const counted = history.filter((h) => h.category !== "rate-limit").length + 1;
        if (outcome.gate && outcome.category === "other" && asksGates(state) && (action.action === "park" || counted >= ROUND_ATTEMPTS)) {
          return askRound(ctx, step, key, rounds, outcome.failures, rec2, action.action === "retry" ? action.rung : rung, action.action === "park" ? action.reason : `${outcome.failures.length} check${outcome.failures.length === 1 ? "" : "s"} still fail after the retry`, outcome.data);
        }
        const failuresSha = ledger.putJson(outcome.failures.slice(0, 20));
        await ledger.append({
          type: "step.failed", key, outputs: [failuresSha],
          data: { ...(outcome.data ?? {}), ...rec2, action: action.action, nextRung: action.action === "retry" ? action.rung : rung, waitMs: action.action === "backoff" ? action.waitMs : 0, reason: action.reason },
        }, writer);
        slog(`✗ ${step.key}: ${outcome.failures.slice(0, 2).map((f) => f.message).join("; ").slice(0, 300)} → ${action.action}`);
        if (action.action === "park") { await ledger.append({ type: "run.parked", data: { reason: `${step.key}: ${action.reason}`, step: step.key } }, writer); return { status: "parked", message: `${step.key}: ${action.reason}. Last failure: ${outcome.failures[0]?.message ?? ""}` }; }
        if (action.action === "a5-check") {
          const reason = `Locked tests ${action.testIds.join(", ")} failed twice. Either the code or the test is wrong; the test-defect check and unlock card aren't built yet, so a human needs to look.`;
          await ledger.append({ type: "run.parked", data: { reason, step: step.key } }, writer);
          return { status: "parked", message: reason };
        }
        if (action.action === "backoff") { slog(`  waiting ${Math.round(action.waitMs / 1000)}s (rate limit)`); await new Promise((r) => setTimeout(r, action.waitMs)); }
        break;
      }
    }
    return undefined;
  }

  trace.startHeartbeat();
  trace.event("run", `executor started (pid ${process.pid})`);
  try {
    state = replay(ledger.events());
    // crash recovery: an unfinished step becomes interrupted; its containers are removed
    if (state.running.length) {
      log(`resuming: ${state.running.map((r) => `${r.step} attempt ${r.attempt}`).join(", ")} ${state.running.length > 1 ? "were" : "was"} interrupted`);
      try {
        const rt = runtime();
        for (const c of await rt.listByLabel("factory.run", runId)) { await rt.stop(c.id, 2); await rt.remove(c.id); }
      } catch { /* no runtime available: nothing to clean */ }
      for (const { step, attempt } of state.running) await ledger.append({ type: "step.interrupted", key: eventKey(step, attempt) }, writer);
    }
    if (state.status === "parked" || state.status === "paused") await ledger.append({ type: "run.resumed" }, writer);

    for (;;) {
      state = replay(ledger.events());
      if (state.flags.stopRequested) { await ledger.append({ type: "run.stopped" }, writer); dropBuildCache(runId); return { status: "stopped", message: "Stopped." }; }
      if (state.flags.pauseRequested) { await ledger.append({ type: "run.paused" }, writer); return { status: "paused", message: "Paused." }; }
      if (typeof state.status === "object" || state.status === "delivered") return { status: String(typeof state.status === "object" ? `closed: ${state.status.closed}` : state.status), message: "Nothing to do." };
      if (state.openCard) return { status: "waiting", message: `Waiting for you: factory show-card ${runId}` };
      const burn = await budgetStop(ledger, writer, state, policy, log, warned);
      if (burn) {
        // B5: a hash-bound card; a lead lets the run go on (factory waive-budget) or decides on a change request
        ledger.writeCard(burn.cardId, burn.markdown);
        await ledger.append({ type: "human.requested", data: { cardId: burn.cardId, kind: "budget", artifactSha: burn.artifactSha, reason: burn.reason, proposed: burn.proposed } }, writer);
        return { status: "waiting", message: `${burn.reason}. Decide with: factory show-card ${runId}` };
      }
      const cap = checkCaps(state, policy.retryBudget);
      if (cap && !cap.waivable) { await ledger.append({ type: "run.parked", data: { reason: cap.reason } }, writer); return { status: "parked", message: cap.reason }; }
      if (cap) {
        // cost, time and attempts: a hash-bound card; a human decides on the terminal
        const artifactSha = hashJson({ kind: cap.kind, reason: cap.reason, seq: state.lastSeq });
        const cardId = `cap-${artifactSha.slice(0, 8)}`;
        const p = cap.proposal ?? {};
        ledger.writeCard(cardId, [
          `# Limit reached: ${cap.reason}`, ``,
          `Run ${runId} · spent $${state.costUsd.toFixed(2)} · ${Math.round(state.activeMs / 60_000)} min active`, ``,
          `To continue with a higher limit (suggested):`,
          `  factory waive-cap ${runId} ${artifactSha.slice(0, 8)}${p.costUsd ? ` --cost ${p.costUsd}` : ""}${p.wallMinutes ? ` --minutes ${p.wallMinutes}` : ""}${p.extraAttempts ? ` --attempts ${p.extraAttempts}` : ""}`,
          `Or stop here: factory stop ${runId}`, ``, `Card hash: ${artifactSha.slice(0, 8)}`,
        ].join("\n"));
        await ledger.append({ type: "human.requested", data: { cardId, kind: "cap", artifactSha, proposal: p, reason: cap.reason } }, writer);
        return { status: "waiting", message: `${cap.reason}. Decide with: factory show-card ${runId}` };
      }

      const n = next(state, ledger, project);
      if (n.kind === "done") return { status: String(state.status), message: "All steps done." };
      if (n.kind === "blocked") throw new Error(`Step ${n.step} isn't ready but nothing before it is pending (bug)`);
      let batch = n.step.parallel ? nextBatch(state, ledger, project) : [{ step: n.step, hash: n.hash }];
      if (opts.until) {
        const keys = stepsFor(state).map((s) => s.key);
        if (!keys.includes(opts.until)) throw new Error(`No step "${opts.until}" in this run`);
        if (keys.indexOf(n.step.key) > keys.indexOf(opts.until)) return { status: "until", message: `Stopped before ${n.step.key}: ${opts.until} is done.` };
        batch = batch.filter((b) => keys.indexOf(b.step.key) <= keys.indexOf(opts.until!));
      }
      trace.setStep(batch.length > 1 ? undefined : batch[0]!.step.key);
      if (batch.length > 1) log(`side by side: ${batch.map((b) => b.step.key).join(", ")}`);
      // every step of the batch is recorded, whatever the others do; the first that ends the run's turn says how
      const ended = (await Promise.all(batch.map((b) => runStep(state, b.step, b.hash, batch.length)))).find((r) => r);
      if (ended) return ended;
    }
  } finally {
    trace.setStep(undefined);
    try { saveReport(ledger); } catch { /* the scorecard never breaks a run */ }
    // Phase 3: an estimate or a build that followed one may carry new evidence; the catalogue tunes itself in the background
    try {
      const s = replay(ledger.events());
      if (completed && (s.steps.get("estimate")?.status === "completed" || s.info.estimateRef)) triggerTune();
    } catch { /* tuning never breaks a run */ }
    trace.event("run", "executor stopped");
    trace.stopHeartbeat();
    ledger.onAppend = undefined;
    await lock.release();
  }
}

/** Ledger events that matter for "where is it?" become readable trace lines. */
function traceLedgerEvent(trace: Tracer, ev: LedgerEvent): void {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case "gate.result":
      trace.event("gate", `gate ${d.gateId} ${d.passed ? "passed" : "FAILED"}${d.passed ? "" : `: ${String(d.details ?? "").slice(0, 200)}`}`, { gateId: d.gateId, passed: d.passed });
      break;
    case "container.started": trace.event("container", `container ${d.role} started ${String(d.id).slice(0, 12)}`, { id: d.id, role: d.role }); break;
    case "container.removed": trace.event("container", `container removed ${String(d.id).slice(0, 12)}`, { id: d.id }); break;
    case "human.requested": trace.event("card", `waiting for you: ${d.kind} card ${String(d.artifactSha).slice(0, 8)}`); break;
    case "human.decided": trace.event("card", `decided: ${d.decision} by ${d.by}`); break;
    case "run.parked": trace.event("park", `PARKED: ${d.reason}`); break;
    case "step.failed": if (d.action) trace.event("ladder", `attempt failed (${d.category}) → ${d.action}${d.nextRung !== undefined ? ` at rung ${d.nextRung}` : ""}: ${d.reason ?? ""}`); break;
    case "workspace.created": trace.event("git", `worktree ${d.path} on ${d.branch}`); break;
    default: break;
  }
}
