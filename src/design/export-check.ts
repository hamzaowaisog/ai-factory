// Checks on a design export (docs/estimates-design.md, "Fidelity and tests", export checks): each PDF has every screen it should
// (a named destination per screen section), its fonts embedded, and at least a page per section; the PNG set has a picture of
// every screen in every state the options ask for, one file per picture. Run on the files as written, so a broken printer or a
// missing picture shows on the export instead of at the client.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "./fidelity.js";
import type { ExportOptions, ExportRecord } from "./export.js";
import type { DesignPackage } from "./package.js";

export interface PdfFacts { pages: number; dests: string[]; fonts: { name: string; embedded: boolean }[] }

/**
 * What a PDF says about itself, read from its plain objects (Chromium writes them uncompressed): the page count of the page tree,
 * the named destinations, and each font with whether its glyphs are in the file (a font file, or a Type 3 font, which draws them).
 */
export function pdfFacts(pdf: Buffer): PdfFacts {
  const text = pdf.toString("latin1");
  const objs = new Map<string, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objs.set(m[1]!, m[2]!.split("stream")[0]!);
  let pages = 0;
  for (const body of objs.values()) {
    if (/\/Type\s*\/Pages\b/.test(body)) pages = Math.max(pages, Number(/\/Count\s+(\d+)/.exec(body)?.[1] ?? 0));
  }
  const dests = [...new Set([...text.matchAll(/\/(screen-[A-Za-z0-9._-]+)/g)].map((m) => m[1]!))];
  const fonts: PdfFacts["fonts"] = [];
  for (const body of objs.values()) {
    if (!/\/Type\s*\/Font\b/.test(body)) continue;
    const sub = /\/Subtype\s*\/(\w+)/.exec(body)?.[1] ?? "";
    if (sub === "Type0") continue; // its descendant CID font is listed itself
    const name = /\/BaseFont\s*\/([^\s/<>[\]]+)/.exec(body)?.[1] ?? (/\/FontName\s*\/([^\s/<>[\]]+)/.exec(objs.get(/\/FontDescriptor\s+(\d+) 0 R/.exec(body)?.[1] ?? "") ?? "")?.[1]) ?? sub;
    if (sub === "Type3") { fonts.push({ name, embedded: true }); continue; }
    const fd = objs.get(/\/FontDescriptor\s+(\d+) 0 R/.exec(body)?.[1] ?? "") ?? "";
    fonts.push({ name, embedded: /\/FontFile[23]?\b/.test(fd) });
  }
  return { pages, dests, fonts };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

/** The screens and states the options ask for, as [screen id, state] pairs. */
export function wantedPairs(pkg: DesignPackage, o: Pick<ExportOptions, "screens" | "states">): [string, string][] {
  const screens = o.screens?.map((x) => x.toLowerCase()), states = o.states?.map(slug);
  return pkg.manifest.screens.filter((s) => !screens || screens.includes(s.id.toLowerCase()))
    .flatMap((s) => s.states.filter((st) => !states || states.includes(slug(st))).map((st): [string, string] => [s.id, st]));
}

/** The export's checks; a format it did not make (no browser, not asked for) is not checked. */
export function checkExport(pkg: DesignPackage, out: string, record: Pick<ExportRecord, "files" | "options" | "notes">, pictured: { name: string; id?: string; stateBase: string }[]): CheckResult[] {
  const out_: CheckResult[] = [];
  const pdfs = record.files.filter((f) => f.format === "pdf");
  if (pdfs.length) {
    const screensOf = (path: string): string[] => {
      const one = /^pdf\/(.+)\.pdf$/.exec(path)?.[1];
      if (one) return [one];
      const want = record.options.screens?.map((x) => x.toLowerCase());
      return pkg.manifest.screens.filter((s) => !want || want.includes(s.id.toLowerCase())).map((s) => s.id);
    };
    const missing: string[] = [], bare: string[] = [], short: string[] = [];
    const counts: string[] = [];
    for (const f of pdfs) {
      const p = join(out, f.path);
      if (!existsSync(p)) { missing.push(`${f.path}: the file is missing`); continue; }
      const facts = pdfFacts(readFileSync(p));
      const want = screensOf(f.path);
      for (const id of want) if (!facts.dests.includes(`screen-${id}`)) missing.push(`${f.path}: screen ${id} is not in the book`);
      for (const font of facts.fonts) if (!font.embedded) bare.push(`${f.path}: the font ${font.name} is not embedded`);
      // a cover, then a page or more per screen section
      const least = want.length + 1;
      if (facts.pages < least) short.push(`${f.path}: ${facts.pages} page(s), fewer than the ${least} its cover and ${want.length} screen(s) need`);
      counts.push(`${f.path} ${facts.pages} page(s), ${want.length} screen(s), ${facts.fonts.length} font(s)`);
    }
    out_.push(missing.length ? { check: "pdf.screens", status: "FAIL", detail: `${missing.length} screen(s) missing`, items: missing } : { check: "pdf.screens", status: "PASS", detail: "every screen is in the book" });
    out_.push(bare.length ? { check: "pdf.fonts", status: "FAIL", detail: `${bare.length} font(s) not embedded`, items: bare } : { check: "pdf.fonts", status: "PASS", detail: "every font is embedded" });
    out_.push(short.length ? { check: "pdf.pages", status: "FAIL", detail: "too few pages", items: short } : { check: "pdf.pages", status: "PASS", detail: counts.join("; ") });
  }
  if (record.options.formats.includes("png") && !record.notes.some((n) => n.startsWith("png:"))) {
    const pngs = record.files.filter((f) => f.format === "png");
    const pairs = wantedPairs(pkg, record.options);
    const have = new Set(pictured.map((s) => `${s.id}|${slug(s.stateBase)}`));
    const gaps = pairs.filter(([id, st]) => !have.has(`${id}|${slug(st)}`)).map(([id, st]) => `${id} ${st}: no picture`);
    const items = [...gaps, ...(pngs.length !== pictured.length ? [`${pngs.length} PNG file(s) for ${pictured.length} picture(s)`] : [])];
    out_.push(items.length
      ? { check: "png.count", status: "FAIL", detail: `${pairs.length - gaps.length} of ${pairs.length} screen states pictured`, items }
      : { check: "png.count", status: "PASS", detail: `${pngs.length} PNG(s) cover all ${pairs.length} screen states (screens × states)` });
  }
  const fig = record.files.find((f) => f.format === "figma");
  if (fig) {
    // figma.json: it reads as the plugin's schema, and has a frame of every screen in every state asked for, each with layers
    let doc: { kind?: string; schemaVersion?: number; frames?: { screen: string; state: string; nodes: number; root?: unknown }[] } | undefined;
    try { doc = JSON.parse(readFileSync(join(out, fig.path), "utf8")); } catch { doc = undefined; }
    if (!doc || doc.kind !== "ai-factory/figma" || !Array.isArray(doc.frames)) out_.push({ check: "figma.frames", status: "FAIL", detail: "figma.json does not read as the plugin's file" });
    else {
      const have = new Set(doc.frames.filter((f) => f.root && f.nodes > 1).map((f) => `${f.screen}|${slug(f.state)}`));
      // a screen state is only pictured, so only checked, where the package has a picture of it
      const shown = new Set(pictured_(pictured));
      const pairs = wantedPairs(pkg, record.options).filter(([id, st]) => shown.has(`${id}|${slug(st)}`));
      const gaps = pairs.filter(([id, st]) => !have.has(`${id}|${slug(st)}`)).map(([id, st]) => `${id} ${st}: no frame`);
      out_.push(gaps.length
        ? { check: "figma.frames", status: "FAIL", detail: `${pairs.length - gaps.length} of ${pairs.length} screen states have a frame`, items: gaps }
        : { check: "figma.frames", status: "PASS", detail: `${doc.frames.length} frame(s) with ${doc.frames.reduce((n, f) => n + f.nodes, 0)} layer(s) cover all ${pairs.length} screen states` });
    }
  }
  return out_;
}

const pictured_ = (shots: { id?: string; stateBase: string }[]): string[] => shots.map((s) => `${s.id}|${slug(s.stateBase)}`);
