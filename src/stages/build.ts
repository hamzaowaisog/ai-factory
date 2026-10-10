// Build side of the brownfield slice (stages-aligned §1): discover/baseline → stub commit →
// author-tests (fails on base twice → lock) → implement ⟲ task verify → integrate → accept.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Failure, IntentBody, LedgerEvent, PlanBody, SpecDraft, TestResult, TestRun } from "../contracts/index.js";
import { scanText } from "../context/secrets.js";
import { failure, runGate, type GateDef } from "../gates/engine.js";
import {
  configIntegrity, diffInScope, diffSize, ESCAPE_HATCHES, failsOnBase, lockSetUnchanged, noEscapeHatches, noSecrets, testExpectations,
  type DiffSummary,
} from "../gates/predicates.js";
import { CONFIG_INTEGRITY_GLOBS } from "../gates/protected.js";
import { matchesAny } from "../util/glob.js";
import { failureSignature, RUNGS } from "../gates/ladder.js";
import { changedFiles, commitAll, diffIncludingUntracked, git, headSha, repoRefusals, resetHard, trackIgnored } from "../ledger/git.js";
import { agentDatabase, NO_CREDIT_TEXT, type AgentProgress } from "../runners/claude-agent.js";
import { codingRunner } from "../runners/codex.js";
import { ensureAgentImage, ensureEgress, feedHostsFrom } from "../runners/netinfra.js";
import { buildPack, FILE_INLINE_MAX } from "../context/pack.js";
import { Redactor } from "../context/secrets.js";
import { sha256 } from "../util/hash.js";
import type { Ledger } from "../ledger/ledger.js";
import { unlockedFiles } from "../ledger/human.js";
import { parseTrx } from "../verify/trx.js";
import { factoryHome } from "../util/paths.js";
import { BUILT_SCHEMA_FILE, buildCachePath, produceDotnetTests, skippableKnownFailures, type BuiltSchema, type Probe, type ProduceOutput } from "../verify/dotnet.js";
import type { ProjectConfig } from "../config/project.js";
import { installIsCurrent, installNodeModules, labFor, markInstalled, runNodeOffline } from "../verify/lab.js";
import { contractGap, contractMatches, dataModelMatches } from "../gates/contract.js";
import { changedPackages, isPackageManifest, packagesPlanned, type PackageChange, type PackageChanges } from "../gates/packages.js";
import { DATA_MODEL_FILE, dataModelDiff, dataModelYaml } from "../gates/data-model.js";
import { parse } from "yaml";
import { DataModel, ReviewCoverage } from "../contracts/index.js";
import { CLIENT_CMD, CLIENT_DIR, contractLockFiles, prepareClient } from "./contract.js";
import { authorIntro, implementIntro, notFoundHint } from "./stack-text.js";
import type { Expectations } from "../verify/validate.js";
import { readApproved } from "../conventions/store.js";
import { guidelinesBrief } from "../conventions/brief.js";
import { approvedDesignFor } from "./design-inputs.js";
import { header, outputOf, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { availableRungs, lightLaneModel, modelFor } from "./routing.js";
import { family } from "../runners/types.js";
import { S, think, tracePack } from "./think.js";
import { changeBase, ensureWorktree, runtime, snapshotFor, toolsAt, uiBase } from "./workspace.js";
import { replay, splitKey, type RunState } from "../ledger/state.js";
import { REPO_DESIGN_DIR, repoFiles, type DesignPackage } from "../design/package.js";
import { exportRunPackage } from "./design-export.js";
import { stepBudgetUsd } from "../ledger/caps.js";
import { LANE, lightBuild, testWriterTurns } from "./lane.js";
import { lessonPointers, readLessons, usableLessons } from "../context/lessons.js";
import { sizeCap } from "../estimate/gates.js";
import { buildWaiver } from "../estimate/build-waiver.js";
import { testsCoverCriteria } from "../gates/coverage.js";
import type { WaiverRow } from "../estimate/log.js";
import { designFidelityLint, designSizeCap } from "../design/gates.js";
import { screenBrief, screenFacts, screenFor, screensBrief, screensForTask, type ApprovedDesign } from "../design/design-link.js";
import { scaffoldSummary, writeScaffold } from "../design/kit/index.js";
import { loadKit } from "../design/kit/kit.js";
import { screenTestsReady } from "../design/kit/screen-tests.js";
import { scaffoldOfRun, type ScaffoldRecord } from "./scaffold-run.js";
import { repoIsEmpty } from "../config/greenfield.js";
import { actualSize, approvedLevel, designOptions, fidelityLint, hasReactApp, touchesUiFiles } from "../design/build-checks.js";
import { buildInventory, inventorySummary } from "../design/inventory.js";
import { dirSource } from "../design/source.js";

type Plan = z.infer<typeof PlanBody> & { complexity: string };
type Intent = z.infer<typeof IntentBody>;

/** A coding agent isn't started with less than this left under the cost limit: it reads the briefing and the repo before it writes anything. */
const AGENT_START_USD = 1;

/** "AC-2.3" → "REQ-2". */
export const reqOfAc = (acId: string) => acId.replace(/^AC-(\d+)\..*$/, "REQ-$1");

/**
 * Criterion tests that already pass on the old code become must-keep-passing (failsOnBase false),
 * as long as some test in the run still fails on the old code: that one proves the change is needed.
 * A whole requirement can be "keep this working" (e.g. "whitespace ids are still trimmed").
 * If every test passes on the old code, nothing proves the bug, and the fails-on-base check rejects them as before.
 */
export function keepPassingTests<T extends { acId: string; testId: string; failsOnBase: boolean }>(tests: T[], passedOnBase: Set<string>): T[] {
  if (!tests.some((t) => !passedOnBase.has(t.testId))) return tests;
  return tests.map((t) => (passedOnBase.has(t.testId) ? { ...t, failsOnBase: false } : t));
}

/** Files the spec's anchors point at: where the test writer should start reading. */
export function anchorFiles(spec: Pick<Spec, "requirements">): string[] {
  return [...new Set(spec.requirements.flatMap((r) => (r.anchors ?? []).map((a) => a.path)))].slice(0, 10);
}
type Spec = z.infer<typeof SpecDraft>;

/**
 * The locked files a run works under: the test writer's lock, less any file a person unlocked for this run (factory unlock).
 * Run 0f9d: a planned stub landed in the generated client's folder and was locked with it, so no task could fill it in.
 */
export function lockOf(state: RunState, ledger: Ledger): { lock: Lock; sha: string } {
  const sha = state.steps.get("author-tests")!.outputs[0]!;
  const lock = ledger.getJson<Lock>(sha);
  const freed = unlockedFiles(ledger.events());
  if (!freed.length) return { lock, sha };
  const cut = { ...lock, lock: lock.lock.filter((l) => !freed.some((u) => u.file === l.file)), unlocks: freed.map((u) => ({ what: u.file, human: u.by, reason: u.reason, boundTo: sha })) };
  return { lock: cut, sha: ledger.putJson(cut) };
}

interface Lock {
  tests: { acId: string; file: string; name: string; testId: string }[];
  characterisation: { target: string; file: string; testId: string }[];
  lock: { file: string; sha: string }[];
  probes?: Probe[];
}

// .NET: the restored NuGet packages (mounted into the coding container); Node: the npm cache the installs share
const packagesDir = (runId: string, stack: ProjectConfig["stack"] = "dotnet") => {
  const d = join(factoryHome(), "tmp", runId, stack === "node" ? "npm-cache" : "nuget");
  mkdirSync(d, { recursive: true });
  return d;
};

async function produce(ctx: StepContext, key: string, commit: string, stage: TestRun["stage"], exp: Expectations, onlyTests?: string[], filterExpr?: string, accept?: { probes: Probe[] }, resolveExp?: (results: TestResult[]) => Expectations, schema?: { readSchema?: boolean; schemaOnly?: boolean }): Promise<ProduceOutput> {
  const rt = runtime();
  await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
  // full-suite runs (task, integrate) leave out tests that already fail on the base branch
  const fullSuite = (stage === "task" || stage === "integrate") && !onlyTests?.length && !filterExpr;
  const skipTests = fullSuite ? skippableKnownFailures(baselineResults(ctx), [...exp.expectPass, ...exp.expectFail.map((e) => e.id)]) : undefined;
  return labFor(ctx.project).produce({
    runId: ctx.runId, key, repo: ctx.state.info.repoPath!, commit, stage, exp, project: ctx.project, rt, onlyTests, filterExpr, accept, resolveExp, knownFailures: knownFailures(ctx),
    packagesDir: packagesDir(ctx.runId, ctx.project.stack),
    // later lab runs on a commit reuse its build; the baseline's commit is never built again
    buildCache: stage === "baseline" ? undefined : join(factoryHome(), "tmp", ctx.runId, "builds"),
    skipTests, ...schema,
    // an existing backend whose database was read before the run: every build's database is read too, model file or not
    ...(stage !== "baseline" && databaseBefore(ctx) ? { readSchema: true } : {}),
    onContainer: async (id, role) => { await ctx.ledger.append({ type: "container.started", key, data: { id, role } }, ctx.writer); },
    onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key, data: { id } }, ctx.writer); },
    onPhase: phaseTracer(ctx),
  });
}

/** This run's baseline results (empty before discover has finished). */
function baselineResults(ctx: StepContext): TestResult[] {
  const sha = ctx.state.steps.get("discover")?.outputs[0];
  return sha ? ctx.ledger.getJson<TestRun>(sha).results : [];
}

/** Tests that failed in this run's baseline (the repo's known failures). */
function knownFailures(ctx: StepContext): Set<string> {
  return new Set(baselineResults(ctx).filter((r) => r.outcome === "failed").map((r) => r.id));
}

/** Test-lab phases → trace; a failing phase's log tail is saved (masked) as a blob. */
function phaseTracer(ctx: StepContext) {
  return (phase: string, msg: string, data?: Record<string, unknown>) => {
    const tail = typeof data?.logTail === "string" ? ctx.trace.blob(data.logTail) : undefined;
    ctx.trace.event(`lab.${phase}`, msg + (tail ? `  (log: ${tail.slice(0, 8)})` : ""), tail ? { logSha: tail } : undefined);
  };
}

/** Coding-agent progress → trace. */
/** A tool result this large (characters, about 2,000 tokens) gets its own line in the run log; every result is counted in the session's summary. */
const BIG_RESULT_CHARS = 8000;

export function agentTracer(ctx: Pick<StepContext, "trace">, who: string) {
  // what the session's context was made of, for `factory report <run> --cost`
  const tools = new Map<string, { calls: number; chars: number }>();
  let peak = 0, compactions = 0;
  return (p: AgentProgress) => {
    if (p.kind === "tool") ctx.trace.event("agent.tool", `${who}: ${p.tool} ${p.target ?? ""}`);
    else if (p.kind === "turn") {
      peak = Math.max(peak, p.in ?? 0);
      ctx.trace.event("agent.turn", `${who}: turn  in ${p.in ?? 0} out ${p.out ?? 0}${p.text ? `  "${p.text}"` : ""}`, { id: p.id, in: p.in ?? 0, out: p.out ?? 0, cacheRead: p.cacheRead ?? 0, cacheWrite: p.cacheWrite ?? 0 });
    } else if (p.kind === "result") {
      const t = tools.get(p.tool ?? "?") ?? { calls: 0, chars: 0 };
      tools.set(p.tool ?? "?", { calls: t.calls + 1, chars: t.chars + (p.chars ?? 0) });
      if ((p.chars ?? 0) >= BIG_RESULT_CHARS) ctx.trace.event("agent.result", `${who}: large result, about ${Math.round((p.chars ?? 0) / 4000)}K tokens, from ${p.tool} ${p.target ?? ""}`, { tool: p.tool, target: p.target, chars: p.chars });
    } else if (p.kind === "compact") {
      compactions++;
      ctx.trace.event("agent.compact", `${who}: context summarised${p.pre ? ` at ${Math.round(p.pre / 1000)}K tokens` : ""}`, { pre: p.pre, trigger: p.trigger });
    } else if (p.kind === "start") ctx.trace.event("agent.start", `${who}: agent started (${p.model ?? "?"})`);
    else if (p.kind === "end") {
      ctx.trace.event("agent.end", `${who}: agent finished: ${p.status} after ${p.turns ?? "?"} turns, $${(p.costUsd ?? 0).toFixed(3)}`);
      if (peak || tools.size) ctx.trace.event("agent.summary", `${who}: context peaked at ${Math.round(peak / 1000)}K tokens${compactions ? `, summarised ${compactions}x` : ""}; tool results: ${[...tools].sort((x, y) => y[1].chars - x[1].chars).map(([n, t]) => `${n} ${t.calls}x ${Math.round(t.chars / 4000)}K`).join(", ") || "none"}`,
        { peak, compactions, tools: Object.fromEntries(tools) });
    }
  };
}

/** Package folders in a checkout's node_modules so far (a scope like @types counts its packages). */
function installedPackages(wt: string): number {
  const dir = join(wt, "node_modules");
  try {
    return readdirSync(dir).reduce((n, e) => n + (e.startsWith(".") ? 0 : e.startsWith("@") ? readdirSync(join(dir, e)).length : 1), 0);
  } catch { return 0; }
}

/** What a reset of the checkout leaves in place: a Node app's installed packages (a retry installed them again each time; the
 *  install key decides whether they are still current, and the lab never reads them: it installs from the commit). */
const keptOnReset = (project: Pick<ProjectConfig, "stack">) => (project.stack === "node" ? ["node_modules"] : []);

/**
 * The coding container reads restored packages from the run's package folder (read-only, no network).
 * If discover reused a cached baseline, nothing restored them yet for this run: do it now.
 */
async function ensurePackages(ctx: StepContext, commit: string, wt: string): Promise<void> {
  if (ctx.project.stack === "node") {
    // a Node checkout gets its node_modules installed in place, before the first agent, and again
    // whenever package.json or the lockfile changed since (PR #17 review, item 7); a reset keeps them (keptOnReset)
    if (!existsSync(join(wt, "package.json")) || installIsCurrent(wt)) return;
    ctx.log(`installing the app's packages for the coding container${existsSync(join(wt, "package-lock.json")) ? "" : " (the first install downloads every package: a few minutes)"}`);
    // npm prints nothing until it ends: say how far it is, so a long first install doesn't look stuck (4 min of silence on a real run)
    const began = Date.now();
    const tick = setInterval(() => ctx.log(`still installing: ${installedPackages(wt)} packages so far (${Math.round((Date.now() - began) / 1000)}s)`), 30_000);
    const r = await installNodeModules(runtime(), {
      runId: ctx.runId, key: "restore", dir: wt, cache: packagesDir(ctx.runId, "node"), image: ctx.project.node.image, timeoutSec: ctx.project.node.buildTimeoutSec,
      onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key: "restore", data: { id, role: "restore" } }, ctx.writer); },
      onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "restore", data: { id } }, ctx.writer); },
    }).finally(() => clearInterval(tick));
    if (!r.ok) throw new Error(`npm install failed: ${r.log.split("\n").filter(Boolean).slice(-5).join(" ")}`);
    markInstalled(wt);
    return;
  }
  const dir = packagesDir(ctx.runId);
  if (readdirSync(dir).length) return;
  ctx.log("restoring packages for the coding container");
  const out = await produceDotnetTests({
    runId: ctx.runId, key: "restore", repo: ctx.state.info.repoPath!, commit, stage: "task",
    exp: { expectPass: [], expectFail: [], compareToBaseline: [] }, project: ctx.project, rt: runtime(), packagesDir: dir, restoreOnly: true, onPhase: phaseTracer(ctx),
    onContainer: async (id, role) => { await ctx.ledger.append({ type: "container.started", key: "restore", data: { id, role } }, ctx.writer); },
    onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "restore", data: { id } }, ctx.writer); },
  });
  if (!out.build.ok) throw new Error(`Package restore failed: ${out.logs.restore.split("\n").slice(-5).join(" ")}`);
}

function storeRun(ctx: StepContext, out: ProduceOutput): { testRun: string; build: string; reports: string[] } {
  return {
    testRun: ctx.ledger.putJson(out.testRun),
    build: ctx.ledger.putJson(out.build),
    reports: out.reports.map((r) => ctx.ledger.putArtifact(r.content)),
  };
}

