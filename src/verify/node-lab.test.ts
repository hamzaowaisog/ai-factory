// The Node test lab with real containers (greenfield, the PR #11 review's follow-up): a scaffolded app with two factory tests is
// installed through the feed proxy, built and tested with no network, and booted for a probe. Slow, and needs Docker (or Colima)
// and the network: FACTORY_LAB_E2E=1 (npm run test:lab).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { loadKit, scaffold, writeScaffold } from "../design/kit/index.js";
import { sampleDesign } from "../design/kit/sample.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { ensureEgress, feedHostsFrom } from "../runners/netinfra.js";
import { produceNodeTests } from "./node.js";
import { DockerCli, findRuntimeBinary } from "./runtime.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

describe.runIf(process.env.FACTORY_LAB_E2E === "1")("the Node lab, with real containers", () => {
  it("installs, builds, tests and boots a scaffolded app", { timeout: 1_800_000 }, async () => {
    // under the home folder: Colima and Docker Desktop share it with their VM by default (the system temp folder is not shared)
    const home = mkdtempSync(join(homedir(), ".factory-lab-e2e-"));
    process.env.FACTORY_HOME = home;
    const repo = mkdtempSync(join(tmpdir(), "factory-lab-repo-"));
    writeScaffold(scaffold({ design: sampleDesign(), kit: loadKit(), product: "Acme Billing", tag: "lab test", apps: ["portal"], target: "next-shadcn" }), repo);
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "tests", "lab.test.ts"), [
      `import { describe, expect, it } from "vitest";`,
      `describe("sign in", () => {`,
      `  it("AC_1_1_Works", () => { expect(1 + 1).toBe(2); });`,
      `  it("AC_1_2_NotYet", () => { expect("Not signed in").toBe("Signed in"); });`,
      `});`, ``,
    ].join("\n"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
    execFileSync("git", ["add", "-A"], { cwd: repo, env });
    execFileSync("git", ["commit", "-q", "-m", "app"], { cwd: repo, env });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env, encoding: "utf8" }).trim();

    const rt = new DockerCli(findRuntimeBinary());
    await ensureEgress(rt, feedHostsFrom(DEFAULT_POLICY.registryAllowlist));
    const phases: string[] = [];
    const out = await produceNodeTests({
      runId: "lab-e2e", key: "lab", repo, commit, stage: "baseline", rt,
      project: ProjectConfig.parse({ project: "lab", repo, stack: "node" }),
      exp: { expectPass: [], expectFail: [], compareToBaseline: [] },
      accept: { probes: [{ acId: "AC-1.1", method: "GET", path: "/", expectStatus: 200 }] },
      onPhase: (_p, msg) => { phases.push(msg); },
    });
    expect(out.build, phases.join("\n")).toMatchObject({ ok: true });
    expect(out.testRun.runner).toBe("vitest");
    const byTitle = Object.fromEntries(out.testRun.results.map((r) => [r.id, r.outcome]));
    expect(byTitle).toEqual({ "tests/lab.test.ts::sign in > AC_1_1_Works": "passed", "tests/lab.test.ts::sign in > AC_1_2_NotYet": "failed" });
    expect(out.testRun.results.find((r) => r.outcome === "failed")!.failureKind).toBe("assertion");
    expect(out.accept?.boot, phases.join("\n")).toMatchObject({ attempted: true, ok: true });
    expect(out.accept!.probes[0]).toMatchObject({ status: 200 });
    rmSync(home, { recursive: true, force: true });
  });
});
