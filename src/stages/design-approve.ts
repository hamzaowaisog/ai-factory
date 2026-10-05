// The design approval step (docs/estimates-design.md, "The pipeline"), moved out of estimate-approve.ts (the PR #11 re-review,
// item 14): it is the same step for an estimate, a build from a request and a design run.
//   design-baseline (E1b)  the approved mock and clickable demo are the baseline of a UI estimate, a build or a design
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { z } from "zod";
import type { Design, Failure, IntentBody, Spec } from "../contracts/index.js";
import { designBaseline } from "../design/gates.js";
import { diffDesigns } from "../design/diff.js";
import { buildDemo, frameDataUri } from "../design/demo.js";
import { designTokens } from "../design/tokens.js";
import type { DesignInventory } from "../design/inventory.js";
import { screenUi, uiFactors, type ScreenUi } from "../estimate/ui-complexity.js";
import { captureDemo, LAYOUT_FAULT, type LayoutIssue, type ShotResult, type Viewport } from "../design/screenshots.js";
import { failure } from "../gates/engine.js";
import type { RunState } from "../ledger/state.js";
import { Ledger } from "../ledger/ledger.js";
import { demoShotList, findPackage, nextVersion, type DesignPackage } from "../design/package.js";
import { ensurePackage } from "./design-export.js";
import { gate } from "./estimate.js";
import { listedFrames, MAX_DESIGN_REVISIONS } from "./design.js";
import type { ProjectConfig } from "../config/project.js";
import { currentPictures } from "../design/current-pages.js";
import { ESTIMATE_SOURCES, intentOf, specOf, type DesignSources, repoInventory } from "./design-inputs.js";
import { reworkCardLines } from "./design-rework.js";
import { lookKey, recordLook } from "../design/looks.js";
import { fieldOf } from "../design/refs/index.js";
import { outputOf, readOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { carriedLines, carries, settledBy } from "./gate-questions.js";


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

/** Pictures of the current pages (the app at the base commit), or why there are none. */
export interface CurrentShots { dir: string; count: number; note?: string }

const currentLines = (cur: CurrentPage[], look?: string[], shots?: CurrentShots): string[] => (cur.length || look?.length ? [
  `## Current vs proposed`,
  ...(look?.length ? [`Drawn in the app's own look, read from its styles and theme: ${look.join("; ")}.`] : []),
  ...cur.map((c) => `- ${c.title ? `${c.title}: ` : ""}${c.screen} (${c.size}). Current: ${c.found ? `${c.file} at ${c.route}${c.uses.length ? `, built from ${c.uses.slice(0, 8).join(", ")}` : ""}` : `${c.file} (not found in the repo: a new page after all?)`}. Proposed: the demo's ${c.screen}${c.proposed.length ? ` (${c.proposed.slice(0, 8).join(", ")})` : ""}.`),
  ...(cur.length && shots ? [shots.count
    ? `Pictures of the current pages: ${shots.count} in ${shots.dir} (the app at the base commit; Preview on the run page shows them beside the demo)${shots.note ? `; ${shots.note}` : ""}.`
    : `Pictures of the current pages: none (${shots.note ?? "not taken"}).`] : []),
  ``,
] : []);

export function designCard(runId: string, design: DesignT, hash: string, extra: { demo?: string; diff?: string[]; compare?: CompareCard; shots?: { dir: string; count: number; note?: string; issues?: LayoutIssue[] }; purpose?: DesignPurpose; refs?: { id: string; role: string; source: string }[]; current?: CurrentPage[]; look?: string[]; currentShots?: CurrentShots } = {}): string {
  return [
    ...CARD_HEAD[extra.purpose ?? "estimate"](runId),
    `Flow: ${design.flow}`, design.figmaUrl ? `Figma: ${design.figmaUrl}` : "",
    extra.demo ? `Clickable demo (open in a browser, walk every screen and state before approving): ${extra.demo}` : "",
    extra.shots?.count ? `Screenshots: ${extra.shots.count} in ${extra.shots.dir} (each screen and state at phone and desktop width, each screen on a tablet${design.theme?.mode === "auto" ? " and in dark mode" : ""})${extra.shots.note ? `; ${extra.shots.note}` : ""}` : extra.shots?.note ? `Screenshots: none (${extra.shots.note})` : "", ``,
    ...layoutLines(extra.shots?.issues ?? []),
    ...(extra.diff ? [`## Change from the approved design`, ...(extra.compare ? compareLines(extra.compare) : []), ...(extra.diff.length ? extra.diff.map((l) => `- ${l}`) : ["- no screen changed"]), ``] : []),
    ...reworkCardLines(design as never),
    ...currentLines(extra.current ?? [], extra.look, extra.currentShots),
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
  /**
   * Gate E1b failing on a design the design step already checked: another attempt of this step changes nothing, so the failures are
   * asked about (src/stages/gate-questions.ts); an answer settles one, and after the rounds of questions what is open is carried as an
   * open risk. No design, no approval or two screens with one id are never carried.
   */
  const baselineOpen = (ctx: StepContext, g: { passed: boolean; details: string; failures?: Failure[] }): { outcome: StepOutcome } | { risks: { openRisks?: string[] } } => {
    if (g.passed) return { risks: {} };
    const open = (g.failures ?? [failure("e1b", g.details)]).filter((f) => !settledBy(ctx.gateAnswers, f.message));
    if (!open.length) return { risks: {} };
    if (carries(ctx, open)) return { risks: { openRisks: carriedLines("gate E1b", open) } };
    return { outcome: { kind: "ask", reason: `The design is not ready (gate E1b): ${open.map((f) => f.message).join("; ")}`, failures: open } };
  };
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
        const e1b = baselineOpen(ctx, g);
        if ("outcome" in e1b) return e1b.outcome;
        return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, note: true, by: "with the estimate (E7)" }) }, data: { ui: true, note: true, screens: design.screens.length, ...e1b.risks } };
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
            const e1b = baselineOpen(ctx, g);
        if ("outcome" in e1b) return e1b.outcome;
            return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, note: true, by: last.by }) }, data: { ui: true, note: true, screens: design.screens.length, ...e1b.risks } };
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
      const writePreview = (shots: ShotResult["shots"], before: Set<string> = new Set(), current: { file: string; screen: string; viewport: Viewport }[] = []) => writeFileSync(join(previewDir, "preview.json"), JSON.stringify({
        site: { entry: "index.html", screens: d.screens.map((sc) => ({ path: `index.html#${sc.id}`, title: label(sc), ...(sc.reqs[0] ? { req: sc.reqs[0] } : {}) })) },
        images: [...images, ...current, ...shots.map((x) => ({ file: `shots/${x.file}`, screen: `${x.screen} - ${x.state}`, viewport: x.viewport, ...(before.has(x.file) ? { before: `before/${x.file}` } : {}) }))],
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
          const e1b = baselineOpen(ctx, g);
        if ("outcome" in e1b) return e1b.outcome;
          // remembered so the next projects are told to look different (best effort: never a reason to stop)
          if (d.theme && d.themeSource !== "repo") try { recordLook(lookKey(ctx.state.info.estimate?.projectName, ctx.runId), d.theme, undefined, undefined, fieldOf(spec.requirements.map((q) => q.ears).join("\n"))); } catch (e) { ctx.log(`design-baseline: look not recorded: ${(e as Error).message}`); }
          return { kind: "done", outputs: { baseline: ctx.ledger.putJson({ ui: true, design: designSha, by: last.by }) }, data: { ui: true, screens: design.screens.length, ...e1b.risks } };
        }
      }
      const bundle = bundleOf(past.length);
      // pictures of the demo, only when a person is about to look at it; best effort, never a reason to stop
      const shotsDir = join(previewDir, "shots");
      const taken = await captureDemo(demoFile, demoShotList(d.screens), shotsDir);
      // a change request: the approved version's pictures beside the new ones (the run page shows before / after)
      const compare = diff ? await beforePictures(ctx, previewDir, taken.shots.map((x) => x.file)) : undefined;
      // an existing app: its pages as they are today, beside the demo (PR #11 re-review, item 6)
      const existing = existingPages();
      const current = existing.current?.length ? await currentShots(ctx, existing.current, previewDir) : undefined;
      if (taken.shots.length || current?.images.length) writePreview(taken.shots, compare?.files, current?.images);
      if (taken.note) ctx.log(`design-baseline: ${taken.note}`);
      if (taken.issues?.length) ctx.log(`design-baseline: ${taken.issues.length} layout problem(s) in the demo, listed on the card`);
      return { kind: "wait", card: { cardId: `design-${bundle.slice(0, 8)}`, kind: "design-approval", artifactSha: bundle, markdown: designCard(ctx.runId, design, bundle, { purpose, demo: demoFile, ...existing, ...(current ? { currentShots: current.card } : {}), ...(ctx.state.info.references?.length ? { refs: ctx.state.info.references } : {}), ...(diff ? { diff } : {}), ...(compare ? { compare: compare.card } : {}), shots: { dir: shotsDir, count: taken.shots.length, ...(taken.note ? { note: taken.note } : {}), ...(taken.issues?.length ? { issues: taken.issues } : {}) } }) } };
    },
  };
}

