#!/usr/bin/env node
// factory CLI (run-manager §2.8). Decisions (approve/reject/...) work only on a terminal.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { hasSecret } from "../config/env.js";
import { loadProject, projectPath } from "../config/project.js";
import { registerConventions } from "./conventions.js";
import { registerMergeGate } from "./merge-gate.js";
import { verifyEvidence } from "../gates/engine.js";
import "../gates/predicates.js";
import "../design/gates.js";
import "../estimate/lint.js";
import "../estimate/gates.js";
import { registerDesignCommands } from "../design/cli.js";
import { assertTty, decide, DecisionError } from "../ledger/human.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { MAX_BUDGET_CEILING, replay, statusLabel } from "../ledger/state.js";
import { createRun, dirtyWarning, execute } from "../stages/executor.js";
import { answerOpenQuestions, canPrompt, terminalIO } from "./interactive.js";
import { describeSources, gatherRequest, MAX_ESTIMATE_REQUEST_BYTES } from "../sources/request.js";
import { describeReferences, gatherReferences, parseRefArg } from "../sources/refs.js";
import { jiraFetcherFor } from "../sources/jira.js";
import { parseEstimateSettings, type EstimateOptions } from "../estimate/settings.js";
import { approvedDesign, approvedEstimate, designFitsProject, estimateDesign, type Approved, type ApprovedDesign } from "../estimate/lineage.js";
import { greenfieldRefusal } from "../config/greenfield.js";
import { DESIGN_EXPORT_HELP, designExportOption, exportSeededNow, registerDesignRunCommands, UI_TARGET_HELP, uiTargetOption } from "./design-runs.js";
import type { RequestSource } from "../sources/request.js";
import { checkEdit, parseAnchorSpec, parseRatioSpec } from "../estimate/edits.js";
import type { Proposal } from "../estimate/assemble.js";
import { checkRoutes, ESTIMATE_ROUTES } from "../stages/routing.js";
import { findRuntimeBinary } from "../verify/runtime.js";
import { factoryHome } from "../util/paths.js";

const log = (m: string): void => { process.stdout.write(`${m}\n`); };

function openRun(runId: string): Ledger {
  if (!Ledger.exists(runId)) {
    const matches = Ledger.listRuns().filter((r) => r.includes(runId));
    if (matches.length === 1) return Ledger.open(matches[0]!);
    throw new Error(matches.length ? `"${runId}" matches several runs: ${matches.join(", ")}` : `No run ${runId}`);
  }
  return Ledger.open(runId);
}

/** Run, and while the run only waits for answers to its questions, ask them here and carry on (a terminal only; elsewhere the run stops with the `factory answer` command). */
async function runAndReport(runId: string): Promise<void> {
  for (;;) {
    const r = await execute(runId, log);
    if (r.status === "waiting" && canPrompt()) {
      const io = terminalIO(log);
      try {
        if (await answerOpenQuestions(Ledger.open(runId), io)) continue;
      } finally { io.close(); }
    }
    log(`\n${r.status}: ${r.message}`);
    return;
  }
}

const program = new Command();
program.name("factory").description("AI Factory: turns a request into a verified PR").version("0.1.0");

program.command("start")
  .argument("[prompt]", "what you want changed, in plain words")
  .requiredOption("--project <name>", "project config in ~/.factory/projects/<name>.yaml")
  .option("--file <path>", "the request as a Markdown or text file")
  .option("--jira <key>", "the request as a Jira ticket (ABC-123 or its link)")
  .option("--from-estimate <run>", "build an approved estimate: inherits its spec, plans against its tasks, and is held to its size and budget (gates B1-B5)")
  .option("--from-design <run>", "build an approved design-only run (factory design start): inherits its spec and follows its approved screens and look")
  .option("--ref <ref>", 'a design reference: an image, an https link, a Figma link, a PDF, a .docx or a Figma JSON export; optional role match:, inspire: or layout: in front and a note after |, e.g. --ref "layout:dash.jpg|table like this"; repeat it', (v: string, prev: string[] = []) => [...prev, v])
  .option("--max-cost <dollars>", "a lower spend limit for this run (it can only lower the normal limit)")
  .option("--design-export <formats>", DESIGN_EXPORT_HELP)
  .option("--ui-target <target>", UI_TARGET_HELP)
  .description("create a run from a prompt, a file or a Jira ticket (any one, or several) and execute until a card, a park, or delivery")
  .action(async (prompt: string | undefined, o: { project: string; maxCost?: string; file?: string; jira?: string; fromEstimate?: string; fromDesign?: string; ref?: string[]; designExport?: string; uiTarget?: string }) => {
    const designExport = designExportOption(o.designExport);
    const uiTarget = uiTargetOption(o.uiTarget);
    const project = loadProject(o.project);
    const dirty = dirtyWarning();
    if (dirty) log(dirty);
    const problems = checkRoutes(project);
    if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
    // everything is read before a run exists: a bad file or ticket costs nothing
    let approved: Approved | undefined;
    if (o.fromEstimate) {
      if (prompt || o.file || o.jira) throw new Error("--from-estimate takes its request from the estimate; drop the prompt, --file and --jira. A changed requirement is a change request: factory estimate --revises <run>.");
      if (o.ref?.length) throw new Error("--from-estimate builds the design approved with the estimate; drop --ref. To change the design, estimate a change request with the references: factory estimate --revises <run> --ref ...");
      approved = approvedEstimate(openRun(o.fromEstimate).runId, { build: true });
    }
    let fromDesign: ApprovedDesign | undefined;
    if (o.fromDesign) {
      if (o.fromEstimate) throw new Error("Use --from-estimate or --from-design, not both. An estimate made with --from-design already carries the design: build it with --from-estimate.");
      if (prompt || o.file || o.jira) throw new Error("--from-design takes its request from the design run; drop the prompt, --file and --jira.");
      if (o.ref?.length) throw new Error("--from-design builds the design approved in that run; drop --ref. To change the design, start a new design run with the references.");
      fromDesign = approvedDesign(openRun(o.fromDesign).runId);
      // a design for a new product (no repo) is built into a project whose repo is still empty (greenfield)
      const why = fromDesign.repo ? undefined : greenfieldRefusal(fromDesign.runId, project);
      if (why) throw new Error(why);
      if (!designFitsProject(fromDesign, o.project)) throw new Error(`${fromDesign.runId} was designed for project ${fromDesign.project}, not ${o.project}.`);
    }
    const req = approved ? { text: approved.request, sources: [{ kind: "prompt" as const }] } : fromDesign ? { text: fromDesign.request, sources: [{ kind: "prompt" as const }] } : await gatherRequest({ prompt, file: o.file, jira: o.jira }, { fetchJira: jiraFetcherFor(project.jira?.allowedReporters) });
    const references = await gatherReferences((o.ref ?? []).map(parseRefArg), { allowPrivate: !!project.design?.allowPrivateRefs });
    const runId = await createRun(req.text, o.project, userInfo().username, {
      ...(o.maxCost !== undefined ? { maxCostUsd: Number(o.maxCost) } : {}),
      sources: req.sources, references, ...(approved ? { lineage: { kind: "build" as const, approved } } : {}), ...(fromDesign ? { fromDesign, ...(fromDesign.repo ? {} : { mode: "greenfield" as const }) } : {}), ...(designExport ? { designExport } : {}), ...(uiTarget ? { uiTarget } : {}),
    });
    log(`run ${runId} (request from ${fromDesign ? `design run ${fromDesign.runId}; the build follows its approved design${fromDesign.repo ? "" : ", a new product built into an empty repo"}` : describeSources(req.sources)}${references.length ? `; design references ${describeReferences(references)}` : ""})`);
    if (approved || fromDesign) await exportSeededNow(runId, designExport, log);
    await runAndReport(runId);
  });