// ---------- discover (D) ----------
const REFUSE: { code: string; re: RegExp; reason: string }[] = [
  { code: "testcontainers", re: /Testcontainers/i, reason: "Tests start their own Docker containers (Testcontainers); not supported in the POC." },
  { code: "sqlserver", re: /UseSqlServer|Microsoft\.EntityFrameworkCore\.SqlServer|System\.Data\.SqlClient/, reason: "Uses SQL Server; the POC supports Postgres only." },
  { code: "windows-only", re: /<UseWPF>true|<UseWindowsForms>true|<TargetFramework>net4\d/i, reason: "Windows-only target (WPF, WinForms or .NET Framework)." },
];

/** Only a greenfield run on an empty repo skips the baseline; any other repo is built and tested as it is (never asked otherwise). */
export function usesEmptyBaseline(mode: string | undefined, repoEmpty: () => boolean): boolean {
  return mode === "greenfield" && repoEmpty();
}

export const discoverStep: StepDef = {
  key: "discover", stage: "discover", templateVersion: "1",
  inputs: (s) => ({ base: s.info.baseCommit }),
  async run(ctx) {
    const repo = ctx.state.info.repoPath!;
    const refusals = await repoRefusals(repo);
    const snap = snapshotFor(ctx);
    for (const f of snap.files.filter((f) => /\.(csproj|props|cs)$/.test(f))) {
      const text = readFileSync(join(snap.root, f), "utf8");
      for (const r of REFUSE) if (r.re.test(text) && !refusals.some((x) => x.code === r.code)) refusals.push({ code: r.code, reason: `${r.reason} (${f})` });
    }
    if (refusals.length) return { kind: "park", reason: `This repo can't be used yet: ${refusals.map((r) => r.reason).join(" ")}` };

    // baseline: cached per repo + commit
    const cacheFile = join(factoryHome(), "repos", ctx.project.project, `baseline-${ctx.state.info.baseCommit}.json`);
    let baseline: TestRun;
    // a backend's database as the untouched code creates it (tables, columns, keys), read once per commit beside the baseline:
    // the plan starts its data model from it, and the Data model page shows it before there is a plan
    const readsSchema = ctx.project.stack === "dotnet";
    const schemaFile = join(factoryHome(), "repos", ctx.project.project, `schema-${ctx.state.info.baseCommit}.json`);
    let existing = readsSchema ? readSchema(schemaFile) : undefined;
    const emptyRepo = usesEmptyBaseline(ctx.state.info.mode, () => repoIsEmpty(repo, ctx.state.info.baseCommit!));
    if (emptyRepo) {
      // an empty repo (a new product): nothing to build or test yet; the scaffold commit writes the app. Greenfield runs only:
      // anything else is built and tested as it is (PR #17 review, item 4)
      baseline = { kind: "test", treeSha: ctx.state.info.baseCommit!, stage: "baseline", runner: ctx.project.stack === "node" ? "vitest" : "vstest", toolVersions: {}, expectPass: [], expectFail: [], compareToBaseline: [], discovered: [], results: [], exitCode: 0, reportShas: [], valid: true, classification: "ok" };
      ctx.log("baseline: the repo is empty (a new product), nothing to build or test yet");
    } else if (existsSync(cacheFile)) {
      baseline = JSON.parse(readFileSync(cacheFile, "utf8")) as TestRun;
      ctx.log("baseline: reusing the recorded run for this commit");
    } else {
      ctx.log("baseline: building and testing the untouched repo (first time is slow)");
      const out = await produce(ctx, "discover", ctx.state.info.baseCommit!, "baseline", { expectPass: [], expectFail: [], compareToBaseline: [] }, undefined, undefined, undefined, undefined, { readSchema: readsSchema });
      if (!out.build.ok) return { kind: "park", reason: `The untouched repo doesn't build in the test lab: ${out.build.errors.slice(0, 3).map((e) => `${e.file ? `${e.file}:${e.line} ` : ""}${e.code === "RESTORE" ? "" : `${e.code} `}${e.msg}`).join("; ") || "see restore/build log"}` };
      baseline = out.testRun;
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(baseline));
      if (readsSchema && out.schema) { existing = out.schema; writeFileSync(schemaFile, JSON.stringify(existing)); }
    }
    // the baseline was on record from before the database was read with it: start the untouched app once more, with no tests.
    // Never stops discover: a database that cannot be read leaves the plan to work as it did without one.
    if (readsSchema && !existing && !emptyRepo) {
      try {
        ctx.log("database: starting the untouched app once to read the tables it creates");
        const out = await produce(ctx, "discover", ctx.state.info.baseCommit!, "baseline", { expectPass: [], expectFail: [], compareToBaseline: [] }, undefined, undefined, undefined, undefined, { readSchema: true, schemaOnly: true });
        if (out.schema) { existing = out.schema; mkdirSync(dirname(schemaFile), { recursive: true }); writeFileSync(schemaFile, JSON.stringify(existing)); }
      } catch (e) { ctx.log(`database: not read (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`); }
    }
    if (existing) ctx.log(existing.model ? `database: the untouched code creates ${existing.model.tables.length} table(s) (${existing.file}): ${existing.model.tables.map((t) => t.name).slice(0, 20).join(", ")}${existing.model.tables.length > 20 ? ", …" : ""}` : `database: no tables read from the untouched code (${existing.note})`);
    const failed = baseline.results.filter((r) => r.outcome === "failed").length;
    const sha = ctx.ledger.putJson(baseline);
    ctx.log(`baseline: ${baseline.results.length} tests, ${failed} failing before any change`);
    // A repo with a React or Next.js front end also gets its design inventory, as a second named output. The
    // snapshot excludes noGo paths, so a front end under one is left out. Best effort: it never stops discover.
    const outputs: Record<string, string> = { baseline: sha, ...(existing ? { schema: ctx.ledger.putJson(existing) } : {}) };
    const data: Record<string, unknown> = { tests: baseline.results.length, knownFailures: failed, status: failed ? "green-with-known-failures" : "green" };
    try {
      const src = dirSource(snap.root);
      if (hasReactApp(src.list(), (p) => src.read(p))) {
        const { navRaises: _n, ...inv } = designOptions(ctx.project.design);
        const inventory = buildInventory(src, inv);
        outputs.design = ctx.ledger.putJson(inventory);
        data.design = inventory.verdict;
        ctx.log(`design inventory: ${inventory.verdict}\n${inventorySummary(inventory)}`);
      }
    } catch (e) { ctx.log(`design inventory skipped: ${e instanceof Error ? e.message : String(e)}`); }
    return { kind: "done", outputs, data };
  },
};

// ---------- stub commit (D) ----------
/**
 * The approved design's package for the repo (docs/estimates-design.md, "The design package"): this run's own,
 * or the one of the estimate or design run it follows. Undefined without an approved design; a package that
 * cannot be written is logged and the build goes on without it.
 */
async function packageForBuild(ctx: StepContext): Promise<DesignPackage | undefined> {
  if (!approvedDesignFor(ctx.state, ctx.ledger)) return undefined;
  try {
    const r = await exportRunPackage(ctx.state, ctx.ledger, ctx.log);
    if ("none" in r) { ctx.log(`stub-commit: no design package (${r.none})`); return undefined; }
    return r;
  } catch (e) {
    ctx.log(`stub-commit: the design package was not added to the repo: ${(e as Error).message}`);
    return undefined;
  }
}

/**
 * The kit's package pins, as an input of the stub commit of a new product with a design: its package.json is written from them,
 * so a run whose scaffold was made before a pin makes it again (a run with no pins to take keeps its hash).
 */
function kitPins(s: RunState): { kitPins?: Record<string, string> } {
  if (s.info.mode !== "greenfield" || !outputOf(s, "design-export")) return {};
  const pins = loadKit().manifest.overrides;
  return Object.keys(pins).length ? { kitPins: pins } : {};
}

export const stubCommitStep: StepDef = {
  key: "stub-commit", stage: "stub-commit", templateVersion: "1",
  // (the design package is an input only when this run wrote one, so runs from before packages keep their hash)
  inputs: (s) => (s.steps.get("approve")?.status === "completed" ? { plan: s.steps.get("plan")!.outputs[0], approval: s.steps.get("approve")!.outputs[0], ...(outputOf(s, "design-export") ? { design: outputOf(s, "design-export") } : {}), ...kitPins(s) } : undefined),
  coding: true,
  async run(ctx) {
    const plan = requireOutput<Plan>(ctx.state, ctx.ledger, "plan");
    const wt = await ensureWorktree(ctx, ctx.state.info.baseCommit!);
    await resetHard(wt, ctx.state.info.baseCommit!);
    // the approved design package: read from the factory's store; committed first, as its own commit, only when the project asks
    const pkg = await packageForBuild(ctx);
    const commitPackage = !!ctx.project.design?.commitPackage;
    let designCommit: string | undefined;
    if (pkg && commitPackage) {
      for (const f of repoFiles(pkg)) {
        mkdirSync(dirname(join(wt, f.path)), { recursive: true });
        copyFileSync(f.from, join(wt, f.path));
      }
      const m = pkg.manifest;
      designCommit = await commitAll(wt, `factory: design ${m.line} v${m.version} (approved by ${m.approved.by}) for ${ctx.runId}`);
    }
    // then the approved design as code in the UI target's kit, as its own commit (docs/estimates-design.md, "Kit and scaffold")
    const scaf = pkg ? scaffoldOfRun(ctx, pkg) : undefined;
    let scaffoldRec: ScaffoldRecord | undefined;
    if (scaf?.layout) {
      const l = scaf.layout;
      const written = writeScaffold(l, wt);
      let scaffoldCommit = written.length ? await commitAll(wt, `factory: scaffold ${l.target} (kit ${l.kit.id} ${l.kit.version}) for ${ctx.runId}`) : undefined;
      // a generated Node app has no lockfile until its first install writes one: install now and commit it as part of the
      // scaffold, so every later install is the same, and the file is neither charged to the test writer nor counted as the
      // agents' change (a real-container greenfield run parked on each)
      const firstInstall = !!scaffoldCommit && ctx.project.stack === "node" && existsSync(join(wt, "package.json")) && !existsSync(join(wt, "package-lock.json"));
      // a web app held to an API contract (the project's `contract`): the contract goes in now, and the generator joins the app's
      // dev packages before the first install, so the lockfile covers it
      // ponytail: a fresh app only; an app that already has a lockfile needs its lockfile updated first (not built)
      const c = ctx.project.contract;
      const planned = c ? plan.stubs.find((st) => st.path === c.file) : undefined;
      const client = !!c && firstInstall && (!!planned || existsSync(join(wt, c.file)));
      if (c && client) {
        if (planned) { mkdirSync(dirname(join(wt, c.file)), { recursive: true }); writeFileSync(join(wt, c.file), planned.content); }
        prepareClient(wt, c.file, c.apiUrl);
        scaffoldCommit = await commitAll(wt, `factory: API contract ${c.file} and its client settings for ${ctx.runId}`);
      }
      if (firstInstall) {
        await ensurePackages(ctx, scaffoldCommit!, wt);
        if (existsSync(join(wt, "package-lock.json"))) scaffoldCommit = await commitAll(wt, `factory: lockfile from the scaffold's first install for ${ctx.runId}`);
      }
      // the client and its test handlers, generated from the contract with no network: factory-owned code, locked with the contract
      if (c && client) {
        ctx.log(`stub-commit: generating the API client and test handlers from ${c.file}`);
        const g = await runNodeOffline(runtime(), {
          runId: ctx.runId, key: "client", dir: wt, image: ctx.project.node.image, timeoutSec: ctx.project.node.buildTimeoutSec, cmd: CLIENT_CMD,
          onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key: "client", data: { id, role: "producer" } }, ctx.writer); },
          onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "client", data: { id } }, ctx.writer); },
        });
        if (!g.ok || !existsSync(join(wt, CLIENT_DIR, "client.ts"))) return { kind: "park", reason: `The API client could not be generated from ${c.file}: ${g.log.split("\n").filter(Boolean).slice(-4).join(" ")}` };
        scaffoldCommit = await commitAll(wt, `factory: API client and test handlers generated from ${c.file} for ${ctx.runId}`);
      }
      scaffoldRec = { target: scaf.target, source: scaf.source, why: scaf.detected.why, kit: l.kit, root: l.root, fresh: l.fresh, written, kept: l.kept, protected: l.protected, screens: l.screens, removed: l.removed, designSystem: l.designSystem, notes: l.notes, summary: scaffoldSummary(l), ...(scaf.changed ? { changed: scaf.changed } : {}), ...(scaffoldCommit ? { commit: scaffoldCommit } : {}) };
      ctx.log(`stub-commit: scaffold ${l.target}: ${written.length} files written${l.kept.length ? `, ${l.kept.length} kept (the repo's own)` : ""}`);
    } else if (scaf) ctx.log(`stub-commit: UI target ${scaf.target} (${scaf.source}; ${scaf.detected.why}): no scaffold, the screens are built with the repo's own components`);
    for (const s of plan.stubs) {
      mkdirSync(dirname(join(wt, s.path)), { recursive: true });
      writeFileSync(join(wt, s.path), s.content);
    }
    // the approved data model goes in beside the contract: the factory's file, locked with the tests
    if (plan.dataModel) {
      mkdirSync(dirname(join(wt, DATA_MODEL_FILE)), { recursive: true });
      writeFileSync(join(wt, DATA_MODEL_FILE), dataModelYaml(plan.dataModel));
    }
    const commit = plan.stubs.length || plan.dataModel ? await commitAll(wt, `factory: interface stubs for ${ctx.runId}`) : await headSha(wt);
    const design = pkg ? { line: pkg.manifest.line, version: pkg.manifest.version, designSha: pkg.manifest.designSha, ...(commitPackage ? { dir: `${REPO_DESIGN_DIR}/${pkg.manifest.line}/v${pkg.manifest.version}` } : {}) } : undefined;
    const scaffoldSha = scaffoldRec ? ctx.ledger.putJson(scaffoldRec) : undefined;
    return {
      kind: "done", outputs: { stubs: ctx.ledger.putJson({ commit, files: plan.stubs.map((s) => s.path), ...(design ? { design, designCommit } : {}) }), ...(scaffoldSha ? { scaffold: scaffoldSha } : {}) }, treeSha: commit,
      data: { commit, ...(design ? { designCommit, design } : {}), ...(scaffoldRec ? { scaffold: { target: scaffoldRec.target, kit: `${scaffoldRec.kit.id} ${scaffoldRec.kit.version}`, files: scaffoldRec.written.length, screens: scaffoldRec.screens.length, ...(scaffoldRec.commit ? { commit: scaffoldRec.commit } : {}) } } : scaf ? { uiTarget: scaf.target } : {}) },
    };
  },
};

// ---------- author-tests (A) + fails on base twice + lock ----------
const AuthorOut = z.object({
  tests: z.array(z.object({ acId: z.string(), file: z.string(), name: z.string().regex(/^AC_\d+_\d+_\w+$/, "method name must be AC_<req>_<n>_<Words>") })).min(1),
  characterisation: z.array(z.object({ target: z.string(), file: z.string(), name: z.string().regex(/^CHAR_\w+$/, "method name must be CHAR_<Words>") })),
  /** one HTTP request per api-level criterion, replayed against the running app at accept */
  probes: z.array(z.object({
    acId: z.string(), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string().startsWith("/"),
    body: z.string().optional(), expectStatus: z.number().int().min(100).max(599),
  })).default([]),
  notes: z.string(),
});

/**
 * The test author gives method names (test titles in a Node app); the factory finds the real test IDs from a run
 * (project::Namespace.Class.Method(args), or file::describe > title), so nobody has to guess the ID format.
 * A theory can have several rows: all of them count.
 */
export function resolveTestIds(names: string[], resultIds: string[]): { ids: Record<string, string[]>; missing: string[] } {
  const ids: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const n of names) {
    // .NET: project::Ns.Class.Method(args); Node: file::describe > title
    const hits = resultIds.filter((id) => { const bare = id.replace(/\(.*$/, ""); return bare.endsWith(`.${n}`) || bare.endsWith(` > ${n}`) || bare.endsWith(`::${n}`); });
    if (hits.length) ids[n] = hits;
    else missing.push(n);
  }
  return { ids, missing };
}

