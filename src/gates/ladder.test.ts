import { describe, expect, it } from "vitest";
import { DEFAULT_LADDER, nextOnFailure, rungKind, type AttemptRecord, type Rung } from "./ladder.js";

const opts = (avail: Rung[], modelSteps?: number) => ({
  ...DEFAULT_LADDER, availableRungs: new Set<Rung>(avail), backoffSpentMs: 0, a5Done: new Set<string>(), ...(modelSteps ? { modelSteps } : {}),
});
const at = (rung: number, n: number): AttemptRecord => ({ category: "other", signature: `fail-${rung}-${n}`, rung });

describe("rung kinds", () => {
  it("keeps today's numbering with one model step", () => {
    expect([0, 1, 2, 3, 4].map((n) => rungKind(n))).toEqual(["retry", "raise-effort", "stronger-model", "other-vendor", undefined]);
  });
  it("gives each extra model step its own stronger-model rung", () => {
    expect([2, 3, 4, 5].map((n) => rungKind(n, 2))).toEqual(["stronger-model", "stronger-model", "other-vendor", undefined]);
  });
});

describe("a tier ladder", () => {
  const tiers = opts(["retry", "stronger-model"], 2);

  it("moves to the first model step after two failures on the start tier", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2)], tiers)).toMatchObject({ action: "retry", rung: 2 });
  });

  it("moves to the second model step after two failures on the first", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2), at(2, 1), at(2, 2)], tiers)).toMatchObject({ action: "retry", rung: 3 });
  });

  it("parks after the top model fails twice", () => {
    expect(nextOnFailure([at(0, 1), at(0, 2), at(2, 1), at(2, 2), at(3, 1), at(3, 2)], tiers)).toMatchObject({ action: "park" });
  });

  it("climbs exactly as before without modelSteps", () => {
    const today = opts(["retry", "raise-effort", "stronger-model"]);
    expect(nextOnFailure([at(0, 1), at(0, 2)], today)).toMatchObject({ rung: 1 });
    expect(nextOnFailure([at(0, 1), at(0, 2), at(1, 1), at(1, 2)], today)).toMatchObject({ rung: 2 });
  });
});