/**
 * The existing app's changed pages as they are at the base commit, into `preview/current/` (best effort). Only where the
 * project set up design.capture, which runs its app on this machine with its consent (allowHost).
 */
async function currentShots(ctx: { state: RunState; project: ProjectConfig; ledger: { dir: string }; log: (m: string) => void }, pages: CurrentPage[], previewDir: string): Promise<{ images: { file: string; screen: string; viewport: Viewport }[]; card: CurrentShots }> {
  const dir = join(previewDir, "current");
  const cfg = ctx.project.design?.capture;
  const { repoPath, baseCommit } = ctx.state.info;
  if (!cfg) return { images: [], card: { dir, count: 0, note: "set design.capture in the project config to take them; it starts the app on this machine, so it is opt-in" } };
  if (!repoPath || !baseCommit) return { images: [], card: { dir, count: 0, note: "the run has no repo" } };
  const found = pages.filter((p) => p.found).map((p) => ({ name: `${p.title ?? p.screen} current`, route: p.route }));
  const got = await currentPictures({ repo: repoPath, base: baseCommit, cfg, pages: found, outDir: dir, tmpDir: join(ctx.ledger.dir, "tmp-current"), log: ctx.log });
  if (got.note) ctx.log(`design-baseline: current pages: ${got.note}`);
  const images = got.files.map((f) => ({ file: `current/${f}`, screen: f.replace(/-(phone|tablet|desktop)\.png$/, "").replace(/-/g, " "), viewport: (/-(phone|tablet|desktop)\.png$/.exec(f)?.[1] ?? "desktop") as Viewport }));
  return { images, card: { dir, count: got.files.length, ...(got.note ? { note: got.note } : {}) } };
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
