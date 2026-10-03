// Design reference intake: parsing --ref, which links may be opened, and (with a browser) pictures,
// sites and documents turned into one form and stored with the run.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { Reference } from "../contracts/reference.js";
import { findChromium } from "../design/screenshots.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { sniffImage } from "../util/image.js";
import { checkRefUrl, defaultRole, gatherReferences, isPrivateAddress, parseRefArg, RefIntakeError, storeReferences, type RefDeps } from "./refs.js";

/** A PNG with the left part one colour and the rest another. */
function png(w: number, h: number, left: [number, number, number], right: [number, number, number], split = 0.75): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set(x < w * split ? left : right, 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
/** A 24-bit BMP of one colour. */
function bmp(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const rowLen = Math.ceil((w * 3) / 4) * 4, size = 54 + rowLen * h;
  const buf = Buffer.alloc(size);
  buf.write("BM"); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(rowLen * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.set([b, g, r], 54 + y * rowLen + x * 3);
  return buf;
}
async function docx(text: string, images: Record<string, Buffer>): Promise<Buffer> {
  const z = new JSZip();
  const ids = Object.keys(images);
  const body = `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` + ids.map((_, i) => `<w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rId${i + 1}"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>`).join("");
  z.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}</w:body></w:document>`);
  z.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ids.map((n, i) => `<Relationship Id="rId${i + 1}" Type="image" Target="media/${n}"/>`).join("")}</Relationships>`);
  for (const [n, b] of Object.entries(images)) z.file(`word/media/${n}`, b);
  return z.generateAsync({ type: "nodebuffer" });
}

