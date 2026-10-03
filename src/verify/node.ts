// Node stack pack producer (greenfield follow-up to the PR #11 review): the .NET lab's counterpart for a TypeScript app.
// copy → install (npm registry only, through the feed proxy, no install scripts) → build (no network) → vitest (no network)
// → stop everything → read the JSON report. Accept starts the built app (npm start, or vite preview) and sends the probes.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BuildRun, TestResult } from "../contracts/index.js";
import { sha256 } from "../util/hash.js";
import { factoryHome } from "../util/paths.js";
import { FEED_PROXY_URL, FEEDS_NET } from "../runners/netinfra.js";
import { copyTree, hostUser, splitCurl, type AcceptResult, type ProduceInput, type ProduceOutput } from "./dotnet.js";
import { type ContainerSpec, stopAndRemove } from "./runtime.js";
import { buildTestRun, markFlaky, rerunCandidates, type Expectations } from "./validate.js";
import { parseVitestJson, titleOf, titlePattern } from "./vitest.js";

/** Settings every Node container gets: a scratch HOME, the run's npm cache, no telemetry, no update checks. */
export const NODE_ENV = {
  HOME: "/tmp", npm_config_cache: "/npm-cache", npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false",
  NEXT_TELEMETRY_DISABLED: "1", CI: "1",
};

/** Install the repo's packages: exactly the lock file when there is one, and never a package's install scripts. */
export const INSTALL_CMD = ["sh", "-c", "if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi"];

/** A `vitest -t` filter for tests with these titles (the factory names them AC_<req>_<n>_<Words> and CHAR_<Words>). */
export const nodeNameFilter = (names: string[]): string => titlePattern(names);

/**
 * TypeScript and Next.js build errors: `file(line,col): error TS2304: msg`, `file:line:col - error TS2304: msg`, and Next's
 * `./file:line:col` followed by `Type error: msg`. Anything else that failed is one line with the end of the log.
 */
