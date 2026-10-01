// Deterministic spec lint (spec-stage §4). L7 (open questions) and L5 details are partial in the POC.
import type { ChangeClass, SpecDraft } from "../contracts/index.js";

export interface LintResult { check: string; passed: boolean; details: string; blocking: boolean }

const EARS = [
  /^The .+ shall .+/i,                                   // ubiquitous
  /^When .+, the .+ shall .+/i,                          // event
  /^While .+, the .+ shall .+/i,                         // state
  /^If .+, then the .+ shall .+/i,                       // unwanted
  /^Where .+, the .+ shall .+/i,                         // optional feature
  /^(While|When) .+, (when|while) .+, the .+ shall .+/i, // complex
];
const VAGUE = /\b(fast|quick(ly)?|user[- ]friendly|easy|easily|robust|efficient(ly)?|appropriate(ly)?|adequate|reasonable|as needed|etc\.?|some|several|many|few|flexible|seamless(ly)?|intuitive|optimal|minimi[sz]e|maximi[sz]e)\b/i;
const NUMBER = /\d/;
const OBSERVABLE = /\b(respon[sd]|status|return|row|record|table|database|db|call|request|sent|email|message|screen|page|display|shown|show|visible|error|log|event|header|body|json|field|value|count|list|file)\w*/i;
const LITERAL_ID = /\b([A-Z]{2,}-\d+|\d{4,}|[A-Z][a-z]+ (Inc|LLC|Ltd|GmbH|Corp))\b/;

/** `id` as a whole token in `text`: "I-1" isn't in "I-12" (never substring matching). */
export const mentions = (text: string, id: string): boolean =>
  new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text);

/** The request's own span says a piece of work isn't wanted ("out of scope", "no need for"). Behaviour words
 * like "don't" or "won't" are left out: "users don't get duplicates" is a requirement, not an exclusion. */
const EXCLUDES = /\b(out of scope|not in scope|not needed|no need (for|to)|exclud\w*|not required)\b/i;
export const requestExcluded = (spans: { id: string; text: string }[]): string[] => spans.filter((s) => EXCLUDES.test(s.text)).map((s) => s.id);

/**
 * Only people put scope out of scope: a span counts as out of scope when an out-of-scope entry names it
 * (exact token) and that same entry cites an answer or accepted assumption id the run has (Q-n / ASM-n),
 * or the request itself excludes it. A drafter's own deferral ("run 2") doesn't count.
 */
export function outOfScopeSpans(outOfScope: string[], spans: string[], decisions: string[], excluded: string[] = []): Set<string> {
  return new Set(spans.filter((s) => outOfScope.some((o) => mentions(o, s) && (excluded.includes(s) || decisions.some((d) => mentions(o, d))))));
}

export const sizeBudget = (cls: ChangeClass) => ({ reqs: cls === "bugfix" ? 4 : 12, acs: 30 });
/** A spec over the size budget, as one line for the approval card (undefined when within it). */
export function sizeNote(spec: SpecDraft, cls: ChangeClass): string | undefined {
  const b = sizeBudget(cls), n = spec.requirements.length, acs = spec.requirements.reduce((k, r) => k + r.acceptance.length, 0);
  if (n <= b.reqs && acs <= b.acs) return undefined;
  const runs = Math.max(Math.ceil(n / b.reqs), Math.ceil(acs / b.acs));
  return `This spec has ${n} requirements, about ${runs} runs' worth of work for a ${cls}; approve it as one run or reject with which part to cut.`;
}

