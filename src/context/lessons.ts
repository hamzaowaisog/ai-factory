// Repo lessons: what earlier runs on this project learned about where tests go, so the next test
// writer doesn't spend its first 10–35 tool calls finding the test project, its libraries and a file
// to copy the style from (measured on the first real runs). Facts only, taken from tests that passed
// the fails-on-base check; no model is involved. Kept per project in ~/.factory/repos/<project>/,
// never in the client repo. A lesson is used only if its files still exist in the code being tested.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { factoryHome } from "../util/paths.js";

export interface TestLesson {
  /** folder the locked tests went into, repo-relative */
  dir: string;
  /** the test project file (nearest .csproj above that folder) */
  csproj: string;
  /** its package references (test framework, assertion and mocking libraries) */
  packages: string[];
  /** existing test files next to them, to copy the style from */
  examples: string[];
  lastUsed: string;
  uses: number;
}

export interface Lessons { tests: TestLesson[] }

const MAX_LESSONS = 5;

export function lessonsPath(project: string): string {
  return join(factoryHome(), "repos", project, "lessons.json");
}

export function readLessons(project: string): Lessons {
  try {
    const p = lessonsPath(project);
    return existsSync(p) ? { tests: (JSON.parse(readFileSync(p, "utf8")) as Lessons).tests ?? [] } : { tests: [] };
  } catch {
    return { tests: [] };
  }
}

/** The nearest .csproj at or above `dir` (repo-relative), inside the worktree. */
function nearestCsproj(root: string, dir: string): string | undefined {
  for (let d = dir; ; d = posix.dirname(d)) {
    const abs = join(root, d);
    if (existsSync(abs)) {
      const p = readdirSync(abs).find((f) => f.endsWith(".csproj"));
      if (p) return d === "." ? p : `${d}/${p}`;
    }
    if (d === "." || d === "" || d === "/") return undefined;
  }
}

function packagesOf(root: string, csproj: string): string[] {
  const text = readFileSync(join(root, csproj), "utf8");
  return [...text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]!).slice(0, 12);
}

/** Existing test files in the same folder (not the ones this run wrote), for style. */
function examplesIn(root: string, dir: string, exclude: Set<string>): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".cs")).map((f) => (dir === "." ? f : `${dir}/${f}`))
    .filter((f) => !exclude.has(f) && /\[(Fact|Theory|Test|TestMethod)\b/.test(readFileSync(join(root, f), "utf8")))
    .sort().slice(0, 2);
}

/**
 * After tests are locked: remember where they went. `lockedFiles` are the files this run wrote;
 * examples are only files that were already there. Returns the updated lessons.
 */
export function recordTestLesson(project: string, root: string, lockedFiles: string[], now = new Date()): Lessons {
  const lessons = readLessons(project);
  const mine = new Set(lockedFiles);
  for (const dir of [...new Set(lockedFiles.filter((f) => f.endsWith(".cs")).map((f) => posix.dirname(f)))]) {
    const csproj = nearestCsproj(root, dir);
    if (!csproj) continue;
    const found = lessons.tests.find((l) => l.dir === dir && l.csproj === csproj);
    const fresh = { dir, csproj, packages: packagesOf(root, csproj), examples: examplesIn(root, dir, mine), lastUsed: now.toISOString() };
    if (found) Object.assign(found, fresh, { uses: found.uses + 1, examples: fresh.examples.length ? fresh.examples : found.examples });
    else lessons.tests.push({ ...fresh, uses: 1 });
  }
  lessons.tests.sort((a, b) => b.uses - a.uses || b.lastUsed.localeCompare(a.lastUsed));
  lessons.tests = lessons.tests.slice(0, MAX_LESSONS);
  const p = lessonsPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(lessons, null, 1));
  renameSync(`${p}.tmp`, p);
  return lessons;
}

/** Lessons whose files still exist in this code; stale examples are dropped, a missing project drops the lesson. */
export function usableLessons(lessons: Lessons, root: string, max = 2): TestLesson[] {
  return lessons.tests
    .filter((l) => existsSync(join(root, l.csproj)))
    .map((l) => ({ ...l, examples: l.examples.filter((e) => existsSync(join(root, e))) }))
    .slice(0, max);
}

/** Pointers for the test writer's briefing. */
export function lessonPointers(ls: TestLesson[]): { path: string; reason: string }[] {
  return ls.flatMap((l) => [
    { path: l.csproj, reason: `earlier runs on this repo put tests in ${l.dir} (${l.uses}×); libraries: ${l.packages.join(", ") || "see the file"}` },
    ...l.examples.map((e) => ({ path: e, reason: "an existing test there: follow its style" })),
  ]);
}
