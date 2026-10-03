import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findChromium } from "../screenshots.js";
import { ARCHETYPES, INDUSTRIES } from "./data.js";
import { allIndustries, archetypeBrief, briefFor, cueBrief, fieldOf, requirementCues, loadMeasured, loadUserIndustries, matchIndustries, pickIndustries, referenceBrief, resolveBrand, saveMeasured } from "./index.js";
import { measureBrands } from "./measure.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "refs-")); dirs.push(d); return d; };

describe("reference data", () => {
  it("has unique industry and brand ids and enough brands each", () => {
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(INDUSTRIES.length);
    const brands = INDUSTRIES.flatMap((i) => i.brands.map((b) => b.id));
    expect(new Set(brands).size).toBe(brands.length);
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(20);
    for (const i of INDUSTRIES) expect(ARCHETYPES.some((a) => a.id === i.archetype)).toBe(true);
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

describe("brief variation", () => {
  const air = INDUSTRIES.find((i) => i.id === "airline")!;
  it("is the same for the same requirement and differs in lead example across requirements", () => {
    const a = referenceBrief([air], {}, "requirement one");
    expect(referenceBrief([air], {}, "requirement one")).toBe(a);
    const leads = new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].map((t) => /\(lead\) ([^:]+):/.exec(referenceBrief([air], {}, t))![1]));
    expect(leads.size).toBeGreaterThan(1);
    expect(a).toContain("change at least two of them");
  });
});

describe("brief", () => {
  it("stays small and tells the model not to copy a brand", () => {
    const b = referenceBrief([INDUSTRIES.find((i) => i.id === "airline")!], {});
    expect(b).toContain("Delta");
    expect(b).toContain("do not reuse any one brand's exact value");
    expect(b.length).toBeLessThan(2400);
  });
  it("falls back to the look families when no field matches, so any field is covered", () => {
    const b = briefFor("A museum audio guide with exhibits and a gift shop map");
    expect(b).toContain("No listed field matched");
    for (const a of ARCHETYPES) expect(b).toContain(a.label);
    expect(b.length).toBeLessThan(3000);
  });
  it("covers hospitals and supermarkets by name", () => {
    expect(pickIndustries("Nurses see the ward list, triage level and discharge status for each patient")[0]?.industry.id).toBe("health");
    expect(pickIndustries("Shoppers fill a basket from supermarket aisles and pick a click and collect slot")[0]?.industry.id).toBe("grocery");
  });
  it("hints at a weak single-keyword match", () => {
    expect(archetypeBrief(INDUSTRIES.find((i) => i.id === "grocery"))).toContain("Weak hint");
  });
});

describe("your own industries", () => {
  const mine = { id: "museum", label: "Museums", archetype: "hospitality", keywords: ["museum", "exhibit", "gallery", "curator"],
    brands: [1, 2, 3].map((n) => ({ id: `m${n}`, name: `M${n}`, site: "https://example.com", brand: "#112233", chrome: "plain", radius: "soft", trait: "quiet" })),
    pattern: "Quiet editorial pages.", usual: { mode: "light", chrome: "plain", neutral: "warm", font: "serif", radius: "sharp", density: "comfortable", surface: "flat" } };
  it("loads valid files, reports bad ones, and matches them", () => {
    const d = tmp();
    writeFileSync(join(d, "museum.json"), JSON.stringify(mine));
    writeFileSync(join(d, "bad.json"), JSON.stringify({ id: "x" }));
    const r = loadUserIndustries(d);
    expect(r.industries.map((i) => i.id)).toEqual(["museum"]);
    expect(r.problems.length).toBe(1);
    const all = allIndustries(d);
    expect(briefFor("The museum shows each exhibit and the curator note", all)).toContain("Museums");
  });
  it("lets one of yours replace a built-in with the same id", () => {
    const d = tmp();
    writeFileSync(join(d, "a.json"), JSON.stringify({ ...mine, id: "airline" }));
    expect(allIndustries(d).filter((i) => i.id === "airline")).toHaveLength(1);
    expect(allIndustries(d).find((i) => i.id === "airline")?.label).toBe("Museums");
  });
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

describe("trusting a live reading", () => {
  const b = { id: "x", name: "X", site: "https://x.example", brand: "#d71921", mode: "light" } as never;
  it("keeps a reading near the reported brand and drops a cookie banner's blue", async () => {
    const { plausible } = await import("./measure.js");
    expect(plausible({ brand: "#c8102e" } as never, b)).toBe(true);
    expect(plausible({ brand: "#1a73e8" } as never, b)).toBe(false);
  });
  it("accepts a real rebrand when the page agrees with itself", async () => {
    const { plausible } = await import("./measure.js");
    expect(plausible({ brand: "#1a73e8", themeColor: "#1a73e8", buttonBg: "#1b74e9" } as never, b)).toBe(true);
  });
});

describe("the brief follows the product, not only its field", () => {
  const patients = "Patients book an appointment at the clinic and see their symptoms history. Older users and caregivers manage it for them.";
  const office = "Clinic back office staff and administrators manage the patient appointment calendar and run daily reports.";
  it("names the field each product belongs to", () => {
    expect(fieldOf(patients)).toBe("health");
    expect(fieldOf("a todo list")).toBe("");
  });
  it("reads who uses it and in what mood from the requirement words", () => {
    expect(requirementCues(patients).map((c) => c.id)).toEqual(["older", "anxious"]);
    expect(requirementCues(office).map((c) => c.id)).toEqual(["desk-all-day"]);
    expect(requirementCues(office)[0]!.word).toBe("back office");
    expect(cueBrief("a todo list")).toBe("");
  });
  it("gives two products in one field different briefs because of those words", () => {
    const a = briefFor(patients), b = briefFor(office);
    expect(a).toContain('"older users": older users: large text');
    expect(a).not.toContain("staff at a desk all day");
    expect(b).not.toContain("may be worried");
    expect(b).toContain("staff at a desk all day");
    expect(b).toContain("Signals in THIS product's requirements");
  });
  it("adds the signals when no field is clear too", () => {
    expect(briefFor("Drivers record each delivery on the go and see their streaks")).toContain("phone first, big touch targets");
  });
  it("keeps the list short", () => {
    expect(requirementCues("kids elderly drivers back office premium emergency patients students wallet feed b2b night offline rewards")).toHaveLength(6);
  });
});
