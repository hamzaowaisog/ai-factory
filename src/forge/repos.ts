// A new product on GitHub: a private repo for each of its repos, made under the account of the factory's token, with main pushed
// and a forge block in the project config, so each run pushes its own branch and opens a PR into main as any GitHub project does.
// The token is read from ~/.factory/.env and goes to git through its environment, never the command line (as deliver does).
import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { secret } from "../config/env.js";
import { projectPath, type ProjectConfig } from "../config/project.js";
import { git, GitError, gitOut, resolveRef } from "../ledger/git.js";

export const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
const GITHUB_API = "https://api.github.com";

/** GitHub's API: github.com unless ~/.factory/.env names another in GITHUB_API_URL (GitHub Enterprise, or a local fake in tests). */
const apiRoot = (): string => (secret("GITHUB_API_URL") ?? GITHUB_API).replace(/\/+$/, "");

export const githubConfigured = (): boolean => !!secret(GITHUB_TOKEN_ENV);

export const NO_GITHUB_TOKEN = `To put a new product on GitHub, add ${GITHUB_TOKEN_ENV} to ~/.factory/.env: a token that may create repos (fine-grained: ` +
  `All repositories, with Administration, Contents and Pull requests set to Read and write; or a classic token with the repo scope).`;

export interface GithubAccount { login: string; root: string; headers: Record<string, string>; token: string }
export interface MadeRepo { repo: string; url: string; cloneUrl: string }

/** git's environment for one call that talks to GitHub: the token as an auth header. */
export const authEnv = (token: string): Record<string, string> => ({
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
});

const hide = (e: unknown, token: string): Error => new Error((e as Error).message.replaceAll(token, "«SECRET»"));

/**
 * The token's account, and that none of `names` is taken there. Reads only: nothing is made, so it runs before anything else.
 * Throws in plain words when there is no token, GitHub refuses it, or a name is taken.
 */
export async function githubPreflight(names: string[], f: typeof fetch = fetch): Promise<GithubAccount> {
  const token = secret(GITHUB_TOKEN_ENV);
  if (!token) throw new Error(NO_GITHUB_TOKEN);
  const root = apiRoot();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ai-factory", "Content-Type": "application/json" };
  try {
    const me = await f(`${root}/user`, { headers });
    if (!me.ok) throw new Error(`GitHub did not accept ${GITHUB_TOKEN_ENV} (${me.status}): it may have expired. Put a new token in ~/.factory/.env.`);
    const { login } = (await me.json()) as { login: string };
    for (const name of names) {
      const r = await f(`${root}/repos/${login}/${name}`, { headers });
      if (r.ok) throw new Error(`${login}/${name} already exists on GitHub. Pick another name.`);
      if (r.status !== 404) throw new Error(`GitHub could not say whether ${login}/${name} exists: ${r.status}.`);
    }
    return { login, root, headers, token };
  } catch (e) { throw hide(e, token); }
}

/** A private repo under the token's account, with the local repo's main pushed to it (so main is its default branch and PRs go into it). */
export async function createGithubRepo(acct: GithubAccount, name: string, localRepo: string, description: string, f: typeof fetch = fetch): Promise<MadeRepo> {
  const res = await f(`${acct.root}/user/repos`, { method: "POST", headers: acct.headers, body: JSON.stringify({ name, description, private: true, auto_init: false, has_wiki: false }) });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200).replaceAll(acct.token, "«SECRET»");
    throw new Error(res.status === 403
      ? `GitHub refused to create ${acct.login}/${name}: ${GITHUB_TOKEN_ENV} may not create repos. ${NO_GITHUB_TOKEN}`
      : `GitHub could not create ${acct.login}/${name}: ${res.status} ${text}`);
  }
  const made = (await res.json()) as { full_name: string; html_url: string; clone_url: string };
  try { await pushBranch(localRepo, made.clone_url, acct.token, "main"); } catch (e) { throw new Error(`${made.full_name} was made on GitHub, but main could not be pushed to it: ${(e as Error).message}`); }
  return { repo: made.full_name, url: made.html_url, cloneUrl: made.clone_url };
}

/** Push one local branch to the same branch on GitHub. */
export async function pushBranch(repo: string, url: string, token: string, branch: string): Promise<void> {
  try { await git(repo, ["push", "-q", url, `refs/heads/${branch}:refs/heads/${branch}`], { env: authEnv(token) }); } catch (e) { throw hide(e, token); }
}

/**
 * Give a project the forge block of the repo the factory made for it, keeping the file's comments. `pullBase`: GitHub's main is
 * where each run starts (see `pullBase`), and a pull request that passes the merge gate is merged into it (`autoMerge`). The API and push URLs are written only when they are not github.com's.
 */
export function addForge(project: string, acct: GithubAccount, made: MadeRepo): void {
  const file = projectPath(project);
  const doc = parseDocument(readFileSync(file, "utf8"));
  doc.set("forge", {
    kind: "github", repo: made.repo,
    ...(acct.root !== GITHUB_API ? { apiUrl: acct.root } : {}),
    ...(made.cloneUrl !== `https://github.com/${made.repo}.git` ? { pushUrl: made.cloneUrl } : {}),
    pullBase: true,
    autoMerge: true,
  });
  writeFileSync(file, doc.toString());
}

const isAncestor = async (repo: string, a: string, b: string): Promise<boolean> => {
  try { await git(repo, ["merge-base", "--is-ancestor", a, b]); return true; } catch (e) { if (e instanceof GitError && e.code === 1) return false; throw e; }
};

/**
 * Before a run on a project with `forge.pullBase`: bring the local base branch up to GitHub's, so a request made after a PR was
 * merged starts from what was merged. Only a fast-forward: a local base branch with commits GitHub does not have is refused.
 */
export async function pullBase(cfg: ProjectConfig): Promise<void> {
  const forge = cfg.forge!;
  const token = secret(forge.tokenEnv);
  if (!token) throw new Error(`${forge.tokenEnv} is missing in ~/.factory/.env, so ${cfg.baseBranch} cannot be brought up to GitHub's (${forge.repo}).`);
  const base = cfg.baseBranch;
  try { await git(cfg.repo, ["fetch", "-q", forge.pushUrl ?? `https://github.com/${forge.repo}.git`, `refs/heads/${base}`], { env: authEnv(token) }); } catch (e) { throw hide(e, token); }
  const local = await resolveRef(cfg.repo, base), remote = await resolveRef(cfg.repo, "FETCH_HEAD");
  if (local === remote || await isAncestor(cfg.repo, remote, local)) return;
  if (!await isAncestor(cfg.repo, local, remote)) throw new Error(`${base} in ${cfg.repo} has commits that are not on GitHub's ${base} (${forge.repo}). Push them or remove them, then start again.`);
  // the base branch is usually the one checked out in the repo's own folder: move it with its files, else move only the branch
  const current = await gitOut(cfg.repo, ["symbolic-ref", "-q", "--short", "HEAD"]).catch(() => "");
  try {
    if (current === base) await git(cfg.repo, ["merge", "-q", "--ff-only", remote]);
    else await git(cfg.repo, ["update-ref", `refs/heads/${base}`, remote, local]);
  } catch (e) { throw new Error(`${base} in ${cfg.repo} could not be brought up to GitHub's (${forge.repo}): ${(e as Error).message}`); }
}
