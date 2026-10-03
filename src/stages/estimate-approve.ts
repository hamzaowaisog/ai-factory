// Estimate mode, the human and file steps (docs/estimates-design.md, "The pipeline"):
//   design-baseline (E1b)  the approved mock and clickable demo are the baseline of a UI estimate
//   approve-estimate (E7)  a lead approves in a terminal, tied to the estimate's hash
//   export                 deterministic code writes the team and client workbooks, then lints them cell by cell
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { z } from "zod";
import type { Breakdown, Design, Estimate, IntentBody, Spec } from "../contracts/index.js";
import { designBaseline, FACTORY_APPROVER, leadApproval } from "../estimate/gates.js";
import { humanReview } from "../estimate/settings.js";
import { catalogueStatusText } from "../estimate/catalogue-status.js";
import { exportWorkbooks, type ExportInput } from "../estimate/export.js";
import { considerationsFrom } from "../estimate/considerations.js";
import { diffEstimates } from "../estimate/lineage.js";
import { diffDesigns } from "../design/diff.js";
import { buildDemo, frameDataUri } from "../design/demo.js";
import { designTokens } from "../design/tokens.js";
import type { DesignInventory } from "../design/inventory.js";
import { screenUi, uiFactors, type ScreenUi } from "../estimate/ui-complexity.js";
import { captureDemo, LAYOUT_FAULT, type LayoutIssue, type ShotResult, type Viewport } from "../design/screenshots.js";
import { gateLine, gateLog, waiversOf } from "../estimate/log.js";
import { loadWorkbook, lintWorkbook } from "../estimate/workbook-lint.js";
import { failure } from "../gates/engine.js";
import type { RunState } from "../ledger/state.js";
import { Ledger } from "../ledger/ledger.js";
import { demoShotList, findPackage, nextVersion, type DesignPackage } from "../design/package.js";
import { ensurePackage, exportRunPackage } from "./design-export.js";
import { writeDesignBook } from "../design/export.js";
import { hashJson } from "../util/hash.js";
import type { ClarifyResult } from "./clarify.js";
import { gate, settingsOf } from "./estimate.js";
import { listedFrames, MAX_DESIGN_REVISIONS } from "./design.js";
import { ESTIMATE_SOURCES, intentOf, specOf, type DesignSources, repoInventory } from "./design-inputs.js";
import { reworkCardLines } from "./design-rework.js";
import { lookKey, recordLook } from "../design/looks.js";
import { fieldOf } from "../design/refs/index.js";
import { header, outputOf, readOutput, requireOutput, type StepDef, type StepOutcome } from "./framework.js";

type Intent = z.infer<typeof IntentBody>;
type DesignT = z.infer<typeof Design>;

const decisionsOn = (state: RunState, prefix: string) => state.decisions.filter((d) => d.cardId.startsWith(prefix));
const reasonOf = (d: unknown): string => String((d as { reason?: string }).reason ?? "").trim();

// ---------- E1b: design baseline ----------

/** What the screenshots found wrong with the drawn pages, for the lead to see before approving. */
/** The design references on the card: how each was used or why it was set aside, and what a screen still lacks of a layout reference. None without references. */
export function refCardLines(design: DesignT, refs: { id: string; role: string; source: string }[] = []): string[] {
  const use = design.refUse ?? [];
  if (!use.length && !refs.length) return [];
  const ids = [...new Set([...refs.map((r) => r.id), ...use.map((u) => u.id)])];
  return [
    `## Design references`,
    ...ids.map((id) => {
      const r = refs.find((x) => x.id === id), u = use.find((x) => x.id === id);
      const shaped = design.screens.filter((x) => (x as { refs?: string[] }).refs?.includes(id)).map((x) => x.id);
      return `- ${id}${r ? ` (${r.role}) ${r.source.slice(0, 80)}` : ""}: ${u ? `${u.use === "used" ? "used" : "set aside"}, ${u.how}` : "not listed by the design"}${shaped.length ? `; shaped ${shaped.join(", ")}` : ""}`;
    }),
    ...(design.restyle ? ["- The app is restyled to the match reference's look (chosen on the questions card): a design-system change, every existing page's look changes."] : []),
    ...(design.refLayout ?? []).map((g) => `- ${g.screen} still differs from ${g.ref}:${g.nav ? ` not reached by ${g.nav}` : ""}${g.nav && g.missing.length ? ";" : ""}${g.missing.length ? ` no ${g.missing.join(", ")}` : ""}`),
    ``,
  ];
}

