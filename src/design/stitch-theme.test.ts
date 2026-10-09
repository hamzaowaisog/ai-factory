import { describe, expect, it } from "vitest";
import { DesignTheme } from "../contracts/artifacts.js";
import { stitchThemeToDesign } from "./stitch-theme.js";

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
