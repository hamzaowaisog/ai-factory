import { describe, expect, it } from "vitest";
import { splitModules } from "./modules.js";

const section = (n: number, chars: number) => `# Module ${n}\n\n${"The system shall do a thing. ".repeat(Math.ceil(chars / 29))}\n`;

describe("splitModules", () => {
  it("leaves a small request alone", () => {
    expect(splitModules("# One\n\nshort", 1000)).toEqual([]);
  });

  it("splits at top-level headings and keeps the document's order and every character", () => {
    const doc = [1, 2, 3, 4, 5, 6].map((n) => section(n, 400)).join("\n");
    const ms = splitModules(doc, 1000);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.map((m) => m.id)).toEqual(ms.map((_, i) => `m${i + 1}`));
    expect(ms.map((m) => m.text).join("\n").trim()).toBe(doc.trim());
    for (const m of ms) expect(m.text.length).toBeLessThanOrEqual(1000 + 50);
  });

  it("is deterministic", () => {
    const doc = [1, 2, 3, 4].map((n) => section(n, 600)).join("\n");
    expect(splitModules(doc, 1000)).toEqual(splitModules(doc, 1000));
  });

  it("cuts one huge section at paragraph breaks", () => {
    const doc = "# Big\n\n" + Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ${"x".repeat(100)}`).join("\n\n");
    const ms = splitModules(doc, 800);
    expect(ms.length).toBeGreaterThan(2);
    expect(ms.every((m) => m.text.length <= 800)).toBe(true);
  });

  it("ignores # lines inside code fences and handles a document with no headings", () => {
    const doc = "```\n# not a heading\n```\n" + "plain text ".repeat(300);
    const ms = splitModules(doc, 1000);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.every((m) => m.text.length <= 1000)).toBe(true);
  });
});
