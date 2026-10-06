// The trigger: which open pull requests get gated, and what a failure on one does to the others.
import { describe, expect, it } from "vitest";
import { pollOnce, pollSummary, type PollDeps } from "./poll.js";

const pr = (number: number, over: Partial<{ draft: boolean; headSha: string }> = {}) =>
  ({ number, draft: false, headSha: `sha${number}`, ...over });

function deps(over: Partial<PollDeps> = {}) {
  const asked: number[] = [];
  const lines: string[] = [];
  const review = over.review ?? (async () => ({ conclusion: "success", cls: "unchanged" }));
  const d: PollDeps = {
    openPrs: async () => [pr(2), pr(1)],
    ...over,
    // wrapped AFTER the spread, so an overriding review is still recorded
    review: async (n) => { asked.push(n); return review(n); },
    log: over.log ?? ((s) => lines.push(s)),
  };
  return { d, asked, lines };
}

describe("pollOnce", () => {
  it("gates every open pull request, oldest first", async () => {
    const { d, asked } = deps();
    const got = await pollOnce(d);
    expect(asked).toEqual([1, 2]);                      // the forge lists newest first
    expect(got.reviewed).toHaveLength(2);
    expect(got.failed).toEqual([]);
  });

  it("leaves a draft alone: the factory marks its own pull request ready when it is", async () => {
    const { d, asked } = deps({ openPrs: async () => [pr(3, { draft: true }), pr(1)] });
    const got = await pollOnce(d);
    expect(asked).toEqual([1]);
    expect(got.skipped).toEqual([{ pr: 3, why: "still a draft" }]);
  });

  it("keeps going when one pull request cannot be gated", async () => {
    // a bad ledger or a container that would not start on #1 says nothing about #2
    const { d, asked } = deps({
      review: async (n) => {
        if (n === 1) throw new Error("no ledger for this run on this host");
        return { conclusion: "success", cls: "unchanged" };
      },
    });
    const got = await pollOnce(d);
    expect(asked).toEqual([1, 2]);
    expect(got.failed).toEqual([{ pr: 1, why: "no ledger for this run on this host" }]);
    expect(got.reviewed).toEqual([{ pr: 2, conclusion: "success", cls: "unchanged" }]);
  });

  it("re-gates a pull request it has already gated, rather than remembering its head", async () => {
    // remembering the head SHA would skip a pull request whose head is unchanged but whose BASE
    // moved — the one case the merge gate exists for. reviewPr decides the cost for itself.
    const { d, asked } = deps({ openPrs: async () => [pr(1)] });
    await pollOnce(d);
    await pollOnce(d);
    expect(asked).toEqual([1, 1]);
  });

  it("reports nothing to do without inventing work", async () => {
    const { d, asked } = deps({ openPrs: async () => [] });
    const got = await pollOnce(d);
    expect(asked).toEqual([]);
    expect(pollSummary(got)).toBe("no open pull requests");
  });

  it("summarises a mixed tick", () => {
    expect(pollSummary({
      reviewed: [{ pr: 1, conclusion: "failure", cls: "conflict" }],
      skipped: [{ pr: 2, why: "still a draft" }],
      failed: [{ pr: 3, why: "boom" }],
    })).toBe("1 gated · 1 failed · 1 draft");
  });
});
