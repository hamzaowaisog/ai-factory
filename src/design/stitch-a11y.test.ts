import { describe, expect, it } from "vitest";
import { a11yHtml, checkStitchA11y, stitchA11yLines, themeContrastFaults } from "./stitch-a11y.js";
import { findChromium } from "./screenshots.js";

describe("Stitch HTML for the accessibility check", () => {
  it("drops scripts, links and inline handlers, and keeps the rest", () => {
    const out = a11yHtml(`<html><head><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="x"></head><body><button onclick="steal()" class="b">Go</button><script>x()</script></body></html>`);
    expect(out).not.toMatch(/<script|<link|onclick/i);
    expect(out).toContain(`<button class="b">Go</button>`);
  });
});

describe("the check in a browser", () => {
  it.skipIf(!findChromium())("finds an unnamed button and an unlabelled field, and nothing on a clean page", async () => {
    const got = await checkStitchA11y([
      { id: "S-1", html: `<html lang="en"><head><title>A</title></head><body><main><h1>A</h1><button></button><input type="text"></main></body></html>` },
      { id: "S-2", html: `<html lang="en"><head><title>B</title></head><body><main><h1>B</h1><label for="n">Name</label><input id="n" type="text"><button>Save</button></main></body></html>` },
    ]);
    expect(got).toBeDefined();
    const rules = (id: string) => got!.find((x) => x.id === id)!.violations.map((v) => v.id);
    expect(rules("S-1")).toEqual(expect.arrayContaining(["button-name", "label"]));
    expect(rules("S-2")).toEqual([]);
  }, 60_000);

  it("says nothing (undefined) when there is no browser", async () => {
    const saved = process.env.FACTORY_CHROMIUM;
    process.env.FACTORY_CHROMIUM = "/no/such/chromium";
    try { expect(await checkStitchA11y([{ id: "S-1", html: "<p>x</p>" }])).toBeUndefined(); } finally { if (saved === undefined) delete process.env.FACTORY_CHROMIUM; else process.env.FACTORY_CHROMIUM = saved; }
  });
});

describe("theme contrast and the card", () => {
  it("checks the theme's palette in each of its modes (the palette keeps text readable for any brand colour)", () => {
    for (const brand of ["#0F766E", "#FFE58A", "#808080"]) for (const mode of ["light", "dark", "auto"]) expect(themeContrastFaults({ mood: "x", brand, mode } as never), `${brand} ${mode}`).toEqual([]);
  });
  it("lists what stays open for the approval card", () => {
    expect(stitchA11yLines([{ screen: "S-1", rules: ["button-name", "label"] }])).toEqual(["Accessibility, still open (Stitch could not fix these):", "- S-1: button-name, label", ""]);
    expect(stitchA11yLines(undefined)).toEqual([]);
  });
});

describe("the sanitizer (review I4)", () => {
  it("closes the bypasses: split script tags, slash-separated handlers, javascript and srcdoc frames", () => {
    const out = a11yHtml(`<div><scr<script>x</script>ipt>alert(1)</script><img/onerror=alert(1) src=x><iframe src="javascript:alert(1)"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>
      <object data="x.swf"></object><embed src="x"><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">
      <a href="javascript:alert(1)">Go</a><a href="/ok">Ok</a><button formaction="javascript:alert(1)">B</button></div>`);
    expect(out).not.toMatch(/<script|<iframe|<object|<embed|<base|<meta|onerror|javascript:|srcdoc/i);
    expect(out).toContain(`<a href="/ok">Ok</a>`);
    expect(out).toContain(`>Go</a>`);
  });
});
