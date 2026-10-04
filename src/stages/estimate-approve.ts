// Estimate mode, the human and file steps (docs/estimates-design.md, "The pipeline"); the design approval (E1b) is in
// design-approve.ts:
//   approve-estimate (E7)  a lead approves in a terminal, tied to the estimate's hash
//   export                 deterministic code writes the team and client workbooks, then lints them cell by cell
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { Breakdown, Design, Estimate, Spec } from "../contracts/index.js";
import { FACTORY_APPROVER, leadApproval } from "../estimate/gates.js";
import { humanReview } from "../estimate/settings.js";
import { catalogueStatusText } from "../estimate/catalogue-status.js";
import { exportWorkbooks, type ExportInput } from "../estimate/export.js";
import { considerationsFrom } from "../estimate/considerations.js";
import { diffEstimates } from "../estimate/lineage.js";
import { gateLine, gateLog, waiversOf } from "../estimate/log.js";
import { loadWorkbook, lintWorkbook } from "../estimate/workbook-lint.js";
import { failure } from "../gates/engine.js";
import type { RunState } from "../ledger/state.js";
import { Ledger } from "../ledger/ledger.js";
import { exportRunPackage } from "./design-export.js";
import { writeDesignBook } from "../design/export.js";
import { hashJson } from "../util/hash.js";
import type { ClarifyResult } from "./clarify.js";
import { gate, settingsOf } from "./estimate.js";
import { header, outputOf, readOutput, requireOutput, type StepDef, type StepOutcome } from "./framework.js";
import { designNoteLines } from "./design-approve.js";


type DesignT = z.infer<typeof Design>;

const decisionsOn = (state: RunState, prefix: string) => state.decisions.filter((d) => d.cardId.startsWith(prefix));
const reasonOf = (d: unknown): string => String((d as { reason?: string }).reason ?? "").trim();

// ---------- E7: approve the estimate ----------

/** Against the approved estimate this run revises, or the sibling delivery model's. */
function parentDiff(ctx: { state: RunState; ledger: { getJson<T>(sha: string): T } }, e: Estimate, b: Breakdown): { title: string; lines: string[] } | undefined {
  const p = ctx.state.info.parent;
  if (!p) return undefined;
  const from = { estimate: ctx.ledger.getJson<Estimate>(p.estimateSha), breakdown: ctx.ledger.getJson<Breakdown>(p.breakdownSha) };
  return {
    title: p.kind === "change" ? `Change from the approved estimate (${p.runId.slice(0, 24)})` : `Compared with the ${from.estimate.deliveryModel === "hitl" ? "HITL" : "solely agentic"} estimate`,
    lines: diffEstimates(from, { estimate: e, breakdown: b }),
  };
}

const h = (r: { min: number; max: number }): string => `${r.min}-${r.max} h`;
const usd = (r: { min: number; max: number }): string => `$${r.min.toFixed(2)}-$${r.max.toFixed(2)}`;

/** The one review the lead does: anchors first, then totals, cost, flags, the gate and waiver log. */

