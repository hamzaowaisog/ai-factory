// The Figma export and the AI Factory Import plugin (docs/estimates-design.md, "Figma", route A): auto layout inferred from
// positions, the tokens as variables, layers read from a page in Chromium, figma.json written by the export with its check,
// and the plugin's import run against a stand-in for Figma's `figma` object, on a plan with modes and on the free plan.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { buildDemo } from "./demo.js";
import { findChromium } from "./screenshots.js";
import { exportDesign } from "./export.js";
import { figmaHowTo, figmaLayers, figmaPluginDir, figmaPluginZip, figmaVariables, finishLayers, inferAuto, type FigmaDoc, type FNode, type RawLayers } from "./figma.js";
import { inPage } from "./fidelity-read.js";
import { sampleDesign } from "./kit/sample.js";
import { writePackage, type DesignPackage } from "./package.js";
import JSZip from "jszip";

// the plugin is a plain script (Figma runs it as one), so it is run here the same way, with a `module` to hand back its functions
const plugin = (() => {
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(readFileSync(join(figmaPluginDir(), "code.js"), "utf8"), { module, Math, JSON, Object, Array, String, Number, RegExp, Error, Promise, Uint8Array });
  return module.exports;
})() as unknown as {
  importDoc(doc: unknown, api: unknown, progress?: (t: string) => void): Promise<Record<string, any>>;
  styleWeight(s: string): number;
  variantName(p: Record<string, string>, taken: Record<string, boolean>): string;
};

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-figma-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  delete process.env.FACTORY_NO_SCREENSHOTS;
  _resetEnvCache();
});

const box = (x: number, y: number, w: number, h: number): FNode => ({ t: "frame", name: "b", x, y, w, h, children: [] });

describe("auto layout from positions", () => {
  it("a row with even gaps, lined up at the top, is a horizontal auto layout with its padding", () => {
    expect(inferAuto({ w: 300, h: 60, children: [box(16, 10, 80, 40), box(108, 10, 80, 30), box(200, 10, 60, 20)] }))
      .toEqual({ dir: "H", gap: 12, pad: [10, 40, 10, 16], align: "MIN" });
  });
  it("a column, a centred row and a row lined up at the bottom", () => {
    expect(inferAuto({ w: 200, h: 200, children: [box(20, 20, 160, 40), box(20, 72, 100, 40), box(20, 124, 160, 40)] })).toMatchObject({ dir: "V", gap: 12, align: "MIN", pad: [20, 20, 36, 20] });
    expect(inferAuto({ w: 300, h: 60, children: [box(0, 10, 80, 40), box(90, 20, 80, 20)] })).toMatchObject({ dir: "H", gap: 10, align: "CENTER" });
    expect(inferAuto({ w: 300, h: 60, children: [box(0, 10, 80, 50), box(90, 40, 80, 20)] })).toMatchObject({ dir: "H", align: "MAX", pad: [10, 130, 0, 0] });
  });
  it("uneven gaps, overlaps, a child outside and one child stay free", () => {
    expect(inferAuto({ w: 300, h: 60, children: [box(0, 0, 50, 20), box(60, 0, 50, 20), box(140, 0, 50, 20)] })).toBeUndefined();
    expect(inferAuto({ w: 300, h: 60, children: [box(0, 0, 50, 20), box(40, 30, 50, 20)] })).toBeUndefined();
    expect(inferAuto({ w: 300, h: 60, children: [box(0, 0, 50, 20), box(40, 5, 50, 20)] })).toBeUndefined();
    expect(inferAuto({ w: 100, h: 60, children: [box(0, 0, 50, 20), box(60, 0, 50, 20)] })).toBeUndefined();
    expect(inferAuto({ w: 100, h: 60, children: [box(0, 0, 50, 20)] })).toBeUndefined();
  });
  it("finishing a tree spreads positioned wrappers, puts the pictures in and adds auto layout", () => {
    const raw: RawLayers = {
      nodes: 4, dir: "ltr", crops: [{ x: 0, y: 0, w: 10, h: 10 }],
      root: { t: "frame", name: "root", x: 0, y: 0, w: 100, h: 40, children: [
        { t: "frame", name: "wrap", x: 0, y: 0, w: 0, h: 0, flat: true, children: [box(0, 0, 40, 40), box(50, 0, 40, 40)] } as never,
        { t: "image", name: "pic", x: 0, y: 0, w: 10, h: 10, crop: 0 },
      ] },
    };
    const root = finishLayers(raw, ["AAAA"])!;
    expect(root.children.map((c) => c.name)).toEqual(["b", "b", "pic"]);
    expect(root.children[2]).toMatchObject({ t: "image", png: "AAAA" });
    expect((root.children[2] as { crop?: number }).crop).toBeUndefined();
  });
});

