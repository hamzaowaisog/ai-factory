// Is a case fit to score anything? Free: git and the lab, no model. On a fresh base at least one hidden test must fail,
// the same way both times (the tests that pass there are guards: behaviour that must keep working); with the reference
// patch every hidden test passes three times in a row and every existing test still passes; the broken patch fails at
// least one. A case whose results flip between runs is unstable and is not scored.
import { commitWith, brokenExisting, freshBase, hiddenOutcomes, runSuite, type HiddenOutcome } from "./lab.js";
import { patchSize, type E2ECase } from "./case.js";

export interface Validation {
  caseId: string;
  ok: boolean;
  unstable: boolean;
  problems: string[];
  hiddenTests: string[];
  /** hidden tests that pass on the base: behaviour that must keep working */
  guards: string[];
  referenceSize: { lines: number; files: string[] };
}

const all = (m: Map<string, HiddenOutcome>, o: HiddenOutcome) => [...m.values()].every((v) => v === o);

export async function validateCase(c: E2ECase, log: (m: string) => void = () => undefined): Promise<Validation> {
  const problems: string[] = [];
  const { dir, commit } = freshBase(c);
  const run = async (label: string, branch: string, patch?: string) => {
    const head = commitWith(dir, commit, branch, { patch, hidden: c.hidden });
    const r = await runSuite(c, dir, head);
    const h = hiddenOutcomes(c, r);
    log(`  ${c.id} ${label}: ${r.built ? "" : "BUILD FAILED; "}${[...h].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (!r.built) problems.push(`${label}: build failed: ${r.buildErrors.join(" | ")}`);
    return { r, h };
  };
  // base, twice: at least one hidden test fails (the change), the same way both times; the rest are guards
  const base = [await run("base #1", "v-base"), await run("base #2", "v-base")];
  const sameBase = JSON.stringify([...base[0]!.h]) === JSON.stringify([...base[1]!.h]);
  if (!sameBase) problems.push("the base gave different hidden results on its two runs");
  for (const [i, b] of base.entries()) {
    if (![...b.h.values()].includes("fail")) problems.push(`base #${i + 1}: no hidden test fails on the base, so the case tests nothing`);
    const missing = [...b.h].filter(([, v]) => v === "missing").map(([k]) => k);
    if (missing.length) problems.push(`base #${i + 1}: hidden tests didn't run: ${missing.join(", ")}`);
  }
  // reference: every hidden test passes, three times in a row, and nothing that was there breaks
  const ref = [];
  for (let i = 1; i <= 3; i++) ref.push(await run(`reference #${i}`, "v-ref", c.reference));
  for (const [i, x] of ref.entries()) {
    if (!all(x.h, "pass")) problems.push(`reference #${i + 1}: ${[...x.h].filter(([, v]) => v !== "pass").map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const broke = brokenExisting(c, x.r);
    if (broke.length) problems.push(`reference #${i + 1} breaks existing tests: ${broke.slice(0, 3).join(", ")}`);
  }
  // broken: the harness must catch it
  const bad = await run("broken", "v-broken", c.broken);
  if (all(bad.h, "pass")) problems.push("the broken patch passes every hidden test: the tests don't catch it");
  const runs = [...base, ...ref];
  const unstable = !sameBase || (ref.some((x) => all(x.h, "pass")) && ref.some((x) => !all(x.h, "pass")));
  const guards = [...base[0]!.h].filter(([, v]) => v === "pass").map(([k]) => k);
  return { caseId: c.id, ok: problems.length === 0, unstable, problems, hiddenTests: [...runs[0]!.h.keys()], guards, referenceSize: patchSize(c.reference) };
}
