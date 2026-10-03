// Design exports (docs/estimates-design.md, "Design handoff", step 3): the formats and options, the picture
// names and tags, the Tailwind theme, each format written and tagged with the design version, a run's numbered
// exports, `factory design export` over a run (and its versions), the --design-export step, and the PDF book.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { DesignTheme } from "../contracts/artifacts.js";
import { findChromium, type Shot } from "./screenshots.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { autoExportFormats, designExportStep, exportForRun } from "../stages/design-export.js";
import {
  designTag, exportDesign, exportShots, listExports, nextExportDir, parseFormats, parseList, pickShots, pngTag, tagPng, tailwindTheme, writeDesignBook, zipExport,
} from "./export.js";
import { writePackage, type DesignPackage, type PackageInput } from "./package.js";

const sha = "a".repeat(64);
const theme = DesignTheme.parse({ mood: "calm clinical", mode: "auto", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Epic MyChart", took: "calm white page, one blue action" }, { ref: "Linear", took: "hairline borders, compact tables" }] });
const mock = { title: "Sign in", blocks: [{ type: "actions", buttons: ["Sign in"] }], copy: {} };
const design = (extra: object = {}) => ({
  flow: "A user signs in", theme, noScreen: [], locale: { languages: ["en", "ar"] },
  screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["empty", "error"], size: "new", mock, mockFull: mock }],
  ...extra,
});

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-export-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  process.env.FACTORY_NO_SCREENSHOTS = "1";
  _resetEnvCache();
});

/** A 1×1 PNG, enough for the chunk walk. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), t = Buffer.from(type, "latin1");
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
}

const input = (over: Partial<PackageInput> = {}): PackageInput => ({
  project: "demo", line: "run-1", version: 1, design: design() as never, designSha: sha, demoHtml: "<!doctype html><title>demo</title>", demoSha: "b".repeat(64),
  run: { id: "run-1", mode: "design", project: "demo" }, product: { name: "Clinic" }, approved: { by: "lead", at: "2026-10-02T10:00:00.000Z" },
  templateVersion: "20", references: [], ...over,
});

const SHOTS: Shot[] = [
  { file: "01.png", id: "S-1", screen: "S-1 Sign in", state: "Empty", viewport: "phone" },
  { file: "02.png", id: "S-1", screen: "S-1 Sign in", state: "Error", viewport: "phone" },
  { file: "03.png", id: "S-1", screen: "S-1 Sign in", state: "Empty", viewport: "desktop" },
  { file: "04.png", id: "S-1", screen: "S-1 Sign in", state: "Dark mode", viewport: "phone", mode: "dark" },
  { file: "05.png", id: "S-1", screen: "S-1 Sign in", state: "In Arabic", viewport: "phone", lang: "ar" },
  { file: "06.png", screen: "Components", state: "All states", viewport: "desktop" },
];

/** A package with pictures (written with no browser, then given stand-in pictures in a copy). */
async function pkgWithShots(): Promise<DesignPackage> {
  const p = await writePackage(input());
  const dir = mkdtempSync(join(tmpdir(), "factory-pkgcopy-"));
  cpSync(p.dir, dir, { recursive: true });
  mkdirSync(join(dir, "shots"), { recursive: true });
  for (const s of SHOTS) writeFileSync(join(dir, "shots", s.file), png());
  const { shotsNote: _n, ...m } = p.manifest;
  return { dir, manifest: { ...m, screens: [{ ...m.screens[0]!, states: ["Empty", "Error"] }], shots: SHOTS } };
}

describe("export options", () => {
  it("reads the formats, expands all (Figma included) and refuses unknown ones", () => {
    expect(parseFormats("pdf, png")).toEqual(["png", "pdf"]);
    expect(parseFormats("all")).toEqual(["png", "pdf", "html", "tokens", "json", "figma"]);
    expect(parseFormats("figma")).toEqual(["figma"]);
    expect(() => parseFormats("svg")).toThrow(/Unknown format "svg"/);
    expect(() => parseFormats(" ")).toThrow(/at least one format/);
  });

  it("reads a list and checks it against what is allowed", () => {
    expect(parseList("widths", "phone, desktop", ["phone", "tablet", "desktop"])).toEqual(["phone", "desktop"]);
    expect(parseList("screens", ["S-1"])).toEqual(["S-1"]);
    expect(parseList("screens", undefined)).toBeUndefined();
    expect(parseList("screens", " , ")).toBeUndefined();
    expect(() => parseList("modes", "sepia", ["light", "dark"])).toThrow(/Unknown modes: sepia\. Use light, dark/);
  });
});