// test folders only: FooTests, Foo.Tests, Foo.Tests.Unit, foo-test, tests, __tests__, not Latest/ or Contest/
// (case-sensitive; no {a,b}: the in-container matcher lacks it)
export const TEST_SCOPE = ["tests/**", "test/**", "**/__tests__/**",
  ...["Test", "Tests", "TEST", "TESTS"].flatMap((n) => [`**/*${n}/**`, `**/*${n}.*/**`]),
  ...["", "*.", "*-", "*_"].flatMap((p) => ["test", "tests"].flatMap((n) => [`**/${p}${n}/**`, ...(p ? [`**/${p}${n}.*/**`] : [])]))];

const SKIP_MARKER = ESCAPE_HATCHES.find((h) => h.id === "skip-test")!.re;
// added lines that take tests out of the build or the run without touching a test method
const UNTEST_MARKER = /<Compile\s+Remove=|<IsTestProject>\s*false|<IsTestingPlatformApplication>\s*false/i;

/**
 * The test writer may only add: new files, or new lines in existing ones. A deleted file, a removed or
 * rewritten line, or an added skip marker could drop part of the existing suite, and that would get locked.
 */
/** Added and removed lines of a -U0 patch (hunk bodies only). A removed line re-added unchanged (appending to a
 * file with no final newline) isn't a removal. */
export function patchLines(patch: string): { added: string[]; removed: string[] } {
  const added: string[] = [], removed: string[] = [];
  // the old file's last line when it had no final newline: git marks it "\ No newline at end of file"
  let lastNoNewline: string | undefined;
  let inHunk = false, prev: "+" | "-" | undefined;
  for (const l of patch.split("\n")) {
    if (l.startsWith("@@")) { inHunk = true; prev = undefined; }
    else if (l.startsWith("diff --git")) inHunk = false;
    else if (inHunk && l.startsWith("+")) { added.push(l.slice(1)); prev = "+"; }
    else if (inHunk && l.startsWith("-")) { removed.push(l.slice(1)); prev = "-"; }
    else if (inHunk && l.startsWith("\\") && prev === "-") lastNoNewline = removed[removed.length - 1];
  }
  // only that one line, re-added unchanged, isn't a removal (appending to a file with no final newline);
  // any other removed line counts even if its text appears among the additions ("[Fact]", "}")
  const i = lastNoNewline === undefined ? -1 : removed.lastIndexOf(lastNoNewline);
  if (i >= 0 && added.includes(lastNoNewline!)) removed.splice(i, 1);
  return { added, removed };
}

export function testWriterTampering(files: { status: string; path: string; added: string[]; removed: string[] }[]): Failure[] {
  const fs: Failure[] = [];
  for (const f of files) {
    if (f.status === "D") fs.push(failure("author-tests-deleted", `Test author deleted an existing file: ${f.path}`, { location: f.path }));
    else if (f.removed.length) fs.push(failure("author-tests-removed", `Test author removed or changed ${f.removed.length} existing line(s) in ${f.path}`, { location: f.path }));
    const skip = f.added.find((l) => SKIP_MARKER.test(l) || UNTEST_MARKER.test(l));
    if (skip) fs.push(failure("author-tests-skip", `Test author added a skip marker in ${f.path}: ${skip.trim().slice(0, 120)}`, { location: f.path }));
  }
  return fs;
}

/**
 * Failures a retry can put right in the tests the last attempt wrote: a criterion with no test, a compile error, a test the
 * lab did not find or that fails for the wrong reason, or an agent that ran out of budget or turns. The files stay and the retry
 * is told what is missing. (A real run wrote 14 test files for $2.84, missed two criteria, and wrote all of them again.)
 */
const TESTS_KEEPABLE = new Set(["ac-coverage", "tests-compile", "test-not-found", "agent-over-budget", "agent-timeout", "not-executed", "keep-passing", "passes-on-base", "wrong-failure-kind", "characterisation", "test-proof"]);

/** Keep the previous attempt's tests for this retry, or start from the stub commit. Any rung: the tests are edited, not trusted. */
export function testRetryMode(prev: PrevAttempt | undefined): { mode: "keep" | "reset"; reason: string } {
  if (!prev) return { mode: "reset", reason: "no previous attempt" };
  if (prev.noCredit) return { mode: "keep", reason: "the previous attempt stopped when the model account ran out of credit" };
  if (prev.interrupted) return { mode: "reset", reason: "the previous attempt didn't finish" };
  if (!prev.checks.length) return { mode: "reset", reason: "no failures to fix" };
  const bad = [...new Set(prev.checks.filter((c) => !TESTS_KEEPABLE.has(c)))];
  if (bad.length) return { mode: "reset", reason: `the previous attempt failed on ${bad.join(", ")}` };
  return { mode: "keep", reason: `the previous attempt failed only on ${[...new Set(prev.checks)].join(", ")}` };
}

/**
 * The previous attempt was rejected only for how its test failures were labelled ("fails with exception"). The labels come from
 * the factory's reading of the raw test reports, so those reports are read again by today's rules: true when every test the
 * rejection named now fails for an accepted reason. The tests were never wrong then, and the test writer has nothing to fix.
 * False whenever that cannot be shown (another kind of failure, a capped list, a report that is gone, a stack other than .NET).
 */
export function labelRejectionLifted(ledger: Pick<Ledger, "events" | "getJson" | "getArtifact" | "hasArtifact">, commit: string | undefined, failures: Failure[]): boolean {
  if (!commit || !failures.length || failures.length >= 20 || failures.some((f) => f.check !== "wrong-failure-kind" || !f.testId)) return false;
  const gate = ledger.events().filter((e) => e.type === "gate.result" && e.treeSha === commit && (e.data as { gateId?: string } | undefined)?.gateId === "author-tests.fails-on-base").at(-1);
  const inputs = (gate?.data as { inputs?: { run1?: string; run2?: string } } | undefined)?.inputs;
  if (!inputs?.run1 || !inputs.run2) return false;
  const name = (id: string) => id.split("::").pop()!;
  for (const sha of [inputs.run1, inputs.run2]) {
    if (!ledger.hasArtifact(sha)) return false;
    const run = ledger.getJson<TestRun>(sha);
    if (run.runner !== "vstest" || !run.reportShas.length) return false;
    const kinds = new Map<string, string | undefined>();
    for (const r of run.reportShas) {
      if (!ledger.hasArtifact(r)) return false;
      try { for (const t of parseTrx(ledger.getArtifact(r).toString("utf8")).results) kinds.set(name(t.id), t.outcome === "failed" ? t.failureKind : t.outcome); } catch { return false; }
    }
    if (failures.some((f) => !["assertion", "not-implemented"].includes(kinds.get(name(f.testId!)) ?? ""))) return false;
  }
  return true;
}

/**
 * The session's limits, told to the agent: it cannot see them, and one that does not know them explores until it is cut off
 * with the work unfinished (run 31fe, attempt 7: stopped at $5 one failing test short). Whole dollars, so the text is steady.
 */
export function limitsNote(l: { maxTurns: number; maxUsd: number; timeoutSec: number }, advice: string): string {
  return `\nThis session is cut off after ${l.maxTurns} turns, ${Math.round(l.timeoutSec / 60)} minutes or about $${Math.max(1, Math.floor(l.maxUsd))} of model use, whichever comes first, and you are not warned. Long tool output, whole-file rewrites and reading a file again all use it up. ${advice}`;
}

/** The agent stopped before it answered (budget, turns or a full context window): what it wrote is still worth finishing. */
const UNFINISHED = new Set(["over-budget", "timeout"]);

/**
 * A failure's check, with a budget stop that was stored as a plain agent error read as what it was: the SDK throws
 * "Reached maximum budget" after the result, and that used to replace the result's own status.
 */
export function checkOf(f: { check: string; message?: string }): string {
  return f.check === "agent-error" && /Reached maximum budget/i.test(f.message ?? "") ? "agent-over-budget" : f.check;
}

/** Uncommitted paths in the checkout (untracked files one by one). */
const GAP_CAP = 60;
/** The contract differences as the coding agent reads them. */
export function gapNote(gap: string[]): string {
  return `Where the API's own document (written by the last build, before your change) differs from the locked contract, ${gap.length} in all${gap.length > GAP_CAP ? `, the first ${GAP_CAP} shown` : ""}. It includes operation ids, parameters, enum values and nullable fields. Work this list down; operations another task builds may stay missing:\n${gap.slice(0, GAP_CAP).map((d) => `- ${d}`).join("\n")}`;
}

/** The detailed contract differences of the newest of `commits` the lab has built, for a .NET API held to a contract. */
function contractGapAt(ctx: StepContext, wt: string, commits: (string | undefined)[]): string[] | undefined {
  for (const c of commits) {
    const file = c ? builtContractFile(ctx, wt, c) : undefined;
    if (file && existsSync(file)) return contractGap(readFileSync(join(wt, ctx.project.contract!.file), "utf8"), readFileSync(file, "utf8"));
  }
  return undefined;
}

/** Scope files that sit in the built API document's folder under a name that differs only in case (one folder on a Mac). */
export function sharesFolder(scope: string[], built: string | undefined): string[] {
  if (!built) return [];
  const dir = built.slice(0, built.lastIndexOf("/") + 1);
  return scope.filter((f) => f.toLowerCase().startsWith(dir.toLowerCase()) && !f.startsWith(dir));
}

async function dirtyPaths(wt: string): Promise<string[]> {
  return (await git(wt, ["status", "--porcelain", "-uall"])).stdout.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ""));
}

