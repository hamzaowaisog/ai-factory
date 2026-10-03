// Commit replay: does the ripple code layer find the other files a real commit changed? Free (git + code, no model).
//   npx tsx bench/ripple/replay.ts [--per-repo 6] [--cache ~/.factory/bench-repos] [--lenses]
// --lenses also counts each lens's briefing tokens (built locally; no model is called, nothing is spent).
// For each pinned public repo, walk its history back from the pin and take commits that changed 2-15 existing
// code files. Truth = files the commit modified or deleted (added files can't be found by any search), minus docs,
// lockfiles, assets and build/package files (.csproj, .props: version bumps no code search links). Commits whose
// subject says update/bump/upgrade/deps/format are skipped: sweeps, not ripples. Seed = the commit's most-changed non-test code file, standing in for ground (which needs a model).
//   ground-only recall = seed found / truth          (ground finds the primary file, nothing else)
//   code-layer recall  = (seed ∪ candidates) / truth
//   precision          = candidates in truth / candidates (also @10: the first 10 candidates, as the card shows 8)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { candidateFiles, LENSES, rippleCandidates } from "../../src/context/ripple.js";
import { buildPack } from "../../src/context/pack.js";
import { Redactor } from "../../src/context/secrets.js";
import { lensSections } from "../../src/stages/impact-lens.js";

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : def; };
const PER_REPO = Number(arg("per-repo", "6"));
const CACHE = arg("cache", join(homedir(), ".factory", "bench-repos"));
const LENS_TOKENS = process.argv.includes("--lenses");
/** `commits`: hand-picked commits with their seed (the route or shared type the commit changes), instead of walking history */
const repos = parse(readFileSync(new URL("./repos.yaml", import.meta.url), "utf8")) as Record<string, { url: string; commit: string; stack?: string; commits?: { sha: string; seed: string }[] }>;

const NOT_CODE = /\.(md|txt|png|jpe?g|gif|svg|ico|lock|snap)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|LICENSE[^/]*|\.gitignore|\.editorconfig)$|^(docs?|\.github)\//i;
const BUILD = /\.(csproj|props|targets|sln|slnx)$|(^|\/)(global\.json|\.aspire\/|\.config\/dotnet-tools\.json)/i;
const SWEEP = /\b(update|bump|upgrade|deps|dependenc|format|lint|rename|cleanup|clean up|merge)\b/i;
const CODE = /\.(cs|ts|tsx|js|jsx|razor|cshtml|json|csproj|props|targets|sql|ya?ml)$/i;

// ground anchors point at production code, so the stand-in seed is never a test file
const isTest = (p: string) => /(^|\/)tests?\/|\.Tests?[./]|Tests?\.cs$|\.(test|spec)\.[tj]sx?$/i.test(p);
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 << 20 });

function clone(name: string, url: string, pin: string): string {
  const dir = join(CACHE, name);
  if (!existsSync(dir)) { mkdirSync(CACHE, { recursive: true }); execFileSync("git", ["clone", "--quiet", "--no-checkout", url, dir], { stdio: "inherit" }); }
  git(dir, "cat-file", "-e", pin);
  return dir;
}

interface Pick { sha: string; parent: string; seed: string; truth: string[] }

function truthOf(dir: string, parent: string, sha: string): { truth: string[]; total: number } {
  const status = git(dir, "diff", "--name-status", "--no-renames", parent, sha).trim().split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]);
  return { truth: status.filter(([s, p]) => (s === "M" || s === "D") && CODE.test(p) && !NOT_CODE.test(p) && !BUILD.test(p)).map(([, p]) => p), total: status.length };
}

