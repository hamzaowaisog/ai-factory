import { describe, expect, it } from "vitest";
import { DesignTheme } from "../contracts/artifacts.js";
import { digestLine, MAX_DIGEST, stitchThemeToDesign } from "./stitch-theme.js";

const base = { colorMode: "LIGHT", headlineFont: "GEIST", bodyFont: "DM_SANS", roundness: "ROUND_EIGHT", customColor: "#0F766E" } as const;

describe("Stitch theme to our theme", () => {
  it("maps colour, mode, corners and fonts, and parses as a DesignTheme", () => {
    const t = stitchThemeToDesign(base, "Calm, balanced front-desk tool for a clinic");
    expect(t).toMatchObject({ brand: "#0F766E", mode: "light", radius: "soft", font: "sans", heading: "match", families: { heading: "Geist", body: "DM Sans" } });
    expect(t.mood.length).toBeLessThanOrEqual(40);
    expect(DesignTheme.safeParse(t).success).toBe(true);
  });
  it("reads serif, grotesk and full-round choices", () => {
    expect(stitchThemeToDesign({ ...base, headlineFont: "NEWSREADER", roundness: "ROUND_FULL", colorMode: "DARK" }, "x")).toMatchObject({ heading: "serif", radius: "round", mode: "dark" });
    expect(stitchThemeToDesign({ ...base, bodyFont: "SPACE_GROTESK", roundness: "ROUND_FOUR" }, "x")).toMatchObject({ font: "grotesk", radius: "sharp" });
    expect(stitchThemeToDesign({ ...base, bodyFont: "SOURCE_SERIF_FOUR", headlineFont: "SOURCE_SERIF_FOUR" }, "x")).toMatchObject({ font: "book", heading: "match", families: { body: "Source Serif 4" } });
  });
});

describe("the design system's digest in a screen's prompt", () => {
  it("is one line, nothing when there is none, and cut at the end of a sentence when long", () => {
    expect(digestLine(undefined)).toBe("");
    expect(digestLine("  ")).toBe("");
    expect(digestLine("Corners are 6 px.\nRows are 44 px high.")).toBe("\nThe design system's rules for every page; follow them, and show none of these words on the page: Corners are 6 px. Rows are 44 px high.");
    const long = digestLine(Array.from({ length: 80 }, (_, i) => `Rule ${i} holds on every page.`).join(" "));
    expect(long.length).toBeLessThan(MAX_DIGEST + 120);
    expect(long.endsWith("holds on every page.")).toBe(true);
  });
});
