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
/**
 * Open pull requests, newest first, with whether each is still a draft. The factory opens a pull
 * request as a draft and marks it ready once its own review is posted, so "draft" is the difference
 * between a pull request that is still being assembled and one that is asking to be gated.
 */
export async function listOpenPrs(gh: Gh, f: typeof fetch = fetch): Promise<{ number: number; draft: boolean; headSha: string }[]> {
  const out: { number: number; draft: boolean; headSha: string }[] = [];
  // every page: past 100 open pull requests the oldest would otherwise never be gated
  let url: string | undefined = `${gh.api}/pulls?state=open&sort=created&direction=desc&per_page=100`;
  while (url) {
    const res = await f(url, { headers: gh.headers });
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers?.get?.("link") ?? "");
    const prs = (await ok(res, "open pulls")) as { number: number; draft?: boolean; head: { sha: string } }[];
    out.push(...prs.map((p) => ({ number: p.number, draft: p.draft === true, headSha: p.head.sha })));
    url = next?.[1];
  }
  return out;
}

export async function listChecks(gh: Gh, sha: string, required: string[], f: typeof fetch = fetch): Promise<ExternalChecks> {
  const runs = (await ok(await f(`${gh.api}/commits/${sha}/check-runs?per_page=100`, { headers: gh.headers }), "check-runs")) as
    { check_runs: { name: string; status: string; conclusion?: string; details_url?: string; completed_at?: string }[] };
  const statuses = (await ok(await f(`${gh.api}/commits/${sha}/status?per_page=100`, { headers: gh.headers }), "status")) as
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

/**
 * The latest state of one context on a commit, read from the combined status. `undefined` when the
 * commit has none, or only a pending one. `error` reads as failure, as a required check treats it.
 * 100 contexts are asked for: GitHub returns 30 by default, and a verdict past them would read as
 * missing and be posted again on every pass.
 */
export async function commitStatus(gh: Gh, sha: string, context: string, f: typeof fetch = fetch): Promise<"success" | "failure" | undefined> {
  const combined = (await ok(await f(`${gh.api}/commits/${sha}/status?per_page=100`, { headers: gh.headers }), "status")) as
    { statuses: { context: string; state: keyof typeof STATE_TO_STATUS }[] };
  const s = combined.statuses.find((x) => x.context === context);
  if (!s || s.state === "pending") return undefined;
  return s.state === "success" ? "success" : "failure";
}

/**
 * The verdict as a commit status. A personal access token can write one; a check run can only be
 * created by a GitHub App. Posting again does NOT replace the last status: GitHub keeps every one,
 * up to 1000 per commit and context, and refuses the next. Only the latest counts for the check.
 */
export async function setCommitStatus(
  gh: Gh,
  a: { context: string; sha: string; conclusion: "success" | "failure" | "neutral"; description: string },
  f: typeof fetch = fetch,
): Promise<void> {
  // a status has no neutral; a required check counts a neutral check run as passing, so this keeps that
  const state = a.conclusion === "failure" ? "failure" : "success";
  // GitHub refuses a description over 140 characters
  const description = a.description.length > 140 ? `${a.description.slice(0, 139)}…` : a.description;
  await ok(
    await f(`${gh.api}/statuses/${a.sha}`, { method: "POST", headers: gh.headers, body: JSON.stringify({ state, context: a.context, description }) }),
    "commit status",
  );
}

/**
 * Merge a pull request with a merge commit, and only while its head is still `sha`: the commit that was judged.
 * A squash or a rebase would land a commit nobody gated. GitHub refusing (branch protection, a head that moved,
 * a conflict, a draft) is an answer, not an error.
 */
export async function mergePullRequest(gh: Gh, a: { pr: number; sha: string }, f: typeof fetch = fetch): Promise<{ merged: boolean; why: string }> {
  const res = await f(`${gh.api}/pulls/${a.pr}/merge`, { method: "PUT", headers: gh.headers, body: JSON.stringify({ sha: a.sha, merge_method: "merge" }) });
  if (res.ok) return { merged: true, why: "merged" };
  let message = "";
  try { message = String(((await res.json()) as { message?: string }).message ?? ""); } catch { /* no body */ }
  return { merged: false, why: `GitHub answered ${res.status}${message ? `: ${message.slice(0, 200)}` : ""}` };
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
  headSha: string; headRef: string; headRepo: string; baseRef: string; state: string; merged: boolean;
}> {
  const pr = (await ok(await f(`${gh.api}/pulls/${n}`, { headers: gh.headers }), `pull ${n}`)) as
    { head: { sha: string; ref: string; repo?: { full_name: string } | null }; base: { ref: string }; state: string; merged: boolean };
  // the head's repository, "" when it was deleted: a fork's branch lives somewhere a push must never aim
  return { headSha: pr.head.sha, headRef: pr.head.ref, headRepo: pr.head.repo?.full_name ?? "", baseRef: pr.base.ref, state: pr.state, merged: pr.merged };
}

/** The account the forge token belongs to: the one that posts the factory's own reviews. */
export async function factoryLogin(gh: Gh, f: typeof fetch = fetch): Promise<string> {
  const me = (await ok(await f(`${gh.root}/user`, { headers: gh.headers }), "user")) as { login: string };
  return me.login;
}

/**
 * The factory's own review body on a pull request, for the run-id marker. With `author`, only a review
 * that account wrote counts: the marker now decides which ledger authorises a push, and anyone who can
 * comment on the pull request could otherwise write one.
 */
export async function findReviewBody(gh: Gh, n: number, f: typeof fetch = fetch, author?: string): Promise<string | undefined> {
  const reviews = (await ok(await f(`${gh.api}/pulls/${n}/reviews?per_page=100`, { headers: gh.headers }), `reviews ${n}`)) as
    { body: string; user?: { login: string } | null }[];
  return reviews
    .filter((r) => author === undefined || r.user?.login === author)
    .map((r) => r.body).find((b) => /factory-review:/.test(b ?? ""));
}
