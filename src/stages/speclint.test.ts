import { describe, expect, it } from "vitest";
import { lintSpec } from "./speclint.js";

const req = (n: number) => ({
  id: `REQ-${n}`, op: "ADDED" as const, ears: `The api shall return a list of ${n} rows`, sources: ["I-1"],
  acceptance: [{ id: `AC-${n}.1`, given: "g", when: "w", then: "the response lists 3 rows", level: "api" as const }],
});
const big = { requirements: Array.from({ length: 15 }, (_, i) => req(i + 1)), nfrs: [], outOfScope: ["nothing"], assumptions: [] } as never;
const ctx = { spans: ["I-1"], changeClass: "feature" as never, anchorOk: () => true };

describe("L9 size", () => {
  it("a build spec over 12 requirements must be split", () => {
    expect(lintSpec(big, ctx).find((l) => l.check === "L9 size")).toMatchObject({ passed: false, blocking: true });
  });
  it("an estimate prices the whole request, so size is not a defect", () => {
    expect(lintSpec(big, { ...ctx, noSizeLimit: true }).find((l) => l.check === "L9 size")!.passed).toBe(true);
  });
});