export const authorTestsStep: StepDef = {
  key: "author-tests", stage: "author-tests", templateVersion: "3", coding: true, needsUsd: AGENT_START_USD,
  inputs: (s) => (s.steps.get("stub-commit")?.status === "completed" ? { stubs: s.steps.get("stub-commit")!.outputs[0], spec: s.steps.get("specify")!.outputs[0] } : undefined),
  async run(ctx) {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const plan = requireOutput<Plan>(ctx.state, ctx.ledger, "plan");
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const light = lightBuild(intent, plan.complexity);
    const start = String(ctx.state.steps.get("stub-commit")!.data!.commit);
    const wt = await ensureWorktree(ctx, start);
    // the tests a card of this step is holding, once a person accepted them: locked as they are, not written and paid for again
    const held = await heldTests(ctx, wt);
    if (held) return held;
    // keep the previous attempt's tests when a retry can fix them, or start again from the stub commit
    const prev = previousAttempt(ctx.ledger.events(), "author-tests", ctx.priorFailures.map(checkOf));
    let mode = testRetryMode(prev);
    let keptFiles: string[] = [];
    if (mode.mode === "keep") {
      const saved = prev!.commit;
      if (saved && await isAncestor(wt, start, saved)) {
        // the saved commit's files, with HEAD back at the stub commit so the tests still end as one commit
        await resetHard(wt, saved, keptOnReset(ctx.project));
        await git(wt, ["reset", "--mixed", "-q", start]);
      } else if (saved || (await headSha(wt)) !== start) mode = { mode: "reset", reason: "the previous attempt's tests are not in the worktree" };
      // (no saved commit: an attempt from before commits were saved left its files in the worktree; they are kept as they are)
      if (mode.mode === "keep") {
        keptFiles = await dirtyPaths(wt);
        if (!keptFiles.length) mode = { mode: "reset", reason: "the previous attempt left no files" };
        else if (keptFiles.some((f) => !matchesAny(f, TEST_SCOPE))) mode = { mode: "reset", reason: "the previous attempt left files outside the tests" };
      }
    }
    if (mode.mode === "reset") { keptFiles = []; await resetHard(wt, start, keptOnReset(ctx.project)); }
    else ctx.log(`author-tests: keeping the previous attempt's ${keptFiles.length} test file${keptFiles.length === 1 ? "" : "s"} (${mode.reason})`);
    const prevOut = mode.mode === "keep" && prev?.out ? AuthorOut.safeParse(ctx.ledger.getJson(prev.out)).data : undefined;
    const retry = { retryMode: mode.mode, retryReason: mode.reason };
    const routed = modelFor(ctx.project, "author-tests", ctx.rung, undefined, ctx.priorFailures);
    // light lane: Sonnet writes the few small tests; Opus stays for bigger work, on escalation, or when the run or the project routes it
    const model = (light ? lightLaneModel(ctx.project, "author-tests", ctx.rung) : undefined) ?? routed.model;
    const { effort } = routed;
    // what earlier runs on this repo learned about where tests go (only if those files still exist here)
    const lessons = usableLessons(readLessons(ctx.project.project), wt);
    if (lessons.length) ctx.log(`author-tests: pointing the test writer at ${lessons.map((l) => l.dir).join(", ")} (from earlier runs)`);
    // "already passes" is no longer a failure when the requirement has a failing test: don't push the writer to break a correct test
    const priorFailures = ctx.priorFailures.filter((f) => f.check !== "passes-on-base");
        // The test author sees ACs, stub signatures and harness rules. Never the plan's approach.
    const acs = spec.requirements.flatMap((r) => r.acceptance.map((a) => ({ req: r.id, ...a })));
    const needTest = acs.filter((a) => a.level !== "manual");
    // the approved screens behind these criteria: what the person approved is what the tests expect (PR #11 review, item 13)
    const screens = screenFacts(approvedDesignFor<ApprovedDesign>(ctx.state, ctx.ledger)?.design, [...new Set(acs.map((a) => a.req))]);
    // the contract is in the repo already (stub-commit wrote it, with the client and handlers made from it): point at it, don't
    // paste it; a full OpenAPI document took the pack over its budget on a real run
    const contractFile = ctx.project.contract && existsSync(join(wt, ctx.project.contract.file)) ? ctx.project.contract.file : undefined;
    const pointers = [...anchorFiles(spec).map((p) => ({ path: p, reason: "the code these criteria are about" })), ...lessonPointers(lessons),
      ...(contractFile && plan.stubs.some((s) => s.path === contractFile) ? [{ path: contractFile, reason: `the locked API contract; the client and test handlers in ${CLIENT_DIR} are generated from it` }] : [])];
    const limits = { maxTurns: testWriterTurns(light, needTest.map((a) => a.level)), maxUsd: stepBudgetUsd(replay(ctx.ledger.events()), 4), timeoutSec: 45 * 60 };
    const pack = buildPack({
      stage: "author-tests", cls: "agent", model, recipeVersion: "1", tools: [], redactor: new Redactor(),
      sections: [
        S.template("tpl", authorIntro(ctx.project.stack, screenTestsReady(wt))),
        ...(light ? [S.template("light", `This is a small, low-risk change. Keep the tests small:
- Write the fewest tests that prove each criterion: usually one test method per criterion, in one new test file next to the existing tests for the class.
- At most ${LANE.light.maxCharacterisation} characterisation tests, as small unit tests of the same class. They must pass on today's code without any external service or seeded data. Skip them if the criteria already cover the unchanged behaviour.
- Compile at most once, at the end.`)] : []),
        S.template("tpl-end", apiElsewhere(ctx.project) ? `
- Give no HTTP probes: the endpoints are served by the API, not by this app. Return an empty list of probes.
Return the list of tests you wrote (acId, file, method name).` : `
- For each "api" criterion whose endpoint needs NO login, also give one HTTP probe: method, path, optional JSON body, and the status code the criterion expects once implemented. The factory sends it to the running app (with an empty test database) as evidence. Skip criteria that need a login or seeded data.
Return the list of tests you wrote (acId, file, method name) and the probes.`),
        ...(pointers.length ? [S.pointers(pointers)] : []),
        S.artifact("acs", "acceptance-criteria", acs),
        ...(screens.length ? [S.artifact("approved-screens", "approved-screens", screens), S.template("approved-screens-rules", `The approved-screens section lists the screens a person approved for these requirements: route, states, and the exact words on them (title, buttons, field labels, column headers, empty, error, success and validation messages, toasts; "change" for a design note). Where a criterion is about what the user sees or is told, take the expected values from there, word for word, and do not invent other wording. A criterion with no screen there is tested as before.`)] : []),
        // the stubs are in the checkout (the stub commit): a big one is named, not pasted, and so are the biggest when the briefing is over
        S.files("stubs", "stubs", plan.stubs.filter((s) => s.path !== contractFile).map((s) => ({ path: s.path, content: s.content }))),
        ...contractNote(ctx.project, wt, "tests"),
        ...dataModelNote(ctx.project, wt, "tests", !!databaseBefore(ctx)),
        ...(keptFiles.length ? [S.artifact("previous-tests", "previous-tests", { files: keptFiles, ...(prevOut ? { tests: prevOut.tests, characterisation: prevOut.characterisation, probes: prevOut.probes } : {}) })] : []),
        ...(priorFailures.length ? [{ spec: { id: "failures", source: "feedback" as const, trust: "derived" as const, placement: "user" as const }, content: "Your previous attempt was rejected:\n" + priorFailures.slice(0, 20).map((f) => `- [${f.check}] ${f.message}`).join("\n") }] : []),
        S.task(`Write the acceptance and characterisation tests now.${keptFiles.length
          ? ` The previous attempt failed for the reasons above. Its test files are still in the checkout (previous-tests lists them${prevOut ? " and the tests it returned" : ""}): keep them, change only what the failures name, and write the tests that are missing.${prevOut ? "" : " It stopped before it finished, so read those files first and finish them."} Return the full list: the tests you kept and the new ones.`
          : priorFailures.length ? " The previous attempt failed for the reasons above; fix them." : ""}
Before you return, check your list against the criteria: each of these needs at least one test in it: ${needTest.map((a) => a.id).join(", ")}.${limitsNote(limits, "Write every test first, then check them.")}`),
        S.recap(["one test per AC", "tests fail now for the right reason", "characterisation tests pass today", "don't touch production code"]),
      ],
    });
    // the briefing is built first: one that doesn't fit stops the step before any container starts
    tracePack(ctx.trace, "test writer", pack);
    const rt = runtime();
    await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
    await ensureAgentImage(rt, ctx.project.dotnet.sdkImage);
    await ensurePackages(ctx, start, wt);
    // rejected only for a label the factory itself gave, and the stored reports no longer say so: the tests go to the lab as they are
    const recheck = mode.mode === "keep" && !!prevOut && labelRejectionLifted(ctx.ledger, prev!.commit, ctx.priorFailures);
    let out: z.infer<typeof AuthorOut>;
    if (recheck) {
      ctx.log(`author-tests: the previous attempt's ${ctx.priorFailures.length} rejected test${ctx.priorFailures.length === 1 ? "" : "s"} fail for an accepted reason when its reports are read again; checking its tests again without the test writer`);
      out = prevOut!;
    } else {
      const r = await codingRunner(rt, {
        runId: ctx.runId, key: `author-tests/${ctx.attempt}`, fileScope: TEST_SCOPE, lockedFiles: [], extraProtected: contractLockFiles(ctx.project, wt), onProgress: agentTracer(ctx, "test writer"),
        protectedGlobs: CONFIG_INTEGRITY_GLOBS, ...(ctx.project.stack === "node" ? {} : { packagesDir: packagesDir(ctx.runId) }), agentEnv: ctx.project.agentEnv, noGo: ctx.project.noGo,
        onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key: "author-tests", data: { id, role: "agent" } }, ctx.writer); },
        onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "author-tests", data: { id } }, ctx.writer); },
      }, model).run({ step: "author-tests", model, effort, pack, schema: AuthorOut, limits, workdir: wt });
      await ctx.usage({ model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite, turns: r.usage.turns, wallMs: r.usage.wallMs, estUsd: r.usage.estUsd });
      if (r.status === "config-error" && r.error === NO_CREDIT_TEXT) {
        // the tests so far are paid for: committed, and the next attempt carries on from them (run b497 lost $1.91 of tests this way)
        const left = await dirtyPaths(wt);
        const unfinished = left.length && left.every((f) => matchesAny(f, TEST_SCOPE)) ? await commitAll(wt, `factory: unfinished acceptance tests for ${ctx.runId}`) : undefined;
        return { kind: "park", reason: r.error, data: { noCredit: true, rung: ctx.rung, ...(unfinished ? { commit: unfinished } : {}) } };
      }
      if (r.status === "config-error") return { kind: "park", reason: r.error ?? "The API rejected the coding agent's request" };
      if (r.status !== "ok") {
        // out of budget or turns: what it wrote is paid for, so it is saved for the retry to finish (test files only)
        const left = UNFINISHED.has(r.status) ? await dirtyPaths(wt) : [];
        const unfinished = left.length && left.every((f) => matchesAny(f, TEST_SCOPE)) ? await commitAll(wt, `factory: unfinished acceptance tests for ${ctx.runId}`) : undefined;
        return { kind: "fail", category: r.status === "rate-limited" ? "rate-limit" : "other", failures: [failure(`agent-${r.status}`, r.error ?? r.status)], signature: `author-tests:${r.status}`, data: { ...retry, ...(unfinished ? { commit: unfinished, ...(prev?.out && mode.mode === "keep" ? { out: prev.out } : {}) } : {}) } };
      }
      out = r.output as z.infer<typeof AuthorOut>;
    }

    const commit = await commitAll(wt, `factory: acceptance tests for ${ctx.runId}`);
    // what a retry needs to carry on from here: the commit and the tests the writer listed
    const keep = { ...retry, ...(recheck ? { recheck: true } : {}), commit, out: ctx.ledger.putJson(out) };
    const changed = await changedFiles(wt, start, commit);
    const notTests = changed.filter((c) => !matchesAny(c.path, TEST_SCOPE));
    if (notTests.length) return { kind: "fail", category: "safety", failures: notTests.map((c) => failure("author-tests-scope", `Test author changed a non-test file: ${c.path}`)), signature: "author-tests:scope" };
    const tampered = testWriterTampering(await Promise.all(changed.map(async (c) => {
      const patch = c.status === "D" ? "" : (await git(wt, ["diff", "--no-color", "-U0", start, commit, "--", c.path])).stdout;
      return { ...c, ...patchLines(patch) };
    })));
    if (tampered.length) return { kind: "fail", category: "safety", failures: tampered, signature: "author-tests:tamper" };
    const missingAc = needTest.filter((a) => !out.tests.some((t) => t.acId === a.id));
    if (missingAc.length) return { kind: "fail", category: "other", failures: missingAc.map((a) => failure("ac-coverage", `No test for ${a.id}`)), signature: "author-tests:coverage", data: keep };

    // One lab run finds the real test IDs by method name AND is the first run on the old code: the IDs
    // (and so the expectations) are only known from its results, so they're decided from them.
    const names = [...out.tests.map((t) => t.name), ...out.characterisation.map((c) => c.name)];
    const none: Expectations = { expectPass: [], expectFail: [], compareToBaseline: [] };
    let missing = names;
    let tests: (z.infer<typeof AuthorOut>["tests"][number] & { testId: string; failsOnBase: boolean })[] = [];
    let characterisation: (z.infer<typeof AuthorOut>["characterisation"][number] & { testId: string; passesOnBase: true })[] = [];
    let exp = none;
    const fromResults = (results: TestResult[]): Expectations => {
      const r = resolveTestIds(names, results.map((x) => x.id));
      missing = r.missing;
      if (missing.length) return none;
      // A criterion can describe behaviour that must keep working ("an upper-case grade stays upper case"):
      // its test passes on the old code by design. Lock it as must-keep-passing, as long as its requirement
      // still has a test that fails on the old code, which proves the change is needed.
      const passedOnBase = new Set(results.filter((x) => x.outcome === "passed").map((x) => x.id));
      tests = keepPassingTests(out.tests.flatMap((t) => r.ids[t.name]!.map((testId) => ({ ...t, testId, failsOnBase: true }))), passedOnBase);
      characterisation = out.characterisation.flatMap((c) => r.ids[c.name]!.map((testId) => ({ ...c, testId, passesOnBase: true as const })));
      exp = {
        expectPass: [...characterisation.map((c) => c.testId), ...tests.filter((t) => !t.failsOnBase).map((t) => t.testId)],
        expectFail: tests.filter((t) => t.failsOnBase).map((t) => ({ id: t.testId, kinds: ["assertion", "not-implemented", "exception"] })),
        compareToBaseline: [],
      };
      return exp;
    };
    ctx.log("author-tests: finding the new tests and running them on the old code (1 of 2)");
    const found = await produce(ctx, "author-tests/base-1", commit, "author-tests-on-base", none, undefined,
      labFor(ctx.project).nameFilter(names), undefined, fromResults);
    keepSchemaBefore(ctx, commit);
    if (!found.build.ok || missing.length) {
      const why = !found.build.ok
        ? found.build.errors.slice(0, 10).map((e) => failure("tests-compile", `${e.file}:${e.line} ${e.code} ${e.msg}`))
        : missing.map((n) => failure("test-not-found", `No test method named ${n} ran. ${notFoundHint(ctx.project.stack)}`));
      return { kind: "fail", category: "other", failures: why, signature: `author-tests:${!found.build.ok ? "compile" : "not-found"}`, data: keep };
    }
    const run1 = storeRun(ctx, found);
    const only = [...tests.map((t) => t.testId), ...characterisation.map((c) => c.testId)];
    ctx.log("author-tests: running the new tests on the old code again (2 of 2)");
    const run2 = storeRun(ctx, await produce(ctx, "author-tests/base-2", commit, "author-tests-on-base", exp, only));
    const acIds = new Set(acs.filter((a) => a.level === "api").map((a) => a.id));
    const lock: Lock = {
      tests, characterisation, probes: apiElsewhere(ctx.project) ? [] : out.probes.filter((p) => acIds.has(p.acId)),
      // the API contract and the client generated from it are locked with the tests: nobody changes them after this
      lock: [...changed.filter((c) => c.status !== "D").map((c) => c.path), ...contractLockFiles(ctx.project, wt)].map((file) => ({ file, sha: sha256(readFileSync(join(wt, file))) })),
    };
    // design allows one family until a second vendor's coding runner exists; say so in the evidence
    const implementer = modelFor(ctx.project, "implement", 0).model;
    const families = { testAuthor: family(model), implementer: family(implementer) };
    const familyNote = families.testAuthor === families.implementer
      ? `Single model family: tests written by ${model}, code by ${implementer} (both ${families.testAuthor}). A second-vendor coding runner isn't built yet.`
      : undefined;
    // rules: which fails-on-base rules this lock was written under (verify-evidence re-checks old locks the old way)
    const lockSha = ctx.ledger.putJson({ ...lock, unlocks: [], families, familyNote, rules: { productionExceptionOk: true }, header: header(ctx.runId, "acceptance-tests", "author-tests", "", model) });
    const g = await runGate(failsOnBase, ctx.ledger, ctx.writer, { run1: run1.testRun, run2: run2.testRun, tests: lockSha }, ctx.policy, { step: "author-tests", treeSha: commit });
    if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [], signature: failureSignature((g.failures ?? []).map((f) => f.message)), data: keep };
    // each test is read against its criterion now, while the writer can still tighten it: this is where a weak test is settled,
    // since after the lock nothing in the run can change it
    const weak = await weakTests(ctx, commit, needTest, tests);
    if ("outcome" in weak) return weak.outcome;
    if (weak.failures.length) {
      const sent = ctx.ledger.events().filter((e) => e.type === "step.failed" && String(e.key).startsWith("author-tests/") && (e.data as { signature?: string } | undefined)?.signature === PROOF_SIGNATURE).length;
      if (sent < PROOF_REWRITES && rewriteHasRoom(ctx)) return { kind: "fail", category: "other", failures: weak.failures, signature: PROOF_SIGNATURE, data: keep };
      ctx.log(`author-tests: ${weak.failures.length} test(s) still read as weak after ${sent} rewrite${sent === 1 ? "" : "s"}; locking them as they are and naming them on the pull request`);
    }
    const done = { outputs: { tests: lockSha, run1: run1.testRun, run2: run2.testRun }, treeSha: commit, data: { commit, ...retry, locked: lock.lock.length, familyNote, ...(weak.weak.length ? { weakTests: weak.weak } : {}), ...(lessons.length ? { lessonsUsed: lessons.map((l) => l.csproj) } : {}) } };
    // a criterion nothing tests, after every rewrite: the run stops here, before any code is paid for, and a person accepts it or stops
    const untested = weak.weak.filter((w) => w.verdict === "no-test").map((w) => w.acId);
    if (!untested.length) return { kind: "done", ...done };
    const cover = await runGate(testsCoverCriteria, ctx.ledger, ctx.writer, { check: ctx.ledger.putJson({ coverage: weak.weak }) }, ctx.policy, { step: "author-tests", treeSha: commit });
    const w = buildWaiver(ctx, "author-tests", [{ def: testsCoverCriteria, failures: cover.failures ?? [failure(testsCoverCriteria.id, cover.details)] }], commit,
      `The test writer was sent back and still wrote no test for ${untested.length === 1 ? "this criterion" : "these criteria"}. Accepting locks the tests as they are and the build goes on; the pull request names the criteria. To stop instead: factory stop ${ctx.runId}`);
    const accepted = { ...done, data: { ...done.data, acceptedUntested: untested } };
    if (w.kind === "waived") return { kind: "done", ...accepted, data: { ...accepted.data, waivers: w.waivers } };
    return w.outcome.kind === "wait" ? { ...w.outcome, card: { ...w.outcome.card, extra: { ...(w.outcome.card.extra ?? {}), testsFor: commit, held: accepted } } } : w.outcome;
  },
};

/**
 * The step's result a waiver card is holding (see the end of authorTestsStep), when a person accepted the card and the
 * worktree still has those tests: the same commit gets the same lock, with the person's name on it.
 */
async function heldTests(ctx: StepContext, wt: string): Promise<StepOutcome | undefined> {
  const ev = [...ctx.ledger.events()].reverse().find((e) => e.type === "human.requested" && (e.data as { step?: string }).step === "author-tests");
  const d = ev?.data as { artifactSha?: string; gateIds?: string[]; testsFor?: string; held?: { outputs: Record<string, string>; treeSha: string; data: Record<string, unknown> } } | undefined;
  if (!d?.held || !d.testsFor || !d.artifactSha) return undefined;
  const given = ctx.state.decisions.find((x) => x.artifactSha === d.artifactSha && x.decision === "waive");
  if (!given || (await headSha(wt)) !== d.testsFor) return undefined;
  ctx.log("author-tests: locking the tests the card was holding, as accepted (no model call)");
  const reason = String((given as unknown as { reason?: string }).reason ?? "").trim();
  return { kind: "done", outputs: d.held.outputs, treeSha: d.held.treeSha, data: { ...d.held.data, waivers: [{ gateIds: d.gateIds ?? [testsCoverCriteria.id], human: given.by, reason, boundTo: d.artifactSha }] } };
}

const PROOF_SIGNATURE = "author-tests:proof";
/** How many times the test writer is sent back for tests that do not prove their criteria, before they are locked as they are. */
const PROOF_REWRITES = 3;

/**
 * Whether the ladder gives the test writer another attempt after a failure now. The same failure twice moves it up a rung
 * (more effort, then a stronger model where the step has one); with no rung left, or no attempt left, it parks the run for
 * a person. A weak test is not worth that: the tests are locked as they are instead.
 */
export function rewriteHasRoom(ctx: Pick<StepContext, "project" | "policy" | "rung" | "attempt" | "state">): boolean {
  const rungs = availableRungs(ctx.project, "author-tests", ctx.policy.localOnly);
  return ctx.attempt < ctx.policy.retryBudget + ctx.state.capOverrides.extraAttempts && RUNGS.slice(ctx.rung + 1).some((r) => rungs.has(r));
}
const ProofOut = z.object({ coverage: z.array(ReviewCoverage) });
/** A criterion whose test a reader judged not to prove it, and why. */
export interface WeakTest { acId: string; verdict: "weak" | "no-test"; testId: string; why: string }
const PROOF_TEMPLATE = `You check acceptance tests before they are locked. The code they test is not written yet, so every test fails today: do not judge whether a test passes.
For each criterion in "acs", open its tests ("ac-tests" gives the file and the test name; a criterion can have several, judge them together) and decide whether they prove the criterion.
- "proves-it": code that broke any part of the criterion would fail these tests. They assert the values, messages, status codes and stored data the criterion names, for every case it names.
- "weak": the tests could pass on code that does not meet the criterion. Typical: checking that some error exists instead of the one the criterion names, checking one case of several, not comparing a value the criterion says is unchanged, not setting up the starting state the criterion describes.
- "no-test": nothing tests it.
Report one verdict per criterion in "coverage", with testId "" unless one test is at fault. In "why", one sentence the test writer can act on: what is not asserted. Judge only against the criterion's own words; do not ask for more than it says.`;

