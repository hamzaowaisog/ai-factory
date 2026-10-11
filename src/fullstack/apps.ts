// A delivered product, started on this machine for a person to try: the API (with its PostgreSQL server and its sample rows) and
// the web app, from the run files `writeRunFiles` checks out. It is the compose file's three services started with the container
// CLI itself, because the factory's own setup (Colima, Docker Engine) has no compose. Two things differ from the compose file: the
// ports are published on 127.0.0.1 only, and the web app shares the API's network, so "localhost:5080" reaches the API from the
// web app's server as well as from the browser. When another program holds port 3000 the web app is published on the next free
// port and the API is told its address; the API's port is written into the web app's generated client, so it never moves.
// Nothing here is a run: no model, no ledger, no cost.
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { findRuntimeBinary } from "../verify/runtime.js";
import { approvedContract, databaseOf, delivered, writeRunFiles, NPM_CACHE_VOLUME, WEB_COMMAND, type Product } from "./product.js";
import { API_PORT, API_SDK_IMAGE, API_SOLUTION, POSTGRES_IMAGE, CORS_KEY, CORS_SETTING, POSTGRES_LOCAL, postgresConnection, SEED_SETTING } from "./skeleton.js";

export const WEB_PORT = 3000;
/** how many ports after WEB_PORT are tried when it is taken */
const WEB_PORT_TRIES = 10;
export const WEB_IMAGE = "node:22-bookworm";
/** the volume one product's installed web packages are kept in */
export const webModulesVolume = (p: Product) => `${project(p)}-web-modules`;
const SERVICES = ["db", "api", "web"] as const;
export type Service = (typeof SERVICES)[number];

export type Docker = (args: string[], timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>;
export type Probe = (url: string) => Promise<{ status: number; body: string } | undefined>;
/** tests pass fakes: the container CLI, an HTTP GET of the started apps, the wait between two looks at the database, and whether a port is free here */
export interface AppsDeps { docker?: Docker; probe?: Probe; sleep?: (ms: number) => Promise<void>; portFree?: (port: number) => Promise<boolean> }

export interface AppsStatus {
  /** stopped: nothing is started. starting: containers are up, the web app does not answer yet. running: it answers. failed: a start step or a container failed. */
  state: "stopped" | "starting" | "running" | "failed";
  /** what the start is doing now */
  step?: string;
  error?: string;
  services: { name: Service; state: string; detail: string; log?: string }[];
  web: { url: string; status?: number };
  api: { url: string; status?: number };
  /** the contract's lists (a GET with no id in its path) and how many rows each returns from the started API */
  lists: { operation: string; status?: number; rows?: number }[];
}

let binary: string | undefined;
const realDocker: Docker = (args, timeoutMs = 120_000) => new Promise((done) => {
  try { binary ??= findRuntimeBinary(); } catch (e) { done({ code: 127, stdout: "", stderr: (e as Error).message }); return; }
  execFile(binary, args, { maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as unknown as { code: number }).code : 1) : 0;
    done({ code, stdout, stderr: stderr || (err ? err.message : "") });
  });
});
const realProbe: Probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: "manual" });
    return { status: r.status, body: (await r.text()).slice(0, 2_000_000) };
  } catch { return undefined; }
};

const realPortFree = (port: number) => new Promise<boolean>((done) => {
  const srv = createServer();
  srv.once("error", () => done(false));
  srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
});

const project = (p: Product) => `${p.name}-run`;
export const containerName = (p: Product, s: Service) => `${project(p)}-${s}`;
const firstLine = (s: string) => s.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "";

/** The contract's lists: each GET whose path has no parameter, "GET /orders". */
export function listOperations(contract: string | undefined): string[] {
  try {
    const doc = parse(contract ?? "") as { paths?: Record<string, Record<string, unknown>> };
    return Object.entries(doc?.paths ?? {}).filter(([path, ops]) => !path.includes("{") && ops && "get" in ops).map(([path]) => `GET ${path}`);
  } catch { return []; }
}

/** How many rows a list's answer holds: the array itself, or the one array inside an envelope ({ items: [...] }). */
export function rowsIn(body: string): number | undefined {
  try {
    const v = JSON.parse(body) as unknown;
    if (Array.isArray(v)) return v.length;
    const inner = v && typeof v === "object" ? Object.values(v).filter(Array.isArray) : [];
    return inner.length === 1 ? (inner[0] as unknown[]).length : undefined;
  } catch { return undefined; }
}

