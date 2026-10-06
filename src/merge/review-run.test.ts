// Step 11: the merge review, with a scripted model. No network, no containers.
import { describe, expect, it } from "vitest";
import { runMergeReview } from "./review-run.js";
import { HUMAN_WRITER, type Ledger } from "../ledger/ledger.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";
import type { LedgerEvent } from "../contracts/index.js";
import type { Review2Inputs } from "../stages/review2.js";
import { sha256, stableStringify } from "../util/hash.js";

function fakeLedger() {
  const artifacts = new Map<string, string>();
  const events: LedgerEvent[] = [];
  const put = (v: unknown) => {
    const body = stableStringify(v);
    const sha = sha256(Buffer.from(body));
    artifacts.set(sha, body);
    return sha;
  };
  return {
    putJson: put, putArtifact: (c: string) => put(c),
    getJson: (sha: string) => JSON.parse(artifacts.get(sha)!),
    hasArtifact: (sha: string) => artifacts.has(sha),
    async append(ev: Partial<LedgerEvent>) { events.push(ev as LedgerEvent); },
    events: () => events,
  } as unknown as Ledger & { events(): LedgerEvent[] };
}

const U = { inputTokens: 100, outputTokens: 10, cacheRead: 0, cacheWrite: 0 };
const submit = (out: unknown): Turn => ({ calls: [{ id: "t1", name: "submit_result", input: out }], text: "", stop: "tool_use", usage: U });

/** A provider that plays back scripted turns and records which model it was asked for. */
function scripted(byModel: Record<string, Turn[] | Error>) {
  const asked: string[] = [];
  const provider = (model: string): Provider => {
    asked.push(model);
    const script = byModel[model] ?? byModel["*"]!;
    return {
      start(): Conversation {
        let i = 0;
        return {
          async next() {
            if (script instanceof Error) throw script;
            const t = script[i++];
            if (!t) throw new Error("script ran out");
            return t;
          },
          toolResults() {},
          say() {},
        };
      },
    };
  };
  return { provider, asked };
}

const GOOD = { findings: [], coverage: [{ acId: "AC-1", testId: "T::x", verdict: "proves-it", why: "it asserts the rejection" }] };

const inputs = (): Review2Inputs => ({
  diff: "diff --git a/A.cs b/A.cs\n+var x = 1;\n",
  intent: { spans: [{ id: "S-1", text: "no double booking" }] },
  spec: { requirements: [{ id: "R-1", acceptance: [{ id: "AC-1" }] }] },
  plan: { tasks: [] },
  acTests: { tests: [{ acId: "AC-1", file: "t.cs", name: "n", testId: "T::x", failsOnBase: true }] },
  assumptions: [],
  guidelinesMarkdown: "# Coding guidelines — shop\n\n## 1. What this repository already does\n",
  lint: { findings: [] },
  verification: { failed: [], flaky: [] },
  changedFiles: ["A.cs"],
});

const opts = (over: Record<string, unknown> = {}) => ({
  ledger: fakeLedger(), writer: HUMAN_WRITER, runId: "run-1",
  snap: { root: "/nope", commit: "a".repeat(40), files: [] },
  inputs: inputs(),
  model: "claude-sonnet-5", stronger: "claude-opus-5",
  implementerModel: "claude-sonnet-5", reviewerModel: "gpt-5.5",
  ...over,
});

describe("runMergeReview", () => {
  it("records the review and its model families in the ledger", async () => {
    const { provider } = scripted({ "*": [submit(GOOD)] });
    const o = opts({ provider });
    const got = await runMergeReview(o as never);
    expect(got).toMatchObject({ findings: 0, coverage: 1, model: "claude-sonnet-5" });
    const l = o.ledger as ReturnType<typeof fakeLedger>;
    expect(l.getJson(got.reviewSha)).toMatchObject({ coverage: GOOD.coverage });
    expect(l.getJson(got.familiesSha)).toEqual({ implementer: "anthropic", reviewer: "openai", reviewer2: "anthropic" });
  });

  it("appends a step.completed event, so the verdict is re-checkable like any step's", async () => {
    const { provider } = scripted({ "*": [submit(GOOD)] });
    const o = opts({ provider });
    await runMergeReview(o as never);
    const ev = (o.ledger as ReturnType<typeof fakeLedger>).events().find((e) => e.key === "review-2")!;
    expect(ev.type).toBe("step.completed");
    expect(ev.outputs).toHaveLength(2);
    expect(ev.inputsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("climbs to a stronger model on the second attempt, rather than repeating the first", async () => {
    const { provider, asked } = scripted({
      "claude-sonnet-5": [{ calls: [], text: "", stop: "refusal", usage: U }],
      "claude-opus-5": [submit(GOOD)],
    });
    const got = await runMergeReview(opts({ provider }) as never);
    expect(got.model).toBe("claude-opus-5");
    expect(asked).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  });

  it("gives up after two attempts and THROWS, so an unfinished review is never a clean one", async () => {
    const { provider, asked } = scripted({ "*": [{ calls: [], text: "", stop: "refusal", usage: U }] });
    const o = opts({ provider });
    await expect(runMergeReview(o as never)).rejects.toThrow(/did not finish after 2 attempts/);
    // nothing recorded: no review happened
    expect((o.ledger as ReturnType<typeof fakeLedger>).events()).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("does not climb when the budget is spent: a stronger model cannot fix that", async () => {
    // the first turn must SPEND the budget without answering. ApiRunner keeps an answer the turn
    // already paid for (api.ts: "an answer this turn already paid for is kept"), so a scripted
    // submit on turn one now succeeds over budget rather than reporting over-budget.
    const spendsItAll: Turn = { calls: [], text: "thinking out loud", stop: "end", usage: U };
    const { provider, asked } = scripted({ "*": [spendsItAll, submit(GOOD)] });
    await expect(runMergeReview(opts({ provider, maxUsd: 0.0000001 }) as never)).rejects.toThrow(/did not finish/);
    expect(asked).toHaveLength(1);
  });

  it("keeps an answer the turn already paid for, even over budget", async () => {
    // the other side of the same rule: a review that answered is a review, and throwing it away
    // would re-run it for nothing
    const { provider } = scripted({ "*": [submit(GOOD)] });
    const got = await runMergeReview(opts({ provider, maxUsd: 0.0000001 }) as never);
    expect(got.coverage).toBe(1);
  });

  it("names the stronger model only once, even when none is configured", async () => {
    const { provider, asked } = scripted({ "*": [{ calls: [], text: "", stop: "refusal", usage: U }] });
    await expect(runMergeReview(opts({ provider, stronger: undefined }) as never)).rejects.toThrow();
    expect(asked).toEqual(["claude-sonnet-5", "claude-sonnet-5"]);
  });

  it("notes when the merge reviewer shares a family with the implementer", async () => {
    const { provider } = scripted({ "*": [submit(GOOD)] });
    const o = opts({ provider, implementerModel: "claude-opus-5", model: "claude-sonnet-5" });
    const got = await runMergeReview(o as never);
    const fams = (o.ledger as ReturnType<typeof fakeLedger>).getJson(got.familiesSha) as Record<string, string>;
    expect(fams.implementer).toBe(fams.reviewer2);        // the gate turns this into a visible note
  });
});
