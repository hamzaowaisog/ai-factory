import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HoursRow } from "./calibrate.js";
import { loadCatalogue, type Catalogue } from "./catalogue.js";
import { currentCatalogue, readProposal, saveProposal, saveTuned, storedVersions } from "./catalogue-store.js";
import type { DecisionPair } from "./decisions.js";
import { formatTunePlan, nextValue, planTune, tuneNow, withTuneLock } from "./tune.js";

const root = loadCatalogue();
const t = root.tuning;
let n = 0;
/** finished tasks of one size pick on one catalogue version, spread over 12 builds */
const tasks = (k: number, choice: string, activeMin: number, catalogue: string, kind = "be-crud", question = "size"): DecisionPair[] => Array.from({ length: k }, () => ({
  taskId: `EST-${++n}`, question: question as never, choice, backend: "llm" as const, confidence: 1, votes: [choice],
  features: { kind, track: "backend", catalogue }, estimateRun: "e", buildRun: `b${n % 12}`,
  actual: { activeMin, turns: 10, attempts: 1, costUsd: 1, outcome: "completed" },
}));
/** large takes `largeOverTypical` x typical's minutes, in three kinds */
const evidence = (c: Catalogue, largeOverTypical: number) => ["be-crud", "be-endpoint", "be-rules"].flatMap((kind) => [...tasks(5, "typical", 20, c.version, kind), ...tasks(5, "large", 20 * largeOverTypical, c.version, kind)]);
const projects = (c: Catalogue, ratio: number, k = 10): HoursRow[] => Array.from({ length: k }, (_, i) => ({ estimateRun: `p${i}`, estimated: { min: 80, max: 120 }, actual: 100 * ratio, verdict: "within", ratio, catalogue: c.version }));

describe("one value's next number", () => {
  it("leaves a value inside the band, moves half way on a ratio scale, holds to the cap and the bounds", () => {
    expect(nextValue(t, 1.6, 1.08, 1.6)).toBeUndefined();
    expect(nextValue(t, 1.6, 0.92, 1.6)).toBeUndefined();
    // measured 1.21x: half way is x1.1
    expect(nextValue(t, 1.6, 1.21, 1.6)).toEqual({ to: 1.76 });
    // measured 4x: half way would be x2, the cap holds it to x1.2
    expect(nextValue(t, 1.6, 4, 1.6)).toEqual({ to: 1.92, limited: "cap" });
    expect(nextValue(t, 1.6, 0.1, 1.6)).toEqual({ to: 1.28, limited: "cap" });
    // never above ceiling x the repo value
    expect(nextValue(t, 3.1, 4, 1.6)).toEqual({ to: 3.2, limited: "bound" });
  });
});

