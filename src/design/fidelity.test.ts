// The fidelity check (docs/estimates-design.md, "Fidelity and tests"): the pages it opens, what each state must show, the token,
// structure and layout findings, the blocking gates, accepting baselines into the ledger, the export checks on the PDF and the
// PNG set, and the Playwright tests the scaffold writes for each screen.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { acceptBaselines, BaselineError, baselinesDir, readBaselineIndex, readBaselines } from "./baselines.js";
import { checkExport, pdfFacts, wantedPairs } from "./export-check.js";
import { approvedTheme, blockWords, expectedFor, fidelityPages, layoutFindings, structureFindings, tokenFindings, type FidelityReport } from "./fidelity-app.js";
import type { ReadBlock } from "./fidelity-read.js";
import { designA11yGate, designStructureGate, designTokensGate } from "./gates.js";
import { e2eConfig, e2eFiles, pressesFor, screenSpec } from "./kit/e2e.js";
import { loadKit, scaffold } from "./kit/index.js";
import { sampleDesign } from "./kit/sample.js";
import type { DesignPackage } from "./package.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { designFidelityStep, fidelityConfig } from "../stages/design-fidelity.js";
import { ProjectConfig } from "../config/project.js";
import type { StepContext } from "../stages/framework.js";
import { NO_TRACE } from "../util/trace.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-fid-")); });

const design = sampleDesign();
const s1 = design.screens.find((s) => s.id === "S-1")!;
const s2 = design.screens.find((s) => s.id === "S-2")!;
const block = (type: string, words: string, w = 1000, nested = false): ReadBlock => ({ type, words, box: { x: 0, y: 0, w, h: 100 }, ...(nested ? { nested } : {}) });