/**
 * Read each new test against its criterion before the lock (run e1b5: five tests passed at the end and proved too little, and by
 * then they were locked, so the run could only ask a person to waive). The reviewer's model reads them, not the writer's route.
 * A criterion the check leaves out counts as proven: the review at the end reads every test again and names what it finds weak.
 */
async function weakTests(ctx: StepContext, commit: string, needTest: { id: string }[], tests: { acId: string; file: string; name: string; testId: string }[]): Promise<{ failures: Failure[]; weak: WeakTest[] } | { outcome: StepOutcome }> {
  if (!needTest.length) return { failures: [], weak: [] };
  const room = Math.max(1, Math.ceil(needTest.length / 12));
  const r = await think({ ...ctx, priorFailures: [], gateAnswers: [] }, {
    stage: "author-tests", label: "test check", route: "review", cls: "read-large", budgetTokens: 60_000, schema: ProofOut,
    maxTurns: 14 * room, maxUsd: 1 * room, timeoutSec: 600 * room,
    tools: ["read_file", "search"], repoTools: toolsAt(ctx, commit), toolsAt: "under-review",
    sections: [
      S.template("tpl", PROOF_TEMPLATE),
      S.artifact("acs", "acceptance-criteria", needTest),
      S.artifact("ac-tests", "acceptance-tests", tests.map((t) => ({ acId: t.acId, file: t.file, name: t.name }))),
      S.task("Check these tests against their criteria. Open the test files."),
    ],
  });
  if (!r.ok) return r.outcome.kind === "park" ? { outcome: r.outcome } : { failures: [], weak: [] };
  const ids = new Set(needTest.map((a) => a.id));
  const seen = new Set<string>();
  const bad = r.output.coverage.filter((c) => c.verdict !== "proves-it" && ids.has(c.acId) && !seen.has(c.acId) && !!seen.add(c.acId));
  ctx.log(`author-tests: test check: ${bad.length ? `${bad.length} of ${needTest.length} criteria not proven by their tests` : `every criterion is proven by its tests`}`);
  return {
    weak: bad.map((c) => ({ acId: c.acId, verdict: c.verdict as WeakTest["verdict"], testId: c.testId, why: c.why })),
    failures: bad.map((c) => failure("test-proof", `${c.acId}: ${c.verdict === "no-test" ? "no test covers it" : `its test${c.testId ? ` ${c.testId}` : ""} does not prove the criterion`} (${c.why}). Tighten the test so it asserts what the criterion says.`)),
  };
}

// ---------- implement per task (A) ⟲ task verify (D) ----------
const ImplementOut = z.object({ done: z.boolean(), filesChanged: z.array(z.string()), notes: z.string() });

export async function diffSummary(wt: string, from: string, to: string, lock: Lock): Promise<DiffSummary> {
  const files = await changedFiles(wt, from, to);
  const out: DiffSummary["files"] = [];
  for (const f of files) {
    const patch = (await git(wt, ["diff", "--no-color", "-U0", from, to, "--", f.path])).stdout;
    out.push({
      status: f.status, path: f.path,
      added: patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)),
      removed: patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1)),
    });
  }
  const lockedNow: Record<string, string | null> = {};
  for (const l of lock.lock) {
    const p = join(wt, l.file);
    lockedNow[l.file] = existsSync(p) ? sha256(readFileSync(p)) : null;
  }
  return { from, to, files: out, lockedNow };
}

