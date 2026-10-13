// The run page's conversation: what the factory asked a model and what the model said back, in plain words, read from the
// run trace. The trace lines carry a short start of each side; the whole briefing and the whole turn are in the ledger.
import { maskSecrets } from "../config/env.js";
import { Redactor } from "../context/secrets.js";
import type { ContextPack } from "../contracts/index.js";
import type { Ledger } from "../ledger/ledger.js";
import { readTrace, type TraceEvent } from "../util/trace.js";

/** One thing the model did in answer: what it said, what it looked up, its answer, or how the call ended. */
export interface TalkReply {
  ts: string;
  kind: "said" | "tools" | "answer" | "rejected" | "reused" | "ended";
  text: string;
  /** the whole turn, in the ledger */
  sha?: string;
}

export interface TalkExchange {
  ts: string;
  /** step and attempt, as the activity log names them */
  where: string;
  /** what the call is for (the step, a design page, a task's implementer) */
  who: string;
  model?: string;
  sent?: { summary: string; ask?: string; sha?: string };
  replies: TalkReply[];
  /** replies left out before the ones shown */
  earlier: number;
  /** nothing back from the model yet */
  waiting: boolean;
}

/** how many exchanges the run page shows, and how many replies of one exchange (a coding agent takes hundreds of turns) */
export const TALK_EXCHANGES = 20;
export const TALK_REPLIES = 12;

