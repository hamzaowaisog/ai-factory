// `factory review-pr` (path A) and `factory verify-merge-group` (path B).
// Both are invoked by a Harness Delegate on this host, with inputs that are NOT trusted.
import type { Command } from "commander";
import { loadProject } from "../config/project.js";
import { OWN_CHECK_NAME } from "../contracts/checks.js";
import { githubApi } from "../forge/github.js";
import { parseMergeGroupRef } from "../merge/group.js";
import { assertPrNumber, assertRepository } from "../merge/reverify.js";

export function registerMergeGate(program: Command, log: (s: string) => void): void {
  program.command("review-pr").argument("<pr>")
    .requiredOption("--project <name>")
    .requiredOption("--repository <owner/name>", "must match the project's forge.repo exactly")
    .option("--json", "machine-readable result for the Harness step")
    .option("--force", "re-run the model reviews even when nothing they read has changed")
    .description("gate a pull request before it may enter the merge queue")
    .action(async (pr: string, o: { project: string; repository: string; json?: boolean; force?: boolean }) => {
      const cfg = loadProject(o.project);
      // before any work, before any check run, before anything is written anywhere
      assertRepository(cfg.forge!.repo, o.repository);
      const n = assertPrNumber(pr);
      if (o.force && !process.stdout.isTTY) {
        // --force is for a person at a keyboard. A trigger that could set it would reintroduce the
        // spend loop the staleness model exists to prevent.
        log("--force is only available from a terminal, not from a trigger.");
        process.exit(2);
      }

      const { reviewPr } = await import("../merge/orchestrate.js");
      const { liveDeps } = await import("../merge/live.js");
      const deps = await liveDeps({ cfg, gh: githubApi(cfg), log });
      const r = await reviewPr(deps, { pr: n, force: o.force });

      if (o.json) log(JSON.stringify(r));
      else log(`${OWN_CHECK_NAME}: ${r.conclusion} (${r.cls})${r.repaired ? " — repaired" : ""}\n${r.why}`);
      process.exit(r.conclusion === "success" ? 0 : 1);
    });

  program.command("verify-merge-group").argument("<ref>", "refs/heads/gh-readonly-queue/<base>/<sha>")
    .requiredOption("--project <name>")
    .requiredOption("--repository <owner/name>")
    .option("--json")
    .description("verify the tree the merge queue is about to make main (read-only; never pushes)")
    .action(async (ref: string, o: { project: string; repository: string; json?: boolean }) => {
      const cfg = loadProject(o.project);
      assertRepository(cfg.forge!.repo, o.repository);
      const { base, sha } = parseMergeGroupRef(ref);

      const { verifyMergeGroup } = await import("../merge/group-run.js");
      const { liveGroupDeps } = await import("../merge/live.js");
      const r = await verifyMergeGroup(await liveGroupDeps({ cfg, gh: githubApi(cfg), log }), { ref, base, sha });

      if (o.json) log(JSON.stringify(r));
      else log(`${OWN_CHECK_NAME}: ${r.conclusion} on ${base} — ${r.why}`);
      process.exit(r.conclusion === "success" ? 0 : 1);
    });

  program.command("review-open-prs")
    .requiredOption("--project <name>")
    .option("--once", "check once and exit (for trying the set-up)")
    .option("--every <seconds>", "seconds between checks", "120")
    .description("gate every open pull request, repeatedly: the trigger, without Harness")
    .action(async (o: { project: string; once?: boolean; every: string }) => {
      const cfg = loadProject(o.project);
      if (!cfg.forge) {
        log(`Project ${o.project} has no forge configured, so there are no pull requests to gate.`);
        process.exit(2);
      }
      const every = Math.max(30, Number(o.every) || 120);

      const { pollOnce, pollSummary } = await import("../merge/poll.js");
      const { reviewPr } = await import("../merge/orchestrate.js");
      const { liveDeps } = await import("../merge/live.js");
      const { listOpenPrs } = await import("../forge/github.js");
      const gh = githubApi(cfg);

      const deps = {
        openPrs: () => listOpenPrs(gh),
        // a fresh deps per pull request: liveDeps holds the run id and the last verify pass of ONE
        // review, and sharing it across pull requests would carry #3's results into #4's judgement
        review: async (pr: number) => {
          const r = await reviewPr(await liveDeps({ cfg, gh, log }), { pr });
          return { conclusion: r.conclusion, cls: r.cls };
        },
        log,
      };

      if (!o.once) log(`Gating open pull requests on ${cfg.forge.repo} every ${every}s. Ctrl+C to stop. This computer must stay awake.`);
      for (;;) {
        try {
          log(`${new Date().toTimeString().slice(0, 8)} ${pollSummary(await pollOnce(deps))}`);
        } catch (e) {
          // the forge being unreachable is not a reason to stop watching
          log(`${new Date().toTimeString().slice(0, 8)} check failed: ${(e as Error).message}`);
        }
        if (o.once) return;
        await new Promise((res) => setTimeout(res, every * 1000));
      }
    });
}
