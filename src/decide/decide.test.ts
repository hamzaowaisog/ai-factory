import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { FencedOutError, HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { defaultProvider, type Provider } from "../runners/api.js";
import type { StepContext } from "../stages/framework.js";
import { setProviderFactory } from "../stages/think.js";
import { NO_TRACE } from "../util/trace.js";
import { ADAPTERS, decide, parsePair, QUESTIONS, signals, type DecisionState } from "./decide.js";

const SPAN = "Customers reorder their usual parts from the saved basket";
const state: DecisionState = { signals: signals("a short idea"), intent: { changeClass: "feature", risk: "low", touchesUi: true }, spans: [SPAN] };
const used: { model: string; estUsd: number }[] = [];

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-decide-"));
  process.env.FACTORY_NO_CACHE = "1";
  _resetEnvCache();
  used.length = 0;
});
afterEach(() => {
  setProviderFactory(defaultProvider);
  vi.unstubAllGlobals();
  delete process.env.FACTORY_NO_CACHE;
  delete process.env.TYPESAFE_API_KEY;
  delete ADAPTERS.test;
});

let n = 0;
async function ctxFor(over: Partial<StepContext> = {}): Promise<StepContext> {
  const ledger = Ledger.create(`decide-test-${++n}`);
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", changeClass: "feature", request: "r" } }, HUMAN_WRITER);
  return {
    runId: "decide-test", ledger, writer: HUMAN_WRITER, state: replay(ledger.events()), project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE,
    usage: async (u) => { used.push({ model: u.model, estUsd: u.estUsd }); }, ...over,
  };
}

describe("the decision port", () => {
  it("keeps only picks that are one of the options, with a confidence from 0 to 1", async () => {
    ADAPTERS.test = { name: "test", decide: async () => [{ id: "maturity", pick: "full spec", confidence: 0.9 }, { id: "genre", pick: "something else", confidence: 0.9 }] };
    expect(await decide(await ctxFor(), "test", state)).toMatchObject({ adapter: "test", answers: [{ id: "maturity", pick: "full spec" }], dropped: ["genre"] });
    ADAPTERS.test = { name: "test", decide: async () => [{ id: "maturity", pick: "full spec", confidence: 1.4 }, { id: "genre", pick: "common product type", confidence: Number.NaN }] };
    expect(await decide(await ctxFor(), "test", state)).toMatchObject({ answers: [], dropped: ["maturity", "genre"] });
  });

  it("returns an error on the record instead of throwing, except for a lost lease", async () => {
    const ctx = await ctxFor();
    ADAPTERS.test = { name: "test", decide: async () => { throw new Error("boom"); } };
    expect(await decide(ctx, "test", state)).toMatchObject({ answers: [], error: "boom" });
    expect(await decide(ctx, "nope", state)).toMatchObject({ adapter: "nope", error: expect.stringContaining("No decision adapter") });
    ADAPTERS.test = { name: "test", decide: async () => { throw new FencedOutError("fenced"); } };
    await expect(decide(ctx, "test", state)).rejects.toBeInstanceOf(FencedOutError);
  });

  it("off asks nothing; fake answers every question from the signals", async () => {
    const ctx = await ctxFor();
    expect(await decide(ctx, "off", state)).toBeUndefined();
    const full = { ...state, signals: signals("- The page must list orders\n- The admin must approve\n- Totals should add up\n") };
    expect((await decide(ctx, "fake", full))!.answers).toEqual([{ id: "maturity", pick: "full spec", confidence: 0.5 }, { id: "genre", pick: "common product type", confidence: 0.5 }]);
    expect((await decide(ctx, "fake", state))!.answers[0]!.pick).toBe("casual idea");
    expect(used).toEqual([]);
  });

  it("reads a pair as an adapter and its model", () => {
    expect(parsePair("llm:claude-haiku-5-5")).toEqual({ adapter: "llm", model: "claude-haiku-5-5" });
    expect(parsePair("jev")).toEqual({ adapter: "jev" });
    expect(() => parsePair("gpt")).toThrow(/No decision adapter/);
  });
});

