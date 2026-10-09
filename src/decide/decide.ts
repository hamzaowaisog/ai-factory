// Decision layer: one port, swappable adapters. A decision is a pick from a fixed list of options with a confidence.
// Nothing in a run calls this yet: bench/decide/run.ts replays stored intakes through it to compare the adapters.
import { z } from "zod";
import { secret } from "../config/env.js";
import type { Intent } from "../contracts/index.js";
import { FencedOutError } from "../ledger/ledger.js";
import { costUsd } from "../runners/pricing.js";
import type { StepContext } from "../stages/framework.js";
import { S, think, UNTRUSTED_NOTE } from "../stages/think.js";

export interface DecisionQuestion { id: string; question: string; options: readonly string[] }
/** pick is always one of the question's options (the port drops any other) */
export interface DecisionAnswer { id: string; pick: string; confidence: number }
/** What a decision is made from. Only `spans` holds the request's own words. */
export interface DecisionState {
  signals: Signals;
  intent: Pick<Intent, "changeClass" | "risk" | "touchesUi">;
  spans: string[];
}
export interface DecisionAdapter {
  readonly name: string;
  decide(ctx: StepContext, state: DecisionState, qs: readonly DecisionQuestion[], model?: string): Promise<DecisionAnswer[]>;
}
export interface DecisionRecord { adapter: string; model?: string; answers: DecisionAnswer[]; dropped: string[]; ms: number; costUsd: number; error?: string }

export const QUESTIONS: readonly DecisionQuestion[] = [
  { id: "maturity", question: "How complete is this request as a specification?", options: ["casual idea", "partial spec", "full spec"] },
  { id: "genre", question: "What kind of product is it?", options: ["common product type", "niche or domain-heavy"] },
];

export interface Signals { words: number; acLines: number; screens: number; roles: number; numbers: number }
/** What code can measure in a request, with no model. ponytail: word lists; tune them on the labelled cases if the signals mislead. */
export function signals(request: string): Signals {
  const count = (re: RegExp) => request.match(re)?.length ?? 0;
  return {
    words: request.split(/\s+/).filter(Boolean).length,
    acLines: request.split("\n").filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+.*\b(must|should|shall|cannot)\b|^\s*(given|when|then)\b|\bAC[- ]?\d+/i.test(l)).length,
    screens: count(/\b(screen|page|view|dashboard|form|modal|tab)s?\b/gi),
    roles: new Set((request.match(/\b(admin|administrator|manager|customer|staff|owner|member|guest|operator|agent|supervisor|instructor)s?\b/gi) ?? []).map((r) => r.toLowerCase().replace(/s$/, ""))).size,
    numbers: count(/\b\d[\d,.]*\b/g),
  };
}

