import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { DEFAULT_POLICY, withPolicy } from "../gates/policy.js";
import { agentFileMasks, ClaudeAgentRunner } from "./claude-agent.js";
import { AGENT_NET, API_BASE_URL, apiProxyEnv } from "./netinfra.js";

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-agent-"));
});

function worktree(): string {
  const wt = mkdtempSync(join(tmpdir(), "factory-wt-"));
  const files: Record<string, string> = {
    ".git": "gitdir: /somewhere", "CLAUDE.md": "secret instructions", "src/Api/AGENTS.md": "x",
    ".claude/settings.json": "{}", "src/A.cs": "class A {}", ".mcp.json": "{}",
    "src/appsettings.Development.json": '{"ConnectionStrings":{"Db":"Password=real"}}', "src/appsettings.json": "{}",
    "web/package.json": "{}", "web/src/app.ts": "x",
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(wt, p, ".."), { recursive: true });
    writeFileSync(join(wt, p), c);
  }
  return wt;
}

class FakeRt implements ContainerRuntime {
  binary = "fake";
  spec?: ContainerSpec;
  removed = false;
  constructor(private readonly result: object | undefined) {}
  async version() { return "x"; }
  async create(s: ContainerSpec) { this.spec = s; return "a1"; }
  async start() {}
  async wait() {
    const out = this.spec!.mounts.find((m) => m.dst === "/job/out")!;
    if (this.result) writeFileSync(join(out.src, "result.json"), JSON.stringify(this.result));
    return 0;
  }
  async exec() { return { code: 0, stdout: "", stderr: "" }; }
  async isRunning() { return true; }
  async logs() { return ""; }
  async stop() {}
  async remove() { this.removed = true; }
  async listByLabel() { return []; }
  async imageDigest(i: string) { return i; }
}

const pack = { system: "s", user: "u", images: [], pointers: [], tools: [], manifest: { stage: "implement" as const, model: "m", recipeVersion: "1", sections: [], packTokens: 1, budgetTokens: 1, countMethod: "proxy" as const, redactions: 0, packSha: "0".repeat(64) } };
const Out = z.object({ done: z.boolean(), notes: z.string() });

