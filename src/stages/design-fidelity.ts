// design-fidelity (no model): after accept, the built app against the approved design (docs/estimates-design.md, "Fidelity and
// tests"). The app is built and started in fixture mode, every screen opened in the states, widths, modes and languages the design
// package pictures, and checked for tokens, structure and accessibility (blocking gates design.tokens, design.structure and
// design.a11y, waivable on the waiver card) and layout and pixels (advice). On by default whenever the factory generated the
// screens (a kit scaffold), with the kit's own commands; design.fidelity changes them, and `design.fidelity: false` switches it off.
// The app is the agents' code, so it is installed and started in containers (the agent image; the install reaches only the
// package feeds, the app no network at all), never on this machine unless the project says `allowHost: true` (the PR #11
// re-review, blocker 2).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Failure } from "../contracts/index.js";
import { withAppInContainer } from "../design/app-container.js";
import { withApp } from "../design/app-runner.js";
import { readBaselines } from "../design/baselines.js";
import { runFidelity, type FidelityReport } from "../design/fidelity-app.js";
import { FIDELITY_GATES } from "../design/gates.js";
import { packageForRun } from "../design/package.js";
import { buildWaiver, type BuildFailed } from "../estimate/build-waiver.js";
import type { WaiverRow } from "../estimate/log.js";
import { failure, runGate } from "../gates/engine.js";
import { approvedDesignFor } from "./design-inputs.js";
import { readOutput, type StepDef, type StepOutcome } from "./framework.js";
import { scaffoldPreview, type ScaffoldRecord } from "./scaffold-run.js";
import { ProjectConfig } from "../config/project.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";
import type { DesignPackage } from "../design/package.js";
import { AGENT_IMAGE, ensureAgentImage, ensureEgress, feedHostsFrom } from "../runners/netinfra.js";
import { ensureWorktree, runtime } from "./workspace.js";

export const FIDELITY_DIR = "design-fidelity";
export const DEFAULT_INSTALL = "npm install --no-audit --no-fund";

/** The kit's own build-and-start command for a target, on $PORT. */
export const defaultStart = (target: string): string =>
  target === "vite-shadcn" ? "npx vite build && npx vite preview --port $PORT --strictPort" : "npx next build && npx next start -p $PORT";

type FidelityConfig = Exclude<NonNullable<NonNullable<ProjectConfig["design"]>["fidelity"]>, false>;
/** The project's fidelity settings, with the defaults when it sets none. */
export function fidelityConfig(project: ProjectConfig): FidelityConfig {
  const set = project.design?.fidelity;
  return set || (ProjectConfig.shape.design.unwrap().shape.fidelity.unwrap().options[1].parse({}) as FidelityConfig);
}

export const designFidelityStep: StepDef = {
  key: "design-fidelity", stage: "accept", templateVersion: "1",
  inputs: (s) => (s.steps.get("accept")?.status === "completed" ? { integrate: s.steps.get("integrate")!.outputs[0], head: s.steps.get("integrate")!.data?.commit } : undefined),
  async run(ctx): Promise<StepOutcome> {
    const head = String(ctx.state.steps.get("integrate")!.data!.commit);
    const done = (r: FidelityReport, waivers: Omit<WaiverRow, "step">[] = []): StepOutcome => ({
      kind: "done", outputs: { fidelity: ctx.ledger.putJson(r) },
      data: r.skipped && !r.pages.length && !r.levels.some((l) => l.status !== "UNCHECKED")
        ? { skipped: r.skipped, ...(waivers.length ? { waivers } : {}) }
        : { overall: r.overall, pages: r.pages.length, levels: Object.fromEntries(r.levels.map((l) => [l.level, l.status])), ...(waivers.length ? { waivers } : {}) },
    });
    const skip = (why: string): StepOutcome => {
      ctx.log(`fidelity check skipped: ${why}`);
      return done({ kind: "design-fidelity", levels: [], findings: [], pages: [], overall: "unchecked", ran: [], notes: [], skipped: why });
    };
    const scaf = readOutput<ScaffoldRecord>(ctx.state, ctx.ledger, "stub-commit", "scaffold");
    if (!scaf) return skip("the run has no scaffold (no approved design, or it was not generated)");
    if (scaf.target === "repo" || !scaf.screens.length) return skip("the screens are built with the repo's own components, not the kit");
    if (ctx.project.design?.fidelity === false) return skip("switched off (design.fidelity: false in the project config)");
    const cfg = fidelityConfig(ctx.project);
    const approved = approvedDesignFor<Parameters<typeof runFidelity>[0]["design"]>(ctx.state, ctx.ledger);
    if (!approved) return skip("the run has no approved design");
    const pkg = packageForRun(ctx.state.info, approved.sha);
    const wt = await ensureWorktree(ctx, head);
    const outDir = join(ctx.ledger.dir, FIDELITY_DIR);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    let report: FidelityReport;
    try {
      const app = { install: cfg.install ?? DEFAULT_INSTALL, start: cfg.start ?? defaultStart(scaf.target), port: cfg.port, readyPath: cfg.readyPath, timeoutSec: cfg.timeoutSec, env: cfg.env, what: "fidelity check" };
      const check = (baseUrl: string) => runFidelity({
        baseUrl, design: approved.design, screens: scaf.screens.map((x) => x.id),
        ...(pkg ? { demoFile: join(pkg.dir, "demo", "index.html"), shots: pkg.manifest.shots, baselines: readBaselines(pkg) } : {}),
        outDir, relDir: FIDELITY_DIR, log: ctx.log, max: cfg.maxPages,
      });
      if (cfg.allowHost) {
        ctx.log("fidelity check: running the app on this machine (design.fidelity.allowHost: true)");
        report = await withApp({ cwd: wt, ...app }, check, ctx.log);
      } else {
        const rt = runtime();
        await ensureEgress(rt, feedHostsFrom(ctx.policy.registryAllowlist));
        await ensureAgentImage(rt, ctx.project.dotnet.sdkImage);
        report = await withAppInContainer({ rt, image: AGENT_IMAGE, runId: ctx.runId, repo: wt, commit: head, ...app }, check, ctx.log);
      }
    } catch (e) {
      report = { kind: "design-fidelity", levels: [], findings: [], pages: [], overall: "unchecked", ran: [], notes: [], skipped: `the app did not start: ${(e as Error).message}` };
    }
    if (!pkg) report.notes.push("the design package is not in the store, so there are no approved pictures or baselines to compare with");
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    ctx.log(report.skipped ? `fidelity check: not run (${report.skipped})` : `fidelity check: ${report.overall}; ${report.levels.map((l) => `${l.level} ${l.status}`).join(", ")}`);
    // the blocking gates; a failure is the lead's to waive for this commit
    const sha = ctx.ledger.putJson(report);
    const failed: BuildFailed[] = [];
    for (const def of FIDELITY_GATES) {
      const g = await runGate(def, ctx.ledger, ctx.writer, { fidelity: sha }, ctx.policy, { step: "design-fidelity", treeSha: head });
      if (!g.passed) failed.push({ def, failures: (g.failures as Failure[] | undefined) ?? [failure(def.id, g.details)] });
    }
    if (!failed.length) return done(report);
    const w = buildWaiver(ctx, "design-fidelity", failed, head,
      `To fix it instead: change the screens' containers or the design (factory design change ${ctx.runId}), then build again. The pictures and findings are on the run's Design tab (factory design fidelity ${ctx.runId}).`);
    if (w.kind === "ask") return w.outcome;
    return done(report, w.waivers);
  },
};

