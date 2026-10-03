// The UI's Code panel (docs/estimates-design.md, "Kit and scaffold"): the UI target a run's approved design is built in, the files
// the scaffold writes, and a copy of them to download and run (fixture mode opens every state without a backend). Generating only
// writes under the run's own `scaffold/` folder; the build writes the repo's copy itself, in its stub commit.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../config/project.js";
import { zipExport } from "../design/export.js";
import { UI_TARGETS, writeScaffold, type UiTarget } from "../design/kit/index.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { scaffoldPreview, scaffoldView, type ScaffoldView } from "../stages/scaffold-run.js";

export const scaffoldDir = (ledger: Ledger, target: string): string => join(ledger.dir, "scaffold", target);

export type ScaffoldPanel =
  | { runId: string; available: false; why: string; targets: readonly string[] }
  | { runId: string; available: true; targets: readonly string[]; view: ScaffoldView; generated: string[] };

function target(v: unknown): UiTarget | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (!(UI_TARGETS as readonly unknown[]).includes(v)) throw Object.assign(new Error(`target is one of ${UI_TARGETS.join(", ")}`), { status: 400 });
  return v as UiTarget;
}

/** The run's scaffold (or another target's), and which targets have a generated copy to download. */
export function scaffoldPanel(ledger: Ledger, want?: unknown): ScaffoldPanel {
  const t = target(want);
  const state = replay(ledger.events());
  const generated = UI_TARGETS.filter((x) => existsSync(scaffoldDir(ledger, x)));
  try {
    const s = scaffoldPreview(state, ledger, loadProject(state.info.project), { ...(t ? { target: t } : {}) });
    return { runId: ledger.runId, available: true, targets: UI_TARGETS, view: scaffoldView(s, s.built), generated };
  } catch (e) {
    return { runId: ledger.runId, available: false, why: (e as Error).message, targets: UI_TARGETS };
  }
}

/** Write the scaffold to the run's `scaffold/<target>/` folder (replacing an earlier copy). */
export function generateScaffold(ledger: Ledger, body: Record<string, unknown>): { target: string; dir: string; files: number } {
  const t = target(body.target);
  const state = replay(ledger.events());
  const s = scaffoldPreview(state, ledger, loadProject(state.info.project), { ...(t ? { target: t } : {}) });
  if (!s.layout) throw Object.assign(new Error(`The target is ${s.target}: the screens are built with the repo's own components, so there is no scaffold to generate`), { status: 409 });
  const dir = scaffoldDir(ledger, s.target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { target: s.target, dir, files: writeScaffold(s.layout, dir).length };
}

/** `<target>.zip`: a generated copy as a zip. */
export async function scaffoldDownload(ledger: Ledger, name: string): Promise<{ body: Buffer; name: string } | undefined> {
  const m = /^([a-z-]+)\.zip$/.exec(name);
  if (!m || !(UI_TARGETS as readonly string[]).includes(m[1]!)) return undefined;
  const dir = scaffoldDir(ledger, m[1]!);
  if (!existsSync(dir)) return undefined;
  return { body: await zipExport(dir), name: `${ledger.runId}-${m[1]}.zip` };
}
