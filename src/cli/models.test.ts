import { describe, expect, it } from "vitest";
import { mobileDesignOption } from "./models.js";

describe("--mobile-design", () => {
  it("takes true or false, and nothing else", () => {
    expect(mobileDesignOption(undefined)).toBeUndefined();
    expect(mobileDesignOption("true")).toBe(true);
    expect(mobileDesignOption("FALSE")).toBe(false);
    expect(() => mobileDesignOption("yes")).toThrow(/--mobile-design takes true or false, not "yes"/);
  });
});
