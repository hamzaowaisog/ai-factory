// A small, complete estimate and breakdown for tests of the workbook export (no model, no ledger).
import { Estimate } from "../contracts/index.js";
import type { Breakdown } from "../contracts/index.js";
import { estimateApiCost } from "./cost.js";
import type { ExportInput } from "./export.js";
import { gateHours } from "./gate-hours.js";
import { sizeTasks } from "./hours.js";
import { computeTotals } from "./totals.js";

const sha = "a".repeat(64);
const task = (id: string, featureId: string, track: string, executor: string, extra: object = {}) =>
  ({ id, title: `Task ${id}`, featureId, reqs: ["R-1"], items: ["field a", "field b"], track, executor, dependsOn: [], complexity: "standard", ...extra });
export const breakdown = {
  features: [{ id: "F-1", title: "Login", reqs: ["R-1"] }, { id: "F-2", title: "Reports", reqs: ["R-2"] }],
  tasks: [
    task("EST-1", "F-1", "backend", "human"), task("EST-2", "F-1", "web", "factory"), task("EST-3", "F-2", "backend", "joint", { reqs: ["R-2"] }),
    task("EST-4", "F-2", "design", "human", { reqs: ["R-2"] }), task("EST-5", "F-1", "pm", "human", { reqs: [], overhead: "project management" }),
  ],
} as unknown as Pick<Breakdown, "features" | "tasks">;

export function fixture(model: "hitl" | "agentic" = "hitl", designInTotal = true): ExportInput {
  const sizing = sizeTasks([{ taskId: "EST-1", hours: { min: 4, max: 8 } }], [
    { taskId: "EST-1", anchorId: "EST-1", ratio: 1, reason: "anchor", executor: "human" },
    { taskId: "EST-2", anchorId: "EST-1", ratio: 2, reason: "twice the screens", executor: "factory" },
    { taskId: "EST-3", anchorId: "EST-1", ratio: 1.5, reason: "one more rule", executor: "joint" },
    { taskId: "EST-4", anchorId: "EST-1", ratio: 0.5, reason: "two screens", executor: "human" },
    { taskId: "EST-5", anchorId: "EST-1", ratio: 0.25, reason: "light", executor: "human" },
  ]);
  const gates = gateHours(model, { questions: 4, approvalSections: 3, prs: { low: 1, medium: 1, high: 0 }, factoryTasks: 1, waivers: 0 });
  const overheads = [{ name: "Deployment", track: "backend" as const, hours: { min: 2, max: 4 }, reason: "staging and production" }, { name: "Documentation", hours: { min: 1, max: 2 }, reason: "handover notes" }];
  const totals = computeTotals(breakdown.tasks, sizing, overheads, gates, designInTotal);
  const estimate = Estimate.parse({
    header: { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
    deliveryModel: model, band: "M", uncertainty: "medium", breakdownSha: sha, specSha: sha,
    anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "typical login form" }], tasks: sizing, overheads, gateHours: gates, totals,
    apiCost: estimateApiCost({ planning: 1, build: 4, verification: 4 }, [], model),
    elapsed: { planningMinutes: 20, criticalPathDays: { min: 1, max: 2 } },
    settings: { stackSource: "client", designInTotal, feedbackRounds: 2 },
    assumptions: ["Client provides API keys before build"], suggested: [{ title: "Audit log", reason: "no requirement asks for it" }],
  });
  return { estimate, breakdown, header: { client: "Acme", project: "Portal", pm: "A. Lead", date: "2026-09-30", version: "v1" }, notInScope: { mobile: "web app only" }, requirements: [{ id: "R-1", title: "Sign in" }, { id: "R-2", title: "Reports" }] };
}