describe("export pictures", () => {
  it("names each picture by screen, state, width, mode and language, the dark and language ones at the first state", async () => {
    const pkg = await pkgWithShots();
    expect(exportShots(pkg, "en").map((s) => s.name)).toEqual([
      "S-1_empty_phone.png", "S-1_error_phone.png", "S-1_empty_desktop.png", "S-1_empty_phone_dark.png", "S-1_empty_phone_ar.png", "components_all-states_desktop.png",
    ]);
  });

  it("picks pictures by screen, state, width, mode and language", async () => {
    const all = exportShots(await pkgWithShots(), "en");
    const names = (o: object) => pickShots(all, { formats: ["png"], ...o }).map((s) => s.name);
    expect(names({ screens: ["s-1"], widths: ["phone"], modes: ["light"], langs: ["en"] })).toEqual(["S-1_empty_phone.png", "S-1_error_phone.png"]);
    expect(names({ states: ["Error"] })).toEqual(["S-1_error_phone.png"]);
    expect(names({ modes: ["dark"] })).toEqual(["S-1_empty_phone_dark.png"]);
    expect(names({ langs: ["ar"] })).toEqual(["S-1_empty_phone_ar.png"]);
    expect(names({ screens: ["components"] })).toEqual([]);
  });

  it("tags a PNG with the design it shows, and a tag reads back", () => {
    const t = tagPng(png(), "ai-factory design run-1 v1 (aaaa)");
    expect(pngTag(t)).toBe("ai-factory design run-1 v1 (aaaa)");
    expect(pngTag(png())).toBeUndefined();
    expect(tagPng(Buffer.from("not a png"), "x").toString()).toBe("not a png");
  });
});

