// A Stitch design in the approval demo and the exports made from it: each state shows only its own Stitch screenshot, with no
// app frame of ours around it (the screenshot already has the app's own).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemo } from "./demo.js";
import { findChromium } from "./screenshots.js";

const png = (n: number) => `data:image/png;base64,${Buffer.from(`PNG-${n}`).toString("base64")}`;
const stitchScreen = { id: "S-1", route: "/appointments", file: "app/appointments/page.tsx", reqs: ["REQ-1"], states: ["empty"], size: "new" as const, frames: ["ST-1", "ST-2"] };
const stitchFrames = { "ST-1": { name: "stitch-S-1-normal-aaaaaaaa.png", dataUri: png(1), state: "normal" }, "ST-2": { name: "stitch-S-1-empty-bbbbbbbb.png", dataUri: png(2), state: "empty" } };
const demo = (screens: typeof stitchScreen[], frames: Record<string, { name: string; dataUri?: string; state?: string }>) =>
  buildDemo({ title: "Clinic", flow: "f", screens, requirements: { "REQ-1": "List appointments." }, noScreen: [], frames });

describe("a Stitch screen in the demo", () => {
  it("gives each state its own pane with its own screenshot, and no app frame of ours", () => {
    const html = demo([stitchScreen], stitchFrames);
    const section = html.slice(html.indexOf(`id="S-1"`));
    expect(section).toMatch(new RegExp(`data-wf="0"[^>]*><img src="${png(1).replace(/[+/]/g, "\\$&")}"`));
    expect(section).toMatch(new RegExp(`data-wf="1" hidden><img src="${png(2).replace(/[+/]/g, "\\$&")}"`));
    expect(section.slice(0, section.indexOf("</section>"))).not.toContain(`class="topbar`);
  });

  it("still shows a request's attached frames, which carry no state, inside the app frame as before", () => {
    const html = demo([{ ...stitchScreen, states: [], frames: ["F-1"] }], { "F-1": { name: "mock.png", dataUri: png(3) } });
    const section = html.slice(html.indexOf(`id="S-1"`), html.indexOf("</section>", html.indexOf(`id="S-1"`)));
    expect(section).toContain(`<img src="${png(3)}" alt="mock.png">`);
    expect(section).toContain(`class="topbar`);
  });

  it.skipIf(!findChromium())("shows only the empty screenshot once the Empty tab is chosen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stitch-demo-"));
    const file = join(dir, "index.html");
    writeFileSync(file, demo([stitchScreen], stitchFrames));
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.goto(`file:///${file.replace(/\\/g, "/")}#S-1`);
      const visible = () => page.locator("#S-1 .pane:not([hidden]) img").evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
      expect(await visible()).toEqual(["stitch-S-1-normal-aaaaaaaa.png"]);
      await page.locator(`#S-1 [data-state="1"]`).click();
      expect(await visible()).toEqual(["stitch-S-1-empty-bbbbbbbb.png"]);
    } finally { await browser.close(); }
  }, 60_000);
});

describe("Stitch frames for the approval step", () => {
  it("carry each frame's state", async () => {
    const { stitchFrames: list } = await import("../stages/design-stitch.js");
    expect(list({ stitch: { frames: { "ST-1": { name: "a.png", state: "normal" }, "ST-2": { name: "b.png", state: "empty" } } } } as never))
      .toEqual([{ id: "ST-1", name: "a.png", state: "normal" }, { id: "ST-2", name: "b.png", state: "empty" }]);
  });
});

describe("the Figma export of a Stitch design", () => {
  it.skipIf(!findChromium())("gives one frame per screen and state, each with its own Stitch picture", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    const shot = async (colour: string) => {
      const p = await browser.newPage({ viewport: { width: 320, height: 480 } });
      await p.setContent(`<body style="margin:0"><div style="width:320px;height:480px;background:${colour}"></div></body>`);
      const b = await p.screenshot();
      await p.close();
      return `data:image/png;base64,${b.toString("base64")}`;
    };
    const frames = { "ST-1": { name: "stitch-S-1-normal-aaaaaaaa.png", dataUri: await shot("#0f766e"), state: "normal" }, "ST-2": { name: "stitch-S-1-empty-bbbbbbbb.png", dataUri: await shot("#f59e0b"), state: "empty" } };
    await browser.close();
    const dir = mkdtempSync(join(tmpdir(), "stitch-pkg-"));
    mkdirSync(join(dir, "demo"));
    writeFileSync(join(dir, "demo", "index.html"), demo([stitchScreen], frames));
    writeFileSync(join(dir, "design.json"), JSON.stringify({ schemaVersion: 1, flow: "f", screens: [{ id: "S-1", route: "/appointments" }] }));
    const manifest = { line: "clinic", version: 1, product: { name: "Clinic" }, run: { id: "r1", mode: "design", project: "p" }, screens: [{ id: "S-1", title: "Appointments", route: "/appointments", reqs: ["REQ-1"], states: ["default", "empty"] }], shots: [], files: [] };
    const { figmaDoc } = await import("./figma.js");
    const shots = ["default", "empty"].map((stateBase) => ({ id: "S-1", screen: "S-1 Appointments", stateBase, viewport: "desktop" as const, modeName: "light" as const, langCode: "en", file: `s-1-${stateBase}-desktop.png` }));
    const saved = process.env.FACTORY_NO_SCREENSHOTS;
    delete process.env.FACTORY_NO_SCREENSHOTS;
    let r: Awaited<ReturnType<typeof figmaDoc>>;
    try { r = await figmaDoc({ manifest, dir } as never, shots, "test"); } finally { if (saved !== undefined) process.env.FACTORY_NO_SCREENSHOTS = saved; }
    expect(r.why).toBeUndefined();
    expect(r.doc!.frames.map((f) => f.state)).toEqual(["default", "empty"]);
    for (const f of r.doc!.frames) { expect(f.picture).toBeTruthy(); expect(f.nodes).toBeGreaterThan(0); }
    expect(r.doc!.frames[0]!.picture).not.toEqual(r.doc!.frames[1]!.picture);
  }, 120_000);
});
