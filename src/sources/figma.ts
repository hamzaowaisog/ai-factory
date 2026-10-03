// Figma as a design reference (docs/estimates-design.md, "Design references", step 4): a Figma link read
// through the REST API with the user's own token (FIGMA_TOKEN in ~/.factory/.env, like Jira's), or a Figma
// JSON export from disk. Code reads the look from the file's nodes (colours by role, fonts, corners,
// shadows; exact values), and up to 8 frames are exported as pictures. The model never reads the JSON.
import { secret } from "../config/env.js";
import type { RefColour, Reference } from "../contracts/reference.js";
import { isPrivateAddress, readResponseCapped } from "../util/safe-fetch.js";

export const FIGMA_API = "https://api.figma.com";
/** frames exported from one file */
export const MAX_FIGMA_FRAMES = 8;
/** a frame smaller than this on both sides is an icon or a sticker, not a screen */
const MIN_FRAME_PX = 200;
const MAX_NODES = 40_000;
const MAX_RESPONSE_BYTES = 60_000_000;
/** one exported frame picture (PR #11 review, item 17: downloads are read up to a cap, never whole) */
export const MAX_FRAME_PNG_BYTES = 25_000_000;
/** the longest a rate limit is waited out, per wait */
const MAX_WAIT_S = 60;

export class FigmaError extends Error {}

export interface FigmaLink { fileKey: string; nodeId?: string }

/** figma.com/{file|design|proto|board}/<key>[/branch/<branch>]/...?node-id=12-34 */
export function parseFigmaUrl(raw: string): FigmaLink {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FigmaError(`"${raw.slice(0, 80)}" is not a link.`); }
  if (!/(^|\.)figma\.com$/i.test(u.hostname)) throw new FigmaError(`${raw} is not a Figma link.`);
  const m = u.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,})(?:\/branch\/([A-Za-z0-9]{10,}))?/);
  if (!m) throw new FigmaError(`${raw} does not name a Figma file; copy the link from the file's Share button.`);
  const node = u.searchParams.get("node-id");
  const nodeId = node ? decodeURIComponent(node).replace(/-/g, ":") : undefined;
  if (nodeId !== undefined && !/^[\w:;]+$/.test(nodeId)) throw new FigmaError(`${raw}: the node-id in the link is not one Figma makes.`);
  return { fileKey: m[2] ?? m[1]!, ...(nodeId && nodeId !== "0:1" ? { nodeId } : {}) };
}

// ---------- the file's nodes (only the fields read here) ----------

interface Rgba { r: number; g: number; b: number; a?: number }
interface Paint { type: string; visible?: boolean; opacity?: number; color?: Rgba }
export interface FigmaNode {
  id: string; name?: string; type: string; visible?: boolean;
  children?: FigmaNode[];
  fills?: Paint[] | unknown;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  cornerRadius?: number;
  effects?: { type: string; visible?: boolean }[];
  styles?: Record<string, string>;
  characters?: string;
  style?: { fontFamily?: string; fontSize?: number };
}
export type FigmaStyles = Record<string, { name?: string; styleType?: string }>;

const FRAME_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);
const big = (n: FigmaNode) => (n.absoluteBoundingBox?.width ?? 0) >= MIN_FRAME_PX && (n.absoluteBoundingBox?.height ?? 0) >= MIN_FRAME_PX;
const shown = (n: FigmaNode) => n.visible !== false;

/** The frames that stand for a page, a section or the node a link points at; screens first, in document order. */
export function pickFrames(root: FigmaNode, max = MAX_FIGMA_FRAMES): FigmaNode[] {
  const out: FigmaNode[] = [];
  const take = (n: FigmaNode, depth: number) => {
    if (out.length >= max || !shown(n)) return;
    if (FRAME_TYPES.has(n.type) && big(n)) { out.push(n); return; }
    // a page, a section or a group holds the screens; look one or two levels in
    if ((n.type === "CANVAS" || n.type === "SECTION" || n.type === "GROUP" || n.type === "DOCUMENT") && depth < 3) for (const c of n.children ?? []) take(c, depth + 1);
  };
  // a link to one frame means that frame, whatever its size
  if (FRAME_TYPES.has(root.type)) return [root];
  take(root, 0);
  return out;
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
const hexOf = (c: Rgba) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const neutral = (h: string) => { const [r, g, b] = rgb(h); return Math.max(r, g, b) - Math.min(r, g, b) < 24; };
const light = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200; };

