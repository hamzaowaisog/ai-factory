// Step 9: repair, run directly rather than through the executor.
//
// Two classes are repairable and no others: a textual conflict, and a clean merge whose locked tests
// fail. Everything about the budget is already decided by `mayRepair` before this is called; what
// remains is doing the work and binding the result.
//
// THE TESTS ARE LOCKED. The model is given the failing tests and the code, and may only change code.
// `lockedFiles` is enforced here, not merely requested in the prompt: an edit to any of them is
// dropped and reported. That is the property that makes automatic repair safe — repair can fix the
// code until the existing proof passes, and can never weaken the proof until the broken code passes.
import { z } from "zod";
import { buildPack } from "../context/pack.js";
import { Redactor } from "../context/secrets.js";
import type { Snapshot } from "../context/snapshot.js";
import { RepoTools } from "../context/tools.js";
import { ApiRunner, defaultProvider, type Provider } from "../runners/api.js";
import { S } from "../stages/think.js";
import { repairTrailer } from "./sync.js";

/** What the model may return: whole-file replacements, nothing else. No shell, no patches. */
export const RepairEdits = z.object({
  summary: z.string().min(1).max(400),
  edits: z.array(z.object({
    path: z.string().min(1),
    content: z.string(),
    why: z.string().min(1).max(200),
  })).min(1).max(20),
});
export type RepairEdits = z.infer<typeof RepairEdits>;

export const CONFLICT_TEMPLATE = `You are resolving a git merge conflict. The files below contain conflict markers (<<<<<<<, =======, >>>>>>>).

For each conflicted file, return the FULL resolved content with every marker removed. Keep both sides' intent: a conflict usually means two changes to the same region, and discarding one silently is the failure mode to avoid. Where the two sides cannot both be honoured, keep the behaviour the tests require and say so in "why".

You may read any other file for context. You may not change any test file: those are locked, and an edit to one will be dropped.`;

export const BROKEN_MERGE_TEMPLATE = `A merge is clean but locked tests now fail. Your job is to change the CODE so the existing tests pass again.

The tests are locked and you may not change them. You may not change what they assert, rename them, delete them or mark them skipped. An edit to a test file will be dropped and reported as a failed repair. If you believe a test is wrong, say so in "summary" and return no edits — a person will read it.

Read the failing tests to understand what they require, read the code they exercise, and return the full new content of each file you change.`;

export interface RepairRunOpts {
  /** the merged worktree, with conflict markers present when resolving a conflict */
  snap: Snapshot;
  /** test files that may never be edited, repo-relative */
  lockedFiles: string[];
  cls: "conflict" | "broken-merge";
  /** conflicted paths, or the ids of the locked tests that failed */
  subject: string[];
  failureDetail?: string;
  model: string;
  stronger?: string;
  noGo?: string[];
  maxUsd?: number;
  provider?: (model: string) => Provider;
  log?: (s: string) => void;
}

export interface RepairRunResult {
  /** edits to apply, already filtered to exclude anything locked */
  edits: RepairEdits["edits"];
  summary: string;
  /** edits the model proposed to locked files, dropped. Non-empty means it tried. */
  rejected: { path: string; why: string }[];
  model: string;
  trailer: string;
}

const MAX_ATTEMPTS = 2;

/**
 * Produces the edits a repair would apply. Deliberately does NOT write them: the caller applies
 * them in the worktree, re-verifies the repaired tree in full, and only then commits with the
 * trailer. Keeping the decision separate from the write is what lets this be tested without a repo.
 */
export async function proposeRepair(o: RepairRunOpts, reverifyRunId: string): Promise<RepairRunResult> {
  const redactor = new Redactor();
  const locked = new Set(o.lockedFiles.map((p) => p.replace(/\\/g, "/")));
  const template = o.cls === "conflict" ? CONFLICT_TEMPLATE : BROKEN_MERGE_TEMPLATE;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const model = attempt === 0 ? o.model : (o.stronger ?? o.model);
    const pack = buildPack({
      stage: "implement", cls: "read-large", model, recipeVersion: "1",
      budgetTokens: 100_000, tools: ["read_file", "search"], toolsAt: "under-review", redactor,
      sections: [
        S.template("tpl", template),
        S.reference("locked", `These files are LOCKED and may not be edited:\n${o.lockedFiles.map((f) => `- ${f}`).join("\n")}`),
        S.reference("subject", o.cls === "conflict"
          ? `Conflicted files:\n${o.subject.map((f) => `- ${f}`).join("\n")}`
          : `Locked tests failing on the merge result:\n${o.subject.map((t) => `- ${t}`).join("\n")}${o.failureDetail ? `\n\n${o.failureDetail}` : ""}`),
        S.task(o.cls === "conflict" ? "Resolve every conflicted file." : "Change the code so these tests pass."),
      ],
    });
    const runner = new ApiRunner({
      provider: o.provider ?? defaultProvider,
      tools: new RepoTools(o.snap, redactor, o.noGo ?? []),
    });
    const res = await runner.run({
      step: "implement", model, pack, schema: RepairEdits,
      limits: { maxTurns: 24, maxUsd: o.maxUsd ?? 4, timeoutSec: 900 },
    });

    if (res.status === "ok" && res.output) {
      const rejected: { path: string; why: string }[] = [];
      const edits = res.output.edits.filter((e) => {
        const p = e.path.replace(/\\/g, "/").replace(/^\.\//, "");
        if (locked.has(p)) { rejected.push({ path: p, why: e.why }); return false; }
        return true;
      });
      o.log?.(`repair proposed ${edits.length} edit(s)${rejected.length ? `, dropped ${rejected.length} to locked test files` : ""}`);
      return { edits, summary: res.output.summary, rejected, model, trailer: repairTrailer(reverifyRunId) };
    }

    lastError = `${res.status}${res.error ? `: ${res.error}` : ""}`;
    o.log?.(`repair attempt ${attempt + 1} of ${MAX_ATTEMPTS} did not finish (${lastError})`);
    if (res.status === "over-budget" || res.status === "config-error") break;
  }
  throw new Error(`The repair did not finish after ${MAX_ATTEMPTS} attempts (${lastError}).`);
}

/** A repair that touched only locked files has proposed nothing legitimate. */
export function repairIsEmpty(r: RepairRunResult): boolean {
  return r.edits.length === 0;
}
