// The guidelines as the implementer is shown them. The reviewer reads the whole file; the coding
// agent pays for every line on every turn, so it gets only the rules for the files of its task, as
// a short list, and never a rule the repository itself disagrees with.
import type { Convention } from "../contracts/index.js";
import { matchesAny } from "../util/glob.js";
import { parseGuidelines } from "./markdown.js";

/** Most rules one briefing carries. The repository's own rules come first, so the cut falls on outside advice. */
export const BRIEF_RULES_MAX = 40;

/** A scope entry that names one file. A folder or a pattern could hold any kind of file, so no rule is ruled out by it. */
const isFile = (p: string) => !/[*?{]/.test(p) && !p.endsWith("/") && /\.[A-Za-z0-9]+$/.test(p);

const appliesTo = (c: Convention, fileScope: string[]) =>
  fileScope.some((p) => !isFile(p) || matchesAny(p, c.appliesTo));

/**
 * The rules for a task's files, in the order they are shown: what the repository follows, then
 * outside best practices.
 *
 * Left out: a `mixed` rule (the repository itself is inconsistent, so there is nothing settled to
 * follow), and an outside rule listed under Conflicts (the repository does the opposite, and code
 * written to it would be reported by the reviewer).
 */
export function rulesFor(a: { conventions: Convention[]; markdown: string }, fileScope: string[]): { repo: Convention[]; outside: Convention[] } {
  const lost = new Set(parseGuidelines(a.markdown).conflicts.map((x) => x.a));
  const mine = a.conventions.filter((c) => appliesTo(c, fileScope));
  return {
    repo: mine.filter((c) => c.source !== "stackpack" && c.status === "confirmed"),
    outside: mine.filter((c) => c.source === "stackpack" && !lost.has(c.id)),
  };
}

/** The section text, or undefined when no rule applies to these files. */
export function guidelinesBrief(a: { conventions: Convention[]; markdown: string }, fileScope: string[]): { text: string; shown: number; cut: number } | undefined {
  const { repo, outside } = rulesFor(a, fileScope);
  const total = repo.length + outside.length;
  if (total === 0) return undefined;
  const r = repo.slice(0, BRIEF_RULES_MAX);
  const o = outside.slice(0, BRIEF_RULES_MAX - r.length);
  const where = (c: Convention) => (c.source === "tool-config" ? `declared in ${c.exemplar}` : `example: ${c.exemplar}`);
  const text = [
    `CODING GUIDELINES for the files of this task (approved for this project). The reviewer judges your change against them.`,
    ...(r.length ? [``, `This repository follows these. Write your code the same way:`, ...r.map((c) => `- ${c.rule}${c.exemplar ? ` (${where(c)})` : ""}`)] : []),
    ...(o.length ? [``, `Outside best practices. Follow one where it fits the code around it; where it disagrees with that code or with an exemplar file, the code wins:`, ...o.map((c) => `- ${c.rule}`)] : []),
  ].join("\n");
  return { text, shown: r.length + o.length, cut: total - r.length - o.length };
}