describe("the pages and what they must show", () => {
  it("every state at phone and desktop, the first at tablet, and the first in dark and in the other language", () => {
    const pages = fidelityPages(design as never, ["S-1"]);
    const keys = pages.map((p) => p.key);
    expect(keys).toContain("s-1-default-phone");
    expect(keys).toContain("s-1-loading-desktop");
    expect(keys).toContain("s-1-default-tablet");
    expect(keys).not.toContain("s-1-loading-tablet");
    expect(keys).toContain("s-1-default-phone-dark");
    expect(keys).toContain("s-1-default-desktop-ur");
    expect(pages.find((p) => p.key === "s-1-default-desktop-ur")!.path).toBe("/?fixture=S-1%3Adefault&lang=ur");
    expect(pages.every((p) => p.id === "S-1")).toBe(true);
    // a route's parameters are filled the way the fixtures are
    expect(fidelityPages(design as never, ["S-2"])[0]!.path).toMatch(/^\/invoices\/sample\?fixture=S-2%3A/);
  });

  it("a block's words: its labels, columns and buttons; a search's filters fold away on a phone", () => {
    const table = s1.mock!.blocks.find((b) => b.type === "table")!;
    expect(blockWords(table)).toEqual(expect.arrayContaining(["Invoice", "Client", "Status"]));
    const facets = { type: "filters", search: "Search invoices", facets: [{ title: "Status", options: ["Paid"] }] } as never;
    expect(blockWords(facets)).toEqual(expect.arrayContaining(["Search invoices", "Status"]));
    expect(blockWords(facets, true)).not.toContain("Status");
  });

  it("a state's expectations: loading is a placeholder, empty and error their message, a layer its title and buttons, a toast its text", () => {
    expect(expectedFor(s1, "loading")).toMatchObject({ blocks: [], busy: true });
    expect(expectedFor(s1, "empty").blocks[0]!.type).toBe("state:empty");
    expect(expectedFor(s1, "error").blocks[0]!.type).toBe("state:error");
    const dialog = expectedFor(s1, "dialog-new-invoice");
    expect(dialog.blocks.at(-1)).toEqual({ type: "overlay:New invoice", words: ["New invoice", "Create", "Cancel"] });
    expect(expectedFor(s1, "menu-row-actions").blocks.at(-1)!.words).toEqual(["Open", "Duplicate", "Archive"]);
    expect(expectedFor(s1, "toast-marked-as-paid").toast).toBe("Marked as paid");
  });

  it("structure: the page title, each block matched by type in order, its words, the message", () => {
    const exp = { page: ["Dashboard"], blocks: [{ type: "table", words: ["Invoice", "Client"] }, { type: "table", words: ["Due"] }], toast: "Saved" };
    const got = [block("table", "Invoice Client Status")];
    expect(structureFindings(exp, got, "Dashboard", "")).toEqual(["table block 2 is missing", `the message "Saved" is not shown`]);
    expect(structureFindings(exp, [block("table", "invoice")], "Home", "saved")).toEqual([
      `the page does not show "Dashboard"`, `table block does not show "Client"`, "table block 2 is missing",
    ]);
    expect(structureFindings({ page: [], blocks: [], busy: true }, [], "nothing", "")).toEqual(["the loading state shows no loading placeholder"]);
  });

  it("tokens: a colour, font, corner or shadow that is none of the design's; scrims, pills and rings of a design colour pass", () => {
    const set = { colours: [[255, 255, 255], [26, 86, 219]] as [number, number, number][], fonts: ["Inter"], radii: [0, 4, 8], shadows: ["0 1px 2px rgba(0,0,0,.05)"] };
    expect(tokenFindings([
      { prop: "colour", value: "", where: "button", count: 3, rgb: [26, 86, 220, 1] },
      { prop: "colour", value: "", where: "scrim", count: 1, rgb: [0, 0, 0, 0.5] },
      { prop: "font", value: "inter", where: "body", count: 1 },
      { prop: "radius", value: "9999px", where: "pill", count: 1 },
      { prop: "radius", value: "12px", where: "chip", count: 1, size: 24 },
      { prop: "shadow", value: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px", where: "card", count: 1 },
      { prop: "shadow", value: "rgb(26, 86, 219) 0px 0px 0px 2px", where: "focus", count: 1 },
    ], set)).toEqual([]);
    const bad = tokenFindings([
      { prop: "colour", value: "", where: "badge", count: 2, rgb: [200, 0, 0, 1] },
      { prop: "font", value: "Comic Sans MS", where: "h1", count: 1 },
      { prop: "radius", value: "6px", where: "card", count: 1, size: 200 },
      { prop: "shadow", value: "rgba(0, 0, 0, 0.3) 0px 10px 30px 0px", where: "panel", count: 1 },
      { prop: "shadow", value: "rgb(200, 0, 0) 0px 0px 0px 2px", where: "input", count: 1 },
    ], set);
    expect(bad).toHaveLength(5);
    expect(bad[0]).toBe("colour rgb(200, 0, 0) is not a design colour (badge, 2 places)");
    expect(bad[2]).toMatch(/^corner 6px is not one of the design's/);
  });

  it("layout: a block only one side has, another order, a block much wider than approved; the actions row and nested blocks do not count", () => {
    const demo = [block("actions", "", 300), block("stats", "", 1000), block("table", "", 1000), block("form", "", 400, true)];
    expect(layoutFindings(demo, [block("stats", "", 900), block("table", "", 900), block("actions", "", 200)])).toEqual([]);
    expect(layoutFindings(demo, [block("table", "", 1000), block("stats", "", 300), block("chart", "", 1000)])).toEqual([
      "actions: 0 built, 1 approved", "chart: 1 built, 0 approved",
      "the blocks are in another order: table > stats (approved stats > table)", "stats is 30% of the page's width, approved 100%",
    ]);
  });
});

const report = (over: Partial<FidelityReport> = {}): FidelityReport => ({
  kind: "design-fidelity", overall: "pass", ran: ["Chromium"], notes: [], findings: [], pages: [],
  levels: (["tokens", "structure", "a11y", "layout", "pixels"] as const).map((level) => ({ level, check: level, blocking: ["tokens", "structure", "a11y"].includes(level), status: "PASS", detail: "ok" })),
  ...over,
});

describe("the blocking gates", () => {
  it("pass on PASS; fail with each finding and its pages; a level not checked fails", () => {
    expect(designTokensGate.predicate({ fidelity: report() })).toMatchObject({ passed: true });
    const r = report({ findings: [{ level: "structure", message: "table block is missing", pages: ["a", "b", "c", "d"] }] });
    r.levels[1]!.status = "FAIL";
    const v = designStructureGate.predicate({ fidelity: r });
    expect(v.passed).toBe(false);
    expect(JSON.stringify(v)).toContain("table block is missing (a, b, c, +1)");
    r.levels[2]!.status = "UNCHECKED";
    r.levels[2]!.detail = "axe did not load";
    expect(JSON.stringify(designA11yGate.predicate({ fidelity: r }))).toContain("could not check: axe did not load");
    expect(JSON.stringify(designTokensGate.predicate({ fidelity: report({ levels: [], skipped: "no app" }) }))).toContain("Tokens: not checked (no app)");
    // an app that keeps its own look: the tokens are not compared, and that does not fail the gate
    const own = report();
    own.levels[0] = { level: "tokens", blocking: false, check: "design.tokens", status: "UNCHECKED", detail: "the app keeps its own look" };
    expect(designTokensGate.predicate({ fidelity: own })).toMatchObject({ passed: true });
  });

  it("compares the tokens with the approved theme only: a new look's, never a default for an app with its own", () => {
    expect(approvedTheme({ theme: design.theme, themeSource: "new" })).toBe(design.theme);
    expect(approvedTheme({ theme: design.theme, themeSource: "repo" })).toBeUndefined();
    expect(approvedTheme({})).toBeUndefined();
    // no theme: no dark pages are opened for a mode the design never drew
    expect(fidelityPages({ ...design, theme: undefined }, ["S-1"]).some((p) => p.mode === "dark")).toBe(false);
  });
});

describe("baselines", () => {
  it("accepting copies the built pictures beside the line's versions, keeps an index and records who and why in the ledger", async () => {
    const ledger = Ledger.create(`20261003-fid-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "design", project: "p", request: "x" } }, HUMAN_WRITER);
    mkdirSync(join(ledger.dir, "design-fidelity", "built"), { recursive: true });
    writeFileSync(join(ledger.dir, "design-fidelity/built/s-1-default-phone.png"), "png-a");
    const root = mkdtempSync(join(tmpdir(), "factory-line-"));
    const pkg = { dir: join(root, "v1"), manifest: { line: "run-1", version: 1 } } as unknown as DesignPackage;
    const r = report({ pages: [{ key: "s-1-default-phone", built: "design-fidelity/built/s-1-default-phone.png" }, { key: "s-1-default-desktop" }] as never });

    await expect(acceptBaselines({ ledger, pkg, report: r, keys: "all", by: "lead", reason: " " })).rejects.toThrow(BaselineError);
    await expect(acceptBaselines({ ledger, pkg, report: r, keys: ["s-1-default-desktop"], by: "lead", reason: "ok" })).rejects.toThrow(/Not pictured/);
    expect(await acceptBaselines({ ledger, pkg, report: r, keys: "all", by: "lead", reason: "matches the design", now: new Date("2026-10-03T09:00:00Z") })).toEqual(["s-1-default-phone"]);

    expect(baselinesDir(pkg)).toBe(join(root, "baselines"));
    expect(readFileSync(join(root, "baselines/s-1-default-phone.png"), "utf8")).toBe("png-a");
    expect(readBaselineIndex(pkg).pages["s-1-default-phone"]).toMatchObject({ run: ledger.runId, designVersion: 1, by: "lead", reason: "matches the design", at: "2026-10-03T09:00:00.000Z" });
    expect(Object.keys(readBaselines(pkg))).toEqual(["s-1-default-phone"]);
    const ev = ledger.events().find((e) => e.type === "human.decided")!;
    expect(ev.data).toMatchObject({ cardId: "design-baseline", decision: "accept-baseline", by: "lead", pages: ["s-1-default-phone"] });
    expect(() => replay(ledger.events())).not.toThrow();
  });
});

/** A small PDF as Chromium writes it: plain objects, a page tree, named destinations, fonts. */
const pdf = (o: { pages: number; dests: string[]; bareFont?: boolean }) => Buffer.from([
  "%PDF-1.4",
  `1 0 obj << /Type /Pages /Count ${o.pages} /Kids [] >> endobj`,
  `2 0 obj << /Names [${o.dests.map((d) => `(/${d}) 9 0 R`).join(" ")}] >> endobj`,
  "3 0 obj << /Type /Font /Subtype /Type3 /Name /F1 >> endobj",
  "4 0 obj << /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Inter /FontDescriptor 5 0 R >> endobj",
  `5 0 obj << /Type /FontDescriptor /FontName /ABCDEF+Inter ${o.bareFont ? "" : "/FontFile2 6 0 R"} >> endobj`,
  "%%EOF",
].join("\n"), "latin1");

describe("export checks", () => {
  const pkg = { manifest: { screens: [{ id: "S-1", states: ["empty", "error"] }, { id: "S-2", states: ["default"] }] } } as unknown as DesignPackage;

  it("reads a PDF's page count, destinations and whether each font is embedded", () => {
    expect(pdfFacts(pdf({ pages: 4, dests: ["screen-S-1", "screen-S-2"] }))).toEqual({
      pages: 4, dests: ["screen-S-1", "screen-S-2"], fonts: [{ name: "Type3", embedded: true }, { name: "ABCDEF+Inter", embedded: true }],
    });
    expect(pdfFacts(pdf({ pages: 1, dests: [], bareFont: true })).fonts[1]).toEqual({ name: "ABCDEF+Inter", embedded: false });
  });

  it("the book has every screen, its fonts and a page per section; the PNGs are screens × states", () => {
    const out = mkdtempSync(join(tmpdir(), "factory-exp-"));
    writeFileSync(join(out, "design.pdf"), pdf({ pages: 3, dests: ["screen-S-1", "screen-S-2"] }));
    const record = { files: [{ path: "design.pdf", format: "pdf" }, { path: "png/1.png", format: "png" }, { path: "png/2.png", format: "png" }, { path: "png/3.png", format: "png" }], options: { formats: ["pdf", "png"] }, notes: [] } as never;
    const pictured = [{ name: "1", id: "S-1", stateBase: "Empty" }, { name: "2", id: "S-1", stateBase: "Error" }, { name: "3", id: "S-2", stateBase: "default" }];
    expect(wantedPairs(pkg, {})).toEqual([["S-1", "empty"], ["S-1", "error"], ["S-2", "default"]]);
    expect(checkExport(pkg, out, record, pictured).map((c) => `${c.check} ${c.status}`)).toEqual(["pdf.screens PASS", "pdf.fonts PASS", "pdf.pages PASS", "png.count PASS"]);

    writeFileSync(join(out, "design.pdf"), pdf({ pages: 2, dests: ["screen-S-1"], bareFont: true }));
    const bad = checkExport(pkg, out, record, pictured.slice(0, 2));
    expect(bad.map((c) => c.status)).toEqual(["FAIL", "FAIL", "FAIL", "FAIL"]);
    expect(bad[0]!.items).toEqual(["design.pdf: screen S-2 is not in the book"]);
    expect(bad[3]!.items).toEqual(["S-2 default: no picture", "3 PNG file(s) for 2 picture(s)"]);
    // a format not made is not checked
    expect(checkExport(pkg, out, { files: [], options: { formats: ["png"] }, notes: ["png: no browser"] } as never, [])).toEqual([]);
  });
});

describe("the generated Playwright tests", () => {
  it("a layer's action opens the layer first; a bulk action ticks a row first", () => {
    expect(pressesFor(s1, "Create")).toEqual([{ label: "New invoice" }, { label: "Create", within: `[data-b="overlay:New invoice"]` }]);
    expect(pressesFor(s1, "Mark paid")).toEqual([{ label: "Mark paid", within: `[data-b="table"]`, tick: true }]);
    expect(pressesFor(s2, "Confirm")).toEqual([{ label: "Pay now" }, { label: "Confirm", within: `[data-b="overlay:Pay now"]` }]);
    expect(pressesFor(s1, "New invoice")).toEqual([{ label: "New invoice" }]);
  });

  it("a screen's spec is tagged with its REQ ids and checks its states, links, layers and messages", () => {
    const spec = screenSpec(s1, { id: "S-1", route: "/", title: "Dashboard" }, design.screens, "TAG");
    expect(spec).toContain("@S-1");
    expect(spec).toContain("@R-1");
    expect(spec).toContain(`"fixture"`.slice(1, -1));
    for (const w of ["loading", "toast-marked-as-paid", "Marked as paid", "New invoice", "/invoices/"]) expect(spec).toContain(w);
  });

  it("the config: Chromium at three widths, dark when the design has it, WebKit at phone width when asked", () => {
    const c = e2eConfig({ tag: "TAG", next: true, dark: true });
    for (const w of ["phone", "tablet", "desktop", "desktop-dark", "webkit-phone", "DESIGN_BROWSERS", "DESIGN_BASE_URL", "DESIGN_CHANNEL", "next start -p 3100"]) expect(c).toContain(w);
    expect(e2eConfig({ tag: "TAG", next: false, dark: false })).not.toContain("desktop-dark");
  });

  it("the scaffold writes a spec per kit screen, the config, the script and the dev dependency, and keeps them out of the app's tsconfig", () => {
    const l = scaffold({ design, kit: loadKit(), product: "Acme Billing", tag: "TAG", apps: ["portal"], target: "next-shadcn" });
    const paths = l.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["e2e/design/s-1.spec.ts", "e2e/design/s-7.spec.ts", "playwright.design.config.ts"]));
    expect(paths).not.toContain("e2e/design/s-6.spec.ts");
    const pj = JSON.parse(l.files.find((f) => f.path === "package.json")!.text);
    expect(pj.scripts["test:design"]).toBe("playwright test -c playwright.design.config.ts");
    expect(pj.devDependencies["@playwright/test"]).toBeDefined();
    expect(JSON.parse(l.files.find((f) => f.path === "tsconfig.json")!.text).exclude).toEqual(expect.arrayContaining(["e2e/design", "playwright.design.config.ts"]));
    expect(e2eFiles({ design, screens: l.screens, write: () => false, tag: "TAG", next: true }).map((f) => f.path)).toEqual(["playwright.design.config.ts"]);
  });
});

describe("the design-fidelity step", () => {
  it("is on by default with the kit's commands; design.fidelity changes them and false switches it off", () => {
    const p = (design?: object) => ProjectConfig.parse({ project: "p", repo: "/r", stack: "dotnet", ...(design ? { design } : {}) });
    expect(fidelityConfig(p())).toMatchObject({ port: 4320, readyPath: "/", maxPages: 160 });
    expect(fidelityConfig(p({ fidelity: { allowHost: true, port: 4400 } }))).toMatchObject({ port: 4400 });
    expect(p({ fidelity: false }).design?.fidelity).toBe(false);
  });

  it("does nothing, and says why, without a kit scaffold or when switched off", async () => {
    const ledger = Ledger.create(`20261003-fs-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x" } }, HUMAN_WRITER);
    await ledger.append({ type: "step.completed", key: "integrate/1", inputsHash: "a".repeat(64), outputs: [ledger.putJson({})], data: { commit: "c1" } }, HUMAN_WRITER);
    const logs: string[] = [];
    const ctx = (project: object) => {
      const state = replay(ledger.events());
      return { runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project, policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: (m: string) => logs.push(m), trace: NO_TRACE, usage: async () => undefined } as unknown as StepContext;
    };
    const out = await designFidelityStep.run(ctx({ design: { fidelity: { allowHost: true, port: 4320, readyPath: "/", timeoutSec: 600, env: {}, maxPages: 160 } } }));
    expect(out).toMatchObject({ kind: "done", data: { skipped: expect.stringMatching(/no scaffold/) } });
    expect(logs[0]).toMatch(/^fidelity check skipped/);
    // no gate ran, so nothing waits on a waiver
    expect(ledger.events().some((e) => e.type === "gate.result")).toBe(false);
    // no project setting at all: still only the missing scaffold stops it
    expect(await designFidelityStep.run(ctx({}))).toMatchObject({ kind: "done", data: { skipped: expect.stringMatching(/no scaffold/) } });
  });
});
