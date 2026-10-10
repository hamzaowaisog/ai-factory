// A full-stack product from one request: a web repo and an API repo that share one API contract. This only does the steps a
// person did by hand between two ordinary runs: make the two repos and their project configs, hand the contract the web run's
// plan wrote (and a person approved) to the API repo, and write the files that start the two delivered apps together.
// The runs themselves are a greenfield web run and a .NET run, unchanged.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { newProductRefusal, PRODUCT_NAME, seedEmptyRepo, type EstimateScope } from "../config/greenfield.js";
import { loadProject, projectPath, type ProjectConfig } from "../config/project.js";
import { secret } from "../config/env.js";
import { addForge, createGithubRepo, githubPreflight, pushBranch, type GithubAccount } from "../forge/repos.js";
import { hardenedEnv } from "../ledger/git.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { approvedDesign, approvedEstimate, type Approved, type ApprovedDesign } from "../estimate/lineage.js";
import type { RequestSource } from "../sources/request.js";
import { createRun } from "../stages/executor.js";
import { checkRoutes, type Choice } from "../stages/routing.js";
import { factoryHome } from "../util/paths.js";
import { newProductDatabase, type DatabaseChoice, type DatabaseKind } from "./database.js";
import { API_BUILT_DOC, API_PORT, API_SDK_IMAGE, API_SKELETON, API_SOLUTION, POSTGRES_IMAGE, POSTGRES_LOCAL, postgresConnection, SEED_FILE, SEED_SETTING } from "./skeleton.js";

export const CONTRACT_FILE = "contracts/openapi.yaml";

/**
 * `from`: the approved design (its design steps are skipped) or approved estimate (the web run is held to it) the product started from.
 * A side's `github`: the GitHub repo the factory made for it (its page), when the product was put on GitHub.
 * `database`: what the API keeps its data in (src/fullstack/database.ts): PostgreSQL. A product from before that was settled has none and is on SQLite.
 * `models`: the models chosen when the product was started (like --preset and --model); the API run uses the same choice, so it is asked once.
 */
export interface ProductSide { project: string; repo: string; run?: string; github?: string }
export interface Product { name: string; dir: string; web: ProductSide; api: ProductSide; request?: string; from?: { kind: "design" | "estimate"; runId: string }; database?: DatabaseChoice; models?: Choice }

/** What a product may start from besides a request: an approved design or an approved estimate, each made with no repo. */
export type ProductSeed = { design: ApprovedDesign } | { estimate: Approved };

/**
 * The approved design or estimate a new product starts from, read and checked before anything is made: made with no repo (a new
 * product), approved by a person (an estimate a build is held to), and nothing the product would not build (a phone app). Throws in plain words.
 */
export function productSeed(from: { design?: string; estimate?: string }): ProductSeed | undefined {
  if (from.design && from.estimate) throw new Error("Start from one thing at a time: an approved design or an approved estimate (an estimate brings its own design).");
  if (from.design) {
    const design = approvedDesign(from.design);
    if (design.repo) throw new Error(`${design.runId} was designed against an existing repo, so it is built into that project, not as a new product. A new product starts from a design made with no repo.`);
    return { design };
  }
  if (from.estimate) {
    const estimate = approvedEstimate(from.estimate, { build: true });
    if (!estimate.settings.noRepo) throw new Error(`${estimate.runId} estimated a change to an existing repo, so it is built into that repo, not as a new product. A new product starts from an estimate made with no repo.`);
    const why = newProductRefusal(estimate.runId, { ...(estimate.artifacts[estimate.breakdownSha] as EstimateScope | undefined), stack: (estimate.artifacts[estimate.estimateSha] as EstimateScope | undefined)?.stack }, true);
    if (why) throw new Error(why);
    return { estimate };
  }
  return undefined;
}

const statePath = (name: string) => join(factoryHome(), "fullstack", `${name}.json`);
export const saveProduct = (p: Product): void => { mkdirSync(dirname(statePath(p.name)), { recursive: true }); writeFileSync(statePath(p.name), `${JSON.stringify(p, null, 2)}\n`); };
export function loadProduct(name: string): Product {
  if (!existsSync(statePath(name))) throw new Error(`No full-stack product "${name}". Start one: factory fullstack start --name ${name} --file <requirements>`);
  return JSON.parse(readFileSync(statePath(name), "utf8")) as Product;
}

