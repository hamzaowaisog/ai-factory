// The scaffold of a run (docs/estimates-design.md, "Kit and scaffold"): which UI target the approved design is built in, and the
// files the stub commit writes for it. Deterministic, no model: the plan computes it to put the design-system task first and the
// containers in the screen tasks' scopes, the stub commit writes it, and implement keeps the agents off the files it owns.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { DesignBody } from "../contracts/artifacts.js";
import type { ProjectConfig } from "../config/project.js";
import { designTag } from "../design/export.js";
import { findPackage, packageForRun, type DesignPackage } from "../design/package.js";
import { gitSource, type FileSource } from "../design/source.js";
import { detectUiTarget, isKitTarget, loadKit, resolveUiTarget, scaffold, scaffoldSummary, type KitTarget, type ScaffoldLayout, type TargetGuess, type UiTarget } from "../design/kit/index.js";
import type { RunState } from "../ledger/state.js";
import { HUMAN_WRITER, type Ledger } from "../ledger/ledger.js";
import { approvedDesignFor } from "./design-inputs.js";
import { isEmptyTree } from "../config/greenfield.js";
import { readOutput } from "./framework.js";

type Design = z.infer<typeof DesignBody>;
type Screen = Design["screens"][number];

export interface RunTarget {
  /** the target the run's web apps are built in: a kit target, or "repo" (the repo's own components, no scaffold) */
  target: UiTarget;
  source: "config" | "run" | "detected" | "default" | "phone" | "none";
  /** what detection found in the repo */
  detected: TargetGuess;
  /** the app ids built with the kit (empty: the design has no apps, so all of it) */
  apps: string[];
  /** apps built with the repo's own components (a phone app, an app set to "repo") */
  repoApps: string[];
}

/** The repo at the run's base commit, or undefined for a run without one (a fresh app). */
export function runSource(state: RunState): FileSource | undefined {
  const { repoPath, baseCommit } = state.info;
  return repoPath && baseCommit ? gitSource(repoPath, baseCommit) : undefined;
}

/**
 * The UI target of a design in a repo: per app, from the project's setting, the run's, detection, then next-shadcn for a new app.
 * An existing repo that detection cannot place keeps its own components until design.uiTarget or --ui-target says otherwise.
 */
export function targetForRun(o: { design: Pick<Design, "apps">; config?: ProjectConfig["design"]; run?: UiTarget; src?: FileSource }): RunTarget {
  // an empty repo (a new product, greenfield) is a fresh app too: next-shadcn by default, like a design with no repo
  const empty = !!o.src && isEmptyTree(o.src.list());
  const src = empty ? undefined : o.src;
  const detected: TargetGuess = src ? detectUiTarget(src) : { why: empty ? "an empty repo: a fresh app" : "no repo: a fresh app" };
  const apps = o.design.apps?.length ? o.design.apps : [undefined];
  const per = apps.map((app) => {
    const r = resolveUiTarget({ ...(app ? { app } : {}), ...(o.config ? { config: o.config } : {}), ...(o.run ? { run: o.run } : {}), detected });
    // an existing repo whose stack nothing shows is not given a new app unasked: its own components, until a target is set
    return { id: app?.id ?? "", ...(src && r.source === "default" ? { target: "repo" as const, source: r.source } : r) };
  });
  // one kit target per run: the first web app's; an app set to the other kit is built with the repo's own components
  const first = per.find((p) => isKitTarget(p.target));
  if (!first) return { target: "repo", source: per[0]?.source ?? "none", detected, apps: [], repoApps: per.map((p) => p.id).filter(Boolean) };
  const on = per.filter((p) => p.target === first.target);
  return { target: first.target, source: first.source, detected, apps: on.map((p) => p.id).filter(Boolean), repoApps: per.filter((p) => p.target !== first.target).map((p) => p.id).filter(Boolean) };
}

/** A change request's screens: the ones added or changed since the design it changes, and the ones it removed. */
export function changedScreens(before: Pick<Design, "screens"> | undefined, after: Pick<Design, "screens">): { changed: string[]; removed: string[] } | undefined {
  if (!before) return undefined;
  const was = new Map(before.screens.map((s) => [s.id, JSON.stringify(s)]));
  const now = new Set(after.screens.map((s) => s.id));
  return {
    changed: after.screens.filter((s: Screen) => was.get(s.id) !== JSON.stringify(s)).map((s) => s.id),
    removed: before.screens.map((s) => s.id).filter((id) => !now.has(id)),
  };
}

/** The design the package changes (its previous version), read from the store. */
function previousDesign(project: string, pkg: DesignPackage | undefined): Design | undefined {
  const prev = pkg?.manifest.previous;
  const p = prev ? findPackage(project, prev.designSha) : undefined;
  const f = p ? join(p.dir, "design.json") : undefined;
  return f && existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Design) : undefined;
}

export interface RunScaffold extends RunTarget {
  /** undefined for the repo target */
  layout?: ScaffoldLayout;
  /** a change request: only these screens are planned and written again */
  changed?: string[];
}