/** The `docker run` arguments of each service, in the order they start. `webPort`: the port of this machine the web app is opened on. */
export function runArgs(p: Product, out: string, webPort = WEB_PORT): { service: Service; args: string[] }[] {
  const pg = databaseOf(p) === "postgres";
  const base = (s: Service) => ["run", "-d", "--name", containerName(p, s), "--label", `factory.product=${p.name}`, "--label", `factory.service=${s}`, "--label", `factory.webPort=${webPort}`];
  const env = (e: Record<string, string>) => Object.entries(e).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return [
    ...(pg ? [{ service: "db" as const, args: [...base("db"), "--network", project(p), "--network-alias", "db", "-v", `${project(p)}-db-data:/var/lib/postgresql/data`,
      ...env({ POSTGRES_USER: POSTGRES_LOCAL.user, POSTGRES_PASSWORD: POSTGRES_LOCAL.password, POSTGRES_DB: POSTGRES_LOCAL.name }), POSTGRES_IMAGE] }] : []),
    // the API's container also publishes the web app's port: the web app runs in its network
    { service: "api", args: [...base("api"), "--network", project(p), "-p", `127.0.0.1:${API_PORT}:${API_PORT}`, "-p", `127.0.0.1:${webPort}:${WEB_PORT}`, "-v", `${join(out, "api")}:/src`, "-w", "/src",
      ...env({ DOTNET_CLI_TELEMETRY_OPTOUT: "1", [SEED_SETTING]: "true", ...(webPort !== WEB_PORT ? { [CORS_SETTING]: `http://localhost:${webPort}` } : {}), ...(pg ? { ConnectionStrings__App: postgresConnection("db") } : {}) }),
      API_SDK_IMAGE, "dotnet", "run", "--project", API_SOLUTION.replace(/\.sln$/, ".Api"), "--urls", `http://0.0.0.0:${API_PORT}`] },
    { service: "web", args: [...base("web"), "--network", `container:${containerName(p, "api")}`, "-v", `${join(out, "web")}:/app`, "-v", `${webModulesVolume(p)}:/app/node_modules`, "-v", `${NPM_CACHE_VOLUME}:/root/.npm`, "-w", "/app", ...env({ NEXT_TELEMETRY_DISABLED: "1" }),
      WEB_IMAGE, "sh", "-c", WEB_COMMAND] },
  ];
}

interface Job { step: string; error?: string; done: boolean; webPort: number }
const jobs = new Map<string, Job>();

/**
 * Start the product: write the run files, then start the database, the API and the web app in the background (the first start
 * builds both apps, which takes minutes; `appsStatus` says where it is). Refuses, before anything is started, when a run is not
 * delivered, when a start is already going, when another product is running, or when the API's port is taken. A taken web port
 * is not a refusal: the web app goes on the next free one (`webPort`). Starting again replaces the three containers; the database
 * keeps its rows. `done` settles when the containers are started or a step failed.
 */
export async function startApps(p: Product, deps: AppsDeps = {}): Promise<{ dir: string; webPort: number; done: Promise<void> }> {
  const docker = deps.docker ?? realDocker, sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!delivered(p.web.run) || !delivered(p.api.run)) throw new Error("Both runs must be delivered first.");
  if (jobs.get(p.name)?.done === false) throw new Error(`${p.name} is starting already.`);
  const others = await docker(["ps", "--filter", "label=factory.product", "--format", '{{.Label "factory.product"}}\t{{.Label "factory.webPort"}}']);
  if (others.code !== 0) throw new Error(`The container runtime did not answer: ${firstLine(others.stderr)}`);
  const started = others.stdout.split("\n").map((l) => l.trim().split("\t")).filter((r) => r[0]);
  const other = started.find((r) => r[0] !== p.name)?.[0];
  if (other) throw new Error(`${other} is running, and every product's API is on port ${API_PORT}. Stop it first.`);
  const dir = writeRunFiles(p);
  // this product's own earlier start holds its ports and is replaced: it keeps the web port it has
  let webPort = Number(started.find((r) => r[0] === p.name)?.[1]) || 0;
  if (!webPort) {
    const free = deps.portFree ?? realPortFree;
    // the API's port is written into the web app's generated client (a locked file), so another program on it is not worked around
    if (!(await free(API_PORT))) throw new Error(`Port ${API_PORT} is in use by another program on this machine. The web app calls the API on that port: free it, then start again.`);
    for (let n = WEB_PORT; n < WEB_PORT + WEB_PORT_TRIES && !webPort; n++) if (await free(n)) webPort = n;
    if (!webPort) throw new Error(`Ports ${WEB_PORT} to ${WEB_PORT + WEB_PORT_TRIES - 1} are all in use on this machine. Free one, then start again.`);
    // on another port the API has to let that address in, which only an API from the current skeleton can be told
    const program = join(dir, "api", API_SOLUTION.replace(/\.sln$/, ".Api"), "Program.cs");
    if (webPort !== WEB_PORT && !(existsSync(program) && readFileSync(program, "utf8").includes(CORS_KEY))) {
      throw new Error(`Port ${WEB_PORT} is in use by another program on this machine, and this product's API lets in only a web app on ${WEB_PORT}. Free it, then start again.`);
    }
  }
  const job: Job = { step: "Clearing an earlier start", done: false, webPort };
  jobs.set(p.name, job);
  const must = async (step: string, args: string[], timeoutMs?: number) => {
    job.step = step;
    const r = await docker(args, timeoutMs);
    if (r.code !== 0) throw new Error(`${step} failed: ${firstLine(r.stderr)}`);
  };
  const run = async () => {
    await docker(["rm", "-f", ...[...SERVICES].reverse().map((s) => containerName(p, s))]);
    if ((await docker(["network", "inspect", project(p)])).code !== 0) await must("Making the network", ["network", "create", project(p)]);
    for (const { service, args } of runArgs(p, dir, webPort)) {
      // an image not on this machine is pulled first, which can take minutes
      await must(`Starting ${service === "db" ? "the database" : service === "api" ? "the API" : "the web app"}`, args, 15 * 60_000);
      if (service !== "db") continue;
      job.step = "Waiting for the database";
      const until = Date.now() + 60_000;
      while ((await docker(["exec", containerName(p, "db"), "pg_isready", "-U", POSTGRES_LOCAL.user, "-d", POSTGRES_LOCAL.name])).code !== 0) {
        if (Date.now() > until) throw new Error("The database did not become ready in 60 s.");
        await sleep(500);
      }
    }
    job.step = "Building both apps";
  };
  const done = run().catch((e) => { job.error = (e as Error).message; }).finally(() => { job.done = true; });
  return { dir, webPort, done };
}

