// Outside systems in a build: what each step is told, and the settings list the pull request carries.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSecretPath } from "../gates/protected.js";
import { scanText } from "../context/secrets.js";
import { matchesAny } from "../util/glob.js";
import { TEST_SCOPE } from "./build.js";
import { prBody, settingsNeeded } from "./deliver.js";
import { isSettingsFile, newSettings, outsideSystemsPlanRule, settingNames, settingsFileFor, settingsSection } from "./outside-systems.js";
import { authorIntro, implementIntro } from "./stack-text.js";

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("what the steps are told about an outside system", () => {
  it("tells the test writer of either stack to put a recording stand-in behind the seam, never the real system", () => {
    for (const stack of ["dotnet", "node"] as const) {
      const text = authorIntro(stack);
      expect(text).toContain("are never called by a test");
      expect(text).toContain("The stand-in records every call it gets");
      expect(text).toContain("locked with them");
    }
    expect(authorIntro("dotnet")).toContain("fake implementation of the system's interface");
    expect(authorIntro("node", true)).toContain("vi.mock");
  });

  it("tells the planner to give each system one seam as a stub and to put the settings file in a task's scope", () => {
    expect(outsideSystemsPlanRule("dotnet")).toContain("an interface of its own");
    expect(outsideSystemsPlanRule("dotnet")).toContain("put appsettings.json in the fileScope");
    expect(outsideSystemsPlanRule("node")).toContain("a module of its own");
    expect(outsideSystemsPlanRule("node")).toContain("put .env.example in the fileScope");
  });

  it("tells the coding agent to declare each setting empty, in a file the secret rules let through", () => {
    for (const stack of ["dotnet", "node"] as const) {
      const file = settingsFileFor(stack);
      expect(implementIntro(stack)).toContain(`declare each new one in ${file} with an empty value`);
      expect(isSecretPath(file)).toBe(false);
      expect(isSecretPath(`api/${file}`)).toBe(false);
      expect(isSettingsFile(`api/${file}`)).toBe(true);
      // the settings file is production code: the test writer cannot write it, a task's scope must hold it
      expect(matchesAny(file, TEST_SCOPE)).toBe(false);
    }
    // an empty value is not a secret; a filled one stops the commit
    expect(scanText("appsettings.json", `"Smtp": { "Password": "" }`)).toEqual([]);
    expect(scanText(".env.example", "SMTP_PASSWORD=")).toEqual([]);
    expect(scanText(".env.example", "SMTP_PASSWORD=hunter2hunter2").length).toBe(1);
  });
});

describe("the settings a change declares", () => {
  it("reads appsettings.json by section and an env example by name", () => {
    expect(settingNames("api/appsettings.json", `{ "Logging": { "LogLevel": { "Default": "Information" } }, "Smtp": { "Host": "", "Port": 587 }, "AllowedHosts": "*" }`))
      .toEqual(["Logging:LogLevel:Default", "Smtp:Host", "Smtp:Port", "AllowedHosts"]);
    expect(settingNames(".env.example", "# mail\nSMTP_HOST=\nexport SMTP_PORT=587\n\nnot a setting\nSMTP_HOST=again\n")).toEqual(["SMTP_HOST", "SMTP_PORT"]);
    expect(settingNames("web/.env.local.example", "NEXT_PUBLIC_API=\n")).toEqual(["NEXT_PUBLIC_API"]);
  });

  it("reads nothing from a file it does not know or cannot parse", () => {
    expect(settingNames("appsettings.json", `{ // comment\n "Smtp": {} }`)).toEqual([]);
    expect(settingNames("src/config.ts", "SMTP_HOST=1")).toEqual([]);
    // the real ones are secret files, never read
    expect(isSettingsFile("appsettings.Production.json")).toBe(false);
    expect(isSettingsFile(".env")).toBe(false);
    expect(isSettingsFile(".env.local")).toBe(false);
  });

  it("keeps only the names the base did not have", () => {
    const before = `{ "ConnectionStrings": { "App": "" } }`;
    const after = `{ "ConnectionStrings": { "App": "" }, "Smtp": { "Host": "", "From": "" } }`;
    expect(newSettings("appsettings.json", before, after)).toEqual({ file: "appsettings.json", names: ["Smtp:Host", "Smtp:From"] });
    expect(newSettings("appsettings.json", "", after)?.names).toEqual(["ConnectionStrings:App", "Smtp:Host", "Smtp:From"]);
    expect(newSettings("appsettings.json", after, after)).toBeUndefined();
  });

  it("reads them from the change's commits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-settings-"));
    made.push(dir);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "api"));
    writeFileSync(join(dir, "api/appsettings.json"), `{ "ConnectionStrings": { "App": "" } }\n`);
    writeFileSync(join(dir, "old.env.example"), "GONE=\n");
    git("add", "-A"); git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "api/appsettings.json"), `{ "ConnectionStrings": { "App": "" }, "Smtp": { "Host": "", "Password": "" } }\n`);
    writeFileSync(join(dir, ".env.example"), "SMTP_HOST=\n");
    writeFileSync(join(dir, "api/Mail.cs"), "class Mail {}\n");
    rmSync(join(dir, "old.env.example"));
    git("add", "-A"); git("commit", "-q", "-m", "change");
    expect(await settingsNeeded(dir, base, git("rev-parse", "HEAD"))).toEqual([
      { file: ".env.example", names: ["SMTP_HOST"] },
      { file: "api/appsettings.json", names: ["Smtp:Host", "Smtp:Password"] },
    ]);
    expect(await settingsNeeded(dir, base, base)).toEqual([]);
  });
});