const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const whereOf = (e: TraceEvent) => (e.step ? `${e.step}${e.attempt ? `#${e.attempt}` : ""}` : "run");
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** "Sent 12.4K tokens: the request, with requirements (8.1K), repo-map (3K)" from a briefing's trace line. */
function sentSummary(d: Record<string, unknown>): string {
  const tokens = typeof d.packTokens === "number" ? d.packTokens : 0;
  const parts = (Array.isArray(d.sections) ? d.sections as { id?: string; tokens?: number }[] : [])
    .filter((x) => x.id && x.id !== "task" && x.id !== "recap" && (x.tokens ?? 0) > 0)
    .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
  const named = parts.slice(0, 4).map((x) => `${x.id} (${kTok(x.tokens ?? 0)})`);
  const more = parts.length - named.length;
  const images = typeof d.images === "number" && d.images ? ` and ${d.images} picture${d.images === 1 ? "" : "s"}` : "";
  return `Sent a briefing of about ${kTok(tokens)} tokens${images}: the request${named.length ? `, with ${named.join(", ")}${more > 0 ? ` and ${more} more part${more === 1 ? "" : "s"}` : ""}` : ""}.`;
}

/** The trace lines of a run as exchanges, oldest first. */
export function talkOf(trace: TraceEvent[]): TalkExchange[] {
  const all: (TalkExchange & { agent: string[] })[] = [];
  // the exchange a line belongs to: the latest one of its step and attempt, for the same call when the line names it
  const find = (e: TraceEvent, who?: string) => {
    const where = whereOf(e);
    for (let i = all.length - 1; i >= 0; i--) if (all[i]!.where === where && (!who || all[i]!.who === who)) return all[i]!;
    return undefined;
  };
  const open = (e: TraceEvent, who: string, model?: string) => {
    const x: TalkExchange & { agent: string[] } = { ts: e.ts, where: whereOf(e), who, model, replies: [], earlier: 0, waiting: true, agent: [] };
    all.push(x);
    return x;
  };
  const add = (x: TalkExchange, r: TalkReply) => { x.replies.push(r); x.waiting = false; };
  // a coding agent's tool calls between two things it says are one line
  const flush = (x: TalkExchange & { agent: string[] }, ts: string) => {
    if (!x.agent.length) return;
    const shown = x.agent.slice(-6);
    add(x, { ts, kind: "tools", text: `Used ${x.agent.length} tool${x.agent.length === 1 ? "" : "s"}: ${x.agent.length > shown.length ? "… " : ""}${shown.join(", ")}` });
    x.agent = [];
  };

  for (const e of trace) {
    const d = e.data ?? {};
    if (e.kind === "pack") {
      const who = str(d.who) ?? /^(.*?): briefing /.exec(e.msg)?.[1] ?? "model call";
      const x = open(e, who, str(d.model));
      x.sent = { summary: sentSummary(d), ...(str(d.ask) ? { ask: str(d.ask) } : {}), ...(str(d.packSha) ? { sha: str(d.packSha) } : {}) };
    } else if (e.kind === "cache.hit") {
      const who = str(d.who) ?? /^(.*?) reused from /.exec(e.msg)?.[1] ?? "model call";
      const x = find(e, who) ?? open(e, who, str(d.model));
      add(x, { ts: e.ts, kind: "reused", text: `No model call: the same briefing was answered before${str(d.fromRun) ? ` in run ${str(d.fromRun)}` : ""}, and that stored answer was used.` });
    } else if (e.kind === "model.turn") {
      const who = str(d.who) ?? /^(.*?) turn \d+ /.exec(e.msg)?.[1];
      const x = find(e, who) ?? open(e, who ?? "model call", str(d.model));
      x.model ??= str(d.model);
      const sha = str(d.turnSha);
      const tools = Array.isArray(d.tools) ? d.tools.map(String) : /  → (?!answer)(.*?)(?:  → answer|  \(hit max tokens\)|$)/.exec(e.msg)?.[1]?.split(/, (?=\w+\()/) ?? [];
      if (str(d.said)) add(x, { ts: e.ts, kind: "said", text: str(d.said)!, sha });
      if (tools.length) add(x, { ts: e.ts, kind: "tools", text: `Looked things up: ${tools.join(", ")}`, sha });
      const rejected = /answer REJECTED: (.*?)(?:  \(hit max tokens\))?$/.exec(e.msg)?.[1];
      if (rejected) add(x, { ts: e.ts, kind: "rejected", text: `Its answer did not have the shape the factory asked for, so it was sent back: ${rejected}`, sha });
      else if (/→ answered/.test(e.msg)) add(x, { ts: e.ts, kind: "answer", text: str(d.answer) ?? "Gave its answer.", sha });
      if (d.maxTokens) add(x, { ts: e.ts, kind: "ended", text: "Cut off: the model reached its output limit before it finished.", sha });
      // a turn with nothing to show (no words, no tool, no answer) still shows the model answered
      if (x.waiting) add(x, { ts: e.ts, kind: "said", text: "(a turn with no text)", sha });
    } else if (e.kind === "agent.start" || e.kind === "agent.tool" || e.kind === "agent.turn" || e.kind === "agent.end") {
      const m = /^(.*?): (.*)$/s.exec(e.msg);
      const x = find(e) ?? open(e, m?.[1] ?? "coding agent");
      const rest = m?.[2] ?? e.msg;
      if (e.kind === "agent.start") x.model ??= /\((.*)\)$/.exec(rest)?.[1];
      else if (e.kind === "agent.tool") x.agent.push(rest.trim());
      else if (e.kind === "agent.turn") {
        const text = str(d.text) ?? /"(.*)"$/s.exec(rest)?.[1];
        if (text) { flush(x, e.ts); add(x, { ts: e.ts, kind: "said", text }); }
      } else {
        flush(x, e.ts);
        add(x, { ts: e.ts, kind: "ended", text: rest.replace(/^agent finished: /, "Finished: ") });
      }
    }
  }
  return all.map(({ agent, ...x }) => {
    // tool calls of an agent still at work
    const replies = agent.length ? [...x.replies, { ts: x.replies.at(-1)?.ts ?? x.ts, kind: "tools" as const, text: `Using tools: ${agent.slice(-6).join(", ")}` }] : x.replies;
    return { ...x, waiting: x.waiting && !agent.length, replies: replies.slice(-TALK_REPLIES), earlier: Math.max(0, replies.length - TALK_REPLIES) };
  });
}

/** The latest exchanges of a run, for its page. */
export function talkView(trace: TraceEvent[]): { exchanges: TalkExchange[]; earlier: number } {
  const all = talkOf(trace);
  return { exchanges: all.slice(-TALK_EXCHANGES), earlier: Math.max(0, all.length - TALK_EXCHANGES) };
}

/** the most of one tool result shown in a turn's full text */
const RESULT_MAX = 4000;

/**
 * The whole of one side of an exchange, as text: a briefing (the system and user messages) or a model turn (what it said,
 * each tool call with its result, its answer). Only what the run's own trace names can be read, and it is masked again.
 */
export function talkText(ledger: Ledger, sha: string): { kind: "sent" | "reply"; text: string } | undefined {
  const named = readTrace(ledger.dir).find((e) => (e.kind === "pack" && e.data?.packSha === sha) || (e.kind === "model.turn" && e.data?.turnSha === sha));
  if (!named || !ledger.hasArtifact(sha)) return undefined;
  const clean = (text: string) => new Redactor().redact(maskSecrets(text)).text;
  if (named.kind === "pack") {
    const p = ledger.getJson<ContextPack>(sha);
    const pictures = p.images.length ? `\n\n(${p.images.length} picture${p.images.length === 1 ? "" : "s"} sent with it)` : "";
    const tools = p.tools.length ? `\n\nTOOLS IT MAY CALL\n${p.tools.join(", ")}` : "";
    return { kind: "sent", text: clean(`STANDING INSTRUCTIONS (system message)\n${p.system || "(none)"}\n\nTHIS REQUEST (user message)\n${p.user}${pictures}${tools}`) };
  }
  const t = ledger.getJson<{ text?: string; stop?: string; calls?: { name: string; input: unknown; isError?: boolean; result?: string }[] }>(sha);
  const parts: string[] = [];
  if (t.text?.trim()) parts.push(`THE MODEL SAID\n${t.text.trim()}`);
  for (const c of t.calls ?? []) {
    if (c.name === "submit_result") { parts.push(`ITS ANSWER\n${JSON.stringify(c.input, null, 1)}${c.isError ? `\n\nSENT BACK BY THE FACTORY\n${c.result ?? ""}` : ""}`); continue; }
    const result = c.result ?? "";
    parts.push(`IT CALLED ${c.name} ${JSON.stringify(c.input)}\n${c.isError ? "The call failed: " : ""}${result.length > RESULT_MAX ? `${result.slice(0, RESULT_MAX)}\n… (${result.length - RESULT_MAX} more characters)` : result}`);
  }
  if (t.stop === "max_tokens") parts.push("(cut off at the model's output limit)");
  return { kind: "reply", text: clean(parts.join("\n\n") || "(nothing in this turn)") };
}
