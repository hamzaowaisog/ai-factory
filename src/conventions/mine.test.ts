// Choosing a bounded, representative sample of the codebase for the one-time scan.
import { describe, expect, it } from "vitest";
import { sampleForScan, toConventions } from "./mine.js";
import type { RepoSurvey } from "../context/survey.js";

const FILES = [
  "src/Orders/OrderService.cs", "src/Orders/OrderRepo.cs", "src/Orders/Money.cs",
  "src/Api/Program.cs", "src/Api/OrdersController.cs",
  "src/Shared/Clock.cs",
  "tests/Orders.Tests/BookingTests.cs", "tests/Orders.Tests/MoneyTests.cs",
  "README.md", "src/Orders/Orders.csproj",
];

const survey = (over: Partial<RepoSurvey> = {}): RepoSurvey => ({
  files: 900, lines: 90_000, languages: [{ name: "C#", files: 900, lines: 90_000, share: 1 }],
  manifests: [], signals: ["ASP.NET"], tests: { files: 2, ratio: 0.2, present: true },
  ci: [], containers: [], infra: false, migrations: 0, docs: ["README.md"],
  areas: [{ path: "src/Orders", files: 120 }, { path: "src/Api", files: 80 }, { path: "src/Shared", files: 40 }],
  history: {
    commits: 500, authors: 4, first: "", last: "",
    hotFiles: [{ path: "src/Orders/OrderService.cs", changes: 44 }, { path: "src/Api/Program.cs", changes: 30 }],
  },
  ...over,
});

describe("sampleForScan", () => {
  it("never returns more than the cap, however large the repo", () => {
    expect(sampleForScan(FILES, survey(), 3)).toHaveLength(3);
  });

  it("puts the most-changed files first: that is where the living conventions are", () => {
    expect(sampleForScan(FILES, survey(), 10)[0]).toBe("src/Orders/OrderService.cs");
  });

  it("covers every major area, not just the biggest one", () => {
    const got = sampleForScan(FILES, survey(), 10).join(" ");
    for (const area of ["src/Orders", "src/Api", "src/Shared"]) expect(got).toContain(area);
  });

  it("includes a test file, so test conventions are mined too", () => {
    expect(sampleForScan(FILES, survey(), 10).some((p) => /Tests/.test(p))).toBe(true);
  });

  it("is deterministic: the same inputs give the same sample", () => {
    expect(sampleForScan(FILES, survey(), 8)).toEqual(sampleForScan(FILES, survey(), 8));
  });

  it("skips files that are not source: a README teaches nothing about code style", () => {
    const got = sampleForScan(FILES, survey(), 20);
    expect(got).not.toContain("README.md");
    expect(got).not.toContain("src/Orders/Orders.csproj");
  });

  it("ignores a hot file that is no longer in the tree", () => {
    const s = survey({ history: { commits: 1, authors: 1, first: "", last: "", hotFiles: [{ path: "src/Deleted.cs", changes: 99 }] } });
    expect(sampleForScan(FILES, s, 20)).not.toContain("src/Deleted.cs");
  });

  it("works on a repo with no history at all", () => {
    expect(sampleForScan(FILES, survey({ history: undefined }), 5).length).toBeGreaterThan(0);
  });

  it("returns nothing rather than throwing on an empty repo", () => {
    expect(sampleForScan([], survey({ areas: [] }), 10)).toEqual([]);
  });
});

describe("toConventions", () => {
  const r = (over = {}) => ({
    rule: "Dependencies come in through the primary constructor", appliesTo: ["src/**/*.cs"],
    exemplar: "src/Orders/OrderService.cs:12", matching: 38, total: 40, ...over,
  });

  it("confirms a rule the code overwhelmingly follows", () => {
    expect(toConventions({ rules: [r()] })[0]).toMatchObject({ status: "confirmed", source: "mined" });
  });

  it("marks a rule the code only half follows as mixed, so it cannot block", () => {
    expect(toConventions({ rules: [r({ matching: 12, total: 40 })] })[0]).toMatchObject({ status: "mixed" });
  });

  it("only carries a check when the model supplied a pattern", () => {
    const [withRx, without] = toConventions({ rules: [
      r({ rule: "No raw SQL strings in services", grep: "SELECT\\s" }),
      r({ rule: "Services are named after the aggregate they own" }),
    ] });
    expect(withRx!.check).toEqual({ tool: "grep", ref: "SELECT\\s" });
    expect(without!.check).toBeUndefined();
  });

  it("a confirmed rule with no check still cannot block, because the gate needs a check", () => {
    const c = toConventions({ rules: [r({ matching: 39, total: 40 })] })[0]!;
    expect(c.status).toBe("confirmed");
    expect(c.check).toBeUndefined();
  });

  it("gives the same rule the same id every time, so a rebuild is comparable", () => {
    expect(toConventions({ rules: [r()] })[0]!.id).toBe(toConventions({ rules: [r()] })[0]!.id);
  });

  it("carries the model's counts through as evidence, unchanged", () => {
    expect(toConventions({ rules: [r({ matching: 7, total: 9 })] })[0]!.evidence)
      .toEqual({ matching: 7, total: 9, recentMatching: 7, recentTotal: 9 });
  });
});
