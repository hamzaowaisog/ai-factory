import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ContainerRuntime, ContainerSpec } from "../verify/runtime.js";
import { ClaudeAgentRunner, NO_CREDIT_TEXT, type AgentProgress } from "./claude-agent.js";
import { codingRunner, CodexRunner, fileRulesText, toStrictJsonSchema, withoutNulls } from "./codex.js";
import { AGENT_NET, issueProxyToken, OPENAI_BASE_URL, PROXY_SPEND_URL, proxyDir, writeProxyKey } from "./netinfra.js";
import { costUsd } from "./pricing.js";

const made: string[] = [];
const temp = (name: string): string => { const d = mkdtempSync(join(tmpdir(), name)); made.push(d); return d; };
beforeEach(() => { process.env.FACTORY_HOME = temp("factory-codex-"); });
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

const put = (wt: string, path: string, text: string) => { mkdirSync(dirname(join(wt, path)), { recursive: true }); writeFileSync(join(wt, path), text); };
const read = (wt: string, path: string) => readFileSync(join(wt, path), "utf8");

/** A committed checkout: a source file, a locked test, a lock file, and a file outside the task. */
function checkout(): string {
  const wt = temp("factory-codex-wt-");
  put(wt, "src/A.cs", "class A {}");
  put(wt, "src/Other.cs", "class Other {}");
  put(wt, "tests/LockedTests.cs", "locked");
  put(wt, "packages.lock.json", "{}");
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: wt, stdio: "ignore" });
  g("init", "-q"); g("add", "-A"); g("commit", "-q", "-m", "base");
  return wt;
}

/** A container that does, in `session`, what a Codex session would have done to the checkout and its progress file. */
class FakeRt implements ContainerRuntime {
  binary = "fake";
  spec?: ContainerSpec;
  job: Record<string, unknown> = {};
  constructor(private readonly result: object | undefined, private readonly session: (progress: (p: Partial<AgentProgress>) => void) => void = () => undefined) {}
  async version() { return "x"; }
  async create(s: ContainerSpec) { this.spec = s; return "a1"; }
  async start() {}
  async wait() {
    const mount = (dst: string) => this.spec!.mounts.find((m) => m.dst === dst)!.src;
    this.job = JSON.parse(readFileSync(mount("/job/in.json"), "utf8"));
    this.session((p) => appendFileSync(join(mount("/job/out"), "progress.jsonl"), JSON.stringify({ ts: 1, ...p }) + "\n"));
    if (this.result) writeFileSync(join(mount("/job/out"), "result.json"), JSON.stringify(this.result));
    return 0;
  }
  async exec() { return { code: 0, stdout: "", stderr: "" }; }
  async isRunning() { return true; }
  async logs() { return ""; }
  async stop() {}
  async remove() {}
  async listByLabel() { return []; }
  async imageDigest(i: string) { return i; }
}

const pack = { system: "FACTORY RULES", user: "do the task", images: [], pointers: [], tools: [], manifest: { stage: "implement" as const, model: "m", recipeVersion: "1", sections: [], packTokens: 1, budgetTokens: 1, countMethod: "proxy" as const, redactions: 0, packSha: "0".repeat(64) } };
const Out = z.object({ done: z.boolean(), notes: z.string().optional(), probes: z.array(z.object({ path: z.string(), body: z.string().optional() })).default([]) });
const ok = (output: unknown, more: object = {}) => ({ status: "ok", output, instructionsLoaded: [], deniedEdits: [], usage: { input_tokens: 9000, output_tokens: 500, cache_read_input_tokens: 1000 }, costUsd: 0.5, turns: 4, ...more });
const extras = { runId: "r", key: "implement/TASK-1/1", fileScope: ["src/A.cs", "src/New.cs"], lockedFiles: ["tests/LockedTests.cs"], extraProtected: [], agentEnv: {} };
const limits = { maxTurns: 30, maxUsd: 2, timeoutSec: 60 };

