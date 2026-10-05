// Cross-run cache for estimate model steps (docs/estimate-consistency.md, option A). A model step is
// keyed by everything it was given: the rendered briefing, the images, the model, the effort and, for
// steps that read the repository, the commit. The same key returns the stored answer, so the same
// requirements give the same breakdown and proposals, and the hours maths (code) gives the same totals.
// A change to any input, prompt or model is a different key, so a stale answer is never replayed.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashJson } from "../util/hash.js";
import { factoryHome } from "../util/paths.js";

export interface CacheKeyInput {
  model: string;
  effort: string | undefined;
  system: string;
  user: string;
  images: string[];
  tools: string[];
  /** repository state for steps that read it; undefined when there is no repository */
  repoCommit?: string;
}

export interface CacheEntry<T = unknown> { key: string; step: string; route: string; model: string; runId: string; createdAt: string; output: T }

export const cacheDir = (): string => join(factoryHome(), "cache", "think");

/** `FACTORY_NO_CACHE=1` (or `factory estimate --fresh`) skips reads and writes for the process. */
export const cacheDisabled = (): boolean => process.env.FACTORY_NO_CACHE === "1";

export function cacheKey(i: CacheKeyInput): string {
  return hashJson({ v: 1, ...i, tools: [...i.tools].sort() });
}

const file = (key: string): string => join(cacheDir(), `${key}.json`);

export function cacheGet<T>(key: string): CacheEntry<T> | undefined {
  try {
    const p = file(key);
    if (!existsSync(p)) return undefined;
    const e = JSON.parse(readFileSync(p, "utf8")) as CacheEntry<T>;
    return e.key === key ? e : undefined;
  } catch { return undefined; }
}

/** Drops a stored answer the step's own checks rejected, so a retry with the same briefing asks the model again. */
export function cacheForget(key: string): void {
  try { rmSync(file(key), { force: true }); } catch { /* ignore */ }
}

/** Best effort: a cache that cannot be written never fails a run. */
export function cachePut(e: CacheEntry): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const tmp = `${file(e.key)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(e));
    renameSync(tmp, file(e.key));
  } catch { /* ignore */ }
}
