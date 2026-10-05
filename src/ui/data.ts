// What the web screens show (`factory ui`), computed only from the ledger, the project configs
// and the repo at the run's base commit: the same sources as `factory status|show-card|report`.
// Read-only: nothing here writes to a ledger. Starting a run lives in start.ts.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, sep } from "node:path";
import type { z } from "zod";
import type { Design as DesignSchema } from "../contracts/artifacts.js";
import type { Breakdown, Estimate } from "../contracts/estimate.js";
import { buildInventory, type DesignInventory } from "../design/inventory.js";
import { depsOf, detectLayout } from "../design/layout.js";
import { LEVEL_NAMES, LEVELS, plannedChanges, sizeChange, type SizeResult } from "../design/size.js";
import { uiSizeCardLine } from "../design/card.js";
import { gitSource } from "../design/source.js";
import { verifyEvidence } from "../gates/engine.js";
import { currentCostCap } from "../ledger/caps.js";
import { readLockInfo, isLockFree } from "../ledger/exec-lock.js";
import { Ledger } from "../ledger/ledger.js";
import { replay, splitKey, statusLabel, type RunState } from "../ledger/state.js";
import { outcomes, scoreRun, stageStats, stageOf, type RunScore } from "../report.js";
import { jiraConfigured } from "../sources/jira.js";
import { figmaConfigured } from "../sources/figma.js";
import { designRunView } from "../design/runs.js";
import type { VisualCheck } from "../design/visual-check.js";
import { exportWorkbooks } from "../estimate/export.js";
import { humanReview } from "../estimate/settings.js";
import { catalogueStatusText } from "../estimate/catalogue-status.js";
import { exportInputFor } from "../stages/estimate-approve.js";
import { stepsFor } from "../stages/modes.js";
import { factoryHome } from "../util/paths.js";
import { lastActivity, readTrace } from "../util/trace.js";
import { maskSecrets } from "../config/env.js";
import { Redactor } from "../context/secrets.js";
import { readPreview } from "./preview.js";
import { factoryAssumed } from "../stages/gate-questions.js";
import { loadProject, STANDALONE_PROJECT } from "../config/project.js";
import { repoIsEmpty } from "../config/greenfield.js";

// ---------- helpers ----------

export function currentStep(s: RunState): string {
  const steps = [...s.steps.values()];
  return s.inFlight?.step ?? steps.filter((x) => x.status !== "completed").pop()?.step ?? steps[steps.length - 1]?.step ?? "-";
}

