// .NET stack pack producer (verify-runner §2.2): copy → restore → build (no network)
// → test in the Postgres container's namespace → stop everything → read results.
import { DATA_MODEL_FILE } from "../gates/data-model.js";
import { POSTGRES_SCHEMA_SQL, postgresModel } from "../gates/postgres-schema.js";
import { isSqliteFile, sqliteModel } from "../gates/sqlite-schema.js";
import type { DataModel } from "../contracts/index.js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildRun, LintRun, TestResult, TestRun, VerifyStage } from "../contracts/index.js";
import { fillTemplate, type ProjectConfig } from "../config/project.js";
import { secret } from "../config/env.js";
import { hardenedEnv } from "../ledger/git.js";
import { sha256 } from "../util/hash.js";
import { factoryHome } from "../util/paths.js";
import { FEED_PROXY_URL, FEEDS_NET } from "../runners/netinfra.js";
import { type ContainerRuntime, type ContainerSpec, stopAndRemove } from "./runtime.js";
import { parseTrx } from "./trx.js";
import { parseBuildWarnings } from "./warnings.js";
import { buildTestRun, type Expectations, markFlaky, needsProbe, rerunCandidates } from "./validate.js";

export interface ProduceInput {
  runId: string;
  key: string;                 // step key, for container labels
  repo: string;                // host repo (only git archive reads it)
  commit: string;              // the gated commit
  stage: VerifyStage;
  exp: Expectations;
  project: ProjectConfig;
  rt: ContainerRuntime;
  /** Logged before start (run-manager §2.10). */
  onContainer?: (id: string, role: ContainerSpec["role"]) => Promise<void>;
  onRemoved?: (id: string) => Promise<void>;
  /** For author-tests-on-base: only run these tests. */
  onlyTests?: string[];
  /** tests that failed in the baseline: never re-run as possibly flaky */
  knownFailures?: ReadonlySet<string>;
  /** Per-run package folder, kept between producer runs (restore is the slow part). */
  packagesDir?: string;
  /** A raw `dotnet test --filter` expression (used to find tests by method name). */
  filterExpr?: string;
  /**
   * Expectations decided from this run's own results (author-tests: test IDs are only known once
   * the tests ran). Replaces `exp` for the flaky re-run and the validity check.
   */
  resolveExp?: (results: TestResult[]) => Expectations;
  /**
   * Folder of finished builds kept per commit (per run). A lab run on a commit that was already built
   * starts from a copy of that build instead of copying, restoring and building again. Needs packagesDir:
   * the build refers to packages in it.
   */
  buildCache?: string;
  /** Test IDs not to run on a full-suite run: the repo's known failures, which can never block anything. */
  skipTests?: string[];
  /** Read what the built app's database has even when the commit has no approved data model (the untouched repo, before a plan). */
  readSchema?: boolean;
  /** Stop once the database was read: no accept, no tests. For a baseline whose tests are already on record. */
  schemaOnly?: boolean;
  /** Only restore packages into packagesDir (for the coding container); no build or tests. */
  restoreOnly?: boolean;
  /** Accept: boot the app in the db's namespace and send these probes before the tests run. */
  accept?: { probes: Probe[] };
  /** For the run trace: one call per finished phase. */
  onPhase?: (phase: string, msg: string, data?: Record<string, unknown>) => void;
}

export interface Probe { acId: string; method: string; path: string; body?: string; expectStatus: number }

export interface AcceptResult {
  boot: { attempted: boolean; ok: boolean; project?: string; firstStatus?: number; ms?: number; note?: string; logTail: string };
  probes: { acId: string; method: string; path: string; requestBody?: string; status: number; expectStatus: number; responseBody: string }[];
}

export interface ProduceOutput {
  testRun: TestRun;
  build: BuildRun;
  /**
   * The analyzer warnings this build emitted. Present wherever a build log was parsed; absent when
   * the build was reused from cache and no log exists to read. Never fatal: TreatWarningsAsErrors
   * stays off, and `lint.no-new-findings` judges these against the baseline instead.
   */
  lint?: LintRun;
  reports: { name: string; content: string }[];
  logs: { restore: string; build: string; test: string };
  accept?: AcceptResult;
  /** What the built app's database has, when this lab run read it (a commit with an approved data model, or `readSchema`). */
  schema?: BuiltSchema;
}

/** Repo-relative paths of files matching `want`; the lab copy has no .git, so walk the folders. */
function findFiles(src: string, want: (name: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 5) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (["bin", "obj", "node_modules", ".git"].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r, depth + 1);
      else if (want(e.name)) found.push(r);
    }
  };
  walk(src, "", 0);
  return found.sort();
}

/** The web project to boot: the configured one, else the first csproj using Sdk.Web. */
export function findWebProject(src: string, configured?: string): string | undefined {
  if (configured) return configured;
  return findFiles(src, (n) => n.endsWith(".csproj")).find((f) => /Sdk="Microsoft\.NET\.Sdk\.Web"/.test(readFileSync(join(src, f), "utf8")) && !/test/i.test(f));
}

const isSolution = (n: string) => n.endsWith(".sln") || n.endsWith(".slnx");
const isProject = (n: string) => /\.(cs|fs|vb)proj$/.test(n);

/**
 * What restore/build/test point at: the configured solution; nothing when the repo root holds a
 * solution or project (dotnet finds it); else the shallowest solution, else the only project.
 */
