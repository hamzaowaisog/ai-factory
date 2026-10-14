import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { answerShape, dropped, editedSince, files, pageOf, setStitchFactory, setStitchFileTries, setStitchRetryWait, stitchClient } from "./stitch.js";

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
  it("takes the page, not the signature Stitch drew first with a page file of its own", () => {
    const signature = { name: "projects/p/screens/sig", width: 500, height: 200, htmlCode: { downloadUrl: "sig-html" }, screenshot: { downloadUrl: "sig-img" } };
    const page = { name: "projects/p/screens/page", deviceType: "DESKTOP", width: 2560, height: 3732, htmlCode: { downloadUrl: "html-url" }, screenshot: { downloadUrl: "img-url" } };
    expect(pageOf({ outputComponents: [{ design: { screens: [signature, page] } }] }).id).toBe("page");
    // no device on either: the taller one is the page
    expect(pageOf({ outputComponents: [{ design: { screens: [signature, { ...page, deviceType: undefined }] } }] }).id).toBe("page");
  });
});

describe("an answer without a screen", () => {
  it("says what the answer held instead", () => {
    expect(() => pageOf({ outputComponents: [{ text: "I could not change that screen." }, { suggestion: "Try a smaller change", design: {} }] } as never))
      .toThrow('without a screen (it sent text "I could not change that screen." | suggestion "Try a smaller change", design)');
    expect(answerShape({ outputComponents: [] })).toBe("no parts");
    expect(answerShape({ outputComponents: [{}] })).toBe("an empty part");
    expect(answerShape({})).toBe("an empty answer");
    expect(answerShape({ sessionId: "s1", screens: [1, 2] })).toBe('no outputComponents, only sessionId "s1", screens [2]');
    expect(answerShape(undefined)).toBe("nothing");
    expect(answerShape({ outputComponents: [{ text: "x".repeat(400) }] })).toHaveLength('text ""'.length + 161);
  });
  it("finds the edited screen in the project's list: the one new page with the edited screen's title", () => {
    const scr = (id: string, title: string, page = true) => ({ name: `projects/p/screens/${id}`, title, ...(page ? { htmlCode: { downloadUrl: `html-${id}` } } : {}) });
    const before = [scr("a", "Routes"), scr("b", "Orders")];
    expect(editedSince(before, [...before, scr("c", "Routes"), scr("d", "Orders")], "a")?.name).toBe("projects/p/screens/c");
    // nothing certain: no new page with that title, two of them, a picture without a page, or the edited screen not listed
    expect(editedSince(before, [...before, scr("d", "Orders")], "a")).toBeUndefined();
    expect(editedSince(before, [...before, scr("c", "Routes"), scr("e", "Routes")], "a")).toBeUndefined();
    expect(editedSince(before, [...before, scr("c", "Routes", false)], "a")).toBeUndefined();
    expect(editedSince(before, [...before, scr("c", "Routes")], "zz")).toBeUndefined();
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

describe("a Stitch call whose connection drops", () => {
  const drop = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET", message: "other side closed" } });
  it("is tried once more and goes on; a second drop fails with the network's reason; other errors are not retried", async () => {
    setStitchRetryWait(0);
    process.env.STITCH_API_KEY = "test";
    let calls = 0;
    setStitchFactory(() => ({ generate: async () => { calls++; if (calls === 1) throw drop(); return { html: "<p/>" }; } }) as never);
    await expect(stitchClient().generate("p", "x", "DESKTOP")).resolves.toEqual({ html: "<p/>" });
    expect(calls).toBe(2);
    setStitchFactory(() => ({ generate: async () => { throw drop(); } }) as never);
    await expect(stitchClient().generate("p", "x", "DESKTOP")).rejects.toThrow("the connection dropped twice during generate_screen (UND_ERR_SOCKET other side closed)");
    calls = 0;
    setStitchFactory(() => ({ generate: async () => { calls++; throw new Error("quota exceeded"); } }) as never);
    await expect(stitchClient().generate("p", "x", "DESKTOP")).rejects.toThrow("quota exceeded");
    expect(calls).toBe(1);
    expect(dropped(new Error("Unauthorized"))).toBe(false);
    setStitchFactory(undefined); setStitchRetryWait(3_000);
  });
});
