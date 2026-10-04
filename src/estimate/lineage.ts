// Runs that build on an approved estimate (docs/estimates-design.md, "Fit with the code"): a change
// request (estimate v2 with a diff), the other delivery model as a sibling over the same breakdown, and a
// build run seeded from the estimate. Each reads the approved run's artifacts and copies them into the new
// ledger under their own hashes, so the new run stands alone and every hash still matches.
import { STANDALONE_PROJECT } from "../config/project.js";
import { Ledger } from "../ledger/ledger.js";
import { replay, type DesignRef, type RunInfo } from "../ledger/state.js";
import type { Breakdown, Estimate } from "../contracts/index.js";
import type { Range } from "./assumptions.js";

export interface Approved {
  runId: string;
  request: string;
  estimateSha: string;
  breakdownSha: string;
  specSha: string;
  criticSha?: string;
  clarifySha?: string;
  clarify2Sha?: string;
  /** the approved design (screen inventory) and the baseline approval of it */
  designSha?: string;
  baselineSha?: string;
  deliveryModel: string;
  settings: NonNullable<RunInfo["estimate"]>;
  /** everything to copy into the new ledger */
  artifacts: Record<string, unknown>;
}

/**
 * The approved estimate of a finished estimate run. Throws, in plain words, when it is not approved and exported.
 * `build`: a build is held to the estimate's budget, so a person must have approved it; a hands-off estimate (the
 * factory approved it) is refused.
 */
export function approvedEstimate(runId: string, opts: { build?: boolean } = {}): Approved {
  const ledger = Ledger.open(runId);
  const s = replay(ledger.events());
  if (s.info.mode !== "estimate") throw new Error(`${runId} is not an estimate run.`);
  for (const step of ["estimate", "approve-estimate", "export"]) {
    if (s.steps.get(step)?.status !== "completed") throw new Error(`${runId} has no approved estimate yet (${step} is not done). Approve it first.`);
  }
  if (opts.build && (s.steps.get("approve-estimate")!.data as { auto?: boolean } | undefined)?.auto) {
    throw new Error(`${runId} was approved by the factory (a hands-off estimate), and a build is held to a budget a person approved. Estimate it again with a person's review (factory estimate --review), then build from that run.`);
  }
  const sha = (step: string, name?: string): string | undefined => {
    const r = s.steps.get(step);
    return r?.status === "completed" ? (name ? (r.data?.named as Record<string, string> | undefined)?.[name] : r.outputs[0]) : undefined;
  };
  const estimateSha = sha("estimate")!, breakdownSha = sha("breakdown")!, specSha = sha("specify")!;
  const criticSha = sha("specify", "critic"), clarifySha = sha("clarify"), clarify2Sha = sha("clarify-2");
  const designSha = sha("design"), baselineSha = sha("design-baseline");
  const estimate = ledger.getJson<Estimate>(estimateSha);
  const artifacts: Record<string, unknown> = {};
  for (const x of [estimateSha, breakdownSha, specSha, criticSha, clarifySha, clarify2Sha, designSha, baselineSha]) if (x) artifacts[x] = ledger.getJson(x);
  return {
    runId, request: s.info.request ?? "", estimateSha, breakdownSha, specSha, criticSha, clarifySha, clarify2Sha, designSha, baselineSha,
    deliveryModel: estimate.deliveryModel, settings: s.info.estimate ?? {}, artifacts,
  };
}

/** An approved design-only run (`factory design start`), as a later estimate or build inherits it. */
export interface ApprovedDesign {
  runId: string;
  request: string;
  project: string;
  /** whether the design run read a repo (a build needs one) */
  repo: boolean;
  ref: DesignRef;
  /** the design run's own settings (no repo, client, product name), carried into an estimate */
  settings: NonNullable<RunInfo["estimate"]>;
  artifacts: Record<string, unknown>;
}

