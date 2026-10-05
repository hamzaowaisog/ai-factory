// Evaluating the repo's own confirmed conventions against the files a change touched.
import type { Convention } from "../contracts/index.js";
import { matchesAny } from "../util/glob.js";

export interface Violation { conventionId: string; file: string; line: number; detail: string }

/**
 * Only `confirmed` conventions carrying a `check` are evaluated — a rule earns the right to block by
 * being demonstrably what the repo already does — and only the `grep` tool is evaluated here.
 * eslint, roslyn, depcruise and archunit are the analyzers' own job and arrive through `LintRun`.
 *
 * CRLF is normalised, so a checkout setting cannot change a verdict: path A and path B must find
 * the same violations in the same tree.
 */
export function checkConventions(cs: Convention[], files: { path: string; text: string }[]): Violation[] {
  const out: Violation[] = [];
  for (const c of cs) {
    if (c.status !== "confirmed" || c.check?.tool !== "grep") continue;
    let rx: RegExp;
    // a mined pattern can be malformed; a bad rule must not take the whole gate down with it
    try { rx = new RegExp(c.check.ref); } catch { continue; }
    for (const f of files) {
      // the repo's own glob matcher, so appliesTo means the same thing as every other path pattern
      if (!matchesAny(f.path, c.appliesTo)) continue;
      f.text.replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
        const m = rx.exec(line);
        if (m) out.push({ conventionId: c.id, file: f.path, line: i + 1, detail: m[0]! });
      });
    }
  }
  return out;
}
