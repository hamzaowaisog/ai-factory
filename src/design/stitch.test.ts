import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../config/env.js";
import { setStitchFactory, stitchClient } from "./stitch.js";

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
