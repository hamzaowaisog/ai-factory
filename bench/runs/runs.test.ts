import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../../src/ledger/ledger.js";
import { changesOf, openRun, rowOf } from "./row.js";
import { baselineRow, compareTable, markdown } from "./run.js";

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function repo(): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), "runs-repo-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, encoding: "utf8" });
  const put = (p: string, t: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); };
  git("init", "-q", "-b", "main");
  put("src/Api/Cancel.cs", "a\nb\nc\n");
  git("add", "-A"); git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  git("checkout", "-q", "-b", "factory/r1");
  put("src/Api/Cancel.cs", "a\nB\nc\nd\n");
  put("tests/Api.Tests/CancelTests.cs", "t1\nt2\nt3\n");
  put(".factory/evidence-manifest.json", "{}\n");
  git("add", "-A"); git("commit", "-q", "-m", "change");
  git("checkout", "-q", "main");
  return { dir, base };
}

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "runs-home-")); });

describe("run rows from the ledger", () => {
  it("lines: production added+removed, tests added; the evidence manifest doesn't count", () => {
    const { dir, base } = repo();
    expect(changesOf(dir, base, "factory/r1")).toEqual({ prodLines: 3, prodFiles: 1, testLinesAdded: 3, testFiles: 1, files: ["src/Api/Cancel.cs", "tests/Api.Tests/CancelTests.cs"] });
    expect(changesOf(dir, base, "no-such-branch")).toBeUndefined();
  });

  it("a row: commit, size, lane, risk, impact, cost per step, locked tests, card waits, outcome", async () => {
    const { dir, base } = repo();
    const l = Ledger.create("r1");
    const at = (s: number) => new Date(Date.UTC(2026, 9, 4, 0, 0, s)).toISOString();
    await l.append({ type: "run.created", data: { mode: "brownfield", project: "vsa", request: "Cancel a completed appointment gives 409", repoPath: dir, baseRef: "main", baseCommit: base, versions: { commit: "abc1234" } } }, HUMAN_WRITER);
    const done = async (step: string, out: unknown, data: Record<string, unknown> = {}) => {
      const o = l.putJson(out);
      await l.append({ type: "step.started", key: `${step}/1`, inputsHash: "a".repeat(64) }, HUMAN_WRITER);
      await l.append({ type: "step.completed", key: `${step}/1`, inputsHash: "a".repeat(64), outputs: [o], data: { ...data, named: { [step]: o } } }, HUMAN_WRITER);
    };
    await done("intake", { risk: "low", rigor: "light", changeClass: "bugfix" });
    await l.append({ type: "usage", key: "intake/1", data: { "gen_ai.request.model": "claude-haiku-4-5", "gen_ai.usage.input_tokens": 1000, "gen_ai.usage.output_tokens": 100, "gen_ai.usage.cache_read_tokens": 0, "gen_ai.usage.cache_write_tokens": 0, "gen_ai.usage.cost_usd": 0.01 } }, HUMAN_WRITER);
    await done("impact", {}, { risk: "low", counts: { breaks: 0, check: 3 } });
    await done("plan", {}, { complexity: "S", taskCount: 1, tasks: ["TASK-1"] });
    await l.append({ type: "human.requested", ts: at(0), data: { cardId: "approval-1", kind: "approval", artifactSha: "x" } } as never, HUMAN_WRITER);
    await l.append({ type: "human.decided", ts: at(90), data: { cardId: "approval-1", decision: "approve", by: "me" } } as never, HUMAN_WRITER);
    await done("accept", { items: [{ ac: "AC-1.1", kind: "http", testIds: ["t1"], passed: true }, { ac: "AC-1.2", kind: "http", testIds: ["t2"], passed: false }, { ac: "AC-2.1", kind: "manual", testIds: [], passed: false }] });
    await l.append({ type: "workspace.created", data: { path: dir, branch: "factory/r1" } }, HUMAN_WRITER);
    const row = rowOf(l);
    expect(row).toMatchObject({
      kind: "factory", runId: "r1", factoryCommit: "abc1234", project: "vsa", ticket: "Cancel a completed appointment gives 409",
      repo: { baseRef: "main", baseCommit: base }, size: "S", lane: "light", risk: { intake: "low", impact: "low" }, impact: { breaks: 0, check: 3 },
      lockedTests: { total: 2, passed: 1, failed: ["AC-1.2"] }, cards: [{ kind: "approval", decision: "approve" }],
      changes: { prodLines: 3, testLinesAdded: 3 },
    });
    expect(row.steps.find((s) => s.step === "intake")).toMatchObject({ costUsd: 0.01, tokens: { input: 1000, output: 100 }, attempts: 1 });
    // an older run without a recorded commit takes one from the command line
    expect(rowOf(l, { factoryCommit: "1c48558" }).factoryCommit).toBe("1c48558");
    // the same run read from its archive
    const tgz = join(mkdtempSync(join(tmpdir(), "runs-tgz-")), "r1.tar.gz");
    execFileSync("tar", ["-czf", tgz, "-C", dirname(l.dir), "r1"]);
    expect(rowOf(openRun(tgz))).toMatchObject({ runId: "r1", lockedTests: { passed: 1 } });
  });

  it("a plain Claude Code result is a row of the same shape; compare and md print them", () => {
    const b = baselineRow({ total_cost_usd: 0.19, duration_ms: 24_000, num_turns: 6, subtype: "success", modelUsage: { "claude-sonnet-5": {} } }, "claude-code", { prodLines: 4, prodFiles: 2, testLinesAdded: 0, testFiles: 0, files: [] });
    expect(b).toMatchObject({ kind: "baseline", outcome: "success", costUsd: 0.19, activeMin: 0.4, turns: 6, models: ["claude-sonnet-5"] });
    const f = { kind: "factory" as const, runId: "r1", ticket: "t", project: "vsa", repo: {}, outcome: "delivered", risk: {}, steps: [{ step: "plan", costUsd: 0.2, tokens: { input: 10, cached: 62000, output: 3400 }, minutes: 0.5, attempts: 1, retryReasons: [], gateFailures: 0, models: ["claude-opus-5-5"] }], costUsd: 2.24, activeMin: 14.6, cards: [], models: ["claude-opus-5-5"], lockedTests: { total: 9, passed: 9, failed: [] }, changes: { prodLines: 15, prodFiles: 4, testLinesAdded: 555, testFiles: 5, files: [] } };
    const t = compareTable([f, b]);
    expect(t.split("\n")[1]).toMatch(/^r1\s+factory\s+delivered\s+\$2\.24\s+14\.6\s+15\/4\s+555\/5\s+9\/9/);
    expect(t.split("\n")[2]).toMatch(/^claude-code\s+baseline\s+success\s+\$0\.19\s+0\.4\s+4\/2\s+0\/0\s+-/);
    const md = markdown(f);
    expect(md).toContain("| Recorded cost | $2.24 |");
    expect(md).toContain("| plan | $0.20 | 10 / 62.0K / 3.4K | 0.5 | 1 | 0 | claude-opus-5-5 |");
    expect(md).toContain("| Factory | not recorded |");
  });
});
