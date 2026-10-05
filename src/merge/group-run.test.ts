// Path B: the queue ref. Read-only, deterministic, and it never repairs.
import { describe, expect, it } from "vitest";
import { verifyMergeGroup, type GroupDeps } from "./group-run.js";

const member = (pr: number, runId: string, tests: string[]) => ({ pr, headRef: `factory/${runId}`, tests });

function deps(over: Partial<GroupDeps> = {}, members = [member(42, "run-a", ["T1", "T2"]), member(43, "run-b", ["T3"])]) {
  const calls = { verify: 0, gates: 0, comments: [] as number[], checks: [] as { conclusion: string; name: string }[], notify: [] as string[] };
  const d: GroupDeps = {
    membersOf: async () => members.map((m) => ({ pr: m.pr, headRef: m.headRef })),
    resolveMember: (m) => {
      const found = members.find((x) => x.pr === m.pr)!;
      return { runId: found.headRef.replace("factory/", ""), lockedTestIds: found.tests };
    },
    verifyRef: async () => { calls.verify++; return { built: true, failed: [], details: "" }; },
    runGates: async () => { calls.gates++; return [{ id: "tests.expectations", passed: true, details: "ok" }]; },
    writeCheck: async (x) => { calls.checks.push({ conclusion: x.conclusion, name: x.name }); },
    commentOnPr: async (x) => { calls.comments.push(x.pr); },
    notify: async (m) => { calls.notify.push(m); },
    ...over,
  };
  return { d, calls };
}

const ref = "refs/heads/gh-readonly-queue/main/pr-42-abc";
const at = { ref, base: "main", sha: "abc" };

describe("verifyMergeGroup", () => {
  it("runs the union of every member's locked tests, not just one PR's", async () => {
    let seen: string[] = [];
    const { d } = deps({ verifyRef: async (a) => { seen = a.testIds; return { built: true, failed: [], details: "" }; } });
    const got = await verifyMergeGroup(d, at);
    expect(seen).toEqual(["T1", "T2", "T3"]);
    expect(got.conclusion).toBe("success");
    expect(got.tests).toBe(3);
  });

  it("reports under the SAME check name path A uses, or the queue stalls forever", async () => {
    const { d, calls } = deps();
    await verifyMergeGroup(d, at);
    expect(calls.checks).toEqual([{ conclusion: "success", name: "factory/merge-gate" }]);
  });

  it("says nothing on a green group — no comments, no Slack", async () => {
    const { d, calls } = deps();
    await verifyMergeGroup(d, at);
    expect(calls.comments).toEqual([]);
    expect(calls.notify).toEqual([]);
  });

  it("refuses the group when a member has no locked tests, before building anything", async () => {
    const { d, calls } = deps({}, [member(42, "run-a", ["T1"]), member(43, "run-b", [])]);
    const got = await verifyMergeGroup(d, at);
    expect(got.conclusion).toBe("failure");
    expect(calls.verify).toBe(0);                 // never verified a union it knows is short
    expect(calls.comments).toEqual([42, 43]);     // every member is told why
  });

  it("fails the group when the combination does not build", async () => {
    const { d, calls } = deps({ verifyRef: async () => { calls.verify++; return { built: false, failed: [], details: "CS0246" }; } });
    const got = await verifyMergeGroup(d, at);
    expect(got.conclusion).toBe("failure");
    expect(got.why).toMatch(/does not build/);
    expect(calls.gates).toBe(0);                  // nothing to gate
  });

  it("fails the group when a locked test fails on the combination", async () => {
    const { d, calls } = deps({ verifyRef: async () => { calls.verify++; return { built: true, failed: ["T3"], details: "" }; } });
    const got = await verifyMergeGroup(d, at);
    expect(got.conclusion).toBe("failure");
    expect(got.why).toMatch(/T3/);
  });

  it("tells every member of a rejected group why, since a queue ref has no PR of its own", async () => {
    const { d, calls } = deps({ verifyRef: async () => { calls.verify++; return { built: true, failed: ["T3"], details: "" }; } });
    await verifyMergeGroup(d, at);
    expect(calls.comments).toEqual([42, 43]);
    expect(calls.notify).toHaveLength(1);
  });

  it("fails when a gate blocks even though the tests passed", async () => {
    const { d } = deps({ runGates: async () => [{ id: "secrets.none", passed: false, details: "a key in Api/appsettings.json" }] });
    const got = await verifyMergeGroup(d, at);
    expect(got.conclusion).toBe("failure");
    expect(got.why).toMatch(/secrets\.none/);
  });

  it("verifies a single-member group the same way", async () => {
    const { d } = deps({}, [member(42, "run-a", ["T1"])]);
    const got = await verifyMergeGroup(d, at);
    expect(got).toMatchObject({ conclusion: "success", members: 1, tests: 1 });
  });

  it("never repairs: there is no repair in its dependencies at all", () => {
    const { d } = deps();
    expect("repair" in d).toBe(false);
  });
});