/** The one solid colour a node is painted with, if any (a gradient or image fill is not a colour). */
function solidFill(n: FigmaNode): string | undefined {
  if (!Array.isArray(n.fills)) return undefined;
  for (const p of [...(n.fills as Paint[])].reverse()) {
    if (p.visible === false || p.type !== "SOLID" || !p.color) continue;
    if ((p.color.a ?? 1) * (p.opacity ?? 1) < 0.5) continue;
    return hexOf(p.color);
  }
  return undefined;
}

/** A style's name to the role it plays, when the name says so (Primary/500, Background, Text/Body ...). */
function roleOfName(name: string): RefColour["role"] | undefined {
  const n = name.toLowerCase();
  if (/primary|brand/.test(n)) return "brand";
  if (/background|surface|\bbg\b|canvas/.test(n)) return "page";
  if (/text|foreground|on[-\s]?surface|\bink\b/.test(n)) return "text";
  if (/button|\bcta\b/.test(n)) return "button";
  if (/link/.test(n)) return "link";
  if (/accent|secondary|highlight/.test(n)) return "accent";
  return undefined;
}

export interface FigmaLook {
  colours: RefColour[];
  fonts: Reference["fonts"];
  radiusPx?: number;
  shadows: boolean;
  notes: string[];
}

/** The look of the given frames, read from their nodes: exact values, roles from style names or from use. */
export function figmaLook(roots: FigmaNode[], styles: FigmaStyles = {}): FigmaLook {
  const area = new Map<string, number>(), uses = new Map<string, number>(), textCol = new Map<string, number>(), buttonCol = new Map<string, number>(), pageCol = new Map<string, number>();
  const named = new Map<NonNullable<RefColour["role"]>, string>();
  const fontChars = new Map<string, number>(), headFonts = new Map<string, number>();
  const radii = new Map<number, number>(), buttonRadii = new Map<number, number>();
  let shadows = false, nodes = 0, truncated = false, total = 0;
  const bump = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  const buttonLike = (n: FigmaNode) => {
    const b = n.absoluteBoundingBox;
    if (/button|btn|cta/i.test(n.name ?? "")) return true;
    return !!b && FRAME_TYPES.has(n.type) && b.height >= 28 && b.height <= 72 && b.width >= 56 && b.width <= 480 && (n.children ?? []).some((c) => c.type === "TEXT");
  };
  const walk = (n: FigmaNode, rootArea: number) => {
    if (!shown(n)) return;
    if (++nodes > MAX_NODES) { truncated = true; return; }
    const b = n.absoluteBoundingBox;
    const a = b ? b.width * b.height : 0;
    const fill = solidFill(n);
    if ((n.effects ?? []).some((e) => e.type === "DROP_SHADOW" && e.visible !== false)) shadows = true;
    const styleName = n.styles?.fill ? styles[n.styles.fill]?.name : undefined;
    if (fill && styleName) { const r = roleOfName(styleName); if (r && !named.has(r)) named.set(r, fill); }
    if (n.type === "TEXT") {
      const chars = (n.characters ?? "").length;
      if (fill) bump(textCol, fill, chars);
      const fam = n.style?.fontFamily, size = n.style?.fontSize ?? 0;
      if (fam) { if (size >= 24) bump(headFonts, fam, chars); else bump(fontChars, fam, chars); }
    } else if (fill) {
      bump(area, fill, a);
      total += a;
      // the big backgrounds say little about the brand; the small painted parts (buttons, chips, bars) do
      if (a < rootArea * 0.4) bump(uses, fill);
      if (buttonLike(n)) bump(buttonCol, fill);
    }
    if (typeof n.cornerRadius === "number" && n.cornerRadius > 0 && fill) { bump(radii, Math.round(n.cornerRadius)); if (buttonLike(n)) bump(buttonRadii, Math.round(n.cornerRadius)); }
    for (const c of n.children ?? []) walk(c, rootArea);
  };
  for (const r of roots) {
    const b = r.absoluteBoundingBox;
    const ra = b ? b.width * b.height : 1;
    const f = solidFill(r);
    if (f) bump(pageCol, f, ra);
    walk(r, ra);
  }
  const top = <K>(m: Map<K, number>, ok: (k: K) => boolean = () => true) => [...m.entries()].filter(([k]) => ok(k)).sort((x, y) => y[1] - x[1])[0]?.[0];
  const colours: RefColour[] = [];
  const add = (role: NonNullable<RefColour["role"]>, h: string | undefined) => { if (h && !colours.some((c) => c.role === role)) colours.push({ hex: h, role, exact: true }); };
  for (const [role, h] of named) add(role, h);
  add("button", top(buttonCol, (h) => !neutral(h)));
  add("brand", top(buttonCol, (h) => !neutral(h)) ?? top(uses, (h) => !neutral(h)) ?? top(area, (h) => !neutral(h)));
  add("page", top(pageCol) ?? top(area, light));
  add("text", top(textCol));
  const brand = colours.find((c) => c.role === "brand")?.hex;
  add("accent", top(uses, (h) => !neutral(h) && h !== brand && (!brand || dist(h, brand) > 60)));
  // the rest of the palette, by how much of the frames it paints
  for (const [h, a] of [...area.entries()].sort((x, y) => y[1] - x[1])) {
    if (colours.length >= 10) break;
    if (colours.some((c) => c.hex === h)) continue;
    const share = total ? Math.round((a / total) * 1000) / 1000 : 0;
    if (share >= 0.02) colours.push({ hex: h, share, exact: true });
  }
  const fonts: Reference["fonts"] = [];
  const body = top(fontChars) ?? top(headFonts);
  if (body) fonts.push({ family: body, use: "body" });
  const head = top(headFonts);
  if (head && head !== body) fonts.push({ family: head, use: "heading" });
  const radius = top(buttonRadii) ?? top(radii);
  const notes: string[] = [];
  if (truncated) notes.push(`the frames have over ${MAX_NODES} layers; the look was read from the first ${MAX_NODES}`);
  if (named.size) notes.push(`colour roles from the file's styles: ${[...named.keys()].join(", ")}`);
  return { colours, fonts, ...(radius !== undefined ? { radiusPx: radius } : {}), shadows, notes };
}

