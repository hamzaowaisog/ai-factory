// Parse vitest's JSON report into test results (stack pack for Node; the TRX parser's counterpart).
// Test ID format: <repo-relative file>::<describe> > <describe> > <test title>.
import type { TestResult } from "../contracts/index.js";
import { classifyFailure } from "./trx.js";

interface Assertion { ancestorTitles?: string[]; title?: string; fullName?: string; status?: string; duration?: number | null; failureMessages?: string[] }
interface FileResult { name?: string; status?: string; message?: string; assertionResults?: Assertion[] }

/** One test's ID: the file it is in, relative to the repo, and its describe titles and title. */
export function vitestId(file: string, ancestors: string[], title: string): string {
  return `${file}::${[...ancestors, title].join(" > ")}`;
}

/** The title a test ID ends with (what `-t` matches on). */
export const titleOf = (id: string): string => id.slice(id.indexOf("::") + 2).split(" > ").at(-1)!;

/** Keep up to 5 frames from the project's own code (not node_modules or node internals). */
export function nodeFrames(stack: string): string[] {
  return stack.split("\n").map((l) => l.trim())
    .filter((l) => l.startsWith("at ") && !/node_modules|node:internal|\(node:/.test(l))
    .map((l) => l.replace(/\/src\//, ""))
    .slice(0, 5);
}

/**
 * The results of a `vitest run --reporter=json` report. `root` is the folder the tests ran in, taken off each file's path.
 * A file that failed to load (an import that does not exist yet) has no tests in the report; its message is returned in `fileErrors`.
 */
export function parseVitestJson(json: string, root = "/src"): { results: TestResult[]; fileErrors: { file: string; message: string }[] } {
  const doc = JSON.parse(json) as { testResults?: FileResult[] };
  if (!doc || !Array.isArray(doc.testResults)) throw new Error("Not a vitest JSON report (no testResults)");
  const rel = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  const results: TestResult[] = [];
  const fileErrors: { file: string; message: string }[] = [];
  for (const f of doc.testResults) {
    const file = rel(f.name ?? "");
    const tests = f.assertionResults ?? [];
    if (!tests.length && f.status === "failed") fileErrors.push({ file, message: (f.message ?? "the file failed to load").slice(0, 2000) });
    for (const a of tests) {
      const id = vitestId(file, a.ancestorTitles ?? [], a.title ?? a.fullName ?? "");
      const durationMs = Math.max(0, Math.round(a.duration ?? 0));
      if (a.status === "passed") results.push({ id, outcome: "passed", durationMs });
      else if (a.status === "failed") {
        const text = (a.failureMessages ?? []).join("\n");
        const [message = "", ...rest] = text.split("\n");
        results.push({ id, outcome: "failed", durationMs, failureKind: classifyFailure(message, rest.join("\n")), message: text.slice(0, 2000), frames: nodeFrames(text) });
      } else if (a.status === "skipped" || a.status === "pending" || a.status === "todo" || a.status === "disabled") results.push({ id, outcome: "skipped", durationMs });
      else results.push({ id, outcome: "notRun", durationMs, message: String(a.status ?? "") });
    }
  }
  return { results, fileErrors };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A `vitest -t` pattern that runs only the tests with these titles. */
export function titlePattern(titles: string[]): string {
  return `(${[...new Set(titles)].map(esc).join("|")})$`;
}
