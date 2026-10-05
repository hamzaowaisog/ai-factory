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
}
