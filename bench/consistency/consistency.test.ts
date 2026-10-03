import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../../src/config/env.js";
import type { Conversation, Provider, Turn } from "../../src/runners/api.js";
import { setRecordsSource, setTaskRecordsSource } from "../../src/stages/estimate.js";
import { setProviderFactory } from "../../src/stages/think.js";
import { formatStats, groupStats, type Sample } from "./report.js";
import { listCases, parseReportArgs, runCase } from "./run.js";

const ok = (group: string, kase: string, min: number, max: number, kinds: Record<string, number> = { "backend/standard": 2 }): Sample =>
  ({ group, case: kase, runId: `${group}-${kase}`, total: { min, max }, tasks: Object.values(kinds).reduce((a, b) => a + b, 0), kinds });

describe("consistency report", () => {
  it("passes a group whose totals sit within the target and fails one that spreads", () => {
    const stats = groupStats([
      ok("tight", "a", 9, 11), ok("tight", "b", 10, 12), ok("tight", "c", 9.5, 11.5),
      ok("loose", "a", 5, 7), ok("loose", "b", 10, 14, { "backend/standard": 3, "qa/standard": 1 }),
    ]);
    const tight = stats.find((g) => g.group === "tight")!;
    expect(tight).toMatchObject({ runs: 3, ok: 3, meanMid: 10.5, minMid: 10, maxMid: 11, pass: true });
    expect(tight.cv).toBeCloseTo(0.039, 3);
    const loose = stats.find((g) => g.group === "loose")!;
    expect(loose.cv).toBeCloseTo(0.333, 3);
    expect(loose.pass).toBe(false);
    // a kind missing from a run counts as 0 there
    expect(loose.kinds).toEqual({ "backend/standard": { min: 2, max: 3 }, "qa/standard": { min: 0, max: 1 } });
    expect(loose.tasks).toEqual({ min: 2, max: 4 });
  });

  it("does not pass a group with a failed run or a single estimate", () => {
    const stats = groupStats([ok("g", "a", 10, 10), { group: "g", case: "b", runId: "r", error: "stopped at clarify (failed)" }, ok("one", "a", 4, 6)]);
    expect(stats.map((g) => [g.group, g.ok, g.pass])).toEqual([["g", 1, false], ["one", 1, false]]);
    const text = formatStats(stats, [{ group: "g", case: "b", runId: "r", error: "stopped at clarify (failed)" }]);
    expect(text).toMatch(/g: FAIL/);
    expect(text).toMatch(/no estimate: stopped at clarify/);
  });

  it("reads report arguments and lists the golden cases", () => {
    expect(parseReportArgs(["portal/a=run-1"])).toEqual([{ group: "portal", name: "a", runId: "run-1" }]);
    expect(() => parseReportArgs(["run-1"])).toThrow(/group\/case=run-id/);
    const cases = listCases();
    expect([...new Set(cases.map((c) => c.group))]).toEqual(["booking-app", "inventory-api", "portal"]);
    expect(cases.filter((c) => c.group === "portal").map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(listCases(undefined, ["portal"]).every((c) => c.group === "portal")).toBe(true);
  });
});

// ---------- one case through the real executor, with a scripted model ----------
const U = { inputTokens: 1000, outputTokens: 200, cacheRead: 0, cacheWrite: 0 };
const REQS = [{ id: "REQ-1", ears: "When a caller posts a product, the system shall store it.", acceptance: [{ id: "AC-1.1", given: "a valid key", when: "a product is posted", then: "the response is 201", level: "api" }] }];
const draft = { requirements: REQS.map((r) => ({ ...r, op: "ADDED", sources: ["I-1"], anchors: [] })), nfrs: [], outOfScope: ["mobile apps"], assumptions: [], suggestions: [] };
const breakdown = {
  features: [{ id: "F-1", title: "Products", reqs: ["REQ-1"] }],
  tasks: [
    { id: "EST-1", title: "Products screen", featureId: "F-1", reqs: ["REQ-1"], items: ["sku", "name", "price"], track: "web", kind: "ui-list", screen: "S-1", executor: "factory", dependsOn: [], complexity: "standard" },
    { id: "EST-2", title: "Client UAT", featureId: "F-1", reqs: [], items: [], track: "qa", kind: "qa-uat", executor: "human", dependsOn: ["EST-1"], complexity: "standard", overhead: "client acceptance testing" },
  ],
  checklist: [{ item: "auth", included: true }],
};
const sizing = {
  stack: { backend: "ASP.NET Core Web API", basis: "assumed" as const, notes: "none named" },
  tasks: [{ taskId: "EST-1", size: "typical", verify: "easy", context: "complete", reason: "search and two filters" }, { taskId: "EST-2", size: "small", reason: "half a day of testing" }],
};
const DESIGN = {
  flow: "A clerk signs in, then adds a product.",
  screens: [{ id: "S-1", route: "/products", file: "app/products/page.tsx", reqs: ["REQ-1"], states: ["empty"], size: "new", frames: [] }],
  noScreen: [],
};
const mock = { title: "Products", blocks: [{ type: "stats", items: [{ label: "Products", value: "14" }] }, { type: "actions", buttons: ["Add product"] }], copy: {} };
function answerFor(system: string): unknown {
  if (system.includes("drawing the screen inventory")) return { theme: { mood: "calm", brand: "#1f6feb", reading: { users: "warehouse clerks", context: "at a desk", device: "web", tone: "plain", hero: "the product list", traits: ["dense", "quiet"] }, basis: [{ ref: "Amazon", took: "dense product rows" }, { ref: "IKEA", took: "one blue action" }] }, ...DESIGN, screens: DESIGN.screens.map((x) => ({ mock, mockFull: mock, ...x })) };
  if (system.includes("intake step")) return { source: "cli", spans: [{ id: "I-1", text: "store products" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "caller stores a product", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: REQS.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`] })), conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Callers store products." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("sizing the tasks")) return sizing;
  if (system.includes("turning a finished spec")) return breakdown;
  throw new Error(`unscripted system prompt: ${system.slice(0, 80)}`);
}
const provider: Provider = {
  start(_m, _e, system): Conversation {
    return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answerFor(system) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-consistency-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  mkdirSync(join(home, "projects"), { recursive: true });
  setProviderFactory(() => provider);
  setRecordsSource(() => []);
  setTaskRecordsSource(() => []);
});

describe("consistency runner", () => {
  it("estimates a case hands-off from requirements alone, approves the design as bench, and samples the estimate", async () => {
    const [c] = listCases(undefined, ["inventory-api"]);
    const s = await runCase(c!);
    expect(s.error).toBeUndefined();
    expect(s).toMatchObject({ group: "inventory-api", case: "a", tasks: 2, kinds: { "ui-list": 1, "qa-uat": 1 } });
    expect(s.total!.max).toBeGreaterThan(0);
    const { Ledger } = await import("../../src/ledger/ledger.js");
    const { replay } = await import("../../src/ledger/state.js");
    const st = replay(Ledger.open(s.runId).events());
    // the design card is the only decision, made by bench; clarify and E7 asked nobody
    expect(st.decisions.map((d) => [d.cardId.split("-")[0], d.by])).toEqual([["design", "bench"]]);
    expect(st.info.estimate).toMatchObject({ humanReview: false, noRepo: true });
  });
});
