// The briefing's stable head, which a step re-sending the same input (distill's repair) may ask to cache.
import { describe, expect, it } from "vitest";
import { buildPack } from "./pack.js";
import { Redactor } from "./secrets.js";
import { S } from "../stages/think.js";

const pack = (sections: Parameters<typeof buildPack>[0]["sections"]) =>
  buildPack({ stage: "distill", cls: "read-large", model: "claude-opus-5-5", recipeVersion: "1", tools: [], redactor: new Redactor(), sections });

describe("the briefing's stable head", () => {
  it("ends where feedback, task and recap begin", () => {
    const p = pack([
      S.template("tpl", "You are the distill step."),
      S.untrusted("turns", "transcript", "T-1 [00:00:01] A: we need a ticket board"),
      S.task("Extract."),
      S.recap(["R-1: the quote is not in T-1"]),
    ]);
    expect(p.user.slice(0, p.userStable)).toContain("T-1 [00:00:01] A: we need a ticket board");
    expect(p.user.slice(0, p.userStable)).not.toContain("Extract.");
    expect(p.user.slice(p.userStable)).toContain("R-1: the quote is not in T-1");
  });
  it("a repair's recap does not change the head", () => {
    const base = [S.untrusted("turns", "transcript", "T-1 [00:00:01] A: we need a ticket board"), S.task("Extract.")];
    const first = pack(base), repair = pack([...base, S.recap(["R-1: quote again"])]);
    expect(repair.user.slice(0, repair.userStable)).toBe(first.user.slice(0, first.userStable));
  });
  it("is not part of the pack's hash", () => {
    const p = pack([S.untrusted("turns", "transcript", "T-1 [00:00:01] A: hi"), S.task("Extract.")]);
    const again = pack([S.untrusted("turns", "transcript", "T-1 [00:00:01] A: hi"), S.task("Extract.")]);
    expect(p.manifest.packSha).toBe(again.manifest.packSha);
    expect(Object.keys(p)).toContain("userStable");
  });
});
