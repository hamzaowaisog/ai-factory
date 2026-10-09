// ClaudeAgentRunner (adapters.md; context-builder §2.9): the Claude Agent SDK inside container A.
// Container A gets the worktree files only (the .git link file is masked), agent instruction
// files masked, restored packages read-only, the agent env template (dummy values), and a network
// that reaches only the factory's API proxy. A step may ask for a database of its own (AgentDatabase): an empty
// PostgreSQL that lives as long as the session, so the agent can run the tests that need one.
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { toAgentJsonSchema } from "../contracts/index.js";
import { activePolicy, blockedText, modelAllowed } from "../gates/policy.js";
import { AGENT_FILE_GLOBS, CONFIG_INTEGRITY_GLOBS, isSecretPath, LOCK_SET_GLOBS } from "../gates/protected.js";
import { listFiles } from "../context/snapshot.js";
import { matchesAny } from "../util/glob.js";
import { factoryHome } from "../util/paths.js";
import { fillTemplate, type ProjectConfig } from "../config/project.js";
import type { ContainerRuntime, Mount } from "../verify/runtime.js";
import { createTestLogin, PG_CAPS, pgAdminEnv, waitForPg } from "../verify/test-db.js";
import { stopAndRemove } from "../verify/runtime.js";
import type { Usage } from "../contracts/index.js";
import { supportsEffort } from "./api.js";
import { AGENT_IMAGE, AGENT_NET, API_BASE_URL, issueProxyToken, revokeProxyToken } from "./netinfra.js";
import { costUsd, priceOf } from "./pricing.js";
import { configErrorText, emptyUsage, type Job, type Result, type Runner } from "./types.js";

export interface AgentJobExtras {
  runId: string;
  key: string;
  /** globs the agent may edit (task file scope); empty = anywhere except protected */
  fileScope: string[];
  /** locked test files + declared-extra protected paths */
  lockedFiles: string[];
  extraProtected: string[];
  /** Replace the default protected globs (author-tests may create test files; config stays protected). */
  protectedGlobs?: string[];
  /** per-run restored NuGet folder, mounted read-only */
  packagesDir?: string;
  agentEnv: Record<string, string>;
  /** an empty PostgreSQL for this session alone, reached on the container's own loopback */
  database?: AgentDatabase;
  /** project no-go globs: hidden from the agent (folder globs "dir/**" become empty folders) */
  noGo?: string[];
  onContainer?: (id: string, role: "agent" | "db") => Promise<void>;
  onRemoved?: (id: string) => Promise<void>;
  /** for the run trace: each progress line the agent writes (tool use, turn, end) */
  onProgress?: (p: AgentProgress) => void;
}

/** `env` is the project's producer env template: the same settings the lab's tests get, filled for this session's server. */
export interface AgentDatabase { image: string; name: string; user: string; env: Record<string, string> }

/**
 * The database a coding session gets, or none. None when the tests hardcode a password kept in ~/.factory/.env (that
 * value stays with the lab, and a random one would fail those tests here), and none when no setting names the database.
 */
export function agentDatabase(project: Pick<ProjectConfig, "stack" | "database">): AgentDatabase | undefined {
  const db = project.database;
  if (!db || project.stack === "node" || db.passwordEnv || !Object.keys(db.producerEnv).length) return undefined;
  return { image: db.image, name: db.name, user: db.user, env: db.producerEnv };
}

/** `result`: what a tool call returned, in characters. `compact`: the session's context was summarised (`pre` = tokens before). */
export interface AgentProgress { ts: number; kind: "start" | "tool" | "result" | "compact" | "turn" | "end"; tool?: string; target?: string; id?: string; in?: number; out?: number; cacheRead?: number; cacheWrite?: number; text?: string; status?: string; turns?: number; costUsd?: number; model?: string; chars?: number; pre?: number; trigger?: string }

