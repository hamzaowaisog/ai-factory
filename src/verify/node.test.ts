import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { resolveTestIds } from "../stages/build.js";
import { labFor } from "./lab.js";
import { nodeNameFilter, parseNodeBuildErrors, produceNodeTests, startCommand } from "./node.js";
import { produceDotnetTests } from "./dotnet.js";
import type { ContainerRuntime, ContainerSpec } from "./runtime.js";
import { parseVitestJson, titleOf, titlePattern, vitestId } from "./vitest.js";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-node-"));
});

type T = { title: string; status: string; ancestors?: string[]; failure?: string };
const report = (files: { name: string; tests: T[]; status?: string; message?: string }[]) => JSON.stringify({
  testResults: files.map((f) => ({
    name: f.name, status: f.status ?? "passed", message: f.message ?? "",
    assertionResults: f.tests.map((t) => ({ ancestorTitles: t.ancestors ?? [], title: t.title, status: t.status, duration: 3.4, failureMessages: t.failure ? [t.failure] : [] })),
  })),
});

describe("vitest JSON", () => {
  it("parses results into file::describe > title IDs with failure kinds", () => {
    const { results, fileErrors } = parseVitestJson(report([{ name: "/src/tests/orders.test.ts", tests: [
      { title: "AC_1_1_ListsOrders", status: "passed", ancestors: ["orders"] },
      { title: "AC_1_2_RejectsEmpty", status: "failed", ancestors: ["orders"], failure: "AssertionError: expected 1 to be 2\n    at /src/tests/orders.test.ts:9:5\n    at node:internal/process" },
      { title: "AC_1_3_Saves", status: "failed", failure: "Error: not implemented\n    at save (/src/app/lib/orders.ts:3:9)" },
      { title: "Later", status: "skipped" },
    ] }]));
    expect(fileErrors).toEqual([]);
    expect(results.map((r) => [r.id, r.outcome, r.failureKind])).toEqual([
      ["tests/orders.test.ts::orders > AC_1_1_ListsOrders", "passed", undefined],
      ["tests/orders.test.ts::orders > AC_1_2_RejectsEmpty", "failed", "assertion"],
      ["tests/orders.test.ts::AC_1_3_Saves", "failed", "not-implemented"],
      ["tests/orders.test.ts::Later", "skipped", undefined],
    ]);
    expect(results[1]!.frames).toEqual(["at tests/orders.test.ts:9:5"]);
    expect(results[0]!.durationMs).toBe(3);
  });

  it("reports a file that failed to load, and refuses a report that is not vitest's", () => {
    const { results, fileErrors } = parseVitestJson(report([{ name: "/src/tests/a.test.ts", status: "failed", message: "Failed to load url @/lib/missing", tests: [] }]));
    expect(results).toEqual([]);
    expect(fileErrors).toEqual([{ file: "tests/a.test.ts", message: "Failed to load url @/lib/missing" }]);
    expect(() => parseVitestJson("{}")).toThrow(/vitest/);
  });

  it("builds IDs, titles and -t patterns", () => {
    const id = vitestId("tests/a.test.ts", ["x", "y"], "AC_1_1_A");
    expect(id).toBe("tests/a.test.ts::x > y > AC_1_1_A");
    expect(titleOf(id)).toBe("AC_1_1_A");
    expect(titleOf("tests/a.test.ts::CHAR_B")).toBe("CHAR_B");
    expect(titlePattern(["AC_1_1_A", "a.b", "AC_1_1_A"])).toBe("(AC_1_1_A|a\\.b)$");
    expect(nodeNameFilter(["CHAR_X"])).toBe("(CHAR_X)$");
  });
});

describe("Node build errors and start command", () => {
  it("reads tsc and Next.js errors, without duplicates", () => {
    const log = [
      "src/lib/a.ts(3,7): error TS2304: Cannot find name 'x'.",
      "/src/app/page.tsx:12:4 - error TS2322: Type 'string' is not assignable to type 'number'.",
      "/src/app/page.tsx:12:9 - error TS2322: again",
      "Failed to compile.",
      "./app/orders/page.tsx:5:10",
      "Type error: Property 'total' does not exist.",
    ].join("\n");
    expect(parseNodeBuildErrors(log)).toEqual([
      { file: "src/lib/a.ts", line: 3, code: "TS2304", msg: "Cannot find name 'x'." },
      { file: "app/page.tsx", line: 12, code: "TS2322", msg: "Type 'string' is not assignable to type 'number'." },
      { file: "app/orders/page.tsx", line: 5, code: "TS", msg: "Property 'total' does not exist." },
    ]);
    expect(parseNodeBuildErrors("npm ERR! something")).toEqual([]);
  });

  it("starts with npm start, else vite preview, else nothing", () => {
    expect(startCommand(JSON.stringify({ scripts: { start: "next start" } }), 5080)).toEqual(["npm", "run", "start"]);
    expect(startCommand(JSON.stringify({ scripts: { preview: "vite preview" } }), 5080)).toEqual(["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", "5080", "--strictPort"]);
    expect(startCommand(JSON.stringify({ scripts: {} }), 5080)).toEqual([]);
    expect(startCommand("not json", 5080)).toEqual([]);
  });
});

