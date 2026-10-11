// $0 dry run of ONE-RUN greenfield on REAL containers: only the model answers are scripted. The request file, the empty
// repo, the scaffold, npm install/build/test in the Node lab, the coding containers, the fidelity check and delivery are real.
//   npx tsx dryrun/one-run-greenfield.ts --intent <file> [--no-fidelity] [--kill-at-implement]
//   npx tsx dryrun/one-run-greenfield.ts --resume <home> <run>            (what `factory resume` does, with the same scripted models)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import "../src/stages/modes.js";
import "../src/gates/predicates.js";
import "../src/design/gates.js";
import { _resetEnvCache } from "../src/config/env.js";
import { seedEmptyRepo } from "../src/config/greenfield.js";
import { verifyEvidence } from "../src/gates/engine.js";
import { decide } from "../src/ledger/human.js";
import { Ledger } from "../src/ledger/ledger.js";
import { replay } from "../src/ledger/state.js";
import type { Conversation, Provider, Turn } from "../src/runners/api.js";
import { setAgentScript } from "../src/runners/claude-agent.js";
import { createRun, execute } from "../src/stages/executor.js";
import { setProviderFactory } from "../src/stages/think.js";

const arg = (f: string, n = 1) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + n] : undefined; };
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// ---------- scripted answers: two screens, two requirements, two tasks ----------
const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's appointments", traits: ["dense", "quiet"] }, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "one blue action" }] };
const intent = { source: "cli", spans: [{ id: "I-1", text: "staff sign in with their email" }, { id: "I-2", text: "staff see today's appointments" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true };
const REQS = [
  { id: "REQ-1", ears: "When a user gives their email, the portal shall sign them in.", op: "ADDED", sources: ["I-1"], anchors: [], acceptance: [{ id: "AC-1.1", given: "a known email", when: "the user signs in", then: "the screen shows Signed in", level: "unit" }] },
  { id: "REQ-2", ears: "When a signed-in user opens the appointments page, the portal shall list today's appointments.", op: "ADDED", sources: ["I-2"], anchors: [], acceptance: [{ id: "AC-2.1", given: "three appointments today", when: "the user opens the page", then: "the screen shows three rows", level: "unit" }] },
];
const draft = { requirements: REQS, nfrs: [], outOfScope: [], assumptions: [], suggestions: [] };
const signIn = { title: "Sign in", blocks: [{ type: "form", fields: [{ label: "Email", kind: "email" }], submit: "Sign in" }, { type: "actions", buttons: ["Need help"] }], copy: {} };
const list = { title: "Today's appointments", blocks: [{ type: "stats", items: [{ label: "Booked today", value: "3" }] }, { type: "table", columns: ["Patient", "Time", "Status"], rows: [["Amina Yusuf", "09:30", "Confirmed"], ["Daniel Okoro", "10:15", "Waiting"], ["Sara Malik", "11:00", "Confirmed"]] }], copy: {} };
const NAMES = ["Amina Yusuf", "Daniel Okoro", "Sara Malik", "Tomas Reyes", "Hina Baig", "Luca Moretti", "Noor Rahman", "Ivy Chen", "Omar Farouk"];
const listFull = { ...list, blocks: [list.blocks[0], { type: "table", columns: ["Patient", "Time", "Status"], rows: NAMES.map((n, i) => [n, `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, ["Confirmed", "Waiting", "Cancelled"][i % 3]!]) }] };
const DESIGN = { flow: "A user signs in, then sees today's appointments.", theme, noScreen: [], screens: [
  { id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", frames: [], mock: signIn, mockFull: signIn },
  { id: "S-2", route: "/appointments", file: "app/appointments/page.tsx", reqs: ["REQ-2"], states: ["empty"], size: "new", frames: [], mock: list, mockFull: listFull },
] };
const TESTS = [{ acId: "AC-1.1", file: "tests/sign-in.test.ts", name: "AC_1_1_SignsIn", marker: "SIGNED_IN_MARKER" }, { acId: "AC-2.1", file: "tests/appointments.test.ts", name: "AC_2_1_ListsToday", marker: "APPOINTMENTS_MARKER" }];

const U = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
const asked: string[] = [];
const scriptedReview = (user: string) => ({ findings: [], coverage: [...new Set([...user.matchAll(/"id":\s*"(AC-[\w.-]+)"/g)].map((m) => m[1]!))].map((acId) => ({ acId, testId: "", verdict: "proves-it" as const, why: "scripted" })) });
function answerFor(system: string, user: string): unknown {
  asked.push(system.slice(0, 50).replace(/\s+/g, " "));
  if (system.includes("plan the implementation")) {
    const containers = [...new Set([...user.matchAll(/"container":\s*"([^"]+)"/g)].map((m) => m[1]!))];
    const ds = /"designSystemTask":\s*\{\s*"fileScope":\s*(\[[^\]]*\])/.exec(user);
    const dsFiles = ds ? (JSON.parse(ds[1]!) as string[]) : [];
    containers.sort();
    console.log(`  [scripted plan: containers ${containers.join(", ")}]`);
    return {
      tasks: [
        { id: "TASK-1", title: "Sign-in screen", reqs: ["REQ-1"], fileScope: [...dsFiles, containers[0]!], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 20, approach: "wire the sign-in form in the screen's container" },
        { id: "TASK-2", title: "Appointments screen", reqs: ["REQ-2"], fileScope: [containers[1]!], exemplars: [], conventions: [], dependsOn: ["TASK-1"], plannedLoc: 20, approach: "list today's appointments from fixture data in the screen's container" },
      ],
      options: [{ id: "O-1", summary: "the screens' containers", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "a separate data module", simplest: false, tradeoffs: "more code" }],
      chosen: "O-1", adr: "Build it in the containers the scaffold made.", protectedPathsDeclared: [], newDependencies: [], stubs: [],
    };
  }
  if (system.includes("review a finished change")) return scriptedReview(user);
  if (system.includes("intake step")) return intent;
  // the spec's open problems are settled by questions in a build too: none to ask here, so they are carried as open risks
  if (system.includes("these problems are still open")) return { questions: [], inRequest: [] };
  if (system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "staff sign in with their email", kind: "happy" }] }, { id: "I-2", behaviours: [{ text: "staff see today's appointments", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: REQS.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`] })), conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Staff sign in with their email." }, { n: 2, text: "Staff see today's appointments." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }, { n: 2, spans: ["I-2"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("drawing the screen inventory")) return DESIGN;
  throw new Error(`unscripted system prompt: ${system.slice(0, 120)}`);
}
const provider: Provider = { start(_m, _e, system, user): Conversation {
  return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: answerFor(system, user) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
} };
setProviderFactory(() => provider);

// ---------- setup: a new home and an empty repo, or the ones of a run to resume ----------
const resume = process.argv.includes("--resume");
const home = resume ? arg("--resume")! : mkdtempSync(join((mkdirSync(join(homedir(), ".factory", "tmp", "greenfield-dryrun"), { recursive: true }), join(homedir(), ".factory", "tmp", "greenfield-dryrun")), "home-"));
process.env.FACTORY_HOME = home;
let runId = resume ? arg("--resume", 2)! : "";
if (!resume) {
  writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-fake-greenfield-0000000000\nOPENAI_API_KEY=sk-fake-greenfield-0000000000\n", { mode: 0o600 });
  const repo = join(home, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  seedEmptyRepo(repo);
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "shop.yaml"), stringify({ project: "shop", repo, stack: "node", design: { fidelity: process.argv.includes("--no-fidelity") ? false : {} } }));
}
_resetEnvCache();

// the scripted agents work on the run's real worktree: real tests that fail until each container carries its marker
const worktree = () => replay(Ledger.open(runId).events()).workspace!.path;
const containers = (wt: string) => (readdirSync(wt, { recursive: true, encoding: "utf8" }) as string[]).filter((f) => f.endsWith("container.tsx") && !f.includes("node_modules"));
const containerFor = (wt: string, t: (typeof TESTS)[number]) => containers(wt).sort()[TESTS.indexOf(t)]!;
setAgentScript((step) => {
  const wt = worktree();
  if (step === "author-tests") return {
    writes: TESTS.map((t) => ({ path: t.file, content: `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("${t.name}", () => { expect(readFileSync("${containerFor(wt, t)}", "utf8")).toContain("${t.marker}"); });\n` })),
    output: { tests: TESTS.map(({ acId, file, name }) => ({ acId, file, name })), characterisation: [], probes: [], notes: "" },
  };
  if (step === "implement") {
    // the tasks run in order: the next container still without its marker is this task's
    const t = TESTS.find((x) => !readFileSync(join(wt, containerFor(wt, x)), "utf8").includes(x.marker))!;
    if (process.argv.includes("--kill-at-implement") && t === TESTS[1]) { console.log(`\nKILLED mid-implement (second task started, not finished). Resume with:\n  npx tsx dryrun/one-run-greenfield.ts --resume ${home} ${runId}`); process.kill(process.pid, "SIGKILL"); }
    const c = containerFor(wt, t);
    return { writes: [{ path: c, content: `${readFileSync(join(wt, c), "utf8")}\n/* ${t.marker} */\n` }], output: { done: true, filesChanged: [c], notes: "" } };
  }
  return undefined;
});

if (!resume) {
  const file = arg("--intent")!;
  // exactly what `factory start --file <intent> --project shop` passes: the file's text, no mode, no design run
  runId = await createRun(readFileSync(file, "utf8"), "shop", "dryrun", { requestFile: file, maxCostUsd: 12 });
}
const t0 = Date.now();
console.log(`${resume ? "resuming" : "one-run greenfield dry run"} ${runId}  (home ${home}; mode ${replay(Ledger.open(runId).events()).info.mode})`);
let passes = 0;
for (let i = 0; i < 8; i++) {
  passes++;
  const r = await execute(runId, (m) => console.log(`  ${m}`));
  if (r.status !== "waiting") { console.log(`\n${r.status}: ${r.message}`); break; }
  const ledger = Ledger.open(runId);
  const card = replay(ledger.events()).openCard!;
  if (card.kind !== "approval" && card.kind !== "design-approval") { console.log(`\nSTOPPED at a ${card.kind} card:\n${readFileSync(join(ledger.dir, "cards", `${card.cardId}.md`), "utf8").slice(0, 2500)}`); break; }
  console.log(`  [CARD ${card.kind} ${card.artifactSha.slice(0, 8)}: approved by the dry run  (factory approve ${runId} ${card.artifactSha.slice(0, 8)})]`);
  await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 8), by: "dryrun", data: { note: "dry run" } });
}
const l = Ledger.open(runId);
const s = replay(l.events());
const bad = verifyEvidence(l).filter((c) => !c.ok);
console.log(`execute passes this invocation: ${passes}; wall ${((Date.now() - t0) / 60000).toFixed(1)} min; model prompts answered: ${asked.length}`);
console.log(`steps: ${[...s.steps.values()].map((x) => `${x.step}${x.attempts > 1 ? `(x${x.attempts})` : ""}:${x.status === "completed" ? "ok" : x.status}`).join(" ")}`);
console.log(`verify-evidence: ${bad.length ? "FAIL " + JSON.stringify(bad).slice(0, 300) : "all ok"}; cost $${s.costUsd.toFixed(2)}`);
