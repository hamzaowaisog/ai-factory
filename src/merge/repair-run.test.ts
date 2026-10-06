// Step 9: repair proposes edits, and can never touch a locked test.
import { describe, expect, it } from "vitest";
import { BROKEN_MERGE_TEMPLATE, CONFLICT_TEMPLATE, proposeRepair, RepairEdits, repairIsEmpty, type RepairRunOpts } from "./repair-run.js";
import type { Conversation, Provider, Turn } from "../runners/api.js";

const U = { inputTokens: 100, outputTokens: 10, cacheRead: 0, cacheWrite: 0 };
const submit = (out: unknown): Turn => ({ calls: [{ id: "t1", name: "submit_result", input: out }], text: "", stop: "tool_use", usage: U });
const refuse = (): Turn => ({ calls: [], text: "", stop: "refusal", usage: U });

function scripted(byModel: Record<string, Turn[]>) {
  const asked: string[] = [];
  const provider = (model: string): Provider => {
    asked.push(model);
    const script = byModel[model] ?? byModel["*"]!;
    return {
      start(): Conversation {
        let i = 0;
        return {
          async next() { const t = script[i++]; if (!t) throw new Error("script ran out"); return t; },
          toolResults() {}, say() {},
        };
      },
    };
  };
  return { provider, asked };
}

/** Records what the model was shown, so a prompt the code never fills can be caught. */
function capturing(turns: Turn[]) {
  const seen: string[] = [];
  const provider = (): Provider => ({
    start(_m, _e, system, user): Conversation {
      seen.push(`${system}
${user}`);
      let i = 0;
      return {
        async next() { const t = turns[i++]; if (!t) throw new Error("script ran out"); return t; },
        toolResults() {}, say() {},
      };
    },
  });
  return { provider, seen };
}

const opts = (over: Partial<RepairRunOpts> = {}): RepairRunOpts => ({
  snap: { root: "/nope", commit: "a".repeat(40), files: [] },
  lockedFiles: ["tests/Orders.Tests/BookingTests.cs", "tests/Orders.Tests/MoneyTests.cs"],
  cls: "broken-merge",
  subject: ["Orders.Tests::BookingTests.Rejects"],
  model: "claude-sonnet-5", stronger: "claude-opus-5",
  ...over,
});

const codeEdit = { path: "src/Orders/OrderService.cs", content: "public class OrderService { }", why: "restore the guard" };
const testEdit = { path: "tests/Orders.Tests/BookingTests.cs", content: "// deleted", why: "the test is wrong" };

describe("proposeRepair", () => {
  it("returns the edits the model proposed", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "restored the guard", edits: [codeEdit] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
    expect(got.summary).toBe("restored the guard");
    expect(got.rejected).toEqual([]);
  });

  it("DROPS an edit to a locked test file, and reports that it was attempted", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "fixed", edits: [codeEdit, testEdit] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
    expect(got.rejected).toEqual([{ path: "tests/Orders.Tests/BookingTests.cs", why: "the test is wrong" }]);
  });

  it("drops a locked edit however the path is spelled", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [
      { ...testEdit, path: "./tests/Orders.Tests/BookingTests.cs" },
      { ...testEdit, path: "tests\\Orders.Tests\\MoneyTests.cs" },
    ] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits).toEqual([]);
    expect(got.rejected).toHaveLength(2);
  });

  it("a repair that only touched locked files has proposed nothing", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "the test is wrong", edits: [testEdit] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(repairIsEmpty(got)).toBe(true);
  });

  it("carries the trailer that marks the commit as ours, for the loop guard", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [codeEdit] })] });
    expect((await proposeRepair(opts({ provider }), "rv-99")).trailer).toBe("Factory-Repair: rv-99");
  });

  it("adds no attribution of any other kind", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [codeEdit] })] });
    expect((await proposeRepair(opts({ provider }), "rv-1")).trailer).not.toMatch(/Co-Authored-By/i);
  });

  it("climbs to a stronger model on the second attempt", async () => {
    const { provider, asked } = scripted({
      "claude-sonnet-5": [refuse()],
      "claude-opus-5": [submit({ summary: "x", edits: [codeEdit] })],
    });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.model).toBe("claude-opus-5");
    expect(asked).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  });

  it("throws after two attempts rather than returning no edits", async () => {
    const { provider } = scripted({ "*": [refuse()] });
    await expect(proposeRepair(opts({ provider }), "rv-1")).rejects.toThrow(/did not finish after 2 attempts/);
  });

  it("does not write anything: the caller applies, re-verifies, then commits", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [codeEdit] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    // the result is a proposal, not a side effect — which is what makes this testable without a repo
    expect(Object.keys(got).sort()).toEqual(["edits", "model", "rejected", "summary", "trailer"]);
  });

  it("uses the conflict instructions for a conflict, not the test-failure ones", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [codeEdit] })] });
    const got = await proposeRepair(opts({ provider, cls: "conflict", subject: ["src/A.cs"] }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
  });

  it("tells the model WHICH files are conflicted", async () => {
    // the orchestrator hands these over; before that was wired the section rendered empty and the
    // model was asked to resolve a conflict it had not been shown
    const { provider, seen } = capturing([submit({ summary: "x", edits: [codeEdit] })]);
    await proposeRepair(opts({ provider, cls: "conflict", subject: ["src/A.cs", "src/B.cs"] }), "rv-1");
    expect(seen[0]).toContain("src/A.cs");
    expect(seen[0]).toContain("src/B.cs");
  });

  it("tells the model WHICH locked tests failed", async () => {
    const { provider, seen } = capturing([submit({ summary: "x", edits: [codeEdit] })]);
    await proposeRepair(opts({ provider, cls: "broken-merge", subject: ["Orders.Tests::Rejects"] }), "rv-1");
    expect(seen[0]).toContain("Orders.Tests::Rejects");
  });

  it("accepts a repair that DECLINES to resolve: case 4 is a legal answer, not a failure", async () => {
    // `.min(1)` on `edits` made this impossible: declining failed schema validation, so the model
    // had to invent a resolution or burn both attempts. A wrong merge that compiles is the most
    // expensive outcome available here, so refusing has to be expressible.
    const { provider } = scripted({ "*": [submit({ summary: "both sides change the same limit; a person should pick", edits: [] })] });
    const got = await proposeRepair(opts({ provider, cls: "conflict", subject: ["src/A.cs"] }), "rv-1");
    expect(got.edits).toEqual([]);
    expect(repairIsEmpty(got)).toBe(true);
    expect(got.summary).toMatch(/a person should pick/);
  });

  it("the contract permits what both templates instruct: returning nothing", () => {
    // prompt and schema disagreeing is the bug class this pins. Both templates offer the escape
    // hatch, so the contract must accept it.
    expect(CONFLICT_TEMPLATE).toMatch(/Return NO edits/);
    expect(BROKEN_MERGE_TEMPLATE).toMatch(/return no edits/);
    expect(RepairEdits.safeParse({ summary: "cannot decide", edits: [] }).success).toBe(true);
  });

  it("the conflict policy forbids keeping both sides of a single decision", () => {
    // the instruction used to be only "keep both sides' intent", which is exactly wrong when the
    // two sides are two versions of the same rule: that is how a merge stops compiling
    expect(CONFLICT_TEMPLATE).toMatch(/You cannot keep both/);
    expect(CONFLICT_TEMPLATE).toMatch(/must compile/);
  });
});
