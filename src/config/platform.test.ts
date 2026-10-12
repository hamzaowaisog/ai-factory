import { describe, expect, it } from "vitest";
import { asWeb, webOnly } from "./platform.js";

describe("web only", () => {
  it("holds for a design run and a new product, not for an estimate or work in an existing repo", () => {
    expect([webOnly("design"), webOnly("greenfield"), webOnly("estimate"), webOnly("brownfield"), webOnly(undefined)]).toEqual([true, true, false, false, false]);
  });

  it("is switched off by the project, for when phone apps are built", () => {
    expect([webOnly("design", { webOnly: false }), webOnly("design", { webOnly: true }), webOnly("design", {})]).toEqual([false, true, true]);
  });

  it("turns a phone app and its bottom tab bar into a responsive web app, and leaves a web design as it is", () => {
    const phone = { screens: [1], apps: [{ id: "driver", device: "phone", shell: "tabs" }, { id: "admin", device: "web", shell: "sidebar" }], theme: { shell: "tabs", reading: { device: "phone", tone: "calm" } } };
    expect(asWeb(phone)).toEqual({ screens: [1], apps: [{ id: "driver", device: "web", shell: "topbar" }, { id: "admin", device: "web", shell: "sidebar" }], theme: { shell: "topbar", reading: { device: "both", tone: "calm" } } });
    const web = { screens: [1], theme: { shell: "sidebar", reading: { device: "web" } } };
    expect(asWeb(web)).toEqual(web);
  });
});
