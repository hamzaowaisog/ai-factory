import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemo } from "./demo.js";
import { captureDemo, findChromium } from "./screenshots.js";

const screens = [
  { id: "S-1", route: "/pay", file: "app/pay/page.tsx", reqs: ["REQ-1"], states: ["default", "error"], size: "new", frames: [] },
  { id: "S-2", route: "/done", file: "app/done/page.tsx", reqs: ["REQ-1"], states: [], size: "tweak", frames: [] },
];
const html = buildDemo({ title: "Pay", flow: "pay then done", screens, requirements: { "REQ-1": "When paying, the system shall confirm." }, noScreen: [] });
const dir = () => mkdtempSync(join(tmpdir(), "shots-"));

describe("demo screenshots", () => {
  it("say so, and do not throw, when there is no browser or they are switched off", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    process.env.FACTORY_NO_SCREENSHOTS = "1";
    try { expect((await captureDemo(f, screens, join(d, "s"))).note).toMatch(/switched off/); } finally { delete process.env.FACTORY_NO_SCREENSHOTS; }
    const saved = process.env.FACTORY_CHROMIUM;
    process.env.FACTORY_CHROMIUM = join(d, "missing");
    try { const r = await captureDemo(f, screens, join(d, "s")); expect(r.shots).toEqual([]); expect(r.note).toMatch(/no browser/); } finally { if (saved === undefined) delete process.env.FACTORY_CHROMIUM; else process.env.FACTORY_CHROMIUM = saved; }
    expect((await captureDemo(f, [], join(d, "s"))).shots).toEqual([]);
  });

  it.skipIf(!findChromium())("takes each screen in each state at phone and desktop width", async () => {
    const d = dir(); const f = join(d, "demo.html"); writeFileSync(f, html);
    const out = join(d, "shots");
    const r = await captureDemo(f, screens, out);
    expect(r.note).toBeUndefined();
    // S-1 has two states, S-2 none listed (one "default"): 3 per width
    expect(r.shots.map((s) => s.file).sort()).toEqual(["s-1-default-desktop.png", "s-1-default-phone.png", "s-1-error-desktop.png", "s-1-error-phone.png", "s-2-default-desktop.png", "s-2-default-phone.png"]);
    for (const s of r.shots) { expect(existsSync(join(out, s.file))).toBe(true); expect(statSync(join(out, s.file)).size).toBeGreaterThan(500); }
    expect(readdirSync(out)).toHaveLength(6);
  }, 60_000);
});
