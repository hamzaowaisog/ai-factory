// Impact lenses with the fake provider only: no model is called.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import type { StepContext } from "./framework.js";
import { impactStep, type ImpactResult } from "./impact.js";
import { setProviderFactory } from "./think.js";
import { NO_TRACE } from "../util/trace.js";

const FILES: Record<string, string> = {
  "src/Orders/OrderService.cs": "public class OrderService\n{\n    public void Cancel(int id) { }\n}\n",
  "src/Orders/OrdersEndpoints.cs": "app.MapPost(\"/api/orders/{id}/cancel\", (int id, OrderService s) => s.Cancel(id));\n",
  "src/Billing/Refunds.cs": "public class Refunds\n{\n    // refunds follow a cancelled order\n    public void OnCancelled(int orderId) { }\n}\n",
  "src/Orders/Notes.cs": "public class Notes { }\n",
};
const U = { inputTokens: 3000, outputTokens: 400, cacheRead: 0, cacheWrite: 0 };
type F = { path: string; lineStart: number; lineEnd: number; quote: string; level: string; reqId?: string; why: string };
let answers: Record<string, (() => F[] | Error)[]>;
let calls: string[];

const provider: Provider = {
  start(_m, _e, system): Conversation {
    const lens = /You are the (\w+) lens/.exec(system)![1]!;
    calls.push(lens);
    const next = answers[lens]?.shift() ?? (() => []);
    return {
      async next(): Promise<Turn> {
        const a = next();
        if (a instanceof Error) throw a;
        return { calls: [{ id: "s", name: "submit_result", input: { findings: a } }], text: "", stop: "tool_use", usage: U };
      },
      toolResults() {}, say() {},
    };
  },
};

function repo(): { dir: string; commit: string } {
  const dir = mkdtempSync(join(tmpdir(), "factory-lens-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  for (const [p, t] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  git("add", "-A"); git("commit", "-q", "-m", "init");
  return { dir, commit: git("rev-parse", "HEAD").trim() };
}

async function runImpact(lenses: boolean) {
  const { dir, commit } = repo();
  const ledger = Ledger.create(`20261004-lens-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "x", repoPath: dir, baseCommit: commit, baseRef: "main" } }, HUMAN_WRITER);
  const done = async (step: string, out: unknown) => {
    const o = ledger.putJson(out);
    await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs: [o], data: { named: { [step]: o } } }, HUMAN_WRITER);
  };
  const anchor = { path: "src/Orders/OrderService.cs", lineStart: 3, lineEnd: 3, quote: "public void Cancel(int id) { }" };
  await done("intake", { spans: [{ id: "I-1", text: "cancel" }], risk: "low" });
  await done("ground", { claims: [{ id: "C1", text: "", spans: ["I-1"], anchors: [{ ...anchor, symbol: "OrderService.Cancel" }] }], notFound: [] });
  await done("specify", { requirements: [{ id: "REQ-1", op: "MODIFIED", ears: "Cancelling refunds the order.", sources: [], acceptance: [], anchors: [anchor] }] });
  const state = replay(ledger.events());
  const used: number[] = [];
  const ctx: StepContext = {
    runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: dir, stack: "dotnet", ...(lenses ? { impact: { lenses: true } } : {}) }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async (u) => { used.push(u.estUsd ?? 0); },
  };
  const out = await impactStep.run(ctx);
  if (out.kind !== "done") throw new Error(JSON.stringify(out));
  return { impact: ledger.getJson<ImpactResult>(out.outputs.impact!), data: out.data!, used };
}

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-lens-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
  setProviderFactory(() => provider);
  answers = {}; calls = [];
});

describe("impact lenses (fake provider)", () => {
  it("off by default: no model is called and nothing is recorded per lens", async () => {
    const { impact } = await runImpact(false);
    expect(calls).toEqual([]);
    expect(impact.lensStats).toBeUndefined();
  });

  it("four lenses in parallel; quoted findings with a requirement raise a file, without one they stay 'check'", async () => {
    answers.callers = [() => [
      { path: "src/Billing/Refunds.cs", lineStart: 4, lineEnd: 4, quote: "public void OnCancelled(int orderId) { }", level: "must-change", reqId: "REQ-1", why: "refunds must run on cancel" },
      { path: "src/Orders/Notes.cs", lineStart: 1, lineEnd: 1, quote: "public class Notes { }", level: "breaks", why: "no requirement given" },
      { path: "src/Orders/OrderService.cs", lineStart: 3, lineEnd: 3, quote: "public void Cancel(int id) { }", level: "must-change", reqId: "REQ-1", why: "seed: ignored" },
    ]];
    const { impact, used, data } = await runImpact(true);
    expect(calls.sort()).toEqual(["callers", "data", "screens", "tests"]);
    const item = (p: string) => impact.items.find((i) => i.path === p);
    expect(item("src/Billing/Refunds.cs")).toMatchObject({ level: "must-change", lens: "callers", reason: "REQ-1: refunds must run on cancel (callers lens)" });
    expect(item("src/Orders/Notes.cs")!.level).toBe("check");
    const callers = impact.lensStats!.find((l) => l.lens === "callers")!;
    expect(callers).toMatchObject({ findings: 2, bad: 0, demoted: 1, retried: false, model: "claude-sonnet-5-5" });
    expect(callers.usd).toBeGreaterThan(0);
    expect(used).toHaveLength(4); // every lens's usage reaches the run's cost
    expect(Object.keys(data.lensUsd as object).sort()).toEqual(["callers", "data", "screens", "tests"]);
  });

  it("more than 30% bad quotes: the lens is asked once more and the second answer is used", async () => {
    answers.data = [
      () => [{ path: "src/Billing/Refunds.cs", lineStart: 1, lineEnd: 1, quote: "made up", level: "check", why: "x" }, { path: "src/Nope.cs", lineStart: 1, lineEnd: 1, quote: "x", level: "check", why: "x" }],
      () => [{ path: "src/Billing/Refunds.cs", lineStart: 3, lineEnd: 3, quote: "// refunds follow a cancelled order", level: "check", why: "reads orders" }],
    ];
    const { impact } = await runImpact(true);
    expect(calls.filter((c) => c === "data")).toHaveLength(2);
    expect(impact.lensStats!.find((l) => l.lens === "data")).toMatchObject({ retried: true, findings: 1, bad: 0 });
    expect(impact.items.find((i) => i.path === "src/Billing/Refunds.cs")).toMatchObject({ level: "check", lens: "data" });
  });

  it("a lens that fails is skipped and reported; the step still completes with the code layer", async () => {
    answers.screens = [() => new Error("boom")];
    const { impact } = await runImpact(true);
    const screens = impact.lensStats!.find((l) => l.lens === "screens")!;
    expect(screens.error).toBeTruthy();
    expect(screens.findings).toBe(0);
    expect(impact.items.find((i) => i.path === "src/Orders/OrderService.cs")).toMatchObject({ level: "check", reason: "REQ-1 (MODIFIED) points at it" });
  });
});