export function findBuildTarget(src: string, configured?: string): string | undefined {
  if (configured) return configured;
  if (readdirSync(src).some((n) => isSolution(n) || isProject(n))) return undefined;
  const depth = (f: string) => f.split("/").length;
  const slns = findFiles(src, isSolution);
  if (slns.length) {
    const top = slns.filter((f) => depth(f) === Math.min(...slns.map(depth)));
    if (top.length === 1) return top[0];
    throw new Error(`Several solutions and none at the repo root (${top.join(", ")}). Set dotnet.solution in the project config.`);
  }
  const projs = findFiles(src, isProject);
  if (projs.length <= 1) return projs[0];
  throw new Error(`No solution file and several projects (${projs.slice(0, 5).join(", ")}${projs.length > 5 ? ", …" : ""}). Add a .sln to the repo or set dotnet.solution in the project config.`);
}

/** "body\nSTATUS" from curl -w → { body, status } */
export function splitCurl(out: string): { body: string; status: number } {
  const i = out.lastIndexOf("\n");
  const status = Number((i >= 0 ? out.slice(i + 1) : out).trim());
  return { body: i >= 0 ? out.slice(0, i) : "", status: Number.isFinite(status) ? status : 0 };
}

const BASE_ENV = {
  HOME: "/tmp", DOTNET_CLI_HOME: "/tmp", DOTNET_NOLOGO: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1", NUGET_PACKAGES: "/nuget", MSBUILDDISABLENODEREUSE: "1",
};

export function hostUser(): string {
  return `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
}

/** git archive <commit> into a fresh folder: no .git, no leftovers (verify-runner §2.2 step 1). */
export function copyTree(repo: string, commit: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const tar = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "archive", "--format=tar", commit], {
    cwd: repo, env: hardenedEnv(), maxBuffer: 2 * 1024 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dest], { input: tar });
}

/** `path(line,col): error CS1234: message [project]` */
export function parseBuildErrors(log: string): BuildRun["errors"] {
  const out: BuildRun["errors"] = [];
  const seen = new Set<string>();
  for (const line of log.split("\n")) {
    const m = /^\s*(.+?)\((\d+),\d+\): error ([A-Z]+\d+): (.+?)(?: \[.*\])?\s*$/.exec(line);
    if (!m) continue;
    const file = m[1]!.replace(/^\/src\//, "");
    const k = `${file}:${m[2]}:${m[3]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ file, line: Number(m[2]), code: m[3]!, msg: m[4]! });
  }
  return out;
}

/** Test ID → dotnet test filter term: strip "<project>::" and theory args. */
export function filterFor(ids: string[]): string {
  return ids.map((id) => `FullyQualifiedName=${id.replace(/^[^:]*::/, "").replace(/\(.*$/, "")}`).join("|");
}

/** Longest exclusion filter passed on the command line; a longer one runs everything instead. */
export const MAX_SKIP_FILTER = 30_000;

/** Test ID → the method's fully qualified name, as the filter sees it. */
const methodOf = (id: string) => id.replace(/^[^:]*::/, "").replace(/\(.*$/, "");

/**
 * "Everything except these" as a dotnet test filter. Filter special characters are escaped.
 * Undefined when there's nothing to skip or the filter would be too long for the command line.
 */
export function skipFilterFor(ids: string[]): string | undefined {
  const names = [...new Set(ids.map(methodOf))].sort();
  if (!names.length) return undefined;
  const f = names.map((n) => `FullyQualifiedName!=${n.replace(/[\\()&|=!~]/g, "\\$&")}`).join("&");
  return f.length <= MAX_SKIP_FILTER ? f : undefined;
}

/**
 * Known failures that are safe to skip: tests that failed in the baseline, by method, but only when
 * EVERY baseline row of that method failed (a theory with some passing rows keeps running), and never
 * a test the run expects to pass or fail.
 */
export function skippableKnownFailures(baseline: TestResult[], keep: Iterable<string>): string[] {
  const kept = new Set([...keep].map(methodOf));
  const byMethod = new Map<string, TestResult[]>();
  for (const r of baseline) byMethod.set(methodOf(r.id), [...(byMethod.get(methodOf(r.id)) ?? []), r]);
  return [...byMethod.entries()]
    .filter(([m, rows]) => !kept.has(m) && rows.every((r) => r.outcome === "failed"))
    .flatMap(([, rows]) => rows.map((r) => r.id));
}

/** Where a finished build of `commit` is kept: same commit, SDK image and build target → same build. */
export function buildCachePath(dir: string, commit: string, project: ProjectConfig): string {
  return join(dir, sha256(JSON.stringify([commit, project.dotnet.sdkImage, project.dotnet.solution ?? ""])).slice(0, 24));
}

/** Builds kept per run: the tests commit and the latest fix commit are the ones reused. */
export const KEEP_BUILDS = 2;

/** Copy a folder's contents: a cheap clone where the file system supports it, a plain copy otherwise. */
function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  const clone = process.platform === "darwin" ? ["-c", "-a"] : ["-a", "--reflink=auto"];
  try {
    execFileSync("cp", [...clone, `${from}/.`, to], { stdio: "ignore" });
  } catch {
    execFileSync("cp", ["-a", `${from}/.`, to], { stdio: "ignore" });
  }
}

