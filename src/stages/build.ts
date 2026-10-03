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
import { failureSignature } from "../gates/ladder.js";
import { changedFiles, commitAll, diffIncludingUntracked, git, headSha, repoRefusals, resetHard } from "../ledger/git.js";
import { ClaudeAgentRunner, type AgentProgress } from "../runners/claude-agent.js";
import { ensureAgentImage, ensureEgress, feedHostsFrom } from "../runners/netinfra.js";
import { buildPack } from "../context/pack.js";
import { Redactor } from "../context/secrets.js";
import { sha256 } from "../util/hash.js";
import { factoryHome } from "../util/paths.js";
import { produceDotnetTests, skippableKnownFailures, type Probe, type ProduceOutput } from "../verify/dotnet.js";
import type { ProjectConfig } from "../config/project.js";
import { installNodeModules, labFor } from "../verify/lab.js";
import { authorIntro, implementIntro, notFoundHint } from "./stack-text.js";
import type { Expectations } from "../verify/validate.js";
import { approvedDesignFor } from "./design-inputs.js";
import { header, outputOf, readOutput, requireOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { modelFor } from "./routing.js";
import { family } from "../runners/types.js";
import { S } from "./think.js";
import { ensureWorktree, runtime, snapshotFor, uiBase } from "./workspace.js";
import { replay, splitKey } from "../ledger/state.js";
import { REPO_DESIGN_DIR, repoFiles, type DesignPackage } from "../design/package.js";
import { exportRunPackage } from "./design-export.js";
import { stepBudgetUsd } from "../ledger/caps.js";
import { LANE, lightBuild, testWriterTurns } from "./lane.js";
import { lessonPointers, readLessons, usableLessons } from "../context/lessons.js";
import { sizeCap } from "../estimate/gates.js";
import { buildWaiver } from "../estimate/build-waiver.js";
import type { WaiverRow } from "../estimate/log.js";
import { designFidelityLint, designSizeCap } from "../design/gates.js";
import { screenBrief, screenFacts, screenFor, screensBrief, screensForTask, type ApprovedDesign } from "../design/design-link.js";
import { scaffoldSummary, writeScaffold } from "../design/kit/index.js";
import { scaffoldOfRun, type ScaffoldRecord } from "./scaffold-run.js";
import { repoIsEmpty } from "../config/greenfield.js";
import { actualSize, approvedLevel, designOptions, fidelityLint, hasReactApp, touchesUiFiles } from "../design/build-checks.js";
import { buildInventory, inventorySummary } from "../design/inventory.js";
import { dirSource } from "../design/source.js";

type Plan = z.infer<typeof PlanBody> & { complexity: string };
type Intent = z.infer<typeof IntentBody>;

const LIGHT_TEST_WRITER = "claude-sonnet-5";

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

async function produce(ctx: StepContext, key: string, commit: string, stage: TestRun["stage"], exp: Expectations, onlyTests?: string[], filterExpr?: string, accept?: { probes: Probe[] }, resolveExp?: (results: TestResult[]) => Expectations): Promise<ProduceOutput> {
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
    skipTests,
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
function agentTracer(ctx: StepContext, who: string) {
  return (p: AgentProgress) => {
    if (p.kind === "tool") ctx.trace.event("agent.tool", `${who}: ${p.tool} ${p.target ?? ""}`);
    else if (p.kind === "turn") ctx.trace.event("agent.turn", `${who}: turn  in ${p.in ?? 0} out ${p.out ?? 0}${p.text ? `  "${p.text}"` : ""}`);
    else if (p.kind === "start") ctx.trace.event("agent.start", `${who}: agent started (${p.model ?? "?"})`);
    else if (p.kind === "end") ctx.trace.event("agent.end", `${who}: agent finished: ${p.status} after ${p.turns ?? "?"} turns, $${(p.costUsd ?? 0).toFixed(3)}`);
  };
}

/**
 * The coding container reads restored packages from the run's package folder (read-only, no network).
 * If discover reused a cached baseline, nothing restored them yet for this run: do it now.
 */
async function ensurePackages(ctx: StepContext, commit: string, wt: string): Promise<void> {
  if (ctx.project.stack === "node") {
    // a Node checkout gets its node_modules installed in place, before each agent (a reset or clean removes them)
    if (existsSync(join(wt, "node_modules")) || !existsSync(join(wt, "package.json"))) return;
    ctx.log("installing the app's packages for the coding container");
    const r = await installNodeModules(runtime(), {
      runId: ctx.runId, key: "restore", dir: wt, cache: packagesDir(ctx.runId, "node"), image: ctx.project.node.image, timeoutSec: ctx.project.node.buildTimeoutSec,
      onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key: "restore", data: { id, role: "restore" } }, ctx.writer); },
      onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "restore", data: { id } }, ctx.writer); },
    });
    if (!r.ok) throw new Error(`npm install failed: ${r.log.split("\n").filter(Boolean).slice(-5).join(" ")}`);
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
    if (repoIsEmpty(repo, ctx.state.info.baseCommit!)) {
      // an empty repo (a new product): nothing to build or test yet; the scaffold commit writes the app
      baseline = { kind: "test", treeSha: ctx.state.info.baseCommit!, stage: "baseline", runner: ctx.project.stack === "node" ? "vitest" : "vstest", toolVersions: {}, expectPass: [], expectFail: [], compareToBaseline: [], discovered: [], results: [], exitCode: 0, reportShas: [], valid: true, classification: "ok" };
      ctx.log("baseline: the repo is empty (a new product), nothing to build or test yet");
    } else if (existsSync(cacheFile)) {
      baseline = JSON.parse(readFileSync(cacheFile, "utf8")) as TestRun;
      ctx.log("baseline: reusing the recorded run for this commit");
    } else {
      ctx.log("baseline: building and testing the untouched repo (first time is slow)");
      const out = await produce(ctx, "discover", ctx.state.info.baseCommit!, "baseline", { expectPass: [], expectFail: [], compareToBaseline: [] });
      if (!out.build.ok) return { kind: "park", reason: `The untouched repo doesn't build in the test lab: ${out.build.errors.slice(0, 3).map((e) => `${e.file ? `${e.file}:${e.line} ` : ""}${e.code === "RESTORE" ? "" : `${e.code} `}${e.msg}`).join("; ") || "see restore/build log"}` };
      baseline = out.testRun;
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(baseline));
    }
    const failed = baseline.results.filter((r) => r.outcome === "failed").length;
    const sha = ctx.ledger.putJson(baseline);
    ctx.log(`baseline: ${baseline.results.length} tests, ${failed} failing before any change`);
    // A repo with a React or Next.js front end also gets its design inventory, as a second named output. The
    // snapshot excludes noGo paths, so a front end under one is left out. Best effort: it never stops discover.
    const outputs: Record<string, string> = { baseline: sha };
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