/** The approved design of a design-only run. Throws, in plain words, when it is not approved or has no UI. */
export function approvedDesign(runId: string): ApprovedDesign {
  const ledger = Ledger.open(runId);
  const s = replay(ledger.events());
  if (s.info.mode !== "design") throw new Error(`${runId} is not a design run (factory design start). ${s.info.mode === "estimate" ? "An estimate's design goes to a build with --from-estimate." : ""}`.trim());
  const base = s.steps.get("design-baseline");
  if (base?.status !== "completed") throw new Error(`${runId} has no approved design yet. Approve it first (factory show-card ${runId}).`);
  if (!(base.data as { ui?: boolean } | undefined)?.ui) throw new Error(`${runId} has no UI to design (the request does not touch any screen), so there is no design to carry on.`);
  const out = (step: string, name?: string): string | undefined => {
    const r = s.steps.get(step);
    return r?.status === "completed" ? (name ? (r.data?.named as Record<string, string> | undefined)?.[name] : r.outputs[0]) : undefined;
  };
  const ref: DesignRef = {
    runId, designSha: out("design")!, baselineSha: out("design-baseline")!, intakeSha: out("intake")!, specSha: out("specify")!,
    ...Object.fromEntries(Object.entries({
      criticSha: out("specify", "critic"), clarifySha: out("clarify"), clarify2Sha: out("clarify-2"),
      groundSha: out("ground"), surveySha: out("ground", "survey"), inventorySha: out("ground", "design"),
    }).filter(([, v]) => v)),
  };
  for (const k of ["designSha", "intakeSha", "specSha"] as const) if (!ref[k]) throw new Error(`${runId} is missing its ${k.replace("Sha", "")} output; it cannot be carried on.`);
  const artifacts: Record<string, unknown> = {};
  for (const [k, sha] of Object.entries(ref)) if (k !== "runId" && sha) artifacts[sha] = ledger.getJson(sha);
  return {
    runId, request: s.info.request ?? "", project: s.info.project, repo: !!s.info.repoPath && !!s.info.baseCommit, ref,
    settings: s.info.estimate ?? {}, artifacts,
  };
}

/**
 * Whether an approved design may be built in this project: its own project, or, for a design with no repo (a new product,
 * designed under the standalone project), any project, whose empty repo it is built into (greenfield).
 */
export function designFitsProject(d: Pick<ApprovedDesign, "project" | "repo">, project: string | undefined): boolean {
  return d.project === project || (!d.repo && d.project === STANDALONE_PROJECT);
}

/** Put the approved run's artifacts into the new ledger; each must land under the hash it had. */
export function copyArtifacts(to: Ledger, a: Pick<Approved, "runId" | "artifacts">): void {
  for (const [sha, value] of Object.entries(a.artifacts)) {
    const got = to.putJson(value);
    if (got !== sha) throw new Error(`Artifact ${sha.slice(0, 8)} from ${a.runId} did not keep its hash when copied (${got.slice(0, 8)}).`);
  }
}

const delta = (a: Range, b: Range) => `${b.min}-${b.max} h (was ${a.min}-${a.max})`;

/** What changed between two estimates, for the approval card: totals, cost and tasks added or removed. */
export function diffEstimates(from: { estimate: Estimate; breakdown: Pick<Breakdown, "tasks"> }, to: { estimate: Estimate; breakdown: Pick<Breakdown, "tasks"> }): string[] {
  const out: string[] = [];
  const a = from.estimate, b = to.estimate;
  if (a.deliveryModel !== b.deliveryModel) out.push(`Delivery model: ${a.deliveryModel} -> ${b.deliveryModel}`);
  out.push(`Overall: ${delta(a.totals.overall, b.totals.overall)}`);
  const tracks = new Set([...Object.keys(a.totals.byTrack), ...Object.keys(b.totals.byTrack)]);
  for (const t of tracks) {
    const x = a.totals.byTrack[t as never] as Range | undefined, y = b.totals.byTrack[t as never] as Range | undefined;
    if (!x || !y || x.min !== y.min || x.max !== y.max) out.push(`${t}: ${y ? delta(x ?? { min: 0, max: 0 }, y) : `removed (was ${x!.min}-${x!.max} h)`}`);
  }
  out.push(`API credits: $${b.apiCost.total.min.toFixed(2)}-$${b.apiCost.total.max.toFixed(2)} (was $${a.apiCost.total.min.toFixed(2)}-$${a.apiCost.total.max.toFixed(2)})`);
  const was = new Set(from.breakdown.tasks.map((t) => t.title)), now = new Set(to.breakdown.tasks.map((t) => t.title));
  for (const t of to.breakdown.tasks) if (!was.has(t.title)) out.push(`Added task: ${t.title}`);
  for (const t of from.breakdown.tasks) if (!now.has(t.title)) out.push(`Removed task: ${t.title}`);
  return out;
}