describe("lab by stack", () => {
  it("picks the Node lab for node and the .NET lab otherwise", () => {
    expect(labFor({ stack: "node" }).produce).toBe(produceNodeTests);
    expect(labFor({ stack: "dotnet" }).produce).toBe(produceDotnetTests);
    expect(labFor({ stack: "node" }).nameFilter(["AC_1_1_A", "CHAR_B"])).toBe("(AC_1_1_A|CHAR_B)$");
    expect(labFor({ stack: "dotnet" }).nameFilter(["AC_1_1_A", "CHAR_B"])).toBe("FullyQualifiedName~.AC_1_1_A|FullyQualifiedName~.CHAR_B");
  });

  it("finds Node test IDs by their titles", () => {
    const ids = ["tests/a.test.ts::orders > AC_1_1_Lists", "tests/a.test.ts::CHAR_Totals", "tests/b.test.ts::x > AC_1_10_Other"];
    const r = resolveTestIds(["AC_1_1_Lists", "CHAR_Totals", "AC_1_1_Other"], ids);
    expect(r.ids).toEqual({ AC_1_1_Lists: [ids[0]], CHAR_Totals: [ids[1]] });
    expect(r.missing).toEqual(["AC_1_1_Other"]);
  });
});

/** A fake runtime: records specs; a vitest container writes `reports` in turn into its results mount. */
class FakeRuntime implements ContainerRuntime {
  binary = "fake";
  specs = new Map<string, ContainerSpec>();
  removed: string[] = [];
  n = 0;
  constructor(private readonly behave: { install?: number; build?: number; buildLog?: string; reports?: string[]; exit?: number }) {}
  async version() { return "fake"; }
  async create(s: ContainerSpec) { const id = `c${++this.n}`; this.specs.set(id, s); return id; }
  async start() {}
  async wait(id: string) {
    const s = this.specs.get(id)!;
    if (s.role === "restore") return this.behave.install ?? 0;
    if (s.cmd.includes("build")) return this.behave.build ?? 0;
    if (s.cmd.includes("vitest")) {
      const res = s.mounts.find((m) => m.dst === "/results")!;
      writeFileSync(join(res.src, "r.json"), this.behave.reports?.shift() ?? report([]));
      return this.behave.exit ?? 0;
    }
    return 0;
  }
  async exec() { return { code: 0, stdout: "", stderr: "" }; }
  async isRunning() { return true; }
  async logs(id: string) { return this.specs.get(id)!.cmd.includes("build") ? this.behave.buildLog ?? "" : ""; }
  async stop() {}
  async remove(id: string) { this.removed.push(id); }
  async listByLabel() { return []; }
  async imageDigest(i: string) { return `${i}@sha256:x`; }
}

function repoWithCommit(files: Record<string, string>): { repo: string; commit: string } {
  const repo = mkdtempSync(join(tmpdir(), "factory-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q"], { cwd: repo, env });
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), c); }
  execFileSync("git", ["add", "."], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", "i"], { cwd: repo, env });
  return { repo, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim() };
}

