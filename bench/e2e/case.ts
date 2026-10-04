// End-to-end eval cases (bench/e2e): a ticket on a pinned public repo, facts to answer its questions, hidden HTTP-level
// tests the factory never sees, our known-good reference patch and one deliberately broken patch.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { loadRepos, Matcher, type RepoPin } from "../spec/case.js";
import { TEST_SCOPE } from "../../src/stages/build.js";
import { matchesAny } from "../../src/util/glob.js";

export const HERE = dirname(fileURLToPath(import.meta.url));

export const E2ECase = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  repo: z.string().min(1),
  kind: z.enum(["bugfix", "feature"]),
  request: z.string().min(20),
  facts: z.array(z.object({ id: z.string().min(1), about: Matcher, answer: z.string().min(1) })).default([]),
  timeoutMin: z.number().positive().default(45),
  maxCostUsd: z.number().positive().default(6),
});
export type E2ECase = z.infer<typeof E2ECase> & {
  dir: string;
  /** hidden test files: repo path → content */
  hidden: Record<string, string>;
  reference: string;
  broken: string;
  pin: RepoPin;
};

export const RepoSettings = z.object({ setup: z.string().optional(), config: z.record(z.string(), z.unknown()) });
export type RepoSettings = z.infer<typeof RepoSettings>;

export function repoSettings(repo: string): RepoSettings & { setupPatch?: string } {
  const s = RepoSettings.parse(parse(readFileSync(join(HERE, "projects", `${repo}.yaml`), "utf8")));
  return { ...s, ...(s.setup ? { setupPatch: join(HERE, "projects", s.setup) } : {}) };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
}

/** Every case, sorted by id; a broken case names itself. */
export function loadE2ECases(dir = join(HERE, "cases"), repos = loadRepos()): E2ECase[] {
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "case.yaml"))).map((d) => {
    const root = join(dir, d);
    const r = E2ECase.safeParse(parse(readFileSync(join(root, "case.yaml"), "utf8")));
    if (!r.success) throw new Error(`${d}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    if (r.data.id !== d) throw new Error(`${d}: its case.yaml says id ${r.data.id}`);
    const pin = repos[r.data.repo];
    if (!pin) throw new Error(`${d}: unknown repo "${r.data.repo}" (bench/spec/repos.yaml)`);
    const hiddenDir = join(root, "hidden");
    const hidden = Object.fromEntries(filesUnder(hiddenDir).map((f) => [relative(hiddenDir, f).split("\\").join("/"), readFileSync(f, "utf8")]));
    if (!Object.keys(hidden).length) throw new Error(`${d}: no hidden tests`);
    for (const p of Object.keys(hidden)) if (!matchesAny(p, TEST_SCOPE)) throw new Error(`${d}: hidden file ${p} is not in a test folder`);
    return { ...r.data, dir: root, hidden, reference: readFileSync(join(root, "reference.patch"), "utf8"), broken: readFileSync(join(root, "broken.patch"), "utf8"), pin };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Production lines (added + removed) and files a patch touches; test files and .factory/ are left out. */
export function patchSize(patch: string): { lines: number; files: string[] } {
  const files: string[] = [];
  let lines = 0, current: string | undefined;
  for (const l of patch.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l)?.[1]?.trim();
    // tests and the factory's own evidence manifest are not production code
    if (f) { current = matchesAny(f, TEST_SCOPE) || f.startsWith(".factory/") ? undefined : f; if (current) files.push(current); continue; }
    if (current && /^[+-](?![+-]{2} )/.test(l)) lines++;
  }
  return { lines, files };
}

/** The hidden tests' test ids look like `<assembly>::<Namespace>.Hidden_<Case>Tests.<Method>`: their class names. */
export const hiddenClasses = (c: Pick<E2ECase, "hidden">): string[] =>
  Object.keys(c.hidden).map((p) => p.split("/").pop()!.replace(/\.cs$/, ""));
