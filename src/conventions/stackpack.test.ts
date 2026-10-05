// External best practices, read from the curated skill files in .claude/skills/.
import { describe, expect, it } from "vitest";
import { parseSkillRules } from "./stackpack.js";

const DOTNET = `---
name: dotnet-best-practices
description: 'Ensure .NET/C# code meets best practices.'
---

# .NET/C# Best Practices

## Async/Await Patterns

- Use async/await for all I/O operations and long-running tasks
- Return Task or Task<T> from async methods

## Testing Standards

- Use MSTest framework with FluentAssertions for assertions
`;

const CODE_REVIEW = `---
name: code-review
---
### 3. Identify the standards sources

- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.

### 4. Spawn both sub-agents in parallel

- The full diff command and commit list.
- The path or fetched contents of the spec.
`;

describe("parseSkillRules", () => {
  it("turns each bullet into a rule carrying where it came from", () => {
    const cs = parseSkillRules(".claude/skills/dotnet-best-practices/SKILL.md", DOTNET);
    expect(cs).toHaveLength(3);
    expect(cs[0]).toMatchObject({
      rule: "Use async/await for all I/O operations and long-running tasks",
      source: "stackpack",
      status: "candidate",
      appliesTo: ["**/*.cs"],
    });
    expect(cs[0]!.id).toMatch(/^CV-/);
  });

  it("never carries a check, so an external rule is structurally unable to block", () => {
    for (const c of parseSkillRules("p/SKILL.md", DOTNET)) expect(c.check).toBeUndefined();
  });

  it("records the skill and heading, so no external claim is a bare sentence", () => {
    expect(parseSkillRules("p/SKILL.md", DOTNET).map((c) => c.exemplar))
      .toContain("dotnet-best-practices › Testing Standards");
  });

  it("gives every external rule evidence of zero: it has none in this repo", () => {
    expect(parseSkillRules("p/SKILL.md", DOTNET)[0]!.evidence)
      .toEqual({ matching: 0, total: 0, recentMatching: 0, recentTotal: 0 });
  });

  it("rejects a rule carrying an unexpanded template placeholder", () => {
    expect(() => parseSkillRules("p/SKILL.md", "---\nname: x\n---\n## S\n\n- Check ${selection} for style\n"))
      .toThrow(/placeholder/);
  });

  it("gives the same rule the same id every time, so a rebuild is comparable", () => {
    expect(parseSkillRules("p/SKILL.md", DOTNET).map((c) => c.id))
      .toEqual(parseSkillRules("p/SKILL.md", DOTNET).map((c) => c.id));
  });

  it("reads only the rule list from a skill that is mostly procedure", () => {
    const cs = parseSkillRules(".claude/skills/code-review/SKILL.md", CODE_REVIEW);
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.rule)).toEqual([
      "**Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.",
      "**Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.",
    ]);
    // the procedure's bullets are instructions to a harness, not conventions for your code
    expect(cs.some((c) => /diff command/.test(c.rule))).toBe(false);
  });

  it("reads every section of a skill that is rules throughout", () => {
    expect(parseSkillRules(".claude/skills/dotnet-best-practices/SKILL.md", DOTNET)).toHaveLength(3);
  });

  it("falls back to every file for a skill it has no entry for", () => {
    const cs = parseSkillRules("p/SKILL.md", "---\nname: something-new\n---\n## S\n\n- Keep functions short and focused\n");
    expect(cs[0]!.appliesTo).toEqual(["**/*"]);
  });

  it("skips a fragment too short to be a rule", () => {
    expect(parseSkillRules("p/SKILL.md", "---\nname: x\n---\n## S\n\n- yes\n- no\n")).toEqual([]);
  });
});
