import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCases, score, type DecideRow } from "./run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const row = (caseId: string, pick: string, confidence: number): DecideRow => ({ caseId, pair: "fake", record: { adapter: "fake", answers: [{ id: "maturity", pick, confidence }], dropped: [], ms: 0, costUsd: 0 } });

describe("the decide bench", () => {
  it("takes one case per distinct request from the ledgers, then the written ones", () => {
    const cases = loadCases(join(HERE, "..", "..", "ledgers"), join(HERE, "cases"));
    const fromLedger = cases.filter((c) => c.from === "ledger");
    expect(fromLedger.length).toBeGreaterThan(0);
    expect(new Set(fromLedger.map((c) => JSON.stringify(c.state))).size).toBe(fromLedger.length);
    expect(fromLedger.every((c) => c.state.spans.length > 0)).toBe(true);
    expect(cases.filter((c) => c.from === "written").map((c) => c.id)).toContain("written-casual-todo-idea");
  });

  it("scores picks against the labels and counts a confident wrong \"full spec\"", () => {
    const labels = { a: { maturity: "full spec" }, b: { maturity: "casual idea" }, c: { maturity: "partial spec" } };
    expect(score([row("a", "full spec", 0.9), row("b", "full spec", 0.9), row("c", "full spec", 0.5), row("unlabelled", "full spec", 0.9)], labels))
      .toEqual([{ pair: "fake", question: "maturity", right: 1, labelled: 3, confidentWrongFullSpec: 1 }]);
  });
});