program.command("estimate")
  .argument("[prompt]", "the requirements, in plain words")
  .option("--project <name>", "project config in ~/.factory/projects/<name>.yaml; leave it out to estimate from the requirements alone (no repo)")
  .option("--file <path>", "the requirements as a Markdown, text or Word (.docx) file")
  .option("--frames <dir>", "a folder of design frames exported from Figma (png, jpg, webp, svg or json)")
  .option("--jira <key>", "the requirements as a Jira ticket (ABC-123 or its link)")
  .option("--ref <ref>", 'a design reference: an image, an https link, a Figma link, a PDF, a .docx or a Figma JSON export; optional role match:, inspire: or layout: in front and a note after |, e.g. --ref "layout:dash.jpg|table like this"; repeat it', (v: string, prev: string[] = []) => [...prev, v])
  .option("--stack-source <source>", "client (fixed), folio3 (we decide) or undecided (a default pack, stated as an assumption)", "undecided")
  .option("--no-design-in-total", "keep Design out of the Summary total (the row still shows)")
  .option("--feedback-rounds <n>", "client feedback rounds to allow for", "2")
  .option("--rate <track=usd>", "hourly rate per track (backend, mobile, web, qa, design, gd, pm, pdm, default); repeat it; adds the team file's cost overlay", (v: string, prev: string[] = []) => [...prev, v])
  .option("--no-repo", "the requirements stand alone: there is no existing code to read")
  .option("--client <name>", "client name for the workbook header")
  .option("--project-name <name>", "project name for the workbook header")
  .option("--pm <name>", "project manager for the workbook header")
  .option("--review", "a person answers the clarify questions and approves the estimate (the default, unless the project sets estimate.humanReview: false)")
  .option("--hands-off", "opt in to a hands-off run: nobody is asked, open questions become assumptions and the factory approves the estimate once its gates pass. A build cannot follow it: estimate again with a review to build")
  .option("--revises <run>", "a change request: the new requirements revise an approved estimate, and the card shows what changed")
  .option("--from-design <run>", "size an approved design-only run (factory design start): its spec, answers and approved design are reused, only the sizing is new")
  .option("--resize <run>", "size an earlier estimate run again: its requirements, answers, spec, approved design and settings are reused (no clarify, no design), and only breakdown, sizing, approval and the workbooks run anew")
  .option("--max-cost <dollars>", "a lower spend limit for this run (it can only lower the normal limit)")
  .option("--fresh", "ask the model again even if the same requirements were estimated before (skips the stored answers)")
  .option("--design-export <formats>", DESIGN_EXPORT_HELP)
  .description("estimate the effort, API credit cost and elapsed time of delivering requirements through the factory, then write two workbooks; a person answers the questions and approves it unless --hands-off")
  .action(async (prompt: string | undefined, o: EstimateOptions & { handsOff?: boolean; project?: string; file?: string; frames?: string; jira?: string; maxCost?: string; revises?: string; fromDesign?: string; resize?: string; fresh?: boolean; ref?: string[]; designExport?: string }) => {
    if (o.fresh) process.env.FACTORY_NO_CACHE = "1";
    const designExport = designExportOption(o.designExport);
    let fromDesign: ApprovedDesign | undefined;
    if (o.resize) {
      if (o.fromDesign || o.revises) throw new Error("--resize starts a new estimate from an earlier one; it does not go with --from-design or --revises.");
      if (prompt || o.file || o.jira || o.frames || o.ref?.length) throw new Error("--resize takes its requirements and design from the earlier run; drop the prompt, --file, --jira, --frames and --ref.");
      fromDesign = estimateDesign(openRun(o.resize).runId);
      if (o.project && o.project !== fromDesign.project) throw new Error(`${fromDesign.runId} was estimated for project ${fromDesign.project}, not ${o.project}.`);
      o.project = fromDesign.project;
    } else if (o.fromDesign) {
      if (o.revises) throw new Error("--from-design starts a new estimate; it does not go with --revises.");
      if (prompt || o.file || o.jira || o.frames) throw new Error("--from-design takes its requirements from the design run; drop the prompt, --file, --jira and --frames.");
      if (o.ref?.length) throw new Error("--from-design sizes the design approved in that run; drop --ref. To change the design, start a new design run with the references.");
      fromDesign = approvedDesign(openRun(o.fromDesign).runId);
      if (o.project && o.project !== fromDesign.project) throw new Error(`${fromDesign.runId} was designed for project ${fromDesign.project}, not ${o.project}.`);
      o.project = fromDesign.project;
    }
    // no --project: the requirements stand alone, so there is no repo to read
    const projectName = o.project ?? (await import("../config/project.js")).ensureStandaloneProject();
    const project = loadProject(projectName);
    const problems = checkRoutes(project, ESTIMATE_ROUTES);
    if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
    if (o.handsOff && o.review) throw new Error("Use --review or --hands-off, not both.");
    o.review = o.handsOff ? false : o.review ?? project.estimate?.humanReview ?? true;
    let settings = parseEstimateSettings(o.project && !fromDesign?.settings.noRepo ? o : { ...o, repo: false });
    // a resize is the same estimate sized again, so the earlier run's settings stand; only who reviews is asked anew
    if (o.resize) settings = { ...fromDesign!.settings, humanReview: settings.humanReview };
    // the design run's product details stand unless given again
    else if (fromDesign) settings = { ...settings, ...Object.fromEntries(Object.entries({ client: fromDesign.settings.client, projectName: fromDesign.settings.projectName }).filter(([k, v]) => v && !(settings as Record<string, unknown>)[k])) };
    let lineage: { kind: "change"; approved: Approved } | undefined;
    let req: { text: string; sources: RequestSource[]; attachments: { name: string; bytes: Buffer }[] };
    if (fromDesign) {
      req = { text: fromDesign.request, sources: [{ kind: "prompt" }], attachments: [] };
    } else {
      req = await gatherRequest({ prompt, file: o.file, jira: o.jira, frames: o.frames }, { fetchJira: jiraFetcherFor(project.jira?.allowedReporters) }, { maxBytes: MAX_ESTIMATE_REQUEST_BYTES });
      if (o.revises) lineage = { kind: "change", approved: approvedEstimate(openRun(o.revises).runId) };
    }
    // read before the run exists: a reference that cannot be read stops here and costs nothing
    const references = await gatherReferences((o.ref ?? []).map(parseRefArg), { allowPrivate: !!project.design?.allowPrivateRefs });
    const runId = await createRun(req.text, projectName, userInfo().username, {
      mode: "estimate", estimate: settings, sources: req.sources, attachments: req.attachments, references, ...(lineage ? { lineage } : {}), ...(fromDesign ? { fromDesign } : {}),
      ...(o.maxCost !== undefined ? { maxCostUsd: Number(o.maxCost) } : {}), ...(designExport ? { designExport } : {}),
    });
    if (fromDesign) await exportSeededNow(runId, designExport, log);
    log(`estimate run ${runId} (requirements from ${o.resize ? `estimate run ${o.resize}, with its spec and approved design; only the sizing is new` : fromDesign ? `design run ${fromDesign.runId}, with its approved design` : describeSources(req.sources)}${references.length ? `; design references ${describeReferences(references)}` : ""}; solely agentic${settings.humanReview ? ", with human review" : ", hands-off"})`);
    await runAndReport(runId);
  });

