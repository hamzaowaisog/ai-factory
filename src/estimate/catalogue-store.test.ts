import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCatalogue } from "./catalogue.js";
import { catalogueAt, currentCatalogue, generationOf, rootOf, saveTuned, storedVersions, tunedVersion } from "./catalogue-store.js";
import { multiplier } from "./catalogue-size.js";

const root = loadCatalogue();
let home: string;
const before = process.env.FACTORY_HOME;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "cat-store-")); process.env.FACTORY_HOME = home; });
afterEach(() => { rmSync(home, { recursive: true, force: true }); if (before === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = before; });

const tuned = (gen: number, over: Partial<typeof root> = {}) => ({ ...root, ...over, version: tunedVersion(root.version, gen), tuned: { parent: gen > 1 ? tunedVersion(root.version, gen - 1) : root.version, at: "2026-10-03T00:00:00Z", builds: 10, projects: 0, changes: [], flagged: [] } });

describe("catalogue versions", () => {
  it("names tuned versions after their root and counts generations", () => {
    expect(rootOf(`${root.version}+t3`)).toBe(root.version);
    expect(generationOf(`${root.version}+t3`)).toBe(3);
    expect(generationOf(root.version)).toBe(0);
  });

  it("sizes new estimates from the newest tuned version, keeps old versions readable, and never overwrites one", () => {
    expect(currentCatalogue().version).toBe(root.version);
    saveTuned(tuned(1));
    saveTuned(tuned(2, { hoursScale: 1.1 }));
    // another root's tuned version is not used
    saveTuned({ ...tuned(5), version: "1999-01-01.1+t5" });
    expect(storedVersions(root.version).map((c) => c.version)).toEqual([`${root.version}+t1`, `${root.version}+t2`]);
    expect(currentCatalogue()).toMatchObject({ version: `${root.version}+t2`, hoursScale: 1.1 });
    expect(catalogueAt(`${root.version}+t1`).version).toBe(`${root.version}+t1`);
    expect(catalogueAt(root.version)).toBe(root);
    expect(() => catalogueAt(`${root.version}+t9`)).toThrow(/not in/);
    expect(() => saveTuned(tuned(1))).toThrow();
  });

  it("applies a tuned hours scale to every task and says so", () => {
    const t = { id: "EST-1", track: "backend" as const, kind: "be-crud", complexity: "standard" as const, executor: "human" as const };
    const s = { taskId: "EST-1", size: "typical" as const, reason: "r" };
    expect(multiplier(root, t, s, ["default"])).toEqual({ mult: 1, parts: ["typical"] });
    expect(multiplier({ ...root, hoursScale: 1.2 }, t, s, ["default"])).toEqual({ mult: 1.2, parts: ["tuned hours x1.2"] });
  });
});
