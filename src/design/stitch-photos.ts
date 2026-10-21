// The photographs an approved Stitch page shows. Stitch serves them from Google's image host; the stub commit saves each one in
// the app (public/images/<screen>-<n>.<ext>) and the coding task is told which is which, so the built page shows the approved
// photo and not a grey box in its place (run 4049 drew every one as a placeholder).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "cheerio";

/** A photo on a Stitch page: where Stitch serves it, the name it is saved under (no extension) and what it shows. */
export interface StitchPhoto { url: string; name: string; alt: string }

/** Where Stitch keeps its pictures; nothing is fetched from anywhere else. */
const PHOTO_HOST = /^https:\/\/lh3\.googleusercontent\.com\//;
export const PHOTO_DIR = "public/images";
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const MAX_BYTES = 5_000_000;
/** Most photos saved for one page: a page of more is a gallery of sample records, not the approved look. */
const MAX_PER_PAGE = 8;

/** The photos of a page's HTML, in page order, each once. */
export function stitchPhotos(screenId: string, html: string): StitchPhoto[] {
  const $ = load(html);
  const seen = new Map<string, StitchPhoto>();
  $("img[src]").each((_, el) => {
    const url = $(el).attr("src")!.trim();
    if (!PHOTO_HOST.test(url) || seen.has(url) || seen.size >= MAX_PER_PAGE) return;
    const alt = ($(el).attr("data-alt") ?? $(el).attr("alt") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    seen.set(url, { url, name: `${screenId.toLowerCase()}-${seen.size + 1}`, alt });
  });
  return [...seen.values()];
}

/** The saved file of a photo in a checkout (its extension is the type it was served as), or undefined when it was not saved. */
export function savedPhoto(dir: string, p: StitchPhoto): string | undefined {
  const ext = Object.values(TYPES).find((e) => existsSync(join(dir, PHOTO_DIR, `${p.name}.${e}`)));
  return ext ? `${PHOTO_DIR}/${p.name}.${ext}` : undefined;
}

/** Save each page's photos in the checkout; returns the files written. A photo that cannot be fetched is left out. */
export async function savePhotos(dir: string, pages: { id: string; html: string }[], log: (m: string) => void): Promise<string[]> {
  const written: string[] = [];
  for (const page of pages) {
    for (const p of stitchPhotos(page.id, page.html)) {
      try {
        const res = await fetch(p.url, { signal: AbortSignal.timeout(20_000), headers: { accept: "image/jpeg,image/png,image/webp" } });
        const ext = TYPES[(res.headers.get("content-type") ?? "").split(";")[0]!.trim()];
        const body = res.ok && ext ? Buffer.from(await res.arrayBuffer()) : undefined;
        if (!body || !ext || body.length > MAX_BYTES) { log(`stub-commit: ${p.name} not saved (${res.status} ${res.headers.get("content-type") ?? ""})`); continue; }
        mkdirSync(join(dir, PHOTO_DIR), { recursive: true });
        writeFileSync(join(dir, PHOTO_DIR, `${p.name}.${ext}`), body);
        written.push(`${PHOTO_DIR}/${p.name}.${ext}`);
      } catch (e) {
        log(`stub-commit: ${p.name} not saved (${(e as Error).message})`);
      }
    }
  }
  return written;
}
