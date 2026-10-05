// The guidelines file: one Markdown document, read by an LLM reviewer and parsed back by the gate.
import { describe, expect, it } from "vitest";
import { parseGuidelines, renderGuidelines } from "./markdown.js";
import type { Convention } from "../contracts/index.js";

const mined: Convention = {
  id: "CV-a1b2", appliesTo: ["src/**/*.cs"], rule: "No raw SQL strings — use the repository",
  exemplar: "src/Orders/OrderRepo.cs:34",
  evidence: { matching: 40, total: 41, recentMatching: 12, recentTotal: 12 },
  status: "confirmed", source: "mined", check: { tool: "grep", ref: "SELECT\\s" },
};
const minedNoCheck: Convention = {
  id: "CV-c3d4", appliesTo: ["src/**/*.cs"], rule: "Services are named after the aggregate they own",
  exemplar: "src/Orders/OrderService.cs:1",
  evidence: { matching: 39, total: 40, recentMatching: 11, recentTotal: 12 },
  status: "mixed", source: "mined",
};
const toolCfg: Convention = {
  id: "CV-e5f6", appliesTo: ["**/*"], rule: "Follow the analyzer settings this repo declares in .editorconfig",
  exemplar: ".editorconfig",
  evidence: { matching: 1, total: 1, recentMatching: 1, recentTotal: 1 },
  status: "confirmed", source: "tool-config", check: { tool: "roslyn", ref: ".editorconfig" },
};
const external: Convention = {
  id: "CV-i9j0", appliesTo: ["**/*.cs"], rule: "Use async/await for all I/O operations",
  exemplar: "dotnet-best-practices › Async/Await Patterns",
  evidence: { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
  status: "candidate", source: "stackpack",
};
const conflict = { a: "CV-m3n4", b: "CV-a1b2", why: 'names "mstest"; this repo uses "xunit" (41/43 files)' };

const ALL = [mined, minedNoCheck, toolCfg, external];
const md = (cs = ALL, conflicts = [conflict]) =>
  renderGuidelines({ project: "shop", builtAt: "2026-10-05", conventions: cs, conflicts });

describe("renderGuidelines", () => {
  it("separates what the repo does from what an outside skill says", () => {
    const t = md();
    expect(t.indexOf("## 1. What this repository already does")).toBeLessThan(t.indexOf("## 3. External"));
    expect(t).toMatch(/advisory only, never block/);
  });

  it("shows a real example from the repo for every mined rule", () => {
    expect(md()).toMatch(/src\/Orders\/OrderRepo\.cs:34/);
  });

  it("shows the evidence count, so a rule is a fact and not an opinion", () => {
    expect(md()).toMatch(/40\/41/);
  });

  it("puts every conflict in its own section with the reason spelled out", () => {
    const t = md();
    expect(t).toMatch(/## 4\. Conflicts/);
    expect(t).toMatch(/CV-m3n4/);
    expect(t).toMatch(/mstest/);
  });

  it("says None when there are no conflicts, rather than leaving the section blank", () => {
    expect(md(ALL, [])).toMatch(/## 4\. Conflicts\n\nNone\./);
  });

  it("carries the build date and the approval command", () => {
    expect(md()).toMatch(/<!-- factory-conventions v1 · built 2026-10-05/);
    expect(md()).toMatch(/factory conventions approve --project shop/);
  });

  it("gives the external table no Check column at all", () => {
    const section3 = md().split("## 3. External")[1]!.split("## 4.")[0]!;
    expect(section3).not.toMatch(/\bCheck\b/);
  });
});

describe("parseGuidelines", () => {
  it("reads back exactly what was written — one source of truth, no second copy", () => {
    const got = parseGuidelines(md());
    expect(got.conventions).toEqual(ALL);
    expect(got.conflicts).toEqual([conflict]);
  });

  it("round-trips a rule containing a pipe, which would otherwise break the table", () => {
    const piped: Convention = { ...mined, id: "CV-pipe", rule: "Prefer a ?? b over a || b" };
    expect(parseGuidelines(md([piped], [])).conventions).toEqual([piped]);
  });

  it("round-trips a check pattern containing a pipe", () => {
    const rx: Convention = { ...mined, id: "CV-rx", check: { tool: "grep", ref: "SELECT|INSERT" } };
    expect(parseGuidelines(md([rx], [])).conventions[0]!.check).toEqual({ tool: "grep", ref: "SELECT|INSERT" });
  });

  it("survives a person editing the prose around the tables", () => {
    const edited = md().replace("**Nothing uses this file until a person approves it.**", "We reviewed this on Monday.");
    expect(parseGuidelines(edited).conventions).toEqual(ALL);
  });

  it("keeps a rule a person edited by hand", () => {
    const edited = md().replace("No raw SQL strings — use the repository", "No raw SQL anywhere, ever");
    expect(parseGuidelines(edited).conventions[0]!.rule).toBe("No raw SQL anywhere, ever");
  });

  it("does not let a person promote a candidate to confirmed by editing the visible table", () => {
    // status travels in an HTML comment, not in a column, so the visible table cannot change it
    const got = parseGuidelines(md([external], []));
    expect(got.conventions[0]!.status).toBe("candidate");
  });

  it("throws rather than returning an empty set when the file is malformed", () => {
    expect(() => parseGuidelines("# Coding guidelines — shop\n\nsomebody deleted the tables\n"))
      .toThrow(/no rule tables/);
  });

  it("reads no conflicts from a file that says None", () => {
    expect(parseGuidelines(md(ALL, [])).conflicts).toEqual([]);
  });
});