async function isAncestor(wt: string, a: string, b: string): Promise<boolean> {
  try { await git(wt, ["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; }
}

/** The packages the commit's project files add or change since `diff.from`, read from the files at both commits. */
async function packageChangesOf(wt: string, diff: DiffSummary): Promise<PackageChanges> {
  const at = async (commit: string, path: string) => { try { return (await git(wt, ["cat-file", "blob", `${commit}:${path}`])).stdout; } catch { return undefined; } };
  const changes: PackageChange[] = [];
  for (const f of diff.files) if (isPackageManifest(f.path)) changes.push(...changedPackages(f.path, await at(diff.from, f.path), await at(diff.to, f.path)));
  return { kind: "packages", from: diff.from, to: diff.to, changes };
}

function secretScanOf(diff: DiffSummary, commit: string) {
  return { kind: "secrets" as const, commit, hits: diff.files.flatMap((f) => scanText(f.path, f.added.join("\n"))) };
}

type OwnerPlan = { tasks: { id: string; reqs: string[]; dependsOn?: string[]; fileScope?: string[] }[] };
type OwnerSpec = { requirements: { id: string; acceptance: { id: string; level?: string }[] }[] };

/**
 * Criteria proven on the app as a whole, not on one class: they can only pass once the route or screen that serves them is wired.
 * A job criterion counts too: on a real run "the built API document lists every operation" was held to the task that
 * writes the document, two tasks before the one that maps the operations.
 */
const THROUGH_APP = new Set(["api", "ui", "job"]);

/** The last task (in plan order) that is built on `taskId`, directly or through other tasks; `taskId` itself when nothing is. */
function lastBuiltOn(plan: OwnerPlan, taskId: string): string {
  const on = new Set([taskId]);
  let last = taskId;
  // plan order is dependency order, so one pass finds every task that follows from it
  for (const t of plan.tasks) if (!on.has(t.id) && (t.dependsOn ?? []).some((d) => on.has(d))) { on.add(t.id); last = t.id; }
  return last;
}

/**
 * Each acceptance criterion belongs to exactly one task: the LAST task (in plan order) that works on
 * its requirement. Earlier tasks that touch the same requirement build towards it but aren't held to
 * its tests yet, so a requirement split over two tasks doesn't make task 1 impossible.
 * `layered`: the run has shown its plan is built in layers (planShowsLayers). A criterion proven through the running
 * app (level api, ui or job) is then held later still, at the last task built on that one: such a plan lists a requirement
 * on the layer that holds its logic, and no test can reach it until the last layer is wired.
 */
export function acOwners(plan: OwnerPlan, spec: OwnerSpec, layered = false): Map<string, string> {
  const owners = new Map<string, string>();
  for (const r of spec.requirements) {
    const owner = [...plan.tasks].reverse().find((t) => t.reqs.includes(r.id));
    if (!owner) continue;
    const later = layered ? lastBuiltOn(plan, owner.id) : owner.id;
    for (const a of r.acceptance) owners.set(a.id, THROUGH_APP.has(a.level ?? "") ? later : owner.id);
  }
  return owners;
}

/**
 * The same locked tests failed twice at `taskId`. True when that says "this task cannot reach them" and not "the code or the
 * test is wrong": each is this task's own, is proven through the running app, and a later task is built on this one.
 */
export function failsForLayers(plan: OwnerPlan, spec: OwnerSpec, tests: { acId: string; testId: string }[], taskId: string, failedIds: string[]): boolean {
  if (!failedIds.length || lastBuiltOn(plan, taskId) === taskId) return false;
  const own = acOwners(plan, spec);
  const level = new Map(spec.requirements.flatMap((r) => r.acceptance.map((a) => [a.id, a.level ?? ""] as const)));
  return failedIds.every((id) => { const t = tests.find((x) => x.testId === id); return !!t && own.get(t.acId) === taskId && THROUGH_APP.has(level.get(t.acId) ?? ""); });
}

/**
 * Each of these tests fails now exactly as it did before the task started (same kind, same message): the task's code made no
 * difference to it, so another attempt at the same code would not either. A real bug changes the message.
 */
export function failsAsBefore(before: Pick<TestRun, "results"> | undefined, now: Pick<TestRun, "results">, ids: string[]): boolean {
  if (!before || !ids.length) return false;
  const was = new Map(before.results.map((r) => [r.id, r])), is = new Map(now.results.map((r) => [r.id, r]));
  return ids.every((id) => {
    const a = was.get(id), b = is.get(id);
    return a?.outcome === "failed" && b?.outcome === "failed" && !!b.message && a.message === b.message && a.failureKind === b.failureKind;
  });
}

/** Files where a request or a page enters the app: until a task writes one, nothing new can be reached through the running app. */
const ENTRY_FILES: Record<string, RegExp> = {
  dotnet: /(^|\/)(Program\.cs|[^/]*(Endpoints?|Controllers?)\.cs)$|(^|\/)(Endpoints|Controllers)\//,
  node: /(^|\/)(app|pages)\/(.*\/)?(page|route)\.[jt]sx?$|(^|\/)pages\/.+\.[jt]sx?$/,
};

function writesEntry(fileScope: string[], stack: string | undefined): boolean {
  const re = ENTRY_FILES[stack ?? ""];
  return !!re && fileScope.some((f) => re.test(f));
}

/**
 * The plan itself shows it is built in layers, before any task has run: a requirement proven through the running app is held
 * by a task that writes no entry file, nor does any task under it, while a task built on it does. Its tests cannot pass
 * until that later task, so they are held there from the start and no attempt is paid to find that out.
 * Says nothing when no task writes an entry file (a change under routes that exist already).
 */
export function layeredByFiles(plan: OwnerPlan, spec: OwnerSpec, stack: string | undefined): boolean {
  const entry = new Set(plan.tasks.filter((t) => writesEntry(t.fileScope ?? [], stack)).map((t) => t.id));
  if (!entry.size) return false;
  const own = acOwners(plan, spec);
  const held = new Set(spec.requirements.flatMap((r) => r.acceptance.filter((a) => THROUGH_APP.has(a.level ?? "")).map((a) => own.get(a.id))));
  return plan.tasks.some((t) => {
    if (!held.has(t.id)) return false;
    // the task and everything it is built on (plan order is dependency order, so one pass from the end finds them all)
    const under = new Set([t.id]);
    for (const x of [...plan.tasks].reverse()) if (under.has(x.id)) for (const d of x.dependsOn ?? []) under.add(d);
    if ([...under].some((id) => entry.has(id))) return false;
    const on = new Set([t.id]);
    for (const x of plan.tasks) if (!on.has(x.id) && (x.dependsOn ?? []).some((d) => on.has(d))) on.add(x.id);
    return [...on].some((id) => entry.has(id));
  });
}

/**
 * Why a plan is not built in working slices, for the planner to fix (asked once; a plan that stays layered still runs, with
 * the hand-over of planShowsLayers). Either its files show layers (layeredByFiles), or the planner listed nearly every
 * criterion checked through the app on one task: the same plan, with the requirements moved to the wiring task.
 * In run 31fe that last task carried 103 tests and every earlier mistake, and was the longest and dearest of the run.
 */
export function slicesProblem(plan: OwnerPlan, spec: OwnerSpec, stack: string | undefined): string | undefined {
  const fix = "Build in working slices: the first task that adds a route or screen wires the app's entry too, and each later task adds its logic together with its own route or screen.";
  if (layeredByFiles(plan, spec, stack)) return `The plan is built in layers: a task holds criteria checked through the running app, but the app's entry is written by a later task, so those criteria can only be checked there. ${fix}`;
  const own = acOwners(plan, spec);
  const through = spec.requirements.flatMap((r) => r.acceptance.filter((a) => THROUGH_APP.has(a.level ?? "")).map((a) => own.get(a.id)));
  if (plan.tasks.length < SLICE_MIN_TASKS || through.length < SLICE_MIN_CRITERIA) return undefined;
  const top = plan.tasks.map((t) => ({ id: t.id, n: through.filter((o) => o === t.id).length })).sort((x, y) => y.n - x.n)[0]!;
  return top.n > SLICE_MAX_SHARE * through.length ? `${top.id} holds ${top.n} of the ${through.length} criteria checked through the running app, so the other ${plan.tasks.length - 1} tasks are checked only when it runs. ${fix} Spread those requirements over the tasks that make them work.` : undefined;
}
const SLICE_MIN_TASKS = 4, SLICE_MIN_CRITERIA = 12, SLICE_MAX_SHARE = 0.6;

/** The plan is treated as layered (acOwners): its files show it (layeredByFiles), or a task of this run failed that way (failsForLayers). */
export function planShowsLayers(events: LedgerEvent[], plan: OwnerPlan, spec: OwnerSpec, tests: { acId: string; testId: string }[], stack?: string): boolean {
  return layeredByFiles(plan, spec, stack) || events.some((e) => {
    if (e.type !== "step.failed" || !e.key?.startsWith("implement/")) return false;
    const d = (e.data ?? {}) as { action?: string; lockedFailedIds?: string[] };
    return (d.action === "defer" || d.action === "a5-check") && failsForLayers(plan, spec, tests, splitKey(e.key).step.slice("implement/".length), d.lockedFailedIds ?? []);
  });
}

/**
 * What a task works on beyond its own entry in the plan, because it holds criteria of requirements an earlier task lists
 * (acOwners): those requirements, those tasks' files, and the files of every task it is built on. A task that must make a
 * test pass may fix the code the test runs.
 * stuck: a locked test of its own failed on the last attempt. Its test runs through the tasks it is built on, and the fault
 * may be in their code (run e1b5: a time the create route returned finer than the database keeps, failing the get task's
 * test twice), so their files open to it as well.
 */
export function takenOver(plan: { tasks: { id: string; reqs: string[]; fileScope: string[]; dependsOn?: string[] }[] }, spec: OwnerSpec, taskId: string, layered = false, stuck = false): { reqs: string[]; fileScope: string[]; from: string[] } {
  const owners = acOwners(plan, spec, layered);
  const me = plan.tasks.find((t) => t.id === taskId);
  const reqs = spec.requirements.filter((r) => !me?.reqs.includes(r.id) && r.acceptance.some((a) => owners.get(a.id) === taskId)).map((r) => r.id);
  const from = reqs.map((id) => [...plan.tasks].reverse().find((t) => t.reqs.includes(id))!).filter((t, i, all) => t.id !== taskId && all.indexOf(t) === i);
  // those tests run through every layer under this task, not only the tasks that list the requirement last (a DTO task whose
  // requirements a later task lists again): a wrong line in any of them fails a test here, so all of them can be fixed here
  const under = new Set(from.length || stuck ? me?.dependsOn ?? [] : []);
  for (const t of [...plan.tasks].reverse()) if (under.has(t.id)) for (const d of t.dependsOn ?? []) under.add(d);
  const files = [...from, ...plan.tasks.filter((t) => under.has(t.id) && !from.includes(t))].flatMap((t) => t.fileScope);
  return { reqs, from: from.map((t) => t.id), fileScope: [...new Set(files)].filter((f) => !me?.fileScope.includes(f)) };
}

type EarlierTests = Map<string, { taskId: string; acId: string }>;

/** Locked tests owned by tasks before `taskId` in plan order (testId → owner). Later tasks' tests never count. */
export function earlierTests(plan: { tasks: { id: string }[] }, owners: Map<string, string>, tests: { acId: string; testId: string }[], taskId: string): EarlierTests {
  const order = plan.tasks.map((t) => t.id);
  const me = order.indexOf(taskId);
  const out: EarlierTests = new Map();
  for (const t of tests) {
    const o = owners.get(t.acId);
    const i = o ? order.indexOf(o) : -1;
    if (o && i >= 0 && i < me) out.set(t.testId, { taskId: o, acId: t.acId });
  }
  return out;
}

const LOCKED_CHECKS = new Set(["locked-failed", "locked-flaky", "locked-not-executed"]);

/**
 * An earlier task's locked test passed at its own task; if it fails now, this task's change broke it.
 * Say so plainly, as a regression: the code is wrong, not the test (no test-defect check, no park).
 */
export function labelRegressions(failures: Failure[], earlier: EarlierTests): Failure[] {
  return failures.map((f) => {
    const o = f.testId && LOCKED_CHECKS.has(f.check) ? earlier.get(f.testId) : undefined;
    return o ? { ...f, check: "regression", message: `Your change broke ${o.taskId}'s locked test ${f.testId} (${o.acId}): ${f.message}` } : f;
  });
}

/** Run gates; classify for the ladder: safety > locked-test > other. Earlier tasks' locked tests become regressions. */
async function gateAll(ctx: StepContext, step: string, treeSha: string, gates: [GateDef, Record<string, string>][], earlier?: EarlierTests): Promise<{ failures: Failure[]; category: "safety" | "locked-test" | "other"; lockedFailedIds: string[] } | undefined> {
  let failures: Failure[] = [];
  let safety = false;
  for (const [def, inputs] of gates) {
    const r = await runGate(def, ctx.ledger, ctx.writer, inputs, ctx.policy, { step, treeSha });
    if (!r.passed) {
      failures.push(...(r.failures ?? [failure(def.id, r.details)]));
      if (def.safety && def.id !== "tests.expectations") safety = true;
    }
  }
  if (!failures.length) return undefined;
  if (earlier) failures = labelRegressions(failures, earlier);
  const lockedFailedIds = failures.filter((f) => f.check === "locked-failed" || f.check === "locked-flaky").map((f) => f.testId!).filter(Boolean);
  const evidence = failures.some((f) => f.check === "evidence" || f.check === "locked-not-executed");
  return { failures, category: safety || evidence ? "safety" : lockedFailedIds.length ? "locked-test" : "other", lockedFailedIds };
}

/** Failures that leave the previous attempt's code worth building on: only behaviour (or the build) was wrong. */
const KEEPABLE = new Set(["build", "locked-failed", "locked-flaky", "regression", "new-failure"]);

export interface PrevAttempt {
  checks: string[]; rung: number; interrupted: boolean; commit?: string;
  /** the attempt stopped when the model account ran out of credit, with its code committed */ noCredit?: boolean;
  /** author-tests: the stored answer of the attempt */ out?: string;
  /** every failure of the attempt was a locked test that fails as it did before the task (failsAsBefore) */ untouched?: boolean;
  /** how many locked tests failed in this attempt, and in the attempt before it, when each ended on locked tests */
  locked?: number; lockedBefore?: number;
}

/**
 * Keep the previous attempt's code for this retry, or start again from the task's start commit.
 * Keep after a recorded failure of keepable checks, at the same rung or after a move up the ladder: the stronger
 * model is told it may replace what cannot work, instead of paying to write all of it again (run 31fe: a reset on
 * each move, $5 a time). Anything else wrong (a safety check, an agent error) starts fresh.
 */
export function retryMode(prev: PrevAttempt | undefined, rung: number): { mode: "keep" | "reset"; reason: string } {
  if (!prev) return { mode: "reset", reason: "no previous attempt" };
  if (prev.interrupted) return { mode: "reset", reason: "the previous attempt didn't finish" };
  if (prev.noCredit) return { mode: "keep", reason: "the previous attempt stopped when the model account ran out of credit" };
  // out of budget or turns is unfinished work, not a wrong approach: it is kept at any rung
  if (prev.checks.length && prev.checks.every((c) => c === "agent-over-budget" || c === "agent-timeout")) return { mode: "keep", reason: "the previous attempt ran out of budget or turns" };
  const closer = prev.locked !== undefined && prev.lockedBefore !== undefined && prev.locked < prev.lockedBefore
    && prev.checks.length > 0 && prev.checks.every((c) => c === "locked-failed" || c === "locked-flaky");
  if (closer && prev.rung !== rung) return { mode: "keep", reason: `fewer locked tests failed than the attempt before (${prev.locked}, was ${prev.lockedBefore})` };
  if (!prev.checks.length) return { mode: "reset", reason: prev.rung !== rung ? `moved from rung ${prev.rung} to rung ${rung}` : "no failures to fix" };
  const bad = [...new Set(prev.checks.filter((c) => !KEEPABLE.has(c)))];
  if (bad.length) return { mode: "reset", reason: `the previous attempt failed on ${bad.join(", ")}` };
  if (prev.rung !== rung) return { mode: "keep", reason: `moved from rung ${prev.rung} to rung ${rung}; the previous attempt failed only on ${[...new Set(prev.checks)].join(", ")}` };
  return { mode: "keep", reason: `the previous attempt failed only on ${[...new Set(prev.checks)].join(", ")}` };
}

/** The last attempt of `step` since it last completed: how it ended, its rung and commit. `checks` from its failures. */
export function previousAttempt(events: LedgerEvent[], step: string, checks: string[]): PrevAttempt | undefined {
  const evs = events.filter((e) => e.key && splitKey(e.key).step === step);
  const lastDone = Math.max(-1, ...evs.filter((e) => e.type === "step.completed").map((e) => e.seq));
  const ends = evs.filter((e) => e.seq > lastDone && (e.type === "step.failed" || e.type === "step.interrupted"));
  const end = ends.at(-1);
  if (!end) return undefined;
  const d = (end.data ?? {}) as { rung?: number; parked?: boolean; commit?: string; out?: string; untouched?: boolean; noCredit?: boolean };
  const noCredit = !!d.noCredit && !!d.commit;
  const locked = (e: LedgerEvent | undefined) => {
    const x = (e?.data ?? {}) as { category?: string; lockedFailedIds?: string[] };
    return e?.type === "step.failed" && x.category === "locked-test" && x.lockedFailedIds?.length ? x.lockedFailedIds.length : undefined;
  };
  const now = locked(end), before = locked(ends.at(-2));
  return {
    checks, rung: Number(d.rung ?? 0), interrupted: end.type === "step.interrupted" || (!!d.parked && !noCredit), commit: d.commit, ...(d.out ? { out: d.out } : {}), ...(noCredit ? { noCredit } : {}),
    ...(d.untouched ? { untouched: true } : {}), ...(now !== undefined ? { locked: now } : {}), ...(before !== undefined ? { lockedBefore: before } : {}),
  };
}

const PREV_CHANGE_CAP = 40_000;

export function implementStep(taskId: string): StepDef {
  const key = `implement/${taskId}`;
  return {
    key, stage: "implement", templateVersion: "2", coding: true, needsUsd: AGENT_START_USD,
    inputs: (s) => {
      if (s.steps.get("author-tests")?.status !== "completed") return undefined;
      const plan = s.steps.get("plan")!.outputs[0];
      // taskStartSha: the previous task's commit (plan order), or the tests commit. Only EARLIER tasks count:
      // a later task finishing mustn't change this task's inputs (that re-ran finished tasks forever).
      const order = (s.steps.get("plan")!.data?.tasks as string[] | undefined) ?? [];
      const prevDone = order.slice(0, Math.max(0, order.indexOf(taskId))).map((t) => `implement/${t}`);
      if (prevDone.some((k) => s.steps.get(k)?.status !== "completed")) return undefined;
      const last = prevDone.at(-1);
      const start = last ? String(s.steps.get(last)!.data?.commit) : String(s.steps.get("author-tests")!.data!.commit);
      return { plan, tests: s.steps.get("author-tests")!.outputs[0], taskStartSha: start, prevDone };
    },
    async run(ctx) {
      const plan = requireOutput<Plan>(ctx.state, ctx.ledger, "plan");
      const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
      const { lock, sha: lockSha } = lockOf(ctx.state, ctx.ledger);
      const baselineSha = ctx.state.steps.get("discover")!.outputs[0]!;
      const task = plan.tasks.find((t) => t.id === taskId)!;
      const inputs = implementStep(taskId).inputs(ctx.state, ctx.ledger)!;
      const start = String(inputs.taskStartSha);
      const wt = await ensureWorktree(ctx, start);
      const builtDoc = ctx.project.contract?.built ? [ctx.project.contract.built] : [];
      // a locked test of this task failed on the last attempt: the files of the tasks it is built on open to it (takenOver)
      const mine = acOwners(plan, spec, planShowsLayers(ctx.ledger.events(), plan, spec, lock.tests, ctx.project.stack));
      const stuck = ctx.priorFailures.some((f) => f.check === "locked-failed" && lock.tests.some((t) => t.testId === f.testId && mine.get(t.acId) === task.id));
      // keep the previous attempt's code, or start fresh from a clean commit (its diff saved first)
      const prev = previousAttempt(ctx.ledger.events(), key, ctx.priorFailures.map(checkOf));
      let mode = retryMode(prev, ctx.rung);
      // an attempt that ended on its budget before that was read as one (run 31fe, attempt 7) left its code uncommitted: commit it now
      if (mode.mode === "keep" && !prev?.commit && ctx.priorFailures.some((f) => f.check !== checkOf(f)) && (await headSha(wt)) === start && (await dirtyPaths(wt)).length) {
        await trackIgnored(wt, [...task.fileScope, ...takenOver(plan, spec, task.id, planShowsLayers(ctx.ledger.events(), plan, spec, lock.tests, ctx.project.stack), stuck).fileScope], builtDoc);
        await commitAll(wt, `factory: ${task.id} unfinished`);
      }
      const head = await headSha(wt);
      const dirty = !!(await git(wt, ["status", "--porcelain"])).stdout.trim();
      if (mode.mode === "keep" && (dirty || head === start || (prev?.commit && prev.commit !== head) || !(await isAncestor(wt, start, head)))) {
        mode = { mode: "reset", reason: "the worktree isn't at the previous attempt's commit" };
      }
      let prevChange: string | undefined;
      if (mode.mode === "keep") {
        prevChange = (await git(wt, ["diff", "--no-color", start, head])).stdout;
        const saved = ctx.ledger.putArtifact(prevChange);
        // files stay; HEAD goes back to the start so the task still ends as one commit
        await git(wt, ["reset", "--mixed", "-q", start]);
        // a kept file an ignore rule matches would be cleaned away with the build output
        await trackIgnored(wt, [...task.fileScope, ...takenOver(plan, spec, task.id, planShowsLayers(ctx.ledger.events(), plan, spec, lock.tests, ctx.project.stack), stuck).fileScope], builtDoc);
        await git(wt, ["clean", "-fdX", ...keptOnReset(ctx.project).flatMap((k) => ["-e", k])]);
        ctx.log(`implement ${taskId}: keeping previous attempt's code (${mode.reason}; diff ${saved.slice(0, 8)})`);
      } else if (head !== start || dirty) {
        const saved = ctx.ledger.putArtifact(await diffIncludingUntracked(wt, start));
        ctx.log(`implement ${taskId}: saved previous attempt's diff (${saved.slice(0, 8)}) and reset (${mode.reason})`);
        await resetHard(wt, start, keptOnReset(ctx.project));
      }
      const retry = { retryMode: mode.mode, retryReason: mode.reason };
      const unfinishedBefore = prevChange !== undefined && ctx.priorFailures.length > 0 && ctx.priorFailures.every((f) => checkOf(f) === "agent-over-budget" || f.check === "agent-timeout");
      const { model, effort } = modelFor(ctx.project, "implement", ctx.rung, undefined, ctx.priorFailures);
      // a plan built in layers shows itself at the first task whose tests need a later layer; from then on those tests wait for it
      const layered = planShowsLayers(ctx.ledger.events(), plan, spec, lock.tests, ctx.project.stack);
      const owners = acOwners(plan, spec, layered);
      const myTests = lock.tests.filter((t) => owners.get(t.acId) === task.id);
      const earlier = earlierTests(plan, owners, lock.tests, task.id);
      // criteria held here for requirements an earlier task lists: this task gets those requirements and may change those tasks' files
      const taken = takenOver(plan, spec, task.id, layered, stuck);
      const fileScope = [...task.fileScope, ...taken.fileScope];
      // a file a person unlocked for this run that this task may write: the agent is told, since the folder's rule still says hands off
      const freed = unlockedFiles(ctx.ledger.events()).map((u) => u.file).filter((f) => matchesAny(f, fileScope));
      const sharesBuiltDir = sharesFolder(fileScope, builtDoc[0]);
      // what the last build's API document still lacks against the contract, so the agent starts from the list instead of finding it by hand
      const gap = writesEntry(fileScope, ctx.project.stack) || fileScope.some((f) => builtDoc.includes(f)) ? contractGapAt(ctx, wt, [prev?.commit, start]) : undefined;
      if (taken.from.length) ctx.log(`implement ${taskId}: also held to the criteria of ${taken.from.join(", ")} (tested through the app, which this task completes), so it may change their files too`);
      else if (taken.fileScope.length) ctx.log(`implement ${taskId}: its own locked test failed on the last attempt, so it may change the files of the tasks it is built on too`);
      const ref = ctx.state.info.estimateRef;
      const approvedDesign = approvedDesignFor<ApprovedDesign>(ctx.state, ctx.ledger)?.design;
      const screen = ref && approvedDesign ? screenFor(ctx.ledger.getJson(ref.breakdownSha), approvedDesign, task.estimateTaskId) : undefined;
      // the scaffold the stub commit wrote: a task that fills in a screen's container is told to write behaviour only, the
      // design-system task gets the scaffold's to-do list, and no task may change the files the factory generated
      const scaf = readOutput<ScaffoldRecord>(ctx.state, ctx.ledger, "stub-commit", "scaffold");
      const scaffoldScreen = scaf?.screens.find((x) => matchesAny(x.container, task.fileScope));
      const designSystemTask = !!scaf && scaf.designSystem.files.some((f) => matchesAny(f, task.fileScope));
      // every task that builds an approved screen gets its brief: an estimated build, --from-design, a kit or a repo of its own
      const fromScaffold = scaffoldScreen ? approvedDesign?.screens.find((x) => x.id === scaffoldScreen.id) : undefined;
      const briefScreens = screen ? [screen] : fromScaffold ? [fromScaffold] : screensForTask(approvedDesign, task);
      const approvedScreen = !approvedDesign || !briefScreens.length ? undefined
        : briefScreens.length === 1 ? screenBrief(approvedDesign, briefScreens[0]!) : screensBrief(approvedDesign, briefScreens);
      // a task that also holds earlier tasks' tests has their work to prove as well as its own: twice the turns, budget and time
      const room = taken.from.length ? 2 : 1;
      const limits = { maxTurns: 80 * room, maxUsd: stepBudgetUsd(replay(ctx.ledger.events()), 4 * room), timeoutSec: 45 * 60 * room };
      // a backend on PostgreSQL: the session gets an empty database of its own, so the agent can run the locked tests
      const sessionDb = agentDatabase(ctx.project);
      // the approved guidelines' rules for this task's files, so the code is written to the rules the reviewer judges it by.
      // Not part of the step's inputs: guidelines approved or rebuilt during a run must not build finished tasks again.
      const conv = readApproved(ctx.state.info.project);
      const rules = "unapproved" in conv ? undefined : guidelinesBrief(conv, fileScope);
      if (rules) ctx.log(`implement ${taskId}: shown ${rules.shown} coding guideline${rules.shown === 1 ? "" : "s"} for its files (guidelines ${"sha" in conv ? conv.sha.slice(0, 8) : ""}${rules.cut ? `; ${rules.cut} outside best practices left out, over the limit` : ""})`);
      else if ("unapproved" in conv) ctx.log(`implement ${taskId}: no approved coding guidelines, so none are shown`);
      const pack = buildPack({
        stage: "implement", cls: "agent", model, recipeVersion: "1", tools: [], redactor: new Redactor(),
        sections: [
          S.template("tpl", implementIntro(ctx.project.stack, sessionDb && { settings: Object.keys(sessionDb.env) })),
          S.artifact("task", "plan-task", { ...task, approach: task.approach }),
          // the plan's packages: the only ones a project file may gain (task.packages-planned checks the commit)
          ...(plan.newDependencies.length ? [S.template("planned-packages", `The approved plan lists these packages: ${plan.newDependencies.map((d) => `${d.name} ${d.version}`).join(", ")}. A project file may gain these and no other, and no other package's version may change: the commit is checked.`)] : []),
          // the approved screen this task builds (route, states, sample content, and the look to follow)
          ...(approvedScreen ? [S.artifact("approved-screen", "approved-screen", approvedScreen)] : []),
          ...(scaf ? [S.profile("scaffold", `The approved design is already code in this repo (${scaf.target}, kit ${scaf.kit.id} ${scaf.kit.version}):\n${scaf.summary}`)] : []),
          ...(scaffoldScreen ? [S.template("behaviour-only", `This task fills in ${scaffoldScreen.id}'s container, ${scaffoldScreen.container}. The page itself is ${scaffoldScreen.screen}: the approved blocks, states, layers and text, generated from the approved design and not editable. Its sample data is ${scaffoldScreen.fixtures}, which is the shape the real data must take.
- Write behaviour only: load the real data in the fixtures' shape and pass it as \`data\`, handle the page's actions in \`onAction(label, at)\`, and pass \`state\` for loading, empty, error, success and validation (the states the design drew: ${Object.keys(scaffoldScreen.states).join(", ")}).
- Do not restyle or rebuild the page: no new markup, classes, colours or components for what the page already draws. Keep the fixture branch (\`?fixture=${scaffoldScreen.id}:<state>\` shows the approved sample data with no backend).
- Server code, API clients and validation go in the other files of your scope.`)] : []),
          ...(designSystemTask ? [S.template("design-system", `This is the design-system task. The generated files are already in the repo (the scaffold commit). Finish the wiring:\n${scaf!.designSystem.todo.map((t) => `- ${t}`).join("\n") || "- nothing left to wire: check the app builds"}\nDo not change the generated files.`)] : []),
          S.artifact("acs", "acceptance-criteria", spec.requirements.filter((r) => task.reqs.includes(r.id) || taken.reqs.includes(r.id))),
          ...(sharesBuiltDir.length ? [S.template("built-doc-folder", `The build writes the API document to ${builtDoc[0]}. On this machine folder names that differ only in case are one folder, so that is also the folder of ${sharesBuiltDir.join(", ")}. Never delete or empty that folder: to get a fresh document, delete only ${builtDoc[0]}.`)] : []),
          ...(taken.from.length ? [S.template("taken-over", `The locked tests below include those of ${taken.from.join(", ")}: their requirements (${taken.reqs.join(", ")}) are tested through the running app, and this is the task that completes it. Those tasks are done and their code is in the repo. Make these tests pass too. Where one fails because that earlier code is wrong, fix it there: their files are in your file scope.`)] : taken.fileScope.length ? [S.template("taken-over", `A locked test of this task failed on the last attempt. It runs through the code of the tasks this one is built on, which are done and in the repo. Where the test fails because that earlier code is wrong, fix it there: their files are in your file scope.`)] : []),
          ...(freed.length ? [S.template("unlocked", `A person unlocked ${freed.join(", ")} for this run: you may change ${freed.length === 1 ? "it" : "them"}, whatever a rule below says about ${freed.length === 1 ? "its" : "their"} folder. Every other locked file stays as it is.`)] : []),
          ...contractNote(ctx.project, wt, "code"),
          ...dataModelNote(ctx.project, wt, "code", !!databaseBefore(ctx)),
          ...(rules ? [S.reference("guidelines", rules.text)] : []),
          S.artifact("tests", "locked-tests", myTests),
          S.pointers([...task.fileScope.map((p) => ({ path: p, reason: "you may change this" })), ...taken.fileScope.map((p) => ({ path: p, reason: "an earlier task's file; change it only to fix a failing test" })), ...task.exemplars.map((p) => ({ path: p, reason: "follow this style" })), ...myTests.map((t) => ({ path: t.file, reason: `locked test for ${t.acId}; read, don't edit` }))]),
          ...(prevChange !== undefined ? [{ spec: { id: "previous-change", source: "artifact" as const, trust: "derived" as const, placement: "user" as const }, artifactKind: "diff",
            content: "Your previous change (diff from the task start; it is already in the files):\n" + (prevChange.length > PREV_CHANGE_CAP ? prevChange.slice(0, PREV_CHANGE_CAP) + `\n… (diff cut at ${PREV_CHANGE_CAP / 1000} KB; read the files for the rest)` : prevChange) }] : []),
          ...(gap?.length ? [{ spec: { id: "contract-gap", source: "feedback" as const, trust: "derived" as const, placement: "user" as const }, content: gapNote(gap) }] : []),
          ...(ctx.priorFailures.length ? [{ spec: { id: "failures", source: "feedback" as const, trust: "derived" as const, placement: "user" as const }, content: ctx.priorFailures.slice(0, 20).map((f) => `- [${f.check}] ${f.message}${f.frames.length ? `\n    ${f.frames.join("\n    ")}` : ""}`).join("\n") }] : []),
          S.task(`Implement ${task.id}: ${task.title}.${unfinishedBefore
            ? " The previous attempt stopped before it finished (above). Its code is still in the files: read it, keep what is right and finish the task."
            : prevChange !== undefined
            ? prev && prev.rung !== ctx.rung
              ? " The previous attempts failed; the latest failures are above. Their code is still in the files: keep what is right and fix the failures there. Replace a part only where its approach cannot pass the tests."
              : " The previous attempt failed; the failures are above. Its code is still in the files: fix the failures by editing that change, don't rewrite it."
            : ctx.priorFailures.length ? " The previous attempt failed; the failures are above." : ""}${limitsNote(limits, "Build and run the locked tests early, and return done=true as soon as they pass.")}`),
          S.recap(["only the file scope", "don't touch tests", "no new packages", "return done=true when finished"]),
        ],
      });
      // the briefing is built first: one that doesn't fit stops the step before any container starts
      const rt = runtime();
      await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
      tracePack(ctx.trace, `implementer ${taskId}`, pack);
      await ensureAgentImage(rt, ctx.project.dotnet.sdkImage);
      // a Node app's packages, in the checkout (a .NET one reads the restored packages from the run's folder)
      if (ctx.project.stack === "node") await ensurePackages(ctx, start, wt);
      // rejected only for locked tests this task is no longer held to (they belong to a later task now): its code is judged again as it is
      const held = new Set([...myTests.map((t) => t.testId), ...earlier.keys(), ...lock.characterisation.map((c) => c.testId)]);
      const recheck = prevChange !== undefined && ctx.priorFailures.length > 0 && (ctx.priorFailures.length < 20 || !!prev?.untouched) && ctx.priorFailures.every((f) => LOCKED_CHECKS.has(f.check) && !!f.testId && !held.has(f.testId));
      if (recheck) ctx.log(`implement ${taskId}: the previous attempt failed only on tests this task is no longer held to; checking its code again without the implementer`);
      else {
        // a task that also holds earlier tasks' tests has their work to prove as well as its own: twice the turns, budget and
        // time of one task, so it is not cut off and started again part-way (each new session pays to read everything again)
        const r = await codingRunner(rt, {
          runId: ctx.runId, key: `${key}/${ctx.attempt}`, fileScope, lockedFiles: lock.lock.map((l) => l.file), onProgress: agentTracer(ctx, "implementer"),
          extraProtected: scaf?.protected ?? [], ...(ctx.project.stack === "node" ? {} : { packagesDir: packagesDir(ctx.runId) }), agentEnv: ctx.project.agentEnv, noGo: ctx.project.noGo, ...(sessionDb ? { database: sessionDb } : {}),
          onContainer: async (id, role) => { await ctx.ledger.append({ type: "container.started", key, data: { id, role } }, ctx.writer); },
          onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key, data: { id } }, ctx.writer); },
        }, model).run({ step: "implement", model, effort, pack, schema: ImplementOut, limits, workdir: wt });
        await ctx.usage({ model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite, turns: r.usage.turns, wallMs: r.usage.wallMs, estUsd: r.usage.estUsd });
        if (r.status === "config-error" && r.error === NO_CREDIT_TEXT) {
          // the code so far is paid for: committed, and the next attempt carries on from it at the same rung
          await trackIgnored(wt, fileScope, builtDoc);
          const unfinished = (await dirtyPaths(wt)).length ? await commitAll(wt, `factory: ${task.id} unfinished`) : undefined;
          return { kind: "park", reason: r.error, data: { noCredit: true, rung: ctx.rung, ...(unfinished ? { commit: unfinished } : {}) } };
        }
        if (r.status === "config-error") return { kind: "park", reason: r.error ?? "The API rejected the coding agent's request" };
        if (r.status !== "ok") {
          // out of budget or turns: the code so far is paid for, so it is committed for the retry to finish
          await trackIgnored(wt, fileScope, builtDoc);
          const unfinished = UNFINISHED.has(r.status) && (await dirtyPaths(wt)).length ? await commitAll(wt, `factory: ${task.id} unfinished`) : undefined;
          return { kind: "fail", category: r.status === "rate-limited" ? "rate-limit" : "other", failures: [failure(`agent-${r.status}`, r.error ?? r.status)], signature: `implement:${r.status}`, data: { ...retry, ...(unfinished ? { commit: unfinished } : {}) } };
        }
      }

      // core commits (the agent has no git), then the producer judges that exact commit
      const hidden = await trackIgnored(wt, fileScope, builtDoc);
      if (hidden.length) ctx.log(`implement ${taskId}: ${hidden.join(", ")} ${hidden.length > 1 ? "match" : "matches"} an ignore rule; committed anyway, because the plan names ${hidden.length > 1 ? "them" : "it"}`);
      const commit = await commitAll(wt, `factory: ${task.id} ${task.title}`);
      const diff = await diffSummary(wt, start, commit, lock);
      const diffSha = ctx.ledger.putJson(diff);
      const baseline = ctx.ledger.getJson<TestRun>(baselineSha);
      // how every test stood when this task started: the run of the task before it, or of the locked tests on the code before any task
      const beforeSha = (inputs.prevDone as string[]).length ? outputOf(ctx.state, (inputs.prevDone as string[]).at(-1)!, "testRun") : outputOf(ctx.state, "author-tests", "run2");
      const before = beforeSha ? ctx.ledger.getJson<TestRun>(beforeSha) : undefined;
      const failed = (g: NonNullable<Awaited<ReturnType<typeof gateAll>>>, now?: TestRun) => {
        const layers = failsForLayers(plan, spec, lock.tests, task.id, g.lockedFailedIds ?? []);
        // nothing else is wrong and each of them fails exactly as it did before this task: they move on now, with no second attempt
        // (not a task that writes a route or page itself: it could have reached them, so it gets its retry)
        const untouched = layers && !!now && !writesEntry(task.fileScope, ctx.project.stack) && g.failures.every((f) => LOCKED_CHECKS.has(f.check)) && failsAsBefore(before, now, g.lockedFailedIds ?? []);
        return { kind: "fail" as const, category: g.category, failures: g.failures.slice(0, 20), signature: failureSignature(g.failures.map((f) => `${f.check}:${f.testId ?? f.message}`)), diffSha: sha256(JSON.stringify(diff.files)), lockedFailedIds: g.lockedFailedIds, data: { ...retry, commit, ...(untouched ? { untouched: true } : {}) },
          // its own tests cannot pass before a later task is done: the same failure twice moves them there instead of parking the run
          ...(layers ? { deferrable: true } : {}), ...(untouched ? { deferNow: true } : {}) };
      };
      // 1. the diff checks first: a change that touches locked tests, protected files or secrets never gets run
      const diffGated = await gateAll(ctx, key, commit, [
        [lockSetUnchanged, { diff: diffSha, tests: lockSha }],
        [configIntegrity, { diff: diffSha, plan: ctx.state.steps.get("plan")!.outputs[0]! }],
        [packagesPlanned, { packages: ctx.ledger.putJson(await packageChangesOf(wt, diff)), plan: ctx.state.steps.get("plan")!.outputs[0]! }],
        [noSecrets, { scan: ctx.ledger.putJson(secretScanOf(diff, commit)) }],
        [diffInScope, { diff: diffSha, task: ctx.ledger.putJson({ fileScope }) }],
        [noEscapeHatches, { diff: diffSha }],
        // a task that changes UI files also passes the token and component lint (design.fidelity-lint),
        // but only in a project that set up its front end (a `design` block): elsewhere the lint has nothing reliable to check against
        ...(ctx.project.design && touchesUiFiles(wt, start, commit) ? [[designFidelityLint, { lint: ctx.ledger.putJson(fidelityLint(wt, start, commit, designOptions(ctx.project.design))) }] as [GateDef, Record<string, string>]] : []),
      ]);
      if (diffGated) return failed(diffGated);
      // 2. only then build and run the tests on that exact commit
      const produced = await produce(ctx, `${key}/${ctx.attempt}`, commit, "task", {
        // must pass: this task's own criteria, earlier tasks' criteria and the characterisation tests (behaviour that must not change)
        expectPass: [...myTests.map((t) => t.testId), ...earlier.keys(), ...lock.characterisation.map((c) => c.testId)],
        expectFail: [], compareToBaseline: baseline.results.map((b) => b.id),
      });
      const run = storeRun(ctx, produced);
      // a failed build marks every expected test "Build failed": that's the build, not a regression
      const gated = await gateAll(ctx, key, commit, [[testExpectations, { run: run.testRun, baseline: baselineSha }], ...(produced.build.ok ? [...contractGate(ctx, wt, commit, true), ...dataModelGate(ctx, wt, commit, true)] : [])], produced.build.ok ? earlier : undefined);
      if (gated) {
        if (!produced.build.ok) {
          gated.failures.unshift(...produced.build.errors.slice(0, 10).map((e) => failure("build", `${e.file}:${e.line} ${e.code} ${e.msg}`)));
          // the tests never ran, so two broken builds aren't "the same locked test failed twice"
          gated.lockedFailedIds = [];
          if (gated.category === "locked-test") gated.category = "other";
        }
        return failed(gated, produced.build.ok ? produced.testRun : undefined);
      }
      return { kind: "done", outputs: { diff: diffSha, testRun: run.testRun }, treeSha: commit, data: { commit, ...retry, ...(task.estimateTaskId ? { estimateTaskId: task.estimateTaskId } : {}) } };
    },
  };
}

