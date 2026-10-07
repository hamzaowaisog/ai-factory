// `factory fullstack` on the page: start a product (both repos, then the web run), hand the approved contract over and start the
// API run, and write the files that start the two delivered apps together. The same steps as the command line
// (src/fullstack/product.ts); the two runs are ordinary runs, shown and decided on their own run pages.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { PRODUCT_NAME } from "../config/greenfield.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { gatherRequest } from "../sources/request.js";
import { runDetached } from "../stages/background.js";
import { shownStatus } from "../stages/run-status.js";
import { API_PORT } from "../fullstack/skeleton.js";
import { approvedContract, CONTRACT_FILE, delivered, loadProduct, productNames, productSeed, startApiRun, startProduct, writeRunFiles, type Product, type ProductSeed } from "../fullstack/product.js";
import { factoryHome } from "../util/paths.js";
import { currentStep } from "./data.js";
import { folderOf, maxCostOf, StartError, str, uploadedFile, type StartDeps } from "./start.js";

export interface SideView {
  project: string; repo: string;
  /** the side's GitHub repo, when the product was put on GitHub, and the run's PR once it is delivered there */
  github?: string; prUrl?: string;
  run?: { runId: string; status: string; step: string; costUsd: number; openCard?: string; delivered: boolean };
}

export interface ProductView {
  name: string; dir: string; request?: string; web: SideView; api: SideView;
  /** the approved design or estimate the product started from */
  from?: Product["from"];
  /** once the web plan is approved: the contract handed to the API run, and its operations ("GET /orders") */
  contract?: { file: string; text: string; operations: string[] };
  /** what to do next, in words, and whether the page's buttons apply */
  next: { say: string; canStartApi: boolean; canWriteRunFiles: boolean };
  /** the folder the run files go to, and the command that starts both apps */
  runFiles: { dir: string; command: string; open: string };
}

function sideView(side: Product["web"]): SideView {
  const at = { project: side.project, repo: side.repo, ...(side.github ? { github: side.github } : {}) };
  if (!side.run) return at;
  try {
    const s = replay(Ledger.open(side.run).events());
    const prUrl = s.steps.get("deliver")?.data?.prUrl;
    return {
      ...at, ...(typeof prUrl === "string" ? { prUrl } : {}),
      run: { runId: side.run, status: shownStatus(s), step: currentStep(s), costUsd: s.costUsd, ...(s.openCard ? { openCard: s.openCard.kind } : {}), delivered: delivered(side.run) },
    };
  } catch { return { ...at, run: { runId: side.run, status: "unknown", step: "", costUsd: 0, delivered: false } }; }
}

/** The operations a contract names, "METHOD /path", in its own order (none when it does not read as OpenAPI). */
export function contractOperations(text: string): string[] {
  try {
    const doc = parse(text) as { paths?: Record<string, Record<string, unknown>> };
    const verbs = ["get", "post", "put", "patch", "delete"];
    return Object.entries(doc?.paths ?? {}).flatMap(([path, ops]) => Object.keys(ops ?? {}).filter((m) => verbs.includes(m)).map((m) => `${m.toUpperCase()} ${path}`));
  } catch { return []; }
}

export function productView(name: string): ProductView {
  const p = loadProduct(name);
  const web = sideView(p.web), api = sideView(p.api);
  let contract: ProductView["contract"];
  try { const text = approvedContract(p); if (text) contract = { file: CONTRACT_FILE, text, operations: contractOperations(text) }; } catch { /* a run being written is read again on the next poll */ }
  const both = !!web.run?.delivered && !!api.run?.delivered;
  const say = !p.web.run ? "The web run has not started."
    : !contract && !p.api.run ? "The web run asks its questions, draws the design, then writes the plan with the API contract. Approve the plan on the web run's page; then start the API run here."
    : !p.api.run ? "The web plan and its API contract are approved. Start the API run: it builds every operation of the contract. The web run goes on by itself."
    : !both ? "Both runs are going. Each stops at its own cards on its run page; when both are delivered, write the run files here."
    : "Both runs are delivered. Write the run files, then start both apps together.";
  const out = join(p.dir, `${p.name}-run`);
  return {
    name: p.name, dir: p.dir, ...(p.request ? { request: p.request } : {}), ...(p.from ? { from: p.from } : {}), web, api, ...(contract ? { contract } : {}),
    next: { say, canStartApi: !p.api.run && !!contract, canWriteRunFiles: both },
    runFiles: { dir: out, command: `docker compose -f ${out}/docker-compose.yml up`, open: `http://localhost:3000 (the API answers on http://localhost:${API_PORT})` },
  };
}