describe("the Codex runner's answer shape", () => {
  it("makes every field required and closes every object: an optional field becomes one that may be null", () => {
    const s = toStrictJsonSchema(Out) as { required: string[]; additionalProperties: boolean; properties: Record<string, { anyOf?: { type?: string; items?: { required: string[]; additionalProperties: boolean } }[] }> };
    expect(s.required).toEqual(["done", "notes", "probes"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.notes!.anyOf!.map((a) => a.type)).toEqual(["string", "null"]);
    expect(s.properties.probes!.anyOf![0]!.items).toMatchObject({ required: ["path", "body"], additionalProperties: false });
    expect(JSON.stringify(s)).not.toMatch(/"default"|\$schema/);
    expect(() => toStrictJsonSchema(z.object({ byName: z.record(z.string(), z.string()) }))).toThrow(/free-form map/);
  });

  it("reads a null back as a field left out", () => {
    expect(withoutNulls({ done: true, notes: null, probes: [{ path: "/a", body: null }] })).toEqual({ done: true, probes: [{ path: "/a" }] });
  });
});

describe("CodexRunner (fake runtime)", () => {
  it("picks the runner by the model: Codex for a GPT model, the Claude agent for any other", () => {
    const rt = new FakeRt(undefined);
    expect(codingRunner(rt, extras, "gpt-6-sol")).toBeInstanceOf(CodexRunner);
    expect(codingRunner(rt, extras, "gpt-6-sol").kind).toBe("codex");
    expect(codingRunner(rt, extras, "claude-opus-5-5")).not.toBeInstanceOf(CodexRunner);
    expect(codingRunner(rt, extras, "claude-opus-5-5")).toBeInstanceOf(ClaudeAgentRunner);
  });

  it("runs in the same sealed container, on a step token, with the file rules in its briefing and a strict answer shape", async () => {
    const wt = checkout();
    const rt = new FakeRt(ok({ done: true, notes: null, probes: [] }));
    process.env.OPENAI_API_KEY = "sk-openai-should-never-appear-000000";
    try {
      const r = await new CodexRunner(rt, extras).run({ step: "implement", model: "gpt-6-sol", effort: "xhigh", pack, schema: Out, limits, workdir: wt });
      expect(r.status).toBe("ok");
      // the null the strict shape asked for is read as the field left out
      expect(r.output).toEqual({ done: true, probes: [] });
      // priced from the table, not from the proxy's flat count
      expect(r.usage).toMatchObject({ inputTokens: 9000, outputTokens: 500, cacheRead: 1000, turns: 4 });
      expect(r.usage.estUsd).toBeCloseTo(costUsd("gpt-6-sol", r.usage), 10);
      expect(r.usage.estUsd).not.toBe(0.5);
    } finally { delete process.env.OPENAI_API_KEY; }
    const s = rt.spec!;
    expect(s.network).toBe(AGENT_NET);
    expect(s.env).toMatchObject({ OPENAI_BASE_URL, FACTORY_SPEND_URL: PROXY_SPEND_URL, CODEX_HOME: "/tmp/codex" });
    expect(s.env.FACTORY_STEP_TOKEN).toMatch(/^factory-[0-9a-f]{48}$/);
    expect(s.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("sk-openai-should-never-appear");
    expect(s.mounts.find((m) => m.dst === "/work/.git")?.ro).toBe(true);
    expect(rt.job).toMatchObject({ agent: "codex", model: "gpt-6-sol", effort: "xhigh", maxTurns: 30, maxUsd: 2, task: "do the task" });
    expect(rt.job.system).toContain("FACTORY RULES");
    expect(rt.job.system).toContain("only inside this task's file scope: src/A.cs, src/New.cs");
    expect(rt.job.system).toMatch(/Never change, create or delete a locked or protected file: .*tests\/LockedTests\.cs/);
    expect((rt.job.schema as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it("puts back every edit the file rules do not allow, and leaves the task's own work", async () => {
    const wt = checkout();
    // a protected file already changed before the session (an earlier step's work) is not the session's to lose
    put(wt, "packages.lock.json", '{"earlier":true}');
    const undone: string[] = [];
    const rt = new FakeRt(ok({ done: true }), (progress) => {
      const edit = (tool: "Write" | "Edit", path: string, text: string | undefined) => { if (text === undefined) rmSync(join(wt, path)); else put(wt, path, text); progress({ kind: "tool", tool, target: path }); };
      edit("Edit", "src/A.cs", "class A { int x; }");
      edit("Write", "src/New.cs", "class New {}");
      edit("Edit", "tests/LockedTests.cs", "weakened");
      edit("Edit", "src/Other.cs", undefined);
      edit("Write", "tests/Sneaky.cs", "new file outside the scope");
      edit("Edit", "packages.lock.json", '{"session":true}');
      progress({ kind: "tool", tool: "Edit", target: "../outside.txt" });
      // written by a command, not an edit: left for the gates, as in a Claude session
      put(wt, "src/Generated.cs", "by a command");
    });
    const r = await new CodexRunner(rt, { ...extras, onProgress: (p) => { if (p.tool?.startsWith("Undone")) undone.push(p.target!); } })
      .run({ step: "implement", model: "gpt-6-sol", pack, schema: Out, limits, workdir: wt });
    expect(r.status).toBe("ok");
    expect(read(wt, "src/A.cs")).toBe("class A { int x; }");
    expect(read(wt, "src/New.cs")).toBe("class New {}");
    expect(read(wt, "tests/LockedTests.cs")).toBe("locked");
    expect(read(wt, "src/Other.cs")).toBe("class Other {}");
    expect(existsSync(join(wt, "tests/Sneaky.cs"))).toBe(false);
    expect(read(wt, "packages.lock.json")).toBe('{"earlier":true}');
    expect(read(wt, "src/Generated.cs")).toBe("by a command");
    expect(undone.sort()).toEqual(["packages.lock.json", "src/Other.cs", "tests/LockedTests.cs", "tests/Sneaky.cs"]);
  });

  it("reads OpenAI's refusals: no quota parks like no credit, a rate limit is one, a full context is unfinished work", async () => {
    const run = (result: object) => new CodexRunner(new FakeRt(result), extras).run({ step: "implement", model: "gpt-6-sol", pack, schema: Out, limits, workdir: checkout() });
    const fail = (error: string, more: object = {}) => ({ status: "error", error, instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 0, ...more });
    expect(await run(fail("unexpected status 429: You exceeded your current quota (insufficient_quota)", { apiErrorStatus: 429 }))).toMatchObject({ status: "config-error", error: NO_CREDIT_TEXT });
    expect((await run(fail("unexpected status 429 Too Many Requests", { apiErrorStatus: 429 }))).status).toBe("rate-limited");
    expect((await run(fail("context_length_exceeded: the input exceeds the context window"))).status).toBe("timeout");
    expect((await run({ ...fail("API error 404: model not found", { apiErrorStatus: 404 }), status: "config-error" })).status).toBe("config-error");
    expect((await run(ok({ done: "yes" }))).status).toBe("bad-output");
  });

  it("names the rules a session without a hook must keep", () => {
    expect(fileRulesText([], [])).not.toMatch(/file scope|locked or protected/);
    expect(fileRulesText([], [])).toMatch(/No git, no network calls and no package installs/);
  });
});

describe("the key proxy for an OpenAI step", () => {
  it("writes each vendor's key to its own file, and drops the file of a key that is gone", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000";
    process.env.OPENAI_API_KEY = "sk-openai-test-0000000000";
    try {
      writeProxyKey();
      expect(readFileSync(join(proxyDir(), "openai-key"), "utf8")).toBe("sk-openai-test-0000000000");
      delete process.env.OPENAI_API_KEY;
      writeProxyKey();
      expect(existsSync(join(proxyDir(), "openai-key"))).toBe(false);
    } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; }
  });

  it("passes only POST /v1/responses on the step's model, counts what it used, and tells the step what it has spent", async () => {
    const proxy = await import("../../docker/proxy/proxy.mjs" as string);
    expect(proxy.callAllowed("POST", "/v1/responses", "openai")).toBe(true);
    expect(proxy.callAllowed("POST", "/v1/responses/compact", "openai")).toBe(false);
    expect(proxy.callAllowed("POST", "/v1/chat/completions", "openai")).toBe(false);
    expect(proxy.callAllowed("GET", "/v1/models", "openai")).toBe(false);
    expect(proxy.callAllowed("POST", "/v1/messages", "openai")).toBe(false);

    const seen: { url?: string; auth?: string }[] = [];
    const api = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        seen.push({ url: req.url, auth: String(req.headers.authorization) });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1000000,"input_tokens_details":{"cached_tokens":400000},"output_tokens":100000}}}\n\n');
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    // 600K input at $2, 400K cached at $0.2 and 100K output at $10 per million = $2.28 a call; the cap lets one through
    const token = issueProxyToken({ run: "r", key: "k", model: "gpt-6-sol", capUsd: 2, usdPerMTok: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } });
    const server: http.Server = proxy.apiServer({
      upstreams: { openai: { host: "127.0.0.1", port: (api.address() as { port: number }).port, tls: false, keyHeader: "authorization", key: () => "Bearer the-real-key" } },
      tokenDir: join(proxyDir(), "tokens"), allowModels: [], timeoutMs: 300,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const call = (o: { method?: string; path?: string; auth?: string; model?: string }) => new Promise<{ status: number; text: string }>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: o.method ?? "POST", path: o.path ?? "/openai/v1/responses", headers: { "content-type": "application/json", ...(o.auth ? { authorization: `Bearer ${o.auth}` } : {}) } }, (res) => {
        let text = "";
        res.on("data", (c) => { text += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on("error", () => resolve({ status: -1, text: "" }));
      req.end(o.method === "GET" ? undefined : JSON.stringify({ model: o.model ?? "gpt-6-sol", input: [], stream: true }));
    });
    try {
      expect((await call({})).status).toBe(401);
      expect((await call({ auth: "factory-not-a-registered-token" })).status).toBe(401);
      expect((await call({ auth: token, path: "/openai/v1/chat/completions" })).status).toBe(403);
      expect((await call({ auth: token, model: "gpt-6-luna" })).status).toBe(403);
      expect((await call({ method: "GET", path: "/spend" })).status).toBe(401);
      expect(JSON.parse((await call({ auth: token, method: "GET", path: "/spend" })).text)).toMatchObject({ usd: 0, calls: 0 });
      expect(seen).toHaveLength(0);
      expect((await call({ auth: token })).status).toBe(200);
      expect(seen).toEqual([{ url: "/v1/responses", auth: "Bearer the-real-key" }]);
      const spent = JSON.parse((await call({ auth: token, method: "GET", path: "/spend" })).text);
      expect(spent).toMatchObject({ calls: 1, input_tokens: 600000, cache_read_input_tokens: 400000, output_tokens: 100000 });
      expect(spent.usd).toBeCloseTo(2.28, 6);
      const capped = await call({ auth: token });
      expect(capped.status).toBe(400);
      expect(capped.text).toContain(proxy.CAP_TEXT);
      expect(seen).toHaveLength(1);
    } finally {
      server.close();
      api.closeAllConnections();
      api.close();
    }
  });
});