export function lintSpec(spec: SpecDraft, ctx: {
  spans: string[]; changeClass: ChangeClass; anchorOk: (reqId: string) => boolean;
  /** answer and assumption ids the human decided (Q-n, ASM-n) */ decisions?: string[];
  /** spans the request itself excludes */ excluded?: string[];
  /** estimate mode prices the whole request: no size check */ estimate?: boolean;
}): LintResult[] {
  const out: LintResult[] = [];
  const add = (check: string, fails: string[], blocking = true) =>
    out.push({ check, passed: fails.length === 0, details: fails.length ? fails.slice(0, 8).join("; ") : "ok", blocking });

  // L1 ids unique and well-formed
  const ids = [...spec.requirements.map((r) => r.id), ...spec.requirements.flatMap((r) => r.acceptance.map((a) => a.id)), ...spec.nfrs.map((n) => n.id)];
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  const badReq = spec.requirements.filter((r) => !/^REQ-\d+$/.test(r.id)).map((r) => `bad id ${r.id}`);
  const badAc = spec.requirements.flatMap((r) => r.acceptance.filter((a) => !new RegExp(`^AC-${r.id.slice(4)}\\.\\d+$`).test(a.id)).map((a) => `${a.id} should be AC-${r.id.slice(4)}.n`));
  add("L1 ids", [...dup.map((d) => `duplicate ${d}`), ...badReq, ...badAc]);

  // L2 REQ ↔ AC
  add("L2 req-ac", spec.requirements.flatMap((r) => [
    ...(r.op !== "REMOVED" && !r.acceptance.length ? [`${r.id} has no acceptance criterion`] : []),
    ...r.acceptance.filter((a) => !a.given.trim() || !a.when.trim() || !a.then.trim()).map((a) => `${a.id} is missing Given/When/Then`),
  ]));

  // L3 EARS
  add("L3 ears", spec.requirements.flatMap((r) => {
    const f: string[] = [];
    if (!EARS.some((re) => re.test(r.ears.trim()))) f.push(`${r.id} isn't in an EARS pattern`);
    if ((r.ears.match(/\bshall\b/gi) ?? []).length !== 1) f.push(`${r.id} needs exactly one "shall"`);
    if (/\band\/or\b/i.test(r.ears)) f.push(`${r.id} uses "and/or"`);
    return f;
  }));

  // L4 vague words without a number
  add("L4 vague", [...spec.requirements.map((r) => ({ id: r.id, t: r.ears })), ...spec.nfrs.map((n) => ({ id: n.id, t: n.text }))]
    .filter((x) => VAGUE.test(x.t) && !NUMBER.test(x.t)).map((x) => `${x.id} uses a vague word ("${x.t.match(VAGUE)![0]}") with no number`));

  // L5 NFR metric
  add("L5 nfr", spec.nfrs.filter((n) => !n.metric.trim() || !NUMBER.test(n.metric)).map((n) => `${n.id} has no measurable metric`));

  // L6 out of scope present
  add("L6 scope", spec.outOfScope.length ? [] : ["out-of-scope list is empty; say explicitly what isn't changing"], false);

  // L8 anchors
  add("L8 anchors", spec.requirements.filter((r) => r.op !== "ADDED").flatMap((r) =>
    !r.anchors?.length ? [`${r.id} is ${r.op} but has no anchor to existing code`] : !ctx.anchorOk(r.id) ? [`${r.id} has an anchor that doesn't match the code`] : [],
  ));

  // L9 size: never blocking (shrinking a spec drops requested behaviour); the card asks the human instead
  if (!ctx.estimate) { const n = sizeNote(spec, ctx.changeClass); add("L9 size", n ? [n] : [], false); }

  // L10 traceability: a span is covered by a requirement, or out of scope by a human decision
  const covered = new Set(spec.requirements.flatMap((r) => r.sources));
  const oos = outOfScopeSpans(spec.outOfScope, ctx.spans, ctx.decisions ?? [], ctx.excluded);
  add("L10 trace", [
    ...ctx.spans.filter((s) => !covered.has(s) && !oos.has(s)).map((s) => spec.outOfScope.some((o) => mentions(o, s))
      ? `intent span ${s} was moved out of scope without a decision from you; cover it or ask`
      : `intent span ${s} isn't covered by any requirement or listed as out of scope`),
    ...spec.requirements.filter((r) => !r.sources.length).map((r) => `${r.id} has no source span`),
  ]);

  // L11 observable surface
  add("L11 observable", spec.requirements.flatMap((r) => r.acceptance.filter((a) => a.level !== "manual" && !OBSERVABLE.test(a.then)).map((a) => `${a.id}'s Then doesn't name something observable (response, row, call, screen)`)));

  // L12 literal ids (advisory)
  add("L12 literals", spec.requirements.filter((r) => LITERAL_ID.test(r.ears)).map((r) => `${r.id} hardcodes "${r.ears.match(LITERAL_ID)![0]}"; should it be configuration?`), false);

  return out;
}