/**
 * The scaffold of a run's approved design. `pkg` names the version (the tag every generated file starts with, and for a change
 * request the version it changes); without one the design's sha stands in.
 */
export function scaffoldForRun(o: { state: RunState; project: ProjectConfig; design: Design; designSha: string; pkg?: DesignPackage; src?: FileSource }): RunScaffold {
  const src = o.src ?? runSource(o.state);
  const t = targetForRun({ design: o.design, config: o.project.design, ...(o.state.info.uiTarget ? { run: o.state.info.uiTarget } : {}), ...(src ? { src } : {}) });
  if (!isKitTarget(t.target)) return t;
  const diff = changedScreens(previousDesign(o.project.project, o.pkg), o.design);
  const tag = o.pkg ? designTag(o.pkg) : `ai-factory design ${o.designSha.slice(0, 12)}`;
  const layout = scaffold({
    design: o.design, kit: loadKit(), target: t.target as KitTarget,
    product: o.state.info.estimate?.projectName ?? o.design.apps?.[0]?.name ?? o.project.project, tag,
    ...(src ? { src } : {}),
    ...(t.detected.target === t.target && t.detected.root !== undefined ? { root: t.detected.root, alias: !!t.detected.alias } : {}),
    ...(diff ? { changed: diff.changed, removed: diff.removed } : {}),
    ...(t.apps.length ? { apps: t.apps } : {}),
  });
  return { ...t, layout, ...(diff ? { changed: diff.changed } : {}) };
}

/** The scaffold as the plan sees it: the design-system task's files and to-dos, and per screen the container its task fills in. */
export function scaffoldForPlan(s: RunScaffold): unknown {
  const l = s.layout!;
  return {
    target: s.target, kit: `${l.kit.id} ${l.kit.version}`, sourceRoot: l.root || ".", freshApp: l.fresh,
    designSystemTask: { fileScope: l.designSystem.files, todo: l.designSystem.todo },
    screens: l.screens.filter((x) => !s.changed || s.changed.includes(x.id)).map((x) => ({ id: x.id, title: x.title, route: x.route, container: x.container, page: x.page })),
    ...(l.inPlace.length ? { changeInPlace: l.inPlace.filter((x) => !s.changed || s.changed.includes(x.id)).map((x) => ({ ...x, todo: "change the app's existing page in place to match the approved design; no new page, no new frame" })) } : {}),
    ...(l.removed.length ? { removedScreens: l.removed } : {}),
    generatedByTheFactory: l.protected.length,
  };
}

/** Code checks on a plan against the scaffold: the design-system task (when it has files) comes first, each planned screen's container is in a task's scope, and each screen changed in place has its page in one. */
export function checkPlanScaffold(plan: { tasks: { id: string; fileScope: string[] }[] }, s: RunScaffold): string[] {
  const l = s.layout;
  if (!l) return [];
  const inScope = (t: { fileScope: string[] }, p: string) => t.fileScope.some((g) => g === p || (g.includes("*") && p.startsWith(g.replace(/\*.*$/, ""))));
  const out: string[] = [];
  const first = plan.tasks[0];
  const missingDs = first ? l.designSystem.files.filter((f) => !inScope(first, f)) : l.designSystem.files;
  if (missingDs.length) out.push(`The first task must be the design-system task: its file scope must include ${missingDs.join(", ")}`);
  for (const x of l.screens.filter((x) => !s.changed || s.changed.includes(x.id))) {
    if (!plan.tasks.some((t) => inScope(t, x.container))) out.push(`Screen ${x.id} (${x.route}): no task has its container ${x.container} in scope`);
  }
  for (const x of l.inPlace.filter((x) => x.file && (!s.changed || s.changed.includes(x.id)))) {
    if (!plan.tasks.some((t) => inScope(t, x.file!))) out.push(`Screen ${x.id} (${x.route}, ${x.size}): no task has its existing page ${x.file} in scope`);
  }
  const owned = new Set(l.protected);
  for (const t of plan.tasks) for (const g of t.fileScope) if (owned.has(g)) out.push(`${t.id} lists ${g}, a file the factory generates from the approved design: change the container instead`);
  return out;
}

/**
 * The scaffold of the design a run builds, or undefined: no approved design, a skipped one, or one that cannot be scaffolded
 * (logged; the build goes on as before, the model writing each screen from its brief). The package is the one the stub commit
 * adds; the plan passes the one already in the store, if any (only the tag in the files' first line can differ).
 */
export function scaffoldOfRun(ctx: { state: RunState; ledger: Ledger; project: ProjectConfig; log: (m: string) => void }, pkg?: DesignPackage | "store"): RunScaffold | undefined {
  const approved = approvedDesignFor<Design & { skipped?: boolean }>(ctx.state, ctx.ledger);
  if (!approved || approved.design.skipped || !approved.design.screens?.length) return undefined;
  try {
    const p = pkg === "store" ? packageForRun({ ...ctx.state.info, project: ctx.project.project }, approved.sha) : pkg;
    return scaffoldForRun({ state: ctx.state, project: ctx.project, design: approved.design, designSha: approved.sha, ...(p ? { pkg: p } : {}) });
  } catch (e) {
    ctx.log(`scaffold: not generated (${(e as Error).message}); the screens are built from their briefs`);
    return undefined;
  }
}