export const stubCommitStep: StepDef = {
  key: "stub-commit", stage: "stub-commit", templateVersion: "1",
  // (the design package is an input only when this run wrote one, so runs from before packages keep their hash)
  inputs: (s) => (s.steps.get("approve")?.status === "completed" ? { plan: s.steps.get("plan")!.outputs[0], approval: s.steps.get("approve")!.outputs[0], ...(outputOf(s, "design-export") ? { design: outputOf(s, "design-export") } : {}) } : undefined),
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
      const scaffoldCommit = written.length ? await commitAll(wt, `factory: scaffold ${l.target} (kit ${l.kit.id} ${l.kit.version}) for ${ctx.runId}`) : undefined;
      scaffoldRec = { target: scaf.target, source: scaf.source, why: scaf.detected.why, kit: l.kit, root: l.root, fresh: l.fresh, written, kept: l.kept, protected: l.protected, screens: l.screens, removed: l.removed, designSystem: l.designSystem, notes: l.notes, summary: scaffoldSummary(l), ...(scaf.changed ? { changed: scaf.changed } : {}), ...(scaffoldCommit ? { commit: scaffoldCommit } : {}) };
      ctx.log(`stub-commit: scaffold ${l.target}: ${written.length} files written${l.kept.length ? `, ${l.kept.length} kept (the repo's own)` : ""}`);
    } else if (scaf) ctx.log(`stub-commit: UI target ${scaf.target} (${scaf.source}; ${scaf.detected.why}): no scaffold, the screens are built with the repo's own components`);
    for (const s of plan.stubs) {
      mkdirSync(dirname(join(wt, s.path)), { recursive: true });
      writeFileSync(join(wt, s.path), s.content);
    }
    const commit = plan.stubs.length ? await commitAll(wt, `factory: interface stubs for ${ctx.runId}`) : await headSha(wt);
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

export const authorTestsStep: StepDef = {
  key: "author-tests", stage: "author-tests", templateVersion: "3", coding: true,
  inputs: (s) => (s.steps.get("stub-commit")?.status === "completed" ? { stubs: s.steps.get("stub-commit")!.outputs[0], spec: s.steps.get("specify")!.outputs[0] } : undefined),
  async run(ctx) {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const plan = requireOutput<Plan>(ctx.state, ctx.ledger, "plan");
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    const light = lightBuild(intent, plan.complexity);
    const start = String(ctx.state.steps.get("stub-commit")!.data!.commit);
    const wt = await ensureWorktree(ctx, start);
    await resetHard(wt, start);
    const routed = modelFor(ctx.project, "author-tests", ctx.rung);
    // light lane: Sonnet writes the few small tests; Opus stays for bigger work, on escalation, or when the project routes it
    const model = light && !ctx.project.steps["author-tests"] && ctx.rung < 2 ? LIGHT_TEST_WRITER : routed.model;
    const { effort } = routed;
    const rt = runtime();
    await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
    await ensureAgentImage(rt, ctx.project.dotnet.sdkImage);
    await ensurePackages(ctx, start, wt);
    // what earlier runs on this repo learned about where tests go (only if those files still exist here)
    const lessons = usableLessons(readLessons(ctx.project.project), wt);
    if (lessons.length) ctx.log(`author-tests: pointing the test writer at ${lessons.map((l) => l.dir).join(", ")} (from earlier runs)`);
    // "already passes" is no longer a failure when the requirement has a failing test: don't push the writer to break a correct test
    const priorFailures = ctx.priorFailures.filter((f) => f.check !== "passes-on-base");
        // The test author sees ACs, stub signatures and harness rules. Never the plan's approach.
    const acs = spec.requirements.flatMap((r) => r.acceptance.map((a) => ({ req: r.id, ...a })));
    // the approved screens behind these criteria: what the person approved is what the tests expect (PR #11 review, item 13)
    const screens = screenFacts(approvedDesignFor<ApprovedDesign>(ctx.state, ctx.ledger)?.design, [...new Set(acs.map((a) => a.req))]);
    const pack = buildPack({
      stage: "author-tests", cls: "agent", model, recipeVersion: "1", tools: [], redactor: new Redactor(),
      sections: [
        S.template("tpl", authorIntro(ctx.project.stack)),
        ...(light ? [S.template("light", `This is a small, low-risk change. Keep the tests small:
- Write the fewest tests that prove each criterion: usually one test method per criterion, in one new test file next to the existing tests for the class.
- At most ${LANE.light.maxCharacterisation} characterisation tests, as small unit tests of the same class. They must pass on today's code without any external service or seeded data. Skip them if the criteria already cover the unchanged behaviour.
- Compile at most once, at the end.`)] : []),
        S.template("tpl-end", `
- For each "api" criterion whose endpoint needs NO login, also give one HTTP probe: method, path, optional JSON body, and the status code the criterion expects once implemented. The factory sends it to the running app (with an empty test database) as evidence. Skip criteria that need a login or seeded data.
Return the list of tests you wrote (acId, file, method name) and the probes.`),
        ...(anchorFiles(spec).length || lessons.length ? [S.pointers([...anchorFiles(spec).map((p) => ({ path: p, reason: "the code these criteria are about" })), ...lessonPointers(lessons)])] : []),
        S.artifact("acs", "acceptance-criteria", acs),
        ...(screens.length ? [S.artifact("approved-screens", "approved-screens", screens), S.template("approved-screens-rules", `The approved-screens section lists the screens a person approved for these requirements: route, states, and the exact words on them (title, buttons, field labels, column headers, empty, error, success and validation messages, toasts; "change" for a design note). Where a criterion is about what the user sees or is told, take the expected values from there, word for word, and do not invent other wording. A criterion with no screen there is tested as before.`)] : []),
        S.artifact("stubs", "stubs", plan.stubs.map((s) => ({ path: s.path, content: s.content }))),
        ...(priorFailures.length ? [{ spec: { id: "failures", source: "feedback" as const, trust: "derived" as const, placement: "user" as const }, content: "Your previous attempt was rejected:\n" + priorFailures.slice(0, 20).map((f) => `- [${f.check}] ${f.message}`).join("\n") }] : []),
        S.task(`Write the acceptance and characterisation tests now.${priorFailures.length ? " The previous attempt failed for the reasons above; fix them." : ""}`),
        S.recap(["one test per AC", "tests fail now for the right reason", "characterisation tests pass today", "don't touch production code"]),
      ],
    });
    const r = await new ClaudeAgentRunner(rt, {
      runId: ctx.runId, key: `author-tests/${ctx.attempt}`, fileScope: TEST_SCOPE, lockedFiles: [], extraProtected: [], onProgress: agentTracer(ctx, "test writer"),
      protectedGlobs: CONFIG_INTEGRITY_GLOBS, ...(ctx.project.stack === "node" ? {} : { packagesDir: packagesDir(ctx.runId) }), agentEnv: ctx.project.agentEnv, noGo: ctx.project.noGo,
      onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key: "author-tests", data: { id, role: "agent" } }, ctx.writer); },
      onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key: "author-tests", data: { id } }, ctx.writer); },
    }).run({ step: "author-tests", model, effort, pack, schema: AuthorOut, limits: { maxTurns: testWriterTurns(light, acs.filter((a) => a.level !== "manual").map((a) => a.level)), maxUsd: stepBudgetUsd(replay(ctx.ledger.events()), 4), timeoutSec: 45 * 60 }, workdir: wt });
    await ctx.usage({ model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite, turns: r.usage.turns, wallMs: r.usage.wallMs, estUsd: r.usage.estUsd });
    if (r.status === "config-error") return { kind: "park", reason: r.error ?? "The API rejected the coding agent's request" };
    if (r.status !== "ok") return { kind: "fail", category: r.status === "rate-limited" ? "rate-limit" : "other", failures: [failure(`agent-${r.status}`, r.error ?? r.status)], signature: `author-tests:${r.status}` };
    const out = r.output as z.infer<typeof AuthorOut>;

    const commit = await commitAll(wt, `factory: acceptance tests for ${ctx.runId}`);
    const changed = await changedFiles(wt, start, commit);
    const notTests = changed.filter((c) => !matchesAny(c.path, TEST_SCOPE));
    if (notTests.length) return { kind: "fail", category: "safety", failures: notTests.map((c) => failure("author-tests-scope", `Test author changed a non-test file: ${c.path}`)), signature: "author-tests:scope" };
    const tampered = testWriterTampering(await Promise.all(changed.map(async (c) => {
      const patch = c.status === "D" ? "" : (await git(wt, ["diff", "--no-color", "-U0", start, commit, "--", c.path])).stdout;
      return { ...c, ...patchLines(patch) };
    })));
    if (tampered.length) return { kind: "fail", category: "safety", failures: tampered, signature: "author-tests:tamper" };
    const missingAc = acs.filter((a) => a.level !== "manual" && !out.tests.some((t) => t.acId === a.id));
    if (missingAc.length) return { kind: "fail", category: "other", failures: missingAc.map((a) => failure("ac-coverage", `No test for ${a.id}`)), signature: "author-tests:coverage" };

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
    if (!found.build.ok || missing.length) {
      await resetHard(wt, start);
      const why = !found.build.ok
        ? found.build.errors.slice(0, 10).map((e) => failure("tests-compile", `${e.file}:${e.line} ${e.code} ${e.msg}`))
        : missing.map((n) => failure("test-not-found", `No test method named ${n} ran. ${notFoundHint(ctx.project.stack)}`));
      return { kind: "fail", category: "other", failures: why, signature: `author-tests:${!found.build.ok ? "compile" : "not-found"}` };
    }
    const run1 = storeRun(ctx, found);
    const only = [...tests.map((t) => t.testId), ...characterisation.map((c) => c.testId)];
    ctx.log("author-tests: running the new tests on the old code again (2 of 2)");
    const run2 = storeRun(ctx, await produce(ctx, "author-tests/base-2", commit, "author-tests-on-base", exp, only));
    const acIds = new Set(acs.filter((a) => a.level === "api").map((a) => a.id));
    const lock: Lock = {
      tests, characterisation, probes: out.probes.filter((p) => acIds.has(p.acId)),
      lock: changed.filter((c) => c.status !== "D").map((c) => ({ file: c.path, sha: sha256(readFileSync(join(wt, c.path))) })),
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
    if (!g.passed) {
      await resetHard(wt, start);
      return { kind: "fail", category: "other", failures: g.failures ?? [], signature: failureSignature((g.failures ?? []).map((f) => f.message)) };
    }
    return { kind: "done", outputs: { tests: lockSha, run1: run1.testRun, run2: run2.testRun }, treeSha: commit, data: { commit, locked: lock.lock.length, familyNote, ...(lessons.length ? { lessonsUsed: lessons.map((l) => l.csproj) } : {}) } };
  },
};

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

