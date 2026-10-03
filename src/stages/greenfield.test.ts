// End to end: a new product (greenfield, the PR #11 review's follow-up). An approved design made with no repo is built into an
// empty repo: discover finds nothing to test, stub-commit writes the scaffold, the tests and the screen's behaviour are written
// by (fake) coding agents and judged by a fake Node lab (npm, vitest JSON), through to a delivered branch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import "../gates/predicates.js";
import { _resetEnvCache } from "../config/env.js";
import { seedEmptyRepo } from "../config/greenfield.js";
import { ensureStandaloneProject } from "../config/project.js";
import { approvedDesign } from "../estimate/lineage.js";
import { verifyEvidence } from "../gates/engine.js";
import { decide } from "../ledger/human.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { setSkipInfra } from "../runners/netinfra.js";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { packageOfRun } from "./design-fidelity.js";
import { createRun, execute } from "./executor.js";
import { setProviderFactory } from "./think.js";
import { setRuntime } from "./workspace.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const AC = "AC_1_1_SignsInWithEmail";
const DONE = "/* IMPLEMENTED */";

// ---------- the approved design, made with no repo ----------
const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the queue", traits: ["dense", "quiet"] }, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "calm" }] };
const mock = { title: "Sign in", blocks: [{ type: "form", fields: [{ label: "Email", kind: "email" }], submit: "Sign in" }], copy: {} };
const intent = { source: "cli", spans: [{ id: "I-1", text: "a portal where clinic staff sign in" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true };
const spec = {
  requirements: [{ id: "REQ-1", ears: "When a user gives their email, the portal shall sign them in.", op: "ADDED", sources: ["I-1"], anchors: [],
    acceptance: [{ id: "AC-1.1", given: "a known email", when: "the user signs in", then: "the portal says Signed in", level: "unit" }] }],
  nfrs: [], outOfScope: [], assumptions: [], suggestions: [], lint: [], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] },
};

async function designRun(): Promise<string> {
  ensureStandaloneProject();
  const runId = await createRun("A portal where clinic staff sign in", "standalone-estimates", "tester", { mode: "design", estimate: { noRepo: true } });
  const l = Ledger.open(runId);
  const designSha = l.putJson({ flow: "A user signs in", theme, noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock }] });
  const done = async (step: string, outputs: string[], data: Record<string, unknown> = {}) =>
    l.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs, data: { ...data, named: { [step]: outputs[0], ...(data.named as object) } } }, HUMAN_WRITER);
  await done("intake", [l.putJson(intent)]);
  await done("specify", [l.putJson(spec)], { named: { critic: l.putJson({ findings: [] }) } });
  await done("design", [designSha]);
  const bundle = l.putJson({ design: designSha, demo: l.putArtifact(Buffer.from("<!doctype html><title>demo</title>")) });
  await l.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
  await l.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
  await done("design-baseline", [l.putJson({ ui: true, design: designSha, by: "lead" })], { ui: true });
  return runId;
}

// ---------- scripted model: the planner reads the scaffold it is given; the reviewer finds nothing ----------
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const prompts: { system: string; user: string }[] = [];
function answerFor(system: string, user: string): unknown {
  if (system.includes("plan the implementation")) {
    const containers = [...user.matchAll(/"container":\s*"([^"]+)"/g)].map((m) => m[1]!);
    const ds = /"designSystemTask":\s*\{\s*"fileScope":\s*(\[[^\]]*\])/.exec(user);
    const dsFiles = ds ? (JSON.parse(ds[1]!) as string[]) : [];
    return {
      tasks: [{ id: "TASK-1", title: "Sign-in screen", reqs: ["REQ-1"], fileScope: [...dsFiles, ...containers], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 20, approach: "wire the sign-in form in the screen's container" }],
      options: [{ id: "O-1", summary: "the screen's container", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "a separate auth module", simplest: false, tradeoffs: "more code" }],
      chosen: "O-1", adr: "Build it in the container the scaffold made.", protectedPathsDeclared: [], newDependencies: [], stubs: [],
    };
  }
  if (system.includes("review a finished change")) return { findings: [] };
  throw new Error(`unscripted system prompt: ${system.slice(0, 80)}`);
}
const provider: Provider = {
  start(_model, _e, system, user): Conversation {
    prompts.push({ system, user });
    return {
      async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answerFor(system, user) }], text: "", stop: "tool_use", usage: U }; },
      toolResults() {}, say() {},
    };
  },
};

