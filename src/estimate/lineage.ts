// Runs that build on an approved estimate (docs/estimates-design.md, "Fit with the code"): a change
// request (estimate v2 with a diff), the other delivery model as a sibling over the same breakdown, and a
// build run seeded from the estimate. Each reads the approved run's artifacts and copies them into the new
// ledger under their own hashes, so the new run stands alone and every hash still matches.
import { Ledger } from "../ledger/ledger.js";
import { replay, type RunInfo } from "../ledger/state.js";
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
  deliveryModel: string;
  settings: NonNullable<RunInfo["estimate"]>;
  /** everything to copy into the new ledger */
  artifacts: Record<string, unknown>;
}

/** The approved estimate of a finished estimate run. Throws, in plain words, when it is not approved and exported. */
export function approvedEstimate(runId: string): Approved {
  const ledger = Ledger.open(runId);
  const s = replay(ledger.events());
  if (s.info.mode !== "estimate") throw new Error(`${runId} is not an estimate run.`);
  for (const step of ["estimate", "approve-estimate", "export"]) {
    if (s.steps.get(step)?.status !== "completed") throw new Error(`${runId} has no approved estimate yet (${step} is not done). Approve it first.`);
  }
  const sha = (step: string, name?: string): string | undefined => {
    const r = s.steps.get(step);
    return r?.status === "completed" ? (name ? (r.data?.named as Record<string, string> | undefined)?.[name] : r.outputs[0]) : undefined;
  };
  const estimateSha = sha("estimate")!, breakdownSha = sha("breakdown")!, specSha = sha("specify")!;
  const criticSha = sha("specify", "critic"), clarifySha = sha("clarify"), clarify2Sha = sha("clarify-2");
  const estimate = ledger.getJson<Estimate>(estimateSha);
  const artifacts: Record<string, unknown> = {};
  for (const x of [estimateSha, breakdownSha, specSha, criticSha, clarifySha, clarify2Sha]) if (x) artifacts[x] = ledger.getJson(x);
  return {
    runId, request: s.info.request ?? "", estimateSha, breakdownSha, specSha, criticSha, clarifySha, clarify2Sha,
    deliveryModel: estimate.deliveryModel, settings: s.info.estimate ?? {}, artifacts,
  };
}

/** Put the approved run's artifacts into the new ledger; each must land under the hash it had. */
export function copyArtifacts(to: Ledger, a: Approved): void {
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