// ---------- the locked API contract ----------
/** What an agent is told about the contract: the API side follows it, the web side calls it through the generated client. */
/** The approved data model for whoever writes backend code or its tests: the tables, columns and keys the database must have. */
function dataModelNote(project: ProjectConfig, wt: string, who: "tests" | "code", keepsDatabase = false): ReturnType<typeof S.template>[] {
  // a plan with no data model on an existing backend: nothing to paste, one line on what is checked
  if (project.stack !== "node" && !existsSync(join(wt, DATA_MODEL_FILE)) && keepsDatabase && who === "code") return [S.template("data-model", "STORED DATA. This plan changes no stored data. After the build the factory starts the app and compares the database it creates with the one the code created before this run: do not add, drop or rename a table, and do not change a primary key, foreign key, unique key or whether a column may be empty.")];
  if (project.stack === "node" || !existsSync(join(wt, DATA_MODEL_FILE))) return [];
  const doc = readFileSync(join(wt, DATA_MODEL_FILE), "utf8");
  return [S.template("data-model", `DATA MODEL (approved and locked: ${DATA_MODEL_FILE}). ${who === "code"
    ? `The database the code creates must have exactly these tables, primary keys, foreign keys and unique keys, with these table and column names; it is compared with this file after the build. Do not rename a table or column, drop a key, or add a table. A column of your own for bookkeeping is allowed. ${project.database ? "The factory starts the app on an empty PostgreSQL database and reads the tables it creates there" : "The factory starts the app with no network and reads the SQLite file it creates"}, so the database must come whole from the code: created when the app starts (EnsureCreated or Migrate in startup), or, where the repo keeps EF Core migrations, by a migration added for every change (the factory runs them when starting the app creates nothing).`
    : "The stored data has these tables and keys. Do not test the database's shape (the factory checks it); use the model to set up data for a test."} Never edit the file.\n\n${doc}`)];
}

