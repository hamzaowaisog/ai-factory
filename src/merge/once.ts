// One pass of the review agent over one pull request, as the poller runs it: for the Review tab's button, and for a
// run that has just delivered on a project that merges what passes, so nobody has to start the pass.
import type { ProjectConfig } from "../config/project.js";
import type { ReviewPrResult } from "./orchestrate.js";

const PR_NUMBER = /\/pull\/(\d+)(?:[/?#].*)?$/;

/** The pull request number in a pull request URL, if it is one. */
export function prNumberOf(url: string | undefined): number | undefined {
  const n = url ? Number(PR_NUMBER.exec(url)?.[1]) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

/** One pass, never forced, only for a run whose ledger is on this host. */
export async function reviewOnce(cfg: ProjectConfig, pr: number, log: (line: string) => void): Promise<ReviewPrResult> {
  const { githubApi } = await import("../forge/github.js");
  const { reviewPr } = await import("./orchestrate.js");
  const { liveDeps } = await import("./live.js");
  const { ensureGuidelines } = await import("../conventions/auto.js");
  await ensureGuidelines(cfg, log);
  return reviewPr(await liveDeps({ cfg, gh: githubApi(cfg), log }), { pr, onlyLocal: true });
}

/**
 * After a run delivers its pull request: one pass straight away, on a project that merges what passes
 * (`forge.autoMerge`), so the pull request is judged and merged without anyone pressing anything. Every other project
 * is left as it was: a pass writes to the pull request, and nobody there asked for one. Never throws: the run has
 * delivered whatever happens here, and the Review tab or the poller can run the pass again.
 */
export async function reviewDelivered(cfg: ProjectConfig, prUrl: string | undefined, log: (line: string) => void, run?: typeof reviewOnce): Promise<ReviewPrResult | undefined> {
  const pr = prNumberOf(prUrl);
  if (!cfg.forge?.autoMerge || pr === undefined) return undefined;
  // tests review nothing unless they bring their own pass
  if (process.env.VITEST && !run) return undefined;
  try {
    log(`review agent: judging pull request #${pr} now that it is delivered`);
    const r = await (run ?? reviewOnce)(cfg, pr, log);
    log(`review agent: ${r.conclusion} (${r.cls})${r.repaired ? ", repaired" : ""}${r.merged ? `, merged` : ""}\n${r.why}`);
    return r;
  } catch (e) {
    log(`review agent: the pass after delivery failed: ${(e as Error).message.split("\n")[0]}. Run it again from the Review tab.`);
    return undefined;
  }
}