describe("the tokens as variables", () => {
  it("colours per mode, corners, spacing and fonts", () => {
    const v = figmaVariables(sampleDesign().theme as never);
    expect(v.modes).toEqual(expect.arrayContaining(["light"]));
    const brand = v.variables.find((x) => x.name === "color/brand")!;
    expect(brand.type).toBe("COLOR");
    for (const m of v.modes) expect((brand.values[m] as number[]).length).toBe(4);
    expect(v.variables.map((x) => x.name)).toEqual(expect.arrayContaining(["radius/base", "space/pad", "space/row", "font/body", "font/heading"]));
  });
});

// ---------- a stand-in for Figma ----------

interface FakeOptions { modesPerCollection?: number; fonts?: { family: string; style: string }[] }

function fakeFigma(o: FakeOptions = {}) {
  let n = 0;
  const loaded = new Set<string>();
  const made: Record<string, any[]> = { pages: [], collections: [], variables: [], sets: [], components: [] };
  class Node {
    id = `n${++n}`; name = ""; x = 0; y = 0; width = 100; height = 100; parent: Node | null = null; children: Node[] = []; data: Record<string, string> = {};
    explicit: [string, string][] = [];
    [k: string]: any;
    constructor(public type: string) {}
    resize(w: number, h: number) { if (!(w > 0 && h > 0)) throw new Error(`bad size ${w}x${h}`); this.width = w; this.height = h; }
    appendChild(c: Node) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.push(c); }
    insertChild(i: number, c: Node) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = this; this.children.splice(i, 0, c); }
    clone(): Node { const c = Object.assign(new Node(this.type), { ...this, id: `n${++n}`, parent: null, children: [] }); for (const k of this.children) c.appendChild(k.clone()); this.parent?.appendChild(c); return c; }
    setPluginData(k: string, v: string) { this.data[k] = v; }
    setExplicitVariableModeForCollection(col: { id: string }, mode: string) { this.explicit.push([col.id, mode]); }
  }
  const text = () => {
    const t = new Node("TEXT");
    let font: { family: string; style: string } | undefined;
    Object.defineProperty(t, "fontName", { get: () => font, set: (f) => { font = f; } });
    Object.defineProperty(t, "characters", {
      get: () => t._chars,
      set: (c: string) => { if (!font || !loaded.has(`${font.family}|${font.style}`)) throw new Error("font not loaded"); t._chars = c; },
    });
    return t;
  };
  const limit = o.modesPerCollection ?? 4;
  const api = {
    createPage: () => { const p = new Node("PAGE"); made.pages.push(p); return p; },
    createFrame: () => new Node("FRAME"),
    createText: text,
    createRectangle: () => new Node("RECTANGLE"),
    createNodeFromSvg: (svg: string) => { if (!svg.startsWith("<svg")) throw new Error("bad svg"); const s = new Node("FRAME"); s.svg = svg; return s; },
    createImage: (b: Uint8Array) => ({ hash: `img${b.length}` }),
    base64Decode: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
    createComponentFromNode: (node: Node) => { const c = new Node("COMPONENT"); c.name = node.name; node.parent?.appendChild(c); node.parent!.children = node.parent!.children.filter((x) => x !== node); c.appendChild(node); made.components.push(c); return c; },
    combineAsVariants: (list: Node[], parent: Node) => { const s = new Node("COMPONENT_SET"); for (const c of list) s.appendChild(c); parent.appendChild(s); made.sets.push(s); return s; },
    listAvailableFontsAsync: async () => (o.fonts ?? [{ family: "Inter", style: "Regular" }, { family: "Inter", style: "Medium" }, { family: "Inter", style: "Semi Bold" }, { family: "Inter", style: "Bold" }, { family: "Inter", style: "Italic" }]).map((fontName) => ({ fontName })),
    loadFontAsync: async (f: { family: string; style: string }) => { loaded.add(`${f.family}|${f.style}`); },
    setCurrentPageAsync: async () => undefined,
    viewport: { scrollAndZoomIntoView: () => undefined },
    variables: {
      createVariableCollection: (name: string) => {
        const col = { id: `c${++n}`, name, modes: [{ modeId: `m${++n}`, name: "Mode 1" }], vars: [] as any[],
          renameMode(id: string, nm: string) { col.modes.find((m) => m.modeId === id)!.name = nm; },
          addMode(nm: string) { if (col.modes.length >= limit) throw new Error("Limited to 1 modes only"); const m = { modeId: `m${++n}`, name: nm }; col.modes.push(m); return m.modeId; } };
        made.collections.push(col);
        return col;
      },
      createVariable: (name: string, col: { id: string; vars: any[] }, type: string) => {
        const v = { id: `v${++n}`, name, type, collection: col.id, values: {} as Record<string, unknown>, setValueForMode(m: string, val: unknown) { v.values[m] = val; } };
        col.vars.push(v);
        made.variables.push(v);
        return v;
      },
      setBoundVariableForPaint: (p: object, field: string, v: { id: string }) => ({ ...p, boundVariables: { [field]: { type: "VARIABLE_ALIAS", id: v.id } } }),
    },
  };
  return { api, made, loaded };
}

