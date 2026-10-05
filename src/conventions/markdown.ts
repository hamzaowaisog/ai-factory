// ONE file is the source of truth. An LLM reviewer reads the prose and the examples; the
// deterministic gate parses the tables back out. A person edits the file directly, which unapproves
// it. Render and parse are inverses, and the round-trip test is what holds them to it.
import type { Convention } from "../contracts/index.js";
import type { Conflict } from "./build.js";

/** A cell's own pipes are escaped, or they would end the column early. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const uncell = (s: string) => s.replace(/\\\|/g, "|").trim();
/** Split a table row on unescaped pipes only. */
const cells = (row: string) => row.split(/(?<!\\)\|/).map((x) => x.trim());

const ev = (c: Convention) => `${c.evidence.matching}/${c.evidence.total} · ${c.evidence.recentMatching}/${c.evidence.recentTotal} recent`;
const chk = (c: Convention) => (c.check ? `\`${cell(`${c.check.tool}:${c.check.ref}`)}\`` : "—");
const applies = (c: Convention) => c.appliesTo.map((p) => `\`${cell(p)}\``).join(", ");
const tick = (s: string) => `\`${cell(s)}\``;

const ROW = (c: Convention) =>
  `| ${c.id} | ${cell(c.rule)} | ${applies(c)} | ${ev(c)} | ${chk(c)} | ${tick(c.exemplar)} | <!-- ${c.status} -->`;

export function renderGuidelines(a: {
  project: string; builtAt: string; conventions: Convention[]; conflicts: Conflict[];
}): string {
  const of = (s: Convention["source"]) => a.conventions.filter((c) => c.source === s);
  const blocking = a.conventions.filter((c) => c.status === "confirmed" && c.check).length;
  return [
    `# Coding guidelines — ${a.project}`,
    ``,
    `<!-- factory-conventions v1 · built ${a.builtAt} · ${a.conventions.length} rules · ${blocking} can block -->`,
    ``,
    `Built once by \`factory conventions build\`. **Nothing uses this file until a person approves it.**`,
    `Edit it and it is unapproved again. Every review reads this file and never scans the codebase.`,
    ``,
    `Approve with: \`factory conventions approve --project ${a.project} <hash>\``,
    ``,
    `## 1. What this repository already does`,
    ``,
    `Mined from your code. A **confirmed** rule carrying a check **can block a merge**.`,
    ``,
    `| ID | Rule | Applies to | Evidence | Check | Example in your code |`,
    `|---|---|---|---|---|---|`,
    ...of("mined").map(ROW),
    ``,
    `## 2. What this repository declares`,
    ``,
    `Read from the config files in your repo, which are already protected from edits in a pull request.`,
    ``,
    `| ID | Rule | Applies to | Evidence | Check | Declared in |`,
    `|---|---|---|---|---|---|`,
    ...of("tool-config").map(ROW),
    ``,
    `## 3. External best practices — advisory only, never block`,
    ``,
    `From the skill files in \`.claude/skills/\`. These have **no evidence in your repository**, so a`,
    `reviewer may mention them and no gate may block on them. They carry no check at all.`,
    ``,
    `| ID | Rule | Applies to | Where it came from |`,
    `|---|---|---|---|`,
    ...of("stackpack").map((c) => `| ${c.id} | ${cell(c.rule)} | ${applies(c)} | ${cell(c.exemplar)} | <!-- ${c.status} -->`),
    ``,
    `## 4. Conflicts`,
    ``,
    ...(a.conflicts.length
      ? [`An external rule disagrees with what your code demonstrably does. **Your repository wins.**`,
         `Leaving one here makes a reviewer report correct code as a violation.`, ``,
         ...a.conflicts.map((x) => `- **${x.a}** vs **${x.b}** — ${x.why}`)]
      : [`None.`]),
    ``,
  ].join("\n");
}

const ID_ROW = /^\|\s*(CV-[0-9a-z]+)\s*\|/i;
const SECTION = /^##\s+(\d)\./;

/** Inverse of renderGuidelines. A file that cannot be read makes the gate fail, never pass. */
export function parseGuidelines(md: string): { conventions: Convention[]; conflicts: Conflict[] } {
  const conventions: Convention[] = [];
  let source: Convention["source"] = "mined";
  for (const line of md.split("\n")) {
    const sec = SECTION.exec(line);
    if (sec) {
      source = sec[1] === "2" ? "tool-config" : sec[1] === "3" ? "stackpack" : "mined";
      continue;
    }
    if (!ID_ROW.test(line.trim())) continue;
    // status travels in an HTML comment, so editing the visible table cannot promote a rule
    const status = (/<\!--\s*(confirmed|mixed|candidate)\s*-->/.exec(line)?.[1] ?? "candidate") as Convention["status"];
    const parts = cells(line.replace(/<\!--[\s\S]*?-->\s*$/, "").trim());
    // leading "" from the opening pipe, and a trailing "" from the closing one
    const col = parts.slice(1).filter((x, i, all) => !(i === all.length - 1 && x === ""));
    const unq = (s: string) => uncell(s).replace(/^`/, "").replace(/`$/, "");
    const id = col[0]!;
    const rule = uncell(col[1] ?? "");
    const appliesTo = (col[2] ?? "`**/*`").split(/`,\s*`/).map(unq);
    if (source === "stackpack") {
      conventions.push({
        id, rule, appliesTo, exemplar: uncell(col[3] ?? ""),
        evidence: { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
        status, source,
      });
      continue;
    }
    const m = /(\d+)\/(\d+)\s*·\s*(\d+)\/(\d+)/.exec(col[3] ?? "");
    const ck = /^`(\w+):([\s\S]*)`$/.exec(uncell(col[4] ?? "—"));
    conventions.push({
      id, rule, appliesTo,
      evidence: m
        ? { matching: +m[1]!, total: +m[2]!, recentMatching: +m[3]!, recentTotal: +m[4]! }
        : { matching: 0, total: 0, recentMatching: 0, recentTotal: 0 },
      ...(ck ? { check: { tool: ck[1] as NonNullable<Convention["check"]>["tool"], ref: ck[2]! } } : {}),
      exemplar: unq(col[5] ?? ""),
      status, source,
    });
  }
  if (conventions.length === 0) {
    throw new Error("The guidelines file has no rule tables: it cannot be used to check anything.");
  }
  const conflicts = [...md.matchAll(/^-\s+\*\*(CV-[0-9a-z]+)\*\*\s+vs\s+\*\*(CV-[0-9a-z]+)\*\*\s+—\s+(.+)$/gim)]
    .map((x) => ({ a: x[1]!, b: x[2]!, why: x[3]!.trim() }));
  return { conventions, conflicts };
}
