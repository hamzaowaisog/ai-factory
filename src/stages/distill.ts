// distill (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §2-§5): a Google Meet transcript → the client's intent,
// checked by code and confirmed by a person on the intent card before intake. The model's checked answer travels on the card
// (as clarify's does), so edits, resumes and approvals never pay for the model again.
import { ClientIntentBody, DistillOut, type Transcript } from "../contracts/index.js";
import { loadRoster, rolesFor } from "../config/team.js";
import { transcriptText } from "../sources/transcript.js";
import { hashJson } from "../util/hash.js";
import { DISTILL_SKILL, loadDistillSkill } from "./distill-skill.js";
import { header, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { applyIntentEdits, INTENT_CARD, intentCard, intentEditsOf, renderBrief } from "./intent-edits.js";
import { checkQuotes, needsRepair, type Dropped } from "./quote-check.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

/** A second rejection of the intent parks the run. */
export const MAX_INTENT_REJECTS = 2;
/**
 * Cache the transcript on the first call so a repair reads it at the cache price ($0.20/M on Opus 5.5) instead of $4/M; costs +25% on
 * the transcript when no repair follows. Worth it while about 1 run in 5 or more needs a repair: check real runs, switch off if not (spec §7).
 */
export const CACHE_TRANSCRIPT = true;

type Pending = { out: DistillOut; dropped: Dropped[]; model: string };
const intentDecisions = (ctx: Pick<StepContext, "state">) => ctx.state.decisions.filter((d) => d.cardId.startsWith(INTENT_CARD));
const rejectsOf = (ctx: Pick<StepContext, "state">) => intentDecisions(ctx).filter((d) => d.decision === "reject").map((d) => String((d as unknown as { reason?: string }).reason ?? "").trim());
const decisionOn = (ctx: StepContext, sha: string) => [...ctx.state.decisions].reverse().find((d) => d.artifactSha === sha);

/** The model's checked answer from an earlier attempt of this step, carried on its card (the same lookup as clarify's pendingFor). */
function pendingFor(ctx: StepContext, cacheKey: string): Pending | undefined {
  const ev = [...ctx.ledger.events()].reverse().find((e) => e.type === "human.requested" && (e.data as { cacheKey?: string } | undefined)?.cacheKey === cacheKey);
  const sha = (ev?.data as { pendingSha?: string } | undefined)?.pendingSha;
  return sha ? ctx.ledger.getJson<Pending>(sha) : undefined;
}

async function ask(ctx: StepContext, t: Transcript, skill: string, roles: string, feedback: string[]): Promise<{ ok: true; out: DistillOut; model: string } | { ok: false; outcome: StepOutcome }> {
  const r = await think(ctx, {
    stage: "distill", route: "distill", cls: "read-large", budgetTokens: 120_000, tools: [], schema: DistillOut, cacheBriefing: CACHE_TRANSCRIPT,
    sections: [
      S.template("skill", skill),
      S.template("tpl", `You are the distill step of a software factory. Follow the transcript-distill rules above.\n${UNTRUSTED_NOTE}`),
      S.reference("roles", `Speakers and their roles (from the team roster):\n${roles}`),
      S.untrusted("notes", "gemini-notes", `UNVERIFIED Gemini notes (never evidence; only a pointer to places worth reading):\n${t.notes}`),
      S.untrusted("turns", "transcript", transcriptText(t)),
      S.task("Extract the client's intent for one project."),
      ...(feedback.length ? [S.recap(feedback)] : []),
    ],
  });
  return r.ok ? { ok: true, out: r.output, model: r.model } : { ok: false, outcome: r.outcome };
}

export const distillStep: StepDef = {
  key: "distill", stage: "distill", templateVersion: "1",
  inputs: (s) => (s.info.transcriptSha
    ? { transcript: s.info.transcriptSha, edits: intentEditsOf(s), rejects: s.decisions.filter((d) => d.cardId.startsWith(INTENT_CARD) && d.decision === "reject").length }
    : undefined),
  async run(ctx): Promise<StepOutcome> {
    const rejects = rejectsOf(ctx);
    if (rejects.length >= MAX_INTENT_REJECTS) return { kind: "park", reason: `the client intent was rejected ${rejects.length} times; last reason: ${rejects.at(-1)}` };
    const t = ctx.ledger.getJson<Transcript>(ctx.state.info.transcriptSha!);
    if (!t) return { kind: "park", reason: "the run's transcript is missing from its ledger" };
    const skill = loadDistillSkill(ctx.state.info.repoPath);
    if (!skill) return { kind: "park", reason: `the ${DISTILL_SKILL} skill is not installed (.agents/skills/${DISTILL_SKILL}/SKILL.md)` };
    const roster = loadRoster(ctx.project.project);
    // a role fixed on the card applies to this run only; the latest edit for a speaker wins
    const cardRoles = Object.assign({}, ...intentEditsOf(ctx.state).map((e) => e.roles ?? {})) as Record<string, "client" | "team">;
    const speakers = rolesFor(t.speakers, roster, cardRoles);

    // the model's checked answer, cached per transcript, skill and rejection (spec §5); the roles it was told are those of the roster
    const cacheKey = hashJson({ step: "distill", transcript: ctx.state.info.transcriptSha, skill: skill.sha256, rejects });
    let base = pendingFor(ctx, cacheKey);
    if (!base) {
      const told = rolesFor(t.speakers, roster);
      const roles = told.map((s) => `- ${s.name}: ${s.role}`).join("\n") + (roster.found ? "" : "\n(no team roster is set up: everyone is treated as the client)");
      const feedback = rejects.map((r) => `A person rejected the last intent: ${r}`);
      let a = await ask(ctx, t, skill.text, roles, feedback);
      if (!a.ok) return a.outcome;
      let chk = checkQuotes(a.out, t.turns);
      if (needsRepair(chk.kept.length, chk.dropped.length)) {
        const fix = await ask(ctx, t, skill.text, roles, [...feedback, ...chk.dropped.map((d) => `${d.id}: ${d.why}; quote "${d.quote}" again exactly from the turn, or leave the item out`)]);
        if (!fix.ok) return fix.outcome;
        a = fix;
        chk = checkQuotes(a.out, t.turns);
      }
      base = { out: { ...a.out, requirements: chk.kept }, dropped: chk.dropped, model: a.model };
    }
    const pendingSha = ctx.ledger.putJson(base);

    const speakerOf = new Map(t.turns.map((x) => [x.id, x.speaker]));
    const roleOf = new Map(speakers.map((s) => [s.name, s.role]));
    const draft = ClientIntentBody.parse({
      ...base.out,
      requirements: base.out.requirements.map((r) => {
        const speaker = speakerOf.get(r.turn);
        return { ...r, ...(speaker ? { speaker } : {}), ...(speaker && roleOf.has(speaker) ? { role: roleOf.get(speaker) } : {}) };
      }),
      warnings: [...base.out.warnings, ...(roster.found ? [] : [`No team roster is set up, so every speaker is treated as the client. Add our people with: factory team add "Full Name" --project ${ctx.project.project}`])],
      speakers, dropped: base.dropped, skill: { name: DISTILL_SKILL, sha256: skill.sha256 }, edits: 0,
    });
    const intent = applyIntentEdits(draft, intentEditsOf(ctx.state).map(({ roles: _roles, ...e }) => e));

    const cardSha = ctx.ledger.putJson({ card: "intent", intent });
    if (decisionOn(ctx, cardSha)?.decision === "approve") {
      const sha = ctx.ledger.putJson({ header: header(ctx.runId, "client-intent", "distill", "", base.model), ...intent });
      return { kind: "done", outputs: { intent: sha }, data: { brief: renderBrief(intent, t.date), requirements: intent.requirements.length } };
    }
    const hash = cardSha.slice(0, 8);
    // the cache travels on the card, as clarify's does (src/stages/clarify.ts cardOrDone / pendingFor)
    return { kind: "wait", card: { cardId: `${INTENT_CARD}${hash}`, kind: "intent", artifactSha: cardSha, markdown: intentCard(ctx.runId, intent, hash), extra: { cacheKey, pendingSha } } };
  },
};
