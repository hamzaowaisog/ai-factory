// factory watch against fake Jira and Slack servers on localhost: who can start runs, the credit guards,
// the queue, and updates that are sent once and never touch a run.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { _resetEnvCache } from "../config/env.js";
import { loadProject } from "../config/project.js";
import { currentCostCap } from "../ledger/caps.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { createRun } from "../stages/executor.js";
import { JiraClient } from "./jira-client.js";
import { SlackNotifier } from "./notify.js";
import { startFromJira } from "./start.js";
import { loadState } from "./state.js";
import { Watcher, type WatcherDeps } from "./watcher.js";

const LONG = "When an order doesn't exist, GET /orders/{id} must answer 404 Not Found instead of crashing with a 500 error.";
const adf = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
/** Jira-style time, `min` minutes from now */
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString().replace("Z", "+0000");
const ANN = { accountId: "acc-ann", emailAddress: "ann@shop.test", displayName: "Ann" };
const EVE = { accountId: "acc-eve", emailAddress: "eve@else.test", displayName: "Eve" };

interface FakeTicket { key: string; summary: string; description: unknown; issuetype?: { name: string; subtask?: boolean; hierarchyLevel?: number }; labels?: string[]; reporter?: typeof ANN; labelAdds?: { at: string; by: typeof ANN }[] }

/** A small Jira: search, changelog, comments, transitions, one issue. Records what it was asked. */
function fakeJira() {
  const tickets = new Map<string, FakeTicket>();
  const comments = new Map<string, { id: string; body: unknown }[]>();
  const transitions: { key: string; id: string }[] = [];
  let changelogWorks = true;
  let rateLimitOnce = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (status: number, json: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(json)); };
      if (rateLimitOnce) { rateLimitOnce = false; return send(429, {}, { "retry-after": "7" }); }
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/\w+)?$/.exec(url.pathname);
      if (req.method === "POST" && url.pathname === "/rest/api/3/search/jql") {
        const jql = JSON.parse(body).jql as string;
        const label = /labels = "([^"]+)"/.exec(jql)![1]!;
        return send(200, { issues: [...tickets.values()].filter((t) => (t.labels ?? ["factory"]).includes(label)).map((t) => ({
          key: t.key, fields: { summary: t.summary, description: t.description, issuetype: t.issuetype ?? { name: "Bug", subtask: false, hierarchyLevel: 0 }, labels: t.labels ?? ["factory"], reporter: t.reporter ?? ANN },
        })) });
      }
      if (!m) return send(404, {});
      const [, key, sub] = m;
      const t = tickets.get(key!);
      if (!t) return send(404, {});
      if (!sub) return send(200, { key, fields: { summary: t.summary, description: t.description, issuetype: { name: "Bug" }, labels: t.labels ?? ["factory"], status: { name: "To Do" }, comment: { comments: [] } } });
      if (sub === "/changelog") {
        if (!changelogWorks) return send(403, {});
        return send(200, { isLast: true, values: (t.labelAdds ?? []).map((a) => ({ created: a.at, author: a.by, items: [{ field: "labels", fromString: "", toString: "factory" }] })) });
      }
      if (sub === "/comment" && req.method === "GET") return send(200, { comments: comments.get(key!) ?? [] });
      if (sub === "/comment" && req.method === "POST") {
        const list = comments.get(key!) ?? [];
        const c = { id: String(list.length + 1), body: JSON.parse(body).body };
        comments.set(key!, [...list, c]);
        return send(201, c);
      }
      if (sub === "/transitions" && req.method === "GET") return send(200, { transitions: [{ id: "21", name: "In Progress" }, { id: "31", name: "In Review" }] });
      if (sub === "/transitions" && req.method === "POST") { transitions.push({ key: key!, id: JSON.parse(body).transition.id }); return send(204, {}); }
      return send(404, {});
    });
  });
  return {
    server, tickets, comments, transitions,
    breakChangelog() { changelogWorks = false; },
    rateLimit() { rateLimitOnce = true; },
    commentTexts: (key: string) => (comments.get(key) ?? []).map((c) => JSON.stringify(c.body)),
  };
}

function fakeSlack(status = 200) {
  const got: { text: string; blocks: unknown[] }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { got.push(JSON.parse(body)); res.writeHead(status); res.end(status === 200 ? "ok" : "no"); });
  });
  return { server, got };
}

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

