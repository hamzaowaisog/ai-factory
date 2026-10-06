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
  // NO floor on `edits`: both templates tell the model it may return nothing - a conflict it
  // cannot safely decide, or a locked test it believes is wrong. A `.min(1)` made that
  // instruction impossible to obey, so the model had to invent an edit or fail validation.
  // `repairIsEmpty` turns an empty result into a parked pull request, which is what we want.
  edits: z.array(z.object({
    path: z.string().min(1),
    content: z.string(),
    why: z.string().min(1).max(200),
  })).max(20),
});
export type RepairEdits = z.infer<typeof RepairEdits>;

export const CONFLICT_TEMPLATE = `You are resolving a git merge conflict. The files below contain conflict markers (<<<<<<<, =======, >>>>>>>).

For each conflicted file, return the FULL resolved content with every marker removed.

Decide each conflicted region by this rule, in order. Stop at the first case that applies.

1. The two sides change DIFFERENT things that merely sit near each other - they added one field, you added another. Keep both.

2. The two sides are two versions of the SAME decision: the same rule, the same constant, the same signature, the same branch of logic. You cannot keep both. Keeping both is how a merge produces code that does not compile, or a rule enforced twice with two different limits. Keep the side the locked tests require, and name the side you dropped in "why".

3. One side makes the other unnecessary or wrong - they moved or rewrote the very thing you were changing. Produce the end state the locked tests require, and say in "why" what you reconciled.

4. You cannot tell which side is correct, or satisfying the tests would mean inventing behaviour neither side wrote. Return NO edits and explain in "summary". A person resolves it instead. THIS IS A CORRECT OUTCOME, not a failure: a wrong resolution that happens to compile costs far more than a parked pull request.

Never leave a conflict marker. Never keep both sides of the same decision "just in case" - that is the most expensive mistake available here. Read the locked tests to learn which behaviour is required; they are the tie-breaker in cases 2 and 3.

Your result must compile. "build.clean" is an unwaivable gate, so a resolution that does not build is rejected and your work is discarded.

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
