// Document intake (docs/estimates-design.md, "Inputs"): a .docx becomes Markdown text (headings, lists,
// tables) plus its embedded images, read offline. The text is untrusted like any request text. Images are
// kept as files next to the run and marked in the text where they appeared; nothing in the document is
// fetched or executed.
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface DocxImage { name: string; bytes: Buffer }
export interface DocxRead { text: string; images: DocxImage[]; tables: number; headings: number }

type Node = Record<string, unknown>;
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: false });

const tagOf = (n: Node): string => Object.keys(n).find((k) => k !== ":@") ?? "";
const kids = (n: Node): Node[] => (n[tagOf(n)] as Node[] | undefined) ?? [];
const attr = (n: Node, name: string): string | undefined => (n[":@"] as Record<string, string> | undefined)?.[`@_${name}`];
const find = (ns: Node[], tag: string): Node | undefined => ns.find((n) => tagOf(n) === tag);

const IMAGE_TYPES = /\.(png|jpe?g|gif|bmp|svg|webp|emf|wmf|tiff?)$/i;

export async function readDocx(data: Buffer): Promise<DocxRead> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error("That file is not a valid .docx (it is not a zip archive)."); }
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("That file is not a Word document: word/document.xml is missing.");

  // relationship id -> media path
  const rels = new Map<string, string>();
  const relFile = zip.file("word/_rels/document.xml.rels");
  if (relFile) {
    for (const r of parser.parse(await relFile.async("string")) as Node[]) {
      for (const rel of kids(r)) {
        const id = attr(rel, "Id"), target = attr(rel, "Target");
        if (id && target && IMAGE_TYPES.test(target)) rels.set(id, target.replace(/^\/?(word\/)?/, "word/"));
      }
    }
  }

  const images = new Map<string, DocxImage>();
  const imageFor = async (rid: string): Promise<string | undefined> => {
    const path = rels.get(rid);
    const f = path ? zip.file(path) : undefined;
    if (!path || !f) return undefined;
    const name = path.split("/").pop()!;
    if (!images.has(name)) images.set(name, { name, bytes: await f.async("nodebuffer") });
    return name;
  };

  const inline = async (ns: Node[]): Promise<string> => {
    let out = "";
    for (const n of ns) {
      switch (tagOf(n)) {
        case "w:t": out += kids(n).map((t) => String(t["#text"] ?? "")).join(""); break;
        case "w:tab": out += "\t"; break;
        case "w:br": case "w:cr": out += "\n"; break;
        case "a:blip": {
          const rid = attr(n, "r:embed");
          const name = rid ? await imageFor(rid) : undefined;
          if (name) out += ` [image: ${name}] `;
          break;
        }
        case "w:pPr": case "w:rPr": break;
        default: out += await inline(kids(n));
      }
    }
    return out;
  };

  let tables = 0, headings = 0;
  const paragraph = async (p: Node): Promise<string> => {
    const props = find(kids(p), "w:pPr");
    const style = props ? attr(find(kids(props), "w:pStyle") ?? {}, "w:val") ?? "" : "";
    const text = (await inline(kids(p))).replace(/[ \t]+/g, " ").trim();
    if (!text) return "";
    const h = /^heading\s*([1-6])$/i.exec(style.replace(/([a-z])(\d)/i, "$1 $2"));
    if (h) { headings++; return `${"#".repeat(Number(h[1]))} ${text}`; }
    if (/^title$/i.test(style)) { headings++; return `# ${text}`; }
    if (props && find(kids(props), "w:numPr")) {
      const lvl = Number(attr(find(kids(find(kids(props), "w:numPr")!), "w:ilvl") ?? {}, "w:val") ?? 0);
      return `${"  ".repeat(lvl)}- ${text}`;
    }
    return text;
  };

  const table = async (t: Node): Promise<string> => {
    tables++;
    const rows: string[][] = [];
    for (const tr of kids(t).filter((n) => tagOf(n) === "w:tr")) {
      const cells: string[] = [];
      for (const tc of kids(tr).filter((n) => tagOf(n) === "w:tc")) {
        const parts: string[] = [];
        for (const p of kids(tc).filter((n) => tagOf(n) === "w:p")) parts.push((await inline(kids(p))).replace(/\s+/g, " ").trim());
        cells.push(parts.filter(Boolean).join(" / ").replace(/\|/g, "\\|"));
      }
      rows.push(cells);
    }
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
    return [line(rows[0]!), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
  };

  const doc = parser.parse(await docFile.async("string")) as Node[];
  const body = find(kids(find(doc, "w:document") ?? {}), "w:body");
  const blocks: string[] = [];
  for (const n of kids(body ?? {})) {
    const tag = tagOf(n);
    const b = tag === "w:p" ? await paragraph(n) : tag === "w:tbl" ? await table(n) : "";
    if (b) blocks.push(b);
  }
  const text = blocks.join("\n\n").trim();
  if (text.length < 10) throw new Error("The Word document is empty or has too little text to be a request.");
  return { text, images: [...images.values()], tables, headings };
}
