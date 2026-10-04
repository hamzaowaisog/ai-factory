// The UI's design exports (docs/estimates-design.md, "Exports"): what a run's approved design can be exported
// as, the export jobs this server runs, and the exported files, downloaded with the session key. An export only
// writes under the run's own `exports/` folder; it never changes the design, the package or the ledger.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { EXPORT_FORMATS, EXPORT_MODES, exportsRoot, listExports, parseFormats, parseList, zipExport, type ExportOptions } from "../design/export.js";
import { listPackages, packageForRun } from "../design/package.js";
import { demoStates } from "../design/demo.js";
import { VIEWPORTS, type Viewport } from "../design/screenshots.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { approvedDesignFor } from "../stages/design-inputs.js";
import { exportForRun } from "../stages/design-export.js";
import { safeRelative } from "./preview.js";

export interface ExportJob { id: string; runId: string; status: "running" | "done" | "failed"; startedAt: string; formats: string[]; version?: number; exportId?: string; error?: string; lines: string[] }

type DesignLike = { screens: { id: string; route: string; reqs: string[]; states?: string[]; mock?: { title?: string } }[]; theme?: { mode?: string }; locale?: { languages: string[] } };

/** What the run's approved design can be exported as, and its earlier exports (newest first). */
export function designExportsView(ledger: Ledger, jobs: ExportJob[] = []) {
  const s = replay(ledger.events());
  const approved = approvedDesignFor<DesignLike>(s, ledger);
  const exports = listExports(ledger.dir).map((e) => ({ id: e.id, at: e.at, line: e.line, version: e.version, designSha: e.designSha, formats: [...new Set(e.files.map((f) => f.format))], files: e.files.map((f) => ({ path: f.path, format: f.format, bytes: f.bytes })), notes: e.notes, checks: e.checks ?? [], options: e.options }));
  const mine = jobs.filter((j) => j.runId === ledger.runId);
  if (!approved) {
    const why = s.openCard?.kind === "design-approval" ? "The design is waiting for approval. Approve it, then export it here."
      : s.info.mode === "brownfield" && !s.steps.has("design") ? "This build has no design of its own: it touches no UI, or it follows a design approved in another run (export from that run)."
      : "There is no approved design yet.";
    return { runId: ledger.runId, available: false as const, why, exports, jobs: mine };
  }
  const pkg = packageForRun(s.info, approved.sha);
  const d = approved.design;
  const screens = d.screens.map((sc) => ({ id: sc.id, title: sc.mock?.title ?? sc.id, states: demoStates(sc as never) }));
  const modes = d.theme?.mode === "auto" ? [...EXPORT_MODES] : [d.theme?.mode === "dark" ? "dark" : "light"];
  return {
    runId: ledger.runId, available: true as const,
    design: pkg ? { line: pkg.manifest.line, version: pkg.manifest.version, designSha: pkg.manifest.designSha, approvedBy: pkg.manifest.approved.by, approvedAt: pkg.manifest.approved.at, pictures: pkg.manifest.shots.length, picturesNote: pkg.manifest.shotsNote }
      : { designSha: approved.sha, pending: "The design package is written with the first export." },
    versions: pkg ? listPackages(pkg.manifest.run.project).filter((p) => p.manifest.line === pkg.manifest.line).map((p) => p.manifest.version) : [],
    formats: [...EXPORT_FORMATS],
    figma: { plugin: "/figma-plugin.zip", note: "Figma: export figma.json, then in the Figma desktop app (any plan, the free one too) import the AI Factory Import plugin once (Plugins > Development > Import plugin from manifest..., its manifest.json), run it in the file and pick figma.json. No Figma token or paid seat is needed." },
    options: { screens: [...screens, ...(screens.length ? [{ id: "components", title: "Components", states: ["All states"] }] : [])], widths: Object.keys(VIEWPORTS), modes, langs: d.locale?.languages ?? ["en"] },
    exports, jobs: mine,
  };
}

