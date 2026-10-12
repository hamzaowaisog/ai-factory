import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { files, pageOf, setStitchFactory, setStitchFileTries, stitchClient } from "./stitch.js";

describe("stitch client", () => {
  const saved = { home: process.env.FACTORY_HOME, key: process.env.STITCH_API_KEY };
  afterEach(() => {
    for (const [k, v] of [["FACTORY_HOME", saved.home], ["STITCH_API_KEY", saved.key]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetEnvCache(); setStitchFactory(undefined);
  });
  it("refuses without STITCH_API_KEY", () => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "stitch-")); delete process.env.STITCH_API_KEY; _resetEnvCache();
    expect(() => stitchClient()).toThrow(/STITCH_API_KEY/);
  });
  it("uses the factory a test sets, behind the time limits", async () => {
    setStitchFactory(() => ({ createProject: async () => "p1" }) as never);
    expect(await stitchClient().createProject("t")).toBe("p1");
  });
});

describe("loading the Stitch SDK (PR #32 review)", () => {
  it("only when a Stitch run starts: no static import, so other runs never need the package", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./stitch.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+"@google\/stitch-sdk"/m);
    expect(src).toMatch(/import\("@google\/stitch-sdk"\)/);
  });
});

describe("the page among what Stitch gave back", () => {
  it("takes the screen that has a page, not the photograph Stitch made first", () => {
    const photo = { name: "projects/p/screens/pic", htmlCode: {}, screenshot: { downloadUrl: "pic-url" } };
    const page = { name: "projects/p/screens/page", htmlCode: { downloadUrl: "html-url" }, screenshot: { downloadUrl: "img-url" } };
    expect(pageOf({ outputComponents: [{}, { design: { screens: [photo, page] } }] })).toEqual({ id: "page", htmlUrl: "html-url", imageUrl: "img-url" });
    expect(pageOf({ outputComponents: [{ design: { screens: [photo] } }] }).id).toBe("pic");
    expect(() => pageOf({ outputComponents: [{}] })).toThrow("without a screen");
  });
});

describe("the files of a screen Stitch just drew", () => {
  afterEach(() => setStitchFileTries(undefined));

  it("asks again when Stitch does not have the screen yet, and fails only after the last try", async () => {
    setStitchFileTries({ tries: 3, waitMs: 1 });
    let asked = 0;
    const late = { id: "scr-1", async getHtml() { if (++asked < 3) throw new Error("Tool Call Failed [get_screen]: Request contains an invalid argument."); return "html-url"; }, async getImage() { return "img-url"; } };
    expect(await files(late)).toEqual({ screenId: "scr-1", htmlUrl: "html-url", imageUrl: "img-url" });
    const never = { id: "scr-2", async getHtml() { return "html-url"; }, async getImage() { return ""; } };
    await expect(files(never)).rejects.toThrow("gave no picture");
  });
});
