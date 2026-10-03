// Design exports (docs/estimates-design.md, "Exports", requirement 3): files made from an approved design
// package for people outside the factory: pictures, a PDF design book, the clickable demo, the tokens and
// the design as JSON. Exports read only the package (src/design/package.ts), never the ledger, so every
// file matches what was approved; each one carries the design line, version and sha.
//
//   <out>/
//     export.json          what was exported, from which version and sha, with the options and every file's sha-256
//     png/S-1_empty_phone_dark_ar.png ...   (each picture carries the design tag in a PNG text chunk)
//     design-book.pdf      or pdf/S-1.pdf ... with --pdf-per-screen
//     demo.zip             the clickable demo, standalone
//     tokens/tokens.json, tokens.css, tailwind.css (a Tailwind v4 @theme block)
//     json/design.json, manifest.json
//     figma.json           the design as layers, components and variables for the AI Factory Import plugin (figma-plugin/)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32 } from "node:zlib";
import JSZip from "jszip";
import { designTokens } from "./tokens.js";
import { findChromium, VIEWPORTS, type Shot, type Viewport } from "./screenshots.js";
import type { DesignTheme } from "../contracts/artifacts.js";
import { checkExport } from "./export-check.js";
import { figmaDoc } from "./figma.js";
import type { CheckResult } from "./fidelity.js";
import { readDesignJson, w3cTokens, type DesignPackage, type PackageFile } from "./package.js";

/** What can be exported. `figma` is `figma.json` for the AI Factory Import plugin (figma-plugin/). */
export const EXPORT_FORMATS = ["png", "pdf", "html", "tokens", "json", "figma"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_MODES = ["light", "dark"] as const;

export interface ExportOptions {
  formats: ExportFormat[];
  /** screen ids (S-1, components); all when absent */
  screens?: string[];
  /** state names as on the demo's tabs (empty, error, "full data"); all when absent */
  states?: string[];
  widths?: Viewport[];
  modes?: (typeof EXPORT_MODES)[number][];
  /** language codes (en, ar); all when absent */
  langs?: string[];
  pdfPerScreen?: boolean;
}

export interface ExportRecord {
  kind: "ai-factory/design-export";
  line: string;
  version: number;
  designSha: string;
  at: string;
  options: ExportOptions;
  files: (PackageFile & { format: ExportFormat })[];
  /** what could not be made, and why (no browser, nothing matched the filters) */
  notes: string[];
  /** the checks on the files written: every screen in the PDF, fonts embedded, a picture per screen state */
  checks?: CheckResult[];
}

/** "png,pdf", "all": the formats asked for, refusing what is not built yet. */
export function parseFormats(list: string): ExportFormat[] {
  const asked = list.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!asked.length) throw new Error("Name at least one format: png, pdf, html, tokens, json, figma or all.");
  const out = new Set<ExportFormat>();
  for (const f of asked) {
    if (f === "all") EXPORT_FORMATS.forEach((x) => out.add(x));
    else if ((EXPORT_FORMATS as readonly string[]).includes(f)) out.add(f as ExportFormat);
    else throw new Error(`Unknown format "${f}". Use png, pdf, html, tokens, json, figma or all.`);
  }
  return EXPORT_FORMATS.filter((f) => out.has(f));
}

