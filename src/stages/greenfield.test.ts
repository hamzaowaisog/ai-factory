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
import { approvedDesign, approvedEstimate } from "../estimate/lineage.js";
import { verifyEvidence } from "../gates/engine.js";
import { decide } from "../ledger/human.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { setSkipInfra } from "../runners/netinfra.js";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { findChromium } from "../design/screenshots.js";
import { FIDELITY_DIR, packageOfRun } from "./design-fidelity.js";
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

// (a drafted spec is linted: its Then names something observable)
const CONTRACT = `openapi: 3.0.3
info: { title: Clinic portal, version: "1" }
paths:
  /api/sign-in:
    post:
      operationId: signIn
      requestBody: { required: true, content: { application/json: { schema: { type: object, required: [email], properties: { email: { type: string } } } } } }
      responses:
        "200": { description: signed in, content: { application/json: { schema: { type: object, required: [message], properties: { message: { type: string } } }, example: { message: Signed in } } } }
`;
let planContract: string | undefined = CONTRACT;
const draft = { requirements: spec.requirements.map((r) => ({ ...r, acceptance: r.acceptance.map((a) => ({ ...a, then: "the screen shows Signed in" })) })), nfrs: [], outOfScope: [], assumptions: [], suggestions: [] };

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
  // the demo holds the screen and its first state, so a fidelity check can open it beside the built page
  const demo = `<!doctype html><title>demo</title><section id="S-1"><button data-state="0">Default</button><h1>Sign in</h1><form><label>Email<input type="email"></label><button>Sign in</button></form></section>`;
  const bundle = l.putJson({ design: designSha, demo: l.putArtifact(Buffer.from(demo)) });
  await l.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
  await l.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
  await done("design-baseline", [l.putJson({ ui: true, design: designSha, by: "lead" })], { ui: true });
  return runId;
}

/** An approved estimate made with no repo (a new product): its spec, its approved design, one estimate task, approved by a person. */
async function estimateRun(): Promise<string> {
  ensureStandaloneProject();
  const runId = await createRun("A portal where clinic staff sign in", "standalone-estimates", "tester", { mode: "estimate", estimate: { noRepo: true } });
  const l = Ledger.open(runId);
  const designSha = l.putJson({ flow: "A user signs in", theme, noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock }] });
  const done = async (step: string, outputs: string[], data: Record<string, unknown> = {}) =>
    l.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs, data: { ...data, named: { [step]: outputs[0], ...(data.named as object) } } }, HUMAN_WRITER);
  const range = (min: number, max: number) => ({ min, max });
  await done("intake", [l.putJson(intent)]);
  await done("specify", [l.putJson(spec)], { named: { critic: l.putJson({ findings: [] }) } });
  await done("design", [designSha]);
  // gate E1b: a person approved the design and its demo
  const demo = `<!doctype html><title>demo</title><section id="S-1"><button data-state="0">Default</button><h1>Sign in</h1><form><label>Email<input type="email"></label><button>Sign in</button></form></section>`;
  const bundle = l.putJson({ design: designSha, demo: l.putArtifact(Buffer.from(demo)) });
  await l.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
  await l.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
  await done("design-baseline", [l.putJson({ ui: true, design: designSha, by: "lead" })], { ui: true });
  await done("breakdown", [l.putJson({ tasks: [{ id: "EST-1", title: "Sign-in screen", reqs: ["REQ-1"], track: "frontend", executor: "agent", items: [], screen: "S-1" }] })]);
  await done("estimate", [l.putJson({ deliveryModel: "agentic", tasks: [{ taskId: "EST-1", hours: range(4, 40) }], totals: { overall: range(4, 40), byTrack: { frontend: range(4, 40) } }, apiCost: { total: range(1, 500) }, elapsed: { criticalPathDays: range(1, 30) } })]);
  await done("approve-estimate", [l.putJson({ by: "lead" })], { by: "lead" });
  await done("export", [l.putJson({})]);
  return runId;
}

// ---------- scripted model: the planner reads the scaffold it is given; the reviewer finds nothing ----------
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const prompts: { system: string; user: string }[] = [];
/** A scripted review must now account for every acceptance criterion, as a real one must. */
function scriptedReview(user: string, findings: unknown[] = []) {
  const acIds = [...new Set([...user.matchAll(/"id":\s*"(AC-[\w.-]+)"/g)].map((m) => m[1]!))];
  return { findings, coverage: acIds.map((acId) => ({ acId, testId: "", verdict: "proves-it" as const, why: "scripted" })) };
}