function layoutLines(issues: LayoutIssue[]): string[] {
  if (!issues.length) return [];
  const shown = issues.slice(0, 8).map((f) => `- ${f.screen}, ${f.state}, ${f.viewport}: "${f.text}" ${LAYOUT_FAULT[f.kind]}`);
  return [`## Layout problems in the demo (${issues.length})`, ...shown, ...(issues.length > shown.length ? [`- and ${issues.length - shown.length} more`] : []), ``];
}

/** A screen's counted UI on the card: what the estimate will size it from. */
const uiLine = (u: ScreenUi): string => `; UI: ${u.level ?? "not counted"}${u.drivers.length ? ` (${u.drivers.slice(0, 3).join("; ")})` : ""}`;

/** What the approved design is for: the estimate sizes from it, a build builds it, a design-only run keeps it for later. */
export type DesignPurpose = "estimate" | "build" | "design";

const CARD_HEAD: Record<DesignPurpose, (runId: string) => string[]> = {
  estimate: (runId) => [`# Approve the design baseline (E1b)`, ``, `Run ${runId}. The estimate of a UI request stands on the approved mock and clickable demo: screen counts, states and flows come from it.`, ``],
  build: (runId) => [`# Approve the design`, ``, `Run ${runId}. The build follows the approved mock and clickable demo: its screens, states, sample content and look are what gets built.`, ``],
  design: (runId) => [`# Approve the design`, ``, `Run ${runId}, design only. Approving keeps this mock, clickable demo and look; nothing is sized or built yet. Afterwards an estimate sizes it (factory estimate --from-design ${runId}) and a build follows it (factory start --project <name> --from-design ${runId}) without drawing it again.`, ``],
};

/** The approved version a change request changes, on its card: what it becomes and how many pictures sit side by side. */
export interface CompareCard { line: string; was: number; becomes: number; runId: string; pairs: number; dir?: string; note?: string }

const compareLines = (c: CompareCard): string[] => [
  `Version: this change becomes v${c.becomes} of design ${c.line} (v${c.was} was approved in ${c.runId}).`,
  c.pairs ? `Side by side: ${c.pairs} picture(s) of v${c.was} next to the new ones (Preview on the run page, before / after)${c.dir ? `; the earlier pictures are in ${c.dir}` : ""}.` : `Side by side: none${c.note ? ` (${c.note})` : ""}.`, ``,
];

/** An existing app's page next to the screen that changes it, on the card (a tweak, a reuse or a design-system screen). */
export interface CurrentPage { screen: string; title?: string; size: string; route: string; file: string; found: boolean; uses: string[]; proposed: string[] }

/** The existing app's pages that the design changes, each beside the proposed screen, and the look the demo was drawn in. */
export function currentPages(design: DesignT, inv: Pick<DesignInventory, "pages"> | undefined): CurrentPage[] {
  const pages = inv?.pages ?? [];
  return design.screens.flatMap((s) => {
    const x = s as { size?: string; mock?: { title?: string; blocks?: { type?: string }[] } };
    if (!x.size || x.size === "new") return [];
    const page = pages.find((p) => p.path === s.file) ?? pages.find((p) => p.route === s.route);
    const proposed = [...new Set((x.mock?.blocks ?? []).map((b) => b.type).filter((b): b is string => !!b))];
    return [{ screen: s.id, ...(x.mock?.title ? { title: x.mock.title } : {}), size: x.size, route: page?.route ?? s.route, file: page?.path ?? s.file, found: !!page, uses: page?.layout ?? [], proposed }];
  });
}

const currentLines = (cur: CurrentPage[], look?: string[]): string[] => (cur.length || look?.length ? [
  `## Current vs proposed`,
  ...(look?.length ? [`Drawn in the app's own look, read from its stylesheets: ${look.join("; ")}.`] : []),
  ...cur.map((c) => `- ${c.title ? `${c.title}: ` : ""}${c.screen} (${c.size}). Current: ${c.found ? `${c.file} at ${c.route}${c.uses.length ? `, built from ${c.uses.slice(0, 8).join(", ")}` : ""}` : `${c.file} (not found in the repo: a new page after all?)`}. Proposed: the demo's ${c.screen}${c.proposed.length ? ` (${c.proposed.slice(0, 8).join(", ")})` : ""}.`),
  ``,
] : []);

