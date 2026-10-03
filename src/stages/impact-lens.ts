// Impact lenses (optional, project config `impact: { lenses: true }`, off by default): four read-only model
// searchers, one per lens, run in parallel after the code layer. Each starts from the code layer's candidates
// for its lens and looks further with read_file and search. Every finding quotes its anchor, which is checked
// against the snapshot; a finding may raise a file to must-change or breaks only with a valid quote AND the
// requirement it serves. More than 30% bad quotes: that lens is asked once more. A lens that fails is skipped
// (the code layer still stands). Cost and tokens are recorded per lens.
import { z } from "zod";
import type { Spec } from "../contracts/index.js";
import type { Snapshot } from "../context/snapshot.js";
import { checkEvidence, RepoTools } from "../context/tools.js";
import { Redactor } from "../context/secrets.js";
import { LENSES, type Lens, type RippleResult, type Seed } from "../context/ripple.js";
import type { ResolvedSection } from "../context/pack.js";
import { stepBudgetUsd } from "../ledger/caps.js";
import { replay } from "../ledger/state.js";
import type { StepContext } from "./framework.js";
import { S, think } from "./think.js";

export const LensOut = z.object({
  findings: z.array(z.object({
    path: z.string(), lineStart: z.number().int().min(1), lineEnd: z.number().int().min(1), quote: z.string().min(1),
    level: z.enum(["must-change", "breaks", "check"]),
    /** the requirement this finding serves; required to raise a file above "check" */
    reqId: z.string().optional(),
    why: z.string(),
  })).max(20),
});
export type LensFinding = z.infer<typeof LensOut>["findings"][number] & { lens: Lens };

export interface LensStat { lens: Lens; model?: string; usd: number; inputTokens: number; outputTokens: number; turns: number; findings: number; bad: number; demoted: number; retried: boolean; error?: string }

/** above this share of bad quotes, the lens is asked once more */
export const BAD_ANCHOR_RETRY = 0.3;
const LENS_USD = 0.3;

const WHAT: Record<Lens, string> = {
  callers: "code that calls, implements, registers (DI) or maps the changed types and methods: callers, interface implementations, DTO and mapping code, public API contracts",
  data: "stored data: entities, EF Core configuration, migrations, raw SQL, seed data, cache keys and anything that reads or writes the changed data",
  screens: "screens and clients: frontend calls to changed API routes, pages and components that show the changed data, Razor views, API client code",
  tests: "tests that exercise the changed behaviour, settings (appsettings, environment), roles and policies, feature flags",
};

/** The briefing for one lens (also used by the replay to count tokens without calling a model). */
export function lensSections(lens: Lens, spec: Pick<Spec, "requirements">, seeds: Seed[], ripple: RippleResult): ResolvedSection[] {
  const cands = ripple.lenses[lens].slice(0, 40).map((c) => `${c.path}:${c.line} [${c.kind}${c.breaks ? ", breaks" : ""}] ${c.quote.trim()}`);
  return [
    S.template("tpl", `You are the ${lens} lens of an impact check. A change is about to be planned in this repository.
Find the files OUTSIDE the changed code that this change will affect through your lens: ${WHAT[lens]}.
Start from the code search candidates (they may be wrong or incomplete), read the code, and search for more.
For each affected file give one anchor: path, lineStart, lineEnd and an exact quote of those lines (quotes are checked).
level: "must-change" when a requirement can't be met without changing this file, "breaks" when this file stops working
unless it changes, "check" when it is worth a look. must-change and breaks need reqId: the requirement it serves.
Do not list the changed files themselves. At most 20 findings; fewer, well-anchored findings beat many guesses.`),
    S.artifact("requirements", "requirements", spec.requirements.map((r) => ({ id: r.id, op: r.op, ears: r.ears, anchors: (r.anchors ?? []).map((a) => `${a.path}:${a.lineStart}`) }))),
    S.reference("changed", `Changed code (seeds): ${[...new Set(seeds.map((s) => s.path))].join(", ") || "(none)"}\nChanged names: ${ripple.symbols.join(", ") || "(none)"}${ripple.routes.length ? `\nChanged routes: ${ripple.routes.join(", ")}` : ""}`),
    S.reference("candidates", cands.length ? `Code search candidates for the ${lens} lens:\n${cands.join("\n")}` : `Code search found no candidates for the ${lens} lens; search yourself.`),
    S.task(`List the files the change affects through the ${lens} lens.`),
  ];
}

