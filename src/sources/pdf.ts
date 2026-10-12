// Document intake (docs/estimates-design.md, "Inputs"): a requirements PDF becomes plain text, page by page,
// read offline with pdf.js in this process (no browser: only the text is wanted, no page is drawn). The text
// is untrusted like any request text; nothing in the document is fetched or executed. A PDF given as a design
// reference is a different reader (refs.ts), which draws its first pages as pictures.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PdfRead { text: string; pages: number; blank: number }

export const MAX_PDF_BYTES = 25_000_000;
/** pages read from a requirements PDF; a longer one is refused, not cut, so nothing asked for is silently dropped */
export const MAX_REQUEST_PDF_PAGES = 300;

interface TextItem { str?: string; hasEOL?: boolean; transform?: number[]; height?: number }
interface PdfDoc { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }>; cleanup(): void }>; destroy(): Promise<void> }
interface PdfJs { getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc> } }

let loaded: Promise<{ pdfjs: PdfJs; root: string }> | undefined;
/** The Node build of pdf.js, loaded on first use: it is large, and most runs never read a PDF. */
function pdfjs(): Promise<{ pdfjs: PdfJs; root: string }> {
  loaded ??= (async () => {
    const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    return { pdfjs: (await import(pathToFileURL(join(root, "legacy", "build", "pdf.mjs")).href)) as PdfJs, root };
  })();
  return loaded;
}

/** One page's text items as lines: a new line where the item ends one or sits at another height, a blank line at a wide gap. */
function pageText(items: TextItem[]): string {
  let out = "", lastY: number | undefined, eol = false;
  for (const it of items) {
    const s = it.str ?? "";
    const y = it.transform?.[5];
    // pdf.js gives the gaps between words as items of their own; items that touch (a ligature, a font change) are one word
    if (s && !s.trim() && out && !/\s$/.test(out)) out += " ";
    if (s.trim()) {
      if (out) {
        const gap = lastY !== undefined && y !== undefined ? Math.abs(lastY - y) : 0;
        if (gap > Math.max(2, (it.height || 12) * 1.8)) out = `${out.trimEnd()}\n\n`;
        else if (eol || gap > 2) out = `${out.trimEnd()}\n`;
      }
      out += s;
      if (y !== undefined) lastY = y;
      eol = false;
    }
    if (it.hasEOL) eol = true;
  }
  return out.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

export async function readPdf(data: Buffer): Promise<PdfRead> {
  if (data.subarray(0, 1024).indexOf("%PDF-") < 0) throw new Error("That file is not a PDF (it has no PDF header).");
  const { pdfjs: lib, root } = await pdfjs();
  let doc: PdfDoc;
  try {
    // a copy: pdf.js takes over the bytes it is given
    doc = await lib.getDocument({
      data: new Uint8Array(data), isEvalSupported: false, enableXfa: false, useSystemFonts: false, disableFontFace: true, verbosity: 0,
      cMapUrl: `${join(root, "cmaps")}/`, cMapPacked: true, standardFontDataUrl: `${join(root, "standard_fonts")}/`,
    }).promise;
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    if (name === "PasswordException") throw new Error("That PDF is protected by a password; save a copy without one.");
    if (name === "InvalidPDFException") throw new Error("That file is not a readable PDF; it may be damaged. Export it again.");
    throw new Error(`That PDF could not be read (${String((e as Error)?.message ?? e).slice(0, 160)}).`);
  }
  try {
    const pages = doc.numPages;
    if (pages > MAX_REQUEST_PDF_PAGES) throw new Error(`That PDF has ${pages} pages; the limit is ${MAX_REQUEST_PDF_PAGES}. Split it, or send the part that holds the requirements.`);
    const parts: string[] = [];
    let blank = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      let t = "";
      try { t = pageText((await page.getTextContent()).items); } catch { /* a page with no readable text */ }
      page.cleanup();
      if (t) parts.push(t); else blank++;
    }
    // a scan is pictures of pages: there is nothing to read, and guessing at it would invent requirements
    if (!parts.length) throw new Error("That PDF has no text in it (it looks like a scan). Run it through OCR, or paste the requirements as text.");
    return { text: parts.join("\n\n"), pages, blank };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