describe("the llm adapter", () => {
  it("uses the model it is given, at low effort and with no failure text, even inside a step that is retrying", async () => {
    const seen: { model: string; effort: string; system: string; user: string }[] = [];
    const provider: Provider = {
      start(model, effort, system, user) {
        seen.push({ model, effort, system, user });
        return {
          async next() { return { calls: [{ id: "1", name: "submit_result", input: { maturity: { pick: "partial spec", confidence: 0.7 }, genre: { pick: "niche or domain-heavy", confidence: 0.6 } } }], text: "", stop: "tool_use", usage: { inputTokens: 900, outputTokens: 40, cacheRead: 0, cacheWrite: 0 } }; },
          toolResults() {}, say() {},
        };
      },
    };
    setProviderFactory(() => provider);
    const retrying = await ctxFor({ rung: 2, priorFailures: [{ check: "intake-shape", message: "INTAKE FAILED BEFORE", frames: [] }] });
    for (const model of ["claude-haiku-5-5", "gpt-6-luna"]) {
      const r = await decide(retrying, `llm:${model}`, state);
      expect(r).toMatchObject({ adapter: "llm", model, dropped: [], answers: [{ id: "maturity", pick: "partial spec", confidence: 0.7 }, { id: "genre", pick: "niche or domain-heavy", confidence: 0.6 }] });
    }
    expect(seen.map((s) => [s.model, s.effort])).toEqual([["claude-haiku-5-5", "low"], ["gpt-6-luna", "low"]]);
    expect(seen[0]!.user).toContain(SPAN);
    expect(seen[0]!.system).toContain(`- "full spec": ${QUESTIONS[0]!.options["full spec"]}`);
    expect(seen[0]!.user).not.toContain("INTAKE FAILED BEFORE");
    // priced from the table, and counted on the record
    expect(used[0]).toEqual({ model: "claude-haiku-5-5", estUsd: (900 * 0.1 + 40 * 0.5) / 1_000_000 });
    expect((await decide(retrying, "llm", state))!.error).toMatch(/needs a model/);
  });
});

describe("the jev adapter", () => {
  it("sends the signals and intake's labels but never the request's words, is not asked what needs them, and records its usage", async () => {
    process.env.TYPESAFE_API_KEY = "ts-test-key";
    _resetEnvCache();
    const sent: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ answers: { maturity: { type: "choice", choice: "casual idea", confidence: 0.82 }, genre: { type: "choice", choice: "common product type", confidence: 0.91 } }, usage: { input_tokens: 400, output_tokens: 0 } }));
    });
    const r = await decide(await ctxFor(), "jev", state);
    expect(r).toMatchObject({ adapter: "jev", answers: [{ id: "maturity", pick: "casual idea", confidence: 0.82 }], dropped: [] });
    expect(r!.answers).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((sent[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer ts-test-key");
    const body = String(sent[0]!.init.body);
    expect(body).not.toContain(SPAN);
    expect(JSON.parse(body)).toMatchObject({ model: "jev-1.13.0", state: { signals: state.signals, intent: state.intent }, questions: { maturity: { type: "choice", criteria: QUESTIONS[0]!.options } } });
    expect(JSON.parse(body).questions.genre).toBeUndefined();
    expect(used).toEqual([{ model: "typesafe/jev-1.13.0", estUsd: (400 * 0.042) / 1_000_000 }]);
    expect(r!.costUsd).toBeCloseTo(0.0000168);
  });

  it("with no key or a failed call, says so on the record", async () => {
    expect((await decide(await ctxFor(), "jev", state))!.error).toMatch(/TYPESAFE_API_KEY is missing/);
    process.env.TYPESAFE_API_KEY = "ts-test-key";
    _resetEnvCache();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    expect((await decide(await ctxFor(), "jev", state))!.error).toBe("Jev answered HTTP 401");
  });
});

describe("signals", () => {
  it("measures a request without a model", () => {
    expect(signals("Admins and customers need a dashboard page.\n- The form must save 3 fields\nGiven a manager\n")).toEqual({ words: 17, acLines: 2, screens: 3, roles: 3, numbers: 1 });
    expect(QUESTIONS.map((q) => q.id)).toEqual(["maturity", "genre"]);
  });
});
