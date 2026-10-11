// Runs inside container A. Reads /job/in.json, drives the Claude Agent SDK in /work (or, for a GPT step,
// the Codex agent: run-codex.mjs), writes /job/out/result.json. No git, no ledger, no real secrets; the API
// key is added by the factory proxy (ANTHROPIC_BASE_URL points at it).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

// progress for the factory's run trace: the host reads this file while the agent works
const progress = (p) => { try { appendFileSync("/job/out/progress.jsonl", JSON.stringify({ ts: Date.now(), ...p }) + "\n"); } catch { /* never break the run */ } };
const short = (s, n = 100) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 3) + "..." : s; };
import { query } from "@anthropic-ai/claude-agent-sdk";

const job = JSON.parse(readFileSync("/job/in.json", "utf8"));
const out = { status: "error", instructionsLoaded: [], deniedEdits: [], usage: {}, costUsd: 0, turns: 0 };

// same small glob as the core: **, *, ?, basename match when no slash
function globRe(g) {
  let s = g.replace(/^\.\//, "");
  const anyDepth = !s.includes("/") || s.startsWith("**/");
  let re = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "*") {
      if (s[i + 1] === "*") { const sl = s[i + 2] === "/"; re += sl ? "(?:.*/)?" : ".*"; i += sl ? 2 : 1; } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  }
  return new RegExp(`^${anyDepth && !s.startsWith("**/") ? "(?:.*/)?" : ""}${re}(?:/.*)?$`);
}
const protectedRes = (job.protectedGlobs ?? []).map(globRe);
const scopeRes = (job.fileScope ?? []).map(globRe);
const rel = (p) => String(p ?? "").replace(/^\/work\/?/, "").replace(/^\.\//, "");

function editDecision(path) {
  const r = rel(path);
  if (r.startsWith("/") || r.startsWith("..")) return `Path ${path} is outside the workspace`;
  if (protectedRes.some((re) => re.test(r))) return `${r} is locked or protected; you may not change it`;
  if (scopeRes.length && !scopeRes.some((re) => re.test(r))) return `${r} is outside this task's file scope (${job.fileScope.join(", ")})`;
  return undefined;
}

// turns (API messages) since a file last changed: a session that only reads and runs things pays for its whole
// context again on every one of them. Edits count, and so do commands that write files.
const idleTurns = new Set();
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const WRITING_COMMAND = /\bsed\s+-i|\btee\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bdotnet\s+(new|format|ef)\b|(^|[^0-9&>])>>?\s*[^&\s>]/;

const hooks = {
  PreToolUse: [{
    hooks: [async (input) => {
      const tool = input.tool_name;
      const ti = input.tool_input ?? {};
      progress({ kind: "tool", tool, target: short(rel(ti.file_path ?? ti.notebook_path ?? ti.path ?? "") || ti.command || ti.pattern || "") });
      if (EDIT_TOOLS.includes(tool)) {
        const reason = editDecision(ti.file_path ?? ti.notebook_path);
        if (reason) {
          out.deniedEdits.push(rel(ti.file_path ?? ti.notebook_path));
          return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
        }
      }
      if (tool === "Bash" && /\bgit\b|curl|wget|nc |ssh |dotnet\s+(add|nuget)|npm\s+(i|install|add)\b/.test(String(ti.command ?? ""))) {
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "No git, network or package installs here. New packages must be declared in the plan." } };
      }
      return {};
    }],
  }],
  // what each tool call put into the session's context: the agent re-reads all of it on every later turn
  PostToolUse: [{
    hooks: [async (input) => {
      const ti = input.tool_input ?? {};
      const r = input.tool_response;
      let chars = 0;
      try { chars = typeof r === "string" ? r.length : JSON.stringify(r ?? "").length; } catch { /* size unknown */ }
      progress({ kind: "result", tool: input.tool_name, target: short(rel(ti.file_path ?? ti.notebook_path ?? ti.path ?? "") || ti.command || ti.pattern || ""), chars });
      // this hook runs only for a call that ran (a denied edit never gets here)
      if (EDIT_TOOLS.includes(input.tool_name) || (input.tool_name === "Bash" && WRITING_COMMAND.test(String(ti.command ?? "")))) idleTurns.clear();
      return {};
    }],
  }],
  InstructionsLoaded: [{
    hooks: [async (input) => { out.instructionsLoaded.push(input.file_path); return {}; }],
  }],
};

/**
 * Selftest only (`factory selftest`): write the scripted files instead of calling a model.
 * The same edit rules apply, so the container, masks and host-side gates are exercised for real.
 */
