// A full-stack product from one request: a web repo and an API repo that share one API contract. This only does the steps a
// person did by hand between two ordinary runs: make the two repos and their project configs, hand the contract the web run's
// plan wrote (and a person approved) to the API repo, and write the files that start the two delivered apps together.
// The runs themselves are a greenfield web run and a .NET run, unchanged.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { seedEmptyRepo } from "../config/greenfield.js";
import { projectPath } from "../config/project.js";
import { hardenedEnv } from "../ledger/git.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { factoryHome } from "../util/paths.js";
import { API_BUILT_DOC, API_PORT, API_SDK_IMAGE, API_SKELETON, API_SOLUTION } from "./skeleton.js";

export const CONTRACT_FILE = "contracts/openapi.yaml";

export interface Product { name: string; dir: string; web: { project: string; repo: string; run?: string }; api: { project: string; repo: string; run?: string }; request?: string }

const statePath = (name: string) => join(factoryHome(), "fullstack", `${name}.json`);
export const saveProduct = (p: Product): void => { mkdirSync(dirname(statePath(p.name)), { recursive: true }); writeFileSync(statePath(p.name), `${JSON.stringify(p, null, 2)}\n`); };
export function loadProduct(name: string): Product {
  if (!existsSync(statePath(name))) throw new Error(`No full-stack product "${name}". Start one: factory fullstack start --name ${name} --file <requirements>`);
  return JSON.parse(readFileSync(statePath(name), "utf8")) as Product;
}

const WHO = { GIT_AUTHOR_NAME: "AI Factory", GIT_AUTHOR_EMAIL: "factory@localhost", GIT_COMMITTER_NAME: "AI Factory", GIT_COMMITTER_EMAIL: "factory@localhost" };
const git = (repo: string, args: string[]): string =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-c", "commit.gpgsign=false", "-C", repo, ...args], { env: { ...hardenedEnv(), ...WHO }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Make the two repos and their project configs. Refuses to touch a folder or a project that already exists. */
export function setUpProduct(name: string, dir: string): Product {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) throw new Error(`"${name}" is not a usable name: lower-case letters, digits and dashes, starting with a letter.`);
  const p: Product = { name, dir, web: { project: `${name}-web`, repo: join(dir, `${name}-web`) }, api: { project: `${name}-api`, repo: join(dir, `${name}-api`) } };
  for (const side of [p.web, p.api]) {
    if (existsSync(side.repo) && readdirSync(side.repo).length) throw new Error(`${side.repo} already exists and is not empty.`);
    if (existsSync(projectPath(side.project))) throw new Error(`Project ${side.project} already exists (${projectPath(side.project)}).`);
  }
  if (existsSync(statePath(name))) throw new Error(`A full-stack product "${name}" already exists.`);
  // the web repo: empty, as any new product's
  mkdirSync(p.web.repo, { recursive: true });
  git(p.web.repo, ["init", "-q", "-b", "main"]);
  seedEmptyRepo(p.web.repo);
  // the API repo: the skeleton
  for (const [path, content] of Object.entries(API_SKELETON)) { mkdirSync(dirname(join(p.api.repo, path)), { recursive: true }); writeFileSync(join(p.api.repo, path), content); }
  git(p.api.repo, ["init", "-q", "-b", "main"]);
  git(p.api.repo, ["add", "-A"]);
  git(p.api.repo, ["commit", "-q", "-m", "API skeleton (factory fullstack): .NET 9, SQLite, one test"]);
  mkdirSync(dirname(projectPath(p.web.project)), { recursive: true });
  const note = (side: string) => `# Written by \`factory fullstack start\` for ${name}: the ${side} side of one product. Both sides hold the same ${CONTRACT_FILE}.\n`;
  // both sides name the same SDK image, so their coding containers are one image and the two runs can overlap
  writeFileSync(projectPath(p.web.project), note("web") + stringify({ project: p.web.project, repo: p.web.repo, baseBranch: "main", stack: "node", dotnet: { sdkImage: API_SDK_IMAGE }, contract: { file: CONTRACT_FILE, apiUrl: `http://localhost:${API_PORT}` } }));
  writeFileSync(projectPath(p.api.project), note("API") + stringify({ project: p.api.project, repo: p.api.repo, baseBranch: "main", stack: "dotnet", dotnet: { sdkImage: API_SDK_IMAGE, solution: API_SOLUTION }, contract: { file: CONTRACT_FILE, built: API_BUILT_DOC }, accept: { readyTimeoutSec: 180 } }));
  saveProduct(p);
  return p;
}

