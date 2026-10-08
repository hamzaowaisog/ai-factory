import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { DEFAULT_POLICY, withPolicy } from "../gates/policy.js";
import { AGENT_IDLE_TURNS, agentFileMasks, ClaudeAgentRunner, proxyCapUsd } from "./claude-agent.js";
import { AGENT_NET, API_BASE_URL, apiProxyEnv, issueProxyToken, proxyDir, revokeProxyToken } from "./netinfra.js";

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

  it("reads a session that filled the context window as unfinished, not as an error or a bad request", async () => {
    for (const res of [
      { status: "error", error: "Claude Code returned an error result: Prompt is too long" },
      { status: "config-error", apiErrorStatus: 400, error: "API error 400: Prompt is too long" },
    ]) {
      const rt = new FakeRt({ ...res, instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 5, output_tokens: 7 }, costUsd: 1.5, turns: 62 });
      const r = await new ClaudeAgentRunner(rt, { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
        .run({ step: "implement", model: "m", pack, schema: Out, limits: { maxTurns: 80, maxUsd: 4, timeoutSec: 60 }, workdir: worktree() });
      expect(r.status).toBe("timeout");
      expect(r.error).toMatch(/context window/);
      expect(r.usage.estUsd).toBe(1.5);
    }
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

  it("gives the container a step token the key proxy knows, and takes it back when the step ends", async () => {
    const rt = new FakeRt({ status: "ok", output: { done: true, notes: "" }, instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 1 });
    const tokens = join(proxyDir(), "tokens");
    let during: Record<string, unknown>[] = [];
    let idle: unknown;
    const orig = rt.wait.bind(rt);
    rt.wait = async () => {
      during = readdirSync(tokens).map((f) => JSON.parse(readFileSync(join(tokens, f), "utf8")));
      idle = JSON.parse(readFileSync(rt.spec!.mounts.find((m) => m.dst === "/job/in.json")!.src, "utf8")).context.idleTurns;
      return orig();
    };
    await new ClaudeAgentRunner(rt, { runId: "r", key: "implement/TASK-1/1", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 5, maxUsd: 2, timeoutSec: 60 }, workdir: worktree() });
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({ run: "r", key: "implement/TASK-1/1", model: "claude-sonnet-5", capUsd: proxyCapUsd(2), usdPerMTok: { input: 2, output: 10 } });
    // the file is named by the token's hash and holds no token
    expect(JSON.stringify(during)).not.toContain(rt.spec!.env.ANTHROPIC_API_KEY);
    expect(rt.spec!.env.ANTHROPIC_API_KEY).toMatch(/^factory-[0-9a-f]{48}$/);
    expect(readdirSync(tokens)).toEqual([]);
    expect(idle).toBe(AGENT_IDLE_TURNS);
  });

  it("a session stopped for changing no file is unfinished work, and one stopped at the proxy's cap is over budget", async () => {
    const run = (result: object) => new ClaudeAgentRunner(new FakeRt(result), { runId: "r", key: "k", fileScope: [], lockedFiles: [], extraProtected: [], agentEnv: {} })
      .run({ step: "implement", model: "claude-sonnet-5", pack, schema: Out, limits: { maxTurns: 1, maxUsd: 1, timeoutSec: 60 }, workdir: worktree() });
    const idle = await run({ status: "no-progress", error: "Stopped: no file was changed in 45 turns in a row", instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 0 });
    expect(idle.status).toBe("timeout");
    expect(idle.error).toMatch(/no file was changed/);
    const capped = await run({ status: "config-error", apiErrorStatus: 400, error: 'API error 400: {"type":"error","error":{"type":"invalid_request_error","message":"factory proxy: this step\'s spending cap is reached"}}', instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 0 });
    expect(capped.status).toBe("over-budget");
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

  it("the key proxy holds no key in its settings", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear-0000000000";
    try { expect(JSON.stringify(apiProxyEnv())).not.toContain("sk-ant"); } finally { delete process.env.ANTHROPIC_API_KEY; }
  });

  it("the key proxy passes only a model call with a step token and that step's model, and stops a token at its cap", async () => {
    const proxy = await import("../../docker/proxy/proxy.mjs" as string);
    expect(proxy.callAllowed("POST", "/v1/messages?beta=true")).toBe(true);
    expect(proxy.callAllowed("POST", "/v1/messages/count_tokens")).toBe(true);
    expect(proxy.callAllowed("GET", "/v1/messages")).toBe(false);
    expect(proxy.callAllowed("POST", "/v1/messages/batches")).toBe(false);
    expect(proxy.callAllowed("POST", "/v1/files")).toBe(false);
    expect(proxy.modelAllowed("claude-sonnet-5-20260301", ["claude-sonnet-5"])).toBe(true);
    expect(proxy.modelAllowed("claude-sonnet-5-5", ["claude-sonnet-5"])).toBe(false);
    expect(proxy.modelAllowed("claude-haiku-4-5", ["claude-sonnet-5", "claude-haiku-*"])).toBe(true);
    expect(proxy.modelAllowed(undefined, ["claude-sonnet-5"])).toBe(false);

    // a stand-in for the API: records what reached it, answers a stream with token counts
    const seen: { url?: string; key?: string; body: string }[] = [];
    const api = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        seen.push({ url: req.url, key: String(req.headers["x-api-key"]), body });
        if (JSON.parse(body).hang) return; // never answers
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000000,"output_tokens":1}}}\n\n');
        res.end('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":100000}}\n\n');
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    const apiPort = (api.address() as { port: number }).port;
    // 1M input at $2 and 100K output at $10 per million = $3 a call; the cap lets one call through
    const token = issueProxyToken({ run: "r", key: "k", model: "claude-sonnet-5", capUsd: 2.5, usdPerMTok: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } });
    const server: http.Server = proxy.apiServer({
      upstreams: { anthropic: { host: "127.0.0.1", port: apiPort, tls: false, keyHeader: "x-api-key", key: () => "the-real-key" } },
      tokenDir: join(proxyDir(), "tokens"), allowModels: ["claude-haiku-*"], timeoutMs: 300,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const call = (o: { method?: string; path?: string; key?: string; body?: object }) => new Promise<{ status: number; text: string }>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: o.method ?? "POST", path: o.path ?? "/anthropic/v1/messages?beta=true", headers: { "content-type": "application/json", ...(o.key ? { "x-api-key": o.key } : {}) } }, (res) => {
        let text = "";
        res.on("data", (c) => { text += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on("error", () => resolve({ status: -1, text: "" }));
      req.end(o.method === "GET" ? undefined : JSON.stringify(o.body ?? { model: "claude-sonnet-5", messages: [] }));
    });
    try {
      expect((await call({})).status).toBe(401);
      expect((await call({ key: "factory-not-a-registered-token" })).status).toBe(401);
      expect((await call({ key: token, method: "GET", path: "/anthropic/v1/models" })).status).toBe(403);
      expect((await call({ key: token, path: "/anthropic/v1/messages/batches" })).status).toBe(403);
      expect((await call({ key: token, body: { model: "claude-opus-5-5", messages: [] } })).status).toBe(403);
      expect(seen).toHaveLength(0);
      // an API that never answers ends in an error, not a call left open
      expect((await call({ key: token, body: { model: "claude-haiku-4-5", hang: true } })).status).toBe(504);
      const ok = await call({ key: token });
      expect(ok.status).toBe(200);
      expect(ok.text).toContain("message_delta");
      expect(seen.at(-1)).toMatchObject({ url: "/v1/messages?beta=true", key: "the-real-key" });
      expect(JSON.stringify(seen)).not.toContain(token);
      const capped = await call({ key: token });
      expect(capped.status).toBe(400);
      expect(capped.text).toContain(proxy.CAP_TEXT);
      expect(seen).toHaveLength(2);
      // the step ended: its token is worth nothing
      revokeProxyToken(token);
      expect((await call({ key: token })).status).toBe(401);
      expect(existsSync(join(proxyDir(), "tokens"))).toBe(true);
    } finally {
      server.close();
      api.closeAllConnections();
      api.close();
    }
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
      const job = JSON.parse((await import("node:fs")).readFileSync(inJson, "utf8"));
      sent = job.schema;
      // the session's context limits go with the job: output cap, read cap, and when it is summarised
      expect(job.context).toEqual({ bashOutputChars: 10_000, readTokens: 12_000, compactWindow: 400_000, idleTurns: 45 });
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
