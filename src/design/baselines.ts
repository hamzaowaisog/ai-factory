// Accepted pictures of the built app (docs/estimates-design.md, "Fidelity and tests", baselines): the fidelity check compares each
// page it opens with the picture a person accepted for it, and the accept card shows the difference next to the approved design.
// Accepting copies the run's built picture into the design line's `baselines/` folder (beside its versions, so a later version is
// compared with what was accepted before) and records who accepted it and why in the run's ledger.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HUMAN_WRITER, type Ledger } from "../ledger/ledger.js";
import type { FidelityReport } from "./fidelity-app.js";
import type { DesignPackage } from "./package.js";

export interface BaselineEntry { file: string; sha256: string; run: string; designVersion: number; by: string; at: string; reason: string }
export interface BaselineIndex { kind: "ai-factory/design-baselines"; line: string; pages: Record<string, BaselineEntry> }

export const baselinesDir = (pkg: DesignPackage): string => join(dirname(pkg.dir), "baselines");
const indexPath = (pkg: DesignPackage): string => join(baselinesDir(pkg), "index.json");

export function readBaselineIndex(pkg: DesignPackage): BaselineIndex {
  const p = indexPath(pkg);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf8")) as BaselineIndex; } catch { /* a broken index is an empty one */ }
  }
  return { kind: "ai-factory/design-baselines", line: pkg.manifest.line, pages: {} };
}

/** The accepted pictures by page key, as absolute paths (only the ones still on disk). */
export function readBaselines(pkg: DesignPackage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, e] of Object.entries(readBaselineIndex(pkg).pages)) {
    const f = join(baselinesDir(pkg), e.file);
    if (existsSync(f)) out[k] = f;
  }
  return out;
}

export class BaselineError extends Error {}

/**
 * Accept the run's built pictures of these pages (all pictured pages when `keys` is "all") as the new baselines. Returns the keys
 * accepted. Needs a name and a reason; a page the report did not picture is refused.
 */
export async function acceptBaselines(o: { ledger: Ledger; pkg: DesignPackage; report: FidelityReport; keys: string[] | "all"; by: string; reason: string; now?: Date }): Promise<string[]> {
  const reason = o.reason.trim();
  if (!reason) throw new BaselineError("Accepting a baseline needs a reason.");
  if (!o.by.trim()) throw new BaselineError("Accepting a baseline needs a name.");
  const pictured = o.report.pages.filter((p) => p.built);
  const want = o.keys === "all" ? pictured.map((p) => p.key) : [...new Set(o.keys)];
  if (!want.length) throw new BaselineError("There is no built picture to accept.");
  const unknown = want.filter((k) => !pictured.some((p) => p.key === k));
  if (unknown.length) throw new BaselineError(`Not pictured in this run's fidelity check: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ""}`);
  const dir = baselinesDir(o.pkg);
  mkdirSync(dir, { recursive: true });
  const index = readBaselineIndex(o.pkg);
  const at = (o.now ?? new Date()).toISOString();
  const shas: Record<string, string> = {};
  for (const k of want) {
    const page = pictured.find((p) => p.key === k)!;
    const from = join(o.ledger.dir, page.built!);
    if (!existsSync(from)) throw new BaselineError(`The built picture of ${k} is missing (${page.built})`);
    const file = `${k}.png`;
    copyFileSync(from, join(dir, file));
    const sha256 = createHash("sha256").update(readFileSync(from)).digest("hex");
    shas[k] = sha256;
    index.pages[k] = { file, sha256, run: o.ledger.runId, designVersion: o.pkg.manifest.version, by: o.by, at, reason };
  }
  writeFileSync(indexPath(o.pkg), JSON.stringify(index, null, 2) + "\n");
  const artifactSha = o.ledger.putJson({ kind: "design-baselines", line: o.pkg.manifest.line, version: o.pkg.manifest.version, pages: shas });
  await o.ledger.append({ type: "human.decided", data: { cardId: "design-baseline", decision: "accept-baseline", by: o.by, artifactSha, reason, pages: want } }, HUMAN_WRITER);
  return want;
}
