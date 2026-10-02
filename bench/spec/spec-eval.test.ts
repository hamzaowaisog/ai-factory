import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import "../../src/gates/predicates.js";
import { _resetEnvCache } from "../../src/config/env.js";
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { setProviderFactory } from "../../src/stages/think.js";
import { createRun, execute } from "../../src/stages/executor.js";
import { EvalCase, hits, loadCases, loadRepos, looseMatchers, strength } from "./case.js";
import { prepareRepo, runCase, writeProject } from "./eval.js";
import { fakeProvider, fakeSpans } from "./fake.js";
import { answer, answerCard } from "./oracle.js";
import { overall, scoreRun, summariseCase, type RunOutcome } from "./score.js";

const CASE = EvalCase.parse({
  id: "demo-cancel-reason", repo: "demo", kind: "feature",
  request: "Patients must give a reason when they cancel an appointment. Show the reason on the appointment.",
  facts: [
    { id: "F1", about: [["reason"], ["required", "optional", "mandatory"]], answer: "The reason is required, at most 500 characters." },
    { id: "F2", about: [["existing", "already"]], answer: "Existing cancelled appointments keep an empty reason." },
  ],
  gaps: [{ id: "G1", match: [["reason"], ["required", "optional", "mandatory"]], fact: "F1" }],
  expect: [
    { id: "E1", match: [["cancel"], ["reason"]] },
    { id: "E2", match: [["reason"], ["shown", "return", "response"]] },
  ],
  forbid: [{ id: "X1", match: [["email", "sms", "notif"]] }],
});

describe("matchers", () => {
  it("needs every group, any alternative, case-insensitive; /re/ is a regex", () => {
    expect(hits([["cancel"], ["reason"]], "When a patient Cancels, the system shall store the REASON.")).toBe(true);
    expect(hits([["cancel"], ["reason"]], "The system shall cancel it.")).toBe(false);
    expect(hits([["/\\b500\\b/"]], "at most 500 characters")).toBe(true);
    expect(hits([["/\\b500\\b/"]], "at most 5000 characters")).toBe(false);
    expect(strength([["reason"], ["required", "mandatory"]], "is a reason required or mandatory")).toBe(3);
  });
  it("rejects a case whose gap names a fact that doesn't exist", () => {
    expect(() => EvalCase.parse({ ...CASE, gaps: [{ id: "G9", match: [["x"]], fact: "F9" }] })).toThrow(/unknown fact F9/);
  });
});

describe("the oracle", () => {
  it("answers from the best matching fact, in the person's words; nothing matching → the recommendation", () => {
    expect(answer({ id: "Q-1", text: "Is the cancellation reason required or optional?", options: ["Required", "Optional"], recommended: "Required" }, CASE.facts))
      .toMatchObject({ fact: "F1", answer: "The reason is required, at most 500 characters." });
    const card = answerCard([
      { id: "Q-1", text: "Is a reason mandatory?", options: ["yes", "no"], recommended: "yes" },
      { id: "Q-2", text: "Which HTTP verb?", options: ["POST", "PATCH"], recommended: "POST" },
    ], CASE.facts);
    expect(card.answers).toEqual({ "Q-1": "The reason is required, at most 500 characters." });
    expect(card.log.map((l) => l.fact)).toEqual(["F1", undefined]);
  });
});

const outcome = (o: Partial<RunOutcome>): RunOutcome => ({
  caseId: CASE.id, repeat: 1, status: "until", message: "", costUsd: 1, wallMs: 60_000, questions: [], assumptions: [], oracle: [], openFindings: [], repairs: 0, ...o,
});
const req = (ears: string, then: string) => ({ id: "REQ-1", ears, acceptance: [{ given: "g", when: "w", then, level: "api" }] });