/** First line of the request, shortened for lists. */
export function shortRequest(request: string | undefined, max = 110): string {
  const line = (request ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Resolve a run id or a unique part of it (like the CLI). */
export function findRun(run: string): Ledger | undefined {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(run)) return undefined;
  if (Ledger.exists(run)) return Ledger.open(run);
  const m = Ledger.listRuns().filter((r) => r.includes(run));
  return m.length === 1 ? Ledger.open(m[0]!) : undefined;
}

// ---------- projects ----------

/** `empty`: a Node project whose repo is still empty, where an approved design for a new product is built (greenfield) */
export interface ProjectRow { name: string; busy?: { runId: string }; empty?: true }

export function projectNames(): string[] {
  const dir = join(factoryHome(), "projects");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yaml") && f !== `${STANDALONE_PROJECT}.yaml`).map((f) => f.replace(/\.yaml$/, "")).sort() : [];
}

/** Is a run executing on this project right now? (the executor's per-repo lock; its key is the project name) */
export async function busyRun(project: string): Promise<{ runId: string } | undefined> {
  if (await isLockFree(project)) return undefined;
  const info = readLockInfo(project);
  return { runId: info?.runId ?? "" };
}

export interface ApprovedEstimateRow { runId: string; project: string; request: string; createdAt: string; deliveryModel: string }

/** Estimate runs that are approved and exported: the ones a build can start from (factory start --from-estimate). */
export function approvedEstimatesView(): ApprovedEstimateRow[] {
  const rows: ApprovedEstimateRow[] = [];
  for (const id of Ledger.listRuns()) {
    try {
      const s = replay(Ledger.open(id).events());
      if (s.info.mode !== "estimate") continue;
      if (!["estimate", "approve-estimate", "export"].every((k) => s.steps.get(k)?.status === "completed")) continue;
      rows.push({ runId: id, project: s.info.project, request: shortRequest(s.info.request), createdAt: s.info.createdAt, deliveryModel: s.info.estimate?.deliveryModel ?? "hitl" });
    } catch { /* a broken ledger doesn't hide the others */ }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

export interface ApprovedDesignRow { runId: string; project: string; request: string; createdAt: string; repo: boolean }

/** Design-only runs with an approved design that has screens: the ones an estimate or a build can start from (--from-design). */
export function approvedDesignsView(): ApprovedDesignRow[] {
  const rows: ApprovedDesignRow[] = [];
  for (const id of Ledger.listRuns()) {
    try {
      const s = replay(Ledger.open(id).events());
      if (s.info.mode !== "design") continue;
      const base = s.steps.get("design-baseline");
      if (base?.status !== "completed" || !(base.data as { ui?: boolean } | undefined)?.ui) continue;
      rows.push({ runId: id, project: s.info.project, request: shortRequest(s.info.request), createdAt: s.info.createdAt, repo: !!s.info.repoPath && !!s.info.baseCommit });
    } catch { /* a broken ledger doesn't hide the others */ }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

export async function projectsView(): Promise<{ projects: ProjectRow[]; estimates: ApprovedEstimateRow[]; designs: ApprovedDesignRow[]; jira: { configured: boolean; why?: string }; figma: { configured: boolean; why?: string } }> {
  const projects: ProjectRow[] = [];
  for (const name of projectNames()) {
    const busy = await busyRun(name);
    let empty = false;
    try { const p = loadProject(name); empty = p.stack === "node" && repoIsEmpty(p.repo, p.baseBranch); } catch { /* a broken config is listed as it is */ }
    projects.push({ name, ...(busy ? { busy } : {}), ...(empty ? { empty: true as const } : {}) });
  }
  const configured = jiraConfigured();
  return {
    projects,
    estimates: approvedEstimatesView(),
    designs: approvedDesignsView(),
    jira: configured ? { configured } : { configured, why: "Jira isn't set up. Add JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to ~/.factory/.env (factory doctor checks it)." },
    figma: figmaConfigured() ? { configured: true } : { configured: false, why: "Figma links need FIGMA_TOKEN in ~/.factory/.env (a personal access token with read access to files). Until then, export the frames as PNG and attach them, or attach a Figma JSON export." },
  };
}

// ---------- runs list ----------

export interface RunRow {
  runId: string; request: string; project: string; status: string; step: string; costUsd: number;
  createdAt: string; openCard?: string; parkedReason?: string;
}

export function runsView(limit = 50): RunRow[] {
  const rows: RunRow[] = [];
  for (const id of Ledger.listRuns()) {
    try {
      const s = replay(Ledger.open(id).events());
      rows.push({
        runId: id, request: shortRequest(s.info.request), project: s.info.project, status: statusLabel(s.status), step: currentStep(s),
        costUsd: s.costUsd, createdAt: s.info.createdAt,
        ...(s.openCard ? { openCard: s.openCard.kind } : {}), ...(s.parkedReason ? { parkedReason: s.parkedReason } : {}),
      });
    } catch { /* a broken ledger doesn't hide the others */ }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// ---------- one run ----------

export interface Attempt { attempt: number; outcome: "running" | "completed" | "failed" | "interrupted" | "waiting" | "decided"; rung: number; why?: string; next?: string }
export interface GateChip { gateId: string; passed: boolean; step?: string; seq: number; safety?: boolean }
export interface TimelineRow {
  step: string; stage: string; status: string; attempts: number; costUsd: number; tries: Attempt[]; note?: string;
  /** machine time of all attempts, seconds */
  activeSec: number; models: string[]; gates: GateChip[];
}

/** The steps in pipeline order (tasks appear once the plan is done), each with its attempts. */
export function timeline(ledger: Ledger, s: RunState): TimelineRow[] {
  const events = ledger.events();
  const order = [...stepsFor(s).map((d) => d.key)];
  for (const k of s.steps.keys()) if (!order.includes(k)) order.push(k);
  const tries = new Map<string, Attempt[]>();
  const cost = new Map<string, number>();
  for (const ev of events) {
    if (!ev.key) continue;
    const { step, attempt } = splitKey(ev.key);
    const list = tries.get(step) ?? [];
    tries.set(step, list);
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const cur = list.find((a) => a.attempt === attempt);
    switch (ev.type) {
      case "step.started": list.push({ attempt, outcome: "running", rung: Number(d.rung ?? 0) }); break;
      case "step.completed": if (cur) cur.outcome = "completed"; break;
      case "step.interrupted": if (cur) cur.outcome = d.reason === "waiting" ? "waiting" : "interrupted"; break;
      case "step.failed": {
        if (!cur) break;
        cur.outcome = "failed";
        let first: string | undefined;
        if (ev.outputs?.[0] && ledger.hasArtifact(ev.outputs[0])) {
          try { first = ledger.getJson<{ message?: string }[]>(ev.outputs[0])[0]?.message; } catch { first = undefined; }
        }
        cur.why = (first ?? String(d.reason ?? d.signature ?? d.category ?? "failed")).slice(0, 300);
        if (d.parked) cur.next = "parked";
        else if (typeof d.action === "string") cur.next = `${d.action}${d.reason ? `: ${String(d.reason).slice(0, 160)}` : ""}`;
        break;
      }
      case "usage": cost.set(step, (cost.get(step) ?? 0) + Number(d["gen_ai.usage.cost_usd"] ?? d.costUsd ?? 0)); break;
      default: break;
    }
  }
  // a wait whose card was since decided: the step runs again when the run continues
  for (const [step, list] of tries) {
    for (const a of list) if (a.outcome === "waiting" && s.openCard?.step !== step) a.outcome = "decided";
  }
  const score = new Map(scoreRun(ledger).steps.map((x) => [x.step, x]));
  const parkEv = s.status === "parked" ? [...events].reverse().find((e) => e.type === "run.parked") : undefined;
  const parkedStep = (parkEv?.data as { step?: string } | undefined)?.step;
  return order.map((step) => {
    const r = s.steps.get(step);
    const t = tries.get(step) ?? [];
    let status: string = r?.status ?? "pending";
    if (s.openCard?.step === step) status = "waiting";
    else if (r?.status === "interrupted" && t[t.length - 1]?.outcome === "decided") status = "decided";
    if (parkedStep === step) status = "parked";
    return {
      step, stage: stageOf(step), status, attempts: r?.attempts ?? 0, costUsd: cost.get(step) ?? 0, tries: t,
      activeSec: Math.round(score.get(step)?.activeSec ?? 0), models: score.get(step)?.models ?? [],
      gates: gateChips(s).filter((g) => g.step === step),
      ...(parkedStep === step && s.parkedReason ? { note: s.parkedReason } : {}),
    };
  });
}

export function gateChips(s: RunState): GateChip[] {
  return s.gates.map((g) => ({ gateId: g.gateId, passed: g.passed, step: g.step, seq: g.seq, ...(g.safety ? { safety: true } : {}) }));
}

/** The commands a card prints, with its hash filled in: what the person pastes into their terminal. */
export function cardCommands(markdown: string, runId: string, hash8: string): string[] {
  const out = [`factory show-card ${runId}`];
  for (const line of markdown.split("\n")) {
    const m = /(?:^|\s|`)(factory (?:approve|reject|answer|waive-cap|stop)\s[^`]*?)`?\s*$/.exec(line);
    if (m) out.push(m[1]!.replace(/\s+/g, " ").replace("<hash>", hash8).trim());
  }
  return [...new Set(out)];
}

const evidenceCache = new Map<string, { seq: number; value: { ok: boolean; total: number; failed: { seq: number; gateId: string; reason?: string }[] } }>();

function evidence(ledger: Ledger, seq: number) {
  const hit = evidenceCache.get(ledger.runId);
  if (hit?.seq === seq) return hit.value;
  const checks = verifyEvidence(ledger);
  const value = { ok: checks.every((c) => c.ok), total: checks.length, failed: checks.filter((c) => !c.ok).map((c) => ({ seq: c.seq, gateId: c.gateId, reason: c.reason })) };
  evidenceCache.set(ledger.runId, { seq, value });
  return value;
}

/** The questions on a run's question card, so the run page can ask them. */
function questionsOf(ledger: Ledger, sha: string) {
  const body = ledger.getJson<{ asked?: { id: string; text: string; options: string[]; recommended: string; reason: string; impactReason: string }[]; assumptions?: { id: string; text: string }[] }>(sha);
  if (!body?.asked?.length) return {};
  return {
    questions: body.asked.map((q) => ({ id: q.id, text: q.text, options: q.options, recommended: q.recommended, reason: q.reason, why: q.impactReason })),
    assumptions: (body.assumptions ?? []).map((a) => ({ id: a.id, text: a.text })),
  };
}

export function runView(ledger: Ledger) {
  const s = replay(ledger.events());
  const card = s.openCard && existsSync(join(ledger.cardsDir, `${s.openCard.cardId}.md`)) ? ledger.readCard(s.openCard.cardId) : undefined;
  const hash8 = s.openCard?.artifactSha.slice(0, 8) ?? "";
  const done = s.status === "delivered" || (typeof s.status === "object" && s.steps.get("deliver")?.status === "completed");
  const d = (s.steps.get("deliver")?.data ?? {}) as { branch?: string; head?: string; prUrl?: string; local?: boolean };
  const prFile = join(ledger.cardsDir, `pr-${ledger.runId}.md`);
  const last = lastActivity(ledger.dir);
  const trace = readTrace(ledger.dir).filter((e) => e.kind !== "model.turn.detail").slice(-40)
    .map((e) => ({ ts: e.ts, where: e.step ? `${e.step}${e.attempt ? `#${e.attempt}` : ""}` : "run", kind: e.kind, msg: e.msg }));
  return {
    runId: ledger.runId,
    mode: s.info.mode,
    project: s.info.project,
    // a repo to build in (a design or estimate made with no project has none)
    repo: !!s.info.repoPath && !!s.info.baseCommit,
    request: s.info.request ?? "",
    sources: s.info.sources ?? [],
    createdAt: s.info.createdAt,
    status: statusLabel(s.status),
    step: currentStep(s),
    parkedReason: s.parkedReason,
    cost: { usd: s.costUsd, capUsd: currentCostCap(s), ...(s.info.maxCostUsd !== undefined ? { maxCostUsd: s.info.maxCostUsd } : {}) },
    activeMin: s.activeMs / 60_000,
    lastActivity: last ? { ts: last.ts, msg: last.msg, where: last.step ?? "run" } : undefined,
    timeline: timeline(ledger, s),
    gates: gateChips(s),
    card: s.openCard ? { kind: s.openCard.kind, hash: hash8, markdown: card ?? "(the card file is missing)", commands: cardCommands(card ?? "", ledger.runId, hash8), ...(s.openCard.kind === "question" ? questionsOf(ledger, s.openCard.artifactSha) : {}) } : undefined,
    trace,
    delivered: done ? {
      branch: d.branch ?? s.workspace?.branch, head: d.head, prUrl: d.prUrl, local: d.local !== false,
      prText: existsSync(prFile) ? ledger.readCard(`pr-${ledger.runId}`) : undefined,
      evidence: evidence(ledger, s.lastSeq),
    } : undefined,
  };
}

// ---------- dashboard ----------

export function allScores(): RunScore[] {
  return Ledger.listRuns().map((id) => { try { return scoreRun(Ledger.open(id)); } catch { return undefined; } }).filter((r): r is RunScore => !!r);
}

export function dashboardView() {
  const runs = allScores();
  return { outcomes: outcomes(runs), stages: stageStats(runs), recent: runsView(8) };
}

// ---------- the four status views: events (text) and stats (graphical, statistical) ----------

export const MAX_EVENTS = 5000;

/** The run's ledger events for the text view, secret-masked like the trace, newest last. */
export function eventsView(ledger: Ledger) {
  const redactor = new Redactor();
  const clean = (x: unknown) => JSON.parse(redactor.redact(maskSecrets(JSON.stringify(x))).text) as unknown;
  const evs = ledger.events();
  return {
    total: evs.length,
    events: evs.slice(-MAX_EVENTS).map((e) => ({
      seq: e.seq, ts: e.ts, type: e.type,
      step: e.key ? splitKey(e.key).step : undefined,
      attempt: e.key ? splitKey(e.key).attempt : undefined,
      detail: clean({ ...(e.data !== undefined ? { data: e.data } : {}), ...(e.outputs?.length ? { outputs: e.outputs } : {}), ...(e.treeSha ? { treeSha: e.treeSha } : {}), ...(e.inputsHash ? { inputsHash: e.inputsHash } : {}) }),
    })),
    trace: readTrace(ledger.dir).filter((t) => t.kind !== "model.turn.detail").slice(-MAX_EVENTS)
      .map((t) => ({ ts: t.ts, kind: t.kind, step: t.step, msg: redactor.redact(t.msg).text })),
  };
}

/** Numbers for the graphical and statistical views, from the scorecard and the ledger. */
export function statsView(ledger: Ledger) {
  const s = replay(ledger.events());
  const score = scoreRun(ledger);
  const events = ledger.events();
  let cum = 0;
  const costOverTime = events.filter((e) => e.type === "usage").map((e) => {
    cum += Number((e.data as Record<string, unknown> | undefined)?.["gen_ai.usage.cost_usd"] ?? 0);
    return { ts: e.ts, usd: cum };
  });
  const gates = s.gates.length;
  const passed = s.gates.filter((g) => g.passed).length;
  const done = score.steps.filter((x) => x.outcome === "completed");
  const first = events[0]?.ts ?? s.info.createdAt;
  const lastTs = events[events.length - 1]?.ts ?? first;
  return {
    runId: ledger.runId,
    capUsd: currentCostCap(s),
    totalUsd: s.costUsd,
    activeMin: s.activeMs / 60_000,
    wallMin: first && lastTs ? (Date.parse(lastTs) - Date.parse(first)) / 60_000 : 0,
    attempts: score.steps.reduce((n, x) => n + x.attempts, 0),
    retries: score.steps.reduce((n, x) => n + Math.max(0, x.attempts - 1), 0),
    firstTimePass: { passed: done.filter((x) => x.firstTimePass).length, finished: done.length },
    gates: { passed, failed: gates - passed },
    humanStops: score.humanCards?.length ?? 0,
    tokens: score.steps.reduce((t, x) => ({ input: t.input + x.tokens.input, output: t.output + x.tokens.output, cached: t.cached + x.tokens.cached }), { input: 0, output: 0, cached: 0 }),
    steps: score.steps.map((x) => ({ step: x.step, costUsd: x.costUsd, activeSec: x.activeSec, attempts: x.attempts, retries: Math.max(0, x.attempts - 1), outcome: x.outcome })),
    costOverTime,
  };
}

/** The run's preview (mocks, designs), or an honest empty state. */
export function previewView(ledger: Ledger) {
  return { runId: ledger.runId, ...readPreview(ledger) };
}

// ---------- design ----------

const inventoryCache = new Map<string, DesignInventory | { none: string }>();

/** The repo's pages and building blocks at a commit, or why there's nothing to show. Cached per commit. */
export function inventoryAt(repo: string, commit: string): DesignInventory | { none: string } {
  const key = `${repo}@${commit}`;
  const hit = inventoryCache.get(key);
  if (hit) return hit;
  const src = gitSource(repo, commit);
  const deps = depsOf(src);
  const hasUi = Object.keys(deps).some((k) => /^(react|next|react-dom|@remix-run\/react|vue|svelte)$/.test(k))
    || src.list().some((f) => /\.(tsx|jsx)$/.test(f));
  const value = hasUi ? buildInventory(src) : { none: "No web UI found in this repo (no package.json with React, Next.js or Vue, and no .tsx or .jsx files)." };
  inventoryCache.set(key, value);
  return value;
}

interface PlanLike { tasks?: { fileScope?: string[] }[] }

export function designView(ledger: Ledger) {
  const s = replay(ledger.events());
  const { repoPath, baseCommit } = s.info;
  const plan = s.steps.get("plan");
  let uiSize: { size: SizeResult; cardLine?: string; approvalCardLine?: string } | { none: string };
  if (!repoPath || !baseCommit) uiSize = { none: "This run has no repo." };
  else if (plan?.status !== "completed" || !plan.outputs[0]) uiSize = { none: "The plan isn't done yet; the UI change size is worked out from the plan's files." };
  else {
    try {
      const p = ledger.getJson<PlanLike>(plan.outputs[0]);
      const files = [...new Set((p.tasks ?? []).flatMap((t) => t.fileScope ?? []))].sort();
      const src = gitSource(repoPath, baseCommit);
      const deps = depsOf(src);
      const layout = deps.react || deps.next ? detectLayout(src) : undefined;
      const size = sizeChange({ files: plannedChanges(files, src, layout) }, layout ? { layout } : {});
      // the line exactly as the approval card showed it, when there is one
      const approval = s.decisions.map((d) => d.cardId).concat(s.openCard ? [s.openCard.cardId] : []).filter((c) => c.startsWith("approval-")).pop();
      const approvalCardLine = approval && existsSync(join(ledger.cardsDir, `${approval}.md`))
        ? ledger.readCard(approval).split("\n").find((l) => l.startsWith("UI size: ")) : undefined;
      const cardLine = uiSizeCardLine(size);
      uiSize = { size, ...(cardLine ? { cardLine } : {}), ...(approvalCardLine ? { approvalCardLine } : {}) };
    } catch (e) {
      uiSize = { none: `Couldn't work out the UI size: ${(e as Error).message.split("\n")[0]}` };
    }
  }
  let inventory: ReturnType<typeof inventorySummaryView> | { none: string };
  if (!repoPath || !baseCommit) inventory = { none: "This run has no repo." };
  else {
    try {
      const inv = inventoryAt(repoPath, baseCommit);
      inventory = "none" in inv ? inv : inventorySummaryView(inv, baseCommit);
    } catch (e) {
      inventory = { none: `Couldn't read the repo at ${baseCommit.slice(0, 8)}: ${(e as Error).message.split("\n")[0]}` };
    }
  }
  const styleChecks = s.gates.filter((g) => g.gateId.startsWith("design.")).map((g) => ({ gateId: g.gateId, passed: g.passed, step: g.step, seq: g.seq }));
  const levels = LEVELS.map((level) => ({ level, name: LEVEL_NAMES[level] }));
  const vs = s.steps.get("design-check");
  const visual: VisualCheck | { none: string } = vs?.status === "completed" && vs.outputs[0] ? ledger.getJson<VisualCheck>(vs.outputs[0])
    : { none: "The visual check runs after the build's acceptance step." };
  return { runId: ledger.runId, project: s.info.project, levels, uiSize, inventory, styleChecks, visual };
}

const nameOf = (c: { key: string; exports: string[] }) => c.exports[0] ?? c.key.split("/").pop()!;

function inventorySummaryView(inv: DesignInventory, commit: string) {
  return {
    commit,
    stack: inv.stack,
    tokens: { light: inv.tokens.light, dark: inv.tokens.dark, theme: inv.tokens.theme },
    pages: inv.pages.map((p) => ({ route: p.route, path: p.path, heading: p.heading, kind: p.kind })),
    buildingBlocks: inv.primitives.map((c) => ({ name: nameOf(c), path: c.path, uses: c.uses, variants: Object.keys(c.variants) })),
    sharedComponents: inv.composites.map((c) => ({ name: nameOf(c), path: c.path, uses: c.uses })),
    offSystem: { hexColors: inv.offSystem.hexColors, arbitraryValues: inv.offSystem.arbitraryValues, inlineStyle: inv.offSystem.inlineStyle, ratio: inv.offSystem.ratio },
    verdict: inv.verdict,
  };
}

// ---------- estimate ----------

interface ExportManifest { team: string; client: string; /** the design book PDF beside the client workbook */ design?: string; designNote?: string }

/** The estimate run's numbers and what they rest on, from the ledger: the same figures as the approval card and workbooks. */
export function estimateView(ledger: Ledger) {
  const s = replay(ledger.events());
  if (s.info.mode !== "estimate") return { runId: ledger.runId, none: "This is not an estimate run. Start one from New run, then Estimate." };
  const done = (step: string) => { const r = s.steps.get(step); return r?.status === "completed" ? r.outputs[0] : undefined; };
  const estSha = done("estimate");
  if (!estSha) return { runId: ledger.runId, settings: s.info.estimate ?? {}, none: "The estimate isn't ready yet. It appears here after the breakdown and sizing steps finish." };
  const est = ledger.getJson<Estimate>(estSha);
  const bdSha = done("breakdown");
  const bd = bdSha ? ledger.getJson<Breakdown>(bdSha) : undefined;
  const titles = new Map((bd?.tasks ?? []).map((t) => [t.id, t]));
  const baseline = done("design-baseline") ? ledger.getJson<{ ui: boolean; design?: string }>(done("design-baseline")!) : undefined;
  const design = baseline?.ui && baseline.design ? ledger.getJson<z.infer<typeof DesignSchema>>(baseline.design) : undefined;
  const approval = s.steps.get("approve-estimate");
  const manifestSha = done("export");
  const files = manifestSha ? (() => { const m = ledger.getJson<ExportManifest>(manifestSha); return { team: existsSync(m.team), client: existsSync(m.client), design: !!m.design && existsSync(m.design), ...(m.designNote ? { designNote: m.designNote } : {}) }; })() : undefined;
  return {
    runId: ledger.runId,
    settings: s.info.estimate ?? {},
    deliveryModel: est.deliveryModel, band: est.band, uncertainty: est.uncertainty, complexity: est.complexity,
    totals: est.totals, apiCost: est.apiCost, elapsed: est.elapsed,
    tasks: est.tasks.map((t) => {
      const b = titles.get(t.taskId);
      return { id: t.taskId, title: b?.title ?? t.taskId, track: b?.track, kind: b?.kind, size: t.size, executor: t.executor, hours: t.hours, ...(t.apiUsd ? { apiUsd: t.apiUsd } : {}), anchor: t.anchorId, ratio: t.ratio, reason: t.reason, flagged: t.flagged, splitAdvised: t.splitAdvised, references: t.references, screen: b?.screen, reqs: b?.reqs ?? [], overhead: b?.overhead };
    }),
    anchors: est.anchors,
    overheads: est.overheads,
    gateHours: est.gateHours,
    scenarios: est.scenarios,
    suggested: est.suggested,
    assumptions: est.assumptions,
    ...(est.stack ? { stack: est.stack } : {}),
    ...(est.catalogue ? { catalogue: { ...est.catalogue, statusText: catalogueStatusText(est.catalogue) } } : {}),
    design: baseline === undefined ? { pending: true } : !design ? { ui: false } : {
      ui: true, flow: design.flow,
      screens: design.screens.map((x) => ({ id: x.id, route: x.route, size: x.size ?? "new", states: x.states ?? [], reqs: x.reqs, frames: x.frames ?? [] })),
      unmapped: design.mapping.unmappedReqs, noScreen: design.noScreen ?? [],
    },
    pending: s.openCard?.kind === "estimate-approval" ? { hash: s.openCard.artifactSha.slice(0, 8), flagged: est.tasks.filter((t) => t.flagged).map((t) => t.taskId) } : undefined,
    approved: approval?.status === "completed" ? (() => {
      const a = (approval.data ?? {}) as { by?: string; hash?: string; auto?: boolean };
      return { by: String(a.by ?? ""), hash: String(a.hash ?? ""), ...(a.auto ? { auto: true } : {}) };
    })() : undefined,
    // a hands-off run: nobody was asked, so what clarify found unclear is listed as the factory's assumptions
    ...(!humanReview(s.info) ? { handsOff: true, factoryAssumptions: ["clarify", "clarify-2"].flatMap((k) => {
      const sha = done(k);
      const r = sha ? ledger.getJson<{ assumedBy?: string; assumptions?: { id: string; text: string; risk: string; fromDefault?: string }[] }>(sha) : undefined;
      return r?.assumedBy ? (r.assumptions ?? []).map((a) => ({ id: a.id, text: a.text, risk: a.risk, ...(a.fromDefault ? { fromDefault: a.fromDefault } : {}) })) : [];
    }).concat(factoryAssumed(ledger)) } : {}),
    files,
  };
}

/** A workbook (or the design book PDF) the run exported, or undefined: only the manifest paths, only inside the run's export folder, never through a link. */
export function exportFile(ledger: Ledger, audience: string): { body: Buffer; name: string } | undefined {
  if (audience !== "team" && audience !== "client" && audience !== "design") return undefined;
  const s = replay(ledger.events());
  const step = s.steps.get("export");
  if (step?.status !== "completed" || !step.outputs[0]) return undefined;
  const p = ledger.getJson<ExportManifest>(step.outputs[0])[audience];
  if (!p) return undefined;
  try {
    const root = realpathSync(join(ledger.dir, "export"));
    if (lstatSync(p).isSymbolicLink()) return undefined;
    const real = realpathSync(p);
    if (!real.startsWith(root + sep) || !(audience === "design" ? /\.pdf$/i : /\.xlsx$/i).test(real) || !lstatSync(real).isFile()) return undefined;
    return { body: readFileSync(real), name: basename(real) };
  } catch { return undefined; }
}

/** A workbook drawn from the finished estimate before anyone has approved it: the same figures, marked DRAFT in its name, kept apart from the approved export. */
export async function draftFile(ledger: Ledger, audience: string): Promise<{ body: Buffer; name: string } | undefined> {
  if (audience !== "team" && audience !== "client") return undefined;
  const s = replay(ledger.events());
  if (s.info.mode !== "estimate" || s.steps.get("estimate")?.status !== "completed" || !s.steps.get("breakdown")?.outputs[0] || !s.steps.get("specify")?.outputs[0]) return undefined;
  try {
    const dir = join(ledger.dir, "draft-export");
    const files = await exportWorkbooks(exportInputFor(s, ledger), dir, ledger.runId, {});
    const p = files[audience];
    return { body: readFileSync(p), name: `DRAFT-${basename(p)}` };
  } catch { return undefined; }
}

/** A picture from the run's visual check: only a .png inside <ledger>/design-check, never through a link. */
// ---------- design references ----------

/**
 * A run's design references for the page: each R-n with its pictures (served by /refs/<run>/<file>), what was measured, how
 * the design-refs step read it, how the design used it (or why it was set aside), the screens it shaped, and the screens
 * still differing from a layout reference.
 */
export function referencesView(ledger: Ledger) {
  const v = designRunView(ledger);
  const base = `/refs/${encodeURIComponent(ledger.runId)}/`;
  return {
    runId: ledger.runId,
    ...(v.references.length ? {} : { none: "No design references were attached to this run. Attach them on New run (any mode) or with --ref." }),
    references: v.references.map((r) => ({
      ...r, images: (r.images ?? []).map((im) => ({ url: base + encodeURIComponent(basename(im.file)), label: im.label })),
      screens: v.screens.filter((x) => x.refs?.includes(r.id)).map((x) => ({ id: x.id, title: x.title ?? x.route })),
      gaps: (v.refLayout ?? []).filter((g) => g.ref === r.id),
    })),
  };
}

/** One stored reference picture (refs/R-n-k.png), only that name pattern, inside the run's folder, no symlinks. */
export function refImage(ledger: Ledger, name: string): Buffer | undefined {
  if (!/^R-\d{1,2}-\d{1,2}\.png$/.test(name)) return undefined;
  try {
    const root = realpathSync(join(ledger.dir, "refs"));
    const p = join(root, name);
    if (lstatSync(p).isSymbolicLink()) return undefined;
    const real = realpathSync(p);
    if (!real.startsWith(root + sep) || !lstatSync(real).isFile()) return undefined;
    return readFileSync(real);
  } catch { return undefined; }
}

export function visualShot(ledger: Ledger, rel: string): Buffer | undefined {
  if (!/^(base|final|diff)\/[\w.-]+\.png$/.test(rel)) return undefined;
  try {
    const root = realpathSync(join(ledger.dir, "design-check"));
    const p = join(root, rel);
    if (lstatSync(p).isSymbolicLink()) return undefined;
    const real = realpathSync(p);
    if (!real.startsWith(root + sep) || !lstatSync(real).isFile()) return undefined;
    return readFileSync(real);
  } catch { return undefined; }
}