export function designCard(runId: string, design: DesignT, hash: string, extra: { demo?: string; diff?: string[]; compare?: CompareCard; shots?: { dir: string; count: number; note?: string; issues?: LayoutIssue[] }; purpose?: DesignPurpose; refs?: { id: string; role: string; source: string }[]; current?: CurrentPage[]; look?: string[] } = {}): string {
  return [
    ...CARD_HEAD[extra.purpose ?? "estimate"](runId),
    `Flow: ${design.flow}`, design.figmaUrl ? `Figma: ${design.figmaUrl}` : "",
    extra.demo ? `Clickable demo (open in a browser, walk every screen and state before approving): ${extra.demo}` : "",
    extra.shots?.count ? `Screenshots: ${extra.shots.count} in ${extra.shots.dir} (each screen and state at phone and desktop width, each screen on a tablet${design.theme?.mode === "auto" ? " and in dark mode" : ""})${extra.shots.note ? `; ${extra.shots.note}` : ""}` : extra.shots?.note ? `Screenshots: none (${extra.shots.note})` : "", ``,
    ...layoutLines(extra.shots?.issues ?? []),
    ...(extra.diff ? [`## Change from the approved design`, ...(extra.compare ? compareLines(extra.compare) : []), ...(extra.diff.length ? extra.diff.map((l) => `- ${l}`) : ["- no screen changed"]), ``] : []),
    ...reworkCardLines(design as never),
    ...currentLines(extra.current ?? [], extra.look),
    `Screens (${design.screens.length}):`,
    ...design.screens.map((s) => { const x = s as typeof s & { states?: string[]; size?: string; mock?: { title: string } }; const title = x.mock?.title ? `${x.mock.title}: ` : ""; return `- ${title}${s.id} ${s.route} (${s.file}) -> ${s.reqs.join(", ") || "NO REQUIREMENT"}${x.size ? `; ${x.size}` : ""}${x.states?.length ? `; states: ${x.states.join(", ")}` : ""}${(s as { refs?: string[] }).refs?.length ? `; from ${(s as { refs?: string[] }).refs!.join(", ")}` : ""}${uiLine(screenUi(s as never))}`; }), ``,
    ...refCardLines(design, extra.refs),
    ...((f) => (f.length ? [`UI across the product (the estimate sizes every UI task with these): ${f.join("; ")}`, ``] : []))(uiFactors(design as never)),
    design.mapping.unmappedReqs.length ? `Requirements with no screen: ${design.mapping.unmappedReqs.join(", ")}` : "Every requirement has a screen.",
    design.mapping.orphanScreens.length ? `Screens with no requirement: ${design.mapping.orphanScreens.join(", ")}` : "Every screen links to a requirement.", ``,
    `Approve: factory approve ${runId} ${hash.slice(0, 8)}`,
    `Reject:  factory reject ${runId} ${hash.slice(0, 8)} --reason "why"   (only the parts you point at are fixed, or the whole design is redrawn if that is what it needs; you get a new card and the run does not stop)`, ``, `Card hash: ${hash.slice(0, 8)}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

/**
 * The design approval for any mode (E1b in the estimate). `src` names the steps it reads and `purpose`
 * picks the card's wording; the key, version and inputs are the same for every mode.
 */
export function makeDesignApprovalStep(opts: { sources?: DesignSources; purpose?: DesignPurpose } = {}): StepDef {
  const src = opts.sources ?? ESTIMATE_SOURCES;
  const purpose = opts.purpose ?? "estimate";
  return {
    key: "design-baseline", stage: "design", templateVersion: "1",
    inputs: (s, l) => {
      if (s.steps.get(src.spec)?.status !== "completed") return undefined;
      const intake = s.steps.get(src.intent);
      const ui = intake?.status === "completed" ? !!l.getJson<Intent>(intake.outputs[0]!)?.touchesUi : false;
      return { spec: s.steps.get(src.spec)!.outputs[0], ui, design: outputOf(s, "design"), decisions: decisionsOn(s, "design-").length };
    },
    async run(ctx): Promise<StepOutcome> {
      const intent = intentOf<Intent>(ctx.state, ctx.ledger, src);
      if (!intent.touchesUi) {
        const g = await gate(ctx, "design-baseline", designBaseline, { ui: false });
        return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: false, gate: g.details }) }, data: { ui: false } };
      }
      const design = readOutput<DesignT & { skipped?: boolean }>(ctx.state, ctx.ledger, "design");
      if (!design || design.skipped) {
        return { kind: "park", reason: purpose === "estimate"
          ? "This request has UI, so its estimate needs an approved mock and clickable demo (gate E1b), and the design step has not produced one for this run. Produce the design, then resume."
          : "This request has UI, and the design step has not produced a mock and clickable demo for this run. Produce the design, then resume." };
      }
      const designSha = outputOf(ctx.state, "design")!;
      // a small fix's text note in an estimate: no demo and no card of its own; the estimate card shows it and its approval covers it
      if (design.note && purpose === "estimate") {
        const g = await gate(ctx, "design-baseline", designBaseline, { ui: true, design, note: true });
        if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [failure("e1b", g.details)], signature: `e1b:${g.details.slice(0, 80)}` };
        return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, note: true, by: "with the estimate (E7)" }) }, data: { ui: true, note: true, screens: design.screens.length } };
      }
      const past = decisionsOn(ctx.state, "design-");
      // a build or a design-only run has no estimate to approve the note with (PR #11 re-review, blocker 1): a short card of its own
      if (design.note) {
        const noteBundle = (round: number) => ctx.ledger.putJson({ design: designSha, note: true, round });
        const last = past[past.length - 1];
        if (last && last.artifactSha === noteBundle(past.length - 1)) {
          const rejects = past.filter((x) => x.decision === "reject").length;
          if (last.decision === "reject" && rejects > MAX_DESIGN_REVISIONS) return { kind: "park", reason: `The design note was sent back ${rejects} times${reasonOf(last) ? `, last time: ${reasonOf(last)}` : ""}. Change the request to show what you want, then start again.` };
          if (last.decision === "approve") {
            const g = await gate(ctx, "design-baseline", designBaseline, { ui: true, design, approval: { decision: "approved", by: last.by } });
            if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [failure("e1b", g.details)], signature: `e1b:${g.details.slice(0, 80)}` };
            return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, note: true, by: last.by }) }, data: { ui: true, note: true, screens: design.screens.length } };
          }
        }
        const bundle = noteBundle(past.length);
        return { kind: "wait", card: { cardId: `design-${bundle.slice(0, 8)}`, kind: "design-approval", artifactSha: bundle, markdown: [...CARD_HEAD[purpose](ctx.runId), ...designNoteLines(design, purpose)].join("\n") } };
      }
      // the demo is drawn from the design, the requirement text and the attached frames; the approval is tied to that exact page
      const spec = specOf<Spec>(ctx.state, ctx.ledger, src);
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
      // an existing app: each page the design changes beside the proposed screen, and the look its demo is drawn in
      const existingPages = () => {
        const inv = repoInventory(ctx, src);
        const current = d.themeSource === "repo" ? currentPages(d, inv) : [];
        const look = d.themeSource === "repo" && inv?.look ? inv.look.from : undefined;
        return { ...(current.length ? { current } : {}), ...(look ? { look } : {}) };
      };
      // a lead knows pages by their titles; two pages with the same title also show the route so they stay apart
      const named = (sc: (typeof d.screens)[number]) => sc.mock?.title?.trim();
      const label = (sc: (typeof d.screens)[number]) => { const t = named(sc); return !t ? `${sc.id} ${sc.route}` : d.screens.filter((o) => named(o) === t).length > 1 ? `${t} (${sc.route})` : t; };
      const html = buildDemo({
        title: ctx.state.info.estimate?.projectName ?? ctx.runId, flow: d.flow, screens: d.screens.map((s) => ({ ...s, states: s.states ?? [], size: s.size ?? "new", frames: s.frames ?? [] })),
        requirements: Object.fromEntries(spec.requirements.map((r) => [r.id, r.ears])), noScreen: d.noScreen ?? [], frames, ...(d.theme ? { theme: d.theme } : {}), ...(d.apps?.length ? { apps: d.apps } : {}),
        ...(d.switcher ? { switcher: d.switcher } : {}), ...(d.locale ? { locale: d.locale } : {}),
      });
      const demoSha = ctx.ledger.putArtifact(html);
      const demoFile = join(ctx.ledger.dir, "design-demo.html");
      writeFileSync(demoFile, html);
      // the same page for `factory ui` (Run: Preview): the walkable demo, plus each attached frame against the screen that cites it
      const previewDir = join(ctx.ledger.dir, "preview");
      mkdirSync(join(previewDir, "frames"), { recursive: true });
      writeFileSync(join(previewDir, "index.html"), html);
      // the look as design tokens, as the build will get them (a repo's own look has none: the build keeps the repo's)
      if (d.theme && d.themeSource !== "repo") {
        const tk = designTokens(d.theme);
        writeFileSync(join(previewDir, "tokens.css"), tk.css);
        writeFileSync(join(previewDir, "tokens.json"), JSON.stringify({ ...tk, css: undefined }, null, 2));
      }
      const images: { file: string; screen: string; req?: string; viewport: Viewport }[] = [];
      for (const sc of d.screens) for (const fid of sc.frames ?? []) {
        const f = frames[fid];
        if (!f?.dataUri) continue;
        copyFileSync(join(ctx.ledger.dir, "attachments", "frames", basename(f.name)), join(previewDir, "frames", basename(f.name)));
        images.push({ file: `frames/${basename(f.name)}`, screen: label(sc), ...(sc.reqs[0] ? { req: sc.reqs[0] } : {}), viewport: "desktop" });
      }
      const writePreview = (shots: ShotResult["shots"], before: Set<string> = new Set()) => writeFileSync(join(previewDir, "preview.json"), JSON.stringify({
        site: { entry: "index.html", screens: d.screens.map((sc) => ({ path: `index.html#${sc.id}`, title: label(sc), ...(sc.reqs[0] ? { req: sc.reqs[0] } : {}) })) },
        images: [...images, ...shots.map((x) => ({ file: `shots/${x.file}`, screen: `${x.screen} - ${x.state}`, viewport: x.viewport, ...(before.has(x.file) ? { before: `before/${x.file}` } : {}) }))],
      }, null, 2));
      writePreview([]);
      const parentDesign = ctx.state.info.parent?.kind === "change" && ctx.state.info.parent.designSha ? ctx.ledger.getJson<Parameters<typeof diffDesigns>[0]>(ctx.state.info.parent.designSha) : undefined;
      const diff = ctx.state.info.parent?.kind === "change" ? diffDesigns(parentDesign, d) : undefined;
      const bundleOf = (round: number) => ctx.ledger.putJson({ design: designSha, demo: demoSha, round });
      const last = past[past.length - 1];
      // the latest decision counts only if it was on the card for this exact design
      if (last && last.artifactSha === bundleOf(past.length - 1)) {
        // a rejection sends the design back with the lead's reason (the design step reruns on its own and fixes or redraws); only after too many rounds does the run stop
        if (last.decision === "reject" && past.filter((d) => d.decision === "reject").length > MAX_DESIGN_REVISIONS) return { kind: "park", reason: `The design was sent back ${past.filter((d) => d.decision === "reject").length} times${reasonOf(last) ? `, last time: ${reasonOf(last)}` : ""}. Change the request or attach a design frame to show what you want, then start again.` };
        if (last.decision === "approve") {
          const g = await gate(ctx, "design-baseline", designBaseline, { ui: true, design, approval: { decision: "approved", by: last.by } });
          if (!g.passed) return { kind: "fail", category: "other", failures: g.failures ?? [failure("e1b", g.details)], signature: `e1b:${g.details.slice(0, 80)}` };
          // remembered so the next projects are told to look different (best effort: never a reason to stop)
          if (d.theme && d.themeSource !== "repo") try { recordLook(lookKey(ctx.state.info.estimate?.projectName, ctx.runId), d.theme, undefined, undefined, fieldOf(spec.requirements.map((q) => q.ears).join("\n"))); } catch (e) { ctx.log(`design-baseline: look not recorded: ${(e as Error).message}`); }
          return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, by: last.by }) }, data: { ui: true, screens: design.screens.length } };
        }
      }
      const bundle = bundleOf(past.length);
      // pictures of the demo, only when a person is about to look at it; best effort, never a reason to stop
      const shotsDir = join(previewDir, "shots");
      const taken = await captureDemo(demoFile, demoShotList(d.screens), shotsDir);
      // a change request: the approved version's pictures beside the new ones (the run page shows before / after)
      const compare = diff ? await beforePictures(ctx, previewDir, taken.shots.map((x) => x.file)) : undefined;
      if (taken.shots.length) writePreview(taken.shots, compare?.files);
      if (taken.note) ctx.log(`design-baseline: ${taken.note}`);
      if (taken.issues?.length) ctx.log(`design-baseline: ${taken.issues.length} layout problem(s) in the demo, listed on the card`);
      return { kind: "wait", card: { cardId: `design-${bundle.slice(0, 8)}`, kind: "design-approval", artifactSha: bundle, markdown: designCard(ctx.runId, design, bundle, { purpose, demo: demoFile, ...existingPages(), ...(ctx.state.info.references?.length ? { refs: ctx.state.info.references } : {}), ...(diff ? { diff } : {}), ...(compare ? { compare: compare.card } : {}), shots: { dir: shotsDir, count: taken.shots.length, ...(taken.note ? { note: taken.note } : {}), ...(taken.issues?.length ? { issues: taken.issues } : {}) } }) } };
    },
  };
}