/** Stop the product: remove its three containers and its network. The database's rows and the web app's installed packages stay in their volumes for the next start. */
export async function stopApps(p: Product, deps: AppsDeps = {}): Promise<void> {
  const docker = deps.docker ?? realDocker;
  if (jobs.get(p.name)?.done === false) throw new Error(`${p.name} is still starting. Stop it once the start has finished.`);
  const r = await docker(["rm", "-f", ...[...SERVICES].reverse().map((s) => containerName(p, s))]);
  if (r.code !== 0 && !/No such container/i.test(r.stderr)) throw new Error(`Could not stop ${p.name}: ${firstLine(r.stderr)}`);
  await docker(["network", "rm", project(p)]);
  jobs.delete(p.name);
}

/** Where the started product is: its containers, whether each app answers, and how many rows each of the contract's lists returns. */
export async function appsStatus(p: Product, deps: AppsDeps = {}): Promise<AppsStatus> {
  const docker = deps.docker ?? realDocker, probe = deps.probe ?? realProbe;
  const job = jobs.get(p.name);
  const web: AppsStatus["web"] = { url: `http://localhost:${job?.webPort ?? WEB_PORT}` }, api: AppsStatus["api"] = { url: `http://localhost:${API_PORT}` };
  const ps = await docker(["ps", "-a", "--filter", `label=factory.product=${p.name}`, "--format", '{{.Label "factory.service"}}\t{{.State}}\t{{.Status}}\t{{.Label "factory.webPort"}}']);
  if (ps.code !== 0) return { state: job?.error ? "failed" : "stopped", error: job?.error ?? `The container runtime did not answer: ${firstLine(ps.stderr)}`, services: [], web, api, lists: [] };
  const rows = ps.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
  // the containers know their web port, so a page server started after them still finds the web app
  const webPort = Number(rows.find((r) => r[3])?.[3]) || job?.webPort || WEB_PORT;
  web.url = `http://localhost:${webPort}`;
  const services: AppsStatus["services"] = [];
  for (const name of SERVICES) {
    const row = rows.find((r) => r[0] === name);
    if (!row) continue;
    const s: AppsStatus["services"][number] = { name, state: row[1] ?? "", detail: row[2] ?? "" };
    // a container that ended: its last lines say why
    if (s.state === "exited" || s.state === "dead") {
      const l = await docker(["logs", "--tail", "15", containerName(p, name)]);
      s.log = `${l.stdout}${l.stderr}`.trim().slice(-2000);
    }
    services.push(s);
  }
  if (!services.length && (!job || (job.done && !job.error))) return { state: "stopped", services, web, api, lists: [] };
  const up = (n: Service) => services.find((s) => s.name === n)?.state === "running";
  const [webAns, apiAns] = await Promise.all([up("web") ? probe(`http://127.0.0.1:${webPort}/`) : undefined, up("api") ? probe(`http://127.0.0.1:${API_PORT}/`) : undefined]);
  if (webAns) web.status = webAns.status;
  if (apiAns) api.status = apiAns.status;
  let contract: string | undefined;
  try { contract = approvedContract(p); } catch { /* shown without its lists */ }
  const lists: AppsStatus["lists"] = !apiAns ? [] : await Promise.all(listOperations(contract).map(async (operation) => {
    const r = await probe(`http://127.0.0.1:${API_PORT}${operation.slice(4)}`);
    const n = r && r.status === 200 ? rowsIn(r.body) : undefined;
    return { operation, ...(r ? { status: r.status } : {}), ...(n !== undefined ? { rows: n } : {}) };
  }));
  const ended = services.find((s) => s.log !== undefined);
  const error = job?.error ?? (ended ? `The ${ended.name === "db" ? "database" : ended.name === "api" ? "API" : "web app"} stopped (${ended.detail}).` : undefined);
  const state = error ? "failed" : webAns && apiAns ? "running" : "starting";
  const step = state !== "starting" ? undefined : job && !job.done ? job.step : !apiAns ? "Building the API" : "Building the web app";
  return { state, ...(step ? { step } : {}), ...(error ? { error } : {}), services, web, api, lists };
}
