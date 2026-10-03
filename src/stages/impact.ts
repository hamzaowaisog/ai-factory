// Impact (ripple effects): between the spec and the plan, list what else the change touches, from code only
// (src/context/ripple.ts; no model, no credits). Three levels:
//   must-change — code the MODIFIED/REMOVED requirements anchor: the spec says it changes
//   breaks      — code that still uses something a REMOVED requirement takes away
//   check       — code that uses the changed code (callers, data, screens, tests, settings): worth a look
// The plan must cover every must-change and breaks path (a task's file scope or a mention in its notes);
// the approval card shows the first few under "Will also affect". Risk goes up for breaks and data changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { CurrentBehaviourBody, Evidence, Risk, Spec } from "../contracts/index.js";
import { failure } from "../gates/engine.js";
import { matchesAny } from "../util/glob.js";
import { candidateFiles, LENSES, rippleCandidates, type Lens, type RippleResult, type Seed } from "../context/ripple.js";
import { header, readOutput, requireOutput, type StepDef } from "./framework.js";
import { snapshotFor } from "./workspace.js";
import type { RunState } from "../ledger/state.js";
import type { Ledger } from "../ledger/ledger.js";
import { runLenses, type LensFinding, type LensStat } from "./impact-lens.js";

type CB = z.infer<typeof CurrentBehaviourBody>;

export type Level = "must-change" | "breaks" | "check";
export interface ImpactItem { path: string; level: Level; lens?: Lens; reason: string; evidence?: Evidence }
export interface ImpactResult {
  items: ImpactItem[];
  counts: Record<Level, number> & Record<Lens, number>;
  risk: Risk;
  riskWhy: string[];
  symbols: string[]; routes: string[]; entities: string[];
  /** per-lens cost and counts, when the lenses ran */
  lensStats?: LensStat[];
}

/** check items kept in the artifact (the card shows fewer) */
const MAX_CHECK = 60;
export const CARD_LINES = 8;

/** Seeds: ground's anchors, plus the anchors of MODIFIED/REMOVED requirements (REMOVED ones mark breaks). */
export function seedsOf(spec: Pick<Spec, "requirements">, cb: CB): Seed[] {
  const seeds: Seed[] = cb.claims.flatMap((c) => c.anchors.map((a) => ({ path: a.path, ...(a.symbol ? { symbol: a.symbol } : {}) })));
  for (const r of spec.requirements) {
    if (r.op === "ADDED") continue;
    for (const a of r.anchors ?? []) seeds.push({ path: a.path, ...(r.op === "REMOVED" ? { removed: true } : {}) });
  }
  return seeds;
}

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

/** Merge the code layer into one list per file (must-change > breaks > check) and judge the risk. */
export function mergeImpact(spec: Pick<Spec, "requirements">, ripple: RippleResult, base: Risk, lensFindings: LensFinding[] = []): ImpactResult {
  const items = new Map<string, ImpactItem>();
  for (const r of spec.requirements) {
    if (r.op === "ADDED") continue;
    for (const a of r.anchors ?? []) if (!items.has(a.path)) items.set(a.path, { path: a.path, level: "must-change", reason: `${r.id} (${r.op}) changes it`, evidence: a });
  }
  const all = LENSES.flatMap((l) => ripple.lenses[l]);
  for (const path of candidateFiles(ripple)) {
    if (items.has(path)) continue;
    const c = all.find((x) => x.path === path)!; // candidateFiles is ranked: the first hit is the strongest
    items.set(path, {
      path, level: c.breaks ? "breaks" : "check", lens: c.lens,
      reason: `${c.kind === "reference" ? "uses" : c.kind} ${c.seed}${c.hop === 2 ? " (through its interface)" : ""}`,
      evidence: { path, lineStart: c.line, lineEnd: c.line, quote: c.quote },
    });
  }
  // lens findings (already checked): new files are added; a file the code layer only had as "check" may be raised
  const order: Level[] = ["must-change", "breaks", "check"];
  for (const f of [...lensFindings].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))) {
    const had = items.get(f.path);
    if (had && (had.level !== "check" || f.level === "check")) continue;
    items.set(f.path, { path: f.path, level: f.level, lens: f.lens, reason: `${f.reqId ? `${f.reqId}: ` : ""}${f.why} (${f.lens} lens)`,
      evidence: { path: f.path, lineStart: f.lineStart, lineEnd: f.lineEnd, quote: f.quote } });
  }
  const list = [...items.values()];
  const kept = [...list.filter((i) => i.level !== "check"), ...list.filter((i) => i.level === "check").slice(0, MAX_CHECK)];
  const count = (l: Level) => list.filter((i) => i.level === l).length;
  const counts = { "must-change": count("must-change"), breaks: count("breaks"), check: count("check"),
    ...Object.fromEntries(LENSES.map((l) => [l, ripple.lenses[l].length])) } as ImpactResult["counts"];

  const why: string[] = [];
  let risk: Risk = "low";
  const raise = (to: Risk, reason: string) => { why.push(reason); if (RANK[to] > RANK[risk]) risk = to; };
  if (counts.breaks) raise("high", `${counts.breaks} file${counts.breaks === 1 ? "" : "s"} still use what a REMOVED requirement takes away`);
  if (ripple.lenses.data.length) raise("high", `the change reaches stored data (${[...new Set(ripple.lenses.data.map((c) => c.seed))].join(", ")})`);
  if (ripple.lenses.screens.length) raise("medium", `${new Set(ripple.lenses.screens.map((c) => c.path)).size} screen file(s) call the changed code`);
  if (counts.check >= 10) raise("medium", `${counts.check} other files use the changed code`);
  if (RANK[base] > RANK[risk]) risk = base;
  return { items: kept, counts, risk, riskWhy: why, symbols: ripple.symbols, routes: ripple.routes, entities: ripple.entities };
}

