// A scripted model for dry runs: it proves the eval's plumbing (runs start, cards get answered, specs get
// scored) at no cost. Its specs echo the request, so its scores say nothing about quality.
import type { Conversation, Provider, Turn } from "../../src/runners/api.js";
import type { EvalCase } from "./case.js";

// no tokens: a dry run reports $0, so a cost on the report always means real spend
const USAGE = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };

/** The request cut into spans, a sentence each (at most 6), stripped of words the spec lint calls vague. */
export function fakeSpans(request: string): { id: string; text: string }[] {
  return request.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter((s) => s.length > 3).slice(0, 6)
    .map((text, i) => ({ id: `I-${i + 1}`, text: text.replace(/\b(fast|quick(ly)?|easy|easily|some|several|many|few|etc)\b/gi, "").replace(/\s+/g, " ").trim() }));
}

function fakeSpec(spans: { id: string; text: string }[]) {
  return {
    requirements: spans.map((s, i) => ({
      id: `REQ-${i + 1}`, ears: `The system shall meet intent span ${s.id}.`, op: "ADDED", sources: [s.id], anchors: [],
      acceptance: [{ id: `AC-${i + 1}.1`, given: "the current data", when: "the request is made", then: `the response shows: ${s.text}`, level: "api" }],
    })),
    nfrs: [], outOfScope: ["Nothing else changes."], assumptions: [], suggestions: [],
  };
}

export function fakeAnswer(c: EvalCase, system: string): unknown {
  const spans = fakeSpans(c.request);
  if (system.includes("intake step")) return { source: "cli", spans, changeClass: c.kind, risk: "medium", riskTags: [], rigor: "full", touchesUi: false };
  if (system.includes("grounding step")) return { claims: [], notFound: spans.map((s) => ({ span: s.id, searched: ["fake"] })) };
  if (system.includes("independently reading a change request")) return { spans: spans.map((s) => ({ id: s.id, behaviours: [{ text: s.text, kind: "happy" }] })) };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Requirements analyst")) {
    // round 1 asks one question per fact, worded from its matcher, so the oracle and gap scoring get exercised
    if (system.includes("already answered")) return { questions: [], conflicts: [] };
    return {
      questions: c.facts.slice(0, 5).map((f, i) => ({
        id: `q${i + 1}`, category: "scope", text: `What should happen about ${f.about.map((g) => g[0]).join(" and ")}?`,
        options: ["Option one", "Option two"], recommended: "Option one", reason: "fake", spans: [spans[0]!.id], impact: 3, impactReason: "fake",
      })),
      conflicts: [],
    };
  }
  if (system.includes("Merge three independent")) {
    const spec = fakeSpec(spans);
    const { suggestions: _s, ...merged } = spec;
    void _s;
    return { spec: merged, alignment: spec.requirements.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`, `d2:${r.id}`, `d3:${r.id}`] })), conflicts: [] };
  }
  if (system.includes("Senior engineer writing a behaviour spec")) return fakeSpec(spans);
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("State, as numbered")) return { sentences: spans.map((s, i) => ({ n: i + 1, text: s.text })) };
  if (system.includes("Map each restated")) return { mapping: spans.map((s, i) => ({ n: i + 1, spans: [s.id], answers: [] })) };
  throw new Error(`fake model: no script for "${system.slice(0, 80)}"`);
}

/** A provider that answers every structured call for case `c`, with fixed token counts. */
export function fakeProvider(c: () => EvalCase): Provider {
  return {
    start(_model, _e, system): Conversation {
      return {
        async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: fakeAnswer(c(), system) }], text: "", stop: "tool_use", usage: USAGE }; },
        toolResults() {}, say() {},
      };
    },
  };
}
