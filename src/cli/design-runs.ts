// `factory design start|show|list|open|check-refs` (docs/estimates-design.md, "Design references", step 3b):
// a design on its own, from requirements and references, without an estimate or a build. The approved
// design is carried on with `factory estimate --from-design` or `factory start --from-design`.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { loadProject } from "../config/project.js";
import { designRunView, formatDesignRun, listDesignRuns } from "../design/runs.js";
import type { Ledger } from "../ledger/ledger.js";
import { createRun } from "../stages/executor.js";
import { checkRoutes, DESIGN_ROUTES } from "../stages/routing.js";
import { describeReferences, gatherReferences, parseRefArg } from "../sources/refs.js";
import { describeSources, gatherRequest, MAX_ESTIMATE_REQUEST_BYTES } from "../sources/request.js";
import { EXPORT_MODES, listExports, parseFormats, parseList, type ExportOptions } from "../design/export.js";
import { VIEWPORTS, type Viewport } from "../estimate/screenshots.js";
import { exportForRun } from "../stages/design-export.js";

export const DESIGN_EXPORT_HELP = "export the design as soon as it is approved: png, pdf, html, tokens, json or all, comma separated (files in <run>/exports/vN/; factory design export makes more later)";

/** `--design-export png,pdf`, checked before a run exists. */
export const designExportOption = (v: string | undefined): string[] | undefined => (v ? parseFormats(v) : undefined);

/**
 * A run seeded from a design approved elsewhere (`--from-design`, `--from-estimate`, `--from-run`) never runs the
 * design steps, so `--design-export` exports right away: the design is approved already.
 */
export async function exportSeededNow(runId: string, formats: string[] | undefined, log: (m: string) => void): Promise<void> {
  if (!formats?.length) return;
  try {
    const e = await exportForRun(runId, { formats: parseFormats(formats.join(",")) }, log);
    log(`design exported (${e.files.length} files, design ${e.line} v${e.version}) to ${e.dir}`);
  } catch (err) {
    log(`design export skipped: ${(err as Error).message}`);
  }
}

export interface DesignRunDeps {
  log: (m: string) => void;
  openRun: (run: string) => Ledger;
  runAndReport: (runId: string) => Promise<void>;
}

const REF_HELP = 'a design reference: an image, an https link, a Figma link, a PDF, a .docx or a Figma JSON export; optional role match:, inspire: or layout: in front and a note after |, e.g. --ref "layout:dash.jpg|table like this"; repeat it';
const collect = (v: string, prev: string[] = []) => [...prev, v];