// ---------- a fake Node lab: npm install makes node_modules, vitest passes the AC test once the container is implemented ----------
class NodeLab implements ContainerRuntime {
  binary = "fake";
  specs = new Map<string, ContainerSpec>();
  n = 0;
  jobs: { fileScope: string[]; system: string }[] = [];
  /** the screen's container, as the planner scoped it */
  container = "";
  async version() { return "fake"; }
  async create(s: ContainerSpec) { const id = `c${++this.n}`; this.specs.set(id, s); return id; }
  async start() {}
  async wait(id: string) {
    const s = this.specs.get(id)!;
    const mount = (dst: string) => s.mounts.find((m) => m.dst === dst)?.src;
    if (s.role === "agent") {
      const work = mount("/work")!, out = mount("/job/out")!;
      const job = JSON.parse(readFileSync(mount("/job/in.json")!, "utf8")) as { fileScope: string[]; system: string };
      this.jobs.push(job);
      const result = (output: unknown) => writeFileSync(join(out, "result.json"), JSON.stringify({ status: "ok", output, instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 5000, output_tokens: 800 }, costUsd: 0.05, turns: 6 }));
      if (job.fileScope.includes("tests/**")) {
        mkdirSync(join(work, "tests"), { recursive: true });
        writeFileSync(join(work, "tests", "sign-in.test.ts"), `import { it, expect } from "vitest";\nit("${AC}", () => { expect(1).toBe(1); });\n`);
        result({ tests: [{ acId: "AC-1.1", file: "tests/sign-in.test.ts", name: AC }], characterisation: [], probes: [], notes: "" });
      } else {
        this.container = job.fileScope.find((f) => f.endsWith("container.tsx"))!;
        writeFileSync(join(work, this.container), `${readFileSync(join(work, this.container), "utf8")}\n${DONE}\n`);
        result({ done: true, filesChanged: [this.container], notes: "" });
      }
      return 0;
    }
    const src = mount("/src");
    if (s.role === "restore") { mkdirSync(join(src!, "node_modules"), { recursive: true }); return 0; }
    if (s.cmd.includes("vitest")) {
      const tests = existsSync(join(src!, "tests")) ? readdirSync(join(src!, "tests")).filter((f) => f.endsWith(".test.ts")) : [];
      const t = s.cmd.indexOf("-t");
      const only = t >= 0 ? new RegExp(s.cmd[t + 1]!) : undefined;
      const scope = readdirSync(src!, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("container.tsx") && !f.includes("node_modules"));
      const implemented = scope.some((f) => readFileSync(join(src!, f), "utf8").includes(DONE));
      const testResults = tests.map((f) => ({
        name: `/src/tests/${f}`, status: implemented ? "passed" : "failed",
        assertionResults: [...readFileSync(join(src!, "tests", f), "utf8").matchAll(/it\("([^"]+)"/g)].map((m) => m[1]!).filter((title) => !only || only.test(title))
          .map((title) => (implemented ? { ancestorTitles: [], title, status: "passed", duration: 3 } : { ancestorTitles: [], title, status: "failed", duration: 3, failureMessages: ["AssertionError: expected 'Not signed in' to be 'Signed in'\n    at /src/tests/sign-in.test.ts:2:40"] })),
      }));
      writeFileSync(join(mount("/results")!, "r.json"), JSON.stringify({ testResults }));
      return testResults.some((f) => f.status === "failed") ? 1 : 0;
    }
    return 0; // npm run build
  }
  async exec(id: string, cmd: string[]) {
    if (this.specs.get(id)!.role === "app" && cmd[0] === "curl") return { code: 0, stdout: cmd.includes("-o") ? "200" : "ok\n200", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }
  async isRunning() { return true; }
  async logs() { return "ready on http://127.0.0.1:3000"; }
  async stop() {}
  async remove() {}
  async listByLabel() { return []; }
  async imageDigest(i: string) { return `${i}@sha256:fake`; }
}

let lab: NodeLab;
let repo: string;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-gf-e2e-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  repo = mkdtempSync(join(tmpdir(), "factory-gf-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  seedEmptyRepo(repo);
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo, stack: "node", design: { fidelity: false } }));
  lab = new NodeLab();
  setRuntime(lab);
  setSkipInfra(true);
  setProviderFactory(() => provider);
  prompts.length = 0;
});

