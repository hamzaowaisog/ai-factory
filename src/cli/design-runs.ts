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
    .description("design only: clarify the requirements, write the spec and draw the design (mock, clickable demo, look) from the requirements and any references; a lead approves it in the terminal. Nothing is sized or built.")
    .action(async (prompt: string | undefined, o: { project?: string; file?: string; jira?: string; frames?: string; ref?: string[]; repo: boolean; client?: string; projectName?: string; maxCost?: string; fresh?: boolean }) => {
      if (o.fresh) process.env.FACTORY_NO_CACHE = "1";
      const projectName = o.project ?? (await import("../config/project.js")).ensureStandaloneProject();
      const project = loadProject(projectName);
      const problems = checkRoutes(project, DESIGN_ROUTES);
      if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
      // everything is read before a run exists: a bad file, ticket or reference costs nothing
      const req = await gatherRequest({ prompt, file: o.file, jira: o.jira, frames: o.frames }, {}, { maxBytes: MAX_ESTIMATE_REQUEST_BYTES });
      const references = await gatherReferences((o.ref ?? []).map(parseRefArg), { allowPrivate: !!project.design?.allowPrivateRefs });
      const settings = { ...(o.project && o.repo ? {} : { noRepo: true }), ...(o.client ? { client: o.client } : {}), ...(o.projectName ? { projectName: o.projectName } : {}) };
      const runId = await createRun(req.text, projectName, userInfo().username, {
        mode: "design", estimate: settings, sources: req.sources, attachments: req.attachments, references,
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
