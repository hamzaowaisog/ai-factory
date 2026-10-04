import { describe, expect, it } from "vitest";
import { decideRework, patchedSinceRedraw, reworkCardLines, type DesignLike, type Triage } from "./design-rework.js";

const screen = (id: string, title = id) => ({ id, route: `/${id}`, file: `${id}.tsx`, reqs: ["R-1"], mock: { title, blocks: [{ type: "text" }] } });
const design = (n: number, rework: DesignLike["rework"] = []): DesignLike => ({ screens: Array.from({ length: n }, (_, i) => screen(`S-${i + 1}`)), rework });
const it1 = (o: object = {}) => ({ part: "screen" as const, screen: "S-1", quote: "q", change: "c", confidence: "high" as const, ...o });
const tri = (o: Partial<Triage> = {}): Triage => ({ verdict: "patch", summary: "s", items: [it1()], fine: [], notDesign: [], ...o });

describe("deciding between a patch and a redraw", () => {
  it("patches one named page of several", () => {
    expect(decideRework(tri(), design(4))).toMatchObject({ mode: "patch", look: false, screens: ["S-1"] });
  });
  it("patches the look together with a page", () => {
    expect(decideRework(tri({ items: [it1({ part: "look", screen: undefined }), it1()] }), design(5))).toMatchObject({ mode: "patch", look: true, screens: ["S-1"] });
  });
  it("redraws on structure, a guess, an unknown page, or nothing pinned down", () => {
    expect(decideRework(tri({ verdict: "redraw" }), design(4))).toEqual({ mode: "redraw", why: "structure" });
    expect(decideRework(tri({ items: [it1({ confidence: "low" })] }), design(4))).toEqual({ mode: "redraw", why: "vague" });
    expect(decideRework(tri({ items: [it1({ screen: "S-99" })] }), design(4))).toEqual({ mode: "redraw", why: "vague" });
    expect(decideRework(tri({ items: [] }), design(4))).toEqual({ mode: "redraw", why: "vague" });
  });
  it("redraws when most pages are touched", () => {
    expect(decideRework(tri({ items: [it1(), it1({ screen: "S-2" }), it1({ screen: "S-3" })] }), design(5))).toEqual({ mode: "redraw", why: "wide" });
    expect(decideRework(tri(), design(1))).toEqual({ mode: "redraw", why: "wide" });
  });
  it("redraws a part that was already patched since the last redraw", () => {
    const r = (mode: "patch" | "redraw", patched: string[]) => ({ round: 1, mode, patched, lines: [], kept: [], notDesign: [], fine: [] });
    expect(decideRework(tri(), design(4, [r("patch", ["S-1"])]))).toEqual({ mode: "redraw", why: "repeat" });
    expect(decideRework(tri(), design(4, [r("patch", ["S-1"]), r("redraw", [])]))).toMatchObject({ mode: "patch" });
    expect([...patchedSinceRedraw([r("patch", ["look"]), r("patch", ["S-2"])])].sort()).toEqual(["S-2", "look"]);
  });
  it("draws nothing when the note is only about something no requirement covers", () => {
    expect(decideRework(tri({ items: [], notDesign: [{ quote: "q", why: "w" }] }), design(4))).toEqual({ mode: "none" });
  });
  it("shows the lead page titles, not ids", () => {
    const d = { ...design(2), rework: [{ round: 1, mode: "patch" as const, patched: ["S-1"], lines: ["Book your flight: calmer (you said: \"crowded\")"], kept: ["My trips"], notDesign: [], fine: [] }] };
    const text = reworkCardLines(d).join("\n");
    expect(text).toContain("Book your flight");
    expect(text).toContain("Kept exactly as before: My trips.");
    expect(text).not.toMatch(/S-\d/);
    expect(reworkCardLines(design(2))).toEqual([]);
  });
});

describe("keeping the pages a lead called fine", () => {
  it("restores a fine page exactly and carries the earlier theme when the patch leaves it out", async () => {
    const { keepFine } = await import("./design.js");
    const old = { ...screen("S-1", "Flights"), states: ["empty"] };
    const out = { flow: "f", screens: [screen("S-1", "Changed"), screen("S-2", "Changed too")] };
    const theme = { brand: "#0a84ff" };
    const r = keepFine(out as never, ["S-1"], { flow: "f", screens: [old] } as never, theme as never);
    expect(r.screens[0]).toEqual(old);
    expect(r.screens[1]).toMatchObject({ mock: { title: "Changed too" } });
    expect((r as { theme?: unknown }).theme).toEqual(theme);
  });
});