describe("a new product end to end (greenfield, fakes)", () => {
  it("builds an approved design with no repo into an empty repo: scaffold, tests, code, delivered", async () => {
    const design = await designRun();
    const runId = await createRun("A portal where clinic staff sign in", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(design) });
    const ledger = Ledger.open(runId);

    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    const s1 = replay(ledger.events());
    expect(s1.openCard?.kind).toBe("approval");
    // nothing to test in an empty repo; the spec and intent came from the design run, the ground stands in for a new product
    expect(s1.steps.get("discover")!.status).toBe("completed");
    expect(readFileSync(join(ledger.dir, "run.log"), "utf8")).toMatch(/the repo is empty \(a new product\)/);
    expect(s1.steps.get("ground")!.data).toMatchObject({ newProduct: true });
    // the planner saw the scaffold of a fresh app
    const plan = prompts.find((p) => p.system.includes("plan the implementation"))!;
    expect(plan.system).toMatch(/TypeScript web app/);
    expect(plan.user).toMatch(/"freshApp":\s*true/);
    await decide(ledger, { decision: "approve", hashPrefix: s1.openCard!.artifactSha.slice(0, 6), by: "lead" });

    const done = await execute(runId);
    expect(done.status, done.message).toBe("delivered");
    const s2 = replay(ledger.events());
    for (const step of ["discover", "intake", "specify", "ground", "plan", "approve", "stub-commit", "author-tests", "implement/TASK-1", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]) {
      expect(s2.steps.get(step)?.status, step).toBe("completed");
    }
    expect(s2.steps.get("stub-commit")!.data).toMatchObject({ scaffold: { target: "next-shadcn", files: expect.any(Number) } });
    // the app the factory generated is not the agents' change: the size and test-infrastructure checks start after the scaffold
    expect(s2.gates.map((g) => `${g.gateId}:${g.passed}`)).toEqual(expect.arrayContaining(["author-tests.fails-on-base:true", "integrate.diff-size:true", "task.lock-set-unchanged:true", "deliver.sha-binding:true"]));
    const reviewed = prompts.find((p) => p.system.includes("review a finished change"))!.user;
    expect(reviewed).toContain(lab.container);
    expect(reviewed).not.toContain("vitest.config.ts");
    // the design package was written under the standalone project it was drawn in, and this run finds it there
    expect(packageOfRun(s2, ledger)?.manifest.run.id).toBe(design);
    // the agents were told about a TypeScript app; the lab ran npm and vitest, never dotnet
    expect(lab.jobs.map((j) => j.system).join("\n")).toMatch(/vitest/);
    const cmds = [...lab.specs.values()].map((s) => s.cmd.join(" "));
    expect(cmds.some((c) => c.includes("dotnet"))).toBe(false);
    expect(cmds.filter((c) => c.includes("vitest")).length).toBeGreaterThan(0);
    // the branch: the scaffold, the tests, the screen's code, on the empty base commit
    const log = execFileSync("git", ["log", "--format=%s", `main..factory/${runId}`], { cwd: repo, encoding: "utf8" }).trim().split("\n");
    expect(log.some((l) => /scaffold next-shadcn/.test(l))).toBe(true);
    const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", `factory/${runId}`], { cwd: repo, encoding: "utf8" });
    expect(tree).toMatch(/^package\.json$/m);
    expect(tree).toMatch(/^tests\/sign-in\.test\.ts$/m);
    expect(tree).not.toMatch(/node_modules/);
    expect(execFileSync("git", ["show", `factory/${runId}:${lab.container}`], { cwd: repo, encoding: "utf8" })).toContain(DONE);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  it("refuses to start a new product in a repo that has code, and a design with a repo as a greenfield run", async () => {
    const design = await designRun();
    writeFileSync(join(repo, "index.ts"), "export {};\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "code"], { cwd: repo, env });
    await expect(createRun("x", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(design) })).rejects.toThrow(/already has code/);
    await expect(createRun("x", "shop", "tester", { fromDesign: approvedDesign(design) })).rejects.toThrow(/build it as a greenfield run/);
    await expect(createRun("x", "shop", "tester", { mode: "greenfield", fromDesign: { ...approvedDesign(design), repo: true } })).rejects.toThrow(/designed with no repo/);
  });
});
