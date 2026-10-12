import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPdf } from "./pdf.js";
import { makePdf } from "./testutil.js";
import { gatherRequest } from "./request.js";

describe("readPdf", () => {
  it("reads the text of every page, line by line", async () => {
    const d = await readPdf(makePdf([["Requirements", "The app shall let a user sign in."], ["A user can reset a password."]]));
    expect(d.pages).toBe(2);
    expect(d.blank).toBe(0);
    expect(d.text).toBe("Requirements\nThe app shall let a user sign in.\n\nA user can reset a password.");
  });

  it("counts pages with no text, and refuses a PDF with none at all", async () => {
    expect((await readPdf(makePdf([["Only this page has words."], []]))).blank).toBe(1);
    await expect(readPdf(makePdf([[], []]))).rejects.toThrow(/no text in it/);
  });

  it("refuses a file that is not a PDF", async () => {
    await expect(readPdf(Buffer.from("plain text"))).rejects.toThrow(/no PDF header/);
    await expect(readPdf(Buffer.from("%PDF-1.4\nnot really"))).rejects.toThrow(/not a readable PDF/);
  });
});

describe("gatherRequest with a PDF", () => {
  it("takes the PDF's text as the request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    writeFileSync(join(dir, "req.pdf"), makePdf([["The app shall let a user sign in."]]));
    const r = await gatherRequest({ file: join(dir, "req.pdf") });
    expect(r.text).toBe("The app shall let a user sign in.");
    expect(r.sources).toEqual([{ kind: "pdf", name: "req.pdf", summary: "1 page" }]);
    expect(r.attachments).toEqual([]);
  });

  it("holds the PDF's text to the request limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    writeFileSync(join(dir, "big.pdf"), makePdf([Array.from({ length: 40 }, () => "word ".repeat(12).trim())]));
    await expect(gatherRequest({ file: join(dir, "big.pdf") }, {}, { maxBytes: 1000 })).rejects.toThrow(/limit is 1 KB/);
  });
});