/** must-change and breaks paths the plan neither scopes nor mentions. */
export function uncoveredByPlan(plan: { adr: string; tasks: { title: string; fileScope: string[]; approach: string }[] }, impact: Pick<ImpactResult, "items">): ImpactItem[] {
  const scopes = plan.tasks.flatMap((t) => t.fileScope);
  const notes = [plan.adr, ...plan.tasks.flatMap((t) => [t.title, t.approach])].join("\n");
  return impact.items.filter((i) => i.level !== "check"
    && !scopes.includes(i.path) && !matchesAny(i.path, scopes)
    && !notes.includes(i.path) && !notes.includes(i.path.split("/").pop()!));
}

export function planCoverageFailures(plan: Parameters<typeof uncoveredByPlan>[0], impact: Pick<ImpactResult, "items">) {
  return uncoveredByPlan(plan, impact).map((i) => failure("impact-uncovered",
    `${i.path} ${i.level === "breaks" ? "breaks" : "must change"} (${i.reason}) but no task's fileScope covers it and the plan doesn't say why it's left alone`));
}

/** For the plan prompt: what the plan has to account for (empty when nothing must be covered). */
export function planNote(impact: ImpactResult): string {
  const must = impact.items.filter((i) => i.level !== "check");
  const check = impact.items.filter((i) => i.level === "check").slice(0, 15);
  if (!must.length && !check.length) return "";
  return [
    ...(must.length ? ["These files must be in a task's fileScope, or the adr or a task's approach must name the file and say why it stays as it is:",
      ...must.map((i) => `- ${i.path} [${i.level}] ${i.reason}`)] : []),
    ...(check.length ? ["Other code that uses the changed code (found by code search; scope it only if it really has to change):",
      ...check.map((i) => `- ${i.path} [${i.lens}] ${i.reason}`)] : []),
  ].join("\n");
}

/** The approval card's "Will also affect" lines: files outside the plan, breaks first, at most CARD_LINES. */
export function affectsLines(impact: ImpactResult, planned: string[]): string[] {
  const outside = impact.items.filter((i) => !planned.includes(i.path) && !matchesAny(i.path, planned));
  if (!outside.length) return [];
  const order: Level[] = ["breaks", "must-change", "check"];
  const sorted = [...outside].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const shown = sorted.slice(0, CARD_LINES).map((i) => `- ${i.path} (${i.level === "check" ? i.lens : i.level}): ${i.reason}`);
  if (sorted.length > CARD_LINES) shown[CARD_LINES - 1] = `- …and ${sorted.length - CARD_LINES + 1} more (see the impact artifact)`;
  return shown;
}

export function readImpact(state: RunState, ledger: Ledger): ImpactResult | undefined {
  return readOutput<ImpactResult>(state, ledger, "impact");
}

export const impactStep: StepDef = {
  key: "impact", stage: "impact", templateVersion: "1",
  inputs: (s) => (s.steps.get("specify")?.status === "completed" && s.steps.get("ground")?.status === "completed"
    ? { spec: s.steps.get("specify")!.outputs[0], cb: s.steps.get("ground")!.outputs[0], base: s.info.baseCommit } : undefined),
  async run(ctx) {
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const cb = requireOutput<CB>(ctx.state, ctx.ledger, "ground");
    const intent = requireOutput<{ risk: Risk }>(ctx.state, ctx.ledger, "intake");
    const snap = snapshotFor(ctx);
    const read = (p: string) => { try { return readFileSync(join(snap.root, p), "utf8"); } catch { return undefined; } };
    const seeds = seedsOf(spec, cb);
    const ripple = rippleCandidates({ files: snap.files, read }, seeds);
    const lenses = ctx.project.impact?.lenses ? await runLenses(ctx, snap, spec, seeds, ripple) : undefined;
    const impact: ImpactResult = { ...mergeImpact(spec, ripple, intent.risk, lenses?.findings), ...(lenses ? { lensStats: lenses.stats } : {}) };
    for (const l of lenses?.stats ?? []) ctx.log(`impact lens ${l.lens}: ${l.findings} findings, ${l.bad} bad quotes${l.retried ? " (asked again)" : ""}, $${l.usd.toFixed(3)}${l.error ? `; skipped: ${l.error}` : ""}`);
    ctx.log(`impact: ${impact.counts["must-change"]} must change, ${impact.counts.breaks} break, ${impact.counts.check} to check; risk ${impact.risk}`);
    const sha = ctx.ledger.putJson({ header: header(ctx.runId, "impact", "impact", ""), ...impact });
    return { kind: "done", outputs: { impact: sha }, data: { risk: impact.risk, counts: impact.counts, ...(lenses ? { lensUsd: Object.fromEntries(lenses.stats.map((l) => [l.lens, Number(l.usd.toFixed(4))])) } : {}) } };
  },
};
