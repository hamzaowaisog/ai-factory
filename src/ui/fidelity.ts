// The Design tab's Fidelity panel (docs/estimates-design.md, "Fidelity and tests"): the build's check of the app against the
// approved design, level by level, its findings, each page's built picture beside the approved one (and the accepted baseline and
// the difference). Accepting the built pictures as the baseline is a terminal decision (factory design baseline). Pictures are served
// only from the run's fidelity folder, the design package's shots and the design line's baselines, by name pattern.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { baselinesDir, readBaselineIndex } from "../design/baselines.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { fidelityOfRun, FIDELITY_DIR, packageOfRun } from "../stages/design-fidelity.js";

const shot = (runId: string, kind: string, name: string) => `/fidelity-shots/${encodeURIComponent(runId)}/${kind}/${encodeURIComponent(name)}`;
const base = (p: string) => p.split("/").pop()!;

export function fidelityPanel(ledger: Ledger) {
  const s = replay(ledger.events());
  const r = fidelityOfRun(s, ledger);
  const pkg = packageOfRun(s, ledger);
  const gates = s.gates.filter((g) => ["design.tokens", "design.structure", "design.a11y"].includes(g.gateId)).map((g) => ({ gateId: g.gateId, passed: g.passed, seq: g.seq }));
  const step = s.steps.get("design-fidelity");
  const waivers = ((step?.data as { waivers?: { gateIds: string[]; human: string; reason: string }[] } | undefined)?.waivers) ?? [];
  if (!r) return { runId: ledger.runId, none: "The fidelity check runs after the build's acceptance step whenever the factory generated the screens (or: factory design fidelity <run> --url <app>); design.fidelity: false in the project config turns it off." };
  const index = pkg ? readBaselineIndex(pkg) : undefined;
  return {
    runId: ledger.runId, overall: r.overall, levels: r.levels, findings: r.findings, ran: r.ran, notes: r.notes, ...(r.skipped ? { skipped: r.skipped } : {}),
    gates, waivers, canAccept: !!pkg && r.pages.some((p) => p.built), line: pkg?.manifest.line,
    pages: r.pages.map((p) => ({
      key: p.key, id: p.id, screen: p.screen, state: p.state, viewport: p.viewport, mode: p.mode, lang: p.lang,
      built: p.built ? shot(ledger.runId, "built", base(p.built)) : undefined,
      approved: p.approved && pkg ? shot(ledger.runId, "approved", base(p.approved)) : undefined,
      baseline: index?.pages[p.key] ? shot(ledger.runId, "baseline", index.pages[p.key]!.file) : undefined,
      accepted: index?.pages[p.key] ? { by: index.pages[p.key]!.by, at: index.pages[p.key]!.at, reason: index.pages[p.key]!.reason, run: index.pages[p.key]!.run } : undefined,
      diff: p.diff ? shot(ledger.runId, "diff", base(p.diff)) : undefined, ratio: p.ratio, noticeable: p.noticeable,
      findings: r.findings.filter((f) => f.pages.includes(p.key)).map((f) => ({ level: f.level, message: f.message })),
    })),
  };
}

/** One picture: built/ and diff/ from the run's fidelity folder, approved/ from the package's shots, baseline/ from the line's. */
export function fidelityShot(ledger: Ledger, kind: string, name: string): Buffer | undefined {
  if (!/^[\w.-]+\.png$/.test(name)) return undefined;
  let root: string;
  if (kind === "built" || kind === "diff") root = join(ledger.dir, FIDELITY_DIR, kind);
  else {
    const pkg = packageOfRun(replay(ledger.events()), ledger);
    if (!pkg) return undefined;
    if (kind === "approved") root = join(pkg.dir, "shots");
    else if (kind === "baseline") root = baselinesDir(pkg);
    else return undefined;
  }
  try {
    const r = realpathSync(root);
    const p = join(r, name);
    if (lstatSync(p).isSymbolicLink()) return undefined;
    const real = realpathSync(p);
    if (!real.startsWith(r + sep) || !lstatSync(real).isFile()) return undefined;
    return readFileSync(real);
  } catch { return undefined; }
}