program.command("resume").argument("<run>").description("continue a run").action(async (run: string) => {
  await runAndReport(openRun(run).runId);
});

program.command("status").argument("[run]").description("state, current step, cost, open card").action(async (run?: string) => {
  const runs = run ? [openRun(run).runId] : Ledger.listRuns().slice(-10);
  if (!runs.length) return log("No runs yet.");
  for (const id of runs) {
    const s = replay(Ledger.open(id).events());
    const steps = [...s.steps.values()];
    const current = s.inFlight?.step ?? steps.filter((x) => x.status !== "completed").pop()?.step ?? steps[steps.length - 1]?.step ?? "-";
    log(`${id}  ${statusLabel(s.status).padEnd(10)} step ${current.padEnd(18)} $${s.costUsd.toFixed(2)}${s.openCard ? `  card: ${s.openCard.kind} ${s.openCard.artifactSha.slice(0, 8)}` : ""}${s.parkedReason ? `\n    parked: ${s.parkedReason}` : ""}`);
    if (run) {
      const { lastActivity, fmtElapsed } = await import("../util/trace.js");
      const last = lastActivity(Ledger.open(id).dir);
      if (last) {
        const ago = Date.now() - Date.parse(last.ts);
        const busy = s.status === "running" || !!s.inFlight;
        log(`    now: ${last.step ?? "run"}${last.attempt ? ` attempt ${last.attempt}` : ""} · ${last.msg} · ${fmtElapsed(ago).slice(1)} ago${busy && ago > 10 * 60_000 ? `  ⚠ no activity for ${Math.round(ago / 60_000)} min (see factory logs ${id} --follow)` : ""}`);
      }
      for (const x of steps) log(`    ${x.status.padEnd(11)} ${x.step}  (attempts ${x.attempts})`);
    }
  }
});

program.command("show-card").argument("<run>").option("--pr", "show the PR text").description("print the open card").action((run: string, o: { pr?: boolean }) => {
  const l = openRun(run);
  if (o.pr) return log(l.readCard(`pr-${l.runId}`));
  const s = replay(l.events());
  if (!s.openCard) return log(s.parkedReason ? `No open card. Parked: ${s.parkedReason}` : "No open card.");
  log(l.readCard(s.openCard.cardId));
});