/** Checked findings: bad quotes dropped, must-change/breaks without a known requirement lowered to check. */
export function checkFindings(snap: Snapshot, reqIds: Set<string>, seeds: Set<string>, lens: Lens, raw: z.infer<typeof LensOut>["findings"]): { kept: LensFinding[]; bad: { path: string; reason: string }[]; demoted: number } {
  const kept: LensFinding[] = [], bad: { path: string; reason: string }[] = [];
  let demoted = 0;
  for (const f of raw) {
    if (seeds.has(f.path)) continue;
    const ev = checkEvidence(snap, f);
    if (!ev.ok) { bad.push({ path: f.path, reason: ev.reason ?? "quote not found" }); continue; }
    if (f.level !== "check" && !(f.reqId && reqIds.has(f.reqId))) { demoted++; kept.push({ ...f, level: "check", lens }); continue; }
    kept.push({ ...f, lens });
  }
  return { kept, bad, demoted };
}

/** Run the four lenses in parallel. Never fails the step: a lens that can't run is reported and skipped. */
export async function runLenses(ctx: StepContext, snap: Snapshot, spec: Pick<Spec, "requirements">, seeds: Seed[], ripple: RippleResult): Promise<{ findings: LensFinding[]; stats: LensStat[] }> {
  const reqIds = new Set(spec.requirements.map((r) => r.id));
  const seedPaths = new Set(seeds.map((s) => s.path));
  // the four run at once: each gets a quarter of what the run has left, at most LENS_USD
  const maxUsd = Math.min(LENS_USD, stepBudgetUsd(replay(ctx.ledger.events()), LENS_USD * 4) / 4);
  const tools = new RepoTools(snap, new Redactor(), ctx.project.noGo);
  const one = async (lens: Lens): Promise<{ findings: LensFinding[]; stat: LensStat }> => {
    const stat: LensStat = { lens, usd: 0, inputTokens: 0, outputTokens: 0, turns: 0, findings: 0, bad: 0, demoted: 0, retried: false };
    const lensCtx: StepContext = { ...ctx, usage: async (u) => {
      stat.usd += u.estUsd ?? 0; stat.inputTokens += u.inputTokens + (u.cacheRead ?? 0); stat.outputTokens += u.outputTokens; stat.turns += u.turns ?? 1; stat.model = u.model;
      await ctx.usage(u);
    } };
    const ask = (extra: ResolvedSection[]) => think(lensCtx, {
      stage: "impact", route: "impact-lens", cls: "read-large", budgetTokens: 15000, tools: ["read_file", "search"],
      repoTools: tools, schema: LensOut, maxTurns: 8, maxUsd,
      sections: [...lensSections(lens, spec, seeds, ripple), ...extra],
    });
    try {
      let r = await ask([]);
      if (!r.ok) return { findings: [], stat: { ...stat, error: r.outcome.kind === "park" ? r.outcome.reason : r.outcome.kind === "fail" ? r.outcome.failures.map((f) => f.message).join("; ") : r.outcome.kind } };
      let c = checkFindings(snap, reqIds, seedPaths, lens, r.output.findings);
      if (r.output.findings.length && c.bad.length / r.output.findings.length > BAD_ANCHOR_RETRY) {
        stat.retried = true;
        const again = await ask([S.reference("bad-anchors", `Your previous answer had quotes that don't match the files; read the files again and quote exactly:\n${c.bad.map((b) => `- ${b.path}: ${b.reason}`).join("\n")}`)]);
        if (again.ok) { r = again; c = checkFindings(snap, reqIds, seedPaths, lens, again.output.findings); }
      }
      return { findings: c.kept, stat: { ...stat, findings: c.kept.length, bad: c.bad.length, demoted: c.demoted } };
    } catch (e) {
      return { findings: [], stat: { ...stat, error: e instanceof Error ? e.message : String(e) } };
    }
  };
  const results = await Promise.all(LENSES.map(one));
  return { findings: results.flatMap((r) => r.findings), stats: results.map((r) => r.stat) };
}
