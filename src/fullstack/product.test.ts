import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import "../stages/modes.js";
import { _resetEnvCache } from "../config/env.js";
import { loadProject } from "../config/project.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { createRun } from "../stages/executor.js";
import { apiRequest, approvedContract, CONTRACT_FILE, handOverContract, loadProduct, saveProduct, setUpProduct, writeRunFiles } from "./product.js";

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
    expect(readFileSync(join(p.api.repo, ".gitignore"), "utf8")).toMatch(/^openapi\/$/m);
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
    // the API run's request keeps the product's words and says which side this is
    expect(apiRequest("Staff sign in.")).toMatch(/^Staff sign in\.\n\nThis run builds the API side[\s\S]*contracts\/openapi\.yaml[\s\S]*SQLite/);
  });

  it("writes the files that start both apps only when both runs are delivered", async () => {
    const p = setUpProduct("clinic", dir);
    expect(() => writeRunFiles(p)).toThrow(/Both runs must be delivered/);
    expect(existsSync(join(dir, "clinic-run"))).toBe(false);
  });
});
