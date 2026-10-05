// A large spec's breakdown is written in parts (src/stages/estimate.ts, breakdownInParts), as its design is drawn: one answer
// for 136 requirements is near the model's 64K output limit. The plan (features, shared tasks, checklist) comes first and is
// checked before any part is paid for; each group of features is written on its own, a failing part gets one more try, and a
// retry pays only for the parts that failed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Breakdown } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { failure } from "../gates/engine.js";
import "../estimate/gates.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import { NO_TRACE } from "../util/trace.js";
import { BREAKDOWN_IN_PARTS_AT, breakdownFailuresFor, breakdownStep, partsOf } from "./estimate.js";
import type { StepContext, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";

const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const N = BREAKDOWN_IN_PARTS_AT + 12;
const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `REQ-${from + i}`);
const spec = (n = N) => ({
  requirements: Array.from({ length: n }, (_, i) => ({ id: `REQ-${i + 1}`, ears: `The system shall do ${i + 1}.`, op: "ADDED", sources: ["I-1"], acceptance: [] })),
  nfrs: [], outOfScope: [], assumptions: [], lint: [{ check: "ears", passed: true, details: "" }], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] },
});
const mock = (title: string) => ({ title, blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Reorder"] }], copy: {} });
// three screens, twenty requirements each
const design = {
  flow: "A buyer finds parts, orders them and tracks the order.", noScreen: [],
  screens: [1, 2, 3].map((k) => ({ id: `S-${k}`, route: `/p${k}`, file: `app/p${k}/page.tsx`, reqs: ids((k - 1) * 20 + 1, k * 20), states: ["error"], size: "new", mock: mock(`Parts page ${k}`), mockFull: { ...mock(`Parts page ${k}`), subtitle: "FULL-DATA-ONLY" } })),
};
// six features of ten requirements: three parts of two features
const features = Array.from({ length: 6 }, (_, k) => ({ id: `F-${k + 1}`, title: `Feature ${k + 1}`, reqs: ids(k * 10 + 1, (k + 1) * 10) }));
const task = (id: string, featureId: string, extra: Record<string, unknown>) => ({ id, title: `Task ${id}`, featureId, items: ["an item"], executor: "factory", complexity: "standard", dependsOn: [], ...extra });
const plan = () => ({
  features: features.map((f) => ({ ...f, reqs: [...f.reqs] })),
  shared: [
    task("EST-1", "F-1", { reqs: ["REQ-1"], track: "backend", kind: "be-data" }),
    task("EST-2", "F-1", { reqs: [], track: "pm", kind: "pm-management", executor: "human", overhead: "coordination across the build" }),
  ],
  checklist: [{ item: "auth", included: true }, { item: "monitoring", included: false, reason: "the client runs it" }],
});
/** a part's tasks: an API per feature, and the part's screen */
const partAnswer = (from: number, fs: string[], skipScreen = false) => {
  const screen = `S-${Math.ceil(Number(fs[0]!.slice(2)) / 2)}`;
  return {
    tasks: [
      ...fs.map((f, i) => task(`EST-${from + i}`, f, { reqs: features.find((x) => x.id === f)!.reqs, track: "backend", kind: "be-crud", dependsOn: ["EST-1"] })),
      ...(skipScreen ? [] : [task(`EST-${from + fs.length}`, fs[0]!, { reqs: [features.find((x) => x.id === fs[0])!.reqs[0]], track: "web", kind: "ui-form", screen, dependsOn: [`EST-${from}`] })]),
    ],
  };
};

interface Call { system: string; user: string }
let calls: Call[] = [];
const isPlan = (c: Call) => c.system.includes("planning the work breakdown of a LARGE spec");
const fromOf = (c: Call) => Number(/Number your tasks EST-(\d+)/.exec(c.system)?.[1]);
const featuresOf = (c: Call) => /Write the tasks of ([F\-\d, ]+)\./.exec(c.user)?.[1]!.split(", ") ?? [];
const partOf = (c: Call) => (isPlan(c) ? "plan" : featuresOf(c).join("+"));
let answer: (c: Call) => unknown;
const provider: Provider = {
  start(_m, _e, system, user): Conversation {
    return { async next(): Promise<Turn> { const c = { system, user }; calls.push(c); return { calls: [{ id: "s", name: "submit_result", input: answer(c) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-bparts-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  delete process.env.FACTORY_NO_CACHE;
  _resetEnvCache();
  calls = [];
  answer = (c) => (isPlan(c) ? plan() : partAnswer(fromOf(c), featuresOf(c)));
  setProviderFactory(() => provider);
});

async function newRun(n = N): Promise<Ledger> {
  const ledger = Ledger.create(`20261005-bparts-${Math.random().toString(16).slice(2, 8)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "a parts portal" } }, HUMAN_WRITER);
  const round = { asked: [{ id: "Q-1", text: "Web or mobile?", recommended: "web" }], answers: { "Q-1": "web" }, answeredBy: "lead", assumptions: [], conflicts: [] };
  for (const [step, out] of [
    ["intake", { source: "cli", spans: [{ id: "I-1", text: "a portal" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true }],
    ["clarify", round], ["clarify-2", { asked: [], answers: {}, assumptions: [], conflicts: [] }], ["specify", spec(n)], ["design", design],
  ] as const) {
    const sha = ledger.putJson(out);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs: [sha], data: { named: { [step]: sha } } }, HUMAN_WRITER);
  }
  return ledger;
}
async function run(ledger: Ledger, priorFailures: Failure[] = []): Promise<StepOutcome> {
  const state = replay(ledger.events());
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures, log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
  return breakdownStep.run(ctx);
}

describe("a large breakdown is written in parts", () => {
  it("plans once, then writes each group of features with only its own requirements and screen", async () => {
    const out = await run(await newRun());
    expect(out.kind).toBe("done");
    expect(calls.map(partOf)).toEqual(["plan", "F-1+F-2", "F-3+F-4", "F-5+F-6"]);
    // the plan reads the screens' links, not their pages; a part reads its own screen's page, never the full-data variant
    const p = calls.find(isPlan)!;
    expect(p.user).toContain('"S-2"');
    expect(p.user).not.toContain("Parts page");
    const p2 = calls.find((c) => partOf(c) === "F-3+F-4")!;
    expect(p2.user).toContain("REQ-21");
    expect(p2.user).not.toContain("The system shall do 1.");
    expect(p2.user).toContain("Parts page 2");
    expect(p2.user).not.toContain("Parts page 1");
    expect(p2.user).not.toContain("FULL-DATA-ONLY");
  });

  it("joins the parts into one breakdown, numbered EST-1 onwards with the dependencies followed", async () => {
    const ledger = await newRun();
    const out = await run(ledger) as { kind: "done"; outputs: { breakdown: string } };
    const b = Breakdown.parse(ledger.getJson(out.outputs.breakdown));
    expect(b.tasks.map((t) => t.id)).toEqual(Array.from({ length: 11 }, (_, i) => `EST-${i + 1}`));
    // shared EST-1, EST-2; part one is EST-3 (F-1 API), EST-4 (F-2 API), EST-5 (S-1, after EST-3)
    expect(b.tasks.find((t) => t.screen === "S-1")).toMatchObject({ id: "EST-5", dependsOn: ["EST-3"] });
    expect(b.tasks.find((t) => t.id === "EST-6")).toMatchObject({ featureId: "F-3", dependsOn: ["EST-1"] });
    expect(b.features).toHaveLength(6);
    expect(b.checklist).toHaveLength(2);
    const gates = replay(ledger.events()).gates.map((g) => `${g.gateId}:${g.passed}`);
    for (const g of ["estimate.e2-req-to-task", "estimate.e3-task-to-req", "estimate.e2c-task-kind", "estimate.e4-checklist", "estimate.e1c-design-coverage"]) expect(gates).toContain(`${g}:true`);
  });

  it("a plan that leaves a requirement out fails before any part is paid for", async () => {
    answer = (c) => {
      if (!isPlan(c)) throw new Error("no part may be written");
      const x = plan();
      x.features[5] = { ...x.features[5]!, reqs: x.features[5]!.reqs.slice(1) };
      return x;
    };
    const out = await run(await newRun());
    expect(out).toMatchObject({ kind: "fail", failures: [{ check: "breakdown-plan-unfeatured", message: "REQ-51 is in no feature" }] });
    expect(calls).toHaveLength(1);
  });

  it("a part that fails its checks is written once more with its own failures; the others are not rewritten", async () => {
    let tries = 0;
    answer = (c) => (isPlan(c) ? plan() : partAnswer(fromOf(c), featuresOf(c), partOf(c) === "F-3+F-4" && tries++ === 0));
    const out = await run(await newRun());
    expect(out.kind).toBe("done");
    const p2 = calls.filter((c) => partOf(c) === "F-3+F-4");
    expect(p2).toHaveLength(2);
    expect(p2[1]!.user).toContain("approved screen S-2 is built by no task");
    expect(calls.filter((c) => partOf(c) === "F-1+F-2")).toHaveLength(1);
  });

  it("a part that fails twice fails the step with its failures, and the retry pays only for that part", async () => {
    answer = (c) => (isPlan(c) ? plan() : partAnswer(fromOf(c), featuresOf(c), partOf(c) === "F-5+F-6"));
    const ledger = await newRun();
    const out = await run(ledger);
    expect(out).toMatchObject({ kind: "fail", signature: "breakdown-parts:e1c-unbuilt-screen" });
    const failures = (out as { failures: Failure[] }).failures;
    expect(failures.every((f) => f.location === "breakdown:P3")).toBe(true);
    calls = [];
    answer = (c) => (isPlan(c) ? plan() : partAnswer(fromOf(c), featuresOf(c)));
    expect((await run(ledger, failures)).kind).toBe("done");
    expect(calls.map(partOf)).toEqual(["F-5+F-6"]);
  });

  it("a small spec is still one answer, without the screens' full-data variant", async () => {
    const small = 3;
    answer = (c) => ({
      features: [{ id: "F-1", title: "Orders", reqs: ids(1, small) }],
      tasks: [
        task("EST-1", "F-1", { reqs: ids(1, small), track: "backend", kind: "be-crud" }),
        ...[1, 2, 3].map((k) => task(`EST-${k + 1}`, "F-1", { reqs: ["REQ-1"], track: "web", kind: "ui-form", screen: `S-${k}` })),
      ],
      checklist: [{ item: "auth", included: true }],
    });
    const out = await run(await newRun(small));
    expect(calls).toHaveLength(1);
    expect(isPlan(calls[0]!)).toBe(false);
    expect(calls[0]!.user).toContain("Parts page 1");
    expect(calls[0]!.user).not.toContain("FULL-DATA-ONLY");
    // the small design cites requirements beyond the small spec; only the shape of the call matters here
    expect(out.kind).not.toBe("park");
  });
});

describe("parts and failures", () => {
  it("groups features in order into parts of at most 24 requirements", () => {
    const f = (id: string, n: number) => ({ id, title: id, reqs: Array.from({ length: n }, (_, i) => `${id}-${i}`) });
    expect(partsOf([f("A", 10), f("B", 10), f("C", 10), f("D", 30), f("E", 2)]).map((p) => p.features.map((x) => x.id).join(""))).toEqual(["AB", "C", "D", "E"]);
  });
  it("a part gets the failures it raised; the plan the rest; the cut-off answer goes to neither", () => {
    const all = [
      failure("runner-bad-output", "The answer was cut off at the model's output limit"),
      failure("e1c-unbuilt-screen", "approved screen S-3 is built by no task", { location: "breakdown:P2" }),
      failure("breakdown-plan-unfeatured", "REQ-4 is in no feature"),
    ];
    expect(breakdownFailuresFor(all, "P2").map((x) => x.check)).toEqual(["e1c-unbuilt-screen"]);
    expect(breakdownFailuresFor(all, "P1")).toEqual([]);
    expect(breakdownFailuresFor(all).map((x) => x.check)).toEqual(["breakdown-plan-unfeatured"]);
  });
});
