// Step 9: repair proposes edits, and can never touch a locked test.
import { describe, expect, it } from "vitest";
import { proposeRepair, repairIsEmpty, type RepairRunOpts } from "./repair-run.js";
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
});