const WHO = { GIT_AUTHOR_NAME: "AI Factory", GIT_AUTHOR_EMAIL: "factory@localhost", GIT_COMMITTER_NAME: "AI Factory", GIT_COMMITTER_EMAIL: "factory@localhost" };
const git = (repo: string, args: string[]): string =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-c", "commit.gpgsign=false", "-C", repo, ...args], { env: { ...hardenedEnv(), ...WHO }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export const databaseOf = (p: Product): DatabaseKind => p.database?.kind ?? "sqlite";

/** The API project's `database` block: the lab starts this image beside the tests and the booted app, and hands them the connection the skeleton reads. */
const LAB_DATABASE = { image: POSTGRES_IMAGE, producerEnv: { ConnectionStrings__App: "Host={{DB_HOST}};Port={{DB_PORT}};Database={{DB_NAME}};Username={{DB_USER}};Password={{DB_PASSWORD}}" } };

/** Make the two repos and their project configs. Refuses to touch a folder or a project that already exists. */
export function setUpProduct(name: string, dir: string, request = ""): Product {
  if (!PRODUCT_NAME.test(name)) throw new Error(`"${name}" is not a usable name: lower-case letters, digits and dashes, starting with a letter.`);
  const p: Product = { name, dir, web: { project: `${name}-web`, repo: join(dir, `${name}-web`) }, api: { project: `${name}-api`, repo: join(dir, `${name}-api`) }, database: newProductDatabase(request) };
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
  git(p.api.repo, ["commit", "-q", "-m", "API skeleton (factory fullstack): .NET 9, PostgreSQL, one test"]);
  mkdirSync(dirname(projectPath(p.web.project)), { recursive: true });
  const note = (side: string) => `# Written by \`factory fullstack start\` for ${name}: the ${side} side of one product. Both sides hold the same ${CONTRACT_FILE}.\n`;
  // both sides name the same SDK image, so their coding containers are one image and the two runs can overlap
  writeFileSync(projectPath(p.web.project), note("web") + stringify({ project: p.web.project, repo: p.web.repo, baseBranch: "main", stack: "node", dotnet: { sdkImage: API_SDK_IMAGE }, contract: { file: CONTRACT_FILE, apiUrl: `http://localhost:${API_PORT}` } }));
  writeFileSync(projectPath(p.api.project), note("API") + stringify({ project: p.api.project, repo: p.api.repo, baseBranch: "main", stack: "dotnet", dotnet: { sdkImage: API_SDK_IMAGE, solution: API_SOLUTION }, contract: { file: CONTRACT_FILE, built: API_BUILT_DOC }, accept: { readyTimeoutSec: 180 }, database: LAB_DATABASE }));
  saveProduct(p);
  return p;
}

/** Undo `setUpProduct`: its two repo folders (empty or missing before it ran), their project configs and the product's state. */
function undoSetUp(p: Product): void {
  for (const side of [p.web, p.api]) {
    rmSync(side.repo, { recursive: true, force: true });
    rmSync(projectPath(side.project), { force: true });
  }
  rmSync(statePath(p.name), { force: true });
}

/**
 * Both repos on GitHub: private, under the token's account, named as the projects (`<name>-web`, `<name>-api`), main pushed, and each
 * project given its forge block, so each run pushes its branch and opens a PR into main. When GitHub fails, nothing is kept on this
 * machine and the error names any repo already made there.
 */
async function putOnGithub(p: Product, acct: GithubAccount): Promise<void> {
  const made: string[] = [];
  try {
    for (const [side, what] of [[p.web, "web app"], [p.api, "API"]] as const) {
      const r = await createGithubRepo(acct, side.project, side.repo, `${p.name}: the ${what}, built by the AI factory`);
      made.push(r.repo);
      addForge(side.project, acct, r);
      side.github = r.url;
    }
  } catch (e) {
    undoSetUp(p);
    const also = made.length ? ` ${made.join(" and ")} ${made.length > 1 ? "were" : "was"} made on GitHub already: delete ${made.length > 1 ? "them" : "it"} there before using this name again.` : "";
    throw new Error(`${(e as Error).message}${also} Nothing was kept on this machine.`);
  }
  saveProduct(p);
}

