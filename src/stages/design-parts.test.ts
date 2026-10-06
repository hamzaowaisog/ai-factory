// A large request's design is drawn in parts (src/stages/design.ts, drawInParts): the 2026-10-05 estimate run's 136
// requirements were one answer, cut off at the 64K output limit. The screen list comes first and is checked before any
// page is paid for; each page is drawn on its own, a failing page gets one more try, and a retry pays only for the pages
// that failed.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { _resetEnvCache } from "../config/env.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { failure } from "../gates/engine.js";
import "../estimate/gates.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import type { Failure } from "../contracts/common.js";
import { NO_TRACE } from "../util/trace.js";
import { designStep, DRAW_IN_PARTS_AT, failuresFor } from "./design.js";
import { readPreview } from "../ui/preview.js";
import type { StepContext, StepOutcome } from "./framework.js";
import { setProviderFactory } from "./think.js";

const sha = "a".repeat(64);
const U = { inputTokens: 2000, outputTokens: 300, cacheRead: 0, cacheWrite: 0 };
const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Epic MyChart", took: "calm white page, one blue action" }, { ref: "Linear", took: "hairline borders, compact tables" }] };

const N = DRAW_IN_PARTS_AT + 6;
const reqs = Array.from({ length: N }, (_, i) => ({ id: `REQ-${i + 1}`, ears: `The system shall let a user sign in, step ${i + 1}.`, op: "ADDED", sources: ["I-1"], acceptance: [] }));
const spec = (rs = reqs) => ({ requirements: rs, nfrs: [], outOfScope: [], assumptions: [], lint: [], critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } });
const intent = { source: "cli", spans: [{ id: "I-1", text: "a" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true };

// three screens, ten requirements each
const listed = (ids = ["S-1", "S-2", "S-3"]) => ({
  theme, flow: "A user signs in and moves between the pages.", noScreen: [],
  screens: ids.map((id, k) => ({ id, route: `/p${k + 1}`, file: `app/p${k + 1}/page.tsx`, reqs: reqs.slice(k * 10, k === ids.length - 1 ? N : (k + 1) * 10).map((r) => r.id), states: ["error"], size: "new", title: `Clinic queue ${k + 1}`, purpose: "Staff see the queue and sign in." })),
});
const page = (title: string) => {
  const mock = { title, blocks: [{ type: "stats", items: [{ label: "Open visits", value: "14" }] }, { type: "actions", buttons: ["Sign in"] }], copy: {} };
  return { mock, mockFull: mock };
};

interface Call { system: string; user: string }
let calls: Call[] = [];
let answer: (c: Call) => unknown = () => { throw new Error("the model must not be called"); };
const provider: Provider = {
  start(_m, _e, system, user): Conversation {
    return { async next(): Promise<Turn> { const c = { system, user }; calls.push(c); return { calls: [{ id: "s", name: "submit_result", input: answer(c) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
  },
};
const isPlan = (c: Call) => c.system.includes("PAGES ARE DRAWN NEXT");
const pageOf = (c: Call) => /Draw page (S-\d+)/.exec(c.user)?.[1];
const titleOf = (c: Call) => /"title":"([^"]+)"/.exec(c.user.slice(c.user.indexOf("this-page")))?.[1] ?? "?";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-dparts-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  delete process.env.FACTORY_NO_CACHE;
  _resetEnvCache();
  calls = [];
  answer = (c) => (isPlan(c) ? listed() : page(titleOf(c)));
  setProviderFactory(() => provider);
});

let n = 0;
async function newRun(rs = reqs): Promise<Ledger> {
  const ledger = Ledger.create(`20261005-dparts-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "a clinic portal", operator: "sam" } }, HUMAN_WRITER);
  for (const [step, out] of [["intake", intent], ["specify", spec(rs)], ["ground", { cb: sha }]] as const) {
    const o = ledger.putJson(out);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o } } }, HUMAN_WRITER);
  }
  return ledger;
}
let logged: string[] = [];
async function draw(ledger: Ledger, priorFailures: Failure[] = []): Promise<StepOutcome> {
  const state = replay(ledger.events());
  logged = [];
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures, log: (m) => { logged.push(m); }, trace: NO_TRACE, usage: async () => undefined,
  };
  return designStep.run(ctx);
}

describe("a large design is drawn in parts", () => {
  it("lists the screens once, then draws each page with only its own requirements", async () => {
    const out = await draw(await newRun());
    expect(out.kind).toBe("done");
    expect(calls.filter(isPlan)).toHaveLength(1);
    expect(calls.map(pageOf).filter(Boolean).sort()).toEqual(["S-1", "S-2", "S-3"]);
    // the list is not asked for page content; each page gets the page rules and its own ten requirements
    expect(calls.find(isPlan)!.system).not.toContain("- MOCK CONTENT.");
    const p2 = calls.find((c) => pageOf(c) === "S-2")!;
    expect(p2.system).toContain("- MOCK CONTENT.");
    expect(p2.user).toContain("REQ-11");
    expect(p2.user).not.toContain('"REQ-1"');
  });

  it("the drawn design has the one-answer shape: every screen from the list with its page", async () => {
    const ledger = await newRun();
    const out = await draw(ledger) as { kind: "done"; outputs: { design: string } };
    const d = ledger.getJson<{ screens: { id: string; route: string; reqs: string[]; mock: { title: string }; title?: string }[]; theme: unknown }>(out.outputs.design)!;
    expect(d.screens.map((s) => [s.id, s.route, s.mock.title])).toEqual([["S-1", "/p1", "Clinic queue 1"], ["S-2", "/p2", "Clinic queue 2"], ["S-3", "/p3", "Clinic queue 3"]]);
    expect(d.screens.flatMap((s) => s.reqs)).toHaveLength(N);
    expect(d.screens[0]).not.toHaveProperty("title");
    expect(d.theme).toMatchObject({ brand: "#1f6feb" });
  });

  it("a screen list that leaves a requirement out fails before any page is paid for", async () => {
    answer = (c) => {
      if (!isPlan(c)) throw new Error("no page may be drawn");
      const l = listed();
      l.screens[2]!.reqs = l.screens[2]!.reqs.slice(1);
      return l;
    };
    const out = await draw(await newRun());
    expect(out).toMatchObject({ kind: "fail", failures: [{ check: "design-unmapped", message: expect.stringContaining("REQ-21") }] });
    expect(calls).toHaveLength(1);
  });

  it("a page that fails its checks is drawn once more with its own failures; the others are not redrawn", async () => {
    let tries = 0;
    answer = (c) => (isPlan(c) ? listed() : pageOf(c) === "S-2" && tries++ === 0 ? page("Page 2") : page(titleOf(c)));
    const out = await draw(await newRun());
    expect(out.kind).toBe("done");
    const s2 = calls.filter((c) => pageOf(c) === "S-2");
    expect(s2).toHaveLength(2);
    expect(s2[1]!.user).toContain("design-generic-title");
    expect(calls.filter((c) => pageOf(c) === "S-1")).toHaveLength(1);
  });

  it("a page that fails twice fails the step with its failures, and the retry pays only for that page", async () => {
    answer = (c) => (isPlan(c) ? listed() : pageOf(c) === "S-3" ? page("Screen 3") : page(titleOf(c)));
    const ledger = await newRun();
    const out = await draw(ledger);
    expect(out).toMatchObject({ kind: "fail", signature: "design-pages:design-generic-title" });
    const failures = (out as { failures: Failure[] }).failures;
    expect(failures.every((f) => f.message.includes("S-3"))).toBe(true);
    // the retry: the list and the passing pages are the same briefings, so their stored answers are read back
    calls = [];
    answer = (c) => (isPlan(c) ? listed() : page(titleOf(c)));
    const again = await draw(ledger, failures);
    expect(again.kind).toBe("done");
    expect(calls.map((c) => pageOf(c) ?? "list")).toEqual(["S-3"]);
  });

  it("the preview fills in as pages come back, marked a draft, and the log counts the pages", async () => {
    const ledger = await newRun();
    const seen: unknown[] = [];
    answer = (c) => {
      if (isPlan(c)) return listed();
      // what the run page shows while this page is being drawn
      const v = readPreview(ledger);
      if ("preview" in v) seen.push(v.preview.draft);
      return page(titleOf(c));
    };
    expect((await draw(ledger)).kind).toBe("done");
    // the first page call sees the list as wireframes: nothing drawn yet, every page pending
    expect(seen[0]).toEqual({ drawn: 0, total: 3, failed: 0 });
    const v = readPreview(ledger);
    if (!("preview" in v)) throw new Error(v.none);
    expect(v.preview.draft).toEqual({ drawn: 3, total: 3, failed: 0 });
    expect(v.preview.site!.screens.map((x) => [x.title, x.pending ?? false])).toEqual([["Clinic queue 1", false], ["Clinic queue 2", false], ["Clinic queue 3", false]]);
    expect(readFileSync(join(ledger.dir, "preview", "index.html"), "utf8")).toContain("Clinic queue 2");
    expect(logged.filter((m) => /^design: page \d of 3 drawn: S-\d "Clinic queue \d"$/.test(m))).toHaveLength(3);
  });

  it("a page that fails twice is counted as failed in the draft, not drawn", async () => {
    answer = (c) => (isPlan(c) ? listed() : pageOf(c) === "S-3" ? page("Screen 3") : page(titleOf(c)));
    const ledger = await newRun();
    await draw(ledger);
    const v = readPreview(ledger);
    if (!("preview" in v)) throw new Error(v.none);
    expect(v.preview.draft).toEqual({ drawn: 2, total: 3, failed: 1 });
    expect(v.preview.site!.screens.find((x) => x.path.endsWith("S-3"))?.pending).toBe(true);
    expect(logged).toContain('design: page 3 of 3 failed its checks twice: S-3 "Clinic queue 3"');
  });

  it("a small request is still one answer", async () => {
    const small = reqs.slice(0, 3);
    answer = () => ({ theme, flow: "A user signs in.", noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: small.map((r) => r.id), states: [], size: "new", ...page("Sign in") }] });
    const ledger = await newRun(small);
    expect((await draw(ledger)).kind).toBe("done");
    expect(calls).toHaveLength(1);
    expect(isPlan(calls[0]!)).toBe(false);
    // no draft for a one-answer design: the preview comes with design-baseline
    expect(existsSync(join(ledger.dir, "preview"))).toBe(false);
  });
});

describe("which earlier failures each part gets", () => {
  const f = (check: string, message: string) => failure(check, message);
  const all = [
    f("runner-bad-output", "The answer was cut off at the model's output limit before it was complete"),
    f("design-no-mock", 'Screen S-2 has no "mock".'),
    f("design-layout", 'On S-20, "Reorder all" is cut off in the drawn demo.'),
    f("design-orphan", "screen S-3 serves no requirement"),
    f("design-theme", "The brand colour is a competitor's exact shade."),
  ];
  it("a page gets those naming it; the list gets its own checks and those naming no page; the cut-off answer goes to neither", () => {
    expect(failuresFor(all, "S-2").map((x) => x.check)).toEqual(["design-no-mock"]);
    expect(failuresFor(all, "S-20").map((x) => x.check)).toEqual(["design-layout"]);
    expect(failuresFor(all, "S-3")).toEqual([]);
    expect(failuresFor(all).map((x) => x.check)).toEqual(["design-orphan", "design-theme"]);
  });
});
