// Per-run snapshot (locked room), worktree (coding) and container runtime access.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readsRequirements } from "../contracts/common.js";
import { createSnapshot, snapshotDir, type Snapshot } from "../context/snapshot.js";
import { Redactor } from "../context/secrets.js";
import { RepoTools } from "../context/tools.js";
import { addWorktree } from "../ledger/git.js";
import { paths } from "../util/paths.js";
import { DockerCli, type ContainerRuntime } from "../verify/runtime.js";
import type { StepContext } from "./framework.js";
import type { RunState } from "../ledger/state.js";

export function snapshotFor(ctx: Pick<StepContext, "runId" | "state" | "project">): Snapshot {
  const { repoPath, baseCommit } = ctx.state.info;
  if (!repoPath || !baseCommit) {
    // an estimate or design from requirements alone reads an empty repository: no files, nothing to anchor to
    if (!readsRequirements(ctx.state.info.mode)) throw new Error("Run has no repo");
    const dir = snapshotDir(ctx.runId, "empty");
    mkdirSync(dir, { recursive: true });
    return { root: dir, commit: "0".repeat(40), files: [] };
  }
  return createSnapshot(repoPath, baseCommit, snapshotDir(ctx.runId, baseCommit), ctx.project.noGo);
}

export function toolsFor(ctx: Pick<StepContext, "runId" | "state" | "project">): RepoTools {
  return new RepoTools(snapshotFor(ctx), new Redactor(), ctx.project.noGo);
}

/** Short worktree path (long-path limits), created once per run by the core. */
export async function ensureWorktree(ctx: StepContext, base: string): Promise<string> {
  if (ctx.state.workspace && existsSync(ctx.state.workspace.path)) return ctx.state.workspace.path;
  const short = ctx.runId.slice(-4) + "-" + ctx.runId.slice(0, 8);
  const wt = join(paths.worktrees(), short);
  // a run started from a Jira ticket carries its key, so Jira's GitHub app links the branch and PR
  const jiraKey = ctx.state.info.sources?.find((s) => s.kind === "jira")?.key;
  const branch = jiraKey ? `factory/${jiraKey}-${ctx.runId}` : `factory/${ctx.runId}`;
  await addWorktree(ctx.state.info.repoPath!, wt, branch, base, ctx.runId);
  await ctx.ledger.append({ type: "workspace.created", data: { path: wt, branch } }, ctx.writer);
  ctx.state.workspace = { path: wt, branch };
  return wt;
}

let rt: ContainerRuntime | undefined;
export function runtime(): ContainerRuntime {
  rt ??= new DockerCli();
  return rt;
}
export function setRuntime(r: ContainerRuntime): void {
  rt = r;
}

/**
 * Where the build's own changes start: the commit holding the design package when the first build commit
 * put one in the repo, else the base. Diffs that judge the work (size, the UI size cap, the review) start here,
 * so the package's files never count as the change.
 */
export function codeBase(state: Pick<RunState, "info" | "steps">): string {
  return String(state.steps.get("stub-commit")?.data?.designCommit ?? state.info.baseCommit);
}

/**
 * Where the agents' change starts: after the scaffold commit when the factory generated the approved pages, else the code
 * base. The design size cap measures from here, so the kit, theme and pages the factory wrote are not counted (PR #11 review, item 11);
 * so do the diff size, the test-infrastructure lock, the review and the PR lines (greenfield: a new product's whole app is scaffold).
 */
export function uiBase(state: Pick<RunState, "info" | "steps">): string {
  const scaffold = state.steps.get("stub-commit")?.data?.scaffold as { commit?: string } | undefined;
  return scaffold?.commit ?? codeBase(state);
}
