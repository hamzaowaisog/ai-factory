import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stitchBriefHtml, stitchScaffoldBrief } from "./design-link.js";
import { savedPhoto, savePhotos, stitchPhotos } from "./stitch-photos.js";

const BAYS = "https://lh3.googleusercontent.com/aida-public/bays";
const CAR = "https://lh3.googleusercontent.com/aida-public/car";
const html = `<body><div><img src="${BAYS}" data-alt="Rows of parking bays"><img src="${CAR}" alt="A silver car">`
  + `<img src="${BAYS}"><img src="https://example.com/x.jpg"><img src="data:image/png;base64,AA"></div></body>`;

describe("Stitch photos (run 4049 drew each one as a grey box)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lists a page's photos from Stitch's image host, each once, in page order", () => {
    expect(stitchPhotos("S-3", html)).toEqual([
      { url: BAYS, name: "s-3-1", alt: "Rows of parking bays" },
      { url: CAR, name: "s-3-2", alt: "A silver car" },
    ]);
  });

  it("the brief's HTML names each photo where it sits, and nothing else keeps a src", () => {
    const out = stitchBriefHtml(html, 30_000, "S-3");
    expect(out).toContain(`<img src="photo:s-3-1">`);
    expect(out).toContain(`<img src="photo:s-3-2">`);
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("googleusercontent");
    expect(stitchBriefHtml(html)).not.toContain("photo:");
  });

  it("saves each photo under the type it is served as, and leaves out one that fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-"));
    try {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => url === BAYS
        ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })
        : new Response("no", { status: 404 })));
      const log: string[] = [];
      expect(await savePhotos(dir, [{ id: "S-3", html }], (m) => log.push(m))).toEqual(["public/images/s-3-1.jpg"]);
      expect(log.join()).toContain("s-3-2 not saved");
      const [bays, car] = stitchPhotos("S-3", html);
      expect(savedPhoto(dir, bays!)).toBe("public/images/s-3-1.jpg");
      expect(savedPhoto(dir, car!)).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("the page's brief says which file each photo is, and the kinds of user sign-in sets", () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-"));
    try {
      mkdirSync(join(dir, "public/images"), { recursive: true });
      writeFileSync(join(dir, "public/images/s-3-1.webp"), "x");
      const file = savedPhoto(dir, stitchPhotos("S-3", html)[0]!)!;
      const brief = stitchScaffoldBrief({ id: "S-3", container: "c.tsx" }, [], [], false, { users: ["employee", "admin"], photos: [{ name: "s-3-1", file, alt: "Rows of parking bays" }] });
      expect(brief).toContain("photo:s-3-1 is /images/s-3-1.webp (Rows of parking bays)");
      expect(brief).toContain("(employee, admin)");
      expect(brief).toContain("setSessionRole(null)");
      expect(stitchScaffoldBrief({ id: "S-3", container: "c.tsx" }, [])).not.toContain("setSessionRole");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