/** Open a file in the computer's own browser; false when there is no way to. */
function openInBrowser(file: string): Promise<boolean> {
  const [cmd, args] = process.platform === "darwin" ? ["open", [file]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : ["xdg-open", [file]];
  return new Promise((done) => {
    try {
      const p = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
      p.on("error", () => done(false));
      p.on("spawn", () => { p.unref(); done(true); });
    } catch { done(false); }
  });
}

export function registerDesignRunCommands(design: Command, deps: DesignRunDeps): void {
  const { log } = deps;

  design.command("start")
    .argument("[prompt]", "the requirements, in plain words")
    .option("--project <name>", "project config in ~/.factory/projects/<name>.yaml: the design follows that app's look and components; leave it out for a new product (no repo)")
    .option("--file <path>", "the requirements as a Markdown, text or Word (.docx) file")
    .option("--jira <key>", "the requirements as a Jira ticket (ABC-123 or its link)")
    .option("--frames <dir>", "a folder of design frames exported from Figma (png, jpg, webp, svg or json)")
    .option("--ref <ref>", REF_HELP, collect)
    .option("--no-repo", "the requirements stand alone: do not read the project's code")
    .option("--client <name>", "client name (shown on the demo)")
    .option("--project-name <name>", "product name (the demo's title)")
    .option("--max-cost <dollars>", "a lower spend limit for this run (it can only lower the normal limit)")
    .option("--fresh", "ask the model again even if the same requirements were designed before (skips the stored answers)")
    .option("--design-export <formats>", DESIGN_EXPORT_HELP)
    .description("design only: clarify the requirements, write the spec and draw the design (mock, clickable demo, look) from the requirements and any references; a lead approves it in the terminal. Nothing is sized or built.")
    .action(async (prompt: string | undefined, o: { project?: string; file?: string; jira?: string; frames?: string; ref?: string[]; repo: boolean; client?: string; projectName?: string; maxCost?: string; fresh?: boolean; designExport?: string }) => {
      if (o.fresh) process.env.FACTORY_NO_CACHE = "1";
      const designExport = designExportOption(o.designExport);
      const projectName = o.project ?? (await import("../config/project.js")).ensureStandaloneProject();
      const project = loadProject(projectName);
      const problems = checkRoutes(project, DESIGN_ROUTES);
      if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
      // everything is read before a run exists: a bad file, ticket or reference costs nothing
      const req = await gatherRequest({ prompt, file: o.file, jira: o.jira, frames: o.frames }, {}, { maxBytes: MAX_ESTIMATE_REQUEST_BYTES });
      const references = await gatherReferences((o.ref ?? []).map(parseRefArg), { allowPrivate: !!project.design?.allowPrivateRefs });
      const settings = { ...(o.project && o.repo ? {} : { noRepo: true }), ...(o.client ? { client: o.client } : {}), ...(o.projectName ? { projectName: o.projectName } : {}) };
      const runId = await createRun(req.text, projectName, userInfo().username, {
        mode: "design", estimate: settings, sources: req.sources, attachments: req.attachments, references, ...(designExport ? { designExport } : {}),
        ...(o.maxCost !== undefined ? { maxCostUsd: Number(o.maxCost) } : {}),
      });
      log(`design run ${runId} (requirements from ${describeSources(req.sources)}${references.length ? `; design references ${describeReferences(references)}` : "; no references: the look comes from the requirements and the industry library"})`);
      await deps.runAndReport(runId);
    });

  design.command("show").argument("<run>", "a design run (or an estimate run, which draws a design too)")
    .option("--json", "print JSON")
    .description("the run's design: stage, look, references, screens, and where the demo, screenshots and tokens are")
    .action((run: string, o: { json?: boolean }) => {
      const v = designRunView(deps.openRun(run));
      log(o.json ? JSON.stringify(v, null, 2) : formatDesignRun(v).join("\n"));
    });

  design.command("list")
    .option("--all", "also estimate runs (they draw a design too)")
    .option("--json", "print JSON")
    .description("design runs: stage (drafting, waiting for approval, approved), screens and cost")
    .action((o: { all?: boolean; json?: boolean }) => {
      const runs = listDesignRuns(!!o.all);
      if (o.json) return log(JSON.stringify(runs, null, 2));
      if (!runs.length) return log("No design runs yet. Start one: factory design start \"<requirements>\" --ref <image or link>");
      for (const v of runs.slice(-20)) log(`${v.runId}  ${v.stage.padEnd(20)} ${String(v.screens.length).padStart(2)} screen(s)  ${v.references.length ? `${v.references.length} ref(s)  ` : ""}$${v.costUsd.toFixed(2)}  ${v.request.slice(0, 60)}`);
    });

  design.command("open").argument("<run>")
    .description("open the run's clickable demo in your browser")
    .action(async (run: string) => {
      const v = designRunView(deps.openRun(run));
      if (!v.files.demo) return log(`${v.runId} has no demo yet (${v.stage}). It is drawn before the approval card.`);
      log(v.files.demo);
      if (!(await openInBrowser(v.files.demo))) log("Could not open a browser here; open the file above yourself.");
    });

  design.command("export").argument("<run>", "a run with an approved design (design, estimate or build), or the word list")
    .argument("[listRun]", "with list: the run whose exports to list")
    .option("--format <formats>", "png, pdf, html, tokens, json or all, comma separated (figma comes with the Figma plugin)", "all")
    .option("--out <dir>", "write here instead of <run>/exports/vN/<n>/")
    .option("--screens <ids>", "only these screens, e.g. S-1,S-3 (components for the Components page)")
    .option("--states <names>", "only these states as on the demo's tabs, e.g. default,empty,error")
    .option("--widths <widths>", "phone, tablet, desktop")
    .option("--mode <modes>", "light, dark")
    .option("--lang <codes>", "language codes, e.g. en,ar")
    .option("--version <vN>", "another version of the same design (v1, v2, ...); the run's own version by default")
    .option("--pdf-per-screen", "one PDF per screen instead of one design book")
    .option("--json", "print JSON")
    .description("export the approved design: pictures, a PDF design book, the clickable demo (zip), tokens (W3C, CSS, Tailwind) and the design as JSON. Every file carries the design's version and sha. `factory design export list <run>` lists earlier exports.")
    .action(async (run: string, listRun: string | undefined, o: { format: string; out?: string; screens?: string; states?: string; widths?: string; mode?: string; lang?: string; version?: string; pdfPerScreen?: boolean; json?: boolean }) => {
      if (run === "list") {
        if (!listRun) throw new Error("Name the run: factory design export list <run>");
        const l = deps.openRun(listRun);
        const rows = listExports(l.dir);
        if (o.json) return log(JSON.stringify(rows, null, 2));
        if (!rows.length) return log(`${l.runId} has no exports yet. Make one: factory design export ${l.runId} --format png,pdf`);
        for (const e of rows) {
          log(`${e.id.padEnd(8)} ${e.at.slice(0, 16).replace("T", " ")}  design ${e.line} v${e.version} (${e.designSha.slice(0, 8)})  ${[...new Set(e.files.map((f) => f.format))].join(", ") || "nothing"}  ${e.files.length} file(s)  ${e.dir}`);
          for (const n of e.notes) log(`         note: ${n}`);
        }
        return;
      }
      if (listRun) throw new Error(`Unexpected argument ${listRun}. To list exports: factory design export list ${run}`);
      const version = o.version === undefined ? undefined : Number(o.version.replace(/^v/i, ""));
      if (version !== undefined && !(Number.isInteger(version) && version > 0)) throw new Error(`--version takes v1, v2, ...; not ${o.version}`);
      const opts: ExportOptions & { version?: number; out?: string } = {
        formats: parseFormats(o.format),
        ...(o.out ? { out: resolve(o.out) } : {}),
        ...(version ? { version } : {}),
        ...(o.pdfPerScreen ? { pdfPerScreen: true } : {}),
      };
      const screens = parseList("screens", o.screens), states = parseList("states", o.states), langs = parseList("languages", o.lang);
      const widths = parseList<Viewport>("widths", o.widths, Object.keys(VIEWPORTS) as Viewport[]), modes = parseList("modes", o.mode, EXPORT_MODES);
      Object.assign(opts, screens ? { screens } : {}, states ? { states } : {}, widths ? { widths } : {}, modes ? { modes } : {}, langs ? { langs } : {});
      const e = await exportForRun(deps.openRun(run).runId, opts, log);
      if (o.json) return log(JSON.stringify(e, null, 2));
      log(`design ${e.line} v${e.version} (${e.designSha.slice(0, 8)}) exported to ${e.dir}`);
      for (const [f, n] of Object.entries(e.files.reduce<Record<string, number>>((a, x) => ({ ...a, [x.format]: (a[x.format] ?? 0) + 1 }), {}))) log(`  ${f.padEnd(7)} ${n} file(s)`);
      for (const n of e.notes) log(`  note: ${n}`);
    });

  design.command("check-refs").argument("<refs...>", "references as for --ref: [match:|inspire:|layout:]<file or link>[|note]")
    .option("--project <name>", "use this project's settings (design.allowPrivateRefs)")
    .option("--out <dir>", "also save the pictures read from each reference")
    .option("--json", "print JSON")
    .description("read design references without starting a run (no model, no cost): what each gives (pictures, colours, fonts, corners) or why it cannot be read")
    .action(async (args: string[], o: { project?: string; out?: string; json?: boolean }) => {
      const allowPrivate = o.project ? !!loadProject(o.project).design?.allowPrivateRefs : false;
      const refs = await gatherReferences(args.map(parseRefArg), { allowPrivate });
      if (o.out) {
        const dir = resolve(o.out);
        mkdirSync(dir, { recursive: true });
        for (const r of refs) r.images.forEach((im, k) => writeFileSync(join(dir, `${r.id}-${k + 1}.png`), im.bytes));
      }
      const plain = refs.map((r) => ({ ...r, images: r.images.map((im) => ({ width: im.width, height: im.height, label: im.label, bytes: im.bytes.length })) }));
      if (o.json) return log(JSON.stringify(plain, null, 2));
      for (const r of plain) {
        log(`${r.id} ${r.kind} ${r.source}  role ${r.role}${r.roleGiven ? "" : " (default)"}  ${r.measured}`);
        if (r.note) log(`  note: ${r.note}`);
        log(`  pictures: ${r.images.length ? r.images.map((im) => `${im.label} ${im.width}x${im.height}`).join(", ") : "none"}`);
        if (r.colours.length) log(`  colours: ${r.colours.map((c) => `${c.hex}${c.role ? ` ${c.role}` : ""}${c.share !== undefined ? ` ${Math.round(c.share * 100)}%` : ""}`).join(", ")}`);
        if (r.fonts.length) log(`  fonts: ${r.fonts.map((f) => `${f.family} (${f.use})`).join(", ")}`);
        if (r.radiusPx !== undefined) log(`  corners: ${r.radiusPx} px`);
        if (r.text) log(`  text: ${r.text.length} characters`);
        for (const n of r.notes) log(`  note: ${n}`);
      }
      if (o.out) log(`pictures saved in ${o.out}`);
    });
}
