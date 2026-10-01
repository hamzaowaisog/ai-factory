import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { createRun } from "../stages/executor.js";
import { answerOpenQuestions, formatQuestion } from "./interactive.js";

let home = "";
const prev = process.env.FACTORY_HOME;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "interactive-"));
  process.env.FACTORY_HOME = home;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const repo = mkdtempSync(join(tmpdir(), "interactive-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  writeFileSync(join(repo, "a.txt"), "x");
  execFileSync("git", ["add", "-A"], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo, env });
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "web.yaml"), stringify({ project: "web", repo, stack: "dotnet" }));
});
afterAll(() => { process.env.FACTORY_HOME = prev; rmSync(home, { recursive: true, force: true }); });

const asked = [
  { id: "Q-1", text: "Who can refund?", options: ["Support only", "Support and finance"], recommended: "Support only", reason: "smaller", impactReason: "money", impact: 3, uncertainty: 3, score: 9, category: "roles", spans: [] },
  { id: "Q-2", text: "Keep history?", options: ["Yes", "No"], recommended: "Yes", reason: "usual", impactReason: "data", impact: 2, uncertainty: 2, score: 4, category: "scope", spans: [] },
];

async function waitingRun(): Promise<Ledger> {
  const id = await createRun("Build an order portal", "web", "tester", { mode: "estimate" } as never);
  const l = Ledger.open(id);
  const sha = l.putJson({ key: "clarify", asked, assumptions: [] });
  l.writeCard(`questions-1-${sha.slice(0, 8)}`, "# Questions");
  await l.append({ type: "step.started", key: "clarify/1", data: { rung: 0 } } as never, HUMAN_WRITER);
  await l.append({ type: "step.interrupted", key: "clarify/1", data: { reason: "waiting" } } as never, HUMAN_WRITER);
  await l.append({ type: "human.requested", data: { cardId: `questions-1-${sha.slice(0, 8)}`, kind: "question", artifactSha: sha, step: "clarify" } } as never, HUMAN_WRITER);
  return l;
}

describe("answering questions in the terminal", () => {
  it("shows each question with its options and the recommended one", () => {
    const text = formatQuestion(asked[0]! as never, 1, 2).join("\n");
    expect(text).toContain("Question 1 of 2");
    expect(text).toContain("B. Support and finance");
    expect(text).toContain("<- recommended");
  });

  it("asks every question, takes Enter as the recommended option, and records one answer decision", async () => {
    const l = await waitingRun();
    const replies = ["B", ""];
    const shown: string[] = [];
    const did = await answerOpenQuestions(l, { ask: async () => replies.shift() ?? "", out: (m) => shown.push(m) });
    expect(did).toBe(true);
    expect(shown.join("\n")).toContain("-> Support and finance");
    const s = replay(l.events());
    expect(s.openCard).toBeUndefined();
    expect(s.decisions.at(-1)).toMatchObject({ decision: "answer" });
    expect((s.decisions.at(-1) as unknown as { answers: Record<string, string> }).answers).toEqual({ "Q-1": "B", "Q-2": "Yes" });
  });

  it("does nothing when no question card is open", async () => {
    const l = await waitingRun();
    await answerOpenQuestions(l, { ask: async () => "", out: () => undefined });
    expect(await answerOpenQuestions(l, { ask: async () => { throw new Error("should not ask"); }, out: () => undefined })).toBe(false);
  });

  it("stops asking and carries on when the web form answers the same card first", async () => {
    const l = await waitingRun();
    const shown: string[] = [];
    const io = {
      ask: (_p: string, signal?: AbortSignal) => new Promise<string>((_res, rej) => {
        signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        // the "web" answers while the terminal is waiting
        void l.append({ type: "human.decided", data: { cardId: replay(l.events()).openCard!.cardId, decision: "answer", by: "Sam (via web)", artifactSha: replay(l.events()).openCard!.artifactSha, answers: {} } } as never, HUMAN_WRITER);
      }),
      out: (m: string) => shown.push(m),
    };
    expect(await answerOpenQuestions(l, io, 20)).toBe(true);
    expect(shown.join("\n")).toContain("answered elsewhere");
    expect(replay(l.events()).decisions).toHaveLength(1);
  });
});
