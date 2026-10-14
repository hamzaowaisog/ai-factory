import { describe, expect, it } from "vitest";
import { anthropicUserContent } from "./api.js";

describe("caching the head of the briefing", () => {
  it("splits the user message at the stable head and marks it for caching", () => {
    expect(anthropicUserContent("HEAD\n\nTAIL", [], 4)).toEqual([
      { type: "text", text: "HEAD", cache_control: { type: "ephemeral" } },
      { type: "text", text: "\n\nTAIL" },
    ]);
  });
  it("leaves a message alone with no head to cache, or nothing after it", () => {
    expect(anthropicUserContent("ALL", [], 0)).toBe("ALL");
    expect(anthropicUserContent("ALL", [])).toBe("ALL");
    expect(anthropicUserContent("ALL", [], 3)).toBe("ALL");
  });
});
