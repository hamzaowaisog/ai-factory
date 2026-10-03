import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appsFit } from "../stages/design.js";
import { lookBrief, lookGap, lookKey, lookOf, lookRepeats, loadLooks, MIN_LOOK_GAP, readingFit, recentLooks, recordLook, RECENT_LOOKS, SAME_FIELD_LOOKS } from "./looks.js";

const reading = { users: "travellers", context: "on the move", device: "web" as const, tone: "warm", hero: "the boarding pass", traits: ["photo-led", "calm"] };
const t = (o: object = {}) => ({ mood: "warm", brand: "#C21F3A", mode: "light", shell: "topbar", font: "sans", radius: "soft", surface: "soft", hero: "band", charts: "soft", imagery: "golden", neutral: "warm", chrome: "brand", reading, ...o }) as never;
const file = () => join(mkdtempSync(join(tmpdir(), "looks-")), "design-looks.json");

describe("each product its own look", () => {
  it("scores how far two looks are apart: colour family counts 2, each axis 1", () => {
    expect(lookGap(lookOf("a", t()), lookOf("b", t())).gap).toBe(0);
    expect(lookGap(lookOf("a", t()), lookOf("b", t({ brand: "#1F6FEB" }))).gap).toBe(2);
    expect(lookGap(lookOf("a", t()), lookOf("b", t({ shell: "sidebar", font: "serif" }))).gap).toBe(2);
  });
  it("records approved looks, one per project, and lists the latest other ones newest first", () => {
    const f = file();
    recordLook("bank", t({ brand: "#0A3D91" }), f, "2026-01-01");
    recordLook("air", t(), f, "2026-02-01");
    recordLook("bank", t({ brand: "#0B5CAD" }), f, "2026-03-01");
    expect(loadLooks(f).map((l) => l.key)).toEqual(["air", "bank"]);
    expect(recentLooks("air", f).map((l) => l.brand)).toEqual(["#0B5CAD"]);
    expect(recentLooks(undefined, f).map((l) => l.key)).toEqual(["bank", "air"]);
    for (let i = 0; i < 10; i++) recordLook(`p${i}`, t(), f, `2026-04-0${i}`);
    expect(recentLooks(undefined, f)).toHaveLength(RECENT_LOOKS);
  });
  it("counts the logo mark and the heading face as part of the look", () => {
    expect(lookGap(lookOf("a", t()), lookOf("b", t({ mark: "monogram" }))).gap).toBe(1);
    expect(lookOf("a", t({ font: "book", heading: "slab" })).font).toBe("book+slab");
    expect(lookGap(lookOf("a", t({ heading: "match" })), lookOf("b", t())).gap).toBe(0);
  });
  it("reads a look recorded before marks existed as the default mark, not a different one", () => {
    const f = file();
    writeFileSync(f, JSON.stringify([{ ...lookOf("old", t()), mark: undefined }]));
    expect(loadLooks(f)[0]!.mark).toBe("glyph");
    expect(lookGap(loadLooks(f)[0]!, lookOf("new", t())).gap).toBe(0);
  });
  it("keys a look by the project name, else the run", () => {
    expect(lookKey(" Mizan Bank ", "run-1")).toBe("mizan bank");
    expect(lookKey(undefined, "run-1")).toBe("run-1");
  });
  it("rejects a look too close to a recent project's and accepts one that differs enough", () => {
    const recent = [lookOf("air", t())];
    expect(lookRepeats(t({ radius: "round" }), recent).map((p) => p.check)).toEqual(["design-look-repeat"]);
    const apart = t({ brand: "#1F6FEB", shell: "sidebar", surface: "flat" });
    expect(lookGap(lookOf("x", apart), recent[0]!).gap).toBeGreaterThanOrEqual(MIN_LOOK_GAP);
    expect(lookRepeats(apart, recent)).toEqual([]);
  });
  it("briefs the model with the recent looks, and nothing when there are none", () => {
    expect(lookBrief([])).toBe("");
    expect(lookBrief([lookOf("air", t())])).toContain("#C21F3A light, topbar frame");
  });
  it("wants a product reading, and a frame that suits its device", () => {
    expect(readingFit(t({ reading: undefined })).map((p) => p.check)).toEqual(["design-no-reading"]);
    expect(readingFit(t({ shell: "sidebar", reading: { ...reading, device: "phone" } })).map((p) => p.check)).toEqual(["design-reading-mismatch"]);
    expect(readingFit(t())).toEqual([]);
  });
});

describe("apps of one product", () => {
  const scr = (id: string, app?: string) => ({ id, app }) as never;
  it("accepts apps whose frames suit their devices and whose screens name them", () => {
    expect(appsFit({ apps: [{ id: "customer", name: "Customer", device: "phone", shell: "tabs" }, { id: "admin", name: "Admin", device: "web", shell: "sidebar" }], screens: [scr("S-1", "customer"), scr("S-2", "admin")] })).toEqual([]);
    expect(appsFit({ screens: [scr("S-1")] })).toEqual([]);
  });
  it("rejects a phone app in a sidebar, a web app with a tab bar, an unknown app, a screen with none, and an app with no screens", () => {
    const bad = appsFit({ apps: [{ id: "customer", name: "Customer", device: "phone", shell: "sidebar" }, { id: "admin", name: "Admin", device: "web", shell: "tabs" }, { id: "driver", name: "Driver", device: "phone", shell: "auto" }], screens: [scr("S-1", "customer"), scr("S-2", "admin"), scr("S-3", "rider"), scr("S-4")] });
    expect(bad.map((b) => b.message).join("\n")).toMatch(/phone app but its frame is "sidebar"[\s\S]*bottom tab bar[\s\S]*Driver app has no screens[\s\S]*"rider"[\s\S]*S-4 names no app/);
  });
  it("wants a web product's frame not to be a phone's tab bar", () => {
    expect(readingFit(t({ shell: "tabs" })).map((p) => p.check)).toEqual(["design-reading-mismatch"]);
  });
  it("also compares older projects in the same field, and says which ones share it", () => {
    const f = file();
    recordLook("clinic-a", t({ brand: "#0065A9" }), f, "2025-01-01", "health");
    recordLook("hotel-old", t(), f, "2025-01-02", "travel");
    recordLook("pharma", t(), f, "2025-01-03", "pharmacy+health");
    for (let i = 0; i < RECENT_LOOKS; i++) recordLook(`p${i}`, t(), f, `2026-04-0${i + 1}`, "retail");
    const got = recentLooks(undefined, f, "health");
    expect(got.map((l) => l.key).slice(RECENT_LOOKS)).toEqual(["pharma", "clinic-a"]);
    expect(recentLooks(undefined, f, "")).toHaveLength(RECENT_LOOKS);
    expect(recentLooks(undefined, f, "health").length).toBeLessThanOrEqual(RECENT_LOOKS + SAME_FIELD_LOOKS);
    const brief = lookBrief(got, "health");
    expect(brief).toContain("[health] #0065A9");
    expect(brief).toContain("2 of them are in this product's own field (health)");
    expect(lookBrief(got.slice(0, RECENT_LOOKS), "health")).not.toContain("own field");
    expect(loadLooks(f).find((l) => l.key === "hotel-old")!.field).toBe("travel");
  });
});
