// MCP front end (run-manager §2.8): Claude Code (or any MCP client) can start runs and read
// status and cards. It can NEVER answer, approve, reject, waive or unlock: those are TTY-only,
// so a prompt-injected agent can't approve its own plan.
import { existsSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { verifyEvidence } from "../gates/engine.js";
import "../gates/predicates.js";
import { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { shownStatus, statusHint } from "../stages/run-status.js";
import { runDetached } from "../stages/background.js";
import { createRun } from "../stages/executor.js";
import { choiceFrom } from "../stages/routing.js";
import { factoryHome } from "../util/paths.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function findRun(run: string): Ledger {
  if (Ledger.exists(run)) return Ledger.open(run);
  const m = Ledger.listRuns().filter((r) => r.includes(run));
  if (m.length !== 1) throw new Error(m.length ? `"${run}" matches several runs: ${m.join(", ")}` : `No run ${run}`);
  return Ledger.open(m[0]!);
}

function summary(id: string): string {
  const s = replay(Ledger.open(id).events());
  const steps = [...s.steps.values()];
  const current = s.inFlight?.step ?? steps[steps.length - 1]?.step ?? "-";
  const shown = shownStatus(s);
  return `${id}: ${shown}, step ${current}, cost $${s.costUsd.toFixed(2)}`
    + (s.openCard ? `, waiting on a ${s.openCard.kind} card (the user decides in their terminal)` : "")
    + (s.parkedReason ? `, parked: ${s.parkedReason}` : "") + (statusHint(shown, id) ? ` (${statusHint(shown, id)})` : "");
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "ai-factory", version: "0.1.0" });

  server.registerTool("factory_projects", {
    description: "List the projects configured for the AI Factory (the names to pass to factory_start).",
  }, async () => {
    const dir = join(factoryHome(), "projects");
    const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yaml") && f !== "standalone-estimates.yaml").map((f) => f.replace(/\.yaml$/, "")) : [];
    return text(names.length ? names.join("\n") : "No projects yet. The user can add one with `factory init <repo>`.");
  });

  server.registerTool("factory_start", {
    description: "Start an AI Factory run: turns a change request into a verified branch/PR. Runs in the background and stops at human cards (questions, approval) that the USER answers in their own terminal. Returns the run id.",
    inputSchema: {
      request: z.string().min(10).describe("What to change, in plain words"), project: z.string().describe("Project name from factory_projects"),
      preset: z.enum(["economy", "balanced", "quality"]).optional().describe("Set every step's model from the tier table. Leave out for the defaults; only set it when the user asks"),
      models: z.record(z.string(), z.string()).optional().describe("A model for single steps, as { step: model id }, e.g. { \"design\": \"gpt-6-sol\" }. Only when the user names a model; a pick the step does not take is refused"),
    },
  }, async ({ request, project, preset, models }) => {
    // the choice is made once, here: createRun checks it against the project and refuses a pick a step does not take
    const runId = await createRun(request, project, `${userInfo().username} (via MCP)`, { models: choiceFrom({ preset, picks: models }) });
    runDetached(runId);
    return text(`Started run ${runId}. It runs in the background. Check it with factory_status. Questions and approval are answered by the user in their terminal (factory answer / factory approve).`);
  });

  server.registerTool("factory_status", {
    description: "Status of one AI Factory run, or the 10 most recent runs.",
    inputSchema: { run: z.string().optional().describe("Run id or a unique part of it") },
  }, async ({ run }) => {
    const ids = run ? [findRun(run).runId] : Ledger.listRuns().slice(-10);
    return text(ids.length ? ids.map(summary).join("\n") : "No runs yet.");
  });

  server.registerTool("factory_show_card", {
    description: "Show the open human card of a run (questions or the approval card), or the PR text once delivered. Read-only: decisions are made by the user in a terminal.",
    inputSchema: { run: z.string(), pr: z.boolean().optional().describe("Show the PR description instead") },
  }, async ({ run, pr }) => {
    const l = findRun(run);
    if (pr) return text(l.readCard(`pr-${l.runId}`));
    const s = replay(l.events());
    if (!s.openCard) return text(s.parkedReason ? `No open card. Parked: ${s.parkedReason}` : "No open card.");
    return text(`${l.readCard(s.openCard.cardId)}\n\n(Only the user can decide, in their own terminal.)`);
  });

  server.registerTool("factory_verify_evidence", {
    description: "Re-check every recorded gate decision of a run from its evidence ledger.",
    inputSchema: { run: z.string() },
  }, async ({ run }) => {
    const checks = verifyEvidence(findRun(run));
    const bad = checks.filter((c) => !c.ok);
    return text(bad.length ? `${bad.length} of ${checks.length} decisions don't re-check:\n${bad.map((c) => `#${c.seq} ${c.gateId}: ${c.reason}`).join("\n")}` : `All ${checks.length} decisions re-check.`);
  });

  await server.connect(new StdioServerTransport());
}