/**
 * `factory fullstack start` after the checks: make the two repos and start the web run (greenfield). Returns the product with its run.
 * From an approved design, the web run builds that design (its design steps are skipped); from an approved estimate, it follows the
 * estimate's spec and design and is held to it (gates B1-B6). Either brings its own request. With neither, the run draws its own design
 * and nothing is estimated. `github`: put both repos on GitHub first (`putOnGithub`); GitHub is asked before anything is made.
 * `models`: the models for both runs, checked before anything is made and kept with the product for the API run.
 */
export async function startProduct(name: string, dir: string, request: { text: string; sources?: RequestSource[] } | undefined, operator: string, maxCostUsd?: number, seed?: ProductSeed, github = false, models: Choice = {}): Promise<Product> {
  const from = seed && ("design" in seed ? seed.design : seed.estimate);
  const text = from?.request ?? request?.text;
  if (!text) throw new Error("Describe the product, or start it from an approved design or estimate.");
  const chosen = !!(models.preset || Object.keys(models.picks ?? {}).length);
  // a new product's projects set no models of their own, so the choice is judged on its own before a repo exists
  const problems = chosen ? checkRoutes({ steps: {} } as unknown as ProjectConfig, undefined, models) : [];
  if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
  const acct = github ? await githubPreflight([`${name}-web`, `${name}-api`]) : undefined;
  const p = setUpProduct(name, dir, text);
  if (acct) await putOnGithub(p, acct);
  p.request = text;
  if (seed) p.from = { kind: "design" in seed ? "design" : "estimate", runId: from!.runId };
  if (chosen) p.models = models;
  p.web.run = await createRun(text, p.web.project, operator, {
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    ...(chosen ? { models } : {}),
    ...(from ? { sources: [{ kind: "prompt" as const }] } : request?.sources ? { sources: request.sources } : {}),
    ...(seed ? { mode: "greenfield" as const, ...("design" in seed ? { fromDesign: seed.design } : { lineage: { kind: "build" as const, approved: seed.estimate } }) } : {}),
  });
  saveProduct(p);
  return p;
}

/**
 * `factory fullstack next` once the web plan is approved: hand the contract to the API repo and start the API run. Undefined while the
 * web plan is not approved; an error when the API run is already started.
 */
export async function startApiRun(p: Product, operator: string, maxCostUsd?: number): Promise<string | undefined> {
  if (p.api.run) throw new Error(`The API run of ${p.name} is started already: ${p.api.run}.`);
  const contract = approvedContract(p);
  if (!contract) return undefined;
  handOverContract(p, contract);
  // a product on GitHub: the contract goes to GitHub's main too, so the API run starts from it there and its PR holds only the API's work
  const forge = loadProject(p.api.project).forge;
  if (forge?.pullBase) {
    const token = secret(forge.tokenEnv);
    if (!token) throw new Error(`${forge.tokenEnv} is missing in ~/.factory/.env, so the contract cannot be pushed to ${forge.repo}.`);
    await pushBranch(p.api.repo, forge.pushUrl ?? `https://github.com/${forge.repo}.git`, token, "main");
  }
  p.api.run = await createRun(apiRequest(p.request ?? "", databaseOf(p)), p.api.project, operator, { ...(maxCostUsd !== undefined ? { maxCostUsd } : {}), ...(p.models ? { models: p.models } : {}) });
  saveProduct(p);
  return p.api.run;
}