/** The approved design as gate B7 sees it once the pages are generated: each screen's file is its container (the page is the factory's). */
export function designForScopeGate<T extends { screens: { id: string; file?: string }[] }>(design: T, s: RunScaffold | undefined): T {
  const l = s?.layout;
  if (!l) return design;
  const by = new Map(l.screens.map((x) => [x.id, x.container]));
  return { ...design, screens: design.screens.map((x) => (by.has(x.id) ? { ...x, file: by.get(x.id) } : x)) };
}

/** What the stub commit records of the scaffold it wrote (the ledger's `scaffold` output of stub-commit; the file texts are in the commit). */
export interface ScaffoldRecord {
  target: UiTarget; source: RunTarget["source"]; why: string;
  kit: { id: string; version: string }; root: string; fresh: boolean;
  /** the files the commit wrote; kept: the repo's own, left as they were */
  written: string[]; kept: string[];
  protected: string[];
  screens: ScaffoldLayout["screens"]; removed: string[];
  designSystem: ScaffoldLayout["designSystem"]; notes: string[];
  summary: string;
  changed?: string[];
  commit?: string;
}

/** A scaffold for the CLI and the UI: every file with its owner, without the texts. */
export interface ScaffoldView {
  target: UiTarget; source: RunTarget["source"]; why: string; apps: string[]; repoApps: string[];
  kit?: { id: string; version: string }; root?: string; fresh?: boolean;
  files: { path: string; owner: string; regenerate: boolean }[];
  kept: string[]; screens: ScaffoldLayout["screens"]; removed: string[]; designSystem?: ScaffoldLayout["designSystem"]; notes: string[];
  changed?: string[];
  /** the build already wrote it: the stub commit's record */
  built?: { commit?: string; written: number };
  summary?: string;
}

export function scaffoldView(s: RunScaffold, built?: ScaffoldRecord): ScaffoldView {
  const l = s.layout;
  return {
    target: s.target, source: s.source, why: s.detected.why, apps: s.apps, repoApps: s.repoApps,
    ...(l ? { kit: l.kit, root: l.root, fresh: l.fresh, designSystem: l.designSystem, summary: scaffoldSummary(l) } : {}),
    files: (l?.files ?? []).map((f) => ({ path: f.path, owner: f.owner, regenerate: f.regenerate })),
    kept: l?.kept ?? [], screens: l?.screens ?? [], removed: l?.removed ?? [], notes: l?.notes ?? [],
    ...(s.changed ? { changed: s.changed } : {}),
    ...(built ? { built: { ...(built.commit ? { commit: built.commit } : {}), written: built.written.length } } : {}),
  };
}

/**
 * The scaffold of a run's approved design, for `factory design scaffold` and the UI: the one the build wrote is reported with it,
 * and `target` tries another target (the project's setting is set aside). Throws when the run has no approved design.
 */
export function scaffoldPreview(state: RunState, ledger: Ledger, project: ProjectConfig, o: { target?: UiTarget } = {}): RunScaffold & { built?: ScaffoldRecord } {
  const proj = o.target ? { ...project, design: { ...(project.design ?? { brandFonts: [], navRaises: false, allowPrivateRefs: false }), uiTarget: o.target, uiTargets: {} } } as ProjectConfig : project;
  const approved = approvedDesignFor<Design & { skipped?: boolean }>(state, ledger);
  if (!approved) throw new Error(`${state.info.runId} has no approved design yet: the scaffold is made from the approved design`);
  if (approved.design.skipped || !approved.design.screens?.length) throw new Error(`${state.info.runId}'s request has no UI, so there is nothing to scaffold`);
  const pkg = packageForRun({ ...state.info, project: project.project }, approved.sha);
  // a run without a repo (a design for a new product) is scaffolded as a fresh app
  const src = runSource(state);
  const s = scaffoldForRun({ state, project: proj, design: approved.design, designSha: approved.sha, ...(pkg ? { pkg } : {}), ...(src ? { src } : {}) });
  const built = readOutput<ScaffoldRecord>(state, ledger, "stub-commit", "scaffold");
  return { ...s, ...(built ? { built } : {}) };
}

/**
 * A copy of a run's scaffold taken out of the factory (factory design scaffold --out, the UI's generate and zip download) is
 * recorded in the run's ledger, like any other side effect: what was written, where, and by whom (greenfield follow-up to the
 * PR #11 review: the zip was the only way to a new product, and it went round every gate unrecorded). Only a run with an
 * approved design has a scaffold (scaffoldPreview), so only such a run can be copied out.
 */
export async function recordScaffoldCopy(ledger: Ledger, o: { kind: "out" | "generate" | "download"; target: string; to: string; files?: number; by: string }): Promise<void> {
  await ledger.append({ type: "scaffold.copied", data: { copy: o.kind, target: o.target, to: o.to, ...(o.files !== undefined ? { files: o.files } : {}), by: o.by } }, HUMAN_WRITER);
}
