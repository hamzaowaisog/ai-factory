import { describe, expect, it } from "vitest";
import { listText, refusal, SUITES } from "./eval.js";

describe("npm run eval", () => {
  it("lists every suite as free or paid with an estimate, and refuses a paid run without --max-cost", () => {
    expect(SUITES.map((s) => s.name)).toEqual(["gates", "calibrate", "spec", "ripple", "e2e", "runs", "publish"]);
    expect(listText()).toMatch(/e2e\s+free or paid[\s\S]*cost: about \$2-3 per factory run.*\(estimate\)/);
    const e2e = SUITES.find((s) => s.name === "e2e")!;
    expect(refusal(e2e, ["run", "--spend"])).toMatch(/add --max-cost/);
    expect(refusal(e2e, ["run", "--spend", "--max-cost", "0"])).toMatch(/add --max-cost/);
    expect(refusal(e2e, ["run", "--spend", "--max-cost", "6"])).toBeUndefined();
    expect(refusal(e2e, ["run", "--fake"])).toBeUndefined();
    expect(refusal(SUITES.find((s) => s.name === "gates")!, ["--spend"])).toBeUndefined();
  });
});
