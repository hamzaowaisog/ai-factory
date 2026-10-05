// Bounded repair, on path A only, behind four guards.
import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, MAX_ATTEMPTS_PER_PR, mayRepair, REPAIR_LADDER, repairPlan } from "./repair.js";

const now = Date.parse("2026-10-05T12:00:00Z");
const base = { path: "A" as const, attemptsThisRun: 0, attemptsThisPr: 0, now };

describe("the repair budget", () => {
  it("is two attempts, one per rung — not the default six across four rungs", () => {
    expect(REPAIR_LADDER).toEqual({ maxAttempts: 2, attemptsPerRung: 1 });
  });

  it("allows the first attempt", () => {
    expect(mayRepair(base)).toEqual({ ok: true });
  });

  it("allows the second, then stops", () => {
    expect(mayRepair({ ...base, attemptsThisRun: 1 })).toEqual({ ok: true });
    expect(mayRepair({ ...base, attemptsThisRun: 2 })).toEqual({ ok: false, why: expect.stringMatching(/2 repair attempts in this run/) });
  });

  it("caps attempts per pull request across runs: two runs of two is four pushes", () => {
    expect(mayRepair({ ...base, attemptsThisPr: MAX_ATTEMPTS_PER_PR }))
      .toEqual({ ok: false, why: expect.stringMatching(/this pull request/) });
  });

  it("NEVER repairs on path B: pushing to a queued branch ejects it", () => {
    expect(mayRepair({ ...base, path: "B" })).toEqual({ ok: false, why: expect.stringMatching(/queue/) });
  });

  it("refuses on path B even with budget to spare — the path decides, not the budget", () => {
    expect(mayRepair({ path: "B", attemptsThisRun: 0, attemptsThisPr: 0, now }).ok).toBe(false);
  });

  it("holds a burst of pushes behind the cooldown", () => {
    expect(mayRepair({ ...base, lastRunAt: now - 30_000 })).toEqual({ ok: false, why: expect.stringMatching(/Cooldown/) });
    expect(mayRepair({ ...base, lastRunAt: now - COOLDOWN_MS - 1 })).toEqual({ ok: true });
  });

  it("checks the path before the budget, so the reason given is the real one", () => {
    const got = mayRepair({ path: "B", attemptsThisRun: 9, attemptsThisPr: 9, lastRunAt: now, now });
    expect(got).toEqual({ ok: false, why: expect.stringMatching(/queue/) });
  });
});

describe("repairPlan", () => {
  it("a conflict is resolved in a worktree and then FULLY re-verified", () => {
    const p = repairPlan("conflict");
    expect(p.action).toBe("merge-base-into-branch");
    expect(p.thenFullVerification).toBe(true);
  });

  it("a broken merge runs the implement loop against the already-locked tests", () => {
    const p = repairPlan("broken-merge");
    expect(p.action).toBe("implement-loop");
    expect(p.testsLocked).toBe(true);
  });

  it("re-binds sha-binding after any repair, never bypassing it", () => {
    for (const cls of ["conflict", "broken-merge"] as const) {
      expect(repairPlan(cls).after).toContain("rebind-sha-binding");
      expect(repairPlan(cls).after).toContain("update-evidence-manifest");
      expect(repairPlan(cls).after).toContain("mark-repair-commit");
    }
  });

  it("evaluates external checks last: a repair push restarts them all", () => {
    const after = repairPlan("conflict").after;
    expect(after[after.length - 1]).toBe("evaluate-external-checks");
  });

  it("marks the repair commit before evaluating anything external", () => {
    const after = repairPlan("broken-merge").after;
    expect(after.indexOf("mark-repair-commit")).toBeLessThan(after.indexOf("evaluate-external-checks"));
  });
});
