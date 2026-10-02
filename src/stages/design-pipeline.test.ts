// The design pipeline as one piece (docs/estimates-design.md, "Design references", step 2): the
// estimate's design steps are unchanged, and a mode with other step names (a stand-in greenfield
// list) draws, approves and hands the approved design to the step after it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import "../estimate/gates.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import { designStep } from "./design.js";
import { approvedDesignFor, type DesignSources } from "./design-inputs.js";
import { designSteps } from "./design-pipeline.js";
import { designBaselineStep } from "./estimate-approve.js";
import type { StepContext, StepDef, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";
import { approvedDesign, copyArtifacts } from "../estimate/lineage.js";
import { designOnlySteps, estimateSteps } from "./modes.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
let answer: () => unknown = () => { throw new Error("the model must not be called"); };
let modelCalls = 0;
const provider: Provider = {
  start(): Conversation {
    return { async next(): Promise<Turn> { modelCalls++; return { calls: [{ id: "s", name: "submit_result", input: answer() }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-dpipe-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  modelCalls = 0;
  answer = () => { throw new Error("the model must not be called"); };
  setProviderFactory(() => provider);
});

let n = 0;
async function newRun(mode: string): Promise<Ledger> {
  const ledger = Ledger.create(`20261002-dpipe-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode, project: "demo", request: "a portal", operator: "sam" } }, HUMAN_WRITER);
  return ledger;
}
async function complete(ledger: Ledger, step: string, output: unknown) {
  const out = ledger.putJson(output);
  await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [out], data: { named: { [step]: out } } }, HUMAN_WRITER);
}
async function exec(ledger: Ledger, step: StepDef): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
  const out = await step.run(ctx);
  if (out.kind === "done") await ledger.append({ type: "step.completed", key: `${step.key}/1`, inputsHash: sha, outputs: Object.values(out.outputs), data: { ...(out.data ?? {}), named: out.outputs } }, HUMAN_WRITER);
  return out;
}
async function decide(ledger: Ledger, out: StepOutcome, step: string, decision: string) {
  if (out.kind !== "wait") throw new Error(`expected a card, got ${out.kind}`);
  const c = out.card;
  await ledger.append({ type: "human.requested", data: { ...(c.extra ?? {}), cardId: c.cardId, kind: c.kind, artifactSha: c.artifactSha, step } }, HUMAN_WRITER);
  await ledger.append({ type: "human.decided", data: { cardId: c.cardId, decision, by: "lead", artifactSha: c.artifactSha } }, HUMAN_WRITER);
}

const intent = (touchesUi: boolean) => ({ source: "cli", spans: [{ id: "I-1", text: "a" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi });
const spec = { requirements: [{ id: "REQ-1", ears: "The system shall let a user sign in.", op: "ADDED", sources: ["I-1"], acceptance: [] }], nfrs: [], outOfScope: [], assumptions: [], lint: [], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } };
const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Epic MyChart", took: "calm white page, one blue action" }, { ref: "Linear", took: "hairline borders, compact tables" }] };
const mock = { title: "Sign in", blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Sign in"] }], copy: {} };
const drawn = () => ({ theme, flow: "A user signs in", screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock }], noScreen: [] });

/** greenfield's own step names, with no repo to read */
const GF: DesignSources = { intent: "gf-intake", spec: "gf-spec" };

describe("design pipeline", () => {
  it("gives the estimate the same steps it always had: keys, versions and inputs", async () => {
    const [d, a] = designSteps({ purpose: "estimate" });
    expect([d!.key, d!.templateVersion, a!.key, a!.templateVersion]).toEqual([designStep.key, designStep.templateVersion, designBaselineStep.key, designBaselineStep.templateVersion]);
    const ledger = await newRun("estimate");
    await complete(ledger, "intake", intent(true));
    await complete(ledger, "specify", spec);
    await complete(ledger, "ground", { cb: sha });
    const s = replay(ledger.events());
    expect(d!.inputs(s, ledger)).toEqual(designStep.inputs(s, ledger));
    expect(a!.inputs(s, ledger)).toEqual(designBaselineStep.inputs(s, ledger));
    expect(d!.inputs(s, ledger)).toMatchObject({ ui: true, inventory: { ground: expect.any(String) } });
  });

  it("plugs into a mode with other step names: draws, asks for approval in build words, and hands the design on", async () => {
    // a stand-in greenfield list: its own intake and spec, the design pipeline, then a plan that reads the approved design
    let planSaw: { sha: string; design: { screens: { id: string }[] } } | undefined;
    const plan: StepDef = { key: "plan", stage: "plan", templateVersion: "1", inputs: () => ({}), async run(ctx) { planSaw = approvedDesignFor(ctx.state, ctx.ledger); return { kind: "done", outputs: { plan: ctx.ledger.putJson({}) } }; } };
    const steps = designSteps({ sources: GF, purpose: "build" });
    expect(steps.map((x) => x.key)).toEqual(["design", "design-baseline", "design-export"]);
    const [draw, approve] = steps as [StepDef, StepDef];

    const ledger = await newRun("greenfield");
    expect(draw.inputs(replay(ledger.events()), ledger)).toBeUndefined();
    await complete(ledger, "gf-intake", intent(true));
    await complete(ledger, "gf-spec", spec);
    expect(draw.inputs(replay(ledger.events()), ledger)).toMatchObject({ ui: true, inventory: undefined });

    answer = drawn;
    expect((await exec(ledger, draw)).kind).toBe("done");
    expect(modelCalls).toBe(1);
    // nothing approved yet: the plan gets no design
    expect(approvedDesignFor(replay(ledger.events()), ledger)).toBeUndefined();

    const card = await exec(ledger, approve);
    expect(card.kind).toBe("wait");
    const md = (card as { card: { markdown: string } }).card.markdown;
    expect(md).toMatch(/^# Approve the design\n/);
    expect(md).not.toMatch(/E1b|estimate/);
    await decide(ledger, card, "design-baseline", "approve");
    expect((await exec(ledger, approve)).kind).toBe("done");

    await exec(ledger, plan);
    const s = replay(ledger.events());
    expect(planSaw?.sha).toBe(s.steps.get("design")!.outputs[0]);
    expect(planSaw?.design.screens.map((x) => x.id)).toEqual(["S-1"]);
  });

  it("skips drawing for a request with no UI and approves on the intent alone, with no model call", async () => {
    const [draw, approve] = designSteps({ sources: GF, purpose: "build" }) as [StepDef, StepDef];
    const ledger = await newRun("greenfield");
    await complete(ledger, "gf-intake", intent(false));
    await complete(ledger, "gf-spec", spec);
    expect((await exec(ledger, draw)).kind).toBe("done");
    expect((await exec(ledger, approve)).kind).toBe("done");
    expect(modelCalls).toBe(0);
    expect(approvedDesignFor(replay(ledger.events()), ledger)).toBeUndefined();
  });

  it("prefers the design approved in the estimate a build was seeded from", async () => {
    const ledger = await newRun("brownfield");
    const seeded = ledger.putJson({ flow: "f", screens: [{ id: "S-9" }] });
    const s = replay(ledger.events());
    s.info.estimateRef = { runId: "e", designSha: seeded } as never;
    expect(approvedDesignFor(s, ledger)?.sha).toBe(seeded);
  });

  it("a design-only run asks in its own words, and its approved design carries into an estimate under the same hashes", async () => {
    const ledger = await newRun("design");
    await complete(ledger, "intake", intent(true));
    await complete(ledger, "ground", { cb: sha });
    await complete(ledger, "clarify", { questions: [] });
    await complete(ledger, "specify", spec);
    const steps = designOnlySteps(replay(ledger.events()));
    const draw = steps.find((x) => x.key === "design")!, approve = steps.find((x) => x.key === "design-baseline")!;
    answer = drawn;
    expect((await exec(ledger, draw)).kind).toBe("done");
    const card = await exec(ledger, approve);
    const md = (card as { card: { markdown: string } }).card.markdown;
    expect(md).toMatch(/^# Approve the design\n/);
    expect(md).toContain("design only");
    expect(md).toContain(`factory estimate --from-design ${ledger.runId}`);
    expect(md).not.toMatch(/E1b/);
    expect(() => approvedDesign(ledger.runId)).toThrow(/no approved design yet/);
    await decide(ledger, card, "design-baseline", "approve");
    expect((await exec(ledger, approve)).kind).toBe("done");

    const a = approvedDesign(ledger.runId);
    expect(a.ref).toMatchObject({ runId: ledger.runId, designSha: replay(ledger.events()).steps.get("design")!.outputs[0] });
    // a new estimate run: the artifacts land under their own hashes and the seeded steps hand them on
    const est = Ledger.create(`20261002-dpipe-est-${Math.random().toString(16).slice(2, 6)}`);
    copyArtifacts(est, a);
    await est.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: a.request, operator: "sam", designRef: a.ref } }, HUMAN_WRITER);
    for (const step of estimateSteps(replay(est.events())).filter((x) => !["breakdown", "estimate", "approve-estimate", "export"].includes(x.key))) {
      expect((await exec(est, step)).kind).toBe("done");
    }
    expect(modelCalls).toBe(1);
    const s = replay(est.events());
    expect(approvedDesignFor<{ screens: { id: string }[] }>(s, est)?.design.screens.map((x) => x.id)).toEqual(["S-1"]);
    expect(estimateSteps(s).find((x) => x.key === "breakdown")!.inputs(s, est)).toBeTruthy();
  });

  it("refuses to carry on a design that is not from a design run", async () => {
    const ledger = await newRun("estimate");
    expect(() => approvedDesign(ledger.runId)).toThrow(/not a design run/);
  });
});