function pickCommits(dir: string, pin: string, listed?: { sha: string; seed: string }[]): Pick[] {
  if (listed) return listed.map(({ sha, seed }) => {
    const parent = git(dir, "rev-parse", `${sha}^`).trim();
    const { truth } = truthOf(dir, parent, sha);
    if (!truth.includes(seed)) throw new Error(`${sha}: seed ${seed} isn't among the files the commit modified`);
    return { sha: git(dir, "rev-parse", sha).trim(), parent, seed, truth };
  });
  const out: Pick[] = [];
  const shas = git(dir, "rev-list", "--no-merges", "--min-parents=1", "--max-count=400", pin).trim().split("\n");
  for (const sha of shas) {
    if (out.length >= PER_REPO) break;
    if (SWEEP.test(git(dir, "log", "-1", "--format=%s", sha))) continue;
    const parent = git(dir, "rev-parse", `${sha}^`).trim();
    const { truth, total } = truthOf(dir, parent, sha);
    if (truth.length < 2 || total > 15) continue;
    const lines = new Map(git(dir, "diff", "--numstat", "--no-renames", parent, sha).trim().split("\n").map((l) => l.split("\t")).map(([a, d, p]) => [p!, Number(a) + Number(d)]));
    const seed = [...truth].filter((p) => /\.(cs|ts|tsx|js|jsx)$/.test(p) && !isTest(p)).sort((a, b) => (lines.get(b) ?? 0) - (lines.get(a) ?? 0))[0];
    if (!seed) continue;
    out.push({ sha, parent, seed, truth });
  }
  return out;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
interface Row { repo: string; stack: string; sha: string; truth: number; cands: number; hits: number; hits10: number; tokens?: Record<string, number> }
const rows: Row[] = [];

for (const [name, r] of Object.entries(repos)) {
  const dir = clone(name, r.url, r.commit);
  for (const p of pickCommits(dir, r.commit, r.commits)) {
    git(dir, "checkout", "--quiet", "--force", "--detach", p.parent);
    const files = git(dir, "ls-files").trim().split("\n");
    const read = (f: string) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return undefined; } };
    const seeds = [{ path: p.seed }];
    const ripple = rippleCandidates({ files, read }, seeds);
    const cands = candidateFiles(ripple);
    const truth = new Set(p.truth);
    const hits = cands.filter((c) => truth.has(c));
    const row: Row = { repo: name, stack: r.stack ?? "dotnet", sha: p.sha.slice(0, 8), truth: truth.size, cands: cands.length, hits: hits.length, hits10: cands.slice(0, 10).filter((c) => truth.has(c)).length };
    if (LENS_TOKENS) {
      // the briefing each lens would get, counted locally; no model is called
      const subject = git(dir, "log", "-1", "--format=%s", p.sha);
      const spec = { requirements: [{ id: "REQ-1", op: "MODIFIED" as const, ears: subject, sources: [], acceptance: [], anchors: [{ path: p.seed, lineStart: 1, lineEnd: 1, quote: "" }] }] };
      row.tokens = Object.fromEntries(LENSES.map((l) => [l, buildPack({ stage: "impact", cls: "read-large", model: "claude-sonnet-5", recipeVersion: "1", sections: lensSections(l, spec, seeds, ripple), tools: ["read_file", "search"], redactor: new Redactor(), budgetTokens: 15000 }).manifest.packTokens]));
    }
    rows.push(row);
  }
}

// Truth includes the seed: the stand-in for ground "finds" exactly the seed, so ground-only recall is 1/truth.
// "beyond seed" leaves the seed out of both: ground-only is 0 there by construction, the layer's share is hits/(truth-1).
console.log(`repo      commit    truth  ground-only  +code-layer  beyond-seed  cands  precision  prec@10${LENS_TOKENS ? "  lens briefing tokens (callers/data/screens/tests)" : ""}`);
for (const x of rows) console.log(`${x.repo.padEnd(9)} ${x.sha}  ${String(x.truth).padStart(5)}  ${pct(1, x.truth).padStart(11)}  ${pct(1 + x.hits, x.truth).padStart(11)}  ${pct(x.hits, x.truth - 1).padStart(11)}  ${String(x.cands).padStart(5)}  ${pct(x.hits, x.cands).padStart(9)}  ${pct(x.hits10, Math.min(10, x.cands)).padStart(7)}${x.tokens ? `  ${LENSES.map((l) => x.tokens![l]).join("/")}` : ""}`);
for (const stack of [...new Set(rows.map((x) => x.stack))]) {
  const rs = rows.filter((x) => x.stack === stack);
  const sum = (f: (x: Row) => number) => rs.reduce((n, x) => n + f(x), 0);
  const truth = sum((x) => x.truth), hits = sum((x) => x.hits), cands = sum((x) => x.cands);
  console.log(`\n${stack}: ${rs.length} commits, ${truth} truth files (seed included)`);
  console.log(`  recall pooled: ground-only ${pct(rs.length, truth)}, ground + code layer ${pct(rs.length + hits, truth)}; beyond the seed: ${pct(hits, truth - rs.length)} (ground-only 0%)`);
  console.log(`  recall per-commit mean: ground-only ${pct(sum((x) => 1 / x.truth), rs.length)}, ground + code layer ${pct(sum((x) => (1 + x.hits) / x.truth), rs.length)}`);
  console.log(`  precision: ${hits} of ${cands} candidates (${pct(hits, cands)}); first 10: ${pct(sum((x) => x.hits10), sum((x) => Math.min(10, x.cands)))}`);
  if (LENS_TOKENS) console.log(`  lens briefing tokens, mean per commit: ${LENSES.map((l) => `${l} ${Math.round(sum((x) => x.tokens![l]!) / rs.length)}`).join(", ")} (briefing only; tool reads add to it)`);
}