describe("scoring", () => {
  it("passes a run whose spec holds every expected behaviour and nothing forbidden", () => {
    const s = scoreRun(CASE, outcome({
      spec: { requirements: [req("When a patient cancels, the system shall require a reason.", "the response is 400"), req("The system shall return the reason.", "the response shows the reason")], nfrs: [] },
      questions: [{ text: "Is the reason required?", options: ["yes", "no"] }],
    }));
    expect(s).toMatchObject({ pass: true, expectHit: ["E1", "E2"], forbidHit: [], gapsCaught: ["G1"], requirements: 2, acs: 2 });
  });
  it("an expected behaviour must sit in one requirement; scope creep and stopped runs fail", () => {
    const split = scoreRun(CASE, outcome({ spec: { requirements: [req("The system shall cancel.", "the row is gone"), req("The system shall keep a reason.", "a row exists")], nfrs: [] } }));
    expect(split.expectMiss).toEqual(["E1", "E2"]);
    const creep = scoreRun(CASE, outcome({ spec: { requirements: [req("When a patient cancels, the system shall require a reason and return it.", "an email is sent")], nfrs: [] } }));
    expect(creep).toMatchObject({ pass: false, forbidHit: ["X1"] });
    const parked = scoreRun(CASE, outcome({ status: "parked" }));
    expect(parked).toMatchObject({ completed: false, pass: false });
    // gaps count when raised as an assumption too
    expect(scoreRun(CASE, outcome({ assumptions: ["Is a reason mandatory? → assumed: yes"] })).gapsCaught).toEqual(["G1"]);
  });
  it("summarises repeats: pass rate, per-behaviour hit rate and whether repeats agree", () => {
    const good = { requirements: [req("When a patient cancels, the system shall require a reason.", "the response shows the reason")], nfrs: [] };
    const half = { requirements: [req("When a patient cancels, the system shall require a reason.", "a row is written")], nfrs: [] };
    const scores = [scoreRun(CASE, outcome({ spec: good })), scoreRun(CASE, outcome({ repeat: 2, spec: half, costUsd: 3 }))];
    const sum = summariseCase(CASE, scores);
    expect(sum).toMatchObject({ runs: 2, passRate: 0.5, completedRate: 1, perExpect: { E1: 1, E2: 0.5 }, agreement: 0.5, reqs: { min: 1, max: 1 }, costUsd: { mean: 2, max: 3 } });
    expect(overall([sum])).toMatchObject({ cases: 1, runs: 2, passRate: 0.5, costUsd: 4, costPerRun: 2 });
  });
});

describe("the case files", () => {
  it("all load, name a pinned repo, and plant gaps that a fact settles", () => {
    const repos = loadRepos();
    const cases = loadCases(undefined, repos);
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      expect(c.request.length, c.id).toBeLessThan(1500);
      for (const g of c.gaps) expect(g.fact, `${c.id} ${g.id}`).toBeTruthy();
      expect(looseMatchers(c)).toEqual([]);
      // a fake spec that echoes the request must be scoreable without throwing
      expect(fakeSpans(c.request).length, c.id).toBeGreaterThan(0);
    }
  });
});

// ---------- dry run through the real pipeline, on a local repo ----------
function makeRepo(): { url: string; commit: string } {
  const dir = mkdtempSync(join(tmpdir(), "spec-eval-src-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  mkdirSync(join(dir, "src/Api"), { recursive: true });
  writeFileSync(join(dir, "src/Api/Appointment.cs"), "namespace Api; public class Appointment { public void Cancel() { } }\n");
  writeFileSync(join(dir, "src/Api/Api.csproj"), '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n');
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, env });
  return { url: `file://${dir}`, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim() };
}

describe("a dry run (fake model, no cost)", () => {
  beforeEach(() => {
    process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "spec-eval-home-"));
    writeFileSync(join(process.env.FACTORY_HOME, ".env"), "ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\n", { mode: 0o600 });
    _resetEnvCache();
    setProviderFactory(() => fakeProvider(() => CASE));
  });

  it("runs intake to the final spec, answers the question card from the facts, and stops before plan", async () => {
    const pin = makeRepo();
    const repo = prepareRepo("demo", { url: pin.url, commit: pin.commit });
    writeProject("demo", repo, pin.commit);
    const o = await runCase(CASE, 1, { maxCostUsd: 4 });
    expect(o.status, o.message).toBe("until");
    expect(o.spec?.requirements.length).toBe(2);
    // the fake clarifier asks one question per fact; both are answered from the facts
    expect(o.oracle.map((a) => a.fact)).toEqual(["F1", "F2"]);
    const ledger = Ledger.open(o.runId!);
    const state = replay(ledger.events());
    expect(state.steps.get("specify")?.status).toBe("completed");
    expect(state.steps.has("plan")).toBe(false);
    const recorded = state.decisions.find((d) => d.by === "spec-eval") as unknown as { answers?: Record<string, string> };
    expect(Object.values(recorded.answers ?? {})).toContain("The reason is required, at most 500 characters.");
    const s = scoreRun(CASE, o);
    expect(s).toMatchObject({ completed: true, gapsCaught: ["G1"], questions: 2, answeredFromFacts: 2 });
  });

  it("execute(until) refuses a step the run doesn't have", async () => {
    const pin = makeRepo();
    writeProject("demo", prepareRepo("demo", { url: pin.url, commit: pin.commit }), pin.commit);
    const runId = await createRun(CASE.request, "eval-demo", "t");
    await expect(execute(runId, () => undefined, { until: "no-such-step" })).rejects.toThrow(/No step "no-such-step"/);
  });
});
