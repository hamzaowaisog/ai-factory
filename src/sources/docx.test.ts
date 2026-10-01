import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocx } from "./docx.js";
import { gatherRequest } from "./request.js";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const p = (t: string, style?: string, extra = "") => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r>${extra}</w:p>`;
const bullet = (t: string, lvl = 0) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const pic = (rid: string) => `<w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="${rid}"/></a:graphicData></a:graphic></w:drawing></w:r>`;

async function makeDocx(body: string): Promise<Buffer> {
  const z = new JSZip();
  z.file("word/document.xml", `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  z.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="image" Target="media/image1.png"/><Relationship Id="rId6" Type="hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`);
  z.file("word/media/image1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return z.generateAsync({ type: "nodebuffer" });
}

describe("readDocx", () => {
  it("reads headings, lists, tables and images into Markdown", async () => {
    const buf = await makeDocx(
      p("Clinic app", "Title") + p("Sessions", "Heading1") + p("The therapist records a session.") +
      bullet("Start and stop") + bullet("Add a note", 1) + p("Screen", undefined, pic("rId5")) +
      `<w:tbl><w:tr>${cell("Field")}${cell("Type")}</w:tr><w:tr>${cell("name")}${cell("text | required")}</w:tr></w:tbl>`,
    );
    const d = await readDocx(buf);
    expect(d.text).toContain("# Clinic app");
    expect(d.text).toContain("# Sessions");
    expect(d.text).toContain("- Start and stop");
    expect(d.text).toContain("  - Add a note");
    expect(d.text).toContain("[image: image1.png]");
    expect(d.text).toContain("| Field | Type |");
    expect(d.text).toContain("| name | text \\| required |");
    expect(d).toMatchObject({ tables: 1, headings: 2 });
    expect(d.images.map((i) => i.name)).toEqual(["image1.png"]);
    expect(d.images[0]!.bytes.length).toBe(4);
  });

  it("refuses a file that is not a docx", async () => {
    await expect(readDocx(Buffer.from("plain text"))).rejects.toThrow(/not a valid .docx/);
    const z = new JSZip(); z.file("hello.txt", "x");
    await expect(readDocx(await z.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(/word\/document\.xml/);
  });

  it("refuses an empty document", async () => {
    await expect(readDocx(await makeDocx(""))).rejects.toThrow(/empty/);
  });
});

describe("gatherRequest with a document and frames", () => {
  it("adds the docx text, its images and the design frames as attachments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docx-"));
    writeFileSync(join(dir, "req.docx"), await makeDocx(p("Requirements", "Heading1") + p("The app shall let a user sign in.") + p("", undefined, pic("rId5"))));
    mkdirSync(join(dir, "frames"));
    writeFileSync(join(dir, "frames", "login.png"), "png");
    writeFileSync(join(dir, "frames", "home.png"), "png");
    writeFileSync(join(dir, "frames", "notes.txt"), "ignored");
    const r = await gatherRequest({ file: join(dir, "req.docx"), frames: join(dir, "frames") });
    expect(r.text).toContain("## From req.docx");
    expect(r.text).toContain("The app shall let a user sign in.");
    expect(r.text).toContain("F-1 home.png");
    expect(r.text).not.toContain("notes.txt");
    expect(r.attachments.map((a) => a.name).sort()).toEqual(["docx/image1.png", "frames/home.png", "frames/login.png"]);
    expect(r.sources.map((s) => s.kind)).toEqual(["docx", "frames"]);
  });

  it("takes a larger request when the caller allows it, and refuses otherwise", async () => {
    const big = "word ".repeat(30_000);
    await expect(gatherRequest({ prompt: big })).rejects.toThrow(/limit is 100 KB/);
    expect((await gatherRequest({ prompt: big }, {}, { maxBytes: 400_000 })).text.length).toBe(big.trim().length);
  });
});
