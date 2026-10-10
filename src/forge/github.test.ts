// The GitHub client. No network: every call takes `fetch`, and the tests script it.
import { describe, expect, it, vi } from "vitest";
import { commitStatus, factoryLogin, findReviewBody, getPr, listChecks, listOpenPrs, setCommitStatus, upsertReviewComment } from "./github.js";

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

describe("commitStatus", () => {
  it("reads the latest state of one context from the combined status", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ statuses: [{ context: "ci/x", state: "failure" }, { context: "factory/merge-gate", state: "success" }] }));
    expect(await commitStatus(gh, SHA, "factory/merge-gate", f as never)).toBe("success");
    expect(f.mock.calls[0]![0]).toBe(`${gh.api}/commits/${SHA}/status`);
  });

  it("is undefined when the commit has no status under that context, or only a pending one", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ statuses: [{ context: "ci/x", state: "success" }] }))
      .mockResolvedValueOnce(json({ statuses: [{ context: "factory/merge-gate", state: "pending" }] }));
    expect(await commitStatus(gh, SHA, "factory/merge-gate", f as never)).toBeUndefined();
    expect(await commitStatus(gh, SHA, "factory/merge-gate", f as never)).toBeUndefined();
  });

  it("reads error as failure", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ statuses: [{ context: "factory/merge-gate", state: "error" }] }));
    expect(await commitStatus(gh, SHA, "factory/merge-gate", f as never)).toBe("failure");
  });
});

describe("setCommitStatus", () => {
  const body = (f: ReturnType<typeof vi.fn>) => JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body));

  it("posts one status to the commit under the gate's context: a PAT can, a check run needs an App", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ id: 1 }));
    await setCommitStatus(gh, { context: "factory/merge-gate", sha: SHA, conclusion: "failure", description: "2 blocking" }, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(`${gh.api}/statuses/${SHA}`);
    expect(f.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(body(f)).toEqual({ state: "failure", context: "factory/merge-gate", description: "2 blocking" });
  });

  it("writes neutral as success, which is how a required check treats a neutral check run", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ id: 1 }));
    await setCommitStatus(gh, { context: "factory/merge-gate", sha: SHA, conclusion: "neutral", description: "d" }, f as never);
    expect(body(f).state).toBe("success");
  });

  it("cuts a description to GitHub's 140 characters instead of being refused", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ id: 1 }));
    await setCommitStatus(gh, { context: "factory/merge-gate", sha: SHA, conclusion: "success", description: "x".repeat(300) }, f as never);
    expect(body(f).description).toHaveLength(140);
    expect(body(f).description.endsWith("…")).toBe(true);
  });

  it("throws when GitHub refuses", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad(403));
    await expect(setCommitStatus(gh, { context: "factory/merge-gate", sha: SHA, conclusion: "success", description: "d" }, f as never))
      .rejects.toThrow(/commit status failed: 403/);
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

describe("findReviewBody: only the factory's own account counts", () => {
  it("ignores a marker written by anyone else", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([{ body: "<!-- factory-review:run-evil -->", user: { login: "mallory" } }]));
    expect(await findReviewBody(gh, 42, f as never, "factory-bot")).toBeUndefined();
  });

  it("takes the marker the factory's account wrote", async () => {
    const f = vi.fn().mockResolvedValueOnce(json([
      { body: "<!-- factory-review:run-evil -->", user: { login: "mallory" } },
      { body: "<!-- factory-review:run-7 -->", user: { login: "factory-bot" } },
    ]));
    expect(await findReviewBody(gh, 42, f as never, "factory-bot")).toMatch(/run-7/);
  });

  it("reads the token's own login", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ login: "factory-bot" }));
    expect(await factoryLogin(gh, f as never)).toBe("factory-bot");
    expect(String(f.mock.calls[0]![0])).toBe("https://api.github.com/user");
  });
});

describe("getPr", () => {
  it("names the head's repository, so a fork can be told apart", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ head: { sha: SHA, ref: "main", repo: { full_name: "someone/shop" } }, base: { ref: "main" }, state: "open", merged: false }));
    expect(await getPr(gh, 7, f as never)).toMatchObject({ headRepo: "someone/shop", headRef: "main" });
  });

  it("reads a deleted head repository as no repository", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ head: { sha: SHA, ref: "x", repo: null }, base: { ref: "main" }, state: "open", merged: false }));
    expect((await getPr(gh, 7, f as never)).headRepo).toBe("");
  });
});

describe("listOpenPrs", () => {
  it("follows the next page instead of stopping at 100", async () => {
    const page = (body: unknown, link?: string) =>
      ({ ...json(body), headers: new Headers(link ? { link } : {}) }) as Response;
    const f = vi.fn()
      .mockResolvedValueOnce(page([{ number: 2, head: { sha: "b" } }], '<https://api.github.com/repos/acme/shop/pulls?page=2>; rel="next", <x>; rel="last"'))
      .mockResolvedValueOnce(page([{ number: 1, draft: true, head: { sha: "a" } }]));
    const got = await listOpenPrs(gh, f as never);
    expect(got.map((p) => p.number)).toEqual([2, 1]);
    expect(String(f.mock.calls[1]![0])).toBe("https://api.github.com/repos/acme/shop/pulls?page=2");
  });
});
