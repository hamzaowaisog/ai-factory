// Catalogue versions (docs/estimate-consistency.md, section 14). The repo file is the root version; the factory
// writes each tuned version next to the ledgers, as <home>/catalogues/<root>+t<n>.json, and never edits one again.
// New estimates are sized from the newest version of the current root; a run keeps the version its breakdown was
// made with, so re-running or exporting it gives the same numbers. Bumping the repo file's version starts a new
// root, and the tuned versions of the old one are no longer used.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryHome } from "../util/paths.js";
import { Catalogue, loadCatalogue } from "./catalogue.js";

export const cataloguesDir = (): string => join(factoryHome(), "catalogues");

/** The repo version a version descends from: "2026-10-03.1+t2" -> "2026-10-03.1". */
export const rootOf = (version: string): string => version.split("+t")[0]!;
/** How many times a version has been tuned: 0 for the repo file. */
export const generationOf = (version: string): number => Number(version.split("+t")[1] ?? 0);
export const tunedVersion = (root: string, generation: number): string => `${root}+t${generation}`;

/** The tuned versions of one root, oldest first. A file that does not parse is skipped. */
export function storedVersions(root: string): Catalogue[] {
  const dir = cataloguesDir();
  if (!existsSync(dir)) return [];
  const out: Catalogue[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const c = Catalogue.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (rootOf(c.version) === root && generationOf(c.version) > 0) out.push(c);
    } catch { /* not a catalogue */ }
  }
  return out.sort((a, b) => generationOf(a.version) - generationOf(b.version));
}

/** The version new estimates are sized from: the newest tuned version of the repo file, or the repo file. */
export function currentCatalogue(): Catalogue {
  const root = loadCatalogue();
  return storedVersions(root.version).at(-1) ?? root;
}

/** One exact version, for a run pinned to it. Throws when it is gone: the run cannot be re-sized the same way. */
export function catalogueAt(version: string): Catalogue {
  const root = loadCatalogue();
  if (version === root.version) return root;
  const f = join(cataloguesDir(), `${version}.json`);
  if (!existsSync(f)) throw new Error(`catalogue version ${version} is not in ${cataloguesDir()}`);
  return Catalogue.parse(JSON.parse(readFileSync(f, "utf8")));
}

/** Write a new tuned version. Refuses to overwrite: a version, once written, never changes. */
export function saveTuned(c: Catalogue): string {
  const dir = cataloguesDir();
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${c.version}.json`);
  writeFileSync(f, JSON.stringify(Catalogue.parse(c), null, 2) + "\n", { flag: "wx" });
  return f;
}
