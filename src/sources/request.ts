// Where a request comes from: a typed prompt, a Markdown/text file, or a Jira ticket (any one, or several).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fetchJiraTicket } from "./jira.js";
import { readDocx } from "./docx.js";
import { MAX_REQUEST_FILE_BYTES, readRequestFile } from "../stages/executor.js";

export interface RequestSource { kind: "prompt" | "file" | "jira" | "docx" | "frames"; name?: string; key?: string; url?: string; summary?: string }

/** A file that travels with the request (document images, design frames); stored beside the run, never fetched. */
export interface Attachment { name: string; bytes: Buffer }

export interface GatheredRequest { text: string; sources: RequestSource[]; attachments: Attachment[] }

const FRAME_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".json"]);
export const MAX_DOCX_BYTES = 50_000_000;
export const MAX_FRAMES = 200;
export const MAX_FRAME_UPLOAD_BYTES = 5_000_000;
export const MAX_FRAMES_TOTAL_BYTES = 20_000_000;
/** Request text limit for the estimate command: requirements documents are far longer than change requests. */
export const MAX_ESTIMATE_REQUEST_BYTES = 400_000;

/** The request text and attachments for a set of frame files (from a folder or an upload). Only names go into the text. */
export function framesRequest(files: { name: string; bytes: Buffer }[]): { text: string; attachments: Attachment[] } {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const attachments = sorted.map((f) => ({ name: `frames/${f.name}`, bytes: f.bytes }));
  const text = `These design frames were exported from Figma and sit with the request (${sorted.length}). Each is one screen or state; count them, do not guess what is not listed.\n${sorted.map((f, i) => `- F-${i + 1} ${f.name}`).join("\n")}`;
  return { text, attachments };
}

/** Pre-exported Figma frames placed in a folder (images, or the export's JSON). Only file names and sizes go into the text. */
export function readFrames(dir: string): { text: string; attachments: Attachment[] } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`No such folder: ${dir}`);
  const files = readdirSync(dir).filter((f) => FRAME_TYPES.has(extname(f).toLowerCase())).sort();
  if (!files.length) throw new Error(`${dir} has no exported frames (png, jpg, webp, svg or json).`);
  if (files.length > MAX_FRAMES) throw new Error(`${dir} has ${files.length} frames; the limit is ${MAX_FRAMES}.`);
  return framesRequest(files.map((f) => ({ name: f, bytes: readFileSync(join(dir, f)) })));
}

/** Frames sent from the web form: each must be a plain file name with a frame extension, and the set is size-limited. */
export function checkUploadedFrames(input: unknown): { name: string; bytes: Buffer }[] {
  if (!Array.isArray(input) || !input.length) throw new Error("No frames were sent.");
  if (input.length > MAX_FRAMES) throw new Error(`${input.length} frames; the limit is ${MAX_FRAMES}.`);
  const seen = new Set<string>();
  let total = 0;
  return input.map((f) => {
    const o = (f ?? {}) as { name?: unknown; data?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!name || name !== basename(name) || name.startsWith(".") || /[\\/\0\r\n]/.test(name) || name.length > 120) throw new Error(`"${name.slice(0, 40)}" is not a usable frame file name.`);
    if (!FRAME_TYPES.has(extname(name).toLowerCase())) throw new Error(`${name}: frames are png, jpg, webp, svg or json files.`);
    if (seen.has(name)) throw new Error(`${name} was sent twice.`);
    seen.add(name);
    if (typeof o.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.data)) throw new Error(`${name}: the file did not arrive intact.`);
    const bytes = Buffer.from(o.data, "base64");
    if (!bytes.length) throw new Error(`${name} is empty.`);
    if (bytes.length > MAX_FRAME_UPLOAD_BYTES) throw new Error(`${name} is over ${MAX_FRAME_UPLOAD_BYTES / 1e6} MB.`);
    total += bytes.length;
    if (total > MAX_FRAMES_TOTAL_BYTES) throw new Error(`The frames add up to over ${MAX_FRAMES_TOTAL_BYTES / 1e6} MB; send fewer or smaller ones.`);
    return { name, bytes };
  });
}

export async function gatherRequest(
  o: { prompt?: string; file?: string; jira?: string; frames?: string; frameFiles?: { name: string; bytes: Buffer }[] },
  deps: { fetchJira?: typeof fetchJiraTicket } = {},
  opts: { maxBytes?: number } = {},
): Promise<GatheredRequest> {
  const attachments: Attachment[] = [];
  const parts: { heading: string; text: string; source: RequestSource }[] = [];
  if (o.prompt?.trim()) parts.push({ heading: "Typed request", text: o.prompt.trim(), source: { kind: "prompt" } });
  if (o.file && extname(o.file).toLowerCase() === ".docx") {
    if (!existsSync(o.file)) throw new Error(`No such file: ${o.file}`);
    if (statSync(o.file).size > MAX_DOCX_BYTES) throw new Error(`${basename(o.file)} is over ${MAX_DOCX_BYTES / 1e6} MB.`);
    const d = await readDocx(readFileSync(o.file));
    attachments.push(...d.images.map((i) => ({ name: `docx/${i.name}`, bytes: i.bytes })));
    parts.push({ heading: `From ${basename(o.file)}`, text: d.text, source: { kind: "docx", name: basename(o.file), summary: `${d.headings} headings, ${d.tables} tables, ${d.images.length} images` } });
  } else if (o.file) {
    const f = readRequestFile(o.file);
    parts.push({ heading: `From ${f.name}`, text: f.text, source: { kind: "file", name: f.name } });
  }
  if (o.frames) {
    const f = readFrames(o.frames);
    attachments.push(...f.attachments);
    parts.push({ heading: "Design frames", text: f.text, source: { kind: "frames", name: basename(o.frames), summary: `${f.attachments.length} frames` } });
  }
  if (o.frameFiles?.length) {
    const f = framesRequest(o.frameFiles);
    attachments.push(...f.attachments);
    parts.push({ heading: "Design frames", text: f.text, source: { kind: "frames", name: "web upload", summary: `${f.attachments.length} frames` } });
  }
  if (o.jira) {
    const t = await (deps.fetchJira ?? fetchJiraTicket)(o.jira);
    parts.push({ heading: `Jira ${t.key}`, text: t.text, source: { kind: "jira", key: t.key, url: t.url, summary: t.summary } });
  }
  if (!parts.length) throw new Error('Give a request: a prompt, --file request.md, or --jira ABC-123 (or several).');
  // one source: its text as is; several: labelled sections
  const text = parts.length === 1 ? parts[0]!.text : parts.map((p) => `## ${p.heading}\n\n${p.text}`).join("\n\n");
  const max = opts.maxBytes ?? MAX_REQUEST_FILE_BYTES;
  if (Buffer.byteLength(text) > max) {
    throw new Error(`The request is ${Math.round(Buffer.byteLength(text) / 1000)} KB; the limit is ${Math.round(max / 1000)} KB; shorten or split it.`);
  }
  return { text, sources: parts.map((p) => p.source), attachments };
}

/** "request.md + Jira ABC-12" for cards and the PR. */
export function describeSources(sources: RequestSource[] | undefined): string {
  if (!sources?.length) return "";
  return sources.map((s) => (s.kind === "prompt" ? "typed prompt" : s.kind === "jira" ? `Jira ${s.key}` : s.kind === "frames" ? `${s.summary ?? "frames"} in ${s.name}` : s.name!)).join(" + ");
}
