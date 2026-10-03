// `factory design start|show|list|open|check-refs` (docs/estimates-design.md, "Design references", step 3b):
// a design on its own, from requirements and references, without an estimate or a build. The approved
// design is carried on with `factory estimate --from-design` or `factory start --from-design`.
import { jiraFetcherFor } from "../sources/jira.js";
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
import { figmaHowTo } from "../design/figma.js";
import { VIEWPORTS, type Viewport } from "../design/screenshots.js";
import { exportForRun, exportSeededNow } from "../stages/design-export.js";
import { replay } from "../ledger/state.js";
import { loadKit, sampleDesign, scaffold, scaffoldSummary, UI_TARGETS, uiTargetOption, writeScaffold, type KitTarget, type ScaffoldLayout } from "../design/kit/index.js";
import { recordScaffoldCopy, scaffoldPreview, scaffoldView, type ScaffoldView } from "../stages/scaffold-run.js";
import { checkRunningApp, fidelityOfRun, FIDELITY_DIR, formatFidelity, packageOfRun } from "../stages/design-fidelity.js";
import { acceptBaselines, baselinesDir, readBaselineIndex } from "../design/baselines.js";
import { assertTty } from "../ledger/human.js";

/** `--ui-target next-shadcn|vite-shadcn|repo`, checked before a run exists. */
export { uiTargetOption };
export const UI_TARGET_HELP = `the stack the approved design is built in when the project sets none: ${UI_TARGETS.join(", ")} (default: detected from the repo's package.json)`;

function printScaffold(v: ScaffoldView, log: (m: string) => void): void {
  log(`UI target ${v.target} (${v.source === "config" ? "the project's setting" : v.source === "run" ? "the run's --ui-target" : v.source === "detected" ? "detected" : v.source === "phone" ? "a phone app" : "the default"}; the repo: ${v.why})`);
  if (v.repoApps.length) log(`built with the repo's own components: ${v.repoApps.join(", ")}`);
  if (!v.kit) return log("no scaffold: the screens are built with the repo's own components, each from its approved brief");
  if (v.built) log(`the build wrote it${v.built.commit ? ` in ${v.built.commit.slice(0, 10)}` : ""} (${v.built.written} files); below is what it would write now`);
  log(v.summary ?? "");
  if (v.changed) log(`change request: pages written again for ${v.changed.join(", ") || "no screen"}`);
}

export { exportSeededNow };

export const DESIGN_EXPORT_HELP = "export the design as soon as it is approved: png, pdf, html, tokens, json or all, comma separated (files in <run>/exports/vN/; factory design export makes more later)";

