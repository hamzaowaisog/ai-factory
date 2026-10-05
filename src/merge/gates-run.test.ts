// Step 12: the gates, their order, and what gets recorded.
import { describe, expect, it } from "vitest";
import { plannedGateIds, runMergeGates, type MergeEvidence } from "./gates-run.js";
import { HUMAN_WRITER, type Ledger } from "../ledger/ledger.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { sha256, stableStringify } from "../util/hash.js";
import type { LedgerEvent } from "../contracts/index.js";
import type { TestRun } from "../contracts/index.js";

/**
 * An in-memory ledger. The real one cannot be created on a native Windows host (it needs fsync and
 * file locking), and its durability is covered by its own tests — what matters here is that the
 * gates are evaluated in the right order and that every verdict is recorded with what produced it.
 */
function fakeLedger() {
  const artifacts = new Map<string, string>();
  const events: LedgerEvent[] = [];
  const put = (v: unknown) => {
    const body = stableStringify(v);
    const sha = sha256(Buffer.from(body));
    artifacts.set(sha, body);
    return sha;
  };
  const l = {
    putJson: put,
    putArtifact: (c: string) => put(c),
    getJson: (sha: string) => JSON.parse(artifacts.get(sha)!),
    hasArtifact: (sha: string) => artifacts.has(sha),
    async append(ev: Partial<LedgerEvent>) { events.push(ev as LedgerEvent); },
    events: () => events,
  };
  return l as unknown as Ledger & { events(): LedgerEvent[] };
}

const testRun = (): TestRun => ({
  kind: "test", treeSha: "a".repeat(40), stage: "integrate", runner: "vstest", toolVersions: {},
  expectPass: [], expectFail: [], compareToBaseline: [], discovered: [],
  results: [{ id: "T1", outcome: "passed", durationMs: 1 }],
  exitCode: 0, reportShas: [], valid: true, classification: "ok",
});

const evidence = (over: Partial<MergeEvidence> = {}): MergeEvidence => ({
  build: { kind: "build", ok: true, errors: [] },
  testRun: testRun(),
  lintBaseline: [],
  secretScan: { kind: "secrets", commit: "a".repeat(40), hits: [] },
  diff: { files: [{ path: "src/A.cs", added: ["var x = 1;"], removed: [] }] },
  guidelines: { conventions: [] },
  violations: [],
  spec: { requirements: [] },
  head: { sha: "a".repeat(40) },
  gatedSha: "a".repeat(40),
  ...over,
});

const withReview = () => evidence({
  review2: { findings: [], coverage: [] },
  families: { implementer: "anthropic", reviewer: "openai", reviewer2: "google" },
  externalChecks: { headSha: "a".repeat(40), required: ["ci/build"], checks: [{ name: "ci/build", status: "completed", conclusion: "success" }] },
  lint: { kind: "lint", tool: "dotnet-build", version: "9", findings: [] },
});

describe("plannedGateIds", () => {
  it("runs the deterministic gates before any model verdict", () => {
    const ids = plannedGateIds(withReview());
    expect(ids.indexOf("build.clean")).toBeLessThan(ids.indexOf("review.covers-every-criterion"));
    expect(ids.indexOf("tests.expectations")).toBeLessThan(ids.indexOf("review-2.no-blocking"));
  });

  it("runs checks.external-green last, because a repair push restarts them all", () => {
    const ids = plannedGateIds(withReview());
    expect(ids[ids.length - 1]).toBe("checks.external-green");
  });

  it("checks review coverage before judging the review's findings", () => {
    const ids = plannedGateIds(withReview());
    expect(ids.indexOf("review.covers-every-criterion")).toBeLessThan(ids.indexOf("review-2.no-blocking"));
  });

  it("skips the review gates entirely when no review ran", () => {
    const ids = plannedGateIds(evidence());
    expect(ids).not.toContain("review.covers-every-criterion");
    expect(ids).not.toContain("review-2.no-blocking");
  });

  it("skips the lint gate when the build produced no analyzer output", () => {
    expect(plannedGateIds(evidence())).not.toContain("lint.no-new-findings");
  });

  it("always checks conventions, even with nothing else to go on", () => {
    expect(plannedGateIds(evidence())).toContain("conventions.followed");
  });

  it("lists every gate once", () => {
    const ids = plannedGateIds(withReview());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("runMergeGates", () => {
  const ledgerAt = fakeLedger;

  it("passes a clean change and records a verdict for every gate", async () => {
    const l = ledgerAt();
    const got = await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, { evidence: evidence(), step: "reverify", treeSha: "a".repeat(40) });
    expect(got.every((g) => g.passed)).toBe(true);
    // every decision is in the ledger, which is what makes it re-checkable later
    const events = l.events().filter((e) => e.type === "gate.result");
    expect(events).toHaveLength(got.length);
  });

  it("fails on a compilation error and says where", async () => {
    const l = ledgerAt();
    const got = await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, {
      evidence: evidence({ build: { kind: "build", ok: false, errors: [{ file: "Api/Program.cs", line: 8, code: "CS0246", msg: "not found" }] } }),
      step: "reverify", treeSha: "a".repeat(40),
    });
    const build = got.find((g) => g.id === "build.clean")!;
    expect(build.passed).toBe(false);
    expect(build.details).toMatch(/Api\/Program\.cs:8 CS0246/);
  });

  it("fails conventions when the guidelines are unapproved: cannot check counts as failed", async () => {
    const l = ledgerAt();
    const got = await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, {
      evidence: evidence({ guidelines: { unapproved: "never approved" } }), step: "reverify", treeSha: "a".repeat(40),
    });
    expect(got.find((g) => g.id === "conventions.followed")!.passed).toBe(false);
  });

  it("records what each decision was computed from, so it can be re-checked", async () => {
    const l = ledgerAt();
    await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, { evidence: evidence(), step: "reverify", treeSha: "a".repeat(40) });
    const ev = l.events().find((e) => e.type === "gate.result" && e.data?.gateId === "build.clean")!;
    expect(ev.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.data!.inputs).toBeTruthy();
    // the inputs are artifact shas, and the artifacts are in the ledger
    for (const sha of Object.values(ev.data!.inputs as Record<string, string>)) expect(l.hasArtifact(sha)).toBe(true);
  });

  it("replays a recorded verdict without evaluating the predicate again", async () => {
    const l = ledgerAt();
    const replay = new Map([["build.clean", { id: "build.clean", passed: true, details: "replayed" }]]);
    const got = await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, {
      // a build that WOULD fail: if the predicate ran, this gate would be red
      evidence: evidence({ build: { kind: "build", ok: false, errors: [{ file: "A.cs", line: 1, code: "CS1002", msg: "; expected" }] } }),
      step: "reverify", treeSha: "a".repeat(40), replay,
    });
    expect(got.find((g) => g.id === "build.clean")).toEqual({ id: "build.clean", passed: true, details: "replayed" });
    // and nothing was recorded for it, because nothing was decided
    expect(l.events().some((e) => e.type === "gate.result" && e.data?.gateId === "build.clean")).toBe(false);
  });

  it("still evaluates the gates that were not replayed", async () => {
    const l = ledgerAt();
    const replay = new Map([["build.clean", { id: "build.clean", passed: true, details: "replayed" }]]);
    const got = await runMergeGates(l, HUMAN_WRITER, DEFAULT_POLICY, { evidence: evidence(), step: "reverify", treeSha: "a".repeat(40), replay });
    expect(got.length).toBeGreaterThan(1);
    expect(l.events().some((e) => e.type === "gate.result" && e.data?.gateId === "secrets.none")).toBe(true);
  });
});
