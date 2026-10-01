// Estimate mode, the human and file steps (docs/estimates-design.md, "The pipeline"):
//   design-baseline (E1b)  the approved mock and clickable demo are the baseline of a UI estimate
//   approve-estimate (E7)  a lead approves in a terminal, tied to the estimate's hash
//   export                 deterministic code writes the team and client workbooks, then lints them cell by cell
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { z } from "zod";
import type { Breakdown, Design, Estimate, IntentBody, Spec } from "../contracts/index.js";
import { designBaseline, leadApproval } from "../estimate/gates.js";
import { exportWorkbooks, type ExportInput } from "../estimate/export.js";
import { considerationsFrom } from "../estimate/considerations.js";
import { diffDesigns, diffEstimates } from "../estimate/lineage.js";
import { buildDemo, frameDataUri, orderStates } from "../estimate/demo.js";
import { captureDemo, type ShotResult } from "../estimate/screenshots.js";
import { gateLine, gateLog, waiversOf } from "../estimate/log.js";
import { loadWorkbook, lintWorkbook } from "../estimate/workbook-lint.js";
import { failure } from "../gates/engine.js";
import type { RunState } from "../ledger/state.js";
import type { Ledger } from "../ledger/ledger.js";
import { hashJson } from "../util/hash.js";
import type { ClarifyResult } from "./clarify.js";
import { gate, settingsOf } from "./estimate.js";
import { listedFrames, MAX_DESIGN_REVISIONS } from "./design.js";
import { header, outputOf, readOutput, requireOutput, type StepDef, type StepOutcome } from "./framework.js";

type Intent = z.infer<typeof IntentBody>;
type DesignT = z.infer<typeof Design>;

const decisionsOn = (state: RunState, prefix: string) => state.decisions.filter((d) => d.cardId.startsWith(prefix));
const reasonOf = (d: unknown): string => String((d as { reason?: string }).reason ?? "").trim();

// ---------- E1b: design baseline ----------