/**
 * The approved version's pictures next to a change request's (best effort): its package is found, or written
 * when the earlier run has none yet, and each of its pictures with the same name as a new one is copied into
 * `preview/before/`. The card says what version the change becomes.
 */
async function beforePictures(ctx: { state: RunState; log: (m: string) => void }, previewDir: string, shots: string[]): Promise<{ files: Set<string>; card: CompareCard } | undefined> {
  const p = ctx.state.info.parent;
  if (p?.kind !== "change" || !p.designSha) return undefined;
  const project = ctx.state.info.project;
  let pkg: DesignPackage | undefined;
  try { pkg = findPackage(project, p.designSha) ?? (Ledger.exists(p.runId) ? await ensurePackage(p.runId, ctx.log) : undefined); } catch (e) { ctx.log(`design-baseline: the approved version's package could not be read: ${(e as Error).message}`); }
  if (!pkg) return { files: new Set(), card: { line: p.runId, was: 1, becomes: 2, runId: p.runId, pairs: 0, note: "the approved version has no pictures" } };
  const files = new Set<string>();
  const dir = join(previewDir, "before");
  rmSync(dir, { recursive: true, force: true });
  for (const f of shots) {
    const from = join(pkg.dir, "shots", f);
    if (!existsSync(from)) continue;
    mkdirSync(dir, { recursive: true });
    copyFileSync(from, join(dir, f));
    files.add(f);
  }
  const m = pkg.manifest;
  return { files, card: { line: m.line, was: m.version, becomes: Math.max(nextVersion(project, m.line), m.version + 1), runId: m.run.id, pairs: files.size, ...(files.size ? { dir: join(pkg.dir, "shots") } : { note: m.shots.length ? "no picture of the same screen and state" : m.shotsNote ?? "the approved version has no pictures" }) } };
}

export const designBaselineStep: StepDef = makeDesignApprovalStep();

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
/** A small fix's design note on the estimate card: each page it touches and what changes there. */
export function designNoteLines(d: { flow: string; screens: { id: string; route: string; file: string; reqs: string[]; size?: string; change?: string }[]; noScreen?: { req: string; reason: string }[] } | undefined, purpose: DesignPurpose = "estimate"): string[] {
  if (!d) return [];
  return [
    purpose === "estimate"
      ? `## Design note (a small change to existing pages: no demo is drawn, and approving the estimate approves this note)`
      : `## Design note (a small change to existing pages: no demo is drawn; approve this note, or reject it with the reason)`,
    `Flow: ${d.flow}`,
    ...d.screens.map((s) => `- ${s.id} ${s.route} (${s.file}; ${s.size ?? "tweak"}) -> ${s.reqs.join(", ")}: ${s.change ?? ""}`),
    ...(d.noScreen ?? []).map((n) => `- ${n.req} needs no page: ${n.reason}`),
    purpose === "estimate" ? `If the note is wrong, reject with the reason; the next estimate run draws it again.` : `If the note is wrong, reject with the reason; the design step writes it again.`, ``,
  ];
}

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
