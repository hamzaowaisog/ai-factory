// A project with no guidelines gets them built and approved by the factory; a person's file is never touched.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectConfig } from "../config/project.js";
import { ensureGuidelines, FACTORY_APPROVER } from "./auto.js";
import type { MinedRules } from "./mine.js";
import { approvalOf, currentSha, guidelinesPath, readApproved, recordApproval, writeGuidelines } from "./store.js";

let home: string;
const prev = process.env.FACTORY_HOME;
beforeAll(() => { home = mkdtempSync(join(tmpdir(), "conv-auto-")); process.env.FACTORY_HOME = home; });
afterAll(() => { process.env.FACTORY_HOME = prev; rmSync(home, { recursive: true, force: true }); });

const git = (repo: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo }).toString().trim();
function project(name: string) {
  const repo = join(home, "repos", name);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "Start");
  return ProjectConfig.parse({ project: name, repo, baseBranch: "main", stack: "node" });
}
function addCode(repo: string) {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "orders.ts"), "export const orders = [];\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "code");
}
const mined: MinedRules = { rules: [{ rule: "Modules export named constants only", appliesTo: ["src/**/*.ts"], exemplar: "src/orders.ts:1", matching: 1, total: 1 }] };
/** a scan that counts its calls instead of calling a model */
function scanner() {
  const s = { calls: 0, scan: async () => { s.calls++; return mined; } };
  return s;
}
const quiet = () => undefined;

describe("guidelines nobody has to build", () => {
  it("builds and approves them as the factory when the project has none", async () => {
    const cfg = project("shop"); addCode(cfg.repo);
    const s = scanner();
    const said: string[] = [];
    expect(await ensureGuidelines(cfg, (m) => said.push(m), s)).toBe("built");
    const got = readApproved("shop");
    expect("conventions" in got && got.conventions.some((c) => c.rule === "Modules export named constants only")).toBe(true);
    expect(approvalOf("shop")).toMatchObject({ by: FACTORY_APPROVER, auto: { scanned: true } });
    expect(said.join("\n")).toMatch(/built and approved by the factory: \d+ rules \(1 from the code/);
    // and never again: the file is there
    expect(await ensureGuidelines(cfg, quiet, s)).toBe("kept");
    expect(s.calls).toBe(1);
  });

  it("a new product with an empty base branch gets them without a model call, and again once the base has code", async () => {
    const cfg = project("fresh");
    const s = scanner();
    // no code and no skill files: there is nothing to make rules from, and a file with no rules is never written
    const said: string[] = [];
    expect(await ensureGuidelines(cfg, (m) => said.push(m), s)).toBe("failed");
    expect(said.join("\n")).toMatch(/nothing to build them from/);
    expect(currentSha("fresh")).toBeUndefined();
    cpSync(join(process.cwd(), ".agents", "skills", "next-best-practices"), join(home, "skills", "next-best-practices"), { recursive: true });
    expect(await ensureGuidelines(cfg, quiet, s)).toBe("built");
    expect(s.calls).toBe(0);
    expect(readApproved("fresh")).toHaveProperty("sha");
    expect(approvalOf("fresh")).toMatchObject({ by: FACTORY_APPROVER, auto: { scanned: false } });
    expect(await ensureGuidelines(cfg, quiet, s)).toBe("kept");

    addCode(cfg.repo);
    expect(await ensureGuidelines(cfg, quiet, s)).toBe("built");
    expect(s.calls).toBe(1);
    expect(approvalOf("fresh")).toMatchObject({ by: FACTORY_APPROVER, auto: { scanned: true } });
    expect(readApproved("fresh")).toHaveProperty("sha");
  });

  it("leaves a file a person built, approved or edited exactly as it is", async () => {
    const s = scanner();
    // built by hand, not approved yet
    const a = project("by-hand"); addCode(a.repo);
    writeGuidelines("by-hand", "# mine\n");
    expect(await ensureGuidelines(a, quiet, s)).toBe("kept");
    expect(approvalOf("by-hand")).toBeUndefined();
    // approved by a person
    recordApproval("by-hand", writeGuidelines("by-hand", "# mine\n"), "sara");
    expect(await ensureGuidelines(a, quiet, s)).toBe("kept");
    expect(approvalOf("by-hand")!.by).toBe("sara");
    // the factory's own file, edited since: unapproved until a person approves it
    const b = project("edited");
    await ensureGuidelines(b, quiet, s);
    appendFileSync(guidelinesPath("edited"), "\nmy own rule\n");
    addCode(b.repo);
    expect(await ensureGuidelines(b, quiet, s)).toBe("kept");
    expect(readApproved("edited")).toEqual({ unapproved: expect.stringMatching(/changed since factory approved/) });
    expect(s.calls).toBe(0);
  });

  it("a build that fails changes nothing and says why; and it can be switched off", async () => {
    const cfg = project("broken"); addCode(cfg.repo);
    const said: string[] = [];
    expect(await ensureGuidelines(cfg, (m) => said.push(m), { scan: async () => { throw new Error("no key"); } })).toBe("failed");
    expect(said.join("\n")).toMatch(/were not built: no key/);
    expect(readApproved("broken")).toEqual({ unapproved: expect.stringMatching(/No coding guidelines/) });

    expect(await ensureGuidelines(cfg, quiet)).toBe("off");
    process.env.FACTORY_NO_AUTO_GUIDELINES = "1";
    try { expect(await ensureGuidelines(cfg, quiet, scanner())).toBe("off"); } finally { delete process.env.FACTORY_NO_AUTO_GUIDELINES; }
  });
});