/**
 * Spend from the per-turn lines when the agent left no SDK total (timeout, crash): tokens summed,
 * priced from the table. `in` includes cache reads; one API message can log several lines (same id),
 * so per id the largest value of each field counts.
 */
export function usageFromProgress(file: string, model: string): Usage {
  const byId = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
  let n = 0;
  for (const p of readProgress(file, 0).lines) {
    if (p.kind !== "turn") continue;
    const k = p.id ?? `#${n++}`, cr = p.cacheRead ?? 0, prev = byId.get(k);
    const t = { input: Math.max(0, (p.in ?? 0) - cr), output: p.out ?? 0, cacheRead: cr, cacheWrite: p.cacheWrite ?? 0 };
    byId.set(k, prev ? { input: Math.max(prev.input, t.input), output: Math.max(prev.output, t.output), cacheRead: Math.max(prev.cacheRead, t.cacheRead), cacheWrite: Math.max(prev.cacheWrite, t.cacheWrite) } : t);
  }
  const u = emptyUsage();
  for (const t of byId.values()) { u.inputTokens += t.input; u.outputTokens += t.output; u.cacheRead += t.cacheRead; u.cacheWrite += t.cacheWrite; }
  u.turns = byId.size;
  u.estUsd = costUsd(model, u);
  return u;
}

/** Read new complete lines of progress.jsonl from `offset`. */
export function readProgress(file: string, offset: number): { lines: AgentProgress[]; offset: number } {
  if (!existsSync(file)) return { lines: [], offset };
  const buf = readFileSync(file);
  if (buf.length <= offset) return { lines: [], offset };
  const chunk = buf.subarray(offset).toString("utf8");
  const end = chunk.lastIndexOf("\n");
  if (end < 0) return { lines: [], offset };
  const lines = chunk.slice(0, end).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as AgentProgress]; } catch { return []; } });
  return { lines, offset: offset + Buffer.byteLength(chunk.slice(0, end + 1)) };
}

/**
 * What keeps a coding session's context small: every later turn pays to read it again.
 *  - a command's output past this many characters goes to a file, and the agent gets a preview and the path (the SDK's default
 *    is 30,000). 20,000 since the session has a database and runs the locked tests: a failing run's output has to fit.
 *  - one file read returns at most this many tokens; a bigger file is read in parts (the SDK's default is 25,000)
 *  - the context is summarised at this many tokens, or at the model's own window when that is smaller (context-builder §2.10).
 *    Set from run 31fe: no session that passed went above 104K, and the ones that failed peaked at 145K to 175K, so this
 *    leaves a passing session alone and summarises a long one earlier than the 200K window did.
 */
export const AGENT_CONTEXT = { bashOutputChars: 20_000, readTokens: 12_000, compactWindow: 150_000 };

/**
 * A session that goes this many turns in a row without changing a file is stopped, and what it wrote is kept
 * like any unfinished work. A backstop, set above every past session: across the 24 sessions of run 31fe the
 * longest such stretch was 32 turns in one that finished (reading before its first edit) and 40 in one that failed.
 */
export const AGENT_IDLE_TURNS = 45;

/**
 * The key proxy counts what a step's token spends and refuses it past this. The agent SDK enforces the step's
 * own budget between turns, so this sits above it: it is for calls made around the SDK, or a budget that failed.
 */
export function proxyCapUsd(maxUsd: number): number {
  return maxUsd * 1.5 + 1;
}
/** The proxy's refusal of a token past its cap (proxy.mjs CAP_TEXT). */
const PROXY_CAP = /factory proxy: this step's spending cap is reached/i;

/** The API's refusal of a request that no longer fits the model's context window. */
const SESSION_FULL = /prompt is too long/i;
/** The API account has no credit left: no retry, model or effort can fix it, only a person adding credit. */
export const NO_CREDIT = /credit balance is too low/i;
export const NO_CREDIT_TEXT = "The model account is out of credit (the API said: Credit balance is too low). Add credit, then resume the run.";

