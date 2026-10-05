// Step 11: the independent merge review, run directly rather than through the executor.
//
// What the executor would add here is a failure ladder and a cost cap, and both are provided
// explicitly: `maxUsd` bounds the spend on the runner itself, and `attempt` climbs exactly one rung
// before giving up — the same 2-attempt budget the repair ladder uses, rather than the pipeline
// default of six across four rungs. The review artifact and its verdict are written to the ledger
// here, so `factory verify-evidence` can re-check them exactly as it would a step's.
import { buildPack } from "../context/pack.js";
import { Redactor } from "../context/secrets.js";
import type { Snapshot } from "../context/snapshot.js";
import { RepoTools } from "../context/tools.js";
import { ReviewSubmit } from "../contracts/index.js";
import type { Ledger, Writer } from "../ledger/ledger.js";
import { ApiRunner, defaultProvider, type Provider } from "../runners/api.js";
import { family } from "../runners/types.js";
import { header } from "../stages/framework.js";
import { review2Sections, type Review2Inputs } from "../stages/review2.js";

export interface ReviewRunOpts {
  ledger: Ledger;
  writer: Writer;
  runId: string;
  /** a snapshot at the MERGE COMMIT: the reviewer must read the code as it will land */
  snap: Snapshot;
  noGo?: string[];
  inputs: Review2Inputs;
  /** attempt 0 uses this; attempt 1 climbs to `stronger` */
  model: string;
  stronger?: string;
  implementerModel: string;
  reviewerModel: string;
  maxUsd?: number;
  log?: (s: string) => void;
  /** Tests script the model; production uses the real provider for the routed model. */
  provider?: (model: string) => Provider;
}

export interface ReviewRunResult {
  reviewSha: string;
  familiesSha: string;
  model: string;
  findings: number;
  coverage: number;
}

const MAX_ATTEMPTS = 2;

/**
 * Runs the merge reviewer and records what it said. Throws only when both attempts fail: a review
 * that did not happen must never read as a review that found nothing.
 */
export async function runMergeReview(o: ReviewRunOpts): Promise<ReviewRunResult> {
  const redactor = new Redactor();
  const sections = review2Sections(o.inputs);
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // rung 1: a stronger model, not simply the same one again — a model that under-reported once is
    // likely to under-report the same way twice
    const model = attempt === 0 ? o.model : (o.stronger ?? o.model);
    const pack = buildPack({
      stage: "review", cls: "read-large", model, recipeVersion: "1",
      budgetTokens: 120_000, sections, tools: ["read_file", "search"],
      toolsAt: "under-review", redactor,
    });
    const runner = new ApiRunner({
      provider: o.provider ?? defaultProvider,
      tools: new RepoTools(o.snap, redactor, o.noGo ?? []),
    });
    const res = await runner.run({
      step: "review", model, pack, schema: ReviewSubmit,
      limits: { maxTurns: 20, maxUsd: o.maxUsd ?? 4, timeoutSec: 900 },
    });

    if (res.status === "ok" && res.output) {
      const reviewSha = o.ledger.putJson({
        header: header(o.runId, "review", "review", pack.manifest.packSha, model),
        ...res.output,
      });
      // a three-way family check: this reviewer should differ from BOTH the implementer and the
      // pre-PR reviewer, or it brings the same blind spots to the same code
      const familiesSha = o.ledger.putJson({
        implementer: family(o.implementerModel),
        reviewer: family(o.reviewerModel),
        reviewer2: family(model),
      });
      await o.ledger.append({
        type: "step.completed", key: "review-2", inputsHash: pack.manifest.packSha,
        outputs: [reviewSha, familiesSha],
        data: { model, findings: res.output.findings.length, coverage: res.output.coverage.length, attempt },
      }, o.writer);
      o.log?.(`review-2: ${res.output.findings.length} findings, ${res.output.coverage.length} criteria accounted for ($${res.usage.estUsd?.toFixed(2) ?? "?"})`);
      return { reviewSha, familiesSha, model, findings: res.output.findings.length, coverage: res.output.coverage.length };
    }

    lastError = `${res.status}${res.error ? `: ${res.error}` : ""}`;
    o.log?.(`review-2 attempt ${attempt + 1} of ${MAX_ATTEMPTS} did not finish (${lastError})`);
    // a budget or a key problem will not be fixed by a stronger model
    if (res.status === "over-budget" || res.status === "config-error") break;
  }
  throw new Error(`The merge review did not finish after ${MAX_ATTEMPTS} attempts (${lastError}). The pull request is not reviewed, so no verdict is recorded.`);
}