const RED: [number, number, number, number] = [1, 0, 0, 1];
const doc = (over: Partial<FigmaDoc> = {}): FigmaDoc => ({
  kind: "ai-factory/figma", schemaVersion: 1, tag: "ai-factory design run-1 v1 (aaaa)", line: "run-1", version: 1, designSha: "a".repeat(64), product: "Clinic",
  apps: [{ id: "web", name: "Clinic web" }, { id: "components", name: "Components" }],
  tokens: { modes: ["light", "dark"], variables: [{ name: "color/brand", type: "COLOR", values: { light: RED, dark: [0, 0, 1, 1] } }, { name: "radius/base", type: "FLOAT", values: { light: 8, dark: 8 } }] },
  fonts: ["Inter 400"],
  frames: [
    {
      name: "S-1 Sign in · empty · desktop", screen: "S-1", title: "Sign in", app: "web", state: "empty", viewport: "desktop", mode: "light", lang: "en", dir: "ltr", w: 400, h: 300, nodes: 4, picture: "AAAA",
      root: { t: "frame", name: "stage", x: 0, y: 0, w: 400, h: 300, fill: [1, 1, 1, 1], clip: true, auto: { dir: "V", gap: 8, pad: [16, 16, 16, 16], align: "MIN" }, children: [
        { t: "text", name: "Sign in", x: 16, y: 16, w: 80, h: 20, chars: "Sign in", font: { families: ["Inter var", "system-ui"], weight: 600, size: 16, lineHeight: 20 }, color: [0, 0, 0, 1], align: "LEFT", lines: 1 },
        { t: "frame", name: "button", x: 16, y: 44, w: 120, h: 36, fill: RED, radius: [8, 8, 8, 8], stroke: { color: RED, w: [1, 1, 2, 1] }, shadows: [{ color: [0, 0, 0, 0.2], x: 0, y: 1, blur: 2, spread: 0 }], children: [] },
        { t: "svg", name: "icon", x: 16, y: 88, w: 16, h: 16, svg: '<svg width="16" height="16"></svg>' },
        { t: "svg", name: "broken", x: 16, y: 88, w: 16, h: 16, svg: "not svg" },
      ] },
    },
    { name: "S-1 Sign in · empty · desktop · dark", screen: "S-1", title: "Sign in", app: "web", state: "empty", viewport: "desktop", mode: "dark", lang: "en", dir: "ltr", w: 400, h: 300, nodes: 1, root: { t: "frame", name: "stage", x: 0, y: 0, w: 400, h: 300, fill: [0, 0, 1, 1], children: [] } },
    {
      name: "components Components · All states · desktop", screen: "components", title: "Components", app: "components", state: "All states", viewport: "desktop", mode: "light", lang: "en", dir: "ltr", w: 400, h: 200, nodes: 4,
      root: { t: "frame", name: "stage", x: 0, y: 0, w: 400, h: 200, children: [
        { t: "frame", name: "btn", x: 0, y: 0, w: 80, h: 32, fill: RED, component: { set: "Buttons", props: { Variant: "Primary", State: "Default" } }, children: [] },
        { t: "frame", name: "btn", x: 100, y: 0, w: 80, h: 32, fill: RED, component: { set: "Buttons", props: { Variant: "Primary", State: "Hover" } }, children: [] },
        { t: "frame", name: "badge", x: 0, y: 50, w: 60, h: 20, fill: RED, component: { set: "Badges", props: { Name: "Active" } }, children: [] },
        { t: "frame", name: "badge", x: 70, y: 50, w: 60, h: 20, fill: RED, component: { set: "Badges", props: { Name: "Active" } }, children: [] },
      ] },
    },
  ],
  notes: [],
  ...over,
});