let jira: ReturnType<typeof fakeJira>;
let slack: ReturnType<typeof fakeSlack>;
let jiraUrl: string, slackUrl: string;
let executed: string[];
let clock: Date;

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-watch-repo-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
  writeFileSync(join(dir, "README.md"), "shop\n");
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, env });
  return dir;
}

beforeEach(async () => {
  const home = mkdtempSync(join(tmpdir(), "factory-watch-"));
  process.env.FACTORY_HOME = home;
  jira = fakeJira();
  slack = fakeSlack();
  jiraUrl = `http://127.0.0.1:${await listen(jira.server)}`;
  slackUrl = `http://127.0.0.1:${await listen(slack.server)}`;
  writeFileSync(join(home, ".env"), `ANTHROPIC_API_KEY=sk-ant-test-not-real-000000000000\nJIRA_BASE_URL=${jiraUrl}\nJIRA_EMAIL=bot@shop.test\nJIRA_API_TOKEN=tok-0123456789\nSLACK_WEBHOOK=${slackUrl}/hook\n`, { mode: 0o600 });
  _resetEnvCache();
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "shop-api.yaml"), stringify({
    project: "shop-api", repo: repo(), stack: "dotnet",
    jira: { project: "SHOP", allowedReporters: ["acc-ann"], transitions: { started: "In Progress" }, dailyBudgetUsd: 10, monthlyBudgetUsd: 100, maxRunsPerDay: 3 },
    notify: { slackWebhookEnv: "SLACK_WEBHOOK" },
  }));
  executed = [];
  // runs are created with the real clock, so the watcher's clock starts at the real now
  clock = new Date();
});
afterEach(() => { jira.server.close(); slack.server.close(); });

/** A watcher whose runs are real ledgers; "starting" a run only creates it (its executor is a stub). */
function watcher(over: Partial<WatcherDeps> = {}) {
  const cfg = loadProject("shop-api");
  return new Watcher("shop-api", cfg.jira!, {
    jira: new JiraClient(),
    notifiers: [new SlackNotifier(`${slackUrl}/hook`)],
    start: async (key) => {
      const runId = await createRun(`Jira ${key}: ${LONG}`, "shop-api", "factory watch", { maxCostUsd: cfg.jira!.maxCostPerRun, sources: [{ kind: "jira", key, url: `${jiraUrl}/browse/${key}`, summary: "s" }] });
      executed.push(runId);
      return runId;
    },
    execute: (id) => executed.push(id),
    lockFree: async () => true,
    now: () => clock,
    ...over,
  });
}
const ticket = (key: string, over: Partial<FakeTicket> = {}) => jira.tickets.set(key, { key, summary: "Return 404 for a missing order", description: adf(LONG), labelAdds: [{ at: at(-1), by: ANN }], ...over });
const toCard = async (runId: string) => {
  const l = Ledger.open(runId);
  await l.append({ type: "human.requested", data: { cardId: "approval-x", kind: "approval", artifactSha: "a".repeat(64), step: "approve" } }, HUMAN_WRITER);
};

