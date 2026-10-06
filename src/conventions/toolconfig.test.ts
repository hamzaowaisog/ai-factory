// Rules drawn from what the repository declares about itself.
import { describe, expect, it } from "vitest";
import { fromToolConfig } from "./toolconfig.js";

const has = (...files: string[]) => (p: string) => files.includes(p);

describe("fromToolConfig", () => {
  it("makes a confirmed rule for each config file the repo has", () => {
    const got = fromToolConfig(has(".editorconfig"));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ source: "tool-config", status: "confirmed", exemplar: ".editorconfig" });
    expect(got[0]!.rule).toMatch(/\.editorconfig/);
  });

  it("returns nothing for a repo that declares nothing", () => {
    expect(fromToolConfig(has())).toEqual([]);
  });

  it("names the analyzer that enforces it, never a grep pattern", () => {
    // these are enforced by the analyzer and reach the gate through LintRun, so conventions.followed
    // must never try to evaluate them itself
    for (const c of fromToolConfig(has(".editorconfig", "stylecop.json", ".eslintrc.json"))) {
      expect(c.check!.tool).not.toBe("grep");
    }
  });

  it("scopes C#-only config to C# files, and editorconfig to everything", () => {
    const got = fromToolConfig(has(".editorconfig", "stylecop.json"));
    expect(got.find((c) => c.exemplar === ".editorconfig")!.appliesTo).toEqual(["**/*"]);
    expect(got.find((c) => c.exemplar === "stylecop.json")!.appliesTo).toEqual(["**/*.cs"]);
  });

  it("gives the same file the same id every time, so a rebuild is comparable", () => {
    expect(fromToolConfig(has(".editorconfig"))[0]!.id).toBe(fromToolConfig(has(".editorconfig"))[0]!.id);
  });

  it("gives different files different ids", () => {
    const got = fromToolConfig(has(".editorconfig", "stylecop.json"));
    expect(got[0]!.id).not.toBe(got[1]!.id);
  });

  it("counts the declaration itself as the evidence", () => {
    expect(fromToolConfig(has(".editorconfig"))[0]!.evidence)
      .toEqual({ matching: 1, total: 1, recentMatching: 1, recentTotal: 1 });
  });
});
