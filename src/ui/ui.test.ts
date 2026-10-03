// factory ui: the server's safety rules, its JSON for a fixture ledger, and starting a run.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { _resetEnvCache } from "../config/env.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { outcomes, scoreRun, stageStats } from "../report.js";
import { ensurePackage } from "../stages/design-export.js";
import { createRun } from "../stages/executor.js";
import { cardCommands } from "./data.js";
import { createUiServer, listen, MAX_BODY_BYTES, MAX_UPLOAD_BODY_BYTES, ROUTES, staticDir, type UiServer } from "./server.js";
import { _resetStarting } from "./start.js";
import { ensureStandaloneProject } from "../config/project.js";
// the page's Markdown renderer (plain browser JS, no DOM needed)
import { renderMarkdown } from "./static/md.js";
import { findChromium } from "../design/screenshots.js";

const TOKEN = "test-token-0123456789abcdef";
const PKEY = "preview-key-0123456789abcd";
const SECRET = "sk-ant-test-not-real-000000000000";
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-ui-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env: gitEnv });
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, env: gitEnv });
  return dir;
}

const WEB_REPO = {
  "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0", "@radix-ui/react-slot": "1.0.0" } }),
  "src/app/page.tsx": `import { Button } from "@/components/ui/button";\nexport default function Home() { return <main><h1>Welcome</h1><Button>Go</Button></main>; }\n`,
  "src/app/orders/page.tsx": `export default function Orders() { return <h1>Orders</h1>; }\n`,
  "src/components/ui/button.tsx": `export function Button(p: { children: unknown }) { return <button className="px-2">{p.children as string}</button>; }\n`,
  "src/Api/Api.csproj": "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>\n",
};

let home: string;
let ui: UiServer;
let port: number;
let started: string[];
let ids: { delivered: string; waiting: string; parked: string };

async function addEvents(runId: string, evs: Parameters<Ledger["append"]>[0][]) {
  const l = Ledger.open(runId);
  for (const e of evs) await l.append(e, HUMAN_WRITER);
  return l;
}

const step = (key: string, costUsd = 0.5, data: Record<string, unknown> = {}, outputs: string[] = []): Parameters<Ledger["append"]>[0][] => [
  { type: "step.started", key: `${key}/1`, data: { rung: 0 } },
  { type: "usage", key: `${key}/1`, data: { "gen_ai.request.model": "claude-test", "gen_ai.usage.cost_usd": costUsd, "gen_ai.usage.input_tokens": 1000, "gen_ai.usage.output_tokens": 100 } },
  { type: "step.completed", key: `${key}/1`, outputs, data },
];

async function fixture() {
  // delivered: every step, one retry in the task, a local branch and PR text
  const delivered = await createRun("Show the order count on the orders page\n\nKeep the heading.", "web", "tester", { sources: [{ kind: "prompt" }] });
  const dl = Ledger.open(delivered);
  const planSha = dl.putJson({ tasks: [{ id: "TASK-1", fileScope: ["src/app/orders/page.tsx"] }] });
  const failSha = dl.putJson([{ check: "build", message: "CS1002: ; expected in Orders.cs", frames: [] }]);
  await addEvents(delivered, [
    ...["discover", "intake", "ground", "clarify", "specify"].flatMap((k) => step(k)),
    ...step("plan", 1, { tasks: ["TASK-1"], complexity: "S" }, [planSha]),
    ...step("approve", 0),
    { type: "step.started", key: "implement/TASK-1/1", data: { rung: 0 } },
    { type: "usage", key: "implement/TASK-1/1", data: { "gen_ai.usage.cost_usd": 0.75 } },
    { type: "step.failed", key: "implement/TASK-1/1", outputs: [failSha], data: { category: "build", signature: "abc", rung: 0, action: "retry", nextRung: 1, reason: "same rung, fresh attempt" } },
    { type: "step.started", key: "implement/TASK-1/2", data: { rung: 1 } },
    { type: "step.completed", key: "implement/TASK-1/2", data: {} },
    ...["integrate", "accept", "review"].flatMap((k) => step(k, 0.25)),
    { type: "workspace.created", data: { path: "/tmp/wt", branch: `factory/${delivered}` } },
    ...step("deliver", 0, { local: true, branch: `factory/${delivered}`, head: "a".repeat(40) }),
    { type: "run.delivered", data: { local: true, branch: `factory/${delivered}` } },
  ]);
  dl.writeCard(`pr-${delivered}`, "# factory: show the order count\n\n## What changed\n- orders page");

  // waiting on the approval card, whose text tries to inject a script
  const waiting = await createRun("Rename the orders heading", "web", "tester");
  const wl = Ledger.open(waiting);
  const bundle = "b".repeat(64);
  wl.putJson({ tasks: [{ id: "TASK-1", fileScope: ["src/app/orders/page.tsx"] }] }); // same plan, same sha
  wl.writeCard(`approval-${bundle.slice(0, 8)}`, [
    "# Approve the spec and plan", "", "> Rename <script>alert(1)</script> the heading", "",
    "UI size: **screen tweak** (src/app/orders/page.tsx: edits an existing screen). Design work: none.", "",
    "## Decide", `  factory approve ${waiting} <hash> --note "your risk note"`, `  factory reject  ${waiting} <hash> --reason "why"`, "", `Card hash: ${bundle.slice(0, 8)}`,
  ].join("\n"));
  await addEvents(waiting, [
    ...["discover", "intake", "ground", "clarify", "specify"].flatMap((k) => step(k)),
    ...step("plan", 1, { tasks: ["TASK-1"], complexity: "S" }, [planSha]),
    { type: "step.started", key: "approve/1", data: { rung: 0 } },
    { type: "step.interrupted", key: "approve/1", data: { reason: "waiting" } },
    { type: "human.requested", data: { cardId: `approval-${bundle.slice(0, 8)}`, kind: "approval", artifactSha: bundle, step: "approve" } },
  ]);

  // parked in review
  const parked = await createRun("Add an export button", "web", "tester");
  await addEvents(parked, [
    ...["discover", "intake"].flatMap((k) => step(k)),
    { type: "step.started", key: "ground/1", data: { rung: 0 } },
    { type: "step.failed", key: "ground/1", data: { category: "other", signature: "park", rung: 0, parked: true } },
    { type: "run.parked", data: { reason: "The request names a page that doesn't exist", step: "ground" } },
  ]);
  return { delivered, waiting, parked };
}

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string; json: () => any }

function call(path: string, o: { method?: string; headers?: Record<string, string>; body?: string; token?: string | null } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, ...(o.token === null ? {} : { "X-Factory-Token": o.token ?? TOKEN }), ...o.headers };
    const req = httpRequest({ host: "127.0.0.1", port, path, method: o.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
      });
    });
    req.on("error", reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  call("/api/runs", { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "factory-ui-"));
  process.env.FACTORY_HOME = home;
  writeFileSync(join(home, ".env"), `ANTHROPIC_API_KEY=${SECRET}\n`, { mode: 0o600 });
  _resetEnvCache();
  _resetStarting();
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "web.yaml"), stringify({ project: "web", repo: makeRepo(WEB_REPO), stack: "dotnet" }));
  writeFileSync(join(home, "projects", "api.yaml"), stringify({ project: "api", repo: makeRepo({ "src/Api/Greeter.cs": "namespace Api;\n" }), stack: "dotnet" }));
  ids = await fixture();
  started = [];
  ui = createUiServer({ token: TOKEN, previewKey: PKEY, deps: { execute: (id) => started.push(id) } });
  port = await listen(ui, 0);
});

afterEach(async () => {
  await new Promise((r) => ui.server.close(r));
});

