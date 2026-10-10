// The rules the implementer is shown: only those for its files, and never one the repository contradicts.
import { describe, expect, it } from "vitest";
import { BRIEF_RULES_MAX, guidelinesBrief, rulesFor } from "./brief.js";
import { renderGuidelines } from "./markdown.js";
import type { Convention } from "../contracts/index.js";

const c = (p: Partial<Convention>): Convention => ({
  id: "CV-1", appliesTo: ["**/*.cs"], rule: "A rule long enough to keep", exemplar: "dotnet-best-practices › Testing",
  evidence: { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
  status: "candidate", source: "stackpack", ...p,
});
const mined = (id: string, rule: string, over: Partial<Convention> = {}) => c({
  id, rule, source: "mined", status: "confirmed", exemplar: "src/Orders/OrderRepo.cs:34",
  evidence: { matching: 41, total: 43, recentMatching: 12, recentTotal: 13 }, ...over,
});
const approved = (conventions: Convention[], conflicts: { a: string; b: string; why: string }[] = []) =>
  ({ conventions, markdown: renderGuidelines({ project: "shop", builtAt: "2026-10-11", conventions, conflicts }) });

describe("rulesFor", () => {
  it("keeps the rules for the task's files and drops the rest", () => {
    const a = approved([mined("CV-cs", "Services take a CancellationToken"), mined("CV-ts", "Components are function components", { appliesTo: ["**/*.tsx"] })]);
    expect(rulesFor(a, ["src/Orders/OrderService.cs"]).repo.map((x) => x.id)).toEqual(["CV-cs"]);
    expect(rulesFor(a, ["web/src/Orders.tsx"]).repo.map((x) => x.id)).toEqual(["CV-ts"]);
  });

  it("rules nothing out for a folder or a pattern, which could hold any kind of file", () => {
    const a = approved([mined("CV-cs", "Services take a CancellationToken")]);
    expect(rulesFor(a, ["src/Orders/"]).repo).toHaveLength(1);
    expect(rulesFor(a, ["src/**"]).repo).toHaveLength(1);
  });

  it("leaves out an outside rule the repository contradicts", () => {
    const a = approved(
      [c({ id: "CV-ext", rule: "Use MSTest framework for unit tests" }), c({ id: "CV-ok", rule: "Prefer async all the way down" }), mined("CV-mined", "Tests use xunit")],
      [{ a: "CV-ext", b: "CV-mined", why: 'names "mstest"; this repo uses "xunit" (41/43 files)' }],
    );
    expect(rulesFor(a, ["src/A.cs"]).outside.map((x) => x.id)).toEqual(["CV-ok"]);
  });

  it("leaves out a mixed rule: the repository has no settled practice to follow", () => {
    const a = approved([mined("CV-mixed", "Tests use xunit", { status: "mixed" })]);
    expect(rulesFor(a, ["src/A.cs"])).toEqual({ repo: [], outside: [] });
  });
});

describe("guidelinesBrief", () => {
  it("is absent when no rule applies to the files", () => {
    expect(guidelinesBrief(approved([mined("CV-cs", "Services take a CancellationToken")]), ["web/src/Orders.tsx"])).toBeUndefined();
  });

  it("shows the repository's rules with their example, then outside advice as advice", () => {
    const b = guidelinesBrief(approved([
      c({ id: "CV-ext", rule: "Prefer async all the way down" }),
      mined("CV-mined", "Services take a CancellationToken"),
      mined("CV-cfg", "Nullable reference types are on", { source: "tool-config", exemplar: "Directory.Build.props" }),
    ]), ["src/A.cs"])!;
    expect(b.text).toContain("- Services take a CancellationToken (example: src/Orders/OrderRepo.cs:34)");
    expect(b.text).toContain("- Nullable reference types are on (declared in Directory.Build.props)");
    expect(b.text.indexOf("Services take")).toBeLessThan(b.text.indexOf("Prefer async"));
    expect(b.text).toMatch(/the code wins:\n- Prefer async all the way down$/);
    expect(b).toMatchObject({ shown: 3, cut: 0 });
  });

  it("cuts outside advice first when there are too many rules", () => {
    const many = Array.from({ length: BRIEF_RULES_MAX + 5 }, (_, i) => c({ id: `CV-e${i}`, rule: `Outside rule number ${i} here` }));
    const b = guidelinesBrief(approved([...many, mined("CV-mined", "Services take a CancellationToken")]), ["src/A.cs"])!;
    expect(b).toMatchObject({ shown: BRIEF_RULES_MAX, cut: 6 });
    expect(b.text).toContain("Services take a CancellationToken");
  });
});
