// Step 9: repair proposes edits, and can never touch a locked test.
import { describe, expect, it } from "vitest";
import { BROKEN_MERGE_TEMPLATE, CONFLICT_TEMPLATE, proposeRepair, RepairEdits, repairIsEmpty, safeEditPath, type RepairRunOpts } from "./repair-run.js";
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

  it("DROPS an edit to a test file that is not locked: deleting or skipping a failing test is not a repair", async () => {
    const other = { path: "tests/Orders.Tests/RefundTests.cs", content: "// [Ignore]", why: "this test fails on the merge" };
    const spec = { path: "web/src/cart.test.ts", content: "it.skip(...)", why: "flaky" };
    const { provider } = scripted({ "*": [submit({ summary: "fixed", edits: [codeEdit, other, spec] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
    expect(got.rejected.map((r) => r.path)).toEqual([other.path, spec.path]);
    expect(got.rejected[0]!.why).toMatch(/test/);
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

  it("DROPS an edit whose path climbs out of the repository", async () => {
    // the caller writes these into the worktree and pushes the result, so an escaping path would be
    // written outside the repo and shipped. The model has been reading repository files, so its
    // output is untrusted in the strong sense.
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [
      codeEdit,
      { path: "../../.ssh/authorized_keys", content: "key", why: "escapes upward" },
      { path: "/etc/passwd", content: "x", why: "absolute" },
      { path: "src/../../outside.cs", content: "x", why: "climbs out after normalising" },
    ] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
    expect(got.rejected.filter((r) => r.why === "path is outside the repository")).toHaveLength(3);
  });

  it("safeEditPath keeps ordinary paths and refuses the ways out", () => {
    expect(safeEditPath("src/A.cs")).toBe("src/A.cs");
    expect(safeEditPath("./src/A.cs")).toBe("src/A.cs");
    expect(safeEditPath("src\\A.cs")).toBe("src/A.cs");
    expect(safeEditPath("src/sub/../A.cs")).toBe("src/A.cs");
    expect(safeEditPath("../A.cs")).toBeUndefined();
    expect(safeEditPath("src/../../A.cs")).toBeUndefined();
    expect(safeEditPath("C:/Windows/System32/x.dll")).toBeUndefined();
    expect(safeEditPath("/etc/passwd")).toBeUndefined();        // absolute, not reinterpreted
    expect(safeEditPath("")).toBeUndefined();
  });

  it("the conflict policy forbids keeping both sides of a single decision", () => {
    // the instruction used to be only "keep both sides' intent", which is exactly wrong when the
    // two sides are two versions of the same rule: that is how a merge stops compiling
    expect(CONFLICT_TEMPLATE).toMatch(/You cannot keep both/);
    expect(CONFLICT_TEMPLATE).toMatch(/must compile/);
  });
});

describe("proposeRepair: what a repair may write", () => {
  it("returns the normalised path, so a backslash never becomes part of a file name", async () => {
    const { provider } = scripted({ "*": [submit({ summary: "x", edits: [{ ...codeEdit, path: String.raw`.\src\Orders\OrderService.cs` }] })] });
    const got = await proposeRepair(opts({ provider }), "rv-1");
    expect(got.edits.map((e) => e.path)).toEqual(["src/Orders/OrderService.cs"]);
  });

  it("refuses workflows, the evidence manifest and no-go paths: they are pushed with the forge token", async () => {
    const edits = [
      { path: ".github/workflows/ci.yml", content: "on: push", why: "x" },
      { path: ".factory/evidence-manifest.json", content: "{}", why: "x" },
      { path: "config/prod.secret.json", content: "{}", why: "x" },
      { path: "src/.env", content: "K=V", why: "x" },
      codeEdit,
    ];
    const { provider } = scripted({ "*": [submit({ summary: "x", edits })] });
    const got = await proposeRepair(opts({ provider, noGo: ["config/*.secret.json"] }), "rv-1");
    expect(got.edits).toEqual([codeEdit]);
    expect(got.rejected.map((r) => r.path).sort()).toEqual([".factory/evidence-manifest.json", ".github/workflows/ci.yml", "config/prod.secret.json", "src/.env"]);
  });
});
