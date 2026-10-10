// Hardened host git (run-manager §2.10): no hooks, no fsmonitor, no user/system config,
// so no filter drivers (LFS etc.) and no repo code ever runs on the host.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { matchesAny } from "../util/glob.js";

const exec = promisify(execFile);

const HARDENING = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "protocol.file.allow=never",
  "-c", "commit.gpgSign=false",
];

const IDENTITY = { name: "AI Factory", email: "factory@localhost" };

export interface GitResult { stdout: string; stderr: string }

export class GitError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly code: number | undefined) {
    super(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

export function hardenedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    ...extra,
  };
  return env;
}

export async function git(cwd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<GitResult> {
  const full = [...HARDENING, ...args];
  try {
    const { stdout, stderr } = await exec("git", full, {
      cwd, env: hardenedEnv(opts.env), maxBuffer: 256 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (e) {
    const err = e as { stderr?: string; code?: number };
    throw new GitError(args, err.stderr ?? String(e), err.code);
  }
}

export async function gitOut(cwd: string, args: string[]): Promise<string> {
  return (await git(cwd, args)).stdout.trim();
}

export async function headSha(cwd: string): Promise<string> {
  return gitOut(cwd, ["rev-parse", "HEAD"]);
}

export async function resolveRef(cwd: string, ref: string): Promise<string> {
  return gitOut(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

/** Refusals checked before a repo is used (run-manager §2.10). */
export async function repoRefusals(repo: string): Promise<{ code: string; reason: string }[]> {
  const out: { code: string; reason: string }[] = [];
  if (existsSync(join(repo, ".gitmodules"))) out.push({ code: "submodules", reason: "Repos with submodules aren't supported yet." });
  const attrs = await git(repo, ["ls-files", "-z", "--", ".gitattributes", "**/.gitattributes"]).catch(() => ({ stdout: "" }));
  if (attrs.stdout) {
    const lfs = await git(repo, ["grep", "-l", "filter=lfs", "HEAD", "--", ".gitattributes", "**/.gitattributes"]).catch(() => ({ stdout: "" }));
    if (lfs.stdout.trim()) out.push({ code: "lfs", reason: "Repos using Git LFS aren't supported yet." });
  }
  return out;
}

/** Create the run's worktree on a new branch and lock it (run-manager §2.10). */
export async function addWorktree(repo: string, wtPath: string, branch: string, base: string, runId: string): Promise<void> {
  mkdirSync(join(wtPath, ".."), { recursive: true });
  await git(repo, ["worktree", "add", "-b", branch, wtPath, base]);
  await git(repo, ["worktree", "lock", "--reason", `factory run ${runId}`, wtPath]);
}

export async function removeWorktree(repo: string, wtPath: string): Promise<void> {
  await git(repo, ["worktree", "unlock", wtPath]).catch(() => undefined);
  await git(repo, ["worktree", "remove", "--force", wtPath]);
}

/**
 * Like `addWorktree`, but survives a path that is already there. `worktree add -b` fails when
 * either the path or the branch exists, and `removeWorktree` deliberately leaves the branch behind,
 * so building the same worktree twice used to throw — which is what happened on every second
 * reverify of a pull request, and on the verification that should have followed a repair.
 */
export async function freshWorktree(repo: string, wtPath: string, branch: string, base: string, runId: string): Promise<void> {
  if (existsSync(wtPath)) await removeWorktree(repo, wtPath).catch(() => undefined);
  // the administrative record outlives the directory; without this git still calls the path in use
  await git(repo, ["worktree", "prune"]).catch(() => undefined);
  await git(repo, ["branch", "-D", branch]).catch(() => undefined);
  await addWorktree(repo, wtPath, branch, base, runId);
}

/**
 * Update the remote-tracking refs the merge gate reads. Nothing else fetches, and the gate derives
 * the base SHA from `origin/<base>` in this clone: without a fetch, a base that moved on the forge
 * still reads as unchanged here, and the gate replays a green verdict for a tree that no longer
 * exists. The head is fetched too, because `commitsSince` walks it locally.
 *
 * The base must be reachable afterwards, so a failure there is fatal. A head branch can legitimately
 * be gone (deleted after a merge), and the caller handles the pull request's state itself. A fork's
 * head is not on this remote at all, so the caller passes no `headRef` for one: fetching the base
 * repository's branch of the same name would walk the wrong commits.
 *
 * `remote` is the forge's URL and token, the same ones the repair push uses. Hardened git reads no
 * credential helper, so without them a private HTTPS repository refuses the fetch, and `origin` is
 * not necessarily the forge repository anyway.
 */
export async function fetchForGate(repo: string, baseRef: string, headRef?: string, remote?: { url: string; token?: string }): Promise<void> {
  const spec = (r: string) => `+refs/heads/${r}:refs/remotes/origin/${r}`;
  const from = remote?.url ?? "origin";
  const env = remote?.token ? authEnv(remote.token) : undefined;
  const run = (r: string) => git(repo, ["fetch", "--quiet", from, spec(r)], { env }).catch((e: Error) => {
    throw remote?.token ? new Error(e.message.replaceAll(remote.token, "«SECRET»")) : e;
  });
  await run(baseRef);
  if (headRef) await run(headRef).catch(() => undefined);
}

/**
 * The forge token as git configuration in the environment, never on a command line: a failed fetch
 * or push prints its command into the error, and from there into the ledger.
 */
export function authEnv(token: string): Record<string, string> {
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}` };
}

/** Stage everything and commit (even when empty, so every attempt has a tree SHA). */
export async function commitAll(wt: string, message: string): Promise<string> {
  await git(wt, ["add", "-A"]);
  await git(wt, ["commit", "--no-verify", "--allow-empty", "-m", message]);
  return headSha(wt);
}

/**
 * Keep files the build writes out of every commit and diff of this repo's worktrees, whatever its own ignore rules say
 * (in .git/info/exclude, which is never committed). The API document a build writes was committed with a task and failed
 * its file scope three times, because the repo's rule `openapi/*.json` only matches at the repo's root (run e1b5).
 */
export async function excludeLocally(wt: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const { stdout } = await git(wt, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  const file = stdout.trim();
  const have = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = files.map((f) => `/${f}`).filter((l) => !have.split("\n").includes(l));
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${have}${have && !have.endsWith("\n") ? "\n" : ""}${lines.join("\n")}\n`);
}

/**
 * Files in `scope` that exist but an ignore rule hides, made visible to `git add -A`, diffs and `git clean -X`.
 * A plan can name a source file an ignore rule matches: on a Mac `openapi/` (the built API document's folder)
 * also matches `OpenApi/`, so the file was left out of every commit and the lab built without it (run 31fe).
 */
export async function trackIgnored(wt: string, scope: string[], except: string[] = []): Promise<string[]> {
  const under = [...new Set(scope.map((g) => {
    const cut = g.search(/[*?[{]/);
    return cut < 0 ? g : g.slice(0, g.lastIndexOf("/", cut) + 1) || ".";
  }))];
  if (!under.length) return [];
  const { stdout } = await git(wt, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...under.map((u) => (u === "." ? u : `:(icase)${u}`))]).catch(() => ({ stdout: "" }));
  // compared without case, and added under the plan's spelling: the folder on disk may carry the ignore rule's
  const lower = except.map((e) => e.toLowerCase());
  const globs = scope.map((g) => g.toLowerCase());
  const files = stdout.split("\0")
    .filter((f) => f && matchesAny(f.toLowerCase(), globs) && !lower.includes(f.toLowerCase()))
    .map((f) => scope.find((g) => g.toLowerCase() === f.toLowerCase()) ?? f);
  if (files.length) await git(wt, ["add", "-f", "--intent-to-add", "--", ...files]);
  return files;
}

/** `keep`: untracked paths the clean leaves alone (a Node checkout's node_modules, so a retry doesn't install again). */
export async function resetHard(wt: string, sha: string, keep: string[] = []): Promise<void> {
  await git(wt, ["reset", "--hard", sha]);
  await git(wt, ["clean", "-fdx", ...keep.flatMap((k) => ["-e", k])]);
}

/** Diff from `from` to the working tree, untracked files included (run-manager §2.5). */
export async function diffIncludingUntracked(wt: string, from: string): Promise<string> {
  await git(wt, ["add", "-A", "--intent-to-add"]);
  const { stdout } = await git(wt, ["diff", "--binary", from]);
  return stdout;
}

export async function changedFiles(wt: string, from: string, to = "HEAD"): Promise<{ status: string; path: string }[]> {
  const out = await gitOut(wt, ["diff", "--name-status", "--no-renames", from, to]);
  if (!out) return [];
  return out.split("\n").map((l) => {
    const [status, ...rest] = l.split("\t");
    return { status: status!, path: rest.join("\t") };
  });
}

export async function treeSha(wt: string, commit = "HEAD"): Promise<string> {
  return gitOut(wt, ["rev-parse", `${commit}^{tree}`]);
}