describe("the pull request's settings section", () => {
  const body = (settings?: { file: string; names: string[] }[]) => prBody({ runId: "run-1", state: { info: { request: "Send a reminder by email." }, steps: new Map(), costUsd: 1 } as never }, {
    spec: { requirements: [], nfrs: [], outOfScope: [], assumptions: [] } as never, plan: { tasks: [] } as never, lock: { tests: [] },
    run: { results: [] } as never, review: { findings: [] }, manifestHash: "m", commits: [], ...(settings ? { settings } : {}),
  });

  it("names each new setting, with the environment variable .NET reads it from, before the factory's own checks", () => {
    const text = body([{ file: "api/appsettings.json", names: ["Smtp:Host", "Smtp:Password"] }, { file: ".env.example", names: ["SMTP_HOST"] }]);
    expect(text).toContain("## Settings to fill in\nThis change declares 3 new settings.");
    expect(text).toContain("no real connection was tried");
    expect(text).toContain("- `api/appsettings.json`\n  - `Smtp:Host` (environment variable `Smtp__Host`)\n  - `Smtp:Password` (environment variable `Smtp__Password`)");
    expect(text).toContain("- `.env.example`\n  - `SMTP_HOST`\n");
    expect(text.indexOf("## Settings to fill in")).toBeLessThan(text.indexOf("## Checks the factory ran itself"));
  });

  it("is left out when the change declares none", () => {
    expect(settingsSection([])).toEqual([]);
    expect(body()).not.toContain("Settings to fill in");
    expect(body([])).not.toContain("Settings to fill in");
  });
});

describe("a demo run delivered with blocking review findings", () => {
  const body = (demoBlocking?: string[]) => prBody({ runId: "run-1", state: { info: { request: "r" }, steps: new Map(demoBlocking ? [["review", { data: { demoBlocking } }]] : []), costUsd: 1 } as never }, {
    spec: { requirements: [], nfrs: [], outOfScope: [], assumptions: [] } as never, plan: { tasks: [] } as never, lock: { tests: [] },
    run: { results: [] } as never, review: { findings: [] }, manifestHash: "m", commits: [],
  });

  it("puts them at the top of the pull request, security first (run 7850, R-1)", () => {
    const text = body(["R-2 [correctness/high] a.ts:1 wrong total", "R-1 [security/medium] LocationEndpoints.cs:37 any driver can post any vehicle's location"]);
    expect(text.startsWith("> [!WARNING]\n> **Delivered in demo mode with 2 blocking review findings, including security.**")).toBe(true);
    expect(text.indexOf("R-1 [security")).toBeLessThan(text.indexOf("R-2 [correctness"));
    expect(text.indexOf("R-2 [correctness")).toBeLessThan(text.indexOf("## What was asked"));
  });

  it("says nothing when there were none", () => {
    expect(body()).not.toContain("demo mode");
  });
});

describe("checks accepted at integrate", () => {
  it("are named on the pull request with who accepted them", () => {
    const text = prBody({ runId: "run-1", state: { info: { request: "r" }, steps: new Map([["integrate", { data: { waivers: [{ gateIds: ["design.size-cap"], human: "DEMO mode", reason: "accepted without asking: too big" }] } }]]), costUsd: 1 } as never }, {
      spec: { requirements: [], nfrs: [], outOfScope: [], assumptions: [] } as never, plan: { tasks: [] } as never, lock: { tests: [] },
      run: { results: [] } as never, review: { findings: [] }, manifestHash: "m", commits: [],
    });
    expect(text).toContain("- ⚠ Waived by DEMO mode at integrate: design.size-cap (accepted without asking: too big)");
  });
});