describe("Node producer (fake runtime)", () => {
  const project = ProjectConfig.parse({ project: "shop", repo: "/x", stack: "node" });
  const app = { "package.json": JSON.stringify({ scripts: { build: "next build", start: "next start" } }), "tests/a.test.ts": "" };
  const pass = report([{ name: "/src/tests/a.test.ts", tests: [{ title: "AC_1_1_A", status: "passed" }] }]);

  it("installs through the proxy, builds and tests offline, cleans up", async () => {
    const { repo, commit } = repoWithCommit(app);
    const rt = new FakeRuntime({ reports: [pass] });
    const out = await produceNodeTests({
      runId: "r1", key: "implement/TASK-1/1", repo, commit, stage: "task", project, rt,
      exp: { expectPass: ["tests/a.test.ts::AC_1_1_A"], expectFail: [], compareToBaseline: [] },
    });
    expect(out.testRun.valid).toBe(true);
    expect(out.testRun.classification).toBe("ok");
    expect(out.testRun.runner).toBe("vitest");
    const specs = [...rt.specs.values()];
    const install = specs.find((s) => s.role === "restore")!;
    const build = specs.find((s) => s.cmd.includes("build"))!;
    const test = specs.find((s) => s.cmd.includes("vitest"))!;
    expect(install.network).not.toBe("none");
    expect(install.env.HTTPS_PROXY).toBeTruthy();
    expect(install.cmd.join(" ")).toMatch(/--ignore-scripts/);
    expect(build.network).toBe("none");
    expect(test.network).toBe("none");
    expect(test.cmd).not.toContain("-t");
    expect(test.mounts.find((m) => m.dst === "/npm-cache")?.ro).toBe(true);
    expect(rt.removed.sort()).toEqual([...rt.specs.keys()].sort());
  });

  it("runs only the named tests with -t", async () => {
    const { repo, commit } = repoWithCommit(app);
    const rt = new FakeRuntime({ reports: [pass] });
    await produceNodeTests({
      runId: "r1", key: "k", repo, commit, stage: "task", project, rt, onlyTests: ["tests/a.test.ts::d > AC_1_1_A"],
      exp: { expectPass: ["tests/a.test.ts::d > AC_1_1_A"], expectFail: [], compareToBaseline: [] },
    });
    const test = [...rt.specs.values()].find((s) => s.cmd.includes("vitest"))!;
    expect(test.cmd.slice(-2)).toEqual(["-t", "(AC_1_1_A)$"]);
  });

  it("re-runs a failed test once and marks it flaky when it passes", async () => {
    const { repo, commit } = repoWithCommit(app);
    const fail = report([{ name: "/src/tests/a.test.ts", tests: [{ title: "AC_1_1_A", status: "passed" }, { title: "CHAR_B", status: "failed", failure: "AssertionError: x" }] }]);
    const again = report([{ name: "/src/tests/a.test.ts", tests: [{ title: "CHAR_B", status: "passed" }] }]);
    const rt = new FakeRuntime({ reports: [fail, again], exit: 1 });
    const out = await produceNodeTests({
      runId: "r1", key: "k", repo, commit, stage: "task", project, rt,
      exp: { expectPass: ["tests/a.test.ts::AC_1_1_A"], expectFail: [], compareToBaseline: [] },
    });
    const tests = [...rt.specs.values()].filter((s) => s.cmd.includes("vitest"));
    expect(tests).toHaveLength(2);
    expect(tests[1]!.cmd.slice(-2)).toEqual(["-t", "(CHAR_B)$"]);
    expect(out.testRun.results.find((r) => r.id.endsWith("CHAR_B"))?.flaky).toBe(true);
  });

  it("reports build errors from the log", async () => {
    const { repo, commit } = repoWithCommit(app);
    const rt = new FakeRuntime({ build: 1, buildLog: "src/lib/a.ts(3,7): error TS2304: Cannot find name 'x'." });
    const out = await produceNodeTests({ runId: "r1", key: "k", repo, commit, stage: "task", project, rt, exp: { expectPass: [], expectFail: [], compareToBaseline: [] } });
    expect(out.build.ok).toBe(false);
    expect(out.build.errors).toEqual([{ file: "src/lib/a.ts", line: 3, code: "TS2304", msg: "Cannot find name 'x'." }]);
    expect(out.testRun.classification).toBe("code");
    expect([...rt.specs.values()].some((s) => s.cmd.includes("vitest"))).toBe(false);
  });

  it("fails an install, and a repo with no package.json, without building", async () => {
    const a = repoWithCommit(app);
    const rt = new FakeRuntime({ install: 1 });
    const out = await produceNodeTests({ runId: "r1", key: "k", repo: a.repo, commit: a.commit, stage: "task", project, rt, exp: { expectPass: [], expectFail: [], compareToBaseline: [] } });
    expect(out.build.errors[0]!.code).toBe("RESTORE");
    expect(rt.specs.size).toBe(1);

    const b = repoWithCommit({ "README.md": "x" });
    const rt2 = new FakeRuntime({});
    const out2 = await produceNodeTests({ runId: "r1", key: "k", repo: b.repo, commit: b.commit, stage: "task", project, rt: rt2, exp: { expectPass: [], expectFail: [], compareToBaseline: [] } });
    expect(out2.build.errors[0]!.code).toBe("NO-APP");
    expect(rt2.specs.size).toBe(0);
  });

  it("refuses a project with a test database", async () => {
    const withDb = ProjectConfig.parse({ project: "shop", repo: "/x", stack: "node", database: {} });
    const { repo, commit } = repoWithCommit(app);
    await expect(produceNodeTests({ runId: "r1", key: "k", repo, commit, stage: "task", project: withDb, rt: new FakeRuntime({}), exp: { expectPass: [], expectFail: [], compareToBaseline: [] } })).rejects.toThrow(/database/);
  });
});
