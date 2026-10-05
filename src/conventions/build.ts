// Building the guidelines: the conflict check between what an outside skill recommends and what
// this repository demonstrably does.
import type { Convention } from "../contracts/index.js";

export interface Conflict { a: string; b: string; why: string }

/** Mutually exclusive choices a repo makes once. An external rule naming the losing side conflicts. */
const EXCLUSIVE: string[][] = [
  ["xunit", "nunit", "mstest"],
  ["fluentassertions", "shouldly"],
  ["moq", "nsubstitute", "fakeiteasy"],
  ["newtonsoft.json", "system.text.json"],
  ["dapper", "entity framework", "ef core"],
];

const mentions = (rule: string, term: string): boolean =>
  new RegExp(`\\b${term.replace(/\./g, "\\.")}\\b`, "i").test(rule);

/**
 * A skill rule is written for .NET in general; this repository made specific choices. Where the two
 * disagree the repository wins — and the person approving the guidelines must SEE it, rather than
 * discover it later through a reviewer reporting correct code as a violation.
 *
 * Only `confirmed` repo rules can win an argument: a `mixed` rule means the repo itself is
 * inconsistent, and there is no settled practice for an external rule to contradict.
 */
export function findConflicts(cs: Convention[]): Conflict[] {
  const repo = cs.filter((x) => x.source !== "stackpack" && x.status === "confirmed");
  const out: Conflict[] = [];
  for (const ext of cs.filter((x) => x.source === "stackpack")) {
    for (const group of EXCLUSIVE) {
      const named = group.find((t) => mentions(ext.rule, t));
      if (!named) continue;
      const theirs = repo.find((r) => group.some((t) => t !== named && mentions(r.rule, t)));
      if (!theirs) continue;
      const used = group.find((t) => t !== named && mentions(theirs.rule, t))!;
      const e = theirs.evidence;
      out.push({ a: ext.id, b: theirs.id, why: `names "${named}"; this repo uses "${used}" (${e.matching}/${e.total} files)` });
    }
  }
  return out;
}