describe("planning a tuned version", () => {
  it("waits for enough builds and projects, and changes nothing while it waits", () => {
    const p = planTune(root, root, tasks(5, "typical", 20, root.version), []);
    expect(p.changes).toEqual([]);
    expect(p.to).toBeUndefined();
    expect(p.waiting).toEqual([`size factors: 5 of ${root.calibration.minBuilds} builds on this version`, `hours: 0 of ${root.calibration.minProjects} finished projects with real hours on this version`]);
  });

  it("leaves a fitted factor alone and tunes one that is off, recording why", () => {
    expect(planTune(root, root, evidence(root, 1.65), [])).toMatchObject({ changes: [], fitted: [{ path: "sizes.large", measured: 1.031, evidence: 30 }] });
    const p = planTune(root, root, evidence(root, 2.4), [], new Date("2026-10-03T12:00:00Z"));
    // measured 2.4 / 1.6 = 1.5x: half way is x1.225, the cap holds it to x1.2
    expect(p.changes).toEqual([{ path: "sizes.large", from: 1.6, to: 1.92, measured: 1.5, evidence: 30, limited: "cap" }]);
    expect(p.to).toBe(`${root.version}+t1`);
    expect(p.catalogue).toMatchObject({ version: `${root.version}+t1`, sizes: { ...root.sizes, large: 1.92 }, tuned: { parent: root.version, builds: 12, at: "2026-10-03T12:00:00.000Z" } });
    expect(root.sizes.large).toBe(1.6); // the measured version is not touched
    expect(formatTunePlan(p)).toMatch(/sizes\.large\s+1\.6 -> 1\.92\s+\(measured x1\.5 over 30, held to the cap\)/);
  });

  it("scales every kind's hours from finished projects' real hours", () => {
    const p = planTune(root, root, [], projects(root, 1.3));
    expect(p.changes).toEqual([{ path: "hoursScale", from: 1, to: 1.14, measured: 1.3, evidence: 10 }]);
    expect(p.catalogue?.hoursScale).toBe(1.14);
    // evidence from another version is not this version's
    expect(planTune(root, root, [], projects({ ...root, version: "old" }, 1.3)).changes).toEqual([]);
  });

  it("settles inside the band instead of chasing the evidence, and flags a value that keeps hitting a limit", () => {
    // the true large/typical ratio is 2.2; every version is judged only on builds sized with it
    let c = root;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = planTune(c, root, evidence(c, 2.2), []);
      if (!p.catalogue) break;
      c = p.catalogue;
      seen.push(c.sizes.large);
    }
    expect(seen).toEqual([1.876, 2.032]);
    expect(Math.abs(2.2 / c.sizes.large - 1)).toBeLessThanOrEqual(t.band);
    // a value that would need to move past its ceiling twice: flagged as a wording problem
    let d = root;
    const flags: string[][] = [];
    for (let i = 0; i < 8; i++) { const p = planTune(d, root, evidence(d, 50), []); flags.push(p.flagged); if (!p.catalogue) break; d = p.catalogue; }
    expect(d.sizes.large).toBe(3.2);
    expect(flags[1]).toEqual(["sizes.large"]);
    expect(flags.at(-1)).toEqual(["sizes.large"]);
  });
});

describe("tuning against the ledger home", () => {
  let home: string;
  const before = process.env.FACTORY_HOME;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "tune-")); process.env.FACTORY_HOME = home; });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); if (before === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = before; });

  it("reports without writing on an empty home, and lets one tuner run at a time", () => {
    const p = tuneNow({ mode: "apply" })!;
    expect(p).toMatchObject({ from: root.version, changes: [], builds: 0, projects: 0 });
    expect(currentCatalogue().version).toBe(root.version);
    expect(withTuneLock(() => withTuneLock(() => "inner"))).toBeUndefined();
    expect(withTuneLock(() => "free again")).toBe("free again");
  });

  it("measures the newest tuned version, not the repo file", () => {
    const p = planTune(root, root, evidence(root, 2.4), [])!;
    saveTuned(p.catalogue!);
    expect(tuneNow({ mode: "report" })!.from).toBe(`${root.version}+t1`);
  });

  it("the background tuner only proposes; a person promotes the proposal", () => {
    // a home whose current version is off: the newest stored version, and evidence measured against it
    const t1 = planTune(root, root, evidence(root, 2.4), []).catalogue!;
    saveTuned(t1);
    const next = planTune(t1, root, evidence(t1, 2.4 * 1.5), []);
    expect(next.to).toBe(`${root.version}+t2`);
    // proposing writes nothing new estimates are sized from
    saveProposal(next.catalogue!);
    expect(readProposal(root.version)?.version).toBe(`${root.version}+t2`);
    expect(currentCatalogue().version).toBe(`${root.version}+t1`);
    expect(storedVersions(root.version).map((c) => c.version)).toEqual([`${root.version}+t1`]);
    // with nothing off, the tuner clears a stale proposal instead of keeping it
    tuneNow({ mode: "propose" });
    expect(readProposal(root.version)).toBeUndefined();
    expect(currentCatalogue().version).toBe(`${root.version}+t1`);
  });
});