function dist(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

// ---------- a Figma JSON export from disk ----------

/** The frames and styles in a Figma JSON export: a file (`document`), a nodes answer (`nodes`) or one node. */
export function readFigmaJson(text: string): { roots: FigmaNode[]; styles: FigmaStyles; name?: string } {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { throw new FigmaError("the file is not valid JSON."); }
  if (!j || typeof j !== "object") throw new FigmaError("the file is not a Figma export.");
  const styles: FigmaStyles = { ...((j.styles as FigmaStyles | undefined) ?? {}) };
  let roots: FigmaNode[] = [];
  if (j.document && typeof j.document === "object") roots = pickFrames(j.document as FigmaNode);
  else if (j.nodes && typeof j.nodes === "object") {
    for (const v of Object.values(j.nodes as Record<string, { document?: FigmaNode; styles?: FigmaStyles } | null>)) {
      if (!v?.document) continue;
      Object.assign(styles, v.styles ?? {});
      roots.push(...pickFrames(v.document));
    }
  } else if (typeof j.type === "string" && Array.isArray(j.children)) roots = pickFrames(j as unknown as FigmaNode);
  else throw new FigmaError("the file is not a Figma export (no document, nodes or frame in it). Export the frames as PNG, or give the file's Figma link.");
  if (!roots.length) throw new FigmaError("the Figma export has no frame of screen size in it.");
  return { roots: roots.slice(0, MAX_FIGMA_FRAMES), styles, ...(typeof j.name === "string" ? { name: j.name } : {}) };
}

// ---------- the REST API ----------

export interface FigmaDeps {
  /** HTTP (tests replace it) */
  fetch?: typeof fetch;
  /** waits out a rate limit (tests replace it) */
  sleep?: (ms: number) => Promise<void>;
  /** the token; default FIGMA_TOKEN from ~/.factory/.env or the environment */
  token?: () => string | undefined;
}

export const figmaConfigured = (deps: FigmaDeps = {}): boolean => !!(deps.token ?? (() => secret("FIGMA_TOKEN")))();

const NO_TOKEN = "reading Figma links needs FIGMA_TOKEN in ~/.factory/.env (a personal access token from Figma, Settings, Security, with read access to files). Or export the frames as PNG and attach them.";

async function call<T>(path: string, deps: FigmaDeps, token: string): Promise<T> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(`${FIGMA_API}${path}`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new FigmaError(`Figma could not be reached (${(e as Error).message.split("\n")[0]}). Try again, or attach the frames as PNG.`);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "10");
      if (attempt < 2 && Number.isFinite(wait) && wait <= MAX_WAIT_S) { await sleep(Math.max(1, wait) * 1000); continue; }
      throw new FigmaError(`Figma is limiting requests for this token${Number.isFinite(wait) ? ` (it asks to wait ${Math.ceil(wait / 60)} min)` : ""}. Try again later, or attach the frames as PNG.`);
    }
    if (res.status === 403) throw new FigmaError("the token cannot open this file. Share the file with the token's Figma account (view access is enough), or attach the frames as PNG.");
    if (res.status === 404) throw new FigmaError("Figma has no such file or node for this token. Check the link, share the file with the token's account, or attach the frames as PNG.");
    if (!res.ok) throw new FigmaError(`Figma answered ${res.status}. Try again, or attach the frames as PNG.`);
    let text: string;
    try { text = (await readResponseCapped(res, MAX_RESPONSE_BYTES)).toString("utf8"); } catch { throw new FigmaError("the Figma file is too large to read; link one page or frame (its link has a node-id) instead."); }
    try { return JSON.parse(text) as T; } catch { throw new FigmaError("Figma's answer could not be read."); }
  }
}