/** Save a build under `dest` (written aside, then renamed, so a half copy is never reused); keep the newest few. */
export function saveBuild(src: string, dir: string, dest: string): void {
  mkdirSync(dir, { recursive: true });
  if (existsSync(dest)) return;
  const tmp = `${dest}.partial-${randomBytes(3).toString("hex")}`;
  try {
    copyDir(src, tmp);
    renameSync(tmp, dest);
  } catch {
    rmSync(tmp, { recursive: true, force: true });
    return;
  }
  // the build just saved always stays; of the others, the most recently used ones fill the rest
  const others = readdirSync(dir).filter((f) => !f.includes(".partial-")).map((f) => join(dir, f)).filter((p) => p !== dest)
    .map((p) => ({ p, t: statSync(p).mtimeMs }));
  for (const old of others.sort((a, b) => b.t - a.t).slice(KEEP_BUILDS - 1)) rmSync(old.p, { recursive: true, force: true });
}

export async function produceDotnetTests(inp: ProduceInput): Promise<ProduceOutput> {
  const { rt, project } = inp;
  const n = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const work = join(factoryHome(), "tmp", inp.runId, n);
  const src = join(work, "src"), nuget = inp.packagesDir ?? join(work, "nuget"), resBuild = join(work, "results-build"), resTest = join(work, "results-test");
  for (const d of [src, nuget, resBuild, resTest]) mkdirSync(d, { recursive: true });
  const live = new Set<string>();
  const logs = { restore: "", build: "", test: "" };
  let sln: string[] = [];

  const launch = async (spec: Omit<ContainerSpec, "labels" | "user"> & { user?: string }): Promise<string> => {
    const id = await rt.create({ user: hostUser(), ...spec, labels: { run: inp.runId, key: inp.key } });
    live.add(id);
    await inp.onContainer?.(id, spec.role);
    await rt.start(id);
    return id;
  };
  const finish = async (id: string) => {
    await stopAndRemove(rt, id);
    live.delete(id);
    await inp.onRemoved?.(id);
  };

  try {
    const t0 = Date.now();
    const phase = (name: string, msg: string, data?: Record<string, unknown>) => inp.onPhase?.(name, msg, data);
    const secs = (from: number) => `${((Date.now() - from) / 1000).toFixed(0)}s`;
    const toolVersions: Record<string, string> = { sdkImage: await rt.imageDigest(project.dotnet.sdkImage) };
    const noTests = () => buildTestRun({ treeSha: inp.commit, stage: inp.stage, toolVersions, exp: inp.exp, raw: { reports: [], results: [], discovered: [], exitCode: 0 }, probeOk: () => true });
    // an earlier lab run in this run already built this exact commit: start from a copy of that build
    const cached = !inp.restoreOnly && inp.buildCache ? buildCachePath(inp.buildCache, inp.commit, project) : undefined;
    const reuse = !!cached && existsSync(cached);
    if (reuse) {
      copyDir(cached!, src);
      utimesSync(cached!, new Date(), new Date()); // most recently used: pruned last
      const target = findBuildTarget(src, project.dotnet.solution);
      if (target) sln = [target];
      phase("build-reused", `lab: reused the build of ${inp.commit.slice(0, 10)} from an earlier lab run (${secs(t0)})`);
    }
    let build: BuildRun = { kind: "build", ok: reuse, errors: [] };
    // only set when a build log was actually produced: a cache hit has no log to read
    let lint: LintRun | undefined;
    let schema: BuiltSchema | undefined;
    const wantsSchema = () => !!inp.readSchema || existsSync(join(src, DATA_MODEL_FILE));
    if (reuse && existsSync(join(src, BUILT_SCHEMA_FILE))) { try { schema = JSON.parse(readFileSync(join(src, BUILT_SCHEMA_FILE), "utf8")) as BuiltSchema; } catch { /* read again below where it can be */ } }
    if (!reuse) {
      copyTree(inp.repo, inp.commit, src);
      const target = findBuildTarget(src, project.dotnet.solution);
      if (target) sln = [target];
      phase("copy", `lab: copied ${inp.commit.slice(0, 10)} (${secs(t0)})`);
      const tRestore = Date.now();

      // restore: only package feeds, through the feed proxy (host allowlist; URL-prefix TLS proxy not built yet)
      const r = await launch({
        role: "restore", image: project.dotnet.sdkImage, network: FEEDS_NET, workdir: "/src",
        env: { ...BASE_ENV, HTTPS_PROXY: FEED_PROXY_URL, HTTP_PROXY: FEED_PROXY_URL, NUGET_CERT_REVOCATION_MODE: "offline" },
        mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget" }], cmd: ["dotnet", "restore", ...sln],
      });
      const rCode = await rt.wait(r, project.dotnet.buildTimeoutSec * 1000);
      phase("restore", `lab: restore ${rCode === 0 ? "ok" : `FAILED (exit ${rCode ?? "timeout"})`} (${secs(tRestore)})`, rCode === 0 ? undefined : { logTail: (await rt.logs(r)).split("\n").slice(-40).join("\n") });
      logs.restore = await rt.logs(r);
      await finish(r);
      // a backend with EF Core migrations: fetch the tool that runs them, once per packages folder, for the schema read below
      const ef = rCode === 0 && !inp.restoreOnly && wantsSchema() && !migrateConfigured(project) ? efMigrations(src) : undefined;
      if (ef && !existsSync(join(nuget, EF_TOOLS, "dotnet-ef"))) {
        const t = await launch({
          role: "restore", image: project.dotnet.sdkImage, network: FEEDS_NET, workdir: "/src",
          env: { ...BASE_ENV, HTTPS_PROXY: FEED_PROXY_URL, HTTP_PROXY: FEED_PROXY_URL, NUGET_CERT_REVOCATION_MODE: "offline" },
          mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget" }], cmd: ["dotnet", "tool", "install", "dotnet-ef", "--tool-path", `/nuget/${EF_TOOLS}`, "--version", `${ef.major}.*`],
        });
        const code = await rt.wait(t, project.dotnet.buildTimeoutSec * 1000);
        phase("ef-tool", `lab: the migrations tool (dotnet-ef ${ef.major}) ${code === 0 ? "is ready" : `could not be fetched (exit ${code ?? "timeout"}); the database is read from startup only`}`, code === 0 ? undefined : { logTail: (await rt.logs(t)).split("\n").slice(-20).join("\n") });
        await finish(t);
      }
      if (inp.restoreOnly) {
        const build: BuildRun = { kind: "build", ok: rCode === 0, errors: rCode === 0 ? [] : [{ file: "", line: 0, code: "RESTORE", msg: `dotnet restore failed (exit ${rCode ?? "timeout"})` }] };
        const testRun = buildTestRun({ treeSha: inp.commit, stage: inp.stage, toolVersions, exp: inp.exp, raw: { reports: [], results: [], discovered: [], exitCode: rCode ?? 124, buildFailed: rCode !== 0 }, probeOk: () => true });
        return { testRun, build, lint, reports: [], logs };
      }

      // build, no network
      if (rCode === 0) {
        const b = await launch({
          role: "producer", image: project.dotnet.sdkImage, network: "none", workdir: "/src", env: BASE_ENV,
          mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget", ro: true }],
          cmd: ["dotnet", "build", ...sln, "--no-restore", "-nologo", "-p:TreatWarningsAsErrors=false"],
        });
        const tBuild = Date.now();
        const bCode = await rt.wait(b, project.dotnet.buildTimeoutSec * 1000);
        phase("build", `lab: build ${bCode === 0 ? "ok" : `FAILED (exit ${bCode ?? "timeout"})`} (${secs(tBuild)})`);
        await rt.stop(b); // stop before read
        logs.build = await rt.logs(b);
        await finish(b);
        build = { kind: "build", ok: bCode === 0, errors: parseBuildErrors(logs.build) };
        lint = { kind: "lint", tool: "dotnet-build", version: toolVersions["dotnet"] ?? "unknown", findings: parseBuildWarnings(logs.build) };
        // a backend with an approved data model: start the app once so it creates its database, and keep what the database has
        // (a backend on PostgreSQL is read further down, once its database server is up)
        if (build.ok && !project.database && wantsSchema()) {
          const tSchema = Date.now();
          const built = schema = await readBuiltSchema(inp, src, nuget, launch, finish);
          mkdirSync(join(src, BUILT_SCHEMA_FILE, ".."), { recursive: true });
          writeFileSync(join(src, BUILT_SCHEMA_FILE), JSON.stringify(built));
          phase("schema", `lab: ${built.model ? `read the database the app created (${built.file}): ${built.model.tables.length} table(s)` : `no database schema read: ${built.note}`} (${secs(tSchema)})`);
        }
        // keep the build as it was before any test ran, for later lab runs on this commit
        if (build.ok && inp.buildCache) saveBuild(src, inp.buildCache, buildCachePath(inp.buildCache, inp.commit, project));
      } else {
        build.errors.push({ file: "", line: 0, code: "RESTORE", msg: `dotnet restore failed (exit ${rCode ?? "timeout"})` });
      }
    }

    if (!build.ok) {
      const testRun = buildTestRun({
        treeSha: inp.commit, stage: inp.stage, toolVersions, exp: inp.exp,
        raw: { reports: [], results: [], discovered: [], exitCode: 1, buildFailed: true }, probeOk: () => true,
      });
      return { testRun, build, lint, reports: [], logs };
    }
    // nothing more to read for a backend on SQLite: skip the database server and the tests
    if (inp.schemaOnly && !project.database) return { testRun: noTests(), build, lint, reports: [], logs, schema };

    // db: loopback only
    let dbId: string | undefined;
    const db = project.database;
    const dbVars = {
      DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_NAME: db?.name ?? "app_test", DB_USER: db?.user ?? "factory",
      DB_PASSWORD: (db?.passwordEnv ? secret(db.passwordEnv) : undefined) ?? randomBytes(12).toString("hex"),
    };
    if (db?.passwordEnv && !secret(db.passwordEnv)) throw new Error(`${db.passwordEnv} is missing in ~/.factory/.env`);
    if (db) {
      toolVersions.dbImage = await rt.imageDigest(db.image);
      // The image's superuser gets a random password nobody sees; tests log in as a CREATEDB role.
      dbId = await launch({
        role: "db", image: db.image, network: "none", user: "",
        env: { POSTGRES_USER: "factory_admin", POSTGRES_PASSWORD: randomBytes(16).toString("hex"), POSTGRES_DB: "postgres" },
        capAdd: ["CHOWN", "SETUID", "SETGID", "FOWNER", "DAC_OVERRIDE"], mounts: [], cmd: [],
      });
      const tDb = Date.now();
      await waitForPg(rt, dbId);
      phase("db", `lab: test Postgres ready (${secs(tDb)})`);
      const ident = dbVars.DB_USER.replace(/"/g, "");
      const pw = dbVars.DB_PASSWORD.replace(/'/g, "''");
      // separate -c flags: CREATE DATABASE can't run inside the single transaction one -c makes
      const r = await rt.exec(dbId, ["psql", "-v", "ON_ERROR_STOP=1", "-U", "factory_admin", "-d", "postgres",
        "-c", `CREATE ROLE "${ident}" LOGIN CREATEDB NOSUPERUSER PASSWORD '${pw}'`,
        "-c", `CREATE DATABASE "${dbVars.DB_NAME.replace(/"/g, "")}" OWNER "${ident}"`]);
      if (r.code !== 0) throw new Error(`Couldn't create the test database login: ${r.stderr.split(dbVars.DB_PASSWORD).join("«SECRET»").slice(0, 300)}`);
    }
    const dbEnv = project.database ? fillTemplate(project.database.producerEnv, dbVars) : {};
    // a backend on PostgreSQL with an approved data model: start the app once on a database of its own, keep what it created
    // there with the build (once per commit: a reused build brings it along), and drop that database before any test runs
    if (dbId && wantsSchema() && !existsSync(join(src, BUILT_SCHEMA_FILE))) {
      const tSchema = Date.now();
      const built = schema = await readPostgresSchema(inp, src, nuget, dbId, dbVars, launch, finish);
      for (const at of [src, ...(cached && existsSync(cached) ? [cached] : [])]) {
        mkdirSync(join(at, BUILT_SCHEMA_FILE, ".."), { recursive: true });
        writeFileSync(join(at, BUILT_SCHEMA_FILE), JSON.stringify(built));
      }
      phase("schema", `lab: ${built.model ? `read the database the app created (${built.file}): ${built.model.tables.length} table(s)` : `no database schema read: ${built.note}`} (${secs(tSchema)})`);
    }

    if (inp.schemaOnly) return { testRun: noTests(), build, lint, reports: [], logs, schema };

    const runTests = async (filter: string | undefined, resultsDir: string) => {
      const started = Date.now();
      const t = await launch({
        role: "producer", image: project.dotnet.sdkImage, network: dbId ? `container:${dbId}` : "none", workdir: "/src",
        env: { ...BASE_ENV, ...dbEnv },
        mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget", ro: true }, { src: resultsDir, dst: "/results" }],
        cmd: [
          "dotnet", "test", ...sln, "--no-build", "--no-restore", "--nologo",
          "--logger", "trx;LogFilePrefix=r", "--results-directory", "/results",
          "--blame-hang-timeout", `${Math.max(60, Math.round(project.dotnet.testTimeoutSec / 3))}s`,
          ...(filter ? ["--filter", filter] : []),
          ...(project.dotnet.runnerArgs.length ? ["--", ...project.dotnet.runnerArgs] : []),
        ],
      });
      const code = await rt.wait(t, project.dotnet.testTimeoutSec * 1000);
      await rt.stop(t); // every process in the room is dead before we read
      const log = await rt.logs(t);
      await finish(t);
      const reports = readdirSync(resultsDir).filter((f) => f.endsWith(".trx")).map((f) => {
        const p = join(resultsDir, f);
        const content = readFileSync(p, "utf8");
        let parsed = true, results: TestResult[] = [];
        try { results = parseTrx(content, f.replace(/\.trx$/, "")).results; } catch { parsed = false; }
        return { name: f, content, sha: sha256(content), parsed, writtenAfterStart: statSync(p).mtimeMs >= started - 1000, results };
      });
      return { code: code ?? 124, log, reports };
    };

    let accept: AcceptResult | undefined;
    if (inp.accept) {
      accept = await bootAndProbe(inp, src, nuget, dbId, dbEnv, launch, finish);
      phase("app", accept.boot.attempted ? `lab: app ${accept.boot.ok ? `started, first answer HTTP ${accept.boot.firstStatus}` : `DIDN'T START: ${accept.boot.note}`} (${((accept.boot.ms ?? 0) / 1000).toFixed(0)}s)` : `lab: app not booted: ${accept.boot.note}`,
        accept.boot.ok ? undefined : { logTail: accept.boot.logTail });
      for (const p of accept.probes) phase("probe", `lab: probe ${p.method} ${p.path} → ${p.status} (expected ${p.expectStatus})`);
    }

    // a full-suite run skips the repo's known failures (every expected test still runs)
    const targeted = inp.filterExpr ?? (inp.onlyTests?.length ? filterFor(inp.onlyTests) : undefined);
    const skipFilter = targeted || !inp.skipTests?.length ? undefined : skipFilterFor(inp.skipTests);
    const skipped = skipFilter ? inp.skipTests! : [];
    if (skipFilter) phase("skip", `lab: skipping ${skipped.length} test(s) that already fail on the base branch`);
    else if (!targeted && inp.skipTests?.length) phase("skip", `lab: running the known failures too: the filter to skip ${inp.skipTests.length} test(s) would be too long`);
    const filter = targeted ?? skipFilter;
    const tTests = Date.now();
    const first = await runTests(filter, resTest);
    {
      const rs = first.reports.flatMap((r) => r.results);
      phase("tests", `lab: tests ran: ${rs.length} (${rs.filter((x) => x.outcome === "passed").length} passed, ${rs.filter((x) => x.outcome === "failed").length} failed), exit ${first.code} (${secs(tTests)})`,
        first.reports.length ? undefined : { logTail: first.log.split("\n").slice(-40).join("\n") });
    }
    logs.test = first.log;
    let results = first.reports.flatMap((r) => r.results);

    let probe = true;
    if (dbId && needsProbe(results)) probe = (await rt.exec(dbId, ["pg_isready", "-h", "127.0.0.1"])).code === 0;

    const exp = inp.resolveExp ? inp.resolveExp(results) : inp.exp;
    const again = rerunCandidates(results, exp, inp.knownFailures);
    if (again.length && again.length <= 20 && probe) {
      const dir = join(work, "results-rerun");
      mkdirSync(dir, { recursive: true });
      phase("rerun", `lab: re-running ${again.length} failed non-locked test(s) once`);
      const second = await runTests(filterFor(again), dir);
      results = markFlaky(results, second.reports.flatMap((r) => r.results));
    }
    if (dbId) await finish(dbId);

    const expected = [...exp.expectPass, ...exp.expectFail.map((e) => e.id)];
    const testRun = buildTestRun({
      treeSha: inp.commit, stage: inp.stage, toolVersions, exp,
      raw: {
        reports: first.reports.map((r) => ({ sha: r.sha, parsed: r.parsed, writtenAfterStart: r.writtenAfterStart })),
        // discovered = the IDs we require; `dotnet test --list-tests` prints display names, not IDs
        results, discovered: expected, exitCode: first.code,
      },
      probeOk: () => probe,
    });
    if (skipped.length) testRun.skippedKnownFailures = skipped;
    return { testRun, build, lint, reports: first.reports.map((r) => ({ name: r.name, content: r.content })), logs, accept, schema };
  } finally {
    for (const id of live) await stopAndRemove(rt, id).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
}

/** Where the lab keeps what the built app's database has, inside the build of a commit (under obj/, which no check reads). */
export const BUILT_SCHEMA_FILE = "obj/factory-built-schema.json";
export interface BuiltSchema { /** how the database was made: by the app starting, or by running its migrations */ by?: "startup" | "migrations"; model?: DataModel; /** the database file, repo-relative */ file?: string; /** why there is no model */ note?: string; /** the app made its database, with no table in it */ empty?: boolean }

const SQLITE_NAME = /\.(db|sqlite|sqlite3)$/i;

/** Where the lab keeps the EF Core command-line tool, inside the packages folder (fetched with the restore). */
const EF_TOOLS = ".factory-tools";
const migrateConfigured = (project: ProjectConfig): string[] | undefined => project.migrate ?? project.database?.migrate;

/** A repo with EF Core migrations: the project holding the model snapshot, and the EF major version it was written with. */
export function efMigrations(src: string): { project: string; major: string } | undefined {
  const snap = findFiles(src, (n) => /ModelSnapshot\.cs$/.test(n))[0];
  if (!snap) return undefined;
  let dir = snap.split("/").slice(0, -1);
  while (dir.length && !readdirSync(join(src, ...dir)).some((f) => f.endsWith(".csproj"))) dir = dir.slice(0, -1);
  const csproj = readdirSync(join(src, ...dir)).find((f) => f.endsWith(".csproj"));
  if (!csproj) return undefined;
  const major = /"ProductVersion",\s*"(\d+)\./.exec(readFileSync(join(src, snap), "utf8"))?.[1] ?? "8";
  return { project: [...dir, csproj].join("/"), major };
}

/**
 * Bring an empty database to the backend's tables when starting the app did not: the project's own `migrate` command, or
 * `dotnet ef database update` for a repo with EF Core migrations. Undefined when the repo has neither.
 */
async function runMigrations(
  inp: ProduceInput, src: string, nuget: string, web: string, network: string, env: Record<string, string>, launch: Launch, finish: (id: string) => Promise<void>,
): Promise<{ ok: boolean; what: string; logTail: string } | undefined> {
  const { rt, project } = inp;
  const own = migrateConfigured(project);
  const ef = own ? undefined : efMigrations(src);
  if (!own && !(ef && existsSync(join(nuget, EF_TOOLS, "dotnet-ef")))) return undefined;
  const cmd = own ?? [`/nuget/${EF_TOOLS}/dotnet-ef`, "database", "update", "--no-build", "--project", ef!.project, "--startup-project", web];
  const m = await launch({
    role: "producer", image: project.dotnet.sdkImage, network, workdir: "/src",
    env: { ...BASE_ENV, ...env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development", ...project.accept.env },
    mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget", ro: true }], cmd,
  });
  const code = await rt.wait(m, project.dotnet.buildTimeoutSec * 1000);
  await rt.stop(m);
  const logTail = (await rt.logs(m)).split("\n").slice(-60).join("\n");
  await finish(m);
  return { ok: code === 0, what: own ? "the project's migrate command" : "its EF Core migrations", logTail };
}

type Launch = (spec: Omit<ContainerSpec, "labels" | "user"> & { user?: string }) => Promise<string>;

/** Start the built app until it answers (or gives up) and stop it again: long enough for it to create its database. */
async function bootOnce(
  inp: ProduceInput, src: string, nuget: string, web: string, network: string, env: Record<string, string>, launch: Launch, finish: (id: string) => Promise<void>,
): Promise<{ answered: boolean; logTail: string }> {
  const { rt, project } = inp;
  const cfg = project.accept;
  const base = `http://127.0.0.1:${cfg.port}`;
  const app = await launch({
    role: "app", image: project.dotnet.sdkImage, network, workdir: "/src",
    env: { ...BASE_ENV, ...env, ASPNETCORE_ENVIRONMENT: "Development", ASPNETCORE_URLS: base, DOTNET_ENVIRONMENT: "Development", ...cfg.env },
    mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget", ro: true }],
    cmd: ["dotnet", "run", "--no-build", "--no-launch-profile", "--project", web, "--urls", base],
  });
  const until = Date.now() + Math.min(cfg.readyTimeoutSec, 60) * 1000;
  let answered = false;
  while (Date.now() < until && !answered && await rt.isRunning(app)) {
    answered = (Number((await rt.exec(app, ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", `${base}${cfg.readyPath}`])).stdout.trim()) || 0) > 0;
    if (!answered) await new Promise((res) => setTimeout(res, 1000));
  }
  await rt.stop(app);
  const logTail = (await rt.logs(app)).split("\n").slice(-60).join("\n");
  await finish(app);
  return { answered, logTail };
}

/** The database the schema read gives the app on PostgreSQL: its own, so the tests' database stays as the tests expect it. */
const SCHEMA_DB = "factory_schema";

/**
 * A backend on PostgreSQL: make an empty database beside the tests' one, start the built app on it until it answers, stop it,
 * read the tables and keys it created there (one catalogue query, src/gates/postgres-schema.ts), and drop that database.
 */
async function readPostgresSchema(
  inp: ProduceInput, src: string, nuget: string, dbId: string, dbVars: Record<string, string>, launch: Launch, finish: (id: string) => Promise<void>,
): Promise<BuiltSchema> {
  const { rt, project } = inp;
  if (!project.accept.bootApp) return { note: "booting the app is turned off for this project" };
  const web = findWebProject(src, project.accept.project);
  if (!web) return { note: "no web project found (no csproj uses Sdk.Web)" };
  const admin = (...sql: string[]) => rt.exec(dbId, ["psql", "-v", "ON_ERROR_STOP=1", "-U", "factory_admin", "-d", "postgres", ...sql.flatMap((q) => ["-c", q])]);
  const made = await admin(`CREATE DATABASE "${SCHEMA_DB}" OWNER "${dbVars.DB_USER!.replace(/"/g, "")}"`);
  if (made.code !== 0) return { note: `the database for the schema read could not be made: ${made.stderr.split("\n")[0]}` };
  try {
    const { answered, logTail } = await bootOnce(inp, src, nuget, web, `container:${dbId}`, fillTemplate(project.database!.producerEnv, { ...dbVars, DB_NAME: SCHEMA_DB }), launch, finish);
    const r = await rt.exec(dbId, ["psql", "-v", "ON_ERROR_STOP=1", "-U", "factory_admin", "-d", SCHEMA_DB, "-At", "-c", POSTGRES_SCHEMA_SQL]);
    if (r.code !== 0) return { note: `the database the app created could not be read: ${r.stderr.split("\n")[0]}` };
    const model = postgresModel(r.stdout.trim());
    if (model.tables.length) return { by: "startup", model, file: `PostgreSQL database ${SCHEMA_DB}` };
    // starting the app made no table: run the backend's migrations on that database and read it again
    const mig = await runMigrations(inp, src, nuget, web, `container:${dbId}`, fillTemplate(project.database!.producerEnv, { ...dbVars, DB_NAME: SCHEMA_DB }), launch, finish);
    if (mig) {
      if (!mig.ok) return { note: `starting the app created no tables, and ${mig.what} failed: ${firstError(mig.logTail)}` };
      const again = await rt.exec(dbId, ["psql", "-v", "ON_ERROR_STOP=1", "-U", "factory_admin", "-d", SCHEMA_DB, "-At", "-c", POSTGRES_SCHEMA_SQL]);
      const migrated = again.code === 0 ? postgresModel(again.stdout.trim()) : { tables: [] };
      if (migrated.tables.length) return { by: "migrations", model: migrated, file: `PostgreSQL database ${SCHEMA_DB}, made by ${mig.what}` };
      return { note: `${mig.what} ran but created no tables`, empty: true };
    }
    return answered ? { note: "the app started but created no tables in its PostgreSQL database on startup", empty: true } : { note: `the app did not start: ${firstError(logTail)}` };
  } catch (e) {
    return { note: `the database the app created could not be read: ${(e as Error).message.split("\n")[0]}` };
  } finally {
    await admin(`DROP DATABASE IF EXISTS "${SCHEMA_DB}" WITH (FORCE)`);
  }
}

/**
 * Start the built app with no network until it answers (or gives up), stop it, and read the SQLite database it created on
 * startup. The database files are removed again, so the tests that follow start as they would have. A project on PostgreSQL
 * (the project's `database`) is read by `readPostgresSchema`.
 */
async function readBuiltSchema(inp: ProduceInput, src: string, nuget: string, launch: Launch, finish: (id: string) => Promise<void>): Promise<BuiltSchema> {
  const { project } = inp;
  const cfg = project.accept;
  if (!cfg.bootApp) return { note: "booting the app is turned off for this project" };
  const web = findWebProject(src, cfg.project);
  if (!web) return { note: "no web project found (no csproj uses Sdk.Web)" };
  const before = new Set(findFiles(src, (n) => SQLITE_NAME.test(n)));
  const { answered, logTail } = await bootOnce(inp, src, nuget, web, "none", {}, launch, finish);
  const fresh = () => findFiles(src, (n) => SQLITE_NAME.test(n)).filter((f) => !before.has(f) && isSqliteFile(join(src, f)));
  try {
    const made = fresh();
    const started = made[0] ? sqliteModel(join(src, made[0])) : undefined;
    if (started?.tables.length) return { by: "startup", model: started, file: made[0]! };
    // starting the app made no table: run the backend's migrations and look for the database file again
    const mig = await runMigrations(inp, src, nuget, web, "none", {}, launch, finish);
    if (mig) {
      if (!mig.ok) return { note: `starting the app created no tables, and ${mig.what} failed: ${firstError(mig.logTail)}` };
      const file = fresh().find((f) => sqliteModel(join(src, f)).tables.length);
      if (file) return { by: "migrations", model: sqliteModel(join(src, file)), file: `${file}, made by ${mig.what}` };
      return { note: `${mig.what} ran but created no SQLite database with tables in it`, empty: true };
    }
    if (!made.length) return { note: answered ? "the app started but created no SQLite database file on startup" : `the app did not start: ${firstError(logTail)}` };
    return { note: `the app created ${made[0]} with no tables in it on startup`, empty: true };
  } catch (e) {
    return { note: `the database the app created could not be read: ${(e as Error).message.split("\n")[0]}` };
  } finally {
    for (const f of findFiles(src, (n) => /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i.test(n))) if (!before.has(f)) rmSync(join(src, f), { force: true });
  }
}

/**
 * Accept (verify-runner §2.8, minimal): run the built app in the db's loopback-only namespace, wait
 * for any HTTP answer, send each locked probe, record request and response. The app is stopped
 * before anything is read back.
 */
async function bootAndProbe(
  inp: ProduceInput, src: string, nuget: string, dbId: string | undefined, dbEnv: Record<string, string>,
  launch: (spec: Omit<ContainerSpec, "labels" | "user"> & { user?: string }) => Promise<string>,
  finish: (id: string) => Promise<void>,
): Promise<AcceptResult> {
  const { rt, project } = inp;
  const cfg = project.accept;
  const none = (note: string): AcceptResult => ({ boot: { attempted: false, ok: false, note, logTail: "" }, probes: [] });
  if (!cfg.bootApp) return none("booting the app is turned off for this project");
  const web = findWebProject(src, cfg.project);
  if (!web) return none("no web project found (no csproj uses Sdk.Web)");
  const base = `http://127.0.0.1:${cfg.port}`;
  const started = Date.now();
  const app = await launch({
    role: "app", image: project.dotnet.sdkImage, network: dbId ? `container:${dbId}` : "none", workdir: "/src",
    env: { ...BASE_ENV, ...dbEnv, ASPNETCORE_ENVIRONMENT: "Development", ASPNETCORE_URLS: base, DOTNET_ENVIRONMENT: "Development", ...cfg.env },
    mounts: [{ src, dst: "/src" }, { src: nuget, dst: "/nuget", ro: true }],
    cmd: ["dotnet", "run", "--no-build", "--no-launch-profile", "--project", web, "--urls", base],
  });
  let firstStatus = 0;
  let crashed = false;
  const until = started + cfg.readyTimeoutSec * 1000;
  while (Date.now() < until) {
    if (!(await rt.isRunning(app))) { crashed = true; break; }
    const r = await rt.exec(app, ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", `${base}${cfg.readyPath}`]);
    firstStatus = Number(r.stdout.trim()) || 0;
    if (firstStatus > 0) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const ms = Date.now() - started;
  const probes: AcceptResult["probes"] = [];
  if (firstStatus > 0) {
    for (const p of inp.accept!.probes) {
      const args = ["curl", "-s", "-X", p.method.toUpperCase(), "-H", "Content-Type: application/json", "-w", "\n%{http_code}"];
      if (p.body !== undefined) args.push("--data-binary", p.body);
      args.push(`${base}${p.path.startsWith("/") ? p.path : `/${p.path}`}`);
      const r = splitCurl((await rt.exec(app, args)).stdout);
      probes.push({ acId: p.acId, method: p.method.toUpperCase(), path: p.path, requestBody: p.body, status: r.status, expectStatus: p.expectStatus, responseBody: r.body.slice(0, 20_000) });
    }
  }
  await rt.stop(app); // stop before reading its log
  const logTail = (await rt.logs(app)).split("\n").slice(-60).join("\n");
  await finish(app);
  return {
    boot: {
      attempted: true, ok: firstStatus > 0, project: web, firstStatus, ms, logTail,
      note: firstStatus > 0 ? undefined : crashed
        ? `the app exited during startup after ${Math.round(ms / 1000)}s: ${firstError(logTail)}`
        : `no HTTP answer on ${cfg.readyPath} within ${cfg.readyTimeoutSec}s`,
    },
    probes,
  };
}

/** The first exception line of a .NET log, for the park message. */
export function firstError(log: string): string {
  const line = log.split("\n").find((l) => /(Exception|Error)[^a-z]*[:(]/.test(l) && !/^\s+at /.test(l));
  return (line ?? log.split("\n").filter(Boolean).slice(-1)[0] ?? "").trim().slice(0, 300);
}

async function waitForPg(rt: ContainerRuntime, id: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await rt.exec(id, ["pg_isready", "-h", "127.0.0.1"])).code === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Postgres didn't become ready in 60 s");
}