export function designCard(runId: string, design: DesignT, hash: string, extra: { demo?: string; diff?: string[]; shots?: { dir: string; count: number; note?: string } } = {}): string {
  return [
    `# Approve the design baseline (E1b)`, ``,
    `Run ${runId}. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.`, ``,
    `Flow: ${design.flow}`, design.figmaUrl ? `Figma: ${design.figmaUrl}` : "",
    extra.demo ? `Clickable demo (open in a browser, walk every screen and state before approving): ${extra.demo}` : "",
    extra.shots?.count ? `Screenshots: ${extra.shots.count} in ${extra.shots.dir} (each screen and state, phone and desktop width)${extra.shots.note ? `; ${extra.shots.note}` : ""}` : extra.shots?.note ? `Screenshots: none (${extra.shots.note})` : "", ``,
    ...(extra.diff ? [`## Change from the approved design`, ...(extra.diff.length ? extra.diff.map((l) => `- ${l}`) : ["- no screen changed"]), ``] : []),
    `Screens (${design.screens.length}):`,
    ...design.screens.map((s) => { const x = s as typeof s & { states?: string[]; size?: string }; return `- ${s.id} ${s.route} (${s.file}) -> ${s.reqs.join(", ") || "NO REQUIREMENT"}${x.size ? `; ${x.size}` : ""}${x.states?.length ? `; states: ${x.states.join(", ")}` : ""}`; }), ``,
    design.mapping.unmappedReqs.length ? `Requirements with no screen: ${design.mapping.unmappedReqs.join(", ")}` : "Every requirement has a screen.",
    design.mapping.orphanScreens.length ? `Screens with no requirement: ${design.mapping.orphanScreens.join(", ")}` : "Every screen links to a requirement.", ``,
    `Approve: factory approve ${runId} ${hash.slice(0, 8)}`,
    `Reject:  factory reject ${runId} ${hash.slice(0, 8)} --reason "why"   (the design is redrawn with your reason and you get a new card; the run does not stop)`, ``, `Card hash: ${hash.slice(0, 8)}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export const designBaselineStep: StepDef = {
  key: "design-baseline", stage: "design", templateVersion: "1",
  inputs: (s, l) => {
    if (s.steps.get("specify")?.status !== "completed") return undefined;
    const intake = s.steps.get("intake");
    const ui = intake?.status === "completed" ? !!l.getJson<Intent>(intake.outputs[0]!)?.touchesUi : false;
    return { spec: s.steps.get("specify")!.outputs[0], ui, design: outputOf(s, "design"), decisions: decisionsOn(s, "design-").length };
  },
  async run(ctx): Promise<StepOutcome> {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    if (!intent.touchesUi) {
      const g = await gate(ctx, "design-baseline", designBaseline, { ui: false });
      return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: false, gate: g.details }) }, data: { ui: false } };
    }
    const design = readOutput<DesignT & { skipped?: boolean }>(ctx.state, ctx.ledger, "design");
    if (!design || design.skipped) {
      return { kind: "park", reason: "This request has UI, so its estimate needs an approved mock and clickable demo (gate E1b), and the design step has not produced one for this run. Produce the design, then resume." };
    }
    const designSha = outputOf(ctx.state, "design")!;
    const past = decisionsOn(ctx.state, "design-");
    // the demo is drawn from the design, the requirement text and the attached frames; the approval is tied to that exact page
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const listed = listedFrames(ctx.state.info.request ?? "");
    const frames: Record<string, { name: string; dataUri?: string }> = {};
    let embedded = 0;
    for (const f of listed) {
      const file = join(ctx.ledger.dir, "attachments", "frames", basename(f.name));
      const bytes = existsSync(file) ? readFileSync(file) : undefined;
      const dataUri = bytes ? frameDataUri(f.name, bytes, embedded) : undefined;
      if (dataUri && bytes) embedded += bytes.length;
      frames[f.id] = { name: f.name, ...(dataUri ? { dataUri } : {}) };
    }
    const d = design;
    const html = buildDemo({
      title: ctx.state.info.estimate?.projectName ?? ctx.runId, flow: d.flow, screens: d.screens.map((s) => ({ ...s, states: s.states ?? [], size: s.size ?? "new", frames: s.frames ?? [] })),
      requirements: Object.fromEntries(spec.requirements.map((r) => [r.id, r.ears])), noScreen: d.noScreen ?? [], frames, ...(d.theme ? { theme: d.theme } : {}),
    });
    const demoSha = ctx.ledger.putArtifact(html);
    const demoFile = join(ctx.ledger.dir, "design-demo.html");
    writeFileSync(demoFile, html);
    // the same page for `factory ui` (Run: Preview): the walkable demo, plus each attached frame against the screen that cites it
    const previewDir = join(ctx.ledger.dir, "preview");
    mkdirSync(join(previewDir, "frames"), { recursive: true });
    writeFileSync(join(previewDir, "index.html"), html);
    const images: { file: string; screen: string; req?: string; viewport: "desktop" }[] = [];
    for (const sc of d.screens) for (const fid of sc.frames ?? []) {
      const f = frames[fid];
      if (!f?.dataUri) continue;
      copyFileSync(join(ctx.ledger.dir, "attachments", "frames", basename(f.name)), join(previewDir, "frames", basename(f.name)));
      images.push({ file: `frames/${basename(f.name)}`, screen: `${sc.id} ${sc.route}`, ...(sc.reqs[0] ? { req: sc.reqs[0] } : {}), viewport: "desktop" });
    }
    const writePreview = (shots: ShotResult["shots"]) => writeFileSync(join(previewDir, "preview.json"), JSON.stringify({
      site: { entry: "index.html", screens: d.screens.map((sc) => ({ path: `index.html#${sc.id}`, title: `${sc.id} ${sc.route}`, ...(sc.reqs[0] ? { req: sc.reqs[0] } : {}) })) },
      images: [...images, ...shots.map((x) => ({ file: `shots/${x.file}`, screen: `${x.screen} - ${x.state}`, viewport: x.viewport }))],
    }, null, 2));
    writePreview([]);
    const parentDesign = ctx.state.info.parent?.kind === "change" && ctx.state.info.parent.designSha ? ctx.ledger.getJson<Parameters<typeof diffDesigns>[0]>(ctx.state.info.parent.designSha) : undefined;
    const diff = ctx.state.info.parent?.kind === "change" ? diffDesigns(parentDesign, d) : undefined;
    const bundleOf = (round: number) => ctx.ledger.putJson({ design: designSha, demo: demoSha, round });
    const last = past[past.length - 1];
    // the latest decision counts only if it was on the card for this exact design
    if (last && last.artifactSha === bundleOf(past.length - 1)) {
      // a rejection sends the design back to be redrawn with the lead's reason (the design step reruns on its own); only after too many rounds does the run stop
      if (last.decision === "reject" && past.filter((d) => d.decision === "reject").length > MAX_DESIGN_REVISIONS) return { kind: "park", reason: `The design was sent back ${past.filter((d) => d.decision === "reject").length} times${reasonOf(last) ? `, last time: ${reasonOf(last)}` : ""}. Change the request or attach a design frame to show what you want, then start again.` };
      if (last.decision === "approve") {
        const g = await gate(ctx, "design-baseline", designBaseline, { ui: true, design, approval: { decision: "approved", by: last.by } });
        if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [failure("e1b", g.details)], signature: `e1b:${g.details.slice(0, 80)}` };
        return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, by: last.by }) }, data: { ui: true, screens: design.screens.length } };
      }
    }
    const bundle = bundleOf(past.length);
    // pictures of the demo, only when a person is about to look at it; best effort, never a reason to stop
    const shotsDir = join(previewDir, "shots");
    const taken = await captureDemo(demoFile, d.screens.map((sc) => ({ id: sc.id, route: sc.route, states: orderStates(sc.states ?? []) })), shotsDir);
    if (taken.shots.length) writePreview(taken.shots);
    if (taken.note) ctx.log(`design-baseline: ${taken.note}`);
    return { kind: "wait", card: { cardId: `design-${bundle.slice(0, 8)}`, kind: "design-approval", artifactSha: bundle, markdown: designCard(ctx.runId, design, bundle, { demo: demoFile, ...(diff ? { diff } : {}), shots: { dir: shotsDir, count: taken.shots.length, ...(taken.note ? { note: taken.note } : {}) } }) } };
  },
};

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
export function estimateCard(runId: string, hash: string, e: Estimate, b: Pick<Breakdown, "tasks">, extra: { gates: string[]; waivers: string[]; note?: string; diff?: { title: string; lines: string[] } }): string {
  const title = new Map(b.tasks.map((t) => [t.id, t.title]));
  const flagged = e.tasks.filter((t) => t.flagged);
  const list = (xs: string[], none: string) => (xs.length ? xs : [none]);
  return [
    `# Approve the estimate (E7)`, ``,
    `Run ${runId} · ${e.deliveryModel === "hitl" ? "HITL (supervisor + agents)" : "solely agentic"} · size ${e.band} · uncertainty ${e.uncertainty}`,
    extra.note ? `\n${extra.note}` : "", ``,
    ...(extra.diff ? [`## ${extra.diff.title}`, ...extra.diff.lines.map((l) => `- ${l}`), ``] : []),
    `## Anchors (check these first: every other task is sized against one)`,
    ...e.anchors.map((a) => `- ${a.taskId} ${title.get(a.taskId) ?? ""}: ${h(a.hours)}. ${a.reason}`), ``,
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
      note, diff: parentDiff(ctx, estimate, breakdown),
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
    const manifest = { team: files.team, client: files.client, teamSha256: sha256File(files.team), clientSha256: sha256File(files.client), estimateSha: outputOf(ctx.state, "estimate") };
    ctx.log(`estimate workbooks written:\n  team   ${files.team}\n  client ${files.client}`);
    return { kind: "done", outputs: { manifest: ctx.ledger.putJson(manifest) }, data: { team: files.team, client: files.client } };
  },
};