describe("the AI Factory Import plugin", () => {
  it("builds a page per app, frames with auto layout and bound colours, component sets and variables in two modes", async () => {
    const { api, made } = fakeFigma();
    const said: string[] = [];
    const s = await plugin.importDoc(doc(), api, (t) => said.push(t));
    expect(s.pages).toEqual(["Clinic web - run-1 v1", "Components - run-1 v1", "Component sets - run-1 v1"]);
    expect(s).toMatchObject({ frames: 3, componentSets: 2, components: 4, variables: 2, darkCollection: false });
    expect(said[0]).toMatch(/variables/);
    const page = made.pages[0];
    const [light, dark] = page.children;
    expect(light).toMatchObject({ type: "FRAME", name: "S-1 Sign in · empty · desktop", layoutMode: "VERTICAL", itemSpacing: 8, paddingTop: 16, primaryAxisSizingMode: "FIXED", width: 400, height: 300 });
    expect(dark.x).toBe(400 + 80);
    // the reference picture first, hidden and locked, out of the auto layout
    expect(light.children[0]).toMatchObject({ type: "RECTANGLE", name: "Approved picture (reference)", visible: false, locked: true, layoutPositioning: "ABSOLUTE" });
    const btn = light.children.find((c: any) => c.name === "button");
    expect(btn).toMatchObject({ cornerRadius: 8, strokeTopWeight: 1, strokeBottomWeight: 2, strokeAlign: "INSIDE" });
    expect(btn.fills[0].boundVariables.color.id).toBe(made.variables[0].id);
    expect(btn.effects[0]).toMatchObject({ type: "DROP_SHADOW", radius: 2, offset: { x: 0, y: 1 } });
    const t = light.children.find((c: any) => c.type === "TEXT");
    expect(t).toMatchObject({ fontName: { family: "Inter", style: "Semi Bold" }, characters: "Sign in", fontSize: 16, lineHeight: { unit: "PIXELS", value: 20 }, textAutoResize: "WIDTH_AND_HEIGHT" });
    // one collection, Light and Dark; the dark frame shows the dark mode
    expect(made.collections).toHaveLength(1);
    expect(made.collections[0].modes.map((m: any) => m.name)).toEqual(["Light", "Dark"]);
    expect(made.variables[0].values[made.collections[0].modes[1].modeId]).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(dark.explicit).toEqual([[made.collections[0].id, made.collections[0].modes[1].modeId]]);
    // the sets, with unique variant names
    expect(made.sets.map((x: any) => x.name)).toEqual(["Buttons", "Badges"]);
    expect(made.sets[0].children.map((c: any) => c.name)).toEqual(["Variant=Primary, State=Default", "Variant=Primary, State=Hover"]);
    expect(made.sets[1].children.map((c: any) => c.name)).toEqual(["Name=Active", "Name=Active 2"]);
    expect(made.sets[0].parent).toBe(made.pages[2]);
    expect(JSON.parse(light.data["ai-factory"])).toMatchObject({ screen: "S-1", state: "empty", designSha: "a".repeat(64) });
    expect(s.notes.join(" ")).toMatch(/1 layer\(s\) could not be made/);
  });

  it("on the free plan (one mode per collection) the dark values get a collection of their own", async () => {
    const { api, made } = fakeFigma({ modesPerCollection: 1 });
    const s = await plugin.importDoc(doc(), api);
    expect(s.darkCollection).toBe(true);
    expect(made.collections.map((c: any) => c.name)).toEqual(["Clinic tokens (run-1 v1)", "Clinic tokens (run-1 v1) - Dark"]);
    expect(made.collections[1].vars.map((v: any) => v.name)).toEqual(["color/brand", "radius/base"]);
    expect(s.notes.join(" ")).toMatch(/one mode per variable collection/);
    // the dark frame's colours are bound to the dark collection's variables
    const dark = made.pages[0].children[1];
    expect(dark.fills[0].boundVariables.color.id).toBe(made.collections[1].vars[0].id);
    expect(dark.explicit).toEqual([]);
  });

  it("a font Figma lacks is shown in Inter and named; a wrong or newer file is refused", async () => {
    const d = doc();
    (d.frames[0]!.root.children[0] as { font: { families: string[] } }).font.families = ["Brand Sans", "sans-serif"];
    const s = await plugin.importDoc(d, fakeFigma().api);
    expect(s.notes.join(" ")).toMatch(/shown in Inter: Brand Sans/);
    await expect(plugin.importDoc({ kind: "x" }, fakeFigma().api)).rejects.toThrow(/not an AI Factory figma\.json/);
    await expect(plugin.importDoc(doc({ schemaVersion: 99 }), fakeFigma().api)).rejects.toThrow(/newer than the plugin/);
  });

  it("reads font weights from style names and keeps variant names unique", () => {
    expect(["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "SemiBold Italic", "Bold", "Extra Bold", "Black", "Wght 550"].map(plugin.styleWeight))
      .toEqual([100, 200, 300, 400, 500, 600, 600, 700, 800, 900, 550]);
    const taken = {};
    expect([plugin.variantName({ A: "x=1, y" }, taken), plugin.variantName({ A: "x=1, y" }, taken)]).toEqual(["A=x 1  y", "A=x 1  y 2"]);
  });

  it("the manifest asks for no network, and the zip carries the plugin", async () => {
    const m = JSON.parse(readFileSync(join(figmaPluginDir(), "manifest.json"), "utf8"));
    expect(m).toMatchObject({ main: "code.js", ui: "ui.html", editorType: ["figma"], documentAccess: "dynamic-page", networkAccess: { allowedDomains: ["none"] } });
    const code = readFileSync(join(figmaPluginDir(), "code.js"), "utf8");
    // Figma's sandbox: plain script, nothing it may not parse
    expect(code).not.toMatch(/\?\.|\?\?|^import |^export /m);
    const z = await JSZip.loadAsync(await figmaPluginZip());
    expect(Object.keys(z.files)).toEqual(expect.arrayContaining(["ai-factory-figma-plugin/manifest.json", "ai-factory-figma-plugin/code.js", "ai-factory-figma-plugin/ui.html"]));
    expect(figmaHowTo("/x/figma.json").join(" ")).toMatch(/Import plugin from manifest.*manifest\.json.*AI Factory Import.*\/x\/figma\.json/);
  });
});

// ---------- in a browser ----------

describe.skipIf(!findChromium())("layers read from a page (needs a browser)", () => {
  it("frames, text, inputs, icons, native controls, any colour syntax and the Components page's sets", async () => {
    const { chromium } = await import("playwright-core");
    const b = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const page = await b.newPage({ viewport: { width: 600, height: 400 } });
      await page.setContent(`<body style="margin:0;background:#f7f9fd;font:14px/20px Arial"><div id="root" style="width:400px;padding:16px">
        <div class="row" style="display:flex;gap:12px;background:color-mix(in srgb, red 50%, white);border:1px solid #ccc;border-radius:8px;padding:8px;box-shadow:0 1px 2px rgba(0,0,0,.2)">
          <button style="all:unset;background:oklch(0.5 0.2 260);color:white;padding:4px 8px;text-transform:uppercase">Save</button>
          <span><svg viewBox="0 0 10 10" width="10" height="10" style="color:rgb(255,0,0)"><path d="M0 0L10 10" stroke="currentColor"/></svg></span>
        </div>
        <input id="e" placeholder="you@company.com" style="width:200px;padding:4px;border:1px solid #999">
        <input type="checkbox" checked>
        <section class="kg"><h4>Buttons</h4><div class="kgrid"><span></span><span class="kh">Default</span><span class="kh">Hover</span><span class="kl">Primary</span><div><b class="btn" style="background:red;display:inline-block">A</b></div><div><b class="btn" style="background:red;display:inline-block">B</b></div></div>
          <div class="kwrap"><span class="badge" style="background:#eee">Active</span><span class="badge" style="background:#eee">Failed</span></div></section>
      </div></body>`);
      const raw = (await page.evaluate(inPage(figmaLayers, { sel: "#root", max: 4000, components: true }))) as RawLayers;
      const root = finishLayers(raw, raw.crops.map(() => "AAAA"))!;
      const all: FNode[] = [];
      const walk = (n: FNode) => { all.push(n); if (n.t === "frame") n.children.forEach(walk); };
      walk(root);
      // the root takes the page colour from the body
      expect(root.fill).toEqual([0.9686, 0.9765, 0.9922, 1]);
      const row = all.find((n) => n.t === "frame" && n.name.includes("row")) as Extract<FNode, { t: "frame" }>;
      expect(row.fill![0]).toBeCloseTo(1, 1);
      expect(row.fill![1]).toBeCloseTo(0.5, 1);
      expect(row).toMatchObject({ stroke: { w: [1, 1, 1, 1] }, radius: [8, 8, 8, 8], auto: { dir: "H", gap: 12 } });
      expect(row.shadows![0]).toMatchObject({ x: 0, y: 1, blur: 2 });
      const save = all.find((n) => n.t === "frame" && n.name.startsWith("button")) as Extract<FNode, { t: "frame" }>;
      expect(save.fill![2]).toBeGreaterThan(0.5); // oklch, read through the canvas
      const label = all.find((n) => n.t === "text" && n.chars === "Save") as Extract<FNode, { t: "text" }>;
      expect(label.font).toMatchObject({ families: ["Arial"], size: 14, case: "UPPER" });
      const svg = all.find((n) => n.t === "svg") as Extract<FNode, { t: "svg" }>;
      expect(svg.svg).toMatch(/stroke="rgb\(255, 0, 0\)"/);
      expect(svg.svg).not.toMatch(/currentColor/);
      expect(all.find((n) => n.t === "text" && n.chars === "you@company.com")).toBeTruthy();
      expect(all.filter((n) => n.t === "image")).toHaveLength(1); // the native tick box, as a picture
      const comps = all.filter((n) => n.t === "frame" && n.component).map((n) => (n as Extract<FNode, { t: "frame" }>).component);
      expect(comps).toEqual([
        { set: "Buttons", props: { Variant: "Primary", State: "Default" } }, { set: "Buttons", props: { Variant: "Primary", State: "Hover" } },
        { set: "Buttons", props: { Name: "Active" } }, { set: "Buttons", props: { Name: "Failed" } },
      ]);
    } finally {
      await b.close();
    }
  }, 30_000);

  it("the export writes figma.json from the approved demo, checked, and the plugin imports it", async () => {
    const d = sampleDesign();
    const html = buildDemo({ title: "Acme", flow: d.flow, screens: d.screens.map((s) => ({ frames: [], size: "new", ...s })) as never, requirements: {}, noScreen: [], theme: d.theme, apps: d.apps, locale: d.locale } as never);
    process.env.FACTORY_NO_SCREENSHOTS = "1";
    const p = await writePackage({ project: "acme", line: "run-f", version: 1, design: d as never, designSha: "a".repeat(64), demoHtml: html, demoSha: "b".repeat(64), run: { id: "run-f", mode: "design", project: "acme" }, product: { name: "Acme" }, approved: { by: "lead", at: "2026-10-02T10:00:00Z" }, templateVersion: "20", references: [] });
    delete process.env.FACTORY_NO_SCREENSHOTS;
    // stand-in pictures: the views the export reads (the package's pictures name them)
    const s1 = p.manifest.screens[0]!;
    const shots = [
      ...s1.states.slice(0, 2).map((st, i) => ({ file: `a${i}.png`, id: s1.id, screen: s1.title, state: st, viewport: "desktop" as const })),
      { file: "d.png", id: s1.id, screen: s1.title, state: "Dark mode", viewport: "phone" as const, mode: "dark" as const },
      { file: "c.png", id: "components", screen: "Components", state: "All states", viewport: "desktop" as const },
    ];
    const pkg: DesignPackage = { dir: p.dir, manifest: { ...p.manifest, shots } };
    const out = mkdtempSync(join(tmpdir(), "factory-figma-out-"));
    const r = await exportDesign(pkg, out, { formats: ["figma"], screens: [s1.id, "components"], states: [...s1.states.slice(0, 2), "All states"] });
    expect(r.files.map((f) => f.path)).toEqual(["figma.json"]);
    const fig = JSON.parse(readFileSync(join(out, "figma.json"), "utf8")) as FigmaDoc;
    expect(fig).toMatchObject({ kind: "ai-factory/figma", line: "run-f", version: 1, tag: expect.stringMatching(/run-f v1/) });
    expect(fig.frames.map((f) => [f.screen, f.state, f.viewport, f.mode])).toEqual([
      [s1.id, s1.states[0], "desktop", "light"], [s1.id, s1.states[1], "desktop", "light"], ["components", "All states", "desktop", "light"], [s1.id, s1.states[0], "phone", "dark"],
    ].sort((a, b) => ["phone", "tablet", "desktop"].indexOf(a[2]!) - ["phone", "tablet", "desktop"].indexOf(b[2]!)));
    for (const f of fig.frames) { expect(f.nodes).toBeGreaterThan(10); expect(f.picture).toBeTruthy(); }
    expect(fig.tokens!.variables.length).toBeGreaterThan(10);
    expect(r.checks!.find((c) => c.check === "figma.frames")).toMatchObject({ status: "PASS" });
    // the frames' colours are the tokens' colours, so the plugin binds them
    const { api, made } = fakeFigma({ modesPerCollection: 1 });
    const s = await plugin.importDoc(fig, api);
    expect(s.frames).toBe(4);
    expect(s.componentSets).toBeGreaterThan(3);
    expect(s.boundColours).toBeGreaterThan(20);
    expect(s.autoLayout).toBeGreaterThan(20);
    expect(made.pages.map((x: any) => x.name)).toContain("Component sets - run-f v1");
    // a broken file fails the check
    writeFileSync(join(out, "figma.json"), "{}");
    const { checkExport } = await import("./export-check.js");
    expect(checkExport(pkg, out, r, shots.map((x) => ({ ...x, stateBase: x.state, name: x.file }))).find((c) => c.check === "figma.frames")).toMatchObject({ status: "FAIL" });
  }, 120_000);
});