/** A small PDF: each page painted one colour on its left three quarters, with a line of text. */
function pdf(pages: { rgb: [number, number, number]; text: string }[]): Buffer {
  const objs: string[] = [];
  const font = 3 + pages.length * 2;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((pg, i) => {
    const stream = `${pg.rgb.map((c) => (c / 255).toFixed(3)).join(" ")} rg 0 0 300 300 re f 0 0 0 rg BT /F1 18 Tf 20 20 Td (${pg.text}) Tj ET`;
    objs[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    objs[4 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) { offsets[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const PUBLIC: RefDeps = { resolve: async () => ["93.184.216.34"] };
const browser = !!findChromium();

describe("--ref", () => {
  it("reads a role in front and a note after the bar", () => {
    expect(parseRefArg("match:https://client.com")).toEqual({ kind: "url", url: "https://client.com", role: "match" });
    expect(parseRefArg("https://client.com/page|the header")).toEqual({ kind: "url", url: "https://client.com/page", note: "the header" });
    const dir = mkdtempSync(join(tmpdir(), "refs-arg-"));
    const f = join(dir, "dash.jpg");
    writeFileSync(f, "x");
    expect(parseRefArg(`Layout:${f}|table like this`)).toMatchObject({ kind: "file", name: "dash.jpg", role: "layout", note: "table like this" });
    expect(() => parseRefArg(join(dir, "missing.png"))).toThrow(/No such file/);
    expect(() => parseRefArg("match:")).toThrow(RefIntakeError);
  });

  it("gives a brand guide the match role and anything else inspire", () => {
    expect(defaultRole("image", "Acme brand guide.png")).toBe("match");
    expect(defaultRole("docx", "acme.docx", "Acme Style Guide\nColours")).toBe("match");
    expect(defaultRole("image", "home.png")).toBe("inspire");
    expect(defaultRole("url", "https://client.com")).toBe("inspire");
    expect(defaultRole("figma", "x")).toBe("match");
  });
});

describe("links the factory may open", () => {
  it("knows private addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.0.9", "172.20.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("opens only https links to public addresses, unless the project allows private ones", async () => {
    await expect(checkRefUrl("http://client.com", false, PUBLIC)).rejects.toThrow(/only https/);
    await expect(checkRefUrl("https://user:pw@client.com", false, PUBLIC)).rejects.toThrow(/user name or password/);
    // a Figma link is read through Figma's API, not opened, so no address check
    expect((await checkRefUrl("https://www.figma.com/design/abc/x", false, { resolve: async () => ["10.0.0.5"] })).hostname).toBe("www.figma.com");
    await expect(checkRefUrl("https://localhost:3000", false, PUBLIC)).rejects.toThrow(/private address/);
    await expect(checkRefUrl("https://10.0.0.5/", false, PUBLIC)).rejects.toThrow(/private address/);
    await expect(checkRefUrl("https://intranet.acme.com", false, { resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/allowPrivateRefs/);
    await expect(checkRefUrl("https://nowhere.invalid", false, { resolve: async () => { throw new Error("ENOTFOUND"); } })).rejects.toThrow(/could not be found/);
    expect((await checkRefUrl("https://client.com/x", false, PUBLIC)).href).toBe("https://client.com/x");
    expect((await checkRefUrl("https://intranet.acme.com", true, { resolve: async () => ["10.0.0.5"] })).hostname).toBe("intranet.acme.com");
  });
});

describe("intake refusals before any browser", () => {
  const file = (name: string, bytes = Buffer.from("x")) => ({ kind: "file" as const, name, bytes });
  it("stops on too many references, a repeat, and formats it does not read, naming the reference", async () => {
    await expect(gatherReferences(Array.from({ length: 13 }, (_, i) => file(`${i}.png`)))).rejects.toThrow(/at most 12/);
    await expect(gatherReferences([file("a.png"), file("a.png")])).rejects.toThrow(/given twice/);
    await expect(gatherReferences([file("brief.pdf")], {}, { chromium: () => undefined })).rejects.toThrow(/R-1 \(brief.pdf\): the file is not a PDF/);
    await expect(gatherReferences([file("export.json")], {}, { chromium: () => undefined })).rejects.toThrow(/R-1 \(export.json\): the file is not valid JSON/);
    await expect(gatherReferences([file("design.fig")], {}, { chromium: () => undefined })).rejects.toThrow(/a .fig file cannot be read; give the file's Figma link/);
    await expect(gatherReferences([{ kind: "url", url: "https://www.figma.com/design/AbCdEfGhIjKlMn/App" }], {}, { chromium: () => undefined, figma: { token: () => undefined } })).rejects.toThrow(/needs FIGMA_TOKEN/);
    await expect(gatherReferences([file("deck.key")], {}, { chromium: () => undefined })).rejects.toThrow(/R-1 \(deck.key\): not a format design references take/);
    expect(await gatherReferences([])).toEqual([]);
  });
  it("says plainly when there is no browser to read a picture with", async () => {
    await expect(gatherReferences([file("home.png", png(4, 4, [255, 0, 0], [0, 0, 255]))], {}, { chromium: () => undefined })).rejects.toThrow(/needs a browser/);
  });
});

describe.skipIf(!browser)("intake in the browser", () => {
  it("turns pictures of any type into PNG with their main colours (approximate)", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#0a7d5a"/><rect width="300" height="40" fill="#ffffff"/></svg>`);
    const refs = await gatherReferences([
      { kind: "file", name: "home.png", bytes: png(3200, 1000, [30, 90, 200], [250, 250, 250]) },
      { kind: "file", name: "logo.svg", bytes: svg, role: "layout", note: "header like this" },
      { kind: "file", name: "old.bmp", bytes: bmp(20, 10, [200, 30, 30]) },
    ]);
    expect(refs.map((r) => [r.id, r.kind, r.role, r.roleGiven])).toEqual([["R-1", "image", "inspire", false], ["R-2", "image", "layout", true], ["R-3", "image", "inspire", false]]);
    const [a, b, c] = refs as [typeof refs[0], typeof refs[0], typeof refs[0]];
    // scaled to the long edge, stored as PNG
    expect([a.images[0]!.width, a.images[0]!.height]).toEqual([1568, 490]);
    expect(sniffImage(a.images[0]!.bytes)).toBe("image/png");
    expect(a.colours[0]).toMatchObject({ hex: "#1e5ac8", exact: false });
    expect(a.colours[0]!.share).toBeGreaterThan(0.7);
    expect(a.measured).toBe("approximate");
    expect(b.colours[0]!.hex).toBe("#0a7d5a");
    expect(b.note).toBe("header like this");
    expect(c.colours[0]!.hex).toBe("#c81e1e");
  });

  it("stops on a picture the browser cannot decode", async () => {
    await expect(gatherReferences([{ kind: "file", name: "broken.png", bytes: Buffer.from("not a png at all") }])).rejects.toThrow(/R-1 \(broken.png\): the picture could not be decoded/);
  });

  it("reads a site at phone and desktop width: screenshots and exact colours, fonts and corners", async () => {
    const html = `<!doctype html><html><head><meta name="theme-color" content="#5b2be0"><style>body{margin:0;background:#fafafa;color:#222;font-family:Georgia,serif}header{background:#5b2be0;height:60px}h1{font-family:Arial,sans-serif}button{background:#ff6a00;color:#fff;border:0;border-radius:12px;width:200px;height:48px;box-shadow:0 2px 6px rgba(0,0,0,.2)}a{color:#0b6bcb}</style></head><body><header></header><h1>Acme</h1><p><a href="#">More</a></p><button>Start</button></body></html>`;
    const refs = await gatherReferences([{ kind: "url", url: "https://acme.example/", role: "match" }], {}, { ...PUBLIC, fulfil: (u) => (u.startsWith("https://acme.example/") ? { status: 200, body: html } : undefined) });
    const r = refs[0]!;
    expect(r).toMatchObject({ id: "R-1", kind: "url", role: "match", measured: "exact", radiusPx: 12, shadows: true });
    expect(r.images.map((i) => [i.label, i.width, i.height])).toEqual([["phone 390 px", 390, 844], ["desktop 1280 px", 1280, 800]]);
    const byRole = Object.fromEntries(r.colours.map((c) => [c.role, c.hex]));
    expect(byRole).toMatchObject({ brand: "#5b2be0", theme: "#5b2be0", header: "#5b2be0", page: "#fafafa", text: "#222222", button: "#ff6a00", link: "#0b6bcb" });
    expect(r.colours.every((c) => c.exact)).toBe(true);
    expect(r.fonts).toEqual([{ family: "Georgia", use: "body" }, { family: "Arial", use: "heading" }]);
  });

  it("stops on a page behind a login, a refused page, and a link that goes nowhere", async () => {
    const login = `<!doctype html><form><input name="u"><input type="password" name="p"></form>`;
    const fulfil = (u: string) => (u.includes("/login") || u.endsWith("/app") ? { status: 200, body: login } : u.endsWith("/secret") ? { status: 403, body: "no" } : u.endsWith("/gone") ? { status: 404, body: "no" } : undefined);
    await expect(gatherReferences([{ kind: "url", url: "https://acme.example/app" }], {}, { ...PUBLIC, fulfil })).rejects.toThrow(/R-1 \(https:\/\/acme.example\/app\): .*login page/);
    await expect(gatherReferences([{ kind: "url", url: "https://acme.example/secret" }], {}, { ...PUBLIC, fulfil })).rejects.toThrow(/asks for a login \(403\)/);
    await expect(gatherReferences([{ kind: "url", url: "https://acme.example/gone" }], {}, { ...PUBLIC, fulfil })).rejects.toThrow(/answered 404/);
  });

  it("reads a Word document's pictures and text, and a brand guide is matched by default", async () => {
    const d = await docx("Acme brand guidelines. Primary colour is green.", { "cover.png": png(200, 100, [10, 140, 70], [255, 255, 255]), "logo.emf": Buffer.from("emf") });
    const r = (await gatherReferences([{ kind: "file", name: "acme.docx", bytes: d }]))[0]!;
    expect(r).toMatchObject({ kind: "docx", role: "match", roleGiven: false, measured: "approximate" });
    expect(r.text).toContain("Acme brand guidelines");
    expect(r.images.map((i) => i.label)).toEqual(["cover.png"]);
    expect(r.colours[0]!.hex).toBe("#0a8c46");
    expect(r.notes.join(" ")).toMatch(/1 image\(s\) in a format a browser cannot show/);
  });

  it("reads a PDF: its first pages as pictures, its text, and a brand guide is matched", async () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({ rgb: [10, 140, 70] as [number, number, number], text: i === 0 ? "Acme brand guidelines" : `Page ${i + 1}` }));
    const r = (await gatherReferences([{ kind: "file", name: "acme.pdf", bytes: pdf(pages) }]))[0]!;
    expect(r).toMatchObject({ kind: "pdf", role: "match", roleGiven: false, measured: "approximate" });
    expect(r.images.map((i) => i.label)).toEqual(["page 1", "page 2", "page 3", "page 4", "page 5", "page 6"]);
    expect(Math.max(r.images[0]!.width, r.images[0]!.height)).toBeLessThanOrEqual(1568);
    expect(sniffImage(r.images[0]!.bytes)).toBe("image/png");
    expect(r.colours[0]!.hex).toBe("#0a8c46");
    expect(r.text).toContain("Acme brand guidelines");
    expect(r.text).toContain("Page 8");
    expect(r.notes).toContain("the first 6 of 8 pages kept as pictures");
    const plain = (await gatherReferences([{ kind: "file", name: "menu.pdf", bytes: pdf([{ rgb: [200, 30, 30], text: "Lunch menu" }]) }]))[0]!;
    expect(plain.role).toBe("inspire");
  });

  it("stops on a damaged PDF", async () => {
    await expect(gatherReferences([{ kind: "file", name: "bad.pdf", bytes: Buffer.from("%PDF-1.4\nnot really a pdf") }])).rejects.toThrow(/R-1 \(bad.pdf\): .*(not a readable PDF|could not be read|no page could be drawn)/);
  });

  it("reads a Figma link: its frames as pictures and its exact look", async () => {
    const frame = { id: "1:2", name: "Home", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], children: [
      { id: "1:3", name: "Button", type: "FRAME", cornerRadius: 8, absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 44 }, fills: [{ type: "SOLID", color: { r: 0.4, g: 0.2, b: 0.9 } }], children: [{ id: "1:4", type: "TEXT", characters: "Sign up", style: { fontFamily: "Inter", fontSize: 16 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] }] },
    ] };
    const fetchFake = (async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/files/AbCdEfGhIjKlMn?depth=2")) return Response.json({ name: "App", document: { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [frame] }] } });
      if (u.includes("/v1/files/AbCdEfGhIjKlMn/nodes")) return Response.json({ nodes: { "1:2": { document: frame, styles: {} } } });
      if (u.includes("/v1/images/")) return Response.json({ err: null, images: { "1:2": "https://figma-alpha-api.s3.example/1.png" } });
      if (u.startsWith("https://figma-alpha-api")) return new Response(png(144, 90, [255, 255, 255], [102, 51, 230]));
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const r = (await gatherReferences([{ kind: "url", url: "https://www.figma.com/design/AbCdEfGhIjKlMn/App" }], {}, { figma: { fetch: fetchFake, token: () => "t" } }))[0]!;
    expect(r).toMatchObject({ kind: "figma", role: "match", measured: "exact", radiusPx: 8 });
    expect(r.images.map((i) => i.label)).toEqual(["Home"]);
    expect(r.colours.find((c) => c.role === "brand")?.hex).toBe("#6633e6");
    expect(r.colours.find((c) => c.role === "page")?.hex).toBe("#ffffff");
    expect(r.fonts).toEqual([{ family: "Inter", use: "body" }]);
  });

  it("stores the pictures with the run: ledger artifacts for the model and PNG files for the UI", async () => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "refs-store-"));
    const gathered = await gatherReferences([{ kind: "file", name: "home.png", bytes: png(40, 20, [30, 90, 200], [250, 250, 250]) }]);
    const ledger = Ledger.create("refs-store");
    const refs = storeReferences(ledger, gathered);
    await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "r", references: refs } }, HUMAN_WRITER);
    const info = replay(ledger.events()).info;
    expect(Reference.array().parse(info.references)).toHaveLength(1);
    const im = info.references![0]!.images[0]!;
    expect(im.file).toBe("refs/R-1-1.png");
    expect(existsSync(join(ledger.dir, im.file))).toBe(true);
    expect(Buffer.from(ledger.getArtifact(im.sha))).toEqual(readFileSync(join(ledger.dir, im.file)));
  });
});