describe("tokens", () => {
  it("writes a Tailwind v4 @theme block, with the dark values as overrides", () => {
    const css = tailwindTheme(theme, "TAG");
    expect(css).toContain("/* TAG */");
    expect(css).toMatch(/@theme \{[\s\S]*--color-brand: #1f6feb;/);
    expect(css).toMatch(/--font-body: /);
    expect(css).toMatch(/--radius-base: /);
    expect(css).toMatch(/prefers-color-scheme: dark/);
    expect(css).toMatch(/\[data-theme="dark"\]/);
    expect(tailwindTheme({ ...theme, mode: "light" }, "TAG")).not.toMatch(/prefers-color-scheme/);
  });
});

describe("exportDesign", () => {
  it("writes each format, tagged with the design version, and records it in export.json", async () => {
    const pkg = await pkgWithShots();
    const out = mkdtempSync(join(tmpdir(), "factory-out-"));
    const r = await exportDesign(pkg, out, { formats: ["png", "html", "tokens", "json"], widths: ["phone"], modes: ["light"], langs: ["en"] });
    expect(r).toMatchObject({ kind: "ai-factory/design-export", line: "run-1", version: 1, designSha: sha, notes: [] });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "demo.zip", "json/design.json", "json/manifest.json", "png/S-1_empty_phone.png", "png/S-1_error_phone.png", "tokens/tailwind.css", "tokens/tokens.css", "tokens/tokens.json",
    ]);
    const tag = designTag(pkg);
    expect(tag).toBe(`ai-factory design run-1 v1 (${sha.slice(0, 12)}), approved by lead on 2026-10-02`);
    expect(pngTag(readFileSync(join(out, "png/S-1_empty_phone.png")))).toBe(tag);
    expect(readFileSync(join(out, "tokens/tokens.css"), "utf8").startsWith(`/* ${tag} */`)).toBe(true);
    expect(JSON.parse(readFileSync(join(out, "tokens/tokens.json"), "utf8")).$extensions["ai.factory.design"]).toEqual({ line: "run-1", version: 1, designSha: sha });
    const zip = await JSZip.loadAsync(readFileSync(join(out, "demo.zip")));
    expect(Object.keys(zip.files).sort()).toEqual(["README.txt", "index.html"]);
    expect(await zip.file("README.txt")!.async("string")).toContain(tag);
    expect(JSON.parse(readFileSync(join(out, "export.json"), "utf8"))).toMatchObject({ version: 1, files: r.files });
    // the same version gives the same demo zip
    const again = mkdtempSync(join(tmpdir(), "factory-out-"));
    await exportDesign(pkg, again, { formats: ["html"] });
    expect(readFileSync(join(again, "demo.zip")).equals(readFileSync(join(out, "demo.zip")))).toBe(true);
  });

  it("notes what it cannot make (no pictures, no browser, no own look, nothing matched) and writes the rest", async () => {
    const plain = await writePackage(input());
    const out = mkdtempSync(join(tmpdir(), "factory-out-"));
    const r = await exportDesign(plain, out, { formats: ["png", "pdf", "json"] });
    expect(r.files.map((f) => f.format)).toEqual(["json", "json"]);
    expect(r.notes.join("\n")).toMatch(/png: the package has no pictures/);
    expect(r.notes.join("\n")).toMatch(/pdf: .*(FACTORY_NO_SCREENSHOTS|browser)/i);
    const repoLook = await writePackage(input({ line: "run-2", design: design({ themeSource: "repo" }) as never }));
    expect((await exportDesign(repoLook, mkdtempSync(join(tmpdir(), "factory-out-")), { formats: ["tokens"] })).notes).toEqual([expect.stringMatching(/keeps the app's own look/)]);
    const shots = await pkgWithShots();
    expect((await exportDesign(shots, mkdtempSync(join(tmpdir(), "factory-out-")), { formats: ["png"], screens: ["S-9"] })).notes).toEqual(["png: no picture matches the options"]);
  });
});

describe("a run's exports", () => {
  it("numbers the exports of each version, lists them newest first, and zips one whole", async () => {
    const run = mkdtempSync(join(tmpdir(), "factory-run-"));
    const pkg = await pkgWithShots();
    const first = nextExportDir(run, 1);
    expect(first).toBe(join(run, "exports", "v1", "1"));
    await exportDesign(pkg, first, { formats: ["json"] });
    const second = nextExportDir(run, 1);
    expect(second).toBe(join(run, "exports", "v1", "2"));
    await exportDesign(pkg, second, { formats: ["tokens"] });
    writeFileSync(join(run, "exports", "v1", "junk"), "x");
    expect(listExports(run).map((e) => e.id)).toEqual(["v1/2", "v1/1"]);
    const zip = await JSZip.loadAsync(await zipExport(first));
    expect(Object.keys(zip.files).filter((f) => !f.endsWith("/")).sort()).toEqual(["export.json", "json/design.json", "json/manifest.json"]);
    expect(listExports(mkdtempSync(join(tmpdir(), "factory-run-")))).toEqual([]);
  });
});

// ---------- over a run ----------

let n = 0;
async function approvedRun(d: object, o: { designExport?: string[]; parent?: object } = {}): Promise<Ledger> {
  const ledger = Ledger.create(`20261002-exp-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode: "design", project: "demo", request: "a portal", operator: "sam", ...(o.designExport ? { designExport: o.designExport } : {}), ...(o.parent ? { parent: o.parent } : {}) } }, HUMAN_WRITER);
  const designSha = ledger.putJson(d);
  const demoSha = ledger.putArtifact(Buffer.from("<!doctype html><title>demo</title>"));
  const bundle = ledger.putJson({ design: designSha, demo: demoSha });
  await ledger.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
  await ledger.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
  const base = ledger.putJson({ ui: true, design: designSha, by: "lead" });
  await ledger.append({ type: "step.completed", key: "design-baseline/1", inputsHash: sha, outputs: [base], data: { named: { "design-baseline": base } } }, HUMAN_WRITER);
  return ledger;
}
const baselineDesign = (l: Ledger): string => l.getJson<{ design: string }>(replay(l.events()).steps.get("design-baseline")!.outputs[0]!).design;

describe("factory design export", () => {
  it("exports a run's approved design into its next numbered folder, and refuses a run with none", async () => {
    const l = await approvedRun(design());
    const r = await exportForRun(l.runId, { formats: ["json", "tokens"] });
    expect(r.dir).toBe(join(l.dir, "exports", "v1", "1"));
    expect(r).toMatchObject({ line: l.runId, version: 1 });
    expect(existsSync(join(r.dir, "tokens", "tailwind.css"))).toBe(true);
    expect((await exportForRun(l.runId, { formats: ["json"] })).dir).toBe(join(l.dir, "exports", "v1", "2"));
    const out = mkdtempSync(join(tmpdir(), "factory-out-"));
    expect((await exportForRun(l.runId, { formats: ["json"], out })).dir).toBe(out);

    const none = Ledger.create(`20261002-exp-none-${Math.random().toString(16).slice(2, 6)}`);
    await none.append({ type: "run.created", data: { mode: "design", project: "demo", request: "r", operator: "sam" } }, HUMAN_WRITER);
    await expect(exportForRun(none.runId, { formats: ["json"] })).rejects.toThrow(/has no approved design to export/);
  });

  it("exports another version of the same design line with --version, and names the versions it has", async () => {
    const v1 = await approvedRun(design());
    const change = await approvedRun(design({ flow: "A user signs in and out" }), { parent: { runId: v1.runId, kind: "change", estimateSha: sha, breakdownSha: sha, specSha: sha, designSha: baselineDesign(v1) } });
    change.putJson(v1.getJson(baselineDesign(v1)));
    expect((await exportForRun(change.runId, { formats: ["json"] })).version).toBe(2);
    const old = await exportForRun(change.runId, { formats: ["json"], version: 1 });
    expect(old).toMatchObject({ line: v1.runId, version: 1, designSha: baselineDesign(v1) });
    expect(old.dir).toBe(join(change.dir, "exports", "v1", "1"));
    await expect(exportForRun(change.runId, { formats: ["json"], version: 7 })).rejects.toThrow(/has no v7; it has v1, v2/);
  });

  it("--design-export exports right after the approval, and a failed export never stops the run", async () => {
    expect(autoExportFormats({ info: {} } as never)).toEqual([]);
    expect(autoExportFormats({ info: { designExport: ["pdf", "png"] } } as never)).toEqual(["png", "pdf"]);
    const l = await approvedRun(design(), { designExport: ["tokens", "json"] });
    const logs: string[] = [];
    const out = await designExportStep.run({ state: replay(l.events()), ledger: l, log: (m: string) => logs.push(m) } as never);
    expect(out).toMatchObject({ kind: "done", data: { version: 1, exported: join(l.dir, "exports", "v1", "1") } });
    expect(listExports(l.dir)[0]!.files.map((f) => f.format)).toEqual(["tokens", "tokens", "tokens", "json", "json"]);
    expect(logs.join("\n")).toMatch(/tokens, json exported \(5 files\)/);
    const plain = await approvedRun(design());
    const o2 = await designExportStep.run({ state: replay(plain.events()), ledger: plain, log: () => undefined } as never);
    expect((o2 as { data: object }).data).not.toHaveProperty("exported");
  });
});

describe.skipIf(!findChromium())("the PDF design book (needs a browser)", () => {
  it("prints the book and one PDF per screen", async () => {
    delete process.env.FACTORY_NO_SCREENSHOTS;
    const pkg = await pkgWithShots();
    const out = mkdtempSync(join(tmpdir(), "factory-out-"));
    const r = await exportDesign(pkg, out, { formats: ["pdf"] }, { requirements: { "REQ-1": "The system shall let a user sign in." } });
    expect(r.notes).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(["design-book.pdf"]);
    const pdf = readFileSync(join(out, "design-book.pdf"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const per = await exportDesign(pkg, mkdtempSync(join(tmpdir(), "factory-out-")), { formats: ["pdf"], pdfPerScreen: true });
    expect(per.files.map((f) => f.path)).toEqual(["pdf/S-1.pdf"]);
    const book = join(mkdtempSync(join(tmpdir(), "factory-out-")), "est-design-v1.pdf");
    expect(await writeDesignBook(pkg, book)).toBeUndefined();
    expect(readFileSync(book).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});
