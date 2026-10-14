// Transcript runs: distill heads the step list (after discover in a build) and nothing after it is listed until it completes.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { stepsFor } from "./modes.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-modes-distill-")); });

const T = "t".repeat(64);
async function run(data: Record<string, unknown>, distilled?: string): Promise<Ledger> {
  const l = Ledger.create(`20261014-md-${Math.random().toString(16).slice(2, 6)}`);
  await l.append({ type: "run.created", data: { project: "p", operator: "sam", ...data } }, HUMAN_WRITER);
  if (distilled !== undefined) {
    await l.append({ type: "step.completed", key: "distill/1", inputsHash: "a".repeat(64), outputs: [l.putJson({ x: 1 })], data: { brief: distilled } }, HUMAN_WRITER);
  }
  return l;
}
const keys = (l: Ledger) => stepsFor(replay(l.events())).map((s) => s.key);

describe("transcript runs", () => {
  it("an estimate from a transcript runs distill alone until it completes", async () => {
    expect(keys(await run({ mode: "estimate", request: "T-1 [00:00:01] A: hi", transcriptSha: T }))).toEqual(["distill"]);
  });
  it("after distill, the usual head follows it and reads the brief", async () => {
    const l = await run({ mode: "estimate", request: "T-1 [00:00:01] A: hi", transcriptSha: T }, "# Brief\n\nGoal: x\n\n## Requirements\n- R-1: x");
    expect(keys(l).slice(0, 2)).toEqual(["distill", "intake"]);
    expect(replay(l.events()).info.request).toContain("# Brief");
  });
  it("a build from a transcript distills after discover", async () => {
    expect(keys(await run({ mode: "brownfield", request: "T-1", transcriptSha: T }))).toEqual(["discover", "distill"]);
  });
  it("a design-only run from a transcript runs distill first", async () => {
    expect(keys(await run({ mode: "design", request: "T-1", transcriptSha: T }))).toEqual(["distill"]);
  });
  it("a run without a transcript is unchanged", async () => {
    expect(keys(await run({ mode: "estimate", request: "a portal" }))).not.toContain("distill");
  });
});
