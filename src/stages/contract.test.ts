import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../contracts/index.js";
import { clientConfig, refreshedClient, withoutMockDelay, withRefreshed } from "./contract.js";

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