// ---------- the CLI's and the UI's view, and a check by hand ----------

/** The run's latest fidelity report: the one in its folder (the step's, or a later check by hand), else the step's output. */
export function fidelityOfRun(state: RunState, ledger: Ledger): FidelityReport | undefined {
  const f = join(ledger.dir, FIDELITY_DIR, "report.json");
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, "utf8")) as FidelityReport; } catch { /* fall back to the step's */ } }
  return readOutput<FidelityReport>(state, ledger, "design-fidelity", "fidelity");
}

/** The design package of the run's approved design, when it is in the store. */
export function packageOfRun(state: RunState, ledger: Ledger): DesignPackage | undefined {
  const a = approvedDesignFor(state, ledger);
  return a ? packageForRun(state.info, a.sha) : undefined;
}

/**
 * Check an app that is already running (`factory design fidelity <run> --url`): the run's approved design and the screens its
 * scaffold builds with the kit, written to the run's fidelity folder like the step's. Gates are not run: this is to look.
 */
export async function checkRunningApp(state: RunState, ledger: Ledger, project: ProjectConfig, baseUrl: string, log: (m: string) => void): Promise<FidelityReport> {
  const approved = approvedDesignFor<Parameters<typeof runFidelity>[0]["design"]>(state, ledger);
  if (!approved) throw new Error(`Run ${ledger.runId} has no approved design`);
  const built = readOutput<ScaffoldRecord>(state, ledger, "stub-commit", "scaffold");
  const screens = built?.screens ?? scaffoldPreview(state, ledger, project).layout?.screens;
  if (!screens?.length) throw new Error("The screens are built with the repo's own components: the fidelity check is for a kit scaffold");
  const pkg = packageForRun(state.info, approved.sha);
  const outDir = join(ledger.dir, FIDELITY_DIR);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const report = await runFidelity({
    baseUrl, design: approved.design, screens: screens.map((x) => x.id),
    ...(pkg ? { demoFile: join(pkg.dir, "demo", "index.html"), shots: pkg.manifest.shots, baselines: readBaselines(pkg) } : {}),
    outDir, relDir: FIDELITY_DIR, log, max: fidelityConfig(project).maxPages,
  });
  if (!pkg) report.notes.push("the design package is not in the store, so there are no approved pictures or baselines to compare with");
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** The report as lines for the terminal. */
export function formatFidelity(r: FidelityReport): string[] {
  if (r.skipped && !r.pages.length) return [`fidelity check: not run (${r.skipped})`, ...r.notes.map((n) => `note: ${n}`)];
  const L = [`fidelity check: ${r.overall.toUpperCase()}, ${r.pages.length} page(s); ran ${r.ran.join(", ") || "nothing"}`];
  for (const l of r.levels) L.push(`  ${l.status.padEnd(9)} ${`design.${l.level}`.padEnd(18)} ${l.blocking ? "blocking" : "advice  "}  ${l.detail}`);
  for (const f of r.findings) L.push(`    [${f.level}] ${f.message}  (${f.pages.slice(0, 4).join(", ")}${f.pages.length > 4 ? `, +${f.pages.length - 4}` : ""})`);
  for (const n of r.notes) L.push(`  note: ${n}`);
  return L;
}