export function productsView(): { name: string; web: SideView; api: SideView }[] {
  const rows: { name: string; web: SideView; api: SideView }[] = [];
  for (const name of productNames()) {
    try { const p = loadProduct(name); rows.push({ name, web: sideView(p.web), api: sideView(p.api) }); } catch { /* a broken file doesn't hide the others */ }
  }
  return rows;
}

/**
 * Start a product, as `factory fullstack start`: { name, dir, prompt or file, or fromDesign or fromEstimate, maxCost, github }. Every
 * check comes before anything is written (with `github`, GitHub is asked too: the token, and that both names are free); then the two repos and their projects are made and the web run (greenfield) starts in the
 * background. An approved design or estimate brings its own request.
 */
export async function startFullstack(input: Record<string, unknown>, deps: StartDeps = {}): Promise<{ name: string; webRun: string }> {
  const name = str(input.name)?.trim() ?? "";
  if (!PRODUCT_NAME.test(name)) throw new StartError(`"${name}" is not a usable name: lower-case letters, digits and dashes, starting with a letter (the repos are <name>-web and <name>-api).`);
  const rawDir = str(input.dir)?.trim();
  if (!rawDir) throw new StartError("Give the folder the two repos go in, for example ~/projects.");
  const dir = folderOf(rawDir);
  if (productNames().includes(name)) throw new StartError(`A full-stack product "${name}" already exists. Open it from the list, or pick another name.`);
  const maxCostUsd = maxCostOf(input.maxCost);
  const file = uploadedFile(input.file);
  const prompt = str(input.prompt);
  let seed: ProductSeed | undefined;
  try { seed = productSeed({ design: str(input.fromDesign)?.trim() || undefined, estimate: str(input.fromEstimate)?.trim() || undefined }); } catch (e) { throw new StartError((e as Error).message); }
  if (seed && (prompt || file)) throw new StartError("An approved design or estimate brings its own request: leave the request and the file empty.");
  if (!seed && !prompt && !file) throw new StartError("Describe the product, or upload its requirements, or start it from an approved design or estimate.");
  if (prompt && file) throw new StartError("Give the request or a file, not both.");
  let tmp: string | undefined;
  let req;
  if (!seed) try {
    let path: string | undefined;
    if (file) {
      mkdirSync(join(factoryHome(), "tmp"), { recursive: true, mode: 0o700 });
      tmp = mkdtempSync(join(factoryHome(), "tmp", "ui-upload-"));
      path = join(tmp, file.name);
      writeFileSync(path, file.text, { mode: 0o600 });
    }
    req = await (deps.gather ?? gatherRequest)({ prompt, file: path }, {});
  } catch (e) {
    throw new StartError((e as Error).message);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  let p: Product;
  try { p = await startProduct(name, dir, req, `${userInfo().username} (via web)`, maxCostUsd, seed, input.github === true); } catch (e) { throw new StartError((e as Error).message); }
  (deps.execute ?? runDetached)(p.web.run!);
  return { name: p.name, webRun: p.web.run! };
}

/** `factory fullstack next` from the page: hand the approved contract to the API repo and start the API run in the background. */
export async function fullstackNext(name: string, input: Record<string, unknown>, deps: StartDeps = {}): Promise<{ apiRun: string }> {
  const p = loadProduct(name);
  if (p.api.run) throw new StartError(`The API run of ${p.name} is started already: ${p.api.run}.`, 409);
  const maxCostUsd = maxCostOf(input.maxCost);
  const api = await startApiRun(p, `${userInfo().username} (via web)`, maxCostUsd);
  if (!api) throw new StartError("The web run's plan is not approved yet, so there is no contract to hand over. Approve it on the web run's page first.", 409);
  (deps.execute ?? runDetached)(api);
  return { apiRun: api };
}

/** `factory fullstack up` from the page: check out both delivered branches side by side and write the compose file. Starts nothing. */
export function fullstackUp(name: string): { dir: string; command: string } {
  const p = loadProduct(name);
  if (!delivered(p.web.run) || !delivered(p.api.run)) throw new StartError("Both runs must be delivered first.", 409);
  const dir = writeRunFiles(p);
  return { dir, command: `docker compose -f ${dir}/docker-compose.yml up` };
}