export interface FigmaRead {
  name: string;
  frames: { id: string; name: string; png?: Buffer }[];
  look: FigmaLook;
  notes: string[];
}

/** Read a Figma link: the frames it stands for, their look, and each frame as a PNG. */
export async function readFigmaLink(raw: string, deps: FigmaDeps = {}): Promise<FigmaRead> {
  const link = parseFigmaUrl(raw);
  const token = (deps.token ?? (() => secret("FIGMA_TOKEN")))();
  if (!token) throw new FigmaError(NO_TOKEN);
  const key = encodeURIComponent(link.fileKey);
  // 1. the outline: the page or node the link points at, two levels deep
  let outline: FigmaNode[];
  let name = "Figma file";
  if (link.nodeId) {
    const r = await call<{ name?: string; nodes?: Record<string, { document?: FigmaNode } | null> }>(`/v1/files/${key}/nodes?ids=${encodeURIComponent(link.nodeId)}&depth=2`, deps, token);
    name = r.name ?? name;
    const doc = r.nodes?.[link.nodeId]?.document;
    if (!doc) throw new FigmaError(`the node in the link (${link.nodeId}) is not in the file; copy the link again.`);
    outline = pickFrames(doc);
  } else {
    const r = await call<{ name?: string; document?: FigmaNode }>(`/v1/files/${key}?depth=2`, deps, token);
    name = r.name ?? name;
    const pages = (r.document?.children ?? []).filter((p) => p.type === "CANVAS");
    outline = [];
    for (const p of pages) { outline = pickFrames(p); if (outline.length) break; }
  }
  if (!outline.length) throw new FigmaError("no frame of screen size was found where the link points. Link a page or a frame, or attach the frames as PNG.");
  const ids = outline.map((n) => n.id);
  // 2. the frames in full, for their look
  const full = await call<{ nodes?: Record<string, { document?: FigmaNode; styles?: FigmaStyles } | null> }>(`/v1/files/${key}/nodes?ids=${ids.map(encodeURIComponent).join(",")}`, deps, token);
  const roots: FigmaNode[] = [];
  const styles: FigmaStyles = {};
  for (const id of ids) {
    const v = full.nodes?.[id];
    if (v?.document) { roots.push(v.document); Object.assign(styles, v.styles ?? {}); }
  }
  const look = figmaLook(roots.length ? roots : outline, styles);
  // 3. the frames as pictures (one export call; each picture fetched from where Figma puts it)
  const notes: string[] = [];
  const img = await call<{ err?: string | null; images?: Record<string, string | null> }>(`/v1/images/${key}?ids=${ids.map(encodeURIComponent).join(",")}&format=png&scale=1`, deps, token);
  if (img.err) notes.push(`Figma did not export the frames: ${String(img.err).slice(0, 120)}`);
  const f = deps.fetch ?? fetch;
  const frames: FigmaRead["frames"] = [];
  for (const n of outline) {
    const url = img.images?.[n.id];
    let png: Buffer | undefined;
    if (url && /^https:\/\//.test(url)) {
      try {
        if (isPrivateAddress(new URL(url).hostname)) throw new FigmaError("private address");
        const res = await f(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
        if (res.ok) png = await readResponseCapped(res, MAX_FRAME_PNG_BYTES);
        else await res.body?.cancel().catch(() => undefined);
      } catch { /* noted below */ }
    }
    if (!png) notes.push(`frame "${n.name ?? n.id}" could not be exported as a picture`);
    frames.push({ id: n.id, name: n.name ?? n.id, ...(png ? { png } : {}) });
  }
  return { name, frames, look, notes };
}

/** The role a Figma file gets with none given: it is the design, so it is matched. */
export const FIGMA_DEFAULT_ROLE = "match" as const;