for (const d of ["approve", "reject"] as const) {
  program.command(d).argument("<run>").argument("<hash>", "first characters of the card hash")
    .option("--note <text>", "your risk note (approve)")
    .option("--sign-off <ids>", "estimate cards: sign off these low-confidence tasks, comma-separated (approve)")
    .option("--reason <text>", "why (reject)")
    .option("--reject <reason>", "reject instead, with this reason (approve only)")
    .description(d === "approve"
      ? "approve the open card, or --reject \"<reason>\" to send the spec and plan back with your reason (terminal only)"
      : "reject the open card with --reason; the spec and plan are revised and you get a new card (terminal only)")
    .action(async (run: string, hash: string, o: { note?: string; signOff?: string; reason?: string; reject?: string }) => {
      assertTty();
      const l = openRun(run);
      const decision = d === "approve" && o.reject !== undefined ? "reject" : d;
      const design = replay(l.events()).openCard?.kind === "design-approval";
      if (design && decision === "reject" && !(o.reject ?? o.reason ?? "").trim()) throw new DecisionError('Say what to change with --reason "...", naming the page or the part in your own words.');
      const signOff = (o.signOff ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const data = decision === "approve" ? { note: o.note ?? "", ...(signOff.length ? { signOff } : {}) } : { reason: o.reject ?? o.reason ?? "" };
      const r = await decide(l, { decision, hashPrefix: hash, data });
      if (r.kind === "repeat") return log("Already recorded.");
      log(decision === "approve" ? "Approved." : design ? "Sent back. Fixing what you pointed at (or redrawing the design if it needs that); a new card follows…" : "Rejected. Revising the spec and plan with your reason…");
      await runAndReport(l.runId);
    });
}

program.command("waive").argument("<run>").argument("<hash>", "first characters of the waiver card's hash")
  .requiredOption("--reason <text>", "why the failing gate is acceptable (recorded with your name)")
  .description("waive the estimate gate(s) on the open waiver card (terminal only; estimate gates E3, E4, E5 and build gates B1, B3, B4, B6)")
  .action(async (run: string, hash: string, o: { reason: string }) => {
    assertTty();
    const l = openRun(run);
    if (replay(l.events()).openCard?.kind !== "waiver") throw new DecisionError("The open card is not a waiver card.");
    const r = await decide(l, { decision: "waive", hashPrefix: hash, data: { reason: o.reason } });
    if (r.kind === "repeat") return log("Already recorded.");
    log("Waived, and recorded with your name.");
    await runAndReport(l.runId);
  });

program.command("edit-estimate").argument("<run>").argument("<hash>", "first characters of the estimate card's hash")
  .option("--anchor <EST-n=min-max>", "set an anchor's hours; repeat it", (v: string, prev: string[] = []) => [...prev, v])
  .option("--ratio <EST-n=multiple>", "set a task's ratio to its anchor; repeat it", (v: string, prev: string[] = []) => [...prev, v])
  .requiredOption("--reason <text>", "why (recorded with your name and shown in the estimate's assumptions)")
  .description("edit anchors or ratios on the open estimate card; every total, gate and workbook cell is recomputed and you get a new card (terminal only)")
  .action(async (run: string, hash: string, o: { anchor?: string[]; ratio?: string[]; reason: string }) => {
    assertTty();
    const l = openRun(run);
    const state = replay(l.events());
    if (state.openCard?.kind !== "estimate-approval") throw new DecisionError("The open card is not an estimate card.");
    const edits = {
      anchors: Object.fromEntries((o.anchor ?? []).map(parseAnchorSpec)),
      ratios: Object.fromEntries((o.ratio ?? []).map(parseRatioSpec)),
    };
    const proposals = l.getJson<Proposal[]>(state.steps.get("estimate")!.data!.named ? (state.steps.get("estimate")!.data!.named as Record<string, string>).proposals! : "");
    const problems = proposals ? checkEdit(edits, proposals[0]!) : ["the estimate's proposals are missing"];
    if (problems.length) throw new DecisionError(`Can't apply that edit: ${problems.join("; ")}`);
    const r = await decide(l, { decision: "edit", hashPrefix: hash, data: { edits, reason: o.reason } });
    if (r.kind === "repeat") return log("Already recorded.");
    log("Edit recorded. Recomputing the estimate…");
    await runAndReport(l.runId);
  });

program.command("answer").argument("<run>").argument("<hash>", "first characters of the card hash")
  .argument("<answers...>", 'Q-1=A Q-2="your own words"')
  .description("answer the open question card (terminal only)")
  .action(async (run: string, hash: string, pairs: string[]) => {
    assertTty();
    const answers: Record<string, string> = {};
    for (const p of pairs) {
      const m = /^(Q-\d+)=(.+)$/s.exec(p);
      if (!m) throw new DecisionError(`Can't read "${p}". Use Q-1=A or Q-1="words".`);
      answers[m[1]!] = m[2]!;
    }
    const l = openRun(run);
    const r = await decide(l, { decision: "answer", hashPrefix: hash, data: { answers } });
    log(r.kind === "repeat" ? "Already recorded." : "Answers recorded; unanswered questions use the recommended option.");
    if (r.kind === "recorded") await runAndReport(l.runId);
  });

program.command("waive-budget").argument("<run>").argument("<hash>", "first characters of the budget card's hash")
  .requiredOption("--reason <text>", "why going past the approved estimate is acceptable (recorded with your name)")
  .option("--ceiling <n>", "new limit as a multiple of the approved maximum (default: the card's suggestion)")
  .description("let a run that reached its approved estimate (gate B5) continue to a higher limit (terminal only)")
  .action(async (run: string, hash: string, o: { reason: string; ceiling?: string }) => {
    assertTty();
    const l = openRun(run);
    const card = replay(l.events()).openCard as ({ kind: string; proposed?: number } | undefined);
    if (card?.kind !== "budget") throw new DecisionError("The open card isn't a budget card.");
    const ceiling = o.ceiling !== undefined ? Number(o.ceiling) : card.proposed;
    const current = replay(l.events()).budgetCeiling;
    if (!Number.isFinite(ceiling) || (ceiling as number) <= current || (ceiling as number) > MAX_BUDGET_CEILING) {
      throw new DecisionError(`--ceiling must be above the current limit (${current}) and at most ${MAX_BUDGET_CEILING} (a multiple of the approved maximum). Past ${MAX_BUDGET_CEILING * 100}%, revise the estimate with a change request.`);
    }
    const r = await decide(l, { decision: "waive-budget", hashPrefix: hash, data: { reason: o.reason, ceiling } });
    if (r.kind === "repeat") return log("Already recorded.");
    log(`Limit raised to ${Math.round((ceiling as number) * 100)}% of the approved maximum, recorded with your name. Continuing…`);
    await runAndReport(l.runId);
  });

program.command("waive-cap").argument("<run>").argument("<hash>", "first characters of the limit card's hash")
  .option("--cost <dollars>", "new cost limit for this run, in USD")
  .option("--minutes <n>", "new active-time limit, in minutes")
  .option("--attempts <n>", "extra attempts per step (the retry ladder starts again)")
  .description("accept going past a limit (cost, time or attempts) and continue; without options uses the card's suggestion (terminal only)")
  .action(async (run: string, hash: string, o: { cost?: string; minutes?: string; attempts?: string }) => {
    assertTty();
    const num = (v: string | undefined, name: string) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new DecisionError(`--${name} must be a positive number`);
      return n;
    };
    const l = openRun(run);
    const card = replay(l.events()).openCard as ({ kind: string; proposal?: Record<string, number> } | undefined);
    if (card?.kind !== "cap") throw new DecisionError("The open card isn't a limit card.");
    const data: Record<string, number> = { ...(card.proposal ?? {}) };
    const cost = num(o.cost, "cost"), minutes = num(o.minutes, "minutes"), attempts = num(o.attempts, "attempts");
    if (cost !== undefined) data.costUsd = cost;
    if (minutes !== undefined) data.wallMinutes = minutes;
    if (attempts !== undefined) data.extraAttempts = Math.round(attempts);
    const r = await decide(l, { decision: "waive-cap", hashPrefix: hash, data });
    if (r.kind === "repeat") return log("Already recorded.");
    log(`New limits: ${Object.entries(data).map(([k, v]) => `${k} ${v}`).join(", ")}. Continuing…`);
    await runAndReport(l.runId);
  });