describe("who can start a run", () => {
  it("an allowed person adding the label starts one run; someone else's label starts nothing and gets no comment", async () => {
    ticket("SHOP-1");
    ticket("SHOP-2", { labelAdds: [{ at: at(-1), by: EVE }] });
    const r = await watcher().tick();
    expect(r.started).toBeDefined();
    expect(executed).toEqual([r.started]);
    expect(loadState("shop-api").seen["SHOP-1"]!.runId).toBe(r.started);
    // one run per tick; SHOP-2 is looked at next time, after SHOP-1's run stops at a card
    await toCard(r.started!);
    const r2 = await watcher().tick();
    expect(r2.started).toBeUndefined();
    expect(r2.skipped).toEqual(["SHOP-2"]);
    expect(loadState("shop-api").seen["SHOP-2"]!.skipped).toMatch(/isn't on the allowed list/);
    expect(jira.commentTexts("SHOP-2")).toEqual([]);
  });

  it("when the label history can't be read, the reporter decides, and the log says so", async () => {
    jira.breakChangelog();
    ticket("SHOP-3", { reporter: ANN });
    const w = watcher({ jira: Object.assign(new JiraClient(), { lastLabelAdd: async () => undefined }) });
    const r = await w.tick();
    expect(r.started).toBeDefined();
    expect(loadState("shop-api").log.map((l) => l.msg).join("\n")).toMatch(/reported it \(the label history wasn't available\)/);
  });
});

describe("a ticket starts once", () => {
  it("the seen-set survives a restart, and editing a ticket never re-runs it", async () => {
    ticket("SHOP-1");
    const first = await watcher().tick();
    await toCard(first.started!);
    const again = await watcher().tick(); // a new watcher, as after a restart
    expect(again.started).toBeUndefined();
    expect(executed).toEqual([first.started]);
    // the run finishes; the ticket is edited but the label isn't re-added: still no new run
    const l = Ledger.open(first.started!);
    await l.append({ type: "run.stopped" }, HUMAN_WRITER);
    expect((await watcher().tick()).started).toBeUndefined();
    // re-adding the label after the run closed is the way to run it again
    clock = new Date(Date.now() + 60 * 60_000);
    jira.tickets.get("SHOP-1")!.labelAdds!.push({ at: at(30), by: ANN });
    expect((await watcher().tick()).started).toBeDefined();
  });
});

describe("the queue: one run per repo at a time", () => {
  it("a second ticket waits until the first run stops at a card", async () => {
    ticket("SHOP-1");
    ticket("SHOP-4");
    const r1 = await watcher().tick();
    const r2 = await watcher().tick();
    expect(r2.started).toBeUndefined();
    expect(r2.blocked).toMatch(/still working/);
    await toCard(r1.started!);
    const r3 = await watcher().tick();
    expect(r3.started).toBeDefined();
    expect(loadState("shop-api").seen["SHOP-4"]!.runId).toBe(r3.started);
  });

  it("another run holding the repo (e.g. one started by hand) also holds the queue", async () => {
    ticket("SHOP-1");
    const r = await watcher({ lockFree: async () => false }).tick();
    expect(r.started).toBeUndefined();
    expect(r.blocked).toMatch(/holds this repo/);
  });
});

describe("credit guards, checked before anything costs money", () => {
  it("every run gets the per-ticket limit, which lowers the normal $10 minimum", async () => {
    ticket("SHOP-1");
    const runId = await startFromJira("shop-api", "SHOP-1", 3, (id) => executed.push(id));
    const s = replay(Ledger.open(runId).events());
    expect(s.info.maxCostUsd).toBe(3);
    expect(currentCostCap(s)).toBe(3);
    expect(s.info.request).toContain("Jira SHOP-1:");
    expect(executed).toEqual([runId]);
  });

  it("epics, sub-tasks and short descriptions are skipped for free, with one comment each", async () => {
    ticket("SHOP-5", { issuetype: { name: "Epic", hierarchyLevel: 1 } });
    ticket("SHOP-6", { issuetype: { name: "Sub-task", subtask: true, hierarchyLevel: -1 } });
    ticket("SHOP-7", { description: adf("Fix it") });
    const r = await watcher().tick();
    expect(r.started).toBeUndefined();
    expect(r.skipped.sort()).toEqual(["SHOP-5", "SHOP-6", "SHOP-7"]);
    expect(jira.commentTexts("SHOP-5")[0]).toMatch(/epic/);
    expect(jira.commentTexts("SHOP-6")[0]).toMatch(/sub-task/);
    expect(jira.commentTexts("SHOP-7")[0]).toMatch(/description is too short/);
    await watcher().tick();
    for (const k of ["SHOP-5", "SHOP-6", "SHOP-7"]) expect(jira.commentTexts(k)).toHaveLength(1);
  });

  it("a used-up budget starts nothing, says so once, and leaves the ticket for later", async () => {
    // an earlier watcher run today spent $10
    ticket("SHOP-1");
    const first = await watcher().tick();
    const l = Ledger.open(first.started!);
    await l.append({ type: "usage", key: "plan/1", data: { "gen_ai.usage.cost_usd": 10 } }, HUMAN_WRITER);
    await toCard(first.started!);
    ticket("SHOP-8");
    const r = await watcher().tick();
    expect(r.started).toBeUndefined();
    expect(r.blocked).toMatch(/today's budget of \$10 is used/);
    expect(loadState("shop-api").seen["SHOP-8"]).toBeUndefined();
    expect(jira.commentTexts("SHOP-8")[0]).toMatch(/didn't start this ticket yet/);
    const notices = slack.got.filter((m) => m.text === "The factory paused new runs");
    expect(notices).toHaveLength(1);
    await watcher().tick();
    expect(slack.got.filter((m) => m.text === "The factory paused new runs")).toHaveLength(1);
    expect(jira.commentTexts("SHOP-8")).toHaveLength(1);
    // the next day it starts
    clock = new Date(Date.now() + 24 * 60 * 60_000);
    expect((await watcher().tick()).started).toBeDefined();
  });

  it("at most maxRunsPerDay runs a day", async () => {
    for (let i = 1; i <= 4; i++) ticket(`SHOP-${10 + i}`);
    for (let i = 0; i < 3; i++) { const r = await watcher().tick(); expect(r.started).toBeDefined(); await toCard(r.started!); }
    const r = await watcher().tick();
    expect(r.started).toBeUndefined();
    expect(r.blocked).toMatch(/daily limit of 3 runs/);
  });
});

describe("updates to Jira and Slack", () => {
  it("started and card updates go out once, with the command, and move the ticket", async () => {
    ticket("SHOP-1");
    const r = await watcher().tick();
    expect(jira.commentTexts("SHOP-1").join()).toMatch(/started run/);
    expect(jira.transitions).toEqual([{ key: "SHOP-1", id: "21" }]);
    expect(slack.got.map((m) => m.text)).toEqual(["SHOP-1: the factory started a run"]);
    await toCard(r.started!);
    await watcher().tick();
    await watcher().tick();
    expect(slack.got.map((m) => m.text)).toEqual(["SHOP-1: the factory started a run", "SHOP-1: a approval card is waiting for you"]);
    expect(JSON.stringify(slack.got[1]!.blocks)).toContain(`factory show-card ${r.started}`);
    expect(jira.commentTexts("SHOP-1")).toHaveLength(2);
    expect(jira.commentTexts("SHOP-1")[1]).toContain(`factory show-card ${r.started}`);
  });

  it("a Jira comment posted just before a crash is found by its marker, not posted twice", async () => {
    ticket("SHOP-1");
    const client = new JiraClient();
    let crash = true;
    const crashy = Object.assign(Object.create(client) as JiraClient, {
      base: client.base,
      addComment: async (key: string, body: unknown) => { const id = await client.addComment(key, body); if (crash) { crash = false; throw new Error("process died after posting"); } return id; },
    });
    await watcher({ jira: crashy }).tick();
    expect(Object.values(loadState("shop-api").runs)[0]!.updates["jira:started"]).toMatchObject({ status: "failed", tries: 1 });
    await watcher({ jira: crashy }).tick();
    expect(jira.commentTexts("SHOP-1").filter((c) => c.includes("started run"))).toHaveLength(1);
    expect(Object.values(loadState("shop-api").runs)[0]!.updates["jira:started"]!.status).toBe("done");
  });

  it("a Slack failure never touches the run, and is retried a few times at most", async () => {
    slack.server.close();
    slack = fakeSlack(500);
    const bad = `http://127.0.0.1:${await listen(slack.server)}/hook`;
    ticket("SHOP-1");
    const w = () => watcher({ notifiers: [new SlackNotifier(bad)] });
    const r = await w().tick();
    const before = Ledger.open(r.started!).events().length;
    for (let i = 0; i < 4; i++) await w().tick();
    expect(slack.got).toHaveLength(3);
    expect(Object.values(loadState("shop-api").runs)[0]!.updates["slack:started"]).toMatchObject({ status: "failed", tries: 3 });
    expect(Ledger.open(r.started!).events().length).toBe(before); // the watcher never writes to a run's ledger
    expect(jira.commentTexts("SHOP-1").length).toBeGreaterThan(0); // Jira still got its update
  });

  it("Jira's slow-down answer (429) is respected", async () => {
    ticket("SHOP-1");
    jira.rateLimit();
    const r = await watcher().tick();
    expect(r.retryAfterSec).toBe(7);
    expect(r.started).toBeUndefined();
  });
});

describe("safety", () => {
  it("no watcher without a jira block; missing Slack secret means no Slack", async () => {
    const { watcherFor } = await import("./start.js");
    writeFileSync(join(process.env.FACTORY_HOME!, "projects", "plain.yaml"), stringify({ project: "plain", repo: repo(), stack: "dotnet" }));
    expect(() => watcherFor("plain")).toThrow(/no "jira:" block/);
    const { notifiersFor } = await import("./notify.js");
    expect(notifiersFor({ slackWebhookEnv: "NOT_SET" })).toEqual([]);
    expect(notifiersFor({})).toEqual([]);
  });
});