function contractNote(project: ProjectConfig, wt: string, who: "tests" | "code"): ReturnType<typeof S.template>[] {
  const c = project.contract;
  if (!c || !existsSync(join(wt, c.file))) return [];
  if (project.stack === "node") return [S.template("contract", `API CONTRACT (locked: ${c.file}). The app talks to the API only through the generated client in ${CLIENT_DIR}/client.ts; never write fetch calls or response types by hand, and never edit ${CLIENT_DIR} or ${c.file}. ${who === "tests" ? `Tests that need the API start the generated handlers from ${CLIENT_DIR}/client.msw.ts with msw's setupServer (msw/node); they answer with the contract's examples, so assert on that data.` : "The tests run against handlers generated from the same contract, so use its field names exactly."}`)];
  // a small contract is pasted; a big one is read from the checkout (it would take most of the briefing's budget)
  const doc = readFileSync(join(wt, c.file), "utf8");
  return [S.template("contract", `API CONTRACT (locked: ${c.file}). The API must answer exactly as this OpenAPI document says: its paths, methods, status codes and JSON field names and types. After every build the factory compares the API's own OpenAPI document with it, so declare each status code on its route (Produces) and keep the project's OpenAPI build settings. Never edit ${c.file}.${doc.length > FILE_INLINE_MAX ? ` Read ${c.file} in the checkout before you write anything: it is not pasted here.` : `\n\n${doc}`}`)];
}

/** Where the lab keeps the OpenAPI document the build of `commit` wrote, for a .NET API held to a contract (the project's `contract.built`). */
function builtContractFile(ctx: StepContext, wt: string, commit: string): string | undefined {
  const c = ctx.project.contract;
  if (!c?.built || ctx.project.stack !== "dotnet" || !existsSync(join(wt, c.file))) return undefined;
  return join(buildCachePath(join(factoryHome(), "tmp", ctx.runId, "builds"), commit, ctx.project), c.built);
}

/**
 * The contract gate: the API's own document, written by the build of this commit, against the locked contract. A task checks
 * what it has built so far (`partial`: other tasks' operations may still be missing); integrate checks the whole contract.
 */
function contractGate(ctx: StepContext, wt: string, commit: string, partial: boolean): [GateDef, Record<string, string>][] {
  const file = builtContractFile(ctx, wt, commit);
  if (!file) return [];
  const c = ctx.project.contract!;
  return [[contractMatches, { contract: ctx.ledger.putJson({ text: readFileSync(join(wt, c.file), "utf8") }), built: ctx.ledger.putJson({ path: c.built, ...(partial ? { partial } : {}), ...(existsSync(file) ? { text: readFileSync(file, "utf8") } : {}) }) }]];
}

/**
 * The data model gate: what the database of this commit's build has (the lab starts the app once and reads it), against the
 * approved model. A task checks that what exists so far is not wrong; integrate checks the whole model. Columns the model does
 * not name pass and are logged.
 */
const builtSchemaFile = (ctx: StepContext, commit: string) => join(buildCachePath(join(factoryHome(), "tmp", ctx.runId, "builds"), commit, ctx.project), BUILT_SCHEMA_FILE);
const schemaBeforeFile = (ctx: StepContext) => join(factoryHome(), "tmp", ctx.runId, "schema-before.json");
const readSchema = (file: string): BuiltSchema | undefined => { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as BuiltSchema : undefined; } catch { return undefined; } };

/**
 * The first lab run of the tests commit starts the code as it was before this run (plus the stubs): what its database has is
 * what the backend had already. Kept for the data model gate, which then holds the run only to tables the run itself made.
 */
function keepSchemaBefore(ctx: StepContext, commit: string): void {
  const kept = readSchema(builtSchemaFile(ctx, commit));
  if (kept) writeFileSync(schemaBeforeFile(ctx), JSON.stringify(kept));
}

/** The database the untouched code creates, as discover read it: set for an existing backend whose database could be read. */
function databaseBefore(ctx: StepContext): DataModel | undefined {
  if (ctx.project.stack !== "dotnet") return undefined;
  const m = DataModel.safeParse(readOutput<BuiltSchema>(ctx.state, ctx.ledger, "discover", "schema")?.model);
  return m.success ? m.data : undefined;
}

function dataModelGate(ctx: StepContext, wt: string, commit: string, partial: boolean): [GateDef, Record<string, string>][] {
  if (ctx.project.stack !== "dotnet") return [];
  // no approved model (the plan changes no stored data, and the repo never had one): the database is held to what it was before the run
  const kept = existsSync(join(wt, DATA_MODEL_FILE)) ? undefined : databaseBefore(ctx);
  if (!existsSync(join(wt, DATA_MODEL_FILE)) && !kept) return [];
  const built: BuiltSchema & { before?: string[]; noDatabaseBefore?: boolean; asBefore?: boolean } = readSchema(builtSchemaFile(ctx, commit)) ?? { note: "the lab kept no schema for this build" };
  // what was there before the run: the untouched code's database as discover read it, else the first tests-commit build's
  const was = readOutput<BuiltSchema>(ctx.state, ctx.ledger, "discover", "schema") ?? readSchema(schemaBeforeFile(ctx));
  if (was?.model) built.before = was.model.tables.map((t) => t.name);
  else if (was?.empty) built.before = [];
  else if (was) built.noDatabaseBefore = true;
  const text = kept ? dataModelYaml(kept) : readFileSync(join(wt, DATA_MODEL_FILE), "utf8");
  if (kept) built.asBefore = true;
  if (built.model && !kept) {
    try {
      const extra = dataModelDiff(DataModel.parse(parse(text)), DataModel.parse(built.model)).extra;
      if (extra.length) ctx.log(`data model: ${extra.length} column(s) the model does not name (allowed): ${extra.slice(0, 8).join("; ")}`);
    } catch { /* the gate reports a model that does not parse */ }
  }
  return [[dataModelMatches, { model: ctx.ledger.putJson({ text }), built: ctx.ledger.putJson({ ...built, ...(partial ? { partial } : {}) }) }]];
}

// ---------- integrate (D) ----------
/**
 * A task's test run can stand in for integrate's own when it judged the same commit, was valid, and
 * already required everything integrate requires: every locked and characterisation test passing and
 * no new failure against the whole baseline. Then a second build and full suite on that commit adds nothing.
 */
export function coversIntegrate(run: Pick<TestRun, "treeSha" | "valid" | "expectPass" | "compareToBaseline">, head: string, expectPass: string[], compareToBaseline: string[]): boolean {
  if (!run.valid || run.treeSha !== head) return false;
  const pass = new Set(run.expectPass), compared = new Set(run.compareToBaseline);
  return expectPass.every((id) => pass.has(id)) && compareToBaseline.every((id) => compared.has(id));
}

/** The completed task step whose commit is `head` and whose test run covers integrate's expectations. */
function reusableTaskRun(ctx: StepContext, head: string, expectPass: string[], compareToBaseline: string[]): { step: string; testRun: string } | undefined {
  for (const r of ctx.state.steps.values()) {
    if (!r.step.startsWith("implement/") || r.status !== "completed" || String(r.data?.commit) !== head) continue;
    const sha = outputOf(ctx.state, r.step, "testRun");
    if (sha && coversIntegrate(ctx.ledger.getJson<TestRun>(sha), head, expectPass, compareToBaseline)) return { step: r.step, testRun: sha };
  }
  return undefined;
}

export const integrateStep: StepDef = {
  key: "integrate", stage: "integrate", templateVersion: "1", coding: true,
  inputs: (s) => {
    const plan = s.steps.get("plan");
    if (plan?.status !== "completed") return undefined;
    const tasks = [...s.steps.values()].filter((r) => r.step.startsWith("implement/"));
    const taskCount = (s.steps.get("plan")!.data?.taskCount as number | undefined);
    if (!tasks.length || tasks.some((t) => t.status !== "completed") || (taskCount && tasks.length < taskCount)) return undefined;
    return { head: tasks[tasks.length - 1]!.data?.commit, tests: s.steps.get("author-tests")!.outputs[0] };
  },
  async run(ctx) {
    const { lock, sha: lockSha } = lockOf(ctx.state, ctx.ledger);
    const baselineSha = ctx.state.steps.get("discover")!.outputs[0]!;
    const baseline = ctx.ledger.getJson<TestRun>(baselineSha);
    const head = String(integrateStep.inputs(ctx.state, ctx.ledger)!.head);
    const wt = await ensureWorktree(ctx, head);
    // greenfield: measured from the scaffold commit, the app the factory generated is not the agents' change; else from the code base
    const diff = await diffSummary(wt, changeBase(ctx.state), head, lock);
    const diffSha = ctx.ledger.putJson(diff);
    const expectPass = [...lock.tests.map((t) => t.testId), ...lock.characterisation.map((c) => c.testId)];
    const compareToBaseline = baseline.results.map((b) => b.id);
    // the last task usually tested this exact commit with the full suite already: reuse that run
    // (a contract check needs the document this commit's build wrote: if the lab no longer keeps that build, build again)
    const builtDoc = builtContractFile(ctx, wt, head);
    const reused = builtDoc && !existsSync(builtDoc) ? undefined : reusableTaskRun(ctx, head, expectPass, compareToBaseline);
    let testRun: string;
    if (reused) {
      testRun = reused.testRun;
      ctx.log(`integrate: ${reused.step} already ran the full suite on ${head.slice(0, 10)} with every locked test; reusing its run`);
    } else {
      testRun = storeRun(ctx, await produce(ctx, "integrate", head, "integrate", { expectPass, expectFail: [], compareToBaseline })).testRun;
    }
    // the UI change as built, next to the size class the approved design allowed (both recorded, so estimates can be read against builds)
    const dRef = approvedDesignFor(ctx.state, ctx.ledger)?.sha;
    const uiFrom = uiBase(ctx.state);
    const uiActual = dRef && touchesUiFiles(wt, uiFrom, head) ? actualSize(wt, uiFrom, head, designOptions(ctx.project.design)) : undefined;
    const uiApproved = dRef ? approvedLevel(ctx.ledger.getJson(dRef)) : undefined;
    const gated = await gateAll(ctx, "integrate", head, [
      [testExpectations, { run: testRun, baseline: baselineSha }],
      [lockSetUnchanged, { diff: diffSha, tests: lockSha }],
      // the whole API says what the locked contract says
      ...contractGate(ctx, wt, head, false),
      // the database the app creates has the approved tables, keys and relations
      ...dataModelGate(ctx, wt, head, false),
      // design.size-cap: the UI change may not be bigger than the approved design allows (a skipped design allows none)
      ...(uiActual
        ? [[designSizeCap, {
          actual: ctx.ledger.putJson(uiActual),
          approved: ctx.ledger.putJson({ level: uiApproved }),
        }] as [GateDef, Record<string, string>]] : []),
    ]);
    if (gated) return { kind: "park", reason: `Integration failed: ${gated.failures.slice(0, 3).map((f) => f.message).join("; ")}` };
    let waivers: Omit<WaiverRow, "step">[] = [];
    // the change-size limit is a person's to waive (its gate says so): a card for this commit, not a park that no resume gets past
    const size = await runGate(diffSize, ctx.ledger, ctx.writer, { diff: diffSha }, ctx.policy, { step: "integrate", treeSha: head });
    if (!size.passed) {
      const w = buildWaiver(ctx, "integrate", [{ def: diffSize, failures: size.failures ?? [failure(diffSize.id, size.details)] }], head,
        `Every other integration check passed on this commit. To stop instead: factory stop ${ctx.runId}`);
      if (w.kind === "ask") return w.outcome;
      waivers = w.waivers;
    }
    // B3: a run that follows an approved estimate may not grow past the size that was approved; a lead can waive it for this commit
    const ref = ctx.state.info.estimateRef;
    if (ref) {
      const b3 = await runGate(sizeCap, ctx.ledger, ctx.writer, { diff: diffSha, estimate: ref.estimateSha }, ctx.policy, { step: "integrate", treeSha: head });
      if (!b3.passed) {
        const w = buildWaiver(ctx, "integrate", [{ def: sizeCap, failures: b3.failures ?? [failure(sizeCap.id, b3.details)] }], head,
          `To stop and change the request instead: factory estimate --revises ${ref.runId}, then build that estimate.`);
        if (w.kind === "ask") return w.outcome;
        waivers = [...waivers, ...w.waivers];
      }
    }
    return { kind: "done", outputs: { testRun, diff: diffSha }, treeSha: head, data: { commit: head, ...(reused ? { reusedRunFrom: reused.step } : {}), ...(uiApproved ? { uiSize: { approved: uiApproved, actual: uiActual?.level ?? "none" } } : {}), ...(waivers.length ? { waivers } : {}) } };
  },
};

/**
 * A web app that is the client of a contract serves none of the contract's endpoints: the API does. A probe sent to it can
 * only answer 404 (run 0f9d parked at accept on five of them, with every locked test passing).
 */
export const apiElsewhere = (project: { stack: string; contract?: unknown }): boolean => project.stack === "node" && !!project.contract;

// ---------- accept (D, no model) ----------
// Boot the app next to the test Postgres, send the locked HTTP probes, re-run the locked criteria tests;
// every criterion gets evidence of its kind (verify-runner §2.8, minimal: no login/identities yet).
export const acceptStep: StepDef = {
  key: "accept", stage: "accept", templateVersion: "2",
  inputs: (s) => (s.steps.get("integrate")?.status === "completed" ? { integrate: s.steps.get("integrate")!.outputs[0], head: s.steps.get("integrate")!.data?.commit } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const { lock } = lockOf(ctx.state, ctx.ledger);
    const head = String(ctx.state.steps.get("integrate")!.data!.commit);
    const locked = lock.probes ?? [];
    const probes = apiElsewhere(ctx.project) ? [] : locked;
    if (locked.length && !probes.length) ctx.log(`accept: ${locked.length} probe(s) not sent: the endpoints are served by the API (${ctx.project.contract!.apiUrl}), not by this app; the locked tests are the evidence`);
    ctx.log(`accept: booting the app and sending ${probes.length} probe(s)`);
    const out = await produce(ctx, "accept", head, "accept", { expectPass: lock.tests.map((t) => t.testId), expectFail: [], compareToBaseline: [] },
      lock.tests.map((t) => t.testId), undefined, { probes });
    const runSha = storeRun(ctx, out).testRun;
    const acc = out.accept ?? { boot: { attempted: false, ok: false, note: "not run", logTail: "" }, probes: [] };
    const bootLog = ctx.ledger.putArtifact(acc.boot.logTail);
    const passed = new Set(out.testRun.results.filter((r) => r.outcome === "passed" && !r.flaky).map((r) => r.id));
    const items = spec.requirements.flatMap((r) => r.acceptance.map((a) => {
      const tests = lock.tests.filter((t) => t.acId === a.id);
      const http = acc.probes.filter((p) => p.acId === a.id).map((p) => ({
        method: p.method, path: p.path, status: p.status, expectStatus: p.expectStatus,
        requestSha: p.requestBody !== undefined ? ctx.ledger.putArtifact(p.requestBody) : undefined,
        bodySha: ctx.ledger.putArtifact(p.responseBody),
      }));
      // unit criteria have a locked test and no probe: "test", never "http"
      const kind = a.level === "manual" ? "manual" : a.level === "ui" ? "ui" : a.level === "job" ? "job" : a.level === "unit" ? "test" : "http";
      const testsOk = tests.length > 0 && tests.every((t) => passed.has(t.testId));
      const probesOk = http.every((h) => h.status === h.expectStatus);
      return { ac: a.id, kind, testIds: tests.map((t) => t.testId), http, passed: kind === "manual" ? false : testsOk && probesOk };
    }));
    const evidence = {
      header: header(ctx.runId, "acceptance-evidence", "accept", ""), items,
      app: { ...acc.boot, logTail: undefined, logSha: bootLog },
      testRun: runSha,
      limits: "Probes cover only endpoints without login (test users/tokens aren't built yet).",
    };
    const sha = ctx.ledger.putJson(evidence);
    const problems = [
      ...(acc.boot.attempted && !acc.boot.ok ? [`the app didn't start: ${acc.boot.note ?? ""}`] : []),
      ...items.filter((i) => i.kind !== "manual" && !i.passed).map((i) => `${i.ac}: ${i.testIds.length ? "" : "no locked test; "}${i.http.filter((h) => h.status !== h.expectStatus).map((h) => `${h.method} ${h.path} answered ${h.status}, expected ${h.expectStatus}`).join("; ") || "locked test didn't pass"}`),
    ];
    if (problems.length) return { kind: "park", reason: `Acceptance evidence is missing: ${problems.join(" | ")}` };
    return { kind: "done", outputs: { evidence: sha, testRun: runSha }, data: { appStarted: acc.boot.ok, probes: acc.probes.length, manualPending: items.filter((i) => i.kind === "manual").map((i) => i.ac) } };
  },
};
