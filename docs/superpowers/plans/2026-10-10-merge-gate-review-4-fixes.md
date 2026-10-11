# Merge gate: fourth-review fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the hole where a repair passes by deleting or skipping a test (item 1). Stop a red `main` from buying a repair on every open pull request (item 3). Make the gate use the project's policy and narrow the `.factory/` exclusion to the manifest (smaller items).

**Architecture:** `proposeRepair` refuses an edit to any test path, not only the locked files. `mergeVerify` reports the failing tests this run never knew (neither locked nor in its baseline). `reviewPr` does not repair a broken merge that has any of them. `liveDeps` merges the project's policy the way the executor does. `gateDiff` excludes only `.factory/evidence-manifest.json`.

**Tech Stack:** TypeScript, vitest.

**Spec:** PR #27, fourth review comment (hamzaowaisog, 2026-10-10T16:11Z), items 1 and 3 and "Smaller" items 1-2.

## Global Constraints

- No `Co-Authored-By` line in commits. Commit messages are one plain sentence of behaviour.
- `src/forge/repos.test.ts` has 4 known native-Windows failures; the task test commands leave it out.
- Item 2 (the conflict with `Hamza/model-picker`) is resolved at merge time, not here. The skills question (`db5b801`) is the user's call, not this plan's.

## Review Focus

- A path like `src/Contest/Foo.cs` matches the test pattern (`[^/]*Tests?/`, case-insensitive) and is refused. This is the safe direction, and it is recorded as a ruling.
- A broken merge with only locked failures must still be repaired. Only unknown failures block the repair.
- A run with no baseline (greenfield): every non-locked failure is unknown, so there is no repair. This is the conservative direction.
- With the project's policy narrowing `registryAllowlist`, the `ensureEgress` feed list must match the build's list.
- `.factory/design/**` changes must appear in the gate diff again.

---

### Task 1: A repair may not edit any test file (item 1)

**Files:** Modify `src/merge/repair-run.ts` (`proposeRepair` filter loop, ~line 160). Test: `src/merge/repair-run.test.ts`.

- [ ] Write a failing test. A fake model proposes edits to `src/Shop/Cart.cs` and to `tests/Shop.Tests/OtherTests.cs`, which is not locked. Expect `edits` to be only `Cart.cs`, and `rejected` to name the test file with a reason matching `/test/`.
- [ ] Run `npx vitest run src/merge/repair-run.test.ts`. Expected: FAIL.
- [ ] Implement: import `isTestPath` from `../context/ripple.js`. After the `locked` check, add `if (isTestPath(p)) { rejected.push({ path: p, why: "a repair may not change a test: it must make the code pass the tests, not the other way round" }); continue; }`.
- [ ] Run again. Expected: PASS. Commit: "Refuse a repair edit to any test file, not only the locked ones, so a repair cannot pass by deleting or skipping a test".

### Task 2: No repair when a failing test is one the run never knew (item 3)

**Files:** `src/merge/adapters.ts` (new `unknownFailures`), `src/merge/orchestrate.ts` (`MergeResult.unknownFailures`, broken-merge branch), `src/merge/live.ts` (fill it in). Tests: `adapters.test.ts`, `orchestrate.test.ts`.

**Interfaces:** `export function unknownFailures(failed: string[], lockedIds: string[], baseline: TestRun | undefined): string[]`, the failed ids that are neither locked nor in `baseline.results`, sorted. `MergeResult.unknownFailures?: string[]`.

- [ ] Write failing tests. For `unknownFailures`: a locked id and a baseline id are not unknown, a new id is, and with no baseline every non-locked id is unknown. For `reviewPr`: a broken merge with `unknownFailures: ["T::NewOnMain"]` makes no repair call (`calls.repair === 0`), concludes `failure`, and its why matches `/NewOnMain/`. A broken merge with only locked failures still repairs.
- [ ] Run `npx vitest run src/merge/adapters.test.ts src/merge/orchestrate.test.ts`. Expected: FAIL.
- [ ] Implement. In `reviewPr`, inside `if (isRepairable(cls))` and before `mayRepair`: if `cls === "broken-merge" && m?.unknownFailures?.length`, `return await fail(cls, "Tests fail that this run never knew", ...)`. The why names the ids and explains they are neither locked nor in the run's baseline, are most likely new on the base and failing there, and that no repair was paid for. In `live.ts`, set `unknownFailures: unknownFailures(lastVerify.verification.failed, mergeExpectations(lock).expectPass, baseline)`.
- [ ] Run again. Expected: PASS. Commit: "Do not pay for a repair when a failing test is one the run never knew, which is what a red main looks like".

### Task 3: Project policy in the gate, and only the manifest left out of the diff (smaller items)

**Files:** `src/merge/live.ts` (the `o.policy ?? DEFAULT_POLICY` sites become `policy(o)` = `o.policy ?? mergePolicy(DEFAULT_POLICY, o.cfg.policy as Partial<Policy>)`), `src/merge/adapters.ts` (`gateDiff` pathspec `:(exclude)${EVIDENCE_MANIFEST}`). Test: `adapters.test.ts`.

- [ ] Write a failing test in the `gateDiff` describe: a change to `.factory/design/tokens.json` on the PR **is** in the diff, while the manifest-only base move still gives the same diff.
- [ ] Run it. Expected: FAIL.
- [ ] Implement both changes. `live.ts` has no tests (it needs Docker); the typecheck covers it.
- [ ] Run `npx tsc --noEmit -p .` and `npx vitest run src/merge src/forge/github.test.ts src/ledger/git.test.ts src/gates`. Expected: PASS. Update `docs/merge-gate-review-fixes.md` with a section 8 for the fourth review. Commit: "Use the project's policy in the merge gate, and leave only the evidence manifest out of its diff". Push to `fork pr-review`.