function secretScanOf(diff: DiffSummary, commit: string) {
  return { kind: "secrets" as const, commit, hits: diff.files.flatMap((f) => scanText(f.path, f.added.join("\n"))) };
}

/**
 * Each acceptance criterion belongs to exactly one task: the LAST task (in plan order) that works on
 * its requirement. Earlier tasks that touch the same requirement build towards it but aren't held to
 * its tests yet, so a requirement split over two tasks doesn't make task 1 impossible.
 */
export function acOwners(plan: { tasks: { id: string; reqs: string[] }[] }, spec: Pick<Spec, "requirements">): Map<string, string> {
  const owners = new Map<string, string>();
  for (const r of spec.requirements) {
    const owner = [...plan.tasks].reverse().find((t) => t.reqs.includes(r.id));
    if (owner) for (const a of r.acceptance) owners.set(a.id, owner.id);
  }
  return owners;
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

export interface PrevAttempt { checks: string[]; rung: number; interrupted: boolean; commit?: string }

/**
 * Keep the previous attempt's code for this retry, or start again from the task's start commit.
 * Keep only after a recorded failure of keepable checks at the same rung: a move up the ladder
 * starts fresh so a stronger model isn't anchored on a weaker model's approach.
 */
export function retryMode(prev: PrevAttempt | undefined, rung: number): { mode: "keep" | "reset"; reason: string } {
  if (!prev) return { mode: "reset", reason: "no previous attempt" };
  if (prev.interrupted) return { mode: "reset", reason: "the previous attempt didn't finish" };
  if (prev.rung !== rung) return { mode: "reset", reason: `moved from rung ${prev.rung} to rung ${rung}` };
  if (!prev.checks.length) return { mode: "reset", reason: "no failures to fix" };
  const bad = [...new Set(prev.checks.filter((c) => !KEEPABLE.has(c)))];
  if (bad.length) return { mode: "reset", reason: `the previous attempt failed on ${bad.join(", ")}` };
  return { mode: "keep", reason: `the previous attempt failed only on ${[...new Set(prev.checks)].join(", ")}` };
}

/** The last attempt of `step` since it last completed: how it ended, its rung and commit. `checks` from its failures. */
export function previousAttempt(events: LedgerEvent[], step: string, checks: string[]): PrevAttempt | undefined {
  const evs = events.filter((e) => e.key && splitKey(e.key).step === step);
  const lastDone = Math.max(-1, ...evs.filter((e) => e.type === "step.completed").map((e) => e.seq));
  const end = evs.filter((e) => e.seq > lastDone && (e.type === "step.failed" || e.type === "step.interrupted")).at(-1);
  if (!end) return undefined;
  const d = (end.data ?? {}) as { rung?: number; parked?: boolean; commit?: string };
  return { checks, rung: Number(d.rung ?? 0), interrupted: end.type === "step.interrupted" || !!d.parked, commit: d.commit };
}

const PREV_CHANGE_CAP = 40_000;

export function implementStep(taskId: string): StepDef {
  const key = `implement/${taskId}`;
  return {
    key, stage: "implement", templateVersion: "2", coding: true,
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
      const lock = requireOutput<Lock>(ctx.state, ctx.ledger, "author-tests");
      const baselineSha = ctx.state.steps.get("discover")!.outputs[0]!;
      const task = plan.tasks.find((t) => t.id === taskId)!;
      const inputs = implementStep(taskId).inputs(ctx.state, ctx.ledger)!;
      const start = String(inputs.taskStartSha);
      const wt = await ensureWorktree(ctx, start);
      // keep the previous attempt's code, or start fresh from a clean commit (its diff saved first)
      const prev = previousAttempt(ctx.ledger.events(), key, ctx.priorFailures.map((f) => f.check));
      let mode = retryMode(prev, ctx.rung);
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
        await git(wt, ["clean", "-fdX"]);
        ctx.log(`implement ${taskId}: keeping previous attempt's code (${mode.reason}; diff ${saved.slice(0, 8)})`);
      } else if (head !== start || dirty) {
        const saved = ctx.ledger.putArtifact(await diffIncludingUntracked(wt, start));
        ctx.log(`implement ${taskId}: saved previous attempt's diff (${saved.slice(0, 8)}) and reset (${mode.reason})`);
        await resetHard(wt, start);
      }
      const retry = { retryMode: mode.mode, retryReason: mode.reason };
      const { model, effort } = modelFor(ctx.project, "implement", ctx.rung);
      const owners = acOwners(plan, spec);
      const myTests = lock.tests.filter((t) => owners.get(t.acId) === task.id);
      const earlier = earlierTests(plan, owners, lock.tests, task.id);
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
      const rt = runtime();
      await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
      await ensureAgentImage(rt, ctx.project.dotnet.sdkImage);
      // a Node app's packages, in the checkout (a .NET one reads the restored packages from the run's folder)
      if (ctx.project.stack === "node") await ensurePackages(ctx, start, wt);
      const pack = buildPack({
        stage: "implement", cls: "agent", model, recipeVersion: "1", tools: [], redactor: new Redactor(),
        sections: [
          S.template("tpl", implementIntro(ctx.project.stack)),
          S.artifact("task", "plan-task", { ...task, approach: task.approach }),
          // the approved screen this task builds (route, states, sample content, and the look to follow)
          ...(approvedScreen ? [S.artifact("approved-screen", "approved-screen", approvedScreen)] : []),
          ...(scaf ? [S.profile("scaffold", `The approved design is already code in this repo (${scaf.target}, kit ${scaf.kit.id} ${scaf.kit.version}):\n${scaf.summary}`)] : []),
          ...(scaffoldScreen ? [S.template("behaviour-only", `This task fills in ${scaffoldScreen.id}'s container, ${scaffoldScreen.container}. The page itself is ${scaffoldScreen.screen}: the approved blocks, states, layers and text, generated from the approved design and not editable. Its sample data is ${scaffoldScreen.fixtures}, which is the shape the real data must take.
- Write behaviour only: load the real data in the fixtures' shape and pass it as \`data\`, handle the page's actions in \`onAction(label, at)\`, and pass \`state\` for loading, empty, error, success and validation (the states the design drew: ${Object.keys(scaffoldScreen.states).join(", ")}).
- Do not restyle or rebuild the page: no new markup, classes, colours or components for what the page already draws. Keep the fixture branch (\`?fixture=${scaffoldScreen.id}:<state>\` shows the approved sample data with no backend).
- Server code, API clients and validation go in the other files of your scope.`)] : []),
          ...(designSystemTask ? [S.template("design-system", `This is the design-system task. The generated files are already in the repo (the scaffold commit). Finish the wiring:\n${scaf!.designSystem.todo.map((t) => `- ${t}`).join("\n") || "- nothing left to wire: check the app builds"}\nDo not change the generated files.`)] : []),
          S.artifact("acs", "acceptance-criteria", spec.requirements.filter((r) => task.reqs.includes(r.id))),
          S.artifact("tests", "locked-tests", myTests),
          S.pointers([...task.fileScope.map((p) => ({ path: p, reason: "you may change this" })), ...task.exemplars.map((p) => ({ path: p, reason: "follow this style" })), ...myTests.map((t) => ({ path: t.file, reason: `locked test for ${t.acId}; read, don't edit` }))]),
          ...(prevChange !== undefined ? [{ spec: { id: "previous-change", source: "artifact" as const, trust: "derived" as const, placement: "user" as const }, artifactKind: "diff",
            content: "Your previous change (diff from the task start; it is already in the files):\n" + (prevChange.length > PREV_CHANGE_CAP ? prevChange.slice(0, PREV_CHANGE_CAP) + `\n… (diff cut at ${PREV_CHANGE_CAP / 1000} KB; read the files for the rest)` : prevChange) }] : []),
          ...(ctx.priorFailures.length ? [{ spec: { id: "failures", source: "feedback" as const, trust: "derived" as const, placement: "user" as const }, content: ctx.priorFailures.slice(0, 20).map((f) => `- [${f.check}] ${f.message}${f.frames.length ? `\n    ${f.frames.join("\n    ")}` : ""}`).join("\n") }] : []),
          S.task(`Implement ${task.id}: ${task.title}.${prevChange !== undefined
            ? " The previous attempt failed; the failures are above. Its code is still in the files: fix the failures by editing that change, don't rewrite it."
            : ctx.priorFailures.length ? " The previous attempt failed; the failures are above." : ""}`),
          S.recap(["only the file scope", "don't touch tests", "no new packages", "return done=true when finished"]),
        ],
      });
      const r = await new ClaudeAgentRunner(rt, {
        runId: ctx.runId, key: `${key}/${ctx.attempt}`, fileScope: task.fileScope, lockedFiles: lock.lock.map((l) => l.file), onProgress: agentTracer(ctx, "implementer"),
        extraProtected: scaf?.protected ?? [], ...(ctx.project.stack === "node" ? {} : { packagesDir: packagesDir(ctx.runId) }), agentEnv: ctx.project.agentEnv, noGo: ctx.project.noGo,
        onContainer: async (id) => { await ctx.ledger.append({ type: "container.started", key, data: { id, role: "agent" } }, ctx.writer); },
        onRemoved: async (id) => { await ctx.ledger.append({ type: "container.removed", key, data: { id } }, ctx.writer); },
      }).run({ step: "implement", model, effort, pack, schema: ImplementOut, limits: { maxTurns: 80, maxUsd: stepBudgetUsd(replay(ctx.ledger.events()), 4), timeoutSec: 45 * 60 }, workdir: wt });
      await ctx.usage({ model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite, turns: r.usage.turns, wallMs: r.usage.wallMs, estUsd: r.usage.estUsd });
      if (r.status === "config-error") return { kind: "park", reason: r.error ?? "The API rejected the coding agent's request" };
      if (r.status !== "ok") return { kind: "fail", category: r.status === "rate-limited" ? "rate-limit" : "other", failures: [failure(`agent-${r.status}`, r.error ?? r.status)], signature: `implement:${r.status}`, data: retry };

      // core commits (the agent has no git), then the producer judges that exact commit
      const commit = await commitAll(wt, `factory: ${task.id} ${task.title}`);
      const diff = await diffSummary(wt, start, commit, lock);
      const diffSha = ctx.ledger.putJson(diff);
      const baseline = ctx.ledger.getJson<TestRun>(baselineSha);
      const failed = (g: NonNullable<Awaited<ReturnType<typeof gateAll>>>) =>
        ({ kind: "fail" as const, category: g.category, failures: g.failures.slice(0, 20), signature: failureSignature(g.failures.map((f) => `${f.check}:${f.testId ?? f.message}`)), diffSha: sha256(JSON.stringify(diff.files)), lockedFailedIds: g.lockedFailedIds, data: { ...retry, commit } });
      // 1. the diff checks first: a change that touches locked tests, protected files or secrets never gets run
      const diffGated = await gateAll(ctx, key, commit, [
        [lockSetUnchanged, { diff: diffSha, tests: ctx.state.steps.get("author-tests")!.outputs[0]! }],
        [configIntegrity, { diff: diffSha, plan: ctx.state.steps.get("plan")!.outputs[0]! }],
        [noSecrets, { scan: ctx.ledger.putJson(secretScanOf(diff, commit)) }],
        [diffInScope, { diff: diffSha, task: ctx.ledger.putJson({ fileScope: task.fileScope }) }],
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
      const gated = await gateAll(ctx, key, commit, [[testExpectations, { run: run.testRun, baseline: baselineSha }]], produced.build.ok ? earlier : undefined);
      if (gated) {
        if (!produced.build.ok) {
          gated.failures.unshift(...produced.build.errors.slice(0, 10).map((e) => failure("build", `${e.file}:${e.line} ${e.code} ${e.msg}`)));
          // the tests never ran, so two broken builds aren't "the same locked test failed twice"
          gated.lockedFailedIds = [];
          if (gated.category === "locked-test") gated.category = "other";
        }
        return failed(gated);
      }
      return { kind: "done", outputs: { diff: diffSha, testRun: run.testRun }, treeSha: commit, data: { commit, ...retry, ...(task.estimateTaskId ? { estimateTaskId: task.estimateTaskId } : {}) } };
    },
  };
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
    const lock = requireOutput<Lock>(ctx.state, ctx.ledger, "author-tests");
    const baselineSha = ctx.state.steps.get("discover")!.outputs[0]!;
    const baseline = ctx.ledger.getJson<TestRun>(baselineSha);
    const head = String(integrateStep.inputs(ctx.state, ctx.ledger)!.head);
    const wt = await ensureWorktree(ctx, head);
    // measured from the scaffold commit: the app the factory generated from the approved design is not the agents' change
    const diff = await diffSummary(wt, uiBase(ctx.state), head, lock);
    const diffSha = ctx.ledger.putJson(diff);
    const expectPass = [...lock.tests.map((t) => t.testId), ...lock.characterisation.map((c) => c.testId)];
    const compareToBaseline = baseline.results.map((b) => b.id);
    // the last task usually tested this exact commit with the full suite already: reuse that run
    const reused = reusableTaskRun(ctx, head, expectPass, compareToBaseline);
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
      [lockSetUnchanged, { diff: diffSha, tests: ctx.state.steps.get("author-tests")!.outputs[0]! }],
      [diffSize, { diff: diffSha }],
      // design.size-cap: the UI change may not be bigger than the approved design allows (a skipped design allows none)
      ...(uiActual
        ? [[designSizeCap, {
          actual: ctx.ledger.putJson(uiActual),
          approved: ctx.ledger.putJson({ level: uiApproved }),
        }] as [GateDef, Record<string, string>]] : []),
    ]);
    if (gated) return { kind: "park", reason: `Integration failed: ${gated.failures.slice(0, 3).map((f) => f.message).join("; ")}` };
    // B3: a run that follows an approved estimate may not grow past the size that was approved; a lead can waive it for this commit
    let waivers: Omit<WaiverRow, "step">[] = [];
    const ref = ctx.state.info.estimateRef;
    if (ref) {
      const b3 = await runGate(sizeCap, ctx.ledger, ctx.writer, { diff: diffSha, estimate: ref.estimateSha }, ctx.policy, { step: "integrate", treeSha: head });
      if (!b3.passed) {
        const w = buildWaiver(ctx, "integrate", [{ def: sizeCap, failures: b3.failures ?? [failure(sizeCap.id, b3.details)] }], head,
          `To stop and change the request instead: factory estimate --revises ${ref.runId}, then build that estimate.`);
        if (w.kind === "ask") return w.outcome;
        waivers = w.waivers;
      }
    }
    return { kind: "done", outputs: { testRun, diff: diffSha }, treeSha: head, data: { commit: head, ...(reused ? { reusedRunFrom: reused.step } : {}), ...(uiApproved ? { uiSize: { approved: uiApproved, actual: uiActual?.level ?? "none" } } : {}), ...(waivers.length ? { waivers } : {}) } };
  },
};

// ---------- accept (D, no model) ----------
// Boot the app next to the test Postgres, send the locked HTTP probes, re-run the locked criteria tests;
// every criterion gets evidence of its kind (verify-runner §2.8, minimal: no login/identities yet).
export const acceptStep: StepDef = {
  key: "accept", stage: "accept", templateVersion: "2",
  inputs: (s) => (s.steps.get("integrate")?.status === "completed" ? { integrate: s.steps.get("integrate")!.outputs[0], head: s.steps.get("integrate")!.data?.commit } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const lock = requireOutput<Lock>(ctx.state, ctx.ledger, "author-tests");
    const head = String(ctx.state.steps.get("integrate")!.data!.commit);
    const probes = lock.probes ?? [];
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
