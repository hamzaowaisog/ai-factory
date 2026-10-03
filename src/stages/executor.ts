// The executor (run-manager §2.3, §2.5, §2.9): replay → next step → run → record → repeat,
// until a human card, a park, delivery, or a stop/pause request. One executor per repo.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Failure, LedgerEvent } from "../contracts/index.js";
import { loadProject, type ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY, mergePolicy, withPolicy, type Policy } from "../gates/policy.js";
import { DEFAULT_LADDER, nextOnFailure, type AttemptRecord, type LadderAction } from "../gates/ladder.js";
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
import { greenfieldRefusal } from "../config/greenfield.js";
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

function versions(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
  return { factory: pkg.version, node: process.version, "mode:brownfield": "1", "mode:estimate": "1", "mode:design": "1", ...Object.fromEntries(Object.entries(pkg.dependencies).filter(([k]) => /anthropic|openai|zod/.test(k))) };
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
  if (opts.mode === "greenfield") {
    if (!opts.fromDesign || opts.fromDesign.repo) throw new Error("A greenfield run builds an approved design for a new product (one designed with no repo).");
    const why = greenfieldRefusal(opts.fromDesign.runId, project);
    if (why) throw new Error(why);
  } else if (opts.fromDesign && !opts.fromDesign.repo && !readsRequirements(opts.mode)) throw new Error(`${opts.fromDesign.runId} is a new product (designed with no repo): build it as a greenfield run.`);
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

/** Pure: the first step whose recorded inputsHash doesn't match its current inputs. */
export function next(state: RunState, ledger: Ledger, project: ProjectConfig): NextStep {
  for (const step of stepsFor(state)) {
    const inp = step.inputs(state, ledger);
    if (!inp) return { kind: "blocked", step: step.key };
    let model: string | undefined;
    try { model = routeFor(project, step.stage).model; } catch { model = undefined; }
    const { hash, done } = stepDone(state, step, inp, model);
    if (done) continue;
    return { kind: "run", step, hash };
  }
  return { kind: "done" };
}

/** Failed attempts of a step since it last completed (a changed input starts a fresh ladder). */
function attemptHistory(ledger: Ledger, step: string): AttemptRecord[] {
  const all = ledger.events();
  const evs = all.filter((e) => e.key && splitKey(e.key).step === step);
  const lastDone = Math.max(-1, ...evs.filter((e) => e.type === "step.completed").map((e) => e.seq));
  // a human raising the attempt limit starts the ladder fresh
  const lastRaise = Math.max(-1, ...all.filter((e) => e.type === "human.decided" && (e.data as { decision?: string; extraAttempts?: number })?.decision === "waive-cap" && typeof (e.data as { extraAttempts?: number }).extraAttempts === "number").map((e) => e.seq));
  const since = Math.max(lastDone, lastRaise);
  return evs.filter((e) => e.type === "step.failed" && e.seq > since && !(e.data as { parked?: boolean })?.parked)
    .map((e) => e.data as unknown as AttemptRecord);
}

/** A run that has ended never reuses a build again: free the disk its kept builds use. */
function dropBuildCache(runId: string): void {
  rmSync(join(factoryHome(), "tmp", runId, "builds"), { recursive: true, force: true });
}

export interface ExecuteResult { status: string; message: string }

export async function execute(runId: string, echo: Log = () => undefined): Promise<ExecuteResult> {
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
  trace.startHeartbeat();
  trace.event("run", `executor started (pid ${process.pid})`);
  try {
    state = replay(ledger.events());
    // crash recovery: an unfinished step becomes interrupted; its containers are removed
    if (state.inFlight) {
      const { step, attempt } = state.inFlight;
      log(`resuming: ${step} attempt ${attempt} was interrupted`);
      try {
        const rt = runtime();
        for (const c of await rt.listByLabel("factory.run", runId)) { await rt.stop(c.id, 2); await rt.remove(c.id); }
      } catch { /* no runtime available: nothing to clean */ }
      await ledger.append({ type: "step.interrupted", key: eventKey(step, attempt) }, writer);
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

      const rec = state.steps.get(n.step.key);
      const attempt = (rec?.lastAttempt ?? 0) + 1;
      const history = attemptHistory(ledger, n.step.key);
      const lastFail = [...ledger.events()].reverse().find((e) => e.type === "step.failed" && e.key && splitKey(e.key).step === n.step.key);
      const rung = history.length ? Number((lastFail?.data as { nextRung?: number } | undefined)?.nextRung ?? 0) : 0;
      const priorFailures: Failure[] = history.length && lastFail?.outputs?.[0] ? ledger.getJson<Failure[]>(lastFail.outputs[0]) : [];
      const key = eventKey(n.step.key, attempt);
      trace.setStep(n.step.key, attempt);
      await ledger.append({ type: "step.started", key, inputsHash: n.hash, data: { rung } }, writer);
      log(`▶ ${n.step.key} (attempt ${attempt}${rung ? `, rung ${rung}` : ""})`);

      const ctx: StepContext = {
        runId, ledger, writer, state, project, policy, attempt, rung, priorFailures, log, trace,
        usage: async (u) => {
          await ledger.append({ type: "usage", key, data: {
            "gen_ai.request.model": u.model, "gen_ai.usage.input_tokens": u.inputTokens, "gen_ai.usage.output_tokens": u.outputTokens,
            "gen_ai.usage.cache_read_tokens": u.cacheRead, "gen_ai.usage.cache_write_tokens": u.cacheWrite, "gen_ai.usage.cost_usd": u.estUsd,
          } }, writer);
        },
      };
      let outcome: StepOutcome;
      try {
        outcome = await withPolicy(policy, () => n.step.run(ctx));
      } catch (e) {
        const msg = (e as Error).message;
        log(`  error: ${msg}`);
        outcome = { kind: "fail", category: /rate limit|overloaded|529|429/i.test(msg) ? "rate-limit" : "other", failures: [{ check: "exception", message: msg.slice(0, 1000), frames: [] }], signature: `exception:${msg.slice(0, 120)}` };
      }

      switch (outcome.kind) {
        case "done": {
          const named = outcome.outputs;
          const treeSha = outcome.treeSha && /^[0-9a-f]{40}$/.test(outcome.treeSha) ? outcome.treeSha : undefined;
          await ledger.append({ type: "step.completed", key, inputsHash: n.hash, treeSha, outputs: Object.values(named), data: { ...(outcome.data ?? {}), named } }, writer);
          completed++;
          const after = replay(ledger.events()).costUsd;
          log(`✓ ${n.step.key} ($${(after - state.costUsd).toFixed(2)}, total $${after.toFixed(2)})`);
          if (n.step.key === "deliver") {
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
          await ledger.append({ type: "human.requested", data: { ...(c.extra ?? {}), cardId: c.cardId, kind: c.kind, artifactSha: c.artifactSha, step: n.step.key, deadline: c.deadline, defaultDecision: c.defaultDecision } }, writer);
          return { status: "waiting", message: `A card needs you: factory show-card ${runId}` };
        }
        case "park":
          await ledger.append({ type: "step.failed", key, data: { category: "other", signature: "park", rung, parked: true } }, writer);
          await ledger.append({ type: "run.parked", data: { reason: outcome.reason, step: n.step.key } }, writer);
          return { status: "parked", message: outcome.reason };
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
            ...DEFAULT_LADDER, maxAttempts: policy.retryBudget + state.capOverrides.extraAttempts, availableRungs: availableRungs(project, n.step.stage, policy.localOnly), backoffSpentMs: backoffSpent, a5Done: new Set(),
          });
          const failuresSha = ledger.putJson(outcome.failures.slice(0, 20));
          await ledger.append({
            type: "step.failed", key, outputs: [failuresSha],
            data: { ...(outcome.data ?? {}), ...rec2, action: action.action, nextRung: action.action === "retry" ? action.rung : rung, waitMs: action.action === "backoff" ? action.waitMs : 0, reason: action.reason },
          }, writer);
          log(`✗ ${n.step.key}: ${outcome.failures.slice(0, 2).map((f) => f.message).join("; ").slice(0, 300)} → ${action.action}`);
          if (action.action === "park") { await ledger.append({ type: "run.parked", data: { reason: `${n.step.key}: ${action.reason}`, step: n.step.key } }, writer); return { status: "parked", message: `${n.step.key}: ${action.reason}. Last failure: ${outcome.failures[0]?.message ?? ""}` }; }
          if (action.action === "a5-check") {
            const reason = `Locked tests ${action.testIds.join(", ")} failed twice. Either the code or the test is wrong; the test-defect check and unlock card aren't built yet, so a human needs to look.`;
            await ledger.append({ type: "run.parked", data: { reason, step: n.step.key } }, writer);
            return { status: "parked", message: reason };
          }
          if (action.action === "backoff") { log(`  waiting ${Math.round(action.waitMs / 1000)}s (rate limit)`); await new Promise((r) => setTimeout(r, action.waitMs)); }
          break;
        }
      }
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
