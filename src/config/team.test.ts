import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addMember, loadRoster, readRoster, removeMember, rolesFor, rosterPath } from "./team.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-team-")); });

describe("roster", () => {
  it("keeps the shared roster and each project's roster in their own files", () => {
    expect(rosterPath()).toBe(join(process.env.FACTORY_HOME!, "team.yaml"));
    expect(rosterPath("shop")).toBe(join(process.env.FACTORY_HOME!, "projects", "shop", "team.yaml"));
  });
  it("adds and removes members; adding the same name twice updates it", () => {
    addMember({ name: "Sam Rivera" });
    addMember({ name: "Jordan Lee", aliases: ["Jordan"], note: "architect" }, "shop");
    addMember({ name: "Jordan Lee", aliases: ["Jordan", "J. Lee"] }, "shop");
    expect(readRoster("shop").members).toEqual([{ name: "Jordan Lee", aliases: ["Jordan", "J. Lee"], note: "architect" }]);
    expect(removeMember("jordan lee", "shop")).toBe(true);
    expect(removeMember("Nobody", "shop")).toBe(false);
  });
  it("merges the shared roster with the project's", () => {
    addMember({ name: "Sam Rivera" });
    addMember({ name: "Jordan Lee" }, "shop");
    const r = loadRoster("shop");
    expect(r.members.map((m) => m.name)).toEqual(["Sam Rivera", "Jordan Lee"]);
    expect(r.found).toBe(true);
    expect(loadRoster(undefined).members.map((m) => m.name)).toEqual(["Sam Rivera"]);
  });
  it("matches names and aliases ignoring case and spaces; anyone else is the client", () => {
    addMember({ name: "Jordan Lee", aliases: ["Jordan"] }, "shop");
    expect(rolesFor(["Alex Morgan", "jordan  lee", "JORDAN"], loadRoster("shop"))).toEqual([
      { name: "Alex Morgan", role: "client", source: "default" },
      { name: "jordan  lee", role: "team", source: "roster" },
      { name: "JORDAN", role: "team", source: "roster" },
    ]);
  });
  it("a role set on the intent card wins for that run", () => {
    expect(rolesFor(["A"], loadRoster(undefined), { A: "team" })).toEqual([{ name: "A", role: "team", source: "card" }]);
  });
  it("no roster at all is not an error, and says so", () => {
    expect(loadRoster("shop")).toEqual({ members: [], domains: [], found: false });
  });
});