export function parseNodeBuildErrors(log: string): BuildRun["errors"] {
  const out: BuildRun["errors"] = [];
  const seen = new Set<string>();
  const push = (file: string, line: number, code: string, msg: string) => {
    const f = file.replace(/^\/src\//, "").replace(/^\.\//, "");
    const k = `${f}:${line}:${code}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ file: f, line, code, msg: msg.trim().slice(0, 500) });
  };
  const lines = log.split("\n");
  lines.forEach((l, i) => {
    let m = /^\s*(.+?)\((\d+),\d+\): error (TS\d+): (.+)$/.exec(l) ?? /^\s*(.+?):(\d+):\d+ - error (TS\d+): (.+)$/.exec(l);
    if (m) return push(m[1]!, Number(m[2]), m[3]!, m[4]!);
    m = /^(\.\/\S+?):(\d+):\d+\s*$/.exec(l);
    const next = lines[i + 1] ?? "";
    if (m && /^(Type error|Error): /.test(next)) push(m[1]!, Number(m[2]), "TS", next.replace(/^(Type error|Error): /, ""));
  });
  return out;
}

export async function produceNodeTests(inp: ProduceInput): Promise<ProduceOutput> {
  const { rt, project } = inp;
  if (project.database) throw new Error("A test database is not available for Node projects yet: remove database: from the project config.");
  const n = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const work = join(factoryHome(), "tmp", inp.runId, n);
  const src = join(work, "src"), cache = inp.packagesDir ?? join(work, "npm-cache"), resTest = join(work, "results-test");
  for (const d of [src, cache, resTest]) mkdirSync(d, { recursive: true });
  const live = new Set<string>();
  const logs = { restore: "", build: "", test: "" };
  const launch = async (spec: Omit<ContainerSpec, "labels" | "user">): Promise<string> => {
    const id = await rt.create({ user: hostUser(), ...spec, labels: { run: inp.runId, key: inp.key } });
    live.add(id);
    await inp.onContainer?.(id, spec.role);
    await rt.start(id);
    return id;
  };
  const finish = async (id: string) => { await stopAndRemove(rt, id); live.delete(id); await inp.onRemoved?.(id); };
  const phase = (name: string, msg: string, data?: Record<string, unknown>) => inp.onPhase?.(name, msg, data);
  const secs = (from: number) => `${((Date.now() - from) / 1000).toFixed(0)}s`;
  const failedRun = (build: BuildRun, toolVersions: Record<string, string>, code = 1): ProduceOutput => ({
    testRun: { ...buildTestRun({ treeSha: inp.commit, stage: inp.stage, toolVersions, exp: inp.exp, raw: { reports: [], results: [], discovered: [], exitCode: code, buildFailed: true }, probeOk: () => true }), runner: "vitest" },
    build, reports: [], logs,
  });

  try {
    const t0 = Date.now();
    const toolVersions: Record<string, string> = { nodeImage: await rt.imageDigest(project.node.image) };
    copyTree(inp.repo, inp.commit, src);
    phase("copy", `lab: copied ${inp.commit.slice(0, 10)} (${secs(t0)})`);
    if (!existsSync(join(src, "package.json"))) {
      return failedRun({ kind: "build", ok: false, errors: [{ file: "package.json", line: 0, code: "NO-APP", msg: "the repo has no package.json at its root" }] }, toolVersions);
    }

    // install: only the npm registry, through the feed proxy; install scripts never run
    const tInstall = Date.now();
    const r = await launch({
      role: "restore", image: project.node.image, network: FEEDS_NET, workdir: "/src",
      env: { ...NODE_ENV, HTTPS_PROXY: FEED_PROXY_URL, HTTP_PROXY: FEED_PROXY_URL },
      mounts: [{ src, dst: "/src" }, { src: cache, dst: "/npm-cache" }], cmd: INSTALL_CMD,
    });
    const rCode = await rt.wait(r, project.node.buildTimeoutSec * 1000);
    logs.restore = await rt.logs(r);
    phase("restore", `lab: npm install ${rCode === 0 ? "ok" : `FAILED (exit ${rCode ?? "timeout"})`} (${secs(tInstall)})`, rCode === 0 ? undefined : { logTail: logs.restore.split("\n").slice(-40).join("\n") });
    await finish(r);
    const installFailed: BuildRun = { kind: "build", ok: false, errors: [{ file: "package.json", line: 0, code: "RESTORE", msg: `npm install failed (exit ${rCode ?? "timeout"})` }] };
    if (inp.restoreOnly) return failedRun(rCode === 0 ? { kind: "build", ok: true, errors: [] } : installFailed, toolVersions, rCode === 0 ? 0 : 1);
    if (rCode !== 0) return failedRun(installFailed, toolVersions);

    // build, no network (a package with no build script builds nothing)
    const tBuild = Date.now();
    const b = await launch({ role: "producer", image: project.node.image, network: "none", workdir: "/src", env: NODE_ENV, mounts: [{ src, dst: "/src" }, { src: cache, dst: "/npm-cache", ro: true }], cmd: ["npm", "run", "build", "--if-present"] });
    const bCode = await rt.wait(b, project.node.buildTimeoutSec * 1000);
    await rt.stop(b);
    logs.build = await rt.logs(b);
    await finish(b);
    phase("build", `lab: build ${bCode === 0 ? "ok" : `FAILED (exit ${bCode ?? "timeout"})`} (${secs(tBuild)})`, bCode === 0 ? undefined : { logTail: logs.build.split("\n").slice(-40).join("\n") });
    if (bCode !== 0) {
      const errors = parseNodeBuildErrors(logs.build);
      return failedRun({ kind: "build", ok: false, errors: errors.length ? errors : [{ file: "", line: 0, code: "BUILD", msg: `npm run build failed (exit ${bCode ?? "timeout"}): ${logs.build.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400)}` }] }, toolVersions);
    }
    const build: BuildRun = { kind: "build", ok: true, errors: [] };

    let accept: AcceptResult | undefined;
    if (inp.accept) {
      accept = await bootAndProbe(inp, src, cache, launch, finish);
      phase("app", accept.boot.attempted ? `lab: app ${accept.boot.ok ? `started, first answer HTTP ${accept.boot.firstStatus}` : `DIDN'T START: ${accept.boot.note}`} (${((accept.boot.ms ?? 0) / 1000).toFixed(0)}s)` : `lab: app not booted: ${accept.boot.note}`,
        accept.boot.ok ? undefined : { logTail: accept.boot.logTail });
      for (const p of accept.probes) phase("probe", `lab: probe ${p.method} ${p.path} → ${p.status} (expected ${p.expectStatus})`);
    }

    const runTests = async (pattern: string | undefined, resultsDir: string) => {
      const started = Date.now();
      const t = await launch({
        role: "producer", image: project.node.image, network: "none", workdir: "/src", env: NODE_ENV,
        mounts: [{ src, dst: "/src" }, { src: cache, dst: "/npm-cache", ro: true }, { src: resultsDir, dst: "/results" }],
        cmd: ["npx", "--no-install", "vitest", "run", "--reporter=json", "--outputFile=/results/r.json", "--passWithNoTests", ...(pattern ? ["-t", pattern] : [])],
      });
      const code = await rt.wait(t, project.node.testTimeoutSec * 1000);
      await rt.stop(t);
      const log = await rt.logs(t);
      await finish(t);
      const reports = readdirSync(resultsDir).filter((f) => f.endsWith(".json")).map((f) => {
        const p = join(resultsDir, f);
        const content = readFileSync(p, "utf8");
        let parsed = true, results: TestResult[] = [], fileErrors: { file: string; message: string }[] = [];
        try { ({ results, fileErrors } = parseVitestJson(content)); } catch { parsed = false; }
        return { name: f, content, sha: sha256(content), parsed, writtenAfterStart: statSync(p).mtimeMs >= started - 1000, results, fileErrors };
      });
      return { code: code ?? 124, log, reports };
    };

    // a targeted run: the tests with these names (author-tests) or these IDs (accept); a full run otherwise
    const titles = inp.filterExpr ? undefined : inp.onlyTests?.length ? inp.onlyTests.map(titleOf) : undefined;
    const pattern = inp.filterExpr ?? (titles ? titlePattern(titles) : undefined);
    const tTests = Date.now();
    const first = await runTests(pattern, resTest);
    let results = first.reports.flatMap((r) => r.results);
    const fileErrors = first.reports.flatMap((r) => r.fileErrors);
    logs.test = first.log + (fileErrors.length ? `\n${fileErrors.map((e) => `${e.file} did not load: ${e.message}`).join("\n")}` : "");
    phase("tests", `lab: tests ran: ${results.length} (${results.filter((x) => x.outcome === "passed").length} passed, ${results.filter((x) => x.outcome === "failed").length} failed), exit ${first.code} (${secs(tTests)})${fileErrors.length ? `; ${fileErrors.length} test file(s) did not load` : ""}`,
      first.reports.length && !fileErrors.length ? undefined : { logTail: logs.test.split("\n").slice(-40).join("\n") });

    const exp: Expectations = inp.resolveExp ? inp.resolveExp(results) : inp.exp;
    const again = rerunCandidates(results, exp, inp.knownFailures);
    if (again.length && again.length <= 20) {
      const dir = join(work, "results-rerun");
      mkdirSync(dir, { recursive: true });
      phase("rerun", `lab: re-running ${again.length} failed non-locked test(s) once`);
      const second = await runTests(titlePattern(again.map(titleOf)), dir);
      results = markFlaky(results, second.reports.flatMap((x) => x.results));
    }
    const expected = [...exp.expectPass, ...exp.expectFail.map((e) => e.id)];
    // a test file that failed to load ran none of its tests: with tests failing to load, the runner's non-zero exit is not "no test failed"
    const exitCode = fileErrors.length && !results.some((x) => x.outcome === "failed") ? 0 : first.code;
    const testRun = {
      ...buildTestRun({
        treeSha: inp.commit, stage: inp.stage, toolVersions, exp,
        raw: { reports: first.reports.map((x) => ({ sha: x.sha, parsed: x.parsed, writtenAfterStart: x.writtenAfterStart })), results, discovered: expected, exitCode },
        probeOk: () => true,
      }),
      runner: "vitest" as const,
    };
    return { testRun, build, reports: first.reports.map((x) => ({ name: x.name, content: x.content })), logs, accept };
  } finally {
    for (const id of live) await stopAndRemove(rt, id).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  }
}

/** The command that serves the built app on `port`: the package's start script, else vite preview. */
export function startCommand(pkgJson: string, port: number): string[] {
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(pkgJson) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { /* no scripts */ }
  if (scripts.start) return ["npm", "run", "start"];
  if (scripts.preview) return ["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  return [];
}

/** Accept: start the built app with no network, wait for any HTTP answer, send each locked probe, stop it before reading. */
async function bootAndProbe(
  inp: ProduceInput, src: string, cache: string,
  launch: (spec: Omit<ContainerSpec, "labels" | "user">) => Promise<string>, finish: (id: string) => Promise<void>,
): Promise<AcceptResult> {
  const { rt, project } = inp;
  const cfg = project.accept;
  const none = (note: string): AcceptResult => ({ boot: { attempted: false, ok: false, note, logTail: "" }, probes: [] });
  if (!cfg.bootApp) return none("booting the app is turned off for this project");
  const cmd = startCommand(readFileSync(join(src, "package.json"), "utf8"), cfg.port);
  if (!cmd.length) return none("package.json has no start or preview script");
  const base = `http://127.0.0.1:${cfg.port}`;
  const started = Date.now();
  const app = await launch({
    role: "app", image: project.node.image, network: "none", workdir: "/src",
    env: { ...NODE_ENV, PORT: String(cfg.port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", ...cfg.env },
    mounts: [{ src, dst: "/src" }, { src: cache, dst: "/npm-cache", ro: true }], cmd,
  });
  let firstStatus = 0, crashed = false;
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
  await rt.stop(app);
  const logTail = (await rt.logs(app)).split("\n").slice(-60).join("\n");
  await finish(app);
  return {
    boot: {
      attempted: true, ok: firstStatus > 0, project: cmd.join(" "), firstStatus, ms, logTail,
      note: firstStatus > 0 ? undefined : crashed ? `the app exited during startup after ${Math.round(ms / 1000)}s: ${logTail.split("\n").filter(Boolean).slice(-1)[0]?.trim().slice(0, 300) ?? ""}` : `no HTTP answer on ${cfg.readyPath} within ${cfg.readyTimeoutSec}s`,
    },
    probes,
  };
}