/** `--design-export png,pdf`, checked before a run exists. */
export const designExportOption = (v: string | undefined): string[] | undefined => (v ? parseFormats(v) : undefined);

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
      const req = await gatherRequest({ prompt, file: o.file, jira: o.jira, frames: o.frames }, { fetchJira: jiraFetcherFor(project.jira?.allowedReporters) }, { maxBytes: MAX_ESTIMATE_REQUEST_BYTES });
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
    .option("--format <formats>", "png, pdf, html, tokens, json, figma or all, comma separated (figma: figma.json for the AI Factory Import plugin in figma-plugin/)", "all")
    .option("--out <dir>", "write here instead of <run>/exports/vN/<n>/")
    .option("--screens <ids>", "only these screens, e.g. S-1,S-3 (components for the Components page)")
    .option("--states <names>", "only these states as on the demo's tabs, e.g. default,empty,error")
    .option("--widths <widths>", "phone, tablet, desktop")
    .option("--mode <modes>", "light, dark")
    .option("--lang <codes>", "language codes, e.g. en,ar")
    .option("--version <vN>", "another version of the same design (v1, v2, ...); the run's own version by default")
    .option("--pdf-per-screen", "one PDF per screen instead of one design book")
    .option("--json", "print JSON")
    .description("export the approved design: pictures, a PDF design book, the clickable demo (zip), tokens (W3C, CSS, Tailwind), the design as JSON and figma.json for the AI Factory Import plugin (no Figma token or paid seat). Every file carries the design's version and sha. `factory design export list <run>` lists earlier exports.")
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
      for (const c of e.checks ?? []) log(`  check  ${c.status.padEnd(4)} ${c.check}: ${c.detail}${c.items?.length ? `\n${c.items.slice(0, 8).map((x) => `           - ${x}`).join("\n")}` : ""}`);
      if (e.files.some((f) => f.format === "figma")) for (const l of figmaHowTo(join(e.dir, "figma.json"))) log(`  figma  ${l}`);
    });

  design.command("scaffold").argument("[run]", "a run with an approved design (design, estimate or build)")
    .option("--sample", "scaffold the kit's sample design (every block, field kind and layer) instead of a run's")
    .option("--target <target>", `try this target: ${UI_TARGETS.join(", ")} (default: the run's)`)
    .option("--out <dir>", "write the files here (a folder you can open, install and run; nothing goes into the repo)")
    .option("--files", "list every file with its owner")
    .option("--json", "print JSON")
    .description("the approved design as code in the UI target's kit: the kit, the theme, a page per screen with its states and sample data, the frame and the routes. The build writes it into the repo before any agent starts; this shows it, or writes it to --out to run it (?fixture=S-1:empty opens any state).")
    .action(async (run: string | undefined, o: { sample?: boolean; target?: string; out?: string; files?: boolean; json?: boolean }) => {
      const target = uiTargetOption(o.target);
      let v: ScaffoldView, layout: ScaffoldLayout | undefined, ledger: Ledger | undefined;
      if (o.sample) {
        if (run) throw new Error("--sample scaffolds the kit's sample design; drop the run");
        const t = (target ?? "next-shadcn") as KitTarget;
        if (t === ("repo" as string)) throw new Error("--sample needs a kit target: next-shadcn or vite-shadcn");
        layout = scaffold({ design: sampleDesign(), kit: loadKit(), target: t, product: "Sample", tag: "ai-factory sample design", apps: ["portal"] });
        v = { target: t, source: "run", why: "the kit's sample design", apps: ["portal"], repoApps: ["mobile"], kit: layout.kit, root: layout.root, fresh: layout.fresh, designSystem: layout.designSystem, summary: scaffoldSummary(layout),
          files: layout.files.map((f) => ({ path: f.path, owner: f.owner, regenerate: f.regenerate })), kept: [], screens: layout.screens, removed: [], notes: layout.notes };
      } else {
        if (!run) throw new Error("Name the run: factory design scaffold <run> (or --sample)");
        const l = ledger = deps.openRun(run);
        const state = replay(l.events());
        const s = scaffoldPreview(state, l, loadProject(state.info.project), { ...(target ? { target } : {}) });
        layout = s.layout;
        v = scaffoldView(s, s.built);
      }
      const written = o.out && layout ? writeScaffold(layout, resolve(o.out)) : undefined;
      // a run's scaffold copied out of the factory is recorded in its ledger (the kit's sample design is no one's)
      if (written && ledger) await recordScaffoldCopy(ledger, { kind: "out", target: v.target, to: resolve(o.out!), files: written.length, by: userInfo().username });
      if (o.json) return log(JSON.stringify({ ...v, ...(written ? { out: resolve(o.out!), written: written.length } : {}) }, null, 2));
      printScaffold(v, log);
      if (o.files) for (const f of v.files) log(`  ${f.owner.padEnd(6)} ${f.regenerate ? "factory" : "repo's "} ${f.path}`);
      if (o.out && !layout) log("nothing written: the target uses the repo's own components");
      if (written) log(`wrote ${written.length} files to ${resolve(o.out!)}${v.fresh ? ": npm install && npm run dev, then open a page with ?fixture=S-1:default" : ""}`);
    });

  design.command("fidelity").argument("<run>", "a build run whose screens are built with the kit")
    .option("--url <base>", "check this running app now (e.g. http://localhost:3000, in fixture mode) instead of showing the build's last check")
    .option("--json", "print JSON")
    .description("the built app against the approved design: tokens, structure and accessibility (blocking gates, waivable), layout and pixels (advice). The build runs it after accept when the project sets design.fidelity; --url checks an app you started yourself")
    .action(async (run: string, o: { url?: string; json?: boolean }) => {
      const l = deps.openRun(run);
      const state = replay(l.events());
      const r = o.url ? await checkRunningApp(state, l, loadProject(state.info.project), o.url, log) : fidelityOfRun(state, l);
      if (!r) return log(`Run ${l.runId} has no fidelity check yet: the build runs it after accept (design.fidelity in the project), or check a running app with --url`);
      if (o.json) return log(JSON.stringify(r, null, 2));
      for (const line of formatFidelity(r)) log(line);
      if (r.pages.some((p) => p.built)) log(`pictures: ${join(l.dir, FIDELITY_DIR)}; accept them as the baseline with factory design baseline ${l.runId} --all --reason "..."`);
    });

  design.command("baseline").argument("<run>", "a run with a fidelity check").argument("[pages...]", "page keys from the check (s-1-default-desktop); or --all")
    .option("--all", "every page the check pictured")
    .option("--reason <text>", "why the built pages are right (recorded with your name)")
    .option("--list", "show the accepted pictures of the run's design line")
    .description("accept the built pictures as the baseline the next fidelity checks compare with (stored beside the design's versions, recorded in the run's ledger)")
    .action(async (run: string, pages: string[], o: { all?: boolean; reason?: string; list?: boolean }) => {
      const l = deps.openRun(run);
      const state = replay(l.events());
      const pkg = packageOfRun(state, l);
      if (!pkg) throw new Error(`Run ${l.runId} has no design package in the store to keep baselines with`);
      if (o.list) {
        const idx = readBaselineIndex(pkg);
        const rows = Object.entries(idx.pages);
        if (!rows.length) return log(`design ${pkg.manifest.line}: no accepted pictures yet`);
        for (const [k, e] of rows) log(`${k.padEnd(44)} v${e.designVersion} ${e.run} by ${e.by} ${e.at.slice(0, 10)}: ${e.reason}`);
        return;
      }
      const report = fidelityOfRun(state, l);
      if (!report) throw new Error(`Run ${l.runId} has no fidelity check to accept pictures from`);
      if (!o.all && !pages.length) throw new Error("Name the pages to accept, or --all");
      if (!o.reason?.trim()) throw new Error("Give a reason: --reason \"why the built pages are right\"");
      assertTty();
      const done = await acceptBaselines({ ledger: l, pkg, report, keys: o.all ? "all" : pages, by: userInfo().username, reason: o.reason });
      log(`accepted ${done.length} picture(s) as the baseline of design ${pkg.manifest.line} (${baselinesDir(pkg)}); the next check compares with them`);
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
