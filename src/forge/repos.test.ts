import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../stages/modes.js";
import { _resetEnvCache } from "../config/env.js";
import { makeNewProduct } from "../config/greenfield.js";
import { loadProject, projectPath } from "../config/project.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { createRun } from "../stages/executor.js";
import { setUpProduct } from "../fullstack/product.js";
import { addForge, createGithubRepo, githubPreflight, pullBase } from "./repos.js";
import { fakeGithub, type FakeGithub } from "./testutil.js";

let gh: FakeGithub;
let home: string;
const env = (lines: string) => { writeFileSync(join(home, ".env"), `ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n${lines}`, { mode: 0o600 }); _resetEnvCache(); };
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "factory-gh-"));
  process.env.FACTORY_HOME = home;
  gh = await fakeGithub();
  env(`GITHUB_TOKEN=${gh.token}\nGITHUB_API_URL=${gh.url}\n`);
});
afterEach(() => gh.close());
const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const newDir = (name: string) => join(mkdtempSync(join(tmpdir(), "factory-gh-repo-")), name);

/** Someone merges a PR on GitHub: a commit on the GitHub repo's main, made from a clone (git over HTTP runs async: the fake is in this process). */
async function mergeOnGithub(repo: string, file: string): Promise<string> {
  const clone = mkdtempSync(join(tmpdir(), "factory-gh-clone-"));
  const run = promisify(execFile);
  await run("git", ["clone", "-q", `${gh.url}/git/${repo}.git`, clone]);
  writeFileSync(join(clone, file), "merged\n");
  git(clone, "add", "-A");
  git(clone, "-c", "user.name=Ann", "-c", "user.email=ann@x.test", "commit", "-q", "-m", "Merge pull request #1");
  await run("git", ["-C", clone, "push", "-q", "origin", "HEAD:main"]);
  return git(clone, "rev-parse", "HEAD");
}

describe("a new product's repo on GitHub", () => {
  it("asks GitHub before anything is made: no token, a token GitHub refuses, a name that is taken", async () => {
    expect(await githubPreflight(["shop"])).toMatchObject({ login: "acme", root: gh.url });
    env("");
    await expect(githubPreflight(["shop"])).rejects.toThrow(/add GITHUB_TOKEN to ~\/\.factory\/\.env: a token that may create repos \(fine-grained: All repositories, with Administration/);
    env(`GITHUB_TOKEN=github_pat_expired0000000000\nGITHUB_API_URL=${gh.url}\n`);
    await expect(githubPreflight(["shop"])).rejects.toThrow(/did not accept GITHUB_TOKEN \(401\): it may have expired/);
    env(`GITHUB_TOKEN=${gh.token}\nGITHUB_API_URL=${gh.url}\n`);
    const acct = await githubPreflight(["shop"]);
    const repo = newDir("shop");
    makeNewProduct("shop", repo);
    await createGithubRepo(acct, "shop", repo, "shop");
    await expect(githubPreflight(["other", "shop"])).rejects.toThrow("acme/shop already exists on GitHub. Pick another name.");
    expect(gh.made).toEqual(["acme/shop"]);
  });

  it("makes a private repo, pushes main and gives the project its forge block; the token is not written down", async () => {
    const repo = newDir("shop");
    makeNewProduct("shop", repo);
    const acct = await githubPreflight(["shop"]);
    const made = await createGithubRepo(acct, "shop", repo, "shop: the web app, built by the AI factory");
    expect(made).toEqual({ repo: "acme/shop", url: `${gh.url}/acme/shop`, cloneUrl: `${gh.url}/git/acme/shop.git` });
    expect(gh.asked).toEqual([expect.objectContaining({ name: "shop", private: true, description: "shop: the web app, built by the AI factory" })]);
    expect(gh.head("acme/shop")).toBe(git(repo, "rev-parse", "main"));
    addForge("shop", acct, made);
    expect(loadProject("shop").forge).toEqual({ kind: "github", repo: "acme/shop", tokenEnv: "GITHUB_TOKEN", apiUrl: gh.url, pushUrl: made.cloneUrl, pullBase: true });
    const yaml = readFileSync(projectPath("shop"), "utf8");
    expect(yaml).not.toContain(gh.token);
    // the config's own notes stay
    expect(yaml).toMatch(/^#/m);
  });

  it("says plainly when the token may not create repos", async () => {
    const repo = newDir("shop");
    makeNewProduct("shop", repo);
    gh.refuseCreate = 403;
    await expect(createGithubRepo(await githubPreflight(["shop"]), "shop", repo, "shop")).rejects.toThrow(/GitHub refused to create acme\/shop: GITHUB_TOKEN may not create repos/);
    expect(gh.made).toEqual([]);
  });

  it("starts each run from GitHub's main: a merged PR is pulled first; local commits GitHub lacks are refused", async () => {
    const p = setUpProduct("clinic", mkdtempSync(join(tmpdir(), "factory-gh-fs-")));
    const acct = await githubPreflight(["clinic-api"]);
    addForge(p.api.project, acct, await createGithubRepo(acct, p.api.project, p.api.repo, "clinic"));
    const cfg = loadProject(p.api.project);
    // nothing new on GitHub: nothing moves
    const before = git(p.api.repo, "rev-parse", "main");
    await pullBase(cfg);
    expect(git(p.api.repo, "rev-parse", "main")).toBe(before);
    // a PR merged on GitHub: the next run starts from it, and the repo's own folder shows it
    const merged = await mergeOnGithub("acme/clinic-api", "Merged.cs");
    const runId = await createRun("Add a patients list", p.api.project, "tester");
    expect(replay(Ledger.open(runId).events()).info.baseCommit).toBe(merged);
    expect(git(p.api.repo, "rev-parse", "main")).toBe(merged);
    expect(readFileSync(join(p.api.repo, "Merged.cs"), "utf8")).toBe("merged\n");
    // a local commit GitHub does not have, and GitHub moved on too: refused, nothing moves
    writeFileSync(join(p.api.repo, "Local.cs"), "local\n");
    git(p.api.repo, "add", "-A");
    git(p.api.repo, "-c", "user.name=Bo", "-c", "user.email=bo@x.test", "commit", "-q", "-m", "local only");
    const local = git(p.api.repo, "rev-parse", "main");
    await mergeOnGithub("acme/clinic-api", "Other.cs");
    await expect(pullBase(cfg)).rejects.toThrow(/main in .*clinic-api has commits that are not on GitHub's main \(acme\/clinic-api\)\. Push them or remove them/);
    expect(git(p.api.repo, "rev-parse", "main")).toBe(local);
  });
});