describe("factory ui: who can talk to it", () => {
  it("every API call needs the key; the link's key becomes an HttpOnly cookie", async () => {
    expect((await call("/api/runs", { token: null })).status).toBe(401);
    expect((await call("/api/runs", { token: "wrong" })).status).toBe(401);
    expect((await call("/api/runs")).status).toBe(200);
    expect((await call("/", { token: null })).status).toBe(401);
    expect((await call("/?t=wrong", { token: null })).status).toBe(401);
    const first = await call(`/?t=${TOKEN}`, { token: null });
    expect(first.status).toBe(302);
    const cookie = String(first.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const jar = cookie.split(";")[0]!;
    expect((await call("/", { token: null, headers: { Cookie: jar } })).body).toContain("<main id=\"view\"");
    expect((await call("/api/runs", { token: null, headers: { Cookie: jar } })).status).toBe(200);
  });

  it("a wrong Host or another site's Origin is refused", async () => {
    expect((await call("/api/runs", { headers: { Host: "evil.example:80" } })).status).toBe(403);
    expect((await call("/api/runs", { headers: { Host: `attacker.test:${port}` } })).status).toBe(403);
    expect((await call("/api/runs", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("/api/runs", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect((await post({ project: "web", prompt: "Rename the orders heading please" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/runs", { headers: { Host: `localhost:${port}` } })).status).toBe(200);
    expect(started).toEqual([]);
  });

  it("a POST needs JSON, and a cookie alone isn't enough without a same-site Origin", async () => {
    const jar = String((await call(`/?t=${TOKEN}`, { token: null })).headers["set-cookie"]).split(";")[0]!;
    const noOrigin = await call("/api/runs", { method: "POST", token: null, headers: { Cookie: jar, "Content-Type": "application/json" }, body: "{}" });
    expect(noOrigin.status).toBe(403);
    const form = await call("/api/runs", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: `http://127.0.0.1:${port}` }, body: "project=web" });
    expect(form.status).toBe(415);
  });

  it("security headers and no secrets in any answer", async () => {
    const page = await call("/", { headers: { Cookie: `factory_ui=${TOKEN}` } });
    expect(page.headers["content-security-policy"]).toMatch(/script-src 'self'/);
    expect(page.headers["x-frame-options"]).toBe("DENY");
    for (const p of ["/api/projects", "/api/runs", `/api/runs/${ids.delivered}`, `/api/runs/${ids.waiting}`, `/api/runs/${ids.delivered}/design`, "/api/dashboard"]) {
      const r = await call(p);
      expect(r.status, p).toBe(200);
      expect(r.body).not.toContain(SECRET);
    }
  });
});

describe("factory ui: no decisions from the web", () => {
  it("the route list has no decision routes; the only write starts a run", () => {
    const decision = /approve|reject|answer|waive|unlock|steer|pause|stop|resume|decide|decision|cap|note/i;
    for (const r of ROUTES.filter((r) => !r.path.endsWith("/estimate-decision") && !r.path.endsWith("/estimate-answers"))) expect(`${r.method} ${r.path}`).not.toMatch(decision);
    // the one exception: the estimate lead's approve or reject, on estimate cards only (and exporting an approved design or generating
    // its scaffold, which write only under the run's exports/ and scaffold/)
    expect(ROUTES.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/runs", "POST /api/check-refs", "POST /api/runs/:id/estimate-decision", "POST /api/runs/:id/estimate-answers", "POST /api/runs/:id/exports", "POST /api/runs/:id/scaffold"]);
  });

  it("decision-looking URLs don't exist", async () => {
    for (const p of [`/api/runs/${ids.waiting}/approve`, `/api/runs/${ids.waiting}/answer`, `/api/runs/${ids.waiting}/stop`]) {
      expect((await call(p, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: "{}" })).status).toBe(404);
    }
    expect(replay(Ledger.open(ids.waiting).events()).openCard?.kind).toBe("approval");
  });

  it("the page says so, and has no decision buttons", () => {
    const html = readFileSync(join(staticDir(), "index.html"), "utf8");
    expect(html).toContain("Plan decisions are made in your terminal, so no AI or script can approve its own plan. Only the estimate lead can approve an estimate here.");
    const js = readFileSync(join(staticDir(), "app.js"), "utf8");
    expect(js).not.toMatch(/method: "POST"[^\n]*\/(approve|reject|answer|waive|stop|pause)/);
    // the only raw HTML the page writes is the escaped Markdown renderer's output
    expect(js.match(/innerHTML/g)).toHaveLength(1);
    expect(js).toContain("el.innerHTML = renderMarkdown(text)");
  });
});

describe("factory ui: what the screens show", () => {
  it("runs list", async () => {
    const rows = (await call("/api/runs")).json() as any[];
    expect(rows).toHaveLength(3);
    const by = Object.fromEntries(rows.map((r) => [r.runId, r]));
    expect(by[ids.delivered]).toMatchObject({ project: "web", status: "delivered", step: "deliver", request: "Show the order count on the orders page" });
    expect(by[ids.delivered].costUsd).toBeCloseTo(0.5 * 5 + 1 + 0.75 + 0.25 * 3);
    expect(by[ids.waiting]).toMatchObject({ status: "waiting", openCard: "approval", step: "approve" });
    expect(by[ids.parked]).toMatchObject({ status: "parked", parkedReason: "The request names a page that doesn't exist" });
  });

  it("run view: timeline in order with retries, delivery, evidence", async () => {
    const r = (await call(`/api/runs/${ids.delivered}`)).json();
    const steps = r.timeline.map((t: any) => t.step);
    expect(steps.slice(0, 3)).toEqual(["discover", "intake", "ground"]);
    expect(steps.indexOf("implement/TASK-1")).toBeGreaterThan(steps.indexOf("approve"));
    expect(steps[steps.length - 1]).toBe("deliver");
    const task = r.timeline.find((t: any) => t.step === "implement/TASK-1");
    expect(task).toMatchObject({ status: "completed", attempts: 2 });
    expect(task.tries[0]).toMatchObject({ attempt: 1, outcome: "failed", why: "CS1002: ; expected in Orders.cs", next: "retry: same rung, fresh attempt" });
    expect(task.tries[1]).toMatchObject({ attempt: 2, outcome: "completed", rung: 1 });
    expect(r.cost.capUsd).toBe(3.5 + 5); // spent up to the plan + the size cap (S: $5)
    expect(r.delivered).toMatchObject({ branch: `factory/${ids.delivered}`, local: true, evidence: { ok: true, total: 0 } });
    expect(r.delivered.prText).toContain("## What changed");
    expect(r.card).toBeUndefined();
  });

  it("run view: the open card is read-only text with the commands to paste", async () => {
    const r = (await call(`/api/runs/${ids.waiting}`)).json();
    expect(r.card.kind).toBe("approval");
    expect(r.card.markdown).toContain("<script>alert(1)</script>"); // raw in JSON; the page escapes it
    expect(r.card.commands).toEqual([
      `factory show-card ${ids.waiting}`,
      `factory approve ${ids.waiting} bbbbbbbb --note "your risk note"`,
      `factory reject ${ids.waiting} bbbbbbbb --reason "why"`,
    ]);
    expect(r.timeline.find((t: any) => t.step === "approve").status).toBe("waiting");
    const p = (await call(`/api/runs/${ids.parked}`)).json();
    expect(p.timeline.find((t: any) => t.step === "ground")).toMatchObject({ status: "parked", note: "The request names a page that doesn't exist" });
  });

  it("card commands: question and limit cards too", () => {
    expect(cardCommands("Answer with letters:\n  factory answer r1 abcd1234 Q-1=A Q-2=A\n  (use quotes)", "r1", "abcd1234"))
      .toEqual(["factory show-card r1", "factory answer r1 abcd1234 Q-1=A Q-2=A"]);
    expect(cardCommands("  factory waive-cap r1 cafe0000 --cost 20\nOr stop here: factory stop r1", "r1", "cafe0000"))
      .toEqual(["factory show-card r1", "factory waive-cap r1 cafe0000 --cost 20", "factory stop r1"]);
  });

  it("dashboard: the same numbers as report --all --json", async () => {
    const d = (await call("/api/dashboard")).json();
    const runs = Ledger.listRuns().map((id) => scoreRun(Ledger.open(id)));
    expect({ outcomes: d.outcomes, stages: d.stages }).toEqual(JSON.parse(JSON.stringify({ outcomes: outcomes(runs), stages: stageStats(runs) })));
    expect(d.outcomes).toMatchObject({ runs: 3, delivered: 1, parked: 1, waiting: 1 });
  });

  it("design: UI size from the plan's files, and the app's pages and building blocks", async () => {
    const d = (await call(`/api/runs/${ids.waiting}/design`)).json();
    expect(d.uiSize.size).toMatchObject({ level: "tweak" });
    expect(d.uiSize.approvalCardLine).toBe("UI size: **screen tweak** (src/app/orders/page.tsx: edits an existing screen). Design work: none.");
    expect(d.inventory.pages.map((p: any) => p.route).sort()).toEqual(["/", "/orders"]);
    expect(d.inventory.buildingBlocks).toEqual([{ name: "Button", path: "src/components/ui/button.tsx", uses: 1, variants: [] }]);
    expect(d.styleChecks).toEqual([]);
    const parked = (await call(`/api/runs/${ids.parked}/design`)).json();
    expect(parked.uiSize.none).toMatch(/plan isn't done/);
  });

  it("design: a .NET-only repo has no web UI", async () => {
    const runId = await createRun("Greet people with Hello instead of Hi", "api", "tester");
    const d = (await call(`/api/runs/${runId}/design`)).json();
    expect(d.inventory.none).toMatch(/No web UI found/);
  });

  it("unknown run → 404", async () => {
    expect((await call("/api/runs/nope-nope")).status).toBe(404);
    expect((await call("/api/runs/..%2F..%2Fetc")).status).toBe(404);
  });
});

describe("factory ui: starting a run", () => {
  const count = () => Ledger.listRuns().length;

  it("bad input is refused before any run exists", async () => {
    const before = count();
    const cases: [unknown, number, RegExp][] = [
      [{ project: "nope", prompt: "Rename the orders heading" }, 400, /No project "nope"/],
      [{ prompt: "Rename the orders heading" }, 400, /Pick a project/],
      [{ project: "web", prompt: "   " }, 400, /Give a request/],
      [{ project: "web", prompt: "Rename it", maxCost: 25 }, 400, /can only lower the normal limit.*\$20/],
      [{ project: "web", prompt: "Rename it", maxCost: -1 }, 400, /positive number/],
      [{ project: "web", file: { name: "req.exe", text: "Rename the orders heading" } }, 400, /\.md\) or text/],
      [{ project: "web", file: { name: "big.md", text: "x".repeat(150_000) } }, 400, /split the request/],
      [{ project: "web", file: { name: "empty.md", text: " " } }, 400, /empty or too short/],
      [{ project: "web", jira: "ABC-12" }, 400, /add JIRA_BASE_URL/],
    ];
    for (const [body, status, msg] of cases) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(status);
      expect(r.json().error).toMatch(msg);
    }
    expect((await post(JSON.stringify({ project: "web", file: { name: "a.md", text: "x".repeat(MAX_UPLOAD_BODY_BYTES) } }))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect(count()).toBe(before);
    expect(started).toEqual([]);
  });

  it("a good request creates the run like factory start and executes it in the background", async () => {
    const r = await post({ project: "web", prompt: "Rename the orders heading to Your orders", file: { name: "notes.md", text: "# Notes\n\nKeep the count next to it." }, maxCost: "8" });
    expect(r.status).toBe(201);
    const { runId, from } = r.json();
    expect(from).toBe("typed prompt + notes.md");
    expect(started).toEqual([runId]);
    const s = replay(Ledger.open(runId).events());
    expect(s.info.request).toBe("## Typed request\n\nRename the orders heading to Your orders\n\n## From notes.md\n\n# Notes\n\nKeep the count next to it.");
    expect(s.info.sources).toEqual([{ kind: "prompt" }, { kind: "file", name: "notes.md" }]);
    expect(s.info.maxCostUsd).toBe(8);
    expect(s.info.project).toBe("web");
    expect((Ledger.open(runId).events()[0]!.data as { operator: string }).operator).toMatch(/\(via web\)$/);
    // a second run on the same project waits until this one stops
    const again = await post({ project: "web", prompt: "Another change to the orders page" });
    expect(again.status).toBe(409);
    expect(again.json().error).toContain(runId);
    // other projects are free
    expect((await post({ project: "api", prompt: "Greet people with Hello instead of Hi" })).status).toBe(201);
  });
});

describe("factory ui: the card renderer escapes everything", () => {
  it("a card with <script> renders as text", () => {
    const html = renderMarkdown("# Title <img src=x onerror=alert(1)>\n\n> Rename <script>alert(1)</script>\n\n**bold** and `code`\n  factory approve r1 <hash>\n- item <b>x</b>");
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<pre><code>factory approve r1 &lt;hash&gt;</code></pre>");
    expect(html).toContain("<li>item &lt;b&gt;x&lt;/b&gt;</li>");
    expect(renderMarkdown('`"quoted"` and \'x\'')).toBe("<p><code>&quot;quoted&quot;</code> and &#39;x&#39;</p>");
  });
});

describe("factory ui: the four status views", () => {
  it("events: every ledger event in order, secrets masked, and trace lines", async () => {
    const l = Ledger.open(ids.delivered);
    await l.append({ type: "step.started", key: "review/2", data: { note: `leaked ${SECRET}` } }, HUMAN_WRITER);
    const r = await call(`/api/runs/${ids.delivered}/events`);
    expect(r.status).toBe(200);
    expect(r.body).not.toContain(SECRET);
    const v = r.json();
    expect(v.total).toBe(l.events().length);
    expect(v.events.map((e: { seq: number }) => e.seq)).toEqual(l.events().map((e) => e.seq));
    const retry = v.events.find((e: { type: string; step?: string }) => e.type === "step.failed" && e.step === "implement/TASK-1");
    expect(retry).toMatchObject({ attempt: 1, detail: { data: { category: "build", action: "retry" } } });
    expect(v.events.at(-1).detail.data.note).toContain("«SECRET");
    expect(Array.isArray(v.trace)).toBe(true);
  });

  it("stats: per-step cost, time and retries, cost over time against the cap, totals", async () => {
    const v = (await call(`/api/runs/${ids.delivered}/stats`)).json();
    const score = scoreRun(Ledger.open(ids.delivered));
    expect(v.totalUsd).toBeCloseTo(score.costUsd);
    expect(v.steps.map((x: { step: string }) => x.step)).toEqual(score.steps.map((x) => x.step));
    expect(v.steps.find((x: { step: string }) => x.step === "implement/TASK-1")).toMatchObject({ attempts: 2, retries: 1, costUsd: 0.75 });
    expect(v.retries).toBe(1);
    expect(v.costOverTime.at(-1).usd).toBeCloseTo(v.totalUsd);
    expect(v.costOverTime.map((p: { usd: number }) => p.usd)).toEqual([...v.costOverTime.map((p: { usd: number }) => p.usd)].sort((a: number, b: number) => a - b));
    expect(v.capUsd).toBeGreaterThan(0);
    expect(v.tokens.input).toBeGreaterThan(0);
    expect(v.gates).toEqual({ passed: 0, failed: 0 });
    expect(v.firstTimePass.finished).toBeGreaterThan(0);
    expect((await call(`/api/runs/${ids.waiting}/stats`)).json().humanStops).toBe(1);
  });

  it("dashboard lists recent runs", async () => {
    const d = (await call("/api/dashboard")).json();
    expect(d.recent.map((r: { runId: string }) => r.runId).sort()).toEqual([ids.delivered, ids.waiting, ids.parked].sort());
  });
});

describe("factory ui: preview", () => {
  const FIXTURE = join(staticDir(), "..", "fixtures", "preview");
  const withPreview = () => cpSync(FIXTURE, join(Ledger.open(ids.delivered).dir, "preview"), { recursive: true });
  const file = (rest: string, key = PKEY, run = ids.delivered) => call(`/preview/${key}/${run}/${rest}`, { token: null });

  it("no preview: an honest empty state", async () => {
    const v = (await call(`/api/runs/${ids.delivered}/preview`)).json();
    expect(v.none).toBe("Clickable mocks appear here once the estimate module produces them.");
    expect((await file("index.html")).status).toBe(404);
  });

  it("a preview: screens, images and a base URL; files served read-only with a strict policy", async () => {
    withPreview();
    const v = (await call(`/api/runs/${ids.delivered}/preview`)).json();
    expect(v.preview.site.screens.map((s: { title: string }) => s.title)).toEqual(["Orders list", "Order detail"]);
    expect(v.preview.images).toHaveLength(2);
    expect(v.base).toBe(`/preview/${PKEY}/${ids.delivered}/`);
    const page = await file("index.html");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(String(page.headers["content-security-policy"])).toMatch(/connect-src 'none'.*sandbox allow-scripts/);
    expect(page.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect((await file("img/orders-after.svg")).headers["content-type"]).toBe("image/svg+xml");
    expect((await call(`/preview/${PKEY}/${ids.delivered}/index.html`, { method: "POST", token: null, headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(405);
  });

  it("needs the preview key, not the session key", async () => {
    withPreview();
    expect((await file("index.html", "wrong-key-0123456789abcdef")).status).toBe(401);
    expect((await file("index.html", TOKEN)).status).toBe(401);
  });

  it("refuses path traversal, encoded forms, hidden files, odd types and symlinks", async () => {
    withPreview();
    const dir = Ledger.open(ids.delivered).dir;
    writeFileSync(join(dir, "secret.txt"), "ledger-only");
    writeFileSync(join(dir, "preview", ".env"), `KEY=${SECRET}`);
    writeFileSync(join(dir, "preview", "tool.exe"), "MZ");
    symlinkSync(join(dir, "secret.txt"), join(dir, "preview", "link.txt"));
    symlinkSync(join(dir, "cards"), join(dir, "preview", "cards"));
    for (const rest of ["../secret.txt", "..%2fsecret.txt", "%2e%2e/secret.txt", "%252e%252e/secret.txt", "img/..%2F..%2Fsecret.txt", "..%5csecret.txt",
      "%2fetc%2fpasswd", ".env", "tool.exe", "link.txt", `cards/pr-${ids.delivered}.md`, "img/", "", "index.html%00.png"]) {
      const r = await file(rest);
      expect(r.status, rest).not.toBe(200);
      expect(r.body, rest).not.toMatch(/ledger-only|sk-ant|What changed/);
    }
    // another run's id through the preview key still only reads that run's preview folder
    expect((await file("index.html", PKEY, ids.waiting)).status).toBe(404);
  });

  it("a preview.json that names a file outside its folder isn't shown", async () => {
    withPreview();
    writeFileSync(join(Ledger.open(ids.delivered).dir, "preview", "preview.json"), JSON.stringify({ images: [{ file: "../secret.txt", screen: "x" }] }));
    expect((await call(`/api/runs/${ids.delivered}/preview`)).json().none).toMatch(/outside its folder/);
  });
});

describe("factory ui: a run started from the web, watched live", () => {
  it("the status endpoints show steps as the executor appends them", async () => {
    let runId = "";
    const r = await post({ project: "api", prompt: "Greet people with Hello instead of Hi" });
    expect(r.status).toBe(201);
    runId = r.json().runId;
    expect(started).toEqual([runId]);
    const view = async () => (await call(`/api/runs/${runId}`)).json();
    expect((await view()).timeline.every((t: { status: string }) => t.status === "pending")).toBe(true);
    // the stubbed executor works through steps; each read sees exactly what's in the ledger
    const l = Ledger.open(runId);
    for (const [i, k] of ["discover", "intake", "ground"].entries()) {
      await l.append({ type: "step.started", key: `${k}/1`, data: { rung: 0 } }, HUMAN_WRITER);
      expect((await view()).timeline.find((t: { step: string }) => t.step === k).status).toBe("running");
      await l.append({ type: "usage", key: `${k}/1`, data: { "gen_ai.usage.cost_usd": 0.1 } }, HUMAN_WRITER);
      await l.append({ type: "step.completed", key: `${k}/1`, data: {} }, HUMAN_WRITER);
      const v = await view();
      expect(v.timeline.filter((t: { status: string }) => t.status === "completed")).toHaveLength(i + 1);
      expect(v.cost.usd).toBeCloseTo(0.1 * (i + 1));
      const st = (await call(`/api/runs/${runId}/stats`)).json();
      expect(st.costOverTime).toHaveLength(i + 1);
      const ev = (await call(`/api/runs/${runId}/events`)).json();
      expect(ev.events.at(-1)).toMatchObject({ type: "step.completed", step: k });
    }
  });
});

describe("factory ui: design-only runs", () => {
  it("starts a design run from requirements, with or without a project, and keeps only the product details", async () => {
    const r = await post({ project: "web", mode: "design", prompt: "Build an order portal with login and a dashboard", design: { client: "Acme", projectName: "Orders", noRepo: false }, estimate: { deliveryModel: "nonsense" } });
    expect(r.status).toBe(201);
    const s = replay(Ledger.open(r.json().runId).events());
    expect(s.info.mode).toBe("design");
    expect(s.info.estimate).toEqual({ client: "Acme", projectName: "Orders" });
    expect(s.info.repoPath).toBeTruthy();
    const alone = await post({ mode: "design", prompt: "Build an order portal with login and a dashboard" });
    expect(alone.status).toBe(201);
    const t = replay(Ledger.open(alone.json().runId).events());
    expect(t.info.estimate).toEqual({ noRepo: true });
    expect(t.info.repoPath).toBeUndefined();
    const fromEst = await post({ project: "web", mode: "design", fromEstimate: "x", prompt: "Build an order portal" });
    expect(fromEst.json().error).toMatch(/starts from requirements/);
  });

  it("export on approval is recorded on the run and checked like --design-export", async () => {
    const r = await post({ mode: "design", prompt: "Build an order portal with login and a dashboard", designExport: ["pdf", "png"] });
    expect(r.status).toBe(201);
    expect(replay(Ledger.open(r.json().runId).events()).info.designExport).toEqual(["png", "pdf"]);
    expect(ui.exportJobs.list().some((j) => j.runId === r.json().runId)).toBe(false); // nothing to export until the design is approved
    const none = await post({ mode: "design", prompt: "Build an order portal with login and a dashboard", designExport: [] });
    expect(replay(Ledger.open(none.json().runId).events()).info.designExport).toBeUndefined();
    const fig = await post({ mode: "design", prompt: "Build an order portal with login and a dashboard", designExport: ["figma"] });
    expect(replay(Ledger.open(fig.json().runId).events()).info.designExport).toEqual(["figma"]);
    expect((await post({ mode: "design", prompt: "Build an order portal", designExport: ["gif"] })).json().error).toMatch(/Unknown format/);
    expect((await post({ mode: "design", prompt: "Build an order portal", designExport: "png" })).json().error).toMatch(/list of formats/);
  });
});

describe("factory ui: estimate runs", () => {
  it("takes design frames with the request, stores them beside the run and lists them in the request text", async () => {
    const png = Buffer.from("not really a png").toString("base64");
    const base = { project: "web", mode: "estimate", prompt: "Build an order portal with login and a dashboard" };
    const r = await post({ ...base, frames: [{ name: "home.png", data: png }, { name: "login.svg", data: Buffer.from("<svg/>").toString("base64") }] });
    expect(r.status).toBe(201);
    expect(r.json().from).toBe("typed prompt + 2 frames in web upload");
    const s = replay(Ledger.open(r.json().runId).events());
    expect(s.info.request).toMatch(/- F-1 home\.png\n- F-2 login\.svg/);
    expect(existsSync(join(Ledger.open(r.json().runId).dir, "attachments", "frames", "home.png"))).toBe(true);
  });

  it("refuses frames that are unsafe, the wrong type, repeated or on a build run", async () => {
    const before = Ledger.listRuns().length;
    const data = Buffer.from("x").toString("base64");
    const base = { project: "web", prompt: "Build an order portal with login and a dashboard" };
    const cases: [unknown, RegExp][] = [
      [{ ...base, mode: "estimate", frames: [{ name: "../evil.png", data }] }, /not a usable frame file name/],
      [{ ...base, mode: "estimate", frames: [{ name: "run.exe", data }] }, /png, jpg, webp, svg or json/],
      [{ ...base, mode: "estimate", frames: [{ name: "a.png", data }, { name: "a.png", data }] }, /sent twice/],
      [{ ...base, mode: "estimate", frames: [{ name: "a.png", data: "***" }] }, /did not arrive intact/],
      [{ ...base, mode: "estimate", frames: [] }, /No frames/],
      [{ ...base, frames: [{ name: "a.png", data }] }, /belong to estimate and design runs/],
    ];
    for (const [body, msg] of cases) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(r.json().error).toMatch(msg);
    }
    expect(Ledger.listRuns().length).toBe(before);
  });

  it("starts an estimate run with the same settings factory estimate parses, and refuses bad ones", async () => {
    const bad = await post({ project: "web", mode: "estimate", prompt: "Build an order portal with login and a dashboard", estimate: { feedbackRounds: "lots" } });
    expect(bad.status).toBe(400);
    const r = await post({ project: "web", mode: "estimate", prompt: "Build an order portal with login and a dashboard", estimate: { client: "Acme", feedbackRounds: "2" } });
    expect(r.status).toBe(201);
    const s = replay(Ledger.open(r.json().runId).events());
    expect(s.info.mode).toBe("estimate");
    // a person reviews it unless the form opts in to hands-off
    expect(s.info.estimate).toMatchObject({ client: "Acme", humanReview: true });
    expect((await call(`/api/runs/${r.json().runId}`)).json().mode).toBe("estimate");
    const reviewed = await post({ project: "", mode: "estimate", prompt: "Build an order portal with login and a dashboard", estimate: { humanReview: false } });
    expect(reviewed.status, reviewed.body).toBe(201);
    expect(replay(Ledger.open(reviewed.json().runId).events()).info.estimate).toMatchObject({ humanReview: false });
  });

  it("starts an estimate with no project: requirements alone, no repo, and the stand-in config stays out of the project list", async () => {
    const r = await post({ project: "", mode: "estimate", prompt: "Build an order portal with login and a dashboard", estimate: { noRepo: false } });
    expect(r.status).toBe(201);
    const s = replay(Ledger.open(r.json().runId).events());
    expect(s.info.mode).toBe("estimate");
    expect(s.info.estimate).toMatchObject({ noRepo: true });
    expect(s.info.repoPath).toBeUndefined();
    expect(s.info.repoId).toBeUndefined();
    expect((await call("/api/projects")).json().projects.map((p: { name: string }) => p.name)).not.toContain("standalone-estimates");
    // a build still needs a real project
    expect((await post({ project: "", prompt: "Change the heading" })).status).toBe(400);
    expect((await post({ project: "standalone-estimates", prompt: "Change the heading" })).status).toBe(400);
  });

  it("a build can start from an approved estimate: it is listed, takes its request from the estimate, and refuses a request of its own", async () => {
    const id = await createRun("Build an order portal with login and a dashboard", "web", "tester", { mode: "estimate", estimate: { deliveryModel: "hitl" } } as never);
    const l = Ledger.open(id);
    expect((await call("/api/projects")).json().estimates).toEqual([]);
    const early = await post({ project: "web", fromEstimate: id });
    expect(early.status).toBe(400);
    expect(early.json().error).toMatch(/no approved estimate yet/);
    const est = l.putJson({ deliveryModel: "hitl" }), bd = l.putJson({ tasks: [] }), spec = l.putJson({ title: "s" });
    await addEvents(id, [...step("breakdown", 0, {}, [bd]), ...step("specify", 0, {}, [spec]), ...step("estimate", 0, {}, [est]), ...step("approve-estimate"), ...step("export")]);
    const listed = (await call("/api/projects")).json().estimates;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ runId: id, project: "web" });
    expect((await post({ project: "web", fromEstimate: id, prompt: "also do this" })).status).toBe(400);
    expect((await post({ project: "web", mode: "estimate", fromEstimate: id })).status).toBe(400);
    const r = await post({ project: "web", fromEstimate: id });
    expect(r.status).toBe(201);
    const built = replay(Ledger.open(r.json().runId).events());
    expect(built.info.request).toBe("Build an order portal with login and a dashboard");
    expect(built.info.estimateRef).toMatchObject({ runId: id, estimateSha: est });
    // the estimate's design is approved already, so export on approval starts an export job at once
    _resetStarting();
    const x = await post({ project: "web", fromEstimate: id, designExport: ["pdf"] });
    expect(x.status).toBe(201);
    expect(replay(Ledger.open(x.json().runId).events()).info.designExport).toEqual(["pdf"]);
    expect(ui.exportJobs.list().find((j) => j.runId === x.json().runId)).toMatchObject({ formats: ["pdf"] });
  });

  it("an estimate can change an approved one (--revises) and ask the model again (--fresh); there is no other delivery model to size it under", async () => {
    const id = await createRun("Build an order portal with login and a dashboard", "web", "tester", { mode: "estimate", estimate: { deliveryModel: "hitl", stackSource: "client", feedbackRounds: 3 } } as never);
    const l = Ledger.open(id);
    const est = l.putJson({ deliveryModel: "hitl" }), bd = l.putJson({ tasks: [] }), spec = l.putJson({ title: "s" });
    await addEvents(id, [...step("breakdown", 0, {}, [bd]), ...step("specify", 0, {}, [spec]), ...step("estimate", 0, {}, [est]), ...step("approve-estimate"), ...step("export")]);
    expect((await call("/api/projects")).json().estimates[0]).toMatchObject({ runId: id, deliveryModel: "hitl" });
    const refusals: [unknown, RegExp][] = [
      [{ project: "web", mode: "estimate", fromRun: id }, /solely agentic now/],
      [{ project: "web", mode: "estimate", fromDesign: id, revises: id }, /one thing at a time/],
      [{ project: "web", revises: id, prompt: "Add a CSV export to the orders page" }, /is an estimate/],
      [{ project: "api", mode: "estimate", revises: id, prompt: "Add a CSV export to the orders page" }, /for project web, not api/],
      [{ project: "web", mode: "design", revises: id, prompt: "x" }, /starts from requirements/],
      [{ project: "web", mode: "estimate", revises: "nope", prompt: "Add a CSV export to the orders page" }, /./],
      [{ project: "web", prompt: "Show the order count please", fresh: true }, /estimate and design runs/],
    ];
    for (const [body, msg] of refusals) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json().error).toMatch(msg);
    }
    const calls: [string, unknown][] = [];
    await new Promise((r) => ui.server.close(r));
    ui = createUiServer({ token: TOKEN, previewKey: PKEY, deps: { execute: (rid, o) => calls.push([rid, o]) } });
    port = await listen(ui, 0);
    const ch = await post({ project: "web", mode: "estimate", revises: id, prompt: "Add a CSV export to the orders page", fresh: true, estimate: { deliveryModel: "hitl" } });
    expect(ch.status).toBe(201);
    const t = replay(Ledger.open(ch.json().runId).events());
    expect(t.info.parent).toMatchObject({ runId: id, kind: "change" });
    // a HITL estimate's change is sized solely agentic: the form's delivery model is not taken any more
    expect(t.info.estimate).toMatchObject({ deliveryModel: "agentic" });
    expect(calls).toEqual([[ch.json().runId, { fresh: true }]]);
  });

  it("the estimate view says so for a build run and before the estimate exists", async () => {
    const built = await call(`/api/runs/${ids.delivered}/estimate`);
    expect(built.status).toBe(200);
    expect(built.json().none).toMatch(/not an estimate run/);
    const id = await createRun("Build an order portal", "web", "tester", { mode: "estimate" } as never);
    const early = await call(`/api/runs/${id}/estimate`);
    expect(early.json().none).toMatch(/isn't ready/);
  });

  it("downloads only workbooks inside the run's export folder", async () => {
    const id = await createRun("Build an order portal", "web", "tester", { mode: "estimate" } as never);
    const l = Ledger.open(id);
    const dir = join(l.dir, "export");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "team.xlsx"), "PK-team");
    const outside = join(home, "secret.xlsx");
    writeFileSync(outside, "nope");
    const manifest = l.putJson({ team: join(dir, "team.xlsx"), client: outside });
    await addEvents(id, step("export", 0, {}, [manifest]));
    const ok = await call(`/export/${id}/team`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toMatch(/attachment.*team\.xlsx/);
    expect(ok.body).toBe("PK-team");
    expect((await call(`/export/${id}/client`)).status).toBe(404);
    expect((await call(`/export/${id}/other`)).status).toBe(404);
    expect((await call(`/export/${id}/team`, { token: null })).status).toBeGreaterThanOrEqual(401);
  });

  it("serves visual-check pictures only as png files inside the run's design-check folder, with the key", async () => {
    const id = await createRun("Build an order portal", "web", "tester");
    const l = Ledger.open(id);
    mkdirSync(join(l.dir, "design-check", "base"), { recursive: true });
    writeFileSync(join(l.dir, "design-check", "base", "home.png"), "PNGDATA");
    writeFileSync(join(l.dir, "design-check", "base", "note.txt"), "no");
    writeFileSync(join(home, "outside.png"), "secret");
    const ok = await call(`/shots/${id}/base/home.png`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect(ok.body).toBe("PNGDATA");
    expect((await call(`/shots/${id}/base/note.txt`)).status).toBe(404);
    expect((await call(`/shots/${id}/base/..%2F..%2F..%2Foutside.png`)).status).toBe(404);
    expect((await call(`/shots/${id}/other/home.png`)).status).toBe(404);
    expect((await call(`/shots/nope/base/home.png`)).status).toBe(404);
    expect((await call(`/shots/${id}/base/home.png`, { token: null })).status).toBeGreaterThanOrEqual(401);
  });
});

describe("factory ui: the estimate lead's decision", () => {
  const decisionPost = (id: string, body: unknown) =>
    call(`/api/runs/${id}/estimate-decision`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });

  it("refuses a plan card, unknown runs and anything that isn't an estimate card; nothing gets recorded", async () => {
    const r = await decisionPost(ids.waiting, { hash: "b".repeat(8), decision: "approve", by: "Sam Lead" });
    expect(r.status).toBe(409);
    expect(r.json().error).toMatch(/no estimate waiting/);
    expect((await decisionPost("nope", { decision: "approve" })).status).toBe(404);
    expect(replay(Ledger.open(ids.waiting).events()).openCard?.kind).toBe("approval");
    expect(started).toEqual([]);
  });

  it("an estimate card needs the hash, a typed name and sign-offs; then it records and continues the run", async () => {
    const id = await createRun("Build an order portal", "web", "tester", { mode: "estimate" } as never);
    const l = Ledger.open(id);
    const est = l.putJson({ tasks: [{ taskId: "EST-1", flagged: true }, { taskId: "EST-2", flagged: false }] });
    const bundle = "c".repeat(64);
    l.writeCard(`estimate-${bundle.slice(0, 8)}`, "# Approve the estimate");
    await addEvents(id, [
      ...step("estimate", 0, {}, [est]),
      { type: "step.started", key: "approve-estimate/1", data: { rung: 0 } },
      { type: "step.interrupted", key: "approve-estimate/1", data: { reason: "waiting" } },
      { type: "human.requested", data: { cardId: `estimate-${bundle.slice(0, 8)}`, kind: "estimate-approval", artifactSha: bundle, step: "approve-estimate" } },
    ]);
    const ok = { hash: bundle.slice(0, 8), decision: "approve", by: "Sam Lead" };
    expect((await decisionPost(id, { ...ok, by: "" })).status).toBe(400);
    expect((await decisionPost(id, { ...ok, hash: "cccc" })).status).toBe(400);
    expect((await decisionPost(id, { hash: ok.hash, by: ok.by, decision: "maybe" })).status).toBe(400);
    expect((await decisionPost(id, { ...ok, decision: "reject" })).json().error).toMatch(/needs a reason/);
    expect((await decisionPost(id, ok)).json().error).toMatch(/Sign off.*EST-1/);
    expect((await decisionPost(id, { ...ok, hash: "deadbeef", signOff: ["EST-1"] })).status).toBe(409);
    expect(started).toEqual([]);
    const done = await decisionPost(id, { ...ok, signOff: ["EST-1"], note: "ok" });
    expect(done.status).toBe(200);
    expect(done.json().recorded).toBe(true);
    expect(started).toEqual([id]);
    const d = replay(l.events()).decisions.at(-1) as unknown as { by: string; decision: string; signOff: string[] };
    expect(d).toMatchObject({ by: "Sam Lead (via web)", decision: "approve", signOff: ["EST-1"] });
    // a repeat is a no-op and does not start the run again
    expect((await decisionPost(id, { ...ok, signOff: ["EST-1"], note: "ok" })).status).toBe(409);
  });
});

describe("factory ui: answering an estimate run's questions", () => {
  const answersPost = (id: string, body: unknown) =>
    call(`/api/runs/${id}/estimate-answers`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
  const asked = [
    { id: "Q-1", text: "Who can refund an order?", options: ["Support only", "Support and finance"], recommended: "Support only", reason: "smaller", impactReason: "changes who sees money", impact: 3, uncertainty: 3, score: 9, category: "roles", spans: [] },
    { id: "Q-2", text: "Keep order history?", options: ["Yes", "No"], recommended: "Yes", reason: "usual", impactReason: "data kept", impact: 2, uncertainty: 2, score: 4, category: "scope", spans: [] },
  ];

  it("shows the questions on the run, refuses a plan card, and takes typed answers that continue the run", async () => {
    const before = started.length;
    expect((await answersPost(ids.waiting, { hash: "b".repeat(8), by: "Sam Lead", answers: {} })).status).toBe(403);
    expect((await answersPost("nope", {})).status).toBe(404);
    const id = await createRun("Build an order portal", "web", "tester", { mode: "estimate" } as never);
    const l = Ledger.open(id);
    const body = l.putJson({ key: "clarify", asked, assumptions: [{ id: "ASM-1", text: "Currency is USD" }] });
    l.writeCard(`questions-1-${body.slice(0, 8)}`, "# Questions");
    await addEvents(id, [
      { type: "step.started", key: "clarify/1", data: { rung: 0 } },
      { type: "step.interrupted", key: "clarify/1", data: { reason: "waiting" } },
      { type: "human.requested", data: { cardId: `questions-1-${body.slice(0, 8)}`, kind: "question", artifactSha: body, step: "clarify" } },
    ]);
    const view = (await call(`/api/runs/${id}`)).json();
    expect(view.card.questions.map((q: { id: string }) => q.id)).toEqual(["Q-1", "Q-2"]);
    expect(view.card.assumptions).toEqual([{ id: "ASM-1", text: "Currency is USD" }]);
    const ok = { hash: body.slice(0, 8), by: "Sam Lead", answers: { "Q-1": "Support and finance" } };
    expect((await answersPost(id, { ...ok, by: "" })).status).toBe(400);
    expect((await answersPost(id, { ...ok, hash: "abcd" })).status).toBe(400);
    expect((await answersPost(id, { ...ok, answers: { "Q-9": "x" } })).status).toBe(400);
    expect((await answersPost(id, { ...ok, hash: "deadbeef" })).status).toBe(409);
    expect(started.length).toBe(before);
    const done = await answersPost(id, ok);
    expect(done.status).toBe(200);
    expect(done.json().recorded).toBe(true);
    expect(started.at(-1)).toBe(id);
    const d = replay(l.events()).decisions.at(-1) as unknown as { by: string; decision: string; answers: Record<string, string> };
    expect(d).toMatchObject({ by: "Sam Lead (via web)", decision: "answer", answers: { "Q-1": "Support and finance" } });
    // Q-2 was left out: it takes its recommended option when the step reads the decision
    expect(d.answers["Q-2"]).toBeUndefined();
  });

  it("refuses answers for a build run's questions: only estimate cards are decided on the page", async () => {
    const id = await createRun("Add a refund button to orders", "web", "tester");
    const l = Ledger.open(id);
    const body = l.putJson({ key: "clarify", asked, assumptions: [] });
    l.writeCard(`questions-1-${body.slice(0, 8)}`, "# Questions");
    await addEvents(id, [
      { type: "step.started", key: "clarify/1", data: { rung: 0 } },
      { type: "step.interrupted", key: "clarify/1", data: { reason: "waiting" } },
      { type: "human.requested", data: { cardId: `questions-1-${body.slice(0, 8)}`, kind: "question", artifactSha: body, step: "clarify" } },
    ]);
    const before = started.length;
    const r = await answersPost(id, { hash: body.slice(0, 8), by: "Sam Lead", answers: { "Q-2": "No" } });
    expect(r.status).toBe(403);
    expect(r.json().error).toMatch(/terminal/);
    expect(started.length).toBe(before);
    expect(replay(l.events()).decisions).toEqual([]);
  });
});

describe("factory ui: design card decisions", () => {
  it("has no route to approve or reject a design: the design card is decided in the terminal", async () => {
    expect(ROUTES.some((r) => r.path.endsWith("/design-decision"))).toBe(false);
    const r = await call(`/api/runs/${ids.waiting}/design-decision`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ decision: "approve" }) });
    expect(r.status).toBe(404);
  });
});

describe("factory ui: design references", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  // the reading is stubbed: what matters here is what the page sends and what the run keeps
  const gathered: unknown[] = [];
  const gatherRefs = async (reqs: { kind: string; name?: string; url?: string; role?: string; note?: string }[]) => {
    gathered.push(reqs);
    return reqs.map((q, i) => ({
      id: `R-${i + 1}`, kind: q.kind === "url" ? "url" as const : "image" as const, source: q.name ?? q.url ?? "", role: (q.role && q.role !== "auto" ? q.role : "inspire") as "inspire", roleGiven: !!q.role && q.role !== "auto",
      ...(q.note ? { note: q.note } : {}), images: [{ bytes: PNG, width: 1, height: 1, label: "page" }], colours: [{ hex: "#1d4ed8", role: "primary" }], fonts: [], measured: "approximate" as const, notes: [],
    }));
  };
  const withRefs = async () => {
    await new Promise((r) => ui.server.close(r));
    ui = createUiServer({ token: TOKEN, previewKey: PKEY, deps: { execute: (id) => started.push(id), gatherRefs: gatherRefs as never } });
    port = await listen(ui, 0);
  };
  const file = (name: string, bytes = PNG) => ({ kind: "file", name, data: bytes.toString("base64") });

  it("refuses bad references before any run exists, and with a build from an estimate", async () => {
    await withRefs();
    const before = Ledger.listRuns().length;
    const cases: [unknown, RegExp][] = [
      ["nope", /couldn't be read/],
      [Array.from({ length: 13 }, (_, i) => file(`a${i}.png`)), /at most 12/],
      [[{ ...file("a.png"), role: "copy" }], /role/i],
      [[{ ...file("a.png"), note: "x".repeat(501) }], /note/i],
      [[{ kind: "url", url: "http://client.com" }], /https/],
      [[{ kind: "file", name: "dir/..", data: PNG.toString("base64") }], /name/i],
      [[{ kind: "file", name: ".a.png", data: PNG.toString("base64") }], /name/i],
      [[{ kind: "file", name: "a.png", data: "" }], /empty/i],
    ];
    for (const [refs, msg] of cases) {
      const r = await post({ project: "web", mode: "estimate", prompt: "Build an order portal with login and a dashboard", refs });
      expect(r.status, JSON.stringify(refs).slice(0, 80)).toBe(400);
      expect(r.json().error).toMatch(msg);
    }
    const fromEst = await post({ project: "web", fromEstimate: "x", refs: [file("a.png")] });
    expect(fromEst.status).toBe(400);
    expect(fromEst.json().error).toMatch(/follows the design approved there/);
    expect(gathered).toEqual([]);
    expect(Ledger.listRuns().length).toBe(before);
  });

  it("checks references without starting a run, like factory design check-refs", async () => {
    await withRefs();
    const before = Ledger.listRuns().length;
    const check = (body: unknown) => call("/api/check-refs", { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
    const r = await check({ project: "web", refs: [{ ...file("shot.png"), role: "match" }, { kind: "url", url: "https://client.com" }] });
    expect(r.status).toBe(200);
    const [a, b] = r.json().references;
    expect(a).toMatchObject({ id: "R-1", source: "shot.png", role: "match", roleGiven: true, pictures: [{ label: "page", width: 1, height: 1 }], colours: [{ hex: "#1d4ed8" }], textChars: 0 });
    expect(a.pictures[0].bytes).toBeUndefined();
    expect(b).toMatchObject({ id: "R-2", kind: "url", roleGiven: false });
    expect((await check({ refs: [] })).json().error).toMatch(/Add a reference/);
    expect((await check({ refs: [{ kind: "url", url: "http://client.com" }] })).status).toBe(400);
    expect((await call("/api/check-refs", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
    expect(Ledger.listRuns().length).toBe(before);
    expect(started).toEqual([]);
  });

  it("a run started with references keeps them, lists them and serves their pictures by the key only", async () => {
    await withRefs();
    const r = await post({ mode: "design", prompt: "Build an order portal with login and a dashboard", refs: [{ ...file("../../home.png"), role: "match", note: "the table like this" }, { kind: "url", url: "https://client.example", role: "auto" }] });
    expect(r.status).toBe(201);
    const { runId, from } = r.json();
    expect(from).toContain("design references R-1 home.png (match), R-2 https://client.example (inspire)");
    const s = replay(Ledger.open(runId).events());
    expect(s.info.references?.map((x) => [x.id, x.role, x.note])).toEqual([["R-1", "match", "the table like this"], ["R-2", "inspire", undefined]]);
    const v = (await call(`/api/runs/${runId}/references`)).json();
    expect(v.none).toBeUndefined();
    expect(v.references.map((x: { id: string; images: { url: string }[] }) => [x.id, x.images[0]!.url])).toEqual([["R-1", `/refs/${runId}/R-1-1.png`], ["R-2", `/refs/${runId}/R-2-1.png`]]);
    const pic = await call(`/refs/${runId}/R-1-1.png`);
    expect(pic.status).toBe(200);
    expect(pic.headers["content-type"]).toBe("image/png");
    expect((await call(`/refs/${runId}/R-1-1.png`, { token: null })).status).toBe(401);
    for (const bad of ["R-9-1.png", "R-1-1.jpg", "..%2Frun.json", "R-1-1.png/x", "%2E%2E"]) expect((await call(`/refs/${runId}/${bad}`)).status, bad).toBe(404);
    expect((await call(`/refs/nope/R-1-1.png`)).status).toBe(404);
    // a run without references says so
    expect((await call(`/api/runs/${ids.delivered}/references`)).json()).toMatchObject({ references: [], none: expect.stringMatching(/No design references/) });
  });

  it("a symlinked picture is not served", async () => {
    await withRefs();
    const { runId } = (await post({ mode: "design", prompt: "Build an order portal with login and a dashboard", refs: [file("home.png")] })).json();
    const dir = Ledger.open(runId).dir;
    writeFileSync(join(home, "secret.png"), PNG);
    symlinkSync(join(home, "secret.png"), join(dir, "refs", "R-1-2.png"));
    expect((await call(`/refs/${runId}/R-1-2.png`)).status).toBe(404);
  });

  it("the projects view says whether Figma links can be read", async () => {
    const p = (await call("/api/projects")).json();
    expect(p.figma.configured).toBe(false);
    expect(p.figma.why).toMatch(/FIGMA_TOKEN/);
  });
});

describe("factory ui: design exports", () => {
  const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the queue", traits: ["dense", "quiet"] }, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "calm" }] };
  const mock = { title: "Sign in", blocks: [{ type: "actions", buttons: ["Sign in"] }], copy: {} };
  async function approvedDesignRun(): Promise<Ledger> {
    const runId = await createRun("Build an order portal with login", "web", "tester", { mode: "design" } as never);
    const l = Ledger.open(runId);
    const designSha = l.putJson({ flow: "A user signs in", theme, noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock }] });
    const bundle = l.putJson({ design: designSha, demo: l.putArtifact(Buffer.from("<!doctype html><title>demo</title>")) });
    const base = l.putJson({ ui: true, design: designSha, by: "lead" });
    await addEvents(runId, [
      { type: "step.completed", key: "design/1", inputsHash: "a".repeat(64), outputs: [designSha], data: { named: { design: designSha } } },
      { type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } },
      { type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } },
      { type: "step.completed", key: "design-baseline/1", inputsHash: "a".repeat(64), outputs: [base], data: { named: { "design-baseline": base } } },
    ]);
    return l;
  }
  const start = (runId: string, body: unknown, token?: string | null) =>
    call(`/api/runs/${runId}/exports`, { method: "POST", token, headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });

  /** An approved design run with the outputs an estimate or build carries on (intake, spec, design, baseline). */
  async function seedableDesignRun(project?: string): Promise<string> {
    if (!project) ensureStandaloneProject();
    const runId = await createRun("Build an order portal with login", project ?? "standalone-estimates", "tester", { mode: "design", ...(project ? {} : { estimate: { noRepo: true } }) } as never);
    const l = Ledger.open(runId);
    const designSha = l.putJson({ flow: "A user signs in", theme, noScreen: [], screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock }] });
    await addEvents(runId, [...step("intake", 0, {}, [l.putJson({ text: "x" })]), ...step("specify", 0, {}, [l.putJson({ title: "s" })]), ...step("design", 0, {}, [designSha]),
      ...step("design-baseline", 0, { ui: true }, [l.putJson({ ui: true, design: designSha, by: "lead" })])]);
    return runId;
  }

  it("an estimate or a build can start from an approved design run, like --from-design", async () => {
    const pending = await createRun("Build an order portal with login", "web", "tester", { mode: "design" } as never);
    expect((await post({ project: "web", mode: "estimate", fromDesign: pending })).json().error).toMatch(/no approved design yet/);
    const id = await seedableDesignRun("web");
    const alone = await seedableDesignRun();
    const listed = (await call("/api/projects")).json().designs;
    expect(listed.map((d: { runId: string; repo: boolean }) => [d.runId, d.repo]).sort()).toEqual([[alone, false], [id, true]].sort());
    expect((await call(`/api/runs/${id}`)).json().repo).toBe(true);
    const refusals: [unknown, RegExp][] = [
      [{ project: "web", mode: "estimate", fromDesign: id, prompt: "and more" }, /brings its own requirements/],
      [{ project: "web", mode: "estimate", fromDesign: id, refs: [{ kind: "url", url: "https://client.com" }] }, /remove the design references/],
      [{ project: "web", mode: "design", fromDesign: id }, /starts from requirements/],
      [{ project: "api", mode: "estimate", fromDesign: id }, /for project web, not api/],
      [{ project: "api", fromDesign: id }, /designed for project web, not api/],
      [{ project: "web", fromDesign: alone }, /new product .*already has code/],
      [{ project: "web", fromDesign: id, fromEstimate: "x" }, /one thing at a time/],
      [{ project: "web", mode: "estimate", fromDesign: ids.delivered }, /not a design run/],
    ];
    for (const [body, msg] of refusals) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json().error).toMatch(msg);
    }
    const e = await post({ mode: "estimate", fromDesign: id, estimate: { deliveryModel: "agentic" } });
    expect(e.status).toBe(201);
    const s = replay(Ledger.open(e.json().runId).events());
    expect(s.info).toMatchObject({ mode: "estimate", project: "web", request: "Build an order portal with login", designRef: { runId: id } });
    const e2 = await post({ mode: "estimate", fromDesign: alone });
    expect(replay(Ledger.open(e2.json().runId).events()).info.estimate).toMatchObject({ noRepo: true });
    _resetStarting();
    const b = await post({ project: "web", fromDesign: id, designExport: ["json"] });
    expect(b.status).toBe(201);
    expect(replay(Ledger.open(b.json().runId).events()).info).toMatchObject({ mode: "brownfield", designRef: { runId: id } });
    expect(ui.exportJobs.list().find((j) => j.runId === b.json().runId)).toMatchObject({ formats: ["json"] });
  });

  it("builds a design for a new product into a project whose repo is empty (greenfield)", async () => {
    const alone = await seedableDesignRun();
    const empty = makeRepo({ "README.md": "# shop\n" });
    writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo: empty, stack: "node" }));
    writeFileSync(join(home, "projects", "shopnet.yaml"), stringify({ project: "shopnet", repo: makeRepo({ "README.md": "x" }), stack: "dotnet" }));
    const projects = (await call("/api/projects")).json().projects as { name: string; empty?: boolean }[];
    expect(projects.filter((p) => p.empty).map((p) => p.name)).toEqual(["shop"]);
    expect((await post({ project: "shopnet", fromDesign: alone })).json().error).toMatch(/stack: dotnet/);
    expect((await post({ project: "api", fromDesign: alone })).json().error).toMatch(/already has code/);
    const r = await post({ project: "shop", fromDesign: alone });
    expect(r.status, JSON.stringify(r.json())).toBe(201);
    expect(replay(Ledger.open(r.json().runId).events()).info).toMatchObject({ mode: "greenfield", project: "shop", repoPath: empty, designRef: { runId: alone } });
  });

  it("says why a run with no approved design cannot be exported, and refuses to start one", async () => {
    const v = (await call(`/api/runs/${ids.waiting}/exports`)).json();
    expect(v).toMatchObject({ available: false, why: expect.any(String), exports: [], jobs: [] });
    expect((await start(ids.waiting, { formats: ["json"] })).status).toBe(409);
    expect((await call("/api/runs/nope/exports")).status).toBe(404);
  });

  it("exports as a job, lists it with its version, and downloads its files and the whole export with the key", async () => {
    const l = await approvedDesignRun();
    const v = (await call(`/api/runs/${l.runId}/exports`)).json();
    expect(v).toMatchObject({ available: true, formats: ["png", "pdf", "html", "tokens", "json", "figma"], figma: { plugin: "/figma-plugin.zip", note: expect.stringMatching(/no Figma token or paid seat/i) }, options: { widths: ["phone", "tablet", "desktop"], modes: ["light"], langs: ["en"] } });
    expect(v.options.screens.map((s: { id: string }) => s.id)).toEqual(["S-1", "components"]);

    expect((await start(l.runId, { formats: ["sketch"] })).json().error).toMatch(/Unknown format/);
    // the plugin, with the key: its manifest, code and window
    expect((await call("/figma-plugin.zip", { token: null })).status).toBe(401);
    const plug = await call("/figma-plugin.zip");
    expect(plug.status).toBe(200);
    expect(plug.headers["content-type"]).toBe("application/zip");
    expect(plug.headers["content-disposition"]).toMatch(/ai-factory-figma-plugin\.zip/);
    expect(plug.body.slice(0, 2)).toBe("PK");
    for (const f of ["manifest.json", "code.js", "ui.html"]) expect(plug.body).toContain(`ai-factory-figma-plugin/${f}`);
    expect((await start(l.runId, { formats: ["json"], widths: ["watch"] })).status).toBe(400);
    expect((await start(l.runId, { formats: ["json"] }, null)).status).toBe(401);
    const r = await start(l.runId, { formats: ["json", "tokens"] });
    expect(r.status).toBe(202);
    expect(r.json().job).toMatchObject({ runId: l.runId, status: "running", formats: ["tokens", "json"] });
    for (let i = 0; i < 100 && ui.exportJobs.list()[0]!.status === "running"; i++) await new Promise((res) => setTimeout(res, 50));
    const after = (await call(`/api/runs/${l.runId}/exports`)).json();
    expect(after.jobs[0]).toMatchObject({ status: "done", exportId: "v1/1" });
    expect(after.design).toMatchObject({ line: l.runId, version: 1, approvedBy: "lead" });
    expect(after.exports).toHaveLength(1);
    expect(after.exports[0]).toMatchObject({ id: "v1/1", version: 1, formats: ["tokens", "json"] });

    const css = await call(`/design-exports/${l.runId}/v1/1/tokens/tailwind.css`);
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/text\/css/);
    expect(css.headers["content-disposition"]).toMatch(/attachment; filename="design-.*-v1-export-1-tailwind\.css"/);
    expect(css.body).toContain("@theme");
    const zip = await call(`/design-exports/${l.runId}/v1/1.zip`);
    expect([zip.status, zip.headers["content-type"]]).toEqual([200, "application/zip"]);
    // the key, recorded files only, no way out of the folder
    expect((await call(`/design-exports/${l.runId}/v1/1/tokens/tailwind.css`, { token: null })).status).toBe(401);
    expect((await call(`/design-exports/${l.runId}/v1/1/export.json`)).status).toBe(404);
    writeFileSync(join(l.dir, "exports", "v1", "1", "extra.css"), "x");
    expect((await call(`/design-exports/${l.runId}/v1/1/extra.css`)).status).toBe(404);
    expect((await call(`/design-exports/${l.runId}/v1/1/..%2F..%2F..%2Fevents.jsonl`)).status).toBe(404);
    expect((await call(`/design-exports/${l.runId}/../../events.jsonl`)).status).toBe(404);
    symlinkSync(join(l.dir, "exports", "v1", "1"), join(l.dir, "exports", "v1", "9"));
    expect((await call(`/design-exports/${l.runId}/v1/9/tokens/tailwind.css`)).status).toBe(404);
  });

  it("shows the UI target and the scaffold on the Code panel, previews another target, and generates a copy to download", async () => {
    const l = await approvedDesignRun();
    const v = (await call(`/api/runs/${l.runId}/scaffold`)).json();
    // the web repo is Next.js with its own button: the kit goes under src/, and the repo's button is kept
    expect(v).toMatchObject({ available: true, targets: ["next-shadcn", "vite-shadcn", "repo"], generated: [], view: { target: "next-shadcn", source: "detected", kit: { id: "shadcn" }, root: "src/", fresh: false } });
    expect(v.view.screens).toEqual([expect.objectContaining({ id: "S-1", route: "/login", container: "src/components/screens/s-1/container.tsx" })]);
    expect(v.view.kept).toContain("src/components/ui/button.tsx");
    expect(v.view.designSystem.todo.join("\n")).toMatch(/from the app.s own navigation/);
    const other = (await call(`/api/runs/${l.runId}/scaffold/vite-shadcn`)).json();
    expect(other.view).toMatchObject({ target: "vite-shadcn", source: "config" });
    expect((await call(`/api/runs/${l.runId}/scaffold/repo`)).json().view).toMatchObject({ target: "repo", files: [] });
    expect((await call(`/api/runs/${l.runId}/scaffold/angular`)).status).toBe(400);
    const gen = (body: unknown, token?: string | null) => call(`/api/runs/${l.runId}/scaffold`, { method: "POST", token, headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
    expect((await gen({ target: "repo" })).status).toBe(409);
    const g = await gen({ target: "vite-shadcn" });
    expect(g.status).toBe(200);
    expect(g.json()).toMatchObject({ target: "vite-shadcn", dir: join(l.dir, "scaffold", "vite-shadcn") });
    expect(existsSync(join(l.dir, "scaffold", "vite-shadcn", "src", "components", "screens", "s-1", "screen.tsx"))).toBe(true);
    expect((await call(`/api/runs/${l.runId}/scaffold`)).json().generated).toEqual(["vite-shadcn"]);
    const zip = await call(`/scaffolds/${l.runId}/vite-shadcn.zip`);
    expect([zip.status, zip.headers["content-type"]]).toEqual([200, "application/zip"]);
    expect((await call(`/scaffolds/${l.runId}/vite-shadcn.zip`, { token: null })).status).toBe(401);
    expect((await call(`/scaffolds/${l.runId}/next-shadcn.zip`)).status).toBe(404);
    expect((await call(`/scaffolds/${l.runId}/..%2Fevents.jsonl`)).status).toBe(404);
    // each copy taken of the app is in the run's ledger (who, which target, where to)
    const copies = readFileSync(join(l.dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)).filter((e) => e.type === "scaffold.copied").map((e) => e.data);
    expect(copies).toEqual([
      expect.objectContaining({ copy: "generate", target: "vite-shadcn", to: join(l.dir, "scaffold", "vite-shadcn"), files: expect.any(Number), by: expect.stringMatching(/\(via web\)$/) }),
      expect.objectContaining({ copy: "download", target: "vite-shadcn", to: `${l.runId}-vite-shadcn.zip` }),
    ]);
    // a run with no approved design says why, and generates nothing
    expect((await call(`/api/runs/${ids.waiting}/scaffold`)).json()).toMatchObject({ available: false, why: expect.stringMatching(/no approved design/) });
    expect((await call(`/api/runs/${ids.waiting}/scaffold`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: "{}" })).status).toBe(400);
  });

  it("a build started from the UI can name its UI target, like --ui-target", async () => {
    _resetStarting();
    const b = await post({ project: "web", prompt: "Add an orders page", uiTarget: "vite-shadcn" });
    expect(b.status).toBe(201);
    expect(replay(Ledger.open(b.json().runId).events()).info.uiTarget).toBe("vite-shadcn");
    expect((await post({ project: "web", prompt: "x", uiTarget: "angular" })).json().error).toMatch(/The UI target takes next-shadcn, vite-shadcn, repo/);
    expect((await post({ project: "web", mode: "estimate", prompt: "x", uiTarget: "repo" })).json().error).toMatch(/chosen for a build/);
  });

  it("runs one export of a run at a time", async () => {
    const l = await approvedDesignRun();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    await new Promise((r) => ui.server.close(r));
    const { ExportJobs } = await import("./exports.js");
    ui = createUiServer({ token: TOKEN, previewKey: PKEY, exportJobs: new ExportJobs(async () => { await gate; return { version: 1, dir: "/x/7" } as never; }) });
    port = await listen(ui, 0);
    expect((await start(l.runId, { formats: ["json"] })).status).toBe(202);
    const again = await start(l.runId, { formats: ["json"] });
    expect([again.status, again.json().error]).toEqual([409, "An export of this run is already running."]);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(ui.exportJobs.list()[0]).toMatchObject({ status: "done", exportId: "v1/7" });
  });
  it("the Fidelity panel: the run's check and its pictures by name only; accepting a baseline is a terminal decision", async () => {
    const l = await approvedDesignRun();
    expect((await call(`/api/runs/${l.runId}/fidelity`)).json().none).toMatch(/design\.fidelity/);
    await ensurePackage(l.runId);
    const dir = join(l.dir, "design-fidelity");
    mkdirSync(join(dir, "built"), { recursive: true });
    writeFileSync(join(dir, "built", "s-1-error-phone.png"), "png");
    const report = {
      kind: "design-fidelity", overall: "fail", ran: ["Chromium"], notes: [],
      levels: [{ level: "structure", check: "structure", blocking: true, status: "FAIL", detail: "1 finding" }],
      findings: [{ level: "structure", message: "actions block is missing", pages: ["s-1-error-phone"] }],
      pages: [{ key: "s-1-error-phone", id: "S-1", screen: "Sign in", state: "error", slug: "error", viewport: "phone", path: "/login", demoState: 0, built: "design-fidelity/built/s-1-error-phone.png" }],
    };
    writeFileSync(join(dir, "report.json"), JSON.stringify(report));
    const v = (await call(`/api/runs/${l.runId}/fidelity`)).json();
    expect(v).toMatchObject({ overall: "fail", canAccept: true, line: l.runId });
    expect(v.pages[0]).toMatchObject({ key: "s-1-error-phone", built: `/fidelity-shots/${l.runId}/built/s-1-error-phone.png`, findings: [{ level: "structure", message: "actions block is missing" }] });
    expect((await call(v.pages[0].built)).status).toBe(200);
    expect((await call(v.pages[0].built, { token: null })).status).toBe(401);
    expect((await call(`/fidelity-shots/${l.runId}/built/..%2Freport.json`)).status).toBe(404);
    expect((await call(`/fidelity-shots/${l.runId}/other/s-1-error-phone.png`)).status).toBe(404);

    const accept = await call(`/api/runs/${l.runId}/fidelity/baseline`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ all: true, by: "lead", reason: "ok" }) });
    expect(accept.status).toBe(404);
    expect(Ledger.open(l.runId).events().some((e) => (e.data as { decision?: string } | undefined)?.decision === "accept-baseline")).toBe(false);
  });
});

