import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findChromium } from "../../estimate/screenshots.js";
import { INDUSTRIES } from "./data.js";
import { briefFor, loadMeasured, matchIndustries, pickIndustries, referenceBrief, resolveBrand, saveMeasured } from "./index.js";
import { measureBrands } from "./measure.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "refs-")); dirs.push(d); return d; };

describe("reference data", () => {
  it("has unique industry and brand ids and enough brands each", () => {
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(INDUSTRIES.length);
    const brands = INDUSTRIES.flatMap((i) => i.brands.map((b) => b.id));
    expect(new Set(brands).size).toBe(brands.length);
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(12);
    for (const i of INDUSTRIES) expect(i.brands.length).toBeGreaterThanOrEqual(3);
  });
});

describe("matching", () => {
  it("picks the airline field for an airline requirement", () => {
    const m = pickIndustries("Passengers see their flight, boarding time and baggage allowance; check-in opens 24h before.");
    expect(m[0]?.industry.id).toBe("airline");
  });
  it("matches whole words only, and one stray word is not enough", () => {
    expect(matchIndustries("a carpet shop").find((x) => x.industry.id === "mobility")).toBeUndefined();
    expect(pickIndustries("The admin can export a report")).toEqual([]);
  });
  it("adds a second industry only when it is close", () => {
    const both = pickIndustries("Hotel guests book a room and pay by card; the booking shows the balance and the transfer receipt.");
    expect(both.map((x) => x.industry.id)).toContain("travel");
    expect(pickIndustries("flights, boarding, baggage, itinerary, one payment").map((x) => x.industry.id)).toEqual(["airline"]);
  });
});

describe("brief", () => {
  it("stays small and tells the model not to copy a brand", () => {
    const b = referenceBrief([INDUSTRIES.find((i) => i.id === "airline")!], {});
    expect(b).toContain("Delta");
    expect(b).toContain("do not reuse any one brand's exact value");
    expect(b.length).toBeLessThan(2400);
  });
  it("is undefined when nothing matches", () => { expect(briefFor("a note-taking widget")).toBeUndefined(); });
});

describe("measured overlay", () => {
  it("round-trips and wins over the reported colour", () => {
    const p = join(tmp(), "m.json");
    const delta = INDUSTRIES[0]!.brands[0]!;
    saveMeasured({ [delta.id]: { brand: "#abcdef", measuredAt: "2026-01-01T00:00:00Z" } }, p);
    const m = loadMeasured(p);
    expect(resolveBrand(delta, m)).toMatchObject({ brand: "#ABCDEF", measured: true });
    expect(referenceBrief([INDUSTRIES[0]!], m)).toContain("[measured]");
    expect(resolveBrand(INDUSTRIES[0]!.brands[1]!, m).measured).toBe(false);
  });
  it("ignores a corrupt file", () => {
    const p = join(tmp(), "bad.json");
    writeFileSync(p, "{not json");
    expect(loadMeasured(p)).toEqual({});
  });
});

describe.skipIf(!findChromium())("measuring a page", () => {
  it("reads theme colour, header, button and radius from a local page", async () => {
    const d = tmp();
    const f = join(d, "site.html");
    writeFileSync(f, `<!doctype html><meta name="theme-color" content="#cc0033"><body style="margin:0;background:#fff;font-family:Georgia,serif">
      <header style="background:#003268;height:60px"></header>
      <button style="background:#e3132c;color:#fff;border:0;border-radius:6px;width:200px;height:48px">Book</button>
      <button style="background:#eee;border:0;width:300px;height:80px">Neutral</button></body>`);
    const brand = INDUSTRIES[0]!.brands[0]!;
    const r = await measureBrands([brand], { url: () => `file://${f}` });
    const x = r.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.reading).toMatchObject({ themeColor: "#cc0033", headerBg: "#003268", buttonBg: "#e3132c", buttonRadiusPx: 6, brand: "#cc0033", font: "Georgia" });
  }, 60_000);
  it("reports an unreachable site as an error row, not a crash", async () => {
    const r = await measureBrands([INDUSTRIES[0]!.brands[0]!], { url: () => "http://127.0.0.1:9/", timeoutMs: 3000 });
    expect(r.results[0]?.error).toBeTruthy();
  }, 60_000);
});