/** A structured-output call to OpenAI or Anthropic: the vendor is the model id, nothing else. */
const llm: DecisionAdapter = {
  name: "llm",
  async decide(ctx, state, qs, model) {
    if (!model) throw new Error("the llm adapter needs a model (llm:<model id>)");
    const schema = z.object(Object.fromEntries(qs.map((q) => [q.id, z.object({ pick: z.enum(q.options as [string, ...string[]]), confidence: z.number() })])));
    // a decision is never a retry of the step it sits in: no failure text, no raised effort, no stronger model
    const r = await think({ ...ctx, rung: 0, priorFailures: [], gateAnswers: undefined }, {
      stage: "intake", label: "decide", route: "intake", model, effort: "low", cls: "read-small", budgetTokens: 4000, tools: [], schema,
      maxTurns: 2, maxUsd: 0.05, timeoutSec: 30,
      sections: [
        S.template("tpl", `You classify a software request. For each question pick exactly one option and give your confidence from 0 to 1.\n${UNTRUSTED_NOTE}\n${qs.map((q) => `- ${q.id}: ${q.question} Options: ${q.options.join(" | ")}`).join("\n")}`),
        S.reference("measured", JSON.stringify({ signals: state.signals, intent: state.intent })),
        S.untrusted("spans", "cli", state.spans.join("\n")),
        S.task("Answer every question."),
      ],
    });
    if (!r.ok) throw new Error(r.outcome.kind === "fail" ? (r.outcome.failures[0]?.message ?? r.outcome.signature) : "reason" in r.outcome ? String(r.outcome.reason) : r.outcome.kind);
    return qs.map((q) => ({ id: q.id, ...r.output[q.id]! }));
  },
};

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
/** TypeSafe's Jev. It is hosted outside the factory's vendors, so it gets the measured signals and intake's labels, never the spans. */
const jev: DecisionAdapter = {
  name: "jev",
  async decide(ctx, state, qs, model = "jev-1.13.0") {
    const key = secret("TYPESAFE_API_KEY");
    if (!key) throw new Error("TYPESAFE_API_KEY is missing from ~/.factory/.env");
    const res = await fetch(JEV_URL, {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, state: { signals: state.signals, intent: state.intent },
        questions: Object.fromEntries(qs.map((q) => [q.id, { type: "choice", instructions: q.question, criteria: Object.fromEntries(q.options.map((o) => [o, o])) }])),
      }),
    });
    if (!res.ok) throw new Error(`Jev answered HTTP ${res.status}`);
    const body = await res.json() as { answers?: Record<string, { choice?: string; confidence?: number }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const u = { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 };
    await ctx.usage({ ...u, model: `typesafe/${model}`, turns: 1, wallMs: 0, estUsd: costUsd(`typesafe/${model}`, u) });
    return qs.map((q) => ({ id: q.id, pick: String(body.answers?.[q.id]?.choice), confidence: Number(body.answers?.[q.id]?.confidence) }));
  },
};

const off: DecisionAdapter = { name: "off", decide: async () => [] };

/** No model: a fixed answer from the signals, for tests and a dry run. */
const fake: DecisionAdapter = {
  name: "fake",
  decide: async (_ctx, state, qs) => qs.map((q) => ({
    id: q.id, confidence: 0.5,
    pick: q.id === "maturity" ? q.options[state.signals.acLines >= 3 ? 2 : state.signals.words < 60 ? 0 : 1]! : q.options[0]!,
  })),
};

export const ADAPTERS: Record<string, DecisionAdapter> = { llm, jev, off, fake };

/** "llm:claude-haiku-5-5" or "jev": an adapter and, where it takes one, its model. */
export function parsePair(pair: string): { adapter: string; model?: string } {
  const at = pair.indexOf(":");
  const adapter = at < 0 ? pair : pair.slice(0, at);
  if (!ADAPTERS[adapter]) throw new Error(`No decision adapter "${adapter}" (known: ${Object.keys(ADAPTERS).join(", ")})`);
  return { adapter, ...(at < 0 ? {} : { model: pair.slice(at + 1) }) };
}

/**
 * Ask one adapter. A decision never fails its caller: an error is returned on the record, and an answer that is not one of
 * its question's options, or whose confidence is outside 0-1, is dropped and named. Only a lost lease is thrown, because the
 * run is no longer this executor's. `off` asks nothing and returns undefined.
 */
export async function decide(ctx: StepContext, pair: string, state: DecisionState, qs: readonly DecisionQuestion[] = QUESTIONS): Promise<DecisionRecord | undefined> {
  const started = Date.now();
  let spent = 0;
  let who: { adapter: string; model?: string } = { adapter: pair };
  try {
    who = parsePair(pair);
    if (who.adapter === "off") return undefined;
    const raw = await ADAPTERS[who.adapter]!.decide({ ...ctx, usage: async (u) => { spent += u.estUsd; await ctx.usage(u); } }, state, qs, who.model);
    const ok = (a: DecisionAnswer) => !!qs.find((q) => q.id === a.id)?.options.includes(a.pick) && a.confidence >= 0 && a.confidence <= 1;
    return { ...who, answers: raw.filter(ok), dropped: raw.filter((a) => !ok(a)).map((a) => a.id), ms: Date.now() - started, costUsd: spent };
  } catch (e) {
    if (e instanceof FencedOutError) throw e;
    return { ...who, answers: [], dropped: [], ms: Date.now() - started, costUsd: spent, error: (e as Error).message.slice(0, 300) };
  }
}
