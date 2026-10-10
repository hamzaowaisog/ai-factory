// A GPT coding step inside container A: drives the Codex agent (the `codex` CLI, through its SDK) in /work.
// run-agent.mjs reads the job, calls this, and writes the result. The model calls go to the factory proxy
// (OPENAI_BASE_URL) with the step's token (FACTORY_STEP_TOKEN); the proxy adds the real key.
//
// What differs from the Claude session:
//  - Codex has no hook that runs before an edit, so the file rules are in the briefing and the core undoes
//    any change that breaks them when the session ends (src/runners/codex.ts).
//  - Codex reports tokens only when it finishes, so the proxy is asked what the step's token has spent
//    (FACTORY_SPEND_URL) while it works: that gives the turn lines, and the turn, budget and no-edit stops.
import { mkdirSync } from "node:fs";
import { Codex } from "@openai/codex-sdk";

// the same commands run-agent.mjs counts as changing a file
const WRITING_COMMAND = /\bsed\s+-i|\btee\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bdotnet\s+(new|format|ef)\b|(^|[^0-9&>])>>?\s*[^&\s>]/;
const TOKEN_ENV = "FACTORY_STEP_TOKEN";
const ZERO = { usd: 0, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** Codex prints a command as the shell call it made: `/bin/bash -lc '<command>'`. */
const bare = (command) => { const m = /^\S+\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(String(command ?? "")); return m ? m[2] : String(command ?? ""); };

export async function runCodex(job, out, { progress, short, rel }) {
  const ctx = job.context ?? {};
  const home = process.env.CODEX_HOME ?? "/tmp/codex";
  mkdirSync(home, { recursive: true });
  const codex = new Codex({
    env: { ...process.env, CODEX_HOME: home },
    config: {
      // the proxy as the model provider: plain HTTPS calls to /responses (it does not serve the WebSocket transport)
      model_provider: "factory",
      model_providers: { factory: { name: "factory", base_url: process.env.OPENAI_BASE_URL, env_key: TOKEN_ENV, wire_api: "responses", supports_websockets: false } },
      // the factory's own rules, as a developer message
      developer_instructions: job.system,
      // no AGENTS.md from the repository (the core masks them too)
      project_doc_max_bytes: 0,
      check_for_update_on_startup: false,
      ...(ctx.compactWindow ? { model_auto_compact_token_limit: ctx.compactWindow } : {}),
      ...(ctx.bashOutputChars ? { tool_output_token_limit: Math.round(ctx.bashOutputChars / 4) } : {}),
      // the proxy reads each request's model, so the body goes uncompressed; nothing here needs apps or plugins
      features: { enable_request_compression: false, apps: false, plugins: false },
    },
  });
  const thread = codex.startThread({
    model: job.model, workingDirectory: "/work", skipGitRepoCheck: true,
    // the container is the sandbox: no network but the proxy, the checkout and nothing else
    sandboxMode: "danger-full-access", approvalPolicy: "never", webSearchMode: "disabled",
    ...(job.effort ? { modelReasoningEffort: job.effort } : {}),
  });

  const stop = new AbortController();
  const halt = (status, error) => { if (out.status !== "error") return; out.status = status; out.error = error; stop.abort(); };
  // model calls since a file last changed (run-agent.mjs: a session that only reads pays for its context on every one)
  let sinceEdit = 0, seen = ZERO, asking = false, said = "";
  const spend = async () => {
    if (asking || !process.env.FACTORY_SPEND_URL) return;
    asking = true;
    try {
      const r = await fetch(process.env.FACTORY_SPEND_URL, { headers: { authorization: `Bearer ${process.env[TOKEN_ENV]}` }, signal: AbortSignal.timeout(5000) });
      const s = r.ok ? await r.json() : undefined;
      if (!s || !(s.calls > seen.calls)) return;
      const d = (k) => Math.max(0, (s[k] ?? 0) - seen[k]);
      // as run-agent.mjs writes them: `in` includes the cache reads
      progress({ kind: "turn", id: `call-${s.calls}`, in: d("input_tokens") + d("cache_read_input_tokens"), out: d("output_tokens"), cacheRead: d("cache_read_input_tokens"), cacheWrite: d("cache_creation_input_tokens"), text: short(said, 160) });
      sinceEdit += s.calls - seen.calls;
      seen = { ...ZERO, ...s };
      said = "";
      if (job.maxUsd && seen.usd >= job.maxUsd) halt("over-budget", "error_max_budget_usd");
      else if (job.maxTurns && seen.calls >= job.maxTurns) halt("max-turns", "error_max_turns");
      else if (ctx.idleTurns && sinceEdit > ctx.idleTurns) halt("no-progress", `Stopped: no file was changed in ${ctx.idleTurns} turns in a row`);
    } catch { /* the proxy did not answer: the next ask may */ } finally { asking = false; }
  };
  const timer = setInterval(spend, 3000);

  let answer, usage, failed;
  try {
    const { events } = await thread.runStreamed(job.task, { outputSchema: job.schema, signal: stop.signal });
    for await (const e of events) {
      if (e.type === "thread.started") { out.sessionId = e.thread_id; progress({ kind: "start", model: job.model }); }
      const it = e.item;
      if (e.type === "item.started" && it?.type === "command_execution") progress({ kind: "tool", tool: "Bash", target: short(bare(it.command)) });
      if (e.type === "item.completed" && it?.type === "command_execution") {
        progress({ kind: "result", tool: "Bash", target: short(bare(it.command)), chars: String(it.aggregated_output ?? "").length });
        if (WRITING_COMMAND.test(bare(it.command))) sinceEdit = 0;
      }
      if (e.type === "item.completed" && it?.type === "file_change") {
        // the whole path: the core reads these lines to undo a change the file rules do not allow
        for (const c of it.changes ?? []) progress({ kind: "tool", tool: c.kind === "add" ? "Write" : "Edit", target: rel(c.path) });
        if (it.status === "completed") sinceEdit = 0;
      }
      if (e.type === "item.completed" && it?.type === "agent_message") { answer = it.text; said = it.text; }
      if (e.type === "turn.completed") usage = e.usage;
      if (e.type === "turn.failed") failed = e.error?.message ?? "the turn failed";
      if (e.type === "item.completed" || e.type === "turn.completed" || e.type === "turn.failed") await spend();
    }
  } catch (e) {
    // a stop made here (budget, turns, no edits) ends the stream with an abort: its status stands
    if (out.status === "error") failed = String(e?.message ?? e);
  } finally {
    clearInterval(timer);
  }
  asking = false;
  await spend();

  // Codex's own total when it finished; what the proxy counted when it did not
  const cached = usage?.cached_input_tokens ?? 0, written = usage?.cache_write_input_tokens ?? 0;
  out.usage = usage
    ? { input_tokens: Math.max(0, (usage.input_tokens ?? 0) - cached - written), output_tokens: usage.output_tokens ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: written }
    : { input_tokens: seen.input_tokens, output_tokens: seen.output_tokens, cache_read_input_tokens: seen.cache_read_input_tokens, cache_creation_input_tokens: seen.cache_creation_input_tokens };
  out.turns = seen.calls || (usage ? 1 : 0);
  out.costUsd = seen.usd;
  if (out.status === "error") {
    if (failed !== undefined) {
      out.error = failed.slice(0, 600);
      const status = Number(/\bstatus (\d{3})\b/.exec(failed)?.[1]);
      if (status) out.apiErrorStatus = status;
      if ([400, 401, 403, 404].includes(status)) { out.status = "config-error"; out.error = `API error ${status}: ${failed.slice(0, 300)}`; }
    } else if (!usage) out.error = "Codex ended without finishing its turn";
    else {
      try { out.output = JSON.parse(answer ?? ""); out.status = "ok"; } catch { out.status = "bad-output"; out.error = "The final answer was not the JSON the step asked for"; }
    }
  }
  progress({ kind: "end", status: out.status, turns: out.turns, costUsd: out.costUsd });
}