function answerFor(system: string, user: string): unknown {
  if (system.includes("plan the implementation")) {
    const containers = [...user.matchAll(/"container":\s*"([^"]+)"/g)].map((m) => m[1]!);
    const ds = /"designSystemTask":\s*\{\s*"fileScope":\s*(\[[^\]]*\])/.exec(user);
    const dsFiles = ds ? (JSON.parse(ds[1]!) as string[]) : [];
    return {
      tasks: [{ id: "TASK-1", title: "Sign-in screen", reqs: ["REQ-1"], fileScope: [...dsFiles, ...containers], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 20, approach: "wire the sign-in form in the screen's container",
        // a build from an approved estimate: the task delivers its estimate task (gate B1)
        ...(system.includes("APPROVED ESTIMATE") ? { estimateTaskId: "EST-1" } : {}) }],
      options: [{ id: "O-1", summary: "the screen's container", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "a separate auth module", simplest: false, tradeoffs: "more code" }],
      chosen: "O-1", adr: "Build it in the container the scaffold made.", protectedPathsDeclared: [], newDependencies: [],
      // asked for the product's API contract (a project with `contract`): the plan gives it as a stub, unless this test leaves it out
      stubs: system.includes("API CONTRACT.") && planContract ? [{ path: "contracts/openapi.yaml", content: planContract, reason: "the API contract" }] : [],
    };
  }
  if (system.includes("review a finished change")) return scriptedReview(user);
  // a run that starts from the request alone (no design run): the head of the pipeline, then the design on the kit
  if (system.includes("intake step")) return intent;
  // the spec's open problems are settled by questions in a build too: none to ask here, so they are carried as open risks
  if (system.includes("these problems are still open")) return { questions: [], inRequest: [] };
  if (system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "staff sign in with their email", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: [{ mergedReq: "REQ-1", from: ["d1:REQ-1"] }], conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Staff sign in with their email." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("drawing the screen inventory")) {
    const drawn = { title: "Sign in", blocks: [{ type: "form", fields: [{ label: "Email", kind: "email" }], submit: "Sign in" }, { type: "actions", buttons: ["Need help"] }], copy: {} };
    return { flow: "A user signs in", theme: { ...theme, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "one blue action" }] }, noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", frames: [], mock: drawn, mockFull: drawn }] };
  }
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
  /** an agent that adds a package on its own (edits package.json), to show the checks still catch it */
  addsPackage?: "test-writer";
  /** an implementer that rewrites the locked API contract */
  editsContract = false;
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
      const addPackage = () => { const f = join(work, "package.json"); const j = JSON.parse(readFileSync(f, "utf8")) as { dependencies?: Record<string, string> }; writeFileSync(f, JSON.stringify({ ...j, dependencies: { ...j.dependencies, "left-pad": "1.3.0" } }, null, 2)); };
      if (this.addsPackage && job.fileScope.includes("tests/**")) addPackage();
      const result = (output: unknown) => writeFileSync(join(out, "result.json"), JSON.stringify({ status: "ok", output, instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 5000, output_tokens: 800 }, costUsd: 0.05, turns: 6 }));
      if (job.fileScope.includes("tests/**")) {
        mkdirSync(join(work, "tests"), { recursive: true });
        writeFileSync(join(work, "tests", "sign-in.test.ts"), `import { it, expect } from "vitest";\nit("${AC}", () => { expect(1).toBe(1); });\n`);
        result({ tests: [{ acId: "AC-1.1", file: "tests/sign-in.test.ts", name: AC }], characterisation: [], probes: [], notes: "" });
      } else {
        if (this.editsContract) writeFileSync(join(work, "contracts", "openapi.yaml"), readFileSync(join(work, "contracts", "openapi.yaml"), "utf8").replace("message:", "text:"));
        this.container = job.fileScope.find((f) => f.endsWith("container.tsx"))!;
        writeFileSync(join(work, this.container), `${readFileSync(join(work, this.container), "utf8")}\n${DONE}\n`);
        result({ done: true, filesChanged: [this.container], notes: "" });
      }
      return 0;
    }
    const src = mount("/src");
    if (s.role === "restore") {
      mkdirSync(join(src!, "node_modules"), { recursive: true });
      // as real npm does: an install with no lockfile writes one (a real-container run parked on this file twice)
      if (!existsSync(join(src!, "package-lock.json"))) writeFileSync(join(src!, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`node_modules/p${i}`, { version: "1.0.0" }])) }, null, 2)}\n`);
      return 0;
    }
    if (s.cmd.includes("orval")) {
      // the generator: reads the contract and its settings in the checkout, writes the client and its test handlers
      const ops = [...readFileSync(join(src!, "contracts", "openapi.yaml"), "utf8").matchAll(/operationId: (\w+)/g)].map((m) => m[1]!);
      mkdirSync(join(src!, "lib", "api"), { recursive: true });
      writeFileSync(join(src!, "lib", "api", "client.ts"), ops.map((o) => `export const ${o} = async () => fetch("http://localhost:5080");\n`).join(""));
      writeFileSync(join(src!, "lib", "api", "client.msw.ts"), `export const getApiMock = () => [];\n`);
      return existsSync(join(src!, "orval.config.cjs")) && existsSync(join(src!, "node_modules")) ? 0 : 1;
    }
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
let home: string;
const writeProject = (design: Record<string, unknown>) => writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo, stack: "node", design }));
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-gf-e2e-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  repo = mkdtempSync(join(tmpdir(), "factory-gf-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  seedEmptyRepo(repo);
  mkdirSync(join(home, "projects"), { recursive: true });
  writeProject({ fidelity: false });
  lab = new NodeLab();
  setRuntime(lab);
  setSkipInfra(true);
  setProviderFactory(() => provider);
  prompts.length = 0;
  planContract = CONTRACT;
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
    // the first install's lockfile is committed as part of the scaffold: not the test writer's change, not the agents' diff
    expect(log.some((l) => /lockfile from the scaffold's first install/.test(l))).toBe(true);
    expect(tree).toMatch(/^package-lock\.json$/m);
    const scaffoldCommit = (s2.steps.get("stub-commit")!.data!.scaffold as { commit: string }).commit;
    expect(execFileSync("git", ["show", "--stat", "--format=%s", scaffoldCommit], { cwd: repo, encoding: "utf8" })).toMatch(/lockfile from the scaffold[\s\S]*package-lock\.json/);
    expect(tree).toMatch(/^package\.json$/m);
    expect(tree).toMatch(/^tests\/sign-in\.test\.ts$/m);
    expect(tree).not.toMatch(/node_modules/);
    expect(execFileSync("git", ["show", `factory/${runId}:${lab.container}`], { cwd: repo, encoding: "utf8" })).toContain(DONE);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  it("one run from the request alone: reads it, writes the spec, draws the design on the kit, then builds it", async () => {
    // no mode and no design run: a plain start on a Node project whose repo is empty
    const runId = await createRun("A portal where clinic staff sign in", "shop", "tester");
    const ledger = Ledger.open(runId);
    expect(replay(ledger.events()).info.mode).toBe("greenfield");
    // every greenfield run asks (settles its spec and design checks by questions), fixed at the start
    expect(replay(ledger.events()).info.asks).toBe(true);

    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    const s1 = replay(ledger.events());
    expect(s1.openCard?.kind).toBe("design-approval");
    expect(s1.steps.get("ground")!.data).toMatchObject({ newProduct: true });
    // the design was drawn onto the factory's kit, as a new app
    const drew = prompts.find((p) => p.system.includes("drawing the screen inventory"))!;
    expect(`${drew.system}\n${drew.user}`).toMatch(/NEW APP FROM A STARTER[\s\S]*ai-factory kit shadcn/);
    await decide(ledger, { decision: "approve", hashPrefix: s1.openCard!.artifactSha.slice(0, 6), by: "lead" });

    const r2 = await execute(runId);
    expect(r2.status, r2.message).toBe("waiting");
    const s2 = replay(ledger.events());
    expect(s2.openCard?.kind).toBe("approval");
    expect(prompts.find((p) => p.system.includes("plan the implementation"))!.user).toMatch(/"freshApp":\s*true/);
    await decide(ledger, { decision: "approve", hashPrefix: s2.openCard!.artifactSha.slice(0, 6), by: "lead" });

    const done = await execute(runId);
    expect(done.status, done.message).toBe("delivered");
    const s3 = replay(ledger.events());
    for (const step of ["discover", "intake", "ground", "specify", "design", "design-baseline", "design-export", "plan", "approve", "stub-commit", "author-tests", "implement/TASK-1", "integrate", "accept", "design-fidelity", "design-check", "review", "deliver"]) {
      expect(s3.steps.get(step)?.status, step).toBe("completed");
    }
    // the package is this run's own, in its project; the scaffold is built from it
    expect(packageOfRun(s3, ledger)?.manifest.run.id).toBe(runId);
    expect(s3.steps.get("stub-commit")!.data).toMatchObject({ scaffold: { target: "next-shadcn", files: expect.any(Number) } });
    const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", `factory/${runId}`], { cwd: repo, encoding: "utf8" });
    expect(tree).toMatch(/^package-lock\.json$/m);
    expect(execFileSync("git", ["show", `factory/${runId}:${lab.container}`], { cwd: repo, encoding: "utf8" })).toContain(DONE);
    expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
  });

  // the scaffold's lockfile is committed by the factory; a package an agent adds on its own is still stopped
  // (the first task of a fresh app has package.json in its file scope, by the scaffold's design: that one may change it)
  it("stops a test writer that adds a package", async () => {
    lab.addsPackage = "test-writer";
    const runId = await createRun("A portal where clinic staff sign in", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(await designRun()) });
    const ledger = Ledger.open(runId);
    await execute(runId);
    await decide(ledger, { decision: "approve", hashPrefix: replay(ledger.events()).openCard!.artifactSha.slice(0, 6), by: "lead" });
    const r = await execute(runId);
    expect(r.status).not.toBe("delivered");
    expect(`${r.message}\n${readFileSync(join(ledger.dir, "run.log"), "utf8")}`).toMatch(/package\.json/);
    expect(replay(ledger.events()).steps.get("deliver")?.status).not.toBe("completed");
  });

  // a full-stack product (the project's `contract`): the web app's side of one locked API contract
  describe("held to an API contract", () => {
    const start = async () => {
      writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo, stack: "node", design: { fidelity: false }, contract: {} }));
      const runId = await createRun("A portal where clinic staff sign in", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(await designRun()) });
      return { runId, ledger: Ledger.open(runId), first: await execute(runId) };
    };

    it("the plan writes the contract, the card shows it, the client is generated from it, and both are locked with the tests", async () => {
      const { runId, ledger, first } = await start();
      expect(first.status, first.message).toBe("waiting");
      const card = replay(ledger.events()).openCard!;
      const text = readFileSync(join(ledger.dir, "cards", `${card.cardId}.md`), "utf8");
      expect(text).toMatch(/## API contract \(contracts\/openapi\.yaml; locked with the tests once you approve\)\n- POST \/api\/sign-in -> 200/);
      expect(text).not.toMatch(/Stub commit/);
      await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "lead" });
      const done = await execute(runId);
      expect(done.status, done.message).toBe("delivered");
      const s = replay(ledger.events());
      const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", `factory/${runId}`], { cwd: repo, encoding: "utf8" });
      for (const f of ["contracts/openapi.yaml", "lib/api/client.ts", "lib/api/client.msw.ts", "orval.config.cjs", "package-lock.json"]) expect(tree.split("\n"), f).toContain(f);
      // the generator and what its output needs are pinned dev packages; the generated client is part of the scaffold, not the agents' change
      const pkg = JSON.parse(execFileSync("git", ["show", `factory/${runId}:package.json`], { cwd: repo, encoding: "utf8" })) as { devDependencies: Record<string, string> };
      expect(pkg.devDependencies).toMatchObject({ orval: "7.21.0", msw: "2.15.0", "@faker-js/faker": "9.9.0" });
      const scaffoldCommit = (s.steps.get("stub-commit")!.data!.scaffold as { commit: string }).commit;
      expect(execFileSync("git", ["show", "--stat", "--format=%s", scaffoldCommit], { cwd: repo, encoding: "utf8" })).toMatch(/API client and test handlers generated from contracts\/openapi\.yaml[\s\S]*lib\/api\/client\.ts/);
      const lock = ledger.getJson<{ lock: { file: string }[] }>(s.steps.get("author-tests")!.outputs[0]!);
      expect(lock.lock.map((l) => l.file)).toEqual(expect.arrayContaining(["tests/sign-in.test.ts", "contracts/openapi.yaml", "lib/api/client.ts", "lib/api/client.msw.ts", "orval.config.cjs"]));
      // both agents were told to go through the generated client, and could not write to the locked files
      const told = lab.jobs.map((j) => j.system).join("\n");
      expect(told).toMatch(/only through the generated client in lib\/api\/client\.ts/);
      expect(told).toMatch(/generated handlers from lib\/api\/client\.msw\.ts/);
      expect(verifyEvidence(ledger).every((c) => c.ok)).toBe(true);
    });

    it("a plan with no contract, or an incomplete one, is sent back", async () => {
      planContract = undefined;
      const none = await start();
      expect(none.first.status).toBe("parked");
      expect(none.first.message).toMatch(/No stub for the API contract/);
      planContract = CONTRACT.replace("      operationId: signIn\n", "").replace(", example: { message: Signed in }", "");
      const thin = await start();
      expect(thin.first.message).toMatch(/has no operationId|has no example/);
    });

    it("an implementer that changes the locked contract is stopped", async () => {
      const { runId, ledger } = await start();
      await decide(ledger, { decision: "approve", hashPrefix: replay(ledger.events()).openCard!.artifactSha.slice(0, 6), by: "lead" });
      lab.editsContract = true;
      const r = await execute(runId);
      expect(r.status).not.toBe("delivered");
      const s = replay(ledger.events());
      expect(s.gates.filter((g) => !g.passed).map((g) => g.gateId)).toContain("task.lock-set-unchanged");
      expect(readFileSync(join(ledger.dir, "run.log"), "utf8")).toMatch(/Changed locked test file contracts\/openapi\.yaml/);
      expect(s.steps.get("deliver")?.status).not.toBe("completed");
    });
  });

  // the PR #17 review, item 8: the fidelity check on a new product's app, in a real browser. The app is a stand-in server (the fake
  // lab installs nothing real), started on this machine; the check opens the scaffold's screen
  it.runIf(!!findChromium())("checks the new product's app against the approved design (fidelity on)", async () => {
    const off = process.env.FACTORY_NO_SCREENSHOTS;
    delete process.env.FACTORY_NO_SCREENSHOTS;
    try {
      const server = join(home, "app.js");
      writeFileSync(server, `require("http").createServer((q,s)=>{s.setHeader("content-type","text/html");s.end('<!doctype html><html lang=en><head><title>Sign in</title></head><body><main><h1>Sign in</h1><form><label for=e>Email</label><input id=e type=email><button>Sign in</button></form></main></body></html>')}).listen(process.env.PORT,"127.0.0.1")`);
      writeProject({ fidelity: { allowHost: true, install: "true", start: `node ${server}`, port: 4398, readyPath: "/", timeoutSec: 30, maxPages: 1 } });
      const design = await designRun();
      const runId = await createRun("A portal where clinic staff sign in", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(design) });
      const ledger = Ledger.open(runId);
      await execute(runId);
      await decide(ledger, { decision: "approve", hashPrefix: replay(ledger.events()).openCard!.artifactSha.slice(0, 6), by: "lead" });
      const r = await execute(runId);
      // the stand-in page is not the approved design (default font and colours, no kit form): the check reads it and stops the run
      expect(r.status, r.message).toBe("waiting");
      const s = replay(ledger.events());
      expect(s.openCard?.kind).toBe("waiver");
      const report = JSON.parse(readFileSync(join(ledger.dir, FIDELITY_DIR, "report.json"), "utf8")) as { skipped?: string; overall: string; pages: { key: string }[] };
      expect(report.skipped).toBeUndefined();
      expect(report.pages.map((p) => p.key)).toEqual(["s-1-default-phone"]);
      expect(report.overall).toBe("fail");
      expect(s.gates.map((g) => `${g.gateId}:${g.passed}`)).toEqual(expect.arrayContaining(["design.tokens:false", "design.a11y:true"]));
    } finally {
      if (off !== undefined) process.env.FACTORY_NO_SCREENSHOTS = off;
    }
  }, 120_000);

  it("builds an approved estimate made with no repo as a new product: a greenfield run held to the estimate, through to delivery", async () => {
    const est = await estimateRun();
    // no mode: a build from a no-repo estimate into an empty Node repo is a greenfield run
    const runId = await createRun("A portal where clinic staff sign in", "shop", "tester", { lineage: { kind: "build", approved: approvedEstimate(est, { build: true }) } });
    const ledger = Ledger.open(runId);
    const s0 = replay(ledger.events());
    expect(s0.info.mode).toBe("greenfield");
    expect(s0.info.estimateRef).toMatchObject({ runId: est });

    const r1 = await execute(runId);
    expect(r1.status, r1.message).toBe("waiting");
    const s1 = replay(ledger.events());
    expect(s1.openCard?.kind).toBe("approval");
    // the spec is the estimate's; no clarify rounds, no design steps of its own; the ground stands in for a new product
    expect(s1.steps.get("specify")!.data).toMatchObject({ seeded: true, from: est });
    expect([...s1.steps.keys()].some((k) => k.startsWith("clarify") || k === "design")).toBe(false);
    expect(s1.steps.get("ground")!.data).toMatchObject({ newProduct: true });
    // the planner was held to the estimate's tasks and saw the scaffold of the approved design
    const plan = prompts.find((p) => p.system.includes("plan the implementation"))!;
    expect(plan.system).toMatch(/APPROVED ESTIMATE/);
    expect(plan.user).toMatch(/"freshApp":\s*true/);
    expect(s1.gates.map((g) => `${g.gateId}:${g.passed}`)).toEqual(expect.arrayContaining(["build.b1-scope-lock:true"]));
    await decide(ledger, { decision: "approve", hashPrefix: s1.openCard!.artifactSha.slice(0, 6), by: "lead" });

    const done = await execute(runId);
    expect(done.status, done.message).toBe("delivered");
    const s2 = replay(ledger.events());
    expect(s2.steps.get("stub-commit")!.data).toMatchObject({ scaffold: { target: "next-shadcn" } });
    expect(s2.gates.map((g) => `${g.gateId}:${g.passed}`)).toEqual(expect.arrayContaining(["build.b3-size-cap:true", "build.b4-unrequested:true"]));
    expect(execFileSync("git", ["show", `factory/${runId}:${lab.container}`], { cwd: repo, encoding: "utf8" })).toContain(DONE);
  }, 120_000);

  it("refuses an estimate of a change to an existing repo as a new product", async () => {
    const est = await estimateRun();
    // (an estimate that read a repo, as its settings record it)
    const withRepo = approvedEstimate(est, { build: true });
    await expect(createRun("x", "shop", "tester", { lineage: { kind: "build", approved: { ...withRepo, settings: { ...withRepo.settings, noRepo: false } } } })).rejects.toThrow(/estimated a change to an existing repo/);
    // (an estimate made with no repo may still be built into a repo that has code: a change to it, not a new product)
  });

  it("refuses a no-repo estimate that prices its own API as a web app alone, and builds it as the web side of a product with its API", async () => {
    const est = await estimateRun();
    const a = approvedEstimate(est, { build: true });
    const bd = a.artifacts[a.breakdownSha] as { tasks: object[] };
    const withApi = { ...a, artifacts: { ...a.artifacts, [a.breakdownSha]: { ...bd, tasks: [...bd.tasks, { id: "EST-2", title: "Orders API", track: "backend", kind: "be-crud", executor: "factory" }] } } };
    const before = Ledger.listRuns().length;
    await expect(createRun("x", "shop", "tester", { lineage: { kind: "build", approved: withApi } })).rejects.toThrow(/prices more than a web app: 1 backend task \(EST-2\)/);
    expect(Ledger.listRuns().length).toBe(before);
    // the web side of a product with its API (its project holds the API contract): the API run builds the backend tasks
    writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo, stack: "node", contract: {} }));
    // (a run copies each artifact under its own hash: the breakdown with the API task, stored as itself)
    const bd2 = withApi.artifacts[a.breakdownSha], bd2Sha = Ledger.open(est).putJson(bd2);
    const { [a.breakdownSha]: _old, ...rest } = withApi.artifacts;
    const runId = await createRun("x", "shop", "tester", { lineage: { kind: "build", approved: { ...withApi, breakdownSha: bd2Sha, artifacts: { ...rest, [bd2Sha]: bd2 } } } });
    expect(replay(Ledger.open(runId).events()).info).toMatchObject({ mode: "greenfield", estimateRef: expect.objectContaining({ runId: est }) });
  });

  it("refuses to start a new product in a repo that has code, a design with a repo as a greenfield run, and a brownfield run on a Node project", async () => {
    const design = await designRun();
    writeFileSync(join(repo, "index.ts"), "export {};\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "code"], { cwd: repo, env });
    await expect(createRun("x", "shop", "tester", { mode: "greenfield", fromDesign: approvedDesign(design) })).rejects.toThrow(/already has code/);
    await expect(createRun("x", "shop", "tester", { fromDesign: approvedDesign(design) })).rejects.toThrow(/build it as a greenfield run/);
    await expect(createRun("x", "shop", "tester", { mode: "greenfield", fromDesign: { ...approvedDesign(design), repo: true } })).rejects.toThrow(/designed with no repo/);
    // the Node lab builds only a new product: a change to an existing Node app is refused (PR #17 review, item 5)
    await expect(createRun("change the sign-in page", "shop", "tester")).rejects.toThrow(/stack: node.*only for a new product/);
  });
});