/** Every full-stack product, by name. */
export function productNames(): string[] {
  const dir = join(factoryHome(), "fullstack");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
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

/** The API run's request: the product's own words, and what this side is. Only a product from before PostgreSQL was settled is on SQLite. */
export const apiRequest = (request: string, database: DatabaseKind = "postgres"): string =>
  `${request.trim()}\n\nThis run builds the API side of the product above, in an existing .NET API project. Build every operation of the locked API contract in ${CONTRACT_FILE}, exactly as it is written there. Keep the data in ${database === "postgres" ? "the project's PostgreSQL database (the connection string named App, which the project already reads)" : "the project's local SQLite database"}, and write its sample data in ${SEED_FILE}: a few believable rows for each table, taken from the contract's examples, so each list has something to show. The app runs that file only when the setting Seed:Demo is true, so no test may count on those rows. The web app is built in its own repo; do not build screens here.`;

/** every product's downloaded packages, kept between starts */
export const NPM_CACHE_VOLUME = "factory-npm-cache";
/**
 * What the web app's container runs. Its packages live in a volume of their own, not in the product's folder on this machine
 * (writing them through the machine's mount is slow and can stall), and the install is skipped while package-lock.json is the
 * one they were installed from.
 */
export const WEB_COMMAND = 'set -e; lock=$(sha256sum package-lock.json | cut -d" " -f1); '
  + 'if [ "$(cat node_modules/.factory-lock 2>/dev/null)" != "$lock" ]; then npm ci --no-audit --no-fund; echo "$lock" > node_modules/.factory-lock; fi; '
  + "npm run build; exec npm start";

/**
 * Check out the two delivered branches side by side and write a compose file that starts them: the API (with a PostgreSQL server of
 * its own that keeps its data in a volume; an older product has its SQLite file instead) on the port the web client calls, the web app on 3000. Returns the folder.
 */
export function writeRunFiles(p: Product): string {
  if (!delivered(p.web.run) || !delivered(p.api.run)) throw new Error("Both runs must be delivered first (factory fullstack next shows where each is).");
  const out = join(p.dir, `${p.name}-run`);
  for (const [side, at] of [[p.web, "web"], [p.api, "api"]] as const) {
    const wt = join(out, at);
    if (!existsSync(wt)) git(side.repo, ["worktree", "add", "-q", "--detach", wt, `factory/${side.run}`]);
  }
  const pg = databaseOf(p) === "postgres";
  writeFileSync(join(out, "docker-compose.yml"), stringify({
    services: {
      ...(pg ? { db: {
        image: POSTGRES_IMAGE, environment: { POSTGRES_USER: POSTGRES_LOCAL.user, POSTGRES_PASSWORD: POSTGRES_LOCAL.password, POSTGRES_DB: POSTGRES_LOCAL.name }, volumes: ["db-data:/var/lib/postgresql/data"],
        healthcheck: { test: ["CMD-SHELL", `pg_isready -U ${POSTGRES_LOCAL.user} -d ${POSTGRES_LOCAL.name}`], interval: "2s", timeout: "3s", retries: 30 },
      } } : {}),
      api: { image: API_SDK_IMAGE, working_dir: "/src", volumes: ["./api:/src"], environment: { DOTNET_CLI_TELEMETRY_OPTOUT: "1", [SEED_SETTING]: "true", ...(pg ? { ConnectionStrings__App: postgresConnection("db") } : {}) }, ...(pg ? { depends_on: { db: { condition: "service_healthy" } } } : {}), command: `dotnet run --project ${API_SOLUTION.replace(/\.sln$/, ".Api")} --urls http://0.0.0.0:${API_PORT}`, ports: [`${API_PORT}:${API_PORT}`] },
      // compose reads $ itself, so the command's own are doubled
      web: { image: "node:22-bookworm", working_dir: "/app", volumes: ["./web:/app", "web-modules:/app/node_modules", `${NPM_CACHE_VOLUME}:/root/.npm`], environment: { NEXT_TELEMETRY_DISABLED: "1" }, command: ["sh", "-c", WEB_COMMAND.replace(/\$/g, "$$$$")], ports: ["3000:3000"], depends_on: ["api"] },
    },
    volumes: { ...(pg ? { "db-data": {} } : {}), "web-modules": {}, [NPM_CACHE_VOLUME]: { name: NPM_CACHE_VOLUME } },
  }));
  return out;
}