async function scripted(script) {
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  progress({ kind: "start", model: "scripted" });
  for (const w of script.writes ?? []) {
    progress({ kind: "tool", tool: "Write", target: rel(w.path) });
    const reason = editDecision(`/work/${w.path}`);
    if (reason) { out.deniedEdits.push(rel(w.path)); continue; }
    mkdirSync(dirname(`/work/${w.path}`), { recursive: true });
    writeFileSync(`/work/${w.path}`, w.content);
  }
  out.status = "ok";
  out.output = script.output;
  out.turns = 1;
  out.usage = { input_tokens: 0, output_tokens: 0 };
  progress({ kind: "end", status: "ok", turns: 1, costUsd: 0 });
}

async function main() {
  if (job.script) return scripted(job.script);
  if (job.agent === "codex") return (await import("./run-codex.mjs")).runCodex(job, out, { progress, short, rel });
  const ctxLimits = job.context ?? {};
  const stop = new AbortController();
  const res = query({
    prompt: job.task,
    options: {
      cwd: "/work",
      abortController: stop,
      model: job.model,
      effort: job.effort,
      maxTurns: job.maxTurns,
      maxBudgetUsd: job.maxUsd,
      settingSources: [],
      persistSession: false,
      permissionMode: "dontAsk",
      tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
      allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
      systemPrompt: { type: "preset", preset: "claude_code", append: job.system, excludeDynamicSections: true },
      outputFormat: { type: "json_schema", schema: job.schema },
      hooks,
      // limits on what one tool call may put into the context, and when the context is summarised (set by the core)
      settings: { ...(ctxLimits.bashOutputChars ? { bashOutputMaxChars: ctxLimits.bashOutputChars } : {}), ...(ctxLimits.compactWindow ? { autoCompactWindow: ctxLimits.compactWindow } : {}) },
      env: { ...process.env, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_AGENT_SDK_CLIENT_APP: "ai-factory/0.1", ...(ctxLimits.readTokens ? { CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: String(ctxLimits.readTokens) } : {}) },
    },
  });
  for await (const m of res) {
    if (m.type === "system" && m.subtype === "init") { out.sessionId = m.session_id; progress({ kind: "start", model: m.model }); }
    if (m.type === "system" && m.subtype === "compact_boundary") progress({ kind: "compact", pre: m.compact_metadata?.pre_tokens, trigger: m.compact_metadata?.trigger });
    if (m.type === "assistant") {
      const u = m.message?.usage ?? {};
      const text = (m.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      progress({ kind: "turn", id: m.message?.id, in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), out: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, text: short(text, 160) });
      // too long without changing a file: stopped here, and the core keeps what was written as unfinished work.
      // No SDK total comes after this, so the core counts the spend from the turn lines above.
      if (m.message?.id) idleTurns.add(m.message.id);
      if (ctxLimits.idleTurns && idleTurns.size > ctxLimits.idleTurns) {
        out.status = "no-progress";
        out.error = `Stopped: no file was changed in ${ctxLimits.idleTurns} turns in a row`;
        stop.abort();
        break;
      }
    }
    if (m.type === "result") {
      out.turns = m.num_turns;
      out.costUsd = m.total_cost_usd;
      out.usage = m.usage;
      out.modelUsage = m.modelUsage;
      if (m.subtype === "success" && !m.is_error) {
        out.status = "ok";
        out.output = m.structured_output;
      } else {
        out.status = { error_max_turns: "max-turns", error_max_budget_usd: "over-budget", error_max_structured_output_retries: "bad-output" }[m.subtype] ?? "error";
        out.error = m.subtype;
      }
      progress({ kind: "end", status: out.status, turns: m.num_turns, costUsd: m.total_cost_usd });
      if (typeof m.api_error_status === "number") {
        out.apiErrorStatus = m.api_error_status;
        if ([400, 401, 403, 404].includes(m.api_error_status)) { out.status = "config-error"; out.error = `API error ${m.api_error_status}: ${String(m.result ?? "").slice(0, 300)}`; }
      }
    }
  }
}

// the SDK throws after a result that ended on a limit ("Reached maximum budget"): the result's own status stands
const LIMIT_STOPS = new Set(["over-budget", "max-turns", "bad-output", "config-error", "no-progress"]);
main().catch((e) => { if (!LIMIT_STOPS.has(out.status)) { out.status = "error"; out.error = String(e?.message ?? e); } })
  .finally(() => {
    writeFileSync("/job/out/result.json", JSON.stringify(out));
    // a stopped session's child process may linger: the result is written, so don't wait for it
    if (out.status === "no-progress" || job.agent === "codex") setTimeout(() => process.exit(0), 2000);
  });