const stateOf = (runId: string) => replay(Ledger.open(runId).events());
export const delivered = (runId: string | undefined): boolean => !!runId && stateOf(runId).steps.get("deliver")?.status === "completed";

/** The contract a person approved with the web run's plan, or undefined while that plan is not approved yet. */
export function approvedContract(p: Product): string | undefined {
  if (!p.web.run) return undefined;
  const s = stateOf(p.web.run);
  if (s.steps.get("approve")?.status !== "completed") return undefined;
  const plan = Ledger.open(p.web.run).getJson<{ stubs: { path: string; content: string }[] }>(s.steps.get("plan")!.outputs[0]!);
  return plan.stubs.find((st) => st.path === CONTRACT_FILE)?.content;
}

/** Put the approved contract in the API repo's base branch, where the API run finds it locked. */
export function handOverContract(p: Product, contract: string): void {
  mkdirSync(dirname(join(p.api.repo, CONTRACT_FILE)), { recursive: true });
  writeFileSync(join(p.api.repo, CONTRACT_FILE), contract);
  git(p.api.repo, ["add", CONTRACT_FILE]);
  if (git(p.api.repo, ["status", "--porcelain"]).trim()) git(p.api.repo, ["commit", "-q", "-m", `API contract, approved with the web plan in ${p.web.run}`]);
}

/** The API run's request: the product's own words, and what this side is. */
export const apiRequest = (request: string): string =>
  `${request.trim()}\n\nThis run builds the API side of the product above, in an existing .NET API project. Build every operation of the locked API contract in ${CONTRACT_FILE}, exactly as it is written there. Keep the data in the project's local SQLite database, with a few rows of sample data so each list has something to show. The web app is built in its own repo; do not build screens here.`;

/**
 * Check out the two delivered branches side by side and write a compose file that starts them: the API (with its SQLite file)
 * on the port the web client calls, the web app on 3000. Returns the folder.
 */
export function writeRunFiles(p: Product): string {
  if (!delivered(p.web.run) || !delivered(p.api.run)) throw new Error("Both runs must be delivered first (factory fullstack next shows where each is).");
  const out = join(p.dir, `${p.name}-run`);
  for (const [side, at] of [[p.web, "web"], [p.api, "api"]] as const) {
    const wt = join(out, at);
    if (!existsSync(wt)) git(side.repo, ["worktree", "add", "-q", "--detach", wt, `factory/${side.run}`]);
  }
  writeFileSync(join(out, "docker-compose.yml"), stringify({
    services: {
      api: { image: API_SDK_IMAGE, working_dir: "/src", volumes: ["./api:/src"], environment: { DOTNET_CLI_TELEMETRY_OPTOUT: "1" }, command: `dotnet run --project ${API_SOLUTION.replace(/\.sln$/, ".Api")} --urls http://0.0.0.0:${API_PORT}`, ports: [`${API_PORT}:${API_PORT}`] },
      web: { image: "node:22-bookworm", working_dir: "/app", volumes: ["./web:/app"], environment: { NEXT_TELEMETRY_DISABLED: "1" }, command: `sh -c "npm ci --no-audit --no-fund && npm run build && npm start"`, ports: ["3000:3000"], depends_on: ["api"] },
    },
  }));
  return out;
}
