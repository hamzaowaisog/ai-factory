// design-export: right after a person approves the design, write the design package (src/design/package.ts;
// docs/estimates-design.md, "The design package"). Deterministic, no model. A change request's design becomes
// the next version of the design it changes; a run seeded from another run's approved design uses that run's package.
import { Ledger } from "../ledger/ledger.js";
import { replay, type RunState } from "../ledger/state.js";
import { diffDesigns } from "../design/diff.js";
import { findPackage, listPackages, nextVersion, packageDir, writePackage, type DesignManifest, type DesignPackage, type PackageInput } from "../design/package.js";
import { exportDesign, nextExportDir, parseFormats, type ExportOptions, type ExportRecord } from "../design/export.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_TEMPLATE_VERSION } from "./design.js";
import { outputOf, readOutput, type StepDef } from "./framework.js";

type Log = (msg: string) => void;
type Baseline = { ui?: boolean; design?: string; by?: string };

/** The approval of the design on the card: the bundle the lead approved (design and demo), by whom and when. */
function approvalOf(state: RunState, ledger: Ledger): { demoSha: string; by: string; at: string } | undefined {
  const d = [...state.decisions].reverse().find((x) => x.cardId.startsWith("design-") && x.decision === "approve");
  if (!d) return undefined;
  const bundle = ledger.getJson<{ design: string; demo: string }>(d.artifactSha);
  const at = ledger.events().find((e) => e.seq === d.seq)?.ts ?? state.info.createdAt;
  return { demoSha: bundle.demo, by: d.by, at };
}

/** The run whose approval this run's design is: itself, or the run it was seeded from (a sibling estimate, `--from-design`, a build from an estimate). */
function originOf(state: RunState): string | undefined {
  const p = state.info.parent;
  if (p?.kind === "sibling") return p.runId;
  return state.info.designRef?.runId ?? state.info.estimateRef?.runId;
}

/**
 * Write the package of a run's approved design, or say why there is none. A run seeded from another run's
 * design gets that run's package. A change request continues the line of the design it changes.
 */
export async function exportRunPackage(state: RunState, ledger: Ledger, log: Log = () => {}): Promise<DesignPackage | { none: string }> {
  const origin = originOf(state);
  if (origin) {
    const pkg = await ensurePackage(origin, log);
    return pkg ?? { none: `the design approved in ${origin} has no package` };
  }
  const base = readOutput<Baseline>(state, ledger, "design-baseline");
  if (!base?.ui || !base.design) return { none: "the request has no UI, so there is no design" };
  if ((base as { note?: boolean }).note) return { none: "a small fix: the design is a text note on the estimate card, with no demo or pictures" };
  const approval = approvalOf(state, ledger);
  if (!approval) return { none: "the design has no approval on record" };
  const project = state.info.project;
  const had = findPackage(project, base.design);
  if (had) return had;
  const design = ledger.getJson<PackageInput["design"] & { skipped?: boolean }>(base.design);
  // a change request: the next version of the design it changes (that one's package is written first if it is missing)
  let line = state.info.runId, previous: DesignManifest["previous"], changes: string[] | undefined;
  const p = state.info.parent;
  if (p?.kind === "change" && p.designSha) {
    const before = findPackage(project, p.designSha) ?? (Ledger.exists(p.runId) ? await ensurePackage(p.runId, log).catch((e: Error) => { log(`design package: the earlier version was not written: ${e.message}`); return undefined; }) : undefined);
    if (before?.manifest.designSha === base.design) return before;
    line = before?.manifest.line ?? p.runId;
    previous = { version: before?.manifest.version ?? 1, designSha: p.designSha, runId: before?.manifest.run.id ?? p.runId };
    changes = diffDesigns(ledger.hasArtifact(p.designSha) ? ledger.getJson(p.designSha) : undefined, design as never);
  }
  const version = previous ? Math.max(nextVersion(project, line), previous.version + 1) : 1;
  const e = state.info.estimate;
  return writePackage({
    project, line, version, design, designSha: base.design, demoHtml: ledger.getArtifact(approval.demoSha).toString("utf8"), demoSha: approval.demoSha,
    run: { id: state.info.runId, mode: state.info.mode, project }, product: { ...(e?.projectName ? { name: e.projectName } : {}), ...(e?.client ? { client: e.client } : {}) },
    approved: { by: approval.by, at: approval.at }, templateVersion: DESIGN_TEMPLATE_VERSION,
    references: (state.info.references ?? []).map((r) => ({ id: r.id, role: r.role, source: r.source })),
    ...(previous ? { previous } : {}), ...(changes ? { changes } : {}), log,
  });
}

/**
 * The package of a run's approved design: the one its design-export step wrote, or written now (a run approved
 * before packages existed, or a store that lost it). Undefined when the run has no approved design with UI.
 */
