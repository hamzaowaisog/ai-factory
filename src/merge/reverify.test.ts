// Path A: the untrusted inputs, the gate order, and replay-not-recheck.
import { describe, expect, it } from "vitest";
import { assertPrNumber, assertRepository, gateOrder, planWork } from "./reverify.js";

describe("assertRepository", () => {
  it("accepts an exact match", () => {
    expect(() => assertRepository("acme/shop", "acme/shop")).not.toThrow();
  });

  it("refuses a different repository", () => {
    expect(() => assertRepository("acme/shop", "attacker/shop")).toThrow(/does not match/);
  });

  it("does not case-fold: a crafted payload must not aim the factory's credential elsewhere", () => {
    expect(() => assertRepository("acme/shop", "ACME/shop")).toThrow(/does not match/);
  });

  it("does not substring-match, in either direction", () => {
    expect(() => assertRepository("acme/shop", "acme/shop-fork")).toThrow(/does not match/);
    expect(() => assertRepository("acme/shop", "shop")).toThrow(/does not match/);
  });

  it("refuses an empty string, a non-string and a missing value", () => {
    for (const bad of ["", 42, null, undefined, { repo: "acme/shop" }]) {
      expect(() => assertRepository("acme/shop", bad)).toThrow(/does not match/);
    }
  });
});

describe("assertPrNumber", () => {
  it("accepts a positive integer, as a number or a string", () => {
    expect(assertPrNumber(42)).toBe(42);
    expect(assertPrNumber("42")).toBe(42);
    expect(assertPrNumber(" 42 ")).toBe(42);
  });

  it("refuses zero, negatives, fractions and nonsense", () => {
    for (const bad of [0, -1, 1.5, "abc", "", null, undefined, "42; rm -rf /"]) {
      expect(() => assertPrNumber(bad)).toThrow(/positive integer/);
    }
  });
});

describe("gateOrder", () => {
  const ids = () => gateOrder().map((g) => g.id);

  it("runs checks.external-green last: a repair push restarts every external check", () => {
    expect(ids()[ids().length - 1]).toBe("checks.external-green");
  });

  it("runs the deterministic gates before any model verdict, so a broken build costs no tokens", () => {
    expect(ids().indexOf("build.clean")).toBeLessThan(ids().indexOf("review.covers-every-criterion"));
    expect(ids().indexOf("tests.expectations")).toBeLessThan(ids().indexOf("review.covers-every-criterion"));
  });

  it("includes every safety gate", () => {
    for (const id of ["build.clean", "tests.expectations", "secrets.none", "deliver.sha-binding", "review.covers-every-criterion"]) {
      expect(ids()).toContain(id);
    }
  });

  it("includes the convention and lint gates", () => {
    expect(ids()).toContain("lint.no-new-findings");
    expect(ids()).toContain("conventions.followed");
  });

  it("lists every gate once", () => {
    expect(new Set(ids()).size).toBe(ids().length);
  });
});

describe("planWork", () => {
  const recorded = new Map([
    ["build.clean", "h-build"],
    ["tests.expectations", "h-tests"],
    ["review.covers-every-criterion", "h-cov"],
  ]);

  it("replays every gate and runs nothing when no hash moved", () => {
    const got = planWork({ recorded, current: new Map(recorded) });
    expect(got.rerun).toEqual([]);
    expect(got.replay.sort()).toEqual(["build.clean", "review.covers-every-criterion", "tests.expectations"]);
  });

  it("re-runs only the gates whose inputs moved", () => {
    const got = planWork({ recorded, current: new Map([...recorded, ["build.clean", "h-build-2"]]) });
    expect(got.rerun).toEqual(["build.clean"]);
    expect(got.replay).not.toContain("build.clean");
  });

  it("runs a gate that was never recorded", () => {
    const got = planWork({ recorded, current: new Map([...recorded, ["conventions.followed", "h-conv"]]) });
    expect(got.rerun).toContain("conventions.followed");
  });

  it("--force re-runs the MODEL reviews and nothing else", () => {
    const got = planWork({ recorded, current: new Map(recorded), force: true });
    expect(got.rerun).toEqual(["review.covers-every-criterion"]);
    // re-running a deterministic gate on an identical tree cannot differ, so forcing it is waste
    expect(got.replay.sort()).toEqual(["build.clean", "tests.expectations"]);
  });

  it("records whether a run was forced, so it is distinguishable in the ledger", () => {
    expect(planWork({ recorded, current: new Map(recorded), force: true }).forced).toBe(true);
    expect(planWork({ recorded, current: new Map(recorded) }).forced).toBe(false);
  });

  it("re-runs a stale deterministic gate even without force", () => {
    const got = planWork({ recorded, current: new Map([...recorded, ["tests.expectations", "moved"]]) });
    expect(got.rerun).toEqual(["tests.expectations"]);
  });
});
