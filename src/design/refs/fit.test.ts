import { describe, expect, it } from "vitest";
import { colourGap, fitRefs, themeFit } from "./fit.js";
import { designQuality } from "../../stages/design.js";
import { buildDemo } from "../demo.js";

const AIR = "Passengers search flights, see fares, manage the itinerary and baggage, and check in for boarding at the airport";
const theme = (o: object) => ({ mood: "m", brand: "#C21F3A", ...o }) as never;
const basis = [{ ref: "Delta", took: "red action" }, { ref: "United", took: "navy text" }];

describe("theme fit to the field's real products", () => {
  it("briefs an airline with real airline brands", () => {
    const r = fitRefs(AIR, undefined, {});
    expect(r.brands.map((b) => b.name)).toEqual(expect.arrayContaining(["Delta", "United"]));
  });
  it("accepts a brand in the family and a theme that cites the references", () => {
    expect(themeFit(theme({ basis }), fitRefs(AIR, undefined, {}))).toEqual([]);
  });
  it("rejects a brand far from every reference colour", () => {
    const bad = themeFit(theme({ brand: "#22C55E", basis }), fitRefs(AIR, undefined, {}));
    expect(bad.map((b) => b.check)).toEqual(["design-off-reference"]);
    expect(bad[0]!.message).toContain("Delta");
  });
  it("allows a brand outside the family when the reading gives a departure", () => {
    expect(themeFit(theme({ brand: "#1F7A4D", basis, departure: "a rail-and-air pass for hikers; the outdoors, not the jet, is the hero" }), fitRefs(AIR, undefined, {}))).toEqual([]);
  });
  it("asks for a reason before a neon brand in a field people trust with money", () => {
    const BANK = "Customers check their bank account balance, send payments and transfer money, and view card statements";
    const r = fitRefs(BANK, undefined, {});
    const fb = [{ ref: r.brands[0]!.name, took: "x" }, { ref: r.brands[1]!.name, took: "y" }];
    expect(themeFit(theme({ brand: "#39FF14", basis: fb }), r).map((b) => b.check)).toContain("design-neon");
    expect(themeFit(theme({ brand: "#39FF14", basis: fb, departure: "a trading app for first-time investors under 25" }), r).map((b) => b.check)).not.toContain("design-neon");
    expect(themeFit(theme({ brand: "#0066FF", basis: fb }), r).map((b) => b.check)).not.toContain("design-neon");
  });
  it("rejects a brand that is one reference brand's exact shade", () => {
    const r = fitRefs(AIR, undefined, {});
    const delta = r.brands.find((b) => b.name === "Delta")!;
    expect(themeFit(theme({ brand: delta.brand, basis }), r).map((b) => b.check)).toEqual(["design-copied"]);
  });
  it("rejects a theme with no basis, or one citing products that were not briefed", () => {
    expect(themeFit(theme({}), fitRefs(AIR, undefined, {})).map((b) => b.check)).toEqual(["design-no-basis"]);
    expect(themeFit(theme({ basis: [{ ref: "Acme", took: "x" }, { ref: "Foo", took: "y" }] }), fitRefs(AIR, undefined, {})).map((b) => b.check)).toEqual(["design-no-basis"]);
  });
  it("asks an unlisted field to name real products", () => {
    const r = fitRefs("A museum audio guide with exhibits", undefined, {});
    expect(r.brands).toEqual([]);
    expect(themeFit(theme({}), r).map((b) => b.check)).toEqual(["design-no-basis"]);
    expect(themeFit(theme({ basis: [{ ref: "Louvre app", took: "dark galleries" }, { ref: "MoMA", took: "mono type" }] }), r)).toEqual([]);
  });
  it("treats near-greys as agreeing and grey against colour as far", () => {
    expect(colourGap("#111111", "#eeeeee")).toBe(0);
    expect(colourGap("#111111", "#e3132c")).toBe(180);
  });
  it("is part of designQuality only when references are given, and never for an existing app", () => {
    const sc = { id: "S-1", route: "/a", file: "a", reqs: ["R-1"], states: [], size: "new", frames: [], mock: { title: "t", blocks: [{ type: "text", body: "x" }, { type: "text", body: "y" }], copy: {} } };
    const out = { flow: "f", noScreen: [], theme: theme({ brand: "#22C55E" }), screens: [sc] } as never;
    expect(designQuality(out).map((q) => q.check)).toEqual([]);
    expect(designQuality(out, false, fitRefs(AIR, undefined, {})).map((q) => q.check)).toEqual(["design-off-reference", "design-no-basis", "design-no-reading"]);
    expect(designQuality(out, true, fitRefs(AIR, undefined, {})).map((q) => q.check)).toEqual([]);
  });
});