export interface AgentOut {
  status: string;
  output?: unknown;
  error?: string;
  instructionsLoaded: string[];
  deniedEdits: string[];
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  costUsd: number;
  turns: number;
  sessionId?: string;
  apiErrorStatus?: number;
}

/**
 * Masks for container A, all read-only:
 *  - agent instruction files at any depth (context-builder §2.9) → empty
 *  - tracked secret files (.env*, appsettings.*.json, keys…) → "{}" for JSON, empty otherwise (§2.6)
 *  - no-go folders from the project config → empty folder
 */
export function agentFileMasks(worktree: string, noGo: string[] = []): { files: string[]; dirs: string[]; secrets: string[] } {
  const files: string[] = [], dirs = new Set<string>(), secrets: string[] = [];
  for (const g of noGo) {
    const m = /^([^*?{]+?)\/\*\*$/.exec(g);
    if (m && existsSync(join(worktree, m[1]!))) dirs.add(m[1]!);
  }
  const hidden = [...dirs];
  for (const f of listFiles(worktree)) {
    if (hidden.some((d) => f.startsWith(`${d}/`))) continue;
    if (isSecretPath(f, noGo)) { secrets.push(f); continue; }
    if (!matchesAny(f, AGENT_FILE_GLOBS)) continue;
    const parts = f.split("/");
    const i = parts.findIndex((p) => /^\.(claude|codex|cursor)$/.test(p));
    if (i >= 0 && i < parts.length - 1) dirs.add(parts.slice(0, i + 1).join("/"));
    else if (f === ".github/instructions" || f.startsWith(".github/instructions/")) dirs.add(".github/instructions");
    else files.push(f);
  }
  return { files, dirs: [...dirs], secrets };
}

/** Selftest only: files the container writes instead of calling a model, and the answer it returns. */
export interface AgentScript { writes: { path: string; content: string }[]; output: unknown }
let agentScript: ((step: string) => AgentScript | undefined) | undefined;
export function setAgentScript(f: typeof agentScript): void {
  agentScript = f;
}

export class ClaudeAgentRunner implements Runner {
  readonly kind = "claude-agent" as const;
  constructor(private readonly rt: ContainerRuntime, private readonly extras: AgentJobExtras) {}

  async run<T>(job: Job<T>): Promise<Result<T>> {
    if (!job.workdir) throw new Error("ClaudeAgentRunner needs the worktree");
    // the run's policy decides the coding model too (config-error parks the step)
    const pol = activePolicy();
    if (pol && !modelAllowed(pol, job.model)) return { status: "config-error", error: blockedText(job.step, job.model, pol), usage: emptyUsage() };
    const started = Date.now();
    const x = this.extras;
    const jobDir = join(factoryHome(), "tmp", x.runId, `agent-${randomBytes(4).toString("hex")}`);
    const outDir = join(jobDir, "out");
    const emptyDir = join(jobDir, "empty-dir");
    const emptyFile = join(jobDir, "empty-file");
    mkdirSync(outDir, { recursive: true });
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(emptyFile, "");
    // agent steps write code: images are untrusted and never reach them (the pack refuses them too)
    if (job.pack.images.length) throw new Error(`${job.step} is an agent step and can't take images`);
    writeFileSync(join(jobDir, "in.json"), JSON.stringify({
      model: job.model,
      // Haiku 4.5 and older models reject an effort setting
      effort: supportsEffort(job.model) ? (job.effort ?? "high") : undefined,
      maxTurns: job.limits.maxTurns,
      maxUsd: job.limits.maxUsd,
      system: job.pack.system,
      task: job.pack.user,
      schema: toAgentJsonSchema(job.schema), // draft-07: what Claude Code's checker accepts
      fileScope: x.fileScope,
      protectedGlobs: [...(x.protectedGlobs ?? [...LOCK_SET_GLOBS, ...CONFIG_INTEGRITY_GLOBS]), ...x.lockedFiles, ...x.extraProtected],
      script: agentScript?.(job.step),
      context: { ...AGENT_CONTEXT, idleTurns: AGENT_IDLE_TURNS },
    }));

    const mounts: Mount[] = [
      { src: job.workdir, dst: "/work" },
      { src: join(jobDir, "in.json"), dst: "/job/in.json", ro: true },
      { src: outDir, dst: "/job/out" },
    ];
    // no git metadata in container A
    if (existsSync(join(job.workdir, ".git"))) {
      mounts.push(lstatSync(join(job.workdir, ".git")).isDirectory()
        ? { src: emptyDir, dst: "/work/.git", ro: true }
        : { src: emptyFile, dst: "/work/.git", ro: true });
    }
    const masks = agentFileMasks(job.workdir, x.noGo ?? []);
    const emptyJson = join(jobDir, "empty.json");
    writeFileSync(emptyJson, "{}\n");
    for (const f of masks.files) mounts.push({ src: emptyFile, dst: `/work/${f}`, ro: true });
    for (const f of masks.secrets) mounts.push({ src: f.endsWith(".json") ? emptyJson : emptyFile, dst: `/work/${f}`, ro: true });
    for (const d of masks.dirs) mounts.push({ src: emptyDir, dst: `/work/${d}`, ro: true });
    if (x.packagesDir) mounts.push({ src: x.packagesDir, dst: "/nuget", ro: true });

    // this step's own pass through the key proxy: gone when the step ends
    const token = issueProxyToken({ run: x.runId, key: x.key, model: job.model, capUsd: proxyCapUsd(job.limits.maxUsd), usdPerMTok: priceOf(job.model) });
    let id: string | undefined, dbId: string | undefined;
    try {
      let dbEnv: Record<string, string> = {};
      if (x.database) {
        // The server sits on the agent network (the coding container shares its network space, and needs the key proxy)
        // but listens on loopback only: no other session on that network can reach it. Not the lab's database, and
        // gone with the session.
        const vars = { DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_NAME: x.database.name, DB_USER: x.database.user, DB_PASSWORD: randomBytes(12).toString("hex") };
        dbId = await this.rt.create({
          image: x.database.image, role: "db", labels: { run: x.runId, key: x.key }, network: AGENT_NET, user: "",
          env: pgAdminEnv(), capAdd: PG_CAPS, mounts: [], cmd: ["postgres", "-c", "listen_addresses=127.0.0.1"],
        });
        await x.onContainer?.(dbId, "db");
        await this.rt.start(dbId);
        await waitForPg(this.rt, dbId);
        await createTestLogin(this.rt, dbId, vars);
        dbEnv = fillTemplate(x.database.env, vars);
      }
      id = await this.rt.create({
        image: AGENT_IMAGE, role: "agent", labels: { run: x.runId, key: x.key }, network: dbId ? `container:${dbId}` : AGENT_NET,
        user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, workdir: "/work", mounts,
        env: {
          ...x.agentEnv,
          ...dbEnv,
          ANTHROPIC_BASE_URL: API_BASE_URL,
          ANTHROPIC_API_KEY: token, // not a key: the proxy swaps it for the real one
          HOME: "/tmp/home", CLAUDE_CONFIG_DIR: "/tmp/claude",
        },
        cmd: [], tmpfs: ["/tmp:exec,size=2g"],
      });
      await x.onContainer?.(id, "agent");
      await this.rt.start(id);
      // forward the agent's progress to the trace while it works
      const progressFile = join(outDir, "progress.jsonl");
      let offset = 0;
      let ended = false;
      const pump = () => { const r = readProgress(progressFile, offset); offset = r.offset; for (const p of r.lines) { if (p.kind === "end") ended = true; x.onProgress?.(p); } };
      const timer = x.onProgress ? setInterval(pump, 3000) : undefined;
      let code: number | undefined;
      try {
        code = await this.rt.wait(id, job.limits.timeoutSec * 1000);
      } finally {
        if (timer) clearInterval(timer);
        pump();
      }
      await this.rt.stop(id, 5); // kills leftover processes before the core commits
      const resultPath = join(outDir, "result.json");
      // no SDK total (timeout, crash): count the spend from the per-turn lines before the folder goes
      const fromProgress = (): Usage => ({ ...usageFromProgress(progressFile, job.model), wallMs: Date.now() - started });
      // a session that was cut off wrote no end line: the trace gets one, so its time and totals are counted like any other
      if (!ended && existsSync(progressFile)) { const u = fromProgress(); x.onProgress?.({ ts: Date.now(), kind: "end", status: code === undefined ? "timeout" : "cut off", turns: u.turns, costUsd: u.estUsd }); }
      if (code === undefined) return { status: "timeout", usage: fromProgress() };
      if (!existsSync(resultPath)) return { status: "error", error: `Agent exited ${code} without a result`, usage: fromProgress() };
      const out = JSON.parse(readFileSync(resultPath, "utf8")) as AgentOut;
      // result.json is also written when the SDK threw before its result message: no total then
      const noTotal = !out.turns && !out.costUsd && !out.usage?.input_tokens && !out.usage?.output_tokens;
      const u = noTotal ? fromProgress() : {
        inputTokens: out.usage.input_tokens ?? 0, outputTokens: out.usage.output_tokens ?? 0,
        cacheRead: out.usage.cache_read_input_tokens ?? 0, cacheWrite: out.usage.cache_creation_input_tokens ?? 0,
        turns: out.turns, wallMs: Date.now() - started, estUsd: out.costUsd,
      };
      // hard check: any instruction file not from the factory fails the step (context-builder §2.9)
      if (out.instructionsLoaded.length) {
        return { status: "error", error: `Agent loaded instruction files: ${out.instructionsLoaded.join(", ")}`, usage: u, sessionId: out.sessionId };
      }
      if (out.status !== "ok") {
        // compaction is on (context-builder §2.10), but one huge output can still fill the model's window: unfinished work, like running out of turns
        if (SESSION_FULL.test(out.error ?? "")) return { status: "timeout", error: "The session filled the model's context window before it finished", usage: u, sessionId: out.sessionId };
        if (NO_CREDIT.test(out.error ?? "")) return { status: "config-error", error: NO_CREDIT_TEXT, usage: u, sessionId: out.sessionId };
        if (PROXY_CAP.test(out.error ?? "")) return { status: "over-budget", error: "The key proxy stopped this step: its calls cost more than the step's budget allows", usage: u, sessionId: out.sessionId };
        if (out.status === "config-error") {
          return { status: "config-error", error: out.apiErrorStatus === 403
            ? "The coding agent's API calls were refused by the factory's key proxy or the API (403). Run factory doctor."
            : configErrorText(out.apiErrorStatus, out.error ?? "", job.model), usage: u, sessionId: out.sessionId };
        }
        const status = out.status === "over-budget" ? "over-budget" : out.status === "bad-output" ? "bad-output" : out.status === "max-turns" || out.status === "no-progress" ? "timeout" : "error";
        return { status, error: out.error, usage: u, sessionId: out.sessionId };
      }
      const parsed = job.schema.safeParse(out.output);
      if (!parsed.success) return { status: "bad-output", error: parsed.error.message.slice(0, 500), usage: u, sessionId: out.sessionId };
      return { status: "ok", output: parsed.data, usage: u, sessionId: out.sessionId };
    } finally {
      if (id) {
        await stopAndRemove(this.rt, id).catch(() => undefined);
        await x.onRemoved?.(id);
      }
      if (dbId) {
        await stopAndRemove(this.rt, dbId).catch(() => undefined);
        await x.onRemoved?.(dbId);
      }
      revokeProxyToken(token);
      rmSync(jobDir, { recursive: true, force: true });
    }
  }
}
