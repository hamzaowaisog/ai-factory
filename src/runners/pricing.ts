// USD per million tokens. Estimates only; the cost caps use these. A project's `prices:` overrides any of them.
// Claude: list prices read from claude.com/pricing on 2026-10-10.
// GPT-6: OpenAI's own price page could not be read on 2026-10-10; these are the figures other sites quote
// for it and are not confirmed. Set `prices:` in the project if the bill says otherwise.
interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
/** A model whose price changes with the size of the prompt: `over` applies to a call whose prompt is above `above` tokens. */
interface Banded extends Price { above?: number; over?: Price }

const TABLE: Record<string, Banded> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, above: 100_000, over: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, above: 272_000, over: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 2.5 } },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, above: 272_000, over: { input: 0.2, output: 0.75, cacheRead: 0.01, cacheWrite: 0.125 } },
  // no longer routed to; kept so the runs that used them still cost what they did
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Models whose price here is not from the vendor's own page. */
export const UNCONFIRMED_PRICES: readonly string[] = ["gpt-6-sol", "gpt-6-luna"];

/** Unknown models are priced like the most expensive known one, so caps stay safe. */
const FALLBACK: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

const overrides = new Map<string, Price>();
export function setPrice(model: string, p: Price): void {
  overrides.set(model, p);
}

/** The price of one call. `promptTokens` (everything sent, cached or not) picks the band of a model that has two. */
export function priceOf(model: string, promptTokens = 0): Price {
  const o = overrides.get(model);
  if (o) return o;
  const t = TABLE[model];
  if (t) return t.over && t.above !== undefined && promptTokens > t.above ? t.over : t;
  return model.startsWith("ollama/") ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : FALLBACK;
}

/** False when a model would be costed at the fallback rate (no list price, no price in the project). */
export function hasPrice(model: string): boolean {
  return overrides.has(model) || model in TABLE || model.startsWith("ollama/");
}

/** `turns` is given when the usage is several calls added up (an agent session): the band is read from the average prompt. */
export function costUsd(model: string, u: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; turns?: number }): number {
  const p = priceOf(model, (u.inputTokens + u.cacheRead + u.cacheWrite) / Math.max(1, u.turns ?? 1));
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}
