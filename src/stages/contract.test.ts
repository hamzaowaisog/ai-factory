import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts/index.js";
import { clientConfig, provedByApi, provenHere, refreshedClient, withoutMockDelay, withRefreshed } from "./contract.js";

const refreshed = (file: string, sha: string): LedgerEvent =>
  ({ seq: 1, ts: "", runId: "r", epoch: 1, type: "client.refreshed", key: "implement/TASK-3", data: { step: "implement/TASK-3", file, sha, was: "old", why: "generated again" } }) as unknown as LedgerEvent;

describe("the generated client's test handlers", () => {
  it("are generated with no wait", () => {
    expect(clientConfig("contracts/openapi.yaml", "http://localhost:5080/api")).toContain("delay: 0");
  });

  it("settings from before the wait was set get it; settings that have it are left alone", () => {
    const now = clientConfig("contracts/openapi.yaml", "http://localhost:5080/api");
    const before = now.replace(", delay: 0", "");
    expect(withoutMockDelay(before)).toBe(now);
    expect(withoutMockDelay(now)).toBeUndefined();
    expect(withoutMockDelay("module.exports = {};")).toBeUndefined();
  });

  it("a file generated again is locked at its newest content, and only if it was locked", () => {
    const lock = { tests: [], lock: [{ file: "lib/api/client.msw.ts", sha: "old" }, { file: "tests/a.test.tsx", sha: "t" }] };
    expect(withRefreshed(lock, [], "lock1")).toBe(lock);
    expect(withRefreshed(lock, [refreshed("lib/api/other.ts", "x")], "lock1")).toBe(lock);
    const events = [refreshed("lib/api/client.msw.ts", "new1"), refreshed("lib/api/client.msw.ts", "new2")];
    expect(refreshedClient(events).map((r) => r.sha)).toEqual(["new2"]);
    const out = withRefreshed(lock, events, "lock1");
    expect(out.lock).toEqual([{ file: "lib/api/client.msw.ts", sha: "new2" }, { file: "tests/a.test.tsx", sha: "t" }]);
    expect(out.unlocks).toEqual([{ what: "lib/api/client.msw.ts", human: "factory (generated again)", reason: "generated again", boundTo: "lock1" }]);
  });
});

describe("the criteria a repo proves (run 77de)", () => {
  const spec = { requirements: [
    { id: "REQ-1", acceptance: [{ id: "AC-1.1", level: "api" }, { id: "AC-1.2", level: "ui" }, { id: "AC-1.3", level: "manual" }] },
    { id: "REQ-2", acceptance: [{ id: "AC-2.1", level: "job" }] },
  ] };
  const web = { stack: "node", contract: { file: "contracts/openapi.yaml" } };
  const api = { stack: "dotnet", contract: { file: "contracts/openapi.yaml" } };

  it("the web side leaves api and job criteria to the API run, and keeps every requirement", () => {
    const here = provenHere(web, spec);
    expect(here.requirements.map((r) => r.acceptance.map((a) => a.id))).toEqual([["AC-1.2", "AC-1.3"], []]);
    expect(provedByApi(web, { level: "api" })).toBe(true);
    expect(provedByApi(web, { level: "ui" })).toBe(false);
  });

  it("the API side and a product with no contract prove every criterion", () => {
    expect(provenHere(api, spec)).toBe(spec);
    expect(provenHere({ stack: "node" }, spec)).toBe(spec);
    expect(provedByApi(api, { level: "api" })).toBe(false);
  });
});
