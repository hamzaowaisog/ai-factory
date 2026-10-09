import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import "../stages/modes.js";
import { _resetEnvCache } from "../config/env.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { createRun } from "../stages/executor.js";
import { appsStatus, listOperations, rowsIn, startApps, stopApps, type Docker, type Probe } from "./apps.js";
import { apiRequest, CONTRACT_FILE, saveProduct, setUpProduct, type Product } from "./product.js";

let dir: string;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-apps-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  dir = mkdtempSync(join(tmpdir(), "factory-apps-repos-"));
});
const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const done = (l: Ledger, step: string, outputs: string[] = []) => l.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs, data: {} }, HUMAN_WRITER);
const CONTRACT = "openapi: 3.0.3\npaths:\n  /orders:\n    get: {}\n    post: {}\n  /orders/{id}:\n    get: {}\n  /customers:\n    get: {}\n";

/** A product whose two runs are delivered, each with its branch. */
async function deliveredProduct(name: string): Promise<Product> {
  const p = setUpProduct(name, dir);
  p.web.run = await createRun("An orders app", p.web.project, "tester");
  p.api.run = await createRun(apiRequest("An orders app"), p.api.project, "tester");
  saveProduct(p);
  const wl = Ledger.open(p.web.run);
  await done(wl, "plan", [wl.putJson({ stubs: [{ path: CONTRACT_FILE, content: CONTRACT, reason: "" }] })]);
  await done(wl, "approve");
  for (const side of [p.web, p.api]) { git(side.repo, "branch", `factory/${side.run}`, "main"); await done(Ledger.open(side.run!), "deliver"); }
  return p;
}