for (const c of ["pause", "stop"] as const) {
  program.command(c).argument("<run>").description(`${c} a run at the next step boundary`).action(async (run: string) => {
    const l = openRun(run);
    await l.append({ type: c === "pause" ? "run.pause-requested" : "run.stop-requested" }, HUMAN_WRITER);
    log(`${c} requested; it takes effect at the next step boundary.`);
  });
}

program.command("steer").argument("<run>").argument("<file>", "a text file describing the change").description("record a requirement change (applied at the next step boundary)")
  .action(async (run: string, file: string) => {
    assertTty();
    const l = openRun(run);
    const sha = l.putArtifact(readFileSync(file, "utf8"));
    await l.append({ type: "change.received", data: { sha, by: userInfo().username } }, HUMAN_WRITER);
    log("Change recorded. Note: applying changes mid-run (re-spec, re-plan) isn't built yet; the run will park when it sees it.");
  });

program.command("baseline").requiredOption("--project <name>")
  .description("build and test the untouched repo in the test lab (no model calls)")
  .action(async (o: { project: string }) => {
    const project = loadProject(o.project);
    const { resolveRef } = await import("../ledger/git.js");
    const { labFor } = await import("../verify/lab.js");
    const { DockerCli } = await import("../verify/runtime.js");
    const { ensureEgress, feedHostsFrom } = await import("../runners/netinfra.js");
    const { DEFAULT_POLICY } = await import("../gates/policy.js");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const commit = await resolveRef(project.repo, project.baseBranch);
    const rt = new DockerCli();
    log(`baseline for ${project.project} @ ${commit.slice(0, 8)}: starting proxies`);
    await ensureEgress(rt, feedHostsFrom(DEFAULT_POLICY.registryAllowlist));
    const pk = join(factoryHome(), "tmp", `baseline-${project.project}`, project.stack === "node" ? "npm-cache" : "nuget");
    mkdirSync(pk, { recursive: true });
    const started = Date.now();
    const out = await labFor(project).produce({
      runId: `baseline-${project.project}`, key: "baseline", repo: project.repo, commit, stage: "baseline",
      exp: { expectPass: [], expectFail: [], compareToBaseline: [] }, project, rt, packagesDir: pk,
      onContainer: async (id, role) => log(`  container ${role} ${id.slice(0, 12)}`),
      onPhase: (_p, msg) => log(`  ${msg}`),
    });
    const secs = Math.round((Date.now() - started) / 1000);
    if (!out.build.ok) {
      log(`build FAILED after ${secs}s`);
      for (const e of out.build.errors.slice(0, 15)) log(`  ${e.file}:${e.line} ${e.code} ${e.msg}`);
      log(`--- restore log tail ---\n${out.logs.restore.split("\n").slice(-25).join("\n")}`);
      log(`--- build log tail ---\n${out.logs.build.split("\n").slice(-25).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    const r = out.testRun.results;
    const failed = r.filter((x) => x.outcome === "failed");
    log(`done in ${secs}s: ${r.length} tests, ${r.filter((x) => x.outcome === "passed").length} passed, ${failed.length} failed, ${r.filter((x) => x.outcome === "skipped").length} skipped; exit ${out.testRun.exitCode}; valid=${out.testRun.valid}`);
    for (const f of failed.slice(0, 10)) log(`  FAIL ${f.id} [${f.failureKind}] ${(f.message ?? "").split("\n")[0]!.slice(0, 160)}`);
    if (!r.length) log(`--- test log tail ---\n${out.logs.test.split("\n").slice(-30).join("\n")}`);
    const dir = join(factoryHome(), "repos", project.project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `baseline-${commit}.json`), JSON.stringify(out.testRun));
    log(`saved; discover will reuse it for this commit`);
  });

program.command("logs").argument("<run>")
  .option("-f, --follow", "keep printing new lines while the run works (Ctrl+C to stop)")
  .option("--step <key>", "only lines of one step, e.g. plan or implement/TASK-1")
  .option("--full", "also print what the AI answered and each tool call's result, for every model turn")
  .description("the run's trace: every step, model turn, tool call, container phase and gate, with times")
  .action(async (run: string, o: { follow?: boolean; step?: string; full?: boolean }) => {
    const { readTrace, formatLine } = await import("../util/trace.js");
    const l = openRun(run);
    const show = (e: import("../util/trace.js").TraceEvent) => {
      if (o.step && !(e.step === o.step || e.step?.startsWith(`${o.step}/`))) return;
      log(formatLine(e));
      const sha = (e.data as { turnSha?: string; logSha?: string } | undefined);
      const blob = sha?.turnSha ?? sha?.logSha;
      if (o.full && blob && l.hasArtifact(blob)) log(l.getArtifact(blob).toString("utf8").split("\n").map((x) => `      | ${x}`).join("\n"));
    };
    let seen = 0;
    const flush = () => { const all = readTrace(l.dir); for (const e of all.slice(seen)) show(e); seen = all.length; };
    flush();
    if (!seen) log("No trace yet for this run (runs started before tracing existed have none).");
    if (o.follow) {
      await new Promise<void>((resolve) => {
        const t = setInterval(() => {
          flush();
          const st = replay(l.events()).status;
          if (typeof st === "object" || st === "delivered" || st === "parked" || st === "waiting" || st === "paused") { clearInterval(t); flush(); resolve(); }
        }, 1000);
      });
    }
  });

program.command("report").argument("[run]")
  .option("--all", "compare steps across all runs, with outcome numbers on top")
  .option("--json", "with --all: print {outcomes, stages} as JSON")
  .description("step scorecard: first-time pass, retries and why, cost, time, tokens, gates, what you changed")
  .action(async (run: string | undefined, o: { all?: boolean; json?: boolean }) => {
    const { formatAll, formatOutcomes, formatRun, outcomes, scoreRun, stageStats } = await import("../report.js");
    if (o.all || !run) {
      const runs = Ledger.listRuns().map((id) => { try { return scoreRun(Ledger.open(id)); } catch { return undefined; } }).filter((r): r is NonNullable<typeof r> => !!r);
      if (o.json) return log(JSON.stringify({ outcomes: outcomes(runs), stages: stageStats(runs) }, null, 2));
      return log(runs.length ? `${formatOutcomes(outcomes(runs))}\n\n${formatAll(runs)}` : "No runs yet.");
    }
    log(formatRun(scoreRun(openRun(run))));
  });

program.command("calibrate")
  .option("--actual-hours <file>", "a file of `estimate-run,actual-hours` lines for finished projects")
  .option("--json", "print JSON")
  .option("--decisions", "print each logged size pick paired with what its build took, one JSON line each (for comparing a backend such as Jev)")
  .option("--tune", "measure the current task catalogue version and show what self-tuning would change, kept as the proposal (nothing is sized from it)")
  .option("--apply <hash>", "promote the waiting proposal with this hash (printed by --tune): it becomes the catalogue version new estimates are sized from (a person's decision)")
  .option("--history", "list the task catalogue versions and why each one changed")
  .option("--auto", "the background tuner after a run (writes a proposal only, one log line)")
  .description("compare approved estimates with what the factory spent (and, with a file, with real hours)")
  .action(async (o: { actualHours?: string; json?: boolean; decisions?: boolean; tune?: boolean; apply?: string; history?: boolean; auto?: boolean }) => {
    if (o.tune || o.auto || o.apply) {
      const { formatTunePlan, tuneNow } = await import("../estimate/tune.js");
      const plan = tuneNow(o.apply ? { mode: "apply", hash: o.apply } : { mode: "propose" });
      if (o.auto) { log(`${new Date().toISOString()} ${plan ? `${plan.from}: ${plan.to ? `proposed ${plan.to} [${plan.proposalHash}] (${plan.changes.map((x) => `${x.path} ${x.from}->${x.to}`).join(", ")}); review it with factory calibrate --tune` : "no change"}${plan.flagged.length ? `; check the wording: ${plan.flagged.join(", ")}` : ""}` : "another tuner is running"}`); return; }
      if (!plan) { log("Another tuner is running; try again in a moment."); return; }
      if (o.json) { log(JSON.stringify(plan, null, 2)); return; }
      if (plan.refused) { log(`Nothing promoted: ${plan.refused}.`); return; }
      log(formatTunePlan(plan));
      if (plan.to) log(o.apply ? `Promoted the proposal as shown. New estimates are sized from ${plan.to}.` : `Wrote this as a proposal (${plan.proposalHash}); nothing is sized from it yet. Promote exactly this one with: factory calibrate --apply ${plan.proposalHash}`);
      return;
    }
    if (o.history) {
      const { loadCatalogue } = await import("../estimate/catalogue.js");
      const { storedVersions } = await import("../estimate/catalogue-store.js");
      const root = loadCatalogue();
      const all = [root, ...storedVersions(root.version)];
      if (o.json) { log(JSON.stringify(all.map((c) => ({ version: c.version, hoursScale: c.hoursScale ?? 1, tuned: c.tuned })), null, 2)); return; }
      log(`${root.version}  the repo file (reference hours)`);
      for (const c of all.slice(1)) {
        const t = c.tuned!;
        log(`${c.version}  ${t.at.slice(0, 10)}, from ${t.builds} build(s) and ${t.projects} project(s): ${t.changes.map((x) => `${x.path} ${x.from}->${x.to}${x.limited ? ` (${x.limited})` : ""}`).join(", ")}${t.flagged.length ? `; check the wording: ${t.flagged.join(", ")}` : ""}`);
      }
      log(`New estimates are sized from ${all.at(-1)!.version}.`);
      const { readProposal } = await import("../estimate/catalogue-store.js");
      const waiting = readProposal(root.version);
      if (waiting?.tuned && waiting.tuned.parent === all.at(-1)!.version) log(`Proposed, not promoted: ${waiting.version} (${waiting.tuned.changes.map((x) => `${x.path} ${x.from}->${x.to}`).join(", ")}). Review it with factory calibrate --tune, which prints the hash --apply needs.`);
      return;
    }
    if (o.decisions) {
      const { decisionPairs, formatPairs } = await import("../estimate/decisions.js");
      const pairs = decisionPairs();
      log(pairs.length ? pairs.map((p) => JSON.stringify(p)).join("\n") : formatPairs(pairs));
      return;
    }
    const { costRows, formatCalibration, hoursRows } = await import("../estimate/calibrate.js");
    const cost = costRows();
    const hours = o.actualHours ? hoursRows(o.actualHours) : [];
    log(o.json ? JSON.stringify({ cost, hours }, null, 2) : formatCalibration(cost, hours));
  });

program.command("verify-evidence").argument("<run>").description("re-check every recorded gate decision").action((run: string) => {
  const checks = verifyEvidence(openRun(run));
  for (const c of checks) log(`${c.ok ? "ok  " : "FAIL"} #${c.seq} ${c.gateId}${c.reason ? `: ${c.reason}` : ""}`);
  log(checks.every((c) => c.ok) ? `All ${checks.length} decisions re-check.` : "Some decisions don't re-check.");
  if (!checks.every((c) => c.ok)) process.exitCode = 1;
});

program.command("init").argument("<repo>", "a local repo path (Windows paths like /mnt/c/... are fine) or a git URL")
  .option("--branch <name>", "base branch (default: the repo's current branch)")
  .option("--name <name>", "project name (default: from the folder name)")
  .option("--force", "overwrite an existing project config")
  .description("set up a project: copy the repo into Linux if needed, detect its settings, write the config")
  .action(async (repoArg: string, o: { branch?: string; name?: string; force?: boolean }) => {
    const { execFileSync } = await import("node:child_process");
    const { appendFileSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { detectDotnet, envVarFor, projectYaml, slugName } = await import("../config/detect.js");
    const { loadFactoryEnv, _resetEnvCache } = await import("../config/env.js");
    const isUrl = /^(https?:\/\/|git@|ssh:\/\/)/.test(repoArg);
    const src = isUrl ? repoArg : (await import("node:path")).resolve(repoArg);
    const name = o.name ?? slugName(isUrl ? repoArg.replace(/\.git$/, "").split(/[/:]/).pop()! : src);
    let repo = src;
    // repos must live inside Linux; copy anything on a Windows drive (or a URL) into ~/code/<name>
    if (isUrl || /^\/mnt\/[a-z]\//i.test(src)) {
      repo = join(homedir(), "code", name);
      if (existsSync(repo)) log(`Using the existing copy at ${repo}`);
      else {
        mkdirSync(join(homedir(), "code"), { recursive: true });
        const branchArgs = o.branch ? ["--branch", o.branch] : [];
        log(`Copying the repo to ${repo} (inside Linux, where the factory works)…`);
        execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "clone", ...(isUrl ? [] : ["--no-hardlinks"]), ...branchArgs, src, repo], { stdio: "inherit" });
      }
    }
    if (!existsSync(join(repo, ".git"))) throw new Error(`${repo} isn't a git repository`);
    const { assertNothingWaiting, commitAt, currentBranch, nodeProjectYaml, repoIsEmpty, seedEmptyRepo } = await import("../config/greenfield.js");
    const branch = o.branch ?? currentBranch(repo);
    const file = projectPath(name);
    // an empty repo is where a new product goes: a Node project, built from an approved design (greenfield)
    if (repoIsEmpty(repo, branch)) {
      if (existsSync(file) && !o.force) throw new Error(`${file} already exists (use --force to overwrite)`);
      if (!commitAt(repo, "HEAD")) assertNothingWaiting(repo);
      if (o.branch && !commitAt(repo, branch)) {
        // a branch that does not exist yet can only be named in a repo with no commits: it becomes the branch the base commit is on
        if (commitAt(repo, "HEAD")) throw new Error(`${repo} has no branch ${branch}`);
        execFileSync("git", ["-c", "safe.directory=*", "-C", repo, "symbolic-ref", "HEAD", `refs/heads/${branch}`], { stdio: "ignore" });
      }
      const base = seedEmptyRepo(repo);
      mkdirSync(join(factoryHome(), "projects"), { recursive: true, mode: 0o700 });
      writeFileSync(file, nodeProjectYaml(name, repo, branch));
      log(`\nProject ${name}\n  repo        ${repo} (branch ${branch}, base ${base.slice(0, 8)})\n  stack       node: the repo is empty, so it is a new product`);
      log(`\nWrote ${file}\nNext: factory start --project ${name} --from-design <design run>   (builds an approved design for a new product into this repo)`);
      return;
    }
    const d = detectDotnet(repo);
    d.name = name;
    if (!d.targetFrameworks.length) throw new Error("No .NET projects found. The POC supports .NET repos, and empty repos for a new product built from an approved design.");
    log(`\nProject ${name}`);
    log(`  repo        ${repo} (branch ${branch})`);
    log(`  solution    ${d.solution ?? "(none; dotnet will pick)"}`);
    log(`  .NET        ${d.targetFrameworks.join(", ")} → ${d.sdkImage}`);
    log(`  database    ${d.usesPostgres ? `Postgres${d.testDb ? `; tests log in as "${d.testDb.user}" to ${d.testDb.database} (${d.testDb.file})` : ""}` : "none detected"}`);
    if (d.frontendDirs.length) log(`  hidden      ${d.frontendDirs.join(", ")} (frontend folders the AI won't see)`);
    if (d.refusals.length) log(`\n  ⚠ Not supported yet: ${d.refusals.join("; ")}`);

    if (existsSync(file) && !o.force) throw new Error(`${file} already exists (use --force to overwrite)`);
    mkdirSync(join(factoryHome(), "projects"), { recursive: true, mode: 0o700 });
    writeFileSync(file, projectYaml(d, repo, branch));
    // the tests' own hardcoded DB password goes to ~/.factory/.env (never printed, never in the YAML)
    if (d.testDb) {
      const key = envVarFor(name, "TEST_DB_PASSWORD");
      if (!loadFactoryEnv()[key]) {
        const envFile = join(factoryHome(), ".env");
        appendFileSync(envFile, `${key}=${d.testDb.password}\n`, { mode: 0o600 });
        chmodSync(envFile, 0o600);
        _resetEnvCache();
        log(`  saved the tests' database password to ~/.factory/.env as ${key}`);
      }
    }
    log(`\nWrote ${file}\nNext: factory baseline --project ${name}   (builds and tests the untouched repo; no AI, no cost)`);
  });

program.command("mcp").description("run the MCP server (for Claude Code: start runs, read status and cards; no decisions)")
  .action(async () => {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer();
  });

program.command("ui").option("--port <n>", "port on 127.0.0.1", "4321")
  .description("local web screens: start runs and watch them (decisions stay in your terminal)")
  .action(async (o: { port: string }) => {
    const { createUiServer, listen } = await import("../ui/server.js");
    const ui = createUiServer();
    const port = await listen(ui, Number(o.port), o.port === "4321" ? 10 : 1);
    log(`Factory screens: http://127.0.0.1:${port}/?t=${ui.token}`);
    log("Only this computer can open it, and only with this link (a new key each time). Decisions are made in your terminal, so no AI or script can approve its own plan. Ctrl+C to stop.");
  });

program.command("smoke").option("--project <name>", "also check models this project overrides")
  .option("--all", "re-check everything, even checks that passed before")
  .description("cheap real check of every paid connection (a few cents): each model, the key proxy, the coding agent")
  .action(async (o: { project?: string; all?: boolean }) => {
    const { runSmoke } = await import("../smoke.js");
    const { defaultProvider } = await import("../runners/api.js");
    const { DockerCli } = await import("../verify/runtime.js");
    const checks = await runSmoke({ provider: defaultProvider, rt: new DockerCli(), project: o.project ? loadProject(o.project) : undefined, log, all: o.all });
    const total = checks.reduce((n, c) => n + c.costUsd, 0);
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    log(`\n${ok ? "All checks passed" : "Stopped at the first failure; fix it before a real run"}. Spent about $${total.toFixed(4)}.`);
    if (!ok) process.exitCode = 1;
  });

program.command("watch").requiredOption("--project <name>", "the project whose Jira tickets to watch")
  .option("--once", "check once and exit (for trying the set-up)")
  .description("start runs from Jira tickets labelled by allowed people, and post updates to Jira and Slack; decisions stay in your terminal")
  .action(async (o: { project: string; once?: boolean }) => {
    const { watcherFor } = await import("../watch/start.js");
    const w = watcherFor(o.project);
    const cfg = loadProject(o.project).jira!;
    log(`Watching ${cfg.project} for the "${cfg.label}" label every ${cfg.pollSeconds}s (limits: $${cfg.maxCostPerRun}/run, ${cfg.maxRunsPerDay} runs and $${cfg.dailyBudgetUsd}/day, $${cfg.monthlyBudgetUsd}/month). Ctrl+C to stop. This computer must stay awake.`);
    for (;;) {
      let wait = cfg.pollSeconds;
      try {
        const r = await w.tick();
        const bits = [r.started && `started ${r.started}`, r.skipped.length && `skipped ${r.skipped.join(", ")}`, r.resumed.length && `resumed ${r.resumed.join(", ")}`,
          r.sent && `${r.sent} update(s) sent`, r.failed && `${r.failed} update(s) failed`, r.blocked && `waiting: ${r.blocked}`].filter(Boolean);
        log(`${new Date().toTimeString().slice(0, 8)} ${bits.length ? bits.join(" · ") : "nothing new"}`);
        if (r.retryAfterSec) wait = Math.max(wait, r.retryAfterSec);
      } catch (e) {
        log(`${new Date().toTimeString().slice(0, 8)} check failed: ${(e as Error).message}`);
      }
      if (o.once) return;
      await new Promise((res) => setTimeout(res, wait * 1000));
    }
  });

program.command("selftest").option("--keep", "keep the sample repo and project afterwards")
  .description("one full run on a small sample repo for $0: real test lab, database, coding container, checks and delivery; only the AI answers are scripted")
  .action(async (o: { keep?: boolean }) => {
    const { runSelftest } = await import("../selftest/index.js");
    const r = await runSelftest({ keep: o.keep, log });
    if (!r.ok) process.exitCode = 1;
  });

registerConventions(program, log);
registerMergeGate(program, log);

program.command("doctor").description("check this machine and the setup").action(async () => {
  const ok = (b: boolean, m: string, fix?: string) => log(`${b ? "ok  " : "MISSING"} ${m}${!b && fix ? `\n      → ${fix}` : ""}`);
  ok(Number(process.versions.node.split(".")[0]) >= 22, `Node ${process.version}`, "install Node 22 with nvm");
  const wsl = process.platform === "linux" && /microsoft/i.test(existsSync("/proc/version") ? readFileSync("/proc/version", "utf8") : "");
  if (process.platform === "darwin") ok(true, "macOS");
  else ok(process.platform === "linux" && !process.cwd().startsWith("/mnt/"), wsl ? "running inside WSL (Ubuntu), not on a Windows drive" : "running on Linux", "on Windows, use the Ubuntu terminal (install.ps1 sets it up)");
  let rt = "";
  try { rt = findRuntimeBinary(); } catch (e) { rt = ""; ok(false, "container runtime", (e as Error).message); }
  if (rt) {
    ok(true, `container runtime: ${rt}`);
    const { apiProxyState } = await import("../runners/netinfra.js");
    const { DockerCli } = await import("../verify/runtime.js");
    const st = await apiProxyState(new DockerCli(rt));
    log(st === "current" ? "ok   key proxy is up to date with your keys"
      : `note key proxy ${st === "outdated" ? "has old settings (e.g. from before you added a key)" : "isn't running"}; it restarts automatically on the next run or smoke test`);
  }
  ok(existsSync(join(factoryHome(), ".env")), "~/.factory/.env exists", "create it yourself with your API keys (never paste keys into chat)");
  ok(hasSecret("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY set in ~/.factory/.env");
  log(`${hasSecret("OPENAI_API_KEY") ? "ok  " : "note"} OPENAI_API_KEY ${hasSecret("OPENAI_API_KEY") ? "set" : "not set: critic and review will use Claude (single family)"}`);
  const { jiraConfigured } = await import("../sources/jira.js");
  log(jiraConfigured() ? "ok   Jira set up (factory start --jira ABC-123)" : "note Jira not set up (optional): add JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN to ~/.factory/.env to use --jira");
  if (hasSecret("OPENAI_API_KEY")) {
    const { DEFAULT_ROUTES } = await import("../stages/routing.js");
    const gpt = [...new Set(Object.values(DEFAULT_ROUTES).map((r) => r.model).filter((m) => /^gpt|^o\d/.test(m)))];
    for (const name of existsSync(join(factoryHome(), "projects")) ? readdirSync(join(factoryHome(), "projects")).filter((f) => f.endsWith(".yaml") && f !== "standalone-estimates.yaml") : []) {
      const p = loadProject(name.replace(/\.yaml$/, ""));
      const missing = gpt.filter((m) => !p.prices[m]);
      if (missing.length) log(`note ${p.project}: no price set for ${missing.join(", ")}; cost is estimated high ($10/$50 per million). Add "prices:" to its config.`);
    }
  }
  const projects = existsSync(join(factoryHome(), "projects")) ? readdirSync(join(factoryHome(), "projects")).filter((f) => f.endsWith(".yaml") && f !== "standalone-estimates.yaml") : [];
  ok(projects.length > 0, `projects: ${projects.join(", ").replace(/\.yaml/g, "") || "none"}`, "add one with: factory init <path-to-repo-or-git-url>");
  // factory watch: only for projects that asked for it
  for (const f of projects) {
    let cfg;
    try { cfg = loadProject(f.replace(/\.yaml$/, "")); } catch { continue; }
    if (!cfg.jira) continue;
    ok(hasSecret("JIRA_BASE_URL") && hasSecret("JIRA_EMAIL") && hasSecret("JIRA_API_TOKEN"), `${cfg.project}: Jira login for factory watch (${cfg.jira.project}, label "${cfg.jira.label}")`, "add JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to ~/.factory/.env");
    if (cfg.notify.slackWebhookEnv) ok(hasSecret(cfg.notify.slackWebhookEnv), `${cfg.project}: Slack webhook (${cfg.notify.slackWebhookEnv})`, `add ${cfg.notify.slackWebhookEnv}=https://hooks.slack.com/services/... to ~/.factory/.env`);
    log(`note ${cfg.project}: factory watch limits: $${cfg.jira.maxCostPerRun} a run, ${cfg.jira.maxRunsPerDay} runs and $${cfg.jira.dailyBudgetUsd} a day, $${cfg.jira.monthlyBudgetUsd} a month`);
  }
});

// design runs (factory design start|show|list|open|check-refs) and the design toolkit (src/design): inventory|size|lint|brief|refs
registerDesignCommands(program, (design) => registerDesignRunCommands(design, { log, openRun, runAndReport }));

program.parseAsync().catch((e: Error) => {
  if (e instanceof DecisionError) process.stderr.write(`${e.message}\n`);
  else process.stderr.write(`error: ${e.message}\n`);
  process.exitCode = 1;
});
