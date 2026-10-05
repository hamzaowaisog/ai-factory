// Analyzer findings from the build log. The build already runs whatever analyzers the repo
// configures, and -p:TreatWarningsAsErrors=false keeps them non-fatal — so today their output is
// simply discarded. This reads it. No new container, no new tool, no new dependency.
import type { LintRun } from "../contracts/index.js";

/**
 * The shape `parseBuildErrors` matches, with "warning" instead: CS, CA, SA (StyleCop), IDE and S
 * (Sonar) codes all come out of the same compiler line format.
 */
export function parseBuildWarnings(log: string): LintRun["findings"] {
  const out: LintRun["findings"] = [];
  const seen = new Set<string>();
  for (const line of log.split("\n")) {
    const m = /^\s*(.+?)\((\d+),\d+\): warning ([A-Z]+\d+): (.+?)(?: \[.*\])?\s*$/.exec(line);
    if (!m) continue;
    const file = m[1]!.replace(/^\/src\//, "");
    // keyed on {file, code}, never the line: a change elsewhere in a file shifts line numbers, and
    // keying on lines would report the whole file as new findings
    const fingerprint = `${file}|${m[3]}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ ruleId: m[3]!, file, line: Number(m[2]), fingerprint, severity: "warning" });
  }
  return out;
}

/**
 * Zero warnings is unachievable on a real repository, so the rule is no NEW findings against the
 * baseline — mirroring how `tests.expectations` uses `knownFailures` to blame a run only for new
 * test failures.
 *
 * Scope is the files this change touched. Otherwise the first run blocks on the entire
 * repository's accumulated debt, which is not this change's fault.
 */
export function newFindings(
  run: Pick<LintRun, "findings">, baseline: LintRun["findings"], changed: string[],
): LintRun["findings"] {
  const known = new Set(baseline.map((f) => f.fingerprint));
  const touched = new Set(changed);
  return run.findings.filter((f) => touched.has(f.file) && !known.has(f.fingerprint));
}
