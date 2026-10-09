// `--model step=model`, `--preset` and `factory models`: the models a run uses, chosen once, at the start.
import type { Command } from "commander";
import { loadProject, type ProjectConfig } from "../config/project.js";
import { modelName, offeredFor, PRESETS, STEPS, type Preset } from "../stages/models.js";
import { CODING_STEPS, checkRoutes, resolveRoute, routeWarnings, runModels as runModelsOf, stepsOf, type Choice } from "../stages/routing.js";
import { hasPrice, priceOf, UNCONFIRMED_PRICES } from "../runners/pricing.js";
import type { LedgerEvent } from "../contracts/index.js";

export const MODEL_HELP = "the model for one step, as step=model (factory models lists the steps and the models each takes); repeat it. A group name sets every step in it: thinking, design, coding or review";
export const PRESET_HELP = `set every step from the tier table: ${PRESETS.join(", ")} (a --model still wins for its step)`;
export const collectModel = (v: string, prev: string[] = []): string[] => [...prev, v];

/** What `--model` and `--preset` say, as a choice. A group name is spread over the steps of that group this run uses. */
export function choiceOption(model: string[] | undefined, preset: string | undefined, mode?: string): Choice {
  const picks: Record<string, string> = {};
  const steps = stepsOf(mode);
  for (const m of model ?? []) {
    const at = m.indexOf("=");
    if (at < 1 || at === m.length - 1) throw new Error(`--model takes step=model (for example --model design=gpt-6-sol), not "${m}"`);
    const name = m.slice(0, at).trim(), id = m.slice(at + 1).trim();
    const group = steps.filter((s) => STEPS[s]!.group === name && !STEPS[s]!.fixed);
    // a step's own name wins over a group of the same name (design is both: the step, and the group it leads)
    if (!STEPS[name] && group.length) for (const s of group) picks[s] = id;
    else picks[name] = id;
  }
  if (preset !== undefined && !PRESETS.includes(preset as Preset)) throw new Error(`--preset takes ${PRESETS.join(", ")}, not "${preset}"`);
  return { ...(Object.keys(picks).length ? { picks } : {}), ...(preset ? { preset: preset as Preset } : {}) };
}

/** The start check for a run with this choice: problems stop it, warnings are printed. */
export function checkChoice(project: ProjectConfig, choice: Choice, steps: readonly string[] | undefined, log: (s: string) => void): void {
  const problems = checkRoutes(project, steps, choice);
  if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
  for (const w of routeWarnings(project, choice, steps)) log(`note ${w}`);
}

const usd = (n: number): string => `$${n}`;

const table = (head: string[], rows: string[][], log: (s: string) => void): void => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i]!)).join("  ").trimEnd();
  log(line(head));
  for (const r of rows) log(line(r));
};

/**
 * What a run's ledger says about its models: each step's route as saved when the run was created, then what was
 * called on each route (calls, tokens, cost) and every retry that moved a step to another model.
 */
export function runModels(events: LedgerEvent[], log: (s: string) => void): void {
  const m = runModelsOf(events);
  if (!m.saved) log("This run began before routes were saved with a run: it uses the routing table of that time. Its calls are listed by step.");
  else {
    if (m.preset) log(`preset: ${m.preset}`);
    table(["step", "model", "effort", "from", "retry moves to"], m.rows.map((r) => [r.step, r.model, r.effort, r.source + (r.preset ? ` (${r.preset})` : r.tier ? ` (${r.tier})` : ""), r.next ?? "-"]), log);
  }
  log("");
  if (!m.calls.length) { log("No model has been called yet."); return; }
  table([m.saved ? "route" : "step", "model that answered", "from", "calls", "tokens in", "tokens out", "cost"],
    m.calls.map((a) => [a.route, a.model, a.source, String(a.calls), String(a.input), String(a.output), `$${a.usd.toFixed(2)}`]), log);
  log(`total $${m.calls.reduce((n, a) => n + a.usd, 0).toFixed(2)}`);
  if (m.moved.length) { log(""); log("Retries that moved a step to another model:"); }
  for (const x of m.moved) log(`  ${x.step}: ${x.from} -> ${x.to}`);
}

export function registerModels(program: Command, log: (s: string) => void, openRun: (runId: string) => { events(): LedgerEvent[] }): void {
  program.command("models")
    .option("--mode <mode>", "the steps of one kind of run: estimate, design, brownfield or greenfield (default: every step)")
    .option("--project <name>", "read this project's file too (its steps: entries)")
    .option("--model <step=model>", MODEL_HELP, collectModel)
    .option("--preset <name>", PRESET_HELP)
    .option("--run <run>", "read a run's ledger instead: the routes it was created with, what was called on each and what it cost")
    .description("list every model step, the model it would run on and why, and the models it can be given at the start of a run")
    .action((o: { mode?: string; project?: string; model?: string[]; preset?: string; run?: string }) => {
      if (o.run) { runModels(openRun(o.run).events(), log); return; }
      if (o.mode && !["estimate", "design", "brownfield", "greenfield"].includes(o.mode)) throw new Error(`--mode takes estimate, design, brownfield or greenfield, not "${o.mode}"`);
      const project = o.project ? loadProject(o.project) : ({ steps: {} } as unknown as ProjectConfig);
      const choice = choiceOption(o.model, o.preset, o.mode);
      const steps = stepsOf(o.mode);
      const rows = steps.map((stage) => {
        const r = resolveRoute(project, stage, choice);
        const offered = offeredFor(stage).map((m) => m.id);
        return [stage, STEPS[stage]!.group, r.model, r.effort ?? "high", r.source + (r.preset ? ` (${r.preset})` : r.tier ? ` (${r.tier})` : ""), r.escalate[0] ?? "-", offered.length ? offered.join(", ") : "not asked"];
      });
      table(["step", "group", "model", "effort", "from", "retry moves to", "can be given"], rows, log);
      log("");
      log("Prices, USD per million tokens (input / output):");
      for (const id of [...new Set(rows.flatMap((r) => [r[2]!, ...(r[6] === "not asked" ? [] : r[6]!.split(", "))]))].sort()) {
        const p = priceOf(id);
        log(`  ${id.padEnd(18)} ${modelName(id).padEnd(18)} ${hasPrice(id) ? `${usd(p.input)} / ${usd(p.output)}` : "no price: costed at the highest rate"}${UNCONFIRMED_PRICES.includes(id) ? "  (not confirmed on OpenAI's price page)" : ""}`);
      }
      const problems = checkRoutes(project, steps, choice);
      if (problems.length) { log(""); log("A run with these would not start:"); for (const p of problems) log(`- ${p}`); }
      for (const x of routeWarnings(project, choice, steps)) log(`note ${x}`);
      if (!o.mode && [...CODING_STEPS].some((s) => choice.picks?.[s])) log("note a coding pick applies to every task of the run");
    });
}