describe("ClaudeAgentRunner (fake runtime)", () => {
  it("masks git metadata and agent files, uses the proxy, never gets the real key", async () => {
    const wt = worktree();
    const rt = new FakeRt({ status: "ok", output: { done: true, notes: "ok" }, instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.01, turns: 3 });
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear-0000000000";
    const r = await new ClaudeAgentRunner(rt, { runId: "r", key: "implement/TASK-1/1", fileScope: ["src/A.cs"], lockedFiles: [], extraProtected: [], agentEnv: { ConnectionStrings__Default: "Host=dummy" } })
      .run({ step: "implement", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 30, maxUsd: 2, timeoutSec: 60 }, workdir: wt });
    expect(r.status).toBe("ok");
    expect(r.output).toEqual({ done: true, notes: "ok" });
    const s = rt.spec!;
    expect(s.network).toBe(AGENT_NET);
    expect(s.env.ANTHROPIC_BASE_URL).toBe(API_BASE_URL);
    expect(JSON.stringify(s)).not.toContain("sk-ant-should-never-appear");
    const masked = s.mounts.filter((m) => m.ro).map((m) => m.dst).sort();
    expect(masked).toEqual(["/job/in.json", "/work/.claude", "/work/.git", "/work/.mcp.json", "/work/CLAUDE.md", "/work/src/Api/AGENTS.md", "/work/src/appsettings.Development.json"]);
    expect(rt.removed).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("fails the step if any instruction file was loaded", async () => {
    const rt = new FakeRt({ status: "ok", output: { done: true, notes: "" }, instructionsLoaded: ["/work/node_modules/x/CLAUDE.md"], deniedEdits: [], usage: {}, costUsd: 0, turns: 1 });
    const r = await new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "m", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/instruction files/);
  });

  it("maps a missing result to an error", async () => {
    const r = await new ClaudeAgentRunner(new FakeRt(undefined), { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "m", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    expect(r.status).toBe("error");
  });

  it("counts spend from progress.jsonl when the agent times out or leaves no result", async () => {
    const lines = [
      { kind: "start", model: "claude-sonnet-5" },
      { kind: "turn", id: "m1", in: 1_000_100, out: 10, cacheRead: 1_000_000, cacheWrite: 0 },
      { kind: "turn", id: "m1", in: 1_000_100, out: 20, cacheRead: 1_000_000, cacheWrite: 0 }, // same message, later block
      { kind: "turn", id: "m2", in: 200_000, out: 1_000_000, cacheRead: 0, cacheWrite: 400_000 },
      { kind: "tool", tool: "Bash" },
    ].map((l) => JSON.stringify({ ts: 1, ...l })).join("\n") + "\n";
    for (const timeout of [true, false]) {
      const rt = new FakeRt(undefined);
      rt.wait = async () => {
        writeFileSync(join(rt.spec!.mounts.find((m) => m.dst === "/job/out")!.src, "progress.jsonl"), lines);
        return timeout ? undefined : 137;
      };
      const r = await new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
        .run({ step: "implement", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
      expect(r.status).toBe(timeout ? "timeout" : "error");
      expect(r.usage).toMatchObject({ inputTokens: 200_100, outputTokens: 1_000_020, cacheRead: 1_000_000, cacheWrite: 400_000, turns: 2 });
      // sonnet-5: 0.2001M×$2 + 1.00002M×$10 + 1M×$0.2 + 0.4M×$2.5
      expect(r.usage.estUsd).toBeCloseTo(0.4002 + 10.0002 + 0.2 + 1, 4);
    }
  });

  it("keeps the SDK's total when the result exists", async () => {
    const rt = new FakeRt({ status: "error", error: "x", instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.5, turns: 2 });
    const r = await new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, estUsd: 0.5, turns: 2 });
  });

  it("refuses a coding model the run's policy doesn't allow (config-error parks) before starting a container", async () => {
    const rt = new FakeRt(undefined);
    const run = () => new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "author-tests", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    const r = await withPolicy({ ...DEFAULT_POLICY, allowedModels: ["claude-opus-5-5"] }, run);
    expect(r.status).toBe("config-error");
    expect(r.error).toMatch(/author-tests needs claude-sonnet-5 but this run's policy allows only claude-opus-5-5/);
    expect(rt.spec).toBeUndefined();
    expect((await withPolicy(DEFAULT_POLICY, run)).status).toBe("error"); // "*": runs (no result here)
  });

  it("lists masks: agent files, tracked secret files, no-go folders", () => {
    const m = agentFileMasks(worktree(), ["web/**"]);
    expect(m.files.sort()).toEqual([".mcp.json", "CLAUDE.md", "src/Api/AGENTS.md"]);
    expect(m.dirs.sort()).toEqual([".claude", "web"]);
    expect(m.secrets).toEqual(["src/appsettings.Development.json"]);
  });
});

describe("egress proxy", () => {
  it("allows only listed feed hosts and routes only known APIs", async () => {
    const proxy = await import("../../docker/proxy/proxy.mjs" as string);
    expect(proxy.hostAllowed("api.nuget.org:443", ["api.nuget.org"])).toBe(true);
    expect(proxy.hostAllowed("pkgs.dev.azure.com", ["api.nuget.org"])).toBe(false);
    expect(proxy.route("/anthropic/v1/messages")).toEqual({ name: "anthropic", path: "/v1/messages" });
    expect(proxy.route("/http://evil.com/")).toBeUndefined();
  });

  // the proxy module reads its keys once at import, so this needs a shell without OPENAI_API_KEY
  it.skipIf(!!process.env.OPENAI_API_KEY)("the key proxy gets only the Anthropic key and refuses routes without a key", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-should-not-reach-proxy";
    try { expect(JSON.stringify(apiProxyEnv())).not.toContain("sk-openai"); } finally { delete process.env.OPENAI_API_KEY; }
    const proxy = await import("../../docker/proxy/proxy.mjs" as string);
    const server: http.Server = proxy.apiServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const status = await new Promise<number>((resolve) => {
      http.request({ host: "127.0.0.1", port, method: "POST", path: "/openai/v1/responses" }, (res) => { res.resume(); resolve(res.statusCode ?? 0); })
        .on("error", () => resolve(-1)).end("{}");
    });
    server.close();
    expect(status).toBe(403);
  });

  it("feed proxy refuses CONNECT to other hosts", async () => {
    const proxy = await import("../../docker/proxy/proxy.mjs" as string);
    const server: http.Server = proxy.feedServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const status = await new Promise<number>((resolve) => {
      http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "evil.example.com:443" })
        .on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); })
        .on("error", () => resolve(-1))
        .end();
    });
    server.close();
    expect(status).toBe(403);
  });
});

describe("the coding agent's output schema", () => {
  it("is draft-07 without a $schema line (Claude Code's checker rejects 2020-12)", async () => {
    const rt = new FakeRt({ status: "ok", output: { done: true, notes: "" }, instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 1 });
    let sent: Record<string, unknown> | undefined;
    const orig = rt.wait.bind(rt);
    rt.wait = async () => {
      const inJson = rt.spec!.mounts.find((m) => m.dst === "/job/in.json")!.src;
      sent = JSON.parse((await import("node:fs")).readFileSync(inJson, "utf8")).schema;
      return orig();
    };
    await new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "claude-sonnet-5", pack, schema: z.object({ done: z.boolean(), notes: z.string(), list: z.array(z.object({ a: z.string().regex(/^AC_/) })).default([]) }), limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    expect(sent).toBeDefined();
    expect(sent!.$schema).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("2020-12");
    expect(JSON.stringify(sent)).not.toContain("$defs");
    expect(sent).toMatchObject({ type: "object", required: expect.arrayContaining(["done", "notes"]) });
  });
});