describe("factory ui: on a phone", () => {
  // the top bar, the run tabs, the request tabs and the closed step drawer used to push the page sideways at phone width
  it.skipIf(!findChromium())("fits a 375px screen on every main page, with the step drawer closed and open", { timeout: 60_000 }, async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: findChromium()!, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true });
      const wide = async (hash: string) => {
        await page.goto(`http://127.0.0.1:${port}/?t=${TOKEN}${hash}`);
        await page.waitForSelector("main > *");
        await page.waitForTimeout(400);
        return [hash, await page.evaluate(() => document.documentElement.scrollWidth)];
      };
      const pages = ["#/new", "#/new/brownfield", "#/new/estimate", "#/runs", "#/dashboard", `#/runs/${ids.waiting}`, `#/runs/${ids.delivered}/design`];
      const out = [];
      for (const h of pages) out.push(await wide(h));
      expect(out).toEqual(pages.map((h) => [h, 375]));
      await wide(`#/runs/${ids.waiting}`);
      await page.click(".node");
      await page.waitForTimeout(400);
      const open = await page.evaluate(() => ({ right: document.querySelector(".drawer")!.getBoundingClientRect().right, width: document.documentElement.scrollWidth }));
      expect(open).toEqual({ right: 375, width: 375 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector(".drawer")!).visibility)).toBe("hidden");
    } finally {
      await browser.close();
    }
  });
});
