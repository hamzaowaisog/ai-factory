// The one-time setup, checked before it can stall a queue.
import { describe, expect, it } from "vitest";
import { mergeGateDoctor } from "./doctor.js";

const good = {
  requiredChecks: ["factory/merge-gate", "ci/build"],
  queueEnabled: true, delegateOnHost: true, conventionsApproved: true,
  mergeMethod: "merge" as const,
};

describe("mergeGateDoctor", () => {
  it("is quiet when everything is set up", () => {
    expect(mergeGateDoctor(good)).toEqual({ ok: true, problems: [] });
  });

  it("catches the check name missing from branch protection — nothing would ever gate", () => {
    const got = mergeGateDoctor({ ...good, requiredChecks: ["ci/build"] });
    expect(got.ok).toBe(false);
    expect(got.problems[0]).toMatch(/factory\/merge-gate.*required/);
  });

  it("catches the merge queue being off", () => {
    expect(mergeGateDoctor({ ...good, queueEnabled: false }).problems[0]).toMatch(/merge queue/i);
  });

  it("catches a missing delegate", () => {
    expect(mergeGateDoctor({ ...good, delegateOnHost: false }).problems[0]).toMatch(/Delegate/);
  });

  it("catches unapproved guidelines, because conventions.followed would fail every PR", () => {
    expect(mergeGateDoctor({ ...good, conventionsApproved: false }).problems[0]).toMatch(/guidelines/i);
  });

  it("catches a squash merge, which rewrites the gated commit", () => {
    const got = mergeGateDoctor({ ...good, mergeMethod: "squash" });
    expect(got.ok).toBe(false);
    expect(got.problems[0]).toMatch(/sha-binding|rewrites/);
  });

  it("says nothing about the merge method when it was not reported", () => {
    expect(mergeGateDoctor({ ...good, mergeMethod: undefined })).toEqual({ ok: true, problems: [] });
  });

  it("reports every problem at once, not just the first", () => {
    const got = mergeGateDoctor({
      requiredChecks: [], queueEnabled: false, delegateOnHost: false,
      conventionsApproved: false, mergeMethod: "squash",
    });
    expect(got.problems).toHaveLength(5);
  });
});
