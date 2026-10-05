// The GitHub client, lifted out of deliver.ts so both merge-gate paths can use it. Every function
// takes `fetch` so tests script it; nothing here reads the clock or retries silently.
import { secret } from "../config/env.js";
import type { ProjectConfig } from "../config/project.js";
import { type ExternalChecks, OWN_CHECK_NAME } from "../contracts/checks.js";

export interface Gh { root: string; api: string; headers: Record<string, string> }

export function githubApi(cfg: ProjectConfig): Gh {
  const forge = cfg.forge;
  if (!forge) throw new Error(`Project ${cfg.project} has no forge configured`);
  const token = secret(forge.tokenEnv);
  if (!token) throw new Error(`${forge.tokenEnv} is missing in ~/.factory/.env`);
  const root = forge.apiUrl.replace(/\/+$/, "");
  return {
    root,
    api: `${root}/repos/${forge.repo}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ai-factory",
      "Content-Type": "application/json",
    },
  };
}

async function ok(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`GitHub ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** A legacy commit status maps onto the check-run vocabulary. */
const STATE_TO_STATUS = { pending: "in_progress", success: "completed", failure: "completed", error: "completed" } as const;

/**
 * Both modern check runs and legacy commit statuses count as required checks in branch protection,
 * so both are folded into one payload — which is then recorded verbatim, because this is a third
 * party's assertion and a replay must not depend on what GitHub answers today.
 */
export async function listChecks(gh: Gh, sha: string, required: string[], f: typeof fetch = fetch): Promise<ExternalChecks> {
  const runs = (await ok(await f(`${gh.api}/commits/${sha}/check-runs?per_page=100`, { headers: gh.headers }), "check-runs")) as
    { check_runs: { name: string; status: string; conclusion?: string; details_url?: string; completed_at?: string }[] };
  const statuses = (await ok(await f(`${gh.api}/commits/${sha}/status`, { headers: gh.headers }), "status")) as
    { statuses: { context: string; state: keyof typeof STATE_TO_STATUS; target_url?: string }[] };
  return {
    headSha: sha,
    // our own check never belongs in the required set: the gate would wait on itself
    required: required.filter((n) => n !== OWN_CHECK_NAME),
    checks: [
      ...runs.check_runs.map((c) => ({
        name: c.name,
        status: c.status as ExternalChecks["checks"][number]["status"],
        conclusion: c.conclusion as ExternalChecks["checks"][number]["conclusion"],
        detailsUrl: c.details_url,
        completedAt: c.completed_at,
      })),
      ...statuses.statuses.map((s) => ({
        name: s.context,
        status: STATE_TO_STATUS[s.state] ?? ("in_progress" as const),
        // a pending status has no conclusion, and leaving it undefined is what makes the gate read it as failed
        conclusion: s.state === "success" ? ("success" as const) : s.state === "pending" ? undefined : ("failure" as const),
        detailsUrl: s.target_url,
      })),
    ],
  };
}

/** One check, updated in place: a pull request accumulating one check per webhook is unusable. */
export async function upsertCheckRun(
  gh: Gh,
  a: { name: string; headSha: string; conclusion: "success" | "failure" | "neutral"; title: string; summary: string },
  f: typeof fetch = fetch,
): Promise<"created" | "updated"> {
  const existing = (await ok(
    await f(`${gh.api}/commits/${a.headSha}/check-runs?check_name=${encodeURIComponent(a.name)}`, { headers: gh.headers }),
    "check-run lookup",
  )) as { check_runs: { id: number }[] };
  const body = JSON.stringify({
    name: a.name, head_sha: a.headSha, status: "completed", conclusion: a.conclusion,
    output: { title: a.title, summary: a.summary },
  });
  const id = existing.check_runs[0]?.id;
  await ok(
    await f(id ? `${gh.api}/check-runs/${id}` : `${gh.api}/check-runs`, { method: id ? "PATCH" : "POST", headers: gh.headers, body }),
    "check-run write",
  );
  return id ? "updated" : "created";
}

/** Update the factory's own comment, never append another. */
export async function upsertReviewComment(
  gh: Gh, prNumber: number, runId: string, body: string, f: typeof fetch = fetch,
): Promise<"created" | "updated"> {
  const marker = `<!-- factory-review:${runId} -->`;
  const comments = (await ok(
    await f(`${gh.api}/issues/${prNumber}/comments?per_page=100`, { headers: gh.headers }), "comments",
  )) as { id: number; body: string }[];
  const mine = comments.find((c) => c.body.includes(marker));
  const payload = JSON.stringify({ body: body.includes(marker) ? body : `${body}\n\n${marker}` });
  if (mine) {
    await ok(await f(`${gh.api}/issues/comments/${mine.id}`, { method: "PATCH", headers: gh.headers, body: payload }), "comment update");
    return "updated";
  }
  await ok(await f(`${gh.api}/issues/${prNumber}/comments`, { method: "POST", headers: gh.headers, body: payload }), "comment create");
  return "created";
}

export async function getPr(gh: Gh, n: number, f: typeof fetch = fetch): Promise<{
  headSha: string; headRef: string; baseRef: string; state: string; merged: boolean;
}> {
  const pr = (await ok(await f(`${gh.api}/pulls/${n}`, { headers: gh.headers }), `pull ${n}`)) as
    { head: { sha: string; ref: string }; base: { ref: string }; state: string; merged: boolean };
  return { headSha: pr.head.sha, headRef: pr.head.ref, baseRef: pr.base.ref, state: pr.state, merged: pr.merged };
}

/** The factory's own review body on a pull request, for the run-id marker. */
export async function findReviewBody(gh: Gh, n: number, f: typeof fetch = fetch): Promise<string | undefined> {
  const reviews = (await ok(await f(`${gh.api}/pulls/${n}/reviews?per_page=100`, { headers: gh.headers }), `reviews ${n}`)) as
    { body: string }[];
  return reviews.map((r) => r.body).find((b) => /factory-review:/.test(b ?? ""));
}
