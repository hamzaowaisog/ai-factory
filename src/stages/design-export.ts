// design-export: right after a person approves the design, write the design package (src/design/package.ts;
// docs/estimates-design.md, "The design package"). Deterministic, no model. A change request's design becomes
// the next version of the design it changes; a run seeded from another run's approved design uses that run's package.
import { Ledger } from "../ledger/ledger.js";
import { replay, type RunState } from "../ledger/state.js";
import { diffDesigns } from "../estimate/lineage.js";
import { findPackage, nextVersion, packageDir, writePackage, type DesignManifest, type DesignPackage, type PackageInput } from "../design/package.js";
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

/** The design package step for any mode's design pipeline, after the approval. */
export const designExportStep: StepDef = {
  key: "design-export", stage: "design", templateVersion: "1",
  inputs: (s) => (s.steps.get("design-baseline")?.status === "completed" ? { baseline: outputOf(s, "design-baseline") } : undefined),
  async run(ctx) {
    const r = await exportRunPackage(ctx.state, ctx.ledger, ctx.log);
    if ("none" in r) return { kind: "done", outputs: { package: ctx.ledger.putJson({ skipped: true, reason: r.none }) }, data: { skipped: true } };
    const m = r.manifest;
    ctx.log(`design-export: design ${m.line} v${m.version} in ${r.dir} (${m.files.length} files, ${m.shots.length} pictures)`);
    return { kind: "done", outputs: { package: ctx.ledger.putJson(m) }, data: { line: m.line, version: m.version, dir: r.dir, shots: m.shots.length } };
  },
};