export async function ensurePackage(runId: string, log: Log = () => {}): Promise<DesignPackage | undefined> {
  const ledger = Ledger.open(runId);
  const state = replay(ledger.events());
  const done = readOutput<DesignManifest & { skipped?: boolean }>(state, ledger, "design-export");
  if (done && !done.skipped && existsSync(join(packageDir(done.run.project, done.line, done.version), "manifest.json"))) {
    return { manifest: done, dir: packageDir(done.run.project, done.line, done.version) };
  }
  const r = await exportRunPackage(state, ledger, log);
  return "none" in r ? undefined : r;
}

/** The requirement texts of a run's spec, for the design book (id → EARS sentence). */
function requirementTexts(state: RunState, ledger: Ledger): Record<string, string> {
  const spec = readOutput<{ requirements?: { id: string; ears: string }[] }>(state, ledger, "specify");
  return Object.fromEntries((spec?.requirements ?? []).map((r) => [r.id, r.ears]));
}

export interface RunExport extends ExportRecord { dir: string }

/**
 * Export a run's approved design (`factory design export`, the UI's Export button, `--design-export`).
 * `version` picks another version of the same design line; `out` writes somewhere other than `<run>/exports/vN/<n>/`.
 */
export async function exportForRun(runId: string, o: ExportOptions & { version?: number; out?: string }, log: Log = () => {}): Promise<RunExport> {
  const ledger = Ledger.open(runId);
  const state = replay(ledger.events());
  let pkg = await ensurePackage(runId, log);
  if (!pkg) throw new Error(`${runId} has no approved design to export${state.status === "waiting" ? " yet (it is waiting for approval)" : ""}.`);
  if (o.version !== undefined && o.version !== pkg.manifest.version) {
    const line = listPackages(pkg.manifest.run.project).filter((p) => p.manifest.line === pkg!.manifest.line);
    const want = line.find((p) => p.manifest.version === o.version);
    if (!want) throw new Error(`Design ${pkg.manifest.line} has no v${o.version}; it has ${line.map((p) => `v${p.manifest.version}`).join(", ")}.`);
    pkg = want;
  }
  const dir = o.out ?? nextExportDir(ledger.dir, pkg.manifest.version);
  const { version: _v, out: _o, ...opts } = o;
  const rec = await exportDesign(pkg, dir, opts, { requirements: requirementTexts(state, ledger), log });
  return { ...rec, dir };
}

/**
 * A run seeded from a design approved elsewhere (`--from-design`, `--from-estimate`, `--from-run`) never runs the
 * design steps, so `--design-export` exports right away: the design is approved already.
 */
export async function exportSeededNow(runId: string, formats: string[] | undefined, log: (m: string) => void): Promise<void> {
  if (!formats?.length) return;
  try {
    const e = await exportForRun(runId, { formats: parseFormats(formats.join(",")) }, log);
    log(`design exported (${e.files.length} files, design ${e.line} v${e.version}) to ${e.dir}`);
  } catch (err) {
    log(`design export skipped: ${(err as Error).message}`);
  }
}

/** The formats a run asked to export as soon as its design is approved (`--design-export png,pdf`). */
export function autoExportFormats(state: Pick<RunState, "info">): ExportOptions["formats"] {
  const f = state.info.designExport;
  return f?.length ? parseFormats(f.join(",")) : [];
}

/** The design package step for any mode's design pipeline, after the approval. */
export const designExportStep: StepDef = {
  key: "design-export", stage: "design", templateVersion: "1",
  inputs: (s) => (s.steps.get("design-baseline")?.status === "completed" ? { baseline: outputOf(s, "design-baseline") } : undefined),
  async run(ctx) {
    const r = await exportRunPackage(ctx.state, ctx.ledger, ctx.log);
    if ("none" in r) return { kind: "done", outputs: { package: ctx.ledger.putJson({ skipped: true, reason: r.none }) }, data: { skipped: true } };
    const m = r.manifest;
    ctx.log(`design-export: design ${m.line} v${m.version} in ${r.dir} (${m.files.length} files, ${m.shots.length} pictures)`);
    // `--design-export`: the files a person asked for, right after the approval; a failed export never stops the run
    let exported: string | undefined;
    const formats = autoExportFormats(ctx.state);
    if (formats.length) {
      try {
        const dir = nextExportDir(ctx.ledger.dir, m.version);
        const e = await exportDesign(r, dir, { formats }, { requirements: requirementTexts(ctx.state, ctx.ledger), log: ctx.log });
        exported = dir;
        ctx.log(`design-export: ${formats.join(", ")} exported (${e.files.length} files) to ${exported}`);
      } catch (e) {
        ctx.log(`design-export: the ${formats.join(", ")} export failed: ${(e as Error).message}`);
      }
    }
    return { kind: "done", outputs: { package: ctx.ledger.putJson(m) }, data: { line: m.line, version: m.version, dir: r.dir, shots: m.shots.length, ...(exported ? { exported } : {}) } };
  },
};
