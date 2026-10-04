// A newer prompt template is for new runs (PR #11 review, item 7): a step a paused run already completed keeps the version it
// ran with, so upgrading the factory does not plan or code a run in flight again. A change of inputs or model still does.
import { describe, expect, it } from "vitest";
import { inputsHash, type RunState } from "../ledger/state.js";
import { earlierVersions, stepDone } from "./executor.js";

const inp = { spec: "s".repeat(64) };
const ranWith = (templateVersion: string, model = "m") => ({ steps: new Map([["plan", { step: "plan", status: "completed", inputsHash: inputsHash({ inputs: [JSON.stringify(inp)], stageDef: "plan", templateVersion, model }), outputs: ["x"], attempts: 1, interruptions: 0, lastAttempt: 1, failureSignatures: [] }]]) }) as unknown as RunState;

describe("template versions of a run in flight", () => {
  it("lists the current version and every earlier number", () => {
    expect(earlierVersions("3")).toEqual(["3", "2", "1"]);
    expect(earlierVersions("1")).toEqual(["1"]);
    expect(earlierVersions("v2-beta")).toEqual(["v2-beta"]);
  });

  it("keeps a step completed under an older template done; new inputs or another model run it again", () => {
    const plan = { key: "plan", templateVersion: "2" };
    expect(stepDone(ranWith("1"), plan, inp, "m").done).toBe(true);
    expect(stepDone(ranWith("2"), plan, inp, "m").done).toBe(true);
    expect(stepDone(ranWith("1"), plan, { spec: "t".repeat(64) }, "m").done).toBe(false);
    expect(stepDone(ranWith("1"), plan, inp, "other").done).toBe(false);
    // a run that has not done the step yet runs it under the new template
    const fresh = stepDone({ steps: new Map() } as unknown as RunState, plan, inp, "m");
    expect(fresh).toEqual({ done: false, hash: inputsHash({ inputs: [JSON.stringify(inp)], stageDef: "plan", templateVersion: "2", model: "m" }) });
  });
});