/** A container CLI that remembers what it was asked and keeps the containers it "started". */
function fakeDocker(o: { fail?: (args: string[]) => string | undefined; running?: Record<string, string> } = {}) {
  const calls: string[][] = [];
  const up = new Map<string, { product: string; service: string; state: string }>();
  const docker: Docker = async (args) => {
    calls.push(args);
    const why = o.fail?.(args);
    if (why) return { code: 1, stdout: "", stderr: why };
    if (args[0] === "run") {
      const label = (k: string) => args.find((a) => a.startsWith(`${k}=`))!.split("=")[1]!;
      up.set(args[args.indexOf("--name") + 1]!, { product: label("factory.product"), service: label("factory.service"), state: "running" });
    }
    if (args[0] === "rm") for (const n of args.slice(2)) up.delete(n);
    if (args[0] === "network" && args[1] === "inspect") return { code: 1, stdout: "", stderr: "no such network" };
    if (args[0] === "ps" && args.includes("-a")) return { code: 0, stdout: [...up.values()].map((c) => `${c.service}\t${c.state}\t${c.state === "running" ? "Up 5 seconds" : "Exited (1) 2 seconds ago"}`).join("\n"), stderr: "" };
    if (args[0] === "ps") return { code: 0, stdout: [...Object.values(o.running ?? {}), ...[...up.values()].map((c) => c.product)].join("\n"), stderr: "" };
    if (args[0] === "logs") return { code: 0, stdout: "error CS1002: ; expected", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { docker, calls, up, portFree: async () => true };
}

describe("a delivered product, started on this machine", () => {
  it("reads the contract's lists and counts the rows a list returns", () => {
    expect(listOperations(CONTRACT)).toEqual(["GET /orders", "GET /customers"]);
    expect(listOperations("not: [yaml")).toEqual([]);
    expect(rowsIn("[1,2,3]")).toBe(3);
    expect(rowsIn('{"items":[1,2],"total":2}')).toBe(2);
    expect(rowsIn('{"name":"x"}')).toBeUndefined();
    expect(rowsIn("<html>")).toBeUndefined();
  });

  it("the API skeleton runs its sample rows only when asked, and the API run is told where they go", () => {
    const p = setUpProduct("clinic", dir);
    const program = readFileSync(join(p.api.repo, "App.Api/Program.cs"), "utf8");
    expect(program).toMatch(/EnsureCreated\(\);[\s\S]*if \(app\.Configuration\.GetValue<bool>\("Seed:Demo"\)\) SeedData\.Run\(db\);/);
    expect(readFileSync(join(p.api.repo, "App.Api/SeedData.cs"), "utf8")).toMatch(/public static void Run\(AppDb db\)/);
    expect(apiRequest("Staff sign in.")).toMatch(/sample data in App\.Api\/SeedData\.cs[\s\S]*only when the setting Seed:Demo is true, so no test may count on those rows/);
  });

  it("refuses to start before both runs are delivered, and asks the container runtime nothing", async () => {
    const p = setUpProduct("clinic", dir);
    const d = fakeDocker();
    await expect(startApps(p, d)).rejects.toThrow(/Both runs must be delivered/);
    expect(d.calls).toEqual([]);
    expect(existsSync(join(dir, "clinic-run"))).toBe(false);
  });

  it("starts the database, then the API with its sample rows, then the web app in the API's network; the ports stay on this machine", async () => {
    const p = await deliveredProduct("clinic");
    const d = fakeDocker();
    const { dir: out, done: started } = await startApps(p, { ...d, sleep: async () => {} });
    await started;
    expect(out).toBe(join(dir, "clinic-run"));
    // the run files are written too, and their API has the sample rows on
    expect(parse(readFileSync(join(out, "docker-compose.yml"), "utf8")).services.api.environment.Seed__Demo).toBe("true");
    const runs = d.calls.filter((a) => a[0] === "run");
    expect(runs.map((a) => a[a.indexOf("--name") + 1])).toEqual(["clinic-run-db", "clinic-run-api", "clinic-run-web"]);
    const [db, api, web] = runs.map((a) => a.join(" "));
    expect(db).toContain("--network clinic-run --network-alias db");
    expect(db).toContain("-v clinic-run-db-data:/var/lib/postgresql/data");
    expect(api).toContain("-p 127.0.0.1:5080:5080 -p 127.0.0.1:3000:3000");
    expect(api).toContain("-e Seed__Demo=true");
    expect(api).toContain("-e ConnectionStrings__App=Host=db;");
    expect(api).toContain(`-v ${join(out, "api")}:/src`);
    expect(api).toMatch(/dotnet run --project App\.Api --urls http:\/\/0\.0\.0\.0:5080$/);
    expect(web).toContain("--network container:clinic-run-api");
    expect(web).not.toContain("-p ");
    // the database answers before the API starts
    const order = d.calls.map((a) => (a[0] === "run" ? `run ${a[a.indexOf("--name") + 1]}` : a[0] === "exec" ? "pg_isready" : a.slice(0, 2).join(" ")));
    expect(order.indexOf("pg_isready")).toBeGreaterThan(order.indexOf("run clinic-run-db"));
    expect(order.indexOf("pg_isready")).toBeLessThan(order.indexOf("run clinic-run-api"));
    expect(order).toContain("network create");
  });

  it("says where the start is: building, then running with the rows each list returns; stopping removes the containers", async () => {
    const p = await deliveredProduct("clinic");
    const d = fakeDocker();
    expect(await appsStatus(p, d)).toMatchObject({ state: "stopped", services: [] });
    await (await startApps(p, { ...d, sleep: async () => {} })).done;
    const silent: Probe = async () => undefined;
    expect(await appsStatus(p, { ...d, probe: silent })).toMatchObject({ state: "starting", step: "Building the API", services: [{ name: "db" }, { name: "api" }, { name: "web" }] });
    const apiOnly: Probe = async (url) => (url.includes(":5080") ? { status: 200, body: "API is up" } : undefined);
    expect(await appsStatus(p, { ...d, probe: apiOnly })).toMatchObject({ state: "starting", step: "Building the web app", api: { status: 200 } });
    const both: Probe = async (url) => ({ status: 200, body: url.endsWith("/orders") ? '[{"id":1},{"id":2}]' : url.endsWith("/customers") ? "[]" : "ok" });
    const s = await appsStatus(p, { ...d, probe: both });
    expect(s).toMatchObject({ state: "running", web: { url: "http://localhost:3000", status: 200 }, api: { url: "http://localhost:5080", status: 200 } });
    expect(s.step).toBeUndefined();
    expect(s.lists).toEqual([{ operation: "GET /orders", status: 200, rows: 2 }, { operation: "GET /customers", status: 200, rows: 0 }]);
    await stopApps(p, d);
    expect(d.up.size).toBe(0);
    expect(d.calls.at(-1)).toEqual(["network", "rm", "clinic-run"]);
    expect(await appsStatus(p, d)).toMatchObject({ state: "stopped" });
  });

  it("a container that ended is a failed start, with its last lines", async () => {
    const p = await deliveredProduct("clinic");
    const d = fakeDocker();
    await (await startApps(p, { ...d, sleep: async () => {} })).done;
    d.up.get("clinic-run-api")!.state = "exited";
    const s = await appsStatus(p, { ...d, probe: async () => undefined });
    expect(s).toMatchObject({ state: "failed", error: "The API stopped (Exited (1) 2 seconds ago)." });
    expect(s.services.find((x) => x.name === "api")!.log).toBe("error CS1002: ; expected");
  });

  it("a start step that fails is reported, and another product on the same ports is refused before anything starts", async () => {
    const p = await deliveredProduct("clinic");
    const d = fakeDocker({ fail: (a) => (a[0] === "run" && a.includes("clinic-run-api") ? "docker: Error response from daemon: port is already allocated" : undefined) });
    await (await startApps(p, { ...d, sleep: async () => {} })).done;
    expect(await appsStatus(p, { ...d, probe: async () => undefined })).toMatchObject({ state: "failed", error: "Starting the API failed: docker: Error response from daemon: port is already allocated" });
    const busy = fakeDocker({ running: { x: "shop" } });
    await expect(startApps(p, busy)).rejects.toThrow(/shop is running, and every product's API is on port 5080\. Stop it first\./);
    expect(busy.calls.some((a) => a[0] === "run")).toBe(false);
  });

  it("puts the web app on the next free port when 3000 is taken and tells the API its address; the API's port never moves", async () => {
    const p = await deliveredProduct("clinic");
    const d = fakeDocker();
    const { webPort, done: started } = await startApps(p, { ...d, sleep: async () => {}, portFree: async (port) => port !== 3000 && port !== 3001 });
    await started;
    expect(webPort).toBe(3002);
    const api = d.calls.find((a) => a[0] === "run" && a.includes("clinic-run-api"))!.join(" ");
    expect(api).toContain("-p 127.0.0.1:5080:5080 -p 127.0.0.1:3002:3000");
    expect(api).toContain("-e Cors__Origin=http://localhost:3002");
    // the page is told where the web app is, and it is looked for there
    const asked: string[] = [];
    const s = await appsStatus(p, { ...d, probe: async (url) => { asked.push(url); return { status: 200, body: "[]" }; } });
    expect(s.web).toEqual({ url: "http://localhost:3002", status: 200 });
    expect(asked).toContain("http://127.0.0.1:3002/");
    await stopApps(p, d);
    // on 3000 itself the API is told nothing: its own default stands
    await (await startApps(p, { ...d, sleep: async () => {} })).done;
    expect(d.calls.filter((a) => a[0] === "run" && a.includes("clinic-run-api")).at(-1)!.join(" ")).not.toContain("Cors__Origin");
    await stopApps(p, d);

    // the API's port is written into the web app's client: taken, the start is refused before anything runs
    const taken = fakeDocker();
    await expect(startApps(p, { ...taken, portFree: async (port) => port !== 5080 })).rejects.toThrow(/Port 5080 is in use by another program/);
    await expect(startApps(p, { ...taken, portFree: async (port) => port === 5080 })).rejects.toThrow(/Ports 3000 to 3009 are all in use/);
    // an API from before the setting lets in only a web app on 3000, so it is not moved
    const program = join(p.api.repo, "App.Api/Program.cs");
    writeFileSync(program, readFileSync(program, "utf8").replace('builder.Configuration["Cors:Origin"] ?? ', "").replace(/^\/\/ the web app's address.*\n/m, ""));
    git(p.api.repo, "checkout", "-q", `factory/${p.api.run}`); git(p.api.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "older API"); git(p.api.repo, "checkout", "-q", "main");
    execFileSync("git", ["-C", join(dir, "clinic-run", "api"), "checkout", "-q", "--detach", `factory/${p.api.run}`]);
    await expect(startApps(p, { ...taken, portFree: async (port) => port !== 3000 })).rejects.toThrow(/Port 3000 is in use by another program on this machine, and this product's API lets in only a web app on 3000/);
    expect(taken.calls.some((a) => a[0] === "run" || a[0] === "rm")).toBe(false);
  });
});
