// External best practices come from curated skill files in the repo, never from a live fetch: a
// person authors them and git reviews them, so the guidelines build needs no network capability.
import type { Convention } from "../contracts/index.js";
import { sha256 } from "../util/hash.js";

/**
 * Which skills contribute rules, what they apply to, and WHICH HEADINGS to read.
 *
 * `sections` is not tidiness. `dotnet-best-practices` is rules from top to bottom, but `code-review`
 * is a procedure with one rule list inside it — its "Spawn both sub-agents" bullets are instructions
 * to a harness ("The full diff command and commit list"), and ingesting those as coding conventions
 * would put nonsense in front of every review. Read the list, not the procedure.
 */
export const SKILLS: Record<string, { appliesTo: string[]; sections?: string[] }> = {
  "dotnet-best-practices": { appliesTo: ["**/*.cs"] },
  "code-review": { appliesTo: ["**/*"], sections: ["3. Identify the standards sources"] },
};

/** `${...}` or `{{...}}` left in a rule means the skill was written for a different harness. */
const PLACEHOLDER = /\$\{[^}]+\}|\{\{[^}]+\}\}/;

export function parseSkillRules(path: string, text: string): Convention[] {
  const name = /^---[\s\S]*?\bname:\s*([^\n]+)[\s\S]*?^---/m.exec(text)?.[1]?.trim() ?? path;
  const cfg = SKILLS[name] ?? { appliesTo: ["**/*"] };
  const body = text.replace(/^---[\s\S]*?^---/m, "");
  const out: Convention[] = [];
  let section = "";
  let include = cfg.sections === undefined;
  for (const line of body.split("\n")) {
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) {
      section = h[1]!.trim();
      include = cfg.sections === undefined || cfg.sections.some((w) => section.startsWith(w));
      continue;
    }
    const b = /^[-*]\s+(.*\S)\s*$/.exec(line);
    if (!b || !section || !include) continue;
    const rule = b[1]!.replace(/\s+/g, " ").trim();
    if (rule.length < 12) continue;                    // a fragment, not a rule
    if (PLACEHOLDER.test(rule)) {
      throw new Error(`${path}: rule contains an unexpanded placeholder, so it cannot be judged: "${rule}"`);
    }
    out.push({
      id: `CV-${sha256(Buffer.from(`${name}|${section}|${rule}`)).slice(0, 8)}`,
      appliesTo: cfg.appliesTo,
      rule,
      // provenance, not a code example: a person approving sees which file and heading said this
      exemplar: `${name} › ${section}`,
      evidence: { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
      // never "confirmed": a rule from outside this repo has no evidence inside it, so it advises
      // and can never block a merge
      status: "candidate",
      source: "stackpack",
    });
  }
  return out;
}