export function estimateCard(runId: string, hash: string, e: Estimate, b: Pick<Breakdown, "tasks">, extra: { gates: string[]; waivers: string[]; note?: string; diff?: { title: string; lines: string[] }; designNote?: Parameters<typeof designNoteLines>[0] }): string {
  const title = new Map(b.tasks.map((t) => [t.id, t.title]));
  const flagged = e.tasks.filter((t) => t.flagged);
  const list = (xs: string[], none: string) => (xs.length ? xs : [none]);
  return [
    `# Approve the estimate (E7)`, ``,
    `Run ${runId} · ${e.deliveryModel === "hitl" ? "HITL (supervisor + agents)" : "solely agentic"} · size ${e.band} · uncertainty ${e.uncertainty}`,
    ...(e.catalogue ? [`Hours from task catalogue ${e.catalogue.version} (stack ${e.catalogue.stack}): ${catalogueStatusText(e.catalogue)}.`] : []),
    extra.note ? `\n${extra.note}` : "", ``,
    ...(extra.diff ? [`## ${extra.diff.title}`, ...extra.diff.lines.map((l) => `- ${l}`), ``] : []),
    ...designNoteLines(extra.designNote),
    `## Anchors (check these first: every other task is sized against one)`,
    ...e.anchors.map((a) => `- ${a.taskId} ${title.get(a.taskId) ?? ""}: ${h(a.hours)}. ${a.reason}`), ``,
    ...(e.tasks.some((t) => t.references?.length) ? [`## Sized with approved past tasks as references`, ...e.tasks.filter((t) => t.references?.length).map((t) => `- ${t.taskId} ${title.get(t.taskId) ?? ""}: ${t.size?.replace("-", " ") ?? "-"}; like ${t.references!.map((r) => `${r.taskId} of ${r.runId} (${r.size.replace("-", " ")}, ${h(r.hours)})`).join(", ")}${t.references!.every((r) => r.size !== t.size) ? " (sized differently: see its reason)" : ""}`), ``] : []),
    ...(e.tasks.some((t) => t.splitAdvised) ? [`## Split before the build (agent work this size fails and retries more)`, ...e.tasks.filter((t) => t.splitAdvised).map((t) => `- ${t.taskId} ${title.get(t.taskId) ?? ""}: ${h(t.hours)}${t.size === "very-large" ? ", very large" : `, over ${e.catalogue?.splitAboveHours} h`}`), ``] : []),
    `## Totals`,
    ...Object.entries(e.totals.byTrack).map(([t, r]) => `- ${t}: ${h(r!)}`),
    `- Overall: ${h(e.totals.overall)} (design ${e.settings.designInTotal ? "included" : "not included"})`, ``,
    `## Cost and time`,
    `- API credits: ${usd(e.apiCost.total)}, ${e.apiCost.confidence} (${e.apiCost.records} measured record${e.apiCost.records === 1 ? "" : "s"}); indicative, not a quote`,
    `- Planning: ${e.elapsed.planningMinutes} min · build critical path: ${e.elapsed.criticalPathDays.min}-${e.elapsed.criticalPathDays.max} days`,
    ...durationLines(e), ``,
    `## Low-confidence lines (estimators disagree; each needs your sign-off)`,
    ...list(flagged.map((t) => `- ${t.taskId} ${title.get(t.taskId) ?? ""}: ${h(t.hours)}`), "none"), ``,
    `## Suggested, not included`, ...list(e.suggested.map((s) => `- ${s.title}: ${s.reason}`), "none"), ``,
    `## Assumptions`, ...list(e.assumptions.map((a) => `- ${a}`), "none"), ``,
    `## Gates`, ...list(extra.gates.map((g) => `- ${g}`), "none recorded"), ``,
    `## Waivers`, ...list(extra.waivers.map((w) => `- ${w}`), "none"), ``,
    `Approve: factory approve ${runId} ${hash.slice(0, 8)}${flagged.length ? ` --sign-off ${flagged.map((t) => t.taskId).join(",")}` : ""}`,
    `Edit:    factory edit-estimate ${runId} ${hash.slice(0, 8)} --anchor ${e.anchors[0]?.taskId ?? "EST-1"}=<min>-<max> --ratio <EST-n>=<multiple> --reason "why"   (everything recomputes; you get a new card)`,
    `Reject:  factory reject ${runId} ${hash.slice(0, 8)} --reason "why"`, ``, `Card hash: ${hash.slice(0, 8)}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

/** Where the build time came from, and any class whose measured turns disagree with the pinned external prior. */
export function durationLines(e: Estimate): string[] {
  const b = e.elapsed.basis;
  if (!b) return [];
  const measured = b.byClass.filter((c) => c.minutes);
  const out = [`- Build time basis: ${b.confidence} (${measured.length} of ${b.byClass.length} task class${b.byClass.length === 1 ? "" : "es"} measured from earlier builds; the rest use the sized hours as an assumed duration)`];
  for (const c of measured) out.push(`  - ${c.taskClass}: ${Math.round(c.minutes!.min)}-${Math.round(c.minutes!.max)} min per task, ${c.records} record${c.records === 1 ? "" : "s"}`);
  for (const c of b.byClass.filter((x) => x.priorFlag)) {
    out.push(`- CHECK ${c.taskClass}: median ${c.turnsMedian} turns per task is ${c.priorFlag} of the external prior (${b.prior!.roundsP10}-${b.prior!.roundsP90} tool rounds, ${b.prior!.source}). Our measurement stands; look at why.`);
  }
  return out;
}

export const approveEstimateStep: StepDef = {
  key: "approve-estimate", stage: "estimate", templateVersion: "1",
  inputs: (s) => (s.steps.get("estimate")?.status === "completed"
    ? { estimate: s.steps.get("estimate")!.outputs[0], breakdown: s.steps.get("breakdown")!.outputs[0], decisions: decisionsOn(s, "estimate-").length }
    : undefined),
  async run(ctx): Promise<StepOutcome> {
    const estimate = requireOutput<Estimate>(ctx.state, ctx.ledger, "estimate");
    const breakdown = requireOutput<Breakdown>(ctx.state, ctx.ledger, "breakdown");
    const estimateSha = outputOf(ctx.state, "estimate")!;
    // a hands-off estimate run: the factory approves an estimate that passed its gates
    if (!humanReview(ctx.state.info)) {
      const approval = { estimateHash: hashJson(estimate), decision: "approved" as const, by: FACTORY_APPROVER, signedOff: [], auto: true as const };
      const g = await gate(ctx, "approve-estimate", leadApproval, { estimate, approval });
      if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [failure("e7", g.details)], signature: `e7:${g.details.slice(0, 80)}` };
      const sha = ctx.ledger.putJson({ header: header(ctx.runId, "estimate-approval", "estimate", estimateSha), estimateSha, ...approval, waivers: waiversOf(ctx.state) });
      return { kind: "done", outputs: { approval: sha }, data: { by: FACTORY_APPROVER, auto: true, hash: approval.estimateHash.slice(0, 12), signedOff: [] } };
    }
    const past = decisionsOn(ctx.state, "estimate-");
    const bundleOf = (round: number) => ctx.ledger.putJson({ estimate: estimateSha, round });
    const last = past[past.length - 1];
    let note: string | undefined;
    // the latest decision counts only if it was on the card for this exact estimate
    if (last && last.artifactSha === bundleOf(past.length - 1)) {
      if (last.decision === "reject") {
        return { kind: "park", reason: `The estimate was rejected by ${last.by}${reasonOf(last) ? `: ${reasonOf(last)}` : ""}. Change the request or settings and start a new estimate run.` };
      }
      if (last.decision === "approve") {
        const raw = (last as unknown as { signOff?: unknown }).signOff;
        const signedOff = Array.isArray(raw) ? raw.map(String) : [];
        const approval = { estimateHash: hashJson(estimate), decision: "approved" as const, by: last.by, signedOff };
        const g = await gate(ctx, "approve-estimate", leadApproval, { estimate, approval });
        if (g.passed) {
          const sha = ctx.ledger.putJson({ header: header(ctx.runId, "estimate-approval", "estimate", estimateSha), estimateSha, ...approval, waivers: waiversOf(ctx.state) });
          return { kind: "done", outputs: { approval: sha }, data: { by: last.by, hash: approval.estimateHash.slice(0, 12), signedOff } };
        }
        note = `Your last approval was not accepted: ${(g.failures ?? []).map((f) => f.message).join("; ") || g.details}. Approve again with the sign-off.`;
      }
    }
    const round = past.length;
    const bundle = bundleOf(round);
    const md = estimateCard(ctx.runId, bundle, estimate, breakdown, {
      gates: gateLog(ctx.ledger.events()).map(gateLine),
      waivers: waiversOf(ctx.state).map((w) => `${w.gateIds.join(", ")} (${w.step}): waived by ${w.human}. ${w.reason}`),
      note, diff: parentDiff(ctx, estimate, breakdown), ...((d) => (d?.note ? { designNote: d } : {}))(readOutput<DesignT>(ctx.state, ctx.ledger, "design")),
    });
    return { kind: "wait", card: { cardId: `estimate-${bundle.slice(0, 8)}`, kind: "estimate-approval", artifactSha: bundle, markdown: md } };
  },
};

// ---------- export ----------

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** What both workbooks are written from: the same inputs for the approved export and for a draft taken before approval. */
export function exportInputFor(state: RunState, ledger: Ledger): ExportInput {
    const estimate = requireOutput<Estimate>(state, ledger, "estimate");
    const breakdown = requireOutput<Breakdown>(state, ledger, "breakdown");
    const spec = requireOutput<Spec>(state, ledger, "specify");
    const info = state.info.estimate ?? {};
    const settings = settingsOf(state);
    const input: ExportInput = {
      estimate, breakdown,
      header: { client: info.client ?? state.info.project, project: info.projectName ?? state.info.project, pm: info.pm ?? state.info.operator ?? "", date: new Date().toISOString().slice(0, 10), version: state.info.parent?.kind === "change" ? "2" : "1" },
      requirements: spec.requirements.map((q) => ({ id: q.id, title: q.ears.length > 140 ? `${q.ears.slice(0, 137)}...` : q.ears })),
      ...(settings.rates && Object.keys(settings.rates).length ? { rates: settings.rates } : {}),
      waivers: waiversOf(state),
      gateLog: gateLog(ledger.events()),
      considerations: considerationsFrom(["clarify", "clarify-2"].map((k) => readOutput<ClarifyResult>(state, ledger, k)).filter((r): r is ClarifyResult => !!r)),
    };
  return input;
}

/** The design book PDF of an estimate's approved design, written into the delivery folder; undefined when the request has no UI. */
async function designBookFor(ctx: { state: RunState; ledger: Ledger; log: (m: string) => void }, dir: string, base: string): Promise<{ file: string; version: number } | { none: string } | undefined> {
  try {
    const pkg = await exportRunPackage(ctx.state, ctx.ledger, ctx.log);
    if ("none" in pkg) return /no UI/.test(pkg.none) ? undefined : { none: pkg.none };
    const file = join(dir, `${base}-design-v${pkg.manifest.version}.pdf`);
    const spec = readOutput<{ requirements?: { id: string; ears: string }[] }>(ctx.state, ctx.ledger, "specify");
    const why = await writeDesignBook(pkg, file, { requirements: Object.fromEntries((spec?.requirements ?? []).map((r) => [r.id, r.ears])) });
    return why ? { none: why } : { file, version: pkg.manifest.version };
  } catch (e) {
    return { none: (e as Error).message.split("\n")[0]! };
  }
}

export const exportStep: StepDef = {
  key: "export", stage: "estimate", templateVersion: "1",
  inputs: (s) => (s.steps.get("approve-estimate")?.status === "completed" ? { approval: s.steps.get("approve-estimate")!.outputs[0], estimate: s.steps.get("estimate")!.outputs[0] } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const input = exportInputFor(ctx.state, ctx.ledger);
    const { estimate, breakdown } = input;
    const dir = join(ctx.ledger.dir, "export");
    const files = await exportWorkbooks(input, dir, ctx.runId, ctx.project.estimateTemplate ? { templatePath: ctx.project.estimateTemplate } : {});
    // E6 at cell level: read each file back and check it against the estimate it came from
    const failures = [];
    for (const [audience, path] of [["team", files.team], ["client", files.client]] as const) {
      for (const i of lintWorkbook(await loadWorkbook(path), estimate, breakdown, audience)) failures.push(failure(`workbook-${i.check}`, `${audience} file: ${i.message}`));
    }
    if (failures.length) return { kind: "fail", category: "other", failures, signature: `export:${failures.map((f) => f.check).sort().join(",")}` };
    // the approved design as its own PDF beside the client workbook (never inside the Excel); no browser is a note, not a failure
    const book = await designBookFor(ctx, dir, ctx.runId);
    const manifest = {
      team: files.team, client: files.client, teamSha256: sha256File(files.team), clientSha256: sha256File(files.client), estimateSha: outputOf(ctx.state, "estimate"),
      ...(book && "file" in book ? { design: book.file, designSha256: sha256File(book.file), designVersion: book.version } : {}), ...(book && "none" in book ? { designNote: book.none } : {}),
    };
    ctx.log(`estimate workbooks written:\n  team   ${files.team}\n  client ${files.client}${book && "file" in book ? `\n  design ${book.file}` : book ? `\n  design PDF not written: ${book.none}` : ""}`);
    return { kind: "done", outputs: { manifest: ctx.ledger.putJson(manifest) }, data: { team: files.team, client: files.client, ...(book && "file" in book ? { design: book.file } : {}) } };
  },
};

