import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { findChromium } from "../estimate/screenshots.js";
import { captureReports } from "./capture.js";
import { compareReports } from "./fidelity.js";

const page = (body: string) => `<!doctype html><html lang="en"><body style="margin:0">${body}</body></html>`;
const dir = mkdtempSync(join(tmpdir(), "cap-"));
const file = (name: string, html: string) => { const f = join(dir, name); writeFileSync(f, html); return pathToFileURL(f).href; };

describe("capture reports of a running app", () => {
  it("says so, and does not throw, when switched off or there is no browser", async () => {
    process.env.FACTORY_NO_SCREENSHOTS = "1";
    try { expect((await captureReports([{ name: "a", url: "file:///x" }], join(dir, "o"))).note).toMatch(/switched off/); } finally { delete process.env.FACTORY_NO_SCREENSHOTS; }
    const saved = process.env.FACTORY_CHROMIUM;
    process.env.FACTORY_CHROMIUM = join(dir, "missing");
    try { expect((await captureReports([{ name: "a", url: "file:///x" }], join(dir, "o"))).note).toMatch(/no browser/); } finally { if (saved === undefined) delete process.env.FACTORY_CHROMIUM; else process.env.FACTORY_CHROMIUM = saved; }
  });

  it.skipIf(!findChromium())("reports both widths; a new missing alt, a moved button and sideways scroll are found against the approved page", async () => {
    const good = file("good.html", page('<h1>Pay</h1><button data-testid="pay" style="margin-top:20px">Pay now</button><img alt="logo" src="data:,">'));
    const bad = file("bad.html", page('<h1>Pay</h1><button data-testid="pay" style="margin-top:120px">Pay now</button><img src="data:,"><div style="width:2000px">wide</div>'));
    const a = await captureReports([{ name: "pay", url: good }], join(dir, "a"));
    const b = await captureReports([{ name: "pay", url: bad }], join(dir, "b"));
    expect(a.note).toBeUndefined();
    expect(a.reports.map((r) => r.state)).toEqual(["pay (phone)", "pay (desktop)"]);
    expect(a.files).toEqual(["pay-phone.png", "pay-desktop.png"]);
    expect(existsSync(join(dir, "a", "pay-phone.png"))).toBe(true);
    expect(compareReports(a.reports, a.reports).every((r) => r.status === "PASS")).toBe(true);
    const r = compareReports(a.reports, b.reports);
    expect(r.find((x) => x.check.startsWith("accessibility"))).toMatchObject({ status: "FAIL" });
    expect(r.find((x) => x.check.startsWith("layout"))?.items?.join(" ")).toMatch(/Pay now/);
    expect(r.find((x) => x.check.startsWith("responsive"))).toMatchObject({ status: "FAIL" });
  });
});
