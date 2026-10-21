import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { brownfieldSteps } from "../stages/modes.js";
import { _resetEnvCache } from "../config/env.js";
import { loadProject, projectPath } from "../config/project.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { createRun } from "../stages/executor.js";
import { apiRequest, approvedContract, CONTRACT_FILE, handOverContract, loadProduct, saveProduct, setUpProduct, startApiRun, writeRunFiles } from "./product.js";

let dir: string;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "factory-fs-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
  _resetEnvCache();
  dir = mkdtempSync(join(tmpdir(), "factory-fs-repos-"));
});
const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const done = (l: Ledger, step: string, outputs: string[]) => l.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs, data: {} }, HUMAN_WRITER);

describe("a full-stack product: two repos, one contract", () => {
  it("sets up an empty web repo and the API skeleton, each with a project config that names the contract", () => {
    const p = setUpProduct("clinic", dir);
    expect(loadProduct("clinic")).toEqual(p);
    const web = loadProject("clinic-web"), api = loadProject("clinic-api");
    expect(web).toMatchObject({ stack: "node", repo: join(dir, "clinic-web"), contract: { file: CONTRACT_FILE, apiUrl: "http://localhost:5080" } });
    expect(api).toMatchObject({ stack: "dotnet", dotnet: { solution: "App.sln", sdkImage: "mcr.microsoft.com/dotnet/sdk:9.0" }, contract: { file: CONTRACT_FILE, built: "App.Api/openapi/built.json" } });
    // one coding image for both sides
    expect(web.dotnet.sdkImage).toBe(api.dotnet.sdkImage);
    expect(git(p.web.repo, "ls-tree", "-r", "--name-only", "main").trim()).toBe("");
    const files = git(p.api.repo, "ls-tree", "-r", "--name-only", "main").trim().split("\n");
    expect(files).toEqual(expect.arrayContaining(["App.sln", "App.Api/App.Api.csproj", "App.Api/Program.cs", "App.Api/AppDb.cs", "App.Tests/HealthTests.cs", ".gitignore"]));
    expect(files).not.toContain(CONTRACT_FILE);
    // the build writes the document the contract gate reads, and it is not committed
    expect(readFileSync(join(p.api.repo, "App.Api/App.Api.csproj"), "utf8")).toMatch(/OpenApiDocumentsDirectory>\$\(MSBuildProjectDirectory\)\/openapi</);
    expect(readFileSync(join(p.api.repo, ".gitignore"), "utf8")).toMatch(/^App\.Api\/openapi\/\*\.json$/m);
  });

  it("refuses a bad name, a product that exists and a folder that is in use", () => {
    expect(() => setUpProduct("My App", dir)).toThrow(/not a usable name/);
    setUpProduct("clinic", dir);
    expect(() => setUpProduct("clinic", dir)).toThrow(/already exists/);
    expect(() => loadProduct("other")).toThrow(/No full-stack product "other"/);
  });

  it("hands the contract over only once the web plan is approved; the API repo then holds it on its base branch", async () => {
    const p = setUpProduct("clinic", dir);
    expect(approvedContract(p)).toBeUndefined();
    p.web.run = await createRun("A portal where clinic staff sign in", p.web.project, "tester");
    saveProduct(p);
    const l = Ledger.open(p.web.run);
    expect(replay(l.events()).info.mode).toBe("greenfield");
    await done(l, "plan", [l.putJson({ stubs: [{ path: CONTRACT_FILE, content: "openapi: 3.0.3\npaths: {}\n", reason: "" }] })]);
    // planned, not approved yet: nothing to hand over
    expect(approvedContract(p)).toBeUndefined();
    await done(l, "approve", [l.putJson({ approved: true })]);
    const contract = approvedContract(p)!;
    expect(contract).toContain("openapi: 3.0.3");
    handOverContract(p, contract);
    expect(git(p.api.repo, "show", `main:${CONTRACT_FILE}`)).toBe(contract);
    expect(git(p.api.repo, "log", "-1", "--format=%s")).toContain(`approved with the web plan in ${p.web.run}`);
    handOverContract(p, contract); // again: nothing new to commit
    expect(git(p.api.repo, "rev-list", "--count", "main").trim()).toBe("2");
    // the API run asks as the web run does, so a request too long for one intake is read module by module (run 1de4 parked on one)
    const long = Array.from({ length: 12 }, (_, n) => `# Part ${n + 1}\n\n${"Staff record each delivery and its temperature. ".repeat(60)}`).join("\n\n");
    saveProduct({ ...p, request: long });
    const apiRun = (await startApiRun(loadProduct("clinic"), "tester"))!;
    const api = replay(Ledger.open(apiRun).events());
    expect(api.info).toMatchObject({ mode: "brownfield", asks: true });
    expect(brownfieldSteps(api).map((s) => s.key).filter((k) => k.startsWith("intake"))).toEqual(["intake:m1", "intake:m2", "intake"]);
    expect(loadProduct("clinic").api.run).toBe(apiRun);
    // the API run's request keeps the product's words and says which side this is
    expect(apiRequest("Staff sign in.")).toMatch(/^Staff sign in\.\n\nThis run builds the API side[\s\S]*contracts\/openapi\.yaml[\s\S]*PostgreSQL database \(the connection string named App/);
  });

  it("a product from a meeting: the web run distills the transcript, and the API run reads the approved brief", async () => {
    const p = setUpProduct("clinic", dir);
    const transcript = { format: "gemini-meet" as const, notes: "", speakers: ["Alex Morgan"], turns: [{ id: "T-1", time: "00:00:41", speaker: "Alex Morgan", text: "Staff sign in and record each delivery" }] };
    p.request = "T-1 [00:00:41] Alex Morgan: Staff sign in and record each delivery";
    p.web.run = await createRun(p.request, p.web.project, "tester", { transcript });
    saveProduct(p);
    const l = Ledger.open(p.web.run);
    expect(replay(l.events()).info.transcriptSha).toBeDefined();
    await l.append({ type: "step.completed", key: "distill/1", inputsHash: "a".repeat(64), outputs: [l.putJson({})], data: { brief: "# Clinic deliveries\n\n## Requirements\n- R-1: Staff record each delivery" } }, HUMAN_WRITER);
    await done(l, "plan", [l.putJson({ stubs: [{ path: CONTRACT_FILE, content: "openapi: 3.0.3\npaths: {}\n", reason: "" }] })]);
    await done(l, "approve", [l.putJson({ approved: true })]);
    const api = replay(Ledger.open((await startApiRun(loadProduct("clinic"), "tester"))!).events());
    expect(api.info.request).toMatch(/^# Clinic deliveries[\s\S]*R-1: Staff record each delivery[\s\S]*This run builds the API side/);
    expect(api.info.request).not.toContain("T-1 [00:00:41]");
  });

  it("sets every new product's API up on PostgreSQL, and says so when the request names another database", () => {
    const p = setUpProduct("clinic", dir, "Staff sign in. Keep it in SQLite.");
    const read = (f: string) => readFileSync(join(p.api.repo, f), "utf8");
    expect(read("App.Api/App.Api.csproj")).toMatch(/Npgsql\.EntityFrameworkCore\.PostgreSQL/);
    expect(read("App.Api/App.Api.csproj")).not.toMatch(/Sqlite/);
    expect(read("App.Api/Program.cs")).toMatch(/UseNpgsql\(builder\.Configuration\.GetConnectionString\("App"\)/);
    // the running API serves its document and a Swagger page; neither is an operation, so the built document stays the contract's
    expect(read("App.Api/Program.cs")).toMatch(/app\.MapOpenApi\(\);\napp\.UseSwaggerUI\(/);
    expect(read("App.Api/App.Api.csproj")).toMatch(/Swashbuckle\.AspNetCore\.SwaggerUI" Version="7\.3\.2"/);
    expect(git(p.api.repo, "log", "-1", "--format=%s").trim()).toBe("API skeleton (factory fullstack): .NET 9, PostgreSQL, one test");
    // the lab starts a PostgreSQL beside the tests and hands the app its connection
    expect(loadProject("clinic-api").database).toMatchObject({ image: "postgres:16-alpine", producerEnv: { ConnectionStrings__App: expect.stringContaining("Host={{DB_HOST}}") } });
    expect(loadProduct("clinic").database).toEqual({ kind: "postgres", reason: "Every new product's API is built on PostgreSQL. The request names SQLite, which the factory does not set up for a new product." });
    // a product from before PostgreSQL was settled is on SQLite, and its API run is still told so
    expect(apiRequest("Staff sign in.", "sqlite")).toMatch(/local SQLite database/);
  });

  it("writes the files that start both apps only when both runs are delivered", async () => {
    const p = setUpProduct("clinic", dir);
    expect(() => writeRunFiles(p)).toThrow(/Both runs must be delivered/);
    expect(existsSync(join(dir, "clinic-run"))).toBe(false);
  });

  it("starts each run's branch as it is now: a fix committed on the PR after delivery is in the next start", async () => {
    const p = setUpProduct("clinic", dir);
    for (const side of [p.web, p.api]) {
      side.run = await createRun("A portal where clinic staff sign in", side.project, "tester");
      await done(Ledger.open(side.run), "deliver", [Ledger.open(side.run).putJson({})]);
      git(side.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "delivered");
      git(side.repo, "branch", `factory/${side.run}`);
    }
    saveProduct(p);
    const out = writeRunFiles(p);
    const head = (s: string) => git(join(out, s), "log", "-1", "--format=%s").trim();
    expect(head("web")).toBe("delivered");
    // the PR's fix: a later commit on the run's branch
    const fix = git(p.web.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", "-m", "fix", "-p", `factory/${p.web.run}`, `factory/${p.web.run}^{tree}`).trim();
    git(p.web.repo, "update-ref", `refs/heads/factory/${p.web.run}`, fix);
    writeRunFiles(p);
    expect(head("web")).toBe("fix");
    expect(head("api")).toBe("delivered");
  });
});