/** A comma list from the command line or the API, checked against what is allowed. */
export function parseList<T extends string>(what: string, value: string | string[] | undefined, allowed?: readonly T[]): T[] | undefined {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : value.split(",")).map((x) => String(x).trim()).filter(Boolean);
  if (!items.length) return undefined;
  const bad = allowed ? items.filter((x) => !allowed.includes(x as T)) : [];
  if (bad.length) throw new Error(`Unknown ${what}: ${bad.join(", ")}. Use ${allowed!.join(", ")}.`);
  return items as T[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
/** The tag every exported file carries: which design, which version, which approved sha. */
export const designTag = (pkg: DesignPackage): string => `ai-factory design ${pkg.manifest.line} v${pkg.manifest.version} (${pkg.manifest.designSha.slice(0, 12)}), approved by ${pkg.manifest.approved.by} on ${pkg.manifest.approved.at.slice(0, 10)}`;

// ---------- which pictures ----------

/** A picture as an export names and filters it: the demo state it shows, and its width, colour mode and language. */
export interface ExportShot extends Shot { stateBase: string; modeName: "light" | "dark"; langCode: string; name: string }

/** The package's pictures with their export names; the dark-mode and other-language pictures show the screen's first state. */
export function exportShots(pkg: DesignPackage, firstLang: string): ExportShot[] {
  const first = new Map(pkg.manifest.screens.map((s) => [s.id, s.states[0] ?? "Default"]));
  return pkg.manifest.shots.map((s) => {
    const stateBase = s.mode || s.lang ? (s.id ? first.get(s.id) : undefined) ?? "Default" : s.state;
    const name = `${s.id ?? slug(s.screen)}_${slug(stateBase)}_${s.viewport}${s.mode === "dark" ? "_dark" : ""}${s.lang ? `_${s.lang}` : ""}.png`;
    return { ...s, stateBase, modeName: s.mode === "dark" ? "dark" : "light", langCode: s.lang ?? firstLang, name };
  });
}

/** The pictures the options ask for. */
export function pickShots(shots: ExportShot[], o: ExportOptions): ExportShot[] {
  const screens = o.screens?.map((x) => x.toLowerCase()), states = o.states?.map(slug);
  return shots.filter((s) =>
    (!screens || screens.includes((s.id ?? "").toLowerCase())) && (!states || states.includes(slug(s.stateBase)))
    && (!o.widths || o.widths.includes(s.viewport)) && (!o.modes || o.modes.includes(s.modeName)) && (!o.langs || o.langs.includes(s.langCode)));
}

/** A PNG with a text chunk (`ai-factory-design`) after its header, so a picture says which design it shows wherever it ends up. */
export function tagPng(png: Buffer, text: string): Buffer {
  if (png.length < 33 || png.readUInt32BE(12) !== 0x49484452) return png;
  const data = Buffer.concat([Buffer.from("ai-factory-design\0", "latin1"), Buffer.from(text.replace(/[^\x20-\x7e]/g, "?"), "latin1")]);
  const type = Buffer.from("tEXt", "latin1");
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  return Buffer.concat([png.subarray(0, 33), len, type, data, crc, png.subarray(33)]);
}

/** The text chunk a tagged PNG carries, or undefined. */
export function pngTag(png: Buffer): string | undefined {
  let at = 8;
  while (at + 8 <= png.length) {
    const n = png.readUInt32BE(at), type = png.toString("latin1", at + 4, at + 8);
    if (type === "tEXt") {
      const body = png.toString("latin1", at + 8, at + 8 + n), k = body.indexOf("\0");
      if (body.slice(0, k) === "ai-factory-design") return body.slice(k + 1);
    }
    if (type === "IDAT") return undefined;
    at += 12 + n;
  }
  return undefined;
}

// ---------- tokens ----------

/** The approved look as a Tailwind v4 `@theme` block, with the dark values as overrides when the product has both modes. */
export function tailwindTheme(theme: DesignTheme, tag: string): string {
  const t = designTokens(theme);
  const modes = Object.keys(t.colour) as ("light" | "dark")[];
  const colours = (m: "light" | "dark") => Object.entries(t.colour[m]!).map(([k, v]) => `--color-${k}: ${v};`);
  const shadows = (m: "light" | "dark") => [`--shadow-card: ${t.shadow[m]!.card};`, `--shadow-raised: ${t.shadow[m]!.raised};`];
  const block = (lines: string[], pad = "  ") => lines.map((l) => `${pad}${l}`).join("\n");
  const main = [
    ...colours(modes[0]!), `--font-body: ${t.type.body};`, `--font-heading: ${t.type.heading};`, `--radius-base: ${t.radiusPx}px;`,
    `--spacing-pad: ${t.space.padPx}px;`, `--spacing-row: ${t.space.rowPx}px;`, ...shadows(modes[0]!), `--ease-standard: ${t.motion.ease};`, `--ease-spring: ${t.motion.spring};`,
  ];
  const dark = modes.length > 1 ? [...colours("dark"), ...shadows("dark")] : [];
  return [
    `/* ${tag} */`, `/* Tailwind v4: @import "tailwindcss"; then this file. Classes: bg-brand, text-text-muted, rounded-base, p-pad, shadow-card, font-heading. */`,
    `@theme {`, block(main), `}`,
    ...(dark.length ? [`@media (prefers-color-scheme: dark) {`, `  :root {`, block(dark, "    "), `  }`, `}`, `:root[data-theme="dark"] {`, block(dark), `}`, `:root[data-theme="light"] {`, block([...colours("light"), ...shadows("light")]), `}`] : []),
    ``,
  ].join("\n");
}

// ---------- the PDF design book ----------

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const dataUri = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

interface BookDesign { flow?: string; theme?: DesignTheme; links?: { from: string; to: string }[]; locale?: { languages: string[] } }

/**
 * The design book as one HTML page for Chromium to print: a cover, the product reading, the look and its
 * tokens, the Components page, then each screen with its states (the widths side by side), its links and
 * its requirements. `screens` limits it to some screens (one PDF per screen).
 */
export function bookHtml(pkg: DesignPackage, shots: ExportShot[], o: { requirements?: Record<string, string>; screens?: string[] } = {}): string {
  const m = pkg.manifest;
  const d = readDesignJson(readFileSync(join(pkg.dir, "design.json"), "utf8")) as BookDesign;
  const product = m.product.name ?? m.run.project;
  const tag = designTag(pkg);
  const theme = d.theme;
  const tokens = existsSync(join(pkg.dir, "tokens.json")) && theme ? designTokens(theme) : undefined;
  const shotFile = (s: ExportShot) => join(pkg.dir, "shots", s.file);
  const order: Viewport[] = ["desktop", "tablet", "phone"];
  const variants = (list: ExportShot[]) => {
    const groups = new Map<string, ExportShot[]>();
    for (const s of list) { const k = `${s.stateBase}|${s.modeName}|${s.langCode}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
    return [...groups.values()].map((g) => g.sort((a, b) => order.indexOf(a.viewport) - order.indexOf(b.viewport)));
  };
  const figure = (g: ExportShot[]) => {
    const s0 = g[0]!;
    const label = `${s0.stateBase}${s0.modeName === "dark" ? " · dark mode" : ""}${s0.lang ? ` · ${s0.lang}` : ""}`;
    const total = g.reduce((n, s) => n + VIEWPORTS[s.viewport].width, 0);
    return `<figure><figcaption>${esc(label)}</figcaption><div class="row">${g.map((s) => `<div class="shot" style="flex:${(VIEWPORTS[s.viewport].width / total).toFixed(3)}"><img src="${dataUri(shotFile(s))}" alt=""><span>${s.viewport}</span></div>`).join("")}</div></figure>`;
  };
  const wanted = o.screens?.map((x) => x.toLowerCase());
  const screens = m.screens.filter((s) => !wanted || wanted.includes(s.id.toLowerCase()));
  const components = shots.filter((s) => s.id === "components");
  const swatches = tokens ? Object.entries(tokens.colour).map(([mode, c]) => `<h3>${esc(mode)} mode</h3><div class="sw">${Object.entries(c!).map(([k, v]) => `<div><i style="background:${esc(v)}"></i><b>${esc(k)}</b><code>${esc(v)}</code></div>`).join("")}</div>`).join("") : "";
  const reading = theme?.reading;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(`${product} - design ${m.line} v${m.version} (${m.designSha.slice(0, 8)})`)}</title>
<meta name="description" content="${esc(tag)}"><style>
@page { size: A4 landscape; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; } body { font: 10.5pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2430; margin: 0; }
h1 { font-size: 30pt; margin: 0 0 6mm; } h2 { font-size: 17pt; margin: 0 0 3mm; } h3 { font-size: 11pt; margin: 4mm 0 2mm; color: #4a5565; }
section { break-before: page; } section.cover { break-before: auto; display: flex; flex-direction: column; justify-content: center; min-height: 170mm; }
.muted { color: #5b6676; } code { font: 9pt ui-monospace, Menlo, monospace; } dl { display: grid; grid-template-columns: 38mm 1fr; gap: 1.5mm 4mm; margin: 0; } dt { color: #5b6676; }
.brand { width: 18mm; height: 4mm; border-radius: 2mm; background: ${esc(theme?.brand ?? "#1f6feb")}; margin-bottom: 8mm; }
.sw { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm 4mm; } .sw div { display: grid; grid-template-columns: 9mm 1fr; grid-template-rows: auto auto; column-gap: 2mm; align-items: center; }
.sw i { grid-row: span 2; width: 9mm; height: 9mm; border-radius: 1.5mm; border: 0.2mm solid #0002; } .sw b { font-weight: 600; font-size: 9pt; } .sw code { color: #5b6676; }
figure { margin: 0 0 5mm; break-inside: avoid; } figcaption { font-weight: 600; margin-bottom: 2mm; break-after: avoid; }
/* a picture never runs past a page (the printable height is 180mm): a tall capture is scaled down whole, never sliced; the PNG export has it full size */
.row { display: flex; gap: 4mm; align-items: flex-start; } .shot { min-width: 0; } .shot img { max-width: 100%; max-height: 150mm; width: auto; border: 0.2mm solid #d5dbe3; border-radius: 1.5mm; display: block; } .shot span { display: block; font-size: 8pt; color: #5b6676; }
ul { margin: 1mm 0 3mm 5mm; padding: 0; } .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3mm; }
</style></head><body>
<section class="cover"><div class="brand"></div><h1>${esc(product)}</h1>
<p class="muted" style="font-size:13pt;margin:0 0 8mm">Design ${esc(m.line)} · version ${m.version}${m.product.client ? ` · for ${esc(m.product.client)}` : ""}</p>
<dl><dt>Approved</dt><dd>by ${esc(m.approved.by)} on ${esc(m.approved.at.slice(0, 10))}</dd><dt>Design sha</dt><dd><code>${esc(m.designSha)}</code></dd>
<dt>Screens</dt><dd>${m.screens.length}: ${screens.map((sc) => `<a href="#screen-${esc(sc.id)}">${esc(sc.id)}</a>`).join(", ")}</dd>${m.previous ? `<dt>Changes v${m.previous.version}</dt><dd>${(m.changes ?? []).map(esc).join("<br>") || "no screen changed"}</dd>` : ""}
${d.flow ? `<dt>Flow</dt><dd>${esc(d.flow)}</dd>` : ""}</dl></section>
${reading || theme ? `<section><h2>The product and its look</h2>${reading ? `<dl><dt>Who uses it</dt><dd>${esc(reading.users)}</dd><dt>Where</dt><dd>${esc(reading.context)}</dd><dt>Device</dt><dd>${esc(reading.device)}</dd><dt>Tone</dt><dd>${esc(reading.tone)}</dd><dt>What matters most</dt><dd>${esc(reading.hero)}</dd><dt>Traits</dt><dd>${(reading.traits ?? []).map(esc).join(", ")}</dd></dl>` : ""}
${theme?.basis?.length ? `<h3>Drawn from</h3><ul>${theme.basis.map((b) => `<li><b>${esc(b.ref)}</b>: ${esc(b.took)}</li>`).join("")}</ul>` : ""}
${tokens ? `<h3>Type, corners and spacing</h3><dl><dt>Body font</dt><dd>${esc(tokens.type.body)}</dd><dt>Heading font</dt><dd>${esc(tokens.type.heading)} (${tokens.type.headingWeight})</dd><dt>Corners</dt><dd>${tokens.radiusPx} px</dd><dt>Spacing</dt><dd>${tokens.space.padPx} px padding, ${tokens.space.rowPx} px rows</dd></dl>${swatches}` : `<p class="muted">The product keeps the app's own look; there are no new tokens.</p>`}</section>` : ""}
${components.length && !wanted ? `<section><h2>Components</h2>${variants(components).map(figure).join("")}</section>` : ""}
${screens.map((sc) => {
    const own = shots.filter((s) => s.id === sc.id);
    const links = (d.links ?? []).filter((l) => l.from === sc.id || l.from === sc.title).map((l) => l.to);
    return `<section id="screen-${esc(sc.id)}"><div class="head"><h2>${esc(sc.title)}</h2><code class="muted">${esc(sc.id)} ${esc(sc.route)}</code></div>
${sc.reqs.length ? `<h3>Requirements</h3><ul>${sc.reqs.map((r) => `<li><b>${esc(r)}</b>${o.requirements?.[r] ? ` ${esc(o.requirements[r])}` : ""}</li>`).join("")}</ul>` : ""}
${links.length ? `<p class="muted">Goes to: ${links.map(esc).join(", ")}</p>` : ""}
<p class="muted">States: ${sc.states.map(esc).join(", ")}</p>
${own.length ? variants(own).map(figure).join("") : `<p class="muted">No pictures of this screen match the options.</p>`}</section>`;
  }).join("\n")}
</body></html>`;
}

/** Print HTML pages to PDF with Chromium (fonts embedded). Undefined, with the reason, when there is no browser. */
async function printPdfs(jobs: { html: string; out: string }[], footer: string): Promise<string | undefined> {
  if (process.env.FACTORY_NO_SCREENSHOTS) return "the PDF needs a browser, and screenshots are switched off (FACTORY_NO_SCREENSHOTS)";
  const exe = findChromium();
  if (!exe) return "the PDF needs Chromium, and there is no browser here (npx playwright install chromium, or set FACTORY_CHROMIUM)";
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    for (const j of jobs) {
      await page.setContent(j.html, { waitUntil: "load" });
      await page.evaluate("document.fonts.ready");
      await page.pdf({
        path: j.out, format: "A4", landscape: true, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
        footerTemplate: `<div style="font:7pt system-ui,sans-serif;color:#6b7684;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
        margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
      });
    }
  } finally {
    await browser.close();
  }
  return undefined;
}

/** The design book of a package as one PDF at `out` (the estimate puts it beside the client workbook). Returns why not, when it could not be made. */
export async function writeDesignBook(pkg: DesignPackage, out: string, o: { requirements?: Record<string, string> } = {}): Promise<string | undefined> {
  mkdirSync(join(out, ".."), { recursive: true });
  return printPdfs([{ html: bookHtml(pkg, exportShots(pkg, firstLang(pkg)), o), out }], designTag(pkg));
}

// ---------- pictures for a package without them ----------

/** A package's pictures; one written without a browser has none, and the export cannot add them (a package never changes). */
async function packageShots(pkg: DesignPackage): Promise<{ note?: string }> {
  return pkg.manifest.shots.length ? {} : { note: `the package has no pictures (${pkg.manifest.shotsNote ?? "none were taken"})` };
}

const firstLang = (pkg: DesignPackage): string => {
  try { return (readDesignJson(readFileSync(join(pkg.dir, "design.json"), "utf8")) as BookDesign).locale?.languages[0] ?? "en"; } catch { return "en"; }
};

// ---------- the export ----------

/**
 * Export a package into `out`. Writes `export.json` last. Formats that cannot be made (a PDF with no browser,
 * pictures that no filter matched) are listed in `notes`; the rest are still written.
 */
export async function exportDesign(pkg: DesignPackage, out: string, o: ExportOptions, extra: { requirements?: Record<string, string>; log?: (m: string) => void } = {}): Promise<ExportRecord> {
  mkdirSync(out, { recursive: true });
  const m = pkg.manifest, tag = designTag(pkg), notes: string[] = [];
  const all = exportShots(pkg, firstLang(pkg));
  const picked = pickShots(all, o);
  const pictureNote = (await packageShots(pkg)).note;
  const files: ExportRecord["files"] = [];
  const add = (format: ExportFormat, rel: string, body: Buffer | string) => {
    const p = join(out, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
    files.push({ format, path: rel, sha256: sha256(b), bytes: b.length });
  };
  const d = readDesignJson(readFileSync(join(pkg.dir, "design.json"), "utf8")) as BookDesign;

  if (o.formats.includes("png")) {
    if (pictureNote) notes.push(`png: ${pictureNote}`);
    else if (!picked.length) notes.push("png: no picture matches the options");
    for (const s of picked) add("png", `png/${s.name}`, tagPng(readFileSync(join(pkg.dir, "shots", s.file)), tag));
  }
  if (o.formats.includes("pdf")) {
    const per = o.pdfPerScreen ? m.screens.filter((s) => !o.screens || o.screens.map((x) => x.toLowerCase()).includes(s.id.toLowerCase())) : [];
    const jobs = o.pdfPerScreen
      ? per.map((s) => ({ html: bookHtml(pkg, picked, { requirements: extra.requirements, screens: [s.id] }), rel: `pdf/${s.id}.pdf` }))
      : [{ html: bookHtml(pkg, picked, { requirements: extra.requirements, ...(o.screens ? { screens: o.screens } : {}) }), rel: "design-book.pdf" }];
    jobs.forEach((j) => mkdirSync(join(out, j.rel, ".."), { recursive: true }));
    const why = await printPdfs(jobs.map((j) => ({ html: j.html, out: join(out, j.rel) })), tag);
    if (why) notes.push(`pdf: ${why}`);
    else {
      if (pictureNote) notes.push(`pdf: ${pictureNote}, so the book has no screen pictures`);
      for (const j of jobs) { const b = readFileSync(join(out, j.rel)); files.push({ format: "pdf", path: j.rel, sha256: sha256(b), bytes: b.length }); }
    }
  }
  if (o.formats.includes("html")) {
    const zip = new JSZip();
    // dated at the approval, so the same version always gives the same zip
    const date = new Date(m.approved.at);
    zip.file("index.html", readFileSync(join(pkg.dir, "demo", "index.html")), { date });
    zip.file("README.txt", `${tag}\n\nThe clickable demo the lead approved. Open index.html in a browser; it needs no server and no network.\n`, { date });
    add("html", "demo.zip", await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  if (o.formats.includes("tokens")) {
    if (!d.theme || !existsSync(join(pkg.dir, "tokens.json"))) notes.push("tokens: the design keeps the app's own look, so it has no tokens of its own");
    else {
      const w3c = w3cTokens(d.theme) as Record<string, unknown> & { $extensions: Record<string, unknown> };
      add("tokens", "tokens/tokens.json", `${JSON.stringify({ ...w3c, $extensions: { ...w3c.$extensions, "ai.factory.design": { line: m.line, version: m.version, designSha: m.designSha } } }, null, 2)}\n`);
      add("tokens", "tokens/tokens.css", `/* ${tag} */\n${readFileSync(join(pkg.dir, "tokens.css"), "utf8")}`);
      add("tokens", "tokens/tailwind.css", tailwindTheme(d.theme, tag));
    }
  }
  if (o.formats.includes("json")) {
    add("json", "json/design.json", readFileSync(join(pkg.dir, "design.json")));
    add("json", "json/manifest.json", readFileSync(join(pkg.dir, "manifest.json")));
  }
  if (o.formats.includes("figma")) {
    const r = await figmaDoc(pkg, picked, tag, extra.log);
    if (r.why) notes.push(`figma: ${r.why}`);
    else if (!r.doc!.frames.length) notes.push(`figma: ${picked.length ? "no picture's view could be read from the demo" : "no picture matches the options"}`);
    else {
      add("figma", "figma.json", JSON.stringify(r.doc));
      for (const n of r.doc!.notes) notes.push(`figma: ${n}`);
    }
  }
  const record: ExportRecord = { kind: "ai-factory/design-export", line: m.line, version: m.version, designSha: m.designSha, at: new Date().toISOString(), options: o, files, notes, checks: [] };
  record.checks = checkExport(pkg, out, record, o.formats.includes("png") || o.formats.includes("figma") ? picked : []);
  for (const c of record.checks) if (c.status !== "PASS") extra.log?.(`design export: ${c.check} ${c.status}: ${c.detail}`);
  writeFileSync(join(out, "export.json"), `${JSON.stringify(record, null, 2)}\n`);
  for (const n of notes) extra.log?.(`design export: ${n}`);
  return record;
}

// ---------- a run's exports ----------

/** Where a run keeps its exports: `<run>/exports/vN/<n>/`, one numbered folder per export. */
export const exportsRoot = (runDir: string): string => join(runDir, "exports");

/** The next free folder for an export of version N. */
export function nextExportDir(runDir: string, version: number): string {
  const vd = join(exportsRoot(runDir), `v${version}`);
  const taken = existsSync(vd) ? readdirSync(vd).filter((x) => /^\d+$/.test(x)).map(Number) : [];
  return join(vd, String(Math.max(0, ...taken) + 1));
}

export interface ExportListing extends ExportRecord { id: string; dir: string }

/** Every export of a run, newest first; `id` is `vN/n`. */
export function listExports(runDir: string): ExportListing[] {
  const root = exportsRoot(runDir);
  if (!existsSync(root)) return [];
  const out: ExportListing[] = [];
  for (const v of readdirSync(root).filter((x) => /^v\d+$/.test(x))) {
    for (const n of readdirSync(join(root, v)).filter((x) => /^\d+$/.test(x))) {
      const f = join(root, v, n, "export.json");
      if (!existsSync(f)) continue;
      try { out.push({ ...(JSON.parse(readFileSync(f, "utf8")) as ExportRecord), id: `${v}/${n}`, dir: join(root, v, n) }); } catch { /* a damaged record is skipped */ }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/** A whole export as one zip (the UI's download), files as recorded and `export.json`. */
export async function zipExport(dir: string): Promise<Buffer> {
  const zip = new JSZip();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else zip.file(relative(dir, p).split("\\").join("/"), readFileSync(p));
    }
  };
  walk(dir);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
