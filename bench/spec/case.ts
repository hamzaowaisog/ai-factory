// Spec-eval cases (bench/spec/CASES.md): a request against a pinned public repo, the facts a person would
// answer questions from, the gaps clarify should raise, and what the final spec must and must not say.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

export const HERE = dirname(fileURLToPath(import.meta.url));

/** YAML reads 403 or true as a number or boolean; an alternative is always text. */
const Alt = z.union([z.string().min(1), z.number(), z.boolean()]).transform(String);
/** Groups of alternatives: every group needs one alternative in the text (a word start, or /regex/). */
export const Matcher = z.array(z.array(Alt).min(1)).min(1);
export type Matcher = z.infer<typeof Matcher>;

const Item = z.object({ id: z.string().min(1), match: Matcher, why: z.string().optional() });

export const EvalCase = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  repo: z.string().min(1),
  kind: z.enum(["feature", "bugfix", "refactor"]),
  request: z.string().min(10),
  facts: z.array(z.object({ id: z.string().min(1), about: Matcher, answer: z.string().min(1) })).default([]),
  gaps: z.array(z.object({ id: z.string().min(1), match: Matcher, fact: z.string().optional() })).default([]),
  expect: z.array(Item).min(1),
  forbid: z.array(Item).default([]),
}).superRefine((c, ctx) => {
  const ids = [...c.facts, ...c.gaps, ...c.expect, ...c.forbid].map((x) => x.id);
  for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) ctx.addIssue({ code: "custom", message: `duplicate id ${id}` });
  for (const g of c.gaps) if (g.fact && !c.facts.some((f) => f.id === g.fact)) ctx.addIssue({ code: "custom", path: ["gaps"], message: `${g.id} names unknown fact ${g.fact}` });
});
export type EvalCase = z.infer<typeof EvalCase>;

export const RepoPin = z.object({ url: z.string().url(), commit: z.string().regex(/^[0-9a-f]{40}$/), about: z.string().optional() });
export type RepoPin = z.infer<typeof RepoPin>;

export function loadRepos(file = join(HERE, "repos.yaml")): Record<string, RepoPin> {
  return z.record(z.string(), RepoPin).parse(parse(readFileSync(file, "utf8")));
}

/** Every case in the folder, sorted by id; a broken file names itself. */
export function loadCases(dir = join(HERE, "cases"), repos: Record<string, RepoPin> = loadRepos()): EvalCase[] {
  const cases = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => {
    const r = EvalCase.safeParse(parse(readFileSync(join(dir, f), "utf8")));
    if (!r.success) throw new Error(`${f}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    if (!repos[r.data.repo]) throw new Error(`${f}: unknown repo "${r.data.repo}" (add it to repos.yaml)`);
    return r.data;
  });
  const ids = cases.map((c) => c.id);
  const dup = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dup) throw new Error(`two cases are called ${dup}`);
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A plain alternative matches at the start of a word ("notif" hits notification, "tax" misses syntax). */
function alt(a: string, text: string): boolean {
  if (a.length > 2 && a.startsWith("/") && a.endsWith("/")) return new RegExp(a.slice(1, -1), "i").test(text);
  return new RegExp(`(?<![a-z0-9])${esc(a.toLowerCase())}`).test(text);
}

export function hits(m: Matcher, text: string): boolean {
  const t = text.toLowerCase();
  return m.every((g) => g.some((a) => alt(a, t)));
}

/** How many alternatives hit, over all groups: ranks two facts that both match a question. */
export function strength(m: Matcher, text: string): number {
  const t = text.toLowerCase();
  return m.reduce((n, g) => n + g.filter((a) => alt(a, t)).length, 0);
}

/**
 * Words that turn up in almost any question or spec line. A matcher whose only group leans on one of them hits
 * questions it isn't about, so the oracle hands out the wrong fact; such words only count next to a second group.
 */
export const LOOSE = new Set(["again", "all", "any", "apply", "case", "change", "data", "date", "dto", "empty", "error", "exist", "field", "filter", "id", "job",
  "list", "low", "match", "message", "new", "old", "only", "order", "put", "remove", "response", "return", "status", "time", "update", "url", "user", "when", "who"]);
const loose = (a: string) => LOOSE.has(a.toLowerCase()) || /^\d{1,3}$/.test(a);

/** Fact, gap and forbid matchers with a single group must not hit on a loose word alone. */
export function looseMatchers(c: EvalCase): string[] {
  const out: string[] = [];
  const check = (where: string, m: Matcher) => {
    if (m.length > 1) return;
    const bad = m[0]!.filter(loose);
    if (bad.length) out.push(`${c.id} ${where}: ${bad.join(", ")}`);
  };
  for (const f of c.facts) check(f.id, f.about);
  for (const g of c.gaps) check(g.id, g.match);
  for (const x of c.forbid) check(x.id, x.match);
  return out;
}
