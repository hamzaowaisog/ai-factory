// $0 dry run of `factory fullstack` on REAL containers: one request, two repos, two runs, one contract, then both apps started
// together. Only the model answers and the coding agents are scripted; the wrapper's own functions are the real ones.
//   npx tsx dryrun/fullstack.ts <intent file>
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "../src/stages/modes.js";
import "../src/gates/predicates.js";
import "../src/design/gates.js";
import { _resetEnvCache } from "../src/config/env.js";
import { apiRequest, approvedContract, handOverContract, saveProduct, setUpProduct, writeRunFiles } from "../src/fullstack/product.js";
import { verifyEvidence } from "../src/gates/engine.js";
import { decide } from "../src/ledger/human.js";
import { Ledger } from "../src/ledger/ledger.js";
import { replay } from "../src/ledger/state.js";
import type { Conversation, Provider, Turn } from "../src/runners/api.js";
import { setAgentScript } from "../src/runners/claude-agent.js";
import { createRun, execute } from "../src/stages/executor.js";
import { setProviderFactory } from "../src/stages/think.js";
import { apiAgent, apiAnswer } from "./api-script.js";
import { webAgent, webAnswer } from "./web-script.js";

const root = join(homedir(), ".factory", "tmp", "greenfield-dryrun");
mkdirSync(root, { recursive: true });
const home = mkdtempSync(join(root, "fs-home-"));
process.env.FACTORY_HOME = home;
writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-fake-greenfield-0000000000\nOPENAI_API_KEY=sk-fake-greenfield-0000000000\n", { mode: 0o600 });
_resetEnvCache();

// which run is being executed: the scripted answers differ per side
let side: "web" | "api" = "web";
let current = "";
const U = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
const provider: Provider = { start(_m, _e, system, user): Conversation {
  return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: side === "web" ? webAnswer(system, user) : apiAnswer(system, user) }], text: "", stop: "tool_use", usage: U }; }, toolResults() {}, say() {} };
} };
setProviderFactory(() => provider);
setAgentScript((step) => (side === "web" ? webAgent(replay(Ledger.open(current).events()).workspace!.path, step) : apiAgent(step)));

const cards: string[] = [];
/** Run until delivered or stuck, approving approval cards; with `untilPlanApproved` it stops right after the plan card. */
async function drive(runId: string, which: "web" | "api", untilPlanApproved = false): Promise<string> {
  side = which; current = runId;
  for (let i = 0; i < 8; i++) {
    const r = await execute(runId, (m) => console.log(`  [${which}] ${m}`));
    if (r.status !== "waiting") return `${r.status}: ${r.message}`;
    const ledger = Ledger.open(runId);
    const card = replay(ledger.events()).openCard!;
    if (card.kind !== "approval" && card.kind !== "design-approval") return `STOPPED at a ${card.kind} card`;
    cards.push(`${which}: ${card.kind}`);
    console.log(`  [${which}] CARD ${card.kind} ${card.artifactSha.slice(0, 8)}: approved by the dry run`);
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 8), by: "dryrun", data: { note: "dry run" } });
    if (untilPlanApproved && card.kind === "approval") {
      // the approval is recorded by the approve step: run it, and stop before the build starts
      await execute(runId, (m) => console.log(`  [${which}] ${m}`), { until: "approve" });
      return "plan approved";
    }
  }
  return "kept stopping";
}

const t0 = Date.now();
const request = readFileSync(process.argv[2]!, "utf8");
// --- factory fullstack start ---
const p = setUpProduct("clinic", join(home, "code"));
p.request = request;
p.web.run = await createRun(request, p.web.project, "dryrun", { maxCostUsd: 8 });
saveProduct(p);
console.log(`product clinic: web run ${p.web.run}, home ${home}`);
console.log(`web: ${await drive(p.web.run, "web", true)}`);
// --- factory fullstack next ---
const contract = approvedContract(p);
if (!contract) throw new Error("no approved contract after the web plan was approved");
handOverContract(p, contract);
p.api.run = await createRun(apiRequest(request), p.api.project, "dryrun", { maxCostUsd: 6 });
saveProduct(p);
console.log(`contract handed over; API run ${p.api.run}`);
console.log(`web: ${await drive(p.web.run, "web")}`);
console.log(`api: ${await drive(p.api.run, "api")}`);
// --- factory fullstack up ---
const out = writeRunFiles(p);
for (const [which, run] of [["web", p.web.run], ["api", p.api.run]] as const) {
  const l = Ledger.open(run!);
  const s = replay(l.events());
  const bad = verifyEvidence(l).filter((c) => !c.ok);
  console.log(`${which} ${run}: ${[...s.steps.values()].filter((x) => x.status !== "completed").map((x) => `${x.step}:${x.status}`).join(" ") || "every step completed"}; contract gate ${s.gates.filter((g) => g.gateId === "contract.matches").map((g) => (g.passed ? "pass" : "FAIL")).join(" ") || "n/a"}; evidence ${bad.length ? "FAIL" : "ok"}; cost $${s.costUsd.toFixed(2)}`);
}
console.log(`cards: ${cards.join("; ")}`);
console.log(`wall ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log(`RUNDIR ${out}`);
