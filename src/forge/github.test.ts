// The GitHub client. No network: every call takes `fetch`, and the tests script it.
import { describe, expect, it, vi } from "vitest";
import { findReviewBody, listChecks, upsertCheckRun, upsertReviewComment } from "./github.js";

const gh = { root: "https://api.github.com", api: "https://api.github.com/repos/acme/shop", headers: {} };
const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const bad = (status: number) =>
  ({ ok: false, status, json: async () => ({}), text: async () => "nope" }) as Response;
const SHA = "a".repeat(40);

describe("listChecks", () => {
  it("folds check runs and legacy commit statuses into one payload", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ check_runs: [{ name: "ci/build", status: "completed", conclusion: "success", details_url: "u", completed_at: "t" }] }))
      .mockResolvedValueOnce(json({ statuses: [{ context: "legacy/lint", state: "success", target_url: "v" }] }));
    const got = await listChecks(gh, SHA, ["ci/build", "legacy/lint"], f as never);
    expect(got.headSha).toBe(SHA);
    expect(got.checks.map((c) => c.name).sort()).toEqual(["ci/build", "legacy/lint"]);
    expect(got.checks.find((c) => c.name === "legacy/lint")).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("maps a pending commit status to in_progress with no conclusion, not to success", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ check_runs: [] }))
      .mockResolvedValueOnce(json({ statuses: [{ context: "legacy/lint", state: "pending" }] }));
    const got = await listChecks(gh, SHA, ["legacy/lint"], f as never);
    expect(got.checks[0]).toMatchObject({ status: "in_progress" });
    expect(got.checks[0]!.conclusion).toBeUndefined();
  });

  it("maps an errored status to a failure", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ check_runs: [] }))
      .mockResolvedValueOnce(json({ statuses: [{ context: "legacy/lint", state: "error" }] }));
    expect((await listChecks(gh, SHA, ["legacy/lint"], f as never)).checks[0]).toMatchObject({ conclusion: "failure" });
  });

  it("drops the factory's own check from the required set, so the gate cannot wait on itself", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ check_runs: [] }))
      .mockResolvedValueOnce(json({ statuses: [] }));
    const got = await listChecks(gh, SHA, ["ci/build", "factory/merge-gate"], f as never);
    expect(got.required).toEqual(["ci/build"]);
  });

  it("throws with the status code when GitHub refuses", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad(403));
    await expect(listChecks(gh, SHA, [], f as never)).rejects.toThrow(/403/);
  });
});

describe("upsertCheckRun", () => {
  it("patches the existing check rather than adding another", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ check_runs: [{ id: 5 }] })).mockResolvedValueOnce(json({ id: 5 }));
    expect(await upsertCheckRun(gh, { name: "factory/merge-gate", headSha: SHA, conclusion: "success", title: "t", summary: "s" }, f as never))
      .toBe("updated");
    expect(f.mock.calls[1]![0]).toMatch(/check-runs\/5$/);
    expect(f.mock.calls[1]![1]).toMatchObject({ method: "PATCH" });
  });

  it("creates one when none exists", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ check_runs: [] })).mockResolvedValueOnce(json({ id: 9 }));
    expect(await upsertCheckRun(gh, { name: "factory/merge-gate", headSha: SHA, conclusion: "failure", title: "t", summary: "s" }, f as never))
      .toBe("created");
    expect(f.mock.calls[1]![1]).toMatchObject({ method: "POST" });
  });

  it("cites the commit it judged", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ check_runs: [] })).mockResolvedValueOnce(json({ id: 9 }));
    await upsertCheckRun(gh, { name: "factory/merge-gate", headSha: SHA, conclusion: "neutral", title: "t", summary: "s" }, f as never);
    expect(JSON.parse(String((f.mock.calls[1]![1] as RequestInit).body))).toMatchObject({ head_sha: SHA, conclusion: "neutral" });
  });
});

describe("upsertReviewComment", () => {
  it("patches the existing factory comment instead of appending another", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([{ id: 7, body: "old\n<!-- factory-review:run-1 -->" }]))
      .mockResolvedValueOnce(json({ id: 7 }));
    expect(await upsertReviewComment(gh, 42, "run-1", "new body", f as never)).toBe("updated");
    expect(f.mock.calls[1]![0]).toMatch(/comments\/7$/);
    expect(f.mock.calls[1]![1]).toMatchObject({ method: "PATCH" });
  });

  it("creates one when no marker is present", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ id: 9 }));
    expect(await upsertReviewComment(gh, 42, "run-1", "body", f as never)).toBe("created");
    expect(f.mock.calls[1]![1]).toMatchObject({ method: "POST" });
  });

  it("matches on this run's marker, not on any factory comment", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ id: 7, body: "<!-- factory-review:other-run -->" }])).mockResolvedValueOnce(json({ id: 9 }));
    expect(await upsertReviewComment(gh, 42, "run-1", "body", f as never)).toBe("created");
  });

  it("adds the marker when the body does not carry one", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ id: 9 }));
    await upsertReviewComment(gh, 42, "run-1", "plain body", f as never);
    expect(JSON.parse(String((f.mock.calls[1]![1] as RequestInit).body)).body).toMatch(/<!-- factory-review:run-1 -->$/);
  });

  it("does not add a second marker when the body already has one", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ id: 9 }));
    await upsertReviewComment(gh, 42, "run-1", "body\n<!-- factory-review:run-1 -->", f as never);
    const sent = JSON.parse(String((f.mock.calls[1]![1] as RequestInit).body)).body as string;
    expect(sent.match(/factory-review:run-1/g)).toHaveLength(1);
  });
});

describe("findReviewBody", () => {
  it("returns the factory's review body, which carries the run id", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: "someone else" }, { body: "ours\n<!-- factory-review:run-7 -->" }]));
    expect(await findReviewBody(gh, 42, f as never)).toMatch(/factory-review:run-7/);
  });

  it("returns undefined when no factory review exists", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: "looks good to me" }]));
    expect(await findReviewBody(gh, 42, f as never)).toBeUndefined();
  });

  it("survives a review with no body at all", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: null }]));
    expect(await findReviewBody(gh, 42, f as never)).toBeUndefined();
  });
});
