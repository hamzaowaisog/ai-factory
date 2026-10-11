// The pass a run starts by itself once it has delivered.
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { prNumberOf, reviewDelivered } from "./once.js";

const cfg = (autoMerge: boolean, forge = true) => ProjectConfig.parse({
  project: "shop", repo: "/tmp/shop", ...(forge ? { forge: { kind: "github", repo: "acme/shop", autoMerge } } : {}),
});
const URL = "https://github.com/acme/shop/pull/7";
const passed = { conclusion: "success" as const, cls: "unchanged" as const, why: "3 gates passed", forced: false, repaired: false, merged: true };

describe("the review pass after a delivery", () => {
  it("reads the pull request number from its URL", () => {
    expect(prNumberOf(URL)).toBe(7);
    expect(prNumberOf(`${URL}/files`)).toBe(7);
    expect(prNumberOf("https://github.com/acme/shop")).toBeUndefined();
    expect(prNumberOf(undefined)).toBeUndefined();
  });

  it("runs one pass on a project that merges what passes, and says what came of it", async () => {
    const said: string[] = [];
    const asked: number[] = [];
    const r = await reviewDelivered(cfg(true), URL, (m) => said.push(m), async (_c, pr) => { asked.push(pr); return passed; });
    expect(r).toBe(passed);
    expect(asked).toEqual([7]);
    expect(said.join("\n")).toMatch(/judging pull request #7[\s\S]*success \(unchanged\), merged\n3 gates passed/);
  });

  it("leaves every other project alone: no auto-merge, no forge, a local delivery", async () => {
    const never = async () => { throw new Error("must not run"); };
    expect(await reviewDelivered(cfg(false), URL, () => undefined, never)).toBeUndefined();
    expect(await reviewDelivered(cfg(true, false), URL, () => undefined, never)).toBeUndefined();
    expect(await reviewDelivered(cfg(true), undefined, () => undefined, never)).toBeUndefined();
  });

  it("a pass that throws never fails the run that delivered", async () => {
    const said: string[] = [];
    expect(await reviewDelivered(cfg(true), URL, (m) => said.push(m), async () => { throw new Error("GITHUB_TOKEN is missing"); })).toBeUndefined();
    expect(said.join("\n")).toMatch(/the pass after delivery failed: GITHUB_TOKEN is missing/);
  });
});