describe("demo effects follow the theme", () => {
  const d = (fx?: string) => buildDemo({ title: "Aero", flow: "f", requirements: {}, noScreen: [], frames: {}, theme: theme({ ...(fx ? { fx } : {}) }), screens: [{ id: "S-1", route: "/a", file: "a", reqs: [], states: [], size: "new", frames: [] }] } as never);
  it("sets the body class from fx, modern by default", () => {
    expect(d()).toContain('<body class="fx-modern ');
    expect(d("futuristic")).toContain('<body class="fx-futuristic ');
    expect(d("quiet")).toContain('<body class="fx-quiet ');
  });
});

describe("every state keeps the sample data on show", () => {
  const mock = { title: "Trips", copy: {}, blocks: [{ type: "stats", items: [{ label: "Miles", value: "48,210" }] }, { type: "table", columns: ["Flight", "Route"], rows: [["EK 202", "DXB to LHR"], ["EK 5", "LHR to DXB"]] }] };
  const page = (state: string) => buildDemo({ title: "Aero", flow: "f", requirements: {}, noScreen: [], frames: {}, screens: [{ id: "S-1", route: "/a", file: "a", reqs: [], states: [state], size: "new", frames: [], mock }] } as never);
  it("opens on the normal page with its data, before the listed special states", () => {
    expect(page("loading")).toMatch(/data-state="0" class="on">default<.*data-state="1">loading</s);
    expect(page("loading").split('data-wf="0"')[1]!.split('data-wf="1"')[0]).toContain("EK 202");
  });
  it("loading keeps the static parts real and turns only the data into skeleton", () => {
    const h = page("loading").split('data-wf="1"')[1]!.split("<details")[0]!;
    expect(h).toContain("Miles");            // stat label stays
    expect(h).toContain("<th>Flight</th>");  // column header stays
    expect(h).not.toContain("EK 202");       // the values are skeleton
    expect(h).not.toContain("48,210");
    expect(h).toContain('class="prog"');
    expect(h).toContain('class="sk"');
  });
  it("empty previews the data, and error keeps it behind the message", () => {
    expect(page("empty")).toContain("What this fills with");
    expect(page("empty")).toContain("EK 202");
    expect(page("error")).toMatch(/class="stale">.*EK 202/s);
  });
});

describe("the full-data state", () => {
  const mock = { title: "Trips", copy: {}, blocks: [{ type: "table", columns: ["Flight"], rows: [["EK 202"]] }, { type: "chart", kind: "line", title: "Miles", points: [{ label: "J", value: 1 }, { label: "F", value: 2 }] }] };
  const full = { title: "Trips", copy: {}, blocks: [{ type: "table", columns: ["Flight"], rows: Array.from({ length: 10 }, (_, i) => [`EK ${100 + i}`]) }, { type: "chart", kind: "line", title: "Miles", points: Array.from({ length: 12 }, (_, i) => ({ label: `M${i}`, value: i * 3 })) }] };
  const page = (m: object) => buildDemo({ title: "Aero", flow: "f", requirements: {}, noScreen: [], frames: {}, screens: [{ id: "S-1", route: "/a", file: "a", reqs: [], states: ["default"], size: "new", frames: [], mock, ...m }] } as never);
  it("adds a Full data tab with the dense page", () => {
    const h = page({ mockFull: full });
    expect(h).toContain(">Full data</button>");
    expect(h).toContain("EK 109");
  });
  it("adds no tab when the design gave none", () => {
    expect(page({})).not.toContain(">Full data</button>");
  });
  const sc = (extra: object) => ({ id: "S-1", route: "/a", file: "a", reqs: ["R-1"], states: [], size: "new", frames: [], mock, ...extra });
  const q = (extra: object) => designQuality({ flow: "f", noScreen: [], theme: theme({}), screens: [sc(extra)] } as never).map((x) => x.check);
  it("is required, and must be denser than the normal page", () => {
    expect(q({})).toContain("design-no-full-mock");
    expect(q({ mockFull: full })).not.toContain("design-no-full-mock");
    expect(q({ mockFull: { ...full, blocks: [full.blocks[0]] } })).toContain("design-thin-full-mock");
    expect(q({ mockFull: { ...full, blocks: [{ ...full.blocks[0], rows: [["a"], ["b"]] }, full.blocks[1]] } })).toContain("design-thin-full-mock");
    expect(q({ mockFull: { ...full, blocks: [full.blocks[0], mock.blocks[1]] } })).toContain("design-thin-full-mock");
  });
});
