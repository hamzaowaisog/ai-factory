// Figma references without a browser: links, the API's answers and refusals, and the look read from nodes.
import { describe, expect, it } from "vitest";
import { figmaLook, parseFigmaUrl, pickFrames, readFigmaJson, readFigmaLink, type FigmaNode } from "./figma.js";

const solid = (r: number, g: number, b: number) => [{ type: "SOLID", color: { r: r / 255, g: g / 255, b: b / 255 } }];
const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
const screen = (id: string, name: string, children: FigmaNode[] = []): FigmaNode => ({ id, name, type: "FRAME", absoluteBoundingBox: box(1440, 900), fills: solid(250, 250, 250), children });

describe("Figma links", () => {
  it("reads the file key, a branch and the node", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbCdEfGhIjKlMn/My-App?node-id=12-34&t=x")).toEqual({ fileKey: "AbCdEfGhIjKlMn", nodeId: "12:34" });
    expect(parseFigmaUrl("https://figma.com/file/AbCdEfGhIjKlMn/x?node-id=12%3A34")).toEqual({ fileKey: "AbCdEfGhIjKlMn", nodeId: "12:34" });
    expect(parseFigmaUrl("https://www.figma.com/design/AbCdEfGhIjKlMn/branch/ZyXwVuTsRqPoNm/x")).toEqual({ fileKey: "ZyXwVuTsRqPoNm" });
    expect(parseFigmaUrl("https://www.figma.com/proto/AbCdEfGhIjKlMn/x?node-id=0-1")).toEqual({ fileKey: "AbCdEfGhIjKlMn" });
    expect(() => parseFigmaUrl("https://www.figma.com/files/recent")).toThrow(/does not name a Figma file/);
    expect(() => parseFigmaUrl("https://example.com/design/AbCdEfGhIjKlMn")).toThrow(/not a Figma link/);
  });
});

describe("the look from nodes", () => {
  it("takes roles from style names, the brand from buttons, fonts by use and the buttons' corners", () => {
    const button = (id: string, rgb: [number, number, number]): FigmaNode => ({ id, name: "Button", type: "INSTANCE", cornerRadius: 12, absoluteBoundingBox: box(140, 40), fills: solid(...rgb), effects: [{ type: "DROP_SHADOW" }], children: [{ id: `${id}t`, type: "TEXT", characters: "Go", style: { fontFamily: "Inter", fontSize: 14 }, fills: solid(255, 255, 255) }] });
    const home = screen("1:1", "Home", [
      { id: "h", type: "TEXT", characters: "Welcome", style: { fontFamily: "Playfair Display", fontSize: 40 }, fills: solid(20, 20, 30) },
      { id: "p", type: "TEXT", characters: "A long paragraph of body text here.", style: { fontFamily: "Inter", fontSize: 16 }, fills: solid(20, 20, 30) },
      button("b1", [230, 80, 20]), button("b2", [230, 80, 20]),
      { id: "c", type: "RECTANGLE", absoluteBoundingBox: box(300, 200), fills: solid(0, 150, 200), styles: { fill: "S:accent" }, cornerRadius: 4 },
    ]);
    const look = figmaLook([home], { "S:accent": { name: "Accent/Teal" } });
    const role = (r: string) => look.colours.find((c) => c.role === r)?.hex;
    expect(role("accent")).toBe("#0096c8");
    expect(role("brand")).toBe("#e65014");
    expect(role("button")).toBe("#e65014");
    expect(role("page")).toBe("#fafafa");
    expect(role("text")).toBe("#14141e");
    expect(look.colours.every((c) => c.exact)).toBe(true);
    expect(look.fonts).toEqual([{ family: "Inter", use: "body" }, { family: "Playfair Display", use: "heading" }]);
    expect(look.radiusPx).toBe(12);
    expect(look.shadows).toBe(true);
    expect(look.notes.join(" ")).toMatch(/styles: accent/);
  });

  it("picks the screens on a page and skips icons and hidden frames", () => {
    const page: FigmaNode = { id: "0:1", type: "CANVAS", children: [
      { id: "i", type: "COMPONENT", absoluteBoundingBox: box(24, 24) },
      screen("1:1", "A"), { ...screen("1:2", "Hidden"), visible: false },
      { id: "s", type: "SECTION", children: [screen("1:3", "B")] },
    ] };
    expect(pickFrames(page).map((f) => f.name)).toEqual(["A", "B"]);
    expect(pickFrames({ id: "x", type: "FRAME", absoluteBoundingBox: box(50, 50) }).map((f) => f.id)).toEqual(["x"]);
  });

  it("reads a JSON export: a file, a nodes answer, or refuses anything else", () => {
    const file = { name: "App", document: { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [screen("1:1", "Home")] }] } };
    expect(readFigmaJson(JSON.stringify(file)).roots.map((r) => r.name)).toEqual(["Home"]);
    expect(readFigmaJson(JSON.stringify({ nodes: { "1:1": { document: screen("1:1", "Home"), styles: { a: { name: "Primary" } } } } })).styles).toEqual({ a: { name: "Primary" } });
    expect(() => readFigmaJson('{"hello": 1}')).toThrow(/not a Figma export/);
    expect(() => readFigmaJson("{")).toThrow(/not valid JSON/);
  });
});

describe("the Figma API", () => {
  const link = "https://www.figma.com/design/AbCdEfGhIjKlMn/App?node-id=1-1";
  const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

  it("needs a token, and says what a refused or missing file means", async () => {
    await expect(readFigmaLink(link, { token: () => undefined })).rejects.toThrow(/FIGMA_TOKEN in ~\/.factory\/.env/);
    await expect(readFigmaLink(link, { token: () => "t", fetch: (async () => answer(403)) as typeof fetch })).rejects.toThrow(/cannot open this file/);
    await expect(readFigmaLink(link, { token: () => "t", fetch: (async () => answer(404)) as typeof fetch })).rejects.toThrow(/no such file or node/);
    await expect(readFigmaLink(link, { token: () => "t", fetch: (async () => answer(200, { nodes: {} })) as typeof fetch })).rejects.toThrow(/not in the file/);
  });

  it("waits out a short rate limit and gives up on a long one", async () => {
    const waits: number[] = [];
    let calls = 0;
    const frame = screen("1:1", "Home");
    const fetchFake = (async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.["X-Figma-Token"] ?? "t").toBe("t");
      if (calls++ === 0) return answer(429, {}, { "retry-after": "3" });
      if (String(url).includes("/v1/images/")) return answer(200, { images: { "1:1": null } });
      return answer(200, { name: "App", nodes: { "1:1": { document: frame } } });
    }) as typeof fetch;
    const r = await readFigmaLink(link, { token: () => "t", fetch: fetchFake, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([3000]);
    expect(r.frames).toEqual([{ id: "1:1", name: "Home" }]);
    expect(r.notes).toContain('frame "Home" could not be exported as a picture');
    await expect(readFigmaLink(link, { token: () => "t", fetch: (async () => answer(429, {}, { "retry-after": "3600" })) as typeof fetch, sleep: async () => undefined })).rejects.toThrow(/limiting requests .* 60 min/);
  });
});
