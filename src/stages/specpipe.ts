// specify ×3 → merge (+ source check, stability) → lint → critic → round trip, with up to 3
// repairs by one drafter (spec-stage §1, §3.3–3.6, §4). Findings still open after 3 repairs
// go on the approval card.
import { z } from "zod";
import { CriticFinding, CurrentBehaviourBody, IntentBody, SpecDraft } from "../contracts/index.js";
import { checkEvidence } from "../context/tools.js";
import { failure } from "../gates/engine.js";
import { planRejections, requireOutput, readOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { clarifications, type ClarifyResult } from "./clarify.js";
import { lintSpec, OBSERVABLE_RULE, outOfScopeSpans, requestExcluded, sizeNote, type LintResult } from "./speclint.js";
import { S, think, UNTRUSTED_NOTE, type ThinkSpec } from "./think.js";
import { snapshotFor, toolsFor } from "./workspace.js";
import { LANE, lightSpec, specLane } from "./lane.js";
import { settles, specRefused, unsettled, type Found } from "../estimate/settled.js";
import { settle, settleKey, type Answer, type Decided } from "./settle.js";
import { hashJson } from "../util/hash.js";
import { repoIsEmpty } from "../config/greenfield.js";
import { testsScreens } from "./stack-text.js";
import { lightLaneModel } from "./routing.js";

type Intent = z.infer<typeof IntentBody>;
type CB = z.infer<typeof CurrentBehaviourBody>;
type Spec = z.infer<typeof SpecDraft>;

export const DraftOut = SpecDraft.extend({ suggestions: z.array(z.string()) });
export const MergeOut = z.object({
  spec: SpecDraft,
  alignment: z.array(z.object({ mergedReq: z.string(), from: z.array(z.string()).min(1) })),
  conflicts: z.array(z.string()),
});
/** A repair answers with what changes, not the whole spec: anything it doesn't return stays as it is. */
export const RepairOut = z.object({
  /** each requirement changed or added, whole (with all its acceptance criteria) */
  requirements: SpecDraft.shape.requirements,
  /** each NFR changed or added, whole */
  nfrs: SpecDraft.shape.nfrs.optional(),
  /** ids of requirements and NFRs to delete */
  removed: z.array(z.string()).optional(),
  /** the whole list, only when it changes */
  outOfScope: SpecDraft.shape.outOfScope.optional(),
  /** the whole list, only when it changes */
  assumptions: SpecDraft.shape.assumptions.optional(),
});
export const CriticOut = z.object({ findings: z.array(CriticFinding.extend({ rubric: z.number().int().min(1).max(8) })) });
export const RestateOut = z.object({ sentences: z.array(z.object({ n: z.number().int(), text: z.string() })) });
export const RtAlignOut = z.object({ mapping: z.array(z.object({ n: z.number().int(), spans: z.array(z.string()), answers: z.array(z.string()) })) });

export const MAX_REPAIRS = LANE.full.maxRepairs;

/**
 * Where the test lab can't test screens (a .NET service), a ui criterion can't get a locked test: it becomes a
 * manual check by a person (no model call), and the approval card says so. A web app keeps its ui criteria: the
 * test writer gives each a screen test (src/design/kit/screen-tests.ts), so `screens` leaves the spec as it is.
 */
export function downgradeUi<T extends Spec>(spec: T, screens = false): { spec: T; downgraded: string[] } {
  if (screens) return { spec, downgraded: [] };
  const downgraded: string[] = [];
  const requirements = spec.requirements.map((r) => ({
    ...r,
    acceptance: r.acceptance.map((a) => {
      if (a.level !== "ui") return a;
      downgraded.push(a.id);
      return { ...a, level: "manual" as const };
    }),
  }));
  return { spec: { ...spec, requirements }, downgraded };
}

// ---------- pure checks ----------

/** Every `from` must name a draft (d1..d3) and a REQ in it; stability = distinct drafts / 3. */
export function checkMerge(m: z.infer<typeof MergeOut>, drafts: Spec[]): { errors: string[]; stability: Record<string, number> } {
  const errors: string[] = [];
  const stability: Record<string, number> = {};
  for (const req of m.spec.requirements) {
    const a = m.alignment.find((x) => x.mergedReq === req.id);
    if (!a) { errors.push(`${req.id} has no source draft`); continue; }
    const ok = a.from.filter((f) => {
      const mm = /^d([123]):(REQ-\d+)$/.exec(f);
      return !!mm && !!drafts[Number(mm[1]) - 1]?.requirements.some((r) => r.id === mm[2]);
    });
    if (ok.length !== a.from.length) errors.push(`${req.id} cites a draft requirement that doesn't exist: ${a.from.filter((f) => !ok.includes(f)).join(", ")}`);
    stability[req.id] = new Set(ok.map((f) => f.slice(0, 2))).size / 3;
  }
  return { errors, stability };
}

/**
 * A dropped span fails unless a human put it out of scope (an answer/assumption cited next to it, or
 * the request itself); a sentence matching no span and no answer is an invention.
 */
export function roundTripCheck(
  spans: string[], answers: string[], spec: Spec,
  restated: z.infer<typeof RestateOut>["sentences"], mapping: z.infer<typeof RtAlignOut>["mapping"], excluded: string[] = [],
): { droppedSpans: string[]; inventedCapabilities: string[] } {
  const covered = new Set(mapping.flatMap((m) => m.spans));
  const oos = outOfScopeSpans(spec.outOfScope, spans, answers, excluded);
  const droppedSpans = spans.filter((s) => !covered.has(s) && !oos.has(s));
  const known = new Set([...spans, ...answers]);
  const inventedCapabilities = restated
    .filter((r) => { const m = mapping.find((x) => x.n === r.n); return !m || ![...m.spans, ...m.answers].some((x) => known.has(x)); })
    .map((r) => r.text);
  return { droppedSpans, inventedCapabilities };
}

/** Critic blocking is derived by code from severity (gate-engine §2.5). */
export const criticBlocks = (f: { severity: string }) => f.severity === "critical" || f.severity === "high";

/** Problem lists compared loosely (case, spacing, trailing punctuation): a repair that changed nothing. */
const norm = (p: string) => p.toLowerCase().replace(/\s+/g, " ").replace(/[.;:\s]+$/, "").trim();
export function sameProblems(a: string[], b: string[]): boolean {
  const x = new Set(a.map(norm)), y = new Set(b.map(norm));
  return x.size === y.size && [...x].every((p) => y.has(p));
}

/** Spans a requirement covered before a repair and none covers after it (exact ids). */
export function lostCoverage(before: Spec, after: Spec, spans: string[]): string[] {
  const had = new Set(before.requirements.flatMap((r) => r.sources)), has = new Set(after.requirements.flatMap((r) => r.sources));
  return spans.filter((s) => had.has(s) && !has.has(s));
}

/** A repair applied to the spec it repaired: changed items replace theirs in place, new ones go last, removed ones go. */
export function applyRepair(spec: Spec, p: z.infer<typeof RepairOut>): Spec {
  const gone = new Set(p.removed ?? []);
  const patch = <T extends { id: string }>(old: T[], changed: T[]): T[] => {
    const by = new Map(changed.map((x) => [x.id, x]));
    const kept = old.filter((x) => !gone.has(x.id) || by.has(x.id)).map((x) => by.get(x.id) ?? x);
    const had = new Set(old.map((x) => x.id));
    return [...kept, ...changed.filter((x) => !had.has(x.id))];
  };
  return {
    requirements: patch(spec.requirements, p.requirements),
    nfrs: patch(spec.nfrs, p.nfrs ?? []),
    outOfScope: p.outOfScope ?? spec.outOfScope,
    assumptions: p.assumptions ?? spec.assumptions,
  };
}

/** Critic instructions; a run with no repo is new work, so existing-code rubric items (5, 6) don't apply. */
export function criticTemplate(repo: boolean): string {
  const rubric = ["1 conflicts between requirements", "2 missing error, empty and permission paths", "3 ACs not observable at a public surface", "4 scope creep beyond the intent",
    ...(repo ? ["5 claims about existing behaviour without anchors", "6 state transitions and existing data"] : []),
    "7 behaviour changes outside the requested scope (blast radius)", "8 hardcoded identifiers that should be configuration"];
  return `Adversarial reviewer. Find defects in this spec; don't praise; don't rewrite it.
Rubric: ${rubric.join(" ")}.
Each finding: rubric number, reqId, severity (critical|high|medium|low), one-sentence evidence in "finding". Empty list if none.
The human answered questions and accepted assumptions (below). Scope they decided is not a defect: don't flag it.${repo ? "" : "\nThere is no existing codebase: this is new work. Don't flag missing anchors, unknown existing data or missing repository."}`;
}

// ---------- helpers ----------
const request = (ctx: Pick<StepContext, "state">) => ctx.state.info.request ?? "";
const hasRepo = (ctx: Pick<StepContext, "state">) => !!ctx.state.info.repoPath && !!ctx.state.info.baseCommit;
/** A new product's repo before anything is built into it: only starter files at the base commit. */
const nothingToRead = (ctx: Pick<StepContext, "state">): boolean => {
  try { return repoIsEmpty(ctx.state.info.repoPath!, ctx.state.info.baseCommit!); } catch { return false; }
};
/**
 * Drafters read the repo; with no repo, or an empty one, there is nothing to read, so no tools. Tools also make the briefing
 * a cached conversation, written at 1.25x for a later turn to read back: on the web run of 2026-10-06 (an empty repo) seven
 * draft calls wrote 200K tokens that way and answered in one turn.
 */
const readTools = (ctx: StepContext): Pick<ThinkSpec<unknown>, "tools" | "repoTools"> =>
  (hasRepo(ctx) && !nothingToRead(ctx) ? { tools: ["read_file", "search"], repoTools: toolsFor(ctx) } : { tools: [] });
const decisionsOf = (i: { answers: { id: string }[]; assumptions: { id: string }[] }) => [...i.answers.map((a) => a.id), ...i.assumptions.map((a) => a.id)];

/** The first question number after the clarify rounds' (Q-n), for the questions that settle the spec's problems. */
export const nextQuestion = (answers: { id: string }[]) => 1 + Math.max(0, ...answers.map((a) => Number(/^Q-(\d+)$/.exec(a.id)?.[1] ?? 0)));
/** A stored spec without its checks (the shape a repair works on). */
const specOf = (s: Spec): Spec => ({ requirements: s.requirements, nfrs: s.nfrs, outOfScope: s.outOfScope, assumptions: s.assumptions });

function inputsOf(ctx: StepContext) {
  const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
  const cb = requireOutput<CB>(ctx.state, ctx.ledger, "ground");
  const c = clarifications(readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify"), readOutput<ClarifyResult>(ctx.state, ctx.ledger, "clarify-2"));
  return { intent, cb, ...c };
}

const draftRules = (screens: boolean): string => `Senior engineer writing a behaviour spec a test author can turn into black-box tests.
Format rules (checked by code):
- Each requirement is one EARS sentence with exactly one "shall": "The <system> shall ...", "When <trigger>, the <system> shall ...", "While <state>, the <system> shall ...", "Where <feature>, the <system> shall ...", "If <condition>, then the <system> shall ...". IDs REQ-1, REQ-2...
- op = ADDED | MODIFIED | REMOVED. MODIFIED and REMOVED copy their anchors exactly from the current-behaviour claims.
- Each requirement has ≥1 acceptance criterion AC-<req>.<n> in Given/When/Then, observable at a public surface: a public class method called directly, an HTTP call, a job run, an outbound call to a named system, a DB row, or a screen. level: unit | api | job | ui | manual.
- ${OBSERVABLE_RULE} (manual criteria are exempt.)
- Pick the LOWEST level that proves the behaviour: unit when the logic lives in one class (call its public method directly), api for an endpoint, job only when the behaviour exists only in a job run. ${screens
    ? "ui for behaviour that exists only on a screen (what is shown for which data, what a click or a typed value does, which message appears): the factory renders the screen in a test and checks it. manual only for what no test can judge, such as how a page looks (colour, spacing, a width) or a check on a real device: a person must sign each one off before delivery, so keep them few."
    : "The factory can't test screens here: a ui criterion becomes a manual check by a person, so use it only for behaviour that exists only on a screen."}
- Change only what the request asks. Other places that might need the same change go in suggestions, not requirements.
- sources: intent span IDs, answer IDs (Q-n) or assumption IDs (ASM-n).
- NFRs need a metric with a number. List out-of-scope items. Every intent span is covered by a requirement.
- Never move requested behaviour out of scope on your own, and never shrink a spec by deferring requested behaviour to a later run. An out-of-scope entry that names an intent span must cite the answer or assumption id that excluded it, e.g. "I-3 SMS reminders (Q-2)"; without one, cover the span.
- No vague words (fast, robust, user-friendly, appropriate) without a number.
- Don't add capabilities the request didn't ask for; put ideas under suggestions.
- A bugfix has at most 4 requirements.
${UNTRUSTED_NOTE}`;

function draftSections(ctx: StepContext, i: ReturnType<typeof inputsOf>) {
  return [
    S.template("tpl", draftRules(testsScreens(ctx.project.stack))),
    S.artifact("intent", "intent", i.intent),
    S.artifact("answers", "answers", i.answers),
    S.artifact("assumptions", "assumptions", i.assumptions),
    S.artifact("cb", "current-behaviour", i.cb),
    S.untrusted("request", "cli", request(ctx)),
  ];
}

// ---------- steps ----------

/** Three independent drafts: 2 × Opus + 1 × other family (Sonnet for a low-risk bugfix). The light and requirements lanes write one. */
export const draftsStep: StepDef = {
  key: "drafts", stage: "specify", templateVersion: "5",
  inputs: (s) => (s.steps.get("clarify-2")?.status === "completed"
    ? { intent: s.steps.get("intake")!.outputs[0], cb: s.steps.get("ground")!.outputs[0], c1: s.steps.get("clarify")!.outputs[0], c2: s.steps.get("clarify-2")!.outputs[0] } : undefined),
  async run(ctx) {
    const i = inputsOf(ctx);
    const lowBugfix = i.intent.changeClass === "bugfix" && i.intent.risk === "low";
    const light = lightSpec(i.intent);
    const routes = (lowBugfix || light ? ["specify", "specify", "specify"] : ["specify", "specify", "specify-other"]).slice(0, specLane(i.intent, ctx.state.info.mode).drafts);
    const models = lowBugfix || light ? routes.map(() => lightLaneModel(ctx.project, "specify", ctx.rung)) : [undefined, undefined, undefined];
    const rs = await Promise.all(routes.map((route, n) => think(ctx, {
      stage: "specify", route, model: models[n], cls: "read-large", budgetTokens: 30000, ...readTools(ctx), schema: DraftOut, maxTurns: 8,
      sections: [...draftSections(ctx, i), S.task(routes.length === 1 ? "Write the spec." : `Write the spec (independent draft ${n + 1}).`)],
    })));
    const bad = rs.find((r) => !r.ok);
    if (bad && !bad.ok) return bad.outcome;
    const ok = rs as { ok: true; output: z.infer<typeof DraftOut>; model: string; note?: string }[];
    const sha = ctx.ledger.putJson({ drafts: ok.map((r) => r.output), models: ok.map((r) => r.model), notes: ok.map((r) => r.note).filter(Boolean) });
    return { kind: "done", outputs: { drafts: sha }, data: { models: ok.map((r) => r.model) } };
  },
};

export const mergeStep: StepDef = {
  key: "merge", stage: "merge", templateVersion: "3",
  inputs: (s) => (s.steps.get("drafts")?.status === "completed" ? { drafts: s.steps.get("drafts")!.outputs[0] } : undefined),
  async run(ctx) {
    const { drafts } = requireOutput<{ drafts: z.infer<typeof DraftOut>[] }>(ctx.state, ctx.ledger, "drafts");
    if (drafts.length === 1) {
      // the light lane's single draft: nothing to merge, no model call; stability isn't measured
      const { suggestions: _s, ...spec } = drafts[0]!;
      void _s;
      const alignment = spec.requirements.map((q) => ({ mergedReq: q.id, from: [`d1:${q.id}`] }));
      return { kind: "done", outputs: { merged: ctx.ledger.putJson({ spec, alignment, conflicts: [], singleDraft: true }) }, data: { singleDraft: true, unstable: [] } };
    }
    const r = await think(ctx, {
      stage: "merge", route: "merge", cls: "read-large", budgetTokens: 40000, tools: [], schema: MergeOut, maxTurns: 4,
      sections: [
        S.template("tpl", `Merge three independent spec drafts into one spec (same format rules as the drafts).
Every merged requirement lists in "alignment" which draft requirements it came from, as "d<draft>:<REQ-id>" (e.g. "d1:REQ-2"). Keep a requirement even if only one draft has it. Never write a requirement that is in no draft.
When drafts conflict, keep both readings as separate requirements and add a conflict entry. Renumber merged requirements REQ-1.. and their ACs AC-<req>.<n>.
${OBSERVABLE_RULE} Reword a draft's Then that doesn't, without changing what it checks.`),
        S.artifact("drafts", "spec-drafts", drafts.map((d, n) => ({ draft: `d${n + 1}`, ...d }))),
        S.task("Merge the drafts."),
      ],
    });
    if (!r.ok) return r.outcome;
    const { errors, stability } = checkMerge(r.output, drafts);
    if (errors.length) return { kind: "fail", category: "other", failures: errors.map((e) => failure("merge-sources", e)), signature: `merge:${errors.length}` };
    const spec = { ...r.output.spec, requirements: r.output.spec.requirements.map((q) => ({ ...q, stability: stability[q.id] })) };
    return { kind: "done", outputs: { merged: ctx.ledger.putJson({ spec, alignment: r.output.alignment, conflicts: r.output.conflicts }) }, data: { unstable: Object.entries(stability).filter(([, v]) => v < 2 / 3).map(([k]) => k) } };
  },
};

export interface Checks { lint: LintResult[]; critic: z.infer<typeof CriticOut>["findings"]; roundTrip: { droppedSpans: string[]; inventedCapabilities: string[] }; criticNote?: string }

async function checkSpec(ctx: StepContext, spec: Spec, i: ReturnType<typeof inputsOf>, criticEffort?: "low" | "medium" | "high"): Promise<{ ok: true; checks: Checks } | { ok: false; outcome: StepOutcome }> {
  const snap = snapshotFor(ctx);
  const excluded = requestExcluded(i.intent.spans);
  const lint = lintSpec(spec, {
    spans: i.intent.spans.map((s) => s.id), changeClass: i.intent.changeClass, decisions: decisionsOf(i), excluded, estimate: ctx.state.info.mode === "estimate",
    anchorOk: (id) => (spec.requirements.find((q) => q.id === id)?.anchors ?? []).every((a) => checkEvidence(snap, a).ok),
  });
  const [critic, restate] = await Promise.all([
    think(ctx, {
      stage: "critic", route: "critic", cls: "read-large", budgetTokens: 30000, tools: [], schema: CriticOut, effort: criticEffort,
      sections: [
        S.template("tpl", criticTemplate(hasRepo(ctx))),
        S.artifact("intent", "intent", i.intent),
        S.artifact("answers", "answers", i.answers),
        S.artifact("assumptions", "assumptions", i.assumptions),
        S.artifact("cb", "current-behaviour", i.cb),
        S.artifact("spec", "spec", spec),
        S.task("Review the spec."),
      ],
    }),
    think(ctx, {
      stage: "round-trip", route: "restater", cls: "read-small", budgetTokens: 15000, tools: [], schema: RestateOut, maxTurns: 3,
      sections: [
        S.template("tpl", "State, as numbered plain sentences (n = 1, 2, ...), what change this spec asks for. Don't add anything the spec doesn't say. Don't mention IDs."),
        S.artifact("spec", "spec", { requirements: spec.requirements.map((r) => ({ ears: r.ears, acceptance: r.acceptance.map((a) => `Given ${a.given} when ${a.when} then ${a.then}`) })), nfrs: spec.nfrs.map((n) => n.text) }),
        S.task("Restate the change."),
      ],
    }),
  ]);
  if (!critic.ok) return { ok: false, outcome: critic.outcome };
  if (!restate.ok) return { ok: false, outcome: restate.outcome };
  const align = await think(ctx, {
    stage: "round-trip", route: "rt-align", cls: "read-small", budgetTokens: 15000, tools: [], schema: RtAlignOut, maxTurns: 3,
    sections: [
      S.template("tpl", "Map each restated sentence to the original intent spans (I-n) and answers (Q-n) it comes from. A sentence that matches none gets empty lists. Every sentence n must appear once."),
      S.artifact("spans", "intent", i.intent.spans),
      S.artifact("answers", "answers", i.answers),
      S.artifact("sentences", "restated", restate.output.sentences),
      S.task("Map the sentences."),
    ],
  });
  if (!align.ok) return { ok: false, outcome: align.outcome };
  const roundTrip = roundTripCheck(i.intent.spans.map((s) => s.id), decisionsOf(i), spec, restate.output.sentences, align.output.mapping, excluded);
  return { ok: true, checks: { lint, critic: critic.output.findings, roundTrip, criticNote: critic.note } };
}

export function problems(c: Checks): string[] {
  return [
    // every failure, not the few a card shows: a repair can only fix what it is told about
    ...c.lint.filter((l) => l.blocking && !l.passed).map((l) => `[lint ${l.check}] ${l.fails.join("; ")}${l.hint ? `. ${l.hint}` : ""}`),
    ...c.critic.filter(criticBlocks).map((f) => `[critic ${f.severity}] ${f.reqId ?? ""} ${f.finding}`),
    ...c.roundTrip.droppedSpans.map((s) => `[round trip] span ${s} isn't covered by the spec`),
    ...c.roundTrip.inventedCapabilities.map((t) => `[round trip] not asked for: ${t}`),
  ];
}

/** Final spec: check, repair (one drafter, merged spec + findings) up to 3 times (once on the light and requirements lanes). */
export const specifyStep: StepDef = {
  key: "specify", stage: "specify", templateVersion: "7",
  // refused: gate E1 refused a spec written before problems were settled by questions, so this step runs again to settle them
  inputs: (s, l) => (s.steps.get("merge")?.status === "completed"
    ? { merged: s.steps.get("merge")!.outputs[0], rejections: planRejections(s), ...(settles(s.info) && specRefused(s, l) ? { refused: true } : {}) }
    : undefined),
  async run(ctx) {
    const i = inputsOf(ctx);
    const lane = specLane(i.intent, ctx.state.info.mode);
    const merged = requireOutput<{ spec: Spec; conflicts: string[]; singleDraft?: boolean }>(ctx.state, ctx.ledger, "merge");
    // stability is only measured across drafts: with one draft there's nothing to report
    const stable = (stab: Record<string, number | undefined>, id: string) => (merged.singleDraft ? undefined : stab[id] ?? 1 / 3);
    // after a rejection, start from the spec the human saw and repair it with their reason first
    const rejections = planRejections(ctx.state);
    let spec = rejections.length ? (readOutput<Spec>(ctx.state, ctx.ledger, "specify") ?? merged.spec) : merged.spec;
    // a failed attempt's repairs are paid for: the retry goes on from its spec, not from the merge again
    const mergedSha = ctx.state.steps.get("merge")!.outputs[0]!;
    const carried = ctx.state.steps.get("specify")?.failData as { repairedSpec?: string; repairedFrom?: string } | undefined;
    let repaired = false;
    if (!rejections.length && carried?.repairedSpec && carried.repairedFrom === mergedSha) {
      spec = ctx.ledger.getJson<Spec>(carried.repairedSpec);
      repaired = true;
      ctx.log("specify: going on from the last attempt's repaired spec");
    }
    let checks: Checks | undefined;
    let repairs = 0;
    const failed = (o: StepOutcome): StepOutcome =>
      (o.kind === "fail" && repaired ? { ...o, data: { ...(o.data ?? {}), repairedSpec: ctx.ledger.putJson(spec), repairedFrom: mergedSha } } : o);
    const manualUi = new Set<string>();
    const spanIds = i.intent.spans.map((s) => s.id);
    let rejectedRepair: string[] | undefined;
    // estimate and design runs, and a build that asks: what the repairs leave open is settled by questions (src/stages/settle.ts)
    const settling = settles(ctx.state.info);
    const key = settleKey(mergedSha, request(ctx));
    const resumed = settling && [...ctx.ledger.events()].some((e) => e.type === "human.requested" && (e.data as { settleKey?: string } | undefined)?.settleKey === key);
    // a spec gate E1 refused before problems were settled by questions: settle that spec's problems, not a new spec's
    const prior = readOutput<Spec & Found>(ctx.state, ctx.ledger, "specify");
    const refused = settling && !resumed && unsettled(prior) && specRefused(ctx.state, ctx.ledger) ? prior : undefined;
    if (resumed || refused) {
      if (refused) ctx.log("specify: gate E1 refused this spec; settling its open problems with questions");
    } else {
    if (rejections.length) {
      ctx.log(`specify: revising for your rejection: ${rejections[rejections.length - 1]}`);
      const r = await think(ctx, {
        stage: "specify", route: "specify", cls: "read-large", budgetTokens: 30000, ...readTools(ctx), schema: DraftOut, maxTurns: 8,
        sections: [
          ...draftSections(ctx, i),
          S.artifact("spec", "spec", spec),
          { spec: { id: "rejection", source: "feedback", trust: "trusted", placement: "user" }, content: `The human reviewer rejected the spec and plan built from this spec. Their reasons (latest last):\n${rejections.map((x) => `- ${x}`).join("\n")}` },
          S.task("Revise this spec so it addresses the reviewer's reasons. Keep requirement IDs stable where the meaning doesn't change. Change nothing the reasons don't need."),
        ],
      });
      if (!r.ok) return r.outcome;
      const { suggestions: _s0, ...draft } = r.output;
      void _s0;
      const stab = Object.fromEntries(spec.requirements.map((q) => [q.id, q.stability]));
      spec = { ...draft, requirements: draft.requirements.map((q) => ({ ...q, stability: stable(stab, q.id) })) };
    }
    let before: string[] | undefined;
    for (;;) {
      const d = downgradeUi(spec, testsScreens(ctx.project.stack));
      spec = d.spec;
      for (const id of d.downgraded) manualUi.add(id);
      const c = await checkSpec(ctx, spec, i, lane.criticEffort);
      if (!c.ok) return failed(c.outcome);
      checks = c.checks;
      const open = problems(checks);
      if (!open.length || repairs >= lane.maxRepairs) break;
      // a repair that left the same problems won't do better next time: stop paying for more
      if (before && sameProblems(before, open)) { ctx.log("specify: the last repair left the same findings; stopping repairs"); break; }
      before = open;
      repairs++;
      ctx.log(`specify: repair ${repairs}/${lane.maxRepairs} for ${open.length} findings`);
      const r = await think(ctx, {
        stage: "specify", route: "specify", cls: "read-large", budgetTokens: 30000, ...readTools(ctx), schema: RepairOut, maxTurns: 8,
        sections: [
          ...draftSections(ctx, i),
          S.artifact("spec", "spec", spec),
          S.artifact("findings", "findings", open),
          S.task(`Repair this spec so every finding is fixed. Keep requirement IDs stable where the meaning doesn't change. Change nothing the findings don't need. Never fix a finding by moving requested behaviour out of scope or deleting the requirements that cover an intent span.
Answer with the changes only, not the whole spec: "requirements" holds each requirement you change or add, whole, with all of its acceptance criteria; "nfrs" each NFR you change or add; "removed" the ids you delete; "outOfScope" and "assumptions" the whole list, only when it changes. Everything you leave out stays exactly as it is.`),
        ],
      });
      if (!r.ok) return failed(r.outcome);
      const stab = Object.fromEntries(spec.requirements.map((q) => [q.id, q.stability]));
      const draft = applyRepair(spec, r.output);
      const next = { ...draft, requirements: draft.requirements.map((q) => ({ ...q, stability: stable(stab, q.id) })) };
      // a repair may not drop requested behaviour: keep the previous spec (and its checks) and stop
      const lost = lostCoverage(spec, next, spanIds);
      if (lost.length) { rejectedRepair = lost; ctx.log(`specify: repair ${repairs} dropped intent span${lost.length > 1 ? "s" : ""} ${lost.join(", ")}; kept the previous spec`); break; }
      spec = next;
      repaired = true;
    }
    }
    let settled: Found["settled"];
    if (settling) {
      const withAnswers = (answers: Answer[]) => ({ ...i, answers: [...i.answers, ...answers] });
      const s = await settle<Checks>(ctx, {
        key, request: request(ctx), firstId: nextQuestion(i.answers),
        start: () => (refused
          ? { spec: specOf(refused), checks: { lint: refused.lint.map((l) => ({ ...l, blocking: false, fails: [] })), critic: refused.critic as Checks["critic"], roundTrip: refused.roundTrip as Checks["roundTrip"] } }
          : { spec, checks: checks! }),
        io: {
          repair: async (before, answers, decided) => {
            const r = await think(ctx, {
              stage: "specify", route: "specify", label: "specify (answers)", cls: "read-large", budgetTokens: 30000, ...readTools(ctx), schema: RepairOut, maxTurns: 8,
              sections: [
                ...draftSections(ctx, withAnswers(answers)),
                S.artifact("spec", "spec", before),
                S.artifact("decisions", "decisions", decided.map((d) => ({ id: d.id, question: d.question, answer: d.answer, settles: d.problems.map((p) => p.text) }))),
                S.task(`Each decision answers a question about a problem in this spec. Change the spec so it does exactly what each answer says: add or change requirements and acceptance criteria, cite the answer id (Q-n) in "sources", and remove what an answer leaves out. Keep requirement IDs stable where the meaning doesn't change. Change nothing the decisions don't need. Never move requested behaviour out of scope or delete the requirements that cover an intent span.
Answer with the changes only, not the whole spec: "requirements" holds each requirement you change or add, whole, with all of its acceptance criteria; "nfrs" each NFR you change or add; "removed" the ids you delete; "outOfScope" and "assumptions" the whole list, only when it changes. Everything you leave out stays exactly as it is.`),
              ],
            });
            if (!r.ok) return r;
            const stab = Object.fromEntries(before.requirements.map((q) => [q.id, q.stability]));
            const draft = applyRepair(before, r.output);
            const d = downgradeUi({ ...draft, requirements: draft.requirements.map((q) => ({ ...q, stability: stable(stab, q.id) })) }, testsScreens(ctx.project.stack));
            for (const id of d.downgraded) manualUi.add(id);
            return { ok: true, spec: d.spec };
          },
          recheck: (next, answers) => checkSpec(ctx, next, withAnswers(answers), lane.criticEffort),
          lost: (before, after) => lostCoverage(before, after, spanIds),
        },
      });
      if (!s.ok) return failed(s.outcome);
      spec = s.spec;
      checks = s.checks;
      settled = s.settled;
    }
    const hardLint = checks!.lint.filter((l) => l.blocking && !l.passed);
    if (hardLint.length) {
      // a spec that still fails format checks can't go to a human for approval
      return failed({ kind: "fail", category: "other", failures: hardLint.map((l) => failure(`spec-lint ${l.check}`, l.details)), signature: `lint:${hardLint.map((l) => l.check).join(",")}` });
    }
    const specSha = ctx.ledger.putJson({ ...spec, lint: checks!.lint.map(({ check, passed, details }) => ({ check, passed, details })), critic: checks!.critic, roundTrip: checks!.roundTrip, ...(settled ? { settled } : {}) });
    const criticSha = ctx.ledger.putJson({ findings: checks!.critic, note: checks!.criticNote });
    return {
      kind: "done", outputs: { spec: specSha, critic: criticSha },
      data: { repairs, openFindings: problems(checks!), conflicts: merged.conflicts, ...(rejectedRepair ? { rejectedRepair } : {}), ...(settled?.length ? { settled: settled.length } : {}),
        ...(ctx.state.info.mode !== "estimate" && sizeNote(spec, i.intent.changeClass) ? { sizeNote: sizeNote(spec, i.intent.changeClass) } : {}), manualUi: [...manualUi], lane: lane.name },
    };
  },
};