/** The options of an export started from the UI, checked the way the command line checks them. */
export function exportRequest(body: Record<string, unknown>): ExportOptions & { version?: number } {
  const list = (k: string) => (Array.isArray(body[k]) ? (body[k] as unknown[]).map(String) : typeof body[k] === "string" ? String(body[k]) : undefined);
  const formats = parseFormats(Array.isArray(body.formats) ? (body.formats as unknown[]).map(String).join(",") : String(body.formats ?? ""));
  const version = body.version === undefined || body.version === null || body.version === "" ? undefined : Number(body.version);
  if (version !== undefined && !(Number.isInteger(version) && version > 0)) throw new Error("version is a whole number (1, 2, ...)");
  const screens = parseList("screens", list("screens")), states = parseList("states", list("states")), langs = parseList("languages", list("langs"));
  const widths = parseList<Viewport>("widths", list("widths"), Object.keys(VIEWPORTS) as Viewport[]), modes = parseList("modes", list("modes"), EXPORT_MODES);
  for (const x of [...(screens ?? []), ...(states ?? []), ...(langs ?? [])]) if (x.length > 60) throw new Error("A filter value is too long.");
  return { formats, ...(version ? { version } : {}), ...(body.pdfPerScreen === true ? { pdfPerScreen: true } : {}), ...(screens ? { screens } : {}), ...(states ? { states } : {}), ...(widths ? { widths } : {}), ...(modes ? { modes } : {}), ...(langs ? { langs } : {}) };
}

/** Export jobs of one UI server: one at a time per run, kept in memory (the files and their records stay on disk). */
export class ExportJobs {
  private jobs: ExportJob[] = [];
  private n = 0;
  /** what runs the export; a test swaps it */
  constructor(private run: typeof exportForRun = exportForRun) {}

  list(): ExportJob[] { return this.jobs; }

  /** Start an export; refused while the run already has one going. Resolves `done` when it ends (tests wait on it). */
  start(runId: string, o: ExportOptions & { version?: number }): { job: ExportJob; done: Promise<void> } {
    if (this.jobs.some((j) => j.runId === runId && j.status === "running")) throw Object.assign(new Error("An export of this run is already running."), { status: 409 });
    const job: ExportJob = { id: `x${++this.n}`, runId, status: "running", startedAt: new Date().toISOString(), formats: o.formats, ...(o.version ? { version: o.version } : {}), lines: [] };
    this.jobs = [job, ...this.jobs].slice(0, 50);
    const done = this.run(runId, o, (m) => { job.lines = [...job.lines, m].slice(-20); })
      .then((r) => { job.status = "done"; job.exportId = `v${r.version}/${r.dir.split(/[\\/]/).pop()}`; })
      .catch((e: Error) => { job.status = "failed"; job.error = e.message.split("\n")[0]; });
    return { job, done };
  }
}

const TYPES: Record<string, string> = { ".png": "image/png", ".pdf": "application/pdf", ".zip": "application/zip", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8" };

/**
 * A file of one of the run's exports: `vN/n/<path>` (a file the export recorded) or `vN/n.zip` (the whole export).
 * Undefined unless it is a regular file inside the run's exports folder reached without symlinks.
 */
export async function exportDownload(ledger: Ledger, raw: string): Promise<{ body: Buffer; type: string; name: string } | undefined> {
  const rel = safeRelative(raw);
  if (!rel) return undefined;
  const whole = /^(v\d+)\/(\d+)\.zip$/.exec(rel);
  const one = /^(v\d+)\/(\d+)\/(.+)$/.exec(rel);
  const [v, n] = whole ? [whole[1]!, whole[2]!] : one ? [one[1]!, one[2]!] : [];
  if (!v || !n) return undefined;
  const root = exportsRoot(ledger.dir), dir = join(root, v, n);
  try {
    if (!existsSync(join(dir, "export.json"))) return undefined;
    const realRoot = realpathSync(root);
    for (const p of [join(root, v), dir]) if (lstatSync(p).isSymbolicLink()) return undefined;
    if (!realpathSync(dir).startsWith(realRoot + sep)) return undefined;
    const rec = JSON.parse(readFileSync(join(dir, "export.json"), "utf8")) as { files: { path: string }[]; line: string; version: number };
    const base = `design-${rec.line}-v${rec.version}-export-${n}`.replace(/[^\w.-]/g, "_");
    if (whole) return { body: await zipExport(dir), type: TYPES[".zip"]!, name: `${base}.zip` };
    const file = one![3]!;
    if (!rec.files.some((f) => f.path === file)) return undefined;
    const p = join(dir, file);
    let cur = dir;
    for (const part of file.split("/")) { cur = join(cur, part); if (lstatSync(cur).isSymbolicLink()) return undefined; }
    if (!lstatSync(p).isFile() || !realpathSync(p).startsWith(realRoot + sep)) return undefined;
    const ext = /\.[a-z0-9]+$/i.exec(file)?.[0].toLowerCase() ?? "";
    const type = TYPES[ext];
    if (!type) return undefined;
    return { body: readFileSync(p), type, name: `${base}-${file.split("/").pop()}`.replace(/[^\w.-]/g, "_") };
  } catch { return undefined; }
}
